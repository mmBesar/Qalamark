<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Editor from './components/Editor.svelte';
  import Login from './components/Login.svelte';
  import SettingsDialog from './components/SettingsDialog.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import DialogHost from './components/DialogHost.svelte';
  import Palette from './components/Palette.svelte';
  import TabBar from './components/TabBar.svelte';
  import ContextMenu from './components/ContextMenu.svelte';
  import { ctxmenu } from './lib/ctxmenu.svelte.ts';
  import { inShell } from './lib/vault.ts';
  import { editorMenu, fieldMenu } from './lib/menus.ts';
  import { store } from './lib/store.svelte.ts';

  let drawer = $state(false);
  let settings = $state(false);

  onMount(() => {
    void store.boot();
  });

  const t = store.t;

  // Android back button: close the top layer (settings, menu, palette, sign-in) before leaving the app
  let pushed = 0;
  $effect(() => {
    const layers = (settings ? 1 : 0) + (drawer ? 1 : 0) + (store.palette ? 1 : 0) + (store.mode === 'login' ? 1 : 0);
    while (pushed < layers) {
      history.pushState({ qm: ++pushed }, '');
    }
  });
  onMount(() => {
    const onPop = () => {
      if (pushed > 0) pushed--;
      if (store.palette) store.palette = false;
      else if (settings) settings = false;
      else if (drawer) drawer = false;
      else if (store.mode === 'login') store.startLocal();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });

  // on a phone the keyboard appears over the page: keep the field being typed in on screen
  onMount(() => {
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (!matchMedia('(pointer: coarse)').matches || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350);
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  });

  // every open note has a tab
  $effect(() => {
    const id = store.currentId;
    untrack(() => store.tabsSeen(id));
  });
  $effect(() => {
    store.notes.length;
    store.notes;
    untrack(() => store.pruneTabs());
  });

  /** Right-click: the app's own themed menu in the editor and in text boxes; no stray browser menu in the apps. */
  function onContext(e: MouseEvent) {
    if (e.defaultPrevented) return;
    const el = e.target as HTMLElement | null;
    const field = el?.closest('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
    if (field && !(field instanceof HTMLInputElement && ['checkbox', 'radio', 'range', 'button'].includes(field.type))) {
      e.preventDefault();
      ctxmenu.show(e.clientX, e.clientY, fieldMenu(field, t));
    } else if (el?.closest('.cm-content')) {
      e.preventDefault();
      ctxmenu.show(e.clientX, e.clientY, editorMenu(e, t));
    } else if (inShell()) {
      e.preventDefault();
    }
  }

  // Swipe the side panel in from the screen edge and out again, following the finger (phones and small windows).
  let prog = $state<number | null>(null); // 0 = closed … 1 = open, while a finger is down
  let sw: { x: number; y: number; w: number; opening: boolean; live: boolean } | null = null;
  const small = () => matchMedia('(max-width: 760px)').matches;
  const rtl = () => document.documentElement.dir === 'rtl';
  function swStart(e: TouchEvent) {
    if (!small() || e.touches.length !== 1 || store.mode === 'login' || store.mode === 'boot') return;
    const t0 = e.touches[0]!;
    const fromEdge = rtl() ? t0.clientX >= innerWidth - 34 : t0.clientX <= 34;
    if (!drawer && !fromEdge) return;
    const w = document.querySelector('aside')?.getBoundingClientRect().width ?? 300;
    sw = { x: t0.clientX, y: t0.clientY, w, opening: !drawer, live: false };
  }
  function swMove(e: TouchEvent) {
    if (!sw) return;
    const t0 = e.touches[0]!;
    const dx = (rtl() ? -1 : 1) * (t0.clientX - sw.x);
    const dy = t0.clientY - sw.y;
    if (!sw.live) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; }
      if (Math.abs(dx) < 10) return;
      if ((sw.opening && dx < 0) || (!sw.opening && dx > 0)) { sw = null; return; }
      sw.live = true;
    }
    prog = Math.max(0, Math.min(1, (sw.opening ? 0 : 1) + dx / sw.w));
  }
  function swEnd() {
    if (sw?.live && prog !== null) drawer = prog > (sw.opening ? 0.35 : 0.65);
    sw = null;
    prog = null;
  }

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
  <div class="shell" class:drawer-open={drawer} class:swiping={prog !== null} style:--p={prog ?? (drawer ? 1 : 0)}>
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
      <TabBar />
      {#if store.current}
        {#key store.current.id + store.mode + store.epoch}
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
<svelte:window ontouchstart={swStart} ontouchmove={swMove} ontouchend={swEnd} ontouchcancel={swEnd} oncontextmenu={onContext} onkeydown={(e) => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'p' || e.key === 'k') && store.mode !== 'login' && store.mode !== 'boot') { e.preventDefault(); store.palette = !store.palette; } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'w' && store.currentId) { e.preventDefault(); store.closeTabs([store.currentId]); } else if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); store.nextTab(e.shiftKey ? -1 : 1); } }} />
<DialogHost />
<ContextMenu />
