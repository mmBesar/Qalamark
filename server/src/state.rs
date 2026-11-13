// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Settings (from environment variables) and the shared state of the server.

use crate::rooms::Rooms;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Signup {
    /// Only the very first account can be created freely (it becomes the admin).
    First,
    /// Anyone can create an account.
    Open,
}

pub struct Config {
    pub data: PathBuf,
    pub web: PathBuf,
    pub addr: String,
    pub signup: Signup,
}

impl Config {
    pub fn from_env() -> Self {
        let get = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.to_string());
        Config {
            data: PathBuf::from(get("QALAMARK_DATA", "./data")),
            web: PathBuf::from(get("QALAMARK_WEB", "./web")),
            addr: get("QALAMARK_ADDR", "0.0.0.0:8080"),
            signup: if get("QALAMARK_SIGNUP", "first") == "open" { Signup::Open } else { Signup::First },
        }
    }
    pub fn notes_dir(&self) -> PathBuf {
        self.data.join("notes")
    }
}

pub struct AppState {
    pub cfg: Config,
    pub db: Mutex<Connection>,
    pub rooms: Rooms,
}

pub type Shared = Arc<AppState>;
