import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findHeading, parseHeadings, pieces, plainHeading, splitTarget } from '../app/src/lib/headings.ts';
import { moveSection, shiftSection } from '../app/src/lib/sections.ts';

const T = `---
title: x
# not a heading
---
# One
intro
## One A
a
## One B
b
# Two
two
\`\`\`
# not a heading either
\`\`\`
`;

test('headings: skip properties and code, keep order and levels', () => {
  const hs = parseHeadings(T);
  assert.deepEqual(hs.map((h) => [h.level, h.text]), [[1, 'One'], [2, 'One A'], [2, 'One B'], [1, 'Two']]);
  assert.equal(T.slice(hs[1]!.pos, hs[1]!.pos + 8), '## One A');
});

test('heading links match ignoring case and marks', () => {
  const hs = parseHeadings('# Hello **World**\n## Part [[x|two]]\n');
  assert.equal(plainHeading('Hello **World**'), 'Hello World');
  assert.equal(findHeading(hs, 'hello world')?.level, 1);
  assert.equal(findHeading(hs, 'Part two')?.level, 2);
  assert.equal(findHeading(hs, 'nope'), undefined);
  assert.deepEqual(splitTarget('Note#My part'), { note: 'Note', heading: 'My part' });
  assert.deepEqual(splitTarget('#Only'), { note: '', heading: 'Only' });
  assert.deepEqual(splitTarget('Plain'), { note: 'Plain', heading: '' });
});

test('pieces: wiki links with sections, web links, plain text', () => {
  const p = pieces('see [[Plan#Costs]] and [site](https://x.org) or https://y.org now');
  assert.deepEqual(p.map((x) => x.kind), ['text', 'wiki', 'text', 'url', 'text', 'url', 'text']);
  assert.equal(p[1]!.target, 'Plan#Costs');
  assert.equal(p[1]!.text, 'Plan › Costs');
  assert.equal(p[3]!.target, 'https://x.org');
});

test('moving sections swaps whole sections, never crosses a parent', () => {
  const t = '# A\na\n## A1\nx\n## A2\ny\n# B\nb\n';
  const down = moveSection(t, 1, 1)!; // A1 below A2
  assert.equal(down, '# A\na\n## A2\ny\n## A1\nx\n# B\nb\n');
  assert.equal(moveSection(t, 2, 1), null); // A2 is last in A: cannot go into B
  assert.equal(moveSection(t, 1, -1), null); // A1 is first in A
  assert.equal(moveSection(t, 3, -1), '# B\nb\n# A\na\n## A1\nx\n## A2\ny\n');
  assert.equal(moveSection('# A\na\n# B\nb', 0, 1), '# B\nb\n# A\na'); // no trailing newline stays so
});

test('promote and demote a section with everything inside it', () => {
  const t = '# A\n## A1\n### deep\n# B\n';
  assert.equal(shiftSection(t, 1, 1), '# A\n### A1\n#### deep\n# B\n');
  assert.equal(shiftSection(t, 1, -1), '# A\n# A1\n## deep\n# B\n');
  assert.equal(shiftSection('###### six\n', 0, 1), null);
  assert.equal(shiftSection('# one\n', 0, -1), null);
});

import { deletedElsewhere, leftoverIsUnchanged } from '../app/src/lib/syncplan.ts';
test('a note is deleted elsewhere only if an earlier server list had it and this one does not', () => {
  const mine = [{ id: 'a', role: 'owner' }, { id: 'b', role: 'owner' }, { id: 'c', role: 'owner' }, { id: 'tmp:x', role: 'owner' }, { id: 'd', role: 'editor' }];
  const gone = deletedElsewhere(mine, new Set(['a']), new Set(['a', 'b', 'd', 'tmp:x']), new Set());
  assert.deepEqual(gone.map((n) => n.id), ['b'], 'c was never in a list (made a moment ago), tmp is local, d is not mine');
  assert.deepEqual(deletedElsewhere(mine, new Set(['a']), new Set(['b']), new Set(['b'])), [], 'already handled');
});
test('a leftover file is trashed only while unchanged', () => {
  assert.ok(leftoverIsUnchanged(1000, 1000));
  assert.ok(leftoverIsUnchanged(900, 1000));
  assert.ok(!leftoverIsUnchanged(9000, 1000), 'edited since: it is yours');
});
