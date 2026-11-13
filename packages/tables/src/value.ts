// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The kinds of values a formula can produce, and how they are written as text.

import { formatDefault, formatWith, type NumberFormat } from './numbers.ts';

/** Error codes that can appear in a cell (same names spreadsheets use). */
export const ERR = {
  DIV0: '#DIV/0!',
  REF: '#REF!',
  NAME: '#NAME?',
  VALUE: '#VALUE!',
  CYCLE: '#CYCLE!',
  SYNTAX: '#ERR!',
} as const;

export class CellError {
  readonly code: string;
  constructor(code: string) {
    this.code = code;
  }
}

/** A cell value: number, text, true/false, empty (null) or an error. */
export type Scalar = number | string | boolean | null | CellError;

/** Plain text of a value, as used by the & operator. */
export function toText(v: Scalar): string {
  if (v === null) return '';
  if (v instanceof CellError) return v.code;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return formatDefault(v);
  return v;
}

/** Text to store inside a Markdown table cell (pipes escaped, one line). */
export function toCellText(v: Scalar, fmt: NumberFormat | null): string {
  const s = typeof v === 'number' && fmt ? formatWith(fmt, v) : toText(v);
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
