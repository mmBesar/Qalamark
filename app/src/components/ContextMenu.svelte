<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { ctxmenu, type MenuItem } from '../lib/ctxmenu.svelte.ts';
  import { store } from '../lib/store.svelte.ts';

  let el = $state<HTMLDivElement>();
  let stack = $state<MenuItem[][]>([]);
  let pos = $state({ x: 0, y: 0 });

  const list = $derived(stack.length ? stack[stack.length - 1] : ctxmenu.items);

  // Place the menu at the pointer, then nudge it back inside the window.
  $effect(() => {
    if (!ctxmenu.open) return;
    stack = [];
    pos = { x: ctxmenu.x, y: ctxmenu.y };
    void place();
  });
  $effect(() => {
    list;
    if (ctxmenu.open) void place();
  });
  async function place() {
    await tick();
    if (!el) return;
    const r = el.getBoundingClientRect();
    const rtl = document.documentElement.dir === 'rtl';
    let x = ctxmenu.x;
    let y = ctxmenu.y;
    if (rtl && x - r.width > 4) x -= r.width;
    x = Math.max(6, Math.min(x, innerWidth - r.width - 6));
    y = Math.max(6, Math.min(y, innerHeight - r.height - 6));
    pos = { x, y };
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  async function choose(it: MenuItem) {
    if (it.disabled) return;
    if (it.children) {
      stack = [...stack, it.children];
      return;
    }
    ctxmenu.close();
    try {
      await it.run?.();
    } catch (e) {
      store.message = e instanceof Error ? e.message : String(e);
    }
  }

  function key(e: KeyboardEvent) {
    if (!ctxmenu.open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (stack.length) stack = stack.slice(0, -1);
      else ctxmenu.close();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const bs = [...(el?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      if (!bs.length) return;
      const i = bs.indexOf(document.activeElement as HTMLButtonElement);
      bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus();
    }
  }
</script>

<svelte:window onkeydown={key} onresize={() => ctxmenu.close()} onblur={() => ctxmenu.close()} />

{#if ctxmenu.open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ctx-scrim" onpointerdown={() => ctxmenu.close()} oncontextmenu={(e) => { e.preventDefault(); ctxmenu.close(); }}></div>
  <div class="ctx" role="menu" bind:this={el} style:left="{pos.x}px" style:top="{pos.y}px">
    {#if stack.length}
      <button class="ctx-item back" onclick={() => (stack = stack.slice(0, -1))}>
        <span class="ci"><Icon name="chevron-left" size={16} /></span><span class="cl">{store.t('back')}</span>
      </button>
      <div class="ctx-sep"></div>
    {/if}
    {#each list as it, i (i)}
      {#if it.sep}
        <div class="ctx-sep"></div>
      {:else}
        <button class="ctx-item" class:danger={it.danger} disabled={it.disabled} role="menuitem" onclick={() => choose(it)}>
          <span class="ci">{#if it.icon}<Icon name={it.icon} size={16} />{/if}</span>
          <span class="cl">{it.label}</span>
          {#if it.hint}<span class="chint">{it.hint}</span>{/if}
          {#if it.children}<span class="cchev"><Icon name="chevron-right" size={14} /></span>{/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}
