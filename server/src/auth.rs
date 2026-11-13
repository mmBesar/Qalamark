// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Passwords (argon2id), login tokens, and the "who is calling?" extractor.

use crate::state::Shared;
use argon2::{
    password_hash::{phc::PasswordHash, PasswordHasher, PasswordVerifier},
    Argon2,
};
use axum::{
    extract::FromRequestParts,
    http::{header, request::Parts, StatusCode},
};
use sha2::{Digest, Sha256};

pub fn hash_password(pw: &str) -> Result<String, String> {
    Argon2::default()
        .hash_password(pw.as_bytes())
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}

pub fn check_password(pw: &str, stored: &str) -> bool {
    match PasswordHash::new(stored) {
        Ok(parsed) => Argon2::default().verify_password(pw.as_bytes(), &parsed).is_ok(),
        Err(_) => false,
    }
}

/// A new random login token (shown once) - only its hash is stored.
pub fn new_token() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

pub fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

#[derive(Clone, Debug)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub is_admin: bool,
}

/// Look a token up in the database.
pub fn user_for_token(state: &Shared, token: &str) -> Option<User> {
    let db = state.db.lock().ok()?;
    db.query_row(
        "SELECT u.id, u.username, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1",
        [token_hash(token)],
        |r| Ok(User { id: r.get(0)?, username: r.get(1)?, is_admin: r.get::<_, i64>(2)? != 0 }),
    )
    .ok()
}

impl FromRequestParts<Shared> for User {
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(parts: &mut Parts, state: &Shared) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or((StatusCode::UNAUTHORIZED, "Please sign in"))?;
        user_for_token(state, token).ok_or((StatusCode::UNAUTHORIZED, "Please sign in again"))
    }
}
