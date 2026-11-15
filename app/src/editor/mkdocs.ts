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

import { StateEffect, type Text } from '@codemirror/state';
import { highlightTree } from '@lezer/highlight';
import { CodeBadge, fenceLang } from './codebadge.ts';
import { codeStyle } from './codestyle.ts';
import { findLanguage } from './langs.ts';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { type Range } from '@codemirror/state';
import { readingMode } from './livepreview.ts';

export interface BlockLine {
  role: 'head' | 'body';
  type: 'admonition' | 'tab';
  kind: string; // note, tip, warning ... (admonitions)
  title: string;
  collapsible: boolean;
  head: number; // line number of the block's first line
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
      head: n,
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


export interface Fence {
  first: number; // opening fence line
  last: number; // closing fence line (or the last line when never closed)
  lang: string;
}

const fenceCache = new WeakMap<Text, Fence[]>();

/** Code fences written inside a tab or admonition body (they are indented by four spaces). */
export function scanFences(doc: Text): Fence[] {
  const hit = fenceCache.get(doc);
  if (hit) return hit;
  const blocks = scanBlocks(doc);
  const out: Fence[] = [];
  let open: Fence | null = null;
  let mark = '';
  let prevHead = -1;
  for (let n = 1; n <= doc.lines; n++) {
    const info = blocks.get(n);
    if (!info || info.role !== 'body' || info.head !== prevHead) {
      if (open) {
        open.last = n - 1;
        out.push(open);
        open = null;
      }
    }
    prevHead = info?.head ?? -1;
    if (!info || info.role !== 'body') {
      if (info?.role === 'head') prevHead = n;
      continue;
    }
    const text = doc.line(n).text.replace(/^( {4}|\t)/, '');
    const f = /^[ \t]*(```|~~~)[ \t]*([^\n]*)$/.exec(text);
    if (open) {
      if (f && f[1] === mark && f[2]!.trim() === '') {
        open.last = n;
        out.push(open);
        open = null;
      }
    } else if (f) {
      mark = f[1]!;
      open = { first: n, last: n, lang: f[2]!.trim() };
    }
  }
  if (open) {
    open.last = doc.lines;
    out.push(open);
  }
  fenceCache.set(doc, out);
  return out;
}

const refresh = StateEffect.define<null>();
const asked = new Set<string>();

/** Colour marks for one code block written inside a tab or admonition. */
function codeMarks(view: EditorView, f: Fence, out: Range<Decoration>[]) {
  const desc = findLanguage(f.lang);
  if (!desc) return;
  if (!desc.support) {
    if (!asked.has(desc.name)) {
      asked.add(desc.name);
      desc.load().then(() => view.dispatch({ effects: refresh.of(null) })).catch(() => asked.delete(desc.name));
    }
    return;
  }
  const doc = view.state.doc;
  const lines: { pos: number; start: number }[] = []; // doc position of the code, and offset in the joined text
  let text = '';
  for (let n = f.first + 1; n < f.last || (n === f.last && f.last === doc.lines && !/^[ \t]*(```|~~~)/.test(doc.line(n).text.replace(/^( {4}|\t)/, ''))); n++) {
    const l = doc.line(n);
    const ind = l.text.startsWith('\t') ? 1 : l.text.startsWith('    ') ? 4 : 0;
    lines.push({ pos: l.from + ind, start: text.length });
    text += l.text.slice(ind) + '\n';
  }
  if (!text) return;
  const tree = desc.support.language.parser.parse(text);
  const at = (off: number) => {
    let i = lines.length - 1;
    while (i > 0 && lines[i]!.start > off) i--;
    return lines[i]!.pos + (off - lines[i]!.start);
  };
  highlightTree(tree, codeStyle, (from, to, cls) => {
    // a highlighted span may cross lines: split it so each piece stays on its own line
    let a = from;
    while (a < to) {
      let nl = text.indexOf('\n', a);
      if (nl < 0 || nl > to) nl = to;
      if (nl > a) out.push(Decoration.mark({ class: cls }).range(at(a), at(a) + (nl - a)));
      a = nl + 1;
    }
  });
}


interface TabGroup {
  heads: number[]; // line numbers of the tab labels
  titles: string[];
  end: number; // last line of the group
}

/** Tabs that follow each other form one group (in Reading mode they become real tabs). */
function tabGroups(doc: Text, blocks: Map<number, BlockLine>, gaps: Set<number> = new Set()): Map<number, { group: TabGroup; index: number }> {
  const out = new Map<number, { group: TabGroup; index: number }>();
  const heads = [...blocks.entries()].filter(([, b]) => b.role === 'head' && b.type === 'tab').map(([n]) => n);
  let cur: TabGroup | null = null;
  let lastBody = 0;
  for (const h of heads) {
    let tail = h;
    for (const [n, b] of blocks) if (b.head === h && n > tail) tail = n;
    let joins = false;
    if (cur) {
      joins = true;
      for (let k = lastBody + 1; k < h; k++) if (doc.line(k).text.trim() !== '') joins = false;
      if (joins) for (let k = lastBody + 1; k < h; k++) gaps.add(k);
    }
    if (!joins) cur = { heads: [], titles: [], end: h };
    cur!.heads.push(h);
    cur!.titles.push(blocks.get(h)!.title);
    cur!.end = tail;
    out.set(h, { group: cur!, index: cur!.heads.length - 1 });
    lastBody = tail;
  }
  return out;
}

class TabStrip extends WidgetType {
  constructor(
    readonly titles: string[],
    readonly active: number,
    readonly pick: (i: number) => void,
  ) {
    super();
  }
  eq(o: TabStrip) {
    return o.active === this.active && o.titles.join('\u0000') === this.titles.join('\u0000');
  }
  toDOM() {
    const bar = document.createElement('span');
    bar.className = 'cm-tabstrip';
    this.titles.forEach((title, i) => {
      const b = document.createElement('span');
      b.className = 'cm-tab-label' + (i === this.active ? ' on' : '');
      b.setAttribute('role', 'tab');
      b.textContent = title;
      b.onmousedown = (e) => {
        e.preventDefault();
        this.pick(i);
      };
      bar.append(b);
    });
    return bar;
  }
  ignoreEvent() {
    return true;
  }
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

function build(view: EditorView, active: Map<number, number>, pick: (group: number, i: number) => void): DecorationSet {
  const { state } = view;
  const blocks = scanBlocks(state.doc);
  const fences = scanFences(state.doc);
  const fenceOf = new Map<number, Fence>();
  for (const f of fences) for (let n = f.first; n <= f.last; n++) fenceOf.set(n, f);
  const gaps = new Set<number>();
  const groups = tabGroups(state.doc, blocks, gaps);
  const out: Range<Decoration>[] = [];
  const reading = state.facet(readingMode);
  const sel = state.selection.ranges;
  const gapGroup = new Map<number, TabGroup>();
  for (const group of new Set([...groups.values()].map((v) => v.group))) for (const n of gaps) if (n > group.heads[0]! && n < group.end) gapGroup.set(n, group);
  const headTouched = (grp: TabGroup) => !reading && grp.heads.some((h) => sel.some((r) => r.from <= state.doc.line(h).to && r.to >= state.doc.line(h).from));
  const touches = (from: number, to: number) => !reading && sel.some((r) => r.from <= to && r.to >= from);
  for (const { from, to } of view.visibleRanges) {
    const a = state.doc.lineAt(from).number;
    const b = state.doc.lineAt(to).number;
    for (let n = a; n <= b; n++) {
      const info = blocks.get(n);
      const gg = !info && gaps.has(n) ? gapGroup.get(n) : undefined;
      if (gg && (reading || !headTouched(gg))) out.push(Decoration.line({ class: 'cm-tab-off' }).range(state.doc.line(n).from));
      if (!info) continue;
      const line = state.doc.line(n);
      const cls =
        info.type === 'admonition'
          ? `cm-callout cm-callout-${info.kind}${info.role === 'head' ? ' cm-callout-head' : ''}`
          : info.role === 'head'
            ? 'cm-tab-head'
            : 'cm-tab-body';
      const g = info.type === 'tab' ? groups.get(info.head) : undefined;
      // real tabs in Reading and in live view; the plain source only while the cursor is on a tab label line
      const tabbed = !!g && (reading || !headTouched(g.group));
      const shown = !tabbed || !g || (info.role === 'head' ? g.index === 0 : false) || (active.get(g.group.heads[0]!) ?? 0) === g.index;
      out.push(Decoration.line({ class: cls + (shown ? '' : ' cm-tab-off') }).range(line.from));
      const fence = fenceOf.get(n);
      if (fence && info.role === 'body') {
        // clean code: no ``` lines unless the cursor is in the block (a badge names the language and copies)
        const closed = fence.last - fence.first >= 2 && /^[ \t]*(```|~~~)[ \t]*$/.test(state.doc.line(fence.last).text.replace(/^( {4}|\t)/, ''));
        const clean = closed && !touches(state.doc.line(fence.first).from, state.doc.line(fence.last).to);
        const top = clean ? fence.first + 1 : fence.first;
        const bottom = clean ? fence.last - 1 : fence.last;
        if (clean && (n === fence.first || n === fence.last)) {
          out.push(Decoration.line({ class: 'cm-fence-off' }).range(line.from));
        } else {
          const edge = !clean && (n === fence.first || (n === fence.last && n !== fence.first));
          out.push(Decoration.line({ class: 'cm-codeblock cm-code-in' + (edge ? ' cm-code-edge' : '') + (n === top ? ' cm-code-first cm-code-badged' : '') + (n === bottom ? ' cm-code-last' : '') }).range(line.from));
          if (clean && n === top) {
            const code = state.doc.sliceString(state.doc.line(fence.first + 1).from, state.doc.line(fence.last - 1).to).split('\n').map((l) => l.replace(/^( {4}|\t)/, '')).join('\n');
            out.push(Decoration.widget({ widget: new CodeBadge(fenceLang(state.doc.line(fence.first).text.replace(/^( {4}|\t)/, '')), code), side: -1 }).range(line.from));
          }
        }
      }
      if (tabbed && g && info.role === 'head') {
        if (g.index === 0) {
          const cur = active.get(g.group.heads[0]!) ?? 0;
          out.push(Decoration.replace({ widget: new TabStrip(g.group.titles, cur, (i) => pick(g.group.heads[0]!, i)) }).range(line.from, line.to));
        } else {
          out.push(Decoration.replace({ widget: new Gap() }).range(line.from, line.to));
        }
      } else if (info.role === 'head' && !touches(line.from, line.to)) {
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
  for (const f of fences) {
    if (view.visibleRanges.some((r) => state.doc.line(f.last).to >= r.from && state.doc.line(f.first).from <= r.to)) codeMarks(view, f, out);
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
    active = new Map<number, number>();
    constructor(readonly view: EditorView) {
      this.decorations = build(view, this.active, this.pick);
    }
    pick = (group: number, i: number) => {
      this.active.set(group, i);
      this.view.dispatch({ effects: refresh.of(null) });
    };
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.startState.facet(readingMode) !== u.state.facet(readingMode) || u.transactions.some((t) => t.effects.some((e) => e.is(refresh)))) {
        this.decorations = build(u.view, this.active, this.pick);
      }
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
