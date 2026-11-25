// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// A note as a clean page for printing or saving as PDF: no properties, black on white, real text (selectable and
// searchable), Arabic lines on the right. The browser's own print engine lays the pages out, so Arabic shaping,
// tables and page breaks are right; on Android the system print service is used (it has "Save as PDF").

import { Marked, type Tokens } from 'marked';

export interface PdfOptions {
  paper: 'A4' | 'Letter' | 'A5';
  landscape: boolean;
  margin: 'narrow' | 'normal' | 'wide';
  size: 'small' | 'medium' | 'large';
  title: boolean;
  pageNumbers: boolean;
}
export const DEFAULT_PDF: PdfOptions = { paper: 'A4', landscape: false, margin: 'normal', size: 'medium', title: false, pageNumbers: true };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The note without its properties. */
export function stripProperties(md: string): string {
  return md.replace(/^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, '');
}

/** The addresses of the pictures a note shows. */
export function imageUrls(md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.add(m[1]!);
  return [...out];
}

const ADMON = /^( *)(!!!|\?\?\?\+?) +([\w-]+)(?: +"([^"]*)")? *$/;

/** `!!! note "Title"` blocks (the MkDocs way) become boxes: the indented lines under them are their body. */
function admonitions(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = ADMON.exec(lines[i]!);
    if (!m) { out.push(lines[i]!); continue; }
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length && (lines[j]!.startsWith('    ') || lines[j]!.startsWith('\t') || lines[j]!.trim() === ''); j++) body.push(lines[j]!.replace(/^( {4}|\t)/, ''));
    while (body.length && body[body.length - 1]!.trim() === '') body.pop();
    const kind = m[3]!.toLowerCase();
    out.push(`<div class="admon ${esc(kind)}" dir="auto"><p class="admon-title">${esc(m[4] ?? kind[0]!.toUpperCase() + kind.slice(1))}</p>`, '', ...body, '', '</div>', '');
    i = j - 1;
  }
  return out.join('\n');
}

/** Turn the note's text into HTML. `images` maps a picture address to something a printed page can show (a data: address). */
export function renderBody(md: string, images: Record<string, string> = {}): string {
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      // pictures: the resolved address, or a plain label when the picture could not be found
      image({ href, title, text }: Tokens.Image) {
        const src = images[href];
        return src ? `<img src="${esc(src)}" alt="${esc(text)}"${title ? ` title="${esc(title)}"` : ''}>` : `<span class="nopic">${esc(text || href)}</span>`;
      },
      // tick boxes drawn as characters: they print the same everywhere
      checkbox({ checked }: Tokens.Checkbox) { return `<span class="tick">${checked ? '☑' : '☐'}</span> `; },
    },
    extensions: [
      { name: 'wikilink', level: 'inline', start: (s: string) => s.indexOf('[['), tokenizer(s: string) { const m = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/.exec(s); return m ? { type: 'wikilink', raw: m[0], text: (m[2] ?? m[1])!.trim() } : undefined; }, renderer: (t) => `<span class="wl">${esc((t as unknown as { text: string }).text)}</span>` },
      { name: 'mark', level: 'inline', start: (s: string) => s.indexOf('=='), tokenizer(s: string) { const m = /^==(?=\S)([\s\S]*?\S)==/.exec(s); return m ? { type: 'mark', raw: m[0], text: m[1] } : undefined; }, renderer: (t) => `<mark>${esc((t as unknown as { text: string }).text)}</mark>` },
    ],
  });
  let html = marked.parse(admonitions(stripProperties(md)), { async: false }) as string;
  // every line decides its own direction: Arabic lines run right to left and sit on the right
  html = html.replace(/<(p|li|h[1-6]|blockquote|table|th|td|figcaption)(?=[\s>])(?![^>]*\sdir=)/g, '<$1 dir="auto"');
  // a list item that holds nested lists or blocks keeps its own direction too; code stays left to right
  html = html.replace(/<pre(?=[\s>])/g, '<pre dir="ltr"').replace(/<code(?=[\s>])(?![^>]*\sdir=)/g, '<code dir="ltr"');
  return html;
}

const SIZE = { small: 10.5, medium: 12, large: 14 } as const;
const MARGIN = { narrow: '12mm', normal: '20mm', wide: '28mm' } as const;

/** A whole page document ready to print. `fontCss` carries the @font-face rules, `families` the font stacks to use. */
export function buildDocument(body: string, title: string, o: PdfOptions, fontCss: string, families: { text: string; code: string }): string {
  const heading = o.title ? `<h1 class="doc-title" dir="auto">${esc(title)}</h1>` : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
${fontCss}
@page { size: ${o.paper} ${o.landscape ? 'landscape' : 'portrait'}; margin: ${MARGIN[o.margin]};${o.pageNumbers ? ' @bottom-center { content: counter(page); font: 9pt sans-serif; color: #666; }' : ''} }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #111; background: #fff; font: ${SIZE[o.size]}pt/1.6 ${families.text}; text-align: start; overflow-wrap: anywhere; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.3em 0 0.45em; break-after: avoid; page-break-after: avoid; }
h1 { font-size: 1.9em; } h2 { font-size: 1.5em; border-bottom: 1px solid #ddd; padding-bottom: 0.15em; } h3 { font-size: 1.25em; } h4 { font-size: 1.1em; }
.doc-title { margin-top: 0; font-size: 2.2em; }
p { margin: 0.55em 0; orphans: 3; widows: 3; }
ul, ol { margin: 0.5em 0; padding-inline-start: 1.6em; }
li { margin: 0.2em 0; }
li:has(> .tick), li:has(> p > .tick) { list-style: none; margin-inline-start: -1.2em; }
.tick { font-family: 'DejaVu Sans', 'Segoe UI Symbol', sans-serif; }
blockquote { margin: 0.8em 0; padding: 0.1em 1em; border-inline-start: 3px solid #aaa; color: #444; }
code { font-family: ${families.code}; font-size: 0.9em; background: #f1f1f1; padding: 0.08em 0.3em; border-radius: 3px; }
pre { background: #f6f6f6; border: 1px solid #e2e2e2; border-radius: 6px; padding: 0.7em 0.9em; overflow: hidden; white-space: pre-wrap; break-inside: avoid; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 0.8em 0; font-size: 0.95em; }
th, td { border: 1px solid #bbb; padding: 0.35em 0.6em; text-align: start; vertical-align: top; }
th { background: #f0f0f0; }
tr { break-inside: avoid; page-break-inside: avoid; }
thead { display: table-header-group; }
img { max-width: 100%; height: auto; break-inside: avoid; }
hr { border: 0; border-top: 1px solid #ccc; margin: 1.2em 0; }
a { color: #0b57d0; text-decoration: none; }
mark { background: #fff3a3; padding: 0 0.15em; }
.wl { color: #0b57d0; }
.nopic { color: #777; font-style: italic; }
.admon { margin: 0.9em 0; padding: 0.1em 1em 0.5em; border-inline-start: 4px solid #3d7fe0; background: #eef4fd; border-radius: 4px; break-inside: avoid; }
.admon.warning, .admon.caution { border-color: #e0953d; background: #fdf4e8; } .admon.danger, .admon.failure, .admon.bug { border-color: #d64545; background: #fdeeee; } .admon.success, .admon.tip { border-color: #3fa66a; background: #ecf8f1; }
.admon-title { font-weight: 700; margin: 0.5em 0 0.2em; }
</style></head>
<body>${heading}${body}</body></html>`;
}

/** Pictures as data: addresses, so the printed page (even in another web view) needs nothing from the app. */
export async function inlineImages(urls: string[], resolve: (url: string) => Promise<string | null>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(urls.map(async (u) => {
    try {
      const src = await resolve(u);
      if (!src) return;
      if (src.startsWith('data:')) { out[u] = src; return; }
      const blob = await (await fetch(src)).blob();
      out[u] = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
    } catch { /* a missing picture is shown as its name */ }
  }));
  return out;
}
