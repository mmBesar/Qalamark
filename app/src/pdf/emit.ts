// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The PDF file itself, written by hand: text as real glyphs of embedded font subsets (with the letters written out
// again so search and copy give the right Arabic), vectors, pictures, and links you can tap.

import type { FontRef } from './fonts.ts';
import type { Doc, Op, PdfImage } from './flow.ts';

const enc = new TextEncoder();
const hex2 = (n: number) => n.toString(16).padStart(2, '0');
const hex4 = (n: number) => n.toString(16).padStart(4, '0');
const num = (n: number) => (Math.round(n * 1000) / 1000).toString();

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const w = cs.writable.getWriter();
  void w.write(data as unknown as BufferSource);
  void w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
const colour = (c: string, stroke = false): string => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  const v = m ? parseInt(m[1]!, 16) : 0;
  return `${num(((v >> 16) & 255) / 255)} ${num(((v >> 8) & 255) / 255)} ${num((v & 255) / 255)} ${stroke ? 'RG' : 'rg'}`;
};
const utf16 = (s: string): string => '<FEFF' + Array.from({ length: s.length }, (_, i) => hex4(s.charCodeAt(i))).join('') + '>';
const pdfStr = (s: string): string => '(' + s.replace(/[\\()]/g, (c) => '\\' + c).replace(/[^\x20-\x7e]/g, (c) => '%' + Array.from(enc.encode(c)).map(hex2).join('')) + ')';

class Writer {
  private chunks: Uint8Array[] = [];
  private len = 0;
  offsets: number[] = [];
  count = 0;
  constructor() { this.raw('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'); }
  raw(s: string | Uint8Array): void { const b = typeof s === 'string' ? Uint8Array.from(s, (c) => c.charCodeAt(0) & 255) : s; this.chunks.push(b); this.len += b.length; }
  alloc(): number { return ++this.count; }
  put(id: number, body: string, stream?: Uint8Array): void {
    this.offsets[id] = this.len;
    if (stream) { this.raw(`${id} 0 obj\n<< ${body} /Length ${stream.length} >>\nstream\n`); this.raw(stream); this.raw('\nendstream\nendobj\n'); }
    else this.raw(`${id} 0 obj\n${body}\nendobj\n`);
  }
  finish(root: number, info: number): Uint8Array {
    const at = this.len;
    let x = `xref\n0 ${this.count + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= this.count; i++) x += `${String(this.offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
    x += `trailer\n<< /Size ${this.count + 1} /Root ${root} 0 R /Info ${info} 0 R >>\nstartxref\n${at}\n%%EOF\n`;
    this.raw(x);
    const out = new Uint8Array(this.len);
    let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    return out;
  }
}

interface Embedded { ref: number; name: string; map: Map<number, number> }

export async function emitPdf(doc: Doc): Promise<Uint8Array> {
  const w = new Writer();
  const catalog = w.alloc(), pagesObj = w.alloc(), info = w.alloc();
  // fonts: which glyphs each face draws
  const used = new Map<FontRef, Set<number>>();
  for (const pg of doc.pages) for (const op of pg.ops) if (op.t === 'text') { let s = used.get(op.p.font); if (!s) used.set(op.p.font, (s = new Set())); for (const g of op.p.shaped.gids) s.add(g); }
  const fonts = new Map<FontRef, Embedded>();
  let fi = 0;
  for (const [ref, gids] of used) {
    const sub = ref.font.createSubset();
    const map = new Map<number, number>();
    const uni = new Map<number, number[]>();
    for (const g of [...gids].sort((a, b) => a - b)) { const glyph = ref.font.getGlyph(g); const n = sub.includeGlyph(glyph); map.set(g, n); uni.set(n, glyph.codePoints ?? []); }
    const raw = sub.encode();
    const data = raw instanceof Uint8Array ? raw : new Uint8Array((raw as { buffer: ArrayBuffer }).buffer);
    const file = w.alloc(), desc = w.alloc(), cid = w.alloc(), type0 = w.alloc(), tou = w.alloc();
    const comp = await deflate(data);
    w.put(file, `/Filter /FlateDecode /Length1 ${data.length}`, comp);
    const k = 1000 / ref.upm;
    const bb = ref.font.bbox;
    const tag = String.fromCharCode(65 + (fi % 26)).repeat(6);
    const psName = `${tag}+${(ref.font.postscriptName || 'Font').replace(/[^A-Za-z0-9-]/g, '')}`;
    w.put(desc, `<< /Type /FontDescriptor /FontName /${psName} /Flags 4 /FontBBox [${[bb.minX, bb.minY, bb.maxX, bb.maxY].map((v) => Math.round(v * k)).join(' ')}] /ItalicAngle 0 /Ascent ${Math.round(ref.asc * k)} /Descent ${-Math.round(ref.desc * k)} /CapHeight ${Math.round((ref.font.capHeight || ref.asc * 0.7) * k)} /StemV 80 /FontFile2 ${file} 0 R >>`);
    const widths = [...map.entries()].sort((a, b) => a[1] - b[1]).map(([old, nw]) => `${nw} [${Math.round(ref.font.getGlyph(old).advanceWidth * k)}]`).join(' ');
    w.put(cid, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${psName} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /DW 1000 /W [${widths}] /CIDToGIDMap /Identity >>`);
    w.put(type0, `<< /Type /Font /Subtype /Type0 /BaseFont /${psName} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tou} 0 R >>`);
    const pairs = [...uni.entries()].filter(([, cps]) => cps.length).sort((a, b) => a[0] - b[0]);
    let cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n';
    for (let i = 0; i < pairs.length; i += 100) {
      const part = pairs.slice(i, i + 100);
      cmap += `${part.length} beginbfchar\n` + part.map(([g, cps]) => `<${hex4(g)}> <${cps.map((c) => (c > 0xffff ? hex4(0xd800 + ((c - 0x10000) >> 10)) + hex4(0xdc00 + ((c - 0x10000) & 0x3ff)) : hex4(c))).join('')}>`).join('\n') + '\nendbfchar\n';
    }
    cmap += 'endcmap CMapName currentdict /CMap defineresource pop end end';
    w.put(tou, '/Filter /FlateDecode', await deflate(enc.encode(cmap)));
    fonts.set(ref, { ref: type0, name: `F${++fi}`, map });
  }
  // pictures
  const imgObj = new Map<PdfImage, { id: number; name: string }>();
  let ii = 0;
  for (const img of doc.images) {
    const id = w.alloc();
    const name = `Im${++ii}`;
    if (img.jpeg) w.put(id, `/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, img.jpeg);
    else {
      let smask = '';
      if (img.alpha) { const sid = w.alloc(); w.put(sid, `/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, await deflate(img.alpha)); smask = ` /SMask ${sid} 0 R`; }
      w.put(id, `/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${smask}`, await deflate(img.rgb ?? new Uint8Array(img.w * img.h * 3)));
    }
    imgObj.set(img, { id, name });
  }
  // pages
  const pageIds: number[] = [];
  const H = doc.h;
  for (const pg of doc.pages) {
    let c = '';
    const annots: number[] = [];
    const draw = (op: Op) => {
      switch (op.t) {
        case 'rect':
          if (op.fill) c += `${colour(op.fill)} ${num(op.x)} ${num(H - op.y - op.h)} ${num(op.w)} ${num(op.h)} re f\n`;
          if (op.stroke) c += `${colour(op.stroke, true)} ${num(op.lw ?? 0.6)} w ${num(op.x)} ${num(H - op.y - op.h)} ${num(op.w)} ${num(op.h)} re S\n`;
          break;
        case 'line': c += `${colour(op.color, true)} ${num(op.lw)} w ${num(op.x1)} ${num(H - op.y1)} m ${num(op.x2)} ${num(H - op.y2)} l S\n`; break;
        case 'dot': {
          const k = 0.5523 * op.r, x = op.x, y = H - op.y, r = op.r;
          c += `${colour(op.color)} ${num(x + r)} ${num(y)} m ${num(x + r)} ${num(y + k)} ${num(x + k)} ${num(y + r)} ${num(x)} ${num(y + r)} c ${num(x - k)} ${num(y + r)} ${num(x - r)} ${num(y + k)} ${num(x - r)} ${num(y)} c ${num(x - r)} ${num(y - k)} ${num(x - k)} ${num(y - r)} ${num(x)} ${num(y - r)} c ${num(x + k)} ${num(y - r)} ${num(x + r)} ${num(y - k)} ${num(x + r)} ${num(y)} c f\n`;
          break;
        }
        case 'image': { const im = imgObj.get(op.img); if (im) c += `q ${num(op.w)} 0 0 ${num(op.h)} ${num(op.x)} ${num(H - op.y - op.h)} cm /${im.name} Do Q\n`; break; }
        case 'text': {
          const f = fonts.get(op.p.font);
          if (!f) break;
          const k = op.p.size / op.p.font.upm;
          c += `/Span << /ActualText ${utf16(op.p.text)} >> BDC\nBT ${colour(op.color)} /${f.name} ${num(op.p.size)} Tf\n`;
          let pen = 0;
          const s = op.p.shaped;
          for (let i = 0; i < s.gids.length; i++) {
            const gx = op.x + pen + s.dx[i]! * k, gy = H - (op.y - s.dy[i]! * k);
            c += `1 0 ${num(op.skew)} 1 ${num(gx)} ${num(gy)} Tm <${hex4(f.map.get(s.gids[i]!) ?? 0)}> Tj\n`;
            pen += s.adv[i]! * k;
          }
          c += 'ET\nEMC\n';
          break;
        }
        case 'link': { const id = w.alloc(); w.put(id, `<< /Type /Annot /Subtype /Link /Rect [${num(op.x)} ${num(H - op.y - op.h)} ${num(op.x + op.w)} ${num(H - op.y)}] /Border [0 0 0] /A << /S /URI /URI ${pdfStr(op.url)} >> >>`); annots.push(id); break; }
      }
    };
    [...pg.bg].sort((a, b) => a.depth - b.depth).forEach(draw);
    pg.ops.forEach(draw);
    const content = w.alloc(), page = w.alloc();
    w.put(content, '/Filter /FlateDecode', await deflate(enc.encode(c)));
    const fontRes = [...fonts.values()].map((f) => `/${f.name} ${f.ref} 0 R`).join(' ');
    const imRes = [...imgObj.values()].map((i) => `/${i.name} ${i.id} 0 R`).join(' ');
    w.put(page, `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${num(doc.w)} ${num(doc.h)}] /Contents ${content} 0 R /Resources << /Font << ${fontRes} >> /XObject << ${imRes} >> >>${annots.length ? ` /Annots [${annots.map((a) => `${a} 0 R`).join(' ')}]` : ''} >>`);
    pageIds.push(page);
  }
  w.put(pagesObj, `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  w.put(catalog, `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  w.put(info, `<< /Title ${utf16(doc.title)} /Producer (Qalamark) /Creator (Qalamark) >>`);
  return w.finish(catalog, info);
}
