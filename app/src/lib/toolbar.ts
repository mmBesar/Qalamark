// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// What the editor tool bar can hold. The person chooses which of these show, and in which order
// (Settings, or the slider button at the end of the bar); the choice is a list of ids.

export type ToolId =
  | 'undo' | 'redo' | 'bold' | 'italic' | 'strike' | 'code'
  | 'heading' | 'bullet' | 'numbered' | 'task' | 'quote' | 'indentMore' | 'indentLess'
  | 'link' | 'wikilink' | 'table' | 'codeBlock' | 'rule' | 'insert' | 'help';

export interface ToolDef { id: ToolId; icon: string; label: string; key?: string }

/** Every tool, in the order they are offered. `label` is a translation key. */
export const TOOLS: ToolDef[] = [
  { id: 'undo', icon: 'undo', label: 'undo', key: 'Ctrl+Z' },
  { id: 'redo', icon: 'redo', label: 'redo', key: 'Ctrl+Y' },
  { id: 'bold', icon: 'bold', label: 'bold', key: 'Ctrl+B' },
  { id: 'italic', icon: 'italic', label: 'italic', key: 'Ctrl+I' },
  { id: 'strike', icon: 'strike', label: 'strike' },
  { id: 'code', icon: 'code', label: 'code' },
  { id: 'heading', icon: 'heading', label: 'heading' },
  { id: 'bullet', icon: 'list', label: 'bullet' },
  { id: 'numbered', icon: 'olist', label: 'numbered' },
  { id: 'task', icon: 'check', label: 'task' },
  { id: 'quote', icon: 'quote', label: 'quote' },
  { id: 'indentMore', icon: 'indent', label: 'indentMore' },
  { id: 'indentLess', icon: 'outdent', label: 'indentLess' },
  { id: 'link', icon: 'link', label: 'link' },
  { id: 'wikilink', icon: 'wikilink', label: 'wikilink' },
  { id: 'table', icon: 'table', label: 'table' },
  { id: 'codeBlock', icon: 'codeblock', label: 'insCodeBlock' },
  { id: 'rule', icon: 'hr', label: 'insRule' },
  { id: 'insert', icon: 'plus', label: 'insert' },
  { id: 'help', icon: 'fx', label: 'help' },
];

/** The bar as it comes: the usual marks first, undo and redo up front, a separator between the groups. */
export const DEFAULT_TOOLBAR: string[] = [
  'undo', 'redo', 'sep',
  'bold', 'italic', 'strike', 'code', 'sep',
  'heading', 'bullet', 'task', 'quote', 'sep',
  'link', 'table', 'insert', 'help',
];

const KNOWN = new Set<string>(['sep', ...TOOLS.map((t) => t.id)]);

/** The saved list, cleaned: unknown ids dropped, no doubled or edge separators. */
export function cleanToolbar(list: unknown): string[] {
  if (!Array.isArray(list)) return [...DEFAULT_TOOLBAR];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of list) {
    if (typeof id !== 'string' || !KNOWN.has(id)) continue;
    if (id === 'sep') { if (out.length && out[out.length - 1] !== 'sep') out.push(id); continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  while (out[out.length - 1] === 'sep') out.pop();
  return out;
}

export function moveTool(list: string[], i: number, dir: -1 | 1): string[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}
