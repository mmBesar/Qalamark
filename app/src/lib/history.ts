// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
// Local version history: a snapshot of a note every few minutes while it changes, kept on this device.

export interface Snapshot { t: number; text: string }

const key = (id: string) => `qm.hist.${id}`;
const MAX = 25;
const MAX_CHARS = 150_000; // very large notes are not snapshotted
const GAP = 3 * 60_000; // at most one snapshot every three minutes

export function snapshots(id: string): Snapshot[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(id)) ?? '[]');
    return Array.isArray(v) ? (v as Snapshot[]) : [];
  } catch {
    return [];
  }
}

/** Remember `text` as it is now, unless it equals the last snapshot or one was taken a moment ago. */
export function snapshot(id: string, text: string, force = false, now = Date.now()): boolean {
  if (!text.trim() || text.length > MAX_CHARS) return false;
  const all = snapshots(id);
  const last = all[all.length - 1];
  if (last && last.text === text) return false;
  if (last && !force && now - last.t < GAP) return false;
  all.push({ t: now, text });
  while (all.length > MAX) all.shift();
  try {
    localStorage.setItem(key(id), JSON.stringify(all));
    return true;
  } catch {
    // storage full: keep only the newest few and try once more
    try {
      localStorage.setItem(key(id), JSON.stringify(all.slice(-5)));
      return true;
    } catch {
      return false;
    }
  }
}

export function forget(id: string): void {
  try {
    localStorage.removeItem(key(id));
  } catch {
    /* nothing to do */
  }
}

/** A short description of how a snapshot differs from the text now: lines added and removed. */
export function lineDiff(from: string, to: string): { added: number; removed: number } {
  const a = new Map<string, number>();
  for (const l of from.split('\n')) a.set(l, (a.get(l) ?? 0) + 1);
  let added = 0;
  for (const l of to.split('\n')) {
    const n = a.get(l) ?? 0;
    if (n > 0) a.set(l, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of a.values()) removed += n;
  return { added, removed };
}
