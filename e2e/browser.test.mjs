// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Opens the real web app in a real browser, against a real server:
// sign up, write a note with a table, share it, and watch a second person
// edit it live.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const ROOT = new URL('../', import.meta.url).pathname;
const BIN = process.env.QALAMARK_BIN ?? join(ROOT, 'server/target/debug/qalamark-server');
const PORT = 30000 + Math.floor(Math.random() * 20000);
const URL_ = `http://127.0.0.1:${PORT}/`;
const data = mkdtempSync(join(tmpdir(), 'qalamark-ui-'));
let proc, browser;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  proc = spawn(BIN, [], {
    env: { ...process.env, QALAMARK_DATA: data, QALAMARK_ADDR: `127.0.0.1:${PORT}`, QALAMARK_WEB: join(ROOT, 'app/dist') },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(URL_ + 'api/status')).ok) break; } catch { /* not yet */ }
    await sleep(100);
  }
  browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
});
after(async () => { await browser?.close(); proc?.kill(); });

async function newPage(errors) {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 760 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  return page;
}
async function signIn(page, user, pass) {
  await page.goto(URL_);
  await page.waitForSelector('.login');
  await page.fill('input[autocomplete=username]', user);
  await page.fill('input[type=password]', pass);
  await page.click('button.primary');
  await page.waitForSelector('aside');
}

test('write a note with a table, share it, edit it together', async () => {
  const errors = [];
  const alice = await newPage(errors);
  await signIn(alice, 'alice', 'alice-password');

  // Alice writes a note. The table is calculated by itself.
  await alice.click('aside .actions .primary');
  await alice.waitForSelector('.cm-content');
  await alice.click('.cm-content');
  await alice.keyboard.insertText(
    '# Shopping\n\n- [ ] Tea\n\n| Item | Qty | Price | Total |\n| --- | --- | --- | --- |\n| Tea | 2 | 3.5 |  |\n| Sugar | 1 | 4 |  |\n| Sum |  |  |  |\n<!-- qalamark\nD = B * C\nD4 = SUM(D)\n-->\n\nنص عربي\n',
  );
  await alice.click('.topbar .title');
  await alice.keyboard.press('Tab');
  await alice.waitForFunction(() => document.querySelector('.qt input[data-r="4"][data-c="3"]')?.value === '11', null, { timeout: 8000 });

  // The file on disk is plain Markdown with the results in it.
  await sleep(1500);
  const file = readFileSync(join(data, 'notes/alice/Untitled.md'), 'utf8');
  assert.match(file, /\| Tea +\| 2 +\| 3\.5 +\| 7 +\|/);
  assert.match(file, /<!-- qalamark/);

  // The admin adds Bob (through the API), then shares the note with him.
  const { token } = await (await fetch(URL_ + 'api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'alice-password' }) })).json();
  await fetch(URL_ + 'api/users', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ username: 'bob', password: 'bob-password-1' }) });
  await alice.click('text=Share');
  await alice.waitForSelector('dialog[open]');
  await alice.selectOption('dialog select[dir=ltr]', 'bob');
  await alice.click('dialog button.primary');
  await alice.waitForSelector('dialog .plain li >> text=bob');
  await alice.keyboard.press('Escape');

  // Bob opens it; Alice changes a number in the table; Bob sees the new totals.
  const bob = await newPage(errors);
  await signIn(bob, 'bob', 'bob-password-1');
  await bob.click('aside li button');
  await bob.waitForSelector('.qt');
  const qty = alice.locator('.qt input[data-r="2"][data-c="1"]');
  await qty.click();
  await qty.fill('10');
  await alice.keyboard.press('Tab');
  await bob.waitForFunction(() => document.querySelector('.qt input[data-r="2"][data-c="3"]')?.value === '35', null, { timeout: 8000 });

  // Bob types a line; Alice sees it.
  await bob.locator('.cm-line').last().click();
  await bob.keyboard.press('Control+End');
  await bob.keyboard.insertText('\nHello from Bob');
  await alice.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('Hello from Bob'), null, { timeout: 8000 });

  assert.deepEqual(errors, []);
});

async function staticApp() {
  // A plain file server stands in for GitHub Pages: no API at all.
  const { createServer } = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/json', '.png': 'image/png' };
  const srv = createServer(async (req, res) => {
    const path = new globalThis.URL(req.url, 'http://x').pathname;
    try {
      const body = await readFile(join(ROOT, 'app/dist', path === '/' ? 'index.html' : path));
      res.writeHead(200, { 'content-type': types[path.slice(path.lastIndexOf('.'))] ?? 'text/html' });
      res.end(body);
    } catch { res.writeHead(404); res.end('no'); }
  }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  return { srv, url: `http://127.0.0.1:${srv.address().port}/` };
}

test('without a server the app still works on this device', async () => {
  const { srv, url } = await staticApp();
  const errors = [];
  const page = await newPage(errors);
  await page.goto(url);
  await page.waitForSelector('aside');
  await page.click('aside .actions .primary');
  await page.waitForSelector('.cm-content');
  await page.click('.cm-content');
  await page.keyboard.insertText('# Local note\n\n| a | b |\n| - | - |\n| 2 |  |\n<!-- qalamark\nB = A * 3\n-->\n');
  await page.click('.topbar .title');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.querySelector('.qt input[data-r="2"][data-c="1"]')?.value === '6', null, { timeout: 8000 });
  await sleep(500);
  await page.reload();
  await page.waitForSelector('.qt');
  assert.equal(await page.locator('.qt input[data-r="2"][data-c="1"]').inputValue(), '6');
  assert.deepEqual(errors, []);
  srv.close();
});

test('editing feels right: click anywhere, tables stay tables, links, callouts, undo', async () => {
  const { srv, url } = await staticApp();
  const errors = [];
  const page = await newPage(errors);
  await page.goto(url);
  await page.waitForSelector('aside');
  const newNote = async () => { await page.click('aside .actions .primary'); await page.waitForSelector('.cm-content'); };

  // A note to link to.
  await newNote();
  await page.click('.topbar .title');
  await page.fill('.topbar .title', 'Target');
  await page.keyboard.press('Enter');

  // Second note: click in the EMPTY area (not on a line) and type.
  await newNote();
  await page.mouse.click(700, 520);
  await page.keyboard.insertText('Hello [[Target]] and ==marked== #tag\n\n> [!tip] Remember\n> be kind\n\n');
  await page.keyboard.insertText('| Item | Qty | Price | Total |\n| --- | --- | --- | --- |\n| Tea | 2 | 3.5 |  |\n| Sum |  |  |  |\n<!-- qalamark\nD = B * C\nD3 = SUM(D)\n-->\n\nend');
  await page.waitForSelector('.qt');
  assert.ok(await page.locator('.cm-wikilink').count() >= 1, 'wiki link drawn');
  assert.ok(await page.locator('.cm-highlight').count() >= 1, 'highlight drawn');
  assert.ok(await page.locator('.cm-tag').count() >= 1, 'tag drawn');
  assert.ok(await page.locator('.cm-callout-label').count() >= 1, 'callout drawn');

  // The table stays a grid while you work in it; formula cells show the value again after you leave.
  await page.waitForFunction(() => document.querySelector('.qt input[data-r="3"][data-c="3"]')?.value === '7', null, { timeout: 8000 });
  const total = page.locator('.qt input[data-r="2"][data-c="3"]');
  await total.click();
  assert.match(await total.inputValue(), /^==/, 'formula visible while editing');
  await page.locator('.qt input[data-r="2"][data-c="0"]').click();
  assert.equal(await page.locator('.qt input[data-r="2"][data-c="3"]').inputValue(), '7', 'value back after leaving');
  assert.equal(await page.locator('.qt').count(), 1, 'still a grid');

  // Undo works from inside the table.
  const qty = page.locator('.qt input[data-r="2"][data-c="1"]');
  await qty.click();
  await qty.fill('9');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.querySelector('.qt input[data-r="2"][data-c="3"]')?.value === '31.5');
  await page.locator('.qt input[data-r="2"][data-c="0"]').click();
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => document.querySelector('.qt input[data-r="2"][data-c="1"]')?.value === '2', null, { timeout: 5000 });

  // Delete a row with the buttons under the table (no extra column).
  assert.equal(await page.locator('.qt .qt-tools').count(), 0);
  await page.locator('.qt input[data-r="2"][data-c="0"]').click();
  await page.click('.qt-del >> nth=0');
  await page.waitForFunction(() => document.querySelectorAll('.qt tr').length === 2);

  // Bullets: the cursor ends up after the marker.
  await page.locator('.cm-line', { hasText: 'end' }).click();
  await page.click('.toolbar button[title="Bullet list"]');
  await page.keyboard.insertText('X');
  assert.match(await page.locator('.cm-content').innerText(), /•\s*endX|end.*X/);

  // Backlinks and following a link.
  await page.click('.cm-line >> nth=0', { modifiers: ['Control'], position: { x: 5, y: 5 } }).catch(() => {});
  await page.locator('.cm-wikilink').first().click({ modifiers: ['Control'] });
  await page.waitForFunction(() => document.querySelector('.topbar .title')?.value === 'Target');
  await page.click('.links-wrap button');
  await page.waitForSelector('.links-wrap .menu button');

  assert.deepEqual(errors, []);
  srv.close();
});

test('round 2: folders, templates, properties, MkDocs blocks, pictures, builder, layout', async () => {
  const errors = [];
  const page = await newPage(errors);
  await signIn(page, 'alice', 'alice-password');

  // A folder and a note inside it (menu: new note here).
  await page.click('aside .actions button[title="New folder"]');
  await page.fill('.askbox input', 'Work');
  await page.keyboard.press('Enter');
  await page.waitForSelector('aside li.folder');
  await page.click('aside li.folder .dots', { force: true });
  await page.click('.menu >> text=New note here');
  await page.waitForSelector('.cm-content');
  assert.equal(await page.locator('aside li.folder').count(), 1);
  assert.ok(await page.locator('aside li.row[style*="--depth: 1"]').count() >= 1, 'the note sits under the folder');

  // A ready-made template with plain-words formulas calculates itself.
  await page.click('aside .actions .relative button');
  await page.click('.menu >> text=Expenses with total');
  await page.waitForSelector('.qt');
  for (const [c, v] of [[0, 'Tea'], [1, '3'], [2, '2.5']]) {
    await page.fill(`.qt input[data-r="2"][data-c="${c}"]`, v);
    await page.keyboard.press('Tab');
    await sleep(150);
  }
  await page.click('.topbar .title');
  await page.keyboard.press('Tab');
  try {
    await page.waitForFunction(() => document.querySelector('.qt input[data-r="2"][data-c="3"]')?.value === '7.5', null, { timeout: 8000 });
  } catch (e) {
    console.log('DEBUG', JSON.stringify(await page.evaluate(() => ({ cells: [...document.querySelectorAll('.qt input')].map((i) => i.value), text: document.querySelector('.cm-content').innerText.slice(0, 400), active: document.activeElement?.className }))));
    throw e;
  }
  await page.waitForFunction(() => document.querySelector('.qt input[data-r="4"][data-c="3"]')?.value === '7.5', null, { timeout: 8000 });

  // The formula builder offers column letters.
  await page.click('.qt button[title*="ormula"], .qt .qt-fx');
  await page.waitForSelector('.qt-builder .qt-select');
  assert.match(await page.locator('.qt-builder .qt-preview').innerText(), /^[A-Z] = /);

  // Properties: add tags from the panel; the note text gets the front matter.
  await page.click('.props-head');
  await page.click('.props-quick >> text=tags');
  await page.fill('.props-grid input', 'work, plan');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => /tags:\s*\n\s*- work\s*\n\s*- plan/.test(document.querySelector('.cm-content')?.innerText ?? ''), null, { timeout: 5000 });
  await page.click('.props-head');
  assert.match(await page.locator('.props-summary').innerText(), /#work/);

  // MkDocs blocks render as boxes and tabs.
  await page.click('.cm-line >> nth=-1');
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n\n!!! warning "Careful"\n    Mind the gap.\n\n=== "One"\n    first\n\n=== "Two"\n    second\n\n```py title="a.py"\nprint(1)\n```\n\nend\n');
  await page.click('.cm-line >> nth=-1');
  await page.waitForSelector('.cm-callout-label');
  assert.match(await page.locator('.cm-callout-label').first().innerText(), /Careful/);
  assert.ok((await page.locator('.cm-tab-label').count()) >= 2);
  assert.match(await page.locator('.cm-code-title').first().innerText(), /a\.py/);

  // A pasted picture is uploaded and shown.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  const res = await page.evaluate(async (b64) => {
    const tok = JSON.parse(localStorage.getItem('qm.settings') ?? '{}').token;
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const r = await fetch('/api/images', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'image/png' }, body: bin });
    return r.json();
  }, png.toString('base64'));
  assert.match(res.markdown, /_images\//);
  await page.click('.cm-line >> nth=-1');
  await page.keyboard.insertText('\n' + res.markdown + '\n\nafter\n');
  await page.click('.cm-line >> nth=-1');
  try {
    await page.waitForSelector('.cm-picture img[src^="blob:"]', { timeout: 8000 });
  } catch (e) {
    console.log('DEBUG2', JSON.stringify(await page.evaluate(() => ({ pic: [...document.querySelectorAll('.cm-picture')].map((p) => p.outerHTML), tail: document.querySelector('.cm-content').innerText.slice(-200) }))));
    throw e;
  }

  // Layout settings: text size reaches the table, the page can be centered.
  await page.click('aside header button[aria-label="Settings"]');
  await page.waitForSelector('dialog[open]');
  await page.locator('dialog input[type=range]').first().fill('24');
  const tableFont = await page.evaluate(() => getComputedStyle(document.querySelector('.qt-cell')).fontSize);
  assert.equal(tableFont, '22.8px');
  assert.deepEqual(errors, []);
});
