// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Pictures when there is no server: kept in this device's browser storage, written in the note as ![](_images/name).

const DB = 'qalamark-images';
const STORE = 'img';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const done = <T>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg' };

/** Keep a picture on this device; returns the markdown to put in the note. */
export async function saveLocalImage(blob: Blob): Promise<string> {
  const name = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.${EXT[blob.type] ?? 'png'}`;
  const db = await open();
  try { await done(db.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, name)); } finally { db.close(); }
  return `![](_images/${name})`;
}

/** A kept picture, or null when this device does not have it. */
export async function loadLocalImage(name: string): Promise<Blob | null> {
  try {
    const db = await open();
    try { return ((await done(db.transaction(STORE).objectStore(STORE).get(name))) as Blob | undefined) ?? null; } finally { db.close(); }
  } catch { return null; }
}
