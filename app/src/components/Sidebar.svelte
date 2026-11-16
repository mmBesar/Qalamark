<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { store } from '../lib/store.svelte.ts';
  import type { NoteMeta } from '../lib/server.ts';
  import { BUILT_IN } from '../lib/templates.ts';
  import { ctxmenu, type MenuItem } from '../lib/ctxmenu.svelte.ts';
  import { inShell, onAndroid, vault } from '../lib/vault.ts';

  let { onSettings, onPick }: { onSettings: () => void; onPick: () => void } = $props();
  const t = store.t;
  const byTitle = (a: NoteMeta, b: NoteMeta) => a.title.toLowerCase().localeCompare(b.title.toLowerCase());
  let query = $state('');
  type View = 'files' | 'search' | 'recent';
  let view = $state<View>('files');
  let hits = $state<Array<{ id: string; title: string; snippet: string }>>([]);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const needle = query.trim();
    clearTimeout(searchTimer);
    hits = [];
    if (needle.length < 2) return;
    searchTimer = setTimeout(async () => {
      const r = await store.searchText(needle);
      if (query.trim() === needle) hits = r;
    }, 220);
  });
  const titleHits = $derived(store.notes.filter((n) => n.title.toLowerCase().includes(query.trim().toLowerCase())).sort(byTitle));
  const textHits = $derived(hits.filter((h) => !titleHits.some((n) => n.id === h.id)));
  const recentNotes = $derived(store.recent.map((id) => store.notes.find((n) => n.id === id)).filter((n): n is NoteMeta => !!n));
  let searchBox = $state<HTMLInputElement>();
  $effect(() => { if (view === 'search') searchBox?.focus(); });
  const showTemplates = (e: MouseEvent) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    ctxmenu.show(document.documentElement.dir === 'rtl' ? r.right : r.left, r.bottom + 4, [
      ...BUILT_IN.map((b) => ({ label: b.name[store.lang], icon: 'note', run: () => fromTemplate('builtin:' + b.id) })),
      ...store.templates.map((n) => ({ label: n.title, icon: 'star', run: () => fromTemplate('note:' + n.id) })),
      ...(store.current ? [{ sep: true }, { label: t('saveAsTemplate'), icon: 'copy', run: saveTemplate }] : []),
    ]);
  };
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

  // ---- the context menu of a note or folder (right-click, or press and hold on touch) ----
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const canReveal = () => inShell() && !onAndroid() && !!store.vaultPath;

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      fail(e);
    }
  };

  /** Folders a note or folder may be moved into (a folder never into itself). */
  const targets = (exclude = '') => ['', ...allFolders.filter((f) => !exclude || (f !== exclude && !f.startsWith(exclude + '/')))];

  const noteMenu = (n: NoteMeta): MenuItem[] => [
    { label: t('openNote'), icon: 'note', run: () => pick(n.id) },
    { sep: true },
    ...(mine(n) ? [{ label: t('rename'), icon: 'edit', run: () => ask(t('rename'), n.title, (v) => store.renameNote(n.id, v)) }] : []),
    { label: t('copy'), icon: 'copy', run: () => run(() => store.copyNote(n.id)) },
    ...(mine(n)
      ? [{ label: t('moveTo'), icon: 'folder-open', children: targets().map((f) => ({ label: f || t('topLevel'), icon: 'folder', disabled: f === (n.folder ?? ''), run: () => run(() => store.moveNote(n.id, f)) })) }]
      : []),
    ...(canReveal() && n.vp ? [{ label: t('revealInFiles'), icon: 'external', run: () => vault.reveal(n.vp!) }] : []),
    { sep: true },
    { label: t('delete'), icon: 'trash', danger: true, run: () => run(() => store.deleteNote(n.id)) },
  ];

  const folderMenu = (path: string): MenuItem[] => [
    { label: t('newNoteHere'), icon: 'plus', run: async () => { if (!open.includes(path)) toggle(path); await create(path); } },
    { label: t('newSubfolder'), icon: 'folder-plus', run: () => ask(t('folderName'), '', (v) => store.createFolder(path + '/' + v)) },
    { sep: true },
    { label: t('rename'), icon: 'edit', run: () => ask(t('rename'), path, (v) => store.renameFolder(path, v)) },
    { label: t('moveTo'), icon: 'folder-open', children: targets(path).map((f) => ({ label: f || t('topLevel'), icon: 'folder', disabled: f === parentOf(path), run: () => run(() => store.renameFolder(path, (f ? f + '/' : '') + nameOf(path))) })) },
    ...(canReveal() ? [{ label: t('revealInFiles'), icon: 'external', run: () => vault.reveal(path) }] : []),
    { sep: true },
    { label: open.includes(path) ? t('collapseAll') : t('expandAll'), icon: open.includes(path) ? 'collapse' : 'expand', run: () => (open.includes(path) ? collapseAll() : expandAll()) },
    { label: t('delete'), icon: 'trash', danger: true, run: () => run(() => store.deleteFolder(path)) },
  ];

  const emptyMenu = (): MenuItem[] => [
    { label: t('newNote'), icon: 'plus', run: () => create() },
    { label: t('newFolder'), icon: 'folder-plus', run: () => ask(t('folderName'), '', (v) => store.createFolder(v)) },
    { sep: true },
    { label: t('collapseAll'), icon: 'collapse', run: collapseAll },
    { label: t('expandAll'), icon: 'expand', run: expandAll },
    ...(canReveal() ? [{ label: t('revealInFiles'), icon: 'external', run: () => vault.reveal('') }] : []),
  ];

  function collapseAll() {
    open = [];
    saveOpen();
  }
  function expandAll() {
    open = [...allFolders, ...(store.notes.some((n) => !mine(n)) ? [SHARED] : [])];
    saveOpen();
  }

  type Target = { kind: 'note'; note: NoteMeta } | { kind: 'folder'; path: string } | { kind: 'empty' };
  const itemsFor = (tg: Target) => (tg.kind === 'note' ? noteMenu(tg.note) : tg.kind === 'folder' ? (tg.path === SHARED ? [] : folderMenu(tg.path)) : emptyMenu());

  /** Right-click, the menu key, or Shift+F10. */
  function onContext(e: MouseEvent, tg: Target) {
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(holdTimer);
    if (held) return; // the long press already opened it
    held = true; // Android raises this event itself on a long press: the tap that follows must not open the note
    setTimeout(() => (held = false), 450);
    let x = e.clientX;
    let y = e.clientY;
    if (!x && !y) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      x = r.left + 28;
      y = r.bottom;
    }
    ctxmenu.show(x, y, itemsFor(tg));
  }

  // Touch: press and hold for about half a second (a small wiggle is fine, a swipe cancels).
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let held = false;
  let from = { x: 0, y: 0 };
  function holdStart(e: PointerEvent, tg: Target) {
    if (e.pointerType === 'mouse') return;
    held = false;
    from = { x: e.clientX, y: e.clientY };
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      held = true;
      navigator.vibrate?.(12);
      ctxmenu.show(from.x, from.y, itemsFor(tg));
    }, 460);
  }
  function holdMove(e: PointerEvent) {
    if (Math.abs(e.clientX - from.x) > 10 || Math.abs(e.clientY - from.y) > 10) clearTimeout(holdTimer);
  }
  function holdEnd() {
    clearTimeout(holdTimer);
    setTimeout(() => (held = false), 400);
  }
  /** The tap that ends a long press must not also open the note or fold the folder. */
  const tap = (fn: () => void) => () => { if (!held) fn(); };

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

<aside>
  <header>
    <img src="./icon.svg" alt="" width="28" height="28" />
    <strong>{t('appName')}</strong>
    <span class="grow"></span>
    <button class="icon" aria-label={t('settings')} title={t('settings')} onclick={onSettings}><Icon name="settings" /></button>
  </header>

  <nav class="views" role="tablist">
    <button role="tab" class:on={view === 'files'} aria-selected={view === 'files'} title={t('viewFiles')} aria-label={t('viewFiles')} onclick={() => (view = 'files')}><Icon name="files" size={17} /></button>
    <button role="tab" class:on={view === 'search'} aria-selected={view === 'search'} title={t('viewSearch')} aria-label={t('viewSearch')} onclick={() => (view = 'search')}><Icon name="search" size={17} /></button>
    <button role="tab" class:on={view === 'recent'} aria-selected={view === 'recent'} title={t('viewRecent')} aria-label={t('viewRecent')} onclick={() => (view = 'recent')}><Icon name="clock" size={17} /></button>
  </nav>

  {#if view === 'files'}
    <div class="actions">
      <button class="icon" title={t('newNote')} aria-label={t('newNote')} onclick={() => create()}><Icon name="plus" size={18} /></button>
      <button class="icon" title={t('newFromTemplate')} aria-label={t('newFromTemplate')} onclick={showTemplates}><Icon name="layers" /></button>
      <button class="icon" title={t('newFolder')} aria-label={t('newFolder')} onclick={() => ask(t('folderName'), '', (v) => store.createFolder(v))}><Icon name="folder-plus" /></button>
      <button class="icon" type="button" title={t('dailyNote')} aria-label={t('dailyNote')} onclick={() => void store.openDaily()}><Icon name="calendar" /></button>
      <button class="icon" title={t('import')} aria-label={t('import')} onclick={() => fileInput.click()}><Icon name="upload" /></button>
      <span class="grow"></span>
      <button class="icon" title={open.length ? t('collapseAll') : t('expandAll')} aria-label={open.length ? t('collapseAll') : t('expandAll')} onclick={() => (open.length ? collapseAll() : expandAll())}><Icon name={open.length ? 'collapse' : 'expand'} /></button>
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

    <ul
      class="tree"
      class:dropping={dropOn === ''}
      ondragover={(e) => { e.preventDefault(); dropOn = ''; }}
      ondragleave={() => (dropOn = null)}
      ondrop={(e) => drop(e, '')}
      oncontextmenu={(e) => onContext(e, { kind: 'empty' })}
    >
      {#each rows as r (r.kind === 'folder' ? 'f:' + r.path : 'n:' + r.note.id)}
        {#if r.kind === 'folder'}
          <li class="row folder" style:--depth={r.depth} class:dropping={dropOn === r.path}>
            <button
              class="main"
              onclick={tap(() => toggle(r.path))}
              oncontextmenu={(e) => onContext(e, { kind: 'folder', path: r.path })}
              onpointerdown={(e) => holdStart(e, { kind: 'folder', path: r.path })}
              onpointermove={holdMove}
              onpointerup={holdEnd}
              onpointercancel={holdEnd}
              ondragover={(e) => { e.preventDefault(); e.stopPropagation(); dropOn = r.path; }}
              ondrop={(e) => drop(e, r.path)}
            >
              <span class="caret" class:open={open.includes(r.path)}><Icon name="chevron-right" size={14} /></span>
              <span class="fico"><Icon name={open.includes(r.path) ? 'folder-open' : 'folder'} size={16} /></span>
              <span class="title">{r.path === SHARED ? t('sharedWithMe') : nameOf(r.path)}</span>
            </button>
          </li>
        {:else}
          {@const n = r.note}
          <li class="row" style:--depth={r.depth}>
            <button
              class="main"
              class:active={n.id === store.currentId}
              draggable={coarse ? 'false' : 'true'}
              ondragstart={(e) => dragStart(e, n.id)}
              onclick={tap(() => pick(n.id))}
              oncontextmenu={(e) => onContext(e, { kind: 'note', note: n })}
              onpointerdown={(e) => holdStart(e, { kind: 'note', note: n })}
              onpointermove={holdMove}
              onpointerup={holdEnd}
              onpointercancel={holdEnd}
            >
              <span class="nicon"><Icon name="note" size={15} /></span><span class="title">{n.title}</span>
              {#if n.role !== 'owner' && store.mode === 'server'}
                <small class="badge" title={t('sharedByOther', { name: n.owner })}>{n.owner}{n.role === 'view' ? ' · 👁' : ''}</small>
              {/if}
            </button>
          </li>
        {/if}
      {:else}
        <li class="muted pad">{t('noNotes')}</li>
      {/each}
    </ul>
  {:else if view === 'search'}
    <input class="search" type="search" placeholder={t('searchHint')} bind:value={query} bind:this={searchBox} aria-label={t('search')} />
    <ul class="results">
      {#each titleHits as n (n.id)}
        <li>
          <button class:active={n.id === store.currentId} onclick={() => pick(n.id)}>
            <span class="nicon"><Icon name="note" size={15} /></span>
            <span class="title">{n.title}</span>
            {#if n.folder}<small class="badge" dir="ltr">{n.folder}</small>{/if}
          </button>
        </li>
      {/each}
      {#each textHits as h (h.id)}
        <li>
          <button class="hit" class:active={h.id === store.currentId} onclick={() => pick(h.id)}>
            <span class="title">{h.title}</span>
            <small class="snip">{h.snippet}</small>
          </button>
        </li>
      {/each}
      {#if query.trim() && !titleHits.length && !textHits.length}
        <li class="muted pad">{t('noResults')}</li>
      {/if}
    </ul>
  {:else}
    <ul class="results">
      {#each recentNotes as n (n.id)}
        <li>
          <button class:active={n.id === store.currentId} onclick={() => pick(n.id)}>
            <span class="nicon"><Icon name="note" size={15} /></span>
            <span class="title">{n.title}</span>
            {#if n.folder}<small class="badge" dir="ltr">{n.folder}</small>{/if}
          </button>
        </li>
      {:else}
        <li class="muted pad">{t('noRecent')}</li>
      {/each}
    </ul>
  {/if}

  <footer>
    {#if store.mode === 'server'}
      <span class="dot" class:off={!store.serverReachable}></span>
      <span>{store.s.username}</span>
      {#if !store.serverReachable}<small class="muted">· {t('offline')}</small>{/if}
      {#if store.pending}<small class="muted pendingbadge" title={t('waitingSync', { n: store.pending })}>· {t('waitingSync', { n: store.pending })}</small>{/if}
    {:else}
      <span class="dot local"></span><span>{t('localMode')}</span>
      <span class="grow"></span>
      <button class="link" onclick={() => store.showLogin()}>{t('signIn')}</button>
    {/if}
  </footer>
</aside>
