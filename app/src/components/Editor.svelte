<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import { findHeading, parseHeadings, splitTarget } from '../lib/headings.ts';
  import { onMount, untrack } from 'svelte';
  import { yUndoManagerKeymap } from 'y-codemirror.next';
  import { cycleHeading, insertLink, insertSnippet, insertTable, SNIPPETS, toggleLinePrefix, toggleWrap } from '../editor/commands.ts';
  import { createEditor, setTouchLabels, type Editor, type ViewMode } from '../editor/editor.ts';
  import type { TableLabels } from '../editor/tables.ts';
  import type { NoteMeta } from '../lib/server.ts';
  import { type LinkStatus, NoteSession } from '../lib/session.ts';
  import HistoryDialog from './HistoryDialog.svelte';
  import { snapshot } from '../lib/history.ts';
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
  import { immersive, onAndroid } from '../lib/vault.ts';
  import Sheet from './Sheet.svelte';
  import ShareDialog from './ShareDialog.svelte';

  let { note, onMenu }: { note: NoteMeta; onMenu: () => void } = $props();
  const t = store.t;

  let host: HTMLDivElement;

  setTouchLabels({ cut: t('cut'), copy: t('copyText'), paste: t('paste'), selectAll: t('selectAll') });

  // ---- phones: the text gets the whole screen; the bars hide while reading and come back with a tap or a scroll up
  const phone = matchMedia('(pointer: coarse) and (max-width: 760px)');
  let mobile = $state(phone.matches);
  let bars = $state(true);
  let focused = $state(false);
  let kbOpen = $state(false);
  let page: HTMLDivElement;
  // On Android the keyboard shrinks the page; with it closed the editor stays in edit mode but the bars may hide again.
  const typing = $derived(focused && (kbOpen || !onAndroid()));
  $effect(() => {
    const on = () => (mobile = phone.matches);
    phone.addEventListener('change', on);
    return () => phone.removeEventListener('change', on);
  });
  $effect(() => {
    if (!mobile) return;
    let tall = window.innerHeight;
    const size = () => {
      tall = Math.max(tall, window.innerHeight);
      kbOpen = window.innerHeight < tall - 120;
    };
    window.addEventListener('resize', size);
    return () => window.removeEventListener('resize', size);
  });
  $effect(() => {
    immersive(mobile && !bars && !typing);
  });
  $effect(() => {
    if (!editorReady) return;
    const sc = page;
    let last = sc.scrollTop;
    let startY = 0;
    let startT = 0;
    let moved = false;
    // Hide after a clear pull down the page, show after a clear pull up; never flip twice within a moment,
    // because hiding the bars changes the window size and the page can nudge itself back and forth.
    let acc = 0;
    let lastFlip = 0;
    const flip = (v: boolean) => {
      if (bars === v) return;
      const now = Date.now();
      if (now - lastFlip < 700) return;
      lastFlip = now;
      bars = v;
    };
    const onScroll = () => {
      if (showToc) tocTick++;
      if (!mobile) return;
      const y = sc.scrollTop;
      const d = y - last;
      last = y;
      if (y < 48) { acc = 0; flip(true); return; }
      if (Math.abs(d) > 120) return; // a jump from a layout change, not a finger
      acc = Math.sign(d) === Math.sign(acc) ? acc + d : d;
      if (acc > 36) { flip(false); acc = 0; }
      else if (acc < -36) { flip(true); acc = 0; }
    };
    const down = (e: TouchEvent) => { startY = e.touches[0].clientY; startT = Date.now(); moved = false; };
    const move = (e: TouchEvent) => { if (Math.abs(e.touches[0].clientY - startY) > 8) moved = true; };
    const up = () => {
      if (moved || Date.now() - startT > 350 || !mobile) return;
      if (!bars) bars = true;
      // the keyboard was put away but the editor kept its focus: a tap on the text brings it back
      else if (focused && !kbOpen && onAndroid()) {
        const v = editor.view;
        setTimeout(() => { v.contentDOM.blur(); v.focus(); }, 30);
      }
    };
    const focus = () => queueMicrotask(() => { focused = true; });
    const blur = () => queueMicrotask(() => { focused = false; bars = true; });
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
  function nextMode() {
    // on a board note the phone's mode button goes Board → List → Read → Source, so the board is one tap away
    const modes: Array<ViewMode | 'board'> = boardNote ? ['board', 'live', 'read', 'source'] : ['live', 'read', 'source'];
    setMode(modes[(modes.indexOf(mode) + 1) % modes.length]!);
  }
  let status = $state<LinkStatus>('local');
  let words = $state(0);
  // The editor is re-created for each note (see App.svelte), so the first value is all we need.
  const first = untrack(() => note);
  let title = $state(first.title);
  let sharing = $state(false);
  let help = $state(false);
  let hist = $state(false);
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
  // the title grows to as many lines as it needs, so a long one wraps instead of running off the screen
  function fit(node: HTMLTextAreaElement, _v: string) {
    const size = () => { node.style.height = 'auto'; node.style.height = node.scrollHeight + 'px'; };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(node);
    return { update: size, destroy: () => ro.disconnect() };
  }
  const toggleContents = () => { if (mobile) store.sheet = 'toc'; else setToc(!showToc); };
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
  function headings(): Array<{ pos: number; level: number; text: string }> {
    if (!editorReady) return [];
    const out: Array<{ pos: number; level: number; text: string }> = [];
    const doc = editor.view.state.doc;
    let fence = false;
    for (let i = 1; i <= doc.lines; i++) {
      const l = doc.line(i);
      if (/^\s*(```|~~~)/.test(l.text)) fence = !fence;
      const m = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l.text);
      if (m) out.push({ pos: l.from, level: m[1].length, text: m[2] });
    }
    return out;
  }
  function makeBoardNote() {
    if (liveText) applyText(liveText, makeBoard(liveText.toString(), t('boardColumns').split('|') as [string, string, string]));
    setMode('board');
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
      const all = session.ytext.toString();
      words = (all.match(/[\p{L}\p{N}]+/gu) ?? []).length;
      store.setPreview(note.id, all.slice(0, 600));
      store.touch(note.id);
      snapshot(note.id, all);
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
    setTimeout(() => { try { snapshot(note.id, session.ytext.toString()); } catch { /* closed already */ } }, 2000);
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
  onkeydown={(e) => { if (e.key === 'Escape') menu = false; else if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyB' && boardNote) { e.preventDefault(); setMode(mode === 'board' ? 'live' : 'board'); } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyO') { e.preventDefault(); toggleContents(); } }}
/>

<section class="editor-pane" class:mobile class:hide-bars={mobile && !bars && !typing} class:typing={mobile && typing}>
  <header class="topbar">
    <button class="icon side-btn" aria-label={t('sidebar')} title="{t('sidebar')} (Ctrl+\\)" onclick={() => store.toggleSide()}><Icon name="sidebar" /></button>

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

    <div class="ctl">
      <span class="status {status}" title={statusText} role="img" aria-label={statusText}><i></i></span>
      {#if readOnly}<span class="pill">{t('readOnly')}</span>{/if}
      {#if boardNote}
        <!-- a board note: Board and its text are always one tap apart; tapping the text side again steps through Live, Read, Source -->
        <div class="boardseg" role="group" aria-label={t('viewMode')}>
          <button class:on={mode === 'board'} onclick={() => setMode('board')}>{t('modeBoard')}</button>
          <button class:on={mode !== 'board'} onclick={() => { if (mode === 'board') setMode('live'); else setMode(mode === 'live' ? 'read' : mode === 'read' ? 'source' : 'live'); }}>{mode === 'read' ? t('modeRead') : mode === 'source' ? t('modeSource') : t('boardList')}</button>
        </div>
      {/if}
      <button class="ghost small modebtn" class:boardnote={boardNote} onclick={nextMode} aria-label={t('viewMode')}>{mode === 'board' ? t('modeBoard') : mode === 'read' ? t('modeRead') : mode === 'source' ? t('modeSource') : t('modeLive')}</button>
      <div class="seg" role="group" aria-label={t('viewMode')}>
        {#if boardNote}<button class:on={mode === 'board'} onclick={() => setMode('board')}>{t('modeBoard')}</button>{/if}
        <button class:on={mode === 'live'} onclick={() => setMode('live')}>{t('modeLive')}</button>
        <button class:on={mode === 'read'} onclick={() => setMode('read')}>{t('modeRead')}</button>
        <button class:on={mode === 'source'} onclick={() => setMode('source')}>{t('modeSource')}</button>
      </div>
      <button class="icon tocbtn" class:on={showToc && !mobile} aria-label={t('toc')} title="{t('toc')} · Alt+O" onclick={toggleContents}><Icon name="outline" size={18} /></button>
      {#if store.mode === 'server' && note.role === 'owner'}
        <button class="icon sharebtn" aria-label={t('share')} title={t('share')} onclick={() => (sharing = true)}><Icon name="share" size={18} /></button>
      {/if}
      <div class="menu-wrap desk">
        <button class="icon" aria-label={t('menu')} aria-expanded={menu} onclick={() => (menu = !menu)}><Icon name="more" /></button>
        {#if menu}
          <div class="menu" role="menu">
            <button role="menuitem" onclick={() => { menu = false; setToc(!showToc); }}>{t('toc')}</button>
            <button role="menuitem" onclick={() => { menu = false; hist = true; }}>{t('history')}</button>
            <button role="menuitem" onclick={() => { menu = false; store.settingsOpen = true; }}>{t('settings')}</button>
            <button role="menuitem" onclick={() => { menu = false; store.toggleZen(); }}>{t('zen')} · Alt+Z</button>
            <button role="menuitem" onclick={() => ((help = true), (menu = false))}>{t('help')} · ƒ</button>
            {#if !boardNote && !readOnly}<button role="menuitem" onclick={() => { menu = false; makeBoardNote(); }}>{t('boardUse')}</button>{/if}
            <button role="menuitem" onclick={exportMd}>{t('export')}</button>
            <button role="menuitem" class="danger" onclick={remove}>{note.role === 'owner' || store.mode === 'local' ? t('delete') : t('leave')}</button>
          </div>
        {/if}
      </div>
    </div>
  </header>

  {#if err}<p class="error banner" role="alert">{err} <button class="link" onclick={() => (err = '')}>×</button></p>{/if}

  {#if liveText && mode === 'board'}<Board ytext={liveText} {readOnly} noteId={note.id} onList={() => setMode('live')} />{/if}

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="editor-row" hidden={mode === 'board'}>
    <div class="page" bind:this={page}>
      <textarea
        class="page-title"
        rows="1"
        dir="auto"
        bind:value={title}
        use:fit={title}
        readonly={!canRename}
        aria-label={t('rename')}
        placeholder={t('untitled')}
        onblur={rename}
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLTextAreaElement).blur(); } }}
      ></textarea>
      {#if liveText && mode !== 'source' && mode !== 'board'}<Properties ytext={liveText} readOnly={readOnly || mode === 'read'} noteId={note.id} />{/if}
      <div class="cm-host" bind:this={host} onmousedown={focusEnd}></div>
    </div>
    {#if showToc && editorReady && mode !== 'board'}<Toc view={editor.view} ytext={liveText!} title={note.title} {readOnly} tick={tocTick} onClose={() => setToc(false)} />{/if}
  </div>

  <!-- phones: a floating bar instead of a fixed one -->
  <div class="float-bar" role="toolbar" aria-label={t('menu')}>
    <button class="icon" aria-label={t('menu')} onclick={onMenu}><Icon name="files" size={22} /></button>
    <button class="icon" aria-label={t('search')} onclick={() => (store.palette = true)}><Icon name="search" size={22} /></button>
    <button class="icon plus" aria-label={t('newNote')} onclick={() => store.createNote()}><Icon name="plus" size={24} /></button>
    <button class="icon tabs" aria-label={t('tabs')} onclick={() => (store.sheet = 'tabs')}><Icon name="layers" size={22} />{#if store.tabs.length > 1}<b>{store.tabs.length}</b>{/if}</button>
    <button class="icon" aria-label={t('more')} onclick={() => (store.sheet = 'more')}><Icon name="more" size={22} /></button>
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

{#if mobile && store.sheet === 'tabs'}
  <Sheet title={t('tabs')} onClose={() => (store.sheet = null)}>
    <div class="tab-grid">
      {#each store.tabs as id (id)}
        {@const n = store.notes.find((x) => x.id === id)}
        {#if n}
          <div class="tab-card" class:on={id === store.currentId} role="button" tabindex="0" onclick={() => { store.currentId = id; store.sheet = null; }} onkeydown={(e) => { if (e.key === 'Enter') { store.currentId = id; store.sheet = null; } }}>
            <b>{n.title}</b>
            <small>{n.folder || t('personal')}</small>
            <p>{store.previews[id] ?? ''}</p>
            <button class="x" aria-label={t('tabClose')} onclick={(e) => { e.stopPropagation(); store.closeTabs([id]); if (!store.tabs.length) store.sheet = null; }}><Icon name="close" size={14} /></button>
          </div>
        {/if}
      {/each}
      <button class="tab-card new" onclick={() => { store.sheet = null; store.createNote(); }}><Icon name="plus" size={26} /></button>
    </div>
  </Sheet>
{/if}

{#if mobile && store.sheet === 'toc'}
  <Sheet title={t('toc')} onClose={() => (store.sheet = null)}>
    <div class="sheet-list toc-list">
      {#each headings() as h (h.pos)}
        <button style:--lv={h.level - 1} onclick={() => { store.sheet = null; jump(h.pos); }}><span>{h.text}</span></button>
      {:else}
        <span class="muted">{t('tocEmpty')}</span>
      {/each}
    </div>
  </Sheet>
{/if}

{#if mobile && store.sheet === 'more'}
  <Sheet title={note.title} onClose={() => (store.sheet = null)}>
    <div class="sheet-list">
      <span class="muted">{t('words', { n: words })}{#if store.mode === 'server' && note.role !== 'owner'} · {t('sharedByOther', { name: note.owner })}{/if}</span>
      <button onclick={() => (store.sheet = 'toc')}><Icon name="outline" size={20} /> {t('toc')}</button>
      <button onclick={() => { loadLinks(); store.sheet = 'links'; }}><Icon name="link" size={20} /> {t('backlinks')}</button>
      {#if store.mode === 'server' && note.role === 'owner'}<button onclick={() => { store.sheet = null; sharing = true; }}><Icon name="share" size={20} /> {t('share')}</button>{/if}
      {#if !boardNote && !readOnly}<button onclick={() => { store.sheet = null; makeBoardNote(); }}><Icon name="board" size={20} /> {t('boardUse')}</button>{/if}
      <button onclick={() => { store.sheet = null; hist = true; }}><Icon name="clock" size={20} /> {t('history')}</button>
      <button onclick={() => { store.sheet = null; store.settingsOpen = true; }}><Icon name="settings" size={20} /> {t('settings')}</button>
      <button onclick={() => { store.sheet = null; help = true; }}><Icon name="fx" size={20} /> {t('help')}</button>
      <button onclick={() => { store.sheet = null; exportMd(); }}><Icon name="upload" size={20} /> {t('export')}</button>
      <button class="danger" onclick={() => { store.sheet = null; remove(); }}><Icon name="trash" size={20} /> {note.role === 'owner' || store.mode === 'local' ? t('delete') : t('leave')}</button>
    </div>
  </Sheet>
{/if}

{#if mobile && store.sheet === 'links'}
  <Sheet title={t('backlinks')} onClose={() => (store.sheet = null)}>
    <div class="sheet-list">
      {#each links as l (l.id)}
        <button onclick={() => { store.sheet = null; store.currentId = l.id; }}>{l.title}</button>
      {:else}
        <span class="muted">{t('noBacklinks')}</span>
      {/each}
    </div>
  </Sheet>
{/if}

{#if hist}
  <HistoryDialog
    id={note.id}
    current={session.ytext.toString()}
    onClose={() => (hist = false)}
    onRestore={(text) => {
      snapshot(note.id, session.ytext.toString(), true);
      const yt = session.ytext;
      yt.doc?.transact(() => { yt.delete(0, yt.length); yt.insert(0, text); });
      changed();
    }}
  />
{/if}

{#if help}
  <HelpDialog onClose={() => (help = false)} />
{/if}

{#if sharing}
  <ShareDialog {note} onClose={() => (sharing = false)} />
{/if}
