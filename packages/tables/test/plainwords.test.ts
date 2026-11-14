// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The plain-words formulas, tried on real tables.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recalculate } from '../src/index.ts';

const col = (md: string, c: number) =>
  md
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .slice(2)
    .map((l) => l.split('|')[c + 1]!.trim());

test('electricity meter: change in [Meter] is 0 on the first row', () => {
  const md = `| Month | Date | Meter | Consumption |
|---|---|---|---|
| JAN 24 | 240101 | 10097 | |
| FEB 24 | 240201 | 10115 | |
| MAR 24 | 240301 | 10133 | |
| APR 24 | 240401 | 10157 | |
| MAY 24 | 240501 | 10179 | |
<!-- qalamark
[Consumption] = change in [Meter]
-->
`;
  const r = recalculate(md);
  assert.deepEqual(col(r.markdown, 3), ['0', '18', '18', '24', '22']);
  assert.deepEqual(r.diagnostics, []);
});

test('two meters in one table', () => {
  const md = `| 1st Reading | 1st Consumption | 2nd Reading | 2nd Consumption |
|---|---|---|---|
| 85822 | | 53482 | |
| 86079 | | 53694 | |
<!-- qalamark
[1st Consumption] = change in [1st Reading]
[2nd Consumption] = change in [2nd Reading]
-->
`;
  const r = recalculate(md);
  assert.deepEqual(col(r.markdown, 1), ['0', '257']);
  assert.deepEqual(col(r.markdown, 3), ['0', '212']);
});

test('days between dates, with the time ignored; hours and minutes on request', () => {
  const md = `| Month | Date | Days | Hours | Minutes |
|---|---|---|---|---|
| APR | 2022-04-01 00:00 | | | |
| MAY | 2022-05-05 00:00 | | | |
| JUN | 2022-06-14 00:00 | | | |
| JUL | 2022-07-27 12:30 | | | |
<!-- qalamark
[Days] = days since previous [Date]
[Hours] = hours between previous [Date] and [Date]
[Minutes] = minutes since previous [Date]
-->
`;
  const r = recalculate(md);
  assert.deepEqual(col(r.markdown, 2), ['', '34', '40', '43']);
  assert.deepEqual(col(r.markdown, 3), ['', '816', '960', '1044.5']);
  assert.equal(col(r.markdown, 4)[3], String(1044.5 * 60));
});

test('totals in the last row, with Arabic headers and bold cells', () => {
  const md = `| المادة | الوحدة | السعر | العدد | الإجمالي |
|---|---|---|---|---|
| سيراميك | متر | 125 | 2 | |
| دهان | علبة | 350 | 1 | |
| إجمالي | | | | |
<!-- qalamark
[الإجمالي] = [السعر] * [العدد]
[الإجمالي] in last row = total of [الإجمالي]
-->
`;
  const r = recalculate(md);
  assert.deepEqual(col(r.markdown, 4), ['250', '350', '600']);
});

test('due / paid / remaining with a total row', () => {
  const md = `| Item | Due | Paid | Remaining |
|---|---|---|---|
| Work | 2515 | | |
| Payment | 0 | 1200 | |
| Total | | | |
<!-- qalamark
[Remaining] = [Due] - [Paid]
[Due] in last row = total of [Due]
[Paid] in last row = total of [Paid]
[Remaining] in last row = [Due] - [Paid]
-->
`;
  const r = recalculate(md);
  assert.deepEqual(col(r.markdown, 1), ['2515', '0', '2515']);
  assert.deepEqual(col(r.markdown, 2), ['', '1200', '1200']);
  assert.deepEqual(col(r.markdown, 3), ['2515', '-1200', '1315']);
});

test('other words: average of, highest, lowest, count of', () => {
  const md = `| N |
|---|
| 2 |
| 4 |
| 9 |
| |
<!-- qalamark
A5 = average of A
-->
`;
  const r = recalculate(md);
  assert.equal(col(r.markdown, 0)[3], '5');
});

test('a bad word gives a readable message', () => {
  const md = `| A | B |
|---|---|
| 1 | |
<!-- qalamark
B = change in
-->
`;
  const r = recalculate(md);
  assert.match(r.diagnostics[0]!.message, /needs a column/);
});

test('column letters work with the plain words too (no header names needed)', () => {
  const md = `| Month | Date | Meter | Used | Days |
|---|---|---|---|---|
| A | 2022-04-01 | 100 | | |
| B | 2022-05-05 | 130 | | |
<!-- qalamark
D = change in C
E = days since previous B
-->
`;
  const r = recalculate(md);
  assert.deepEqual(col(r.markdown, 3), ['0', '30']);
  assert.deepEqual(col(r.markdown, 4), ['', '34']);
});
