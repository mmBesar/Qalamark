// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Pictures when there is no server. With a notes folder (the apps) they are real files in its `_images` folder, named after
// what is in them (the same picture twice is one file); in a plain browser they are kept in its storage. The note says
// ![](_images/name) either way, which is also what the server writes.

import { vault } from './vault.ts';

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
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml' };

/** The first 16 hex digits of the picture's SHA-256: the same picture always gets the same name. */
export async function fingerprint(bytes: ArrayBuffer): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(h.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Keep a picture; returns the markdown to put in the note. `inFolder`: the app has a notes folder to put it in. */
export async function saveLocalImage(blob: Blob, inFolder = false): Promise<string> {
  const buf = await blob.arrayBuffer();
  const name = `${await fingerprint(buf)}.${EXT[blob.type] ?? 'png'}`;
  if (inFolder) {
    try {
      await vault.writeFile(`_images/${name}`, new Uint8Array(buf));
      return `![](_images/${name})`;
    } catch { /* the folder refused it: keep it in the browser's storage instead */ }
  }
  const db = await open();
  try { await done(db.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, name)); } finally { db.close(); }
  return `![](_images/${name})`;
}

/** A kept picture, or null when this device does not have it. Older pictures that only live in the browser's storage are
 * moved into the notes folder the first time they are shown. */
export async function loadLocalImage(name: string, inFolder = false): Promise<Blob | null> {
  const type = MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'image/png';
  if (inFolder) {
    try {
      const b = await vault.readFile(`_images/${name}`);
      if (b) return new Blob([b as BlobPart], { type });
    } catch { /* not there: look in the old place */ }
  }
  try {
    const db = await open();
    let found: Blob | null = null;
    try { found = ((await done(db.transaction(STORE).objectStore(STORE).get(name))) as Blob | undefined) ?? null; } finally { db.close(); }
    if (found && inFolder) {
      try { await vault.writeFile(`_images/${name}`, new Uint8Array(await found.arrayBuffer())); } catch { /* try again next time */ }
    }
    return found;
  } catch { return null; }
}
