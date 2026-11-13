// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findTables, formatTables } from '../src/index.ts';

test('formatTables lines up the pipes and respects alignment', () => {
  const md = `Intro

|name|qty|note|
|-|-:|:-:|
|apple|3|ok|
|kiwi|12|x|

Outro
`;
  const r = formatTables(md);
  assert.equal(
    r.markdown,
    `Intro

| name  | qty | note |
| ----- | --: | :--: |
| apple |   3 |  ok  |
| kiwi  |  12 |  x   |

Outro
`,
  );
  assert.equal(r.tables, 1);
  assert.equal(r.changed, true);
});

test('formatting is stable (running it twice changes nothing)', () => {
  const once = formatTables('|a|b|\n|-|-|\n|long text|1|\n').markdown;
  assert.equal(formatTables(once).changed, false);
});

test('Arabic text is measured without its accent marks', () => {
  // "مَرحبا" has a mark (fatha) that takes no room, so it is as wide as "الاسم".
  const md = '|الاسم|العدد|\n|-|-|\n|مَرحبا|١|\n';
  assert.equal(
    formatTables(md).markdown,
    '| الاسم | العدد |\n| ----- | ----- |\n| مَرحبا | ١     |\n',
  );
});

test('escaped pipes do not split cells', () => {
  const lines = ['| a \\| b | c |', '|---|---|', '| 1 | 2 |'];
  const [t] = findTables(lines);
  assert.equal(t!.ncols, 2);
});

test('tables without outer pipes are found too', () => {
  const lines = ['a | b', '--|--', '1 | 2'];
  const tables = findTables(lines);
  assert.equal(tables.length, 1);
  assert.equal(tables[0]!.ncols, 2);
});

test('code blocks and non-tables are ignored', () => {
  assert.equal(findTables(['```', '| a |', '|---|', '```']).length, 0);
  assert.equal(findTables(['a | b', 'not a delimiter']).length, 0);
  assert.equal(findTables(['| a | b |', '|---|']).length, 0); // column counts differ
});

test('the formula comment is not treated as a table row', () => {
  const lines = ['| a |', '|---|', '| 1 |', '<!-- qalamark', 'A = 1', '-->', 'after'];
  const [t] = findTables(lines);
  assert.equal(t!.rows.length, 2);
  assert.equal(t!.block!.start, 3);
  assert.equal(t!.block!.end, 5);
});
