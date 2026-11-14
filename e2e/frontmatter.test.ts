// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The properties (YAML front matter) reader and writer.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFrontMatter, withProps, tagsOf } from '../app/src/lib/frontmatter.ts';

test('front matter: read, write back, add, remove', () => {
  const doc = `---\ntitle: "Plan: v2"\ntags:\n  - work\n  - urgent\naliases: [a, "b c"]\ndraft: true\ncount: 3\n---\n# Hello\n`;
  const fm = readFrontMatter(doc)!;
  assert.equal(fm.editable, true);
  assert.deepEqual(fm.props.map((p) => [p.key, p.type]), [['title','text'],['tags','list'],['aliases','list'],['draft','checkbox'],['count','number']]);
  assert.equal(fm.props[0].text, 'Plan: v2');
  assert.deepEqual(fm.props[2].items, ['a','b c']);
  assert.equal(withProps(doc, fm.props), doc.replace('aliases: [a, "b c"]','aliases:\n  - a\n  - b c'));
  assert.equal(withProps('# no fm\n', fm.props).startsWith('---\ntitle: "Plan: v2"'), true);
  assert.equal(withProps(doc, []), '# Hello\n');
  assert.deepEqual(tagsOf(doc), ['work','urgent']);
  assert.equal(readFrontMatter('# x\n---\na: 1\n---\n'), null);
  assert.equal(readFrontMatter('---\nnested:\n  a: 1\n---\nx')!.editable, false);


});
