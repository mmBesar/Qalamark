// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// A "base": a table of notes built from their properties. It lives in a note as a fenced block
//
//   ```base
//   folder: Projects
//   tag: work
//   where: status = open
//   show: status, due, done
//   link: title
//   sort: due
//   ```
//
// and is drawn as a table. Cells can be edited there; the change is written to that note's properties.

import { type Prop, type PropType, readFrontMatter, withProps } from './frontmatter.ts';

export interface BaseSpec {
  folder?: string;
  tag?: string;
  where: Array<{ key: string; op: '=' | '!=' | 'contains'; value: string }>;
  show: string[];
  link: string;
  sort?: { key: string; desc: boolean };
}

export interface NoteRow {
  id: string;
  title: string;
  folder: string;
  updated: number;
  props: Prop[];
}

export interface Cell {
  type: PropType | 'date';
  text: string;
  items: string[];
  /** false for what the note itself decides (its name, folder, last change) */
  editable: boolean;
}

/** The fixed columns every note has. */
export const BUILTIN = ['title', 'folder', 'updated'] as const;

export function parseBase(src: string): BaseSpec {
  const spec: BaseSpec = { where: [], show: [], link: 'title' };
  for (const raw of src.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z][\w -]*?)\s*:\s*(.*?)\s*$/.exec(raw);
    if (!m) continue;
    const k = m[1]!.toLowerCase();
    const v = m[2]!;
    if (k === 'folder') spec.folder = v.replace(/^\/+|\/+$/g, '');
    else if (k === 'tag') spec.tag = v.replace(/^#/, '');
    else if (k === 'show' || k === 'columns') spec.show = v.split(',').map((x) => x.trim()).filter(Boolean);
    else if (k === 'link') spec.link = v || 'title';
    else if (k === 'sort') {
      const [key, dir] = v.split(/\s+/);
      if (key) spec.sort = { key, desc: /^desc/i.test(dir ?? '') };
    } else if (k === 'where') {
      const w = /^(.+?)\s*(!=|=|contains)\s*(.*)$/i.exec(v);
      if (w) spec.where.push({ key: w[1]!.trim(), op: w[2]!.toLowerCase() as '=' | '!=' | 'contains', value: w[3]!.trim() });
    }
  }
  return spec;
}

export function cellOf(row: NoteRow, key: string): Cell {
  const k = key.toLowerCase();
  if (k === 'title') return { type: 'text', text: row.title, items: [], editable: false };
  if (k === 'folder') return { type: 'text', text: row.folder, items: [], editable: false };
  if (k === 'updated') return { type: 'date', text: row.updated ? new Date(row.updated).toISOString().slice(0, 10) : '', items: [], editable: false };
  const p = row.props.find((x) => x.key.toLowerCase() === k);
  if (!p) return { type: 'text', text: '', items: [], editable: true };
  return { type: p.type, text: p.text, items: p.items, editable: true };
}

const plain = (c: Cell) => (c.type === 'list' ? c.items.join(', ') : c.text);

/** The notes a base shows, filtered and sorted. */
export function queryRows(spec: BaseSpec, rows: NoteRow[]): NoteRow[] {
  const folder = spec.folder?.toLowerCase();
  let out = rows.filter((r) => {
    const f = r.folder.toLowerCase();
    if (folder !== undefined && folder !== '' && f !== folder && !f.startsWith(folder + '/')) return false;
    if (spec.tag) {
      const tags = r.props.find((p) => p.key.toLowerCase() === 'tags');
      if (!tags || !tags.items.some((t) => t.replace(/^#/, '').toLowerCase() === spec.tag!.toLowerCase())) return false;
    }
    for (const w of spec.where) {
      const c = cellOf(r, w.key);
      const have = plain(c).toLowerCase();
      const want = w.value.toLowerCase();
      if (w.op === '=' && !(have === want || c.items.some((i) => i.toLowerCase() === want))) return false;
      if (w.op === '!=' && (have === want || c.items.some((i) => i.toLowerCase() === want))) return false;
      if (w.op === 'contains' && !have.includes(want)) return false;
    }
    return true;
  });
  const key = spec.sort?.key ?? 'title';
  const dir = spec.sort?.desc ? -1 : 1;
  out = out.slice().sort((a, b) => {
    const x = cellOf(a, key);
    const y = cellOf(b, key);
    if (key.toLowerCase() === 'updated') return (a.updated - b.updated) * dir;
    if (x.type === 'number' && y.type === 'number') return (Number(x.text) - Number(y.text)) * dir;
    // notes without the property go last, whichever way it sorts
    if (plain(x) === '' && plain(y) !== '') return 1;
    if (plain(y) === '' && plain(x) !== '') return -1;
    return plain(x).localeCompare(plain(y), undefined, { numeric: true, sensitivity: 'base' }) * dir;
  });
  return out;
}

/** The columns to draw: what was asked, or the name plus the first few properties found. */
export function columnsOf(spec: BaseSpec, rows: NoteRow[]): string[] {
  // the column that links to the note is always there
  if (spec.show.length) return spec.show.some((c) => c.toLowerCase() === spec.link.toLowerCase()) ? spec.show : [spec.link, ...spec.show];
  const seen: string[] = [];
  for (const r of rows) for (const p of r.props) if (!seen.some((s) => s.toLowerCase() === p.key.toLowerCase()) && !/^(title|tags|aliases)$/i.test(p.key)) seen.push(p.key);
  return ['title', ...seen.slice(0, 4)];
}

/** Every property name used in the given notes (to offer when building a base). */
export function propertyNames(rows: NoteRow[]): string[] {
  const names = new Set<string>();
  for (const r of rows) for (const p of r.props) names.add(p.key);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** The note text with one property set (added when missing). */
export function setPropText(doc: string, key: string, type: PropType, text: string): string {
  const fm = readFrontMatter(doc);
  if (fm && !fm.editable) return doc; // leave complicated front matter alone
  const props = fm ? fm.props.map((p) => ({ ...p, items: [...p.items] })) : [];
  const at = props.findIndex((p) => p.key.toLowerCase() === key.toLowerCase());
  const next: Prop =
    type === 'list'
      ? { key: at >= 0 ? props[at]!.key : key, type, text: '', items: text.split(',').map((x) => x.trim()).filter(Boolean) }
      : { key: at >= 0 ? props[at]!.key : key, type, text, items: [] };
  if (at >= 0) props[at] = next;
  else props.push(next);
  return withProps(doc, props);
}

/** The block's source for a new base. */
export const BASE_TEMPLATE = '```base\nfolder: \nshow: status, due\nsort: title\n```\n';
