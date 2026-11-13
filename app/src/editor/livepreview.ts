// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// "Live preview": the text stays plain Markdown, but it looks formatted.
// The marks (# ** [] etc.) fade away except where the cursor is.
// Nothing here changes the text itself - only how it is drawn.

import { syntaxTree } from '@codemirror/language';
import { Facet, type EditorState, type Range } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';

const hide = Decoration.replace({});

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
  toDOM(view: EditorView) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-task';
    box.checked = this.checked;
    box.disabled = view.state.readOnly;
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

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (n) => {
        const name = n.name;
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
            if (!lineTouched(state, n.from, n.to)) {
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
            const last = state.doc.lineAt(n.to).number;
            for (let p = first; p <= last; p++) {
              const cls = ['cm-codeblock', p === first ? 'cm-code-first' : '', p === last ? 'cm-code-last' : ''];
              if (name === 'FencedCode' && (p === first || p === last)) cls.push('cm-fence');
              line(state.doc.line(p).from, cls.filter(Boolean).join(' '));
            }
            return false;
          }
          case 'Blockquote': {
            for (let p = state.doc.lineAt(n.from).number; p <= state.doc.lineAt(n.to).number; p++) {
              line(state.doc.line(p).from, 'cm-quote');
            }
            break;
          }
          case 'QuoteMark':
            if (!lineTouched(state, n.from, n.to)) {
              const next = state.sliceDoc(n.to, n.to + 1) === ' ' ? 1 : 0;
              cover(n.from, n.to + next);
            }
            break;
          case 'ListMark': {
            const list = n.node.parent?.parent?.name;
            if (list === 'BulletList' && !lineTouched(state, n.from, n.to)) {
              out.push(Decoration.replace({ widget: new BulletWidget() }).range(n.from, n.to));
            } else mark(n.from, n.to, 'cm-listmark');
            break;
          }
          case 'TaskMarker': {
            const checked = /x/i.test(state.sliceDoc(n.from, n.to));
            out.push(Decoration.replace({ widget: new CheckWidget(checked, n.from) }).range(n.from, n.to));
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
  return Decoration.set(out, true);
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
      // Ctrl/Cmd + click opens a link.
      mousedown(e, view) {
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

export const livePreview = [plugin];
