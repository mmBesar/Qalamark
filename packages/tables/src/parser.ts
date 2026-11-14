// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Formula text -> syntax tree. Spreadsheet-style syntax, no eval().
//
//   B2*C2        cell references          SUM(D2:D5)   ranges
//   B*C          whole column, same row   SUM(D)       every row above
//   [Price]      column by header name    IF(B>10,1,0) functions
//
// Operator precedence follows Excel (so -2^2 is 4 and 2^3^2 is 64).

import { ERR } from './value.ts';

export interface Ref {
  col: number; // 0-based column
  row: number; // 1-based row, row 1 is the header
}

export type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'cell'; col: number; row: number }
  | { t: 'col'; col: number | null; name: string | null }
  | { t: 'range'; a: Ref; b: Ref }
  | { t: 'unary'; op: '-' | '+'; x: Node }
  | { t: 'pct'; x: Node }
  | { t: 'bin'; op: string; l: Node; r: Node }
  | { t: 'call'; name: string; args: Node[] };

export class FormulaSyntaxError extends Error {
  readonly code: string;
  constructor(message: string, code: string = ERR.SYNTAX) {
    super(message);
    this.code = code;
  }
}

/** Allowed number of arguments per function: [min, max]. */
const ARITY: Record<string, [number, number]> = {
  SUM: [1, Infinity],
  AVG: [1, Infinity],
  AVERAGE: [1, Infinity],
  MIN: [1, Infinity],
  MAX: [1, Infinity],
  COUNT: [1, Infinity],
  PRODUCT: [1, Infinity],
  MEDIAN: [1, Infinity],
  ROUND: [1, 2],
  FLOOR: [1, 1],
  INT: [1, 1],
  CEIL: [1, 1],
  CEILING: [1, 1],
  ABS: [1, 1],
  SQRT: [1, 1],
  MOD: [2, 2],
  IF: [2, 3],
  AND: [1, Infinity],
  OR: [1, Infinity],
  NOT: [1, 1],
  ROW: [0, 0],
  PREV: [1, 1],
  CHANGE: [1, 1],
  DAYS: [2, 2],
  HOURS: [2, 2],
  MINUTES: [2, 2],
};

export const FUNCTION_NAMES: string[] = Object.keys(ARITY);

/** "A" -> 0, "B" -> 1, "AA" -> 26 */
export function colToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 0 -> "A", 1 -> "B", 26 -> "AA" */
export function indexToCol(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ---------------------------------------------------------------- lexer

interface Tok {
  k: 'num' | 'str' | 'id' | 'br' | 'op' | 'end';
  v: string;
  n: number;
}

const DIGIT = '[0-9\\u0660-\\u0669\\u06f0-\\u06f9]';
const NUMBER_RE = new RegExp(
  `^(?:${DIGIT}+[.\\u066b]?${DIGIT}*|[.\\u066b]${DIGIT}+)(?:[eE][+-]?${DIGIT}+)?`,
);
const IDENT_RE = /^[$A-Za-z_][$A-Za-z0-9_]*/;

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let out = '';
      for (;;) {
        if (j >= src.length) throw new FormulaSyntaxError('Text in quotes is missing its closing "');
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            out += '"';
            j += 2;
            continue;
          }
          break;
        }
        out += src[j];
        j++;
      }
      toks.push({ k: 'str', v: out, n: 0 });
      i = j + 1;
      continue;
    }
    if (ch === '[') {
      const j = src.indexOf(']', i + 1);
      if (j < 0) throw new FormulaSyntaxError('A column name in [ ] is missing its closing ]');
      toks.push({ k: 'br', v: src.slice(i + 1, j).trim(), n: 0 });
      i = j + 1;
      continue;
    }
    const rest = src.slice(i);
    const num = NUMBER_RE.exec(rest);
    if (num) {
      const text = num[0];
      const plain = text
        .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
        .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
        .replace('٫', '.');
      toks.push({ k: 'num', v: text, n: Number(plain) });
      i += text.length;
      continue;
    }
    const id = IDENT_RE.exec(rest);
    if (id) {
      toks.push({ k: 'id', v: id[0], n: 0 });
      i += id[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<>' || two === '<=' || two === '>=') {
      toks.push({ k: 'op', v: two, n: 0 });
      i += 2;
      continue;
    }
    if ('+-*/^&=<>(),:%'.includes(ch)) {
      toks.push({ k: 'op', v: ch, n: 0 });
      i++;
      continue;
    }
    throw new FormulaSyntaxError(`Unexpected character "${ch}"`);
  }
  toks.push({ k: 'end', v: '', n: 0 });
  return toks;
}

// --------------------------------------------------------------- parser

const BIN_PREC: Record<string, number> = {
  '=': 1,
  '<>': 1,
  '<': 1,
  '>': 1,
  '<=': 1,
  '>=': 1,
  '&': 2,
  '+': 3,
  '-': 3,
  '*': 4,
  '/': 4,
  '^': 5,
};

const CELL_RE = /^([A-Z]{1,3})(\d+)$/;
const COL_RE = /^[A-Z]{1,3}$/;

/** Formulas nested deeper than this are refused (keeps the parser safe). */
const MAX_DEPTH = 100;

class Parser {
  private readonly toks: Tok[];
  private pos = 0;
  private depth = 0;

  constructor(toks: Tok[]) {
    this.toks = toks;
  }

  private peek(): Tok {
    return this.toks[this.pos]!;
  }

  private next(): Tok {
    const t = this.toks[this.pos]!;
    if (t.k !== 'end') this.pos++;
    return t;
  }

  private peekOp(v: string): boolean {
    const t = this.peek();
    return t.k === 'op' && t.v === v;
  }

  private expectOp(v: string): void {
    const t = this.next();
    if (t.k !== 'op' || t.v !== v) {
      throw new FormulaSyntaxError(`Expected "${v}"${t.k === 'end' ? ' but the formula ended' : ` but found "${t.v}"`}`);
    }
  }

  parseAll(): Node {
    const node = this.expr(0);
    const t = this.peek();
    if (t.k !== 'end') throw new FormulaSyntaxError(`Unexpected "${t.v}"`);
    return node;
  }

  private enter(): void {
    if (++this.depth > MAX_DEPTH) throw new FormulaSyntaxError('The formula is nested too deeply');
  }

  private expr(minPrec: number): Node {
    this.enter();
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.k !== 'op') break;
      const prec = BIN_PREC[t.v];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const right = this.expr(prec + 1);
      left = { t: 'bin', op: t.v, l: left, r: right };
    }
    this.depth--;
    return left;
  }

  private unary(): Node {
    if (this.peekOp('-') || this.peekOp('+')) {
      const op = this.next().v as '-' | '+';
      this.enter();
      const x = this.unary();
      this.depth--;
      return { t: 'unary', op, x };
    }
    let x = this.primary();
    while (this.peekOp('%')) {
      this.next();
      x = { t: 'pct', x };
    }
    return x;
  }

  private primary(): Node {
    const t = this.next();
    switch (t.k) {
      case 'num':
        return { t: 'num', v: t.n };
      case 'str':
        return { t: 'str', v: t.v };
      case 'br':
        return { t: 'col', col: null, name: t.v };
      case 'id':
        return this.phrase(t.v) ?? this.identifier(t.v);
      case 'op':
        if (t.v === '(') {
          const inner = this.expr(0);
          this.expectOp(')');
          return inner;
        }
        throw new FormulaSyntaxError(`Unexpected "${t.v}"`);
      default:
        throw new FormulaSyntaxError('The formula ended too early');
    }
  }

  private word(w: string): boolean {
    const t = this.peek();
    return t.k === 'id' && t.v.toLowerCase() === w;
  }

  private skipWords(...ws: string[]): void {
    while (ws.some((w) => this.word(w))) this.next();
  }

  /** The column a plain-words phrase talks about: [Header] or a column letter. */
  private operand(what: string): Node {
    this.skipWords('of', 'in', 'the');
    const t = this.peek();
    if (t.k === 'br' || t.k === 'id' || (t.k === 'op' && t.v === '(')) return this.primary();
    throw new FormulaSyntaxError(`"${what}" needs a column after it, like ${what} [Price]`);
  }

  /**
   * Plain-words formulas. They read like a sentence:
   *   previous [Meter]            the value one row above
   *   change in [Meter]           this row minus the row above (0 on the first row)
   *   total of [Price]            also: average of, highest, lowest, count of
   *   days between [A] and [B]    also: hours between, minutes between
   *   days since previous [Date]  shorthand for days between previous [Date] and [Date]
   */
  private phrase(raw: string): Node | null {
    if (this.peekOp('(')) return null; // a normal function call, like SUM(D)
    const w = raw.toLowerCase();
    const agg: Record<string, string> = {
      total: 'SUM',
      sum: 'SUM',
      average: 'AVG',
      highest: 'MAX',
      maximum: 'MAX',
      biggest: 'MAX',
      lowest: 'MIN',
      minimum: 'MIN',
      smallest: 'MIN',
      count: 'COUNT',
    };
    if (w === 'previous' || w === 'above') {
      return { t: 'call', name: 'PREV', args: [this.operand(w)] };
    }
    if (w === 'change') {
      return { t: 'call', name: 'CHANGE', args: [this.operand('change in')] };
    }
    if (agg[w] !== undefined && (this.word('of') || this.peek().k === 'br')) {
      return { t: 'call', name: agg[w]!, args: [this.operand(w)] };
    }
    if ((w === 'days' || w === 'hours' || w === 'minutes') && (this.word('between') || this.word('since'))) {
      const name = w.toUpperCase();
      const since = this.word('since');
      this.next();
      const a = this.operand(w);
      if (since) {
        // "days since previous [Date]" -> from the earlier date up to this row's date
        const col = a.t === 'call' && a.name === 'PREV' ? a.args[0]! : a;
        return { t: 'call', name, args: [a, col] };
      }
      this.skipWords('and');
      const b = this.operand(w);
      return { t: 'call', name, args: [a, b] };
    }
    return null;
  }

  private identifier(raw: string): Node {
    if (this.peekOp('(')) return this.call(raw);
    const up = raw.replace(/\$/g, '').toUpperCase();
    if (up === 'TRUE') return { t: 'bool', v: true };
    if (up === 'FALSE') return { t: 'bool', v: false };

    const cell = CELL_RE.exec(up);
    if (cell) {
      const a: Ref = { col: colToIndex(cell[1]!), row: Number(cell[2]) };
      if (this.peekOp(':')) {
        this.next();
        const t2 = this.next();
        const second = t2.k === 'id' ? CELL_RE.exec(t2.v.replace(/\$/g, '').toUpperCase()) : null;
        if (!second) throw new FormulaSyntaxError('Expected a cell like D5 after ":"');
        return { t: 'range', a, b: { col: colToIndex(second[1]!), row: Number(second[2]) } };
      }
      return { t: 'cell', col: a.col, row: a.row };
    }
    if (COL_RE.test(up)) {
      if (this.peekOp(':')) throw new FormulaSyntaxError('Write ranges with rows, like D2:D5');
      return { t: 'col', col: colToIndex(up), name: null };
    }
    throw new FormulaSyntaxError(`Unknown name "${raw}"`, ERR.NAME);
  }

  private call(raw: string): Node {
    const name = raw.toUpperCase();
    const arity = ARITY[name];
    if (!arity) throw new FormulaSyntaxError(`Unknown function "${raw}"`, ERR.NAME);
    this.expectOp('(');
    const args: Node[] = [];
    if (!this.peekOp(')')) {
      for (;;) {
        args.push(this.expr(0));
        if (this.peekOp(',')) {
          this.next();
          continue;
        }
        break;
      }
    }
    this.expectOp(')');
    const [min, max] = arity;
    if (args.length < min || args.length > max) {
      const want = min === max ? `${min}` : max === Infinity ? `at least ${min}` : `${min} to ${max}`;
      throw new FormulaSyntaxError(`${name} needs ${want} argument(s), got ${args.length}`);
    }
    return { t: 'call', name, args };
  }
}

/** Parse formula text (without a leading "="). Throws FormulaSyntaxError. */
export function parseFormula(src: string): Node {
  return new Parser(lex(src)).parseAll();
}
