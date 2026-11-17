<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import { findHeading, parseHeadings, splitTarget } from '../lib/headings.ts';
  import { onMount, untrack } from 'svelte';
  import { yUndoManagerKeymap } from 'y-codemirror.next';
  import { cycleHeading, insertLink, insertSnippet, insertTable, SNIPPETS, toggleLinePrefix, toggleWrap } from '../editor/commands.ts';
  import { createEditor, type Editor, type ViewMode } from '../editor/editor.ts';
  import type { TableLabels } from '../editor/tables.ts';
  import type { NoteMeta } from '../lib/server.ts';
  import { type LinkStatus, NoteSession } from '../lib/session.ts';
  import { store } from '../lib/store.svelte.ts';
  import Properties from './Properties.svelte';
  import Icon from './Icon.svelte';
  import Toc from './Toc.svelte';
  import Board from './Board.svelte';
  import { EditorView } from '@codemirror/view';
  import { isBoard, makeBoard } from '../lib/kanban.ts';
  import { applyText } from '../lib/ytext.ts';
  import { confirmBox } from '../lib/dialog.svelte.ts';
  import HelpDialog from './HelpDialog.svelte';
  import { immersive } from '../lib/vault.ts';
  import ShareDialog from './ShareDialog.svelte';

  let { note, onMenu }: { note: NoteMeta; onMenu: () => void } = $props();
  const t = store.t;

  let host: HTMLDivElement;

  // ---- phones: the text gets the whole screen; the bars hide while reading and come back with a tap or a scroll up
  const phone = matchMedia('(pointer: coarse) and (max-width: 760px)');
  let mobile = $state(phone.matches);
  let bars = $state(true);
  let typing = $state(false);
  $effect(() => {
    const on = () => (mobile = phone.matches);
    phone.addEventListener('change', on);
    return () => phone.removeEventListener('change', on);
  });
  $effect(() => {
    immersive(mobile && !bars && !typing);
  });
  $effect(() => {
    if (!mobile || !editorReady) return;
    const sc = host;
    let last = sc.scrollTop;
    let startY = 0;
    let startT = 0;
    let moved = false;
    const onScroll = () => {
      const y = sc.scrollTop;
      const d = y - last;
      if (y < 48) bars = true;
      else if (d > 10) bars = false;
      else if (d < -10) bars = true;
      if (Math.abs(d) > 10) last = y;
    };
    const down = (e: TouchEvent) => { startY = e.touches[0].clientY; startT = Date.now(); moved = false; };
    const move = (e: TouchEvent) => { if (Math.abs(e.touches[0].clientY - startY) > 8) moved = true; };
    const up = () => { if (!moved && Date.now() - startT < 350 && !bars) bars = true; };
    const focus = () => { typing = true; };
    const blur = () => { typing = false; bars = true; };
    sc.addEventListener('scroll', onScroll, { passive: true });
    sc.addEventListener('touchstart', down, { passive: true });
    sc.addEventListener('touchmove', move, { passive: true });
    sc.addEventListener('touchend', up, { passive: true });
    sc.addEventListener('focusin', focus);
    sc.addEventListener('focusout', blur);
    return () => {
      sc.removeEventListener('scroll', onScroll);
      sc.removeEventListener('touchstart', down);
      sc.removeEventListener('touchmove', move);
      sc.removeEventListener('touchend', up);
      sc.removeEventListener('focusin', focus);
      sc.removeEventListener('focusout', blur);
      immersive(false);
    };
  });
  const MODES: Array<ViewMode | 'board'> = ['live', 'read', 'source'];
  function nextMode() {
    setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
  }
  let status = $state<LinkStatus>('local');
  let words = $state(0);
  // The editor is re-created for each note (see App.svelte), so the first value is all we need.
  const first = untrack(() => note);
  let title = $state(first.title);
  let sharing = $state(false);
  let help = $state(false);
  let links = $state<Array<{ id: string; title: string }>>([]);
  let showLinks = $state(false);
  let mode = $state<ViewMode | 'board'>((() => {
    try {
      const m = localStorage.getItem('qm.mode');
      return m === 'read' || m === 'source' ? m : 'live';
    } catch {
      return 'live';
    }
  })());
  function setMode(m: ViewMode | 'board') {
    mode = m;
    editor.setMode(m === 'board' ? 'live' : m);
    try {
      if (m !== 'board') localStorage.setItem('qm.mode', m);
    } catch {
      /* fine */
    }
  }
  // The contents panel (all modes): jump to, fold and rearrange sections.
  let showToc = $state((() => { try { return localStorage.getItem('qm.toc') === '1'; } catch { return false; } })());
  let tocTick = $state(0);
  const setToc = (on: boolean) => {
    showToc = on;
    try { localStorage.setItem('qm.toc', on ? '1' : '0'); } catch { /* fine */ }
  };
  const tocExt = [
    EditorView.updateListener.of((u) => { if (u.docChanged || u.selectionSet || u.transactions.some((tr) => tr.effects.length)) tocTick++; }),
    EditorView.domEventHandlers({ scroll: () => { if (showToc) tocTick++; } }),
  ];
  function jump(pos: number) {
    if (mode === 'board') setMode('live');
    queueMicrotask(() => {
      const v = editor.view;
      v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 24 }) });
      if (mode !== 'read') v.focus();
    });
  }
  let boardNote = $state(false);
  let boardSeen = false;
  let menu = $state(false);
  let err = $state('');
  let session: NoteSession;
  let liveText = $state.raw<import('yjs').Text | null>(null);
  let editor: Editor;
  let editorReady = $state(false);
  let pendingTick: (() => boolean) | null = null;
  $effect(() => {
    if (store.pendingHeading) untrack(() => pendingTick?.());
  });

  const readOnly = first.role === 'view';
  const canRename = first.role === 'owner';

  // One stable object per language, so tables are only redrawn when needed.
  const labels: TableLabels = {
    addRow: t('addRow'),
    addColumn: t('addColumn'),
    deleteRow: t('deleteRow'),
    deleteColumn: t('deleteColumn'),
    formulas: t('formulas'),
    formulasHelp: t('formulasHelp'),
    editSource: t('editSource'),
    help: t('help'),
    lang: store.lang,
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  function changed() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      words = (session.ytext.toString().match(/[\p{L}\p{N}]+/gu) ?? []).length;
      store.touch(note.id);
      if (store.vaultPath) void store.vaultPush(note.id, session.ytext.toString());
    }, 400);
  }

  onMount(() => {
    const server = store.mode === 'server' && !note.id.startsWith('tmp:');
    session = new NoteSession(
      store.storeName(note.id),
      store.s.username,
      (s) => (status = s),
      server ? store.api : undefined,
      server ? note.id : undefined,
    );
    liveText = session.ytext;
    const watchBoard = () => {
      const now = isBoard(session.ytext.toString());
      if (now && !boardNote && !boardSeen) setMode('board');
      boardNote = now;
      if (now) boardSeen = true;
    };
    session.ytext.observe(watchBoard);
    watchBoard();
    editor = createEditor({
      parent: host,
      ytext: session.ytext,
      awareness: session.awareness,
      readOnly,
      labels: () => labels,
      hint: '',
      base: {
        rows: () => store.baseRows(),
        open: (id) => (store.currentId = id),
        setProp: (id, key, type, text) => store.setNoteProp(id, key, type, text),
        canEdit: (id) => !readOnly && store.canEditRow(id),
        labels: () => ({
          empty: '',
          edit: t('baseEdit'),
          none: t('baseNone'),
          count: (n) => t('baseCount').replace('{n}', String(n)),
          cols: { title: t('colTitle'), folder: t('colFolder'), updated: t('colUpdated') },
        }),
      },
      slash: () => [
        { label: t('heading') + ' 1', keywords: 'h1 title', run: (v) => toggleLinePrefix(v, '# ') },
        { label: t('heading') + ' 2', keywords: 'h2', run: (v) => toggleLinePrefix(v, '## ') },
        { label: t('heading') + ' 3', keywords: 'h3', run: (v) => toggleLinePrefix(v, '### ') },
        { label: t('bullet'), keywords: 'list ul', run: (v) => toggleLinePrefix(v, '- ') },
        { label: t('task'), keywords: 'todo checkbox', run: (v) => toggleLinePrefix(v, '- [ ] ') },
        { label: t('quote'), keywords: 'blockquote', run: (v) => toggleLinePrefix(v, '> ') },
        { label: t('table'), run: (v) => insertTable(v) },
        { label: t('insCodeTitle'), keywords: 'code fence block', run: (v) => insertSnippet(v, SNIPPETS.codeTitle) },
        { label: t('insCallout'), keywords: 'note info warning', run: (v) => insertSnippet(v, SNIPPETS.callout) },
        { label: t('insAdmonition'), keywords: 'mkdocs !!!', run: (v) => insertSnippet(v, SNIPPETS.admonition) },
        { label: t('insCollapsible'), keywords: 'details ???', run: (v) => insertSnippet(v, SNIPPETS.collapsible) },
        { label: t('insTabs'), keywords: '===', run: (v) => insertSnippet(v, SNIPPETS.tabs) },
        { label: t('insBase'), keywords: 'base database table properties list overview', run: (v) => insertSnippet(v, '```base\nshow: tags\nsort: title\n```\n') },
        { label: t('link'), run: (v) => insertLink(v) },
        { label: t('dailyNote').replace(/.*/, new Date().toISOString().slice(0, 10)), keywords: 'date today', run: (v) => v.dispatch(v.state.replaceSelection(new Date().toISOString().slice(0, 10))) },
      ],
      mode: mode === 'board' ? 'live' : mode,
      titles: () => store.notes.map((n) => n.title).filter((x) => x !== first.title),
      openLink: (target) => {
        const { note, heading } = splitTarget(target);
        if (!note || note.toLowerCase() === first.title.toLowerCase()) {
          // a section of this very note: scroll to it
          const h = findHeading(parseHeadings(liveText?.toString() ?? ''), heading);
          if (h) jump(h.pos);
          return;
        }
        void store.openLink(target, first.id).catch((e) => (err = e instanceof Error ? e.message : String(e)));
      },
      headings: (note) => store.headingsOf(note, first.id, liveText?.toString()),
      onChange: changed,
      extra: tocExt,
      images: {
        resolve: resolveImage,
        upload: server && !readOnly ? uploadImage : undefined,
      },
    });
    editorReady = true;
    const applyPending = () => {
      const p = store.pendingHeading;
      if (!p || p.id !== note.id) return true;
      const h = findHeading(parseHeadings(session.ytext.toString()), p.heading);
      if (!h) return false;
      store.pendingHeading = null;
      jump(h.pos);
      return true;
    };
    pendingTick = applyPending;
    if (store.pendingHeading?.id === note.id) {
      let tries = 0;
      const poll = setInterval(() => { if (applyPending() || ++tries > 25) clearInterval(poll); }, 120);
    }
    host.addEventListener('qalamark-help', () => (help = true));
    store.touchRecent(note.id);
    const onCmd = (e: Event) => {
      const c = (e as CustomEvent<string>).detail;
      if (c.startsWith('mode:')) setMode(c.slice(5) as ViewMode);
      else if (c === 'outline') setToc(!showToc);
    };
    window.addEventListener('qalamark-cmd', onCmd);
    changed();
    void loadLinks();
    return () => {
      window.removeEventListener('qalamark-cmd', onCmd);
      clearTimeout(timer);
      editor.destroy();
      session.destroy();
    };
  });

  // Pictures live on the server, in the owner's _images folder; they need the sign-in header,
  // so they are fetched and shown from a local blob.
  const blobs = new Map<string, Promise<string | null>>();
  function resolveImage(url: string): Promise<string | null> {
    if (/^(https?:|data:|blob:)/i.test(url)) return Promise.resolve(url);
    const m = /^(?:\.\/)?(?:\.\.\/)*_images\/([A-Za-z0-9._-]+)$/.exec(url);
    if (!m || store.mode !== 'server') return Promise.resolve(null);
    const key = `${note.owner}/${m[1]}`;
    let p = blobs.get(key);
    if (!p) {
      p = store.api
        .imageBlob(note.owner, m[1]!)
        .then((b) => URL.createObjectURL(b))
        .catch(() => null);
      blobs.set(key, p);
    }
    return p;
  }
  async function uploadImage(blob: Blob): Promise<string | null> {
    try {
      return (await store.api.uploadImage(blob)).markdown;
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  async function loadLinks() {
    try {
      links = await store.backlinks(first.id);
    } catch {
      links = [];
    }
  }

  const history = (key: string) => () => {
    yUndoManagerKeymap.find((b) => b.key === key)?.run?.(editor.view);
    editor.view.focus();
  };

  /** Click anywhere in the empty page area to start typing there (at the end), like other editors. */
  function focusEnd(e: MouseEvent) {
    const el = e.target as HTMLElement;
    if (el.closest('.cm-content') || el.closest('.qt') || readOnly || mode === 'read') return;
    e.preventDefault();
    const v = editor.view;
    const doc = v.state.doc;
    const last = doc.line(doc.lines).text.trim();
    // Never leave the cursor stuck right behind a table.
    if (last.startsWith('|') || last.endsWith('-->')) {
      v.dispatch({ changes: { from: doc.length, insert: '\n' }, selection: { anchor: doc.length + 1 } });
    } else v.dispatch({ selection: { anchor: doc.length } });
    v.focus();
  }

  let insMenu = $state(false);
  let picInput: HTMLInputElement;
  const snippet = (s: string) => {
    insMenu = false;
    insertSnippet(editor.view, s);
  };
  async function pickPicture() {
    const f = picInput.files?.[0];
    picInput.value = '';
    if (!f) return;
    const md = await uploadImage(f);
    if (md) insertSnippet(editor.view, md + '\n');
  }
  const run = (f: (v: typeof editor.view) => boolean) => () => f(editor.view);

  async function rename() {
    if (!canRename || title.trim() === note.title) return;
    try {
      await store.renameNote(note.id, title);
      title = store.current?.title ?? title;
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
      title = note.title;
    }
  }

  async function exportMd() {
    menu = false;
    const text = await store.exportText(note.id, session.ytext.toString());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    a.download = `${note.title}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function remove() {
    menu = false;
    const ask = store.mode === 'server' ? t('deleteAsk') : t('deleteAskLocal');
    if (!(await confirmBox(note.role === 'owner' || store.mode === 'local' ? ask : t('leave') + '?'))) return;
    try {
      await store.deleteNote(note.id);
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
  }

  const statusText = $derived(
    status === 'online' ? t('online') : status === 'connecting' ? t('connecting') : status === 'offline' ? t('offline') : t('saved'),
  );
</script>

<svelte:window
  onpointerdown={(e) => {
    if (menu && !(e.target as Element).closest('.menu-wrap')) menu = false;
    if (showLinks && !(e.target as Element).closest('.links-wrap')) showLinks = false;
    if (insMenu && !(e.target as Element).closest('.relative')) insMenu = false;
  }}
  onkeydown={(e) => e.key === 'Escape' && (menu = false)}
/>

<section class="editor-pane" class:mobile class:hide-bars={mobile && !bars && !typing} class:typing={mobile && typing}>
  <header class="topbar">
    <button class="icon menu-btn" aria-label={t('menu')} onclick={onMenu}><Icon name="menu" /></button>
    <input
      class="title"
      bind:value={title}
      readonly={!canRename}
      aria-label={t('rename')}
      onblur={rename}
      onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
    />
    <button class="ghost small modebtn" onclick={nextMode} aria-label={t('viewMode')}>{mode === 'read' ? t('modeRead') : mode === 'source' ? t('modeSource') : t('modeLive')}</button>
    <span class="status {status}" title={statusText}><i></i><span class="label">{statusText}</span></span>
    <div class="seg" role="group" aria-label={t('viewMode')}>
      {#if boardNote}<button class:on={mode === 'board'} onclick={() => setMode('board')}>{t('modeBoard')}</button>{/if}
      <button class:on={mode === 'live'} onclick={() => setMode('live')}>{t('modeLive')}</button>
      <button class:on={mode === 'read'} onclick={() => setMode('read')}>{t('modeRead')}</button>
      <button class:on={mode === 'source'} onclick={() => setMode('source')}>{t('modeSource')}</button>
    </div>
    {#if readOnly}<span class="pill">{t('readOnly')}</span>{/if}
    {#if store.mode === 'server' && note.role === 'owner'}
      <button class="ghost small" onclick={() => (sharing = true)}><Icon name="share" size={16} /><span class="lbl">{t('share')}</span></button>
    {/if}
    <div class="menu-wrap">
      <button class="icon" aria-label={t('menu')} aria-expanded={menu} onclick={() => (menu = !menu)}><Icon name="more" /></button>
      {#if menu}
        <div class="menu" role="menu">
          <button role="menuitem" onclick={() => ((help = true), (menu = false))}>{t('help')} · ƒ</button>
          {#if !boardNote && !readOnly}<button role="menuitem" onclick={() => { menu = false; if (liveText) applyText(liveText, makeBoard(liveText.toString(), t('boardColumns').split('|') as [string, string, string])); setMode('board'); }}>{t('boardUse')}</button>{/if}
          <button role="menuitem" onclick={exportMd}>{t('export')}</button>
          <button role="menuitem" class="danger" onclick={remove}>{note.role === 'owner' || store.mode === 'local' ? t('delete') : t('leave')}</button>
        </div>
      {/if}
    </div>
  </header>

  {#if !readOnly && mode !== 'read' && mode !== 'board'}
    <div class="toolbar" role="toolbar">
      <button title="{t('bold')} (Ctrl+B)" onclick={run((v) => toggleWrap(v, '**'))}><Icon name="bold" /></button>
      <button title="{t('italic')} (Ctrl+I)" onclick={run((v) => toggleWrap(v, '*'))}><Icon name="italic" /></button>
      <button title={t('strike')} onclick={run((v) => toggleWrap(v, '~~'))}><Icon name="strike" /></button>
      <button title={t('code')} onclick={run((v) => toggleWrap(v, '`'))}><Icon name="code" /></button>
      <span class="sep"></span>
      <button title={t('heading')} onclick={run(cycleHeading)}><Icon name="heading" /></button>
      <button title={t('bullet')} onclick={run((v) => toggleLinePrefix(v, '- '))}><Icon name="list" /></button>
      <button title={t('task')} onclick={run((v) => toggleLinePrefix(v, '- [ ] '))}><Icon name="check" /></button>
      <button title={t('quote')} onclick={run((v) => toggleLinePrefix(v, '> '))}><Icon name="quote" /></button>
      <span class="sep"></span>
      <button title={t('link')} onclick={run(insertLink)}><Icon name="link" /></button>
      <button title={t('table')} onclick={run(insertTable)}><Icon name="table" /></button>
      <span class="relative">
        <button title={t('insert')} aria-haspopup="menu" onclick={(e) => { e.stopPropagation(); insMenu = !insMenu; }}><Icon name="plus" /><Icon name="chevron" size={12} /></button>
        {#if insMenu}
          <div class="menu insmenu" role="menu">
            <button onclick={() => snippet(SNIPPETS.callout)}>{t('insCallout')}</button>
            <button onclick={() => snippet(SNIPPETS.admonition)}>{t('insAdmonition')}</button>
            <button onclick={() => snippet(SNIPPETS.collapsible)}>{t('insCollapsible')}</button>
            <button onclick={() => snippet(SNIPPETS.tabs)}>{t('insTabs')}</button>
            <button onclick={() => snippet(SNIPPETS.codeTitle)}>{t('insCodeTitle')}</button>
            {#if store.mode === 'server'}
              <button onclick={() => { insMenu = false; picInput.click(); }}>{t('insPicture')}</button>
            {/if}
          </div>
        {/if}
      </span>
      <input bind:this={picInput} type="file" accept="image/*" hidden onchange={pickPicture} />
      <button title={t('help')} onclick={() => (help = true)}><Icon name="fx" /></button>
    </div>
  {/if}

  {#if err}<p class="error banner" role="alert">{err} <button class="link" onclick={() => (err = '')}>×</button></p>{/if}

  {#if liveText && mode === 'board'}<Board ytext={liveText} {readOnly} noteId={note.id} />{/if}
  {#if liveText && mode !== 'source' && mode !== 'board'}<Properties ytext={liveText} readOnly={readOnly || mode === 'read'} noteId={note.id} />{/if}

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="editor-row" hidden={mode === 'board'}>
    <div class="cm-host" bind:this={host} onmousedown={focusEnd}></div>
    {#if showToc && editorReady && mode !== 'board'}<Toc view={editor.view} ytext={liveText!} title={note.title} {readOnly} tick={tocTick} onClose={() => setToc(false)} />{/if}
  </div>

  <div class="float-bar" role="toolbar" aria-label={t('menu')}>
    <button class="icon" aria-label={t('menu')} onclick={onMenu}><Icon name="menu" size={22} /></button>
    <button class="icon" aria-label={t('search')} onclick={() => (store.palette = true)}><Icon name="search" size={22} /></button>
    <button class="icon" aria-label={t('newNote')} onclick={() => store.createNote()}><Icon name="plus" size={22} /></button>
    <button class="icon" aria-label={t('toc')} aria-pressed={showToc} onclick={() => setToc(!showToc)}><Icon name="outline" size={22} /></button>
  </div>

  <footer class="statusbar">
    <span>{t('words', { n: words })}</span>
    <span class="grow"></span>
    <button class="link" onclick={() => setToc(!showToc)} aria-pressed={showToc} title={t('toc')}><Icon name="outline" size={14} /> {t('toc')}</button>
    <div class="links-wrap">
      <button class="link" onclick={() => ((showLinks = !showLinks), loadLinks())} aria-expanded={showLinks}>↩ {t('backlinks')} ({links.length})</button>
      {#if showLinks}
        <div class="menu up">
          {#each links as l (l.id)}
            <button onclick={() => ((store.currentId = l.id), (showLinks = false))}>{l.title}</button>
          {:else}
            <span class="muted pad">{t('noBacklinks')}</span>
          {/each}
        </div>
      {/if}
    </div>
    {#if store.mode === 'server' && note.role !== 'owner'}<span>· {t('sharedByOther', { name: note.owner })}</span>{/if}
  </footer>
</section>

{#if help}
  <HelpDialog onClose={() => (help = false)} />
{/if}

{#if sharing}
  <ShareDialog {note} onClose={() => (sharing = false)} />
{/if}
