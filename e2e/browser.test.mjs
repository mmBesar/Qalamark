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
  await alice.fill('dialog input[placeholder=Username]', 'bob');
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

test('without a server the app still works on this device', async () => {
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
  const errors = [];
  const page = await newPage(errors);
  await page.goto(`http://127.0.0.1:${srv.address().port}/`);
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
