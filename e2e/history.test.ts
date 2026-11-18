import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forget, lineDiff, snapshot, snapshots } from '../app/src/lib/history.ts';

const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

test('snapshots: skip duplicates and rapid ones, keep the newest 25', () => {
  assert.equal(snapshot('a', 'one', false, 1000), true);
  assert.equal(snapshot('a', 'one', false, 9e6), false, 'same text');
  assert.equal(snapshot('a', 'two', false, 1500), false, 'too soon');
  assert.equal(snapshot('a', 'two', true, 1500), true, 'forced');
  for (let i = 0; i < 40; i++) snapshot('a', 'v' + i, false, 1e7 + i * 1e6);
  const all = snapshots('a');
  assert.equal(all.length, 25);
  assert.equal(all[all.length - 1]!.text, 'v39');
  forget('a');
  assert.deepEqual(snapshots('a'), []);
});

test('snapshots: empty and huge notes are not kept', () => {
  assert.equal(snapshot('b', '   '), false);
  assert.equal(snapshot('b', 'x'.repeat(200_000)), false);
});

test('lineDiff counts changed lines', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nc\nd'), { added: 1, removed: 1 });
  assert.deepEqual(lineDiff('same', 'same'), { added: 0, removed: 0 });
});
