// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Finding Markdown tables in a document and editing single cells in place.
// The rest of the text is never touched, line endings are kept as they were.

export type Align = 'none' | 'left' | 'right' | 'center';

/** Where one cell's text sits inside its line (between two pipes). */
export interface CellSpan {
  start: number;
  end: number;
}

export interface RowInfo {
  line: number; // index in the document's lines
  cells: CellSpan[];
}

/** The <!-- qalamark ... --> comment directly under a table. */
export interface FormulaBlock {
  start: number; // line of "<!-- qalamark"
  end: number; // line of "-->"
  bodyLines: string[]; // text inside, one entry per line
}

export interface TableInfo {
  rows: RowInfo[]; // header row first; the delimiter row is not listed
  delimLine: number;
  align: Align[];
  ncols: number;
  lastLine: number;
  indent: string;
  block: FormulaBlock | null;
}

// ------------------------------------------------------------ documents

export interface Doc {
  lines: string[];
  eols: string[]; // line ending after each line ('' for the last line if none)
}

export function parseDoc(md: string): Doc {
  const parts = md.split(/(\r?\n)/);
  const lines: string[] = [];
  const eols: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    lines.push(parts[i]!);
    eols.push(parts[i + 1] ?? '');
  }
  return { lines, eols };
}

export function printDoc(doc: Doc): string {
  let out = '';
  for (let i = 0; i < doc.lines.length; i++) out += doc.lines[i]! + doc.eols[i]!;
  return out;
}

/** Replace `deleteCount` lines at `start` with new lines, keeping the file's line ending style. */
export function spliceLines(doc: Doc, start: number, deleteCount: number, newLines: string[]): void {
  const eol = doc.eols.find((e) => e !== '') ?? '\n';
  const lastEol = doc.eols[doc.eols.length - 1]!;
  doc.lines.splice(start, deleteCount, ...newLines);
  doc.eols.splice(start, deleteCount, ...newLines.map(() => eol));
  for (let i = 0; i < doc.eols.length - 1; i++) if (doc.eols[i] === '') doc.eols[i] = eol;
  doc.eols[doc.eols.length - 1] = lastEol;
}

// ----------------------------------------------------------------- rows

/** Split a table line into cells at unescaped pipes. */
export function splitRow(line: string): CellSpan[] {
  const pipes: number[] = [];
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '|') pipes.push(i);
  }
  const first = line.search(/\S/);
  let from = 0;
  if (first >= 0 && line[first] === '|' && pipes[0] === first) {
    from = first + 1;
    pipes.shift();
  }
  const spans: CellSpan[] = [];
  let pos = from;
  for (const p of pipes) {
    spans.push({ start: pos, end: p });
    pos = p + 1;
  }
  if (line.slice(pos).trim() !== '') spans.push({ start: pos, end: line.length });
  return spans;
}

/** Text of a cell as the user sees it (surrounding spaces and \| escapes removed). */
export function cellText(line: string, span: CellSpan): string {
  return line.slice(span.start, span.end).trim().replace(/\\\|/g, '|');
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** How many columns a text takes on screen (accents count 0, CJK and emoji count 2). */
export function displayWidth(s: string): number {
  if (/^[\x20-\x7e]*$/.test(s)) return s.length;
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (
      /\p{M}/u.test(ch) ||
      (cp >= 0x200b && cp <= 0x200f) ||
      (cp >= 0x202a && cp <= 0x202e) ||
      (cp >= 0x2060 && cp <= 0x2064) ||
      cp === 0xfeff
    ) {
      continue;
    }
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}

/** Put new text into one cell, keeping its width (and so the alignment) when it fits. */
export function replaceCell(line: string, span: CellSpan, text: string, align: Align): string {
  const raw = line.slice(span.start, span.end);
  let lead: string;
  let trail: string;
  if (raw.trim() === '') {
    // An empty cell: keep the compact style (||) if that is what the row uses,
    // otherwise one space on each side.
    lead = raw.length >= 1 ? ' ' : '';
    trail = raw.length >= 1 ? ' ' : '';
  } else {
    lead = /^\s*/.exec(raw)![0];
    trail = /\s*$/.exec(raw)![0];
  }
  const extra = displayWidth(raw) - (displayWidth(lead) + displayWidth(text) + displayWidth(trail));
  if (extra > 0) {
    if (align === 'right') lead += ' '.repeat(extra);
    else if (align === 'center') {
      const left = Math.floor(extra / 2);
      lead += ' '.repeat(left);
      trail += ' '.repeat(extra - left);
    } else trail += ' '.repeat(extra);
  }
  return line.slice(0, span.start) + lead + text + trail + line.slice(span.end);
}

/** Give a short row enough cells (rewrites the row in the standard style). */
export function padRow(line: string, n: number): string {
  const indent = /^\s*/.exec(line)![0];
  const cells = splitRow(line).map((s) => line.slice(s.start, s.end).trim());
  while (cells.length < n) cells.push('');
  return `${indent}| ${cells.join(' | ')} |`;
}

// --------------------------------------------------------------- tables

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const BLOCK_START = /^\s*<!--\s*qalamark\b/i;

function isDelimiterRow(line: string): boolean {
  if (!line.includes('|')) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(line.slice(c.start, c.end).trim()));
}

function readBlock(lines: string[], j: number): FormulaBlock | null {
  const first = lines[j]!;
  if (!BLOCK_START.test(first)) return null;
  const head = first.replace(/^\s*<!--\s*qalamark\b\s*:?/i, '');
  const pieces: string[] = [];
  for (let k = j; k < lines.length; k++) {
    const cur = k === j ? head : lines[k]!;
    const close = cur.indexOf('-->');
    if (close >= 0) {
      if (cur.slice(close + 3).trim() !== '') return null;
      pieces.push(cur.slice(0, close));
      return { start: j, end: k, bodyLines: pieces };
    }
    pieces.push(cur);
  }
  return null;
}

/** Find every pipe table that is not inside a fenced code block. */
export function findTables(lines: string[]): TableInfo[] {
  const out: TableInfo[] = [];
  let fence: { ch: string; len: number } | null = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (fence) {
      const m = FENCE_CLOSE.exec(line);
      if (m && m[1]![0] === fence.ch && m[1]!.length >= fence.len) fence = null;
      i++;
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      fence = { ch: open[1]![0]!, len: open[1]!.length };
      i++;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isDelimiterRow(lines[i + 1]!)) {
      const head = splitRow(line);
      const delim = splitRow(lines[i + 1]!);
      if (head.length === delim.length) {
        const rows: RowInfo[] = [{ line: i, cells: head }];
        let j = i + 2;
        while (
          j < lines.length &&
          lines[j]!.trim() !== '' &&
          lines[j]!.includes('|') &&
          !/^\s*<!--/.test(lines[j]!) &&
          !FENCE_OPEN.test(lines[j]!)
        ) {
          rows.push({ line: j, cells: splitRow(lines[j]!) });
          j++;
        }
        const lastLine = j - 1;
        const block = j < lines.length ? readBlock(lines, j) : null;
        const dl = lines[i + 1]!;
        const align = delim.map((c): Align => {
          const t = dl.slice(c.start, c.end).trim();
          const l = t.startsWith(':');
          const r = t.endsWith(':');
          return l && r ? 'center' : r ? 'right' : l ? 'left' : 'none';
        });
        out.push({
          rows,
          delimLine: i + 1,
          align,
          ncols: head.length,
          lastLine,
          indent: /^\s*/.exec(line)![0],
          block,
        });
        i = (block ? block.end : lastLine) + 1;
        continue;
      }
    }
    i++;
  }
  return out;
}

/** Text of every cell (row 0 = header), padded to the table's width. */
export function gridOf(lines: string[], t: TableInfo): string[][] {
  return t.rows.map((r) => {
    const line = lines[r.line]!;
    const row: string[] = [];
    for (let c = 0; c < t.ncols; c++) {
      const span = r.cells[c];
      row.push(span ? cellText(line, span) : '');
    }
    return row;
  });
}

/** Text of a cell exactly as written in the file (trimmed, escapes kept). */
export function rawCellText(lines: string[], t: TableInfo, row: number, col: number): string {
  const r = t.rows[row - 1];
  const span = r?.cells[col];
  return r && span ? lines[r.line]!.slice(span.start, span.end).trim() : '';
}

export interface CellEdit {
  row: number; // 1-based, 1 = header row
  col: number; // 0-based
  text: string; // already escaped for Markdown
}

/** Apply cell edits to the document lines in place. */
export function applyEdits(doc: Doc, t: TableInfo, edits: CellEdit[]): void {
  const byLine = new Map<number, CellEdit[]>();
  for (const e of edits) {
    const li = t.rows[e.row - 1]!.line;
    const list = byLine.get(li);
    if (list) list.push(e);
    else byLine.set(li, [e]);
  }
  for (const [li, list] of byLine) {
    let line = doc.lines[li]!;
    let spans = splitRow(line);
    const maxCol = Math.max(...list.map((e) => e.col));
    if (maxCol >= spans.length) {
      line = padRow(line, maxCol + 1);
      spans = splitRow(line);
    }
    list.sort((a, b) => b.col - a.col); // right to left keeps earlier positions valid
    for (const e of list) line = replaceCell(line, spans[e.col]!, e.text, t.align[e.col] ?? 'none');
    doc.lines[li] = line;
  }
}

// ----------------------------------------------------------- formatting

function delimiterCell(width: number, align: Align): string {
  switch (align) {
    case 'left':
      return ':' + '-'.repeat(width - 1);
    case 'right':
      return '-'.repeat(width - 1) + ':';
    case 'center':
      return ':' + '-'.repeat(width - 2) + ':';
    default:
      return '-'.repeat(width);
  }
}

function pad(s: string, width: number, align: Align): string {
  const extra = width - displayWidth(s);
  if (extra <= 0) return s;
  if (align === 'right') return ' '.repeat(extra) + s;
  if (align === 'center') {
    const left = Math.floor(extra / 2);
    return ' '.repeat(left) + s + ' '.repeat(extra - left);
  }
  return s + ' '.repeat(extra);
}

/** Lay out a table from its cell texts (row 0 = header): pipes lined up, delimiter row added. */
export function renderTable(texts: string[][], align: Align[], indent: string): string[] {
  const ncols = Math.max(...texts.map((r) => r.length), align.length, 1);
  const rows = texts.map((r) => {
    const cells = [...r];
    while (cells.length < ncols) cells.push('');
    return cells;
  });
  const al = Array.from({ length: ncols }, (_, i): Align => align[i] ?? 'none');
  const widths = Array.from({ length: ncols }, (_, c) =>
    Math.max(3, ...rows.map((r) => displayWidth(r[c]!))),
  );
  const row = (cells: string[]) =>
    `${indent}| ${cells.map((s, c) => pad(s, widths[c]!, al[c]!)).join(' | ')} |`;
  const delim = widths.map((w, c) => delimiterCell(w, al[c]!));
  return [row(rows[0]!), `${indent}| ${delim.join(' | ')} |`, ...rows.slice(1).map(row)];
}

/** Cell texts of a table exactly as written (trimmed, escapes kept), header row first. */
export function rawGrid(lines: string[], t: TableInfo): string[][] {
  const ncols = Math.max(t.ncols, ...t.rows.map((r) => r.cells.length));
  return t.rows.map((r) => {
    const line = lines[r.line]!;
    const cells = r.cells.map((c) => line.slice(c.start, c.end).trim());
    while (cells.length < ncols) cells.push('');
    return cells;
  });
}

/** Tidy one table: pipes lined up, delimiter row as wide as the column. */
export function formatTable(lines: string[], t: TableInfo): string[] {
  const texts = rawGrid(lines, t);
  return renderTable(texts, t.align, t.indent);
}

export interface FormatResult {
  markdown: string;
  changed: boolean;
  tables: number;
}

/** Tidy every table in a document. */
export function formatTables(md: string): FormatResult {
  const doc = parseDoc(md);
  const tables = findTables(doc.lines);
  for (const t of tables) {
    const header = t.rows[0]!.line;
    const formatted = formatTable(doc.lines, t);
    formatted.forEach((text, k) => {
      doc.lines[header + k] = text;
    });
  }
  const out = printDoc(doc);
  return { markdown: out, changed: out !== md, tables: tables.length };
}
