<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  // The Kanban view of a note. It only ever edits the note's text (columns = ## headings,
  // cards = task lines), so the file stays plain Markdown.
  import type { Text as YText } from 'yjs';
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { store } from '../lib/store.svelte.ts';
  import { applyText } from '../lib/ytext.ts';
  import { linkSuggest } from '../lib/linksuggest.ts';
  import { pieces } from '../lib/headings.ts';
  import { confirmBox } from '../lib/dialog.svelte.ts';
  import { addCard, addColumn, deleteCard, deleteColumn, editCard, moveCard, parseBoard, renameColumn, toggleCard } from '../lib/kanban.ts';

  let { ytext, readOnly, noteId }: { ytext: YText; readOnly: boolean; noteId?: string } = $props();
  const t = store.t;

  let text = $state(ytext.toString());
  const board = $derived(parseBoard(text));
  onMount(() => {
    const h = () => (text = ytext.toString());
    ytext.observe(h);
    return () => ytext.unobserve(h);
  });

  const apply = (next: string) => { if (!readOnly) applyText(ytext, next); };

  let adding = $state<number | null>(null);
  let draft = $state('');
  let editing = $state<{ c: number; i: number } | null>(null);
  let newCol = $state(false);
  let colDraft = $state('');
  let renaming = $state<number | null>(null);
  let drag = $state<{ c: number; i: number } | null>(null);
  let over = $state<{ c: number; i: number } | null>(null);

  const tags = (s: string) => [...s.matchAll(/(^|\s)#([\p{L}\p{N}_/-]+)/gu)].map((m) => m[2]!);
  const plain = (s: string) => s.replace(/(^|\s)#[\p{L}\p{N}_/-]+/gu, '$1').replace(/\s+/g, ' ').trim();

  function submitCard(c: number) {
    apply(addCard(text, c, draft));
    draft = '';
  }
  function drop(c: number, i: number) {
    if (drag) apply(moveCard(text, drag.c, drag.i, c, i));
    drag = over = null;
  }
  async function removeColumn(c: number) {
    const col = board.columns[c]!;
    if (col.cards.length && !(await confirmBox(t('deleteColumnAsk', { name: col.title, n: col.cards.length })))) return;
    apply(deleteColumn(text, c));
  }
  const focus = (el: HTMLElement) => el.focus();
</script>

<div class="board" role="region" aria-label={t('modeBoard')}>
  {#each board.columns as col, c (col.head + ':' + col.title)}
    <section class="bcol" class:over={over?.c === c && over.i >= col.cards.length}
      ondragover={(e) => { if (drag) { e.preventDefault(); over = { c, i: col.cards.length }; } }}
      ondrop={(e) => { e.preventDefault(); drop(c, over?.c === c ? over.i : col.cards.length); }}>
      <header>
        {#if renaming === c}
          <!-- svelte-ignore a11y_autofocus -->
          <input class="bname" value={col.title} use:focus
            onblur={(e) => { apply(renameColumn(text, c, e.currentTarget.value)); renaming = null; }}
            onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') renaming = null; }} />
        {:else}
          <h3 ondblclick={() => !readOnly && (renaming = c)}>{col.title}</h3>
        {/if}
        <span class="count">{col.cards.length}</span>
        {#if !readOnly}
          <button class="icon sm" title={t('rename')} aria-label={t('rename')} onclick={() => (renaming = c)}><Icon name="edit" size={14} /></button>
          <button class="icon sm" title={t('delete')} aria-label={t('delete')} onclick={() => removeColumn(c)}><Icon name="trash" size={14} /></button>
        {/if}
      </header>

      <ul>
        {#each col.cards as card, i (card.start + ':' + card.text)}
          <li class="card" class:done={card.done} class:dragging={drag?.c === c && drag.i === i} class:before={over?.c === c && over.i === i && drag}
            draggable={!readOnly && editing === null}
            ondragstart={(e) => { drag = { c, i }; e.dataTransfer?.setData('text/plain', card.text); }}
            ondragend={() => (drag = over = null)}
            ondragover={(e) => { if (drag) { e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); over = { c, i: e.clientY < r.top + r.height / 2 ? i : i + 1 }; } }}
            ondrop={(e) => { e.preventDefault(); e.stopPropagation(); drop(c, over?.c === c ? over.i : i); }}>
            {#if editing?.c === c && editing.i === i}
              <!-- svelte-ignore a11y_autofocus -->
              <textarea rows="2" value={card.text} use:focus use:linkSuggest={{ here: noteId }}
                onblur={(e) => { apply(editCard(text, c, i, e.currentTarget.value)); editing = null; }}
                onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') editing = null; }}></textarea>
            {:else}
              <div class="ctext">
                {#if card.done !== null}
                  <button class="tick" class:on={card.done} aria-label={t('task')} aria-pressed={card.done} disabled={readOnly} onclick={() => apply(toggleCard(text, c, i))}>
                    {#if card.done}<Icon name="check-small" size={12} />{/if}
                  </button>
                {/if}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div class="label" role="button" tabindex="0" class:ro={readOnly}
                  onclick={(e) => {
                    const a = (e.target as HTMLElement).closest('[data-target]') as HTMLElement | null;
                    if (a) { e.preventDefault(); a.dataset.kind === 'url' ? window.open(a.dataset.target, '_blank', 'noopener') : void store.openLink(a.dataset.target!, noteId); return; }
                    if (!readOnly) editing = { c, i };
                  }}
                  onkeydown={(e) => { if (e.key === 'Enter' && !readOnly) editing = { c, i }; }}>
                  {#each pieces(plain(card.text) || card.text) as p}{#if p.kind === 'text'}{p.text}{:else}<a href={p.kind === 'url' ? p.target : '#'} class="clink" data-kind={p.kind} data-target={p.target}>{p.text}</a>{/if}{/each}
                </div>
              </div>
              {#if card.extra.length}<p class="extra">{card.extra.join(' · ')}</p>{/if}
              {#if tags(card.text).length}<div class="ctags">{#each tags(card.text) as tg}<span>#{tg}</span>{/each}</div>{/if}
              {#if !readOnly}
                <div class="cact">
                  <button class="icon sm" aria-label={t('moveLeft')} title={t('moveLeft')} disabled={c === 0} onclick={() => apply(moveCard(text, c, i, c - 1, 1e9))}><Icon name={store.lang === 'ar' ? 'chevron-right' : 'chevron-left'} size={14} /></button>
                  <button class="icon sm" aria-label={t('moveRight')} title={t('moveRight')} disabled={c === board.columns.length - 1} onclick={() => apply(moveCard(text, c, i, c + 1, 1e9))}><Icon name={store.lang === 'ar' ? 'chevron-left' : 'chevron-right'} size={14} /></button>
                  <button class="icon sm" aria-label={t('delete')} title={t('delete')} onclick={() => apply(deleteCard(text, c, i))}><Icon name="trash" size={14} /></button>
                </div>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>

      {#if !readOnly}
        {#if adding === c}
          <form class="addform" onsubmit={(e) => { e.preventDefault(); submitCard(c); }}>
            <!-- svelte-ignore a11y_autofocus -->
            <input bind:value={draft} placeholder={t('cardText')} use:focus use:linkSuggest={{ here: noteId }} onkeydown={(e) => e.key === 'Escape' && ((adding = null), (draft = ''))} onblur={() => { if (!draft.trim()) adding = null; }} />
            <button class="primary small" type="submit">{t('add')}</button>
          </form>
        {:else}
          <button class="ghost addbtn" onclick={() => ((adding = c), (draft = ''))}><Icon name="plus" size={14} /> {t('addCard')}</button>
        {/if}
      {/if}
    </section>
  {/each}

  {#if !readOnly}
    <section class="bcol newcol">
      {#if newCol}
        <form class="addform" onsubmit={(e) => { e.preventDefault(); apply(addColumn(text, colDraft)); colDraft = ''; newCol = false; }}>
          <!-- svelte-ignore a11y_autofocus -->
          <input bind:value={colDraft} placeholder={t('columnName')} use:focus onkeydown={(e) => e.key === 'Escape' && (newCol = false)} />
          <button class="primary small" type="submit">{t('add')}</button>
        </form>
      {:else}
        <button class="ghost addbtn" onclick={() => (newCol = true)}><Icon name="plus" size={14} /> {t('addColumn')}</button>
      {/if}
    </section>
  {/if}
  {#if board.columns.length === 0}<p class="muted pad">{t('noColumns')}</p>{/if}
</div>

<style>
  .board { flex: 1; min-height: 0; display: flex; gap: 0.9rem; align-items: flex-start; overflow: auto; padding: 1.1rem 1.2rem 2rem; }
  .bcol { flex: 0 0 18rem; max-width: 85vw; background: color-mix(in srgb, var(--ink) 5%, var(--surface)); border: 1px solid var(--hairline, var(--line)); border-radius: 16px; padding: 0.7rem; display: flex; flex-direction: column; gap: 0.5rem; max-height: 100%; }
  .bcol.over { outline: 2px dashed var(--accent); outline-offset: -2px; }
  .newcol { background: transparent; border-style: dashed; }
  header { display: flex; align-items: center; gap: 0.25rem; }
  h3 { margin: 0; font-size: 0.95rem; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0.2rem 0.3rem; }
  .bname { flex: 1; font-weight: 650; }
  .count { color: var(--muted); font-size: 0.8rem; background: color-mix(in srgb, var(--ink) 8%, transparent); border-radius: 99px; padding: 0 0.5rem; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; overflow: auto; min-height: 0.5rem; }
  .card { position: relative; background: var(--surface); border: 1px solid var(--hairline, var(--line)); border-radius: 12px; padding: 0.55rem 0.65rem; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06); cursor: grab; }
  .card.dragging { opacity: 0.4; }
  .card.before::before { content: ''; position: absolute; inset-inline: 0; top: -0.3rem; height: 3px; border-radius: 3px; background: var(--accent); }
  .card.done .label { color: var(--muted); text-decoration: line-through; }
  .ctext { display: flex; gap: 0.5rem; align-items: flex-start; }
  .clink { color: var(--accent); text-decoration: none; }
  .clink:hover { text-decoration: underline; text-underline-offset: 3px; }
  .label { background: none; border: 0; padding: 0; text-align: start; flex: 1; min-width: 0; line-height: 1.4; cursor: text; overflow-wrap: anywhere; }
  .tick { flex: none; width: 1.1rem; height: 1.1rem; padding: 0; margin-top: 0.1rem; border-radius: 6px; display: grid; place-items: center; }
  .tick.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .extra { margin: 0.3rem 0 0; font-size: 0.8rem; color: var(--muted); }
  .ctags { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.35rem; }
  .ctags span { font-size: 0.72rem; background: var(--accent-soft); color: var(--accent); border-radius: 99px; padding: 0 0.45rem; }
  .cact { display: flex; gap: 0.1rem; margin-top: 0.3rem; opacity: 0; transition: opacity 0.12s; }
  .card:hover .cact, .card:focus-within .cact { opacity: 1; }
  @media (hover: none) { .cact { opacity: 1; } }
  .sm { width: 1.7rem; height: 1.7rem; }
  textarea { width: 100%; resize: vertical; font: inherit; background: var(--bg); border: 1px solid var(--accent); border-radius: 8px; padding: 0.35rem 0.5rem; }
  .addform { display: flex; gap: 0.35rem; }
  .addform input { flex: 1; min-width: 0; }
  .addbtn { display: inline-flex; gap: 0.35rem; align-items: center; justify-content: flex-start; color: var(--muted); }
  .pad { padding: 1rem; }
</style>
