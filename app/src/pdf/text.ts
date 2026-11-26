// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// One paragraph of text on a page: which face draws each letter, the direction of every piece (Arabic runs right to
// left, numbers and Latin words inside it left to right), where a line may break, and where every piece goes.

import bidiFactory from 'bidi-js';
import type { FontRef, Fonts, Shaped } from './fonts.ts';

const bidi = bidiFactory();

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  del?: boolean;
  mark?: boolean;
  /** An address the words link to ('' = a link inside the notes: coloured, but nowhere to go on paper). */
  link?: string;
  color?: string;
}

export interface Piece {
  font: FontRef;
  size: number;
  shaped: Shaped;
  level: number;
  /** The letters as written (for copying text out of the PDF). */
  text: string;
  w: number;
  space: boolean;
  span: Span;
  x: number;
}
export interface Line { pieces: Piece[]; width: number; rtl: boolean }
export interface Para { lines: Line[]; rtl: boolean; asc: number; desc: number; lineH: number; baseline: number }

export interface ParaOpts {
  size: number;
  width: number;
  lineHeight: number;
  /** 'auto': the first letter that has a direction decides (like dir="auto"). */
  dir?: 'auto' | 'ltr' | 'rtl';
  bold?: boolean;
  /** Code: spaces stay, and a line only breaks where it must. */
  pre?: boolean;
}

const CP = (s: string, i: number) => s.codePointAt(i)!;

/** Does the text start in an Arabic (or other right-to-left) direction? */
export function isRtlText(text: string): boolean {
  const { paragraphs } = bidi.getEmbeddingLevels(text);
  return !!paragraphs[0] && (paragraphs[0].level & 1) === 1;
}

/** Visual order of a line's pieces (the standard rule: reverse runs from the highest level down). */
function visualOrder(levels: number[]): number[] {
  const order = levels.map((_, i) => i);
  if (!levels.length) return order;
  const max = Math.max(...levels);
  const minOdd = Math.min(...levels.filter((l) => l & 1), 99);
  for (let lvl = max; lvl >= minOdd && lvl > 0; lvl--) {
    for (let i = 0; i < order.length; ) {
      if (levels[order[i]!]! >= lvl) {
        let j = i;
        while (j < order.length && levels[order[j]!]! >= lvl) j++;
        const seg = order.slice(i, j).reverse();
        order.splice(i, seg.length, ...seg);
        i = j;
      } else i++;
    }
  }
  return order;
}

/** Break one paragraph of spans (no line breaks inside) into lines. */
export function layoutPara(fonts: Fonts, spans: Span[], o: ParaOpts): Para {
  // 1. the letters, each with its span and its face; letters nobody can draw are dropped
  let text = '';
  const spanAt: Span[] = [];
  const fontAt: FontRef[] = [];
  let prev: FontRef | null = null;
  for (const sp of spans) {
    for (const ch of sp.text.replace(/\t/g, '    ').replace(/[\r\n]+/g, ' ')) {
      const cp = CP(ch, 0);
      const f = fonts.pick(cp, !!(sp.bold || o.bold), !!sp.code, prev);
      if (f === 'skip' || f === null) continue;
      text += ch;
      for (let k = 0; k < ch.length; k++) { spanAt.push(sp); fontAt.push(f); }
      prev = f;
    }
  }
  const dirParam = o.dir === 'ltr' ? 'ltr' : o.dir === 'rtl' ? 'rtl' : undefined;
  const lv = bidi.getEmbeddingLevels(text, dirParam);
  const rtl = (lv.paragraphs[0]?.level ?? 0) % 2 === 1;
  const mirror = bidi.getMirroredCharactersMap(text, lv.levels);

  // 2. pieces: runs of one span, one face, one direction, all letters or all spaces
  const atoms: Piece[][] = [];
  let atom: Piece[] = [];
  const pieces: Piece[] = []; // spaces are atoms of their own, marked by `space`
  let i = 0;
  while (i < text.length) {
    const sp = spanAt[i]!, f = fontAt[i]!, level = lv.levels[i]!;
    const space = !o.pre && text[i] === ' ';
    let j = i;
    let str = '';
    while (j < text.length && spanAt[j] === sp && fontAt[j] === f && lv.levels[j] === level && (!o.pre && text[j] === ' ') === space) {
      const m = level & 1 ? mirror.get(j) : undefined;
      str += m ?? text[j];
      j++;
    }
    const size = o.size * (sp.code ? 0.9 : 1) * f.scale;
    const shaped = fonts.shape(f, str, (level & 1) === 1);
    const piece: Piece = { font: f, size, shaped, level, text: text.slice(i, j), w: (shaped.width * size) / f.upm, space, span: sp, x: 0 };
    pieces.push(piece);
    i = j;
  }
  for (const p of pieces) {
    if (p.space) { if (atom.length) atoms.push(atom); atom = []; atoms.push([p]); } else atom.push(p);
  }
  if (atom.length) atoms.push(atom);

  // 3. lines: break only at spaces; a word wider than the line is cut where it must be
  const lines: Piece[][] = [];
  let cur: Piece[] = [];
  let curW = 0;
  const flush = () => {
    while (cur.length && cur[cur.length - 1]!.space) cur.pop();
    if (cur.length) lines.push(cur);
    cur = []; curW = 0;
  };
  for (const a of atoms) {
    const w = a.reduce((s, p) => s + p.w, 0);
    if (a[0]!.space) { if (cur.length) { cur.push(a[0]!); curW += w; } continue; }
    if (curW + w > o.width + 0.01 && cur.length) flush();
    if (w <= o.width + 0.01) { cur.push(...a); curW += w; continue; }
    // too long even alone: cut it by letters
    for (const p of a) {
      let rest = p;
      while (curW + rest.w > o.width + 0.01) {
        const cut = cutPiece(fonts, rest, Math.max(0, o.width - curW), cur.length === 0);
        if (!cut) { flush(); continue; }
        cur.push(cut[0]); curW += cut[0].w; flush();
        rest = cut[1];
      }
      cur.push(rest); curW += rest.w;
    }
  }
  flush();
  if (!lines.length) lines.push([]);

  // 4. where everything goes: visual order, from the left edge of the line
  let asc = 0, desc = 0;
  for (const p of pieces) { asc = Math.max(asc, (p.font.asc * p.size) / p.font.upm); desc = Math.max(desc, (p.font.desc * p.size) / p.font.upm); }
  if (!pieces.length) { asc = o.size * 0.95; desc = o.size * 0.25; }
  const lineH = Math.max(o.size * o.lineHeight, (asc + desc) * 1.02);
  const out: Line[] = lines.map((ps) => {
    const order = visualOrder(ps.map((p) => Math.max(p.level, rtl ? 1 : 0)));
    let x = 0;
    const placed = order.map((k) => { const p = { ...ps[k]!, x }; x += p.w; return p; });
    return { pieces: placed, width: x, rtl };
  });
  return { lines: out, rtl, asc, desc, lineH, baseline: (lineH - (asc + desc)) / 2 + asc };
}

/** Cut the front off a piece so it fits `room` points (a long address, say). Null when not even one letter fits and the line has other things on it. */
function cutPiece(fonts: Fonts, p: Piece, room: number, empty: boolean): [Piece, Piece] | null {
  const chars = Array.from(p.text);
  let k = 0;
  let best: Shaped | null = null;
  const rtl = (p.level & 1) === 1;
  for (let n = 1; n < chars.length; n++) {
    const s = fonts.shape(p.font, chars.slice(0, n).join(''), rtl);
    if ((s.width * p.size) / p.font.upm > room) break;
    k = n; best = s;
  }
  if (k === 0) {
    if (!empty) return null;
    k = 1; best = fonts.shape(p.font, chars[0]!, rtl);
  }
  const head = chars.slice(0, k).join(''), tail = chars.slice(k).join('');
  const sh = fonts.shape(p.font, tail, rtl);
  return [
    { ...p, text: head, shaped: best!, w: (best!.width * p.size) / p.font.upm },
    { ...p, text: tail, shaped: sh, w: (sh.width * p.size) / p.font.upm },
  ];
}

/** The width of the widest line when nothing wraps, and of the widest single word (for table columns). */
export function measure(fonts: Fonts, spans: Span[], size: number): { max: number; min: number } {
  const wide = layoutPara(fonts, spans, { size, width: 1e6, lineHeight: 1 });
  const max = wide.lines.reduce((m, l) => Math.max(m, l.width), 0);
  const words = spans.map((s) => s.text).join('').split(/\s+/).filter(Boolean);
  let min = 0;
  for (const w of words) {
    const l = layoutPara(fonts, [{ text: w, bold: spans.some((s) => s.bold) }], { size, width: 1e6, lineHeight: 1 });
    min = Math.max(min, l.lines[0]?.width ?? 0);
  }
  return { max, min };
}
