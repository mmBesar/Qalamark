// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// "Live preview": the text stays plain Markdown, but it looks formatted.
// The marks (# ** [] etc.) fade away except where the cursor is.
// Nothing here changes the text itself - only how it is drawn.

import { readFrontMatter } from '../lib/frontmatter.ts';
import { scanBlocks } from './mkdocs.ts';
import { syntaxTree } from '@codemirror/language';
import { Facet, type EditorState, type Range, StateField } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';

const hide = Decoration.replace({});

/** What the editor needs to know about other notes, to draw and follow [[links]]. */
export interface WikiConfig {
  titles: () => string[];
  open: (title: string) => void;
}
export const wikiConfig = Facet.define<WikiConfig, WikiConfig | null>({ combine: (v) => v[0] ?? null });

/** In reading mode every mark stays hidden, wherever the cursor is. */
export const readingMode = Facet.define<boolean, boolean>({ combine: (v) => v.some(Boolean) });

class BulletWidget extends WidgetType {
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-bullet';
    s.textContent = '•';
    return s;
  }
  eq() {
    return true;
  }
}

class CheckWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
  ) {
    super();
  }
  // A plain <span>, not a real <input>: browsers cannot drag-select across a form control,
  // and double-click picks the wrong line next to one.
  toDOM(view: EditorView) {
    const box = document.createElement('span');
    box.className = 'cm-task' + (this.checked ? ' cm-task-checked' : '');
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(this.checked));
    box.contentEditable = 'false';
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      e.preventDefault();
      if (view.state.readOnly) return;
      const pos = view.posAtDOM(box);
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? ' ' : 'x' } });
    });
    return box;
  }
  eq(o: CheckWidget) {
    return o.checked === this.checked;
  }
  ignoreEvent() {
    return true;
  }
}

const CALLOUT_ICONS: Record<string, string> = {
  note: '✎', info: 'ℹ', tip: '💡', hint: '💡', important: '❗', success: '✔', check: '✔', done: '✔', question: '?', help: '?', faq: '?',
  warning: '⚠', caution: '⚠', attention: '⚠', failure: '✘', fail: '✘', missing: '✘', danger: '⛔', error: '⛔', bug: '🐞',
  example: '☰', quote: '❝', cite: '❝', abstract: '☰', summary: '☰', tldr: '☰', todo: '☐',
};

class CalloutLabel extends WidgetType {
  constructor(
    readonly kind: string,
    readonly label: string,
  ) {
    super();
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-callout-label';
    s.textContent = `${CALLOUT_ICONS[this.kind] ?? '✎'} ${this.label}`;
    return s;
  }
  eq(o: CalloutLabel) {
    return o.kind === this.kind && o.label === this.label;
  }
}

class RuleWidget extends WidgetType {
  toDOM() {
    const hr = document.createElement('hr');
    hr.className = 'cm-hr';
    return hr;
  }
  eq() {
    return true;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly alt: string,
    readonly url: string,
  ) {
    super();
  }
  toDOM() {
    const img = document.createElement('img');
    img.className = 'cm-image';
    img.alt = this.alt;
    img.src = this.url;
    img.loading = 'lazy';
    img.addEventListener('error', () => {
      img.replaceWith(Object.assign(document.createElement('span'), { className: 'cm-image-missing', textContent: this.alt || this.url }));
    });
    return img;
  }
  eq(o: ImageWidget) {
    return o.url === this.url && o.alt === this.alt;
  }
}

/** Is any part of the selection inside [from, to] ? */
function touched(state: EditorState, from: number, to: number): boolean {
  if (state.facet(readingMode)) return false;
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

/** Is the selection on one of the lines between `from` and `to`? */
function lineTouched(state: EditorState, from: number, to: number): boolean {
  const a = state.doc.lineAt(from).from;
  const b = state.doc.lineAt(to).to;
  return touched(state, a, b);
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const out: Range<Decoration>[] = [];
  const line = (pos: number, cls: string) => out.push(Decoration.line({ class: cls }).range(state.doc.lineAt(pos).from));
  const mark = (from: number, to: number, cls: string) => {
    if (to > from) out.push(Decoration.mark({ class: cls }).range(from, to));
  };
  const cover = (from: number, to: number) => {
    if (to > from) out.push(hide.range(from, to));
  };

  const blocks = scanBlocks(state.doc);
  // The properties block at the top is shown as a plain, quiet block of text.
  const fm = state.doc.lines > 1 && state.doc.line(1).text.trim() === '---' ? readFrontMatter(state.sliceDoc(0, 4000)) : null;
  const fmEnd = fm ? fm.end : 0;
  if (fm) {
    const last = state.doc.lineAt(Math.max(0, fmEnd - 1)).number;
    for (let p = 1; p <= last; p++) line(state.doc.line(p).from, 'cm-frontmatter');
  }
  const calloutHeads = new Set<number>(); // lines already replaced by a callout label
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (n) => {
        const name = n.name;
        if (fmEnd > 0 && name !== 'Document' && n.from < fmEnd) return false;
        const heading = /^ATXHeading([1-6])$/.exec(name) ?? /^SetextHeading([12])$/.exec(name);
        if (heading) {
          for (let p = state.doc.lineAt(n.from).number; p <= state.doc.lineAt(n.to).number; p++) {
            line(state.doc.line(p).from, `cm-heading cm-h${heading[1]}`);
          }
          return;
        }
        switch (name) {
          case 'HeaderMark': {
            if (n.node.parent?.name.startsWith('Setext')) break;
            // Shown only while the cursor is on the mark itself, so the text does
            // not jump sideways while you type on the line.
            if (!touched(state, n.from, n.to + 1)) {
              const next = state.sliceDoc(n.to, n.to + 1) === ' ' ? 1 : 0;
              cover(n.from, n.to + next);
            }
            break;
          }
          case 'StrongEmphasis':
            mark(n.from, n.to, 'cm-strong');
            break;
          case 'Emphasis':
            mark(n.from, n.to, 'cm-em');
            break;
          case 'Strikethrough':
            mark(n.from, n.to, 'cm-strike');
            break;
          case 'InlineCode':
            mark(n.from, n.to, 'cm-inline-code');
            break;
          case 'EmphasisMark':
          case 'StrikethroughMark': {
            const parent = n.node.parent;
            if (parent && !touched(state, parent.from, parent.to)) cover(n.from, n.to);
            break;
          }
          case 'CodeMark': {
            const parent = n.node.parent;
            if (parent?.name === 'InlineCode' && !touched(state, parent.from, parent.to)) cover(n.from, n.to);
            break;
          }
          case 'FencedCode':
          case 'CodeBlock': {
            const first = state.doc.lineAt(n.from).number;
            if (blocks.get(first)?.role === 'body') return false; // text inside a !!! admonition or === tab
            const last = state.doc.lineAt(n.to).number;
            for (let p = first; p <= last; p++) {
              const cls = ['cm-codeblock', p === first ? 'cm-code-first' : '', p === last ? 'cm-code-last' : ''];
              if (name === 'FencedCode' && (p === first || p === last)) cls.push('cm-fence');
              line(state.doc.line(p).from, cls.filter(Boolean).join(' '));
            }
            return false;
          }
          case 'Blockquote': {
            const first = state.doc.lineAt(n.from);
            const co = /^(\s*>\s*)\[!([A-Za-z]+)\]([+-]?)[ \t]*(.*)$/.exec(first.text);
            const firstNo = first.number;
            for (let p = firstNo; p <= state.doc.lineAt(n.to).number; p++) {
              const l = state.doc.line(p);
              if (!co) line(l.from, 'cm-quote');
              else line(l.from, `cm-callout cm-callout-${co[2]!.toLowerCase()}${p === firstNo ? ' cm-callout-head' : ''}`);
            }
            if (co && !touched(state, first.from, first.to)) {
              const kind = co[2]!.toLowerCase();
              const markerEnd = first.from + first.text.length - co[4]!.length;
              const title = co[4]!.trim() === '' ? kind.charAt(0).toUpperCase() + kind.slice(1) : '';
              out.push(Decoration.replace({ widget: new CalloutLabel(kind, title) }).range(first.from, markerEnd));
              calloutHeads.add(firstNo);
            }
            break;
          }
          case 'QuoteMark':
            if (calloutHeads.has(state.doc.lineAt(n.from).number)) break;
            if (!touched(state, n.from, n.to + 1)) {
              const next = state.sliceDoc(n.to, n.to + 1) === ' ' ? 1 : 0;
              cover(n.from, n.to + next);
            }
            break;
          case 'ListMark': {
            const list = n.node.parent?.parent?.name;
            if (list === 'BulletList') {
              out.push(Decoration.replace({ widget: new BulletWidget() }).range(n.from, n.to));
            } else mark(n.from, n.to, 'cm-listmark');
            break;
          }
          case 'TaskMarker': {
            const checked = /x/i.test(state.sliceDoc(n.from, n.to));
            out.push(Decoration.replace({ widget: new CheckWidget(checked, n.from) }).range(n.from, n.to));
            if (checked) {
              // strike the text after the box, not the bullet or the space before it
              const l = state.doc.lineAt(n.from);
              const start = n.to + (state.sliceDoc(n.to, n.to + 1) === ' ' ? 1 : 0);
              if (start < l.to) mark(start, l.to, 'cm-task-done');
            }
            break;
          }
          case 'HorizontalRule':
            if (!lineTouched(state, n.from, n.to)) out.push(Decoration.replace({ widget: new RuleWidget() }).range(n.from, n.to));
            break;
          case 'Link': {
            mark(n.from, n.to, 'cm-link');
            if (!touched(state, n.from, n.to)) {
              const c = n.node.cursor();
              c.firstChild();
              do {
                if (c.name === 'LinkMark' || c.name === 'URL' || c.name === 'LinkTitle') cover(c.from, c.to);
              } while (c.nextSibling());
            }
            break;
          }
          case 'Image': {
            if (touched(state, n.from, n.to)) break;
            const text = state.sliceDoc(n.from, n.to);
            const m = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)/.exec(text);
            if (m) out.push(Decoration.replace({ widget: new ImageWidget(m[1]!, m[2]!) }).range(n.from, n.to));
            return false;
          }
          case 'URL':
            if (n.node.parent?.name === 'Autolink' || n.node.parent?.name === 'Paragraph') mark(n.from, n.to, 'cm-link');
            break;
          case 'Comment':
          case 'CommentBlock':
            mark(n.from, n.to, 'cm-comment');
            break;
        }
      },
    });
  }
  inlineExtras(view, out);
  return Decoration.set(out, true);
}

const SKIP = new Set(['FencedCode', 'InlineCode', 'CodeBlock', 'Comment', 'CommentBlock', 'HTMLBlock', 'HTMLTag']);

function inCode(state: EditorState, pos: number): boolean {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (SKIP.has(n.name)) return true;
  }
  return false;
}

const WIKI = /(?<!!)\[\[([^\]\n|#]*)(#[^\]\n|]*)?(?:\|([^\]\n]*))?\]\]/g;
const HIGHLIGHT = /==(?=\S)([^=\n]+?)(?<=\S)==/g;
const TAG = /(^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;

/** [[links]], ==highlights== and #tags: found in the text of each visible line. */
function inlineExtras(view: EditorView, out: Range<Decoration>[]): void {
  const { state } = view;
  const cfg = state.facet(wikiConfig);
  const known = cfg ? new Set(cfg.titles().map((t) => t.toLowerCase())) : new Set<string>();
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    for (let p = state.doc.lineAt(from).number; p <= state.doc.lineAt(to).number; p++) {
      if (seen.has(p)) continue;
      seen.add(p);
      const l = state.doc.line(p);
      if (!/[[=#]/.test(l.text)) continue;

      for (const m of l.text.matchAll(WIKI)) {
        const start = l.from + m.index!;
        const end = start + m[0].length;
        if (inCode(state, start)) continue;
        const target = m[1]!.trim();
        const cls = 'cm-wikilink' + (known.has(target.toLowerCase()) || target === '' ? '' : ' cm-wikilink-missing');
        if (touched(state, start, end)) {
          out.push(Decoration.mark({ class: 'cm-wikilink-src', attributes: { 'data-wiki': target } }).range(start, end));
          continue;
        }
        const alias = m[3];
        const shownFrom = alias !== undefined ? end - 2 - alias.length : start + 2;
        out.push(hide.range(start, shownFrom));
        out.push(hide.range(end - 2, end));
        if (shownFrom < end - 2) out.push(Decoration.mark({ class: cls, attributes: { 'data-wiki': target } }).range(shownFrom, end - 2));
      }

      for (const m of l.text.matchAll(HIGHLIGHT)) {
        const start = l.from + m.index!;
        const end = start + m[0].length;
        if (inCode(state, start)) continue;
        out.push(Decoration.mark({ class: 'cm-highlight' }).range(start + 2, end - 2));
        if (!touched(state, start, end)) {
          out.push(hide.range(start, start + 2));
          out.push(hide.range(end - 2, end));
        } else out.push(Decoration.mark({ class: 'cm-listmark' }).range(start, start + 2), Decoration.mark({ class: 'cm-listmark' }).range(end - 2, end));
      }

      for (const m of l.text.matchAll(TAG)) {
        const start = l.from + m.index! + m[1]!.length;
        if (inCode(state, start)) continue;
        out.push(Decoration.mark({ class: 'cm-tag' }).range(start, start + 1 + m[2]!.length));
      }
    }
  }
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = build(u.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      // Click a [[link]] to open that note (Ctrl/Cmd + click while editing; a tap on touch screens).
      mousedown(e, view) {
        const el = (e.target as HTMLElement).closest?.('[data-wiki]') as HTMLElement | null;
        const cfg = view.state.facet(wikiConfig);
        if (el && cfg && el.dataset.wiki) {
          const open = view.state.facet(readingMode) || e.ctrlKey || e.metaKey || window.matchMedia('(pointer: coarse)').matches;
          if (open) {
            e.preventDefault();
            cfg.open(el.dataset.wiki);
            return true;
          }
        }
        if (!(e.ctrlKey || e.metaKey)) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos === null) return false;
        let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1);
        while (node && node.name !== 'Link' && node.name !== 'URL') node = node.parent;
        if (!node) return false;
        const urlNode = node.name === 'URL' ? node : node.getChild('URL');
        const url = urlNode ? view.state.sliceDoc(urlNode.from, urlNode.to) : '';
        if (!url) return false;
        window.open(url, '_blank', 'noopener');
        e.preventDefault();
        return true;
      },
    },
  },
);

// The properties block is hidden here: the Properties panel above the note shows and edits it.
// A block it cannot edit safely stays visible as plain text so nothing is hidden that you cannot reach.
const frontMatterHidden = StateField.define<DecorationSet>({
  create: (state) => hideFront(state),
  update: (v, tr) => (tr.docChanged ? hideFront(tr.state) : v),
  provide: (f) => EditorView.decorations.from(f),
});

function hideFront(state: EditorState): DecorationSet {
  if (state.doc.lines < 2 || state.doc.line(1).text.trim() !== '---') return Decoration.none;
  const fm = readFrontMatter(state.sliceDoc(0, 4000));
  if (!fm || !fm.editable) return Decoration.none;
  const to = Math.min(state.doc.length, Math.max(0, fm.end - (state.doc.sliceString(fm.end - 1, fm.end) === '\n' ? 1 : 0)));
  if (to <= 0) return Decoration.none;
  return Decoration.set([Decoration.replace({ block: true }).range(0, to)]);
}

export const livePreview = [plugin, frontMatterHidden];

/** Source mode: the properties block is plain, uncoloured text. */
export const plainFrontMatter = StateField.define<DecorationSet>({
  create: plainFront,
  update: (v, tr) => (tr.docChanged ? plainFront(tr.state) : v),
  provide: (f) => EditorView.decorations.from(f),
});

function plainFront(state: EditorState): DecorationSet {
  if (state.doc.lines < 2 || state.doc.line(1).text.trim() !== '---') return Decoration.none;
  const fm = readFrontMatter(state.sliceDoc(0, 4000));
  if (!fm) return Decoration.none;
  const last = state.doc.lineAt(Math.max(0, fm.end - 1)).number;
  const out: Range<Decoration>[] = [];
  for (let p = 1; p <= last; p++) out.push(Decoration.line({ class: 'cm-fm-plain' }).range(state.doc.line(p).from));
  return Decoration.set(out);
}
