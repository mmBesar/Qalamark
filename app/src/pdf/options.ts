// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// What a PDF export can be told. Everything has a default; the person can make their own choices the defaults.

export interface PdfOptions {
  paper: 'A4' | 'A5' | 'A3' | 'Letter' | 'Legal';
  landscape: boolean;
  /** Page margin in millimetres. */
  margin: number;
  /** Text size in points. */
  size: number;
  spacing: 'tight' | 'normal' | 'airy';
  /** Shrink the text until the whole note fits on one page. */
  fitOne: boolean;
  /** Arabic letter style: the Naskh book face or a clean sans. */
  arabic: 'naskh' | 'sans';
  /** Put the note's name at the top as a title. */
  title: boolean;
  /** Header and footer: left, middle, right. Words in braces are filled in: {file} {title} {date} {time} {page} {pages}. */
  headerL: string; headerC: string; headerR: string;
  footerL: string; footerC: string; footerR: string;
  /** A thin line between the header or footer and the page. */
  rules: boolean;
  /** Links: blue like on the web, or the same black as the text. */
  linkColor: 'blue' | 'black';
  linkUnderline: boolean;
  /** Write the web address in brackets after a link's words (useful on paper). */
  linkShowUrl: boolean;
  /** Plain black and white: no tinted boxes or shaded cells (saves ink). */
  plain: boolean;
  /** Start every top heading on a new page. */
  breakH1: boolean;
  /** Draw table lines, shade the header row, and tint every second row. */
  tableLines: boolean;
  tableZebra: boolean;
  /** Include pictures. */
  pictures: boolean;
  /** Keep the code font for code and show a grey box behind it. */
  codeBox: boolean;
  /** Text colour: pure black or a soft dark grey. */
  ink: 'black' | 'soft';
}

export const DEFAULT_PDF: PdfOptions = {
  paper: 'A4', landscape: false, margin: 20, size: 12, spacing: 'normal', fitOne: false, arabic: 'naskh', title: false,
  headerL: '', headerC: '', headerR: '', footerL: '{file}', footerC: '', footerR: '{page} / {pages}', rules: false,
  linkColor: 'blue', linkUnderline: false, linkShowUrl: false, plain: false, breakH1: false,
  tableLines: true, tableZebra: false, pictures: true, codeBox: true, ink: 'black',
};

export const PAPERS: Record<PdfOptions['paper'], [number, number]> = {
  A4: [595.28, 841.89], A5: [419.53, 595.28], A3: [841.89, 1190.55], Letter: [612, 792], Legal: [612, 1008],
};

/** Options from storage (possibly written by an older version), always complete and in range. */
export function cleanOptions(raw: unknown): PdfOptions {
  const o: Record<string, unknown> = { ...DEFAULT_PDF };
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_PDF)) if (typeof r[k] === typeof (DEFAULT_PDF as unknown as Record<string, unknown>)[k]) o[k] = r[k];
  // older versions: a page-number switch and word sizes
  if (r.pageNumbers === true && !('footerR' in r)) o.footerR = '{page}';
  if (r.pageNumbers === false && !('footerR' in r)) { o.footerR = ''; o.footerL = ''; }
  if (r.margin === 'narrow') o.margin = 12; else if (r.margin === 'wide') o.margin = 28;
  if (r.size === 'small') o.size = 10.5; else if (r.size === 'large') o.size = 14;
  if (!(o.paper as string in PAPERS)) o.paper = 'A4';
  o.margin = Math.min(50, Math.max(5, Number(o.margin) || 20));
  o.size = Math.min(24, Math.max(6, Number(o.size) || 12));
  return o as unknown as PdfOptions;
}
