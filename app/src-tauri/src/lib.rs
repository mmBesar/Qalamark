// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The native shell shows the same web app as the browser, and adds one thing: a notes folder.
// Your notes are real .md files in a folder you choose (default: Documents/Qalamark), so any
// other editor, backup tool or sync program can use them too.

mod tlsbridge;
mod vault;

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn config_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map(|d| d.join("vault.json")).map_err(|e| e.to_string())
}

fn default_path(app: &AppHandle) -> PathBuf {
    let fallback = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    let private = vault::default_dir(app.path().document_dir().ok(), fallback);
    // Android: the real Documents/Qalamark, as soon as the "all files" permission lets us use it
    #[cfg(target_os = "android")]
    {
        let shared = PathBuf::from("/storage/emulated/0/Documents/Qalamark");
        if vault::usable(&shared) {
            vault::adopt(&private, &shared);
            return shared;
        }
    }
    private
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
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
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

fn host_port(u: &str) -> Result<(String, u16, bool), String> {
    let url = url::Url::parse(u).map_err(err)?;
    let tls = match url.scheme() {
        "https" => true,
        "http" => false,
        _ => return Err("the address must start with http:// or https://".into()),
    };
    let host = url.host_str().ok_or("no host in the address")?.to_string();
    Ok((host, url.port_or_known_default().unwrap_or(if tls { 443 } else { 80 }), tls))
}

fn mode_of(tls: bool, pin: &str) -> tlsbridge::Mode {
    match (tls, pin.is_empty()) {
        (false, _) => tlsbridge::Mode::Plain,
        (true, true) => tlsbridge::Mode::Roots,
        (true, false) => tlsbridge::Mode::Pin(pin.to_string()),
    }
}

/// The SHA-256 fingerprint of the certificate a server shows (so it can be remembered).
/// The font families installed on this computer, for the font pickers in Settings.
#[tauri::command]
fn system_fonts() -> Vec<String> {
    let Ok(out) = std::process::Command::new("fc-list").args([":", "family"]).output() else {
        return Vec::new();
    };
    let mut v: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| l.split(',').next())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    v.sort_by_key(|s| s.to_lowercase());
    v.dedup();
    v
}


/// The desktop's own colours, so the "System" theme can follow them: the KDE colour scheme when there is one,
/// otherwise the GNOME accent colour and light/dark choice. Empty when nothing is known.
#[tauri::command]
fn system_colors() -> serde_json::Value {
    system_colors_inner()
}

fn system_colors_inner() -> serde_json::Value {
    use serde_json::json;
    let home = std::env::var("HOME").unwrap_or_default();
    if let Ok(text) = std::fs::read_to_string(format!("{home}/.config/kdeglobals")) {
        let get = |section: &str, key: &str| -> Option<String> {
            let mut inside = false;
            for l in text.lines() {
                let l = l.trim();
                if l.starts_with('[') {
                    inside = l == format!("[{section}]");
                } else if inside {
                    if let Some(v) = l.strip_prefix(&format!("{key}=")) {
                        let p: Vec<u8> = v.split(',').filter_map(|x| x.trim().parse().ok()).collect();
                        if p.len() >= 3 {
                            return Some(format!("#{:02x}{:02x}{:02x}", p[0], p[1], p[2]));
                        }
                    }
                }
            }
            None
        };
        if let (Some(bg), Some(fg)) = (get("Colors:View", "BackgroundNormal"), get("Colors:View", "ForegroundNormal")) {
            return json!({
                "bg": bg,
                "side": get("Colors:Window", "BackgroundNormal"),
                "fg": fg,
                "accent": get("Colors:Selection", "BackgroundNormal").or_else(|| get("Colors:View", "DecorationFocus")),
            });
        }
    }
    let gs = |key: &str| -> Option<String> {
        let o = std::process::Command::new("gsettings").args(["get", "org.gnome.desktop.interface", key]).output().ok()?;
        o.status.success().then(|| String::from_utf8_lossy(&o.stdout).trim().trim_matches('\'').to_string())
    };
    let accent = gs("accent-color").map(|n| match n.as_str() {
        "teal" => "#2190a4",
        "green" => "#3a944a",
        "yellow" => "#c88800",
        "orange" => "#ed5b00",
        "red" => "#e62d42",
        "pink" => "#d56199",
        "purple" => "#9141ac",
        "slate" => "#6f8396",
        _ => "#3584e4",
    });
    let dark = gs("color-scheme").map(|s| s.contains("dark"));
    if accent.is_none() && dark.is_none() {
        return json!({});
    }
    json!({ "accent": accent, "dark": dark })
}

#[tauri::command]
async fn tls_probe(url: String) -> Result<String, String> {
    let (h, p, tls) = host_port(&url)?;
    if !tls {
        return Err("a plain http:// server has no certificate".into());
    }
    tlsbridge::probe(&h, p).await
}

/// Can this server be reached the way the app will reach it? The answer says why not, in words.
#[tauri::command]
async fn net_check(url: String, pin: String) -> Result<(), String> {
    let (h, p, tls) = host_port(&url)?;
    tlsbridge::check(&h, p, &mode_of(tls, &pin)).await
}

/// Start the local bridge to the server; returns the http:// address on this device to use instead.
/// (The web view then never has to judge the server's address or certificate itself.)
#[tauri::command]
async fn net_bridge(url: String, pin: String) -> Result<String, String> {
    let (h, p, tls) = host_port(&url)?;
    let local = tlsbridge::start(h, p, mode_of(tls, &pin)).await?;
    Ok(format!("http://127.0.0.1:{local}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![vault_info, vault_set, vault_list, vault_read, vault_write, vault_trash, vault_rename, vault_mkdir, vault_reveal, tls_probe, system_fonts, system_colors, net_check, net_bridge])
        .run(tauri::generate_context!())
        .expect("error while running Qalamark");
}
