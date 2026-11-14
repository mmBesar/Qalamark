// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Starts the real server and talks to it like the apps do.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

const BIN = process.env.QALAMARK_BIN ?? new URL('../server/target/debug/qalamark-server', import.meta.url).pathname;
const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
const data = mkdtempSync(join(tmpdir(), 'qalamark-'));
let proc;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 6000) {
  const end = Date.now() + ms;
  for (;;) {
    try { if (await fn()) return; } catch { /* try again */ }
    if (Date.now() > end) throw new Error('Timed out waiting for: ' + what);
    await sleep(50);
  }
}
async function api(method, path, token, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
function start() {
  proc = spawn(BIN, [], {
    env: { ...process.env, QALAMARK_DATA: data, QALAMARK_ADDR: `127.0.0.1:${PORT}`, QALAMARK_WEB: join(data, 'web') },
    stdio: 'ignore',
  });
}
async function ready() { await until(async () => (await fetch(BASE + '/api/status')).ok, 'server start'); }
function open(noteId, token) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, noteId, doc, { WebSocketPolyfill: WebSocket, params: { token }, disableBc: true });
  return { doc, text: doc.getText('content'), provider, close: () => provider.destroy() };
}

before(async () => { start(); await ready(); });
after(() => proc?.kill());

let alice, bob, carol, note;

test('the first account becomes the admin; later sign-up is closed', async () => {
  assert.equal((await api('GET', '/api/status')).body.setup, true);
  const a = await api('POST', '/api/register', null, { username: 'Alice', password: 'correct horse' });
  assert.equal(a.status, 200);
  assert.equal(a.body.admin, true);
  assert.equal(a.body.username, 'alice');
  alice = a.body.token;
  const closed = await api('POST', '/api/register', null, { username: 'mallory', password: 'password1' });
  assert.equal(closed.status, 403);
});

test('the admin adds users; bad logins are refused', async () => {
  assert.equal((await api('POST', '/api/users', alice, { username: 'bob', password: 'bobs-password' })).status, 200);
  assert.equal((await api('POST', '/api/users', alice, { username: 'carol', password: 'carols-password' })).status, 200);
  assert.equal((await api('POST', '/api/users', alice, { username: 'bob', password: 'bobs-password' })).status, 409);
  assert.equal((await api('POST', '/api/login', null, { username: 'bob', password: 'wrong-wrong' })).status, 401);
  bob = (await api('POST', '/api/login', null, { username: 'bob', password: 'bobs-password' })).body.token;
  carol = (await api('POST', '/api/login', null, { username: 'carol', password: 'carols-password' })).body.token;
  assert.equal((await api('POST', '/api/users', bob, { username: 'eve', password: 'evil-password' })).status, 403);
  assert.equal((await api('GET', '/api/notes')).status, 401);
});

test('notes are plain .md files in the owner folder', async () => {
  const r = await api('POST', '/api/notes', alice, { title: 'Shopping / list', content: '# Shopping\n' });
  assert.equal(r.status, 200);
  note = r.body;
  assert.equal(note.title, 'Shopping - list');
  assert.equal(readFileSync(join(data, 'notes/alice/Shopping - list.md'), 'utf8'), '# Shopping\n');
  const same = await api('POST', '/api/notes', alice, { title: 'Shopping / list' });
  assert.equal(same.body.title, 'Shopping - list 2');
});

test('other people cannot see a note until it is shared', async () => {
  assert.equal((await api('GET', `/api/notes/${note.id}`, bob)).status, 404);
  assert.equal((await api('GET', '/api/notes', bob)).body.length, 0);
  assert.equal((await api('POST', `/api/notes/${note.id}/shares`, alice, { username: 'nobody', role: 'edit' })).status, 404);
  assert.equal((await api('POST', `/api/notes/${note.id}/shares`, alice, { username: 'bob', role: 'edit' })).status, 200);
  assert.equal((await api('POST', `/api/notes/${note.id}/shares`, alice, { username: 'carol', role: 'view' })).status, 200);
  const list = (await api('GET', '/api/notes', bob)).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].role, 'edit');
  assert.equal(list[0].owner, 'alice');
  assert.equal((await api('POST', `/api/notes/${note.id}/shares`, bob, { username: 'carol', role: 'edit' })).status, 403);
});

test('two people edit the same note live, and the .md file follows', async () => {
  const a = open(note.id, alice);
  const b = open(note.id, bob);
  await until(() => a.text.toString() === '# Shopping\n' && b.text.toString() === '# Shopping\n', 'both see the note');
  a.text.insert(a.text.length, 'Tea\n');
  await until(() => b.text.toString().includes('Tea'), 'bob sees alice');
  b.text.insert(0, 'DRAFT ');
  await until(() => a.text.toString().startsWith('DRAFT '), 'alice sees bob');
  const want = a.text.toString();
  assert.equal(b.text.toString(), want);
  await until(() => readFileSync(join(data, 'notes/alice/Shopping - list.md'), 'utf8') === want, 'file saved');
  a.close(); b.close();
});

test('a viewer can read but not change the note', async () => {
  const c = open(note.id, carol);
  const a = open(note.id, alice);
  await until(() => c.text.toString().includes('Tea'), 'carol reads');
  const before = a.text.toString();
  c.text.insert(0, 'HACK');
  await sleep(500);
  assert.equal(a.text.toString(), before);
  c.close(); a.close();
  await sleep(300);
  assert.ok(!readFileSync(join(data, 'notes/alice/Shopping - list.md'), 'utf8').includes('HACK'));
});

test('a connection with a wrong token or without access is refused', async () => {
  const ws = (token, id = note.id) => new Promise((res) => {
    const s = new WebSocket(`ws://127.0.0.1:${PORT}/ws/${id}?token=${token}`);
    s.on('open', () => { s.close(); res('open'); });
    s.on('error', () => res('refused'));
    s.on('unexpected-response', () => res('refused'));
  });
  assert.equal(await ws('nope'), 'refused');
  const other = (await api('POST', '/api/notes', alice, { title: 'private' })).body;
  assert.equal(await ws(bob, other.id), 'refused');
  assert.equal(await ws(bob), 'open');
});

test('changing the .md file from outside reaches people who have it open', async () => {
  const a = open(note.id, alice);
  await until(() => a.text.toString().includes('Tea'), 'loaded');
  const file = join(data, 'notes/alice/Shopping - list.md');
  writeFileSync(file, readFileSync(file, 'utf8') + 'Added from outside\n');
  await until(() => a.text.toString().includes('Added from outside'), 'external edit arrives', 9000);
  a.close();
});

test('everything survives a restart, and files dropped into the folder become notes', async () => {
  proc.kill(); await sleep(300);
  writeFileSync(join(data, 'notes/alice/Dropped in.md'), 'hello from a file');
  start(); await ready();
  const list = (await api('GET', '/api/notes', alice)).body;
  assert.ok(list.some((n) => n.title === 'Dropped in'));
  const a = open(note.id, alice);
  await until(() => a.text.toString().includes('Added from outside') && a.text.toString().startsWith('DRAFT '), 'content back');
  a.close();
});

test('rename moves the file; delete moves it to the trash', async () => {
  const r = await api('PATCH', `/api/notes/${note.id}`, alice, { title: 'Groceries' });
  assert.equal(r.body.title, 'Groceries');
  assert.ok(existsSync(join(data, 'notes/alice/Groceries.md')));
  assert.equal((await api('PATCH', `/api/notes/${note.id}`, bob, { title: 'x' })).status, 403);
  assert.equal((await api('DELETE', `/api/notes/${note.id}`, bob)).status, 403);
  assert.equal((await api('DELETE', `/api/notes/${note.id}`, alice)).status, 200);
  assert.ok(!existsSync(join(data, 'notes/alice/Groceries.md')));
  assert.equal(readdirSync(join(data, 'trash')).length, 1);
  assert.equal((await api('GET', `/api/notes/${note.id}`, alice)).status, 404);
});

test('removing a share takes access away; people can leave a share themselves', async () => {
  const n = (await api('POST', '/api/notes', alice, { title: 'team' })).body;
  await api('POST', `/api/notes/${n.id}/shares`, alice, { username: 'bob', role: 'edit' });
  assert.equal((await api('GET', `/api/notes/${n.id}`, bob)).status, 200);
  assert.equal((await api('DELETE', `/api/notes/${n.id}/shares/bob`, carol)).status, 404);
  assert.equal((await api('DELETE', `/api/notes/${n.id}/shares/bob`, bob)).status, 200);
  assert.equal((await api('GET', `/api/notes/${n.id}`, bob)).status, 404);
});

test('backlinks: notes that link to a note with [[Title]]', async () => {
  const target = (await api('POST', '/api/notes', alice, { title: 'Target page' })).body;
  await api('POST', '/api/notes', alice, { title: 'Linker', content: 'See [[target page]] and [[Other|x]]' });
  await api('POST', '/api/notes', alice, { title: 'Nope', content: 'no links' });
  const r = await api('GET', `/api/notes/${target.id}/backlinks`, alice);
  assert.deepEqual(r.body.map((b) => b.title), ['Linker']);
  assert.equal((await api('GET', `/api/notes/${target.id}/backlinks`, bob)).status, 404);
});

test('admin: sign-up switch, password reset, make admin, delete user', async () => {
  // The switch: closed by default, open when the admin says so, and closed again.
  assert.equal((await api('PUT', '/api/admin/settings', bob, { signup: true })).status, 403);
  assert.equal((await api('PUT', '/api/admin/settings', alice, { signup: true })).status, 200);
  assert.equal((await api('GET', '/api/status')).body.signup, true);
  const dave = await api('POST', '/api/register', null, { username: 'dave', password: 'daves-password' });
  assert.equal(dave.status, 200);
  assert.equal(dave.body.admin, false);
  await api('PUT', '/api/admin/settings', alice, { signup: false });
  assert.equal((await api('POST', '/api/register', null, { username: 'erin', password: 'erins-password' })).status, 403);

  // Reset a password: the old one stops working and old sessions end.
  assert.equal((await api('PATCH', '/api/users/dave', bob, { password: 'new-password-1' })).status, 403);
  assert.equal((await api('PATCH', '/api/users/dave', alice, { password: 'new-password-1' })).status, 200);
  assert.equal((await api('GET', '/api/me', dave.body.token)).status, 401);
  assert.equal((await api('POST', '/api/login', null, { username: 'dave', password: 'daves-password' })).status, 401);
  assert.equal((await api('POST', '/api/login', null, { username: 'dave', password: 'new-password-1' })).status, 200);

  // Admin rights; the last admin cannot be removed or demoted.
  assert.equal((await api('PATCH', '/api/users/alice', alice, { admin: false })).status, 409);
  assert.equal((await api('PATCH', '/api/users/dave', alice, { admin: true })).status, 200);
  assert.equal((await api('PATCH', '/api/users/dave', alice, { admin: false })).status, 200);
  assert.equal((await api('DELETE', '/api/users/alice', alice)).status, 409);

  // Deleting a user keeps their notes in the trash.
  const dtoken = (await api('POST', '/api/login', null, { username: 'dave', password: 'new-password-1' })).body.token;
  await api('POST', '/api/notes', dtoken, { title: 'Dave note', content: 'keep me' });
  assert.equal((await api('DELETE', '/api/users/dave', bob)).status, 403);
  assert.equal((await api('DELETE', '/api/users/dave', alice)).status, 200);
  assert.equal((await api('POST', '/api/login', null, { username: 'dave', password: 'new-password-1' })).status, 401);
  assert.ok(readdirSync(join(data, 'trash')).some((f) => f.includes('user-dave')));
  assert.deepEqual((await api('GET', '/api/users', alice)).body.map((u) => u.username).sort(), ['alice', 'bob', 'carol']);
});
