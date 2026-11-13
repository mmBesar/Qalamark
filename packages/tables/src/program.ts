// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Reads the formula block that sits under a table:
//
//   <!-- qalamark
//   D = B * C             formula for every row of column D
//   D5 = SUM(D)           formula for one cell
//   [Total] = [Qty] * [Price]   columns can be named by their header
//   format D = #,##0.00   how to write the results
//   -->

import type { Rule } from './evaluator.ts';
import { parseFormat, type NumberFormat } from './numbers.ts';
import { colToIndex, FormulaSyntaxError, parseFormula } from './parser.ts';
import { ERR } from './value.ts';
import { normName } from './evaluator.ts';

export interface FormatRule {
  col: number;
  row: number | null; // null = whole column
  format: NumberFormat;
}

export interface Program {
  rules: Rule[];
  formats: FormatRule[];
  diagnostics: Array<{ line: number; message: string }>;
}

/** Split one line into statements at ";" (but not inside quotes or [ ]). */
export function splitStatements(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  let depth = 0;
  for (const ch of text) {
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && ch === '[') depth++;
    else if (!inQuote && ch === ']' && depth > 0) depth--;
    if (ch === ';' && !inQuote && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter((s) => s !== '');
}

interface RawTarget {
  col: number | null;
  name: string | null;
  row: number | null;
  rest: string;
}

/** Read "D", "D5" or "[Header]" from the start of a statement. */
function readTarget(text: string): RawTarget | null {
  if (text.startsWith('[')) {
    const j = text.indexOf(']');
    if (j < 0) return null;
    return { col: null, name: text.slice(1, j), row: null, rest: text.slice(j + 1) };
  }
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)?(?![A-Za-z0-9])/.exec(text);
  if (!m) return null;
  return {
    col: colToIndex(m[1]!),
    name: null,
    row: m[2] ? Number(m[2]) : null,
    rest: text.slice(m[0].length),
  };
}

function resolveTarget(
  t: RawTarget,
  names: Map<string, number>,
  ncols: number,
): { col: number; row: number | null } | string {
  let col = t.col;
  if (col === null) {
    const idx = names.get(normName(t.name ?? ''));
    if (idx === undefined) return `There is no column named "${t.name}"`;
    col = idx;
  }
  if (col >= ncols) {
    return t.name === null
      ? `The table has only ${ncols} column(s). To use a column's header name, put it in brackets, like [Total]`
      : `The table has only ${ncols} column(s)`;
  }
  if (t.row !== null && t.row < 2) return 'Row 1 is the header row, formulas start at row 2';
  return { col, row: t.row };
}

/** Which cell or column a statement is about (null if it is a format line or unreadable). */
export function statementTarget(
  stmt: string,
  names: Map<string, number>,
  ncols: number,
): { col: number; row: number | null } | null {
  const t = stmt.trim();
  if (/^format\s/i.test(t)) return null;
  const raw = readTarget(t);
  if (!raw) return null;
  const res = resolveTarget(raw, names, ncols);
  return typeof res === 'string' ? null : res;
}

/**
 * @param bodyLines  the text inside the comment, one entry per line
 * @param firstLine  1-based line number of the first entry (for messages)
 */
export function parseProgram(
  bodyLines: string[],
  firstLine: number,
  names: Map<string, number>,
  ncols: number,
): Program {
  const rules: Rule[] = [];
  const formats: FormatRule[] = [];
  const diagnostics: Program['diagnostics'] = [];

  bodyLines.forEach((line, i) => {
    const lineNo = firstLine + i;
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('#')) return;

    for (const st of splitStatements(trimmed)) {
      const fm = /^format\s+/i.exec(st);
      const body = fm ? st.slice(fm[0].length) : st;
      const raw = readTarget(body);
      if (!raw) {
        diagnostics.push({ line: lineNo, message: `Cannot tell which cell or column "${st}" is for` });
        continue;
      }
      const rest = raw.rest.trim();
      if (!rest.startsWith('=')) {
        diagnostics.push({ line: lineNo, message: `Expected "=" after the target in "${st}"` });
        continue;
      }
      const target = resolveTarget(raw, names, ncols);
      if (typeof target === 'string') {
        diagnostics.push({ line: lineNo, message: `"${st}": ${target}` });
        continue;
      }
      let expr = rest.slice(1).trim();

      if (fm) {
        const format = parseFormat(expr);
        if (!format) {
          diagnostics.push({ line: lineNo, message: `"${expr}" is not a number format (try 0.00)` });
          continue;
        }
        formats.push({ col: target.col, row: target.row, format });
        continue;
      }

      if (expr.startsWith('=')) expr = expr.slice(1).trim();
      let ast = null;
      let error: string | null = null;
      let code: string = ERR.SYNTAX;
      try {
        ast = parseFormula(expr);
      } catch (e) {
        if (!(e instanceof FormulaSyntaxError)) throw e;
        error = e.message;
        code = e.code;
        diagnostics.push({ line: lineNo, message: `"${st}": ${e.message}` });
      }
      rules.push({ col: target.col, row: target.row, ast, error, code });
    }
  });

  return { rules, formats, diagnostics };
}
