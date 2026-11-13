<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import { store } from '../lib/store.svelte.ts';

  let { onSettings, onPick }: { onSettings: () => void; onPick: () => void } = $props();
  const t = store.t;
  let query = $state('');
  let fileInput: HTMLInputElement;

  const shown = $derived(
    store.notes.filter((n) => n.title.toLowerCase().includes(query.trim().toLowerCase())),
  );

  function pick(id: string) {
    store.currentId = id;
    onPick();
  }

  async function create() {
    try {
      await store.createNote();
      onPick();
    } catch (e) {
      store.message = e instanceof Error ? e.message : String(e);
    }
  }

  async function imported() {
    if (fileInput.files?.length) await store.importFiles(fileInput.files);
    fileInput.value = '';
  }
</script>

<aside>
  <header>
    <img src="./icon.svg" alt="" width="28" height="28" />
    <strong>{t('appName')}</strong>
    <span class="grow"></span>
    <button class="icon" aria-label={t('settings')} title={t('settings')} onclick={onSettings}>⚙</button>
  </header>

  <div class="actions">
    <button class="primary" onclick={create}>＋ {t('newNote')}</button>
    <button class="icon" title={t('import')} aria-label={t('import')} onclick={() => fileInput.click()}>⇪</button>
    <input bind:this={fileInput} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple hidden onchange={imported} />
  </div>

  <input class="search" type="search" placeholder={t('search')} bind:value={query} aria-label={t('search')} />

  <ul>
    {#each shown as n (n.id)}
      <li>
        <button class:active={n.id === store.currentId} onclick={() => pick(n.id)}>
          <span class="title">{n.title}</span>
          {#if n.role !== 'owner' && store.mode === 'server'}
            <small class="badge" title={t('sharedByOther', { name: n.owner })}>{n.owner}{n.role === 'view' ? ' · 👁' : ''}</small>
          {/if}
        </button>
      </li>
    {:else}
      <li class="muted pad">{store.notes.length ? t('noResults') : t('noNotes')}</li>
    {/each}
  </ul>

  <footer>
    {#if store.mode === 'server'}
      <span class="dot" class:off={!store.serverReachable}></span>
      <span>{store.s.username}</span>
      {#if !store.serverReachable}<small class="muted">· {t('offline')}</small>{/if}
    {:else}
      <span class="dot local"></span><span>{t('localMode')}</span>
      <span class="grow"></span>
      <button class="link" onclick={() => store.showLogin()}>{t('signIn')}</button>
    {/if}
  </footer>
</aside>
