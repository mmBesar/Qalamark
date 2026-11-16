<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  // Several notes open at once, like the tabs of a browser.
  import Icon from './Icon.svelte';
  import { ctxmenu } from '../lib/ctxmenu.svelte.ts';
  import { store } from '../lib/store.svelte.ts';

  const t = store.t;
  const title = (id: string) => store.notes.find((n) => n.id === id)?.title ?? '…';
  let dragging = $state<string | null>(null);
  let over = $state<string | null>(null);
  let strip = $state<HTMLElement>();

  $effect(() => {
    store.currentId;
    // keep the active tab in view
    queueMicrotask(() => strip?.querySelector('.tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  });

  function menu(e: MouseEvent, id: string) {
    e.preventDefault();
    const i = store.tabs.indexOf(id);
    ctxmenu.show(e.clientX, e.clientY, [
      { label: t('tabClose'), icon: 'close', run: () => store.closeTabs([id]) },
      { label: t('tabCloseOthers'), icon: 'close', disabled: store.tabs.length < 2, run: () => { store.currentId = id; store.closeTabs(store.tabs.filter((x) => x !== id)); } },
      { label: t('tabCloseRight'), icon: 'close', disabled: i === store.tabs.length - 1, run: () => store.closeTabs(store.tabs.slice(i + 1)) },
      { sep: true },
      { label: t('tabCloseAll'), icon: 'close', run: () => store.closeTabs([...store.tabs]) },
    ]);
  }
</script>

{#if store.tabs.length}
  <div class="tabbar" role="tablist" bind:this={strip}>
    {#each store.tabs as id (id)}
      <div
        class="tab"
        class:on={id === store.currentId}
        class:over={over === id && dragging !== id}
        role="tab"
        tabindex="0"
        aria-selected={id === store.currentId}
        draggable="true"
        ondragstart={(e) => { dragging = id; e.dataTransfer?.setData('text/plain', id); }}
        ondragover={(e) => { e.preventDefault(); over = id; }}
        ondragleave={() => (over = null)}
        ondrop={(e) => { e.preventDefault(); if (dragging && dragging !== id) store.moveTab(dragging, id); dragging = over = null; }}
        ondragend={() => (dragging = over = null)}
        onclick={() => (store.currentId = id)}
        onauxclick={(e) => { if (e.button === 1) { e.preventDefault(); store.closeTabs([id]); } }}
        onkeydown={(e) => { if (e.key === 'Enter') store.currentId = id; }}
        oncontextmenu={(e) => menu(e, id)}
        title={title(id)}
      >
        <span class="name">{title(id)}</span>
        <button class="x" aria-label={t('tabClose')} onclick={(e) => { e.stopPropagation(); store.closeTabs([id]); }}><Icon name="close" size={13} /></button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .tabbar { display: flex; gap: 2px; padding: 0.35rem 0.6rem 0; overflow-x: auto; scrollbar-width: none; background: color-mix(in srgb, var(--ink) 4%, var(--bg)); border-bottom: 1px solid var(--line); flex: none; }
  .tabbar::-webkit-scrollbar { display: none; }
  .tab { display: flex; align-items: center; gap: 0.3rem; min-width: 7rem; max-width: 14rem; padding: 0.35rem 0.3rem 0.35rem 0.8rem; border-radius: 9px 9px 0 0; color: var(--muted); cursor: pointer; user-select: none; position: relative; border: 1px solid transparent; border-bottom: 0; margin-bottom: -1px; flex: none; }
  .tab:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--ink); }
  .tab.on { background: var(--bg); color: var(--ink); border-color: var(--line); }
  .tab.on::before { content: ''; position: absolute; inset-inline: 8px; top: 0; height: 2px; border-radius: 2px; background: var(--accent); }
  .tab.over { box-shadow: inset 2px 0 0 var(--accent); }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.88rem; }
  .x { width: 1.5rem; height: 1.5rem; border: 0; border-radius: 6px; background: none; color: inherit; display: grid; place-items: center; padding: 0; opacity: 0; }
  .tab:hover .x, .tab.on .x, .tab:focus-within .x { opacity: 0.7; }
  .x:hover { opacity: 1 !important; background: color-mix(in srgb, var(--ink) 12%, transparent); }
  @media (pointer: coarse) { .x { opacity: 0.7; width: 2rem; height: 2rem; } .tab { padding-block: 0.5rem; } }
  @media (max-width: 760px) { .tab { min-width: 6rem; max-width: 10rem; } }
</style>
