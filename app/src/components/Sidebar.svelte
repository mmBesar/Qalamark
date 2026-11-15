<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { store } from '../lib/store.svelte.ts';
  import type { NoteMeta } from '../lib/server.ts';
  import { BUILT_IN } from '../lib/templates.ts';

  let { onSettings, onPick }: { onSettings: () => void; onPick: () => void } = $props();
  const t = store.t;
  let query = $state('');
  let fileInput: HTMLInputElement;

  const OPEN_KEY = 'qm.open';
  const SHARED = '@shared';
  const readOpen = (): string[] => {
    try {
      return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]');
    } catch {
      return [];
    }
  };
  let open = $state<string[]>(readOpen());
  const saveOpen = () => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(open));
    } catch {
      /* fine without it */
    }
  };
  const toggle = (path: string) => {
    open = open.includes(path) ? open.filter((p) => p !== path) : [...open, path];
    saveOpen();
  };

  // Keep the folders around the current note open.
  $effect(() => {
    const folder = store.current?.folder ?? '';
    if (!folder || store.current?.role !== 'owner') return;
    const parts = folder.split('/');
    const need = parts.map((_, i) => parts.slice(0, i + 1).join('/')).filter((p) => !open.includes(p));
    if (need.length) {
      open = [...open, ...need];
      saveOpen();
    }
  });

  const mine = (n: NoteMeta) => n.role === 'owner' || store.mode !== 'server';
  const byTitle = (a: NoteMeta, b: NoteMeta) => a.title.toLowerCase().localeCompare(b.title.toLowerCase());
  const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

  type Row = { kind: 'folder'; path: string; depth: number } | { kind: 'note'; note: NoteMeta; depth: number };

  const allFolders = $derived.by(() => {
    const set = new Set<string>();
    const add = (path: string) => {
      const parts = path.split('/').filter(Boolean);
      parts.forEach((_, i) => set.add(parts.slice(0, i + 1).join('/')));
    };
    store.folders.forEach(add);
    store.notes.filter(mine).forEach((n) => add(n.folder ?? ''));
    return [...set].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  });

  const rows = $derived.by((): Row[] => {
    const out: Row[] = [];
    const own = store.notes.filter(mine);
    const walk = (parent: string, depth: number) => {
      for (const f of allFolders.filter((x) => parentOf(x) === parent)) {
        out.push({ kind: 'folder', path: f, depth });
        if (open.includes(f)) {
          walk(f, depth + 1);
          own.filter((n) => (n.folder ?? '') === f).sort(byTitle).forEach((note) => out.push({ kind: 'note', note, depth: depth + 1 }));
        }
      }
    };
    walk('', 0);
    own.filter((n) => (n.folder ?? '') === '').sort(byTitle).forEach((note) => out.push({ kind: 'note', note, depth: 0 }));
    const shared = store.notes.filter((n) => !mine(n)).sort(byTitle);
    if (shared.length) {
      out.push({ kind: 'folder', path: SHARED, depth: 0 });
      if (open.includes(SHARED)) shared.forEach((note) => out.push({ kind: 'note', note, depth: 1 }));
    }
    return out;
  });

  const found = $derived(
    store.notes.filter((n) => n.title.toLowerCase().includes(query.trim().toLowerCase())).sort(byTitle),
  );

  function pick(id: string) {
    store.currentId = id;
    onPick();
  }

  const fail = (e: unknown) => (store.message = e instanceof Error ? e.message : String(e));

  async function create(folder = '') {
    try {
      await store.createNote('', '', folder);
      onPick();
    } catch (e) {
      fail(e);
    }
  }

  async function imported() {
    if (fileInput.files?.length) await store.importFiles(fileInput.files);
    fileInput.value = '';
  }

  // ---- the little name box (prompt() does not work in every app shell) ----
  let asking = $state<{ label: string; value: string; done: (v: string) => Promise<void> } | null>(null);
  const ask = (label: string, value: string, done: (v: string) => Promise<void>) => {
    menu = null;
    asking = { label, value, done };
  };
  async function submitAsk(e: Event) {
    e.preventDefault();
    if (!asking) return;
    const { value, done } = asking;
    asking = null;
    try {
      await done(value);
    } catch (err) {
      fail(err);
    }
  }

  let tmpl = $state(false);
  async function fromTemplate(source: string) {
    tmpl = false;
    try {
      await store.newFromTemplate(source);
      onPick();
    } catch (e) {
      fail(e);
    }
  }
  async function saveTemplate() {
    tmpl = false;
    if (store.currentId) await store.saveAsTemplate(store.currentId).catch(fail);
  }

  // ---- the "..." menu of a note or folder ----
  let menu = $state<{ kind: 'note' | 'folder'; key: string; step: 'main' | 'move' } | null>(null);
  const openMenu = (e: Event, kind: 'note' | 'folder', key: string) => {
    e.stopPropagation();
    menu = menu && menu.key === key ? null : { kind, key, step: 'main' };
  };

  const run = async (fn: () => Promise<unknown>) => {
    menu = null;
    try {
      await fn();
    } catch (e) {
      fail(e);
    }
  };

  /** Folders a note or folder may be moved into (a folder never into itself). */
  const targets = (exclude = '') => ['', ...allFolders.filter((f) => !exclude || (f !== exclude && !f.startsWith(exclude + '/')))];

  // ---- drag a note onto a folder ----
  let dropOn = $state<string | null>(null);
  const dragStart = (e: DragEvent, id: string) => e.dataTransfer?.setData('text/qalamark-note', id);
  async function drop(e: DragEvent, folder: string) {
    e.preventDefault();
    e.stopPropagation();
    dropOn = null;
    const id = e.dataTransfer?.getData('text/qalamark-note');
    if (id && folder !== SHARED) await run(() => store.moveNote(id, folder));
  }
</script>

<svelte:window onclick={() => { menu = null; tmpl = false; }} />

<aside>
  <header>
    <img src="./icon.svg" alt="" width="28" height="28" />
    <strong>{t('appName')}</strong>
    <span class="grow"></span>
    <button class="icon" aria-label={t('settings')} title={t('settings')} onclick={onSettings}><Icon name="settings" /></button>
  </header>

  <div class="actions">
    <button class="primary" title={t('newNote')} aria-label={t('newNote')} onclick={() => create()}><Icon name="plus" size={18} /></button>
    <span class="relative">
      <button class="icon" title={t('newFromTemplate')} aria-label={t('newFromTemplate')} onclick={(e) => { e.stopPropagation(); tmpl = !tmpl; }}><Icon name="chevron" size={16} /></button>
      {#if tmpl}
        <div class="menu" role="menu">
          {#each BUILT_IN as b (b.id)}
            <button onclick={() => fromTemplate('builtin:' + b.id)}>{b.name[store.lang]}</button>
          {/each}
          {#each store.templates as n (n.id)}
            <button onclick={() => fromTemplate('note:' + n.id)}>★ {n.title}</button>
          {/each}
          {#if store.current}
            <button onclick={saveTemplate}>{t('saveAsTemplate')}</button>
          {/if}
          <small class="muted pad">{t('templatesNone')}</small>
        </div>
      {/if}
    </span>
    <button class="icon" title={t('newFolder')} aria-label={t('newFolder')} onclick={() => ask(t('folderName'), '', (v) => store.createFolder(v))}><Icon name="folder-plus" /></button>
    <button class="icon" type="button" title={t('dailyNote')} aria-label={t('dailyNote')} onclick={() => void store.openDaily()}><Icon name="calendar" /></button>
        <button class="icon" title={t('import')} aria-label={t('import')} onclick={() => fileInput.click()}><Icon name="upload" /></button>
    <input bind:this={fileInput} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple hidden onchange={imported} />
  </div>

  {#if asking}
    <form class="askbox" onsubmit={submitAsk}>
      <!-- svelte-ignore a11y_autofocus -->
      <input autofocus bind:value={asking.value} placeholder={asking.label} aria-label={asking.label} />
      <button class="primary small" type="submit">OK</button>
      <button class="ghost small" type="button" aria-label="Cancel" onclick={() => (asking = null)}><Icon name="close" size={14} /></button>
    </form>
  {/if}

  <input class="search" type="search" placeholder={t('search')} bind:value={query} aria-label={t('search')} />

  {#if query.trim()}
    <ul>
      {#each found as n (n.id)}
        <li>
          <button class:active={n.id === store.currentId} onclick={() => pick(n.id)}>
            <span class="title">{n.title}</span>
            {#if n.folder}<small class="badge" dir="ltr">{n.folder}</small>{/if}
          </button>
        </li>
      {:else}
        <li class="muted pad">{t('noResults')}</li>
      {/each}
    </ul>
  {:else}
    <ul class:dropping={dropOn === ''} ondragover={(e) => { e.preventDefault(); dropOn = ''; }} ondragleave={() => (dropOn = null)} ondrop={(e) => drop(e, '')}>
      {#each rows as r (r.kind === 'folder' ? 'f:' + r.path : 'n:' + r.note.id)}
        {#if r.kind === 'folder'}
          <li class="row folder" style:--depth={r.depth} class:dropping={dropOn === r.path}>
            <button
              class="main"
              onclick={() => toggle(r.path)}
              ondragover={(e) => { e.preventDefault(); e.stopPropagation(); dropOn = r.path; }}
              ondrop={(e) => drop(e, r.path)}
            >
              <span class="caret" class:open={open.includes(r.path)}><Icon name="chevron-right" size={14} /></span>
              <span class="fico"><Icon name="folder" size={16} /></span>
              <span class="title">{r.path === SHARED ? t('sharedWithMe') : nameOf(r.path)}</span>
            </button>
            {#if r.path !== SHARED}
              <button class="dots" aria-label={t('menu')} onclick={(e) => openMenu(e, 'folder', r.path)}><Icon name="more" size={16} /></button>
              {#if menu?.key === r.path}
                <div class="menu" role="menu">
                  <button onclick={() => run(async () => { if (!open.includes(r.path)) toggle(r.path); await create(r.path); })}>{t('newNoteHere')}</button>
                  <button onclick={() => ask(t('folderName'), '', (v) => store.createFolder(r.path + '/' + v))}>{t('newSubfolder')}</button>
                  <button onclick={() => ask(t('rename'), r.path, (v) => store.renameFolder(r.path, v))}>{t('rename')}</button>
                  {#if menu.step === 'main'}
                    <button onclick={(e) => { e.stopPropagation(); if (menu) menu.step = 'move'; }}>{t('moveTo')}</button>
                  {:else}
                    {#each targets(r.path) as f (f)}
                      <button class="target" onclick={() => run(() => store.renameFolder(r.path, (f ? f + '/' : '') + nameOf(r.path)))} disabled={f === parentOf(r.path)}>{f || t('topLevel')}</button>
                    {/each}
                  {/if}
                  <button class="danger" onclick={() => run(() => store.deleteFolder(r.path))}>{t('delete')}</button>
                </div>
              {/if}
            {/if}
          </li>
        {:else}
          {@const n = r.note}
          <li class="row" style:--depth={r.depth}>
            <button class="main" class:active={n.id === store.currentId} draggable="true" ondragstart={(e) => dragStart(e, n.id)} onclick={() => pick(n.id)}>
              <span class="title">{n.title}</span>
              {#if n.role !== 'owner' && store.mode === 'server'}
                <small class="badge" title={t('sharedByOther', { name: n.owner })}>{n.owner}{n.role === 'view' ? ' · 👁' : ''}</small>
              {/if}
            </button>
            <button class="dots" aria-label={t('menu')} onclick={(e) => openMenu(e, 'note', n.id)}><Icon name="more" size={16} /></button>
            {#if menu?.key === n.id}
              <div class="menu" role="menu">
                {#if menu.step === 'main'}
                  {#if mine(n)}<button onclick={() => ask(t('rename'), n.title, (v) => store.renameNote(n.id, v))}>{t('rename')}</button>{/if}
                  <button onclick={() => run(() => store.copyNote(n.id))}>{t('copy')}</button>
                  {#if mine(n)}<button onclick={(e) => { e.stopPropagation(); if (menu) menu.step = 'move'; }}>{t('moveTo')}</button>{/if}
                  <button class="danger" onclick={() => run(() => store.deleteNote(n.id))}>{t('delete')}</button>
                {:else}
                  {#each targets() as f (f)}
                    <button class="target" disabled={f === (n.folder ?? '')} onclick={() => run(() => store.moveNote(n.id, f))}>{f || t('topLevel')}</button>
                  {/each}
                {/if}
              </div>
            {/if}
          </li>
        {/if}
      {:else}
        <li class="muted pad">{t('noNotes')}</li>
      {/each}
    </ul>
  {/if}

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
