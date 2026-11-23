// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar

/**
 * The Latin letter, digit or sign a key stands for, whatever keyboard language is active.
 * With an Arabic (or any other) layout `event.key` is that language's letter, so Ctrl+Z arrives as Ctrl+ئ.
 * The physical key (`event.code`) does not change with the layout, so shortcuts go by that.
 */
const SIGNS: Record<string, string> = { Backslash: '\\', BracketLeft: '[', BracketRight: ']', Slash: '/', Minus: '-', Equal: '=', Comma: ',', Period: '.', Semicolon: ';', Quote: "'", Backquote: '`' };
export function latinKey(e: { key: string; code?: string }): string {
  if (/^[\x20-\x7e]$/.test(e.key) && !/^[A-Za-z]$/.test(e.key)) return e.key;
  if (/^[A-Za-z]$/.test(e.key)) return e.key.toLowerCase();
  const c = e.code ?? '';
  if (/^Key[A-Z]$/.test(c)) return c.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(c)) return c.slice(5);
  return SIGNS[c] ?? e.key;
}
/** True when the key typed is not the Latin one the shortcut is written with (another keyboard language is on). */
export const otherLayout = (e: { key: string; code?: string }) => latinKey(e) !== (e.key.length === 1 ? e.key.toLowerCase() : e.key) && latinKey(e) !== e.key;
