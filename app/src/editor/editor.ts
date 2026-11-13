// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Puts the editor together: Markdown, live preview, tables, co-editing.

import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { drawSelection, dropCursor, EditorView, keymap, placeholder } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { UndoManager } from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { cycleHeading, toggleWrap } from './commands.ts';
import { autoCalc } from './autocalc.ts';
import { livePreview } from './livepreview.ts';
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

export interface EditorOptions {
  parent: HTMLElement;
  ytext: Y.Text;
  awareness: Awareness | null;
  readOnly: boolean;
  labels: () => TableLabels;
  hint: string;
  onChange?: () => void;
}

export interface Editor {
  view: EditorView;
  destroy(): void;
}

export function createEditor(o: EditorOptions): Editor {
  const undo = new UndoManager(o.ytext);
  const extensions = [
    yCollab(o.ytext, o.awareness, { undoManager: undo }),
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
    syntaxHighlighting(codeStyle),
    livePreview,
    tablesExtension(o.labels),
    autoCalc(o.awareness),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion({ icons: false }),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    EditorView.perLineTextDirection.of(true), // Arabic and English lines each get their own direction
    EditorState.readOnly.of(o.readOnly),
    EditorView.editable.of(!o.readOnly),
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
  return { view, destroy: () => view.destroy() };
}
