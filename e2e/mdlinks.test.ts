import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteLink, noteLinks, noteTarget, relativeTo, resolveDest, retarget, scanLinks, slug, writeDest } from '../app/src/lib/mdlinks.ts';

test('relative paths go up and down the folder tree', () => {
  assert.equal(relativeTo('', 'A/b.md'), 'A/b.md');
  assert.equal(relativeTo('A', 'A/b.md'), 'b.md');
  assert.equal(relativeTo('A/B', '_images/x.png'), '../../_images/x.png');
  assert.equal(relativeTo('A', 'C/d.md'), '../C/d.md');
  assert.equal(resolveDest('A/B', '../../_images/x.png')!.path, '_images/x.png');
  assert.equal(resolveDest('A', '../../x.md'), null, 'outside the notes folder');
  assert.equal(resolveDest('A', 'https://x.y/a.md'), null);
  assert.equal(resolveDest('', '#top'), null);
});

test('links are written readable and found again, Arabic and spaces included', () => {
  assert.equal(noteLink('', '', 'Shopping'), '[Shopping](Shopping.md)');
  assert.equal(noteLink('Work', '', 'My plan'), '[My plan](<../My plan.md>)');
  assert.equal(noteLink('', 'قوائم', 'التسوق'), '[التسوق](قوائم/التسوق.md)');
  assert.equal(noteLink('', '', 'Plan', 'Week 2'), '[Plan](Plan.md#week-2)');
  assert.equal(noteLink('', '', 'A', '', 'shown [x]'), '[shown \\[x\\]](A.md)');
  assert.equal(writeDest('a b.md'), '<a b.md>');
  assert.equal(slug('Week 2: Plan!'), 'week-2-plan');
  const t = '[a](<../My plan.md>) and [ب](قوائم/التسوق.md#x) and ![p](../_images/i.png) and [web](https://a.b/c.md) and `[no](in-code.md)`\n```\n[no](fenced.md)\n```';
  assert.deepEqual(noteLinks(t, 'Work'), [{ folder: '', title: 'My plan', frag: '' }, { folder: 'Work/قوائم', title: 'التسوق', frag: 'x' }]);
  assert.equal(scanLinks(t).filter((f) => f.image).length, 1);
  assert.deepEqual(noteTarget('A', '../B/c%20d.md'), { folder: 'B', title: 'c d', frag: '' });
});

test('a moved or renamed note: links to it follow, and its own links are rewritten for its new folder', () => {
  const t = 'See [x](Old.md) and [y](../Other/z.md) and ![i](../_images/p.png).';
  // the note Old moved: links to it elsewhere follow
  assert.equal(retarget(t, 'A', 'A', (p) => (p === 'Old.md' ? 'New/Old.md' : null)), null, 'A/Old.md is not Old.md');
  assert.equal(retarget('[x](Old.md)', '', '', (p) => (p === 'Old.md' ? 'New/Old.md' : null)), '[x](New/Old.md)');
  assert.equal(retarget('[x](<My old.md>)', '', '', (p) => (p === 'My old.md' ? 'My new.md' : null)), '[x](<My new.md>)');
  // this note moved from Work to Work/Sub: its own relative links gain a ../
  assert.equal(retarget(t, 'Work', 'Work/Sub', () => null), 'See [x](../Old.md) and [y](../../Other/z.md) and ![i](../../_images/p.png).');
  // web links and anchors are left alone
  assert.equal(retarget('[w](https://a.b/c.md) [t](#top)', 'A', 'B', () => null), null);
});
