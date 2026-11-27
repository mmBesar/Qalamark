// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasInline, parseInline } from '../app/src/editor/inline.ts';

test('table cell inline markdown', () => {
  assert.equal(hasInline(parseInline('plain 3.5')), false);
  assert.deepEqual(parseInline('a **b** c'), [{ t: 'text', s: 'a ' }, { t: 'b', kids: [{ t: 'text', s: 'b' }] }, { t: 'text', s: ' c' }]);
  assert.deepEqual(parseInline('`c`'), [{ t: 'code', s: 'c' }]);
  assert.deepEqual(parseInline('\\*not\\*'), [{ t: 'text', s: '*' }, { t: 'text', s: 'not' }, { t: 'text', s: '*' }]);
  assert.deepEqual(parseInline('snake_case_name'), [{ t: 'text', s: 'snake_case_name' }], 'underscores inside words stay');
  assert.deepEqual(parseInline('2 * 3 * 4'), [{ t: 'text', s: '2 * 3 * 4' }], 'a sum is not emphasis');
  assert.deepEqual(parseInline('[site](https://x.org "t")'), [{ t: 'a', kids: [{ t: 'text', s: 'site' }] }]);
  assert.deepEqual(parseInline('[[Note|alias]]'), [{ t: 'a', kids: [{ t: 'text', s: 'alias' }] }]);
  assert.deepEqual(parseInline('~~x~~ ==y=='), [{ t: 's', kids: [{ t: 'text', s: 'x' }] }, { t: 'text', s: ' ' }, { t: 'mark', kids: [{ t: 'text', s: 'y' }] }]);
});
