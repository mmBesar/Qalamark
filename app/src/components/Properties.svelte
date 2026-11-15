<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import Select from './Select.svelte';
  import Icon from './Icon.svelte';
  import { onMount } from 'svelte';
  import type { Text as YText } from 'yjs';
  import { COMMON_PROPS, readFrontMatter, type Prop, type PropType, withProps } from '../lib/frontmatter.ts';
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
  function addProp(key: string, type: PropType) {
    const k = key.trim().replace(/[:\n]/g, '');
    if (!k || plist.some((p) => p.key.toLowerCase() === k.toLowerCase())) return;
    commit([...plist, { key: k, type, text: type === 'checkbox' ? 'false' : '', items: [] }]);
    adding = false;
    newKey = '';
    openPanel = true;
  }
  function setItems(i: number, raw: string) {
    update(i, { items: raw.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean) });
  }
  const ICON: Record<string, string> = { title: 'type', tags: 'tag', tag: 'tag', aliases: 'link', alias: 'link', description: 'text', summary: 'text', date: 'calendar', created: 'calendar', updated: 'calendar', modified: 'calendar', author: 'user', url: 'globe', link: 'globe', cssclasses: 'layers', kanban: 'board', draft: 'check-box', publish: 'check-box' };
  const iconFor = (p: Prop) => ICON[p.key.toLowerCase()] ?? (p.type === 'checkbox' ? 'check-box' : p.type === 'list' ? 'list' : p.type === 'number' ? 'hash' : 'text');
  const unused = $derived(COMMON_PROPS.filter((c) => !plist.some((p) => p.key.toLowerCase() === c.key)));
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
            <label class="pkey" for={'p' + i}><span class="pico"><Icon name={iconFor(p)} size={15} /></span>{p.key}</label>
            {#if p.type === 'checkbox'}
              <span class="pcheck">
                <input id={'p' + i} type="checkbox" checked={p.text === 'true'} disabled={readOnly} onchange={(e) => update(i, { text: e.currentTarget.checked ? 'true' : 'false' })} />
                <span class="pbox" aria-hidden="true"><Icon name="check-small" size={16} /></span>
              </span>
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
              <input list="common-plist" bind:value={newKey} placeholder={t('propsName')} dir="ltr" />
              <datalist id="common-plist">{#each unused as c (c.key)}<option value={c.key}></option>{/each}</datalist>
              <Select bind:value={newType} options={[{ value: 'text', label: t('typeText') }, { value: 'list', label: t('typeList') }, { value: 'number', label: t('typeNumber') }, { value: 'checkbox', label: t('typeCheckbox') }]} />
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
