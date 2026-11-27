<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  // A short message at the bottom ("Saved ..."), with one optional action. It slides up and away again.
  import { fly } from 'svelte/transition';
  import { store } from '../lib/store.svelte.ts';
</script>

{#if store.toast}
  {#key store.toast.n}
    <div class="toast" class:bad={store.toast.bad} role="status" aria-live="polite" transition:fly={{ y: 60, duration: 220 }}>
      <span dir="auto">{store.toast.text}</span>
      {#if store.toast.label}<button class="ghost small" onclick={() => { store.toast?.act?.(); store.toast = null; }}>{store.toast.label}</button>{/if}
      <button class="ghost small" aria-label="×" onclick={() => (store.toast = null)}>✕</button>
    </div>
  {/key}
{/if}
