// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Material for MkDocs blocks, shown nicely while the text stays exactly as it is:
//
//   !!! note "Optional title"          ??? tip "Collapsible"        ???+ tip "Open"
//       Indented text belongs to the block.
//
//   === "Python"                       === "JavaScript"
//       ```py                              ```js
//
// and  ```py title="main.py"  on a code block.

import { type Text } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { type Range } from '@codemirror/state';
import { readingMode } from './livepreview.ts';

export interface BlockLine {
  role: 'head' | 'body';
  type: 'admonition' | 'tab';
  kind: string; // note, tip, warning ... (admonitions)
  title: string;
  collapsible: boolean;
}

const ADMONITION = /^(!!!|\?\?\?\+?)[ \t]+([A-Za-z][\w-]*)(?:[ \t]+"([^"]*)")?[ \t]*$/;
const TAB = /^===\+?[ \t]+"([^"]*)"[ \t]*$/;
const FENCE = /^[ \t]*(```|~~~)/;

const cache = new WeakMap<Text, Map<number, BlockLine>>();

/** Which lines of the document belong to an admonition or a tab, by line number. */
export function scanBlocks(doc: Text): Map<number, BlockLine> {
  const hit = cache.get(doc);
  if (hit) return hit;
  const out = new Map<number, BlockLine>();
  let fence: string | null = null;
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    const f = FENCE.exec(text);
    if (f && /^(```|~~~)/.test(text.trimStart()) && !/^[ \t]/.test(text)) {
      fence = fence === null ? f[1]! : fence === f[1] ? null : fence;
      continue;
    }
    if (fence !== null) continue;
    const a = ADMONITION.exec(text);
    const t = a ? null : TAB.exec(text);
    if (!a && !t) continue;
    out.set(n, {
      role: 'head',
      type: a ? 'admonition' : 'tab',
      kind: a ? a[2]!.toLowerCase() : 'tab',
      title: a ? (a[3] ?? '') : t![1]!,
      collapsible: !!a && a[1]!.startsWith('???'),
    });
    // the indented lines that follow (blank lines inside the block are allowed)
    let last = n;
    for (let m = n + 1; m <= doc.lines; m++) {
      const l = doc.line(m).text;
      if (/^( {4}|\t)/.test(l)) {
        last = m;
        out.set(m, { ...out.get(n)!, role: 'body' });
        for (let k = last - 1; k > n; k--) if (!out.has(k)) out.set(k, { ...out.get(n)!, role: 'body' });
      } else if (l.trim() !== '') break;
    }
    n = last;
  }
  cache.set(doc, out);
  return out;
}

const ICONS: Record<string, string> = {
  note: '✎', abstract: '☰', summary: '☰', info: 'ⓘ', todo: '☐', tip: '💡', hint: '💡', important: '💡',
  success: '✓', check: '✓', done: '✓', question: '?', help: '?', faq: '?', warning: '⚠', caution: '⚠',
  attention: '⚠', failure: '✗', fail: '✗', missing: '✗', danger: '⚡', error: '⚡', bug: '🐞',
  example: '☰', quote: '❝', cite: '❝',
};

class Label extends WidgetType {
  constructor(
    readonly text: string,
    readonly icon: string,
    readonly cls: string,
  ) {
    super();
  }
  eq(o: Label) {
    return o.text === this.text && o.icon === this.icon && o.cls === this.cls;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = this.cls;
    s.textContent = this.icon ? `${this.icon} ${this.text}` : this.text;
    return s;
  }
}

class Gap extends WidgetType {
  toDOM() {
    return document.createElement('span');
  }
  eq() {
    return true;
  }
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const blocks = scanBlocks(state.doc);
  const out: Range<Decoration>[] = [];
  const reading = state.facet(readingMode);
  const sel = state.selection.ranges;
  const touches = (from: number, to: number) => !reading && sel.some((r) => r.from <= to && r.to >= from);
  for (const { from, to } of view.visibleRanges) {
    const a = state.doc.lineAt(from).number;
    const b = state.doc.lineAt(to).number;
    for (let n = a; n <= b; n++) {
      const info = blocks.get(n);
      if (!info) continue;
      const line = state.doc.line(n);
      const cls =
        info.type === 'admonition'
          ? `cm-callout cm-callout-${info.kind}${info.role === 'head' ? ' cm-callout-head' : ''}`
          : info.role === 'head'
            ? 'cm-tab-head'
            : 'cm-tab-body';
      out.push(Decoration.line({ class: cls }).range(line.from));
      if (info.role === 'head' && !touches(line.from, line.to)) {
        const label =
          info.type === 'admonition'
            ? new Label(info.title || info.kind.charAt(0).toUpperCase() + info.kind.slice(1), (info.collapsible ? '▸ ' : '') + (ICONS[info.kind] ?? '✎'), 'cm-callout-label')
            : new Label(info.title, '', 'cm-tab-label');
        out.push(Decoration.replace({ widget: label }).range(line.from, line.to));
      } else if (info.role === 'body' && line.text.length >= 4 && !touches(line.from, line.to)) {
        const indent = line.text.startsWith('\t') ? 1 : 4;
        out.push(Decoration.replace({ widget: new Gap() }).range(line.from, line.from + indent));
      }
    }
  }
  return Decoration.set(out, true);
}

/** ```py title="main.py"  ->  the title is shown above the code. */
class CodeTitle extends WidgetType {
  constructor(readonly title: string) {
    super();
  }
  eq(o: CodeTitle) {
    return o.title === this.title;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-code-title';
    s.textContent = this.title;
    return s;
  }
}

function titles(view: EditorView): DecorationSet {
  const out: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (let n = view.state.doc.lineAt(from).number; n <= view.state.doc.lineAt(to).number; n++) {
      const l = view.state.doc.line(n);
      const m = /^[ \t]*(?:```|~~~)[\w+#-]*[^\n]*?\btitle="([^"]*)"/.exec(l.text);
      if (m) out.push(Decoration.widget({ widget: new CodeTitle(m[1]!), side: 1 }).range(l.to));
    }
  }
  return Decoration.set(out, true);
}

export const mkdocsBlocks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

export const codeTitles = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = titles(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = titles(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
