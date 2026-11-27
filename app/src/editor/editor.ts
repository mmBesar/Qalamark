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
import { Compartment, EditorSelection, Prec, EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, type DecorationSet, ViewPlugin, type ViewUpdate, crosshairCursor, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder, rectangularSelection, runScopeHandlers, type Command } from '@codemirror/view';
import { latinKey } from '../lib/keys.ts';
import { tags as t } from '@lezer/highlight';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { UndoManager } from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { cycleHeading, toggleWrap } from './commands.ts';
import { autoCalc } from './autocalc.ts';
import { codeTitles, mkdocsBlocks } from './mkdocs.ts';
import { pictures, type ImageHooks } from './images.ts';
import { noteLink } from '../lib/mdlinks.ts';
import { livePreview, plainFrontMatter, readingMode, wikiConfig } from './livepreview.ts';
import { type BaseHooks, baseExtension } from './base.ts';
import { closeFence, leaveCode } from './codeflow.ts';
import { type TableLabels, tablesExtension } from './tables.ts';

// Colours for Source mode (plain Markdown text, nicely coloured).
/** Move (or extend) each cursor to the first or last character of its line, unless the line is wrapped over several rows. */
function lineEdge(end: boolean, extend: boolean): Command {
  return (view) => {
    let wrapped = false;
    const sel = EditorSelection.create(view.state.selection.ranges.map((r) => {
      const line = view.state.doc.lineAt(r.head);
      const a = view.coordsAtPos(line.from, 1), b = view.coordsAtPos(line.to, -1);
      if (a && b && Math.abs(a.top - b.top) > 4) wrapped = true;
      const to = end ? line.to : line.from;
      return extend ? EditorSelection.range(r.anchor, to) : EditorSelection.cursor(to);
    }), view.state.selection.mainIndex);
    if (wrapped) return false;
    view.dispatch({ selection: sel, scrollIntoView: true, userEvent: 'select' });
    return true;
  };
}

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
  /** Where each other note lives, and the folder of this one: `[[` writes standard relative links. */
  places?: () => Array<{ title: string; folder: string }>;
  folder?: () => string;
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
/** Lines with Arabic diacritics. WebKitGTK (the engine of the Linux app) draws the words of such a line shifted up and
 *  down when the line keeps its spaces (white-space: pre-wrap, which the editor needs), but not when spaces collapse,
 *  so these lines get a class the style sheet uses on that engine. */
const TASHKEEL = /[\u064B-\u065F\u0670\u06D6-\u06ED]/;
const tashkeelLine = Decoration.line({ class: 'qm-tashkeel' });
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
          // the task box [x] holds a Latin letter, which must not decide the direction of an Arabic task
          const m = /\p{L}/u.exec(line.text.replace(/^\s*(?:[-*+]|\d+[.)])?\s*\[[ xX]\]/, ''));
          if (m) out.push((RTL.test(m[0]) ? rtlLine : ltrLine).range(line.from));
          if (TASHKEEL.test(line.text)) out.push(tashkeelLine.range(line.from));
        }
      }
      return Decoration.set(out);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Words for the little menu that opens from the selection handles (set by the page, so they follow the language). */
let touchLabels = { cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all' };
export function setTouchLabels(l: typeof touchLabels): void {
  touchLabels = l;
}
async function clipText(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}

/** On a touch screen: two draggable handles at the ends of the selection (like every mobile editor), so a
 *  selection can be started with a long press and then stretched to exactly the text wanted. */
const touchHandles = ViewPlugin.fromClass(
  class {
    a = document.createElement('div');
    b = document.createElement('div');
    c = document.createElement('div'); // the caret's own handle
    menu = document.createElement('div');
    menuOn = false;
    caretOn = false;
    caretTimer = 0;
    moved = 0;
    touch = false;
    anchor = 0;
    drag: HTMLElement | null = null;
    off: () => void;
    constructor(readonly view: EditorView) {
      this.menu.className = 'qm-touchmenu';
      this.menu.style.display = 'none';
      this.menu.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the focus and the selection
      view.scrollDOM.append(this.menu);
      this.c.classList.add('qm-caret');
      for (const h of [this.a, this.b, this.c]) {
        h.classList.add('qm-handle');
        h.style.display = 'none';
        h.addEventListener('pointerdown', (e) => this.down(e, h));
        h.addEventListener('pointermove', (e) => this.move(e));
        h.addEventListener('pointerup', (e) => this.up(e, h));
        h.addEventListener('pointercancel', (e) => this.up(e, h));
        view.scrollDOM.append(h);
      }
      const seen = (e: PointerEvent) => {
        if (e.target instanceof Node && (this.a.contains(e.target) || this.b.contains(e.target) || this.c.contains(e.target) || this.menu.contains(e.target))) return;
        this.touch = e.pointerType === 'touch';
        this.menuOn = false;
        // a tap on text shows the caret's handle for a few seconds: tap it for paste / select all
        this.caretOn = this.touch && view.state.selection.main.empty;
        clearTimeout(this.caretTimer);
        if (this.caretOn) this.caretTimer = window.setTimeout(() => { this.caretOn = false; this.menuOn = false; this.place(); }, 6000);
        if (!this.touch) this.place();
        else setTimeout(() => this.place(), 60);
      };
      view.dom.addEventListener('pointerdown', seen, true);
      this.off = () => view.dom.removeEventListener('pointerdown', seen, true);
    }
    down(e: PointerEvent, h: HTMLElement) {
      e.preventDefault();
      e.stopPropagation();
      const m = this.view.state.selection.main;
      this.anchor = h === this.a ? m.to : m.from;
      this.drag = h;
      this.moved = 0;
      this.menuOn = false;
      this.place();
      h.setPointerCapture(e.pointerId);
    }
    move(e: PointerEvent) {
      if (!this.drag) return;
      e.preventDefault();
      // the finger covers what it touches: aim a little above it
      this.moved++;
      const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY - 26 }, false);
      this.view.dispatch({ selection: this.drag === this.c ? EditorSelection.cursor(pos) : EditorSelection.range(this.anchor, pos), userEvent: 'select.pointer' });
    }
    up(e: PointerEvent, h: HTMLElement) {
      if (!this.drag) return;
      this.drag = null;
      // a tap on a handle (not a drag) opens or closes the menu; after a drag the menu comes back by itself
      this.menuOn = this.moved < 3 ? !this.menuOn : true;
      this.place();
      try {
        h.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    }
    update(u: ViewUpdate) {
      if (u.docChanged) {
        this.menuOn = false;
        this.caretOn = false;
      }
      if (u.selectionSet && this.touch && !u.docChanged && !this.drag) {
        const m = u.state.selection.main;
        // a selection made by a long press opens the menu at once, like the system's own editors
        if (!m.empty && u.transactions.some((t) => t.isUserEvent('select'))) this.menuOn = true;
        else if (m.empty) this.menuOn = false;
      }
      if (u.selectionSet || u.docChanged || u.geometryChanged || u.viewportChanged || u.focusChanged) this.place();
    }
    items(): Array<[string, () => void | Promise<void>]> {
      const v = this.view;
      const m = v.state.selection.main;
      const ro = v.state.readOnly;
      const text = () => v.state.sliceDoc(m.from, m.to);
      const out: Array<[string, () => void | Promise<void>]> = [];
      if (!m.empty && !ro) out.push([touchLabels.cut, async () => { await navigator.clipboard.writeText(text()); v.dispatch({ changes: { from: m.from, to: m.to, insert: '' } }); }]);
      if (!m.empty) out.push([touchLabels.copy, async () => { await navigator.clipboard.writeText(text()); }]);
      if (!ro) out.push([touchLabels.paste, async () => { const p = await clipText(); if (p) v.dispatch({ ...v.state.replaceSelection(p), userEvent: 'input.paste', scrollIntoView: true }); }]);
      out.push([touchLabels.selectAll, () => { v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }); this.menuOn = true; }]);
      return out;
    }
    drawMenu(x: number, y: number) {
      const menu = this.menu;
      menu.replaceChildren();
      for (const [label, run] of this.items()) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', async () => {
          this.menuOn = false;
          await run();
          this.view.focus();
          this.place();
        });
        menu.append(b);
      }
      menu.style.display = 'flex';
      const w = menu.offsetWidth || 220;
      const box = this.view.scrollDOM.getBoundingClientRect().width;
      menu.style.transform = `translate(${Math.max(6, Math.min(box - w - 6, x - w / 2))}px, ${y}px)`;
    }
    place() {
      const view = this.view;
      view.requestMeasure({
        read: () => {
          const m = view.state.selection.main;
          if (!this.touch) return null;
          const r = view.scrollDOM.getBoundingClientRect();
          const f = view.coordsAtPos(m.from, 1);
          const t = view.coordsAtPos(m.to, -1);
          if (!f || !t) return null;
          return { empty: m.empty, fx: f.left - r.left, fy: f.bottom - r.top, ftop: f.top - r.top, tx: t.left - r.left, ty: t.bottom - r.top, focus: view.hasFocus };
        },
        write: (v) => {
          const range = !!v && !v.empty;
          const caret = !!v && v.empty && this.caretOn && v.focus;
          this.a.style.display = this.b.style.display = range ? '' : 'none';
          this.c.style.display = caret ? '' : 'none';
          if (!v || (!range && !caret)) {
            this.menu.style.display = 'none';
            return;
          }
          if (range) {
            this.a.style.transform = `translate(${v.fx}px, ${v.fy}px)`;
            this.b.style.transform = `translate(${v.tx}px, ${v.ty}px)`;
          } else {
            this.c.style.transform = `translate(${v.fx}px, ${v.fy}px)`;
          }
          if (this.menuOn) {
            // above the selection, or below it when there is no room at the top of the page
            const top = v.ftop - 52;
            const abs = this.view.scrollDOM.getBoundingClientRect().top + top;
            this.drawMenu(range ? (v.fx + v.tx) / 2 : v.fx, abs > 64 ? top : v.ty + 34);
          } else this.menu.style.display = 'none';
        },
      });
    }
    destroy() {
      this.off();
      this.a.remove();
      this.b.remove();
      this.c.remove();
      this.menu.remove();
      clearTimeout(this.caretTimer);
    }
  },
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
  /** The standard link to a note (and a heading in it): relative to this note, so it keeps working when the folder moves. */
  const linkFor = (title: string, heading: string): string => {
    const here = o.folder?.() ?? '';
    const note = (o.places?.() ?? []).find((n) => n.title.toLowerCase() === (title || '').toLowerCase());
    return noteLink(here, note?.folder ?? here, note?.title ?? title, heading);
  };
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
            const note = body.slice(0, hash).trim();
            const link = linkFor(note, label);
            const start = m.from;
            const end = to + (closed ? 2 : 0);
            view.dispatch({ changes: { from: start, to: end, insert: link }, selection: { anchor: start + link.length } });
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
          const link = linkFor(label, '');
          const start = m.from;
          const end = to + (closed ? 2 : 0);
          view.dispatch({ changes: { from: start, to: end, insert: link }, selection: { anchor: start + link.length } });
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
  const selDraw = new Compartment();
  const fine = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches && !/Android/i.test(navigator.userAgent);
  let drawn = false;
  const extensions = [
    modeSlot.of(forMode(o.mode)),
    yCollab(o.ytext, o.awareness, { undoManager: undo }),
    markdown({ base: markdownLanguage, codeLanguages: (info) => findLanguage(info), addKeymap: true }),
    syntaxHighlighting(codeStyle),
    autoCalc(o.awareness),
    EditorState.allowMultipleSelections.of(true),
    // The drawn selection (needed for several cursors and for touch handles) misses numbers inside Arabic lines, so on a computer
    // with a mouse a single selection is shown by the browser itself, which gets mixed directions right. Several cursors switch the
    // drawn one back on.
    selDraw.of(fine ? [] : drawSelection()),
    ViewPlugin.fromClass(class {
      constructor(readonly view: EditorView) {}
      update(u: ViewUpdate) {
        if (!fine || !u.selectionSet) return;
        const multi = u.state.selection.ranges.length > 1;
        if (multi === drawn) return;
        drawn = multi;
        queueMicrotask(() => this.view.dispatch({ effects: selDraw.reconfigure(multi ? [drawSelection()] : []) }));
      }
    }),
    edgeClicks,
    touchHandles,
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion({ icons: false, override: [wikiSource, slashSource] }),
    wikiConfig.of({ titles: o.titles, open: o.openLink, folder: o.folder }),
    highlightSelectionMatches({ minSelectionLength: 3, wholeWords: true, highlightWordAroundCursor: false }),
    // Triple-click selects the line itself, not the line break (which dragged the cursor onto the next line).
    // Home and End go to the start and end of the line as it is written (the first and last character), also on lines that mix
    // Arabic and numbers or Latin words, where the default visual rule stopped in the middle. Wrapped lines keep the default.
    Prec.high(keymap.of([
      { key: 'Enter', run: closeFence },
      { key: 'Mod-Enter', run: leaveCode },
      { key: 'Home', shift: lineEdge(false, true), run: lineEdge(false, false) },
      { key: 'End', shift: lineEdge(true, true), run: lineEdge(true, false) },
    ])),
    EditorView.domEventHandlers({
      // shortcuts follow the physical key, so Ctrl+Z, Ctrl+B ... work with an Arabic (or any other) keyboard layout on
      keydown(e, view) {
        if (!(e.ctrlKey || e.metaKey || e.altKey) || e.key.length !== 1 && !/^[^\x00-\x7f]/.test(e.key)) return false;
        const k = latinKey(e);
        if (k === e.key || k === e.key.toLowerCase()) return false;
        const ne = new KeyboardEvent('keydown', { key: e.shiftKey ? k.toUpperCase() : k, code: e.code, keyCode: e.keyCode, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, cancelable: true });
        if (runScopeHandlers(view, ne, 'editor')) { e.preventDefault(); return true; }
        return false;
      },
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
    // on a phone the bars float over the text: keep the cursor clear of them
    EditorView.scrollMargins.of(() => (matchMedia('(pointer: coarse) and (max-width: 760px)').matches ? { top: 56, bottom: 72 } : null)),
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
