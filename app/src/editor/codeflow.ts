// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Working with code blocks: typing ``` and Enter closes the block, Ctrl+Enter steps out below it, and the language in the
// block's corner can be changed from a small list.

import { syntaxTree } from '@codemirror/language';
import { EditorSelection, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** The languages offered in the list, in the order people reach for them (any other word can be typed). */
export const LANG_CHOICES = [
  'bash', 'python', 'javascript', 'typescript', 'json', 'yaml', 'toml', 'html', 'css', 'sql', 'rust', 'go', 'c', 'cpp', 'java',
  'kotlin', 'php', 'ruby', 'nix', 'dockerfile', 'nginx', 'conf', 'ini', 'powershell', 'diff', 'markdown', 'xml', 'text',
];

const FENCE = /^([ \t>]*)(`{3,}|~{3,})[ \t]*([^\s{`]*)/;

/** The fenced block around a position: where it starts and ends, and whether it has its closing fence. */
export function fenceAround(state: EditorState, pos: number): { from: number; to: number; open: number; close: number | null } | null {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name !== 'FencedCode') continue;
    const open = state.doc.lineAt(n.from);
    const last = state.doc.lineAt(n.to);
    const m = FENCE.exec(open.text);
    const closed = last.number > open.number && !!m && new RegExp('^[ \\t>]*' + m[2]![0] + '{' + m[2]!.length + ',}[ \\t]*$').test(last.text);
    return { from: n.from, to: n.to, open: open.number, close: closed ? last.number : null };
  }
  return null;
}

/** Enter at the end of an opening fence line with no closing line: add the closing fence and put the cursor inside. */
export function closeFence(view: EditorView): boolean {
  const { state } = view;
  const r = state.selection.main;
  if (!r.empty) return false;
  const line = state.doc.lineAt(r.head);
  const m = FENCE.exec(line.text);
  if (!m || r.head !== line.to) return false;
  const f = fenceAround(state, line.from);
  // only an opening line that nothing closes (the block is open to the end of the note)
  if (!f || f.open !== line.number || f.close !== null) return false;
  const lead = m[1]!;
  const insert = '\n' + lead + '\n' + lead + m[2]!;
  view.dispatch({ changes: { from: line.to, insert }, selection: { anchor: line.to + 1 + lead.length }, userEvent: 'input', scrollIntoView: true });
  return true;
}

/** Ctrl+Enter inside a block: step out below its closing fence (making a line there if the note ends). */
export function leaveCode(view: EditorView): boolean {
  const { state } = view;
  const f = fenceAround(state, state.selection.main.head);
  if (!f) return false;
  const end = state.doc.line(f.close ?? state.doc.lineAt(f.to).number);
  if (end.number === state.doc.lines) {
    view.dispatch({ changes: { from: end.to, insert: '\n' }, selection: EditorSelection.cursor(end.to + 1), userEvent: 'input', scrollIntoView: true });
  } else {
    view.dispatch({ selection: EditorSelection.cursor(state.doc.line(end.number + 1).from), scrollIntoView: true });
  }
  return true;
}

/** Change the language word on the opening fence line (the line number given). */
export function setFenceLang(view: EditorView, openLine: number, lang: string): void {
  if (openLine < 1 || openLine > view.state.doc.lines) return;
  const line = view.state.doc.line(openLine);
  const m = FENCE.exec(line.text);
  if (!m) return;
  const from = line.from + m[0].length - m[3]!.length;
  view.dispatch({ changes: { from, to: line.from + m[0].length, insert: lang.replace(/[\s`{]/g, '') }, userEvent: 'input.format' });
}

/** A new block at the cursor, with the cursor inside. */
export function insertCode(view: EditorView, lang = ''): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const empty = line.text.trim() === '';
  const lead = empty ? '' : '\n\n';
  const head = '```' + lang + '\n';
  const from = empty ? line.from : line.to;
  view.dispatch({
    changes: { from, to: empty ? line.to : from, insert: lead + head + '\n```\n' },
    selection: { anchor: from + lead.length + head.length },
    userEvent: 'input.format',
    scrollIntoView: true,
  });
  view.focus();
  return true;
}
