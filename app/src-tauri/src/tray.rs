// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The system tray (desktop only): an icon with a small menu, closing the window to the tray so reminders and sync
// keep running, starting at login, and the choice of icon (three styles; colour, white or black; or follow the theme).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Theme, WebviewWindow};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct TrayConfig {
    /// Show an icon in the system tray.
    pub enabled: bool,
    /// The window's close button hides the window and leaves the app running in the tray.
    pub close_to_tray: bool,
    /// Start when the person logs in.
    pub autostart: bool,
    /// ...and start without a window, only the tray icon.
    pub start_hidden: bool,
    /// "pen", "outline" or "qaf".
    pub style: String,
    /// "colour", "light", "dark" or "auto" (follow the system theme).
    pub tone: String,
}

impl Default for TrayConfig {
    fn default() -> Self {
        TrayConfig { enabled: false, close_to_tray: true, autostart: false, start_hidden: true, style: "pen".into(), tone: "auto".into() }
    }
}

/// The words of the menu, in the app's language (the web app sends them).
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct TrayLabels {
    pub open: String,
    pub new_note: String,
    pub settings: String,
    pub quit: String,
    pub tooltip: String,
}

pub struct TrayState {
    pub config: Mutex<TrayConfig>,
    labels: Mutex<TrayLabels>,
    icon: Mutex<Option<TrayIcon>>,
}

impl TrayState {
    pub fn load(app: &AppHandle) -> Self {
        TrayState { config: Mutex::new(read(app)), labels: Mutex::new(TrayLabels::default()), icon: Mutex::new(None) }
    }
}

fn file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("tray.json"))
}

fn read(app: &AppHandle) -> TrayConfig {
    file(app).and_then(|f| std::fs::read_to_string(f).ok()).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn write(app: &AppHandle, c: &TrayConfig) {
    if let Some(f) = file(app) {
        if let Some(d) = f.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        let _ = std::fs::write(f, serde_json::to_string_pretty(c).unwrap_or_default());
    }
}

macro_rules! icon_table {
    ($($style:literal),*) => {
        fn png(style: &str, tone: &str) -> &'static [u8] {
            match (style, tone) {
                $(
                    ($style, "light") => include_bytes!(concat!("../icons/tray/", $style, "-light.png")),
                    ($style, "dark") => include_bytes!(concat!("../icons/tray/", $style, "-dark.png")),
                    ($style, _) => include_bytes!(concat!("../icons/tray/", $style, "-colour.png")),
                )*
                _ => include_bytes!("../icons/tray/pen-colour.png"),
            }
        }
    };
}
icon_table!("pen", "outline", "qaf");

/// The icon for a choice; "auto" is white on a dark desktop and black on a light one.
fn icon_for(app: &AppHandle, c: &TrayConfig) -> Option<Image<'static>> {
    let tone = if c.tone == "auto" {
        let dark = app.get_webview_window("main").and_then(|w| w.theme().ok()).map_or(true, |t| t == Theme::Dark);
        if dark { "light" } else { "dark" }
    } else {
        c.tone.as_str()
    };
    Image::from_bytes(png(&c.style, tone)).ok()
}

pub fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn build_menu(app: &AppHandle, l: &TrayLabels) -> tauri::Result<Menu<tauri::Wry>> {
    let word = |s: &str, fallback: &str| if s.is_empty() { fallback.to_string() } else { s.to_string() };
    let open = MenuItem::with_id(app, "open", word(&l.open, "Open Qalamark"), true, None::<&str>)?;
    let new = MenuItem::with_id(app, "new", word(&l.new_note, "New note"), true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", word(&l.settings, "Settings"), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", word(&l.quit, "Quit"), true, None::<&str>)?;
    Menu::with_items(app, &[&open, &new, &settings, &PredefinedMenuItem::separator(app)?, &quit])
}

/// Make the tray match the configuration: create it, change it or remove it.
pub fn apply(app: &AppHandle) {
    let Some(state) = app.try_state::<TrayState>() else { return };
    let cfg = state.config.lock().unwrap().clone();
    let labels = state.labels.lock().unwrap().clone();
    let mut slot = state.icon.lock().unwrap();
    if !cfg.enabled {
        // dropping the handle removes the icon
        *slot = None;
        return;
    }
    let Some(img) = icon_for(app, &cfg) else { return };
    if let Some(t) = slot.as_ref() {
        let _ = t.set_icon(Some(img));
        if let Ok(m) = build_menu(app, &labels) {
            let _ = t.set_menu(Some(m));
        }
        let _ = t.set_tooltip(Some(if labels.tooltip.is_empty() { "Qalamark".to_string() } else { labels.tooltip.clone() }));
        return;
    }
    let Ok(menu) = build_menu(app, &labels) else { return };
    let built = TrayIconBuilder::with_id("qalamark")
        .icon(img)
        .tooltip("Qalamark")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => show_window(app),
            "new" => { show_window(app); let _ = app.emit("tray-new-note", ()); }
            "settings" => { show_window(app); let _ = app.emit("tray-settings", ()); }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|t, e| {
            // (Windows and macOS: a left click shows or hides the window. On Linux the click only opens the menu.)
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                let app = t.app_handle();
                match app.get_webview_window("main") {
                    Some(w) if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) => { let _ = w.hide(); }
                    _ => show_window(app),
                }
            }
        })
        .build(app);
    if let Ok(t) = built {
        *slot = Some(t);
    }
}

/// The window's close button: with the tray on and the option chosen, hide the window instead of quitting.
pub fn close_requested(app: &AppHandle, window: &WebviewWindow) -> bool {
    let Some(state) = app.try_state::<TrayState>() else { return false };
    let c = state.config.lock().unwrap();
    let has_icon = state.icon.lock().unwrap().is_some();
    if c.enabled && c.close_to_tray && has_icon {
        let _ = window.hide();
        return true;
    }
    false
}

/// When the system theme changes, an "auto" icon changes with it.
pub fn theme_changed(app: &AppHandle) {
    let auto = app.try_state::<TrayState>().map_or(false, |s| s.config.lock().unwrap().tone == "auto");
    if auto {
        apply(app);
    }
}

// ---- starting at login (Linux: an autostart entry the desktop reads)

#[cfg(target_os = "linux")]
fn autostart_file() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))?;
    Some(base.join("autostart").join("io.github.mmbesar.qalamark.desktop"))
}

#[cfg(target_os = "linux")]
fn set_autostart(c: &TrayConfig) {
    let Some(f) = autostart_file() else { return };
    if !c.autostart {
        let _ = std::fs::remove_file(f);
        return;
    }
    // an AppImage runs from a temporary mount: its real path is in $APPIMAGE
    let exe = std::env::var("APPIMAGE").ok().or_else(|| std::env::current_exe().ok().map(|p| p.to_string_lossy().into_owned()));
    let Some(exe) = exe else { return };
    let quoted = format!("\"{}\"", exe.replace('\\', "\\\\").replace('"', "\\\""));
    let entry = format!(
        "[Desktop Entry]\nType=Application\nName=Qalamark\nComment=Light Markdown notes\nExec={quoted}{}\nIcon=qalamark-app\nTerminal=false\nX-GNOME-Autostart-enabled=true\n",
        if c.start_hidden { " --hidden" } else { "" }
    );
    if let Some(d) = f.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    let _ = std::fs::write(f, entry);
}
#[cfg(not(target_os = "linux"))]
fn set_autostart(_c: &TrayConfig) {}

/// Called once the window exists: show the tray, and stay out of sight when started at login with `--hidden`.
pub fn setup(app: &AppHandle) {
    apply(app);
    let hidden = std::env::args().any(|a| a == "--hidden");
    let ok = app.try_state::<TrayState>().map_or(false, |s| s.config.lock().unwrap().enabled && s.icon.lock().unwrap().is_some());
    if hidden && ok {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.hide();
        }
    }
}

#[tauri::command]
pub fn tray_get(app: AppHandle) -> TrayConfig {
    app.try_state::<TrayState>().map(|s| s.config.lock().unwrap().clone()).unwrap_or_default()
}

/// Change the choices (and the words of the menu), keep them, and make the tray match.
#[tauri::command]
pub fn tray_set(app: AppHandle, config: TrayConfig, labels: TrayLabels) -> Result<TrayConfig, String> {
    let state = app.try_state::<TrayState>().ok_or("no tray state")?;
    *state.config.lock().unwrap() = config.clone();
    *state.labels.lock().unwrap() = labels;
    write(&app, &config);
    set_autostart(&config);
    apply(&app);
    Ok(config)
}

/// Whether the icon really exists (it cannot on a desktop with no tray support).
#[tauri::command]
pub fn tray_ok(app: AppHandle) -> bool {
    app.try_state::<TrayState>().map_or(false, |s| s.icon.lock().unwrap().is_some())
}
