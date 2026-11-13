// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recalculate } from '../src/index.ts';

const BASIC = `| Item | Qty | Price | Total |
|------|----:|------:|------:|
| Tea  |   2 |  3.50 |       |
| Cake |   1 |  4.25 |       |
<!-- qalamark
D = B * C
format D = 0.00
-->
`;

test('a column formula fills every row and keeps the table tidy', () => {
  const r = recalculate(BASIC);
  assert.equal(
    r.markdown,
    `| Item | Qty | Price | Total |
|------|----:|------:|------:|
| Tea  |   2 |  3.50 |  7.00 |
| Cake |   1 |  4.25 |  4.25 |
<!-- qalamark
D = B * C
format D = 0.00
-->
`,
  );
  assert.equal(r.changed, true);
  assert.equal(r.tables, 1);
  assert.deepEqual(r.diagnostics, []);
});

test('recalculating twice changes nothing the second time', () => {
  const once = recalculate(BASIC).markdown;
  const twice = recalculate(once);
  assert.equal(twice.changed, false);
  assert.equal(twice.markdown, once);
});

test('documents without formulas are returned untouched', () => {
  const md = '# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nText\n';
  const r = recalculate(md);
  assert.equal(r.markdown, md);
  assert.equal(r.changed, false);
  assert.equal(r.tables, 0);
});

test('a total row typed as =SUM(D) moves into the comment and shows the result', () => {
  const md = `| Item | Qty | Price | Total |
|------|----:|------:|------:|
| Tea  |   2 |  3.50 |       |
| Cake |   1 |  4.25 |       |
| Sum  | =SUM(B) |   | =SUM(D) |
<!-- qalamark
D = B * C
format D = 0.00
-->
`;
  const r = recalculate(md);
  // Row numbers count the header as row 1, so the total row is row 4.
  assert.match(r.markdown, /\| Sum\s+\|\s+3 \|\s+\|\s+11\.25 \|/);
  assert.match(r.markdown, /B4 = SUM\(B\)/);
  assert.match(r.markdown, /D4 = SUM\(D\)/);
  assert.doesNotMatch(r.markdown, /\| *=SUM/);
  assert.deepEqual(r.diagnostics, []);
  // The column formula must not run on the total row (it has formulas of its own).
  assert.equal(recalculate(r.markdown).changed, false);
});

test('"==" in a cell makes a formula for the whole column', () => {
  const md = `| Qty | Price | Total |
|----:|------:|------:|
|   2 |  3.50 | ==A*B |
|   1 |  4.25 |       |
`;
  const r = recalculate(md);
  assert.match(r.markdown, /\| +2 \| +3\.50 \| +7 \|/);
  assert.match(r.markdown, /\| +1 \| +4\.25 \| +4\.25 \|/);
  assert.match(r.markdown, /<!-- qalamark\nC = A\*B\n-->/);
  assert.deepEqual(r.diagnostics, []);
});

test('a column formula that uses its own column is a cycle', () => {
  const md = `| a | b |
|---|---|
| 2 | ==A*B |
`;
  assert.match(recalculate(md).markdown, /#CYCLE!/);
});

test('typing a new formula replaces the old one for the same cell', () => {
  const md = `| a | b |
|---|---|
| 1 | =A+1 |
<!-- qalamark
B2 = A*100
-->
`;
  const r = recalculate(md);
  assert.match(r.markdown, /\| 1 \| 2 +\|/);
  assert.doesNotMatch(r.markdown, /A\*100/);
});

test('empty rows stay empty instead of showing 0', () => {
  const md = `| Qty | Price | Total |
|----:|------:|------:|
|   2 |  3.50 |       |
|     |       |       |
<!-- qalamark
C = A * B
-->
`;
  const r = recalculate(md);
  const lines = r.markdown.split('\n');
  assert.match(lines[2]!, /\| +7 \|/);
  assert.equal(lines[3], '|     |       |       |');
});

test('columns can be named by their header, including Arabic headers and digits', () => {
  const md = `| الصنف | الكمية | السعر | الإجمالي |
|---|---|---|---|
| شاي | ٢ | ٣٫٥ | |
| كعك | ١ | ٤٫٢٥ | |
<!-- qalamark
[الإجمالي] = [الكمية] * [السعر]
-->
`;
  const r = recalculate(md);
  assert.deepEqual(r.diagnostics, []);
  const rows = r.markdown.split('\n');
  assert.equal(rows[2], '| شاي | ٢ | ٣٫٥ | 7 |');
  assert.equal(rows[3], '| كعك | ١ | ٤٫٢٥ | 4.25 |');
});

test('formulas can use other formulas, in any order', () => {
  const md = `| a | b | c |
|---|---|---|
| 2 |   |   |
<!-- qalamark
C2 = B2 + 1
B2 = A2 * 10
-->
`;
  const r = recalculate(md);
  assert.match(r.markdown, /\| 2 \| 20 \| 21 \|/);
});

test('circular formulas show #CYCLE! instead of hanging', () => {
  const md = `| a | b |
|---|---|
| 1 |   |
<!-- qalamark
A2 = B2 + 1
B2 = A2 + 1
-->
`;
  const r = recalculate(md);
  assert.match(r.markdown, /#CYCLE!/);
});

test('a formula that depends on itself through its own total is a cycle', () => {
  const md = `| a |
|---|
| 1 |
| 2 |
| 0 |
<!-- qalamark
A4 = SUM(A2:A4)
-->
`;
  assert.match(recalculate(md).markdown, /#CYCLE!/);
});

test('errors are written into the cell and reported', () => {
  const md = `| a | b |
|---|---|
| 5 | 0 |
| 1 | 1 |
<!-- qalamark
A = A + FOO(1)
B2 = A2 / B2
-->
`;
  const r = recalculate(md);
  assert.match(r.markdown, /#NAME\?/);
  assert.ok(r.diagnostics.length >= 1);
  assert.match(r.diagnostics[0]!.message, /Unknown function "FOO"/);
});

test('bad statements are reported with their line number', () => {
  const md = `| a | b |
|---|---|
| 1 | 2 |
<!-- qalamark
Z = A
B = =
D2 = A
what is this
format B = nope
-->
`;
  const r = recalculate(md);
  const lines = r.diagnostics.map((d) => d.line);
  assert.ok(lines.includes(5)); // Z
  assert.ok(lines.includes(7)); // D2
  assert.ok(lines.includes(8)); // "what is this"
  assert.ok(lines.includes(9)); // format B = nope
  assert.ok(r.diagnostics.length >= 5);
});

test('rows with their own formulas are skipped by column formulas', () => {
  const md = `| n | double |
|--:|-------:|
| 1 |        |
| 2 |        |
| 9 |        |
<!-- qalamark
B = A * 2
B4 = 0
-->
`;
  const r = recalculate(md);
  const rows = r.markdown.split('\n');
  assert.match(rows[2]!, /\| +2 \|/);
  assert.match(rows[3]!, /\| +4 \|/);
  assert.match(rows[4]!, /\| +0 \|/);
});

test('single-line comments and several statements per line work', () => {
  const md = `| a | b | c |
|---|---|---|
| 2 |   |   |
<!-- qalamark: B = A * 2; C = B + 1 -->
`;
  const r = recalculate(md);
  assert.match(r.markdown, /\| 2 \| 4 \| 5 \|/);
});

test('results with a pipe are escaped so the table does not break', () => {
  const md = `| a | b |
|---|---|
| x |   |
<!-- qalamark
B2 = A2 & "|" & A2
-->
`;
  const r = recalculate(md);
  assert.match(r.markdown, /\| x \| x\\\|x \|/);
  assert.equal(recalculate(r.markdown).changed, false);
});

test('tables inside code blocks are left alone', () => {
  const md = '```\n| a | b |\n|---|---|\n| 1 |   |\n<!-- qalamark\nB = A\n-->\n```\n';
  const r = recalculate(md);
  assert.equal(r.markdown, md);
  assert.equal(r.tables, 0);
});

test('several tables in one document are each worked out', () => {
  const md = `First

| a | b |
|---|---|
| 1 |   |
<!-- qalamark
B = A + 1
-->

Second

| x | y |
|---|---|
| 5 |   |
<!-- qalamark
[y] = [x] * 10
-->
`;
  const r = recalculate(md);
  assert.equal(r.tables, 2);
  assert.deepEqual(r.diagnostics, []);
  assert.match(r.markdown, /\| 1 \| 2 \|/);
  assert.match(r.markdown, /\| 5 \| 50 \|/);
});

test('a letter target that is really a header name gets a helpful hint', () => {
  const md = `| x | y |
|---|---|
| 5 |   |
<!-- qalamark
y = x * 10
-->
`;
  const r = recalculate(md);
  assert.equal(r.changed, false);
  assert.match(r.diagnostics[0]!.message, /brackets, like \[Total\]/);
});

test('a table inside a list keeps its indentation when a formula is lifted', () => {
  const md = `- item

  | a | b |
  |---|---|
  | 1 | =A+1 |

after
`;
  const r = recalculate(md);
  assert.match(r.markdown, /\n {2}<!-- qalamark\n {2}B2 = A\+1\n {2}-->\n/);
  assert.match(r.markdown, /\n {2}\| 1 \| 2 +\|\n/);
  assert.ok(r.markdown.endsWith('\nafter\n'));
});

test('comments written inside the formula block survive a lift', () => {
  const md = `| a | b | c |
|---|---|---|
| 1 | 2 | =A+B |
<!-- qalamark
// c is the sum
format C = 0.0
-->
`;
  const r = recalculate(md);
  assert.match(r.markdown, /\/\/ c is the sum/);
  assert.match(r.markdown, /format C = 0\.0/);
  assert.match(r.markdown, /C2 = A\+B/);
  // The cell keeps the width of the formula it replaced; "format" tidies it up.
  assert.match(r.markdown, /\| 3\.0 +\|/);
});

test('Windows line endings and a missing final newline are kept', () => {
  const crlf = BASIC.replace(/\n/g, '\r\n');
  const r = recalculate(crlf);
  assert.ok(r.markdown.includes('|  7.00 |\r\n'));
  assert.ok(!/[^\r]\n/.test(r.markdown));

  const noEnd = BASIC.trimEnd();
  const r2 = recalculate(noEnd);
  assert.ok(r2.markdown.endsWith('-->'));
  assert.ok(r2.markdown.includes('|  7.00 |'));
});

test('short rows get the cells they need', () => {
  const md = `| a | b | c |
|---|---|---|
| 1 |
<!-- qalamark
C = A + 1
-->
`;
  const r = recalculate(md);
  assert.match(r.markdown, /\| 1 \| +\| 2 \|/);
});

test('per-cell format beats column format', () => {
  const md = `| a | b |
|---|---|
| 1 |   |
| 2 |   |
<!-- qalamark
B = A / 3
format B = 0.00
format B3 = 0.0%
-->
`;
  const r = recalculate(md);
  const rows = r.markdown.split('\n');
  assert.match(rows[2]!, /\| 0\.33 \|/);
  assert.match(rows[3]!, /\| 66\.7% \|/);
});

test('formulas that point below the table are reported, not applied', () => {
  const md = `| a |
|---|
| 1 |
<!-- qalamark
A9 = 5
-->
`;
  const r = recalculate(md);
  assert.equal(r.changed, false);
  assert.ok(r.diagnostics.some((d) => /only has/.test(d.message)));
});

test('lifting can be switched off', () => {
  const md = `| a | b |
|---|---|
| 1 | =A+1 |
`;
  const r = recalculate(md, { lift: false });
  assert.equal(r.changed, false);
});

test('an unknown header name is reported by name', () => {
  const md = `| Item | Cost |
|------|-----:|
| a    |   10 |
<!-- qalamark
[Price] = 1
-->
`;
  const r = recalculate(md);
  assert.equal(r.changed, false);
  assert.match(r.diagnostics[0]!.message, /no column named "Price"/);
});

test('bold numbers are read as numbers', () => {
  const md = `| Item | Cost |
|------|-----:|
| a    | **10** |
| b    |  5 |
| Sum  |      |
<!-- qalamark
B4 = SUM(B)
-->
`;
  const r = recalculate(md);
  assert.match(r.markdown, /\| Sum +\| +15 \|/);
});

// ---- Robustness: big and awkward tables must never crash the caller ----

test('a long chain of formulas works, even when the deepest one is listed first', () => {
  const n = 5000;
  let md = '| n | running |\n|--:|--:|\n';
  for (let i = 1; i <= n; i++) md += '| 1 | |\n';
  md += '<!-- qalamark\n';
  for (let r = n + 1; r >= 3; r--) md += `B${r} = B${r - 1} + A${r}\n`; // deepest first
  md += 'B2 = A2\n-->\n';
  const r = recalculate(md);
  assert.deepEqual(r.diagnostics, []);
  assert.equal(r.markdown.split('\n')[n + 1], '| 1 | 5000 |');
  assert.equal(recalculate(r.markdown).changed, false);
});

test('a very long circular chain is detected instead of looping forever', () => {
  const n = 3000;
  let md = '| a |\n|--:|\n';
  for (let i = 1; i <= n; i++) md += '|   |\n';
  md += '<!-- qalamark\n';
  for (let r = 2; r <= n + 1; r++) md += `A${r} = A${r === n + 1 ? 2 : r + 1} + 1\n`; // ring
  md += '-->\n';
  const r = recalculate(md);
  const rows = r.markdown.split('\n').slice(2, n + 2);
  assert.ok(rows.every((row) => row.includes('#CYCLE!')));
});

test('a running total over a computed column works', () => {
  const md = `| n | double | running |
|--:|-------:|--------:|
| 1 |        |         |
| 2 |        |         |
| 3 |        |         |
<!-- qalamark
B = A * 2
C = SUM(B) + B
-->
`;
  const r = recalculate(md);
  const rows = r.markdown.split('\n');
  // running = (sum of "double" in the rows above) + this row's "double"
  assert.match(rows[2]!, /\| 1 \| +2 \| +2 \|/);
  assert.match(rows[3]!, /\| 2 \| +4 \| +6 \|/);
  assert.match(rows[4]!, /\| 3 \| +6 \| +12 \|/);
});

test('formulas nested too deeply are refused, normal nesting is fine', () => {
  const ok = `| a |\n|--:|\n|   |\n<!-- qalamark\nA2 = ${'('.repeat(40)}1${')'.repeat(40)}\n-->\n`;
  assert.match(recalculate(ok).markdown, /\| 1 \|/);
  const bad = `| a |\n|--:|\n|   |\n<!-- qalamark\nA2 = ${'('.repeat(5000)}1${')'.repeat(5000)}\n-->\n`;
  const r = recalculate(bad);
  assert.match(r.markdown, /#ERR!/);
  assert.match(r.diagnostics[0]!.message, /nested too deeply/);
  const minus = `| a |\n|--:|\n|   |\n<!-- qalamark\nA2 = ${'-'.repeat(5000)}1\n-->\n`;
  assert.match(recalculate(minus).markdown, /#ERR!/);
});
