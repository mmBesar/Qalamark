// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// A note laid out on pages: headings, paragraphs, lists, quotes, boxes, code, tables and pictures, with the page
// breaks, header and footer. The result is a list of drawing steps per page; `emit.ts` writes them as a PDF and
// `preview.ts` draws the same steps on a canvas.

import { Marked, type Token, type Tokens } from 'marked';
import { Fonts, type FontRef, type Loader } from './fonts.ts';
import { DEFAULT_PDF, PAPERS, type PdfOptions } from './options.ts';
import { layoutPara, measure, type Para, type Piece, type Span } from './text.ts';

export interface PdfImage { w: number; h: number; jpeg?: Uint8Array; rgb?: Uint8Array; alpha?: Uint8Array; id?: number }
export type Op =
  | { t: 'text'; x: number; y: number; p: Piece; color: string; skew: number }
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; lw?: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; lw: number; color: string }
  | { t: 'dot'; x: number; y: number; r: number; color: string }
  | { t: 'image'; x: number; y: number; w: number; h: number; img: PdfImage }
  | { t: 'link'; x: number; y: number; w: number; h: number; url: string };
export interface Page { bg: Array<Op & { depth: number }>; ops: Op[] }
export interface Doc { pages: Page[]; w: number; h: number; fonts: Fonts; images: PdfImage[]; scale: number; title: string; tooLong: boolean }

export interface Env {
  fonts: Loader;
  /** A picture of the note, by the address written in it (null when it cannot be found). */
  image?: (url: string) => Promise<PdfImage | null>;
  now?: Date;
}
export interface Meta { title: string; file: string }

const MM = 72 / 25.4;
const C = { text: '#111111', soft: '#333333', link: '#0b57d0', quote: '#444444', codeBg: '#f1f1f1', box: '#f6f6f6', boxLine: '#dddddd', tableLine: '#bbbbbb', th: '#f0f0f0', zebra: '#f7f7f7', mark: '#fff3a3', rule: '#cccccc', grey: '#666666' };
const KIND: Record<string, [string, string]> = {
  note: ['#3d7fe0', '#eef4fd'], info: ['#3d7fe0', '#eef4fd'], abstract: ['#3d7fe0', '#eef4fd'], todo: ['#3d7fe0', '#eef4fd'], seealso: ['#3d7fe0', '#eef4fd'],
  tip: ['#3fa66a', '#ecf8f1'], hint: ['#3fa66a', '#ecf8f1'], important: ['#7c5ce0', '#f1eefd'], success: ['#3fa66a', '#ecf8f1'], check: ['#3fa66a', '#ecf8f1'], done: ['#3fa66a', '#ecf8f1'],
  warning: ['#e0953d', '#fdf4e8'], caution: ['#e0953d', '#fdf4e8'], attention: ['#e0953d', '#fdf4e8'], question: ['#e0953d', '#fdf4e8'], help: ['#e0953d', '#fdf4e8'], faq: ['#e0953d', '#fdf4e8'],
  danger: ['#d64545', '#fdeeee'], error: ['#d64545', '#fdeeee'], failure: ['#d64545', '#fdeeee'], fail: ['#d64545', '#fdeeee'], bug: ['#d64545', '#fdeeee'], missing: ['#d64545', '#fdeeee'],
  example: ['#7c5ce0', '#f1eefd'], quote: ['#888888', '#f4f4f4'], cite: ['#888888', '#f4f4f4'],
};

const decode = (s: string): string =>
  s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, e: string) => {
    const l = e.toLowerCase();
    if (l === 'amp') return '&'; if (l === 'lt') return '<'; if (l === 'gt') return '>'; if (l === 'quot') return '"'; if (l === 'apos') return "'"; if (l === 'nbsp') return ' ';
    const n = l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : _m;
  });

/** The note without its properties. */
export function stripProperties(md: string): string {
  return md.replace(/^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, '');
}

const ADMON = /^( *)(!!!|\?\?\?\+?) +([\w-]+)(?: +"([^"]*)")? *$/;
const TAB = /^( *)=== +"([^"]*)" *$/;
/** MkDocs boxes and tabs (still readable from older notes) as plain Markdown the layout knows: a callout, a bold line. */
export function legacyBlocks(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = fence ? null : ADMON.exec(line);
    const tab = fence ? null : TAB.exec(line);
    if (!m && !tab) { out.push(line); continue; }
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length && (lines[j]!.startsWith('    ') || lines[j]!.startsWith('\t') || lines[j]!.trim() === ''); j++) body.push(lines[j]!.replace(/^( {4}|\t)/, ''));
    while (body.length && body[body.length - 1]!.trim() === '') body.pop();
    if (m) {
      out.push(`> [!${m[3]}] ${m[4] ?? ''}`.trimEnd(), ...body.map((b) => ('> ' + b).trimEnd()), '');
    } else out.push(`**${tab![2]}**`, '', ...body, '');
    i = j - 1;
  }
  return out.join('\n');
}

export function lexer(md: string): Token[] {
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    extensions: [
      { name: 'wikilink', level: 'inline', start: (s: string) => s.indexOf('[['), tokenizer(s: string) { const m = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/.exec(s); return m ? { type: 'wikilink', raw: m[0], text: (m[2] ?? m[1])!.trim() } : undefined; } },
      // a footnote mark [^1] prints as [1]; its definition line starts the same way
      { name: 'fnref', level: 'inline', start: (s: string) => s.indexOf('[^'), tokenizer(s: string) { const m = /^\[\^([^\]\s]+)\]/.exec(s); return m ? { type: 'fnref', raw: m[0], text: '[' + m[1] + ']' } : undefined; } },
      { name: 'mark', level: 'inline', start: (s: string) => s.indexOf('=='), tokenizer(s: string) { const m = /^==(?=\S)([\s\S]*?\S)==/.exec(s); return m ? { type: 'mark', raw: m[0], text: m[1] } : undefined; } },
    ],
  });
  return marked.lexer(legacyBlocks(stripProperties(md)));
}

interface Region { y0: number; depth: number; draw: (page: Page, y0: number, y1: number) => void }
interface Box { l: number; r: number }

class Layout {
  pages: Page[] = [{ bg: [], ops: [] }];
  y: number;
  readonly top: number; readonly bottom: number; readonly left: number; readonly right: number;
  open: Region[] = [];
  images: PdfImage[] = [];
  firstOnPage = true;
  tooLong = false;
  fonts: Fonts; o: PdfOptions; k: number; W: number; H: number; env: Env; imgs: Map<string, PdfImage | null>;
  constructor(fonts: Fonts, o: PdfOptions, k: number, W: number, H: number, env: Env, imgs: Map<string, PdfImage | null>) {
    this.fonts = fonts; this.o = o; this.k = k; this.W = W; this.H = H; this.env = env; this.imgs = imgs;
    const m = o.margin * MM;
    this.left = m; this.right = W - m; this.top = m; this.bottom = H - m;
    this.y = this.top;
  }
  get S(): number { return this.o.size * this.k; }
  get page(): Page { return this.pages[this.pages.length - 1]!; }
  get lh(): number { return this.o.spacing === 'tight' ? 1.35 : this.o.spacing === 'airy' ? 1.8 : 1.55; }
  get ink(): string { return this.o.ink === 'soft' ? C.soft : C.text; }
  get plain(): boolean { return this.o.plain; }

  newPage(): void {
    for (const r of this.open) r.draw(this.page, r.y0, this.bottom);
    this.pages.push({ bg: [], ops: [] });
    this.y = this.top;
    this.firstOnPage = true;
    for (const r of this.open) r.y0 = this.top;
  }
  /** Make room for `h`; a new page when it does not fit (and the page is not empty). */
  need(h: number): void { if (this.y + h > this.bottom + 0.01 && !this.firstOnPage) this.newPage(); }
  skipGap = false;
  gap(h: number): void { if (this.skipGap) { this.skipGap = false; return; } if (!this.firstOnPage) this.y += h; }
  advance(h: number): void { this.y += h; this.firstOnPage = false; }
  begin(depth: number, draw: Region['draw']): Region { const r = { y0: this.y, depth, draw }; this.open.push(r); return r; }
  end(r: Region): void { r.draw(this.page, r.y0, this.y); this.open = this.open.filter((x) => x !== r); }
  bg(op: Op, depth = 100): void { this.page.bg.push({ ...op, depth }); }

  // ---- text
  placeLines(p: Para, box: Box, color: string, opts: { align?: 'start' | 'end'; widowControl?: boolean } = {}): void {
    let from = 0;
    const total = p.lines.length;
    while (from < total) {
      const room = Math.floor((this.bottom - this.y + 0.01) / p.lineH);
      const left = total - from;
      let n = Math.min(left, Math.max(room, 0));
      if (n < left && opts.widowControl !== false && total >= 4) {
        if (from === 0 && n < 2) n = 0;
        else if (left - n < 2) n = Math.max(0, left - 2);
        if (n === 1 && from > 0) n = 0;
      }
      if (n <= 0) { if (this.firstOnPage) n = Math.max(1, Math.min(left, 1)); else { this.newPage(); continue; } }
      for (let i = 0; i < n; i++) this.drawLine(p, p.lines[from + i]!, box, color);
      from += n;
      if (from < total) this.newPage();
    }
  }
  private drawLine(p: Para, line: Para['lines'][number], box: Box, color: string): void {
    const x0 = p.rtl ? box.r - line.width : box.l;
    const base = this.y + p.baseline;
    for (const pc of line.pieces) {
      if (pc.space && !pc.span.mark && !pc.span.del && !(pc.span.link !== undefined && this.o.linkUnderline)) continue;
      const x = x0 + pc.x;
      const sp = pc.span;
      const isLink = sp.link !== undefined;
      const col = sp.color ?? (isLink && this.o.linkColor === 'blue' ? C.link : color);
      if (sp.mark && !this.plain) this.bg({ t: 'rect', x, y: this.y + (p.lineH - (p.asc + p.desc)) / 2 - 1, w: pc.w, h: p.asc + p.desc + 2, fill: C.mark }, 101);
      else if (sp.code && this.o.codeBox && !this.plain && !pc.space) this.bg({ t: 'rect', x: x - 1, y: base - pc.size * 0.95, w: pc.w + 2, h: pc.size * 1.3, fill: C.codeBg }, 101);
      if (!pc.space) this.page.ops.push({ t: 'text', x, y: base, p: pc, color: col, skew: sp.italic && pc.font.kind !== 'arabic' ? 0.2 : 0 });
      if (sp.del) this.page.ops.push({ t: 'line', x1: x, y1: base - pc.size * 0.3, x2: x + pc.w, y2: base - pc.size * 0.3, lw: Math.max(0.5, pc.size * 0.06), color: col });
      if (isLink && (this.o.linkUnderline || this.o.linkColor === 'black') && !pc.space) this.page.ops.push({ t: 'line', x1: x, y1: base + pc.size * 0.14, x2: x + pc.w, y2: base + pc.size * 0.14, lw: Math.max(0.5, pc.size * 0.06), color: col });
      if (sp.link) this.page.ops.push({ t: 'link', x, y: this.y, w: pc.w, h: p.lineH, url: sp.link });
    }
    this.y += p.lineH;
    this.firstOnPage = false;
  }
  paragraph(spans: Span[], box: Box, o: { size?: number; color?: string; bold?: boolean; dir?: 'auto' | 'ltr' | 'rtl'; widow?: boolean } = {}): Para {
    const p = layoutPara(this.fonts, spans, { size: o.size ?? this.S, width: box.r - box.l, lineHeight: this.lh, dir: o.dir ?? 'auto', bold: o.bold });
    this.placeLines(p, box, o.color ?? this.ink, { widowControl: o.widow });
    return p;
  }

  // ---- inline
  inline(tokens: Token[] | undefined, st: Partial<Span>, out: Span[], images: Array<{ href: string; alt: string; width?: number }>): void {
    for (const t of tokens ?? []) {
      switch (t.type) {
        case 'text': case 'escape': {
          const tt = t as Tokens.Text;
          if (tt.tokens?.length) this.inline(tt.tokens, st, out, images); else out.push({ ...st, text: decode(tt.text) });
          break;
        }
        case 'strong': this.inline((t as Tokens.Strong).tokens, { ...st, bold: true }, out, images); break;
        case 'em': this.inline((t as Tokens.Em).tokens, { ...st, italic: true }, out, images); break;
        case 'del': this.inline((t as Tokens.Del).tokens, { ...st, del: true }, out, images); break;
        case 'codespan': out.push({ ...st, code: true, text: decode((t as Tokens.Codespan).text) }); break;
        case 'link': {
          const l = t as Tokens.Link;
          const ext = /^(https?:|mailto:|tel:)/i.test(l.href);
          this.inline(l.tokens, { ...st, link: ext ? l.href : '' }, out, images);
          if (ext && this.o.linkShowUrl && l.href.replace(/^mailto:|^tel:/, '') !== l.text) out.push({ ...st, text: ` (${l.href.replace(/^mailto:|^tel:/, '')})` });
          break;
        }
        case 'image': { const im = t as Tokens.Image; images.push({ href: im.href, alt: decode(im.text) }); break; }
        case 'br': out.push({ ...st, text: '\n' }); break;
        case 'html': {
          const h = (t as Tokens.HTML).text;
          if (/^<br\s*\/?>$/i.test(h.trim())) out.push({ ...st, text: '\n' });
          else { const im = /^<img\b[^>]*>$/i.exec(h.trim()); if (im) images.push(htmlImage(im[0])); }
          break;
        }
        case 'wikilink': out.push({ ...st, link: '', text: (t as unknown as { text: string }).text }); break;
        case 'mark': out.push({ ...st, mark: true, text: (t as unknown as { text: string }).text }); break;
        case 'checkbox': break;
        default: if ('text' in t && typeof (t as { text?: string }).text === 'string') out.push({ ...st, text: decode((t as { text: string }).text) });
      }
    }
  }
  /** Spans split at line breaks. */
  lines(spans: Span[]): Span[][] {
    const out: Span[][] = [[]];
    for (const sp of spans) {
      const parts = sp.text.split('\n');
      parts.forEach((part, i) => { if (i) out.push([]); if (part) out[out.length - 1]!.push({ ...sp, text: part }); });
    }
    return out;
  }
  /** A paragraph of inline tokens; pictures in it are laid out after the words before them. */
  async text(tokens: Token[] | undefined, box: Box, o: { size?: number; bold?: boolean; color?: string; dir?: 'auto' | 'ltr' | 'rtl'; st?: Partial<Span> } = {}): Promise<void> {
    let spans: Span[] = [];
    const flush = () => {
      for (const r of this.lines(spans)) if (r.length) this.paragraph(r, box, { size: o.size, bold: o.bold, color: o.color, dir: o.dir });
      spans = [];
    };
    // walk the tokens, cutting at pictures
    const batch: Token[] = [];
    const run = async (group: Token[]) => {
      const imgs: Array<{ href: string; alt: string; width?: number }> = [];
      this.inline(group, o.st ?? {}, spans, imgs);
      flush();
      for (const im of imgs) await this.picture(im, box);
    };
    for (const t of tokens ?? []) {
      if (t.type === 'image' || (t.type === 'html' && /^<img\b/i.test((t as Tokens.HTML).text.trim()))) { batch.push(t); await run(batch.splice(0)); } else batch.push(t);
    }
    if (batch.length) await run(batch);
  }

  async picture(im: { href: string; alt: string; width?: number }, box: Box): Promise<void> {
    if (!this.o.pictures) return;
    const img = this.imgs.get(im.href);
    if (!img) {
      const label = im.alt || im.href;
      this.gap(this.S * 0.3);
      this.paragraph([{ text: label, italic: true, color: C.grey }], box, {});
      return;
    }
    const avail = box.r - box.l;
    let w = Math.min(img.w * 0.75, avail), h = (w * img.h) / img.w;
    if (im.width) { w = Math.min(im.width * 0.75, avail); h = (w * img.h) / img.w; }
    w *= this.k; h *= this.k;
    const max = this.bottom - this.top;
    if (h > max) { w = (w * max) / h; h = max; }
    this.gap(this.S * 0.4);
    this.need(h);
    const x = box.l + (avail - w) / 2;
    if (!this.images.includes(img)) this.images.push(img);
    this.page.ops.push({ t: 'image', x, y: this.y, w, h, img });
    this.advance(h + this.S * 0.4);
  }

  // ---- blocks
  async blocks(tokens: Token[], box: Box, o: { tight?: boolean } = {}): Promise<void> {
    for (const t of tokens) await this.block(t, box, o);
  }
  private async block(t: Token, box: Box, o: { tight?: boolean }): Promise<void> {
    const S = this.S;
    switch (t.type) {
      case 'space': case 'def': return;
      case 'heading': {
        const h = t as Tokens.Heading;
        const mul = [0, 1.9, 1.5, 1.25, 1.1, 1, 1][h.depth]!;
        const size = S * mul;
        if (h.depth === 1 && this.o.breakH1 && !this.firstOnPage) this.newPage();
        this.gap(S * (h.depth <= 2 ? 1.0 : 0.8));
        const spans: Span[] = [];
        this.inline(h.tokens, { bold: true }, spans, []);
        const para = layoutPara(this.fonts, spans.length ? spans : [{ text: '' }], { size, width: box.r - box.l, lineHeight: 1.25, bold: true });
        this.need(para.lineH * para.lines.length + S * 2.2);
        this.placeLines(para, box, this.ink, { widowControl: false });
        if (h.depth === 2 && !this.plain) { this.y += S * 0.1; this.bg({ t: 'line', x1: box.l, y1: this.y, x2: box.r, y2: this.y, lw: 0.6, color: '#dddddd' }); }
        this.y += S * 0.35;
        return;
      }
      case 'paragraph': case 'text': {
        const p = t as Tokens.Paragraph;
        this.gap(o.tight ? S * 0.15 : S * 0.6);
        await this.text(p.tokens ?? [{ type: 'text', raw: p.text, text: p.text } as Token], box);
        return;
      }
      case 'hr': this.gap(S * 0.8); this.need(S); this.page.ops.push({ t: 'line', x1: box.l, y1: this.y, x2: box.r, y2: this.y, lw: 0.8, color: C.rule }); this.advance(S * 0.6); return;
      case 'html': {
        const raw = (t as Tokens.HTML).text;
        const imgs = [...raw.matchAll(/<img\b[^>]*>/gi)].map((m) => htmlImage(m[0]));
        const words = decode(raw.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')).trim();
        if (words) { this.gap(S * 0.6); for (const r of this.lines([{ text: words }])) if (r.length) this.paragraph(r, box); }
        for (const im of imgs) await this.picture(im, box);
        return;
      }
      case 'code': return this.code((t as Tokens.Code).text, box);
      case 'list': return this.list(t as Tokens.List, box, o);
      case 'blockquote': return this.quote(t as Tokens.Blockquote, box);
      case 'table': return this.table(t as Tokens.Table, box);
      default: {
        const tt = t as { text?: string };
        if (tt.text) { this.gap(S * 0.6); this.paragraph([{ text: decode(tt.text) }], box); }
      }
    }
  }

  private code(src: string, box: Box): void {
    const S = this.S;
    const pad = S * 0.6;
    this.gap(S * 0.7);
    const inner: Box = { l: box.l + pad, r: box.r - pad };
    const size = S * 0.88;
    this.need(size * 1.5 + pad * 2);
    const fill = this.o.codeBox && !this.plain;
    const region = this.begin(5, (page, y0, y1) => {
      if (y1 - y0 < 1) return;
      page.bg.push({ t: 'rect', x: box.l, y: y0, w: box.r - box.l, h: y1 - y0, fill: fill ? C.box : undefined, stroke: this.o.codeBox ? C.boxLine : undefined, lw: 0.6, depth: 5 });
    });
    this.advance(pad);
    for (const line of src.replace(/\s+$/, '').split('\n')) {
      const p = layoutPara(this.fonts, [{ text: line || ' ', code: true }], { size: size / 0.9, width: inner.r - inner.l, lineHeight: 1.45, dir: 'ltr', pre: true });
      for (let i = 0; i < p.lines.length; i++) {
        if (this.y + p.lineH > this.bottom - pad && !this.firstOnPage) { this.newPage(); this.advance(pad); }
        this.placeLines({ ...p, lines: [p.lines[i]!] }, inner, this.ink, { widowControl: false });
      }
    }
    this.y += pad;
    this.end(region);
    this.y += 0;
  }

  private async list(l: Tokens.List, box: Box, o: { tight?: boolean }): Promise<void> {
    const S = this.S;
    this.gap(o.tight ? S * 0.2 : S * 0.5);
    // the whole list takes the direction of its first words
    const first = (l.items[0]?.text ?? '');
    const rtl = layoutPara(this.fonts, [{ text: first.replace(/^\[[ xX]\]\s*/, '') || ' ' }], { size: S, width: 1e5, lineHeight: 1 }).rtl;
    const nums = l.ordered ? l.items.map((_, i) => `${(Number(l.start) || 1) + i}.`) : [];
    const markW = l.ordered ? Math.max(...nums.map((n) => this.fonts.shape(this.fonts.all().find((f) => f.id === 'qm-roboto-400')!, n, false).width * S / this.fonts.all().find((f) => f.id === 'qm-roboto-400')!.upm)) : 0;
    const indent = Math.max(S * 1.5, markW + S * 0.7);
    for (let i = 0; i < l.items.length; i++) {
      const it = l.items[i]!;
      const inner: Box = rtl ? { l: box.l, r: box.r - indent } : { l: box.l + indent, r: box.r };
      const startY = this.y;
      const startPage = this.pages.length;
      this.need(S * this.lh * 2);
      const y0 = this.y, pg = this.pages.length;
      // the item's blocks
      const kids = it.tokens ?? [];
      const firstIdx = kids.findIndex((t) => t.type === 'text' || t.type === 'paragraph');
      this.skipGap = true;
      await this.blocks(kids, inner, { tight: true });
      this.skipGap = false;
      void startY; void startPage;
      // the marker sits next to the first line (on the page where the item starts)
      const page = this.pages[pg - 1]!;
      const base = y0 + (S * this.lh) / 2;
      const mx = rtl ? box.r : box.l;
      if (firstIdx === 0 || firstIdx === -1) {
        if (it.task) {
          const s = S * 0.78;
          const x = rtl ? mx - s : mx;
          const yy = base - s / 2 - S * 0.02;
          page.ops.push({ t: 'rect', x, y: yy, w: s, h: s, stroke: '#444444', lw: 0.9 });
          if (it.checked) {
            page.ops.push({ t: 'line', x1: x + s * 0.18, y1: yy + s * 0.55, x2: x + s * 0.42, y2: yy + s * 0.8, lw: 1.3, color: '#222222' });
            page.ops.push({ t: 'line', x1: x + s * 0.42, y1: yy + s * 0.8, x2: x + s * 0.84, y2: yy + s * 0.2, lw: 1.3, color: '#222222' });
          }
        } else if (l.ordered) {
          const roboto = this.fonts.all().find((f) => f.id === 'qm-roboto-400')!;
          const sh = this.fonts.shape(roboto, nums[i]!, false);
          const w = (sh.width * S) / roboto.upm;
          const p: Piece = { font: roboto, size: S, shaped: sh, level: 0, text: nums[i]!, w, space: false, span: { text: nums[i]! }, x: 0 };
          page.ops.push({ t: 'text', x: rtl ? mx - w : mx, y: y0 + (S * this.lh - (roboto.asc + roboto.desc) * S / roboto.upm) / 2 + (roboto.asc * S) / roboto.upm, p, color: this.ink, skew: 0 });
        } else {
          page.ops.push({ t: 'dot', x: rtl ? mx - S * 0.35 : mx + S * 0.35, y: base, r: S * 0.14, color: this.ink });
        }
      }
      this.y += S * 0.1;
    }
  }

  private async quote(q: Tokens.Blockquote, box: Box): Promise<void> {
    const S = this.S;
    const kids = q.tokens ?? [];
    // a note box: > [!NOTE] Title
    const head = kids[0]?.type === 'paragraph' ? (kids[0] as Tokens.Paragraph) : null;
    const m = head ? /^\[!([\w-]+)\][+-]?[ \t]*([^\n]*)(?:\n([\s\S]*))?$/.exec(head.text) : null;
    const kind = m ? m[1]!.toLowerCase() : '';
    const colors = m ? KIND[kind] ?? KIND.note! : null;
    const rest: Token[] = m && m[3] ? lexer(m[3]) : [];
    const body: Token[] = m ? [...rest, ...kids.slice(1)] : kids;
    const title = m ? (m[2]!.trim() || kind.charAt(0).toUpperCase() + kind.slice(1)) : '';
    const rtl = layoutPara(this.fonts, [{ text: m ? title : (head?.text ?? ' ') }], { size: S, width: 1e5, lineHeight: 1 }).rtl;
    const pad = S * 0.8, bar = 3;
    const inner: Box = rtl ? { l: box.l + pad, r: box.r - bar - pad } : { l: box.l + bar + pad, r: box.r - pad };
    this.gap(S * 0.7);
    this.need(S * this.lh * 2 + S);
    const barColor = colors ? colors[0] : '#aaaaaa';
    const region = this.begin(colors ? 2 : 3, (page, y0, y1) => {
      if (y1 - y0 < 1) return;
      if (colors && !this.plain) page.bg.push({ t: 'rect', x: box.l, y: y0, w: box.r - box.l, h: y1 - y0, fill: colors[1], depth: 2 });
      page.bg.push({ t: 'rect', x: rtl ? box.r - bar : box.l, y: y0, w: bar, h: y1 - y0, fill: this.plain ? '#888888' : barColor, depth: 3 });
    });
    this.advance(colors ? S * 0.5 : 0);
    if (m) { const p = layoutPara(this.fonts, [{ text: title, bold: true }], { size: S, width: inner.r - inner.l, lineHeight: this.lh }); this.placeLines(p, inner, this.ink); this.y += S * 0.1; }
    await this.blocks(body, inner, { tight: false });
    this.y += colors ? S * 0.5 : S * 0.1;
    this.end(region);
  }

  private async table(t: Tokens.Table, box: Box): Promise<void> {
    const S = this.S;
    const size = S * 0.95;
    const padX = S * 0.5, padY = S * 0.3;
    const rows = [t.header, ...t.rows];
    const n = t.header.length;
    const cellSpans = (c: Tokens.TableCell, head: boolean): Span[] => { const s: Span[] = []; this.inline(c.tokens, head ? { bold: true } : {}, s, []); return this.lines(s).flat().length ? s.map((x) => ({ ...x, text: x.text.replace(/\n/g, ' ') })) : [{ text: ' ' }]; };
    const spans = rows.map((r, ri) => r.map((c) => cellSpans(c, ri === 0)));
    const all = spans.flat(2).map((s) => s.text).join(' ');
    const rtl = layoutPara(this.fonts, [{ text: all || ' ' }], { size, width: 1e5, lineHeight: 1 }).rtl;
    const mx = new Array<number>(n).fill(0), mn = new Array<number>(n).fill(0);
    rows.forEach((_r, ri) => { for (let c = 0; c < n; c++) { const m = measure(this.fonts, spans[ri]![c] ?? [{ text: ' ' }], size); mx[c] = Math.max(mx[c]!, m.max + 2 * padX); mn[c] = Math.max(mn[c]!, Math.min(m.min, m.max) + 2 * padX); } });
    const W = box.r - box.l;
    let widths: number[];
    const sumMax = mx.reduce((a, b) => a + b, 0), sumMin = mn.reduce((a, b) => a + b, 0);
    if (sumMax <= W) widths = mx.map((x) => x + (W - sumMax) / n);
    else if (sumMin >= W) widths = mn.map((x) => (x * W) / sumMin);
    else { const share = (W - sumMin) / (sumMax - sumMin); widths = mn.map((x, i) => x + (mx[i]! - x) * share); }
    const colX: number[] = [];
    let x = rtl ? box.r : box.l;
    for (let c = 0; c < n; c++) { if (rtl) { x -= widths[c]!; colX.push(x); } else { colX.push(x); x += widths[c]!; } }
    this.gap(S * 0.7);
    const layoutRow = (ri: number) => {
      const paras = spans[ri]!.map((sp, c) => layoutPara(this.fonts, sp, { size, width: widths[c]! - 2 * padX, lineHeight: this.lh, dir: 'auto', bold: ri === 0 }));
      const h = Math.max(...paras.map((p) => p.lineH * p.lines.length)) + 2 * padY;
      return { paras, h };
    };
    const drawRow = (ri: number, r: { paras: Para[]; h: number }) => {
      const y0 = this.y;
      const fill = ri === 0 ? (this.o.tableLines && !this.plain ? C.th : undefined) : this.o.tableZebra && !this.plain && ri % 2 === 0 ? C.zebra : undefined;
      for (let c = 0; c < n; c++) {
        if (fill) this.bg({ t: 'rect', x: colX[c]!, y: y0, w: widths[c]!, h: r.h, fill }, 6);
        if (this.o.tableLines) this.bg({ t: 'rect', x: colX[c]!, y: y0, w: widths[c]!, h: r.h, stroke: C.tableLine, lw: 0.6 }, 7);
        const p = r.paras[c]!;
        const saved = this.y;
        this.y = y0 + padY;
        const cb: Box = { l: colX[c]! + padX, r: colX[c]! + widths[c]! - padX };
        for (const ln of p.lines) { this.drawLine(p, ln, cb, this.ink); }
        this.y = saved;
      }
      this.y = y0 + r.h;
      this.firstOnPage = false;
    };
    const head = layoutRow(0);
    for (let ri = 0; ri < rows.length; ri++) {
      const r = ri === 0 ? head : layoutRow(ri);
      if (this.y + r.h > this.bottom + 0.01 && !this.firstOnPage) {
        this.newPage();
        if (ri > 0) drawRow(0, head); // the header row again on the new page
      }
      if (ri === 1 && this.y + r.h + head.h > this.bottom && !this.firstOnPage) { this.newPage(); drawRow(0, head); }
      drawRow(ri, r);
    }
    this.y += S * 0.1;
  }
}

/** <img src="…" width="…"> as a picture to place. */
function htmlImage(tag: string): { href: string; alt: string; width?: number } {
  const attr = (n: string) => new RegExp(`\\b${n}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  const src = attr('src'), alt = attr('alt'), w = attr('width');
  return { href: decode(src?.[2] ?? src?.[3] ?? ''), alt: decode(alt?.[2] ?? alt?.[3] ?? ''), width: w ? parseFloat(w[2] ?? w[3] ?? '') || undefined : undefined };
}

const urlsOf = (tokens: Token[], out: Set<string>): void => {
  for (const t of tokens) {
    if (t.type === 'image') out.add((t as Tokens.Image).href);
    else if (t.type === 'html') for (const m of (t as Tokens.HTML).text.matchAll(/<img\b[^>]*>/gi)) out.add(htmlImage(m[0]).href);
    const sub = (t as { tokens?: Token[] }).tokens;
    if (sub) urlsOf(sub, out);
    const items = (t as { items?: Array<{ tokens?: Token[] }> }).items;
    if (items) for (const i of items) if (i.tokens) urlsOf(i.tokens, out);
  }
};

function fill(text: string, meta: Meta, o: PdfOptions, page: number, pages: number, now: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return text
    .replace(/\{file\}/g, meta.file).replace(/\{title\}/g, meta.title).replace(/\{page\}/g, String(page)).replace(/\{pages\}/g, String(pages))
    .replace(/\{date\}/g, `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`).replace(/\{time\}/g, `${two(now.getHours())}:${two(now.getMinutes())}`);
}

function run(fonts: Fonts, tokens: Token[], md: string, meta: Meta, o: PdfOptions, k: number, env: Env, imgs: Map<string, PdfImage | null>): Promise<Layout> {
  const [pw, ph] = PAPERS[o.paper] ?? PAPERS.A4;
  const W = o.landscape ? ph : pw, H = o.landscape ? pw : ph;
  const lay = new Layout(fonts, o, k, W, H, env, imgs);
  void md;
  return (async () => {
    const box: Box = { l: lay.left, r: lay.right };
    if (o.title && meta.title) {
      const spans: Span[] = [{ text: meta.title, bold: true }];
      const p = layoutPara(fonts, spans, { size: lay.S * 2.2, width: box.r - box.l, lineHeight: 1.25, bold: true });
      lay.placeLines(p, box, lay.ink, { widowControl: false });
      lay.y += lay.S * 0.5;
    }
    await lay.blocks(tokens, box);
    return lay;
  })();
}

/** Lay a note out on pages. */
export async function layoutDoc(md: string, meta: Meta, options: PdfOptions, env: Env): Promise<Doc> {
  const o = { ...DEFAULT_PDF, ...options };
  const tokens = lexer(md);
  const fonts = new Fonts(env.fonts, o.arabic);
  const footL = o.footerL || (o.fileName ? '{file}' : ''), footR = o.footerR || (o.pageNumbers ? '{page} / {pages}' : '');
  await fonts.prepare(md + [o.headerL, o.headerC, o.headerR, footL, o.footerC, footR].join(' ') + meta.title + meta.file);
  const urls = new Set<string>();
  urlsOf(tokens, urls);
  const imgs = new Map<string, PdfImage | null>();
  if (o.pictures && env.image) await Promise.all([...urls].map(async (u) => { try { imgs.set(u, await env.image!(u)); } catch { imgs.set(u, null); } }));
  fonts.missing = 0;
  let k = 1;
  let lay = await run(fonts, tokens, md, meta, o, k, env, imgs);
  let tooLong = false;
  if (o.fitOne && lay.pages.length > 1) {
    let lo = 0.2, hi = 1;
    let best: Layout | null = null;
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      const t = await run(fonts, tokens, md, meta, o, mid, env, imgs);
      if (t.pages.length === 1) { best = t; k = mid; lo = mid; } else hi = mid;
    }
    if (best) lay = best;
    else { tooLong = true; lay = await run(fonts, tokens, md, meta, o, 0.2, env, imgs); k = 0.2; }
  }
  // header and footer, now that the number of pages is known
  const now = env.now ?? new Date();
  const pages = lay.pages.length;
  const m = o.margin * MM;
  lay.pages.forEach((pg, i) => {
    const put = (text: string, where: 'L' | 'C' | 'R', y: number) => {
      const s = fill(text, meta, o, i + 1, pages, now).trim();
      if (!s) return;
      const p = layoutPara(fonts, [{ text: s }], { size: 8.5, width: lay.right - lay.left, lineHeight: 1.2, dir: 'auto' });
      const line = p.lines[0];
      if (!line) return;
      const x0 = where === 'L' ? lay.left : where === 'R' ? lay.right - line.width : lay.left + (lay.right - lay.left - line.width) / 2;
      const col = C.grey;
      for (const pc of line.pieces) if (!pc.space) pg.ops.push({ t: 'text', x: x0 + pc.x, y: y + p.baseline - p.lineH / 2, p: pc, color: col, skew: 0 });
    };
    const hy = Math.max(m * 0.55, 14), fy = lay.H - Math.max(m * 0.45, 14);
    put(o.headerL, 'L', hy); put(o.headerC, 'C', hy); put(o.headerR, 'R', hy);
    put(footL, 'L', fy); put(o.footerC, 'C', fy); put(footR, 'R', fy);
    if (o.rules && (o.headerL || o.headerC || o.headerR)) pg.ops.push({ t: 'line', x1: lay.left, y1: hy + 7, x2: lay.right, y2: hy + 7, lw: 0.5, color: C.rule });
    if (o.rules && (footL || o.footerC || footR)) pg.ops.push({ t: 'line', x1: lay.left, y1: fy - 11, x2: lay.right, y2: fy - 11, lw: 0.5, color: C.rule });
  });
  return { pages: lay.pages, w: lay.W, h: lay.H, fonts, images: lay.images, scale: k, title: meta.title, tooLong };
}
export type { FontRef };
