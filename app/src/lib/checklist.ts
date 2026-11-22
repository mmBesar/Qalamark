// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The checklist view of a note (shopping lists, packing lists, routines). Like the board, it only reads and
// edits the note's text: sections are headings, items are `- [ ]` lines, and the file stays plain Markdown.
// A note is a checklist when its properties say `view: checklist`.

export interface Item {
  /** Line index of the item in the note. */
  line: number;
  /** Last line of the item, including indented lines under it. */
  end: number;
  done: boolean;
  text: string;
}
export interface Section {
  /** The heading text, or null for the items above the first heading. */
  title: string | null;
  /** Line index of the heading (-1 when there is none). */
  head: number;
  /** Where this section's lines stop (exclusive). */
  stop: number;
  items: Item[];
}
export interface Checklist {
  lines: string[];
  sections: Section[];
  total: number;
  done: number;
}

const ITEM = /^[-*+] \[( |x|X)\] ?(.*)$/;

function fmEnd(lines: string[]): number {
  if (lines[0]?.trimEnd() !== '---') return 0;
  for (let i = 1; i < lines.length; i++) if (lines[i]!.trimEnd() === '---') return i + 1;
  return 0;
}

export function isChecklist(text: string): boolean {
  const lines = text.split('\n', 60);
  const end = fmEnd(lines);
  for (let i = 1; i < end - 1; i++) if (/^view\s*:\s*["']?(checklist|tasks|task-list)["']?\s*$/i.test(lines[i]!)) return true;
  return false;
}

export function parseChecklist(text: string): Checklist {
  const lines = text.split('\n');
  const start = fmEnd(lines);
  const sections: Section[] = [{ title: null, head: -1, stop: lines.length, items: [] }];
  let fence = false;
  let cur: Item | null = null;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; if (cur) cur.end = i + 1; continue; }
    if (fence) { if (cur) cur.end = i + 1; continue; }
    const h = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(l);
    if (h) {
      sections[sections.length - 1]!.stop = i;
      sections.push({ title: h[1]!, head: i, stop: lines.length, items: [] });
      cur = null;
      continue;
    }
    const m = ITEM.exec(l);
    if (m) {
      cur = { line: i, end: i + 1, done: m[1] !== ' ', text: m[2]! };
      sections[sections.length - 1]!.items.push(cur);
    } else if (cur && /^\s+\S/.test(l)) cur.end = i + 1;
    else if (l.trim() !== '') cur = null;
  }
  // the implicit first section only counts when it has items or when it is the whole note
  const out = sections.filter((s, i) => i > 0 || s.items.length > 0 || sections.length === 1);
  const all = out.flatMap((s) => s.items);
  return { lines, sections: out, total: all.length, done: all.filter((x) => x.done).length };
}

const clean = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();
const mark = (done: boolean, text: string) => `- [${done ? 'x' : ' '}] ${text}`;

function replaceLines(lines: string[], from: number, to: number, insert: string[]): string {
  return [...lines.slice(0, from), ...insert, ...lines.slice(to)].join('\n');
}

export function toggleItem(text: string, line: number): string {
  const lines = text.split('\n');
  const m = ITEM.exec(lines[line] ?? '');
  if (!m) return text;
  lines[line] = mark(m[1] === ' ', m[2]!);
  return lines.join('\n');
}

export function setAll(text: string, done: boolean): string {
  const c = parseChecklist(text);
  const lines = [...c.lines];
  for (const s of c.sections) for (const it of s.items) lines[it.line] = mark(done, it.text);
  return lines.join('\n');
}

export function clearDone(text: string): string {
  const c = parseChecklist(text);
  const drop = new Set<number>();
  for (const s of c.sections) for (const it of s.items) if (it.done) for (let i = it.line; i < it.end; i++) drop.add(i);
  return c.lines.filter((_, i) => !drop.has(i)).join('\n');
}

export function editItem(text: string, line: number, label: string): string {
  const lines = text.split('\n');
  const m = ITEM.exec(lines[line] ?? '');
  const t = clean(label);
  if (!m || !t) return text;
  lines[line] = mark(m[1] !== ' ', t);
  return lines.join('\n');
}

export function deleteItem(text: string, line: number): string {
  const c = parseChecklist(text);
  for (const s of c.sections) for (const it of s.items) if (it.line === line) return replaceLines(c.lines, it.line, it.end, []);
  return text;
}

/** Add an item at the end of a section's items (or right under its heading). */
export function addItem(text: string, section: number, label: string): string {
  const c = parseChecklist(text);
  const t = clean(label);
  const s = c.sections[section];
  if (!s || !t) return text;
  const last = s.items[s.items.length - 1];
  let at: number;
  if (last) at = last.end;
  else if (s.head >= 0) at = s.head + 1;
  else {
    at = fmEnd(c.lines);
    while (at < c.lines.length && c.lines[at]!.trim() === '') at++;
  }
  const ins = [mark(false, t)];
  // a heading's first item gets a blank line before it only if the heading was followed by one already
  return replaceLines(c.lines, at, at, ins);
}

export function addSection(text: string, title: string): string {
  const t = clean(title);
  if (!t) return text;
  const body = text.replace(/\s+$/, '');
  return body + '\n\n## ' + t + '\n';
}

export function renameSection(text: string, section: number, title: string): string {
  const c = parseChecklist(text);
  const s = c.sections[section];
  const t = clean(title);
  if (!s || s.head < 0 || !t) return text;
  const lead = /^#{1,6}/.exec(c.lines[s.head]!)![0];
  const lines = [...c.lines];
  lines[s.head] = `${lead} ${t}`;
  return lines.join('\n');
}

/** Turn a note into a checklist: set `view: checklist` in its properties (creating them if needed). */
export function makeChecklist(text: string): string {
  if (isChecklist(text)) return text;
  const lines = text.split('\n');
  const end = fmEnd(lines);
  if (end) {
    lines.splice(end - 1, 0, 'view: checklist');
    return lines.join('\n');
  }
  return `---\nview: checklist\n---\n\n${text}`;
}

/** Move an item (with the lines under it) to the end of another section. */
export function moveItem(text: string, line: number, toSection: number): string {
  const c = parseChecklist(text);
  let item: Item | undefined;
  for (const s of c.sections) for (const it of s.items) if (it.line === line) item = it;
  const dest = c.sections[toSection];
  if (!item || !dest || dest.items.includes(item)) return text;
  const block = c.lines.slice(item.line, item.end);
  const last = dest.items[dest.items.length - 1];
  let at = last ? last.end : dest.head >= 0 ? dest.head + 1 : fmEnd(c.lines);
  if (!last && dest.head < 0) while (at < c.lines.length && c.lines[at]!.trim() === '') at++;
  // insert first, then remove the original (which moves down when the new copy lands above it)
  const withCopy = replaceLines(c.lines, at, at, block).split('\n');
  const from = at <= item.line ? item.line + block.length : item.line;
  return withCopy.filter((_, i) => i < from || i >= from + block.length).join('\n');
}

export const CHECKLIST_TEMPLATE = (sections: Array<{ title: string; items: string[] }>) =>
  `---\nview: checklist\n---\n\n${sections.map((s) => `## ${s.title}\n\n${s.items.map((i) => `- [ ] ${i}`).join('\n')}\n`).join('\n')}`;
