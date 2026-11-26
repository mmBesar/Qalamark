// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The fonts of a PDF: the ones that ship with the app, shaped here (fontkit does Arabic joining, ligatures and the
// placing of diacritics), so a page looks the same whatever system made it.

import * as fk from 'fontkit';

export type Kind = 'latin' | 'arabic' | 'mono';
export interface FontRef {
  id: string;
  kind: Kind;
  bold: boolean;
  font: fk.Font;
  upm: number;
  asc: number;
  desc: number;
  /** Size relative to the text size: the Naskh face is drawn a little larger so it matches the Latin letters. */
  scale: number;
}
export interface Shaped { gids: number[]; adv: number[]; dx: number[]; dy: number[]; width: number }

export type Loader = (name: string) => Promise<Uint8Array>;
/** The files, by name; the app and the tests each say where to find them. */
export const FONT_FILES = ['qm-roboto-400', 'qm-roboto-700', 'qm-naskh-ui-400', 'qm-naskh-ui-700', 'qm-sans-arabic-400', 'qm-sans-arabic-700', 'jbmono-400'] as const;

export const isArabicCp = (cp: number): boolean =>
  (cp >= 0x600 && cp <= 0x6ff) || (cp >= 0x750 && cp <= 0x77f) || (cp >= 0x8a0 && cp <= 0x8ff) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff);
/** Characters that draw nothing and are simply dropped. */
const INVISIBLE = (cp: number): boolean => cp === 0xfe0f || cp === 0xfe0e || cp === 0x200b || cp === 0xfeff || cp === 0x200e || cp === 0x200f || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0xad;

export class Fonts {
  private refs = new Map<string, FontRef>();
  private cache = new Map<string, Shaped>();
  missing = 0;
  private load: Loader;
  private arabicStyle: 'naskh' | 'sans';
  constructor(load: Loader, arabicStyle: 'naskh' | 'sans') { this.load = load; this.arabicStyle = arabicStyle; }

  private async make(file: string, kind: Kind, bold: boolean): Promise<FontRef> {
    const font = fk.create(await this.load(file));
    const upm = font.unitsPerEm;
    const naskh = file.startsWith('qm-naskh');
    return { id: file, kind, bold, font, upm, asc: font.ascent, desc: Math.abs(font.descent), scale: naskh ? 1.12 : 1 };
  }
  /** Load what a text needs (Arabic and code faces only when the text has Arabic or code). */
  async prepare(text: string): Promise<void> {
    const want: Array<[string, Kind, boolean]> = [['qm-roboto-400', 'latin', false], ['qm-roboto-700', 'latin', true]];
    if (/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(text)) {
      const a = this.arabicStyle === 'sans' ? 'qm-sans-arabic' : 'qm-naskh-ui';
      want.push([a + '-400', 'arabic', false], [a + '-700', 'arabic', true]);
    }
    if (/`|^( {4}|\t)/m.test(text)) want.push(['jbmono-400', 'mono', false]);
    await Promise.all(want.filter(([f]) => !this.refs.has(f)).map(async ([f, k, b]) => { this.refs.set(f, await this.make(f, k, b)); }));
  }
  private get(kind: Kind, bold: boolean): FontRef | undefined {
    if (kind === 'latin') return this.refs.get(bold ? 'qm-roboto-700' : 'qm-roboto-400');
    if (kind === 'arabic') { const a = this.arabicStyle === 'sans' ? 'qm-sans-arabic' : 'qm-naskh-ui'; return this.refs.get(`${a}-${bold ? 700 : 400}`); }
    return this.refs.get('jbmono-400');
  }
  all(): FontRef[] { return [...this.refs.values()]; }

  /** The face for a character: the one the style asks for, else another that has it. null = nobody has it (dropped). */
  pick(cp: number, bold: boolean, code: boolean, prev: FontRef | null): FontRef | null | 'skip' {
    if (INVISIBLE(cp)) return 'skip';
    const order: Kind[] = isArabicCp(cp) ? ['arabic', 'latin'] : code ? ['mono', 'latin', 'arabic'] : cp === 0x20 || cp === 0xa0 || !/[\p{L}\p{N}]/u.test(String.fromCodePoint(cp)) ? [prev?.kind === 'arabic' ? 'arabic' : 'latin', 'latin', 'arabic', 'mono'] : ['latin', 'arabic'];
    for (const k of order) {
      const f = this.get(k, bold) ?? this.get(k, false);
      if (f && f.font.hasGlyphForCodePoint(cp)) return f;
    }
    if (cp === 0x200c || cp === 0x200d) return 'skip';
    this.missing++;
    return null;
  }

  shape(ref: FontRef, text: string, rtl: boolean): Shaped {
    const key = `${ref.id}|${rtl ? 1 : 0}|${text}`;
    let s = this.cache.get(key);
    if (s) return s;
    // code keeps its letters apart: no programming ligatures
    const feats = ref.kind === 'mono' ? { calt: false, liga: false, clig: false } : undefined;
    const run = ref.font.layout(text, feats as unknown, undefined, undefined, rtl ? 'rtl' : 'ltr');
    s = { gids: [], adv: [], dx: [], dy: [], width: 0 };
    run.glyphs.forEach((g, i) => {
      const p = run.positions[i]!;
      s!.gids.push(g.id); s!.adv.push(p.xAdvance); s!.dx.push(p.xOffset); s!.dy.push(p.yOffset); s!.width += p.xAdvance;
    });
    this.cache.set(key, s);
    return s;
  }
}
