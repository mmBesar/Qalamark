<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  // A bottom sheet for phones: slides up over the note, closes with a tap outside, a swipe down or the back button.
  import type { Snippet } from 'svelte';
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
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />
<button class="sheet-scrim" aria-label={store.t('close')} onclick={onClose}></button>
<div class="sheet" role="dialog" aria-label={title} bind:this={sheet} style:transform={dy ? `translateY(${dy}px)` : undefined}>
  <div class="grab" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} role="presentation"><i></i></div>
  <h3>{title}</h3>
  <div class="sheet-body">{@render children()}</div>
</div>
