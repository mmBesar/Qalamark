// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Tables as a real grid you can type in. Under the hood it is still the
// plain Markdown table: every change goes through @qalamark/tables, which
// writes the new text (and recalculates the formulas).

import { describeTables, editCell, setFormulas, tableOp, type TableOp, type TableView } from '@qalamark/tables';
import { type EditorState, type Range, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';

export interface TableLabels {
  addRow: string;
  addColumn: string;
  deleteRow: string;
  deleteColumn: string;
  formulas: string;
  formulasHelp: string;
  editSource: string;
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

    for (let r = 1; r <= nrows; r++) {
      const tr = el('tr');
      const tools = el(r === 1 ? 'th' : 'td', 'qt-tools');
      if (!readOnly && r > 1) tools.append(button(labels.deleteRow, '×', 'qt-x', () => run(tableOp(mdNow(), index, { op: 'deleteRow', row: r }))));
      tr.append(tools);
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
        input.addEventListener('focus', () => {
          // A calculated cell shows its formula while you edit it.
          if (f) input.value = (f.column ? '==' : '=') + f.source;
          start = input.value;
        });
        const commit = () => {
          if (input.value === start) {
            input.value = shown;
            return false;
          }
          run(editCell(mdNow(), index, r, c, input.value));
          return true;
        };
        input.addEventListener('blur', () => {
          if (!readOnly && input.isConnected) commit();
        });
        input.addEventListener('keydown', (e) => {
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
            if (nr > nrows && !readOnly) {
              run(tableOp(mdNow(), index, { op: 'addRow', at: nrows + 1 }));
            }
            if (nr >= 1) focusCell(view, index, nr, nc);
          };
          if (e.key === 'Enter') go(1, 0);
          else if (e.key === 'Tab') go(0, e.shiftKey ? -1 : 1);
          else if (e.key === 'ArrowDown' && !e.shiftKey) go(1, 0);
          else if (e.key === 'ArrowUp' && !e.shiftKey) go(-1, 0);
          else if (e.key === 'Escape') {
            input.value = shown;
            start = shown;
            input.blur();
          }
        });
        cell.append(input);

        if (r === 1 && !readOnly) {
          const bar = el('span', 'qt-colbtns');
          bar.append(
            button('left / center / right', '↔', 'qt-x', () => {
              const next = ({ none: 'left', left: 'center', center: 'right', right: 'none' } as const)[v.align[c] ?? 'none'];
              run(tableOp(mdNow(), index, { op: 'align', col: c, align: next } as TableOp));
            }),
          );
          if (ncols > 1) bar.append(button(labels.deleteColumn, '×', 'qt-x', () => run(tableOp(mdNow(), index, { op: 'deleteColumn', col: c }))));
          cell.append(bar);
        }
        tr.append(cell);
      }
      table.append(tr);
    }
    scroll.append(table);
    root.append(scroll);

    // Buttons under the table, and the formula box.
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
    box.append(el('div', 'qt-formulas-title', 'ƒ ' + labels.formulas), area);
    for (const p of v.problems) box.append(el('div', 'qt-problem', p));

    if (!readOnly) {
      bar.append(
        button(labels.addRow, '+ ' + labels.addRow, 'qt-btn', () => run(tableOp(mdNow(), index, { op: 'addRow', at: nrows + 1 }))),
        button(labels.addColumn, '+ ' + labels.addColumn, 'qt-btn', () => run(tableOp(mdNow(), index, { op: 'addColumn', at: ncols }))),
      );
    }
    bar.append(
      button(labels.formulas, 'ƒ', 'qt-btn', () => {
        box.hidden = !box.hidden;
        if (!box.hidden) area.focus();
      }),
      button(labels.editSource, '</>', 'qt-btn', () => {
        const pos = view.posAtDOM(root);
        view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        view.focus();
      }),
    );
    root.append(bar, box);
    return root;
  }
}

function build(state: EditorState, labels: () => TableLabels): DecorationSet {
  const text = state.doc.toString();
  if (!text.includes('|')) return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  const L = labels();
  describeTables(text).forEach((v, i) => {
    const from = state.doc.line(v.fromLine + 1).from;
    const to = state.doc.line(v.toLine + 1).to;
    // While the cursor is inside, show the plain text so it can be edited by hand.
    if (state.selection.ranges.some((r) => r.from <= to && r.to >= from)) return;
    ranges.push(Decoration.replace({ widget: new TableWidget(i, v, L), block: true }).range(from, to));
  });
  return Decoration.set(ranges, true);
}

export function tablesExtension(labels: () => TableLabels) {
  return StateField.define<DecorationSet>({
    create: (state) => build(state, labels),
    update: (value, tr) => (tr.docChanged || tr.selection ? build(tr.state, labels) : value),
    provide: (f) => EditorView.decorations.from(f),
  });
}
