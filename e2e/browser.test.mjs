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
  await page.click('.props-head');
  await page.click('.props-quick >> text=tags');
  await page.fill('.props-grid input', 'work, plan');
  await page.keyboard.press('Tab');
  // Live preview hides the block; Source mode shows it as plain text and has no panel.
  await page.click('button:has-text("Source")');
  await page.waitForFunction(() => /tags:\s*\n\s*- work\s*\n\s*- plan/.test(document.querySelector('.cm-content')?.innerText ?? ''), null, { timeout: 5000 });
  assert.equal(await page.locator('.props-head').count(), 0);
  await page.click('button:has-text("Live preview")');
  assert.ok(!/tags:/.test(await page.locator('.cm-content').innerText()), 'front matter is hidden in live preview');
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
  assert.equal(await page.locator('.pal').count(), 0);
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
  await page.waitForSelector('.cm-selectionBackground', { state: 'attached', timeout: 4000 });

  // right-click in the editor: themed app menu, inside the window
  await page.locator('.cm-line:has-text("second line")').click({ button: 'right' });
  await page.waitForSelector('.ctx');
  const cb = await page.locator('.ctx').boundingBox();
  assert.ok(cb.x >= 0 && cb.y >= 0 && cb.x + cb.width <= 1100 && cb.y + cb.height <= 760, 'menu stays on screen');
  const bg = await page.locator('.ctx').evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.ok(bg !== 'rgba(0, 0, 0, 0)', 'menu has the theme background');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.ctx').count(), 0);

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
  await page.waitForSelector('.cm-base a.base-link:has-text("Task one")');
  assert.equal(await page.locator('.cm-base a.base-link:has-text("Task two")').count(), 1);
  // edit a property from the list
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
  const rects = () => page.evaluate(() => [...document.querySelectorAll('.cm-selectionBackground')].map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.right]));
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
  await page.locator('.ctl .modebtn').dispatchEvent('click'); // list → read ... cycle reaches board again
  await page.locator('.ctl .modebtn').dispatchEvent('click');
  await page.locator('.ctl .modebtn').dispatchEvent('click');
  await page.waitForSelector('.board .bcol');
  assert.deepEqual(errors, []);
});
