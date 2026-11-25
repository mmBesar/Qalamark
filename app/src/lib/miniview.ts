// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// A small "picture" of a note for the tab cards: the first blocks of the note as they look when rendered (headings, lists,
// ticks, quotes, tables), not as markdown source.

export type MiniBlock =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'li'; text: string; depth: number; task: 'open' | 'done' | null; num: string | null }
  | { t: 'quote'; text: string }
  | { t: 'code'; text: string }
  | { t: 'table'; rows: string[][] }
  | { t: 'img'; text: string }
  | { t: 'hr' };

const inline = (s: string): string =>
  s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '🖼 $1')
    .replace(/\[\[([^\]|#]+)[^\]]*\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/==(.+?)==/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

/** The first `max` blocks of a note's text. */
export function miniBlocks(md: string, max = 12): MiniBlock[] {
  const text = md.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');
  const lines = text.split(/\r?\n/);
  const out: MiniBlock[] = [];
  let para = '';
  const flush = () => { if (para.trim()) out.push({ t: 'p', text: inline(para) }); para = ''; };
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const l = lines[i]!;
    let m: RegExpExecArray | null;
    if (l.trim() === '') { flush(); continue; }
    if ((m = /^\s*```/.exec(l))) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]!); i++) code.push(lines[i]!);
      out.push({ t: 'code', text: code.slice(0, 3).join('\n') });
    } else if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l))) { flush(); out.push({ t: 'h', level: m[1]!.length, text: inline(m[2]!) }); }
    else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); out.push({ t: 'hr' }); }
    else if ((m = /^\s*>\s?(.*)$/.exec(l))) { flush(); out.push({ t: 'quote', text: inline(m[1]!) }); }
    else if (/^\s*\|.*\|\s*$/.test(l)) {
      flush();
      const rows: string[][] = [];
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!); i++) {
        const cells = lines[i]!.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c));
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')))) rows.push(cells);
      }
      i--;
      out.push({ t: 'table', rows: rows.slice(0, 4).map((r) => r.slice(0, 4)) });
    } else if ((m = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(l))) {
      flush();
      out.push({ t: 'li', text: inline(m[5]!), depth: Math.min(3, Math.floor(m[1]!.replace(/\t/g, '  ').length / 2)), task: m[4] === undefined ? null : m[4] === ' ' ? 'open' : 'done', num: m[3] ?? null });
    } else if ((m = /^!\[([^\]]*)\]\([^)]*\)\s*$/.exec(l))) { flush(); out.push({ t: 'img', text: inline(m[1]!) }); }
    else para += (para ? ' ' : '') + l;
  }
  flush();
  return out.slice(0, max);
}
