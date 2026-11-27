<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  // Quick capture: a small box that adds a dated line to the "Quick notes" note. Ctrl+Enter adds, Escape closes.
  import { onMount } from 'svelte';
  import { store } from '../lib/store.svelte.ts';

  const t = store.t;
  let dlg: HTMLDialogElement;
  let text = $state('');
  let busy = $state(false);

  onMount(() => {
    dlg.showModal();
    dlg.querySelector('textarea')?.focus();
  });
  async function add() {
    if (!text.trim() || busy) return;
    busy = true;
    try {
      await store.quickAdd(text);
      store.say(t('quickSaved'), { label: t('quickOpen'), act: () => void store.openQuick() });
      dlg.close();
    } catch (e) {
      store.say(e instanceof Error ? e.message : String(e), { bad: true });
      busy = false;
    }
  }
</script>

<dialog bind:this={dlg} class="quick-dlg" onclose={() => (store.quickOpen = false)}>
  <div class="dialog-head"><h2>{t('quickNote')}</h2></div>
  <p class="muted small">{t('quickHint')}</p>
  <textarea
    dir="auto"
    rows="4"
    bind:value={text}
    onkeydown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void add(); } }}
  ></textarea>
  <div class="row-end">
    <button type="button" class="ghost" onclick={() => { dlg.close(); void store.openQuick(); }}>{t('quickOpen')}</button>
    <span class="grow"></span>
    <button type="button" onclick={() => dlg.close()}>{t('cancel')}</button>
    <button type="button" class="primary" disabled={!text.trim() || busy} onclick={add}>{t('quickAdd')}</button>
  </div>
</dialog>

<style>
  .quick-dlg { width: min(32rem, 94vw); }
  textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 6rem; font: inherit; }
  .row-end { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.7rem; }
  .grow { flex: 1; }
</style>
