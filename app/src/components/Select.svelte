<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  // A drop-down drawn by the app, so it follows the app theme on every platform
  // (the native one is drawn by the system and ignores our colours on Linux).
  import Icon from './Icon.svelte';
  let {
    value = $bindable(''),
    options,
    label = '',
    dir = undefined,
    onchange = undefined,
  }: { value?: string; options: { value: string; label: string }[]; label?: string; dir?: 'ltr' | 'rtl'; onchange?: (v: string) => void } = $props();
  let open = $state(false);
  let btn: HTMLButtonElement | undefined = $state();
  let pos = $state({ x: 0, y: 0, w: 0, up: false });
  let hi = $state(0);
  const current = $derived(options.find((o) => o.value === value)?.label ?? '—');

  function toggle() {
    if (open) return (open = false);
    const r = btn!.getBoundingClientRect();
    const room = window.innerHeight - r.bottom;
    pos = { x: r.left, y: room < 220 ? r.top : r.bottom + 4, w: r.width, up: room < 220 };
    hi = Math.max(0, options.findIndex((o) => o.value === value));
    open = true;
  }
  function pick(v: string) {
    value = v;
    open = false;
    onchange?.(v);
    btn?.focus();
  }
  function key(e: KeyboardEvent) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); toggle(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); open = false; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.min(options.length - 1, hi + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(0, hi - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const o = options[hi]; if (o) pick(o.value); }
    else if (e.key === 'Tab') open = false;
  }
</script>

<svelte:window onpointerdown={(e) => { if (open && !(e.target as Element).closest('.sel-pop, .selbtn')) open = false; }} onresize={() => (open = false)} />

<button type="button" class="selbtn" bind:this={btn} role="combobox" aria-expanded={open} aria-haspopup="listbox" aria-label={label || undefined} {dir} onclick={toggle} onkeydown={key}>
  <span class="cur">{current}</span><Icon name="chevron" size={14} />
</button>
{#if open}
  <ul class="sel-pop" role="listbox" {dir} style="left:{pos.x}px; min-width:{pos.w}px; {pos.up ? `bottom:${window.innerHeight - pos.y + 4}px` : `top:${pos.y}px`}">
    {#each options as o, i (o.value)}
      <li role="option" aria-selected={o.value === value} class:hi={i === hi} onpointerenter={() => (hi = i)} onclick={() => pick(o.value)} onkeydown={() => {}}>{o.label}</li>
    {/each}
  </ul>
{/if}

<style>
  .selbtn { display: inline-flex; align-items: center; justify-content: space-between; gap: 0.5rem; background: var(--surface); border: 1px solid var(--hairline, var(--line)); border-radius: 10px; padding: 0.5rem 0.7rem; min-width: 7rem; text-align: start; }
  .selbtn[aria-expanded='true'] { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
  .cur { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sel-pop { position: fixed; z-index: 1000; margin: 0; padding: 0.3rem; list-style: none; background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.35); max-height: 16rem; overflow: auto; }
  li { padding: 0.45rem 0.7rem; border-radius: 8px; cursor: pointer; white-space: nowrap; }
  li.hi { background: var(--accent-soft); }
  li[aria-selected='true'] { color: var(--accent); font-weight: 600; }
</style>
