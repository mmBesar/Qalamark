// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Headings of a note (for the table of contents and for [[Note#Heading]] links).

import { slug } from './mdlinks.ts';

export interface Heading {
  level: number;
  /** The heading as plain text (marks removed). */
  text: string;
  /** Offset of the start of the heading line in the note. */
  pos: number;
  /** 0-based line number. */
  line: number;
}

/** Strip the Markdown marks from heading text, so a link can match it. */
export function plainHeading(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, a: string, b?: string) => b ?? a)
    .replace(/[*_`~=]/g, '')
    .replace(/\s+#+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseHeadings(text: string): Heading[] {
  const out: Heading[] = [];
  let fence: string | null = null;
  let pos = 0;
  const lines = text.split('\n');
  let k = 0;
  // skip the properties block
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && (l.trim() === '---' || l.trim() === '...'));
    if (end > 0) {
      for (; k <= end; k++) pos += lines[k]!.length + 1;
    }
  }
  for (; k < lines.length; k++) {
    const l = lines[k]!;
    const f = /^\s*(`{3,}|~{3,})/.exec(l);
    if (f) {
      if (!fence) fence = f[1]![0]!;
      else if (f[1]![0] === fence) fence = null;
    } else if (!fence) {
      const m = /^(#{1,6})\s+(.*?)\s*$/.exec(l);
      if (m && plainHeading(m[2]!)) out.push({ level: m[1]!.length, text: plainHeading(m[2]!), pos, line: k });
    }
    pos += l.length + 1;
  }
  return out;
}

/** The heading a link points to: exact (ignoring case) first, then "starts with". */
export function findHeading(hs: Heading[], wanted: string): Heading | undefined {
  const w = plainHeading(wanted).toLowerCase();
  if (!w) return undefined;
  return hs.find((h) => h.text.toLowerCase() === w) ?? hs.find((h) => slug(h.text) === w) ?? hs.find((h) => h.text.toLowerCase().startsWith(w));
}

/** Split a link target "Note#Heading" into its parts. */
export function splitTarget(target: string): { note: string; heading: string } {
  const i = target.indexOf('#');
  if (i < 0) return { note: target.trim(), heading: '' };
  return { note: target.slice(0, i).trim(), heading: target.slice(i + 1).trim() };
}

export interface Piece {
  kind: 'text' | 'wiki' | 'url';
  text: string;
  /** For links: what to open. */
  target?: string;
}

/** Cut a short text (a card, a table cell) into plain text, [[links]] and web links. */
export function pieces(s: string): Piece[] {
  const out: Piece[] = [];
  const re = /\[\[([^\]\n|]*)(?:\|([^\]\n]*))?\]\]|\[([^\]\n]+)\]\((https?:[^)\s]+)\)|https?:\/\/[^\s)]+/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push({ kind: 'text', text: s.slice(last, m.index) });
    if (m[1] !== undefined) {
      const target = m[1].trim();
      const { note, heading } = splitTarget(target);
      out.push({ kind: 'wiki', text: m[2] ?? (note && heading ? `${note} › ${heading}` : heading || note), target });
    } else if (m[4]) out.push({ kind: 'url', text: m[3]!, target: m[4] });
    else out.push({ kind: 'url', text: m[0], target: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) });
  return out;
}
