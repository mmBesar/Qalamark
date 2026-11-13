// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

function run(args: string[], input = '') {
  const r = spawnSync(process.execPath, [CLI, ...args], { input, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const NEEDS_WORK = '| a | b |\n|---|---|\n| 2 |   |\n<!-- qalamark\nB = A * 3\n-->\n';

test('eval prints the result', () => {
  assert.equal(run(['eval', 'SUM(1,2,3)*2']).out, '12\n');
  assert.equal(run(['eval', '1/0']).out, '#DIV/0!\n');
});

test('recalc prints the finished document', () => {
  const r = run(['recalc', '-'], NEEDS_WORK);
  assert.equal(r.code, 0);
  assert.match(r.out, /\| 2 \| 6 \|/);
});

test('recalc --check fails when something would change, passes when not', () => {
  assert.equal(run(['recalc', '-', '--check'], NEEDS_WORK).code, 1);
  const done = run(['recalc', '-'], NEEDS_WORK).out;
  assert.equal(run(['recalc', '-', '--check'], done).code, 0);
});

test('recalc --check also fails on formula problems', () => {
  const bad = '| a |\n|---|\n| 1 |\n<!-- qalamark\nA2 = FOO(1)\n-->\n';
  assert.equal(run(['recalc', '-', '--check'], bad).code, 1);
});

test('format tidies tables', () => {
  const r = run(['format', '-'], '|a|b|\n|-|-|\n|1|2|\n');
  assert.equal(r.out, '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n');
});

test('commands can be chained with a real shell pipe', { skip: process.platform === 'win32' }, () => {
  // Regression: reading a piped stdin used to crash with EAGAIN.
  const quoted = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const node = quoted(process.execPath);
  const script = `printf %s ${quoted(NEEDS_WORK)} | ${node} ${quoted(CLI)} recalc - | ${node} ${quoted(CLI)} format -`;
  const r = spawnSync('sh', ['-c', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\| 2 {3}\| 6 {3}\|/);
});

test('a missing file gives a clear message and exit code 2', () => {
  const r = run(['recalc', '/no/such/file.md']);
  assert.equal(r.code, 2);
  assert.match(r.err, /Cannot read "\/no\/such\/file\.md": ENOENT/);
});

test('no arguments prints usage and fails', () => {
  const r = run([]);
  assert.equal(r.code, 2);
  assert.match(r.err, /recalc <file/);
});
