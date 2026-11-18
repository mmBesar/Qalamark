<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '../lib/store.svelte.ts';
  import { lineDiff, snapshots } from '../lib/history.ts';

  let { id, current, onRestore, onClose }: { id: string; current: string; onRestore: (text: string) => void; onClose: () => void } = $props();
  let dlg: HTMLDialogElement;
  const t = store.t;
  const list = snapshots(id).slice().reverse();
  let sel = $state(0);
  onMount(() => dlg.showModal());

  const when = (ts: number) => new Date(ts).toLocaleString(store.lang === 'ar' ? 'ar' : undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const chosen = $derived(list[sel]);
  const diff = $derived(chosen ? lineDiff(chosen.text, current) : null);
</script>

<dialog bind:this={dlg} onclose={onClose} class="wide history">
  <form method="dialog" class="dialog-head">
    <h2>{t('history')}</h2>
    <button class="icon" aria-label={t('close')}>×</button>
  </form>
  {#if !list.length}
    <p class="muted">{t('historyEmpty')}</p>
  {:else}
    <div class="hist">
      <ul role="listbox" aria-label={t('history')}>
        {#each list as s, i (s.t)}
          <li><button role="option" aria-selected={i === sel} class:on={i === sel} onclick={() => (sel = i)}>{when(s.t)}</button></li>
        {/each}
      </ul>
      <div class="pane">
        {#if diff}<p class="muted">{t('historyDiff', { a: diff.removed, b: diff.added })}</p>{/if}
        <pre dir="auto">{chosen?.text}</pre>
        <div class="row-actions">
          <button class="primary" onclick={() => { if (chosen) { onRestore(chosen.text); dlg.close(); } }}>{t('historyRestore')}</button>
        </div>
      </div>
    </div>
  {/if}
</dialog>

<style>
  .hist { display: grid; grid-template-columns: 13rem 1fr; gap: 1rem; min-height: 18rem; }
  ul { list-style: none; margin: 0; padding: 0; max-height: 22rem; overflow: auto; display: grid; gap: 0.2rem; align-content: start; }
  li button { width: 100%; text-align: start; border: 0; border-radius: 8px; padding: 0.45rem 0.6rem; background: none; color: var(--ink); font: inherit; cursor: pointer; }
  li button:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); }
  li button.on { background: color-mix(in srgb, var(--accent) 18%, transparent); }
  .pane { display: grid; grid-template-rows: auto 1fr auto; gap: 0.5rem; min-width: 0; }
  pre { margin: 0; padding: 0.7rem; border-radius: 10px; background: color-mix(in srgb, var(--ink) 5%, transparent); max-height: 20rem; overflow: auto; white-space: pre-wrap; font-family: var(--mono); font-size: 0.85rem; }
  .row-actions { display: flex; justify-content: flex-end; }
  @media (max-width: 640px) { .hist { grid-template-columns: 1fr; } ul { max-height: 9rem; } }
</style>
