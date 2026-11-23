<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  // A bottom sheet for phones: slides up over the note, closes with a tap outside, a swipe down or the back button.
  import type { Snippet } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { store } from '../lib/store.svelte.ts';
  let { title, onClose, children }: { title: string; onClose: () => void; children: Snippet } = $props();
  let startY = 0;
  let dy = $state(0);
  let sheet: HTMLElement;
  function down(e: PointerEvent) {
    startY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if ((e.buttons & 1) === 0 && e.pointerType === 'mouse') return;
    dy = Math.max(0, e.clientY - startY);
  }
  function up() {
    if (dy > 90) onClose();
    dy = 0;
  }
  // Swiping down anywhere on the sheet closes it, as long as its own list is scrolled to the top.
  let ty = 0, tx = 0, tdrag = false;
  function tstart(e: TouchEvent) {
    const t = e.touches[0]!;
    ty = t.clientY; tx = t.clientX; tdrag = false;
  }
  function tmove(e: TouchEvent) {
    const t = e.touches[0]!;
    const body = sheet?.querySelector('.sheet-body') as HTMLElement | null;
    const inBody = body?.contains(e.target as Node);
    if (!tdrag) {
      if (inBody && body && body.scrollTop > 0) return;
      if (t.clientY - ty > 14 && t.clientY - ty > Math.abs(t.clientX - tx) * 1.5) tdrag = true;
      else return;
    }
    dy = Math.max(0, t.clientY - ty);
  }
  function tend() {
    if (tdrag && dy > 70) onClose();
    dy = 0; tdrag = false;
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />
<button class="sheet-scrim" style:opacity={store.sheetDrag !== null ? store.sheetDrag : undefined} transition:fade|global={{ duration: store.sheetDrag !== null ? 0 : 200 }} aria-label={store.t('close')} onclick={onClose} ontouchstart={tstart} ontouchmove={tmove} ontouchend={tend}></button>
<div class="sheet" role="dialog" transition:fly|global={{ y: 600, duration: store.sheetDrag !== null ? 0 : 260, opacity: 1, easing: cubicOut }} aria-label={title} bind:this={sheet} ontouchstart={tstart} ontouchmove={tmove} ontouchend={tend} ontouchcancel={tend} style:transform={store.sheetDrag !== null ? `translateY(${(1 - store.sheetDrag) * 100}%)` : dy ? `translateY(${dy}px)` : undefined}>
  <div class="grab" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} role="presentation"><i></i></div>
  <h3>{title}</h3>
  <div class="sheet-body">{@render children()}</div>
</div>
