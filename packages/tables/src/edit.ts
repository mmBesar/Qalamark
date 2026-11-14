// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Helpers for an editor that shows tables as a grid:
//   describeTables  - what is in every table (cells, alignment, which cells have formulas)
//   editCell        - change one cell, then recalculate
//   tableOp         - add / delete a row or a column, keeping formulas pointing at the right cells
//
// Everything takes a Markdown string and gives back a Markdown string.
// Text outside the table that is changed is left exactly as it was.

import { recalculate } from './engine.ts';
import { Evaluator, nameMap } from './evaluator.ts';
import {
  findTables,
  gridOf,
  parseDoc,
  printDoc,
  rawGrid,
  renderTable,
  spliceLines,
  type Align,
  type Doc,
  type TableInfo,
} from './markdown.ts';
import { indexToCol, colToIndex } from './parser.ts';
import { parseProgram, readTarget, splitStatements } from './program.ts';

export interface CellFormula {
  row: number; // 1-based, header = 1
  col: number; // 0-based
  source: string; // the formula text, e.g. "B2 * C2"
  column: boolean; // true when it is a formula for the whole column
}

export interface TableView {
  /** First and last line (0-based) the table takes, including its formula comment. */
  fromLine: number;
  toLine: number;
  /** First and last line of the grid itself (header to last row). */
  gridFrom: number;
  gridTo: number;
  align: Align[];
  /** Cell texts as written in the file (escapes kept), header row first. */
  rows: string[][];
  /** Cells that are driven by a formula (single-cell or whole-column). */
  formulas: CellFormula[];
  /** The formula comment lines, without the <!-- --> wrapper. */
  formulaText: string[];
  /** Problems found in the formulas. */
  problems: string[];
}

function tableRange(t: TableInfo): { from: number; to: number } {
  return { from: t.rows[0]!.line, to: t.block ? t.block.end : t.lastLine };
}

export function describeTables(md: string): TableView[] {
  const doc = parseDoc(md);
  return findTables(doc.lines).map((t) => {
    const { from, to } = tableRange(t);
    const cells = gridOf(doc.lines, t);
    const names = nameMap(cells[0]!);
    const formulas: CellFormula[] = [];
    const problems: string[] = [];
    if (t.block) {
      const program = parseProgram(t.block.bodyLines, t.block.start + 1, names, t.ncols, cells.length);
      problems.push(...program.diagnostics.map((d) => d.message));
      const ev = new Evaluator(cells, t.ncols, program.rules, names);
      try {
        ev.prepare();
        for (const { row, col } of ev.targets()) {
          if (row > cells.length) continue;
          const rule = ev.ruleAt(row, col);
          if (rule) formulas.push({ row, col, source: rule.source, column: rule.row === null });
        }
      } catch {
        problems.push('This table is too complicated to calculate');
      }
    }
    return {
      fromLine: from,
      toLine: to,
      gridFrom: t.rows[0]!.line,
      gridTo: t.lastLine,
      align: t.align,
      rows: rawGrid(doc.lines, t),
      formulas,
      formulaText: t.block ? t.block.bodyLines.map((l) => l.trim()).filter((l) => l !== '') : [],
      problems,
    };
  });
}

/** Make text safe to sit inside a table cell. */
export function escapeCell(text: string): string {
  return text.replace(/\r?\n/g, '<br>').replace(/(?<!\\)\|/g, '\\|');
}

function withTable(md: string, index: number, change: (doc: Doc, t: TableInfo) => void): string {
  const doc = parseDoc(md);
  const t = findTables(doc.lines)[index];
  if (!t) return md;
  change(doc, t);
  return printDoc(doc);
}

/** Replace the grid lines of a table with a freshly laid out grid. */
function writeGrid(doc: Doc, t: TableInfo, texts: string[][], align: Align[]): void {
  const lines = renderTable(texts, align, t.indent);
  spliceLines(doc, t.rows[0]!.line, t.lastLine - t.rows[0]!.line + 1, lines);
}

/**
 * Change one cell (row 1 = header, col 0-based) and recalculate.
 * Typing "=SUM(D)" or "==B*C" works like in the file: it becomes a formula.
 */
export function editCell(md: string, index: number, row: number, col: number, text: string): string {
  const changed = withTable(md, index, (doc, t) => {
    const texts = rawGrid(doc.lines, t);
    if (!texts[row - 1] || col < 0 || col >= texts[0]!.length) return;
    texts[row - 1]![col] = escapeCell(text.trim());
    writeGrid(doc, t, texts, t.align);
  });
  return tidy(recalculate(changed).markdown, index);
}

/** Line up the pipes of one table again (after results changed the cell widths). */
function tidy(md: string, index: number): string {
  return withTable(md, index, (doc, t) => writeGrid(doc, t, rawGrid(doc.lines, t), t.align));
}

// ------------------------------------------------ keeping formulas in step

interface Shift {
  axis: 'row' | 'col';
  at: number; // row: 1-based row number; col: 0-based column index
  kind: 'insert' | 'delete';
}

// "B2:D5", "[Header]", quoted text, or one cell / column reference.
const REF =
  /("[^"]*")|(\[[^\]]*\])|(?<![A-Za-z0-9_.])(\$?)([A-Za-z]{1,3})(\$?)(\d+)?(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+)?)?(?![A-Za-z0-9_(])/g;

/** Move one row number; null when the row is gone. `end` tells whether it closes a range. */
function moveRow(n: number, s: Shift, inRange: boolean, isEnd: boolean): number | null {
  if (s.kind === 'insert') return n >= s.at ? n + 1 : n;
  if (n < s.at) return n;
  if (n > s.at) return n - 1;
  if (!inRange) return null;
  return isEnd ? n - 1 : n; // a range shrinks instead of breaking
}

function moveCol(n: number, s: Shift): number | null {
  if (s.kind === 'insert') return n >= s.at ? n + 1 : n;
  if (n < s.at) return n;
  if (n > s.at) return n - 1;
  return null;
}

/** Rewrite the references in one piece of formula text. Null when something it points at is gone. */
function shiftText(text: string, s: Shift): string | null {
  let broken = false;
  const out = text.replace(REF, (m, quoted, bracket, d1, c1, d2, r1, d3, c2, d4, r2) => {
    if (quoted || bracket) return m;
    const range = c2 !== undefined;
    let col1 = colToIndex(c1);
    let row1: number | null = r1 ? Number(r1) : null;
    let col2 = range ? colToIndex(c2) : 0;
    let row2: number | null = r2 ? Number(r2) : null;
    if (s.axis === 'col') {
      const a = moveCol(col1, s);
      const b = range ? moveCol(col2, s) : 0;
      if (a === null || b === null) {
        broken = true;
        return m;
      }
      col1 = a;
      col2 = b;
    } else {
      if (row1 !== null) {
        const v = moveRow(row1, s, range, false);
        if (v === null) broken = true;
        else row1 = v;
      }
      if (range && row2 !== null) {
        const v = moveRow(row2, s, true, true);
        if (v === null) broken = true;
        else row2 = v;
      }
    }
    const first = `${d1}${indexToCol(col1)}${row1 !== null ? d2 + row1 : ''}`;
    return range ? `${first}:${d3}${indexToCol(col2)}${row2 !== null ? d4 + row2 : ''}` : first;
  });
  return broken ? null : out;
}

/** Rewrite a whole statement ("D5 = SUM(D2:D4)"); null means drop it. */
function shiftStatement(stmt: string, s: Shift): string | null {
  const fm = /^format\s+/i.exec(stmt);
  const body = fm ? stmt.slice(fm[0].length) : stmt;
  const target = readTarget(body);
  if (!target) return stmt;
  const eq = body.indexOf('=', body.length - target.rest.length);
  if (eq < 0) return stmt;
  const lhs = body.slice(0, eq).trim();
  const rhs = body.slice(eq + 1);
  const newLhs = target.name !== null ? lhs : shiftText(lhs, s);
  const newRhs = fm ? rhs : shiftText(rhs, s);
  if (newLhs === null || newRhs === null) return null;
  return `${fm ? fm[0] : ''}${newLhs} = ${newRhs.trim()}`.trimEnd();
}

function shiftBlock(body: string[], s: Shift): string[] {
  const out: string[] = [];
  for (const line of body) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('#')) {
      if (trimmed !== '') out.push(trimmed);
      continue;
    }
    const kept = splitStatements(trimmed)
      .map((st) => shiftStatement(st, s))
      .filter((x): x is string => x !== null);
    if (kept.length > 0) out.push(kept.join('; '));
  }
  return out;
}

function writeBlock(doc: Doc, t: TableInfo, lines: string[]): void {
  if (!t.block) return;
  // Position of the block after the grid has been rewritten.
  const found = findTables(doc.lines).find((x) => x.rows[0]!.line === t.rows[0]!.line);
  const b = found?.block;
  if (!b) return;
  const text = lines.length
    ? [`${t.indent}<!-- qalamark`, ...lines.map((l) => `${t.indent}${l}`), `${t.indent}-->`]
    : [];
  spliceLines(doc, b.start, b.end - b.start + 1, text);
}

/**
 * Replace the formula lines under a table (one formula per line). Empty text removes them.
 * Then everything is recalculated.
 */
export function setFormulas(md: string, index: number, text: string): string {
  const changed = withTable(md, index, (doc, t) => {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '' && !l.includes('-->'));
    const block = lines.length
      ? [`${t.indent}<!-- qalamark`, ...lines.map((l) => `${t.indent}${l}`), `${t.indent}-->`]
      : [];
    if (t.block) spliceLines(doc, t.block.start, t.block.end - t.block.start + 1, block);
    else if (block.length) spliceLines(doc, t.lastLine + 1, 0, block);
  });
  return tidy(recalculate(changed).markdown, index);
}

export type TableOp =
  | { op: 'addRow'; at: number } // new row becomes row `at` (2 or more; rows+1 = at the end)
  | { op: 'deleteRow'; row: number } // 2 or more (the header stays)
  | { op: 'addColumn'; at: number } // new column index (0-based; ncols = at the end)
  | { op: 'deleteColumn'; col: number }
  | { op: 'align'; col: number; align: Align };

/** Add or remove rows and columns, keep formulas pointing at the same cells, recalculate. */
export function tableOp(md: string, index: number, op: TableOp): string {
  const changed = withTable(md, index, (doc, t) => {
    const texts = rawGrid(doc.lines, t);
    const align = [...t.align];
    const ncols = texts[0]!.length;
    const body = t.block?.bodyLines ?? [];
    let shift: Shift | null = null;

    if (op.op === 'addRow') {
      const at = Math.min(Math.max(op.at, 2), texts.length + 1);
      texts.splice(at - 1, 0, Array.from({ length: ncols }, () => ''));
      shift = { axis: 'row', at, kind: 'insert' };
    } else if (op.op === 'deleteRow') {
      if (op.row < 2 || op.row > texts.length) return;
      texts.splice(op.row - 1, 1);
      shift = { axis: 'row', at: op.row, kind: 'delete' };
    } else if (op.op === 'addColumn') {
      const at = Math.min(Math.max(op.at, 0), ncols);
      texts.forEach((r, i) => r.splice(at, 0, i === 0 ? '' : ''));
      align.splice(at, 0, 'none');
      shift = { axis: 'col', at, kind: 'insert' };
    } else if (op.op === 'deleteColumn') {
      if (ncols <= 1 || op.col < 0 || op.col >= ncols) return;
      texts.forEach((r) => r.splice(op.col, 1));
      align.splice(op.col, 1);
      shift = { axis: 'col', at: op.col, kind: 'delete' };
    } else {
      align[op.col] = op.align;
    }

    writeGrid(doc, t, texts, align);
    if (shift && t.block) writeBlock(doc, t, shiftBlock(body, shift));
  });
  return tidy(recalculate(changed).markdown, index);
}
