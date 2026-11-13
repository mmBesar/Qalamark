// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Reading numbers out of table cells, and writing numbers back with a format.

/** Turn Arabic-Indic digits (٠-٩, ۰-۹) and Arabic separators into plain ASCII. */
export function normalizeDigits(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x0660 && code <= 0x0669) out += String(code - 0x0660);
    else if (code >= 0x06f0 && code <= 0x06f9) out += String(code - 0x06f0);
    else if (ch === '٫') out += '.'; // Arabic decimal separator
    else if (ch === '٬') out += ','; // Arabic thousands separator
    else out += ch;
  }
  return out;
}

const CURRENCY = '[$€£¥₹]';
const LEADING_CURRENCY = new RegExp(`^([+-]?)\\s*${CURRENCY}\\s*`);
const TRAILING_CURRENCY = new RegExp(`\\s*${CURRENCY}$`);
const THOUSANDS = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Read a number from cell text. Understands: 12, 3.5, 1,234.50, $3.50, -$3,
 * (5) for negatives, 45% (= 0.45), **bold** wrappers and Arabic digits.
 * Returns null when the text is empty or is not a number.
 */
export function parseNumber(input: string): number | null {
  let s = normalizeDigits(input).replace(/ /g, ' ').trim();
  s = s.replace(/^[*_`~]+/, '').replace(/[*_`~]+$/, '').trim();
  if (s === '') return null;

  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  let percent = false;
  if (s.endsWith('%')) {
    percent = true;
    s = s.slice(0, -1).trim();
  }
  s = s.replace(LEADING_CURRENCY, '$1').replace(TRAILING_CURRENCY, '').trim();
  if (THOUSANDS.test(s)) s = s.replace(/,/g, '');
  if (!PLAIN_NUMBER.test(s)) return null;

  let n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (percent) n /= 100;
  if (negative) n = -n;
  return n;
}

/** Round half away from zero, the way people (and spreadsheets) expect. */
export function roundTo(x: number, digits: number): number {
  if (!Number.isFinite(x)) return x;
  if (String(x).includes('e')) {
    // Very large or very small numbers: fall back to the built-in rounding.
    return digits >= 0 ? Number(x.toFixed(Math.min(digits, 100))) + 0 : x;
  }
  const shifted = Number(`${x}e${digits}`);
  const rounded = Math.sign(shifted) * Math.round(Math.abs(shifted));
  const out = Number(`${rounded}e${-digits}`);
  if (!Number.isFinite(out)) return x;
  return out === 0 ? 0 : out;
}

/** Default way to write a number into a cell: no floating point noise. */
export function formatDefault(n: number): string {
  if (!Number.isFinite(n)) return '#VALUE!';
  if (n === 0) return '0';
  return String(Number(n.toPrecision(12)));
}

export interface NumberFormat {
  prefix: string;
  suffix: string;
  minInt: number;
  fracMin: number;
  fracMax: number;
  grouping: boolean;
  percent: boolean;
}

/**
 * Read a format pattern such as 0.00, #,##0.00, $0.00, 0.0% or 0 kg.
 * "0" is a digit that is always shown, "#" is a digit shown only when needed,
 * "," turns on thousands separators, a "%" in the text after the digits
 * multiplies by 100. Returns null when the pattern has no digit placeholder.
 */
export function parseFormat(pattern: string): NumberFormat | null {
  const m = /^([^#0.,]*)([#0,]*)(?:\.([#0]*))?([^#0]*)$/.exec(pattern.trim());
  if (!m) return null;
  const prefix = m[1] ?? '';
  const int = m[2] ?? '';
  const frac = m[3] ?? '';
  const suffix = m[4] ?? '';
  if (!/[#0]/.test(int + frac)) return null;
  return {
    prefix,
    suffix,
    minInt: (int.match(/0/g) ?? []).length,
    fracMin: (frac.match(/0/g) ?? []).length,
    fracMax: frac.length,
    grouping: int.includes(','),
    percent: suffix.includes('%'),
  };
}

/** Write a number using a parsed format. */
export function formatWith(fmt: NumberFormat, n: number): string {
  if (!Number.isFinite(n)) return '#VALUE!';
  const value = fmt.percent ? n * 100 : n;
  const abs = roundTo(Math.abs(value), fmt.fracMax);
  if (abs >= 1e21) return formatDefault(n);
  const negative = value < 0 && abs !== 0;

  const [intRaw = '0', fracRaw = ''] = abs.toFixed(fmt.fracMax).split('.');
  let frac = fracRaw;
  while (frac.length > fmt.fracMin && frac.endsWith('0')) frac = frac.slice(0, -1);
  let int = intRaw;
  if (int === '0' && fmt.minInt === 0) int = frac ? '' : '0';
  int = int.padStart(fmt.minInt, '0');
  if (fmt.grouping) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return (negative ? '-' : '') + fmt.prefix + int + (frac ? `.${frac}` : '') + fmt.suffix;
}

/** Convenience: parse a pattern and format in one step (null pattern = default). */
export function formatNumber(n: number, pattern?: string): string {
  const fmt = pattern === undefined ? null : parseFormat(pattern);
  return fmt ? formatWith(fmt, n) : formatDefault(n);
}
