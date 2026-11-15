import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addCard, addColumn, deleteCard, deleteColumn, editCard, isBoard, makeBoard, moveCard, parseBoard, renameColumn, toggleCard } from '../app/src/lib/kanban.ts';

const T = `---
kanban: board
---
# Work

## Todo
- [ ] write docs
  more detail here
- [ ] fix bug

## Doing
- [ ] review

## Done
- [x] ship
`;

test('detects boards and reads columns and cards', () => {
  assert.ok(isBoard(T));
  assert.ok(!isBoard('# plain\n## Todo\n- [ ] x'));
  const b = parseBoard(T);
  assert.deepEqual(b.columns.map((c) => c.title), ['Todo', 'Doing', 'Done']);
  assert.deepEqual(b.columns[0]!.cards.map((c) => c.text), ['write docs', 'fix bug']);
  assert.deepEqual(b.columns[0]!.cards[0]!.extra, ['more detail here']);
  assert.equal(b.columns[2]!.cards[0]!.done, true);
});

test('move a card between columns, with its detail lines', () => {
  const r = moveCard(T, 0, 0, 1, 0);
  const b = parseBoard(r);
  assert.deepEqual(b.columns[0]!.cards.map((c) => c.text), ['fix bug']);
  assert.deepEqual(b.columns[1]!.cards.map((c) => c.text), ['write docs', 'review']);
  assert.deepEqual(b.columns[1]!.cards[0]!.extra, ['more detail here']);
  // to an empty column, and to the end
  const r2 = moveCard(r, 1, 1, 0, 99);
  assert.deepEqual(parseBoard(r2).columns[0]!.cards.map((c) => c.text), ['fix bug', 'review']);
});

test('reorder inside a column', () => {
  const r = moveCard(T, 0, 0, 0, 2); // first card to the end
  assert.deepEqual(parseBoard(r).columns[0]!.cards.map((c) => c.text), ['fix bug', 'write docs']);
  const r2 = moveCard(T, 0, 1, 0, 0);
  assert.deepEqual(parseBoard(r2).columns[0]!.cards.map((c) => c.text), ['fix bug', 'write docs']);
});

test('add, edit, tick, delete cards', () => {
  let t = addCard(T, 1, 'new one');
  assert.deepEqual(parseBoard(t).columns[1]!.cards.map((c) => c.text), ['review', 'new one']);
  t = editCard(t, 1, 1, 'renamed card');
  t = toggleCard(t, 1, 1);
  assert.match(t, /- \[x\] renamed card/);
  t = deleteCard(t, 0, 0); // the one with detail lines
  assert.ok(!t.includes('more detail'));
  assert.deepEqual(parseBoard(t).columns[0]!.cards.map((c) => c.text), ['fix bug']);
  const empty = addCard(`${T}\n## Later\n`, 3, 'idea');
  assert.deepEqual(parseBoard(empty).columns[3]!.cards.map((c) => c.text), ['idea']);
});

test('columns: add, rename, delete; make any note a board', () => {
  let t = addColumn(T, 'Blocked');
  assert.deepEqual(parseBoard(t).columns.map((c) => c.title), ['Todo', 'Doing', 'Done', 'Blocked']);
  t = renameColumn(t, 3, 'Waiting');
  t = deleteColumn(t, 1);
  assert.deepEqual(parseBoard(t).columns.map((c) => c.title), ['Todo', 'Done', 'Waiting']);
  const m = makeBoard('# My list\n- [ ] a', ['To do', 'Doing', 'Done']);
  assert.ok(isBoard(m));
  assert.equal(parseBoard(m).columns.length, 3);
  assert.equal(makeBoard(m, ['x', 'y', 'z']), m);
  const withProps = makeBoard('---\ntags: [a]\n---\n## A\n- b', ['x', 'y', 'z']);
  assert.ok(isBoard(withProps) && parseBoard(withProps).columns.length === 1);
});

test('code fences and other text are left alone', () => {
  const t = '---\nkanban: board\n---\n## A\n- x\n```\n## not a column\n```\nsome prose\n- y\n';
  const b = parseBoard(t);
  assert.equal(b.columns.length, 1);
  assert.deepEqual(b.columns[0]!.cards.map((c) => c.text), ['x', 'y']);
});
