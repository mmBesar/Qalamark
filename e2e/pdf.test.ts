import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutDoc, emitPdf, stripProperties } from '../app/src/pdf/index.ts';
import { DEFAULT_PDF, cleanOptions } from '../app/src/pdf/options.ts';
import type { Op } from '../app/src/pdf/flow.ts';

const dir = new URL('../app/src/pdf/fonts/', import.meta.url);
const env = { fonts: async (n: string) => new Uint8Array(readFileSync(new URL(n + '.ttf', dir))), now: new Date(2026, 10, 26, 9, 5) };
const meta = { title: 'Invoice 12', file: 'Invoice 12.md' };
const texts = (ops: Op[]) => ops.filter((o) => o.t === 'text') as Extract<Op, { t: 'text' }>[];
const said = (d: Awaited<ReturnType<typeof layoutDoc>>, page = 0) => texts(d.pages[page]!.ops).map((o) => o.p.text).join(' ');

test('properties never reach the page', async () => {
  const md = '---\ntitle: Invoice\nremind: 2026-12-01\n---\n# Invoice 12\n\nTotal: **40**';
  assert.ok(stripProperties(md).startsWith('# Invoice 12'));
  const d = await layoutDoc(md, meta, { ...DEFAULT_PDF, footerL: '', footerR: '' }, env);
  assert.ok(!said(d).includes('remind') && said(d).includes('Total'));
});

test('a real PDF comes out: header, pages, fonts, links', async () => {
  const md = '# Hello\n\nSee [the site](https://example.com) and [[Other]].\n\n- [x] done\n- [ ] todo\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
  const d = await layoutDoc(md, meta, DEFAULT_PDF, env);
  const bytes = await emitPdf(d);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 8));
  const tail = new TextDecoder('latin1').decode(bytes.subarray(bytes.length - 6));
  assert.ok(head.startsWith('%PDF-1.7') && tail.includes('%%EOF'));
  assert.equal(d.pages.length, 1);
  assert.ok(d.pages[0]!.ops.some((o) => o.t === 'link' && o.url === 'https://example.com'), 'tappable link');
  assert.ok(new TextDecoder('latin1').decode(bytes).includes('/Subtype /Link'));
});

test('Arabic: right to left, joined, diacritics sit on their letters, lines start at the right edge', async () => {
  const md = 'سَيِّدُ الِاسْتِغْفَارِ\n\nthe date is 2026 and سلام';
  const d = await layoutDoc(md, meta, { ...DEFAULT_PDF, footerL: '', footerR: '' }, env);
  const ops = texts(d.pages[0]!.ops);
  const ar = ops.filter((o) => o.p.font.kind === 'arabic');
  assert.ok(ar.length > 0);
  // a diacritic has no width of its own and is lifted onto its letter
  const marks = ar.flatMap((o) => o.p.shaped.gids.map((_g, i) => ({ adv: o.p.shaped.adv[i]!, dy: o.p.shaped.dy[i]! }))).filter((g) => g.adv === 0);
  assert.ok(marks.length >= 3 && marks.some((m) => m.dy > 0), 'marks are positioned');
  // the Arabic line ends at the right margin
  const right = d.w - DEFAULT_PDF.margin * (72 / 25.4);
  const end = Math.max(...ar.slice(0, 3).map((o) => o.x + o.p.w));
  assert.ok(Math.abs(end - right) < 1, 'right aligned: ' + end + ' vs ' + right);
  // the English line stays at the left margin
  const en = ops.find((o) => o.p.text === 'the')!;
  assert.ok(Math.abs(en.x - DEFAULT_PDF.margin * (72 / 25.4)) < 1);
});

test('fit on one page shrinks a long note; without it the note takes several pages', async () => {
  const md = Array.from({ length: 90 }, (_v, i) => `Line ${i} of a long note that goes on.`).join('\n\n');
  const many = await layoutDoc(md, meta, DEFAULT_PDF, env);
  assert.ok(many.pages.length > 1);
  const one = await layoutDoc(md, meta, { ...DEFAULT_PDF, fitOne: true }, env);
  assert.equal(one.pages.length, 1);
  assert.ok(one.scale < 1 && one.scale > 0.2);
});

test('header and footer: words in braces are filled in, on every page', async () => {
  const md = Array.from({ length: 120 }, (_v, i) => `Paragraph ${i}`).join('\n\n');
  const d = await layoutDoc(md, meta, { ...DEFAULT_PDF, headerC: '{title}', headerR: '{date} {time}', fileName: true, pageNumbers: true }, env);
  assert.ok(d.pages.length >= 2);
  const n = d.pages.length;
  for (let i = 0; i < n; i++) {
    const s = said(d, i);
    assert.ok(s.includes('Invoice') && s.includes('Invoice 12.md'.split(' ')[0]!), 'title and file name');
    assert.ok(s.includes('2026-11-26') && s.includes('09:05'), 'date and time');
    assert.ok(s.includes(String(i + 1)) && s.includes(String(n)), 'page numbers');
  }
});

test('links: blue like the web, or black with a line; the address can follow the words', async () => {
  const md = 'Go to [here](https://example.com/x).';
  const link = (d: Awaited<ReturnType<typeof layoutDoc>>) => texts(d.pages[0]!.ops).find((o) => o.p.text === 'here')!;
  const blue = await layoutDoc(md, meta, DEFAULT_PDF, env);
  assert.notEqual(link(blue).color, '#111111');
  const black = await layoutDoc(md, meta, { ...DEFAULT_PDF, linkColor: 'black' }, env);
  assert.equal(link(black).color, '#111111');
  assert.ok(black.pages[0]!.ops.some((o) => o.t === 'line'), 'underlined');
  const url = await layoutDoc(md, meta, { ...DEFAULT_PDF, linkShowUrl: true }, env);
  assert.ok(said(url).includes('example.com'));
});

test('plain mode drops tinted boxes; callouts, quotes, code, checkboxes and legacy boxes all lay out', async () => {
  const md = '> [!WARNING] Careful\n> mind the gap\n\n!!! tip "Hint"\n    do it\n\n```js\nconst a = 1;\n```\n\n- [x] ticked\n';
  const tint = await layoutDoc(md, meta, DEFAULT_PDF, env);
  const plain = await layoutDoc(md, meta, { ...DEFAULT_PDF, plain: true }, env);
  const fills = (d: typeof tint) => d.pages[0]!.bg.filter((b) => b.t === 'rect' && b.fill && b.fill !== '#888888').length;
  assert.ok(fills(tint) > fills(plain));
  const s = said(tint);
  assert.ok(s.includes('Careful') && s.includes('Hint') && s.includes('const') && s.includes('ticked'));
});

test('old option files still load, and nonsense is put right', () => {
  const o = cleanOptions({ paper: 'Letter', margin: 'wide', size: 'large', pageNumbers: false, junk: 1 });
  assert.equal(o.paper, 'Letter'); assert.equal(o.margin, 28); assert.equal(o.size, 14); assert.equal(o.footerR, '');
  assert.deepEqual(cleanOptions(null), DEFAULT_PDF);
  assert.equal(cleanOptions({ margin: 900 }).margin, 50);
});

test('no footer unless asked: the file name and the page numbers are two switches', async () => {
  const md = Array.from({ length: 120 }, (_v, i) => `Paragraph ${i}`).join('\n\n');
  const off = await layoutDoc(md, meta, DEFAULT_PDF, env);
  assert.ok(!said(off, 0).includes('Invoice 12'), 'nothing at the bottom by default');
  const names = await layoutDoc(md, meta, { ...DEFAULT_PDF, fileName: true }, env);
  assert.ok(said(names, 0).includes('Invoice 12'));
  assert.ok(!said(names, 0).includes(' / '), 'no page numbers');
  const mine = await layoutDoc(md, meta, { ...DEFAULT_PDF, fileName: true, footerL: 'Mine' }, env);
  assert.ok(said(mine, 0).includes('Mine') && !said(mine, 0).includes('Invoice 12'), 'typed text wins');
  const old = cleanOptions({ footerL: '{file}', footerR: '{page} / {pages}' });
  assert.ok(old.fileName && old.pageNumbers && old.footerL === '' && old.footerR === '');
});
