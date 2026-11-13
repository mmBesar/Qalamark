<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { store, type Theme } from '../lib/store.svelte.ts';
  import { ACCENTS, PALETTES, THEME_LIST, themeName } from '../lib/theme.ts';

  let { onClose }: { onClose: () => void } = $props();
  const t = store.t;
  let dlg: HTMLDialogElement;
  let msg = $state('');
  let error = $state('');
  let oldPw = $state('');
  let newPw = $state('');
  let uName = $state('');
  let uPw = $state('');
  let uAdmin = $state(false);

  onMount(() => dlg.showModal());

  async function attempt(f: () => Promise<string | void>) {
    msg = '';
    error = '';
    try {
      msg = (await f()) ?? '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  const changePw = (e: Event) => {
    e.preventDefault();
    void attempt(async () => {
      await store.api.changePassword(oldPw, newPw);
      oldPw = newPw = '';
      return '✓';
    });
  };
  const addUser = (e: Event) => {
    e.preventDefault();
    void attempt(async () => {
      await store.api.addUser(uName, uPw, uAdmin);
      uName = uPw = '';
      return '✓';
    });
  };
  const upload = () =>
    attempt(async () => {
      const n = await store.uploadLocalNotes();
      return t('uploaded', { n });
    });
</script>

<dialog bind:this={dlg} onclose={onClose}>
  <form method="dialog" class="dialog-head">
    <h2>{t('settings')}</h2>
    <button class="icon" aria-label={t('close')}>×</button>
  </form>

  <div class="grid2">
    <label>
      {t('language')}
      <select value={store.lang} onchange={(e) => store.setLang(e.currentTarget.value as 'en' | 'ar')}>
        <option value="en">English</option>
        <option value="ar">العربية</option>
      </select>
    </label>
    <label>
      {t('theme')}
      <select value={store.s.theme} onchange={(e) => store.setTheme(e.currentTarget.value as Theme)}>
        {#each THEME_LIST as id (id)}
          <option value={id}>{themeName(id, t)}</option>
        {/each}
      </select>
    </label>
  </div>

  <h3>{t('accent')}</h3>
  <div class="swatches" role="group" aria-label={t('accent')}>
    <button class:on={store.s.accent === 'default'} title={t('accentDefault')} aria-label={t('accentDefault')} style="background: conic-gradient(var(--accent), var(--gold), var(--accent))" onclick={() => store.setAccent('default')}></button>
    {#each ACCENTS as a (a)}
      <button class:on={store.s.accent === a} title={a} aria-label={a} style="background: {PALETTES.mocha.accents[a]}" onclick={() => store.setAccent(a)}></button>
    {/each}
  </div>

  {#if store.mode === 'server'}
    <h3>{store.s.username}{store.s.admin ? ' · ' + t('admin') : ''}</h3>
    <p class="muted" dir="ltr">{store.api.base || location.origin}</p>
    <div class="row">
      <button onclick={() => store.signOut().then(onClose)}>{t('signOut')}</button>
      {#if store.hasLocalNotes()}<button onclick={upload}>{t('uploadLocal')}</button>{/if}
    </div>

    <h3>{t('changePassword')}</h3>
    <form class="row" onsubmit={changePw}>
      <input type="password" bind:value={oldPw} placeholder={t('oldPassword')} required autocomplete="current-password" dir="ltr" />
      <input type="password" bind:value={newPw} placeholder={t('newPassword')} required minlength="8" autocomplete="new-password" dir="ltr" />
      <button>{t('save')}</button>
    </form>

    {#if store.s.admin}
      <h3>{t('addUser')}</h3>
      <form class="row" onsubmit={addUser}>
        <input bind:value={uName} placeholder={t('username')} required autocapitalize="off" spellcheck="false" dir="ltr" />
        <input type="password" bind:value={uPw} placeholder={t('password')} required minlength="8" autocomplete="new-password" dir="ltr" />
        <label class="check"><input type="checkbox" bind:checked={uAdmin} /> {t('admin')}</label>
        <button>{t('save')}</button>
      </form>
    {/if}
  {:else}
    <p class="muted">{t('localMode')}</p>
    <button onclick={() => (store.showLogin(), onClose())}>{t('signIn')} / {t('server')}</button>
  {/if}

  {#if msg}<p class="ok">{msg}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <p class="muted tiny">Qalamark {''}· AGPL-3.0-or-later · <a href="https://github.com/mmBesar/Qalamark" target="_blank" rel="noopener">GitHub</a></p>
</dialog>
