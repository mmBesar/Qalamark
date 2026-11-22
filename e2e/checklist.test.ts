// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addItem, addSection, clearDone, deleteItem, editItem, isChecklist, makeChecklist, moveItem, parseChecklist, renameSection, setAll, toggleItem } from '../app/src/lib/checklist.ts';

const NOTE = '---\nview: checklist\n---\n\n## Fruit\n\n- [ ] apples\n- [x] pears\n  a note under it\n\n## Dairy\n\n- [ ] milk\n';

test('a checklist is found by its property, and parsed into sections and items', () => {
  assert.ok(isChecklist(NOTE));
  assert.ok(!isChecklist('# hi\n- [ ] a'));
  const c = parseChecklist(NOTE);
  assert.deepEqual(c.sections.map((s) => s.title), ['Fruit', 'Dairy']);
  assert.equal(c.total, 3);
  assert.equal(c.done, 1);
  assert.equal(c.sections[0]!.items[1]!.end - c.sections[0]!.items[1]!.line, 2, 'the line under an item belongs to it');
});

test('toggle, edit, delete and add change only the lines they should', () => {
  const c = parseChecklist(NOTE);
  const apples = c.sections[0]!.items[0]!;
  assert.equal(toggleItem(NOTE, apples.line), NOTE.replace('- [ ] apples', '- [x] apples'));
  assert.equal(toggleItem(toggleItem(NOTE, apples.line), apples.line), NOTE);
  assert.equal(editItem(NOTE, apples.line, ' green apples '), NOTE.replace('apples', 'green apples'));
  assert.equal(deleteItem(NOTE, c.sections[0]!.items[1]!.line), NOTE.replace('- [x] pears\n  a note under it\n', ''));
  assert.equal(addItem(NOTE, 1, 'cheese'), NOTE.replace('- [ ] milk\n', '- [ ] milk\n- [ ] cheese\n'));
  assert.equal(addItem(NOTE, 0, 'plums'), NOTE.replace('  a note under it\n', '  a note under it\n- [ ] plums\n'));
});

test('reset, clear done, sections', () => {
  assert.equal(parseChecklist(setAll(NOTE, false)).done, 0);
  assert.equal(parseChecklist(setAll(NOTE, true)).done, 3);
  assert.equal(clearDone(NOTE), NOTE.replace('- [x] pears\n  a note under it\n', ''));
  assert.ok(addSection(NOTE, 'Bakery').endsWith('\n\n## Bakery\n'));
  assert.ok(renameSection(NOTE, 1, 'Milk & co').includes('## Milk & co'));
});

test('an empty section gets its first item under the heading; items above any heading work too', () => {
  const t = '---\nview: checklist\n---\n\n## Empty\n\n## Other\n- [ ] x\n';
  assert.equal(addItem(t, 0, 'first'), t.replace('## Empty\n', '## Empty\n- [ ] first\n'));
  const flat = makeChecklist('- [ ] a\n- [ ] b\n');
  assert.ok(isChecklist(flat));
  assert.equal(parseChecklist(flat).sections.length, 1);
  assert.equal(addItem(flat, 0, 'c').split('\n').filter((l) => l.startsWith('- [')).length, 3);
  const empty = makeChecklist('');
  assert.equal(parseChecklist(addItem(empty, 0, 'one')).total, 1);
});

test('moving an item to another section keeps everything else', () => {
  const c = parseChecklist(NOTE);
  const out = moveItem(NOTE, c.sections[0]!.items[1]!.line, 1);
  const d = parseChecklist(out);
  assert.deepEqual(d.sections.map((s) => s.items.map((i) => i.text)), [['apples'], ['milk', 'pears']]);
  assert.ok(out.includes('- [x] pears\n  a note under it'));
  assert.equal(d.total, 3);
  // and from below to above
  const back = moveItem(out, d.sections[1]!.items[0]!.line, 0);
  assert.deepEqual(parseChecklist(back).sections.map((s) => s.items.map((i) => i.text)), [['apples', 'milk'], ['pears']]);
});

test('code fences and other text are left alone', () => {
  const t = '---\nview: checklist\n---\n\nIntro\n\n```\n- [ ] not an item\n```\n\n## A\n- [ ] real\n';
  const c = parseChecklist(t);
  assert.equal(c.total, 1);
  assert.equal(setAll(t, true), t.replace('- [ ] real', '- [x] real'));
});

test('property: random operations never lose or invent items', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let round = 0; round < 200; round++) {
    let t = NOTE;
    let expect = 3;
    for (let k = 0; k < 12; k++) {
      const c = parseChecklist(t);
      const all = c.sections.flatMap((s) => s.items);
      const op = Math.floor(rnd() * 5);
      if (op === 0) { t = addItem(t, Math.floor(rnd() * c.sections.length), 'n' + k); expect++; }
      else if (op === 1 && all.length) { t = deleteItem(t, all[Math.floor(rnd() * all.length)]!.line); expect--; }
      else if (op === 2 && all.length) t = toggleItem(t, all[Math.floor(rnd() * all.length)]!.line);
      else if (op === 3 && all.length) t = moveItem(t, all[Math.floor(rnd() * all.length)]!.line, Math.floor(rnd() * c.sections.length));
      else if (op === 4) { t = clearDone(t); expect = parseChecklist(t).total; }
      assert.equal(parseChecklist(t).total, expect, `round ${round} step ${k}`);
    }
  }
});
