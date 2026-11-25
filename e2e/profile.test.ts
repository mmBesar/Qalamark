import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyConstructs } from '../app/src/lib/profile.ts';
import { SNIPPETS } from '../app/src/editor/commands.ts';
import { BUILT_IN } from '../app/src/lib/templates.ts';

test('the profile finder sees what is no longer written', () => {
  const md = '!!! note "T"\n    body\n\nSee [[Other]].\n\n> [!note] Title\n> x\n\n> [!NOTE]\n> fine\n\n```\n[[in code]]\n!!! not\n```\n';
  assert.deepEqual(legacyConstructs(md).map((x) => x.kind), ['admonition', 'wikilink', 'obsidian-callout']);
});

test('every snippet the app inserts stays on the profile', () => {
  for (const [name, text] of Object.entries(SNIPPETS)) assert.deepEqual(legacyConstructs(text.replace('[[cursor]]', '')), [], `snippet ${name}`);
  assert.ok(SNIPPETS.callout.startsWith('> [!NOTE]\n'), 'GitHub alert form');
});

test('every built-in template stays on the profile', () => {
  for (const t of BUILT_IN) {
    const bodies: string[] = [];
    for (const v of Object.values(t)) { if (typeof v === 'string') bodies.push(v); else if (v && typeof v === 'object') for (const w of Object.values(v as Record<string, unknown>)) if (typeof w === 'string') bodies.push(w); }
    for (const b of bodies) assert.deepEqual(legacyConstructs(b), [], `template ${t.id ?? ''}`);
  }
});
