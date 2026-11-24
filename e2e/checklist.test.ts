// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addItem, addSub, indentItem, outdentItem, flatItems, addSection, clearDone, deleteItem, editItem, isChecklist, makeChecklist, moveItem, parseChecklist, renameSection, setAll, toggleItem } from '../app/src/lib/checklist.ts';

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

const NESTED = '---\nview: checklist\n---\n\n# Trip\n\n## Pack\n\n- [ ] clothes\n  - [x] shirts\n  - [ ] socks\n- [ ] charger\n\n### Bathroom\n\n- [ ] brush\n\n## Book\n\n- [ ] hotel\n';

test('a higher heading holds the lower ones, and subtasks nest under their item', () => {
  const c = parseChecklist(NESTED);
  assert.deepEqual(c.roots.map((s) => s.title), ['Trip']);
  assert.deepEqual(c.roots[0]!.children.map((s) => s.title), ['Pack', 'Book']);
  assert.deepEqual(c.roots[0]!.children[0]!.children.map((s) => s.title), ['Bathroom']);
  const clothes = c.sections.find((s) => s.title === 'Pack')!.items[0]!;
  assert.deepEqual(clothes.children.map((k) => k.text), ['shirts', 'socks']);
  assert.equal(clothes.end - clothes.line, 3);
  // tasks to do are the items without subtasks: shirts, socks, charger, brush, hotel
  assert.equal(c.total, 5);
  assert.equal(c.done, 1);
});

test('subtasks: ticking all of them ticks the parent, ticking the parent ticks all of them', () => {
  const c = parseChecklist(NESTED);
  const clothes = c.sections.find((s) => s.title === 'Pack')!.items[0]!;
  const socks = clothes.children[1]!;
  const a = toggleItem(NESTED, socks.line);
  assert.ok(a.includes('- [x] clothes'), 'parent follows the last subtask');
  const b = toggleItem(a, socks.line);
  assert.ok(b.includes('- [ ] clothes'), 'and goes back when one is undone');
  const d = toggleItem(NESTED, clothes.line);
  assert.ok(d.includes('  - [x] socks') && d.includes('  - [x] shirts'));
  assert.equal(toggleItem(d, clothes.line), NESTED.replace('  - [x] shirts', '  - [ ] shirts').replace('- [x] shirts', '- [ ] shirts'));
});

test('add a subtask, indent and outdent keep every other line', () => {
  const c = parseChecklist(NESTED);
  const charger = c.sections.find((s) => s.title === 'Pack')!.items[1]!;
  const sub = addSub(NESTED, charger.line, 'cable');
  assert.ok(sub.includes('- [ ] charger\n  - [ ] cable\n'));
  const out = outdentItem(sub, parseChecklist(sub).sections.find((s) => s.title === 'Pack')!.items[1]!.children[0]!.line);
  assert.equal(out, NESTED.replace('- [ ] charger\n', '- [ ] charger\n- [ ] cable\n'));
  const again = indentItem(out, flatItems(parseChecklist(out).sections.flatMap((s) => s.items)).find((i) => i.text === 'cable')!.line);
  assert.equal(again, sub);
  // a subtask added to a done item makes it undone
  const d = toggleItem(NESTED, parseChecklist(NESTED).sections.find((s) => s.title === 'Pack')!.items[0]!.line);
  const withNew = addSub(d, parseChecklist(d).sections.find((s) => s.title === 'Pack')!.items[0]!.line, 'hat');
  assert.ok(withNew.includes('- [ ] clothes'));
});

test('a section can be added under another one, one level lower', () => {
  const out = addSection(NESTED, 'Snacks', 1);
  const c = parseChecklist(out);
  assert.deepEqual(c.roots[0]!.children[0]!.children.map((s) => s.title), ['Bathroom', 'Snacks']);
  assert.ok(out.includes('### Snacks'));
});

test('the widget gets sections as headings with their tasks (and subsections inside)', async () => {
  const { widgetItems } = await import('../app/src/lib/widgets.ts');
  const text = '---\nview: checklist\n---\n# Kitchen\n- [ ] bread\n  - [x] toast\n## Fridge\n- [ ] milk\n# Home\n- [x] soap\n';
  const w = widgetItems(text);
  assert.deepEqual(w.map((x) => [x.head ? 'H' : 'T', x.text, x.depth]), [['H', 'Kitchen', 0], ['T', 'bread', 0], ['T', 'toast', 1], ['H', 'Fridge', 1], ['T', 'milk', 0], ['H', 'Home', 0], ['T', 'soap', 0]]);
  assert.equal(w.find((x) => x.text === 'bread').line, 4);
});
