// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Formatting commands for the toolbar and keyboard shortcuts.

import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** Wrap the selection in marks (or remove them if already there): **bold**, *italic* ... */
export function toggleWrap(view: EditorView, mark: string): boolean {
  const { state } = view;
  const changes = state.changeByRange((r) => {
    // spaces at the edges of the selection stay outside the marks: "** word **" is not bold
    let from = r.from;
    let to = r.to;
    while (from < to && /\s/.test(state.sliceDoc(from, from + 1))) from++;
    while (to > from && /\s/.test(state.sliceDoc(to - 1, to))) to--;
    const range = from === to && r.from !== r.to ? EditorSelection.range(r.from, r.from) : EditorSelection.range(from, to);
    const before = state.sliceDoc(range.from - mark.length, range.from);
    const after = state.sliceDoc(range.to, range.to + mark.length);
    // *italic* around **bold** is not "already italic": a run of stars counts, an odd run means the italic star is there
    // (*x* = 1, ***x*** = 3, **x** = 2 does not have it)
    const run = (at: number, dir: 1 | -1) => { let n = 0; while (n < 8 && state.sliceDoc(dir > 0 ? at + n : at - n - 1, dir > 0 ? at + n + 1 : at - n) === '*') n++; return n; };
    const stars = mark === '*' ? Math.min(run(range.from, -1), run(range.to, 1)) : 1;
    const outer = mark === '*' && stars % 2 === 0;
    if (before === mark && after === mark && !outer) {
      return {
        changes: [
          { from: range.from - mark.length, to: range.from },
          { from: range.to, to: range.to + mark.length },
        ],
        range: EditorSelection.range(range.from - mark.length, range.to - mark.length),
      };
    }
    return {
      changes: [
        { from: range.from, insert: mark },
        { from: range.to, insert: mark },
      ],
      range: EditorSelection.range(range.from + mark.length, range.to + mark.length),
    };
  });
  view.dispatch(state.update(changes, { userEvent: 'input.format', scrollIntoView: true }));
  view.focus();
  return true;
}

/** A horizontal rule on its own line, with the cursor below it. */
export function insertRule(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const blank = line.text.trim() === '';
  const insert = (blank ? '' : '\n\n') + '---\n\n';
  const at = blank ? line.from : line.to;
  view.dispatch({ changes: { from: at, to: blank ? line.to : at, insert }, selection: { anchor: at + insert.length }, userEvent: 'input.format', scrollIntoView: true });
  view.focus();
  return true;
}

/** [[ ]] with the cursor inside (or around the selected text). */
export function insertWikilink(view: EditorView): boolean {
  const r = view.state.selection.main;
  const text = view.state.sliceDoc(r.from, r.to);
  view.dispatch({
    changes: { from: r.from, to: r.to, insert: `[[${text}]]` },
    selection: { anchor: r.from + 2, head: r.from + 2 + text.length },
    userEvent: 'input.format',
  });
  view.focus();
  return true;
}

/** Make the lines one level deeper or shallower (two spaces, like the lists the app writes). */
export function shiftLines(view: EditorView, dir: 1 | -1): boolean {
  const { state } = view;
  const nums = new Set<number>();
  for (const r of state.selection.ranges) for (let p = state.doc.lineAt(r.from).number; p <= state.doc.lineAt(r.to).number; p++) nums.add(p);
  const specs: Array<{ from: number; to?: number; insert?: string }> = [];
  for (const n of nums) {
    const l = state.doc.line(n);
    if (dir > 0) specs.push({ from: l.from, insert: '  ' });
    else {
      const m = /^( {1,2}|\t)/.exec(l.text);
      if (m) specs.push({ from: l.from, to: l.from + m[0].length });
    }
  }
  const changes = state.changes(specs);
  view.dispatch({ changes, selection: state.selection.map(changes, 1), userEvent: 'input.format' });
  view.focus();
  return true;
}

const BULLET = /^(\s*)[-*+] (?!\[[ xX]\] )/;
const TASK = /^(\s*)[-*+] \[[ xX]\] /;

/**
 * Turn the selected lines into a list, a task list or a quote, or back into plain lines when they all are already.
 * Blank lines are left alone, a bullet becomes a task (and the other way round) instead of getting a second marker,
 * and indentation stays where it was.
 */
export function toggleLinePrefix(view: EditorView, prefix: string): boolean {
  const { state } = view;
  const nums = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let p = state.doc.lineAt(r.from).number; p <= state.doc.lineAt(r.to).number; p++) nums.add(p);
  }
  let lines = [...nums].map((n) => state.doc.line(n)).filter((l) => l.text.trim() !== '');
  // on an empty line there is nothing to turn into a list: start an empty item, ready to be filled in
  if (lines.length === 0) lines = [...nums].map((n) => state.doc.line(n));
  const kind = prefix === '- [ ] ' ? 'task' : prefix === '- ' ? 'bullet' : 'other';
  const has = (t: string) => (kind === 'task' ? TASK.test(t) : kind === 'bullet' ? BULLET.test(t) : t.startsWith(prefix));
  const all = lines.length > 0 && lines.every((l) => has(l.text));
  const specs = lines.map((l) => {
    if (kind === 'other') return all ? { from: l.from, to: l.from + prefix.length } : { from: l.from, insert: prefix };
    const m = TASK.exec(l.text) ?? BULLET.exec(l.text);
    const indent = /^\s*/.exec(l.text)![0].length;
    if (all) return { from: l.from + indent, to: l.from + (m ? m[0].length : indent) };
    // a bullet becomes a task and a task a bullet: swap the marker, keep the text
    return m ? { from: l.from + indent, to: l.from + m[0].length, insert: prefix } : { from: l.from + indent, insert: prefix };
  });
  const changes = state.changes(specs);
  // assoc 1: the cursor stays AFTER what was added, so you can type right away.
  view.dispatch({ changes, selection: state.selection.map(changes, 1), userEvent: 'input.format' });
  view.focus();
  return true;
}

/** # -> ## -> ### -> none */
export function cycleHeading(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const m = /^(#{1,6})\s/.exec(line.text);
  const level = m ? m[1]!.length : 0;
  const next = level >= 3 ? 0 : level + 1;
  const changes = state.changes({ from: line.from, to: line.from + (m ? m[0].length : 0), insert: next ? '#'.repeat(next) + ' ' : '' });
  view.dispatch({ changes, selection: state.selection.map(changes, 1), userEvent: 'input.format' });
  view.focus();
  return true;
}

export function insertLink(view: EditorView): boolean {
  const { state } = view;
  const r = state.selection.main;
  const text = state.sliceDoc(r.from, r.to) || 'link';
  const insert = `[${text}](https://)`;
  view.dispatch({
    changes: { from: r.from, to: r.to, insert },
    selection: EditorSelection.range(r.from + text.length + 3, r.from + insert.length - 1),
    userEvent: 'input.format',
  });
  view.focus();
  return true;
}

export function insertTable(view: EditorView): boolean {
  const { state } = view;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const lead = line.text.trim() === '' ? '' : '\n\n';
  const table = '| A   | B   | C   |\n| --- | --- | --- |\n|     |     |     |\n|     |     |     |\n';
  const from = line.text.trim() === '' ? line.from : line.to;
  view.dispatch({
    changes: { from, insert: lead + table },
    selection: { anchor: from + lead.length + 2 },
    userEvent: 'input.format',
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

/** Put a block of text on its own lines at the cursor, with the cursor at `[[cursor]]`. */
export function insertSnippet(view: EditorView, snippet: string): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const empty = line.text.trim() === '';
  const lead = empty ? '' : '\n\n';
  const at = snippet.indexOf('[[cursor]]');
  const text = snippet.replace('[[cursor]]', '');
  const from = empty ? line.from : line.to;
  view.dispatch({
    changes: { from, to: empty ? line.to : from, insert: lead + text },
    selection: { anchor: from + lead.length + (at < 0 ? text.length : at) },
    userEvent: 'input.format',
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

export const SNIPPETS = {
  callout: '> [!NOTE]\n> [[cursor]]\n',
  collapsible: '??? tip "Title"\n    [[cursor]]\n',
  tabs: '=== "First"\n    [[cursor]]\n\n=== "Second"\n    \n',
  codeTitle: '```py title="example.py"\n[[cursor]]\n```\n',
  codeBlock: '```\n[[cursor]]\n```\n',
} as const;
