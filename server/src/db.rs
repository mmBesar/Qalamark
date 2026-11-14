// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The small SQLite database: users, login sessions, who shares what, and the
// co-editing history. Note TEXT is never stored here - notes are .md files.

use rusqlite::Connection;
use std::path::Path;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA synchronous = NORMAL;
         CREATE TABLE IF NOT EXISTS users (
           id        INTEGER PRIMARY KEY,
           username  TEXT NOT NULL UNIQUE COLLATE NOCASE,
           pass_hash TEXT NOT NULL,
           is_admin  INTEGER NOT NULL DEFAULT 0,
           created   INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS sessions (
           token_hash TEXT PRIMARY KEY,
           user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           label      TEXT NOT NULL DEFAULT '',
           created    INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS notes (
           id      TEXT PRIMARY KEY,
           owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           path    TEXT NOT NULL UNIQUE,
           created INTEGER NOT NULL,
           updated INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS shares (
           note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
           user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           role    TEXT NOT NULL CHECK (role IN ('edit','view')),
           PRIMARY KEY (note_id, user_id)
         );
         CREATE TABLE IF NOT EXISTS settings (
           key   TEXT PRIMARY KEY,
           value TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS ydocs (
           note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
           state   BLOB NOT NULL
         );",
    )?;
    Ok(conn)
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
