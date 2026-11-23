<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import Select from './Select.svelte';
  import Icon from './Icon.svelte';
  import { onMount } from 'svelte';
  import type { Text as YText } from 'yjs';
  import { COMMON_PROPS, KEY_CHOICES, readFrontMatter, type Prop, type PropType, VIEW_PROPS, withProps } from '../lib/frontmatter.ts';
  import { pop } from '../lib/motion.ts';
  import { fade } from 'svelte/transition';
  import { store } from '../lib/store.svelte.ts';

  let { ytext, readOnly, noteId }: { ytext: YText; readOnly: boolean; noteId: string } = $props();
  const t = store.t;

  let doc = $state(ytext.toString());
  let openPanel = $state(false);
  let adding = $state(false);
  let newKey = $state('');
  let newType = $state<PropType>('text');

  onMount(() => {
    const h = () => {
      doc = ytext.toString();
      store.setDisplay(noteId, readFrontMatter(doc)?.props.find((x) => x.key.toLowerCase() === 'title')?.text ?? '');
    };
    h();
    ytext.observe(h);
    return () => ytext.unobserve(h);
  });

  const fm = $derived(readFrontMatter(doc));
  const plist = $derived(fm?.props ?? []);

  /** Replace only the front matter, leaving the rest of the note untouched. */
  function commit(next: Prop[]) {
    if (readOnly) return;
    const cur = ytext.toString();
    const target = withProps(cur, next);
    if (target === cur) return;
    const old = readFrontMatter(cur);
    const oldEnd = old ? old.end : 0;
    const head = target.length - (cur.length - oldEnd); // length of the new front matter
    ytext.doc?.transact(() => {
      ytext.delete(0, oldEnd);
      ytext.insert(0, target.slice(0, head));
    });
    // The title property and the file name are one thing: changing one renames the other.
    const titleOf = (ps: Prop[]) => ps.find((x) => x.key.toLowerCase() === 'title')?.text.trim() ?? '';
    const was = titleOf(old?.props ?? []);
    const now = titleOf(next);
    if (now && now !== was) void store.renameNote(noteId, now).catch(() => {});
  }

  const update = (i: number, patch: Partial<Prop>) => commit(plist.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const remove = (i: number) => commit(plist.filter((_, k) => k !== i));
  function addProp(key: string, type: PropType, value?: string) {
    const k = key.trim().replace(/[:\n]/g, '');
    if (!k || plist.some((p) => p.key.toLowerCase() === k.toLowerCase())) return;
    const known = COMMON_PROPS.find((c) => c.key === k.toLowerCase());
    commit([...plist, { key: k, type: known?.type ?? type, text: value ?? known?.value ?? (type === 'checkbox' ? 'false' : ''), items: [] }]);
    adding = false;
    newKey = '';
    openPanel = true;
  }
  function setItems(i: number, raw: string) {
    update(i, { items: raw.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean) });
  }
  const ICON: Record<string, string> = { title: 'type', tags: 'tag', tag: 'tag', aliases: 'link', alias: 'link', description: 'text', summary: 'text', date: 'calendar', created: 'calendar', updated: 'calendar', modified: 'calendar', due: 'clock', start: 'calendar', end: 'calendar', author: 'user', url: 'globe', link: 'globe', source: 'link', cssclasses: 'layers', kanban: 'board', view: 'board', tap: 'check', status: 'target', priority: 'flag', project: 'briefcase', category: 'folder', type: 'layers', location: 'mappin', rating: 'star', progress: 'percent', cover: 'image', related: 'link', pinned: 'pin', draft: 'check-box', publish: 'check-box' };
  const iconFor = (p: Prop) => store.s.propIcons?.[p.key.toLowerCase()] ?? ICON[p.key.toLowerCase()] ?? (p.type === 'checkbox' ? 'check-box' : p.type === 'list' ? 'list' : p.type === 'number' ? 'hash' : 'text');
  const viewOf = $derived((plist.find((p) => p.key.toLowerCase() === 'view')?.text ?? '').trim().toLowerCase());
  const unused = $derived([
    ...COMMON_PROPS,
    ...(VIEW_PROPS[viewOf] ?? []),
  ].filter((c) => !plist.some((p) => p.key.toLowerCase() === c.key)));
  // the choices for a property the app knows the values of (plus the current value, if it is something else)
  const choices = (p: Prop) => {
    const base = KEY_CHOICES[p.key.toLowerCase()];
    if (!base) return null;
    const cur = p.text.trim();
    return (cur && !base.includes(cur) ? [cur, ...base] : base).map((v) => ({ value: v, label: v }));
  };
  const TYPES: Array<[string, string]> = [['text', 'typeText'], ['list', 'typeList'], ['number', 'typeNumber'], ['checkbox', 'typeCheckbox']];

  // ── the name list: our own, themed, and it knows what your other notes use ──
  let sugOpen = $state(false);
  let sugHi = $state(0);
  let nameBox = $state<HTMLInputElement>();
  let sugPos = $state({ x: 0, y: 0, w: 0, up: false });
  const sugs = $derived.by(() => {
    const q = newKey.trim().toLowerCase();
    const have = new Set(plist.map((p) => p.key.toLowerCase()));
    const out: Array<{ key: string; type: PropType; value?: string; mine: boolean }> = [];
    const seen = new Set<string>();
    for (const c of COMMON_PROPS) { if (!have.has(c.key) && !seen.has(c.key)) { seen.add(c.key); out.push({ ...c, mine: false }); } }
    for (const k of store.knownPropKeys) { const l = k.toLowerCase(); if (!have.has(l) && !seen.has(l)) { seen.add(l); out.push({ key: k, type: 'text', mine: true }); } }
    return out.filter((x) => !q || x.key.toLowerCase().includes(q)).slice(0, 40);
  });
  function openSug() {
    void store.loadKnownPropKeys();
    if (!nameBox) return;
    const r = nameBox.getBoundingClientRect();
    const room = innerHeight - r.bottom;
    sugPos = { x: r.left, y: room < 260 ? r.top : r.bottom + 4, w: Math.max(r.width, 220), up: room < 260 };
    sugHi = 0;
    sugOpen = true;
  }
  function pickSug(i: number) {
    const x = sugs[i];
    if (!x) return;
    sugOpen = false;
    addProp(x.key, x.type, x.value);
  }
  function sugKey(e: KeyboardEvent) {
    if (!sugOpen && (e.key === 'ArrowDown')) { openSug(); e.preventDefault(); return; }
    if (!sugOpen) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sugHi = Math.min(sugs.length - 1, sugHi + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sugHi = Math.max(0, sugHi - 1); }
    else if (e.key === 'Enter' && sugs[sugHi] && newKey.trim() && sugs[sugHi]!.key.toLowerCase().startsWith(newKey.trim().toLowerCase()) && sugs[sugHi]!.key.toLowerCase() !== newKey.trim().toLowerCase()) { e.preventDefault(); pickSug(sugHi); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); sugOpen = false; }
  }

  // ── choose the icon of a property ──
  const ICONS = ['text', 'type', 'tag', 'hash', 'calendar', 'clock', 'check-box', 'list', 'link', 'globe', 'user', 'users', 'star', 'flag', 'bookmark', 'pin', 'bell', 'target', 'trophy', 'rocket', 'bolt', 'flame', 'heart', 'smile', 'sun', 'moon', 'leaf', 'mail', 'phone', 'mappin', 'image', 'camera', 'video', 'music', 'book', 'briefcase', 'home', 'cart', 'gift', 'dollar', 'percent', 'key', 'lock', 'wrench', 'folder', 'layers', 'board', 'code', 'fx'];
  let iconFor_ = $state<{ key: string; x: number; y: number } | null>(null);
  function openIcons(e: MouseEvent, key: string) {
    if (readOnly) return;
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    iconFor_ = { key, x: Math.max(8, Math.min(r.left, innerWidth - 290)), y: r.bottom + 6 > innerHeight - 260 ? Math.max(8, r.top - 252) : r.bottom + 6 };
  }
  const pickIcon = (icon: string | null) => { if (iconFor_) store.setPropIcon(iconFor_.key, icon); iconFor_ = null; };
  const tags = $derived(plist.find((p) => p.key.toLowerCase() === 'tags')?.items ?? []);
</script>

{#if fm || !readOnly}
  <div class="props" class:open={openPanel}>
    <button class="props-head" onclick={() => (openPanel = !openPanel)} aria-expanded={openPanel}>
      <span class="caret">{openPanel ? '▾' : store.lang === 'ar' ? '◂' : '▸'}</span>
      <strong>{t('properties')}</strong>
      {#if !openPanel}
        <span class="props-summary">
          {#each tags as tag (tag)}<span class="tag">#{tag}</span>{/each}
          {#if plist.length > 0 && tags.length === 0}<span class="muted">{plist.length}</span>{/if}
        </span>
      {/if}
    </button>

    {#if openPanel}
      {#if fm && !fm.editable}
        <p class="muted tiny">{t('propsComplex')}</p>
      {:else}
        <div class="props-grid">
          {#each plist as p, i (p.key)}
            <span class="pkey"><button type="button" class="pico" title={t('propIcon')} aria-label={t('propIcon')} disabled={readOnly} onclick={(e) => openIcons(e, p.key)}><Icon name={iconFor(p)} size={15} /></button><label for={'p' + i}>{p.key}</label></span>
            {#if p.type === 'checkbox'}
              <span class="pcheck">
                <input id={'p' + i} type="checkbox" checked={p.text === 'true'} disabled={readOnly} onchange={(e) => update(i, { text: e.currentTarget.checked ? 'true' : 'false' })} />
                <span class="pbox" aria-hidden="true"><Icon name="check-small" size={16} /></span>
              </span>
            {:else if choices(p)}
              <Select value={p.text} options={choices(p)!} onchange={(v) => update(i, { text: v })} />
            {:else if p.type === 'list'}
              <input id={'p' + i} value={p.items.join(', ')} disabled={readOnly} placeholder={t('propsListHint')} onchange={(e) => setItems(i, e.currentTarget.value)} />
            {:else}
              <input id={'p' + i} type={p.type === 'number' ? 'number' : 'text'} value={p.text} disabled={readOnly} onchange={(e) => update(i, { text: e.currentTarget.value })} />
            {/if}
            {#if !readOnly}<button class="ghost small" aria-label={t('delete')} title={t('delete')} onclick={() => remove(i)}>✕</button>{:else}<span></span>{/if}
          {/each}
        </div>
        {#if !readOnly}
          {#if adding}
            <form class="props-add" onsubmit={(e) => { e.preventDefault(); addProp(newKey, newType); }}>
              <input bind:this={nameBox} bind:value={newKey} placeholder={t('propsName')} dir="auto" autocomplete="off" onfocus={openSug} oninput={openSug} onkeydown={sugKey} onblur={() => setTimeout(() => (sugOpen = false), 150)} />
              <Select bind:value={newType} options={TYPES.map(([v, k]) => ({ value: v, label: t(k as never) }))} />
              <button class="primary small" type="submit">{t('add')}</button>
              <button class="ghost small" type="button" onclick={() => (adding = false)}>✕</button>
            </form>
          {:else}
            <div class="props-quick">
              {#each unused as c (c.key)}
                <button class="ghost small" onclick={() => addProp(c.key, c.type)}>＋ {c.key}</button>
              {/each}
              <button class="ghost small" onclick={() => (adding = true)}>＋ {t('propsCustom')}</button>
            </div>
          {/if}
        {/if}
      {/if}
    {/if}
  </div>
{/if}

{#if sugOpen && sugs.length}
  <ul class="sel-pop sug-pop" role="listbox" transition:pop|global style="left:{sugPos.x}px; min-width:{sugPos.w}px; {sugPos.up ? `bottom:${innerHeight - sugPos.y + 4}px` : `top:${sugPos.y}px`}">
    {#each sugs as x, i (x.key)}
      <li role="option" aria-selected={i === sugHi} class:hi={i === sugHi} onpointerenter={() => (sugHi = i)} onpointerdown={(e) => { e.preventDefault(); pickSug(i); }}><Icon name={store.s.propIcons?.[x.key.toLowerCase()] ?? ICON[x.key.toLowerCase()] ?? 'text'} size={15} /><span>{x.key}</span>{#if x.mine}<em>{t('propMine')}</em>{/if}</li>
    {/each}
  </ul>
{/if}

{#if iconFor_}
  <div class="icon-scrim" role="presentation" transition:fade|global={{ duration: 120 }} onpointerdown={() => (iconFor_ = null)}></div>
  <div class="icon-pop menu" role="dialog" aria-label={t('propIcon')} transition:pop|global style="left:{iconFor_.x}px; top:{iconFor_.y}px">
    <div class="icon-grid">
      {#each ICONS as ic (ic)}
        <button type="button" class:on={store.s.propIcons?.[iconFor_.key.toLowerCase()] === ic} aria-label={ic} onclick={() => pickIcon(ic)}><Icon name={ic} size={18} /></button>
      {/each}
    </div>
    <button type="button" class="ghost small" onclick={() => pickIcon(null)}>{t('propIconReset')}</button>
  </div>
{/if}
