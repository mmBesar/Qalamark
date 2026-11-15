<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import { onMount } from 'svelte';
  import Editor from './components/Editor.svelte';
  import Login from './components/Login.svelte';
  import SettingsDialog from './components/SettingsDialog.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import DialogHost from './components/DialogHost.svelte';
  import Palette from './components/Palette.svelte';
  import { store } from './lib/store.svelte.ts';

  let drawer = $state(false);
  let settings = $state(false);

  onMount(() => {
    void store.boot();
  });

  const t = store.t;

  // Drag the edge of the sidebar to change its width (double-click resets it).
  let dragging = $state(false);
  function startDrag(e: PointerEvent) {
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function moveDrag(e: PointerEvent) {
    if (!dragging) return;
    const rtl = document.documentElement.dir === 'rtl';
    const w = rtl ? window.innerWidth - e.clientX : e.clientX;
    store.setLayout({ sideWidth: Math.round(Math.min(560, Math.max(200, w))) });
  }
  function endDrag() {
    dragging = false;
  }
</script>

{#if store.mode === 'boot'}
  <div class="splash"><img src="./icon.svg" alt="" width="72" height="72" /></div>
{:else if store.mode === 'login'}
  <Login />
{:else}
  <div class="shell" class:drawer-open={drawer}>
    <Sidebar onSettings={() => (settings = true)} onPick={() => (drawer = false)} />
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <button
      class="resizer"
      class:drag={dragging}
      aria-label="Resize"
      tabindex="-1"
      onpointerdown={startDrag}
      onpointermove={moveDrag}
      onpointerup={endDrag}
      onpointercancel={endDrag}
      ondblclick={() => store.setLayout({ sideWidth: 304 })}
    ></button>
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
{#if store.palette}<Palette onSettings={() => (settings = true)} />{/if}
<svelte:window onkeydown={(e) => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'p' || e.key === 'k') && store.mode !== 'login' && store.mode !== 'boot') { e.preventDefault(); store.palette = !store.palette; } }} />
<DialogHost />
