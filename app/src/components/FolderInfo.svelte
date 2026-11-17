<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  // The apps keep notes as plain .md files in a folder. Shown before signing in, so it is clear which folder
  // is used and that the files already in it become notes (nothing is copied or downloaded twice).
  import { onMount } from 'svelte';
  import { store } from '../lib/store.svelte.ts';
  import { onAndroid, vault } from '../lib/vault.ts';
  const t = store.t;
  let path = $state('');
  let count = $state<number | null>(null);
  let err = $state('');
  async function look() {
    try {
      const i = await vault.info();
      path = i.path;
      count = (await vault.list()).length;
      err = '';
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
  }
  async function change() {
    const p = await vault.pick();
    if (!p) return;
    try {
      await vault.set(p);
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    await look();
  }
  onMount(() => {
    void look();
    // back from the Android permission screen: look again
    const again = () => void look();
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  });
</script>

{#if path}
  <div class="folder">
    <div>
      <b>{t('folderTitle')}</b>
      <code dir="ltr">{path}</code>
      <small>{count === null ? '' : count === 0 ? t('folderEmpty') : t('folderFound', { n: count })}</small>
    </div>
    {#if !onAndroid()}<button type="button" class="ghost" onclick={change}>{t('folderChange')}</button>{/if}
    {#if onAndroid() && path.includes('/Android/data/')}<small class="warn">{t('folderAndroidHint')}</small>{/if}
    {#if err}<small class="warn">{err}</small>{/if}
  </div>
{/if}

<style>
  .folder { display: flex; gap: 0.6rem; align-items: center; justify-content: space-between; padding: 0.6rem 0.75rem; border: 1px solid var(--line); border-radius: 10px; text-align: start; flex-wrap: wrap; margin: 0.2rem 0 0.5rem; }
  .folder div { display: grid; gap: 0.15rem; min-width: 0; }
  b { font-size: 0.9rem; }
  code { font-size: 0.8rem; color: var(--muted); overflow-wrap: anywhere; }
  small { color: var(--muted); font-size: 0.8rem; line-height: 1.35; }
  small.warn { color: var(--danger); flex-basis: 100%; }
</style>
