// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The checklist view of a note (shopping lists, packing lists, routines). Like the board, it only reads and
// edits the note's text: headings are sections (a higher heading holds the lower ones), `- [ ]` lines are items,
// and indented `- [ ]` lines under an item are its subtasks. The file stays plain Markdown.
// A note is a checklist when its properties say `view: checklist`.

export interface Item {
  /** Line index of the item in the note. */
  line: number;
  /** Where the item stops (exclusive): includes its subtasks and indented lines under it. */
  end: number;
  done: boolean;
  text: string;
  /** Width of the item's indentation. */
  indent: number;
  children: Item[];
  parent: Item | null;
}
export interface Section {
  /** Position in document order (what `addItem` and `moveItem` take). */
  index: number;
  /** The heading text, or null for the items above the first heading. */
  title: string | null;
  /** 1–6 for a heading, 0 for the items above the first one. */
  level: number;
  /** Line index of the heading (-1 when there is none). */
  head: number;
  /** Where this section's own lines stop (exclusive): the next heading of any level. */
  stop: number;
  /** Its own top-level items. */
  items: Item[];
  /** The lower headings it holds. */
  children: Section[];
  parent: Section | null;
}
export interface Checklist {
  lines: string[];
  /** Every section, in document order. */
  sections: Section[];
  /** The top-level ones. */
  roots: Section[];
  /** Tasks to do: items without subtasks (a parent counts through its subtasks). */
  total: number;
  done: number;
}

const ITEM = /^(\s*)[-*+] \[( |x|X)\] ?(.*)$/;
const width = (s: string) => s.replace(/\t/g, '  ').length;

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

/** The items that count as tasks: those without subtasks. */
export function leaves(items: Item[]): Item[] {
  return items.flatMap((i) => (i.children.length ? leaves(i.children) : [i]));
}
/** Every item below (and including) these, in order. */
export function flatItems(items: Item[]): Item[] {
  return items.flatMap((i) => [i, ...flatItems(i.children)]);
}
/** The tasks inside a section and the sections under it. */
export function sectionLeaves(s: Section): Item[] {
  return [...leaves(s.items), ...s.children.flatMap(sectionLeaves)];
}
/** Where a section and everything under it stops. */
export function subtreeEnd(s: Section): number {
  const last = s.children[s.children.length - 1];
  return last ? subtreeEnd(last) : s.stop;
}

export function parseChecklist(text: string): Checklist {
  const lines = text.split('\n');
  const start = fmEnd(lines);
  const implicit: Section = { index: 0, title: null, level: 0, head: -1, stop: lines.length, items: [], children: [], parent: null };
  const all: Section[] = [implicit];
  const roots: Section[] = [implicit];
  const stack: Section[] = [];
  let cur: Section = implicit;
  let items: Item[] = [];
  let fence = false;
  const extend = (i: number) => { for (let it: Item | null = items[items.length - 1] ?? null; it; it = it.parent) it.end = i + 1; };
  for (let i = start; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; if (items.length) extend(i); continue; }
    if (fence) { if (items.length) extend(i); continue; }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (h) {
      cur.stop = i;
      const level = h[1]!.length;
      while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
      const parent = stack[stack.length - 1] ?? null;
      const sec: Section = { index: all.length, title: h[2]!, level, head: i, stop: lines.length, items: [], children: [], parent };
      (parent ? parent.children : roots).push(sec);
      all.push(sec);
      stack.push(sec);
      cur = sec;
      items = [];
      continue;
    }
    const m = ITEM.exec(l);
    if (m) {
      const w = width(m[1]!);
      while (items.length && items[items.length - 1]!.indent >= w) items.pop();
      const parent = items[items.length - 1] ?? null;
      const it: Item = { line: i, end: i + 1, done: m[2] !== ' ', text: m[3]!, indent: w, children: [], parent };
      (parent ? parent.children : cur.items).push(it);
      items.push(it);
      extend(i);
    } else if (items.length && /^\s+\S/.test(l)) extend(i);
    else if (l.trim() !== '') items = [];
  }
  // the implicit first section only counts when it has items or when it is the whole note
  const keep = all.length === 1 || implicit.items.length > 0;
  const sections = keep ? all : all.slice(1);
  const rootList = keep ? roots : roots.slice(1);
  sections.forEach((s, k) => (s.index = k));
  const ls = rootList.flatMap(sectionLeaves);
  return { lines, sections, roots: rootList, total: ls.length, done: ls.filter((x) => x.done).length };
}

const clean = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();
const box = (line: string, done: boolean) => line.replace(/^(\s*[-*+] )\[.\]/, `$1[${done ? 'x' : ' '}]`);
const mark = (indent: number, done: boolean, text: string) => `${' '.repeat(indent)}- [${done ? 'x' : ' '}] ${text}`;

function replaceLines(lines: string[], from: number, to: number, insert: string[]): string[] {
  return [...lines.slice(0, from), ...insert, ...lines.slice(to)];
}
const findItem = (c: Checklist, line: number): Item | undefined => flatItems(c.sections.flatMap((s) => s.items)).find((i) => i.line === line);

/** After a change below it, a parent is done exactly when all its subtasks are. `line` is the parent's line. */
function syncUp(lines: string[], line: number | null): string[] {
  let from = line;
  const out = [...lines];
  while (from !== null) {
    const c = parseChecklist(out.join('\n'));
    const p = findItem(c, from);
    if (!p || !p.children.length) break;
    out[p.line] = box(out[p.line]!, p.children.every((k) => k.done));
    from = p.parent ? p.parent.line : null;
  }
  return out;
}

export function toggleItem(text: string, line: number): string {
  const c = parseChecklist(text);
  const it = findItem(c, line);
  if (!it) return text;
  const lines = [...c.lines];
  const next = !it.done;
  for (const x of flatItems([it])) lines[x.line] = box(lines[x.line]!, next); // the item and all its subtasks follow
  return syncUp(lines, it.parent?.line ?? null).join('\n');
}

export function setAll(text: string, done: boolean): string {
  const c = parseChecklist(text);
  const lines = [...c.lines];
  for (const it of flatItems(c.sections.flatMap((s) => s.items))) lines[it.line] = box(lines[it.line]!, done);
  return lines.join('\n');
}

/** Remove what is done (a done parent goes with its subtasks). */
export function clearDone(text: string): string {
  const c = parseChecklist(text);
  const drop = new Set<number>();
  const walk = (items: Item[]) => {
    for (const it of items) {
      if (it.done && !it.children.some((k) => !k.done)) for (let i = it.line; i < it.end; i++) drop.add(i);
      else walk(it.children);
    }
  };
  for (const s of c.sections) walk(s.items);
  let out = c.lines.filter((_, i) => !drop.has(i));
  // a parent that lost all subtasks stays as a plain task
  return out.join('\n');
}

export function editItem(text: string, line: number, label: string): string {
  const c = parseChecklist(text);
  const it = findItem(c, line);
  const t = clean(label);
  if (!it || !t) return text;
  const lines = [...c.lines];
  lines[it.line] = mark(it.indent, it.done, t);
  return lines.join('\n');
}

export function deleteItem(text: string, line: number): string {
  const c = parseChecklist(text);
  const it = findItem(c, line);
  if (!it) return text;
  const lines = replaceLines(c.lines, it.line, it.end, []);
  return syncUp(lines, it.parent?.line ?? null).join('\n');
}

/** Add an item at the end of a section's own items (or right under its heading). */
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
  return replaceLines(c.lines, at, at, [mark(0, false, t)]).join('\n');
}

/** Add a subtask under an item (it makes the item undone until the new one is done). */
export function addSub(text: string, line: number, label: string): string {
  const c = parseChecklist(text);
  const it = findItem(c, line);
  const t = clean(label);
  if (!it || !t) return text;
  const indent = it.children[0]?.indent ?? it.indent + 2;
  const lines = replaceLines(c.lines, it.end, it.end, [mark(indent, false, t)]);
  return syncUp(lines, it.line).join('\n');
}

const shift = (l: string, by: number) => (by >= 0 ? ' '.repeat(by) + l : l.replace(new RegExp(`^(?:\\t| ){1,${-by}}`), ''));

/** Make an item a subtask of the one above it. */
export function indentItem(text: string, line: number): string {
  const c = parseChecklist(text);
  const it = findItem(c, line);
  if (!it) return text;
  const sibs = it.parent ? it.parent.children : c.sections.flatMap((s) => s.items).filter((x) => x.line < it.line && x.end <= it.line);
  const prev = it.parent ? it.parent.children[it.parent.children.indexOf(it) - 1] : sibs.find((x) => x.end === it.line);
  if (!prev) return text;
  const target = prev.children[0]?.indent ?? prev.indent + 2;
  const by = target - it.indent;
  const lines = [...c.lines];
  for (let i = it.line; i < it.end; i++) lines[i] = shift(lines[i]!, by);
  return syncUp(lines, prev.line).join('\n');
}

/** Take a subtask out to the level of its parent, right after it. */
export function outdentItem(text: string, line: number): string {
  const c = parseChecklist(text);
  const it = findItem(c, line);
  if (!it || !it.parent) return text;
  const p = it.parent;
  const by = p.indent - it.indent;
  const block = c.lines.slice(it.line, it.end).map((l) => shift(l, by));
  const rest = replaceLines(c.lines, it.line, it.end, []);
  // the parent's block ends where it did, minus what we took out
  const at = p.end - (it.end - it.line);
  const lines = replaceLines(rest, at, at, block);
  return syncUp(lines, p.line).join('\n');
}

/** Move an item (with its subtasks) to the end of another section. */
export function moveItem(text: string, line: number, toSection: number): string {
  const c = parseChecklist(text);
  const it = findItem(c, line);
  const dest = c.sections[toSection];
  if (!it || !dest || dest.items.includes(it)) return text;
  const block = c.lines.slice(it.line, it.end).map((l) => shift(l, -it.indent));
  const last = dest.items[dest.items.length - 1];
  let at = last ? last.end : dest.head >= 0 ? dest.head + 1 : fmEnd(c.lines);
  if (!last && dest.head < 0) while (at < c.lines.length && c.lines[at]!.trim() === '') at++;
  // insert first, then remove the original (it moves down when the copy lands above it)
  const withCopy = replaceLines(c.lines, at, at, block);
  const from = at <= it.line ? it.line + block.length : it.line;
  const out = withCopy.filter((_, i) => i < from || i >= from + (it.end - it.line));
  return syncUp(out, it.parent?.line ?? null).join('\n');
}

/** A new section: at the end of the note, or (with `parent`) a level lower, at the end of that section. */
export function addSection(text: string, title: string, parent?: number): string {
  const t = clean(title);
  if (!t) return text;
  const c = parseChecklist(text);
  const p = parent === undefined ? undefined : c.sections[parent];
  if (!p || p.head < 0) return text.replace(/\s+$/, '') + '\n\n## ' + t + '\n';
  const at = subtreeEnd(p);
  const head = '#'.repeat(Math.min(6, p.level + 1)) + ' ' + t;
  const lines = [...c.lines];
  // keep a blank line between what came before and the new heading
  const before = lines[at - 1]?.trim() === '' ? [] : [''];
  return replaceLines(lines, at, at, [...before, head, '']).join('\n');
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

export const CHECKLIST_TEMPLATE = (sections: Array<{ title: string; items: string[] }>) =>
  `---\nview: checklist\n---\n\n${sections.map((s) => `## ${s.title}\n\n${s.items.map((i) => `- [ ] ${i}`).join('\n')}\n`).join('\n')}`;
