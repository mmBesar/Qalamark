// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Works out the value of table cells that have formulas.
//
// Cells are evaluated on demand and remembered, so a formula can use the
// result of another formula, in any order. A formula that depends on itself
// gives #CYCLE!.

import { normalizeDigits, parseNumber, roundTo } from './numbers.ts';
import type { Node, Ref } from './parser.ts';
import { CellError, ERR, toText, type Scalar } from './value.ts';

/** One formula: either for a single cell (row set) or a whole column (row null). */
export interface Rule {
  col: number;
  row: number | null;
  ast: Node | null;
  source: string; // the formula text as written (without the leading "=")
  error: string | null; // why the formula could not be read, if it could not
  code: string; // error code shown in the cell in that case
}

interface Frame {
  row: number;
  col: number;
  reads: number; // single cells this formula read
  nonEmpty: number; // ...of which had something in them
}

type BinNode = Extract<Node, { t: 'bin' }>;
type CallNode = Extract<Node, { t: 'call' }>;

/** Functions whose arguments may be whole columns or ranges. */
const AGGREGATES = new Set(['SUM', 'AVG', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'PRODUCT', 'MEDIAN']);

/** True when a formula totals a column or range (SUM(D), AVG(B2:B9) ...). */
function usesAggregate(node: Node): boolean {
  switch (node.t) {
    case 'call':
      return (
        (AGGREGATES.has(node.name) && node.args.some((a) => a.t === 'col' || a.t === 'range')) ||
        node.args.some(usesAggregate)
      );
    case 'unary':
    case 'pct':
      return usesAggregate(node.x);
    case 'bin':
      return usesAggregate(node.l) || usesAggregate(node.r);
    default:
      return false;
  }
}

/** Header text -> column index, using comparable names. */
export function nameMap(header: string[]): Map<string, number> {
  const map = new Map<string, number>();
  header.forEach((h, i) => {
    const n = normName(h);
    if (n !== '' && !map.has(n)) map.set(n, i);
  });
  return map;
}

/** Make header names comparable: ignore case, bold marks and extra spaces. */
export function normName(s: string): string {
  return normalizeDigits(s)
    .replace(/\\\|/g, '|')
    .replace(/^[*_`~\s]+|[*_`~\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFC');
}

function toNum(v: Scalar): number | CellError {
  if (v instanceof CellError) return v;
  if (v === null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = parseNumber(v);
  return n === null ? new CellError(ERR.VALUE) : n;
}

function toBool(v: Scalar): boolean | CellError {
  if (v instanceof CellError) return v;
  if (v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const up = v.trim().toUpperCase();
  if (up === 'TRUE') return true;
  if (up === 'FALSE') return false;
  return new CellError(ERR.VALUE);
}

function compare(a: Scalar, b: Scalar): number | CellError {
  if (a instanceof CellError) return a;
  if (b instanceof CellError) return b;
  let x: Exclude<Scalar, CellError> = a;
  let y: Exclude<Scalar, CellError> = b;
  if (x === null) x = typeof y === 'string' ? '' : typeof y === 'boolean' ? false : 0;
  if (y === null) y = typeof x === 'string' ? '' : typeof x === 'boolean' ? false : 0;
  if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : x > y ? 1 : 0;
  if (typeof x === 'boolean' && typeof y === 'boolean') return Number(x) - Number(y);
  const sx = toText(x).toLowerCase();
  const sy = toText(y).toLowerCase();
  return sx < sy ? -1 : sx > sy ? 1 : 0;
}

function aggregate(name: string, nums: number[]): Scalar {
  switch (name) {
    case 'SUM': {
      let s = 0;
      for (const n of nums) s += n;
      return s;
    }
    case 'AVG':
    case 'AVERAGE': {
      if (nums.length === 0) return new CellError(ERR.DIV0);
      let s = 0;
      for (const n of nums) s += n;
      return s / nums.length;
    }
    case 'MIN': {
      if (nums.length === 0) return 0;
      let m = nums[0]!;
      for (const n of nums) if (n < m) m = n;
      return m;
    }
    case 'MAX': {
      if (nums.length === 0) return 0;
      let m = nums[0]!;
      for (const n of nums) if (n > m) m = n;
      return m;
    }
    case 'COUNT':
      return nums.length;
    case 'PRODUCT': {
      if (nums.length === 0) return 0;
      let p = 1;
      for (const n of nums) p *= n;
      return p;
    }
    case 'MEDIAN': {
      if (nums.length === 0) return new CellError(ERR.VALUE);
      const sorted = [...nums].sort((p, q) => p - q);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    }
    default:
      return new CellError(ERR.NAME);
  }
}

export class Evaluator {
  private readonly cells: string[][];
  private readonly ncols: number;
  private readonly names: Map<string, number>;
  private readonly cellRules = new Map<number, Rule>();
  private readonly colRules = new Map<number, Rule>();
  private readonly summaryRows = new Set<number>();
  private readonly memo = new Map<number, Scalar>();
  private readonly visiting = new Set<number>();

  /**
   * @param cells    text of every cell, row 0 is the header row
   * @param ncols    number of columns
   * @param rules    formulas (a later rule for the same target wins)
   * @param names    normalised header name -> column index
   */
  constructor(cells: string[][], ncols: number, rules: Rule[], names: Map<string, number>) {
    this.cells = cells;
    this.ncols = ncols;
    this.names = names;
    for (const r of rules) {
      if (r.row === null) this.colRules.set(r.col, r);
      else {
        this.cellRules.set(this.key(r.row, r.col), r);
        // Only rows with a total formula are skipped by column formulas.
        if (r.ast && usesAggregate(r.ast)) this.summaryRows.add(r.row);
      }
    }
  }

  private key(row: number, col: number): number {
    return row * 100000 + col;
  }

  /**
   * Work out every formula cell, dependencies first, without deep recursion.
   * Call this before reading values: a long chain of formulas (each using the
   * one above) would otherwise overflow the call stack, and a circular chain
   * of any length is found here.
   */
  prepare(): void {
    const state = new Map<number, number>(); // 1 = being visited, 2 = done
    const order: number[] = [];
    const cyclic = new Set<number>();
    for (const t of this.targets()) {
      if (t.row > this.cells.length) continue;
      const start = this.key(t.row, t.col);
      if (state.has(start)) continue;
      state.set(start, 1);
      const stack = [{ key: start, it: this.depKeys(start) }];
      while (stack.length > 0) {
        const top = stack[stack.length - 1]!;
        const next = top.it.next();
        if (next.done) {
          state.set(top.key, 2);
          order.push(top.key);
          stack.pop();
          continue;
        }
        const dep = next.value;
        const s = state.get(dep);
        if (s === undefined) {
          state.set(dep, 1);
          stack.push({ key: dep, it: this.depKeys(dep) });
        } else if (s === 1) {
          cyclic.add(dep); // we came back to a cell we are still working out
        }
      }
    }
    for (const k of cyclic) this.memo.set(k, new CellError(ERR.CYCLE));
    for (const k of order) {
      const row = Math.floor(k / 100000);
      this.getCell(row, k - row * 100000);
    }
  }

  /** Formula cells that the formula in cell `k` reads. */
  private *depKeys(k: number): Generator<number> {
    const row = Math.floor(k / 100000);
    const col = k - row * 100000;
    const rule = this.ruleFor(row, col);
    if (!rule?.ast) return;
    for (const d of this.dependencies(rule.ast, row, false)) {
      const dRow = Math.floor(d / 100000);
      if (this.ruleFor(dRow, d - dRow * 100000)) yield d;
    }
  }

  /** Every cell a formula may read (same reading rules as the evaluator). */
  private *dependencies(node: Node, row: number, list: boolean): Generator<number> {
    switch (node.t) {
      case 'cell':
        if (node.row >= 1 && node.row <= this.cells.length && node.col < this.ncols) {
          yield this.key(node.row, node.col);
        }
        return;
      case 'col': {
        const col = this.resolveCol(node);
        if (col instanceof CellError) return;
        if (list) {
          const last = Math.min(row - 1, this.cells.length);
          for (let r = 2; r <= last; r++) yield this.key(r, col);
        } else if (row <= this.cells.length) {
          yield this.key(row, col);
        }
        return;
      }
      case 'range': {
        const r1 = Math.max(1, Math.min(node.a.row, node.b.row));
        const r2 = Math.min(this.cells.length, Math.max(node.a.row, node.b.row));
        const c1 = Math.min(node.a.col, node.b.col);
        const c2 = Math.min(this.ncols - 1, Math.max(node.a.col, node.b.col));
        for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) yield this.key(r, c);
        return;
      }
      case 'unary':
      case 'pct':
        yield* this.dependencies(node.x, row, false);
        return;
      case 'bin':
        yield* this.dependencies(node.l, row, false);
        yield* this.dependencies(node.r, row, false);
        return;
      case 'call': {
        const inList = AGGREGATES.has(node.name);
        for (const arg of node.args) yield* this.dependencies(arg, row, inList);
        return;
      }
      default:
        return;
    }
  }

  /** The formula that drives a cell, if any. */
  ruleAt(row: number, col: number): Rule | undefined {
    return this.ruleFor(row, col);
  }

  /** Rows with a total formula, in order. */
  summaryRowList(): number[] {
    return [...this.summaryRows].sort((a, b) => a - b);
  }

  /** Every cell that gets its value from a formula. */
  targets(): Array<{ row: number; col: number }> {
    const out: Array<{ row: number; col: number }> = [];
    for (const r of this.cellRules.values()) out.push({ row: r.row!, col: r.col });
    for (const col of this.colRules.keys()) {
      for (let row = 2; row <= this.cells.length; row++) {
        if (this.summaryRows.has(row)) continue; // rows with their own formulas (Total rows)
        out.push({ row, col });
      }
    }
    return out;
  }

  private ruleFor(row: number, col: number): Rule | undefined {
    if (row < 2) return undefined;
    const own = this.cellRules.get(this.key(row, col));
    if (own) return own;
    if (this.summaryRows.has(row)) return undefined;
    return this.colRules.get(col);
  }

  /** Value of one cell (row 1 = header row, col 0 = first column). */
  getCell(row: number, col: number): Scalar {
    if (row < 1 || row > this.cells.length || col < 0 || col >= this.ncols) {
      return new CellError(ERR.REF);
    }
    const k = this.key(row, col);
    const known = this.memo.get(k);
    if (known !== undefined) return known;

    const rule = this.ruleFor(row, col);
    let value: Scalar;
    if (!rule) {
      value = this.raw(row, col);
    } else {
      if (this.visiting.has(k)) return new CellError(ERR.CYCLE);
      this.visiting.add(k);
      value = this.run(rule, row, col);
      this.visiting.delete(k);
    }
    this.memo.set(k, value);
    return value;
  }

  /** Evaluate a formula as if it were typed into (row, col). */
  evaluateAt(ast: Node, row: number, col: number): Scalar {
    return this.scalar(ast, { row, col, reads: 0, nonEmpty: 0 });
  }

  private raw(row: number, col: number): Scalar {
    const text = this.cells[row - 1]?.[col] ?? '';
    if (text === '') return null;
    const n = parseNumber(text);
    return n === null ? text : n;
  }

  private run(rule: Rule, row: number, col: number): Scalar {
    if (!rule.ast) return new CellError(rule.code);
    const f: Frame = { row, col, reads: 0, nonEmpty: 0 };
    const value = this.scalar(rule.ast, f);
    // A row that is still empty (nothing typed in the cells it reads) stays empty.
    if (f.reads > 0 && f.nonEmpty === 0) return null;
    return value;
  }

  private read(row: number, col: number, f: Frame): Scalar {
    const v = this.getCell(row, col);
    f.reads++;
    if (v !== null && v !== '') f.nonEmpty++;
    return v;
  }

  private resolveCol(node: Extract<Node, { t: 'col' }>): number | CellError {
    if (node.col !== null) return node.col < this.ncols ? node.col : new CellError(ERR.REF);
    const idx = this.names.get(normName(node.name ?? ''));
    return idx === undefined ? new CellError(ERR.NAME) : idx;
  }

  /** Every row above the formula's row, in one column. */
  private above(col: number, f: Frame): Scalar[] {
    const out: Scalar[] = [];
    const last = Math.min(f.row - 1, this.cells.length);
    for (let r = 2; r <= last; r++) out.push(this.getCell(r, col));
    return out;
  }

  private range(a: Ref, b: Ref): Scalar[] | CellError {
    const r1 = Math.min(a.row, b.row);
    const r2 = Math.max(a.row, b.row);
    const c1 = Math.min(a.col, b.col);
    const c2 = Math.max(a.col, b.col);
    if (r1 < 1 || r2 > this.cells.length || c2 >= this.ncols) return new CellError(ERR.REF);
    const out: Scalar[] = [];
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(this.getCell(r, c));
    return out;
  }

  private scalar(node: Node, f: Frame): Scalar {
    const v = this.ev(node, f, false);
    return Array.isArray(v) ? new CellError(ERR.VALUE) : v;
  }

  private num(node: Node, f: Frame): number | CellError {
    return toNum(this.scalar(node, f));
  }

  /** `list` is true for function arguments, where a column or range means many values. */
  private ev(node: Node, f: Frame, list: boolean): Scalar | Scalar[] {
    switch (node.t) {
      case 'num':
      case 'str':
      case 'bool':
        return node.v;
      case 'cell':
        return this.read(node.row, node.col, f);
      case 'col': {
        const col = this.resolveCol(node);
        if (col instanceof CellError) return col;
        return list ? this.above(col, f) : this.read(f.row, col, f);
      }
      case 'range':
        return list ? this.range(node.a, node.b) : new CellError(ERR.VALUE);
      case 'unary': {
        const n = this.num(node.x, f);
        if (n instanceof CellError) return n;
        return node.op === '-' ? -n : n;
      }
      case 'pct': {
        const n = this.num(node.x, f);
        return n instanceof CellError ? n : n / 100;
      }
      case 'bin':
        return this.binary(node, f);
      case 'call':
        return this.call(node, f);
    }
  }

  private binary(node: BinNode, f: Frame): Scalar {
    const l = this.scalar(node.l, f);
    const r = this.scalar(node.r, f);
    const op = node.op;

    if (op === '&') {
      if (l instanceof CellError) return l;
      if (r instanceof CellError) return r;
      return toText(l) + toText(r);
    }
    if (op === '=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=') {
      const c = compare(l, r);
      if (c instanceof CellError) return c;
      switch (op) {
        case '=':
          return c === 0;
        case '<>':
          return c !== 0;
        case '<':
          return c < 0;
        case '>':
          return c > 0;
        case '<=':
          return c <= 0;
        default:
          return c >= 0;
      }
    }

    const a = toNum(l);
    if (a instanceof CellError) return a;
    const b = toNum(r);
    if (b instanceof CellError) return b;
    let out: number;
    switch (op) {
      case '+':
        out = a + b;
        break;
      case '-':
        out = a - b;
        break;
      case '*':
        out = a * b;
        break;
      case '/':
        if (b === 0) return new CellError(ERR.DIV0);
        out = a / b;
        break;
      default:
        out = Math.pow(a, b);
    }
    return Number.isFinite(out) ? out : new CellError(ERR.VALUE);
  }

  /** Numbers from function arguments. Text and empty cells in ranges are skipped. */
  private collect(args: Node[], f: Frame): number[] | CellError {
    const nums: number[] = [];
    for (const arg of args) {
      const r = this.ev(arg, f, true);
      if (r instanceof CellError) return r;
      if (Array.isArray(r)) {
        for (const v of r) {
          if (v instanceof CellError) return v;
          if (typeof v === 'number') nums.push(v);
        }
      } else if (r !== null) {
        if (typeof r === 'number') nums.push(r);
        else if (typeof r === 'boolean') nums.push(r ? 1 : 0);
        else {
          const n = parseNumber(r);
          if (n === null) return new CellError(ERR.VALUE);
          nums.push(n);
        }
      }
    }
    return nums;
  }

  private call(node: CallNode, f: Frame): Scalar {
    const a = node.args;
    switch (node.name) {
      case 'SUM':
      case 'AVG':
      case 'AVERAGE':
      case 'MIN':
      case 'MAX':
      case 'COUNT':
      case 'PRODUCT':
      case 'MEDIAN': {
        const nums = this.collect(a, f);
        return nums instanceof CellError ? nums : aggregate(node.name, nums);
      }
      case 'ROUND': {
        const x = this.num(a[0]!, f);
        if (x instanceof CellError) return x;
        let digits = 0;
        if (a[1]) {
          const d = this.num(a[1], f);
          if (d instanceof CellError) return d;
          digits = Math.trunc(d);
        }
        return roundTo(x, digits);
      }
      case 'FLOOR':
      case 'INT': {
        const x = this.num(a[0]!, f);
        return x instanceof CellError ? x : Math.floor(x);
      }
      case 'CEIL':
      case 'CEILING': {
        const x = this.num(a[0]!, f);
        return x instanceof CellError ? x : Math.ceil(x);
      }
      case 'ABS': {
        const x = this.num(a[0]!, f);
        return x instanceof CellError ? x : Math.abs(x);
      }
      case 'SQRT': {
        const x = this.num(a[0]!, f);
        if (x instanceof CellError) return x;
        return x < 0 ? new CellError(ERR.VALUE) : Math.sqrt(x);
      }
      case 'MOD': {
        const x = this.num(a[0]!, f);
        if (x instanceof CellError) return x;
        const y = this.num(a[1]!, f);
        if (y instanceof CellError) return y;
        return y === 0 ? new CellError(ERR.DIV0) : x - y * Math.floor(x / y);
      }
      case 'IF': {
        const c = toBool(this.scalar(a[0]!, f));
        if (c instanceof CellError) return c;
        if (c) return this.scalar(a[1]!, f);
        return a[2] ? this.scalar(a[2], f) : null;
      }
      case 'AND':
      case 'OR': {
        const isAnd = node.name === 'AND';
        let result = isAnd;
        for (const arg of a) {
          const b = toBool(this.scalar(arg, f));
          if (b instanceof CellError) return b;
          result = isAnd ? result && b : result || b;
        }
        return result;
      }
      case 'NOT': {
        const b = toBool(this.scalar(a[0]!, f));
        return b instanceof CellError ? b : !b;
      }
      case 'ROW':
        return f.row;
      default:
        return new CellError(ERR.NAME);
    }
  }
}
