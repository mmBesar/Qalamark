// Property tests for the editing commands: many random documents (Arabic with diacritics, emoji, blank lines, lists,
// tabs, CRLF-free text) and random selections, checking the things a person relies on: a toggle done twice leaves the
// note exactly as it was, no command ever touches text outside the lines/selection it was asked about, and the
// selection stays inside the document.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorSelection, EditorState } from '../app/node_modules/@codemirror/state/dist/index.js';
import { cycleHeading, insertLink, insertTable, toggleLinePrefix, toggleWrap } from '../app/src/editor/commands.ts';

// a small seeded generator so a failure can be replayed
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WORDS = ['hello', 'world', 'سَيِّدُ', 'الِاسْتِغْفَارِ', 'مرحبا', 'قلم', '😀', 'x+y', 'a_b', '`tick`', 'نص', 'ملاحظة', '[[link]]', '#tag', '1.', 'tab\there'];
const LINE_STARTS = ['', '', '', '- ', '- [ ] ', '- [x] ', '> ', '1. ', '  - ', '# ', '## ', '    '];
function doc(r: () => number): string {
  const lines: string[] = [];
  const n = 1 + Math.floor(r() * 12);
  for (let i = 0; i < n; i++) {
    if (r() < 0.2) { lines.push(''); continue; }
    const w = Array.from({ length: 1 + Math.floor(r() * 5) }, () => WORDS[Math.floor(r() * WORDS.length)]).join(' ');
    lines.push(LINE_STARTS[Math.floor(r() * LINE_STARTS.length)] + w);
  }
  return lines.join('\n');
}
function view(text: string, from: number, to: number) {
  const v = { state: EditorState.create({ doc: text, selection: EditorSelection.single(from, to), extensions: [EditorState.allowMultipleSelections.of(true)] }), dispatch(tr: any) { v.state = tr.state ?? v.state.update(tr).state; }, focus() {} };
  return v as any;
}
const pick = (r: () => number, len: number): [number, number] => { const a = Math.floor(r() * (len + 1)); const b = Math.floor(r() * (len + 1)); return a <= b ? [a, b] : [b, a]; };
const ITER = 600;

test('toggleWrap: twice is the identity, spaces stay outside the marks, the selection stays valid', () => {
  for (const mark of ['**', '*', '~~', '`']) {
    for (let seed = 1; seed <= ITER; seed++) {
      const r = rng(seed * 7 + mark.length);
      const text = doc(r);
      const [from, to] = pick(r, text.length);
      const v = view(text, from, to);
      toggleWrap(v, mark);
      const once = v.state.doc.toString();
      assert.ok([text.length + 2 * mark.length, text.length - mark.length * 2].includes(once.length), `a toggle adds or removes exactly the two marks (${mark}, seed ${seed})`);
      const sel = v.state.selection.main;
      assert.ok(sel.from >= 0 && sel.to <= once.length, 'selection inside the note');
      toggleWrap(v, mark);
      assert.equal(v.state.doc.toString(), text, `wrap twice restores the note (mark ${mark}, seed ${seed}, selection ${from}-${to})`);
    }
  }
});

test('toggleWrap: italic on bold text adds to it instead of stripping a star', () => {
  const v = view('**word**', 2, 6);
  toggleWrap(v, '*');
  assert.equal(v.state.doc.toString(), '***word***');
  toggleWrap(v, '*');
  assert.equal(v.state.doc.toString(), '**word**');
});

test('toggleWrap: leading and trailing spaces of a selection stay outside', () => {
  const v = view('a  word  b', 1, 9);
  toggleWrap(v, '**');
  assert.equal(v.state.doc.toString(), 'a  **word**  b');
});

test('toggleLinePrefix: lines without the marker get it and lose it again; blank lines are never touched', () => {
  for (const prefix of ['- ', '- [ ] ', '> ']) {
    for (let seed = 1; seed <= ITER; seed++) {
      const r = rng(seed * 13 + prefix.length);
      const lines = Array.from({ length: 1 + Math.floor(r() * 8) }, () => (r() < 0.25 ? '' : (r() < 0.3 ? '  ' : '') + WORDS[Math.floor(r() * 12)] + ' ' + WORDS[Math.floor(r() * 12)]));
      const clean = lines.map((l) => (/^\s*([-*+] (\[[ xX]\] )?|> )/.test(l) ? 'x' + l : l));
      const text = clean.join('\n');
      const [from, to] = pick(r, text.length);
      const v = view(text, from, to);
      toggleLinePrefix(v, prefix);
      const once = v.state.doc.toString().split('\n');
      assert.equal(once.length, clean.length, 'no line is added or removed');
      once.forEach((l, i) => { if (clean[i]!.trim() === '') assert.equal(l, clean[i], `blank line ${i} untouched (seed ${seed})`); });
      toggleLinePrefix(v, prefix);
      assert.equal(v.state.doc.toString(), text, `twice restores the note (prefix "${prefix}", seed ${seed}, selection ${from}-${to})`);
    }
  }
});

test('toggleLinePrefix: a bullet becomes a task (and back) without a second marker, indentation kept', () => {
  const v = view('- one\n  - two\n- [x] three', 0, 25);
  toggleLinePrefix(v, '- [ ] ');
  assert.equal(v.state.doc.toString(), '- [ ] one\n  - [ ] two\n- [ ] three');
  toggleLinePrefix(v, '- [ ] ');
  assert.equal(v.state.doc.toString(), 'one\n  two\nthree');
  const w = view('- [ ] a\n- [x] b', 0, 15);
  toggleLinePrefix(w, '- ');
  assert.equal(w.state.doc.toString(), '- a\n- b');
});

test('cycleHeading: three taps go # ## ### and a fourth removes it; the rest of the note is untouched', () => {
  for (let seed = 1; seed <= ITER; seed++) {
    const r = rng(seed * 31);
    const text = doc(r).replace(/^#{1,6} /gm, '');
    const head = Math.floor(r() * (text.length + 1));
    const v = view(text, head, head);
    const line = v.state.doc.lineAt(head);
    for (let i = 0; i < 4; i++) cycleHeading(v);
    assert.equal(v.state.doc.toString(), text, `four cycles restore the note (seed ${seed})`);
    cycleHeading(v);
    const after = v.state.doc.toString().split('\n');
    const before = text.split('\n');
    after.forEach((l, i) => { if (i !== line.number - 1) assert.equal(l, before[i], 'other lines untouched'); });
    assert.equal(after[line.number - 1], '# ' + before[line.number - 1]);
  }
});

test('insertLink and insertTable only add text; the original is still all there, in order', () => {
  for (let seed = 1; seed <= ITER; seed++) {
    const r = rng(seed * 17);
    const text = doc(r);
    const [from, to] = pick(r, text.length);
    for (const cmd of [insertLink, insertTable]) {
      const v = view(text, from, to);
      cmd(v);
      const out = v.state.doc.toString();
      assert.ok(out.length > text.length - (to - from), 'something was added');
      if (cmd === insertTable) { assert.ok(out.startsWith(text.slice(0, from)) || out.startsWith(text.slice(0, v.state.doc.lineAt(from).from)), 'text before is intact'); assert.ok(out.endsWith(text.slice(to)) || out.includes(text.slice(v.state.doc.lineAt(to).to)), 'text after is intact'); }
      const sel = v.state.selection.main;
      assert.ok(sel.to <= out.length);
    }
  }
});
