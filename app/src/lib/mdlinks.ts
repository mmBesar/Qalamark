// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Standard links between notes (docs/MARKDOWN.md): `[Title](../Folder/other-note.md#heading)`, relative to the note
// that holds the link, so the whole notes folder can move and every link keeps working. The Rust server has the same
// rules (server/src/text.rs); both are tested against the same cases.

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** A link or picture found in a text: where its address is, and the address itself. */
export interface Found { image: boolean; label: string; start: number; end: number; dest: string; angle: boolean }

const ADDR = '<[^>\\n]*>|(?:[^\\s()<>]|\\([^\\s()]*\\))+';
const RE = () => new RegExp(`(!?)\\[((?:[^\\[\\]\\\\\\n]|\\\\.)*)\\]\\(\\s*(${ADDR})(?:\\s+(?:"[^"\\n]*"|'[^'\\n]*'))?\\s*\\)`, 'g');

/** Every inline link and picture of a note (not inside code). */
export function scanLinks(text: string): Found[] {
  const out: Found[] = [];
  let fence = false;
  let off = 0;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    else if (!fence) {
      // blank out inline code so a link inside it is not a link
      const masked = line.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
      for (const m of masked.matchAll(RE())) {
        const raw = m[3]!;
        const angle = raw.startsWith('<');
        const at = m.index! + m[0].indexOf(raw, m[1]!.length + m[2]!.length + 2);
        out.push({ image: m[1] === '!', label: m[2]!, start: off + at, end: off + at + raw.length, dest: angle ? raw.slice(1, -1) : raw, angle });
      }
    }
    off += line.length + 1;
  }
  return out;
}

const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/** A folder-relative address as an absolute path inside the notes folder ("" = the top), or null for web addresses and anything outside it. */
export function resolveDest(fromFolder: string, dest: string): { path: string; frag: string } | null {
  if (!dest || SCHEME.test(dest) || dest.startsWith('#') || dest.startsWith('/') || dest.startsWith('//')) return null;
  const hash = dest.indexOf('#');
  const frag = hash >= 0 ? dec(dest.slice(hash + 1)) : '';
  const rel = dec(hash >= 0 ? dest.slice(0, hash) : dest).split('?')[0]!;
  const parts = fromFolder ? fromFolder.split('/') : [];
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
  }
  return { path: parts.join('/'), frag };
}

/** The path as an address relative to a folder: `../_images/a.png`. */
export function relativeTo(fromFolder: string, path: string): string {
  const a = fromFolder ? fromFolder.split('/') : [];
  const b = path.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i]!.toLowerCase() === b[i]!.toLowerCase()) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

/** An address as it is written in the note: raw letters (Arabic stays readable), in <angle brackets> when it has a space or a bracket. */
export function writeDest(path: string, frag = ''): string {
  const full = path + (frag ? '#' + frag : '');
  return /[\s()<>]/.test(full) ? `<${full}>` : full;
}

/** GitHub's way of turning a heading into an anchor (also what VS Code uses). */
export function slug(heading: string): string {
  return heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');
}

/** The link to write for a note: `[Title](../Folder/Title.md)`; `shown` replaces the title as the visible text. */
export function noteLink(fromFolder: string, toFolder: string, title: string, heading = '', shown = ''): string {
  const path = relativeTo(fromFolder, (toFolder ? toFolder + '/' : '') + title + '.md');
  return `[${(shown || title).replace(/([[\]])/g, '\\$1')}](${writeDest(path, heading ? slug(heading) : '')})`;
}

export interface NoteTarget { folder: string; title: string; frag: string }
/** Where a link to a note points (null for anything that is not a `.md` file inside the notes folder). */
export function noteTarget(fromFolder: string, dest: string): NoteTarget | null {
  const r = resolveDest(fromFolder, dest);
  if (!r || !/\.md$/i.test(r.path)) return null;
  const cut = r.path.lastIndexOf('/');
  return { folder: cut < 0 ? '' : r.path.slice(0, cut), title: r.path.slice(cut + 1).replace(/\.md$/i, ''), frag: r.frag };
}

/** The notes a text links to with standard links. */
export function noteLinks(text: string, fromFolder: string): NoteTarget[] {
  return scanLinks(text).filter((f) => !f.image).map((f) => noteTarget(fromFolder, f.dest)).filter((x): x is NoteTarget => !!x);
}

/**
 * Rewrite the addresses in a text after something moved: `fromOld` is the folder the note was in, `fromNew` where it
 * is now, and `moved` says where a path that moved goes (null = it stayed). Every relative address is resolved the old
 * way and written the new way. Returns null when nothing changed.
 */
export function retarget(text: string, fromOld: string, fromNew: string, moved: (path: string) => string | null): string | null {
  let out = '';
  let last = 0;
  for (const f of scanLinks(text)) {
    const r = resolveDest(fromOld, f.dest);
    if (!r) continue;
    const to = moved(r.path) ?? r.path;
    if (to === r.path && fromOld === fromNew) continue;
    const dest = writeDest(relativeTo(fromNew, to), r.frag ? (/[^\p{L}\p{N}\p{M}_-]/u.test(r.frag) ? slug(r.frag) : r.frag) : '');
    if (dest === (f.angle ? `<${f.dest}>` : f.dest)) continue;
    out += text.slice(last, f.start) + dest;
    last = f.end;
  }
  if (last === 0) return null;
  return out + text.slice(last);
}
