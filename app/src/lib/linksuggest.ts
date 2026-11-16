// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Typing [[ in a plain text box (a Kanban card, a table cell…) offers your notes, and after
// "Note#" the headings of that note - the same suggestions the editor gives.

import { store } from './store.svelte.ts';

type Field = HTMLInputElement | HTMLTextAreaElement;

export function linkSuggest(el: Field, opts: { here?: string } = {}) {
  let pop: HTMLDivElement | null = null;
  let items: string[] = [];
  let sel = 0;
  let from = 0; // where the typed part of the link starts
  let ticket = 0;

  const close = () => {
    pop?.remove();
    pop = null;
    items = [];
  };

  function place() {
    if (!pop) return;
    const r = el.getBoundingClientRect();
    pop.style.left = `${Math.max(6, Math.min(r.left, innerWidth - 270))}px`;
    const below = r.bottom + 4;
    pop.style.top = `${Math.min(below, innerHeight - pop.offsetHeight - 6)}px`;
  }

  function draw() {
    if (!items.length) return close();
    if (!pop) {
      pop = document.createElement('div');
      pop.className = 'ctx suggest';
      pop.setAttribute('role', 'listbox');
      document.body.appendChild(pop);
    }
    pop.replaceChildren(
      ...items.map((label, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ctx-item' + (i === sel ? ' picked' : '');
        b.textContent = label;
        b.onmousedown = (e) => {
          e.preventDefault(); // keep the focus in the box
          choose(i);
        };
        return b;
      }),
    );
    place();
    pop.querySelector('.picked')?.scrollIntoView({ block: 'nearest' });
  }

  function choose(i: number) {
    const label = items[i];
    if (label === undefined) return;
    const caret = el.selectionStart ?? el.value.length;
    const after = el.value.slice(caret);
    const closed = after.startsWith(']]');
    el.setRangeText(label + (closed ? '' : ']]'), from, caret, 'end');
    if (closed) el.setSelectionRange(el.selectionStart! + 2, el.selectionStart! + 2);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    close();
  }

  async function update() {
    const caret = el.selectionStart ?? 0;
    const m = /\[\[([^\]\n|]*)$/.exec(el.value.slice(0, caret));
    if (!m) return close();
    const body = m[1]!;
    const hash = body.indexOf('#');
    const mine = ++ticket;
    if (hash >= 0) {
      const note = body.slice(0, hash).trim();
      const q = body.slice(hash + 1).toLowerCase();
      const hs = await store.headingsOf(note, opts.here).catch(() => [] as string[]);
      if (mine !== ticket) return;
      from = caret - body.length + hash + 1;
      items = hs.filter((h) => h.toLowerCase().includes(q)).slice(0, 30);
    } else {
      const q = body.toLowerCase();
      from = caret - body.length;
      items = store.notes
        .map((n) => n.title)
        .filter((t, i, a) => a.indexOf(t) === i && t.toLowerCase().includes(q))
        .slice(0, 30);
    }
    sel = 0;
    draw();
  }

  const onKey = (e: KeyboardEvent) => {
    if (!pop) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      draw();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      choose(sel);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  const onInput = () => void update();

  (el as HTMLElement).addEventListener('keydown', onKey as EventListener, true);
  el.addEventListener('input', onInput);
  el.addEventListener('blur', close);
  return {
    destroy() {
      close();
      (el as HTMLElement).removeEventListener('keydown', onKey as EventListener, true);
      el.removeEventListener('input', onInput);
      el.removeEventListener('blur', close);
    },
  };
}
