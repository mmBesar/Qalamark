// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Puts the editor together: Markdown, live preview, tables, co-editing.

import { autocompletion, closeBrackets, closeBracketsKeymap, type CompletionContext, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { drawSelection, dropCursor, EditorView, keymap, placeholder } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { UndoManager } from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { cycleHeading, toggleWrap } from './commands.ts';
import { autoCalc } from './autocalc.ts';
import { livePreview, readingMode, wikiConfig } from './livepreview.ts';
import { type TableLabels, tablesExtension } from './tables.ts';

// Colours for code inside code blocks (other Markdown looks come from live preview).
const codeStyle = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: 'var(--c-keyword)' },
  { tag: [t.string, t.regexp, t.special(t.string)], color: 'var(--c-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--c-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--c-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)], color: 'var(--c-function)' },
  { tag: [t.typeName, t.className, t.tagName], color: 'var(--c-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--c-property)' },
]);

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
}

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
    if (mode === 'source') return [common, syntaxHighlighting(sourceStyle), EditorView.editorAttributes.of({ class: 'cm-source' })];
    return [common, livePreview, tables, readingMode.of(mode === 'read')];
  };
  const extensions = [
    modeSlot.of(forMode(o.mode)),
    yCollab(o.ytext, o.awareness, { undoManager: undo }),
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
    syntaxHighlighting(codeStyle),
    autoCalc(o.awareness),
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
