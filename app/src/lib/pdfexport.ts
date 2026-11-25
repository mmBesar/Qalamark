// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The "Export as PDF" machinery: build the page, show it, and hand it to the system's print service.

import { buildDocument, DEFAULT_PDF, imageUrls, inlineImages, renderBody, type PdfOptions } from './pdf.ts';
import { printNative } from './widgets.ts';

const KEY = 'qm.pdf';
export function loadPdfOptions(): PdfOptions {
  try { return { ...DEFAULT_PDF, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PdfOptions>) }; } catch { return { ...DEFAULT_PDF }; }
}
export function savePdfOptions(o: PdfOptions): void {
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* not saved */ }
}

/** The app's own @font-face rules (with absolute addresses), so the page uses the same fonts as the app. */
function appFontFaces(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    const base = sheet.href ?? location.href;
    for (const r of Array.from(rules)) {
      if (r instanceof CSSFontFaceRule) out.push(r.cssText.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/g, (_m, u: string) => (u.startsWith('data:') ? `url(${u})` : `url("${new URL(u, base).href}")`)));
    }
  }
  return out.join('\n');
}

/** The font stacks the user chose in Settings, for the page. */
function families(): { text: string; code: string } {
  const css = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return { text: pick('--ui', "'Qalamark Roboto', Roboto, system-ui, sans-serif"), code: pick('--mono', "'JetBrainsMono Nerd Font Mono', monospace") };
}

/** The page for a note, as a complete HTML document. */
export async function pageFor(md: string, title: string, o: PdfOptions, resolve: (url: string) => Promise<string | null>): Promise<string> {
  const images = await inlineImages(imageUrls(md), resolve);
  return buildDocument(renderBody(md, images), title, o, appFontFaces(), families());
}

/** Paper size in CSS pixels (96 per inch), for the preview. */
export function paperPx(o: PdfOptions): { w: number; h: number } {
  const [w, h] = o.paper === 'Letter' ? [816, 1056] : o.paper === 'A5' ? [559, 794] : [794, 1123];
  return o.landscape ? { w: h, h: w } : { w, h };
}

/** Send the page to the print service: "Save as PDF" is one of its choices on every system. */
export async function printPage(html: string, name: string): Promise<void> {
  if (printNative(html, name)) return; // Android: the system print window
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.srcdoc = html;
  const loaded = new Promise<void>((res) => { frame.onload = () => res(); });
  document.body.appendChild(frame);
  await loaded;
  const w = frame.contentWindow!;
  try { await w.document.fonts.ready; } catch { /* no font events */ }
  await Promise.all(Array.from(w.document.images).map((i) => i.decode().catch(() => {})));
  const done = () => frame.remove();
  w.addEventListener('afterprint', done, { once: true });
  setTimeout(done, 10 * 60_000);
  w.focus();
  w.print();
}
