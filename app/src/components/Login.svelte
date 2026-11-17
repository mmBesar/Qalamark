<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import Icon from './Icon.svelte';
  import FolderInfo from './FolderInfo.svelte';
  import NetOptions from './NetOptions.svelte';
  import { inShell } from '../lib/vault.ts';
  import { store } from '../lib/store.svelte.ts';

  const t = store.t;
  let server = $state(store.s.serverUrl);
  let username = $state('');
  let password = $state('');
  let show = $state(false);
  let create = $state(store.setupNeeded);
  let error = $state('');
  let busy = $state(false);
  let editServer = $state(false);
  let adv = $state(!store.serverReachable);
  let report = $state('');
  let testing = $state(false);
  async function test() {
    testing = true;
    report = '';
    try {
      report = await store.diagnose(server);
    } finally {
      testing = false;
    }
  }
  $effect(() => {
    if (error) adv = true;
  });

  async function submit(e: Event) {
    e.preventDefault();
    error = '';
    busy = true;
    try {
      if (editServer || server !== store.s.serverUrl) await store.connect(server);
      await store.signIn(username, password, create);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="login-wrap">
  <form class="login" onsubmit={submit}>
    <img src="./icon.svg" alt="" width="64" height="64" />
    <h1>{t('welcome')}</h1>
    <p class="muted">{t('welcomeText')}</p>

    {#if store.setupNeeded}
      <p class="note">{t('firstRun')}</p>
    {/if}

    <details class="adv" bind:open={adv}>
      <summary>{t('server')}{server ? ' · ' + server.replace(/^https?:\/\//, '') : ''}</summary>
      <label>
        {t('server')}
        <input bind:value={server} oninput={() => (editServer = true)} placeholder="https://notes.example.com" autocapitalize="off" spellcheck="false" dir="ltr" />
      </label>
      {#if inShell()}<NetOptions />{/if}
      {#if inShell()}<FolderInfo />{/if}
      {#if inShell()}
        <button type="button" class="ghost" disabled={testing} onclick={test}>{testing ? '…' : t('testConn')}</button>
        {#if report}<pre class="diag" dir="ltr">{report}</pre>{/if}
      {/if}
    </details>
    <label>
      {t('username')}
      <input bind:value={username} autocomplete="username" autocapitalize="off" spellcheck="false" required dir="ltr" />
    </label>
    <label>
      {t('password')}
      <span class="pw">
        <input type={show ? 'text' : 'password'} bind:value={password} autocomplete={create ? 'new-password' : 'current-password'} required minlength="8" dir="ltr" />
        <button type="button" class="eye" aria-label={show ? t('hidePassword') : t('showPassword')} title={show ? t('hidePassword') : t('showPassword')} onclick={() => (show = !show)}><Icon name={show ? 'eye-off' : 'eye'} size={18} /></button>
      </span>
    </label>

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <button class="primary" disabled={busy}>{create ? (store.setupNeeded ? t('createFirst') : t('register')) : t('signIn')}</button>

    <div class="row center">
      {#if store.signupOpen && !store.setupNeeded}
        <button type="button" class="link" onclick={() => (create = !create)}>{create ? t('signIn') : t('register')}</button>
      {/if}
      <button type="button" class="link" onclick={() => store.setLang(store.lang === 'ar' ? 'en' : 'ar')}>{store.lang === 'ar' ? 'English' : 'العربية'}</button>
    </div>
    <button type="button" class="ghost" onclick={() => store.startLocal()}>{t('useLocal')}</button>
  </form>
</div>
