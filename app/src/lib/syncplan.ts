// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The rules that keep deletions deleted, as plain functions (so they can be tested without a server or a folder).

export interface Known { id: string; role?: string; vp?: string; vm?: number }

/**
 * Notes that were deleted somewhere else: they were in the last list the server gave us, and they are not in this one.
 * A note this device made a moment ago was never in an earlier list, so a list that is simply older than it is never taken for a deletion.
 */
export function deletedElsewhere<T extends Known>(cached: T[], freshIds: Set<string>, previouslySeen: Set<string>, alreadyGone: Set<string>): T[] {
  return cached.filter((n) => n.role === 'owner' && !n.id.startsWith('tmp:') && previouslySeen.has(n.id) && !freshIds.has(n.id) && !alreadyGone.has(n.id));
}

/** A file left behind by a deleted note goes to the trash only while it is unchanged; if you edited it since, it is yours and stays. */
export const leftoverIsUnchanged = (fileMtimeMs: number, deletedAtMtimeMs: number): boolean => fileMtimeMs <= deletedAtMtimeMs + 1500;
