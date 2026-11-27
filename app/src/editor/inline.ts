// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The small inline Markdown that shows inside a table cell when you are not editing it: `code`, **bold**, *italic*,
// ~~strike~~, ==highlight==, [links](url), [[notes]] and \escapes. Built as plain text nodes and elements, never as HTML.

export type Inline =
  | { t: 'text'; s: string }
  | { t: 'code'; s: string }
  | { t: 'b' | 'i' | 's' | 'mark' | 'a'; kids: Inline[] };

const TOKEN =
  /\\([\\`*_{}[\]()#+\-.!|~=<>])|`([^`\n]+)`|\*\*(?=\S)(.+?)(?<=\S)\*\*|__(?=\S)(.+?)(?<=\S)__|~~(?=\S)(.+?)(?<=\S)~~|==(?=\S)(.+?)(?<=\S)==|\*(?=[^\s*])(.+?)(?<=[^\s*])\*|(?<![\p{L}\p{N}_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\p{L}\p{N}_])|\[\[([^\]\n|]*)(?:\|([^\]\n]*))?\]\]|\[([^\]\n]+)\]\(\s*<?[^)\s>]*>?(?:\s+"[^"]*")?\s*\)/gu;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  const push = (s: string) => {
    if (s) out.push({ t: 'text', s });
  };
  for (const m of text.matchAll(TOKEN)) {
    push(text.slice(at, m.index));
    at = m.index! + m[0].length;
    if (m[1] !== undefined) push(m[1]);
    else if (m[2] !== undefined) out.push({ t: 'code', s: m[2] });
    else if (m[3] !== undefined || m[4] !== undefined) out.push({ t: 'b', kids: parseInline((m[3] ?? m[4])!) });
    else if (m[5] !== undefined) out.push({ t: 's', kids: parseInline(m[5]) });
    else if (m[6] !== undefined) out.push({ t: 'mark', kids: parseInline(m[6]) });
    else if (m[7] !== undefined || m[8] !== undefined) out.push({ t: 'i', kids: parseInline((m[7] ?? m[8])!) });
    else if (m[9] !== undefined) out.push({ t: 'a', kids: [{ t: 'text', s: (m[10] ?? m[9]).trim() }] });
    else if (m[11] !== undefined) out.push({ t: 'a', kids: parseInline(m[11]) });
  }
  push(text.slice(at));
  return out;
}

/** True when the text holds anything that would look different once drawn. */
export function hasInline(nodes: Inline[]): boolean {
  return nodes.some((n) => n.t !== 'text');
}

const TAGS = { code: 'code', b: 'strong', i: 'em', s: 'del', mark: 'mark', a: 'span' } as const;

export function drawInline(nodes: Inline[], doc: Document = document): DocumentFragment {
  const frag = doc.createDocumentFragment();
  for (const n of nodes) {
    if (n.t === 'text') frag.append(doc.createTextNode(n.s));
    else if (n.t === 'code') {
      const e = doc.createElement('code');
      e.textContent = n.s;
      frag.append(e);
    } else {
      const e = doc.createElement(TAGS[n.t]);
      if (n.t === 'a') e.className = 'qt-link';
      e.append(drawInline(n.kids, doc));
      frag.append(e);
    }
  }
  return frag;
}
