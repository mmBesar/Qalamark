// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Formatting commands for the toolbar and keyboard shortcuts.

import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** Wrap the selection in marks (or remove them if already there): **bold**, *italic* ... */
export function toggleWrap(view: EditorView, mark: string): boolean {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const before = state.sliceDoc(range.from - mark.length, range.from);
    const after = state.sliceDoc(range.to, range.to + mark.length);
    if (before === mark && after === mark) {
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

/** Put a prefix at the start of each selected line, or take it off if all have it. */
export function toggleLinePrefix(view: EditorView, prefix: string): boolean {
  const { state } = view;
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let p = state.doc.lineAt(r.from).number; p <= state.doc.lineAt(r.to).number; p++) lines.add(p);
  }
  const list = [...lines].map((n) => state.doc.line(n));
  const all = list.every((l) => l.text.startsWith(prefix));
  const changes = state.changes(list.map((l) => (all ? { from: l.from, to: l.from + prefix.length } : { from: l.from, insert: prefix })));
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
  callout: '> [!note] Title\n> [[cursor]]\n',
  admonition: '!!! note "Title"\n    [[cursor]]\n',
  collapsible: '??? tip "Title"\n    [[cursor]]\n',
  tabs: '=== "First"\n    [[cursor]]\n\n=== "Second"\n    \n',
  codeTitle: '```py title="example.py"\n[[cursor]]\n```\n',
} as const;
