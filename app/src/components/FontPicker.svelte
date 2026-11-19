<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  // A font chooser: type to search, or open the whole list. Fonts you added come first, then suggestions,
  // then everything installed on this computer.
  import Icon from './Icon.svelte';
  import { listSystemFonts } from '../lib/fonts.ts';
  import { store } from '../lib/store.svelte.ts';

  let { value, suggestions, placeholder, onChange }: { value: string; suggestions: string[]; placeholder: string; onChange: (v: string) => void } = $props();
  let open = $state(false);
  let typed = $state(false); // the list is filtered only after the person types, so it never hides itself
  let draft = $state('');
  let system = $state<string[]>([]);
  let loaded = false;
  let box: HTMLElement;

  $effect(() => {
    draft = value;
  });

  async function show() {
    open = true;
    typed = false;
    if (!loaded) {
      loaded = true;
      system = await listSystemFonts();
    }
  }
  const groups = $derived.by(() => {
    const q = typed ? draft.trim().toLowerCase() : '';
    const keep = (l: string[]) => l.filter((f) => !q || f.toLowerCase().includes(q));
    const mine = keep(store.userFonts);
    const sug = keep(suggestions).filter((f) => !mine.includes(f));
    const rest = keep(system).filter((f) => !mine.includes(f) && !sug.includes(f));
    return [
      { name: store.t('fontsYours'), list: mine },
      { name: store.t('fontsSuggested'), list: sug },
      { name: store.t('fontsSystem'), list: rest.slice(0, 400) },
    ].filter((g) => g.list.length);
  });
  function choose(f: string) {
    draft = f;
    open = false;
    if (f !== value) onChange(f);
  }
  function commit() {
    open = false;
    const v = draft.trim();
    if (v !== value) onChange(v);
  }
</script>

<svelte:window onpointerdown={(e) => { if (open && box && !box.contains(e.target as Node)) commit(); }} />
<div class="fontpick" bind:this={box}>
  <div class="fp-input">
    <input
      value={draft}
      {placeholder}
      dir="ltr"
      spellcheck="false"
      autocomplete="off"
      role="combobox"
      aria-expanded={open}
      onfocus={show}
      onclick={() => { if (!open) void show(); }}
      oninput={(e) => { draft = e.currentTarget.value; typed = true; open = true; }}
      onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { draft = value; open = false; } else if (e.key === 'ArrowDown' && !open) void show(); }}
    />
    {#if draft}<button type="button" class="fp-clear" aria-label={store.t('fontDefault')} title={store.t('fontDefault')} onclick={() => choose('')}><Icon name="close" size={14} /></button>{/if}
    <button type="button" class="fp-open" aria-label={store.t('fontsList')} onclick={() => (open ? commit() : void show())}><Icon name="chevron" size={14} /></button>
  </div>
  {#if open}
    <div class="fp-list" role="listbox">
      {#each groups as g (g.name)}
        <div class="fp-group">{g.name}</div>
        {#each g.list as f (f)}
          <button type="button" role="option" aria-selected={f === value} class:on={f === value} onclick={() => choose(f)}>{f}</button>
        {/each}
      {:else}
        <div class="fp-empty">{store.t('fontsNone')}</div>
      {/each}
    </div>
  {/if}
  <div class="fp-sample" dir="ltr" style:--pick={draft ? `'${draft.replace(/['"\\]/g, '')}'` : ''}><span class="fp-en">Aa Bb ·</span> <span class="fp-ar" dir="rtl">أبجد · سَيِّدُ الِاسْتِغْفَارِ</span></div>
</div>
