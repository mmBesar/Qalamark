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
  import type { Sub } from '../lib/kanban.ts';
  import type { NoteRow } from '../lib/base.ts';
  import { readFrontMatter } from '../lib/frontmatter.ts';
  import { addCard, addColumn, addSub, boardKind, cardProgress, deleteCard, deleteColumn, deleteSub, editCard, moveCard, parseBoard, renameColumn, setBoardKind, toggleCard, toggleSub } from '../lib/kanban.ts';

  let { ytext, readOnly, noteId, onList }: { ytext: YText; readOnly: boolean; noteId?: string; onList?: () => void } = $props();
  const t = store.t;

  let text = $state(ytext.toString());
  const board = $derived(parseBoard(text));
  const kind = $derived(boardKind(text));
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
    if (drag) relocate(drag.c, drag.i, c, i);
    drag = over = null;
  }
  // ── touch: press a card for a moment, then drag it to another column (HTML5 drag and drop does not exist on phones) ──
  let press: { id: number; x: number; y: number; c: number; i: number; dx: number; dy: number; w: number; h: number; text: string; timer: ReturnType<typeof setTimeout> } | null = null;
  let ghost = $state<{ x: number; y: number; w: number; h: number; text: string } | null>(null);
  let touchDragging = false;
  let lastX = 0;
  let edge: ReturnType<typeof setInterval> | undefined;

  function cardDown(e: PointerEvent, c: number, i: number, text: string) {
    if (e.pointerType === 'mouse' || readOnly || editing !== null || press) return;
    if ((e.target as HTMLElement).closest('button, a, input, textarea, .steps, .stages, .addform')) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, c, i, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height, text: clean(text) || text, timer: setTimeout(startTouchDrag, 380) };
  }
  function startTouchDrag() {
    if (!press) return;
    touchDragging = true;
    drag = { c: press.c, i: press.i };
    ghost = { x: press.x - press.dx, y: press.y - press.dy, w: press.w, h: press.h, text: press.text };
    lastX = press.x;
    try { navigator.vibrate?.(18); } catch { /* no vibration */ }
    // keep the column strip still while a finger is dragging: a timer scrolls it when the finger is at an edge
    edge = setInterval(() => {
      if (!scroller) return;
      const r = scroller.getBoundingClientRect();
      const d = lastX < r.left + 48 ? -14 : lastX > r.right - 48 ? 14 : 0;
      if (d) scroller.scrollLeft += d;
    }, 16);
  }
  function cardMove(e: PointerEvent) {
    if (!press || e.pointerId !== press.id) return;
    if (!touchDragging) { if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) endPress(false); return; }
    lastX = e.clientX;
    if (ghost) ghost = { ...ghost, x: e.clientX - press.dx, y: e.clientY - press.dy };
    const col = document.elementFromPoint(e.clientX, e.clientY)?.closest('.bcol') as HTMLElement | null;
    const ci = col ? Array.from(scroller?.querySelectorAll('.bcol') ?? []).indexOf(col) : -1;
    if (!col || ci < 0) { over = null; return; }
    const cards = Array.from(col.querySelectorAll<HTMLElement>('li.card'));
    const after = cards.find((el) => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    over = { c: ci, i: after ? Number(after.dataset.i) : board.columns[ci]!.cards.length };
  }
  function cardUp(e: PointerEvent) {
    if (!press || e.pointerId !== press.id) return;
    endPress(touchDragging && e.type === 'pointerup');
  }
  function endPress(commit: boolean) {
    if (!press) return;
    clearTimeout(press.timer);
    clearInterval(edge);
    if (touchDragging && commit && over) drop(over.c, over.i);
    drag = over = null;
    ghost = null;
    touchDragging = false;
    press = null;
  }
  // a finger that is dragging a card must not also scroll the page
  function holdScroll(node: HTMLElement) {
    const h = (e: TouchEvent) => { if (touchDragging && e.cancelable) e.preventDefault(); };
    node.addEventListener('touchmove', h, { passive: false });
    return { destroy: () => node.removeEventListener('touchmove', h) };
  }

  async function removeColumn(c: number) {
    const col = board.columns[c]!;
    if (col.cards.length && !(await confirmBox(t('deleteColumnAsk', { name: col.title, n: col.cards.length })))) return;
    apply(deleteColumn(text, c));
  }
  const focus = (el: HTMLElement) => el.focus();

  // ── cards that are notes: a card with a [[link]] shows that note's properties, and moving it writes the note's status ──
  let rows = $state<NoteRow[]>([]);
  const targetOf = (s: string) => /\[\[([^\]|#\n]+)/.exec(s)?.[1]?.trim() ?? '';
  const linkKey = $derived(board.columns.flatMap((c) => c.cards.map((k) => targetOf(k.text))).join('|'));
  $effect(() => {
    if (linkKey.replace(/\|/g, '')) void store.baseRows().then((r) => (rows = r)).catch(() => {});
  });
  const fm = $derived(readFrontMatter(text)?.props ?? []);
  const fmText = (k: string) => { const p = fm.find((x) => x.key.toLowerCase() === k); return p ? (p.type === 'list' ? p.items.join(',') : p.text) : ''; };
  const statusKey = $derived(fmText('status-prop').trim() || 'status');
  const fieldKeys = $derived(fmText('card-props').split(',').map((x) => x.trim()).filter(Boolean));
  const noteRow = (cardText: string) => { const tt = targetOf(cardText).toLowerCase(); return tt ? rows.find((r) => r.title.toLowerCase() === tt && r.id !== noteId) : undefined; };
  const propText = (r: NoteRow, k: string) => { const p = r.props.find((x) => x.key.toLowerCase() === k.toLowerCase()); return p ? (p.type === 'list' ? p.items.join(', ') : p.text).trim() : ''; };
  const HIDE = new Set(['tags', 'tag', 'aliases', 'kanban', 'cssclasses']);
  function facts(r: NoteRow): Array<{ k: string; v: string }> {
    const keys = fieldKeys.length ? fieldKeys : r.props.map((p) => p.key).filter((k) => k.toLowerCase() !== statusKey.toLowerCase() && !HIDE.has(k.toLowerCase()));
    return keys.map((k) => ({ k, v: propText(r, k) })).filter((f) => f.v).slice(0, fieldKeys.length ? 6 : 3);
  }
  const DATEY = /^(due|scheduled|publish|publish-date|published|date)$/i;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
  const noteDue = (r?: NoteRow) => r?.props.map((p) => ({ k: p.key, v: p.text })).find((p) => DATEY.test(p.k) && DATE_RE.test(p.v))?.v.slice(0, 10) ?? null;
  const noteStatus = (r?: NoteRow) => (r ? propText(r, statusKey) : '');
  async function syncNote(cardText: string, title: string) {
    const r = noteRow(cardText);
    if (!r || noteStatus(r).toLowerCase() === title.toLowerCase()) return;
    await store.setNoteProp(r.id, statusKey, 'text', title);
    rows = await store.baseRows();
  }
  /** Move a card; when it is a note, its status follows the column. */
  function relocate(c: number, i: number, to: number, at = 1e9) {
    const card = board.columns[c]?.cards[i];
    const dest = board.columns[to]?.title;
    apply(moveCard(text, c, i, to, at));
    if (card && dest && to !== c) void syncNote(card.text, dest);
  }
  /** The note says another stage than the column the card is in: follow the note. */
  function followNote(c: number, i: number, status: string) {
    const to = board.columns.findIndex((x) => x.title.toLowerCase() === status.toLowerCase());
    if (to >= 0 && to !== c) apply(moveCard(text, c, i, to, 1e9));
  }
  async function noteFromDraft(c: number) {
    const name = draft.trim().replace(/[[\]|#]/g, '');
    if (!name || readOnly) return;
    const home = store.notes.find((n) => n.id === noteId);
    const folder = fmText('card-folder').trim() || home?.folder || '';
    const prev = store.currentId;
    const id = await store.createNote(name, `---\n${statusKey}: ${board.columns[c]!.title}\n---\n\n# ${name}\n`, folder);
    store.currentId = prev;
    const made = store.notes.find((n) => n.id === id)?.title ?? name;
    apply(addCard(text, c, `[[${made}]]`));
    draft = '';
    rows = await store.baseRows();
  }

  // ── steps, stages and moving ──
  let open = $state<Set<string>>(new Set());
  let moving = $state<string | null>(null);
  let stepDraft = $state('');
  // step templates: a property `steps-bug: [Reproduce, Fix, Test]` on the board note gives every card tagged #bug those steps
  const templates = $derived.by(() => {
    const out: Record<string, string[]> = {};
    for (const p of readFrontMatter(text)?.props ?? []) {
      const m = /^steps?[-_.](.+)$/i.exec(p.key);
      if (!m) continue;
      const list = (p.type === 'list' ? p.items : p.text.split(/[,،]/)).map((x) => x.trim()).filter(Boolean);
      if (list.length) out[m[1]!.toLowerCase()] = list;
    }
    return out;
  });
  const templateFor = (card: { text: string; subs: unknown[] }): { tag: string; steps: string[] } | null => {
    if (card.subs.length) return null;
    for (const tg of tags(card.text)) { const st = templates[tg.toLowerCase()]; if (st) return { tag: tg, steps: st }; }
    return null;
  };
  function applyTemplate(c: number, i: number, steps: string[], stage: string | null) {
    let next = text;
    for (const label of steps) next = addSub(next, c, i, label, stage);
    apply(next);
  }
  const key = (c: number, i: number) => `${c}:${i}`;
  const toggleOpen = (k: string) => { const n = new Set(open); n.has(k) ? n.delete(k) : n.add(k); open = n; };
  const stepsOf = (card: { subs: Sub[] }, title: string) =>
    card.subs.map((s, n) => ({ s, n })).filter(({ s }) => (kind === 'pipeline' ? s.stage === title : s.stage === null || s.stage === title));
  function goTo(c: number, i: number, to: number) {
    moving = null;
    if (to !== c) relocate(c, i, to);
  }
  function cardKeys(e: KeyboardEvent, c: number, i: number) {
    if (readOnly || !e.altKey || (e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'INPUT') return;
    const rtl = store.lang === 'ar';
    const step = e.key === 'ArrowRight' ? (rtl ? -1 : 1) : e.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
    if (!step || c + step < 0 || c + step >= board.columns.length) return;
    e.preventDefault();
    goTo(c, i, c + step);
  }

  // ── filters, due dates, progress ──
  let query = $state('');
  let tagOn = $state<string | null>(null);
  const allTags = $derived([...new Set(board.columns.flatMap((c) => c.cards.flatMap((k) => tags(k.text))))].sort());
  const shown = (text: string) => (!tagOn || tags(text).includes(tagOn)) && (!query.trim() || text.toLowerCase().includes(query.trim().toLowerCase()));
  const DUE = /(?:📅|🗓️?|due:|@due\()\s*(\d{4}-\d{2}-\d{2})/u;
  const dueOf = (s: string) => DUE.exec(s)?.[1] ?? null;
  const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = day(new Date());
  const dueState = (d: string, done: boolean | null) => (done ? 'ok' : d < today ? 'late' : d === today ? 'today' : 'soon');
  const clean = (s: string) => plain(s).replace(new RegExp(DUE.source, 'gu'), '').replace(/\s+/g, ' ').trim();
  const total = $derived(board.columns.reduce((n, c) => n + c.cards.filter((k) => k.done !== null).length, 0));
  const finished = $derived(board.columns.reduce((n, c) => n + c.cards.filter((k) => k.done).length, 0));
  const lateCount = $derived(board.columns.reduce((n, c) => n + c.cards.filter((k) => { const d = dueOf(k.text); return d && !k.done && d < today; }).length, 0));
  const colDone = (c: { cards: Array<{ done: boolean | null }> }) => { const n = c.cards.filter((k) => k.done !== null).length; return n ? Math.round((100 * c.cards.filter((k) => k.done).length) / n) : -1; };

  // phones: one column fills the screen; the strip on top shows where you are and jumps
  let scroller: HTMLElement;
  let at = $state(0);
  function seen() {
    if (!scroller) return;
    const cols = [...scroller.querySelectorAll<HTMLElement>('.bcol:not(.newcol)')];
    const mid = scroller.getBoundingClientRect().left + scroller.clientWidth / 2;
    let best = 0, gap = 1e9;
    cols.forEach((el, i) => { const r = el.getBoundingClientRect(); const d = Math.abs(r.left + r.width / 2 - mid); if (d < gap) { gap = d; best = i; } });
    at = best;
  }
  function jump(i: number) {
    scroller.querySelectorAll<HTMLElement>('.bcol:not(.newcol)')[i]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
</script>

<svelte:window onpointermove={cardMove} onpointerup={cardUp} onpointercancel={cardUp} />

<div class="boardwrap">
<div class="btools">
  <div class="bsum" title={t('boardProgress')}>
    <div class="bar"><i style:width="{total ? (100 * finished) / total : 0}%"></i></div>
    <span>{finished}/{total}{#if lateCount} · <b class="late">{t('boardLate', { n: lateCount })}</b>{/if}</span>
  </div>
  <input class="bfind" type="search" bind:value={query} placeholder={t('boardFilter')} aria-label={t('boardFilter')} />
  {#if !readOnly}<button class="ghost small kindbtn" class:on={kind === 'pipeline'} aria-pressed={kind === 'pipeline'} title={t('boardPipelineHint')} onclick={() => apply(setBoardKind(text, kind === 'pipeline' ? 'board' : 'pipeline'))}>{t('boardPipeline')}</button>{/if}
  {#if onList}<button class="ghost small listbtn" onclick={onList}><Icon name="outline" size={15} /> {t('boardList')}</button>{/if}
</div>
{#if allTags.length}
  <div class="btags" role="group">
    <button class:on={tagOn === null} onclick={() => (tagOn = null)}>{t('boardAll')}</button>
    {#each allTags as tg}<button class:on={tagOn === tg} onclick={() => (tagOn = tagOn === tg ? null : tg)}>#{tg}</button>{/each}
  </div>
{/if}
<nav class="bstrip" aria-label={t('modeBoard')}>
  {#each board.columns as col, c}<button class:on={at === c} onclick={() => jump(c)}>{col.title} <small>{col.cards.length}</small></button>{/each}
</nav>
<div class="board" class:dragging={!!ghost} role="region" aria-label={t('modeBoard')} bind:this={scroller} onscroll={seen} use:holdScroll>
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
      {#if colDone(col) >= 0}<div class="cbar" title="{colDone(col)}%"><i style:width="{colDone(col)}%"></i></div>{/if}

      <ul>
        {#each col.cards as card, i (card.start + ':' + card.text)}
          {#if shown(card.text)}
          <li class="card" dir="auto" data-i={i} class:done={card.done} class:dragging={drag?.c === c && drag.i === i} class:before={over?.c === c && over.i === i && drag}
            onkeydown={(e) => cardKeys(e, c, i)}
            onpointerdown={(e) => cardDown(e, c, i, card.text)}
            oncontextmenu={(e) => { if (press) e.preventDefault(); }}
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
                  {#each pieces(clean(card.text) || card.text) as p}{#if p.kind === 'text'}{p.text}{:else}<a href={p.kind === 'url' ? p.target : '#'} class="clink" data-kind={p.kind} data-target={p.target}>{p.text}</a>{/if}{/each}
                </div>
              </div>
              {#if kind === 'pipeline'}
                <div class="stages" role="group" aria-label={t('boardStages')}>
                  {#each board.columns as sc, j}
                    {@const share = j < c ? 1 : j === c ? cardProgress('board', { ...card, subs: card.subs.filter((x) => x.stage === col.title) }, 0, 1, '') : 0}
                    <button class="seg" class:cur={j === c} title={sc.title} aria-label={sc.title} disabled={readOnly} onclick={() => goTo(c, i, j)}><i style:width="{j === c && !card.subs.some((x) => x.stage === col.title) ? (card.done ? 100 : 0) : share * 100}%"></i></button>
                  {/each}
                </div>
              {:else if card.subs.length}
                <div class="cbar subbar"><i style:width="{(100 * card.subs.filter((x) => x.done).length) / card.subs.length}%"></i></div>
              {/if}
              {#if open.has(key(c, i))}
                <ul class="steps">
                  {#each stepsOf(card, col.title) as { s: st, n }}
                    <li class:done={st.done}>
                      <button class="tick" class:on={st.done} aria-label={st.text} aria-pressed={st.done} disabled={readOnly} onclick={() => apply(toggleSub(text, c, i, n))}>{#if st.done}<Icon name="check-small" size={12} />{/if}</button>
                      <span>{st.text}</span>
                      {#if !readOnly}<button class="icon sm" aria-label={t('delete')} onclick={() => apply(deleteSub(text, c, i, n))}><Icon name="trash" size={12} /></button>{/if}
                    </li>
                  {/each}
                </ul>
                {#if !readOnly}
                  {#if templateFor(card)}
                    {@const tpl = templateFor(card)!}
                    <button class="ghost small tplbtn" onclick={() => applyTemplate(c, i, tpl.steps, kind === 'pipeline' ? col.title : null)}>＋ {t('boardTemplate', { tag: tpl.tag, n: tpl.steps.length })}</button>
                  {/if}
                  <form class="addform stepadd" onsubmit={(e) => { e.preventDefault(); apply(addSub(text, c, i, stepDraft, kind === 'pipeline' ? col.title : null)); stepDraft = ''; }}>
                    <input bind:value={stepDraft} placeholder={t('boardStepText')} aria-label={t('boardStepText')} />
                  </form>
                {/if}
              {/if}
              {#if card.extra.length}<p class="extra">{card.extra.join(' · ')}</p>{/if}
              {#if noteRow(card.text)}
                {@const nr = noteRow(card.text)!}
                {@const ns = noteStatus(nr)}
                <div class="nprops">
                  {#each facts(nr) as f}<span><em>{f.k}</em> {f.v}</span>{/each}
                  {#if ns && ns.toLowerCase() !== col.title.toLowerCase()}
                    <button class="drift" title={t('boardDrift')} onclick={() => followNote(c, i, ns)}>↻ {ns}</button>
                  {/if}
                </div>
              {/if}
              {#if tags(card.text).length || dueOf(card.text) || noteDue(noteRow(card.text))}<div class="ctags">{#if dueOf(card.text) || noteDue(noteRow(card.text))}{@const dd = dueOf(card.text) ?? noteDue(noteRow(card.text))!}<span class="due {dueState(dd, card.done)}">📅 {dd}</span>{/if}{#each tags(card.text) as tg}<span>#{tg}</span>{/each}</div>{/if}
              {#if !readOnly}
                <div class="cact">
                  <button class="icon sm stepbtn" class:on={open.has(key(c, i))} aria-label={t('boardSteps')} title={t('boardSteps')} aria-expanded={open.has(key(c, i))} onclick={() => toggleOpen(key(c, i))}><Icon name="check-small" size={14} />{#if card.subs.length}<small>{card.subs.filter((x) => x.done).length}/{card.subs.length}</small>{/if}</button>
                  <div class="movewrap">
                    <button class="icon sm" aria-label={t('moveTo')} title="{t('moveTo')} · Alt+←/→" aria-expanded={moving === key(c, i)} onclick={() => (moving = moving === key(c, i) ? null : key(c, i))}><Icon name="more" size={14} /></button>
                    {#if moving === key(c, i)}
                      <div class="movemenu" role="menu">
                        <b>{t('moveTo')}</b>
                        {#each board.columns as mc, j}<button role="menuitem" class:here={j === c} onclick={() => goTo(c, i, j)}>{mc.title} <small>{mc.cards.length}</small></button>{/each}
                      </div>
                    {/if}
                  </div>
                  <button class="icon sm" aria-label={t('moveLeft')} title={t('moveLeft')} disabled={c === 0} onclick={() => relocate(c, i, c - 1)}><Icon name={store.lang === 'ar' ? 'chevron-right' : 'chevron-left'} size={14} /></button>
                  <button class="icon sm" aria-label={t('moveRight')} title={t('moveRight')} disabled={c === board.columns.length - 1} onclick={() => relocate(c, i, c + 1)}><Icon name={store.lang === 'ar' ? 'chevron-left' : 'chevron-right'} size={14} /></button>
                  <button class="icon sm" aria-label={t('delete')} title={t('delete')} onclick={() => apply(deleteCard(text, c, i))}><Icon name="trash" size={14} /></button>
                </div>
              {/if}
            {/if}
          </li>
          {/if}
        {/each}
      </ul>

      {#if !readOnly}
        {#if adding === c}
          <form class="addform" onsubmit={(e) => { e.preventDefault(); submitCard(c); }}>
            <!-- svelte-ignore a11y_autofocus -->
            <input bind:value={draft} placeholder={t('cardText')} use:focus use:linkSuggest={{ here: noteId }} onkeydown={(e) => e.key === 'Escape' && ((adding = null), (draft = ''))} onblur={() => { if (!draft.trim()) adding = null; }} />
            <button class="primary small" type="submit">{t('add')}</button>
            <button class="ghost small" type="button" title={t('boardNewNote')} aria-label={t('boardNewNote')} disabled={!draft.trim()} onmousedown={(e) => e.preventDefault()} onclick={() => noteFromDraft(c)}><Icon name="note" size={14} />+</button>
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
</div>

{#if ghost}
  <div class="card-ghost" dir="auto" aria-hidden="true" style:left="{ghost.x}px" style:top="{ghost.y}px" style:width="{ghost.w}px">{ghost.text}</div>
{/if}

<style>
  .card-ghost { position: fixed; z-index: 120; pointer-events: none; padding: 0.6rem 0.75rem; border-radius: 12px; background: var(--surface, var(--bg)); border: 1px solid var(--accent); box-shadow: 0 14px 34px rgb(0 0 0 / 0.4); transform: rotate(2.5deg) scale(1.03); opacity: 0.96; overflow: hidden; max-height: 9rem; }
  .board.dragging { scroll-snap-type: none !important; }
  @media (pointer: coarse) { .card { -webkit-touch-callout: none; user-select: none; -webkit-user-select: none; } }
  .boardwrap { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .btools { display: flex; align-items: center; gap: 0.7rem; padding: 0.7rem 1.2rem 0; flex-wrap: wrap; }
  .bsum { display: flex; align-items: center; gap: 0.5rem; font-size: 0.82rem; color: var(--muted); }
  .bar, .cbar { height: 6px; border-radius: 6px; background: color-mix(in srgb, var(--ink) 10%, transparent); overflow: hidden; }
  .bar { width: 7rem; }
  .bar i, .cbar i { display: block; height: 100%; background: var(--accent); border-radius: 6px; transition: width 0.25s; }
  .cbar { margin: 0 0.3rem; height: 4px; }
  .late { color: var(--danger, #d20f39); font-weight: 600; }
  .bfind { flex: 1; min-width: 8rem; max-width: 18rem; }
  .listbtn { display: inline-flex; gap: 0.35rem; align-items: center; margin-inline-start: auto; }
  .btags { display: flex; gap: 0.35rem; padding: 0.5rem 1.2rem 0; overflow-x: auto; }
  .btags button { flex: none; font-size: 0.78rem; padding: 0.1rem 0.65rem; border-radius: 99px; border: 1px solid var(--line); background: none; color: var(--muted); }
  .btags button.on { background: var(--accent); color: var(--accent-ink, #fff); border-color: var(--accent); }
  .bstrip { display: none; }
  .due { background: color-mix(in srgb, var(--ink) 8%, transparent) !important; color: var(--muted) !important; }
  .due.late { background: color-mix(in srgb, var(--danger, #d20f39) 16%, transparent) !important; color: var(--danger, #d20f39) !important; }
  .due.today { background: color-mix(in srgb, #df8e1d 22%, transparent) !important; color: #df8e1d !important; }
  .due.ok { text-decoration: line-through; opacity: 0.6; }
  @media (max-width: 760px) {
    .btools { padding: 4rem 0.9rem 0; }
    .btools .bfind { order: 3; max-width: none; flex-basis: 100%; }
    .bstrip { display: flex; gap: 0.4rem; padding: 0.55rem 0.9rem 0; overflow-x: auto; scrollbar-width: none; }
    .bstrip button { flex: none; border-radius: 99px; padding: 0.3rem 0.8rem; font-size: 0.85rem; border: 1px solid var(--line); background: none; color: var(--muted); }
    .bstrip button.on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); font-weight: 600; }
    .bstrip small { opacity: 0.7; }
    .board { scroll-snap-type: x mandatory; padding: 0.7rem 0.9rem 6.5rem !important; gap: 0.7rem; scroll-padding-inline: 0.9rem; }
    .bcol { flex: 0 0 86vw !important; max-width: none !important; scroll-snap-align: center; }
    .bcol ul { max-height: none; }
  }
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
  .nprops { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.45rem; }
  .nprops span { font-size: 0.76rem; padding: 0 0.5rem; border-radius: 6px; background: color-mix(in srgb, var(--ink) 7%, transparent); color: var(--muted); }
  .nprops em { font-style: normal; opacity: 0.65; margin-inline-end: 0.2rem; }
  .drift { font-size: 0.76rem; padding: 0 0.55rem; border-radius: 6px; border: 1px dashed var(--accent); background: var(--accent-soft); color: var(--accent); min-height: 0; }
  .kindbtn.on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
  .stages { display: flex; gap: 3px; margin-top: 0.45rem; }
  .seg { flex: 1; height: 7px; padding: 0; border: 0; border-radius: 4px; background: color-mix(in srgb, var(--ink) 11%, transparent); overflow: hidden; min-height: 0; }
  .seg i { display: block; height: 100%; background: var(--accent); border-radius: 4px; transition: width 0.25s; }
  .seg.cur { outline: 1.5px solid var(--accent); outline-offset: 1px; }
  .subbar { margin: 0.45rem 0 0; }
  .steps { list-style: none; margin: 0.5rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; overflow: visible; }
  .steps li { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; }
  .steps li span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .steps li.done span { color: var(--muted); text-decoration: line-through; }
  .stepadd { margin-top: 0.4rem; }
  .stepbtn { width: auto; padding: 0 0.4rem; display: inline-flex; gap: 0.25rem; align-items: center; }
  .stepbtn.on { color: var(--accent); }
  .grow { flex: 1; }
  .movewrap { position: relative; }
  .movemenu { position: absolute; inset-inline-end: 0; bottom: 110%; z-index: 20; min-width: 11rem; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); padding: 0.3rem; display: flex; flex-direction: column; }
  .movemenu b { font-size: 0.72rem; color: var(--muted); padding: 0.3rem 0.6rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .movemenu button { text-align: start; background: none; border: 0; border-radius: 8px; padding: 0.55rem 0.7rem; min-height: 2.4rem; display: flex; justify-content: space-between; gap: 1rem; color: var(--ink); }
  .movemenu button:hover { background: var(--accent-soft); }
  .movemenu button.here { color: var(--accent); font-weight: 700; }
</style>
