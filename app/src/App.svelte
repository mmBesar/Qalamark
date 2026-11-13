<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import { onMount } from 'svelte';
  import Editor from './components/Editor.svelte';
  import Login from './components/Login.svelte';
  import SettingsDialog from './components/SettingsDialog.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import { store } from './lib/store.svelte.ts';

  let drawer = $state(false);
  let settings = $state(false);

  onMount(() => {
    void store.boot();
  });

  const t = store.t;
</script>

{#if store.mode === 'boot'}
  <div class="splash"><img src="./icon.svg" alt="" width="72" height="72" /></div>
{:else if store.mode === 'login'}
  <Login />
{:else}
  <div class="shell" class:drawer-open={drawer}>
    <Sidebar onSettings={() => (settings = true)} onPick={() => (drawer = false)} />
    <button class="scrim" aria-label={t('close')} onclick={() => (drawer = false)}></button>
    <main>
      {#if store.current}
        {#key store.current.id + store.mode}
          <Editor note={store.current} onMenu={() => (drawer = true)} />
        {/key}
      {:else}
        <div class="empty">
          <button class="icon menu-btn" aria-label={t('menu')} onclick={() => (drawer = true)}>☰</button>
          <img src="./icon.svg" alt="" width="64" height="64" />
          <p>{t('pickNote')}</p>
          <button class="primary" onclick={() => store.createNote()}>{t('newNote')}</button>
        </div>
      {/if}
    </main>
  </div>
  {#if settings}
    <SettingsDialog onClose={() => (settings = false)} />
  {/if}
{/if}
