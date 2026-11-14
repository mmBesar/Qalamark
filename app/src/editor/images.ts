// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Pictures: ![alt](url) shows the picture (the raw text comes back when the cursor
// is on it), and pasting or dropping a picture uploads it and writes the link.

import { syntaxTree } from '@codemirror/language';
import { type Extension, Prec, type Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { readingMode } from './livepreview.ts';

export interface ImageHooks {
  /** Turn a link in the note into something an <img> can show (null = cannot). */
  resolve: (url: string) => Promise<string | null>;
  /** Save a pasted or dropped picture; returns the markdown to insert (null = refused). */
  upload?: (blob: Blob) => Promise<string | null>;
}

class PictureWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
    readonly hooks: ImageHooks,
  ) {
    super();
  }
  eq(o: PictureWidget) {
    return o.url === this.url && o.alt === this.alt;
  }
  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = 'cm-picture';
    const img = document.createElement('img');
    img.alt = this.alt;
    img.loading = 'lazy';
    img.addEventListener('error', () => {
      wrap.classList.add('cm-picture-broken');
      wrap.textContent = `🖼 ${this.alt || this.url}`;
    });
    wrap.append(img);
    void this.hooks.resolve(this.url).then((src) => {
      if (src) img.src = src;
      else {
        wrap.classList.add('cm-picture-broken');
        wrap.textContent = `🖼 ${this.alt || this.url}`;
      }
    });
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

function build(view: EditorView, hooks: ImageHooks): DecorationSet {
  const out: Range<Decoration>[] = [];
  const reading = view.state.facet(readingMode);
  const sel = view.state.selection.ranges;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (n) => {
        if (n.name !== 'Image') return;
        const text = view.state.doc.sliceString(n.from, n.to);
        const m = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)$/.exec(text);
        if (!m) return;
        const editing = !reading && sel.some((r) => r.from <= n.to && r.to >= n.from);
        if (editing) return;
        out.push(Decoration.replace({ widget: new PictureWidget(m[2]!, m[1]!, hooks) }).range(n.from, n.to));
      },
    });
  }
  return Decoration.set(out, true);
}

export function pictures(hooks: ImageHooks): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, hooks);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.transactions.length) this.decorations = build(u.view, hooks);
      }
    },
    { decorations: (v) => v.decorations },
  );

  const insert = async (view: EditorView, files: File[], at: number) => {
    let pos = at;
    for (const f of files) {
      const md = await hooks.upload!(f);
      if (!md) continue;
      const text = md + '\n';
      view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
      pos += text.length;
    }
  };
  const pictureFiles = (list: DataTransfer | null) => Array.from(list?.files ?? []).filter((f) => f.type.startsWith('image/'));

  return [
    Prec.high(plugin),
    EditorView.domEventHandlers({
      paste(e, view) {
        const files = pictureFiles(e.clipboardData);
        if (!hooks.upload || files.length === 0) return false;
        e.preventDefault();
        void insert(view, files, view.state.selection.main.head);
        return true;
      },
      drop(e, view) {
        const files = pictureFiles(e.dataTransfer);
        if (!hooks.upload || files.length === 0) return false;
        e.preventDefault();
        const at = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
        void insert(view, files, at);
        return true;
      },
    }),
  ];
}
