// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The main entry point: read a Markdown document, work out every table
// formula, and write the results back into the cells.
//
// Two ways to add a formula:
//   1. Write it in the <!-- qalamark ... --> comment under the table.
//   2. Type it into a cell starting with "=" (for one cell) or "==" (for the
//      whole column). It is moved into the comment and the cell shows the result.

import { Evaluator, nameMap } from './evaluator.ts';
import {
  applyEdits,
  findTables,
  gridOf,
  parseDoc,
  printDoc,
  rawCellText,
  spliceLines,
  cellText,
  type CellEdit,
  type Doc,
  type TableInfo,
} from './markdown.ts';
import type { NumberFormat } from './numbers.ts';
import { FormulaSyntaxError, indexToCol, parseFormula } from './parser.ts';
import { parseProgram, splitStatements, statementTarget, type FormatRule } from './program.ts';
import { CellError, toCellText, type Scalar } from './value.ts';

export interface Diagnostic {
  line: number; // 1-based line in the document
  message: string;
}

export interface RecalcResult {
  markdown: string;
  changed: boolean;
  tables: number; // tables that have formulas
  diagnostics: Diagnostic[];
}

export interface RecalcOptions {
  /** Move formulas typed into cells ("=SUM(D)") into the comment. Default true. */
  lift?: boolean;
}

const HAS_BLOCK = /<!--\s*qalamark\b/i;
const HAS_INLINE = /\|\s*=/;

function formatFor(formats: FormatRule[], col: number, row: number): NumberFormat | null {
  let colFormat: NumberFormat | null = null;
  for (const f of formats) {
    if (f.col !== col) continue;
    if (f.row === row) return f.format;
    if (f.row === null) colFormat = f.format;
  }
  return colFormat;
}

// --------------------------------------------------- typed-in formulas

interface Found {
  row: number;
  col: number;
  expr: string;
  wholeColumn: boolean;
}

/** Move "=..." cells of one table into its formula comment. */
function liftTable(doc: Doc, t: TableInfo): void {
  const found: Found[] = [];
  for (let r = 1; r < t.rows.length; r++) {
    const row = t.rows[r]!;
    const line = doc.lines[row.line]!;
    for (let c = 0; c < Math.min(row.cells.length, t.ncols); c++) {
      const text = cellText(line, row.cells[c]!);
      if (text.length < 2 || !text.startsWith('=')) continue;
      let expr = text.slice(1).trim();
      let wholeColumn = false;
      if (expr.startsWith('=')) {
        wholeColumn = true;
        expr = expr.slice(1).trim();
      }
      if (expr !== '') found.push({ row: r + 1, col: c, expr, wholeColumn });
    }
  }
  if (found.length === 0) return;

  // 1) Empty the cells (the real value is filled in by the recalculation).
  const edits: CellEdit[] = found.map((f) => ({ row: f.row, col: f.col, text: '' }));
  applyEdits(doc, t, edits);

  // 2) Add the formulas to the comment, replacing older ones for the same target.
  const header = gridOf(doc.lines, t)[0]!;
  const names = nameMap(header);
  const added = found.map((f) => ({
    col: f.col,
    row: f.wholeColumn ? null : f.row,
    text: `${indexToCol(f.col)}${f.wholeColumn ? '' : f.row} = ${f.expr}`,
  }));
  const same = (s: string) => {
    const tgt = statementTarget(s, names, t.ncols);
    return tgt !== null && added.some((a) => a.col === tgt.col && a.row === tgt.row);
  };

  const kept: string[] = [];
  for (const body of t.block?.bodyLines ?? []) {
    const trimmed = body.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
      kept.push(trimmed);
      continue;
    }
    const stmts = splitStatements(trimmed);
    const remaining = stmts.filter((s) => !same(s));
    if (remaining.length > 0) kept.push(remaining.join('; '));
  }
  const block = [
    `${t.indent}<!-- qalamark`,
    ...kept.map((s) => `${t.indent}${s}`),
    ...added.map((a) => `${t.indent}${a.text}`),
    `${t.indent}-->`,
  ];
  if (t.block) spliceLines(doc, t.block.start, t.block.end - t.block.start + 1, block);
  else spliceLines(doc, t.lastLine + 1, 0, block);
}

// ------------------------------------------------------ recalculation

function computeTable(doc: Doc, t: TableInfo, diagnostics: Diagnostic[]): void {
  const block = t.block!;
  const cells = gridOf(doc.lines, t);
  const names = nameMap(cells[0]!);
  const program = parseProgram(block.bodyLines, block.start + 1, names, t.ncols);
  diagnostics.push(...program.diagnostics);

  const ev = new Evaluator(cells, t.ncols, program.rules, names);
  try {
    ev.prepare();
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    diagnostics.push({ line: block.start + 1, message: 'This table is too complicated to calculate' });
    return;
  }
  const edits: CellEdit[] = [];
  let reportedOutside = false;
  for (const { row, col } of ev.targets()) {
    if (row > cells.length) {
      if (!reportedOutside) {
        diagnostics.push({
          line: block.start + 1,
          message: `A formula points at row ${row}, but the table only has ${cells.length} rows`,
        });
        reportedOutside = true;
      }
      continue;
    }
    const text = toCellText(ev.getCell(row, col), formatFor(program.formats, col, row));
    if (rawCellText(doc.lines, t, row, col) !== text) edits.push({ row, col, text });
  }
  applyEdits(doc, t, edits);
}

/**
 * Work out all table formulas in a Markdown document.
 * Text outside the changed cells is left exactly as it was.
 */
export function recalculate(md: string, opts: RecalcOptions = {}): RecalcResult {
  const lift = opts.lift !== false;
  if (!HAS_BLOCK.test(md) && !(lift && HAS_INLINE.test(md))) {
    return { markdown: md, changed: false, tables: 0, diagnostics: [] };
  }
  const doc = parseDoc(md);
  if (lift) {
    const found = findTables(doc.lines);
    for (let i = found.length - 1; i >= 0; i--) liftTable(doc, found[i]!); // bottom first
  }
  const diagnostics: Diagnostic[] = [];
  let tables = 0;
  for (const t of findTables(doc.lines)) {
    if (!t.block) continue;
    tables++;
    computeTable(doc, t, diagnostics);
  }
  const markdown = printDoc(doc);
  return { markdown, changed: markdown !== md, tables, diagnostics };
}

/**
 * Evaluate one formula, optionally against table cells (row 0 = header).
 * By default it is evaluated as if typed in a new row under the table, so
 * SUM(B) adds up the whole column. Pass `at` (1-based row) to evaluate inside.
 */
export function evaluateFormula(src: string, cells: string[][] = [['']], at?: number): Scalar {
  let ast;
  try {
    ast = parseFormula(src.trim().replace(/^=/, ''));
  } catch (e) {
    if (e instanceof FormulaSyntaxError) return new CellError(e.code);
    throw e;
  }
  const ncols = Math.max(1, ...cells.map((r) => r.length));
  const grid = cells.map((r) => {
    const row = [...r];
    while (row.length < ncols) row.push('');
    return row;
  });
  const ev = new Evaluator(grid, ncols, [], nameMap(grid[0] ?? []));
  return ev.evaluateAt(ast, at ?? grid.length + 1, 0);
}
