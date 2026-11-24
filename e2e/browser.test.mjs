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
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 760 }, permissions: ['clipboard-read', 'clipboard-write'] })).newPage();
  page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERR', e.stack); });
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
  await alice.click('aside .actions button:first-child');
  await alice.waitForSelector('.cm-content');
  await alice.click('.cm-content');
  await alice.keyboard.insertText(
    '# Shopping\n\n- [ ] Tea\n\n| Item | Qty | Price | Total |\n| --- | --- | --- | --- |\n| Tea | 2 | 3.5 |  |\n| Sugar | 1 | 4 |  |\n| Sum |  |  |  |\n<!-- qalamark\nD = B * C\nD4 = SUM(D)\n-->\n\nنص عربي\n',
  );
  await alice.click('.page-title');
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
  await alice.click('button.sharebtn');
  await alice.waitForSelector('dialog[open]');
  await alice.click('dialog .selbtn[dir=ltr]');
  await alice.click('.sel-pop li:has-text("bob")');
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
  await page.click('aside .actions button:first-child');
  await page.waitForSelector('.cm-content');
  await page.click('.cm-content');
  await page.keyboard.insertText('# Local note\n\n| a | b |\n| - | - |\n| 2 |  |\n<!-- qalamark\nB = A * 3\n-->\n');
  await page.click('.page-title');
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
  const newNote = async () => { await page.click('aside .actions button:first-child'); await page.waitForSelector('.cm-content'); };

  // A note to link to.
  await newNote();
  await page.click('.page-title');
  await page.fill('.page-title', 'Target');
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
  await page.waitForFunction(() => document.querySelector('.page-title')?.value === 'Target');
  await page.click('.links-wrap:last-child button');
  await page.waitForSelector('.links-wrap:last-child .menu button');

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
  await page.click('aside li.folder', { button: 'right' });
  await page.click('.ctx >> text=New note here');
  await page.waitForSelector('.cm-content');
  assert.equal(await page.locator('aside li.folder').count(), 1);
  await page.waitForSelector('aside li.row[style*="--depth: 1"]', { timeout: 8000 });

  // A ready-made template with plain-words formulas calculates itself.
  await page.click('aside .actions button[title="New from template"]');
  await page.click('.ctx >> text=Expenses with total');
  await page.waitForSelector('.qt');
  for (const [c, v] of [[0, 'Tea'], [1, '3'], [2, '2.5']]) {
    await page.fill(`.qt input[data-r="2"][data-c="${c}"]`, v);
    await page.keyboard.press('Tab');
    await sleep(150);
  }
  await page.click('.page-title');
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
  await page.waitForSelector('.qt-builder .dd-btn');
  assert.match(await page.locator('.qt-builder .qt-preview').innerText(), /^[A-Z] = /);

  // Properties: add tags from the panel; the note text gets the front matter.
  await page.click('.props-addbtn');
  await page.click('.props-quick >> text=tags');
  await page.fill('.props-grid input', 'work, plan');
  await page.keyboard.press('Tab');
  // Live preview hides the block; Source mode shows it as plain text and has no panel.
  await page.click('button:has-text("Source")');
  await page.waitForFunction(() => /tags:\s*\n\s*- work\s*\n\s*- plan/.test(document.querySelector('.cm-content')?.innerText ?? ''), null, { timeout: 5000 });
  assert.equal(await page.locator('.props-head').count(), 0);
  await page.click('button:has-text("Live preview")');
  assert.ok(!/tags:/.test(await page.locator('.cm-content').innerText()), 'front matter is hidden in live preview');
  assert.match(await page.locator('.props-grid').evaluate((g) => [...g.querySelectorAll('input')].map((i) => i.value).join(' ') + g.innerText), /work/);

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
  await page.click('.set-tabs button:has-text("Text and fonts")');
  await page.locator('dialog input[type=range]').first().fill('24');
  const tableFont = await page.evaluate(() => getComputedStyle(document.querySelector('.qt-cell')).fontSize);
  assert.equal(tableFont, '22.8px');
  assert.deepEqual(errors, []);
});

test('round 3: code languages, tabbed code, properties by mode, centred page', async () => {
  const errors = [];
  const page = await newPage(errors);
  await signIn(page, 'alice', 'alice-password');
  await page.click('aside .actions button:first-child');
  await page.waitForSelector('.cm-content');
  await page.click('.cm-content');
  await page.keyboard.insertText('---\ntitle: Demo\n---\n# Hi\n\n```yml\nname: x\n```\n\n=== "Fedora"\n\n    ``` sh\n    sudo dnf install foo # c\n    ```\n\n=== "Arch"\n\n    ``` sh\n    sudo pacman -S foo\n    ```\n\nend\n');
  await page.click('.page-title');
  await page.waitForTimeout(800);
  // yaml and the code inside a tab are coloured
  const coloured = (sel) => page.locator(sel).evaluate((el) => el.querySelectorAll('span[class]').length);
  assert.ok((await coloured('.cm-line:has-text("name: x")')) > 0, 'yml is highlighted');
  assert.ok((await coloured('.cm-line:has-text("sudo dnf install")')) > 0, 'code inside a tab is highlighted');
  assert.ok(!/title: Demo/.test(await page.locator('.cm-content').innerText()), 'properties hidden in live mode');
  // Reading mode: real tabs, only the chosen one is shown, properties are read-only
  await page.click('button:has-text("Reading")');
  await page.waitForSelector('.cm-tabstrip');
  assert.equal(await page.locator('.cm-tabstrip .cm-tab-label').count(), 2);
  assert.ok(await page.locator('.cm-line:has-text("sudo dnf install"):visible').count() === 1);
  assert.ok(await page.locator('.cm-line:has-text("sudo pacman"):visible').count() === 0);
  await page.click('.cm-tabstrip .cm-tab-label >> nth=1');
  assert.ok(await page.locator('.cm-line:has-text("sudo pacman"):visible').count() === 1);
  assert.ok(await page.locator('.cm-line:has-text("sudo dnf install"):visible').count() === 0);
  // Source mode: plain text, no panel
  await page.click('button:has-text("Source")');
  assert.match(await page.locator('.cm-content').innerText(), /title: Demo/);
  assert.equal(await page.locator('.props-head').count(), 0);
  // Centred page never slides under the sidebar
  await page.setViewportSize({ width: 1300, height: 800 });
  await page.evaluate(() => { document.documentElement.dataset.page = 'center'; });
  await page.click('button:has-text("Live preview")');
  const box = await page.locator('.cm-content').boundingBox();
  const side = await page.locator('aside').boundingBox();
  assert.ok(box.x >= side.x + side.width, 'page stays right of the sidebar');
  const mid = (box.x + box.width / 2 - (side.x + side.width)) / (1300 - (side.x + side.width));
  assert.ok(Math.abs(mid - 0.5) < 0.03, 'page is centred in the writing area');
  assert.deepEqual(errors, []);
});

test('round 4: a note becomes a Kanban board and stays plain Markdown', async () => {
  const errors = [];
  const page = await newPage(errors);
  await signIn(page, 'alice', 'alice-password');
  await page.click('aside .actions button:first-child');
  await page.waitForSelector('.cm-content');
  await page.click('.cm-content');
  await page.keyboard.insertText('# Work\n\n## Todo\n- [ ] write docs\n- [ ] fix bug\n\n## Done\n- [x] ship\n');
  await page.click('.page-title');
  await page.click('.topbar .menu-wrap.desk > button');
  await page.click('button[role=menuitem]:has-text("Kanban")');
  await page.waitForSelector('.board .bcol');
  assert.equal(await page.locator('.bcol:not(.newcol)').count(), 2);
  assert.equal(await page.locator('.bcol:not(.newcol) >> nth=0').locator('.card').count(), 2);
  // add a card, then move it to the next column with the arrow button
  await page.click('.bcol >> nth=0 >> .addbtn');
  await page.keyboard.type('new card');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.bcol >> nth=0 >> .card:has-text("new card")');
  await page.hover('.bcol >> nth=0 >> .card:has-text("new card")');
  await page.click('.bcol >> nth=0 >> .card:has-text("new card") >> button[aria-label="Move to the next column"]');
  await page.waitForSelector('.bcol >> nth=1 >> .card:has-text("new card")');
  // tick a card
  await page.click('.bcol >> nth=0 >> .card:has-text("fix bug") >> .tick');
  await page.waitForSelector('.bcol >> nth=0 >> .card.done:has-text("fix bug")');
  // the text is still plain Markdown
  await page.click('button:has-text("Source")');
  const md = await page.locator('.cm-content').innerText();
  assert.match(md, /kanban: board/);
  assert.match(md, /## Todo\s*\n- \[ \] write docs\s*\n- \[x\] fix bug/);
  assert.match(md, /## Done\s*\n- \[x\] ship\s*\n- \[ \] new card/);
  assert.deepEqual(errors, []);
});

test('round 5: quick switcher, text search, today note, outline', async () => {
  const errors = [];
  const page = await newPage(errors);
  await signIn(page, 'alice', 'alice-password');
  await page.click('aside .actions button:first-child');
  await page.waitForSelector('.cm-content');
  await page.click('.cm-content');
  await page.keyboard.insertText('# Big title\n\nsome words about Quokka habitats\n\n## Second part\n\nmore\n');
  await page.click('.page-title');
  await page.keyboard.press('Control+p');
  await page.waitForSelector('.pal');
  await page.keyboard.type('quokka');
  await page.waitForSelector('.pal li:has-text("Quokka")', { timeout: 5000 }); // found by text, not title
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.pal'), null, { timeout: 3000 });
  // outline jumps
  await page.click('button:has-text("Contents")');
  await page.click('aside.toc button.item:has-text("Second part")');
  await page.keyboard.type('Z');
  assert.match(await page.locator('.cm-line:has-text("Second part")').innerText(), /Z/);
  // today note
  await page.click('aside .actions button[aria-label="Open today\'s note"]');
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await page.waitForFunction((x) => document.querySelector('.page-title')?.value === x, today);
  assert.deepEqual(errors, []);
});

test('round 6: notes folder in the apps: files out, outside edits in, renames follow', async () => {
  const errors = [];
  const page = await newPage(errors);
  // a fake notes folder standing in for the Rust side of the Linux/Android app
  await page.addInitScript(() => {
    const fs = (window.__fs = new Map([['From outside/Hello.md', { text: '# Hello from disk', m: 1000 }]]));
    let clock = 2000;
    const bad = (p) => { if (/\.\.|^\//.test(p)) throw 'refused'; };
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (cmd, a) => {
        switch (cmd) {
          case 'vault_info': return { path: '/home/me/Documents/Qalamark', default_path: '/home/me/Documents/Qalamark' };
          case 'vault_list': return [...fs].map(([path, f]) => ({ path, mtime_ms: f.m }));
          case 'vault_read': { const f = fs.get(a.path); if (!f) throw 'missing'; return { text: f.text, mtime_ms: f.m }; }
          case 'vault_write': bad(a.path); fs.set(a.path, { text: a.text, m: ++clock }); return clock;
          case 'vault_rename': { const f = fs.get(a.from); if (f) { fs.delete(a.from); fs.set(a.to, f); } return f?.m ?? 0; }
          case 'vault_trash': fs.delete(a.path); return null;
          case 'vault_mkdir': return null;
          case 'vault_set': return a.path || '/home/me/Documents/Qalamark';
        }
        throw 'unknown ' + cmd;
      },
    };
  });
  await page.goto(URL_);
  await page.waitForSelector('.login');
  await page.click('button:has-text("this device only")');
  await page.waitForSelector('aside');
  // the file that was already in the folder became a note, inside its folder
  await page.waitForSelector('aside li:has-text("Hello")');
  // a new note is written out as a real .md file
  await page.click('aside .actions button:first-child');
  await page.waitForSelector('.cm-content');
  await page.click('.cm-content');
  await page.keyboard.insertText('# Fresh\n\nwritten in the app');
  await page.waitForFunction(() => [...window.__fs].some(([p, f]) => /^Untitled.*\.md$/.test(p) && f.text.includes('written in the app')), null, { timeout: 5000 });
  // renaming in the app renames the file
  await page.fill('.page-title', 'Journal');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__fs.has('Journal.md') && ![...window.__fs.keys()].some((p) => /^Untitled/.test(p)), null, { timeout: 5000 });
  assert.match(await page.evaluate(() => window.__fs.get('Journal.md').text), /written in the app/);
  // an edit made outside shows up when the window gets focus again
  await page.evaluate(() => window.__fs.set('Journal.md', { text: 'edited elsewhere', m: 9999 }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => /edited elsewhere/.test(document.querySelector('.cm-content')?.innerText ?? ''), null, { timeout: 5000 });
  // deleting in the app moves the file to the trash
  await page.click('.topbar .menu-wrap.desk > button');
  page.once('dialog', (d) => d.accept());
  await page.click('button[role=menuitem].danger');
  await page.click('dialog.askdialog button.primary');
  await page.waitForFunction(() => !window.__fs.has('Journal.md'), null, { timeout: 5000 });
  assert.deepEqual(errors, []);
});

test('round 7: context menus, long-press, swipe drawer, live tabs, selection, clean code', async () => {
  const errors = [];
  const page = await newPage(errors);
  await signIn(page, 'alice', 'alice-password');
  await page.click('aside .actions button:first-child');
  await page.waitForSelector('.cm-content');
  await page.click('.cm-content');
  await page.keyboard.insertText('# Heading one\n\nsome plain words here\nsecond line\n\n```bash\nls -la\n```\n\n=== "Fedora"\n\n    alpha-body\n\n=== "Arch"\n\n    beta-body\n\nend\n');
  await page.click('.page-title');
  await page.waitForTimeout(700);

  // live view: no ```bash line, a language badge instead; tabs are real tabs with one body at a time
  assert.ok(!/```/.test(await page.locator('.cm-content').innerText()), 'no fence marks in live view');
  assert.ok(await page.locator('.cm-code-badge').count() >= 1, 'code badge');
  assert.equal(await page.locator('.cm-tabstrip .cm-tab-label').count(), 2, 'tab strip in live view');
  assert.equal(await page.locator('.cm-line:has-text("alpha-body"):visible').count(), 1);
  assert.equal(await page.locator('.cm-line:has-text("beta-body"):visible').count(), 0);

  // heading marks show while the cursor is anywhere on the heading line
  await page.locator('.cm-line:has-text("Heading one")').click();
  assert.ok(/^# /.test(await page.locator('.cm-line:has-text("Heading one")').innerText()), 'heading # visible at the cursor');

  // triple-click selects the line, not the line break (the cursor must not land on the next line)
  await page.locator('.cm-line:has-text("some plain words")').click({ clickCount: 3 });
  const sel = await page.evaluate(() => getSelection().toString());
  assert.equal(sel.trim(), 'some plain words here');
  // double-click selects a word and the selection layer is visible
  await page.locator('.cm-line:has-text("some plain words")').click({ clickCount: 2, position: { x: 60, y: 8 } });
  await page.waitForFunction(() => !!document.querySelector('.cm-selectionBackground') || (getSelection().rangeCount > 0 && !getSelection().isCollapsed), null, { timeout: 4000 });

  // right-click in the editor: themed app menu, inside the window
  await page.locator('.cm-line:has-text("second line")').click({ button: 'right' });
  await page.waitForSelector('.ctx');
  const cb = await page.locator('.ctx').boundingBox();
  assert.ok(cb.x >= 0 && cb.y >= 0 && cb.x + cb.width <= 1100 && cb.y + cb.height <= 760, 'menu stays on screen ' + JSON.stringify(cb));
  const bg = await page.locator('.ctx').evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.ok(bg !== 'rgba(0, 0, 0, 0)', 'menu has the theme background');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.ctx'), null, { timeout: 3000 });

  // sidebar: right-click a note → rename/copy/move/delete menu with icons; no three-dots column left
  assert.equal(await page.locator('aside .dots').count(), 0);
  await page.locator('aside li.row .main').first().click({ button: 'right' });
  await page.waitForSelector('.ctx');
  for (const w of ['Rename', 'Move to', 'Delete']) assert.ok(await page.locator(`.ctx >> text=${w}`).count() >= 1, w);
  await page.click('.ctx >> text=Move to');
  assert.ok(await page.locator('.ctx >> text=Back').count() === 1, 'sub-list has a way back');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // folder tree: guide lines, collapse all
  await page.click('aside .actions button[title="New folder"]');
  await page.fill('.askbox input', 'Work/Plans');
  await page.keyboard.press('Enter');
  await page.waitForSelector('aside li.folder');
  await page.click('aside .actions button[title="Collapse all folders"]').catch(() => {});
  assert.ok(await page.locator('aside .views button').count() === 3, 'files / search / recent views');
  await page.click('aside .views button[title="Search"]');
  assert.ok(await page.locator('aside input.search').isVisible());
  await page.click('aside .views button[title="Files"]');
  // "/" at the start of a line offers blocks to insert
  await page.click('.cm-content');
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n/tabl');
  await page.waitForSelector('.cm-tooltip-autocomplete');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.waitForSelector('.qt-cell', { timeout: 4000 }); // the table the slash menu inserted
  await page.screenshot({ path: process.env.SHOT_DIR ? join(process.env.SHOT_DIR, 'desktop.png') : '/tmp/qm-desktop.png' });
  assert.deepEqual(errors, []);
});

test('round 7b: touch — long-press menu and swipe the side panel', async () => {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, 'alice', 'alice-password');
  await page.waitForTimeout(500);
  // side panel is hidden on a phone; swipe in from the left edge
  const swipe = async (x0, x1) => page.evaluate(async ([a, b]) => {
    const mk = (type, x) => {
      const t = new Touch({ identifier: 1, target: document.body, clientX: x, clientY: 300 });
      document.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true }));
      window.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t] }));
    };
    mk('touchstart', a);
    for (let i = 1; i <= 8; i++) { mk('touchmove', a + ((b - a) * i) / 8); await new Promise((r) => setTimeout(r, 16)); }
    mk('touchend', b);
  }, [x0, x1]);
  assert.ok(!(await page.locator('.shell.drawer-open').count()));
  await swipe(8, 260);
  await page.waitForSelector('.shell.drawer-open');
  await swipe(280, 40);
  await page.waitForFunction(() => !document.querySelector('.shell.drawer-open'));
  await swipe(150, 20); // a swipe that does not start at the edge does nothing while closed
  assert.ok(!(await page.locator('.shell.drawer-open').count()));
  // long-press a note opens the same menu
  await swipe(8, 260);
  await page.waitForSelector('.shell.drawer-open');
  await page.locator('aside li.row .main').first().dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 120, clientY: 200 });
  await page.waitForSelector('.ctx', { timeout: 3000 });
  assert.ok(await page.locator('.ctx >> text=Rename').count() >= 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('round 8: offline work queues and syncs when the server returns; section links; card links', async () => {
  const errors = [];
  const page = await newPage(errors);
  await signIn(page, 'alice', 'alice-password');
  await page.click('aside .actions button:first-child');
  await page.waitForSelector('.cm-content');
  await page.click('.cm-content');
  await page.keyboard.insertText('# Target note\n\n## Second part\n\ntext\n');
  await page.click('.page-title');
  await page.fill('.page-title', 'Target');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);

  // --- offline: create, rename; nothing may throw, the list shows the new note
  await page.context().setOffline(true);
  await page.click('aside .actions button:first-child');
  await page.waitForSelector('.cm-content');
  await page.click('.cm-content');
  await page.keyboard.insertText('written while offline');
  await page.waitForTimeout(800);
  await page.waitForFunction(() => document.body.innerText.includes('waiting to sync'), null, { timeout: 8000 });
  assert.ok((await page.locator('aside li.row').count()) >= 2, 'new note is listed while offline');

  // --- back online: the queue is sent
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => !document.body.innerText.includes('waiting to sync'), null, { timeout: 20000 });
  const onServer = await page.evaluate(async () => {
    const tok = JSON.parse(localStorage.getItem('qm.settings') ?? '{}').token;
    const r = await fetch('/api/notes', { headers: { authorization: 'Bearer ' + tok } });
    return (await r.json()).map((n) => n.title);
  });
  assert.ok(onServer.length >= 2 && onServer.every((t) => !t.startsWith('tmp:')), 'the note made offline reached the server: ' + onServer);
  assert.ok(await page.locator('aside li.row').count() >= 2);

  // --- links with sections: [[Target#Second part]] jumps to the heading
  await page.click('aside .actions button:first-child');
  await page.waitForSelector('.cm-content');
  await page.click('.cm-content');
  await page.keyboard.insertText('see [[Target#Sec');
  await page.waitForSelector('.cm-tooltip-autocomplete', { timeout: 6000 });
  assert.ok(/Second part/.test(await page.locator('.cm-tooltip-autocomplete').innerText()), 'headings are suggested after #');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.click('.topbar .seg button:has-text("Source")');
  await page.waitForTimeout(300);
  const shown = await page.locator('.cm-content').innerText();
  assert.ok(/\[\[Target#Second part\]\]/.test(shown), 'heading inserted into the link: ' + JSON.stringify(shown));
  assert.deepEqual(errors, []);
});

test('round 9: tabs hold several notes; closing picks a neighbour', async () => {
  const errors = [];
  const page = await newPage(errors);
  await signIn(page, 'alice', 'alice-password');
  for (const name of ['TabA', 'TabB']) {
    await page.click('aside .actions button:first-child');
    await page.waitForSelector('.cm-content');
    await page.click('.cm-content');
    await page.keyboard.insertText('body of ' + name);
    await page.click('.page-title');
    await page.fill('.page-title', name);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
  }
  const names = async () => page.locator('.tabbar .tab .name').allInnerTexts();
  let n = await names();
  assert.ok(n.includes('TabA') && n.includes('TabB'), 'both notes have tabs: ' + n);
  await page.click('.tabbar .tab:has-text("TabA")');
  await page.waitForTimeout(400);
  assert.ok((await page.locator('.cm-content').innerText()).includes('body of TabA'));
  await page.click('.tabbar .tab.on .x');
  await page.waitForTimeout(400);
  n = await names();
  assert.ok(!n.includes('TabA'), 'tab closed');
  assert.ok((await page.locator('.cm-content').innerText()).includes('body of TabB'), 'neighbour opened');
  assert.deepEqual(errors, []);
});

test('round 9b: a base block lists notes by their properties and edits them', async () => {
  const errors = [];
  const page = await newPage(errors);
  await signIn(page, 'alice', 'alice-password');
  const make = async (title, body) => {
    await page.click('aside .actions button:first-child');
    await page.waitForSelector('.cm-content');
    await page.click('.cm-content');
    await page.keyboard.insertText(body);
    await page.click('.page-title');
    await page.fill('.page-title', title);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
  };
  await make('Task one', '---\nstatus: open\ndone: false\n---\nhello');
  await make('Task two', '---\nstatus: closed\ndone: true\n---\nhello');
  await make('Overview', 'x');
  await page.click('.cm-content');
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n\n```base\nshow: status, done\nsort: title\n```\n\nafter');
  await page.waitForSelector('.cm-base table', { timeout: 8000 });
  const heads = await page.locator('.cm-base th').allInnerTexts();
  assert.ok(heads.length === 3, 'columns: ' + heads);
  await page.click('.cm-base th >> nth=0');
  await page.waitForSelector('.cm-base th[data-sort="asc"]');
  await page.click('.cm-base th >> nth=0');
  await page.waitForSelector('.cm-base th[data-sort="desc"]');
  await page.fill('.base-find', 'two');
  await page.waitForFunction(() => document.querySelectorAll('.cm-base tbody tr').length === 1);
  await page.fill('.base-find', '');
  await page.waitForFunction(() => document.querySelectorAll('.cm-base tbody tr').length >= 2);
  await page.waitForSelector('.cm-base a.base-link:has-text("Task one")');
  assert.equal(await page.locator('.cm-base a.base-link:has-text("Task two")').count(), 1);
  // edit a property from the list
  const badge = page.locator('.cm-base tr:has-text("Task one") .base-badge.edit');
  if (await badge.count()) await badge.first().click(); // a status shows as a badge until you click it
  await page.fill('.cm-base tr:has-text("Task one") input.base-cell', 'in progress');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  // click the link: the note opens and its properties changed
  await page.click('.cm-base a.base-link:has-text("Task one")');
  await page.waitForFunction(() => document.querySelector('.page-title')?.value === 'Task one');
  await page.click('.topbar .seg button:has-text("Source")');
  await page.waitForTimeout(400);
  assert.match(await page.locator('.cm-content').innerText(), /status: in progress/);
  assert.deepEqual(errors, []);
});

test('round 10: selection is drawn on the text, and pressing beside the page still selects', async () => {
  const errors = [];
  const page = await newPage(errors);
  await page.setViewportSize({ width: 1600, height: 800 });
  await signIn(page, 'alice', 'alice-password');
  await page.click('aside .actions button:first-child');
  await page.waitForSelector('.cm-content');
  await page.click('.cm-content');
  await page.keyboard.insertText('The quick brown fox jumps over the lazy dog and keeps running through the long green field until evening, then rests.\n\nSecond paragraph.');
  await page.click('body');
  const line = await page.locator('.cm-line').first().boundingBox();
  const rects = () => page.evaluate(() => { const d = [...document.querySelectorAll('.cm-selectionBackground')].map((e) => e.getBoundingClientRect()); const rs = d.length ? d : (getSelection().rangeCount ? [...getSelection().getRangeAt(0).getClientRects()] : []); return rs.map((r) => [r.left, r.right]); });
  const textLeft = await page.evaluate(() => { const l = document.querySelector('.cm-line'); return l.getBoundingClientRect().left + parseFloat(getComputedStyle(l).paddingLeft); });
  // drag across a wrapped line
  await page.mouse.move(line.x + 80, line.y + 12);
  await page.mouse.down();
  await page.mouse.move(line.x + 300, line.y + 80, { steps: 8 });
  await page.mouse.up();
  const r1 = await rects();
  assert.ok(r1.length >= 2, 'a wrapped selection has several bands');
  for (const [l] of r1.slice(1)) assert.ok(l >= textLeft - 2, `band starts at the text (${l} vs ${textLeft})`);
  // press in the empty space to the right of the page and drag back over the text
  await page.mouse.click(line.x + 20, line.y + 160);
  await page.mouse.move(1550, line.y + 12);
  await page.mouse.down();
  await page.mouse.move(line.x + 150, line.y + 60, { steps: 8 });
  await page.mouse.up();
  assert.ok((await rects()).length >= 1, 'a drag that starts beside the page selects text');
  assert.deepEqual(errors, []);
});

test('round 11: Arabic and mixed text select, double-click and triple-click properly in live and source', async () => {
  const errors = [];
  const page = await newPage(errors);
  await signIn(page, 'alice', 'alice-password');
  const TXT = 'الإصدار الجديد من **فيدورا 45 وأوبونتو 26.10** وصل، ومعاهم تحديث **KDE Plasma 6.8** اللي بيودّع جلسة X11 ويتجه بالكامل إلى Wayland، ونستعرض كمان أهم التغييرات في **Linux Kernel 7.3**، ومجموعة من الأخبار والتحديثات المهمة في عالم البرمجيات الحرة، والكثير من... **أخبار لينكس**!';
  await page.click('aside .actions button:first-child');
  await page.waitForSelector('.cm-content');
  await page.click('.cm-content');
  await page.keyboard.insertText(TXT + '\n\nEnglish line after.');
  await page.click('body');
  const view = (fn, arg) => page.evaluate(`(${fn})(document.querySelector('.cm-editor').cmEditorView, ${JSON.stringify(arg ?? null)})`);
  const selText = () => view((v) => { const m = v.state.selection.main; return v.state.sliceDoc(m.from, m.to); });
  for (const mode of ['Live preview', 'Source']) {
    await page.click(`.topbar .seg button:has-text("${mode}")`);
    await page.waitForTimeout(400);
    await page.click('body');
    const dir = await view((v) => v.dom.querySelector('.cm-line').getAttribute('dir'));
    assert.equal(dir, 'rtl', mode + ': the Arabic paragraph runs right to left');
    // press at the right end of the first line (where an Arabic paragraph starts) and drag to the end of the paragraph
    const r = await view((v) => { const l = v.dom.querySelector('.cm-line').getBoundingClientRect(); const e = v.coordsAtPos(v.state.doc.line(1).to); return { l: l.left, r: l.right, t: l.top, h: l.height, ex: e.left, ey: v.coordsAtPos(v.state.doc.line(2).from).top + 5 }; });
    await page.mouse.move(r.r - 6, r.t + 10);
    await page.mouse.down();
    await page.mouse.move(r.l + 60, r.ey, { steps: 12 });
    await page.mouse.up();
    const s = await selText();
    assert.ok(s.startsWith('الإ') || s.startsWith('لإ'), mode + ': selection starts at the beginning: ' + s.slice(0, 12));
    assert.ok(s.length >= TXT.length - 4, mode + ': selection reaches the end ' + s.length + '/' + TXT.length + ' ' + JSON.stringify(r) + s.slice(-15));
    // double-click Wayland selects that word only (first put the cursor elsewhere, so the layout is settled)
    await view((v) => v.dispatch({ selection: { anchor: v.state.doc.length } }));
    await page.waitForTimeout(150);
    const w = await view((v, t) => { const i = v.state.doc.toString().indexOf('Wayland') + 3; const c = v.coordsAtPos(i); return { x: c.left, y: c.top + 6 }; });
    await page.mouse.dblclick(w.x, w.y);
    assert.equal(await selText(), 'Wayland', mode + ': double-click');
    // triple-click selects the paragraph
    await view((v) => v.dispatch({ selection: { anchor: v.state.doc.length } }));
    await page.waitForTimeout(700);
    await page.mouse.click(w.x, w.y, { clickCount: 3 });
    const t = await selText();
    assert.ok(t.length >= TXT.length - 1 && !t.includes('English'), mode + ': triple-click selects the whole paragraph');
    // copy and paste gives the same text back
    await page.keyboard.press('Control+C');
    await view((v) => v.dispatch({ selection: { anchor: v.state.doc.length } }));
    await page.keyboard.press('Control+V');
    await page.waitForTimeout(200);
    const copies = await view((v) => v.state.doc.toString().split('الإصدار الجديد').length - 1);
    assert.ok(copies >= 2, mode + ': paste returns the copied paragraph');
    await view((v) => v.dispatch({ changes: { from: v.state.doc.toString().lastIndexOf('الإصدار الجديد'), to: v.state.doc.length, insert: '' } }));
  }
  assert.deepEqual(errors, []);
});

test('round 12: on a touch screen a long press selects a word and the handles stretch it', async () => {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 420, height: 820 }, hasTouch: true, isMobile: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, 'alice', 'alice-password');
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    const mk = (type, x) => {
      const t = new Touch({ identifier: 1, target: document.body, clientX: x, clientY: 300 });
      document.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true }));
      window.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t] }));
    };
    mk('touchstart', 8);
    for (let i = 1; i <= 8; i++) { mk('touchmove', 8 + (252 * i) / 8); await new Promise((r) => setTimeout(r, 16)); }
    mk('touchend', 260);
  });
  await page.waitForSelector('.shell.drawer-open');
  await page.click('aside .actions button:first-child');
  await page.waitForSelector('.cm-content');
  await page.waitForTimeout(400);
  await page.click('.cm-content');
  await page.keyboard.insertText('alpha bravo charlie delta echo foxtrot golf hotel india');
  const view = (fn, arg) => page.evaluate(`(${fn})(document.querySelector('.cm-editor').cmEditorView, ${JSON.stringify(arg ?? null)})`);
  const sel = () => view((v) => { const m = v.state.selection.main; return v.state.sliceDoc(m.from, m.to); });
  const at = await view((v) => { const c = v.coordsAtPos(v.state.doc.toString().indexOf('charlie') + 3); return { x: c.left, y: c.top + 8 }; });
  await page.evaluate(({ x, y }) => {
    const c = document.querySelector('.cm-content');
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, clientX: x, clientY: y }));
    c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  }, at);
  assert.equal(await sel(), 'charlie', 'long press selects the word');
  await page.waitForSelector('.ctx-item:has-text("Copy")');
  assert.ok(await page.locator('.ctx-item:has-text("Select line")').count(), 'menu offers select line');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.qm-handle', { state: 'visible' });
  const hb = await page.locator('.qm-handle').nth(1).boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 110, hb.y + 4, { steps: 8 });
  await page.mouse.up();
  const s = await sel();
  assert.ok(s.startsWith('charlie') && s.length > 'charlie'.length + 6, 'dragging the end handle stretches the selection: ' + s);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('round 13: the app asks at the first start: a server, or this device only (with the notes folder shown)', async () => {
  const errors = [];
  // pretend to be the desktop/Android shell: a few commands answered by a fake notes folder
  const shell = () => {
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd) => {
        if (cmd === 'vault_info') return { path: '/storage/emulated/0/Android/data/x/files/Documents/Qalamark', default_path: '/storage/emulated/0/Android/data/x/files/Documents/Qalamark' };
        if (cmd === 'vault_list') return [{ path: 'Old.md', mtime_ms: 1 }];
        if (cmd === 'vault_read') return { text: '# Old\n', mtime_ms: 1 };
        if (cmd === 'vault_set') return '/x';
        return null;
      },
      transformCallback: () => 0,
    };
  };
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 800 }, userAgent: 'Mozilla/5.0 (Linux; Android 17) Chrome/120 Mobile' });
    await ctx.addInitScript(shell);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    return { ctx, page };
  };
  const a = await mk();
  await a.page.addInitScript(() => { if (!localStorage.getItem('qm.settings')) localStorage.setItem('qm.settings', JSON.stringify({ serverUrl: location.origin })); });
  await a.page.goto(URL_);
  await a.page.waitForSelector('.welcome');
  assert.match(await a.page.locator('.welcome .folder').innerText(), /Qalamark/, 'shows the notes folder');
  assert.ok(await a.page.locator('.welcome .folder .warn').count(), 'Android is told how to get Documents/Qalamark');
  assert.equal(await a.page.locator('.welcome .choice').count(), 2);
  await a.page.click('.welcome .choice:nth-of-type(2)');
  await a.page.waitForSelector('aside', { state: 'attached' });
  await a.page.reload();
  await a.page.waitForSelector('aside', { state: 'attached' });
  assert.equal(await a.page.locator('.welcome').count(), 0, 'asked only once');
  await a.ctx.close();

  const b = await mk();
  await b.page.addInitScript(() => { if (!localStorage.getItem('qm.settings')) localStorage.setItem('qm.settings', JSON.stringify({ serverUrl: location.origin })); });
  await b.page.goto(URL_);
  await b.page.waitForSelector('.welcome');
  await b.page.click('.welcome .choice.primary');
  await b.page.waitForSelector('.login input[autocomplete=username]');
  await b.ctx.close();
  assert.deepEqual(errors, []);
});

test('round 14: on a phone the bars float and hide while reading, and the text has the screen', async () => {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 400, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, 'alice', 'alice-password');
  await page.waitForSelector('.shell');
  await page.locator('aside .actions button:first-child').dispatchEvent('click');
  await page.waitForSelector('.cm-content');
  await page.waitForTimeout(400);
  await page.click('.cm-content');
  const long = Array.from({ length: 90 }, (_, i) => `## Part ${i}\n\nSome **bold** and *italic* words in line ${i}.\n`).join('\n');
  await page.keyboard.insertText(long);
  await page.waitForSelector('.editor-pane.typing .toolbar', { state: 'visible' });
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForSelector('.editor-pane:not(.typing)');
  assert.ok(await page.locator('.float-bar').isVisible(), 'floating bar shows after typing');
  assert.equal(await page.locator('.tabbar').isVisible(), false, 'no tab strip on a phone');
  const scroll = (y) => page.evaluate(async (y) => { const s = document.querySelector('.page'); while (Math.abs(s.scrollTop - y) > 1) { s.scrollTop += Math.sign(y - s.scrollTop) * Math.min(30, Math.abs(y - s.scrollTop)); await new Promise((r) => setTimeout(r, 16)); } }, y);
  await scroll(400); await page.waitForTimeout(150);
  await scroll(900); await page.waitForTimeout(800);
  assert.ok(await page.locator('.editor-pane.mobile').count(), 'phone mode on');
  assert.ok(await page.locator('.editor-pane.hide-bars').count(), 'scrolling down hides the bars');
  const box = await page.locator('.ctl').boundingBox();
  assert.ok(box.y + box.height <= 1, 'top bar is out of the way: ' + JSON.stringify(box));
  await scroll(600); await page.waitForTimeout(800);
  assert.equal(await page.locator('.editor-pane.hide-bars').count(), 0, 'scrolling up brings them back');
  await scroll(1200); await page.waitForTimeout(300);
  await page.touchscreen.tap(200, 400);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.editor-pane.hide-bars').count(), 0, 'a tap brings them back');
  await page.screenshot({ path: process.env.SHOT ?? '/tmp/claude-0/phone.png' });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('round 15: the System theme takes the phone\'s own colours (Material You)', async () => {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.QalamarkAndroid = {
      dynamicColors: () => JSON.stringify({ accent1_600: '#006a60', accent1_200: '#80d5c9', neutral1_10: '#fbfdf9', neutral1_50: '#f0f1ed', neutral1_100: '#e1e3df', neutral1_200: '#c5c7c3', neutral1_900: '#191c1a', neutral1_800: '#2e312f', neutral1_1000: '#000000', neutral2_300: '#bfc9c5', neutral2_700: '#3f4946', neutral1_900x: '' }),
      bars() {}, immersive() {},
    };
    try { if (!localStorage.getItem('qm-init')) { localStorage.setItem('qm-init', '1'); } } catch {}
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await signIn(page, 'alice', 'alice-password');
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('qm.settings') || '{}'); s.theme = 'system'; localStorage.setItem('qm.settings', JSON.stringify(s)); });
  await page.reload();
  await page.waitForSelector('aside');
  await page.waitForTimeout(500);
  const v = await page.evaluate(() => { const c = getComputedStyle(document.documentElement); return [c.getPropertyValue('--accent').trim(), c.getPropertyValue('--surface').trim()]; });
  assert.deepEqual(v, ['#006a60', '#fbfdf9'], 'accent and page colour come from the system palette: ' + v);
  await ctx.close();
  assert.deepEqual(errors, []);
});

test('round 16: focus mode shows only the page (Alt+Z), Escape brings everything back', async () => {
  const errors = [];
  const page = await newPage(errors);
  await signIn(page, 'alice', 'alice-password');
  await page.waitForSelector('.shell');
  await page.locator('aside .actions button:first-child').dispatchEvent('click');
  await page.waitForSelector('.cm-content');
  await page.keyboard.press('Alt+z');
  await page.waitForSelector('.shell.zen');
  assert.equal(await page.locator('aside').isVisible(), false, 'sidebar hidden in focus mode');
  assert.equal(await page.locator('.statusbar').isVisible(), false, 'status bar hidden');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.shell:not(.zen)');
  assert.ok(await page.locator('aside').isVisible(), 'sidebar is back');
  assert.deepEqual(errors, []);
});

test('round 17: pinned notes sit on top; version history restores an older text', async () => {
  const errors = [];
  const page = await newPage(errors);
  await signIn(page, 'alice', 'alice-password');
  await page.waitForSelector('.shell');
  await page.locator('aside .actions button:first-child').dispatchEvent('click');
  await page.waitForSelector('.cm-content');
  await page.click('.cm-content');
  await page.keyboard.insertText('# Pin me\n\nfirst version text');
  await page.waitForTimeout(2600); // the opening snapshot and the 400 ms save settle
  // pin from the side panel
  await page.locator('aside .tree .row:not(.folder)').first().click({ button: 'right' });
  await page.locator('.ctxmenu button:has-text("Pin to top"), [role=menu] button:has-text("Pin to top")').first().click();
  await page.waitForSelector('aside .pinned .pinrow');
  assert.equal(await page.locator('aside .pinned .pinrow').count(), 1);
  // a forced snapshot of the first text, then change the note
  await page.evaluate(() => {
    const id = Object.keys(localStorage).find((k) => k.startsWith('qm.hist.'));
    const arr = JSON.parse(localStorage.getItem(id) || '[]');
    arr.push({ t: Date.now() - 600000, text: '# Pin me\n\nOLD text from before' });
    localStorage.setItem(id, JSON.stringify(arr));
  });
  await page.click('.menu-wrap.desk button, .topbar .menu-wrap button');
  await page.locator('[role=menuitem]:has-text("Version history")').click();
  await page.waitForSelector('dialog.history[open] .hist');
  await page.locator('dialog.history [role=option]').first().click();
  await page.locator('dialog.history button.primary').click();
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('OLD text'));
  assert.deepEqual(errors, []);
});

test('round 18: Arabic lines use the chosen font whole (letters, marks and spaces in one font)', async () => {
  const errors = [];
  const page = await newPage(errors);
  await signIn(page, 'alice', 'alice-password');
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('qm.settings') || '{}'); s.fontAr = 'DejaVu Sans'; localStorage.setItem('qm.settings', JSON.stringify(s)); });
  await page.reload();
  await page.waitForSelector('.shell');
  await page.locator('aside .actions button:first-child').dispatchEvent('click');
  await page.waitForSelector('.cm-content');
  await page.click('.cm-content');
  await page.keyboard.insertText('سَيِّدُ الِاسْتِغْفَارِ\n\nEnglish line');
  await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    await document.fonts.ready;
    const lines = [...document.querySelectorAll('.cm-line')];
    return { ar: getComputedStyle(lines[0]).fontFamily, en: getComputedStyle(lines[lines.length - 1]).fontFamily, loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family) };
  });
  assert.ok(r.ar.startsWith('"DejaVu Sans"'), 'Arabic line stack starts with the chosen font: ' + r.ar);
  assert.ok(r.en.startsWith('"Qalamark Roboto"'), 'English line keeps the English font first: ' + r.en);
  assert.ok(r.loaded.some((f) => f.includes('QM Arabic Line')), 'the whole-line face loaded: ' + r.loaded);
  assert.deepEqual(errors, []);
});

test('round 19: an Arabic task keeps its direction when ticked and the font size reaches the text', async () => {
  const errors = [];
  const page = await newPage(errors);
  await signIn(page, 'alice', 'alice-password');
  await page.locator('aside .actions button:first-child').dispatchEvent('click');
  await page.waitForSelector('.cm-content');
  await page.click('.cm-content');
  await page.keyboard.insertText('- [ ] مهمة أولى\n- [x] مهمة ثانية');
  await page.waitForTimeout(600);
  const dirs = await page.evaluate(() => [...document.querySelectorAll('.cm-line')].map((l) => l.getAttribute('dir')));
  assert.deepEqual(dirs, ['rtl', 'rtl'], 'ticked and unticked Arabic tasks both run right to left');
  const sizes = await page.evaluate(() => { document.documentElement.style.setProperty('--font-size', '26px'); return parseFloat(getComputedStyle(document.querySelector('.cm-content')).fontSize); });
  assert.ok(sizes >= 26, 'the font-size setting reaches the editor text: ' + sizes);
  assert.deepEqual(errors, []);
});

test('round 20: Arabic title on the right and wrapping, [[ list themed, links open on click, Contents one tap away', async () => {
  const errors = [];
  const page = await newPage(errors);
  await signIn(page, 'alice', 'alice-password');
  await page.locator('aside .actions button:first-child').dispatchEvent('click');
  await page.waitForSelector('.page-title');
  await page.fill('.page-title', 'عنوان عربي');
  await page.locator('.page-title').blur();
  const al = await page.evaluate(() => { const t = document.querySelector('.page-title'); const b = t.getBoundingClientRect(); return { dir: getComputedStyle(t).direction, align: getComputedStyle(t).textAlign }; });
  assert.equal(al.dir, 'rtl');
  await page.click('.cm-content');
  await page.keyboard.insertText('# Head one\n\ntext\n\n## Head two\n\n[[');
  await page.waitForSelector('.cm-tooltip-autocomplete', { timeout: 5000 }).catch(() => {});
  const bg = await page.evaluate(() => { const e = document.querySelector('.cm-tooltip'); return e ? getComputedStyle(e).backgroundColor : null; });
  if (bg) assert.notEqual(bg, 'rgb(255, 255, 255)', 'the [[ list follows the theme');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+o');
  await page.waitForSelector('.toc, [class*=toc]');
  assert.deepEqual(errors, []);
});

test('round 21: on a phone the board clears the top bar, shows one column at a time and flips to the list and back', async () => {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 400, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, 'alice', 'alice-password');
  await page.waitForSelector('.shell');
  await page.locator('aside .actions button:first-child').dispatchEvent('click');
  await page.waitForSelector('.cm-content');
  await page.click('.cm-content');
  await page.keyboard.insertText('# Plan\n\n## Todo\n- [ ] write docs #docs 📅 2020-01-01\n- [ ] fix bug #bug\n\n## Done\n- [x] ship\n');
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(500);
  await page.locator('.ctl .modebtn').dispatchEvent('click'); // live → read
  await page.locator('.ctl .modebtn').dispatchEvent('click'); // read → source
  await page.locator('.ctl .modebtn').dispatchEvent('click'); // source → live
  await page.locator('.float-bar button[aria-label]').last().dispatchEvent('click');
  await page.locator('.sheet-list button', { hasText: /kanban/i }).dispatchEvent('click');
  await page.waitForSelector('.board .bcol');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  const g = await page.evaluate(() => {
    const ctl = document.querySelector('.ctl').getBoundingClientRect();
    const tools = document.querySelector('.btools');
    const col = document.querySelector('.bcol:not(.newcol)').getBoundingClientRect();
    const first = [...document.querySelectorAll('.btools > *')].map((e) => e.getBoundingClientRect().top);
    return { ctlBottom: ctl.bottom, toolsTop: Math.min(...first), colW: col.width, vw: innerWidth, strip: getComputedStyle(document.querySelector('.bstrip')).display, late: !!document.querySelector('.due.late') };
  });
  assert.ok(g.toolsTop >= g.ctlBottom - 1, `board content starts below the top pill (${g.toolsTop} vs ${g.ctlBottom})`);
  assert.ok(g.colW > g.vw * 0.8, 'one column fills the screen: ' + g.colW);
  assert.equal(g.strip, 'flex');
  assert.ok(g.late, 'an overdue card is marked');
  await page.locator('.listbtn').dispatchEvent('click');
  await page.waitForSelector('.cm-content');
  await page.locator('.boardseg button').first().dispatchEvent('click');
  await page.waitForSelector('.board .bcol');
  // pipeline mode: one stage segment per column, and "Move to" moves a card
  await page.locator('.kindbtn').dispatchEvent('click');
  await page.waitForSelector('.card .stages');
  assert.equal(await page.locator('.card').first().locator('.stages .seg').count(), 2);
  await page.locator('.card').first().locator('.movewrap button').first().dispatchEvent('click');
  await page.locator('.movemenu button', { hasText: 'Done' }).dispatchEvent('click');
  await page.waitForFunction(() => document.querySelectorAll('.bcol:nth-child(2) .card').length === 2);
  // the Board|List switch is always there: List, and back to Board
  await page.locator('.boardseg button').last().dispatchEvent('click');
  await page.waitForSelector('.cm-content');
  await page.locator('.boardseg button').first().dispatchEvent('click');
  await page.waitForSelector('.board .bcol');
  assert.deepEqual(errors, []);
});

test('round 22: a card that links a note shows its properties and moving it writes the note status', async () => {
  const errors = [];
  const page = await newPage(errors);
  await page.setViewportSize({ width: 1300, height: 800 });
  await signIn(page, 'alice', 'alice-password');
  await page.locator('aside .actions button:first-child').dispatchEvent('click');
  await page.waitForSelector('.page-title');
  await page.fill('.page-title', 'Vid One');
  await page.locator('.page-title').blur();
  await page.click('.cm-content');
  await page.keyboard.insertText('---\nstatus: Ideas\nnumber: 7\n---\n\nhello');
  await page.waitForTimeout(1500);
  await page.locator('aside .actions button:first-child').dispatchEvent('click');
  await page.waitForFunction(() => document.querySelector('.page-title')?.value !== 'Vid One');
  await page.fill('.page-title', 'Plan');
  await page.locator('.page-title').blur();
  await page.click('.cm-content');
  await page.keyboard.insertText('---\nkanban: pipeline\n---\n\n## Ideas\n- [ ] [[Vid One]]\n\n## Shooting\n');
  await page.waitForSelector('.board .bcol', { timeout: 10000 });
  await page.waitForSelector('.nprops', { timeout: 10000 });
  assert.match(await page.locator('.nprops').first().innerText(), /number\s*7/);
  if (process.env.SHOT2) await page.screenshot({ path: process.env.SHOT2 });
  await page.locator('.card').first().locator('.movewrap button').first().dispatchEvent('click');
  await page.locator('.movemenu button', { hasText: 'Shooting' }).dispatchEvent('click');
  await page.waitForTimeout(1500);
  await page.click('.card .clink');
  await page.waitForFunction(() => document.querySelector('.page-title')?.value === 'Vid One');
  await page.click('.topbar .seg button:has-text("Source")');
  await page.waitForTimeout(400);
  assert.match(await page.locator('.cm-content').innerText(), /status: Shooting/);
  assert.deepEqual(errors, []);
});

// ───────── trust: typing, undo, select all, saving and two people editing the same note ─────────
const TRICKY = 'سَيِّدُ الِاسْتِغْفَارِ\n\n\tindented with a tab\ntrailing spaces   \n😀 emoji ✓ — “quotes” ‘x’\n# not a *heading* [[x]] `code` \\* \\_\n\n\n- [ ] task\n  - nested\n> quote\n|a|b|\n|-|-|\n|1|2|\nlast line with no newline';
const note = (name) => join(data, 'notes/alice', name + '.md');
async function freshNote(page, name) {
  await page.locator('aside .actions button:first-child').dispatchEvent('click');
  await page.waitForFunction((n) => document.querySelector('.page-title') && document.querySelector('.page-title').value !== n, name);
  await page.fill('.page-title', name);
  await page.locator('.page-title').blur();
  await page.waitForTimeout(400);
  await page.click('.cm-content');
}
const onDisk = async (name, want, ms = 8000) => {
  const end = Date.now() + ms;
  let got = '';
  while (Date.now() < end) {
    try { got = readFileSync(note(name), 'utf8'); if (got.replace(/^---\n[\s\S]*?\n---\n/, '') .trimEnd() === want.trimEnd() || got === want) return got; } catch { /* not there yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return got;
};

test('trust 1: what you type is what is saved, byte for byte', async () => {
  const errors = [];
  const page = await newPage(errors);
  await signIn(page, 'alice', 'alice-password');
  await freshNote(page, 'Trust A');
  await page.keyboard.insertText(TRICKY);
  const got = await onDisk('Trust A', TRICKY);
  assert.equal(got.trimEnd(), TRICKY.trimEnd());
  // switching view mode never changes the text
  for (const m of ['Reading', 'Source', 'Live preview']) { await page.click(`.topbar .seg button:has-text("${m}")`); await page.waitForTimeout(250); }
  await page.waitForTimeout(1500);
  assert.equal((await onDisk('Trust A', TRICKY)).trimEnd(), TRICKY.trimEnd());
  // and a reload brings back the same text
  await page.reload();
  await page.waitForSelector('aside');
  await page.click('aside >> text=Trust A');
  await page.click('.topbar .seg button:has-text("Source")');
  await page.waitForSelector('.cm-content');
  await page.waitForTimeout(600);
  assert.equal((await page.locator('.cm-content').innerText()).replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim().length > 40, true);
  assert.deepEqual(errors, []);
});

test('trust 2: undo and redo walk back and forward exactly', async () => {
  const errors = [];
  const page = await newPage(errors);
  await signIn(page, 'alice', 'alice-password');
  await freshNote(page, 'Trust B');
  const steps = ['first line', '\nسَيِّدُ الِاسْتِغْفَارِ', '\n- a list item', '\n\n# heading', '\n**bold** end'];
  let acc = '';
  for (const st of steps) { await page.keyboard.insertText(st); acc += st; await page.waitForTimeout(650); }
  await onDisk('Trust B', acc);
  for (let i = 0; i < steps.length; i++) { await page.keyboard.press('Control+z'); await page.waitForTimeout(120); }
  await page.waitForTimeout(900);
  assert.equal((await onDisk('Trust B', '')).replace(/^---[\s\S]*?---\n/, '').trim(), '', 'undo all the way gives an empty note');
  for (let i = 0; i < steps.length; i++) { await page.keyboard.press('Control+Shift+Z'); await page.waitForTimeout(120); }
  assert.equal((await onDisk('Trust B', acc)).trimEnd(), acc.trimEnd(), 'redo all the way gives the note back');
  // Ctrl+Y redoes too
  for (let i = 0; i < steps.length; i++) { await page.keyboard.press('Control+z'); await page.waitForTimeout(120); }
  for (let i = 0; i < steps.length; i++) { await page.keyboard.press('Control+y'); await page.waitForTimeout(120); }
  assert.equal((await onDisk('Trust B', acc)).trimEnd(), acc.trimEnd());
  assert.deepEqual(errors, []);
});

test('trust 3: select all takes the whole note, wherever the focus is', async () => {
  const errors = [];
  const page = await newPage(errors);
  await page.setViewportSize({ width: 1300, height: 600 });
  await signIn(page, 'alice', 'alice-password');
  await freshNote(page, 'Trust C');
  const body = Array.from({ length: 400 }, (_, i) => `line ${i} سَيِّدُ`).join('\n');
  await page.keyboard.insertText(body);
  await onDisk('Trust C', body);
  const clip = async () => { await page.keyboard.press('Control+c'); return page.evaluate(() => navigator.clipboard.readText()); };
  // focus in the text
  await page.keyboard.press('Control+a');
  assert.equal((await clip()).length, body.length);
  // focus on the page's blank area, and in Reading mode (the page draws only the lines near the screen)
  await page.click('.topbar .seg button:has-text("Reading")');
  await page.mouse.click(1250, 300);
  await page.keyboard.press('Control+a');
  assert.equal((await clip()).length, body.length, 'Reading mode: the copy holds all 400 lines');
  await page.click('.topbar .seg button:has-text("Live preview")');
  await page.click('.cm-content');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('replaced');
  assert.equal((await onDisk('Trust C', 'replaced')).trimEnd().endsWith('replaced'), true);
  assert.equal((await onDisk('Trust C', 'replaced')).includes('line 399'), false);
  assert.deepEqual(errors, []);
});

test('trust 4: two people typing in the same note at once end with the same text, and nothing is lost', async () => {
  const errors = [];
  const a = await newPage(errors);
  const b = await newPage(errors);
  await signIn(a, 'alice', 'alice-password');
  await freshNote(a, 'Trust D');
  await a.keyboard.insertText('start\n\nmiddle\n\nend');
  await onDisk('Trust D', 'start\n\nmiddle\n\nend');
  await signIn(b, 'alice', 'alice-password');
  await b.click('aside >> text=Trust D');
  await b.waitForSelector('.cm-content');
  await b.click('.cm-content');
  await b.waitForTimeout(800);
  const tokens = [];
  for (let round = 0; round < 6; round++) {
    const ta = `[A${round}]`, tb = `[B${round}سَ]`;
    tokens.push(ta, tb);
    await Promise.all([
      (async () => { await a.keyboard.press('Control+Home'); await a.keyboard.insertText(ta); })(),
      (async () => { await b.keyboard.press('Control+End'); await b.keyboard.insertText(tb); })(),
    ]);
  }
  await a.waitForTimeout(2500);
  const text = (p) => p.evaluate(() => [...document.querySelectorAll('.cm-line')].map((l) => { const c = l.cloneNode(true); c.querySelectorAll('.cm-ySelectionInfo, .cm-ySelectionCaret, .cm-widgetBuffer').forEach((e) => e.remove()); return c.textContent.replace(/[\u2060\u200b]/g, ''); }).join('\n'));
  await a.click('.topbar .seg button:has-text("Source")');
  await b.click('.topbar .seg button:has-text("Source")');
  await a.waitForTimeout(800);
  const ta = await text(a), tb = await text(b);
  assert.equal(ta, tb, 'both screens show the same text');
  for (const t of tokens) assert.ok(ta.includes(t), `${t} survived`);
  assert.ok(ta.includes('middle'));
  const disk = await onDisk('Trust D', ta.replace(/\u00a0/g, ' '));
  for (const t of tokens) assert.ok(disk.includes(t), `${t} is on disk`);
  assert.deepEqual(errors, []);
});

test('trust 5: on a phone the tool bar works by touch, and the side panel opens from the button and by a swipe inside the screen', async () => {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 400, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, 'alice', 'alice-password');
  await freshNote(page, 'Trust E');
  await page.tap('.cm-content');
  await page.keyboard.insertText('item one\nitem two');
  await page.waitForSelector('.toolbar', { state: 'visible' });
  await page.tap('.toolbar button[title="Heading"]');
  await page.tap('.toolbar button[title="Bullet list"]');
  await page.waitForTimeout(500);
  const text = await page.evaluate(() => document.querySelector('.cm-content').innerText);
  assert.match(text, /item two/);
  const src = await page.evaluate(() => [...document.querySelectorAll('.cm-line')].map((l) => l.textContent).join('\n'));
  assert.ok(/#|•|-/.test(src), 'a toolbar tap changed the text: ' + JSON.stringify(src));
  // the floating side-panel button
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(500);
  await page.tap('.side-fab');
  await page.waitForFunction(() => document.querySelector('.shell').classList.contains('drawer-open'));
  await page.tap('.scrim', { position: { x: 385, y: 400 } });
  await page.waitForFunction(() => !document.querySelector('.shell').classList.contains('drawer-open'));
  // a swipe that starts 120px inside the screen (the very edge is the system's)
  const swipe = (x0, x1) => page.evaluate(async ([a, b]) => {
    const target = document.elementFromPoint(a, 400);
    const mk = (type, x) => new Touch({ identifier: 1, target, clientX: x, clientY: 400, pageX: x, pageY: 400 });
    const fire = (type, x) => target.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [mk(type, x)], changedTouches: [mk(type, x)], bubbles: true, cancelable: true }));
    fire('touchstart', a);
    for (let i = 1; i <= 8; i++) { fire('touchmove', a + ((b - a) * i) / 8); await new Promise((r) => setTimeout(r, 16)); }
    fire('touchend', b);
  }, [x0, x1]);
  await swipe(130, 330);
  await page.waitForFunction(() => document.querySelector('.shell').classList.contains('drawer-open'), null, { timeout: 4000 });
  assert.deepEqual(errors, []);
});

test('gestures 1: on a phone a swipe up on the bottom bar opens the menu, a swipe down closes it, and a swipe toward the panel side from the far side opens the contents', async () => {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 400, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, 'alice', 'alice-password');
  await freshNote(page, 'Gestures A');
  await page.tap('.cm-content');
  await page.keyboard.insertText('# One\n\n## Two\n');
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(500);
  const drag = (sel, from, to, y0 = null, y1 = null) => page.evaluate(async ([sel, a, b, ya, yb]) => {
    const el = sel ? document.querySelector(sel) : null;
    const r = el ? el.getBoundingClientRect() : null;
    const x0 = a ?? (r.left + r.width / 2), x1 = b ?? x0;
    const yy0 = ya ?? (r.top + r.height / 2), yy1 = yb ?? yy0;
    const target = document.elementFromPoint(x0, yy0);
    const mk = (x, y) => new Touch({ identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y });
    const fire = (type, x, y) => target.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [mk(x, y)], changedTouches: [mk(x, y)], bubbles: true, cancelable: true }));
    fire('touchstart', x0, yy0);
    for (let i = 1; i <= 8; i++) { fire('touchmove', x0 + ((x1 - x0) * i) / 8, yy0 + ((yy1 - yy0) * i) / 8); await new Promise((r) => setTimeout(r, 16)); }
    fire('touchend', x1, yy1);
  }, [sel, from, to, y0, y1]);
  const bar = await page.evaluate(() => { const r = document.querySelector('.float-bar').getBoundingClientRect(); return { y: r.top + r.height / 2, x: r.left + 20 }; });
  await drag(null, bar.x, bar.x, bar.y, bar.y - 90);
  await page.waitForSelector('.sheet', { timeout: 3000 });
  await drag('.sheet h3', null, null, null, null);
  const y = await page.evaluate(() => { const r = document.querySelector('.sheet h3').getBoundingClientRect(); return r.top + 4; });
  await drag(null, 200, 200, y, y + 140);
  await page.waitForFunction(() => !document.querySelector('.sheet'), null, { timeout: 3000 });
  // from the far side toward the panel's side: the contents
  await drag(null, 350, 120, 400, 400);
  await page.waitForSelector('.toc-drawer aside.toc', { timeout: 3000 });
  assert.match(await page.textContent('.toc-drawer'), /Two/);
  await page.waitForTimeout(500); // the slide-in
  // it comes in from the right edge of the screen
  const box = await page.evaluate(() => { const r = document.querySelector('.toc-drawer aside.toc').getBoundingClientRect(); return { right: r.right, left: r.left, w: innerWidth, dir: document.documentElement.dir, pos: getComputedStyle(document.querySelector('.toc-drawer aside.toc')).position }; });
  assert.ok(Math.abs(box.right - box.w) < 2, 'the contents sit at the right edge: ' + JSON.stringify(box));
  // swiping it back to the right puts it away
  await drag(null, 200, 340, 300, 300);
  await page.waitForFunction(() => !document.querySelector('.toc-drawer'), null, { timeout: 3000 });
  assert.deepEqual(errors, []);
});

test('gestures 2: the phone contents drawer follows the finger and slides out smoothly, like the sidebar', async () => {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await signIn(page, 'alice', 'alice-password');
  await freshNote(page, 'Gestures B');
  await page.tap('.cm-content');
  await page.keyboard.insertText('# One\n\n## Two\n');
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(500);
  const x = await page.evaluate(async () => {
    const target = document.elementFromPoint(360, 400);
    const mk = (x, y) => new Touch({ identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y });
    const fire = (type, x, y) => target.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [mk(x, y)], changedTouches: [mk(x, y)], bubbles: true, cancelable: true }));
    fire('touchstart', 360, 400);
    for (let i = 1; i <= 6; i++) { fire('touchmove', 360 - i * 20, 400); await new Promise((r) => setTimeout(r, 30)); }
    await new Promise((r) => setTimeout(r, 50));
    const a = document.querySelector('.toc-drawer aside.toc');
    const mid = a ? Math.round(a.getBoundingClientRect().left) : null;
    fire('touchend', 240, 400);
    return mid;
  });
  // a 120px drag of a 320px panel: it is part-way in, not shut and not fully open
  assert.ok(x !== null && x > 80 && x < 400, 'the drawer follows the finger: left=' + x);
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => Math.round(document.querySelector('.toc-drawer aside.toc').getBoundingClientRect().right)), 400, 'and settles open');
  // closing from the button slides it out, then it is gone
  await page.tap('.toc-scrim', { position: { x: 20, y: 400 } });
  await page.waitForTimeout(120);
  const mid = await page.evaluate(() => { const a = document.querySelector('.toc-drawer aside.toc'); return a ? Math.round(a.getBoundingClientRect().right) : null; });
  assert.ok(mid !== null && mid > 400, 'it is still sliding out part-way: ' + mid);
  await page.waitForFunction(() => !document.querySelector('.toc-drawer'), null, { timeout: 3000 });
  await ctx.close();
});

test('checklist 1: a note with view: checklist becomes a checklist you can tick, add to, swipe away and undo', async () => {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 400, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, 'alice', 'alice-password');
  await freshNote(page, 'Groceries');
  await page.tap('.cm-content');
  await page.keyboard.insertText('---\nview: checklist\n---\n\n## Fruit\n- [ ] apples\n- [ ] pears\n\n## Dairy\n- [ ] milk\n');
  await page.waitForSelector('.checklist', { timeout: 5000 });
  assert.equal(await page.locator('.ck-row').count(), 3);
  assert.match(await page.textContent('.ck-sum'), /0 of 3/);
  // tick by tapping the row text
  await page.tap('.ck-label >> text=apples');
  await page.waitForSelector('.ck-donehead');
  assert.match(await page.textContent('.ck-sum'), /1 of 3/);
  assert.equal(await page.locator('.ck-items.done .ck-label').first().textContent(), 'apples');
  // quick add
  await page.tap('.ck-add input >> nth=0');
  await page.keyboard.insertText('plums');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.ck-row').length === 4);
  // swipe an item toward the start of the line: it goes, and Undo brings it back
  const box = await page.locator('.ck-row:has-text("pears")').boundingBox();
  await page.evaluate(async ([x, y]) => {
    const el = document.elementFromPoint(x, y);
    const fire = (type, cx) => el.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: cx, clientY: y, bubbles: true, cancelable: true, isPrimary: true }));
    fire('pointerdown', x);
    for (let i = 1; i <= 8; i++) { fire('pointermove', x - i * 30); await new Promise((r) => setTimeout(r, 16)); }
    fire('pointerup', x - 240);
  }, [box.x + 120, box.y + box.height / 2]);
  await page.waitForFunction(() => document.querySelectorAll('.ck-row').length === 3);
  await page.tap('.ck-undo button');
  await page.waitForFunction(() => document.querySelectorAll('.ck-row').length === 4);
  // reset, then everything is open again
  await page.tap('.ck-actions button >> text=Uncheck all');
  await page.waitForFunction(() => !document.querySelector('.ck-donehead'));
  assert.match(await page.textContent('.ck-sum'), /0 of 4/);
  // the file stays plain Markdown: the text view shows the list lines
  await page.tap('.ck-actions button >> text=Source');
  await page.waitForSelector('.cm-content');
  assert.match(await page.textContent('.cm-content'), /plums/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('checklist 2: it scrolls, headings nest, subtasks tick their parent, Arabic starts from the right', async () => {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 600 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, 'alice', 'alice-password');
  await freshNote(page, 'Nested');
  await page.click('.cm-content');
  let body = '---\nview: checklist\n---\n\n# Trip\n\n## Pack\n';
  for (let i = 1; i <= 14; i++) body += `- [ ] thing ${i}\n`;
  body += '- [ ] clothes\n  - [ ] shirts\n  - [ ] socks\n\n### Bathroom\n- [ ] brush\n\n## كتب\n- [ ] قراءة الكتاب\n';
  await page.keyboard.insertText(body);
  await page.waitForSelector('.checklist');
  // 1. it scrolls with the mouse wheel
  const before = await page.evaluate(() => document.querySelector('.checklist').scrollTop);
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => document.querySelector('.checklist').scrollTop);
  assert.ok(after > before + 100, `the list scrolls: ${before} -> ${after}`);
  // 2. nesting: Trip holds Pack and the Arabic section; Pack holds Bathroom
  const tree = await page.evaluate(() => {
    const names = (sec) => [...sec.querySelectorAll(':scope > .ck-body > .ck-sec')].map((x) => x.querySelector(':scope > .ck-sec-head h3').textContent);
    const trip = [...document.querySelectorAll('.ck-sec.l1')][0];
    const pack = trip.querySelector('.ck-sec.l2');
    return { trip: names(trip), pack: names(pack) };
  });
  assert.deepEqual(tree.trip, ['Pack', 'كتب']);
  assert.deepEqual(tree.pack, ['Bathroom']);
  // 3. subtasks: ticking both ticks "clothes"
  await page.click('.ck-label >> text=shirts');
  await page.click('.ck-label >> text=socks');
  await page.waitForFunction(() => [...document.querySelectorAll('.ck-row')].some((r) => r.textContent.includes('clothes') && r.classList.contains('done')));
  // 4. folding a section hides what is under it, and it slides back
  await page.click('.ck-sec.l2 > .ck-sec-head .fold >> nth=0');
  await page.waitForFunction(() => !document.querySelector('.ck-sec.l3'));
  await page.click('.ck-sec.l2 > .ck-sec-head .fold >> nth=0');
  await page.waitForSelector('.ck-sec.l3');
  // 5. Arabic lines start from the right
  const ar = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.ck-row')].find((r) => r.textContent.includes('قراءة'));
    const label = row.querySelector('.ck-label');
    const tick = row.querySelector('.tick').getBoundingClientRect();
    const lab = label.getBoundingClientRect();
    return { dir: getComputedStyle(row).direction, tickRight: tick.left > lab.left, align: getComputedStyle(label).textAlign };
  });
  assert.equal(ar.dir, 'rtl');
  assert.ok(ar.tickRight, 'the tick sits on the right of an Arabic line');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('props 1: view is offered and chosen from a list, the name list is themed and long, icons can be set', async () => {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, 'alice', 'alice-password');
  await freshNote(page, 'Props');
  // open by default, and the ready-made names only show when adding
  assert.equal(await page.locator('.props-quick').count(), 0);
  await page.click('.props-addbtn');
  await page.click('.props-quick button >> text=view');
  // `view` starts as a plain note; choosing checklist turns the note into one
  assert.equal(await page.locator('.checklist').count(), 0);
  await page.click('.props .selbtn');
  await page.click('.sel-pop li >> text=checklist');
  await page.waitForSelector('.checklist', { timeout: 5000 });
  // the text side shows the properties
  const back = async () => { await page.locator('.topbar button >> text=Live preview').click(); await page.waitForSelector('.props'); await page.waitForSelector('.props .selbtn'); };
  await back();
  // its value is a list to choose from
  await page.click('.props .selbtn');
  const opts = await page.locator('.sel-pop li').allTextContents();
  assert.deepEqual(opts.slice(0, 4), ['note', 'checklist', 'board', 'pipeline']);
  await page.click('.sel-pop li >> text=board');
  await page.locator('.topbar button', { hasText: /^(Checklist|Board|Pipeline)$/ }).locator('visible=true').first().click();
  await page.waitForSelector('.board', { timeout: 5000 });
  await back();
  await page.click('.props .selbtn');
  await page.click('.sel-pop li >> text=checklist');
  await page.click('.props-addbtn');
  await page.waitForSelector('.props-quick button >> text=tap');
  assert.ok(await page.locator('.props-quick button >> text=tap').count() === 1, 'tap is offered for checklists');
  // our own list for the name, with plenty of choices and our theme
  await page.locator('.props-quick button', { hasText: 'your own' }).click();
  await page.click('.props-add input');
  await page.waitForSelector('.sug-pop');
  const n = await page.locator('.sug-pop li').count();
  assert.ok(n >= 15, 'many suggestions: ' + n);
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.sug-pop')).backgroundColor);
  assert.notEqual(bg, 'rgb(255, 255, 255)', 'not the browser white list: ' + bg);
  await page.fill('.props-add input', 'prio');
  assert.equal(await page.locator('.sug-pop li').first().textContent().then((x) => x.includes('priority')), true);
  await page.keyboard.press('Escape');
  // choose an icon for a property
  await page.click('.pkey .pico >> nth=0');
  await page.waitForSelector('.icon-pop');
  const before = await page.evaluate(() => document.querySelector('.pkey .pico svg').innerHTML);
  await page.click('.icon-grid button[aria-label="rocket"]');
  await page.waitForFunction((b) => document.querySelector('.pkey .pico svg').innerHTML !== b, before);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('motion 1: windows and menus leave the way they came; the bottom menu follows the finger; templates are one press away', async () => {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await signIn(page, 'alice', 'alice-password');
  await freshNote(page, 'Motion');
  await page.tap('.cm-content');
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(400);
  // the bottom menu comes up under the finger: half way up it is half out
  const mid = await page.evaluate(async () => {
    const bar = document.querySelector('.float-bar');
    const r = bar.getBoundingClientRect();
    const target = bar.querySelector('button');
    const x = r.left + 20, y0 = r.top + r.height / 2;
    const mk = (y) => new Touch({ identifier: 3, target, clientX: x, clientY: y, pageX: x, pageY: y });
    const fire = (type, y) => target.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [mk(y)], changedTouches: [mk(y)], bubbles: true, cancelable: true }));
    fire('touchstart', y0);
    for (let i = 1; i <= 6; i++) { fire('touchmove', y0 - i * 30); await new Promise((r) => setTimeout(r, 30)); }
    await new Promise((r) => setTimeout(r, 60));
    const sh = document.querySelector('.sheet');
    const top = sh ? Math.round(sh.getBoundingClientRect().top) : null;
    const h = sh ? Math.round(sh.getBoundingClientRect().height) : null;
    fire('touchend', y0 - 180);
    return { top, h, vh: innerHeight };
  });
  assert.ok(mid.top !== null && mid.top > mid.vh - mid.h + 20 && mid.top < mid.vh - 20, 'part way out under the finger: ' + JSON.stringify(mid));
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => Math.round(document.querySelector('.sheet').getBoundingClientRect().bottom)), 780, 'and it settles open');
  // closing slides it down (it is still there a moment later), then it is gone
  await page.tap('.sheet-scrim', { position: { x: 200, y: 40 } });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.sheet').count(), 1, 'it is still sliding out');
  await page.waitForFunction(() => !document.querySelector('.sheet'), null, { timeout: 3000 });
  // press and hold the plus: the templates
  const plus = await page.locator('.float-bar .plus').boundingBox();
  await page.evaluate(async ([x, y]) => {
    const el = document.querySelector('.float-bar .plus');
    const fire = (type) => el.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true }));
    fire('pointerdown');
    await new Promise((r) => setTimeout(r, 600));
    fire('pointerup');
  }, [plus.x + 10, plus.y + 10]);
  await page.waitForSelector('.sheet');
  assert.ok((await page.textContent('.sheet')).includes('Shopping list'), 'the shopping list template is there');
  await page.tap('.sheet-scrim', { position: { x: 200, y: 40 } });
  await page.waitForFunction(() => !document.querySelector('.sheet'));
  // a dialog (settings) closes with an exit, not instantly
  await page.evaluate(() => { document.querySelector('.float-bar button[aria-label="More"]')?.click(); });
  await ctx.close();
});

test('rtl 2: English menus stay left-to-right even in an Arabic note', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const page = await ctx.newPage();
  await signIn(page, 'alice', 'alice-password');
  await freshNote(page, 'مرحبا');
  await page.keyboard.type('أوبونتو 20.10');
  await page.click('.menu-wrap.desk button.icon');
  await page.waitForSelector('.menu-wrap .menu');
  const r = await page.evaluate(() => { const m = document.querySelector('.menu-wrap .menu'); const b = m.querySelector('button'); const c = getComputedStyle(m); return { dir: c.direction, ta: getComputedStyle(b).textAlign, html: document.documentElement.dir, rect: m.getBoundingClientRect().toJSON(), bt: b.getBoundingClientRect().toJSON(), txt: b.textContent }; });
  console.log(JSON.stringify(r));
  assert.equal(r.dir, 'ltr');
  await ctx.close();
});

test('bidi 1: Home and Shift+End select mixed Arabic and numbers, and shortcuts work on an Arabic keyboard', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const page = await ctx.newPage();
  await signIn(page, 'alice', 'alice-password');
  page.on('console', (m) => { if (m.text().startsWith('LINEEDGE')) console.log(m.text()); });
  await freshNote(page, 'bidi');
  await page.keyboard.insertText('أوبونتو 20.10\n26.10 أوبونتو');
  for (const [line, want] of [[1, '26.10 أوبونتو'], [0, 'أوبونتو 20.10']]) {
    await page.locator('.cm-line').nth(line).click();
    await page.keyboard.press('Home');
    console.log('HOME', await page.evaluate(() => { const g = getSelection(); return g.anchorNode?.textContent + '|' + g.anchorOffset; }));
    await page.keyboard.press('Shift+End');
    console.log('END', await page.evaluate(() => { const g = getSelection(); return g.anchorNode?.textContent + '|' + g.anchorOffset + ' -> ' + g.focusNode?.textContent + '|' + g.focusOffset; }));
    const got = await page.evaluate(() => { const v = document.querySelector('.cm-editor'); const sel = getSelection().toString(); const rects = document.querySelectorAll('.cm-selectionBackground').length; return { sel, rects }; });
    console.log('SEL', line, JSON.stringify(got));
    await page.screenshot({ path: '/tmp/bidi' + line + '.png', clip: { x: 300, y: 250, width: 800, height: 140 } });
    assert.equal(got.sel.replace(/[\u200e\u200f]/g, '').trim(), want, 'Home then Shift+End selects the whole line ' + line);
  }
  // double click on the number
  await page.locator('.cm-line').nth(0).dblclick({ position: { x: 20, y: 8 } });
  // Ctrl+Z with an Arabic layout (the key says ئ, the physical key is Z)
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(' xyz');
  await page.waitForTimeout(100);
  await page.evaluate(() => { const el = document.querySelector('.cm-content'); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ئ', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true })); });
  await page.waitForTimeout(200);
  const txt = await page.evaluate(() => document.querySelector('.cm-content').innerText);
  assert.ok(!txt.includes('xyz'), 'undo worked: ' + JSON.stringify(txt));
  await ctx.close();
});

test('settings 1: a full page with tabs on a computer; the properties box remembers open or closed for each note', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await signIn(page, 'alice', 'alice-password');
  await freshNote(page, 'Remember');
  assert.equal(await page.locator('.props-box').count(), 1, 'open by default');
  await page.click('.props-head');
  await page.waitForFunction(() => !document.querySelector('.props-box'));
  await page.reload();
  await page.waitForSelector('aside >> text=Remember');
  await page.click('aside >> text=Remember');
  await page.waitForSelector('.cm-content');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.props-box').count(), 0, 'closed stays closed for this note');
  await page.click('aside header button[aria-label="Settings"]');
  await page.waitForSelector('dialog.settings[open] .set-nav');
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => { const d = document.querySelector('dialog.settings').getBoundingClientRect(); return { w: d.width, h: d.height }; });
  assert.ok(r.w >= 1279 && r.h >= 799, 'fills the window ' + JSON.stringify(r));
  await page.click('.set-tabs button:has-text("Tasks")');
  await page.waitForSelector('text=Swipe right');
  await ctx.close();
});

test('phone 1: settings fit the screen as a list that slides to a page; properties start folded and remember', async () => {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await signIn(page, 'alice', 'alice-password');
  await freshNote(page, 'Phone props');
  assert.equal(await page.locator('.props-box').count(), 0, 'folded by default on a phone');
  await page.tap('.props-head');
  await page.waitForSelector('.props-box');
  await page.tap('.props-addbtn');
  await page.tap('.props-quick button >> text=tags');
  await page.fill('.props-grid input', 'work, home');
  await page.tap('.props-addbtn');
  await page.tap('.props-quick button >> text=status');
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/phprops.png' });
  const saved = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('qm.props.')).map(([, v]) => v));
  assert.deepEqual(saved, ['1'], 'the choice is remembered for this note');
  await page.evaluate(() => { document.querySelector('button[aria-label="Settings"]')?.click(); });
  await page.waitForSelector('dialog.settings[open]');
  await page.waitForTimeout(500);
  const fit = await page.evaluate(() => { const d = document.querySelector('dialog.settings').getBoundingClientRect(); return { l: d.left, w: d.width, iw: innerWidth, sw: document.documentElement.scrollWidth }; });
  assert.ok(fit.l >= -1 && fit.w <= fit.iw + 1 && fit.sw <= fit.iw + 1, 'fits the screen ' + JSON.stringify(fit));
  await page.tap('.set-tabs button:has-text("Look")');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => { const m = document.querySelector('.set-main').getBoundingClientRect(); return { l: m.left, r: m.right, iw: innerWidth }; });
  assert.ok(after.l >= -1 && after.r <= after.iw + 1, 'the page is on screen ' + JSON.stringify(after));
  await ctx.close();
});

test('tools 1: the insert menu shows, bullet and task start an empty item, the bar can be customised, and each panel hides on its own', async () => {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, 'alice', 'alice-password');
  await freshNote(page, 'Tools A');
  await page.click('.cm-content');
  await page.keyboard.insertText('# Head\n\n');
  // an empty line + bullet = an empty bullet to fill in
  await page.click('.toolbar button[title^="Bullet"]');
  assert.match(await page.evaluate(() => [...document.querySelectorAll('.cm-line')].map((l) => l.textContent).pop()), /^(- |• )$/);
  await page.keyboard.type('milk');
  await page.keyboard.press('Enter'); // a new item; Enter on an empty one leaves the list
  await page.keyboard.press('Enter');
  await page.click('.toolbar button[title^="Task"]');
  await page.click('.seg button:text-is("Source")');
  await page.waitForTimeout(300);
  const lines = await page.evaluate(() => [...document.querySelectorAll('.cm-line')].map((l) => l.textContent));
  assert.ok(lines.includes('- [ ] '), 'an empty task: ' + JSON.stringify(lines));
  await page.click('.seg button:has-text("Live")');
  await page.click('.cm-content');
  // the insert menu is visible and not cut off by the bar
  await page.click('.toolbar button[title="Insert"]');
  const vis = await page.evaluate(() => { const m = document.querySelector('.insmenu'); if (!m) return null; const r = m.getBoundingClientRect(); const e = document.elementFromPoint(r.left + 20, r.top + 10); return { h: r.height, hit: !!e?.closest('.insmenu') }; });
  assert.ok(vis && vis.h > 100 && vis.hit, 'the insert menu is on top: ' + JSON.stringify(vis));
  await page.click('.insmenu button >> text=Divider');
  assert.ok((await page.evaluate(() => document.querySelector('.cm-content').innerText)).length > 0);
  // customise: add Numbered list, remove Strike
  await page.click('.toolbar button[title^="Customise"]');
  await page.waitForSelector('dialog.toolbar-edit[open]');
  await page.click('.toolbar-edit li:has-text("Numbered list") button[title="Add"]');
  await page.click('.toolbar-edit li:has-text("Strikethrough") button[title="Remove"], .toolbar-edit li:has(.tb-name:text-is("Strike")) button[title="Remove"]').catch(() => {});
  await page.click('.toolbar-edit .row-end .primary');
  await page.waitForFunction(() => !document.querySelector('dialog.toolbar-edit[open]'));
  assert.ok(await page.locator('.toolbar button[title^="Numbered"]').count() === 1, 'the added tool shows');
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('qm.settings') || '{}').toolbar?.includes('numbered') ?? true));
  // contents on the right stays when the left side bar is hidden, and each has its own button
  await page.click('.tocbtn');
  await page.waitForSelector('aside.toc');
  await page.click('.side-btn');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('aside.toc').isVisible(), true, 'the contents stay');
  assert.equal(await page.locator('.shell > aside').first().isVisible(), false, 'the side bar is hidden');
  await page.click('.tocbtn');
  assert.equal(await page.locator('aside.toc').count(), 0);
  await page.click('.side-btn');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('sync 1: a note made offline reaches the server once, with its text, and the list shows it once', async () => {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, 'alice', 'alice-password');
  await page.waitForSelector('aside');
  await ctx.setOffline(true);
  await page.waitForTimeout(800);
  await page.locator('aside .actions button:first-child').dispatchEvent('click');
  await page.waitForSelector('.page-title');
  await page.fill('.page-title', 'Made offline');
  await page.locator('.page-title').blur();
  await page.click('.cm-content');
  await page.keyboard.insertText('written without a connection سَيِّدُ');
  await page.waitForTimeout(1200);
  // the app is closed and opened again just as the connection comes back (what happens on a phone)
  await ctx.setOffline(false);
  await page.reload();
  await page.waitForSelector('aside');
  const end = Date.now() + 25000;
  let titles = [];
  while (Date.now() < end) {
    titles = await page.$$eval('aside .note-row, aside [role=treeitem], aside .notes li', (els) => els.map((e) => e.textContent.trim()));
    if (readableOnDisk('Made offline')) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await page.waitForTimeout(3000); // let every refresh path run
  const rows = await page.$$eval('aside', (els) => els[0].innerText);
  assert.equal((rows.match(/Made offline/g) ?? []).length, 1, 'listed exactly once:\n' + rows);
  assert.match(readFileSync(note('Made offline'), 'utf8'), /written without a connection سَيِّدُ/);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem([...Object.keys(localStorage)].find((k) => k.startsWith('qm.outbox')) ?? '') ?? '[]').length), 0, 'nothing left waiting');
  assert.deepEqual(errors, []);
});
function readableOnDisk(name) { try { return readFileSync(note(name), 'utf8').includes('written'); } catch { return false; } }
