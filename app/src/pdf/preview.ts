// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// A page of the PDF drawn on a canvas from the very same drawing steps the file is written from: what you see in
// the preview is what is in the file.

import type { FontRef } from './fonts.ts';
import type { Doc, Op, PdfImage } from './flow.ts';

const paths = new Map<string, Path2D>();
function glyphPath(f: FontRef, gid: number): Path2D {
  const key = f.id + ':' + gid;
  let p = paths.get(key);
  if (!p) {
    p = new Path2D();
    for (const c of f.font.getGlyph(gid).path.commands) {
      const a = c.args;
      if (c.command === 'moveTo') p.moveTo(a[0]!, a[1]!);
      else if (c.command === 'lineTo') p.lineTo(a[0]!, a[1]!);
      else if (c.command === 'quadraticCurveTo') p.quadraticCurveTo(a[0]!, a[1]!, a[2]!, a[3]!);
      else if (c.command === 'bezierCurveTo') p.bezierCurveTo(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!);
      else if (c.command === 'closePath') p.closePath();
    }
    paths.set(key, p);
  }
  return p;
}

const bitmaps = new WeakMap<PdfImage, CanvasImageSource>();
/** Decode the pictures once, so drawing a page can stay synchronous. */
export async function prepareImages(doc: Doc): Promise<void> {
  for (const img of doc.images) {
    if (bitmaps.has(img)) continue;
    if (img.jpeg) bitmaps.set(img, await createImageBitmap(new Blob([img.jpeg as unknown as BlobPart], { type: 'image/jpeg' })));
    else if (img.rgb) {
      const d = new ImageData(img.w, img.h);
      for (let i = 0, p = 0; p < img.w * img.h; p++, i += 4) { d.data[i] = img.rgb[p * 3]!; d.data[i + 1] = img.rgb[p * 3 + 1]!; d.data[i + 2] = img.rgb[p * 3 + 2]!; d.data[i + 3] = img.alpha ? img.alpha[p]! : 255; }
      bitmaps.set(img, await createImageBitmap(d));
    }
  }
}

/** Draw page `n` (from 0) at `scale` canvas pixels per point. */
export function drawPage(cv: HTMLCanvasElement, doc: Doc, n: number, scale: number): void {
  cv.width = Math.round(doc.w * scale);
  cv.height = Math.round(doc.h * scale);
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, doc.w, doc.h);
  const page = doc.pages[n];
  if (!page) return;
  const draw = (op: Op) => {
    switch (op.t) {
      case 'rect':
        if (op.fill) { ctx.fillStyle = op.fill; ctx.fillRect(op.x, op.y, op.w, op.h); }
        if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = op.lw ?? 0.6; ctx.strokeRect(op.x, op.y, op.w, op.h); }
        break;
      case 'line': ctx.strokeStyle = op.color; ctx.lineWidth = op.lw; ctx.beginPath(); ctx.moveTo(op.x1, op.y1); ctx.lineTo(op.x2, op.y2); ctx.stroke(); break;
      case 'dot': ctx.fillStyle = op.color; ctx.beginPath(); ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2); ctx.fill(); break;
      case 'image': { const b = bitmaps.get(op.img); if (b) ctx.drawImage(b, op.x, op.y, op.w, op.h); break; }
      case 'text': {
        const k = op.p.size / op.p.font.upm;
        const s = op.p.shaped;
        ctx.fillStyle = op.color;
        let pen = 0;
        for (let i = 0; i < s.gids.length; i++) {
          ctx.save();
          ctx.translate(op.x + pen + s.dx[i]! * k, op.y - s.dy[i]! * k);
          ctx.transform(1, 0, -op.skew, 1, 0, 0);
          ctx.scale(k, -k);
          ctx.fill(glyphPath(op.p.font, s.gids[i]!));
          ctx.restore();
          pen += s.adv[i]! * k;
        }
        break;
      }
      default: break;
    }
  };
  [...page.bg].sort((a, b) => a.depth - b.depth).forEach(draw);
  page.ops.forEach(draw);
}
