<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  // The checklist view of a note: shopping lists, packing lists, routines. Big tap targets, a progress ring,
  // sections that nest by heading level, subtasks, a "done" group, quick add, swipe to tick or remove.
  // It only edits the note's text.
  import type { Text as YText } from 'yjs';
  import { onMount, tick } from 'svelte';
  import { fade, fly, slide } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import { cleanGestures, type TaskAction } from '../lib/gestures.ts';
  import { store } from '../lib/store.svelte.ts';
  import { applyText } from '../lib/ytext.ts';
  import { pieces } from '../lib/headings.ts';
  import { readFrontMatter } from '../lib/frontmatter.ts';
  import { pop } from '../lib/motion.ts';
  import { addItem, addSection, flatItems, addSub, clearDone, deleteItem, editItem, indentItem, moveItem, outdentItem, parseChecklist, renameSection, sectionLeaves, setAll, toggleItem, type Item, type Section } from '../lib/checklist.ts';

  let { ytext, readOnly, noteId, onText }: { ytext: YText; readOnly: boolean; noteId?: string; onText?: () => void } = $props();
  const t = store.t;

  let text = $state(ytext.toString());
  const list = $derived(parseChecklist(text));
  onMount(() => {
    const h = () => (text = ytext.toString());
    ytext.observe(h);
    return () => { ytext.unobserve(h); clearTimeout(undoTimer); clearTimeout(pressTimer); };
  });
  const apply = (next: string) => { if (!readOnly) applyText(ytext, next); };

  // `tap: box` (or `edit`) in the properties: only the round box ticks, a tap on the words edits them
  const tapMode = $derived((readFrontMatter(text)?.props.find((p) => p.key.toLowerCase() === 'tap')?.text ?? '').trim().toLowerCase());
  const boxOnly = $derived(tapMode === 'box' || tapMode === 'edit');

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

  // ── what is folded (remembered per note) ──
  const FOLD = 'qm.ck.' + (noteId ?? '');
  let folded = $state<Record<string, boolean>>((() => { try { return JSON.parse(localStorage.getItem(FOLD) ?? '{}'); } catch { return {}; } })());
  function fold(k: string) {
    folded[k] = !folded[k];
    try { localStorage.setItem(FOLD, JSON.stringify(folded)); } catch { /* fine */ }
  }
  const secKey = (s: Section) => 's:' + (s.title ?? '') + '@' + s.level;
  const itemKey = (it: Item) => 'i:' + it.text;
  const doneKey = (s: Section) => 'd:' + (s.title ?? '');

  // ── adding: one box per section, one under an item for subtasks ──
  let drafts = $state<Record<number, string>>({});
  function add(s: number) {
    const v = (drafts[s] ?? '').trim();
    if (!v) return;
    change(addItem(text, s, v));
    drafts[s] = '';
  }
  let subOf = $state<number | null>(null);
  let subDraft = $state('');
  function addSubtask(line: number) {
    const v = subDraft.trim();
    if (!v) return;
    change(addSub(text, line, v));
    subDraft = '';
  }
  let newSection = $state<{ parent?: number } | null>(null);
  let sectionDraft = $state('');
  function submitSection() {
    if (sectionDraft.trim()) change(addSection(text, sectionDraft, newSection?.parent));
    sectionDraft = '';
    newSection = null;
  }
  let renaming = $state<number | null>(null);
  let editing = $state<number | null>(null); // line of the item being edited
  let menuFor = $state<{ line: number; moving: boolean } | null>(null);
  let secMenu = $state<number | null>(null);
  const focus = (el: HTMLElement) => { el.focus(); if (el instanceof HTMLInputElement) el.select(); };
  $effect(() => { if (menuFor || secMenu !== null) { const h = (e: Event) => { if (!(e.target as Element).closest('.ck-pop, .ck-menu-btn')) { menuFor = null; secMenu = null; } }; window.addEventListener('pointerdown', h, true); return () => window.removeEventListener('pointerdown', h, true); } });

  // ── swipe a row: toward the end of the line ticks it, toward the start removes it ──
  // (the outer fifth of the screen on each side stays with the app's own panels; see App.svelte)
  let sw = $state<{ line: number; dx: number } | null>(null);
  let st = { x: 0, y: 0, live: false, w: 1, line: -1, dir: 1 };
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let pressed = false;
  // double-click to edit is a mouse habit; a phone edits with press-and-hold (or what you set in Settings)
  const finePointer = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
  const title = $derived(store.notes.find((n) => n.id === noteId)?.title ?? '');
  const g = $derived(cleanGestures(store.s.gestures));
  /** do what the person chose for a gesture */
  function run(a: TaskAction, it: Item) {
    if (a === 'tick') change(toggleItem(text, it.line));
    else if (a === 'delete') change(deleteItem(text, it.line), t('taskRemoved'));
    else if (a === 'edit') editing = it.line;
    else if (a === 'menu') menuFor = { line: it.line, moving: false };
  }
  const actIcon = (a: TaskAction) => (a === 'tick' ? 'check-small' : a === 'delete' ? 'trash' : a === 'edit' ? 'edit' : 'more');
  const actColor = (a: TaskAction) => (a === 'tick' ? 'var(--ok)' : a === 'delete' ? 'var(--danger)' : 'var(--accent)');
  function down(e: PointerEvent, it: Item) {
    if (readOnly || e.pointerType === 'mouse' || (e.target as Element).closest('button, input, a')) return;
    const el = e.currentTarget as HTMLElement;
    st = { x: e.clientX, y: e.clientY, live: false, w: el.getBoundingClientRect().width, line: it.line, dir: 1 };
    pressed = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => { if (!st.live && st.line === it.line && g.longPress !== 'none') { pressed = true; run(g.longPress, it); navigator.vibrate?.(8); } }, 480);
  }
  function move(e: PointerEvent) {
    if (st.line < 0) return;
    const dx = (e.clientX - st.x) * st.dir;
    const dy = e.clientY - st.y;
    if (!st.live) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { st.line = -1; clearTimeout(pressTimer); return; }
      if (Math.abs(dx) < 12) return;
      clearTimeout(pressTimer);
      st.live = true;
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* the finger already left */ }
    }
    sw = { line: st.line, dx };
  }
  function up() {
    clearTimeout(pressTimer);
    if (st.live && sw) {
      const need = Math.min(110, st.w * 0.3);
      const line = sw.line;
      const dx = sw.dx;
      sw = null;
      const item = list.sections.flatMap((x) => flatItems(x.items)).find((x) => x.line === line);
      if (item && dx > need) run(g.swipeRight, item);
      else if (item && dx < -need) run(g.swipeLeft, item);
    } else sw = null;
    st.line = -1;
    st.live = false;
  }
  const swallow = (e: Event) => { if (st.live || pressed) { e.preventDefault(); e.stopPropagation(); pressed = false; } };

  function onLabel(e: MouseEvent, it: Item) {
    const a = (e.target as HTMLElement).closest('[data-target]') as HTMLElement | null;
    if (a) {
      e.preventDefault();
      e.stopPropagation();
      a.dataset.kind === 'url' ? window.open(a.dataset.target, '_blank', 'noopener') : void store.openLink(a.dataset.target!, noteId);
      return;
    }
    if (readOnly) return;
    run(boxOnly ? 'edit' : g.tap, it);
  }
  const kids = (it: Item) => it.children.length;
  const kidsDone = (it: Item) => it.children.filter((k) => k.done).length;
  const secDone = (s: Section) => sectionLeaves(s).filter((x) => x.done).length;
  const secAll = (s: Section) => sectionLeaves(s).length;
  const pad = (n: number) => ' '.repeat(Math.max(0, n - 1));
</script>

<div class="checklist">
  <div class="ck-inner" class:complete>
    <header class="ck-head" dir="auto">
      <div class="ring" role="img" aria-label={t('taskOf', { done: list.done, n: list.total })}>
        <svg viewBox="0 0 80 80" width="76" height="76">
          <circle class="track" cx="40" cy="40" r={R} />
          <circle class="bar" cx="40" cy="40" r={R} stroke-dasharray={CIRC} stroke-dashoffset={CIRC * (1 - pct)} />
        </svg>
        <span class="ring-n">{#if complete}<Icon name="check-small" size={30} />{:else}{Math.round(pct * 100)}%{/if}</span>
      </div>
      <div class="ck-sum">
        {#if title}<h2 class="ck-title" dir="auto">{title}</h2>{/if}
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

    {#each list.roots as sec (sec.head)}
      {@render section(sec)}
    {/each}

    {#if list.total === 0 && list.sections.length <= 1}<p class="ck-empty muted">{t('taskNone')}</p>{/if}

    {#if !readOnly}
      <div class="ck-newsec">
        {#if newSection && newSection.parent === undefined}
          <form onsubmit={(e) => { e.preventDefault(); submitSection(); }}>
            <input dir="auto" use:focus bind:value={sectionDraft} placeholder={t('taskSectionName')} onblur={() => { if (!sectionDraft.trim()) newSection = null; }} />
          </form>
        {:else}
          <button class="ghost" onclick={() => (newSection = {})}><Icon name="plus" size={16} /> {t('taskAddSection')}</button>
        {/if}
      </div>
    {/if}
  </div>

  {#if undo}
    <div class="ck-undo" role="status" in:fly|global={{ y: 24, duration: 220 }} out:fly|global={{ y: 24, duration: 180 }}><span>{undo.msg}</span><button onclick={undoNow}>{t('undo')}</button></div>
  {/if}
</div>

{#snippet section(sec: Section)}
  {@const open = sec.items.filter((i) => !i.done)}
  {@const done = sec.items.filter((i) => i.done)}
  {@const closed = !!folded[secKey(sec)]}
  <section class="ck-sec l{sec.level}">
    {#if sec.title !== null}
      <div class="ck-sec-head" dir="auto">
        <button class="fold" aria-expanded={!closed} aria-label={sec.title} onclick={() => fold(secKey(sec))}><span class="caret" class:open={!closed}><Icon name="chevron" size={16} /></span></button>
        {#if renaming === sec.index}
          <input class="ck-rename" dir="auto" use:focus value={sec.title} onblur={() => (renaming = null)} onkeydown={(e) => {
            if (e.key === 'Enter') { change(renameSection(text, sec.index, e.currentTarget.value)); renaming = null; }
            else if (e.key === 'Escape') renaming = null;
          }} />
        {:else}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
          <h3 dir="auto" ondblclick={() => { if (!readOnly) renaming = sec.index; }} onclick={() => fold(secKey(sec))}>{sec.title}</h3>
        {/if}
        {#if secAll(sec)}
          <span class="ck-count" class:all={secDone(sec) === secAll(sec)}>{secDone(sec)}/{secAll(sec)}</span>
          <span class="ck-mini"><i style:width="{(secDone(sec) / secAll(sec)) * 100}%"></i></span>
        {/if}
        {#if !readOnly}
          <span class="ck-menu-wrap">
            <button class="icon sm ck-menu-btn" aria-label={t('more')} onclick={() => (secMenu = secMenu === sec.index ? null : sec.index)}><Icon name="more" size={16} /></button>
            {#if secMenu === sec.index}
              <div class="menu ck-pop" role="menu" transition:pop|global>
                <button role="menuitem" onclick={() => { secMenu = null; renaming = sec.index; }}>{t('rename')}</button>
                {#if sec.level < 6}<button role="menuitem" onclick={() => { secMenu = null; newSection = { parent: sec.index }; sectionDraft = ''; }}>{t('taskAddSub')}</button>{/if}
              </div>
            {/if}
          </span>
        {/if}
      </div>
    {/if}

    {#if !closed}
      <div class="ck-body" transition:slide|global={{ duration: 200 }}>
        <ul class="ck-items">
          {#each open as it (it.line)}
            {@render row(it, sec)}
          {/each}
        </ul>

        {#if !readOnly}
          <form class="ck-add" dir="auto" onsubmit={(e) => { e.preventDefault(); add(sec.index); }}>
            <Icon name="plus" size={18} />
            <input dir="auto" bind:value={drafts[sec.index]} placeholder={t('taskAdd')} enterkeyhint="done" autocomplete="off" />
          </form>
        {/if}

        {#if done.length}
          <button class="ck-donehead" aria-expanded={!folded[doneKey(sec)]} onclick={() => fold(doneKey(sec))}>
            <span class="caret" class:open={!folded[doneKey(sec)]}><Icon name="chevron" size={14} /></span>
            {t('taskDone')} · {done.length}
          </button>
          {#if !folded[doneKey(sec)]}
            <ul class="ck-items done" transition:slide|global={{ duration: 180 }}>
              {#each done as it (it.line)}
                {@render row(it, sec)}
              {/each}
            </ul>
          {/if}
        {/if}

        {#if newSection && newSection.parent === sec.index}
          <form class="ck-newsub" onsubmit={(e) => { e.preventDefault(); submitSection(); }}>
            <input dir="auto" use:focus bind:value={sectionDraft} placeholder={t('taskSectionName')} onblur={() => { if (!sectionDraft.trim()) newSection = null; }} />
          </form>
        {/if}

        {#each sec.children as child (child.head)}
          {@render section(child)}
        {/each}
      </div>
    {/if}
  </section>
{/snippet}

{#snippet row(it: Item, sec: Section)}
  {@const closed = !!folded[itemKey(it)]}
  <li class="ck-row-wrap" class:swiping={sw?.line === it.line} class:r-side={sw?.line === it.line && sw.dx > 0} class:l-side={sw?.line === it.line && sw.dx < 0} transition:slide|global={{ duration: 180 }}>
    <span class="ck-sw ck-sw-r" style:background={actColor(g.swipeRight)} aria-hidden="true">{#if g.swipeRight !== 'none'}<Icon name={actIcon(g.swipeRight)} size={22} />{/if}</span>
    <span class="ck-sw ck-sw-l" style:background={actColor(g.swipeLeft)} aria-hidden="true">{#if g.swipeLeft !== 'none'}<Icon name={actIcon(g.swipeLeft)} size={22} />{/if}</span>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="ck-row" dir="auto" class:done={it.done} class:has-kids={kids(it) > 0} style:transform={sw?.line === it.line ? `translateX(${sw.dx}px)` : undefined}
      onpointerdown={(e) => down(e, it)} onpointermove={move} onpointerup={up} onpointercancel={up} onclickcapture={swallow}>
      {#if kids(it)}
        <button class="fold" aria-expanded={!closed} aria-label={it.text} onclick={() => fold(itemKey(it))}><span class="caret" class:open={!closed}><Icon name="chevron" size={16} /></span></button>
      {/if}
      <button class="tick" class:on={it.done} class:part={!it.done && kidsDone(it) > 0} role="checkbox" aria-checked={it.done} aria-label={it.text} disabled={readOnly} onclick={() => change(toggleItem(text, it.line))}>
        <Icon name="check-small" size={16} />
      </button>
      {#if editing === it.line}
        <input class="ck-edit" dir="auto" use:focus value={it.text} onblur={() => (editing = null)} onkeydown={(e) => {
          if (e.key === 'Enter') { change(editItem(text, it.line, e.currentTarget.value)); editing = null; }
          else if (e.key === 'Escape') editing = null;
        }} />
      {:else}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <span class="ck-label" onclick={(e) => onLabel(e, it)} ondblclick={() => { if (!readOnly && !boxOnly && g.tap !== 'edit' && finePointer) editing = it.line; }}>{#each pieces(it.text) as p}{#if p.kind === 'text'}{p.text}{:else}<a href={p.kind === 'url' ? p.target : '#'} class="clink" data-kind={p.kind} data-target={p.target}>{p.text}</a>{/if}{/each}</span>
        {#if kids(it)}<span class="ck-kids">{kidsDone(it)}/{kids(it)}</span>{/if}
        {#if !readOnly}
          <span class="ck-tools">
            <button class="icon sm" title={t('taskAddSub')} aria-label={t('taskAddSub')} onclick={() => { subOf = subOf === it.line ? null : it.line; subDraft = ''; }}><Icon name="plus" size={16} /></button>
            <button class="icon sm" title={t('taskEdit')} aria-label={t('taskEdit')} onclick={() => (editing = it.line)}><Icon name="edit" size={16} /></button>
            <button class="icon sm ck-del" title={t('delete')} aria-label={t('delete')} onclick={() => change(deleteItem(text, it.line), t('taskRemoved'))}><Icon name="trash" size={16} /></button>
            <span class="ck-menu-wrap">
              <button class="icon sm ck-menu-btn" aria-label={t('more')} onclick={() => (menuFor = menuFor?.line === it.line ? null : { line: it.line, moving: false })}><Icon name="more" size={16} /></button>
              {#if menuFor?.line === it.line}
                <div class="menu ck-pop" role="menu" transition:pop|global>
                  {#if menuFor.moving}
                    {#each list.sections as other}
                      {#if other !== sec}<button role="menuitem" onclick={() => { menuFor = null; change(moveItem(text, it.line, other.index)); }}>{pad(other.level)}{other.title ?? '—'}</button>{/if}
                    {/each}
                  {:else}
                    <button role="menuitem" onclick={() => { menuFor = null; subOf = it.line; subDraft = ''; }}>{t('taskAddSub')}</button>
                    <button role="menuitem" onclick={() => { menuFor = null; change(indentItem(text, it.line)); }}>{t('taskIndent')}</button>
                    {#if it.parent}<button role="menuitem" onclick={() => { menuFor = null; change(outdentItem(text, it.line)); }}>{t('taskOutdent')}</button>{/if}
                    {#if list.sections.length > 1 && !it.parent}<button role="menuitem" onclick={() => { if (menuFor) menuFor.moving = true; }}>{t('taskMoveTo')} ›</button>{/if}
                    <button role="menuitem" class="danger" onclick={() => { menuFor = null; change(deleteItem(text, it.line), t('taskRemoved')); }}>{t('delete')}</button>
                  {/if}
                </div>
              {/if}
            </span>
          </span>
        {/if}
      {/if}
    </div>
    {#if (kids(it) && !closed) || subOf === it.line}
      <div class="ck-sub" transition:slide|global={{ duration: 180 }}>
        {#if kids(it) && !closed}
          <ul class="ck-items">
            {#each it.children as k (k.line)}
              {@render row(k, sec)}
            {/each}
          </ul>
        {/if}
        {#if subOf === it.line && !readOnly}
          <form class="ck-add small" dir="auto" onsubmit={(e) => { e.preventDefault(); addSubtask(it.line); }}>
            <Icon name="plus" size={16} />
            <input dir="auto" use:focus bind:value={subDraft} placeholder={t('taskAddSub')} enterkeyhint="done" autocomplete="off" onblur={() => { if (!subDraft.trim()) subOf = null; }} onkeydown={(e) => { if (e.key === 'Escape') subOf = null; }} />
          </form>
        {/if}
      </div>
    {/if}
  </li>
{/snippet}

<style>
  /* the scrolling box (this was what stopped the page from scrolling) */
  .checklist { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; position: relative; }
  .ck-inner { max-width: 42rem; margin: 0 auto; padding: 1rem 1rem 7rem; }
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
  .ck-title { align-self: stretch; margin: 0 0 0.1rem; font-size: 1.5rem; line-height: 1.25; overflow-wrap: anywhere; text-align: start; }
  .ck-sum strong { font-size: 0.95rem; font-weight: 500; color: var(--muted); }
  .ck-del:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 14%, transparent); }
  .ck-actions { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  @media (max-width: 760px) { .ck-inner { padding-top: 4.6rem; } }
  .ck-sec { margin-top: 1.1rem; }
  .ck-sec .ck-sec { margin-inline-start: 0.9rem; padding-inline-start: 0.7rem; border-inline-start: 2px solid var(--hairline); }
  .ck-sec-head { display: flex; align-items: center; gap: 0.45rem; padding: 0 0.2rem; margin-bottom: 0.4rem; }
  .ck-sec-head h3 { margin: 0; flex: none; max-width: 70%; cursor: pointer; overflow-wrap: anywhere; text-align: start; }
  .l1 > .ck-sec-head h3 { font-size: 1.35rem; color: var(--ink); }
  .l2 > .ck-sec-head h3 { font-size: 1.05rem; color: var(--accent); }
  .l3 > .ck-sec-head h3, .l4 > .ck-sec-head h3, .l5 > .ck-sec-head h3, .l6 > .ck-sec-head h3 { font-size: 0.95rem; color: var(--muted); }
  .ck-rename { font: inherit; font-weight: 700; }
  .fold { flex: none; width: 1.6rem; height: 1.6rem; padding: 0; border: 0; background: transparent; color: var(--muted); display: grid; place-items: center; border-radius: 8px; }
  .fold:hover { background: var(--accent-soft); }
  .ck-count { font-size: 0.8rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .ck-count.all { color: var(--ok); }
  .ck-mini { flex: 1; min-width: 1rem; height: 4px; border-radius: 4px; background: var(--hairline); overflow: hidden; }
  .ck-mini i { display: block; height: 100%; background: var(--accent); border-radius: 4px; transition: width 0.4s; }
  .ck-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  .ck-row-wrap { position: relative; border-radius: 16px; }
  .ck-sw { position: absolute; inset-block: 0; display: grid; place-items: center; width: 100%; opacity: 0; transition: opacity 0.15s; border-radius: 16px; color: #fff; }
  .ck-sw { direction: ltr; }
  .ck-sw-r { justify-content: start; padding-left: 1.1rem; }
  .ck-sw-l { justify-content: end; padding-right: 1.1rem; }
  .r-side > .ck-sw-r, .l-side > .ck-sw-l { opacity: 1; }
  .ck-row { position: relative; display: flex; align-items: center; gap: 0.7rem; min-height: 3.4rem; padding: 0.35rem 0.6rem 0.35rem 0.9rem; padding-inline: 0.7rem 0.6rem; border-radius: 16px; background: var(--surface); border: 1px solid var(--hairline); touch-action: pan-y; transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), background 0.15s, border-color 0.15s; }
  .swiping .ck-row { transition: none; }
  .ck-row:hover { border-color: var(--accent); }
  .tick { flex: none; width: 1.7rem; height: 1.7rem; border-radius: 50%; border: 2px solid var(--muted); background: transparent; display: grid; place-items: center; color: transparent; padding: 0; transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.15s; }
  .tick:active { transform: scale(0.88); }
  .tick.part { border-color: var(--accent); background: var(--accent-soft); }
  .tick.on { background: var(--accent); border-color: var(--accent); color: var(--on-accent); animation: pop 0.3s cubic-bezier(0.2, 1.6, 0.4, 1); }
  .ck-label { flex: 1; min-width: 0; font-size: 1.05rem; line-height: 1.35; overflow-wrap: anywhere; cursor: pointer; padding-block: 0.5rem; text-align: start; }
  .ck-kids { flex: none; font-size: 0.78rem; color: var(--muted); background: var(--accent-soft); padding: 0.05rem 0.5rem; border-radius: 999px; font-variant-numeric: tabular-nums; }
  .done > .ck-row-wrap > .ck-row .ck-label, .ck-row.done .ck-label { color: var(--muted); text-decoration: line-through; text-decoration-thickness: 1.5px; }
  .ck-tools { display: flex; opacity: 0; transition: opacity 0.15s; }
  .ck-row:hover .ck-tools, .ck-row:focus-within .ck-tools { opacity: 1; }
  /* a phone has swipes and the ⋯ menu; the hover tools are for a mouse */
  @media (pointer: coarse) { .ck-tools { opacity: 1; } .ck-tools > button { display: none; } }
  .ck-sub { padding-inline-start: 1.6rem; margin-top: 0.3rem; }
  .ck-sub .ck-row { min-height: 3rem; }
  .ck-edit, .ck-add input, .ck-newsub input { flex: 1; min-width: 0; font: inherit; font-size: 1.05rem; }
  .ck-add { display: flex; align-items: center; gap: 0.7rem; margin-top: 0.4rem; padding: 0.2rem 0.9rem; min-height: 3rem; border-radius: 16px; border: 1.5px dashed var(--line); color: var(--muted); }
  .ck-add.small { min-height: 2.5rem; }
  .ck-add:focus-within { border-color: var(--accent); color: var(--accent); }
  .ck-add input { border: 0; background: transparent; box-shadow: none; outline: none; color: var(--ink); }
  .ck-donehead { margin-top: 0.7rem; display: flex; align-items: center; gap: 0.4rem; border: 0; background: transparent; color: var(--muted); font-size: 0.85rem; padding: 0.3rem 0.4rem; }
  .caret { display: inline-grid; transition: transform 0.2s; transform: rotate(-90deg); }
  :global([dir='rtl']) .caret { transform: rotate(90deg); }
  .caret.open, :global([dir='rtl']) .caret.open { transform: none; }
  .ck-items.done { margin-top: 0.3rem; opacity: 0.85; }
  .ck-newsec { margin-top: 1.6rem; }
  .ck-newsec input, .ck-newsub input { width: 100%; font-size: 1rem; margin-top: 0.4rem; }
  .ck-empty { text-align: center; padding: 2rem 0 0; }
  .ck-menu-wrap { position: relative; display: inline-flex; }
  .ck-pop { position: absolute; inset-inline-end: 0; top: 100%; z-index: 30; min-width: 11rem; transform-origin: top right; }
  .ck-pop .danger { color: var(--danger); }
  .ck-undo { position: fixed; inset-inline: 1rem; bottom: calc(1.2rem + env(safe-area-inset-bottom)); max-width: 26rem; margin-inline: auto; display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.7rem 1rem; border-radius: 14px; background: var(--ink); color: var(--bg); box-shadow: var(--shadow); z-index: 40; }
  .ck-undo button { border: 0; background: transparent; color: var(--accent-soft); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  .clink { color: var(--accent); text-decoration: none; }
  @keyframes pop { 0% { transform: scale(0.6); } 100% { transform: scale(1); } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>
