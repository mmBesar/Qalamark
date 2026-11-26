// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The browser's side of the PDF writer: where the fonts come from, and how a picture becomes pixels.

import type { Env, PdfImage } from './flow.ts';

const urls = import.meta.glob('./fonts/*.ttf', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const bytes = new Map<string, Promise<Uint8Array>>();

function fontBytes(name: string): Promise<Uint8Array> {
  let p = bytes.get(name);
  if (!p) {
    const u = urls[`./fonts/${name}.ttf`];
    if (!u) return Promise.reject(new Error('No font ' + name));
    p = fetch(u).then(async (r) => new Uint8Array(await r.arrayBuffer()));
    bytes.set(name, p);
  }
  return p;
}

const MAX = 1800; // longest side of a picture in the PDF, in pixels

/** A picture from an address the page can read (a blob:, data: or web address). */
async function loadImage(src: string): Promise<PdfImage | null> {
  const el = new Image();
  el.decoding = 'async';
  el.src = src;
  try { await el.decode(); } catch { return null; }
  let w = el.naturalWidth || 300, h = el.naturalHeight || 150;
  const k = Math.min(1, MAX / Math.max(w, h));
  w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(el, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  let alpha = false;
  for (let i = 3; i < px.length; i += 4) if (px[i]! < 255) { alpha = true; break; }
  if (!alpha) {
    // no see-through parts: a JPEG is far smaller than raw pixels
    const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/jpeg', 0.88));
    if (blob) return { w, h, jpeg: new Uint8Array(await blob.arrayBuffer()) };
  }
  const rgb = new Uint8Array(w * h * 3), a = new Uint8Array(w * h);
  for (let i = 0, j = 0, p = 0; i < px.length; i += 4, p++) { rgb[j++] = px[i]!; rgb[j++] = px[i + 1]!; rgb[j++] = px[i + 2]!; a[p] = px[i + 3]!; }
  return { w, h, rgb, alpha: alpha ? a : undefined };
}

/** What the PDF writer needs here; `resolve` turns the address written in a note into one the page can load. */
export function browserEnv(resolve: (url: string) => Promise<string | null>): Env {
  return {
    fonts: fontBytes,
    image: async (url) => {
      const src = await resolve(url);
      return src ? loadImage(src) : null;
    },
  };
}
