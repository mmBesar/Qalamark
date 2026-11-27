<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import { findHeading, parseHeadings, splitTarget } from '../lib/headings.ts';
  import { onMount, untrack } from 'svelte';
  import { yUndoManagerKeymap } from 'y-codemirror.next';
  import { insertCode } from '../editor/codeflow.ts';
  import { setCodeLabels } from '../editor/codebadge.ts';
  import { cycleHeading, insertLink, insertRule, insertSnippet, insertTable, insertWikilink, shiftLines, SNIPPETS, toggleLinePrefix, toggleWrap } from '../editor/commands.ts';
  import { pop } from '../lib/motion.ts';
  import { BUILT_IN } from '../lib/templates.ts';
  import { cleanToolbar, TOOLS, type ToolId } from '../lib/toolbar.ts';
  import { TABLE_EVENT, type TableApi } from '../editor/tables.ts';
  import { createEditor, setTouchLabels, type Editor, type ViewMode } from '../editor/editor.ts';
  import type { TableLabels } from '../editor/tables.ts';
  import type { NoteMeta } from '../lib/server.ts';
  import { type LinkStatus, NoteSession } from '../lib/session.ts';
  import HistoryDialog from './HistoryDialog.svelte';
  import { snapshot } from '../lib/history.ts';
  import { miniBlocks } from '../lib/miniview.ts';
  import PdfDialog from './PdfDialog.svelte';
  import { loadLocalImage, saveLocalImage } from '../lib/localimages.ts';
  import { store } from '../lib/store.svelte.ts';
  import { latinKey } from '../lib/keys.ts';
  import Properties from './Properties.svelte';
  import Icon from './Icon.svelte';
  import Toc from './Toc.svelte';
  import Board from './Board.svelte';
  import { EditorView } from '@codemirror/view';
  import { isBoard, makeBoard } from '../lib/kanban.ts';
  import { isChecklist, makeChecklist } from '../lib/checklist.ts';
  import Checklist from './Checklist.svelte';
  import { applyText } from '../lib/ytext.ts';
  import { confirmBox } from '../lib/dialog.svelte.ts';
  import HelpDialog from './HelpDialog.svelte';
  import { immersive, onAndroid } from '../lib/vault.ts';
  import Sheet from './Sheet.svelte';
  import ShareDialog from './ShareDialog.svelte';

  let { note, onMenu }: { note: NoteMeta; onMenu: () => void } = $props();
  const t = store.t;

  let host: HTMLDivElement;

  setCodeLabels({ language: t('codeLanguage'), none: t('codePlain'), other: t('codeUse') });
  setTouchLabels({ cut: t('cut'), copy: t('copyText'), paste: t('paste'), selectAll: t('selectAll') });

  // ---- phones: the text gets the whole screen; the bars hide while reading and come back with a tap or a scroll up
  const phone = matchMedia('(pointer: coarse) and (max-width: 760px)');
  let mobile = $state(phone.matches);
  let bars = $state(true);
  let focused = $state(false);
  let kbOpen = $state(false);
  let page: HTMLDivElement;
  // On Android the keyboard shrinks the page; with it closed the editor stays in edit mode but the bars may hide again.
  // a tap on the tool bar takes the focus away for a moment (and the keyboard with it); the bar must stay until the tap has landed
  let holdBar = $state(false);
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  const holdTools = () => { holdBar = true; clearTimeout(holdTimer); holdTimer = setTimeout(() => (holdBar = false), 900); };
  const typing = $derived((focused && (kbOpen || !onAndroid())) || holdBar);
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
    const modes: Array<ViewMode | 'board'> = viewNote ? ['board', 'live', 'read', 'source'] : ['live', 'read', 'source'];
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
  let modeMenu = $state(false);
  // Ctrl+A selects the whole note whatever has the focus. The page shows only the lines near the screen, so the browser's own
  // select-all (when the focus is outside the text, or in Reading mode) would take only those; this selects the note itself.
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || latinKey(e) !== 'a') return;
      if (!editorReady || mode === 'board') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, dialog, [contenteditable="true"]:not(.cm-content)')) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      const v = editor.view;
      v.focus();
      v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
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
  let taskNote = $state(false);
  let boardSeen = false;
  /** A note with its own view (board or checklist): that view sits beside Live / Read / Source. */
  const viewNote = $derived(boardNote || taskNote);
  const viewName = $derived(taskNote ? t('modeTasks') : t('modeBoard'));
  function makeChecklistNote() {
    if (liveText) applyText(liveText, makeChecklist(liveText.toString()));
    setMode('board');
  }
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

  // The table you are in: its tools show in the toolbar (set when a cell gets focus, cleared a moment after you leave).
  let tbl = $state<TableApi | null>(null);
  let tblOff: ReturnType<typeof setTimeout> | undefined;
  function onTable(e: Event) {
    const d = (e as CustomEvent<TableApi | null>).detail;
    clearTimeout(tblOff);
    if (d) tbl = d;
    else tblOff = setTimeout(() => (tbl = null), 160); // a table is redrawn on every edit: do not flicker
  }

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
    host.addEventListener(TABLE_EVENT, onTable);
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
      const txt = session.ytext.toString();
      const board = isBoard(txt);
      const now = board || isChecklist(txt);
      if (now && !viewNote && !boardSeen) queueMicrotask(() => setMode('board')); // not inside the editor's own update
      boardNote = board;
      taskNote = !board && now;
      if (now) boardSeen = true;
      else if (mode === 'board') queueMicrotask(() => setMode('live')); // the view property was taken away
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
        { label: t('insCode'), keywords: 'code fence block ```', run: (v) => insertCode(v) },
        ...(['bash', 'python', 'javascript', 'json', 'yaml', 'html', 'css', 'sql', 'nix', 'rust'] as const).map((l) => ({ label: t('insCode') + ' · ' + l, keywords: 'code ' + l, run: (v: EditorView) => insertCode(v, l) })),
        { label: t('insCodeTitle'), keywords: 'code fence block title file', run: (v) => insertSnippet(v, SNIPPETS.codeTitle) },
        { label: t('numbered'), keywords: 'ordered ol 1.', run: (v) => toggleLinePrefix(v, '1. ') },
        { label: t('insRule'), keywords: 'divider line hr ---', run: (v) => insertRule(v) },
        { label: t('insCallout'), keywords: 'note info warning', run: (v) => insertSnippet(v, SNIPPETS.callout) },
        { label: t('insCollapsible'), keywords: 'details ???', run: (v) => insertSnippet(v, SNIPPETS.collapsible) },
        { label: t('insTabs'), keywords: '===', run: (v) => insertSnippet(v, SNIPPETS.tabs) },
        { label: t('insBase'), keywords: 'base database table properties list overview', run: (v) => insertSnippet(v, '```base\nshow: tags\nsort: title\n```\n') },
        { label: t('link'), run: (v) => insertLink(v) },
        { label: t('dailyNote').replace(/.*/, new Date().toISOString().slice(0, 10)), keywords: 'date today', run: (v) => v.dispatch(v.state.replaceSelection(new Date().toISOString().slice(0, 10))) },
      ],
      mode: mode === 'board' ? 'live' : mode,
      titles: () => store.notes.map((n) => n.title).filter((x) => x !== first.title),
      places: () => store.notes.filter((n) => n.id !== first.id).map((n) => ({ title: n.title, folder: n.folder ?? '' })),
      folder: () => store.notes.find((n) => n.id === first.id)?.folder ?? first.folder ?? '',
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
        upload: !readOnly ? uploadImage : undefined,
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
    if (!m) return Promise.resolve(null);
    if (store.mode !== 'server') {
      // no server: the picture is on this device
      const key = `local/${m[1]}`;
      let lp = blobs.get(key);
      if (!lp) { lp = loadLocalImage(m[1]!).then((b) => (b ? URL.createObjectURL(b) : null)); blobs.set(key, lp); }
      return lp;
    }
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
      if (store.mode !== 'server') return await saveLocalImage(blob);
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

  // a mouse wheel over the bar scrolls it sideways
  function sideWheel(node: HTMLElement) {
    const on = (e: WheelEvent) => {
      if (node.scrollWidth <= node.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      node.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    node.addEventListener('wheel', on, { passive: false });
    return { destroy: () => node.removeEventListener('wheel', on) };
  }
  const toolList = $derived(cleanToolbar(store.s.toolbar));
  const tool = (id: ToolId) => {
    const v = editor.view;
    switch (id) {
      case 'undo': return history('Mod-z')();
      case 'redo': return history('Mod-y')();
      case 'bold': return run((x) => toggleWrap(x, '**'))();
      case 'italic': return run((x) => toggleWrap(x, '*'))();
      case 'strike': return run((x) => toggleWrap(x, '~~'))();
      case 'code': return run((x) => toggleWrap(x, '`'))();
      case 'heading': return run(cycleHeading)();
      case 'bullet': return run((x) => toggleLinePrefix(x, '- '))();
      case 'numbered': return run((x) => toggleLinePrefix(x, '1. '))();
      case 'task': return run((x) => toggleLinePrefix(x, '- [ ] '))();
      case 'quote': return run((x) => toggleLinePrefix(x, '> '))();
      case 'indentMore': return run((x) => shiftLines(x, 1))();
      case 'indentLess': return run((x) => shiftLines(x, -1))();
      case 'link': return run(insertLink)();
      case 'wikilink': return run(insertWikilink)();
      case 'table': return run(insertTable)();
      case 'codeBlock': return insertSnippet(v, SNIPPETS.codeBlock);
      case 'rule': return run(insertRule)();
      case 'help': help = true;
    }
  };
  // the insert menu is fixed to the screen: the bar scrolls sideways and would cut a menu that hangs from it
  let insPos = $state<{ left: number; top?: number; bottom?: number }>({ left: 0 });
  function openInsert(e: MouseEvent) {
    e.stopPropagation();
    if (insMenu) { insMenu = false; return; }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, innerWidth - 232));
    insPos = r.top > innerHeight / 2 ? { left, bottom: innerHeight - r.top + 6 } : { left, top: r.bottom + 6 };
    insMenu = true;
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
  const run = (f: (v: typeof editor.view) => boolean) => () => { f(editor.view); editor.view.focus(); };

  // the tab cards show the notes as they are now: read each open note when the cards open
  async function refreshThumbs() {
    for (const id of store.tabs) {
      if (id === note.id) continue; // this one is kept up to date by the editor itself
      const text = await store.exportText(id).catch(() => '');
      if (text) store.setPreview(id, text);
    }
  }
  $effect(() => { if (mobile && store.sheet === 'tabs') void refreshThumbs(); });
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

  let pdf = $state<{ text: string } | null>(null);
  async function openPdf() {
    menu = false;
    pdf = { text: await store.exportText(note.id, session.ytext.toString()) };
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
  // The contents drawer: open (0–1) follows the finger, or the open/closed state; it is kept mounted while it slides out.
  const dwW = () => Math.min(320, innerWidth * 0.86);
  let dwLive = $state(false), dwProg = $state<number | null>(null);
  let entered = $state(false); // a freshly mounted drawer starts shut for one frame, so it slides in
  const tp = $derived(dwProg ?? store.tocProg ?? (store.sheet === 'toc' && entered ? 1 : 0));
  $effect(() => {
    if (store.tocProg !== null || dwLive) { entered = true; return; }
    if (store.sheet !== 'toc') { entered = false; return; }
    if (entered || !tocMounted) return;
    requestAnimationFrame(() => requestAnimationFrame(() => (entered = true)));
  });
  let tocMounted = $state(false);
  let tocTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (store.sheet === 'toc' || store.tocProg !== null || dwLive) { clearTimeout(tocTimer); tocMounted = true; }
    else { clearTimeout(tocTimer); tocTimer = setTimeout(() => (tocMounted = false), 320); }
  });
  let dwX = 0, dwY = 0;
  function drawerStart(e: TouchEvent) { dwX = e.touches[0]!.clientX; dwY = e.touches[0]!.clientY; dwLive = false; dwProg = null; }
  function drawerMove(e: TouchEvent) {
    const t0 = e.touches[0]!;
    const dx = (document.documentElement.dir === 'rtl' ? -1 : 1) * (t0.clientX - dwX);
    if (!dwLive) {
      if (dx > 12 && dx > Math.abs(t0.clientY - dwY) * 1.5) dwLive = true;
      else return;
    }
    dwProg = Math.max(0, Math.min(1, 1 - dx / dwW()));
  }
  function drawerEnd() {
    if (dwLive) {
      const close = (dwProg ?? 1) < 0.65;
      dwLive = false;
      dwProg = null;
      if (close) store.sheet = null;
    }
  }
  // New note: a tap makes an empty one; press and hold (or the row in the menu) offers the templates.
  let plusTimer: ReturnType<typeof setTimeout> | undefined;
  let plusLong = false;
  function plusDown() { plusLong = false; clearTimeout(plusTimer); plusTimer = setTimeout(() => { plusLong = true; navigator.vibrate?.(10); store.sheet = 'templates'; }, 420); }
  function plusCancel() { clearTimeout(plusTimer); }
  function plusClick() { if (plusLong) { plusLong = false; return; } void store.createNote(); }
  async function useTemplate(source: string) {
    store.sheet = null;
    try { await store.newFromTemplate(source); } catch (e) { store.message = e instanceof Error ? e.message : String(e); }
  }

  // Swipe up on the bottom bar: the menu comes up under the finger, and settles open or goes back down.
  let barY = 0, barX = 0, barLive = false, barAnim = 0;
  const SHEET_H = 380;
  function tween(from: number, to: number, done: () => void) {
    cancelAnimationFrame(barAnim);
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 240);
      const e = 1 - Math.pow(1 - k, 3);
      store.sheetDrag = from + (to - from) * e;
      if (k < 1) barAnim = requestAnimationFrame(step);
      else done();
    };
    barAnim = requestAnimationFrame(step);
  }
  function barStart(e: TouchEvent) { barY = e.touches[0]!.clientY; barX = e.touches[0]!.clientX; barLive = false; }
  function barMove(e: TouchEvent) {
    const t0 = e.touches[0]!;
    const up = barY - t0.clientY;
    if (!barLive) {
      if (up > 12 && up > Math.abs(t0.clientX - barX) * 1.2 && !store.sheet) { barLive = true; cancelAnimationFrame(barAnim); store.sheet = 'more'; }
      else return;
    }
    store.sheetDrag = Math.max(0, Math.min(1, up / SHEET_H));
  }
  function barEnd() {
    if (!barLive) return;
    barLive = false;
    const p = store.sheetDrag ?? 0;
    if (p > 0.2) tween(p, 1, () => (store.sheetDrag = null));
    else tween(p, 0, () => { store.sheetDrag = null; store.sheet = null; });
  }
</script>

<svelte:window
  onpointerdown={(e) => {
    if (menu && !(e.target as Element).closest('.menu-wrap')) menu = false;
    if (showLinks && !(e.target as Element).closest('.links-wrap')) showLinks = false;
    if (insMenu && !(e.target as Element).closest('.insmenu, .toolbar')) insMenu = false;
  }}
  onkeydown={(e) => { if (e.key === 'Escape') menu = false; else if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyB' && viewNote) { e.preventDefault(); setMode(mode === 'board' ? 'live' : 'board'); } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyO') { e.preventDefault(); toggleContents(); } }}
/>

<section class="editor-pane" class:mobile class:hide-bars={mobile && !bars && !typing} class:typing={mobile && typing}>
  <header class="topbar">
    <button class="icon side-btn" aria-label={t('sidebar')} title="{t('sidebar')} (Ctrl+\\)" onclick={() => (matchMedia('(max-width: 760px)').matches ? onMenu() : store.toggleSide())}><Icon name="sidebar" /></button>

    {#if !readOnly && mode !== 'read' && mode !== 'board'}
      <div class="toolbar" role="toolbar" onpointerdown={holdTools} onmousedown={(e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); }}>
        <div class="tb-scroll" use:sideWheel>
          <div class="tb-table" class:idle={!tbl || tbl.readOnly} role="group" aria-label={t('table')}>
            <button disabled={!tbl || tbl.readOnly} title={t('addRow')} aria-label={t('addRow')} onclick={() => tbl?.addRow()}><Icon name="row-add" /></button>
            <button disabled={!tbl || tbl.readOnly} title={t('addColumn')} aria-label={t('addColumn')} onclick={() => tbl?.addColumn()}><Icon name="col-add" /></button>
            <button disabled={!tbl || tbl.readOnly} title={t('deleteRow')} aria-label={t('deleteRow')} onclick={() => tbl?.deleteRow()}><Icon name="row-del" /></button>
            <button disabled={!tbl || tbl.readOnly} title={t('deleteColumn')} aria-label={t('deleteColumn')} onclick={() => tbl?.deleteColumn()}><Icon name="col-del" /></button>
            <button disabled={!tbl || tbl.readOnly} title={t('alignColumn')} aria-label={t('alignColumn')} onclick={() => tbl?.align()}><Icon name="text-align" /></button>
            <button class="fx" class:bad={tbl?.problems} disabled={!tbl || tbl.readOnly} title={t('formulas')} aria-label={t('formulas')} onclick={() => tbl?.formulas()}>ƒ</button>
          </div>
        {#each toolList as id, i (i + id)}
          {#if id === 'sep'}
            <span class="sep"></span>
          {:else if id === 'insert'}
            <button title={t('insert')} aria-haspopup="menu" aria-expanded={insMenu} onclick={openInsert}><Icon name="plus" /><Icon name="chevron" size={12} /></button>
          {:else}
            {@const d = TOOLS.find((x) => x.id === id)}
            {#if d}<button title={t(d.label as never) + (d.key ? ' (' + d.key + ')' : '')} aria-label={t(d.label as never)} onclick={() => tool(id as ToolId)}><Icon name={d.icon} /></button>{/if}
          {/if}
        {/each}
        </div>
        <button class="tb-edit" title={t('toolbarEdit')} aria-label={t('toolbarEdit')} onclick={() => (store.toolbarOpen = true)}><Icon name="sliders" /></button>
        <input bind:this={picInput} type="file" accept="image/*" hidden onchange={pickPicture} />
      </div>
    {/if}

    <div class="ctl">
      <span class="status {status}" title={statusText} role="img" aria-label={statusText}><i></i></span>
      {#if readOnly}<span class="pill">{t('readOnly')}</span>{/if}
      {#if viewNote}
        <!-- a board or checklist note: Board and its text are always one tap apart; tapping the text side again steps through Live, Read, Source -->
        <div class="boardseg" role="group" aria-label={t('viewMode')}>
          <button class:on={mode === 'board'} onclick={() => setMode('board')}>{viewName}</button>
          <button class:on={mode !== 'board'} aria-haspopup="menu" aria-expanded={modeMenu} onclick={() => { if (mode === 'board') setMode('live'); else modeMenu = !modeMenu; }}>{mode === 'read' ? t('modeRead') : mode === 'source' ? t('modeSource') : mode === 'live' ? t('modeLive') : t('boardList')}{#if mode !== 'board'} ▾{/if}</button>
          {#if modeMenu}
            <div class="modemenu" role="menu" transition:pop|global>
              {#each [['live', t('modeLive')], ['read', t('modeRead')], ['source', t('modeSource')]] as [m, label]}
                <button role="menuitem" class:on={mode === m} onclick={() => { modeMenu = false; setMode(m as ViewMode); }}>{label}</button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
      <button class="ghost small modebtn" class:boardnote={viewNote} onclick={nextMode} aria-label={t('viewMode')}>{mode === 'board' ? viewName : mode === 'read' ? t('modeRead') : mode === 'source' ? t('modeSource') : t('modeLive')}</button>
      <div class="seg" role="group" aria-label={t('viewMode')}>
        {#if viewNote}<button class:on={mode === 'board'} onclick={() => setMode('board')}>{viewName}</button>{/if}
        <button class:on={mode === 'live'} onclick={() => setMode('live')}>{t('modeLive')}</button>
        <button class:on={mode === 'read'} onclick={() => setMode('read')}>{t('modeRead')}</button>
        <button class:on={mode === 'source'} onclick={() => setMode('source')}>{t('modeSource')}</button>
      </div>
      <button class="icon tocbtn" class:on={showToc && !mobile} aria-label={t('toc')} title="{t('toc')} · Alt+O" onclick={toggleContents}><Icon name="toc" size={18} /></button>
      {#if store.mode === 'server' && note.role === 'owner'}
        <button class="icon sharebtn" aria-label={t('share')} title={t('share')} onclick={() => (sharing = true)}><Icon name="share" size={18} /></button>
      {/if}
      <div class="menu-wrap desk">
        <button class="icon" aria-label={t('menu')} aria-expanded={menu} onclick={() => (menu = !menu)}><Icon name="more" /></button>
        {#if menu}
          <div class="menu" role="menu" transition:pop|global>
            <button role="menuitem" onclick={() => { menu = false; setToc(!showToc); }}>{t('toc')}</button>
            <button role="menuitem" onclick={() => { menu = false; hist = true; }}>{t('history')}</button>
            <button role="menuitem" onclick={() => { menu = false; store.settingsOpen = true; }}>{t('settings')}</button>
            <button role="menuitem" onclick={() => { menu = false; store.toggleZen(); }}>{t('zen')} · Alt+Z</button>
            <button role="menuitem" onclick={() => ((help = true), (menu = false))}>{t('help')} · ƒ</button>
            {#if !viewNote && !readOnly}<button role="menuitem" onclick={() => { menu = false; makeBoardNote(); }}>{t('boardUse')}</button><button role="menuitem" onclick={() => { menu = false; makeChecklistNote(); }}>{t('checklistUse')}</button>{/if}
            <button role="menuitem" onclick={openPdf}>{t('pdfExport')}</button>
            <button role="menuitem" onclick={exportMd}>{t('export')}</button>
            <button role="menuitem" class="danger" onclick={remove}>{note.role === 'owner' || store.mode === 'local' ? t('delete') : t('leave')}</button>
          </div>
        {/if}
      </div>
    </div>
  </header>
  {#if insMenu}
    <div class="menu insmenu" role="menu" transition:pop|global onpointerdown={holdTools} onmousedown={(e) => e.preventDefault()} style:left={insPos.left + 'px'} style:top={insPos.top != null ? insPos.top + 'px' : undefined} style:bottom={insPos.bottom != null ? insPos.bottom + 'px' : undefined}>
      <button onclick={() => snippet(SNIPPETS.callout)}>{t('insCallout')}</button>
      <button onclick={() => snippet(SNIPPETS.collapsible)}>{t('insCollapsible')}</button>
      <button onclick={() => snippet(SNIPPETS.tabs)}>{t('insTabs')}</button>
      <button onclick={() => snippet(SNIPPETS.codeTitle)}>{t('insCodeTitle')}</button>
      <button onclick={() => snippet(SNIPPETS.codeBlock)}>{t('insCodeBlock')}</button>
      <button onclick={() => { insMenu = false; run(insertRule)(); }}>{t('insRule')}</button>
      {#if store.mode === 'server'}
        <button onclick={() => { insMenu = false; picInput.click(); }}>{t('insPicture')}</button>
      {/if}
    </div>
  {/if}

  {#if err}<p class="error banner" role="alert">{err} <button class="link" onclick={() => (err = '')}>×</button></p>{/if}

  {#if liveText && mode === 'board' && taskNote}<Checklist ytext={liveText} {readOnly} noteId={note.id} onText={() => setMode('live')} />{:else if liveText && mode === 'board'}<Board ytext={liveText} {readOnly} noteId={note.id} onList={() => setMode('live')} />{/if}

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

  <!-- phones: a floating button for the side panel (the swipe from the left works too) -->
  <button class="side-fab" aria-label={t('menu')} title={t('menu')} onclick={onMenu}><Icon name="sidebar" size={20} /></button>

  <!-- phones: a floating bar instead of a fixed one -->
  <div class="float-bar" role="toolbar" aria-label={t('menu')} ontouchstart={barStart} ontouchmove={barMove} ontouchend={barEnd} ontouchcancel={barEnd}>
    <button class="icon" aria-label={t('menu')} onclick={onMenu}><Icon name="files" size={22} /></button>
    <button class="icon" aria-label={t('search')} onclick={() => (store.palette = true)}><Icon name="search" size={22} /></button>
    <button class="icon plus" aria-label={t('newNote')} title={t('newFromTemplate')} onpointerdown={plusDown} onpointerup={plusCancel} onpointerleave={plusCancel} onpointercancel={plusCancel} oncontextmenu={(e) => e.preventDefault()} onclick={plusClick}><Icon name="plus" size={24} /></button>
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
        <div class="menu up" transition:pop|global>
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
          <div class="tab-card" dir="auto" class:on={id === store.currentId} role="button" tabindex="0" onclick={() => { store.currentId = id; store.sheet = null; }} onkeydown={(e) => { if (e.key === 'Enter') { store.currentId = id; store.sheet = null; } }}>
            <b>{n.title}</b>
            <small>{n.folder || t('personal')}</small>
            <div class="tab-thumb" dir="auto" aria-hidden="true">
              {#each miniBlocks(store.previews[id] ?? '') as b, bi (bi)}
                {#if b.t === 'h'}<div class={'mv-h mv-h' + Math.min(b.level, 3)} dir="auto">{b.text}</div>
                {:else if b.t === 'li'}<div class="mv-li" dir="auto" style:margin-inline-start={b.depth * 0.7 + 'em'}><span class="mv-mark" class:box={b.task} class:done={b.task === 'done'}>{b.task ? (b.task === 'done' ? '✓' : '') : b.num ? b.num + '.' : '•'}</span><span class:mv-struck={b.task === 'done'}>{b.text}</span></div>
                {:else if b.t === 'quote'}<div class="mv-quote" dir="auto">{b.text}</div>
                {:else if b.t === 'code'}<pre class="mv-code" dir="ltr">{b.text}</pre>
                {:else if b.t === 'table'}<table class="mv-table"><tbody>{#each b.rows as row, ri (ri)}<tr>{#each row as c, ci (ci)}<td dir="auto">{c}</td>{/each}</tr>{/each}</tbody></table>
                {:else if b.t === 'img'}<div class="mv-img">🖼 {b.text}</div>
                {:else if b.t === 'hr'}<hr class="mv-hr" />
                {:else}<div class="mv-p" dir="auto">{b.text}</div>{/if}
              {/each}
            </div>
            <button class="x" aria-label={t('tabClose')} onclick={(e) => { e.stopPropagation(); store.closeTabs([id]); if (!store.tabs.length) store.sheet = null; }}><Icon name="close" size={14} /></button>
          </div>
        {/if}
      {/each}
      <button class="tab-card new" onclick={() => { store.sheet = null; store.createNote(); }}><Icon name="plus" size={26} /></button>
    </div>
  </Sheet>
{/if}

{#if mobile && tocMounted && editorReady && mode !== 'board'}
  <!-- the contents slide in from the right (from the left in Arabic), following the finger like the sidebar does -->
  <div class="toc-drawer" class:open={tp > 0} class:dragging={store.tocProg !== null || dwLive} style:--tp={tp} role="presentation" ontouchstart={drawerStart} ontouchmove={drawerMove} ontouchend={drawerEnd} ontouchcancel={drawerEnd}>
    <button class="toc-scrim" aria-label={t('close')} tabindex={tp > 0 ? 0 : -1} onclick={() => (store.sheet = null)}></button>
    <Toc view={editor.view} ytext={liveText!} title={note.title} {readOnly} tick={tocTick} onClose={() => (store.sheet = null)} onGo={() => (store.sheet = null)} />
  </div>
{/if}

{#if mobile && store.sheet === 'templates'}
  <Sheet title={t('newFromTemplate')} onClose={() => (store.sheet = null)}>
    <div class="sheet-list">
      <button onclick={() => { store.sheet = null; store.quickOpen = true; }}><Icon name="bolt" size={20} /> {t('quickNote')}</button>
      <button onclick={() => { store.sheet = null; void store.createNote(); }}><Icon name="note" size={20} /> {t('newNote')}</button>
      {#each BUILT_IN as b (b.id)}
        <button onclick={() => useTemplate('builtin:' + b.id)}><Icon name={b.id.includes('check') || b.id.includes('shopping') ? 'check' : b.id.includes('board') ? 'board' : 'note'} size={20} /> {b.name[store.lang]}</button>
      {/each}
      {#each store.templates as n (n.id)}
        <button onclick={() => useTemplate('note:' + n.id)}><Icon name="star" size={20} /> {n.title}</button>
      {/each}
    </div>
  </Sheet>
{/if}

{#if mobile && store.sheet === 'more'}
  <Sheet title={note.title} onClose={() => (store.sheet = null)}>
    <div class="sheet-list">
      <button onclick={() => (store.sheet = 'templates')}><Icon name="plus" size={20} /> {t('newFromTemplate')}</button>
      <span class="muted">{t('words', { n: words })}{#if store.mode === 'server' && note.role !== 'owner'} · {t('sharedByOther', { name: note.owner })}{/if}</span>
      <button onclick={() => (store.sheet = 'toc')}><Icon name="outline" size={20} /> {t('toc')}</button>
      <button onclick={() => { loadLinks(); store.sheet = 'links'; }}><Icon name="link" size={20} /> {t('backlinks')}</button>
      {#if store.mode === 'server' && note.role === 'owner'}<button onclick={() => { store.sheet = null; sharing = true; }}><Icon name="share" size={20} /> {t('share')}</button>{/if}
      {#if !viewNote && !readOnly}<button onclick={() => { store.sheet = null; makeBoardNote(); }}><Icon name="board" size={20} /> {t('boardUse')}</button><button onclick={() => { store.sheet = null; makeChecklistNote(); }}><Icon name="check" size={20} /> {t('checklistUse')}</button>{/if}
      <button onclick={() => { store.sheet = null; hist = true; }}><Icon name="clock" size={20} /> {t('history')}</button>
      <button onclick={() => { store.sheet = null; store.settingsOpen = true; }}><Icon name="settings" size={20} /> {t('settings')}</button>
      <button onclick={() => { store.sheet = null; help = true; }}><Icon name="fx" size={20} /> {t('help')}</button>
      <button onclick={() => { store.sheet = null; void openPdf(); }}><Icon name="pdf" size={20} /> {t('pdfExport')}</button>
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

{#if pdf}
  <PdfDialog title={note.title} file={note.title + '.md'} id={note.id} text={pdf.text} resolve={resolveImage} onClose={() => (pdf = null)} />
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
