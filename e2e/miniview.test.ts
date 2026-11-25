import { test } from 'node:test';
import assert from 'node:assert/strict';
import { miniBlocks } from '../app/src/lib/miniview.ts';

test('a note becomes rendered-looking blocks, not source', () => {
  const md = '---\ntitle: x\n---\n# Shopping\n\nSome **bold** and a [link](http://a.b) and [[Other]].\n\n- [ ] milk\n- [x] eggs\n  - sub\n1. first\n\n> quoted\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n![cat](_images/c.png)\n';
  const b = miniBlocks(md);
  assert.deepEqual(b[0], { t: 'h', level: 1, text: 'Shopping' });
  assert.deepEqual(b[1], { t: 'p', text: 'Some bold and a link and Other.' });
  assert.deepEqual(b.slice(2, 5).map((x) => x.t === 'li' && [x.task, x.depth]), [['open', 0], ['done', 0], [null, 1]]);
  assert.equal(b[5]!.t === 'li' && b[5]!.num, '1');
  assert.deepEqual(b[6], { t: 'quote', text: 'quoted' });
  assert.deepEqual(b[7], { t: 'table', rows: [['a', 'b'], ['1', '2']] });
  assert.deepEqual(b[8], { t: 'img', text: 'cat' });
  assert.ok(!JSON.stringify(b).includes('---'), 'no front matter');
});
test('Arabic and long notes are cut at the limit', () => {
  const md = Array.from({ length: 50 }, (_, i) => `- بند ${i}`).join('\n');
  assert.equal(miniBlocks(md, 6).length, 6);
});
