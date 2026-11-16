<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  // The table of contents of the open note: jump to a section, fold it in the page, fold
  // everything, move it up or down, make it a higher or lower level, copy a link to it.
  import { EditorView } from '@codemirror/view';
  import { foldable, foldedRanges, foldEffect, unfoldEffect } from '@codemirror/language';
  import type { Text as YText } from 'yjs';
  import Icon from './Icon.svelte';
  import { ctxmenu, type MenuItem } from '../lib/ctxmenu.svelte.ts';
  import { parseHeadings, type Heading } from '../lib/headings.ts';
  import { moveSection, shiftSection } from '../lib/sections.ts';
  import { applyText } from '../lib/ytext.ts';
  import { store } from '../lib/store.svelte.ts';

  let { view, ytext, title, readOnly, tick, onClose }: { view: EditorView; ytext: YText; title: string; readOnly: boolean; tick: number; onClose: () => void } = $props();
  const t = store.t;

  const heads = $derived.by(() => {
    tick;
    return parseHeadings(view.state.doc.toString());
  });

  // which headings have children (so they can be folded in this list)
  const hasKids = (i: number) => i + 1 < heads.length && heads[i + 1]!.level > heads[i]!.level;
  let shut = $state<Set<number>>(new Set()); // headings whose children are hidden in this list (by line)
  const rows = $derived.by(() => {
    const out: Array<{ h: Heading; i: number }> = [];
    let hideBelow = 99;
    heads.forEach((h, i) => {
      if (h.level > hideBelow) return;
      hideBelow = 99;
      out.push({ h, i });
      if (shut.has(h.line) && hasKids(i)) hideBelow = h.level;
    });
    return out;
  });
  const minLevel = $derived(heads.length ? Math.min(...heads.map((h) => h.level)) : 1);

  // the section being read: the last heading at or above the top of the visible page
  const current = $derived.by(() => {
    tick;
    const top = view.lineBlockAtHeight(view.scrollDOM.scrollTop + 30).from;
    let at = -1;
    heads.forEach((h, i) => { if (h.pos <= top + 1) at = i; });
    return at;
  });

  function isFolded(h: Heading): boolean {
    tick;
    const line = view.state.doc.lineAt(h.pos);
    let folded = false;
    foldedRanges(view.state).between(line.to, line.to, (f) => { if (f === line.to) folded = true; });
    return folded;
  }
  function toggleFold(h: Heading) {
    const line = view.state.doc.lineAt(h.pos);
    let from = -1, to = -1;
    foldedRanges(view.state).between(line.to, line.to, (f, e) => { if (f === line.to) { from = f; to = e; } });
    if (from >= 0) view.dispatch({ effects: unfoldEffect.of({ from, to }) });
    else {
      const r = foldable(view.state, line.from, line.to);
      if (r) view.dispatch({ effects: foldEffect.of(r) });
    }
  }
  function foldAll(fold: boolean) {
    const effects = [];
    for (const h of heads) {
      const line = view.state.doc.lineAt(h.pos);
      if (fold) {
        const r = foldable(view.state, line.from, line.to);
        if (r && h.level === minLevel) effects.push(foldEffect.of(r));
      } else {
        foldedRanges(view.state).between(line.to, line.to, (f, e) => { if (f === line.to) effects.push(unfoldEffect.of({ from: f, to: e })); });
      }
    }
    // unfold everything, however deep
    if (!fold) foldedRanges(view.state).between(0, view.state.doc.length, (f, e) => { effects.push(unfoldEffect.of({ from: f, to: e })); });
    if (effects.length) view.dispatch({ effects });
  }

  function go(h: Heading) {
    view.dispatch({ selection: { anchor: h.pos }, effects: EditorView.scrollIntoView(h.pos, { y: 'start', yMargin: 24 }) });
    if (!matchMedia('(pointer: coarse)').matches) view.focus();
  }
  function edit(next: string | null) {
    if (next !== null && !readOnly) applyText(ytext, next);
  }
  function menu(e: MouseEvent, h: Heading, i: number) {
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX || r.left;
    const y = e.clientY || r.bottom;
    const txt = () => view.state.doc.toString();
    const items: MenuItem[] = [
      { label: isFolded(h) ? t('tocUnfold') : t('tocFold'), icon: isFolded(h) ? 'expand' : 'collapse', run: () => toggleFold(h) },
      { label: t('copyLink'), icon: 'link', run: () => navigator.clipboard.writeText(`[[${title}#${h.text}]]`) },
      ...(readOnly ? [] : [
        { sep: true } as MenuItem,
        { label: t('tocUp'), icon: 'chevron-up', disabled: moveSection(txt(), i, -1) === null, run: () => edit(moveSection(txt(), i, -1)) },
        { label: t('tocDown'), icon: 'chevron-down', disabled: moveSection(txt(), i, 1) === null, run: () => edit(moveSection(txt(), i, 1)) },
        { label: t('tocPromote'), icon: 'chevron-left', disabled: shiftSection(txt(), i, -1) === null, run: () => edit(shiftSection(txt(), i, -1)) },
        { label: t('tocDemote'), icon: 'chevron-right', disabled: shiftSection(txt(), i, 1) === null, run: () => edit(shiftSection(txt(), i, 1)) },
      ]),
    ];
    ctxmenu.show(x, y, items);
  }
</script>

<aside class="toc" aria-label={t('toc')}>
  <header>
    <strong>{t('toc')}</strong>
    <span class="grow"></span>
    <button class="icon sm" title={t('tocFoldAll')} aria-label={t('tocFoldAll')} onclick={() => foldAll(true)}><Icon name="collapse" size={15} /></button>
    <button class="icon sm" title={t('tocUnfoldAll')} aria-label={t('tocUnfoldAll')} onclick={() => foldAll(false)}><Icon name="expand" size={15} /></button>
    <button class="icon sm" title={t('close')} aria-label={t('close')} onclick={onClose}><Icon name="close" size={15} /></button>
  </header>
  {#if heads.length === 0}
    <p class="muted pad">{t('noHeadings')}</p>
  {:else}
    <ul>
      {#each rows as { h, i } (h.pos + ':' + i)}
        <li class:on={i === current} style="--lv: {h.level - minLevel}">
          {#if hasKids(i)}
            <button class="caret" class:shut={shut.has(h.line)} aria-label={shut.has(h.line) ? t('expandAll') : t('collapseAll')}
              onclick={() => { const n = new Set(shut); n.has(h.line) ? n.delete(h.line) : n.add(h.line); shut = n; }}><Icon name="chevron" size={13} /></button>
          {:else}<span class="caret none"></span>{/if}
          <button class="item" class:folded={isFolded(h)} onclick={() => go(h)} oncontextmenu={(e) => menu(e, h, i)} title={h.text}>{h.text}</button>
          <button class="more icon sm" aria-label={t('more')} onclick={(e) => menu(e, h, i)}><Icon name="more" size={15} /></button>
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  .toc { width: 17rem; flex: none; border-inline-start: 1px solid var(--hairline, var(--line)); background: color-mix(in srgb, var(--ink) 3%, var(--bg)); display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  header { display: flex; align-items: center; gap: 0.1rem; padding: 0.6rem 0.6rem 0.4rem 0.9rem; }
  header strong { font-size: 0.82rem; letter-spacing: 0.02em; color: var(--muted); text-transform: uppercase; }
  .sm { width: 1.8rem; height: 1.8rem; }
  ul { list-style: none; margin: 0; padding: 0 0.4rem 1rem; overflow: auto; flex: 1; }
  li { display: flex; align-items: center; gap: 0.1rem; padding-inline-start: calc(var(--lv) * 0.85rem); border-radius: 8px; position: relative; }
  li:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); }
  li.on { background: var(--accent-soft); }
  li.on .item { color: var(--accent); font-weight: 600; }
  .caret { width: 1.3rem; height: 1.6rem; flex: none; border: 0; background: none; color: var(--muted); display: inline-grid; place-items: center; padding: 0; transition: transform 0.12s; transform: rotate(0deg); }
  .caret.shut { transform: rotate(-90deg); }
  :global([dir='rtl']) .caret.shut { transform: rotate(90deg); }
  .caret.none { visibility: hidden; }
  .item { flex: 1; min-width: 0; text-align: start; border: 0; background: none; padding: 0.3rem 0.3rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9rem; }
  .item.folded::after { content: ' ⋯'; color: var(--muted); }
  .more { opacity: 0; }
  li:hover .more, li:focus-within .more { opacity: 1; }
  @media (hover: none) { .more { opacity: 1; } }
  .pad { padding: 0.5rem 1rem; }
  @media (max-width: 900px) {
    .toc { position: absolute; inset-block: 0; inset-inline-end: 0; z-index: 30; box-shadow: -8px 0 28px rgba(0, 0, 0, 0.25); background: var(--surface); width: min(18rem, 86vw); }
  }
</style>
