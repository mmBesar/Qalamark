<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { cycleHeading, insertLink, insertTable, toggleLinePrefix, toggleWrap } from '../editor/commands.ts';
  import { createEditor, type Editor } from '../editor/editor.ts';
  import type { TableLabels } from '../editor/tables.ts';
  import type { NoteMeta } from '../lib/server.ts';
  import { type LinkStatus, NoteSession } from '../lib/session.ts';
  import { store } from '../lib/store.svelte.ts';
  import ShareDialog from './ShareDialog.svelte';

  let { note, onMenu }: { note: NoteMeta; onMenu: () => void } = $props();
  const t = store.t;

  let host: HTMLDivElement;
  let status = $state<LinkStatus>('local');
  let words = $state(0);
  // The editor is re-created for each note (see App.svelte), so the first value is all we need.
  const first = untrack(() => note);
  let title = $state(first.title);
  let sharing = $state(false);
  let menu = $state(false);
  let err = $state('');
  let session: NoteSession;
  let editor: Editor;

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
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  function changed() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      words = (session.ytext.toString().match(/[\p{L}\p{N}]+/gu) ?? []).length;
      store.touch(note.id);
    }, 400);
  }

  onMount(() => {
    const server = store.mode === 'server';
    session = new NoteSession(
      store.storeName(note.id),
      store.s.username,
      (s) => (status = s),
      server ? store.api : undefined,
      server ? note.id : undefined,
    );
    editor = createEditor({
      parent: host,
      ytext: session.ytext,
      awareness: session.awareness,
      readOnly,
      labels: () => labels,
      hint: '',
      onChange: changed,
    });
    changed();
    return () => {
      clearTimeout(timer);
      editor.destroy();
      session.destroy();
    };
  });

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
    if (note.role === 'owner' || store.mode === 'local' ? !confirm(ask) : !confirm(t('leave') + '?')) return;
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

<section class="editor-pane">
  <header class="topbar">
    <button class="icon menu-btn" aria-label={t('menu')} onclick={onMenu}>☰</button>
    <input
      class="title"
      bind:value={title}
      readonly={!canRename}
      aria-label={t('rename')}
      onblur={rename}
      onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
    />
    <span class="status {status}" title={statusText}><i></i><span class="label">{statusText}</span></span>
    {#if readOnly}<span class="pill">{t('readOnly')}</span>{/if}
    {#if store.mode === 'server' && note.role === 'owner'}
      <button class="ghost small" onclick={() => (sharing = true)}>👥 {t('share')}</button>
    {/if}
    <div class="menu-wrap">
      <button class="icon" aria-label={t('menu')} aria-expanded={menu} onclick={() => (menu = !menu)}>⋯</button>
      {#if menu}
        <div class="menu" role="menu">
          <button role="menuitem" onclick={exportMd}>{t('export')}</button>
          <button role="menuitem" class="danger" onclick={remove}>{note.role === 'owner' || store.mode === 'local' ? t('delete') : t('leave')}</button>
        </div>
      {/if}
    </div>
  </header>

  {#if !readOnly}
    <div class="toolbar" role="toolbar">
      <button title="{t('bold')} (Ctrl+B)" onclick={run((v) => toggleWrap(v, '**'))}><b>B</b></button>
      <button title="{t('italic')} (Ctrl+I)" onclick={run((v) => toggleWrap(v, '*'))}><i>I</i></button>
      <button title={t('strike')} onclick={run((v) => toggleWrap(v, '~~'))}><s>S</s></button>
      <button title={t('code')} onclick={run((v) => toggleWrap(v, '`'))}>&lt;/&gt;</button>
      <span class="sep"></span>
      <button title={t('heading')} onclick={run(cycleHeading)}>H</button>
      <button title={t('bullet')} onclick={run((v) => toggleLinePrefix(v, '- '))}>•</button>
      <button title={t('task')} onclick={run((v) => toggleLinePrefix(v, '- [ ] '))}>☑</button>
      <button title={t('quote')} onclick={run((v) => toggleLinePrefix(v, '> '))}>❝</button>
      <span class="sep"></span>
      <button title={t('link')} onclick={run(insertLink)}>🔗</button>
      <button title={t('table')} onclick={run(insertTable)}>▦</button>
    </div>
  {/if}

  {#if err}<p class="error banner" role="alert">{err} <button class="link" onclick={() => (err = '')}>×</button></p>{/if}

  <div class="cm-host" bind:this={host}></div>

  <footer class="statusbar">
    <span>{t('words', { n: words })}</span>
    {#if store.mode === 'server' && note.role !== 'owner'}<span>· {t('sharedByOther', { name: note.owner })}</span>{/if}
  </footer>
</section>

{#if sharing}
  <ShareDialog {note} onClose={() => (sharing = false)} />
{/if}
