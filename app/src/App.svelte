<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import { latinKey } from './lib/keys.ts';
  import { onMount, untrack } from 'svelte';
  import { hasTray, listenNotify, listenTray, trayRefresh } from './lib/tray.ts';
  import Editor from './components/Editor.svelte';
  import Login from './components/Login.svelte';
  import Welcome from './components/Welcome.svelte';
  import SettingsDialog from './components/SettingsDialog.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import DialogHost from './components/DialogHost.svelte';
  import ToolbarDialog from './components/ToolbarDialog.svelte';
  import Palette from './components/Palette.svelte';
  import QuickCapture from './components/QuickCapture.svelte';
  import TabBar from './components/TabBar.svelte';
  import ContextMenu from './components/ContextMenu.svelte';
  import { ctxmenu } from './lib/ctxmenu.svelte.ts';
  import { inShell } from './lib/vault.ts';
  import { editorMenu, fieldMenu } from './lib/menus.ts';
  import { store } from './lib/store.svelte.ts';
  import ReminderBanner from './components/ReminderBanner.svelte';
  import Toast from './components/Toast.svelte';

  let drawer = $state(false);
  // Small window: the notes panel is a drawer. The menu button (or Ctrl+\) opens it; clicking away or picking a note closes it;
  // while a right-click menu of one of its notes is open it stays, and it stays after the menu is gone, until you click away.


  // the home-screen widget follows the notes: one refresh after a burst of changes, never on a timer
  $effect(() => {
    void store.mode;
    store.notes.map((n) => n.id + n.updated).join(',');
    untrack(() => { store.widgetKick(); store.remindKick(); store.applyWantOpen(); });
  });
  // the tray menu's "New note" and "Settings", and its words in the app's language
  onMount(() => {
    if (!hasTray()) return;
    let off = () => {};
    let off2 = () => {};
    void listenTray(() => void store.createNote(), () => { store.settingsOpen = true; }).then((f) => (off = f));
    void listenNotify((id) => store.openNoteFromNotice(id)).then((f) => (off2 = f));
    return () => { off(); off2(); };
  });
  $effect(() => { void store.s.lang; if (hasTray()) void trayRefresh(store.t); });
  onMount(() => {
    store.startWidgets();
    store.startReminders();
    void store.boot();
  });

  const t = store.t;

  // Android back button: close the top layer (a settings page, settings, menu, palette, sign-in) before leaving the app.
  // Each layer has one history entry: opening one adds an entry, and closing one by hand (an X, a back arrow) takes its entry
  // away again, so the next back press is not wasted on an entry that no longer means anything.
  let pushed = 0;
  let skip = 0; // entries we took away ourselves: their popstate must not close anything
  $effect(() => {
    const layers = (store.settingsOpen ? 1 : 0) + (store.settingsOpen && store.settingsPage ? 1 : 0) + (drawer ? 1 : 0) + (store.sheet ? 1 : 0) + (store.palette ? 1 : 0) + (store.mode === 'login' ? 1 : 0);
    while (pushed < layers) history.pushState({ qm: ++pushed }, '');
    while (pushed > layers) { pushed--; skip++; history.back(); }
  });
  $effect(() => { if (!store.settingsOpen) store.settingsPage = false; });
  onMount(() => {
    const onPop = () => {
      if (skip > 0) { skip--; return; }
      if (pushed > 0) pushed--;
      if (store.sheet) store.sheet = null;
      else if (store.palette) store.palette = false;
      else if (store.settingsOpen && store.settingsPage) store.settingsPage = false;
      else if (store.settingsOpen) store.settingsOpen = false;
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
  let sw: { x: number; y: number; w: number; opening: boolean; live: boolean; t: number; toc?: boolean } | null = null;
  const small = () => matchMedia('(max-width: 760px)').matches;
  const rtl = () => document.documentElement.dir === 'rtl';
  /** Is the finger on something that scrolls sideways (a board, a table, a code block), or on a field? */
  function sideways(target: EventTarget | null): boolean {
    for (let el = target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
      if (el.matches?.('input, textarea, select, .cm-widgetBuffer, .modemenu, .sheet, dialog')) return true;
      if (el.scrollWidth > el.clientWidth + 2) {
        const ox = getComputedStyle(el).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
      }
    }
    return false;
  }
  function swStart(e: TouchEvent) {
    if (!small() || e.touches.length !== 1 || store.mode === 'login' || store.mode === 'boot') return;
    const t0 = e.touches[0]!;
    // The very edge belongs to the system's back gesture, so the swipe can also start well inside the screen
    // (the outer 40% on the side where the panel lives), but not on something that scrolls sideways itself.
    const dist = rtl() ? innerWidth - t0.clientX : t0.clientX; // from the side where the panel lives
    const fromEdge = dist <= innerWidth * 0.4;
    const fromFar = innerWidth - dist <= innerWidth * 0.4; // from the other side: the contents of the note
    // on a checklist row the middle of the screen belongs to the row (swipe to tick / remove); the outer fifth on each side stays with the panels
    if (!drawer && (e.target as Element).closest?.('.ck-row') && t0.clientX > innerWidth * 0.2 && t0.clientX < innerWidth * 0.8) return;
    const busy = !!store.sheet || store.palette || store.settingsOpen || !!document.querySelector('dialog[open]');
    if (!drawer && (getSelection()?.toString() ?? '') !== '') return; // dragging a text selection is not a swipe
    const w = document.querySelector('aside')?.getBoundingClientRect().width ?? 300;
    if (drawer) {
      sw = { x: t0.clientX, y: t0.clientY, w, opening: false, live: false, t: Date.now() };
    } else if (!busy && fromEdge && !sideways(e.target)) {
      sw = { x: t0.clientX, y: t0.clientY, w, opening: true, live: false, t: Date.now() };
    } else if (!busy && fromFar && store.currentId && !sideways(e.target)) {
      sw = { x: t0.clientX, y: t0.clientY, w, opening: true, live: false, t: Date.now(), toc: true };
    }
  }
  function swMove(e: TouchEvent) {
    if (!sw) return;
    const t0 = e.touches[0]!;
    const dx = (rtl() ? -1 : 1) * (t0.clientX - sw.x);
    const dy = t0.clientY - sw.y;
    if (!sw.live) {
      if (Date.now() - sw.t > 450) { sw = null; return; } // a finger that rested first is selecting or scrolling, not swiping
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; }
      if (Math.abs(dx) < 10) return;
      if (sw.toc) {
        if (dx > 0) { sw = null; return; } // toward the panel's side from the far side: that is the contents gesture
        sw.live = true;
      } else {
        if ((sw.opening && dx < 0) || (!sw.opening && dx > 0)) { sw = null; return; }
        sw.live = true;
      }
    }
    if (sw.toc) {
      // the contents follow the finger, like the sidebar does
      store.tocProg = Math.max(0, Math.min(1, -dx / Math.min(320, innerWidth * 0.86)));
      return;
    }
    prog = Math.max(0, Math.min(1, (sw.opening ? 0 : 1) + dx / sw.w));
  }
  function swEnd(e?: TouchEvent) {
    if (sw?.toc) {
      if (sw.live && (store.tocProg ?? 0) > 0.3) store.sheet = 'toc'; // far side toward the panel's side: the note's contents
      store.tocProg = null;
      sw = null;
      return;
    }
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
{:else if store.mode === 'welcome'}
  <Welcome />
{:else if store.mode === 'login'}
  <Login />
{:else}
  <div class="shell" class:side-off={store.s.hideSide} class:zen={store.zen} class:drawer-open={drawer} class:swiping={prog !== null} style:--p={prog ?? (drawer ? 1 : 0)}>
    <Sidebar onSettings={() => (store.settingsOpen = true)} onPick={() => (drawer = false)} />
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
  {#if store.settingsOpen}
    <SettingsDialog onClose={() => (store.settingsOpen = false)} />
  {/if}
{/if}
{#if store.toolbarOpen}<ToolbarDialog />{/if}
<ReminderBanner />
<Toast />
{#if store.quickOpen}<QuickCapture />{/if}
{#if store.palette}<Palette onSettings={() => (store.settingsOpen = true)} />{/if}
<svelte:window ontouchstart={swStart} ontouchmove={swMove} ontouchend={swEnd} ontouchcancel={swEnd} oncontextmenu={onContext} onkeydown={(e) => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (latinKey(e) === 'p' || latinKey(e) === 'k') && store.mode !== 'login' && store.mode !== 'welcome' && store.mode !== 'boot') { e.preventDefault(); store.palette = !store.palette; } else if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && latinKey(e) === 'n' && store.mode !== 'login' && store.mode !== 'welcome' && store.mode !== 'boot') { e.preventDefault(); store.quickOpen = true; } else if (e.altKey && !e.ctrlKey && !e.metaKey && latinKey(e) === 'w' && store.currentId) { e.preventDefault(); store.closeTabs([store.currentId]); } else if ((e.ctrlKey || e.metaKey) && latinKey(e) === '\\' && store.mode !== 'login' && store.mode !== 'welcome') { e.preventDefault(); if (small()) drawer = !drawer; else store.toggleSide(); } else if (e.altKey && !e.ctrlKey && !e.metaKey && latinKey(e) === 'z' && store.mode !== 'login' && store.mode !== 'welcome') { e.preventDefault(); store.toggleZen(); } else if (e.key === 'Escape' && drawer && small() && !e.defaultPrevented && !ctxmenu.open && !store.palette && !document.querySelector('dialog[open]')) { drawer = false; } else if (e.key === 'Escape' && store.zen && !store.palette) { store.zen = false; } else if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); store.nextTab(e.shiftKey ? -1 : 1); } }} />
<DialogHost />
<ContextMenu />
