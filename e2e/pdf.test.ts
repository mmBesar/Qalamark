import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBody, stripProperties, imageUrls, buildDocument, DEFAULT_PDF } from '../app/src/lib/pdf.ts';

test('properties never reach the page', () => {
  const md = '---\ntitle: Invoice\nremind: 2026-12-01\ntags: [a, b]\n---\n# Invoice 12\n\nTotal: **40**';
  assert.equal(stripProperties(md).startsWith('# Invoice 12'), true);
  const html = renderBody(md);
  assert.ok(!html.includes('remind') && !html.includes('tags'));
  assert.ok(html.includes('<strong>40</strong>'));
});

test('tables, ticks, wikilinks, marks, admonitions and Arabic direction', () => {
  const md = '| الصنف | السعر |\n|---|--:|\n| قلم | 5 |\n\n- [x] done\n- [ ] todo\n\nSee [[Other note]] and ==this==.\n\n!!! warning "Careful"\n    Do not **skip** it.\n\nمرحبا بالعالم\n';
  const html = renderBody(md);
  assert.ok(html.includes('<table dir="auto">'), 'table direction follows its text');
  assert.ok(html.includes('☑') && html.includes('☐'));
  assert.ok(html.includes('<span class="wl">Other note</span>'));
  assert.ok(html.includes('<mark>this</mark>'));
  assert.ok(/<div class="admon warning"[^>]*>\s*<p dir="auto" class="admon-title">Careful<\/p>|<p class="admon-title"[^>]*>Careful/.test(html) || html.includes('admon-title'), 'admonition');
  assert.ok(html.includes('<strong>skip</strong>'), 'markdown inside the box');
  assert.ok(html.includes('<p dir="auto">مرحبا بالعالم</p>'));
});

test('pictures: found ones are inlined, missing ones are named; page document carries the options', () => {
  const md = '![logo](_images/logo.png)\n\n![gone](_images/gone.png)';
  assert.deepEqual(imageUrls(md), ['_images/logo.png', '_images/gone.png']);
  const html = renderBody(md, { '_images/logo.png': 'data:image/png;base64,AAAA' });
  assert.ok(html.includes('src="data:image/png;base64,AAAA"'));
  assert.ok(html.includes('<span class="nopic">gone</span>'));
  const doc = buildDocument(html, 'My <title>', { ...DEFAULT_PDF, paper: 'Letter', landscape: true, title: true }, '', { text: 'sans-serif', code: 'monospace' });
  assert.ok(doc.includes('size: Letter landscape'));
  assert.ok(doc.includes('My &lt;title&gt;'));
  assert.ok(doc.includes('class="doc-title"'));
});
