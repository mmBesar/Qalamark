<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  // Ctrl+P / Ctrl+K: jump to any note or run a command from the keyboard.
  import Icon from './Icon.svelte';
  import { store } from '../lib/store.svelte.ts';

  let { onSettings }: { onSettings: () => void } = $props();
  const t = store.t;
  let q = $state('');
  let hi = $state(0);
  let hits = $state<Array<{ id: string; title: string; snippet: string }>>([]);
  let input: HTMLInputElement | undefined = $state();
  let timer: ReturnType<typeof setTimeout>;

  interface Item { key: string; icon: string; label: string; hint?: string; run: () => void }
  const close = () => (store.palette = false);
  const cmd = (name: string) => window.dispatchEvent(new CustomEvent('qalamark-cmd', { detail: name }));

  const commands: Item[] = [
    { key: 'new', icon: 'plus', label: t('newNote'), run: () => void store.createNote() },
    { key: 'quick', icon: 'bolt', label: t('quickNote'), hint: 'Alt+N', run: () => (store.quickOpen = true) },
    { key: 'daily', icon: 'calendar', label: t('dailyNote'), run: () => void store.openDaily() },
    { key: 'board', icon: 'board', label: t('newBoard'), run: () => void store.newFromTemplate('builtin:kanban') },
    { key: 'outline', icon: 'outline', label: t('outline'), run: () => cmd('outline') },
    { key: 'live', icon: 'note', label: t('modeLive'), run: () => cmd('mode:live') },
    { key: 'read', icon: 'note', label: t('modeRead'), run: () => cmd('mode:read') },
    { key: 'source', icon: 'code', label: t('modeSource'), run: () => cmd('mode:source') },
    { key: 'settings', icon: 'settings', label: t('settings'), run: onSettings },
  ];

  const norm = (s: string) => s.toLowerCase();
  /** letters of the query appear in order (fuzzy), best when they are together */
  function score(title: string, needle: string): number {
    const a = norm(title);
    if (!needle) return 1;
    const i = a.indexOf(needle);
    if (i >= 0) return 100 - i - a.length / 100;
    let p = 0;
    for (const ch of needle) {
      p = a.indexOf(ch, p);
      if (p < 0) return 0;
      p++;
    }
    return 10 - a.length / 100;
  }

  const items = $derived.by<Item[]>(() => {
    const needle = norm(q.trim());
    const cs = commands.filter((c) => !needle || norm(c.label).includes(needle));
    let notes = store.notes.filter((n) => n.id !== store.currentId);
    if (needle) {
      notes = notes.map((n) => [n, score(n.title, needle)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([n]) => n);
    } else {
      const rank = (id: string) => { const i = store.recent.indexOf(id); return i < 0 ? 99 : i; };
      notes = [...notes].sort((a, b) => rank(a.id) - rank(b.id));
    }
    const ns: Item[] = notes.slice(0, 12).map((n) => ({ key: 'n:' + n.id, icon: 'note', label: n.title, hint: n.folder || undefined, run: () => (store.currentId = n.id) }));
    const known = new Set(notes.slice(0, 12).map((n) => n.id));
    const tx: Item[] = hits.filter((h) => !known.has(h.id)).map((h) => ({ key: 't:' + h.id, icon: 'search', label: h.title, hint: h.snippet, run: () => (store.currentId = h.id) }));
    return needle ? [...ns, ...tx, ...cs] : [...cs, ...ns];
  });

  $effect(() => {
    const needle = q.trim();
    clearTimeout(timer);
    hits = [];
    if (needle.length < 2) return;
    timer = setTimeout(async () => {
      const r = await store.searchText(needle);
      if (q.trim() === needle) hits = r;
    }, 220);
  });
  $effect(() => { q; hi = 0; });
  $effect(() => { input?.focus(); });

  function go(it: Item | undefined) {
    if (!it) return;
    close();
    it.run();
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.min(items.length - 1, hi + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(0, hi - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); go(items[hi]); }
  }
  $effect(() => { document.querySelector('.pal-list li.hi')?.scrollIntoView({ block: 'nearest' }); });
</script>

<div class="pal-back" role="presentation" transition:fade|global={{ duration: 150 }} onpointerdown={(e) => e.target === e.currentTarget && close()}>
  <div class="pal" role="dialog" in:fly|global={{ y: -24, duration: 220 }} out:fly|global={{ y: -24, duration: 160 }} aria-label={t('palette')}>
    <div class="pal-in"><Icon name="search" size={18} /><input bind:this={input} bind:value={q} onkeydown={key} placeholder={t('palettePlaceholder')} spellcheck="false" autocomplete="off" /></div>
    <ul class="pal-list" role="listbox">
      {#each items as it, i (it.key)}
        <li dir="auto" role="option" aria-selected={i === hi} class:hi={i === hi} onpointerenter={() => (hi = i)} onclick={() => go(it)} onkeydown={() => {}}>
          <Icon name={it.icon} size={16} /><span class="lbl">{it.label}</span>{#if it.hint}<span class="hint">{it.hint}</span>{/if}
        </li>
      {:else}
        <li class="none">{t('nothing')}</li>
      {/each}
    </ul>
  </div>
</div>

<style>
  .pal-back { position: fixed; inset: 0; z-index: 900; background: rgba(10, 8, 20, 0.4); backdrop-filter: blur(3px); display: flex; justify-content: center; align-items: flex-start; padding-top: min(16vh, 7rem); }
  .pal { width: min(38rem, 94vw); background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.5); overflow: hidden; display: flex; flex-direction: column; max-height: 70vh; }
  .pal-in { display: flex; align-items: center; gap: 0.6rem; padding: 0.85rem 1rem; border-bottom: 1px solid var(--line); color: var(--muted); }
  .pal-in input { flex: 1; border: 0; background: none; font-size: 1.05rem; color: var(--ink); padding: 0; box-shadow: none; }
  .pal-in input:focus-visible { box-shadow: none; }
  .pal-list { list-style: none; margin: 0; padding: 0.4rem; overflow: auto; }
  li { display: flex; align-items: center; gap: 0.65rem; padding: 0.55rem 0.7rem; border-radius: 10px; cursor: pointer; color: var(--ink); }
  li.hi { background: var(--accent-soft); color: var(--accent); }
  .lbl { flex: none; max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hint { color: var(--muted); font-size: 0.82rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .none { color: var(--muted); cursor: default; justify-content: center; }
</style>
