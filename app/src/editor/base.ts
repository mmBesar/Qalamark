// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Draws a ```base block as a table of notes. Reveals the plain block when the cursor is in it.

import { type EditorState, type Range, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { type BaseSpec, cellOf, columnsOf, type NoteRow, parseBase, queryRows } from '../lib/base.ts';
import type { PropType } from '../lib/frontmatter.ts';

export interface BaseHooks {
  rows(): Promise<NoteRow[]>;
  open(id: string): void;
  setProp(id: string, key: string, type: PropType, text: string): Promise<void>;
  /** false for the note that holds the table (it is open here) and notes you may only read */
  canEdit(id: string): boolean;
  labels: () => { empty: string; edit: string; none: string; count: (n: number) => string; cols: Record<string, string> };
}

class BaseWidget extends WidgetType {
  constructor(
    private src: string,
    private hooks: BaseHooks,
    private from: number,
  ) {
    super();
  }
  eq(o: BaseWidget) {
    return o.src === this.src;
  }
  get estimatedHeight() {
    return 120;
  }
  ignoreEvent() {
    return true; // clicks in the table are the table's own
  }
  toDOM(view: EditorView) {
    const root = document.createElement('div');
    root.className = 'cm-base';
    const spec = parseBase(this.src);
    let sortKey: string | null = null;
    let sortDir = 1;
    let q = '';
    let hadFocus = false;
    const hue = (v: string) => { let h = 0; for (const ch of v.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
    const STATUS = /^(status|state|stage|phase|type|kind|category|priority|الحالة|المرحلة|النوع)$/i;
    const draw = async () => {
      const L = this.hooks.labels();
      const all = queryRows(spec, await this.hooks.rows().catch(() => []));
      const cols = columnsOf(spec, all);
      let rows = all;
      if (q.trim()) {
        const needle = q.trim().toLowerCase();
        rows = rows.filter((r) => r.title.toLowerCase().includes(needle) || cols.some((c) => {
          const x = cellOf(r, c);
          return (x.type === 'list' ? x.items.join(' ') : x.text).toLowerCase().includes(needle);
        }));
      }
      if (sortKey) {
        const k = sortKey;
        const val = (r: NoteRow) => { const x = cellOf(r, k); return x.type === 'list' ? x.items.join(', ') : x.text; };
        rows = [...rows].sort((a, b) => sortDir * val(a).localeCompare(val(b), undefined, { numeric: true, sensitivity: 'base' }));
      }
      root.textContent = '';
      const bar = document.createElement('div');
      bar.className = 'base-bar';
      const count = document.createElement('span');
      count.textContent = L.count(rows.length);
      const find = document.createElement('input');
      find.type = 'search';
      find.className = 'base-find';
      find.value = q;
      find.placeholder = '🔍';
      find.setAttribute('aria-label', 'filter');
      find.oninput = () => { q = find.value; hadFocus = true; void draw(); };
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = L.edit;
      edit.onclick = () => {
        view.dispatch({ selection: { anchor: this.from + 1 }, scrollIntoView: true });
        view.focus();
      };
      bar.append(count, find, edit);
      if (hadFocus) { hadFocus = false; queueMicrotask(() => { find.focus(); find.setSelectionRange(find.value.length, find.value.length); }); }
      root.append(bar);
      if (!rows.length) {
        const p = document.createElement('p');
        p.className = 'base-none';
        p.textContent = L.none;
        root.append(p);
        return;
      }
      const wrap = document.createElement('div');
      wrap.className = 'base-wrap';
      const table = document.createElement('table');
      const head = table.createTHead().insertRow();
      for (const c of cols) {
        const th = document.createElement('th');
        th.textContent = L.cols[c.toLowerCase()] ?? c;
        th.className = 'sortable';
        if (sortKey === c) th.dataset.sort = sortDir > 0 ? 'asc' : 'desc';
        th.tabIndex = 0;
        const flip = () => { if (sortKey === c) sortDir = -sortDir; else { sortKey = c; sortDir = 1; } void draw(); };
        th.onclick = flip;
        th.onkeydown = (e) => { if (e.key === 'Enter') flip(); };
        head.append(th);
      }
      const body = table.createTBody();
      for (const r of rows) {
        const tr = body.insertRow();
        for (const c of cols) {
          const td = tr.insertCell();
          const cell = cellOf(r, c);
          const isLink = c.toLowerCase() === spec.link.toLowerCase();
          const editable = cell.editable && this.hooks.canEdit(r.id);
          const save = (type: PropType, text: string) => {
            this.hooks.setProp(r.id, c, type, text).then(draw, draw);
          };
          if (isLink) {
            const a = document.createElement('a');
            a.className = 'base-link';
            a.href = '#';
            a.textContent = cell.text || r.title;
            a.onclick = (e) => {
              e.preventDefault();
              this.hooks.open(r.id);
            };
            td.append(a);
            if (editable && cell.type !== 'text') td.classList.add('plain');
            continue;
          }
          if (cell.type === 'checkbox') {
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = cell.text === 'true';
            box.disabled = !editable;
            box.onchange = () => save('checkbox', box.checked ? 'true' : 'false');
            td.append(box);
            td.className = 'center';
          } else if (cell.type === 'list' && cell.items.length) {
            // tags and other lists are drawn as chips
            const box = document.createElement('div');
            box.className = 'base-chips';
            for (const it of cell.items) {
              const chip = document.createElement('span');
              chip.textContent = it;
              chip.style.setProperty('--h', String(hue(it)));
              box.append(chip);
            }
            td.append(box);
            td.classList.add('plain');
          } else if (!editable) {
            if (STATUS.test(c) && cell.text) {
              const badge = document.createElement('span');
              badge.className = 'base-badge';
              badge.textContent = cell.text;
              badge.style.setProperty('--h', String(hue(cell.text)));
              td.append(badge);
              td.classList.add('plain');
            } else {
              td.textContent = cell.type === 'list' ? cell.items.join(', ') : cell.text;
              if (!cell.editable) td.className = 'fixed';
            }
          } else if (STATUS.test(c) && cell.text && cell.type === 'text') {
            // a coloured badge; a click turns it into the input
            const badge = document.createElement('button');
            badge.type = 'button';
            badge.className = 'base-badge edit';
            badge.textContent = cell.text;
            badge.style.setProperty('--h', String(hue(cell.text)));
            const edit = () => {
              const inp = document.createElement('input');
              inp.className = 'base-cell';
              inp.value = cell.text;
              inp.setAttribute('aria-label', c);
              inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = cell.text; inp.blur(); } };
              inp.onblur = () => { if (inp.value !== cell.text) save('text', inp.value); else void draw(); };
              badge.replaceWith(inp);
              inp.focus();
              inp.select();
            };
            badge.onclick = edit;
            td.append(badge);
            td.classList.add('plain');
          } else {
            const inp = document.createElement('input');
            inp.className = 'base-cell';
            inp.type = cell.type === 'number' ? 'number' : 'text';
            const orig = cell.type === 'list' ? cell.items.join(', ') : cell.text;
            inp.value = orig;
            inp.setAttribute('aria-label', c);
            inp.onkeydown = (e) => {
              if (e.key === 'Enter') inp.blur();
              if (e.key === 'Escape') {
                inp.value = orig;
                inp.blur();
              }
            };
            inp.onchange = () => {
              if (inp.value !== orig) save(cell.type === 'date' ? 'text' : cell.type, inp.value);
            };
            td.append(inp);
          }
        }
      }
      wrap.append(table);
      root.append(wrap);
    };
    void draw();
    return root;
  }
}

const FENCE = /^[ \t]*(```|~~~)[ \t]*base[ \t]*$/i;

function build(state: EditorState, hooks: BaseHooks): DecorationSet {
  const doc = state.doc;
  const out: Range<Decoration>[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    if (!FENCE.test(doc.line(n).text)) continue;
    const fence = /^[ \t]*(```|~~~)/.exec(doc.line(n).text)![1]!;
    let end = -1;
    for (let m = n + 1; m <= doc.lines; m++) {
      if (new RegExp(`^[ \\t]*${fence}[ \\t]*$`).test(doc.line(m).text)) {
        end = m;
        break;
      }
    }
    if (end < 0) continue;
    const from = doc.line(n).from;
    const to = doc.line(end).to;
    n = end;
    // the plain block shows while the cursor is in it
    if (state.selection.ranges.some((r) => r.from <= to && r.to >= from)) continue;
    const first = doc.lineAt(from).number;
    const src = end - 1 > first ? doc.sliceString(doc.line(first + 1).from, doc.line(end - 1).to) : '';
    out.push(Decoration.replace({ widget: new BaseWidget(src, hooks, from), block: true }).range(from, to));
  }
  return Decoration.set(out, true);
}

export function baseExtension(hooks: BaseHooks) {
  return StateField.define<DecorationSet>({
    create: (s) => build(s, hooks),
    update: (v, tr) => (tr.docChanged || tr.selection ? build(tr.state, hooks) : v),
    provide: (f) => EditorView.decorations.from(f),
  });
}

export type { BaseSpec };
