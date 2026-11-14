// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Tables as a real grid you can type in. Under the hood it is still the
// plain Markdown table: every change goes through @qalamark/tables, which
// writes the new text (and recalculates the formulas).

import { describeTables, editCell, setFormulas, tableOp, type TableOp, type TableView } from '@qalamark/tables';
import { type EditorState, type Range, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { yUndoManagerKeymap } from 'y-codemirror.next';

export interface TableLabels {
  addRow: string;
  addColumn: string;
  deleteRow: string;
  deleteColumn: string;
  formulas: string;
  formulasHelp: string;
  editSource: string;
  help: string;
}

/** Change only what differs, so other people's edits in the same note are not disturbed. */
export function applyDiff(view: EditorView, oldText: string, newText: string): void {
  if (oldText === newText) return;
  let pre = 0;
  const max = Math.min(oldText.length, newText.length);
  while (pre < max && oldText.charCodeAt(pre) === newText.charCodeAt(pre)) pre++;
  let suf = 0;
  while (suf < max - pre && oldText.charCodeAt(oldText.length - 1 - suf) === newText.charCodeAt(newText.length - 1 - suf)) suf++;
  view.dispatch({
    changes: { from: pre, to: oldText.length - suf, insert: newText.slice(pre, newText.length - suf) },
    userEvent: 'input.table',
  });
}

const history = (key: string) => yUndoManagerKeymap.find((b) => b.key === key)?.run;

const ERRORS = /^#(DIV\/0!|VALUE!|REF!|NAME\?|CYCLE!|ERR!)$/;
const unescape = (s: string) => s.replace(/\\\|/g, '|').replace(/<br\s*\/?>/gi, '\n');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function button(label: string, text: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.preventDefault();
    onClick();
  });
  return b;
}

function focusCell(view: EditorView, index: number, row: number, col: number): void {
  const root = view.dom.querySelector(`.qt[data-index="${index}"]`);
  const input = root?.querySelector<HTMLInputElement>(`input[data-r="${row}"][data-c="${col}"]`);
  input?.focus();
  input?.select();
}

class TableWidget extends WidgetType {
  constructor(
    readonly index: number,
    readonly v: TableView,
    readonly labels: TableLabels,
  ) {
    super();
  }

  eq(o: TableWidget): boolean {
    return o.index === this.index && JSON.stringify(o.v) === JSON.stringify(this.v) && o.labels === this.labels;
  }

  ignoreEvent(): boolean {
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const { v, index, labels } = this;
    const readOnly = view.state.readOnly;
    const nrows = v.rows.length;
    const ncols = v.rows[0]!.length;
    const mdNow = () => view.state.doc.toString();
    const run = (next: string) => applyDiff(view, mdNow(), next);

    const root = el('div', 'qt');
    root.dataset.index = String(index);
    const scroll = el('div', 'qt-scroll');
    const table = el('table');
    const formulaAt = (r: number, c: number) => v.formulas.find((f) => f.row === r && f.col === c);

    // The cell being edited, so the buttons under the table know what "this row / column" means.
    let active: { r: number; c: number } | null = null;
    let commitActive: () => void = () => {};

    for (let r = 1; r <= nrows; r++) {
      const tr = el('tr');
      for (let c = 0; c < ncols; c++) {
        const cell = el(r === 1 ? 'th' : 'td');
        const shown = unescape(v.rows[r - 1]![c] ?? '');
        const f = formulaAt(r, c);
        const input = el('input', 'qt-cell');
        input.value = shown;
        input.readOnly = readOnly;
        input.dir = 'auto';
        input.spellcheck = false;
        input.dataset.r = String(r);
        input.dataset.c = String(c);
        input.style.textAlign = v.align[c] === 'none' || !v.align[c] ? '' : (v.align[c] as string);
        if (f) cell.classList.add('qt-formula');
        if (ERRORS.test(shown)) cell.classList.add('qt-error');
        if (f) input.title = (f.column ? '==' : '=') + f.source;

        let start = shown;
        const commit = () => {
          if (input.value === start) return;
          const text = input.value;
          start = text;
          run(editCell(mdNow(), index, r, c, text));
        };
        input.addEventListener('focus', () => {
          active = { r, c };
          commitActive = commit;
          // A calculated cell shows its formula while you edit it.
          if (f) input.value = (f.column ? '==' : '=') + f.source;
          start = input.value;
          root.classList.add('qt-active');
        });
        input.addEventListener('blur', () => {
          if (!readOnly && input.isConnected) commit();
          // Whatever happened, show the real content again once we leave.
          // (If the table was rebuilt, this input is already gone and nothing is lost.)
          input.value = shown;
        });
        input.addEventListener('keydown', (e) => {
          const mod = e.ctrlKey || e.metaKey;
          if (mod && !e.altKey && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
            // Undo / redo work for the whole note, also from inside a table.
            e.preventDefault();
            input.value = start; // drop what is half typed
            const redo = e.key.toLowerCase() === 'y' || e.shiftKey;
            history(redo ? 'Mod-y' : 'Mod-z')?.(view);
            return;
          }
          const go = (dr: number, dc: number) => {
            e.preventDefault();
            if (!readOnly) commit();
            let nr = r + dr;
            let nc = c + dc;
            if (nc >= ncols) {
              nc = 0;
              nr++;
            }
            if (nc < 0) {
              nc = ncols - 1;
              nr--;
            }
            if (nr > nrows) {
              if (e.key === 'ArrowDown') return leave(view, v, true);
              if (!readOnly) run(tableOp(mdNow(), index, { op: 'addRow', at: nrows + 1 }));
            }
            if (nr < 1) return leave(view, v, false);
            focusCell(view, index, nr, nc);
          };
          if (e.key === 'Enter') go(1, 0);
          else if (e.key === 'Tab') go(0, e.shiftKey ? -1 : 1);
          else if (e.key === 'ArrowDown' && !e.shiftKey) go(1, 0);
          else if (e.key === 'ArrowUp' && !e.shiftKey) go(-1, 0);
          else if (e.key === 'Escape') {
            input.value = shown;
            start = shown;
            input.blur();
            view.focus();
          }
        });
        cell.append(input);
        tr.append(cell);
      }
      table.append(tr);
    }
    scroll.append(table);
    root.append(scroll);

    // ---- the buttons under the table (they act on the cell you are in) ----
    const bar = el('div', 'qt-bar');
    const box = el('div', 'qt-formulas');
    box.hidden = v.problems.length === 0;
    const area = el('textarea', 'qt-formula-text');
    area.rows = Math.max(2, v.formulaText.length + 1);
    area.value = v.formulaText.join('\n');
    area.placeholder = labels.formulasHelp;
    area.spellcheck = false;
    area.dir = 'ltr';
    area.readOnly = readOnly;
    area.addEventListener('blur', () => {
      if (readOnly || area.value.trim() === v.formulaText.join('\n').trim()) return;
      run(setFormulas(mdNow(), index, area.value));
    });
    const head = el('div', 'qt-formulas-head');
    head.append(
      el('span', 'qt-formulas-title', 'ƒ ' + labels.formulas),
      button(labels.help, '?', 'qt-btn', () => root.dispatchEvent(new CustomEvent('qalamark-help', { bubbles: true }))),
    );
    box.append(head, area);
    for (const p of v.problems) box.append(el('div', 'qt-problem', p));

    // Do an operation, then put the cursor back in a sensible cell.
    const act = (op: TableOp, focus: (a: { r: number; c: number }) => { r: number; c: number }) => {
      commitActive();
      const a = active ?? { r: 1, c: 0 };
      run(tableOp(mdNow(), index, op));
      const f = focus(a);
      focusCell(view, index, f.r, f.c);
    };

    if (!readOnly) {
      const ctx = el('span', 'qt-ctx');
      ctx.append(
        button(labels.addRow, '＋ ' + labels.addRow, 'qt-btn', () => {
          const at = Math.max(2, (active?.r ?? nrows) + 1);
          act({ op: 'addRow', at }, (a) => ({ r: at, c: a.c }));
        }),
        button(labels.addColumn, '＋ ' + labels.addColumn, 'qt-btn', () => {
          const at = (active?.c ?? ncols - 1) + 1;
          act({ op: 'addColumn', at }, (a) => ({ r: a.r, c: at }));
        }),
        button(labels.deleteRow, '－ ' + labels.deleteRow, 'qt-btn qt-del', () => {
          if (!active || active.r < 2) return;
          act({ op: 'deleteRow', row: active.r }, (a) => ({ r: Math.min(a.r, nrows - 1), c: a.c }));
        }),
        button(labels.deleteColumn, '－ ' + labels.deleteColumn, 'qt-btn qt-del', () => {
          if (!active || ncols < 2) return;
          act({ op: 'deleteColumn', col: active.c }, (a) => ({ r: a.r, c: Math.min(a.c, ncols - 2) }));
        }),
        button('left / center / right', '↔', 'qt-btn', () => {
          if (!active) return;
          const next = ({ none: 'left', left: 'center', center: 'right', right: 'none' } as const)[v.align[active.c] ?? 'none'];
          act({ op: 'align', col: active.c, align: next } as TableOp, (a) => a);
        }),
      );
      bar.append(ctx);
    }
    bar.append(
      button(labels.formulas, 'ƒ', 'qt-btn', () => {
        box.hidden = !box.hidden;
        if (!box.hidden) area.focus();
      }),
    );
    root.append(bar, box);
    return root;
  }
}

/** Move the cursor out of the table, to the line after it (or before it). */
function leave(view: EditorView, v: TableView, after: boolean): void {
  const doc = view.state.doc;
  if (after) {
    if (v.toLine + 2 <= doc.lines) {
      view.dispatch({ selection: { anchor: doc.line(v.toLine + 2).from }, scrollIntoView: true });
    } else {
      view.dispatch({ changes: { from: doc.length, insert: '\n' }, selection: { anchor: doc.length + 1 }, scrollIntoView: true });
    }
  } else if (v.fromLine > 0) {
    view.dispatch({ selection: { anchor: doc.line(v.fromLine).to }, scrollIntoView: true });
  } else {
    view.dispatch({ changes: { from: 0, insert: '\n' }, selection: { anchor: 0 }, scrollIntoView: true });
  }
  view.focus();
}

function build(state: EditorState, labels: () => TableLabels): DecorationSet {
  const text = state.doc.toString();
  if (!text.includes('|')) return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  const L = labels();
  describeTables(text).forEach((v, i) => {
    const from = state.doc.line(v.fromLine + 1).from;
    const to = state.doc.line(v.toLine + 1).to;
    ranges.push(Decoration.replace({ widget: new TableWidget(i, v, L), block: true }).range(from, to));
  });
  return Decoration.set(ranges, true);
}

export function tablesExtension(labels: () => TableLabels) {
  const field = StateField.define<DecorationSet>({
    create: (state) => build(state, labels),
    update: (value, tr) => (tr.docChanged ? build(tr.state, labels) : value),
    provide: (f) => EditorView.decorations.from(f),
  });
  // The cursor jumps over a table instead of getting lost inside it.
  return [field, EditorView.atomicRanges.of((view) => view.state.field(field))];
}
