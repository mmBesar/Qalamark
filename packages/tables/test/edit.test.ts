// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeTables, editCell, recalculate, setFormulas, tableOp } from '../src/index.ts';

const SHOP = `Intro

| Item  | Qty | Price | Total |
| ----- | --- | ----- | ----- |
| Tea   | 2   | 3     | 6     |
| Sugar | 1   | 4     | 4     |
| Sum   |     |       | 10    |
<!-- qalamark
D = B * C
D4 = SUM(D2:D3)
-->

Outro
`;

test('describeTables lists cells, formulas and line ranges', () => {
  const [t] = describeTables(SHOP);
  assert.equal(t!.rows.length, 4);
  assert.equal(t!.rows[1]![0], 'Tea');
  assert.equal(t!.gridFrom, 2);
  assert.equal(t!.gridTo, 6);
  assert.equal(t!.toLine, 10);
  assert.ok(t!.formulas.some((f) => f.row === 2 && f.col === 3 && f.source === 'B * C'));
  assert.ok(t!.formulas.some((f) => f.row === 4 && f.col === 3 && f.source === 'SUM(D2:D3)'));
});

test('editCell changes one cell and recalculates', () => {
  const out = editCell(SHOP, 0, 2, 1, '5');
  assert.match(out, /\| Tea {3}\| 5 {3}\| 3 {5}\| 15 {4}\|/);
  assert.match(out, /\| Sum .*\| 19 /);
  assert.ok(out.startsWith('Intro\n') && out.endsWith('Outro\n'));
});

test('editCell can type a formula into a cell', () => {
  const out = editCell(SHOP, 0, 3, 1, '=1+1');
  assert.match(out, /B3 = 1\+1|B3 = 1 \+ 1/);
  assert.match(out, /\| Sugar \| 2 /);
});

test('editCell escapes pipes', () => {
  const out = editCell(SHOP, 0, 2, 0, 'a|b');
  assert.match(out, /a\\\|b/);
});

test('adding a row in the middle moves formulas', () => {
  const out = tableOp(SHOP, 0, { op: 'addRow', at: 3 });
  const [t] = describeTables(out);
  assert.equal(t!.rows.length, 5);
  assert.ok(t!.formulas.some((f) => f.row === 5 && f.source === 'SUM(D2:D4)'));
  assert.match(out, /D5 = SUM\(D2:D4\)/);
});

test('adding a row at the end keeps the total range (total row moves only if below)', () => {
  const out = tableOp(SHOP, 0, { op: 'addRow', at: 5 });
  assert.match(out, /D4 = SUM\(D2:D3\)/);
});

test('deleting a row shrinks ranges and moves cell formulas', () => {
  const out = tableOp(SHOP, 0, { op: 'deleteRow', row: 3 });
  assert.match(out, /D3 = SUM\(D2:D2\)/);
  assert.match(out, /\| Sum .*\| 6 /);
  assert.doesNotMatch(out, /Sugar/);
});

test('deleting a row a single-cell formula points at drops that formula', () => {
  const md = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 |   |\n<!-- qalamark\nB3 = A2 * 2\nB2 = A3\n-->\n';
  const out = tableOp(md, 0, { op: 'deleteRow', row: 2 });
  assert.doesNotMatch(out, /A2 \* 2/);
});

test('adding a column in front shifts column letters', () => {
  const out = tableOp(SHOP, 0, { op: 'addColumn', at: 1 });
  assert.match(out, /E = C \* D/);
  assert.match(out, /E4 = SUM\(E2:E3\)/);
  const [t] = describeTables(out);
  assert.equal(t!.rows[0]!.length, 5);
});

test('deleting a column drops formulas that need it and shifts the rest', () => {
  const out = tableOp(SHOP, 0, { op: 'deleteColumn', col: 0 });
  assert.match(out, /C = A \* B/);
  assert.match(out, /C4 = SUM\(C2:C3\)/);
  const gone = tableOp(SHOP, 0, { op: 'deleteColumn', col: 1 });
  assert.doesNotMatch(gone, /= B \* C/);
});

test('alignment can be changed', () => {
  const out = tableOp(SHOP, 0, { op: 'align', col: 1, align: 'right' });
  assert.match(out, /\| -{2,}: \|/);
});

test('operations are stable: a second recalculation changes nothing', () => {
  for (const op of [
    { op: 'addRow', at: 2 },
    { op: 'deleteRow', row: 2 },
    { op: 'addColumn', at: 4 },
    { op: 'deleteColumn', col: 2 },
  ] as const) {
    const out = tableOp(SHOP, 0, op);
    assert.equal(recalculate(out).changed, false, JSON.stringify(op));
  }
});

test('bad indexes leave the text alone', () => {
  assert.equal(tableOp(SHOP, 5, { op: 'addRow', at: 2 }), SHOP);
  assert.equal(tableOp(SHOP, 0, { op: 'deleteRow', row: 1 }), SHOP);
  assert.equal(editCell(SHOP, 3, 2, 1, '1'), SHOP);
});

test('setFormulas replaces, adds and removes the formula comment', () => {
  const out = setFormulas(SHOP, 0, 'D = B * C * 2');
  assert.match(out, /\| Tea {3}\| 2 {3}\| 3 {5}\| 12 /);
  assert.doesNotMatch(out, /SUM/);
  const bare = '| a | b |\n|---|---|\n| 2 |   |\n';
  const added = setFormulas(bare, 0, 'B = A * 3');
  assert.match(added, /<!-- qalamark\nB = A \* 3\n-->/);
  assert.match(added, /\| 2 +\| 6 +\|/);
  const none = setFormulas(added, 0, '');
  assert.doesNotMatch(none, /qalamark/);
});
