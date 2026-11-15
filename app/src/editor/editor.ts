// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Puts the editor together: Markdown, live preview, tables, co-editing.

import { autocompletion, closeBrackets, closeBracketsKeymap, type CompletionContext, completionKeymap } from '@codemirror/autocomplete';
import { copyLineDown, copyLineUp, defaultKeymap, deleteLine, indentLess, indentMore, indentWithTab, insertBlankLine, moveLineDown, moveLineUp, selectLine } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { codeStyle } from './codestyle.ts';
import { findLanguage } from './langs.ts';
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap, selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';
import { Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { crosshairCursor, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder, rectangularSelection, type Command } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { UndoManager } from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { cycleHeading, toggleWrap } from './commands.ts';
import { autoCalc } from './autocalc.ts';
import { codeTitles, mkdocsBlocks } from './mkdocs.ts';
import { pictures, type ImageHooks } from './images.ts';
import { livePreview, plainFrontMatter, readingMode, wikiConfig } from './livepreview.ts';
import { type TableLabels, tablesExtension } from './tables.ts';

// Colours for Source mode (plain Markdown text, nicely coloured).
const sourceStyle = HighlightStyle.define([
  { tag: t.heading, color: 'var(--accent)', fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--c-function)' },
  { tag: [t.processingInstruction, t.contentSeparator, t.meta], color: 'var(--muted)' },
  { tag: t.quote, color: 'var(--muted)' },
  { tag: t.monospace, color: 'var(--c-string)' },
  { tag: t.labelName, color: 'var(--c-type)' },
]);

export interface EditorOptions {
  parent: HTMLElement;
  ytext: Y.Text;
  awareness: Awareness | null;
  readOnly: boolean;
  labels: () => TableLabels;
  hint: string;
  mode: ViewMode;
  /** Titles of the other notes (for [[links]]). */
  titles: () => string[];
  openLink: (title: string) => void;
  onChange?: () => void;
  images?: ImageHooks;
}

/** Cursors above or below every cursor (Ctrl+Alt+Up / Down in VS Code). */
const addCursor =
  (down: boolean): Command =>
  (view) => {
    const ranges = view.state.selection.ranges;
    const extra = ranges.map((r) => view.moveVertically(r, down));
    view.dispatch({ selection: EditorSelection.create([...ranges, ...extra], view.state.selection.mainIndex), scrollIntoView: true });
    return true;
  };

/** Ctrl+/ : turn the selected lines into <!-- comments --> and back. */
const toggleComment: Command = (view) => {
  const { state } = view;
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) lines.add(n);
  }
  const all = [...lines].map((n) => state.doc.line(n));
  const commented = (t: string) => /^\s*<!-- .* -->\s*$/.test(t);
  const off = all.every((l) => l.text.trim() === '' || commented(l.text));
  const changes = all
    .filter((l) => l.text.trim() !== '')
    .map((l) => ({
      from: l.from,
      to: l.to,
      insert: off ? l.text.replace(/<!-- (.*) -->/, '$1') : `<!-- ${l.text} -->`,
    }));
  view.dispatch({ changes });
  return true;
};

/** Editing like VS Code, for source mode. */
const vscodeEditing: Extension = [
  lineNumbers(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
  foldGutter(),
  rectangularSelection(),
  crosshairCursor(),
  EditorView.clickAddsSelectionRange.of((e) => e.altKey || e.ctrlKey || e.metaKey),
  keymap.of([
    { key: 'Alt-ArrowUp', run: moveLineUp },
    { key: 'Alt-ArrowDown', run: moveLineDown },
    { key: 'Shift-Alt-ArrowUp', run: copyLineUp },
    { key: 'Shift-Alt-ArrowDown', run: copyLineDown },
    { key: 'Mod-Shift-k', run: deleteLine },
    { key: 'Mod-Alt-ArrowUp', run: addCursor(false) },
    { key: 'Mod-Alt-ArrowDown', run: addCursor(true) },
    { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
    { key: 'Mod-Shift-l', run: selectSelectionMatches, preventDefault: true },
    { key: 'Mod-l', run: selectLine, preventDefault: true },
    { key: 'Mod-]', run: indentMore },
    { key: 'Mod-[', run: indentLess },
    { key: 'Mod-/', run: toggleComment, preventDefault: true },
    { key: 'Mod-Enter', run: insertBlankLine },
    ...foldKeymap,
  ]),
];

export type ViewMode = 'live' | 'read' | 'source';

export interface Editor {
  view: EditorView;
  setMode(mode: ViewMode): void;
  destroy(): void;
}

export function createEditor(o: EditorOptions): Editor {
  const undo = new UndoManager(o.ytext);
  // Typing [[ offers the titles of your notes.
  const wikiSource = (ctx: CompletionContext) => {
    const m = ctx.matchBefore(/\[\[[^\]\n]*/);
    if (!m) return null;
    const q = m.text.slice(2).toLowerCase();
    const options = o
      .titles()
      .filter((t) => t.toLowerCase().includes(q))
      .slice(0, 30)
      .map((label) => ({
        label,
        apply: (view: EditorView, _c: unknown, from: number, to: number) => {
          const closed = view.state.sliceDoc(to, to + 2) === ']]';
          view.dispatch({ changes: { from, to, insert: label + (closed ? '' : ']]') }, selection: { anchor: from + label.length + 2 } });
        },
      }));
    return { from: m.from + 2, options, filter: false, validFor: /^[^\]\n]*$/ };
  };
  const tables = tablesExtension(o.labels);
  const modeSlot = new Compartment();
  // What changes between the three ways of looking at a note.
  const forMode = (mode: ViewMode): Extension => {
    const locked = o.readOnly || mode === 'read';
    const common = [EditorState.readOnly.of(locked), EditorView.editable.of(!o.readOnly && mode !== 'read')];
    if (mode === 'source') return [common, syntaxHighlighting(sourceStyle), plainFrontMatter, vscodeEditing, EditorView.editorAttributes.of({ class: 'cm-source' })];
    return [common, livePreview, mkdocsBlocks, codeTitles, tables, readingMode.of(mode === 'read'), ...(o.images ? [pictures(o.images)] : [])];
  };
  const extensions = [
    modeSlot.of(forMode(o.mode)),
    yCollab(o.ytext, o.awareness, { undoManager: undo }),
    markdown({ base: markdownLanguage, codeLanguages: (info) => findLanguage(info), addKeymap: true }),
    syntaxHighlighting(codeStyle),
    autoCalc(o.awareness),
    EditorState.allowMultipleSelections.of(true),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion({ icons: false, override: [wikiSource] }),
    wikiConfig.of({ titles: o.titles, open: o.openLink }),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    EditorView.perLineTextDirection.of(true), // Arabic and English lines each get their own direction
    placeholder(o.hint),
    keymap.of([
      { key: 'Mod-b', run: (v) => toggleWrap(v, '**') },
      { key: 'Mod-i', run: (v) => toggleWrap(v, '*') },
      { key: 'Mod-e', run: (v) => toggleWrap(v, '`') },
      { key: 'Mod-Shift-x', run: (v) => toggleWrap(v, '~~') },
      { key: 'Mod-Alt-h', run: cycleHeading },
      ...yUndoManagerKeymap,
      ...markdownKeymap,
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...searchKeymap,
      ...defaultKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && o.onChange) o.onChange();
    }),
  ];
  const view = new EditorView({ parent: o.parent, state: EditorState.create({ doc: o.ytext.toString(), extensions }) });
  return {
    view,
    setMode: (mode) => view.dispatch({ effects: modeSlot.reconfigure(forMode(mode)) }),
    destroy: () => view.destroy(),
  };
}
