// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Qalamark server: accounts, notes as .md files, sharing, live co-editing,
// and it also serves the web app.

mod api;
mod auth;
mod db;
mod rooms;
mod state;
mod text;

use axum::{
    routing::{delete, get, patch, post},
    Router,
};
use state::{AppState, Config, Shared};
use std::sync::{Arc, Mutex};
use tower_http::{
    compression::CompressionLayer,
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
};

pub fn app(state: Shared) -> Router {
    let web = state.cfg.web.clone();
    let index = web.join("index.html");
    Router::new()
        .route("/api/status", get(api::status))
        .route("/api/register", post(api::register))
        .route("/api/login", post(api::login))
        .route("/api/logout", post(api::logout))
        .route("/api/me", get(api::me))
        .route("/api/password", post(api::change_password))
        .route("/api/users", get(api::admin_list_users).post(api::admin_create_user))
        .route("/api/people", get(api::list_usernames))
        .route("/api/users/{name}", patch(api::admin_update_user).delete(api::admin_delete_user))
        .route("/api/admin/settings", get(api::admin_get_settings).put(api::admin_set_settings))
        .route("/api/images", post(api::upload_image).layer(axum::extract::DefaultBodyLimit::max(25 * 1024 * 1024)))
        .route("/api/images/{owner}/{file}", get(api::get_image))
        .route("/api/folders", get(api::list_folders).post(api::create_folder).patch(api::move_folder).delete(api::delete_folder))
        .route("/api/notes", get(api::list_notes).post(api::create_note))
        .route("/api/notes/{id}", get(api::get_note).patch(api::rename_note).delete(api::delete_note))
        .route("/api/notes/{id}/backlinks", get(api::backlinks))
        .route("/api/search", get(api::search))
        .route("/api/notes/{id}/shares", get(api::list_shares).post(api::add_share))
        .route("/api/notes/{id}/shares/{name}", delete(api::remove_share))
        .route("/ws/{id}", get(api::ws_note))
        .fallback_service(ServeDir::new(web).fallback(ServeFile::new(index)))
        .layer(CorsLayer::permissive()) // the apps load from other origins; we use bearer tokens, not cookies
        .layer(CompressionLayer::new())
        .with_state(state)
}

pub fn build_state(cfg: Config) -> Shared {
    std::fs::create_dir_all(cfg.notes_dir()).expect("cannot create the data folder");
    let conn = db::open(&cfg.data.join("qalamark.db")).expect("cannot open the database");
    Arc::new(AppState { cfg, db: Mutex::new(conn), rooms: Default::default() })
}

/// `qalamark-server --health`: used by the container health check.
fn health_check() -> ! {
    use std::io::{Read, Write};
    let port = std::env::var("QALAMARK_ADDR").ok().and_then(|a| a.rsplit(':').next().map(str::to_string)).unwrap_or_else(|| "8080".into());
    let ok = std::net::TcpStream::connect(format!("127.0.0.1:{port}"))
        .and_then(|mut c| {
            c.set_read_timeout(Some(std::time::Duration::from_secs(3)))?;
            c.write_all(b"GET /api/status HTTP/1.0\r\n\r\n")?;
            let mut out = String::new();
            c.read_to_string(&mut out)?;
            Ok(out.starts_with("HTTP/1.0 200") || out.starts_with("HTTP/1.1 200"))
        })
        .unwrap_or(false);
    std::process::exit(if ok { 0 } else { 1 });
}

#[tokio::main]
async fn main() {
    if std::env::args().any(|a| a == "--health") {
        health_check();
    }
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_default_env()).init();
    let cfg = Config::from_env();
    let addr = cfg.addr.clone();
    let state = build_state(cfg);
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("cannot listen on that address");
    tracing::info!("Qalamark listening on {addr}");
    axum::serve(listener, app(state)).with_graceful_shutdown(shutdown()).await.unwrap();
}

async fn shutdown() {
    let _ = tokio::signal::ctrl_c().await;
}
