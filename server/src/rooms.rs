// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Live co-editing. Every open note is a "room" holding a Yjs document.
//   - people connect over a WebSocket and exchange small updates (y-websocket protocol)
//   - a short while after a change, the text is written to the note's .md file
//   - if the .md file is changed from outside (Syncthing, a text editor...), the
//     change is merged in and sent to everyone who has the note open

use crate::state::Shared;
use crate::text::diff;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{broadcast, Notify};
use tokio::task::JoinHandle;
use yrs::sync::{Message, MessageReader, SyncMessage};
use yrs::updates::decoder::{Decode, DecoderV1};
use yrs::updates::encoder::Encode;
use yrs::{Doc, GetString, OffsetKind, Options, ReadTxn, StateVector, Text, Transact, Update};

const TEXT: &str = "content";

pub struct Room {
    pub id: String,
    doc: Doc,
    pub tx: broadcast::Sender<Vec<u8>>,
    dirty: Notify,
    last_written: Mutex<String>,
    users: Mutex<usize>,
    task: Mutex<Option<JoinHandle<()>>>,
}

#[derive(Default)]
pub struct Rooms {
    map: Mutex<HashMap<String, Arc<Room>>>,
}

fn full_path(state: &Shared, rel: &str) -> PathBuf {
    state.cfg.notes_dir().join(rel)
}

fn note_path(state: &Shared, id: &str) -> Option<String> {
    let db = state.db.lock().ok()?;
    db.query_row("SELECT path FROM notes WHERE id = ?1", [id], |r| r.get(0)).ok()
}

impl Room {
    pub fn text(&self) -> String {
        let t = self.doc.get_or_insert_text(TEXT);
        t.get_string(&self.doc.transact())
    }

    /// The first message to send to a new connection (asks for what the client has).
    pub fn hello(&self) -> Vec<u8> {
        let sv = self.doc.transact().state_vector();
        Message::Sync(SyncMessage::SyncStep1(sv)).encode_v1()
    }

    /// Handle bytes from one connection. Returns messages to send back to it.
    pub fn handle(&self, data: &[u8], can_write: bool) -> Vec<Vec<u8>> {
        let mut replies = Vec::new();
        let mut decoder = DecoderV1::new(yrs::encoding::read::Cursor::new(data));
        for msg in MessageReader::new(&mut decoder) {
            let Ok(msg) = msg else { break };
            match msg {
                Message::Sync(SyncMessage::SyncStep1(sv)) => {
                    let update = self.doc.transact().encode_state_as_update_v1(&sv);
                    replies.push(Message::Sync(SyncMessage::SyncStep2(update)).encode_v1());
                }
                Message::Sync(SyncMessage::SyncStep2(u)) | Message::Sync(SyncMessage::Update(u)) => {
                    if !can_write {
                        continue;
                    }
                    if let Ok(update) = Update::decode_v1(&u) {
                        let mut txn = self.doc.transact_mut();
                        if txn.apply_update(update).is_ok() {
                            drop(txn);
                            self.dirty.notify_one();
                        }
                    }
                }
                Message::Awareness(a) => {
                    // Who is here / where their cursor is: just pass it on.
                    let _ = self.tx.send(Message::Awareness(a).encode_v1());
                }
                _ => {}
            }
        }
        replies
    }

    /// Change the text in place (used when a rename updates links); everyone connected sees it.
    pub fn rewrite(&self, f: impl Fn(&str) -> Option<String>) -> bool {
        let cur = self.text();
        match f(&cur) {
            Some(new) if self.merge_text(&new) => {
                self.dirty.notify_one();
                true
            }
            _ => false,
        }
    }

    /// Merge text that was changed outside (in the .md file) into the document.
    fn merge_text(&self, new_text: &str) -> bool {
        let t = self.doc.get_or_insert_text(TEXT);
        let mut txn = self.doc.transact_mut();
        let cur = t.get_string(&txn);
        let Some((start, del, ins)) = diff(&cur, new_text) else { return false };
        if del > 0 {
            t.remove_range(&mut txn, start, del);
        }
        if !ins.is_empty() {
            t.insert(&mut txn, start, &ins);
        }
        true
    }
}

fn new_doc() -> Doc {
    Doc::with_options(Options { offset_kind: OffsetKind::Utf16, ..Options::default() })
}

fn load(state: &Shared, id: &str) -> Arc<Room> {
    let doc = new_doc();
    let _ = doc.get_or_insert_text(TEXT);
    // 1) the saved editing history, if there is one
    let blob: Option<Vec<u8>> = state
        .db
        .lock()
        .ok()
        .and_then(|db| db.query_row("SELECT state FROM ydocs WHERE note_id = ?1", [id], |r| r.get(0)).ok());
    if let Some(b) = blob {
        if let Ok(u) = Update::decode_v1(&b) {
            let _ = doc.transact_mut().apply_update(u);
        }
    }
    let (tx, _) = broadcast::channel(256);
    let tx2 = tx.clone();
    // Every change to the document (from anyone, or from the file) goes out to everyone.
    let _ = doc.observe_update_v1("broadcast", move |_txn, e| {
        let _ = tx2.send(Message::Sync(SyncMessage::Update(e.update.clone())).encode_v1());
    });
    let room = Arc::new(Room {
        id: id.to_string(),
        doc,
        tx,
        dirty: Notify::new(),
        last_written: Mutex::new(String::new()),
        users: Mutex::new(0),
        task: Mutex::new(None),
    });
    // 2) the .md file is the truth: fold in anything that differs
    if let Some(rel) = note_path(state, id) {
        if let Ok(file_text) = std::fs::read_to_string(full_path(state, &rel)) {
            room.merge_text(&file_text);
            *room.last_written.lock().unwrap() = file_text;
        }
    }
    room
}

/// Write the file (if the text changed) and the editing history.
fn save(state: &Shared, room: &Room) {
    let Some(rel) = note_path(state, &room.id) else { return };
    let text = room.text();
    {
        let mut last = room.last_written.lock().unwrap();
        if *last != text {
            let path = full_path(state, &rel);
            if let Some(dir) = path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let tmp = path.with_extension("md.tmp");
            if std::fs::write(&tmp, &text).and_then(|_| std::fs::rename(&tmp, &path)).is_ok() {
                *last = text.clone();
            }
        }
    }
    let blob = room.doc.transact().encode_state_as_update_v1(&StateVector::default());
    if let Ok(db) = state.db.lock() {
        let _ = db.execute(
            "INSERT INTO ydocs (note_id, state) VALUES (?1, ?2) ON CONFLICT(note_id) DO UPDATE SET state = excluded.state",
            rusqlite::params![room.id, blob],
        );
        let _ = db.execute("UPDATE notes SET updated = ?2 WHERE id = ?1", rusqlite::params![room.id, crate::db::now()]);
    }
}

/// Has the .md file been changed from outside? Merge it in.
fn check_external(state: &Shared, room: &Room) {
    let Some(rel) = note_path(state, &room.id) else { return };
    let Ok(file_text) = std::fs::read_to_string(full_path(state, &rel)) else { return };
    let known = room.last_written.lock().unwrap().clone();
    if file_text != known {
        *room.last_written.lock().unwrap() = file_text.clone();
        if room.merge_text(&file_text) {
            room.dirty.notify_one();
        }
    }
}

async fn saver(state: Shared, room: Arc<Room>) {
    let mut tick = tokio::time::interval(Duration::from_secs(3));
    loop {
        tokio::select! {
            _ = room.dirty.notified() => {
                tokio::time::sleep(Duration::from_millis(600)).await;
                save(&state, &room);
            }
            _ = tick.tick() => check_external(&state, &room),
        }
    }
}

impl Rooms {
    /// A person opens a note.
    pub fn join(&self, state: &Shared, id: &str) -> Arc<Room> {
        let mut map = self.map.lock().unwrap();
        let room = map
            .entry(id.to_string())
            .or_insert_with(|| {
                let room = load(state, id);
                let handle = tokio::spawn(saver(state.clone(), room.clone()));
                *room.task.lock().unwrap() = Some(handle);
                room
            })
            .clone();
        *room.users.lock().unwrap() += 1;
        room
    }

    /// A person closes a note. The last one out saves and frees the room.
    pub fn leave(&self, state: &Shared, room: &Arc<Room>) {
        let mut map = self.map.lock().unwrap();
        let mut users = room.users.lock().unwrap();
        *users = users.saturating_sub(1);
        if *users == 0 {
            if let Some(h) = room.task.lock().unwrap().take() {
                h.abort();
            }
            save(state, room);
            map.remove(&room.id);
        }
    }

    pub fn get(&self, id: &str) -> Option<Arc<Room>> {
        self.map.lock().unwrap().get(id).cloned()
    }

    /// Forget a room (the note was deleted).
    pub fn drop_room(&self, id: &str) {
        if let Some(room) = self.map.lock().unwrap().remove(id) {
            if let Some(h) = room.task.lock().unwrap().take() {
                h.abort();
            }
        }
    }
}
