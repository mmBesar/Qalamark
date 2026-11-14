// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The HTTP API: accounts, notes, sharing.

use crate::auth::{check_password, hash_password, new_token, token_hash, user_for_token, User};
use crate::db::now;
use crate::state::{Shared, Signup};
use crate::text::{safe_folder, safe_name, valid_username, wiki_links};
use axum::{
    extract::{ws::{Message as WsMessage, WebSocket, WebSocketUpgrade}, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use futures_util::{SinkExt, StreamExt};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

type ApiResult<T> = Result<Json<T>, (StatusCode, String)>;

fn err<T>(code: StatusCode, msg: &str) -> Result<T, (StatusCode, String)> {
    Err((code, msg.to_string()))
}

fn internal<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    tracing::error!("{e}");
    (StatusCode::INTERNAL_SERVER_ERROR, "Something went wrong on the server".into())
}

// ------------------------------------------------------------- accounts

#[derive(Serialize)]
pub struct Status {
    setup: bool,
    signup: bool,
    version: &'static str,
}

pub async fn status(State(s): State<Shared>) -> ApiResult<Status> {
    let count = user_count(&s);
    Ok(Json(Status {
        setup: count == 0,
        signup: count == 0 || signup_open(&s),
        version: env!("CARGO_PKG_VERSION"),
    }))
}

/// Is self-service sign-up on? The admin's switch (stored in the database) wins over the
/// QALAMARK_SIGNUP default.
fn signup_open(s: &Shared) -> bool {
    let stored: Option<String> = s
        .db
        .lock()
        .unwrap()
        .query_row("SELECT value FROM settings WHERE key = 'signup'", [], |r| r.get(0))
        .optional()
        .unwrap_or(None);
    match stored.as_deref() {
        Some("open") => true,
        Some("closed") => false,
        _ => s.cfg.signup == Signup::Open,
    }
}

fn user_count(s: &Shared) -> i64 {
    s.db.lock().unwrap().query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0)).unwrap_or(0)
}

#[derive(Deserialize)]
pub struct Credentials {
    username: String,
    password: String,
    #[serde(default)]
    label: String,
}

#[derive(Serialize)]
pub struct Session {
    token: String,
    username: String,
    admin: bool,
}

fn open_session(s: &Shared, user_id: i64, label: &str) -> Result<String, (StatusCode, String)> {
    let token = new_token();
    s.db.lock()
        .unwrap()
        .execute(
            "INSERT INTO sessions (token_hash, user_id, label, created) VALUES (?1, ?2, ?3, ?4)",
            params![token_hash(&token), user_id, label, now()],
        )
        .map_err(internal)?;
    Ok(token)
}

pub async fn register(State(s): State<Shared>, Json(c): Json<Credentials>) -> ApiResult<Session> {
    let first = user_count(&s) == 0;
    if !first && !signup_open(&s) {
        return err(StatusCode::FORBIDDEN, "Sign-up is closed. Ask the admin to create your account.");
    }
    create_user(&s, &c.username, &c.password, first)?;
    login(State(s), Json(c)).await
}

fn create_user(s: &Shared, name: &str, pw: &str, admin: bool) -> Result<i64, (StatusCode, String)> {
    let name = name.trim().to_lowercase();
    if !valid_username(&name) {
        return err(StatusCode::BAD_REQUEST, "Username: 2-32 characters, a-z 0-9 . _ -");
    }
    if pw.chars().count() < 8 {
        return err(StatusCode::BAD_REQUEST, "The password needs at least 8 characters");
    }
    let hash = hash_password(pw).map_err(internal)?;
    let db = s.db.lock().unwrap();
    match db.execute(
        "INSERT INTO users (username, pass_hash, is_admin, created) VALUES (?1, ?2, ?3, ?4)",
        params![name, hash, admin as i64, now()],
    ) {
        Ok(_) => Ok(db.last_insert_rowid()),
        Err(rusqlite::Error::SqliteFailure(e, _)) if e.code == rusqlite::ErrorCode::ConstraintViolation => {
            err(StatusCode::CONFLICT, "That username is taken")
        }
        Err(e) => Err(internal(e)),
    }
}

pub async fn login(State(s): State<Shared>, Json(c): Json<Credentials>) -> ApiResult<Session> {
    let name = c.username.trim().to_lowercase();
    let row: Option<(i64, String, String, i64)> = s
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT id, username, pass_hash, is_admin FROM users WHERE username = ?1",
            [&name],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(internal)?;
    let ok = match &row {
        Some((_, _, hash, _)) => check_password(&c.password, hash),
        None => false,
    };
    if !ok {
        tokio::time::sleep(std::time::Duration::from_millis(400)).await; // slows down guessing
        return err(StatusCode::UNAUTHORIZED, "Wrong username or password");
    }
    let (id, username, _, admin) = row.unwrap();
    let token = open_session(&s, id, &c.label)?;
    Ok(Json(Session { token, username, admin: admin != 0 }))
}

pub async fn logout(State(s): State<Shared>, headers: axum::http::HeaderMap) -> StatusCode {
    if let Some(t) = headers.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")) {
        let _ = s.db.lock().unwrap().execute("DELETE FROM sessions WHERE token_hash = ?1", [token_hash(t)]);
    }
    StatusCode::NO_CONTENT
}

#[derive(Serialize)]
pub struct Me {
    username: String,
    admin: bool,
}

pub async fn me(user: User) -> Json<Me> {
    Json(Me { username: user.username, admin: user.is_admin })
}

#[derive(Deserialize)]
pub struct NewUser {
    username: String,
    password: String,
    #[serde(default)]
    admin: bool,
}

pub async fn admin_create_user(State(s): State<Shared>, user: User, Json(n): Json<NewUser>) -> ApiResult<Me> {
    if !user.is_admin {
        return err(StatusCode::FORBIDDEN, "Only the admin can add users");
    }
    create_user(&s, &n.username, &n.password, n.admin)?;
    Ok(Json(Me { username: n.username.trim().to_lowercase(), admin: n.admin }))
}

pub async fn admin_list_users(State(s): State<Shared>, user: User) -> ApiResult<Vec<Me>> {
    if !user.is_admin {
        return err(StatusCode::FORBIDDEN, "Only the admin can list users");
    }
    let db = s.db.lock().unwrap();
    let mut st = db.prepare("SELECT username, is_admin FROM users ORDER BY username").map_err(internal)?;
    let rows = st
        .query_map([], |r| Ok(Me { username: r.get(0)?, admin: r.get::<_, i64>(1)? != 0 }))
        .map_err(internal)?
        .filter_map(Result::ok)
        .collect();
    Ok(Json(rows))
}

#[derive(Serialize, Deserialize)]
pub struct AdminSettings {
    signup: bool,
}

pub async fn admin_get_settings(State(s): State<Shared>, user: User) -> ApiResult<AdminSettings> {
    if !user.is_admin {
        return err(StatusCode::FORBIDDEN, "Only the admin can see the settings");
    }
    Ok(Json(AdminSettings { signup: signup_open(&s) }))
}

pub async fn admin_set_settings(State(s): State<Shared>, user: User, Json(n): Json<AdminSettings>) -> ApiResult<AdminSettings> {
    if !user.is_admin {
        return err(StatusCode::FORBIDDEN, "Only the admin can change the settings");
    }
    s.db.lock()
        .unwrap()
        .execute(
            "INSERT INTO settings (key, value) VALUES ('signup', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [if n.signup { "open" } else { "closed" }],
        )
        .map_err(internal)?;
    Ok(Json(n))
}

#[derive(Deserialize)]
pub struct UserChange {
    password: Option<String>,
    admin: Option<bool>,
}

fn admin_count(s: &Shared) -> i64 {
    s.db.lock().unwrap().query_row("SELECT COUNT(*) FROM users WHERE is_admin = 1", [], |r| r.get(0)).unwrap_or(0)
}

pub async fn admin_update_user(
    State(s): State<Shared>,
    user: User,
    Path(name): Path<String>,
    Json(c): Json<UserChange>,
) -> ApiResult<()> {
    if !user.is_admin {
        return err(StatusCode::FORBIDDEN, "Only the admin can change users");
    }
    let name = name.trim().to_lowercase();
    let row: Option<(i64, i64)> = s
        .db
        .lock()
        .unwrap()
        .query_row("SELECT id, is_admin FROM users WHERE username = ?1", [&name], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
        .map_err(internal)?;
    let Some((id, was_admin)) = row else {
        return err(StatusCode::NOT_FOUND, "There is no such user");
    };
    if let Some(admin) = c.admin {
        if !admin && was_admin != 0 && admin_count(&s) <= 1 {
            return err(StatusCode::CONFLICT, "There must always be at least one admin");
        }
        s.db.lock().unwrap().execute("UPDATE users SET is_admin = ?1 WHERE id = ?2", params![admin as i64, id]).map_err(internal)?;
    }
    if let Some(pw) = c.password {
        if pw.chars().count() < 8 {
            return err(StatusCode::BAD_REQUEST, "The password needs at least 8 characters");
        }
        let hash = hash_password(&pw).map_err(internal)?;
        let db = s.db.lock().unwrap();
        db.execute("UPDATE users SET pass_hash = ?1 WHERE id = ?2", params![hash, id]).map_err(internal)?;
        db.execute("DELETE FROM sessions WHERE user_id = ?1", [id]).map_err(internal)?; // sign them out everywhere
    }
    Ok(Json(()))
}

pub async fn admin_delete_user(State(s): State<Shared>, user: User, Path(name): Path<String>) -> ApiResult<()> {
    if !user.is_admin {
        return err(StatusCode::FORBIDDEN, "Only the admin can delete users");
    }
    let name = name.trim().to_lowercase();
    if name == user.username.to_lowercase() {
        return err(StatusCode::CONFLICT, "You cannot delete your own account");
    }
    let row: Option<i64> = s
        .db
        .lock()
        .unwrap()
        .query_row("SELECT id FROM users WHERE username = ?1", [&name], |r| r.get(0))
        .optional()
        .map_err(internal)?;
    let Some(id) = row else {
        return err(StatusCode::NOT_FOUND, "There is no such user");
    };
    let note_ids: Vec<String> = {
        let db = s.db.lock().unwrap();
        let mut st = db.prepare("SELECT id FROM notes WHERE owner_id = ?1").map_err(internal)?;
        let ids = st.query_map([id], |r| r.get(0)).map_err(internal)?.filter_map(Result::ok).collect();
        ids
    };
    for nid in &note_ids {
        s.rooms.drop_room(nid);
    }
    // Their notes are kept: the whole folder moves to the trash, nothing is erased.
    let folder = s.cfg.notes_dir().join(&name);
    if folder.exists() {
        let trash = s.cfg.data.join("trash");
        std::fs::create_dir_all(&trash).map_err(internal)?;
        std::fs::rename(&folder, trash.join(format!("{}-user-{}", now(), name))).map_err(internal)?;
    }
    s.db.lock().unwrap().execute("DELETE FROM users WHERE id = ?1", [id]).map_err(internal)?;
    Ok(Json(()))
}

#[derive(Deserialize)]
pub struct PasswordChange {
    old: String,
    new: String,
}

pub async fn change_password(State(s): State<Shared>, user: User, Json(p): Json<PasswordChange>) -> ApiResult<()> {
    let stored: String = s
        .db
        .lock()
        .unwrap()
        .query_row("SELECT pass_hash FROM users WHERE id = ?1", [user.id], |r| r.get(0))
        .map_err(internal)?;
    if !check_password(&p.old, &stored) {
        return err(StatusCode::UNAUTHORIZED, "The old password is wrong");
    }
    if p.new.chars().count() < 8 {
        return err(StatusCode::BAD_REQUEST, "The password needs at least 8 characters");
    }
    let hash = hash_password(&p.new).map_err(internal)?;
    s.db.lock().unwrap().execute("UPDATE users SET pass_hash = ?2 WHERE id = ?1", params![user.id, hash]).map_err(internal)?;
    Ok(Json(()))
}

// ---------------------------------------------------------------- notes

#[derive(Serialize, Clone)]
pub struct NoteMeta {
    id: String,
    title: String,
    folder: String, // "" or "Work/Projects"
    /// The `title:` property of the note, when it has one (the file name is `title`).
    display: String,
    owner: String,
    role: &'static str, // owner | edit | view
    updated: i64,
}

fn title_of(path: &str) -> String {
    let file = path.rsplit('/').next().unwrap_or(path);
    file.strip_suffix(".md").unwrap_or(file).to_string()
}

/// The `title:` from the note's front matter, read from the top of the file ("" if none).
fn display_of(s: &Shared, path: &str) -> String {
    use std::io::Read;
    let Ok(f) = std::fs::File::open(s.cfg.notes_dir().join(path)) else { return String::new() };
    let mut buf = Vec::new();
    let _ = f.take(2048).read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf);
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") {
        return String::new();
    }
    for l in lines {
        if l.trim() == "---" {
            break;
        }
        if let Some(v) = l.strip_prefix("title:") {
            return v.trim().trim_matches(|c| c == '"' || c == '\'').to_string();
        }
    }
    String::new()
}

fn folder_of(path: &str) -> String {
    // path is "<user>/<folders...>/<file>.md"
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() <= 2 {
        String::new()
    } else {
        parts[1..parts.len() - 1].join("/")
    }
}

/// Every .md file below `dir`, as paths relative to the notes folder. Hidden folders and
/// the images folder are skipped.
fn md_files(root: &std::path::Path, dir: &std::path::Path, out: &mut Vec<String>, depth: usize) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let p = e.path();
        if p.is_dir() && depth < 8 && name != IMAGES_DIR {
            md_files(root, &p, out, depth + 1);
        } else if p.is_file() && name.ends_with(".md") {
            if let Ok(rel) = p.strip_prefix(root) {
                out.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
}

/// Where pasted and uploaded pictures live, inside each user's folder.
pub const IMAGES_DIR: &str = "_images";

/// Notes that appear as .md files in a user's folder become notes automatically.
fn adopt_files(s: &Shared, user: &User) {
    let root = s.cfg.notes_dir();
    let mut files = Vec::new();
    md_files(&root, &root.join(&user.username), &mut files, 0);
    let db = s.db.lock().unwrap();
    for rel in files {
        let exists: bool = db.query_row("SELECT 1 FROM notes WHERE path = ?1", [&rel], |_| Ok(true)).unwrap_or(false);
        if !exists {
            let t = now();
            let _ = db.execute(
                "INSERT INTO notes (id, owner_id, path, created, updated) VALUES (?1, ?2, ?3, ?4, ?4)",
                params![uuid::Uuid::new_v4().to_string(), user.id, rel, t],
            );
        }
    }
}

/// Notes whose file was deleted outside disappear from the list.
fn forget_missing(s: &Shared, notes: &[(String, String)]) {
    for (id, path) in notes {
        if !s.cfg.notes_dir().join(path).exists() && s.rooms.get(id).is_none() {
            let _ = s.db.lock().unwrap().execute("DELETE FROM notes WHERE id = ?1", [id]);
        }
    }
}

pub async fn list_notes(State(s): State<Shared>, user: User) -> ApiResult<Vec<NoteMeta>> {
    adopt_files(&s, &user);
    let rows: Vec<(String, String, String, &'static str, i64)> = {
        let db = s.db.lock().unwrap();
        let mut st = db
            .prepare(
                "SELECT n.id, n.path, o.username,
                        CASE WHEN n.owner_id = ?1 THEN 'owner' ELSE sh.role END, n.updated
                 FROM notes n
                 JOIN users o ON o.id = n.owner_id
                 LEFT JOIN shares sh ON sh.note_id = n.id AND sh.user_id = ?1
                 WHERE n.owner_id = ?1 OR sh.user_id IS NOT NULL
                 ORDER BY n.updated DESC",
            )
            .map_err(internal)?;
        st.query_map([user.id], |r| {
            let role: String = r.get(3)?;
            let role: &'static str = match role.as_str() {
                "owner" => "owner",
                "edit" => "edit",
                _ => "view",
            };
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, role, r.get(4)?))
        })
        .map_err(internal)?
        .filter_map(Result::ok)
        .collect()
    };
    forget_missing(&s, &rows.iter().map(|r| (r.0.clone(), r.1.clone())).collect::<Vec<_>>());
    let out = rows
        .into_iter()
        .filter(|r| s.cfg.notes_dir().join(&r.1).exists() || s.rooms.get(&r.0).is_some())
        .map(|(id, path, owner, role, updated)| NoteMeta { display: display_of(&s, &path), folder: folder_of(&path), id, title: title_of(&path), owner, role, updated })
        .collect();
    Ok(Json(out))
}

struct Access {
    role: &'static str,
    owner: String,
    path: String,
    updated: i64,
}

fn access(s: &Shared, user: &User, id: &str) -> Result<Access, (StatusCode, String)> {
    let db = s.db.lock().unwrap();
    let row: Option<(i64, String, String, i64)> = db
        .query_row(
            "SELECT n.owner_id, o.username, n.path, n.updated FROM notes n JOIN users o ON o.id = n.owner_id WHERE n.id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(internal)?;
    let Some((owner_id, owner, path, updated)) = row else {
        return err(StatusCode::NOT_FOUND, "Note not found");
    };
    let role = if owner_id == user.id {
        "owner"
    } else {
        let r: Option<String> = db
            .query_row("SELECT role FROM shares WHERE note_id = ?1 AND user_id = ?2", params![id, user.id], |r| r.get(0))
            .optional()
            .map_err(internal)?;
        match r.as_deref() {
            Some("edit") => "edit",
            Some(_) => "view",
            None => return err(StatusCode::NOT_FOUND, "Note not found"), // do not reveal it exists
        }
    };
    Ok(Access { role, owner, path, updated })
}

/// Find a file name that is not used yet: "Title.md", "Title 2.md", ...
fn free_path(s: &Shared, username: &str, folder: &str, title: &str, same_as: Option<&str>) -> String {
    let base = safe_name(title);
    let folder = safe_folder(folder);
    let prefix = if folder.is_empty() { username.to_string() } else { format!("{username}/{folder}") };
    let db = s.db.lock().unwrap();
    for n in 1.. {
        let name = if n == 1 { base.clone() } else { format!("{base} {n}") };
        let rel = format!("{prefix}/{name}.md");
        if same_as == Some(rel.as_str()) {
            return rel;
        }
        let taken: bool = db.query_row("SELECT 1 FROM notes WHERE path = ?1", [&rel], |_| Ok(true)).unwrap_or(false);
        if !taken && !s.cfg.notes_dir().join(&rel).exists() {
            return rel;
        }
    }
    unreachable!()
}

#[derive(Deserialize)]
pub struct NewNote {
    title: String,
    #[serde(default)]
    folder: String,
    #[serde(default)]
    content: String,
}

pub async fn create_note(State(s): State<Shared>, user: User, Json(n): Json<NewNote>) -> ApiResult<NoteMeta> {
    let rel = free_path(&s, &user.username, &n.folder, &n.title, None);
    let full: PathBuf = s.cfg.notes_dir().join(&rel);
    std::fs::create_dir_all(full.parent().unwrap()).map_err(internal)?;
    std::fs::write(&full, &n.content).map_err(internal)?;
    let id = uuid::Uuid::new_v4().to_string();
    let t = now();
    s.db.lock()
        .unwrap()
        .execute("INSERT INTO notes (id, owner_id, path, created, updated) VALUES (?1, ?2, ?3, ?4, ?4)", params![id, user.id, rel, t])
        .map_err(internal)?;
    Ok(Json(NoteMeta { display: display_of(&s, &rel), folder: folder_of(&rel), id, title: title_of(&rel), owner: user.username, role: "owner", updated: t }))
}

#[derive(Serialize)]
pub struct NoteFull {
    #[serde(flatten)]
    meta: NoteMeta,
    content: String,
}

pub async fn get_note(State(s): State<Shared>, user: User, Path(id): Path<String>) -> ApiResult<NoteFull> {
    let a = access(&s, &user, &id)?;
    let content = match s.rooms.get(&id) {
        Some(room) => room.text(),
        None => std::fs::read_to_string(s.cfg.notes_dir().join(&a.path)).unwrap_or_default(),
    };
    Ok(Json(NoteFull {
        meta: NoteMeta { display: display_of(&s, &a.path), folder: folder_of(&a.path), id, title: title_of(&a.path), owner: a.owner, role: a.role, updated: a.updated },
        content,
    }))
}

#[derive(Deserialize)]
pub struct Rename {
    title: Option<String>,
    /// Move to this folder ("" = the top).
    folder: Option<String>,
}

pub async fn rename_note(State(s): State<Shared>, user: User, Path(id): Path<String>, Json(r): Json<Rename>) -> ApiResult<NoteMeta> {
    let a = access(&s, &user, &id)?;
    if a.role != "owner" {
        return err(StatusCode::FORBIDDEN, "Only the owner can rename a note");
    }
    let title = r.title.unwrap_or_else(|| title_of(&a.path));
    let folder = r.folder.unwrap_or_else(|| folder_of(&a.path));
    let rel = free_path(&s, &a.owner, &folder, &title, Some(&a.path));
    if rel != a.path {
        let from = s.cfg.notes_dir().join(&a.path);
        let to = s.cfg.notes_dir().join(&rel);
        if from.exists() {
            std::fs::create_dir_all(to.parent().unwrap()).map_err(internal)?;
            std::fs::rename(&from, &to).map_err(internal)?;
        }
        s.db.lock().unwrap().execute("UPDATE notes SET path = ?2 WHERE id = ?1", params![id, rel]).map_err(internal)?;
    }
    Ok(Json(NoteMeta { display: display_of(&s, &rel), folder: folder_of(&rel), id, title: title_of(&rel), owner: a.owner, role: "owner", updated: a.updated }))
}

pub async fn delete_note(State(s): State<Shared>, user: User, Path(id): Path<String>) -> ApiResult<()> {
    let a = access(&s, &user, &id)?;
    if a.role != "owner" {
        return err(StatusCode::FORBIDDEN, "Only the owner can delete a note");
    }
    // Keep a copy in the trash folder instead of erasing it for good.
    let from = s.cfg.notes_dir().join(&a.path);
    if from.exists() {
        let trash = s.cfg.data.join("trash");
        std::fs::create_dir_all(&trash).map_err(internal)?;
        let name = format!("{}-{}-{}.md", now(), a.owner, title_of(&a.path));
        std::fs::rename(&from, trash.join(name)).map_err(internal)?;
    }
    s.rooms.drop_room(&id);
    s.db.lock().unwrap().execute("DELETE FROM notes WHERE id = ?1", [&id]).map_err(internal)?;
    Ok(Json(()))
}

// -------------------------------------------------------------- sharing

#[derive(Serialize)]
pub struct ShareInfo {
    username: String,
    role: String,
}

pub async fn list_shares(State(s): State<Shared>, user: User, Path(id): Path<String>) -> ApiResult<Vec<ShareInfo>> {
    let a = access(&s, &user, &id)?;
    if a.role != "owner" {
        return err(StatusCode::FORBIDDEN, "Only the owner can see who has access");
    }
    let db = s.db.lock().unwrap();
    let mut st = db
        .prepare("SELECT u.username, sh.role FROM shares sh JOIN users u ON u.id = sh.user_id WHERE sh.note_id = ?1 ORDER BY u.username")
        .map_err(internal)?;
    let rows = st
        .query_map([&id], |r| Ok(ShareInfo { username: r.get(0)?, role: r.get(1)? }))
        .map_err(internal)?
        .filter_map(Result::ok)
        .collect();
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct NewShare {
    username: String,
    role: String,
}

pub async fn add_share(State(s): State<Shared>, user: User, Path(id): Path<String>, Json(n): Json<NewShare>) -> ApiResult<ShareInfo> {
    let a = access(&s, &user, &id)?;
    if a.role != "owner" {
        return err(StatusCode::FORBIDDEN, "Only the owner can share a note");
    }
    if n.role != "edit" && n.role != "view" {
        return err(StatusCode::BAD_REQUEST, "Role must be edit or view");
    }
    let name = n.username.trim().to_lowercase();
    let db = s.db.lock().unwrap();
    let uid: Option<i64> = db.query_row("SELECT id FROM users WHERE username = ?1", [&name], |r| r.get(0)).optional().map_err(internal)?;
    let Some(uid) = uid else { return err(StatusCode::NOT_FOUND, "There is no user with that name") };
    if name == a.owner {
        return err(StatusCode::BAD_REQUEST, "That is you - you already own this note");
    }
    db.execute(
        "INSERT INTO shares (note_id, user_id, role) VALUES (?1, ?2, ?3) ON CONFLICT(note_id, user_id) DO UPDATE SET role = excluded.role",
        params![id, uid, n.role],
    )
    .map_err(internal)?;
    Ok(Json(ShareInfo { username: name, role: n.role }))
}

/// The owner removes anyone; a person with access can remove themselves.
pub async fn remove_share(State(s): State<Shared>, user: User, Path((id, name)): Path<(String, String)>) -> ApiResult<()> {
    let a = access(&s, &user, &id)?;
    let name = name.to_lowercase();
    if a.role != "owner" && name != user.username {
        return err(StatusCode::FORBIDDEN, "You can only remove yourself");
    }
    s.db.lock()
        .unwrap()
        .execute("DELETE FROM shares WHERE note_id = ?1 AND user_id = (SELECT id FROM users WHERE username = ?2)", params![id, name])
        .map_err(internal)?;
    Ok(Json(()))
}

// ------------------------------------------------------ live co-editing

pub async fn ws_note(
    State(s): State<Shared>,
    Path(id): Path<String>,
    Query(q): Query<HashMap<String, String>>,
    ws: WebSocketUpgrade,
) -> Response {
    let Some(user) = q.get("token").and_then(|t| user_for_token(&s, t)) else {
        return (StatusCode::UNAUTHORIZED, "Please sign in").into_response();
    };
    let a = match access(&s, &user, &id) {
        Ok(a) => a,
        Err((code, msg)) => return (code, msg).into_response(),
    };
    let can_write = a.role != "view";
    ws.max_message_size(16 * 1024 * 1024).on_upgrade(move |socket| serve_socket(s, id, can_write, socket))
}

async fn serve_socket(s: Shared, id: String, can_write: bool, socket: WebSocket) {
    let room = s.rooms.join(&s, &id);
    let (mut out, mut inp) = socket.split();
    let mut rx = room.tx.subscribe();
    if out.send(WsMessage::Binary(room.hello().into())).await.is_ok() {
        loop {
            tokio::select! {
                msg = inp.next() => match msg {
                    Some(Ok(WsMessage::Binary(data))) => {
                        let replies = room.handle(&data, can_write);
                        let mut failed = false;
                        for r in replies {
                            if out.send(WsMessage::Binary(r.into())).await.is_err() { failed = true; break; }
                        }
                        if failed { break; }
                    }
                    Some(Ok(WsMessage::Close(_))) | None | Some(Err(_)) => break,
                    Some(Ok(_)) => {}
                },
                frame = rx.recv() => match frame {
                    Ok(bytes) => { if out.send(WsMessage::Binary(bytes.into())).await.is_err() { break; } }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        // Too slow to keep up: ask the client to sync again.
                        if out.send(WsMessage::Binary(room.hello().into())).await.is_err() { break; }
                    }
                    Err(_) => break,
                },
            }
        }
    }
    s.rooms.leave(&s, &room);
}

// ------------------------------------------------------------ backlinks

#[derive(Serialize)]
pub struct Backlink {
    id: String,
    title: String,
}

/// Notes (that you can open) which link to this one with [[Title]].
pub async fn backlinks(State(s): State<Shared>, user: User, Path(id): Path<String>) -> ApiResult<Vec<Backlink>> {
    let me = access(&s, &user, &id)?;
    let title = title_of(&me.path).to_lowercase();
    let candidates: Vec<(String, String)> = {
        let db = s.db.lock().unwrap();
        let mut st = db
            .prepare(
                "SELECT n.id, n.path FROM notes n
                 LEFT JOIN shares sh ON sh.note_id = n.id AND sh.user_id = ?1
                 WHERE (n.owner_id = ?1 OR sh.user_id IS NOT NULL) AND n.id <> ?2",
            )
            .map_err(internal)?;
        st.query_map(params![user.id, id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(internal)?
            .filter_map(Result::ok)
            .collect()
    };
    let mut out = Vec::new();
    for (nid, path) in candidates {
        let text = match s.rooms.get(&nid) {
            Some(room) => room.text(),
            None => std::fs::read_to_string(s.cfg.notes_dir().join(&path)).unwrap_or_default(),
        };
        if wiki_links(&text).iter().any(|l| l.to_lowercase() == title) {
            out.push(Backlink { id: nid, title: title_of(&path) });
        }
    }
    out.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(Json(out))
}

// -------------------------------------------------------------- folders

#[derive(Serialize, Deserialize)]
pub struct FolderPath {
    path: String,
}

#[derive(Deserialize)]
pub struct FolderMove {
    from: String,
    to: String,
}

fn user_root(s: &Shared, user: &User) -> PathBuf {
    s.cfg.notes_dir().join(&user.username)
}

fn dirs_below(root: &std::path::Path, dir: &std::path::Path, out: &mut Vec<String>, depth: usize) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == IMAGES_DIR || !e.path().is_dir() || depth >= 8 {
            continue;
        }
        if let Ok(rel) = e.path().strip_prefix(root) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
        dirs_below(root, &e.path(), out, depth + 1);
    }
}

/// All the user's folders, including empty ones.
pub async fn list_folders(State(s): State<Shared>, user: User) -> Json<Vec<String>> {
    let root = user_root(&s, &user);
    let mut out = Vec::new();
    dirs_below(&root, &root, &mut out, 0);
    out.sort_by_key(|p| p.to_lowercase());
    Json(out)
}

pub async fn create_folder(State(s): State<Shared>, user: User, Json(f): Json<FolderPath>) -> ApiResult<FolderPath> {
    let path = safe_folder(&f.path);
    if path.is_empty() || path.split('/').next() == Some(IMAGES_DIR) {
        return err(StatusCode::BAD_REQUEST, "Give the folder a name");
    }
    std::fs::create_dir_all(user_root(&s, &user).join(&path)).map_err(internal)?;
    Ok(Json(FolderPath { path }))
}

/// Rename or move a folder (with everything inside it).
pub async fn move_folder(State(s): State<Shared>, user: User, Json(m): Json<FolderMove>) -> ApiResult<FolderPath> {
    let from = safe_folder(&m.from);
    let to = safe_folder(&m.to);
    if from.is_empty() || to.is_empty() || to == from || to.starts_with(&format!("{from}/")) {
        return err(StatusCode::BAD_REQUEST, "A folder cannot be moved into itself");
    }
    let root = user_root(&s, &user);
    let (src, dst) = (root.join(&from), root.join(&to));
    if !src.is_dir() {
        return err(StatusCode::NOT_FOUND, "There is no such folder");
    }
    if dst.exists() {
        return err(StatusCode::CONFLICT, "A folder with that name already exists");
    }
    std::fs::create_dir_all(dst.parent().unwrap()).map_err(internal)?;
    std::fs::rename(&src, &dst).map_err(internal)?;
    let (old, new) = (format!("{}/{}", user.username, from), format!("{}/{}", user.username, to));
    let db = s.db.lock().unwrap();
    db.execute(
        "UPDATE notes SET path = ?2 || substr(path, ?3) WHERE owner_id = ?1 AND substr(path, 1, ?4) = ?5",
        params![user.id, new, old.chars().count() as i64 + 1, old.chars().count() as i64 + 1, format!("{old}/")],
    )
    .map_err(internal)?;
    Ok(Json(FolderPath { path: to }))
}

/// Delete an empty folder.
pub async fn delete_folder(State(s): State<Shared>, user: User, axum::extract::Query(f): axum::extract::Query<FolderPath>) -> ApiResult<()> {
    let path = safe_folder(&f.path);
    if path.is_empty() {
        return err(StatusCode::BAD_REQUEST, "Give the folder a name");
    }
    match std::fs::remove_dir(user_root(&s, &user).join(&path)) {
        Ok(()) => Ok(Json(())),
        Err(_) => err(StatusCode::CONFLICT, "Only an empty folder can be deleted. Move or delete what is inside first"),
    }
}

// -------------------------------------------------------------- images

#[derive(Serialize)]
pub struct ImageInfo {
    /// The name inside the images folder, e.g. "3f9a1c2e.png".
    name: String,
    /// What to put in the note.
    markdown: String,
}

fn image_ext(content_type: &str) -> Option<&'static str> {
    match content_type.split(';').next().unwrap_or("").trim() {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/avif" => Some("avif"),
        "image/svg+xml" => Some("svg"),
        _ => None,
    }
}

/// Save a picture (the request body) into the user's images folder.
pub async fn upload_image(
    State(s): State<Shared>,
    user: User,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> ApiResult<ImageInfo> {
    let ct = headers.get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("");
    let Some(ext) = image_ext(ct) else {
        return err(StatusCode::UNSUPPORTED_MEDIA_TYPE, "Only png, jpg, gif, webp, avif and svg pictures are supported");
    };
    if body.is_empty() {
        return err(StatusCode::BAD_REQUEST, "The picture is empty");
    }
    let dir = user_root(&s, &user).join(IMAGES_DIR);
    std::fs::create_dir_all(&dir).map_err(internal)?;
    let name = format!("{}.{}", &uuid::Uuid::new_v4().simple().to_string()[..12], ext);
    std::fs::write(dir.join(&name), &body).map_err(internal)?;
    Ok(Json(ImageInfo { markdown: format!("![]({IMAGES_DIR}/{name})"), name }))
}

/// Show a picture: its owner may, and so may anyone the owner shared a note with.
pub async fn get_image(
    State(s): State<Shared>,
    user: User,
    Path((owner, file)): Path<(String, String)>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let clean = !file.is_empty() && !file.contains("..") && file.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if !clean || !valid_username(&owner) {
        return err(StatusCode::BAD_REQUEST, "Bad picture name");
    }
    if owner != user.username {
        let shared: bool = s
            .db
            .lock()
            .unwrap()
            .query_row(
                "SELECT 1 FROM shares sh JOIN notes n ON n.id = sh.note_id JOIN users o ON o.id = n.owner_id
                 WHERE o.username = ?1 AND sh.user_id = ?2 LIMIT 1",
                params![owner, user.id],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if !shared {
            return err(StatusCode::NOT_FOUND, "No such picture");
        }
    }
    let path = s.cfg.notes_dir().join(&owner).join(IMAGES_DIR).join(&file);
    let Ok(bytes) = std::fs::read(&path) else {
        return err(StatusCode::NOT_FOUND, "No such picture");
    };
    let ct = match file.rsplit('.').next().unwrap_or("") {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    };
    Ok(axum::response::Response::builder()
        .header("content-type", ct)
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
        .header("cache-control", "private, max-age=86400")
        .body(axum::body::Body::from(bytes))
        .unwrap())
}

/// Names of the other people on this server, so a note can be shared by picking one.
pub async fn list_usernames(State(s): State<Shared>, user: User) -> ApiResult<Vec<String>> {
    let db = s.db.lock().unwrap();
    let mut st = db.prepare("SELECT username FROM users WHERE username != ?1 ORDER BY username").map_err(internal)?;
    let names = st.query_map([&user.username], |r| r.get(0)).map_err(internal)?.filter_map(Result::ok).collect();
    Ok(Json(names))
}
