// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Fonts the user adds themselves (.ttf .otf .woff .woff2). They are kept in this
// browser (IndexedDB), so they work offline and never leave the device.

const DB = 'qalamark-fonts';
const STORE = 'fonts';

export interface UserFont {
  family: string;
  data: ArrayBuffer;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'family' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function register(f: UserFont): Promise<void> {
  const face = new FontFace(f.family, f.data);
  await face.load();
  document.fonts.add(face);
}

/** Load every saved font; call once at start-up. Returns their family names. */
export async function loadUserFonts(): Promise<string[]> {
  try {
    const all = await tx<UserFont[]>('readonly', (s) => s.getAll());
    const names: string[] = [];
    for (const f of all) {
      try {
        await register(f);
        names.push(f.family);
      } catch {
        /* a broken file is skipped */
      }
    }
    return names;
  } catch {
    return [];
  }
}

/** Add a font file. The family name is the file name without its extension. */
export async function addUserFont(file: File): Promise<string> {
  const family = file.name.replace(/\.(ttf|otf|woff2?|ttc)$/i, '').replace(/[-_]?(Regular|Book)$/i, '');
  const font: UserFont = { family, data: await file.arrayBuffer() };
  await register(font); // fails here, before saving, if the file is not a font
  await tx('readwrite', (s) => s.put(font));
  return family;
}

export async function removeUserFont(family: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(family));
}

let arLine: FontFace | null = null;

/** The Arabic font chosen in Settings, used for Arabic letters only (so the English font stays as it is).
 *  It is a font added by the user, or one installed on the computer. */
export async function setArabicFont(name: string): Promise<void> {
  if (arLine) {
    document.fonts.delete(arLine);
    arLine = null;
  }
  const n = name.trim().replace(/["\\]/g, '');
  if (!n) return;
  try {
    const mine = await tx<UserFont | undefined>('readonly', (s) => s.get(n)).catch(() => undefined);
    const src = () => (mine ? mine.data : `local("${n}")`);
    // The chosen font as one face with no unicode-range (WebKitGTK draws diacritics wrongly when an Arabic web font has a
    // range, or when a word sits next to text from another font). A font installed on the computer is also named
    // directly in the stacks, which is the safest path there.
    const whole = new FontFace('QM Arabic Line', src(), { weight: '100 900' });
    await whole.load();
    document.fonts.add(whole);
    arLine = whole;
  } catch {
    /* not found: the bundled Arabic font stays */
  }
}

/** Fonts installed on this computer (the desktop app asks the system; browsers that allow it answer too). */
export async function listSystemFonts(): Promise<string[]> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const l = await invoke<string[]>('system_fonts');
    if (l.length) return l;
  } catch {
    /* not in the desktop app */
  }
  try {
    const q = (window as unknown as { queryLocalFonts?: () => Promise<Array<{ family: string }>> }).queryLocalFonts;
    if (q) return [...new Set((await q()).map((f) => f.family))].sort((a, b) => a.localeCompare(b));
  } catch {
    /* no permission */
  }
  return [];
}
