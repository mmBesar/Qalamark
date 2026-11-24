// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// YAML front matter ("properties") at the top of a note:
//
//   ---
//   title: Plan
//   tags: [work, urgent]
//   ---
//
// Only the simple, everyday shapes are understood: text, numbers, yes/no, dates and
// lists. If a block holds anything more complex (nested maps) the app leaves it alone
// and shows it as plain text, so nothing is ever lost.

export type PropType = 'text' | 'list' | 'checkbox' | 'number';

export interface Prop {
  key: string;
  type: PropType;
  text: string; // text, number, checkbox ("true"/"false")
  items: string[]; // list
}

export interface FrontMatter {
  /** The properties, in file order. */
  props: Prop[];
  /** Length of the whole block in the note, including both --- lines and the line break. */
  end: number;
  /** False when the block has something we cannot edit safely. */
  editable: boolean;
}

const BLOCK = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function unquote(v: string): string {
  const s = v.trim();
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s[0] === '"' ? s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\') : s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

function splitFlow(inner: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = '';
  for (const c of inner) {
    if (q) {
      cur += c;
      if (c === q) q = '';
    } else if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur.trim() !== '') out.push(cur);
  return out.map(unquote).filter((x) => x !== '');
}

/** Read the front matter at the very top of `doc`, or null when there is none. */
export function readFrontMatter(doc: string): FrontMatter | null {
  const m = BLOCK.exec(doc);
  if (!m) return null;
  const lines = m[1]!.split(/\r?\n/);
  const props: Prop[] = [];
  let editable = true;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const kv = /^([^\s:#][^:]*?):(?:[ \t]+(.*))?$/.exec(line);
    if (!kv) {
      editable = false;
      continue;
    }
    const key = kv[1]!.trim();
    const raw = (kv[2] ?? '').trim();
    if (raw === '') {
      // either an empty value or a block list on the following lines
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^[ \t]*-([ \t]|$)/.test(lines[j]!)) {
        items.push(unquote(lines[j]!.replace(/^[ \t]*-[ \t]?/, '')));
        j++;
      }
      if (items.length > 0) {
        props.push({ key, type: 'list', text: '', items });
        i = j - 1;
      } else {
        if (j < lines.length && /^[ \t]+\S/.test(lines[j]!)) editable = false; // a nested map
        props.push({ key, type: 'text', text: '', items: [] });
      }
    } else if (raw.startsWith('[') && raw.endsWith(']')) {
      props.push({ key, type: 'list', text: '', items: splitFlow(raw.slice(1, -1)) });
    } else if (/^(true|false)$/i.test(raw)) {
      props.push({ key, type: 'checkbox', text: raw.toLowerCase(), items: [] });
    } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
      props.push({ key, type: 'number', text: raw, items: [] });
    } else if (/^[|>{&*!]/.test(raw)) {
      editable = false;
      props.push({ key, type: 'text', text: raw, items: [] });
    } else {
      props.push({ key, type: 'text', text: unquote(raw), items: [] });
    }
  }
  return { props, end: m[0].length, editable };
}

const needsQuotes = (s: string) =>
  s === '' || /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s) || /:\s|\s#|\s$/.test(s) || /^(true|false|null|~|yes|no)$/i.test(s) || /^-?\d+(\.\d+)?$/.test(s);
const quote = (s: string) => (needsQuotes(s) ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : s);

export function writeFrontMatter(props: Prop[]): string {
  if (props.length === 0) return '';
  const body = props
    .map((p) => {
      switch (p.type) {
        case 'list':
          return p.items.length === 0 ? `${p.key}: []` : `${p.key}:\n${p.items.map((i) => `  - ${quote(i)}`).join('\n')}`;
        case 'checkbox':
          return `${p.key}: ${p.text === 'true' ? 'true' : 'false'}`;
        case 'number':
          return `${p.key}: ${p.text.trim() === '' ? '0' : p.text.trim()}`;
        default:
          return p.text === '' ? `${p.key}:` : `${p.key}: ${quote(p.text)}`;
      }
    })
    .join('\n');
  return `---\n${body}\n---\n`;
}

/** The note text with its front matter replaced (or added, or removed when props is empty). */
export function withProps(doc: string, props: Prop[]): string {
  const fm = readFrontMatter(doc);
  const rest = fm ? doc.slice(fm.end) : doc;
  const head = writeFrontMatter(props);
  return head + (head && rest.startsWith('\n') ? rest : rest);
}

/** Properties people usually want; offered in the "add" list. `value` is what a new one starts with. */
export const COMMON_PROPS: Array<{ key: string; type: PropType; value?: string }> = [
  { key: 'view', type: 'text', value: 'note' },
  { key: 'title', type: 'text' },
  { key: 'tags', type: 'list' },
  { key: 'aliases', type: 'list' },
  { key: 'description', type: 'text' },
  { key: 'date', type: 'text' },
  { key: 'status', type: 'text', value: 'todo' },
  { key: 'priority', type: 'text', value: 'medium' },
  { key: 'remind', type: 'text' },
  { key: 'due', type: 'text' },
  { key: 'start', type: 'text' },
  { key: 'end', type: 'text' },
  { key: 'created', type: 'text' },
  { key: 'updated', type: 'text' },
  { key: 'author', type: 'text' },
  { key: 'project', type: 'text' },
  { key: 'category', type: 'text' },
  { key: 'type', type: 'text' },
  { key: 'source', type: 'text' },
  { key: 'url', type: 'text' },
  { key: 'location', type: 'text' },
  { key: 'rating', type: 'number' },
  { key: 'progress', type: 'number' },
  { key: 'cover', type: 'text' },
  { key: 'related', type: 'list' },
  { key: 'draft', type: 'checkbox' },
  { key: 'pinned', type: 'checkbox' },
];

/** Properties the app understands the values of: they are chosen from a list instead of typed. */
export const KEY_CHOICES: Record<string, string[]> = {
  view: ['note', 'checklist', 'board', 'pipeline'],
  tap: ['tick', 'box'],
  status: ['todo', 'doing', 'blocked', 'done'],
  priority: ['low', 'medium', 'high', 'urgent'],
};

/** Properties that only make sense for one view: offered once that view is set. */
export const VIEW_PROPS: Record<string, Array<{ key: string; type: PropType; value?: string }>> = {
  checklist: [{ key: 'tap', type: 'text', value: 'tick' }],
  board: [{ key: 'status-prop', type: 'text', value: 'status' }, { key: 'card-folder', type: 'text' }],
  pipeline: [{ key: 'status-prop', type: 'text', value: 'status' }, { key: 'card-folder', type: 'text' }, { key: 'card-props', type: 'text' }],
};

/** Tags of a note, from its properties. */
export function tagsOf(doc: string): string[] {
  const fm = readFrontMatter(doc);
  const t = fm?.props.find((p) => p.key.toLowerCase() === 'tags' || p.key.toLowerCase() === 'tag');
  if (!t) return [];
  return (t.type === 'list' ? t.items : t.text.split(/[,\s]+/)).map((x) => x.replace(/^#/, '')).filter(Boolean);
}
