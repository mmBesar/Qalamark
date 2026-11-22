<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  // Choose what the editor tool bar holds and in which order.
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { store } from '../lib/store.svelte.ts';
  import { cleanToolbar, DEFAULT_TOOLBAR, moveTool, TOOLS } from '../lib/toolbar.ts';

  const t = store.t;
  let dlg: HTMLDialogElement;
  onMount(() => dlg.showModal());
  const list = $derived(cleanToolbar(store.s.toolbar));
  const def = (id: string) => TOOLS.find((x) => x.id === id);
  const avail = $derived(TOOLS.filter((x) => !list.includes(x.id)));
  const set = (l: string[]) => store.setToolbar(l);
</script>

<dialog bind:this={dlg} class="toolbar-edit" onclose={() => (store.toolbarOpen = false)}>
  <form method="dialog" class="dialog-head">
    <h2>{t('toolbarEdit')}</h2>
    <button class="icon" aria-label={t('close')}>×</button>
  </form>
  <p class="muted">{t('toolbarHint')}</p>

  <h3>{t('toolbarIn')}</h3>
  <ul class="tb-list">
    {#each list as id, i (i + id)}
      <li>
        <span class="tb-ico">{#if id === 'sep'}<i class="tb-sep"></i>{:else}<Icon name={def(id)!.icon} size={18} />{/if}</span>
        <span class="tb-name">{id === 'sep' ? t('separator') : t(def(id)!.label as never)}</span>
        <button class="icon sm" title={t('moveUp')} aria-label={t('moveUp')} disabled={i === 0} onclick={() => set(moveTool(list, i, -1))}><Icon name="chevron-up" size={16} /></button>
        <button class="icon sm" title={t('moveDown')} aria-label={t('moveDown')} disabled={i === list.length - 1} onclick={() => set(moveTool(list, i, 1))}><Icon name="chevron-down" size={16} /></button>
        <button class="icon sm" title={t('remove')} aria-label={t('remove')} onclick={() => set(list.filter((_, k) => k !== i))}><Icon name="close" size={16} /></button>
      </li>
    {/each}
  </ul>

  <h3>{t('toolbarAvail')}</h3>
  <ul class="tb-list">
    {#each avail as x (x.id)}
      <li>
        <span class="tb-ico"><Icon name={x.icon} size={18} /></span>
        <span class="tb-name">{t(x.label as never)}</span>
        <button class="icon sm" title={t('add')} aria-label={t('add')} onclick={() => set([...list, x.id])}><Icon name="plus" size={16} /></button>
      </li>
    {/each}
    <li>
      <span class="tb-ico"><i class="tb-sep"></i></span>
      <span class="tb-name">{t('separator')}</span>
      <button class="icon sm" title={t('add')} aria-label={t('add')} onclick={() => set([...list, 'sep'])}><Icon name="plus" size={16} /></button>
    </li>
  </ul>

  <div class="row-end">
    <button class="ghost" onclick={() => set([...DEFAULT_TOOLBAR])}>{t('toolbarReset')}</button>
    <button class="primary" onclick={() => dlg.close()}>{t('done')}</button>
  </div>
</dialog>
