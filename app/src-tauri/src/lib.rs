// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The native shell shows the same web app as the browser, and adds one thing: a notes folder.
// Your notes are real .md files in a folder you choose (default: Documents/Qalamark), so any
// other editor, backup tool or sync program can use them too.

mod vault;

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn config_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map(|d| d.join("vault.json")).map_err(|e| e.to_string())
}

fn default_path(app: &AppHandle) -> PathBuf {
    let fallback = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    vault::default_dir(app.path().document_dir().ok(), fallback)
}

fn root(app: &AppHandle) -> PathBuf {
    let chosen = config_file(app)
        .ok()
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("path").and_then(|p| p.as_str().map(PathBuf::from)));
    chosen.unwrap_or_else(|| default_path(app))
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize)]
struct VaultInfo {
    path: String,
    default_path: String,
}

#[derive(Serialize)]
struct Entry {
    path: String,
    mtime_ms: u64,
}

#[derive(Serialize)]
struct Content {
    text: String,
    mtime_ms: u64,
}

#[tauri::command]
fn vault_info(app: AppHandle) -> VaultInfo {
    VaultInfo { path: root(&app).to_string_lossy().to_string(), default_path: default_path(&app).to_string_lossy().to_string() }
}

/// Choose the notes folder (an empty path goes back to the default). Returns the folder in use.
#[tauri::command]
fn vault_set(app: AppHandle, path: String) -> Result<String, String> {
    let file = config_file(&app)?;
    if path.trim().is_empty() {
        let _ = std::fs::remove_file(&file);
    } else {
        let p = PathBuf::from(path.trim());
        std::fs::create_dir_all(&p).map_err(err)?;
        if let Some(d) = file.parent() {
            std::fs::create_dir_all(d).map_err(err)?;
        }
        std::fs::write(&file, serde_json::json!({ "path": p.to_string_lossy() }).to_string()).map_err(err)?;
    }
    let r = root(&app);
    std::fs::create_dir_all(&r).map_err(err)?;
    Ok(r.to_string_lossy().to_string())
}

#[tauri::command]
fn vault_list(app: AppHandle) -> Result<Vec<Entry>, String> {
    Ok(vault::list(&root(&app)).map_err(err)?.into_iter().map(|f| Entry { path: f.path, mtime_ms: f.mtime_ms }).collect())
}

#[tauri::command]
fn vault_read(app: AppHandle, path: String) -> Result<Content, String> {
    let (text, mtime_ms) = vault::read(&root(&app), &path).map_err(err)?;
    Ok(Content { text, mtime_ms })
}

#[tauri::command]
fn vault_write(app: AppHandle, path: String, text: String) -> Result<u64, String> {
    vault::write(&root(&app), &path, &text).map_err(err)
}

#[tauri::command]
fn vault_trash(app: AppHandle, path: String) -> Result<(), String> {
    vault::trash(&root(&app), &path).map_err(err)
}

#[tauri::command]
fn vault_rename(app: AppHandle, from: String, to: String) -> Result<u64, String> {
    vault::rename(&root(&app), &from, &to).map_err(err)
}

#[tauri::command]
fn vault_mkdir(app: AppHandle, folder: String) -> Result<(), String> {
    vault::mkdir(&root(&app), &folder).map_err(err)
}

/// Show a note or folder in the system file manager (Linux: select it when the manager supports it).
#[tauri::command]
fn vault_reveal(app: AppHandle, path: String) -> Result<(), String> {
    use std::process::Command;
    let target = vault::resolve(&root(&app), &path).map_err(err)?;
    let target = if target.exists() { target } else { root(&app) };
    #[cfg(target_os = "linux")]
    {
        let uri = format!("file://{}", target.display());
        let shown = Command::new("dbus-send")
            .args(["--session", "--print-reply", "--dest=org.freedesktop.FileManager1", "/org/freedesktop/FileManager1", "org.freedesktop.FileManager1.ShowItems"])
            .arg(format!("array:string:{uri}"))
            .arg("string:")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !shown {
            let dir = if target.is_dir() { target.clone() } else { target.parent().map(|p| p.to_path_buf()).unwrap_or(target.clone()) };
            Command::new("xdg-open").arg(dir).spawn().map_err(err)?;
        }
    }
    #[cfg(target_os = "macos")]
    Command::new("open").arg("-R").arg(&target).spawn().map_err(err)?;
    #[cfg(target_os = "windows")]
    Command::new("explorer").arg(format!("/select,{}", target.display())).spawn().map_err(err)?;
    #[cfg(target_os = "android")]
    let _ = target;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![vault_info, vault_set, vault_list, vault_read, vault_write, vault_trash, vault_rename, vault_mkdir, vault_reveal])
        .run(tauri::generate_context!())
        .expect("error while running Qalamark");
}
