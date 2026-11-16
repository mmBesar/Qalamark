// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Working with the sections of a note (a heading and everything under it): move them, change
// their level. Pure text in, text out - the editor applies the result.

import { type Heading, parseHeadings } from './headings.ts';

/** Where the section of heading `i` ends: the next heading of the same or a higher level. */
export function sectionEnd(hs: Heading[], i: number, len: number): number {
  const lvl = hs[i]!.level;
  for (let j = i + 1; j < hs.length; j++) if (hs[j]!.level <= lvl) return hs[j]!.pos;
  return len;
}

const nl = (s: string) => (s.endsWith('\n') ? s : s + '\n');

/** Swap a section with the one before (-1) or after (+1) it at the same level. null = cannot move. */
export function moveSection(text: string, i: number, dir: -1 | 1): string | null {
  const hs = parseHeadings(text);
  const me = hs[i];
  if (!me) return null;
  const end = sectionEnd(hs, i, text.length);
  let aFrom: number, aTo: number, bFrom: number, bTo: number;
  if (dir < 0) {
    let j = i - 1;
    while (j >= 0 && hs[j]!.level > me.level) j--;
    if (j < 0 || hs[j]!.level < me.level) return null;
    [aFrom, aTo, bFrom, bTo] = [hs[j]!.pos, me.pos, me.pos, end];
  } else {
    const k = hs.findIndex((h, n) => n > i && h.pos >= end);
    if (k < 0 || hs[k]!.level < me.level) return null;
    [aFrom, aTo, bFrom, bTo] = [me.pos, end, end, sectionEnd(hs, k, text.length)];
  }
  const noTail = !text.endsWith('\n');
  const a = nl(text.slice(aFrom, aTo));
  const b = nl(text.slice(bFrom, bTo));
  let out = text.slice(0, aFrom) + b + a + text.slice(bTo);
  if (noTail && out.endsWith('\n')) out = out.slice(0, -1);
  return out;
}

/** Make a section (and everything inside it) one level higher (-1) or lower (+1). null = out of range. */
export function shiftSection(text: string, i: number, delta: -1 | 1): string | null {
  const hs = parseHeadings(text);
  const me = hs[i];
  if (!me) return null;
  const end = sectionEnd(hs, i, text.length);
  const inside = hs.filter((h) => h.pos >= me.pos && h.pos < end);
  if (inside.some((h) => h.level + delta < 1 || h.level + delta > 6)) return null;
  let out = text;
  for (const h of [...inside].reverse()) {
    const lineEnd = out.indexOf('\n', h.pos);
    const line = out.slice(h.pos, lineEnd < 0 ? out.length : lineEnd);
    const m = /^(#{1,6})(\s.*)$/.exec(line);
    if (!m) continue;
    const next = '#'.repeat(h.level + delta) + m[2];
    out = out.slice(0, h.pos) + next + out.slice(h.pos + line.length);
  }
  return out;
}
