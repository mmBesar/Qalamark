import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cellOf, columnsOf, type NoteRow, parseBase, queryRows, setPropText } from '../app/src/lib/base.ts';
import { readFrontMatter } from '../app/src/lib/frontmatter.ts';

const row = (id: string, title: string, folder: string, doc: string): NoteRow => ({ id, title, folder, updated: 0, props: readFrontMatter(doc)?.props ?? [] });
const rows = [
  row('1', 'Alpha', 'Work', '---\nstatus: open\ndue: 2026-12-01\ndone: false\ntags: [work, urgent]\n---\nx'),
  row('2', 'Beta', 'Work/Sub', '---\nstatus: closed\ndue: 2026-11-01\ndone: true\n---\nx'),
  row('3', 'Gamma', 'Home', '---\nstatus: open\n---\nx'),
  row('4', 'Delta', '', 'no props'),
];

test('parse a base block', () => {
  const s = parseBase('folder: Work/\ntag: #urgent\nwhere: status = open\nwhere: due contains 2026\nshow: status, due\nsort: due desc\nlink: title');
  assert.equal(s.folder, 'Work');
  assert.equal(s.tag, 'urgent');
  assert.equal(s.where.length, 2);
  assert.deepEqual(s.show, ['status', 'due']);
  assert.deepEqual(s.sort, { key: 'due', desc: true });
});

test('filter by folder (with subfolders), tag and where', () => {
  assert.deepEqual(queryRows(parseBase('folder: Work'), rows).map((r) => r.title), ['Alpha', 'Beta']);
  assert.deepEqual(queryRows(parseBase('tag: urgent'), rows).map((r) => r.title), ['Alpha']);
  assert.deepEqual(queryRows(parseBase('where: status = open'), rows).map((r) => r.title), ['Alpha', 'Gamma']);
  assert.deepEqual(queryRows(parseBase('where: status != open'), rows).map((r) => r.title), ['Beta', 'Delta']);
});

test('sort puts notes without the property last', () => {
  assert.deepEqual(queryRows(parseBase('sort: due'), rows).map((r) => r.title), ['Beta', 'Alpha', 'Gamma', 'Delta']);
  assert.deepEqual(queryRows(parseBase('sort: due desc'), rows).map((r) => r.title), ['Alpha', 'Beta', 'Gamma', 'Delta']);
});

test('columns and cells', () => {
  assert.deepEqual(columnsOf(parseBase('show: status'), rows), ['title', 'status']);
  assert.deepEqual(columnsOf(parseBase('show: status, title'), rows), ['status', 'title']);
  assert.deepEqual(columnsOf(parseBase(''), rows).slice(0, 3), ['title', 'status', 'due']);
  assert.equal(cellOf(rows[0]!, 'done').type, 'checkbox');
  assert.equal(cellOf(rows[0]!, 'title').editable, false);
  assert.equal(cellOf(rows[3]!, 'status').text, '');
});

test('editing a cell changes only that property', () => {
  const doc = '---\nstatus: open\ndue: 2026-12-01\n---\n# Body\n';
  const next = setPropText(doc, 'status', 'text', 'closed');
  assert.equal(next, '---\nstatus: closed\ndue: 2026-12-01\n---\n# Body\n');
  assert.ok(setPropText('# plain\n', 'done', 'checkbox', 'true').startsWith('---\ndone: true\n---\n# plain'));
  assert.ok(setPropText(doc, 'tags', 'list', 'a, b').includes('tags:\n  - a\n  - b'));
});
