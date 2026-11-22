<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  // The checklist view of a note: shopping lists, packing lists, routines. Big tap targets, a progress ring,
  // sections, a "done" group, quick add, swipe to remove. It only edits the note's text.
  import type { Text as YText } from 'yjs';
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { store } from '../lib/store.svelte.ts';
  import { applyText } from '../lib/ytext.ts';
  import { pieces } from '../lib/headings.ts';
  import { addItem, addSection, clearDone, deleteItem, editItem, moveItem, parseChecklist, renameSection, setAll, toggleItem } from '../lib/checklist.ts';

  let { ytext, readOnly, noteId, onText }: { ytext: YText; readOnly: boolean; noteId?: string; onText?: () => void } = $props();
  const t = store.t;

  let text = $state(ytext.toString());
  const list = $derived(parseChecklist(text));
  onMount(() => {
    const h = () => (text = ytext.toString());
    ytext.observe(h);
    return () => { ytext.unobserve(h); clearTimeout(undoTimer); };
  });
  const apply = (next: string) => { if (!readOnly) applyText(ytext, next); };

  // ── undo for the things that are easy to do by accident ──
  let undo = $state<{ text: string; msg: string } | null>(null);
  let undoTimer: ReturnType<typeof setTimeout> | undefined;
  function change(next: string, msg?: string) {
    if (msg) {
      undo = { text, msg };
      clearTimeout(undoTimer);
      undoTimer = setTimeout(() => (undo = null), 6000);
    }
    apply(next);
  }
  function undoNow() {
    if (!undo) return;
    apply(undo.text);
    undo = null;
    clearTimeout(undoTimer);
  }

  const pct = $derived(list.total ? list.done / list.total : 0);
  const R = 34;
  const CIRC = 2 * Math.PI * R;
  const complete = $derived(list.total > 0 && list.done === list.total);

  // quick add: one box per section, Enter adds and keeps the box ready for the next item
  let drafts = $state<Record<number, string>>({});
  function add(s: number) {
    const v = (drafts[s] ?? '').trim();
    if (!v) return;
    change(addItem(text, s, v));
    drafts[s] = '';
  }
  let newSection = $state(false);
  let sectionDraft = $state('');
  function submitSection() {
    if (sectionDraft.trim()) change(addSection(text, sectionDraft));
    sectionDraft = '';
    newSection = false;
  }
  let renaming = $state<number | null>(null);
  let editing = $state<number | null>(null); // line of the item being edited
  let moving = $state<number | null>(null); // line of the item whose "move to" menu is open
  let collapsed = $state<Record<string, boolean>>({});
  const key = (s: number) => String(list.sections[s]?.head ?? -1);
  const focus = (el: HTMLElement) => { el.focus(); if (el instanceof HTMLInputElement) el.select(); };

  // ── swipe an item toward the end of the line to remove it ──
  let sw = $state<{ line: number; dx: number } | null>(null);
  let swStart = { x: 0, y: 0, live: false, w: 1, line: -1 };
  const dirSign = () => (document.documentElement.dir === 'rtl' ? -1 : 1);
  function swDown(e: PointerEvent, line: number) {
    if (readOnly || e.pointerType === 'mouse') return;
    swStart = { x: e.clientX, y: e.clientY, live: false, w: (e.currentTarget as HTMLElement).getBoundingClientRect().width, line };
  }
  function swMove(e: PointerEvent) {
    if (swStart.line < 0) return;
    const dx = (e.clientX - swStart.x) * dirSign();
    const dy = e.clientY - swStart.y;
    if (!swStart.live) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swStart.line = -1; return; }
      if (dx < 12) return;
      swStart.live = true;
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* the finger already left */ }
    }
    sw = { line: swStart.line, dx: Math.max(0, dx) };
  }
  function swUp() {
    if (swStart.live && sw && sw.dx > Math.min(110, swStart.w * 0.35)) {
      const line = sw.line;
      sw = null;
      change(deleteItem(text, line), t('taskRemoved'));
    } else sw = null;
    swStart.line = -1;
    swStart.live = false;
  }
  const swallow = (e: Event) => { if (swStart.live) e.preventDefault(); };

  function onLabel(e: MouseEvent, line: number) {
    const a = (e.target as HTMLElement).closest('[data-target]') as HTMLElement | null;
    if (a) {
      e.preventDefault();
      e.stopPropagation();
      a.dataset.kind === 'url' ? window.open(a.dataset.target, '_blank', 'noopener') : void store.openLink(a.dataset.target!, noteId);
      return;
    }
    if (!readOnly) change(toggleItem(text, line));
  }
  const doneCount = (s: number) => list.sections[s]!.items.filter((i) => i.done).length;
</script>

<div class="checklist" class:complete>
  <header class="ck-head">
    <div class="ring" role="img" aria-label={t('taskOf', { done: list.done, n: list.total })}>
      <svg viewBox="0 0 80 80" width="76" height="76">
        <circle class="track" cx="40" cy="40" r={R} />
        <circle class="bar" cx="40" cy="40" r={R} stroke-dasharray={CIRC} stroke-dashoffset={CIRC * (1 - pct)} />
      </svg>
      <span class="ring-n">{#if complete}<Icon name="check-small" size={30} />{:else}{Math.round(pct * 100)}%{/if}</span>
    </div>
    <div class="ck-sum">
      <strong>{complete ? t('taskAllDone') : t('taskOf', { done: list.done, n: list.total })}</strong>
    </div>
    {#if !readOnly}
      <div class="ck-actions">
        <button class="ghost small" disabled={list.done === 0} onclick={() => change(setAll(text, false), t('taskResetDone'))}>{t('taskReset')}</button>
        <button class="ghost small" disabled={list.done === 0} onclick={() => change(clearDone(text), t('taskCleared', { n: list.done }))}>{t('taskClear')}</button>
        <button class="ghost small" onclick={() => onText?.()}>{t('modeSource')}</button>
      </div>
    {/if}
  </header>

  {#each list.sections as sec, s (sec.head)}
    {@const open = sec.items.filter((i) => !i.done)}
    {@const done = sec.items.filter((i) => i.done)}
    <section class="ck-sec">
      <div class="ck-sec-head">
        {#if renaming === s && sec.title !== null}
          <input class="ck-rename" use:focus value={sec.title} onblur={() => (renaming = null)} onkeydown={(e) => {
            if (e.key === 'Enter') { change(renameSection(text, s, e.currentTarget.value)); renaming = null; }
            else if (e.key === 'Escape') renaming = null;
          }} />
        {:else}
          <h3 ondblclick={() => { if (!readOnly && sec.title !== null) renaming = s; }}>{sec.title ?? ''}</h3>
        {/if}
        {#if sec.items.length}
          <span class="ck-count" class:all={done.length === sec.items.length}>{done.length}/{sec.items.length}</span>
          <span class="ck-mini"><i style:width="{(done.length / sec.items.length) * 100}%"></i></span>
        {/if}
      </div>

      <ul class="ck-items">
        {#each open as it (it.line)}
          {@render row(it, s)}
        {/each}
      </ul>

      {#if !readOnly}
        <form class="ck-add" onsubmit={(e) => { e.preventDefault(); add(s); }}>
          <Icon name="plus" size={18} />
          <input bind:value={drafts[s]} placeholder={t('taskAdd')} enterkeyhint="done" autocomplete="off" />
        </form>
      {/if}

      {#if done.length}
        <button class="ck-donehead" aria-expanded={!collapsed[key(s)]} onclick={() => (collapsed[key(s)] = !collapsed[key(s)])}>
          <span class="caret" class:open={!collapsed[key(s)]}><Icon name="chevron" size={14} /></span>
          {t('taskDone')} · {done.length}
        </button>
        {#if !collapsed[key(s)]}
          <ul class="ck-items done">
            {#each done as it (it.line)}
              {@render row(it, s)}
            {/each}
          </ul>
        {/if}
      {/if}
    </section>
  {/each}

  {#if list.total === 0 && list.sections.length <= 1}<p class="ck-empty muted">{t('taskNone')}</p>{/if}

  {#if !readOnly}
    <div class="ck-newsec">
      {#if newSection}
        <form onsubmit={(e) => { e.preventDefault(); submitSection(); }}>
          <input use:focus bind:value={sectionDraft} placeholder={t('taskSectionName')} onblur={() => { if (!sectionDraft.trim()) newSection = false; }} />
        </form>
      {:else}
        <button class="ghost" onclick={() => (newSection = true)}><Icon name="plus" size={16} /> {t('taskAddSection')}</button>
      {/if}
    </div>
  {/if}

  {#if undo}
    <div class="ck-undo" role="status"><span>{undo.msg}</span><button onclick={undoNow}>{t('undo')}</button></div>
  {/if}
</div>

{#snippet row(it: { line: number; done: boolean; text: string }, s: number)}
  <li class="ck-row-wrap" class:swiping={sw?.line === it.line}>
    <span class="ck-del" aria-hidden="true"><Icon name="trash" size={20} /></span>
    <div class="ck-row" class:done={it.done} style:transform={sw?.line === it.line ? `translateX(${sw.dx * dirSign()}px)` : undefined}
      onpointerdown={(e) => swDown(e, it.line)} onpointermove={swMove} onpointerup={swUp} onpointercancel={swUp} onclickcapture={swallow}>
      <button class="tick" class:on={it.done} role="checkbox" aria-checked={it.done} aria-label={it.text} disabled={readOnly} onclick={() => change(toggleItem(text, it.line))}>
        <Icon name="check-small" size={16} />
      </button>
      {#if editing === it.line}
        <input class="ck-edit" use:focus value={it.text} onblur={() => (editing = null)} onkeydown={(e) => {
          if (e.key === 'Enter') { change(editItem(text, it.line, e.currentTarget.value)); editing = null; }
          else if (e.key === 'Escape') editing = null;
        }} />
      {:else}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <span class="ck-label" onclick={(e) => onLabel(e, it.line)}>{#each pieces(it.text) as p}{#if p.kind === 'text'}{p.text}{:else}<a href={p.kind === 'url' ? p.target : '#'} class="clink" data-kind={p.kind} data-target={p.target}>{p.text}</a>{/if}{/each}</span>
        {#if !readOnly}
          <span class="ck-tools">
            {#if list.sections.length > 1}<button class="icon sm" title={t('taskMoveTo')} aria-label={t('taskMoveTo')} onclick={() => (moving = moving === it.line ? null : it.line)}><Icon name="folder" size={16} /></button>{/if}
            <button class="icon sm" title={t('taskEdit')} aria-label={t('taskEdit')} onclick={() => (editing = it.line)}><Icon name="edit" size={16} /></button>
            <button class="icon sm del" title={t('delete')} aria-label={t('delete')} onclick={() => change(deleteItem(text, it.line), t('taskRemoved'))}><Icon name="close" size={16} /></button>
          </span>
        {/if}
      {/if}
      {#if moving === it.line}
        <div class="menu ck-move" role="menu">
          {#each list.sections as other, o}
            {#if o !== s}<button role="menuitem" onclick={() => { moving = null; change(moveItem(text, it.line, o)); }}>{other.title ?? '—'}</button>{/if}
          {/each}
        </div>
      {/if}
    </div>
  </li>
{/snippet}

<style>
  .checklist { max-width: 42rem; margin: 0 auto; padding: 1rem 1rem 6rem; position: relative; }
  .ck-head { display: flex; align-items: center; gap: 1rem; padding: 1rem 1.1rem; border-radius: 22px; background: linear-gradient(135deg, var(--accent-soft), transparent 70%), var(--surface); border: 1px solid var(--hairline); box-shadow: var(--shadow); flex-wrap: wrap; }
  .ring { position: relative; width: 76px; height: 76px; flex: none; }
  .ring svg { transform: rotate(-90deg); }
  .ring circle { fill: none; stroke-width: 7; }
  .ring .track { stroke: var(--hairline); }
  .ring .bar { stroke: var(--accent); stroke-linecap: round; transition: stroke-dashoffset 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), stroke 0.3s; }
  .complete .ring .bar { stroke: var(--ok); }
  .ring-n { position: absolute; inset: 0; display: grid; place-items: center; font-weight: 700; font-size: 1rem; font-variant-numeric: tabular-nums; }
  .complete .ring-n { color: var(--ok); animation: pop 0.4s cubic-bezier(0.2, 1.6, 0.4, 1); }
  .ck-sum { display: flex; flex-direction: column; gap: 0.1rem; flex: 1; min-width: 8rem; }
  .ck-sum strong { font-size: 1.2rem; }
  .ck-actions { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  @media (max-width: 760px) { .checklist { padding-top: 4.6rem; } }
  .ck-sec { margin-top: 1.4rem; }
  .ck-sec-head { display: flex; align-items: center; gap: 0.6rem; padding: 0 0.4rem; margin-bottom: 0.4rem; }
  .ck-sec-head h3 { margin: 0; font-size: 1rem; color: var(--accent); flex: none; }
  .ck-rename { font: inherit; font-weight: 700; }
  .ck-count { font-size: 0.8rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .ck-count.all { color: var(--ok); }
  .ck-mini { flex: 1; height: 4px; border-radius: 4px; background: var(--hairline); overflow: hidden; }
  .ck-mini i { display: block; height: 100%; background: var(--accent); border-radius: 4px; transition: width 0.4s; }
  .ck-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  .ck-row-wrap { position: relative; border-radius: 16px; background: var(--danger); }
  .ck-del { position: absolute; inset-block: 0; inset-inline-start: 1rem; display: grid; place-items: center; color: #fff; opacity: 0; transition: opacity 0.15s; }
  .swiping .ck-del { opacity: 1; }
  .ck-row { position: relative; display: flex; align-items: center; gap: 0.85rem; min-height: 3.4rem; padding: 0.35rem 0.7rem 0.35rem 0.9rem; padding-inline: 0.9rem 0.6rem; border-radius: 16px; background: var(--surface); border: 1px solid var(--hairline); touch-action: pan-y; transition: transform 0.2s ease, background 0.15s, border-color 0.15s; }
  .swiping .ck-row { transition: none; }
  .ck-row:hover { border-color: var(--accent); }
  .tick { flex: none; width: 1.7rem; height: 1.7rem; border-radius: 50%; border: 2px solid var(--muted); background: transparent; display: grid; place-items: center; color: transparent; padding: 0; transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.15s; }
  .tick:active { transform: scale(0.88); }
  .tick.on { background: var(--accent); border-color: var(--accent); color: var(--on-accent); animation: pop 0.3s cubic-bezier(0.2, 1.6, 0.4, 1); }
  .ck-label { flex: 1; min-width: 0; font-size: 1.05rem; line-height: 1.35; overflow-wrap: anywhere; cursor: pointer; padding-block: 0.5rem; }
  .done .ck-label { color: var(--muted); text-decoration: line-through; text-decoration-thickness: 1.5px; }
  .ck-tools { display: flex; opacity: 0; transition: opacity 0.15s; }
  .ck-row:hover .ck-tools, .ck-row:focus-within .ck-tools { opacity: 1; }
  @media (pointer: coarse) { .ck-tools { opacity: 1; } .ck-tools .del { display: none; } }
  .ck-edit, .ck-add input { flex: 1; min-width: 0; font: inherit; font-size: 1.05rem; }
  .ck-add { display: flex; align-items: center; gap: 0.7rem; margin-top: 0.4rem; padding: 0.2rem 0.9rem; min-height: 3rem; border-radius: 16px; border: 1.5px dashed var(--line); color: var(--muted); }
  .ck-add:focus-within { border-color: var(--accent); color: var(--accent); }
  .ck-add input { border: 0; background: transparent; box-shadow: none; outline: none; color: var(--ink); }
  .ck-donehead { margin-top: 0.7rem; display: flex; align-items: center; gap: 0.4rem; border: 0; background: transparent; color: var(--muted); font-size: 0.85rem; padding: 0.3rem 0.4rem; }
  .caret { display: inline-grid; transition: transform 0.2s; transform: rotate(-90deg); }
  :global([dir='rtl']) .caret { transform: rotate(90deg); }
  .caret.open, :global([dir='rtl']) .caret.open { transform: none; }
  .ck-items.done { margin-top: 0.3rem; opacity: 0.85; }
  .ck-newsec { margin-top: 1.6rem; }
  .ck-newsec input { width: 100%; font-size: 1rem; }
  .ck-empty { text-align: center; padding: 2rem 0 0; }
  .ck-move { position: absolute; inset-inline-end: 0.5rem; top: 100%; z-index: 20; min-width: 10rem; }
  .ck-undo { position: fixed; inset-inline: 1rem; bottom: calc(1.2rem + env(safe-area-inset-bottom)); max-width: 26rem; margin-inline: auto; display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.7rem 1rem; border-radius: 14px; background: var(--ink); color: var(--bg); box-shadow: var(--shadow); z-index: 40; animation: rise 0.25s ease; }
  .ck-undo button { border: 0; background: transparent; color: var(--accent-soft); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  .clink { color: var(--accent); text-decoration: none; }
  @keyframes pop { 0% { transform: scale(0.6); } 100% { transform: scale(1); } }
  @keyframes rise { from { transform: translateY(14px); opacity: 0; } to { transform: none; opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>
