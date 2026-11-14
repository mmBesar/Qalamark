<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { NoteMeta, Share } from '../lib/server.ts';
  import { store } from '../lib/store.svelte.ts';

  let { note, onClose }: { note: NoteMeta; onClose: () => void } = $props();
  const t = store.t;
  let dlg: HTMLDialogElement;
  let shares = $state<Share[]>([]);
  let name = $state('');
  let role = $state<'edit' | 'view'>('edit');
  let error = $state('');
  let people = $state<string[]>([]);
  const choices = $derived(people.filter((p) => !shares.some((s) => s.username === p)));

  async function load() {
    try {
      shares = await store.api.shares(note.id);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  onMount(() => {
    dlg.showModal();
    void load();
    store.api.people().then((p) => (people = p)).catch(() => {});
    // pick the first person who is not shared yet
  });
  $effect(() => {
    if (!choices.includes(name)) name = choices[0] ?? '';
  });

  async function add(e: Event) {
    e.preventDefault();
    error = '';
    try {
      await store.api.addShare(note.id, name, role);
      name = '';
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  async function remove(u: string) {
    await store.api.removeShare(note.id, u);
    await load();
  }
</script>

<dialog bind:this={dlg} onclose={onClose}>
  <form method="dialog" class="dialog-head">
    <h2>👥 {t('share')} · {note.display || note.title}</h2>
    <button class="icon" aria-label={t('close')}>×</button>
  </form>

  <h3>{t('sharedWith')}</h3>
  <ul class="plain">
    {#each shares as s (s.username)}
      <li>
        <span>{s.username}</span>
        <small class="muted">{s.role === 'edit' ? t('canEdit') : t('canView')}</small>
        <span class="grow"></span>
        <button class="link" onclick={() => remove(s.username)}>{t('remove')}</button>
      </li>
    {:else}
      <li class="muted">—</li>
    {/each}
  </ul>

  <form class="row" onsubmit={add}>
    {#if people.length > 0}
      <select bind:value={name} aria-label={t('username')} dir="ltr" required>
        {#each choices as p (p)}<option value={p}>{p}</option>{:else}<option value="" disabled>—</option>{/each}
      </select>
    {:else}
      <input bind:value={name} placeholder={t('username')} required autocapitalize="off" spellcheck="false" dir="ltr" />
    {/if}
    <select bind:value={role}>
      <option value="edit">{t('canEdit')}</option>
      <option value="view">{t('canView')}</option>
    </select>
    <button class="primary">{t('addPerson')}</button>
  </form>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</dialog>
