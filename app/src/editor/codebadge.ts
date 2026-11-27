// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// A code block in Live preview shows no ``` lines. Instead a small badge in the corner names the
// language and copies the code.

import { EditorView, WidgetType } from '@codemirror/view';
import { LANG_CHOICES, setFenceLang } from './codeflow.ts';

/** Words for the language list (set by the page so they follow the app's language). */
let words = { language: 'Language', none: 'plain text', other: 'Use “{x}”' };
export function setCodeLabels(w: typeof words): void {
  words = w;
}

/** The little list under the badge: pick a language or type any word, Enter to use it. */
function openPicker(anchor: HTMLElement, current: string): void {
  document.querySelector('.cm-lang-pop')?.remove();
  const view = EditorView.findFromDOM(anchor.closest('.cm-editor')?.querySelector('.cm-content') as HTMLElement);
  if (!view) return;
  const at = view.posAtDOM(anchor);
  const openLine = view.state.doc.lineAt(at).number - 1;
  const box = document.createElement('div');
  box.className = 'cm-lang-pop';
  box.setAttribute('role', 'listbox');
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = words.language;
  input.setAttribute('aria-label', words.language);
  input.autocomplete = 'off';
  input.spellcheck = false;
  const list = document.createElement('ul');
  box.append(input, list);
  let sel = 0;
  let items: string[] = [];
  const close = () => {
    document.removeEventListener('pointerdown', away, true);
    box.classList.remove('open');
    setTimeout(() => box.remove(), 180);
    view.focus();
  };
  const away = (e: Event) => { if (!box.contains(e.target as Node)) close(); };
  const pick = (lang: string) => { setFenceLang(view, openLine, lang); close(); };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    items = LANG_CHOICES.filter((l) => !q || l.includes(q));
    if (q && !items.includes(q)) items.push(q);
    if (!q) items.unshift('');
    sel = Math.min(sel, items.length - 1);
    list.replaceChildren(...items.map((l, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.className = (i === sel ? 'on ' : '') + (l === current ? 'cur' : '');
      li.textContent = l === '' ? words.none : q && l === q && !LANG_CHOICES.includes(q) ? words.other.replace('{x}', l) : l;
      li.onpointerdown = (e) => { e.preventDefault(); pick(l); };
      return li;
    }));
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  input.oninput = () => { sel = 0; draw(); };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { sel = (sel + 1) % items.length; draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = (sel - 1 + items.length) % items.length; draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { pick(items[sel] ?? ''); e.preventDefault(); }
    else if (e.key === 'Escape') { close(); e.preventDefault(); e.stopPropagation(); }
  };
  document.body.append(box);
  const r = anchor.getBoundingClientRect();
  box.style.top = Math.min(r.bottom + 4, innerHeight - 280) + 'px';
  box.style.insetInlineStart = '';
  box.style.left = Math.max(8, Math.min(r.left, innerWidth - 188)) + 'px';
  draw();
  document.addEventListener('pointerdown', away, true);
  input.focus({ preventScroll: true });
  requestAnimationFrame(() => box.classList.add('open'));
}

export class CodeBadge extends WidgetType {
  constructor(
    readonly lang: string,
    readonly code: string,
  ) {
    super();
  }
  eq(o: CodeBadge) {
    return o.lang === this.lang && o.code === this.code;
  }
  toDOM() {
    const b = document.createElement('span');
    b.className = 'cm-code-badge';
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'cm-code-lang' + (this.lang ? '' : ' none');
    name.textContent = this.lang || words.none;
    name.title = words.language;
    name.onmousedown = (e) => { e.preventDefault(); openPicker(name, this.lang); };
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'cm-code-copy';
    copy.setAttribute('aria-label', 'Copy');
    copy.title = 'Copy';
    copy.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
    copy.onmousedown = (e) => {
      e.preventDefault();
      void navigator.clipboard?.writeText(this.code).then(() => {
        copy.classList.add('done');
        setTimeout(() => copy.classList.remove('done'), 1200);
      });
    };
    b.append(name, copy);
    return b;
  }
  ignoreEvent() {
    return true;
  }
}

/** The language word of a fence line: "```bash title=x" -> "bash" */
export const fenceLang = (line: string): string => /^[ \t]*(?:```|~~~)[ \t]*([^\s{`]*)/.exec(line)?.[1] ?? '';
