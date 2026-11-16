// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Puts the editor together: Markdown, live preview, tables, co-editing.

import { autocompletion, closeBrackets, closeBracketsKeymap, type CompletionContext, completionKeymap } from '@codemirror/autocomplete';
import { copyLineDown, copyLineUp, defaultKeymap, deleteLine, indentLess, indentMore, indentWithTab, insertBlankLine, moveLineDown, moveLineUp, selectLine } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { codeStyle } from './codestyle.ts';
import { findLanguage } from './langs.ts';
import { bracketMatching, codeFolding, foldGutter, foldKeymap, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap, selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';
import { Compartment, EditorSelection, EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, type DecorationSet, ViewPlugin, type ViewUpdate, crosshairCursor, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder, rectangularSelection, type Command } from '@codemirror/view';
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
import { type BaseHooks, baseExtension } from './base.ts';
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
  openLink: (target: string) => void;
  /** Headings of the note called `note` (empty = this note), for [[Note#Heading]]. */
  headings?: (note: string) => Promise<string[]>;
  onChange?: () => void;
  images?: ImageHooks;
  /** More CodeMirror extensions (the page uses this to follow the cursor and scrolling). */
  extra?: Extension[];
  /** Lets a ```base block list your notes by their properties. */
  base?: BaseHooks;
  /** The “/” insert menu: what to offer (typed at the start of a line). */
  slash?: () => Array<{ label: string; keywords?: string; run: (view: EditorView) => void }>;
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

/** Pressing in the empty space beside the page (or above/below the text) starts a selection like pressing on the nearest text. */
const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const rtlLine = Decoration.line({ attributes: { dir: 'rtl' } });
const ltrLine = Decoration.line({ attributes: { dir: 'ltr' } });
/** Every paragraph runs in the direction of its first letter, so Arabic lines are right-to-left and the
 *  editor (which reads the direction from the line) places the cursor and selection correctly. */
const lineDirections = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView) {
      const out: Range<Decoration>[] = [];
      let last = -1;
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = view.state.doc.lineAt(pos);
          pos = line.to + 1;
          if (line.from === last) continue;
          last = line.from;
          const m = /\p{L}/u.exec(line.text);
          if (m) out.push((RTL.test(m[0]) ? rtlLine : ltrLine).range(line.from));
        }
      }
      return Decoration.set(out);
    }
  },
  { decorations: (v) => v.decorations },
);

const edgeClicks = ViewPlugin.fromClass(
  class {
    off: () => void;
    constructor(view: EditorView) {
      const down = (e: MouseEvent) => {
        if (e.button !== 0 || (e.target !== view.scrollDOM && e.target !== view.dom)) return;
        const r = view.contentDOM.getBoundingClientRect();
        if (!r.width) return;
        const x = Math.min(Math.max(e.clientX, r.left + 2), r.right - 2);
        const y = Math.min(Math.max(e.clientY, r.top + 2), r.bottom - 2);
        e.preventDefault();
        view.contentDOM.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1, detail: e.detail, clientX: x, clientY: y, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey }));
        view.focus();
      };
      view.scrollDOM.addEventListener('mousedown', down);
      view.dom.addEventListener('mousedown', down);
      this.off = () => {
        view.scrollDOM.removeEventListener('mousedown', down);
        view.dom.removeEventListener('mousedown', down);
      };
    }
    destroy() {
      this.off();
    }
  },
);

export function createEditor(o: EditorOptions): Editor {
  const undo = new UndoManager(o.ytext);
  // Typing [[ offers the titles of your notes.
  const wikiSource = async (ctx: CompletionContext) => {
    const m = ctx.matchBefore(/\[\[[^\]\n|]*/);
    if (!m) return null;
    const body = m.text.slice(2);
    const hash = body.indexOf('#');
    if (hash >= 0 && o.headings) {
      // [[Note#  ->  the headings of that note
      const note = body.slice(0, hash).trim();
      const q = body.slice(hash + 1).toLowerCase();
      const hs = await o.headings(note).catch(() => [] as string[]);
      const options = hs
        .filter((h) => h.toLowerCase().includes(q))
        .slice(0, 40)
        .map((label) => ({
          label,
          detail: '#',
          apply: (view: EditorView, _c: unknown, from: number, to: number) => {
            const closed = view.state.sliceDoc(to, to + 2) === ']]';
            view.dispatch({ changes: { from, to, insert: label + (closed ? '' : ']]') }, selection: { anchor: from + label.length + (closed ? 2 : 2) } });
          },
        }));
      return options.length ? { from: m.from + 2 + hash + 1, options, filter: false, validFor: /^[^\]\n|]*$/ } : null;
    }
    const q = body.toLowerCase();
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
    return { from: m.from + 2, options, filter: false, validFor: /^[^\]\n|#]*$/ };
  };
  // Typing / at the start of a line offers headings, lists, tables, boxes, code…
  const slashSource = (ctx: CompletionContext) => {
    if (!o.slash || o.readOnly) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    const m = /^\s*\/([^\s/]*)$/.exec(before);
    if (!m) return null;
    const q = m[1]!.toLowerCase();
    const from = line.from + before.indexOf('/');
    const options = o
      .slash()
      .filter((i) => !q || (i.label + ' ' + (i.keywords ?? '')).toLowerCase().includes(q))
      .map((i, n) => ({
        label: i.label,
        boost: -n,
        apply: (view: EditorView, _c: unknown, f: number, t: number) => {
          view.dispatch({ changes: { from: f, to: t, insert: '' } });
          i.run(view);
        },
      }));
    return options.length ? { from, options, filter: false, validFor: /^\/[^\s/]*$/ } : null;
  };
  const tables = tablesExtension(o.labels);
  const bases = o.base ? [baseExtension(o.base)] : [];
  const modeSlot = new Compartment();
  // What changes between the three ways of looking at a note.
  const forMode = (mode: ViewMode): Extension => {
    const locked = o.readOnly || mode === 'read';
    const common = [EditorState.readOnly.of(locked), EditorView.editable.of(!o.readOnly && mode !== 'read')];
    if (mode === 'source') return [common, syntaxHighlighting(sourceStyle), plainFrontMatter, vscodeEditing, EditorView.editorAttributes.of({ class: 'cm-source' })];
    return [common, livePreview, mkdocsBlocks, codeTitles, tables, ...bases, readingMode.of(mode === 'read'), ...(o.images ? [pictures(o.images)] : [])];
  };
  const extensions = [
    modeSlot.of(forMode(o.mode)),
    yCollab(o.ytext, o.awareness, { undoManager: undo }),
    markdown({ base: markdownLanguage, codeLanguages: (info) => findLanguage(info), addKeymap: true }),
    syntaxHighlighting(codeStyle),
    autoCalc(o.awareness),
    EditorState.allowMultipleSelections.of(true),
    drawSelection(),
    edgeClicks,
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion({ icons: false, override: [wikiSource, slashSource] }),
    wikiConfig.of({ titles: o.titles, open: o.openLink }),
    highlightSelectionMatches({ minSelectionLength: 3, wholeWords: true, highlightWordAroundCursor: false }),
    // Triple-click selects the line itself, not the line break (which dragged the cursor onto the next line).
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (e.detail !== 3 || e.button !== 0) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos == null) return false;
        const l = view.state.doc.lineAt(pos);
        view.dispatch({ selection: { anchor: l.from, head: l.to }, userEvent: 'select.pointer' });
        e.preventDefault();
        return true;
      },
    }),
    codeFolding({ placeholderText: '⋯' }),
    ...(o.extra ?? []),
    EditorView.lineWrapping,
    // each paragraph takes its own direction (Arabic lines run right to left), and the editor measures them that way
    EditorView.perLineTextDirection.of(true),
    lineDirections,
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
  (view.dom as HTMLElement & { cmEditorView?: EditorView }).cmEditorView = view; // for tests
  return {
    view,
    setMode: (mode) => view.dispatch({ effects: modeSlot.reconfigure(forMode(mode)) }),
    destroy: () => view.destroy(),
  };
}
