// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The Qalamark Markdown profile (docs/MARKDOWN.md): what the app writes must stay on the list. This finds the
// constructs that were once written but no longer are, so templates and snippets can be kept clean (and tested).

export interface Legacy { kind: 'admonition' | 'wikilink' | 'obsidian-callout'; line: number; text: string }

/** Constructs the app reads but does not write any more. */
export function legacyConstructs(md: string): Legacy[] {
  const out: Legacy[] = [];
  let fence = false;
  md.split('\n').forEach((text, i) => {
    if (/^\s*(```|~~~)/.test(text)) { fence = !fence; return; }
    if (fence) return;
    if (/^\s*!!!\s+\w+/.test(text)) out.push({ kind: 'admonition', line: i + 1, text });
    if (/\[\[[^\]\n]+\]\]/.test(text)) out.push({ kind: 'wikilink', line: i + 1, text });
    // an alert with a title on the same line, or a fold mark, is Obsidian's callout; GitHub alerts have neither
    if (/^\s*>\s*\[![A-Za-z]+\][+-]?\s+\S/.test(text) || /^\s*>\s*\[![A-Za-z]+\][+-]/.test(text)) out.push({ kind: 'obsidian-callout', line: i + 1, text });
  });
  return out;
}
