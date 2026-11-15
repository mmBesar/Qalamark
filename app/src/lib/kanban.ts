// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// A Kanban board is an ordinary note: a `kanban` property at the top, each `## Heading` is a
// column and each list item under it is a card (`- [ ] task`, `- [x] done`, or a plain `- item`).
// Lines indented under a card belong to that card. Nothing here is special file syntax,
// so the note reads fine in any Markdown editor.

export interface Card {
  start: number; // first line (index into lines)
  end: number; // one past the last line
  text: string;
  done: boolean | null; // null = a plain bullet (no checkbox)
  extra: string[]; // the lines indented under the card, trimmed
}
export interface Column {
  title: string;
  head: number; // line of the ## heading
  end: number; // one past the column's last line
  cards: Card[];
}
export interface Board {
  lines: string[];
  columns: Column[];
}

const CARD = /^[-*+] (?:\[([ xX])\] )?(.*)$/;

function frontMatterEnd(lines: string[]): number {
  if (lines[0]?.trimEnd() !== '---') return 0;
  for (let i = 1; i < lines.length; i++) if (lines[i]!.trimEnd() === '---') return i + 1;
  return 0;
}

/** True when the note's properties contain `kanban` (or `kanban-plugin`, as the Obsidian plugin writes). */
export function isBoard(text: string): boolean {
  const lines = text.split('\n', 60);
  const end = frontMatterEnd(lines);
  for (let i = 1; i < end - 1; i++) if (/^kanban(-plugin)?\s*:/i.test(lines[i]!)) return true;
  return false;
}

export function parseBoard(text: string): Board {
  const lines = text.split('\n');
  const columns: Column[] = [];
  let fence = false;
  for (let i = frontMatterEnd(lines); i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    if (fence) continue;
    const m = /^##\s+(.*?)\s*#*\s*$/.exec(l);
    if (m && !l.startsWith('###')) {
      if (columns.length) columns[columns.length - 1]!.end = i;
      columns.push({ title: m[1]!, head: i, end: lines.length, cards: [] });
    } else if (columns.length && /^#{1,2}\s/.test(l)) {
      columns[columns.length - 1]!.end = i; // a level-1 heading ends the board
      break;
    }
  }
  for (const col of columns) {
    let cur: Card | null = null;
    for (let i = col.head + 1; i < col.end; i++) {
      const l = lines[i]!;
      const m = CARD.exec(l);
      if (m) {
        cur = { start: i, end: i + 1, text: m[2]!, done: m[1] === undefined ? null : m[1] !== ' ', extra: [] };
        col.cards.push(cur);
      } else if (cur && /^\s+\S/.test(l)) {
        cur.end = i + 1;
        cur.extra.push(l.trim());
      } else if (l.trim() !== '') {
        cur = null;
      }
    }
  }
  return { lines, columns };
}

const render = (c: Pick<Card, 'done' | 'text'>) => (c.done === null ? `- ${c.text}` : `- [${c.done ? 'x' : ' '}] ${c.text}`);
const clean = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();

function insertAt(b: Board, col: number, index: number): number {
  const c = b.columns[col]!;
  if (index < c.cards.length) return c.cards[index]!.start;
  const last = c.cards[c.cards.length - 1];
  return last ? last.end : c.head + 1;
}

export function addCard(text: string, col: number, label: string): string {
  const b = parseBoard(text);
  const t = clean(label);
  if (!t || !b.columns[col]) return text;
  const at = insertAt(b, col, b.columns[col]!.cards.length);
  b.lines.splice(at, 0, render({ done: false, text: t }));
  return b.lines.join('\n');
}

export function editCard(text: string, col: number, idx: number, label: string): string {
  const b = parseBoard(text);
  const card = b.columns[col]?.cards[idx];
  const t = clean(label);
  if (!card || !t) return text;
  b.lines[card.start] = render({ done: card.done, text: t });
  return b.lines.join('\n');
}

export function toggleCard(text: string, col: number, idx: number): string {
  const b = parseBoard(text);
  const card = b.columns[col]?.cards[idx];
  if (!card) return text;
  b.lines[card.start] = render({ done: card.done === true ? false : true, text: card.text });
  return b.lines.join('\n');
}

export function deleteCard(text: string, col: number, idx: number): string {
  const b = parseBoard(text);
  const card = b.columns[col]?.cards[idx];
  if (!card) return text;
  b.lines.splice(card.start, card.end - card.start);
  return b.lines.join('\n');
}

/** Move a card to column `toCol`, before the card that is now at `toIdx` (or to the end). */
export function moveCard(text: string, fromCol: number, fromIdx: number, toCol: number, toIdx: number): string {
  const b = parseBoard(text);
  const card = b.columns[fromCol]?.cards[fromIdx];
  if (!card || !b.columns[toCol]) return text;
  const block = b.lines.slice(card.start, card.end);
  b.lines.splice(card.start, card.end - card.start);
  const rest = parseBoard(b.lines.join('\n'));
  let at = toIdx;
  if (fromCol === toCol && fromIdx < toIdx) at -= 1;
  const pos = insertAt(rest, toCol, Math.max(0, at));
  rest.lines.splice(pos, 0, ...block);
  return rest.lines.join('\n');
}

export function addColumn(text: string, title: string): string {
  const t = clean(title);
  if (!t) return text;
  return text.replace(/\n*$/, '') + `\n\n## ${t}\n`;
}

export function renameColumn(text: string, col: number, title: string): string {
  const b = parseBoard(text);
  const c = b.columns[col];
  const t = clean(title);
  if (!c || !t) return text;
  b.lines[c.head] = `## ${t}`;
  return b.lines.join('\n');
}

export function deleteColumn(text: string, col: number): string {
  const b = parseBoard(text);
  const c = b.columns[col];
  if (!c) return text;
  b.lines.splice(c.head, c.end - c.head);
  return b.lines.join('\n');
}

/** Turn any note into a board: add the `kanban` property, and columns if the note has none. */
export function makeBoard(text: string, names: [string, string, string]): string {
  let out = text;
  const lines = out.split('\n');
  const end = frontMatterEnd(lines);
  if (end > 0) {
    if (!isBoard(out)) {
      lines.splice(end - 1, 0, 'kanban: board');
      out = lines.join('\n');
    }
  } else {
    out = `---\nkanban: board\n---\n${out}`;
  }
  if (parseBoard(out).columns.length === 0) {
    // keep the note's own task lines as the first column's cards
    const body = out.replace(/\n*$/, '');
    out = `${body}\n\n## ${names[0]}\n\n## ${names[1]}\n\n## ${names[2]}\n`;
  }
  return out;
}

export const BOARD_TEMPLATE = (names: [string, string, string], first: string) =>
  `---\nkanban: board\n---\n# {{title}}\n\n## ${names[0]}\n- [ ] ${first}\n\n## ${names[1]}\n\n## ${names[2]}\n`;
