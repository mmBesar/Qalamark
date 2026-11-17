<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  // First start of an app: use a server, or stay on this device. Shows the notes folder first, so it is clear
  // where the notes are and that files already in it become notes.
  import FolderInfo from './FolderInfo.svelte';
  import Icon from './Icon.svelte';
  import { store } from '../lib/store.svelte.ts';
  const t = store.t;
</script>

<div class="login-wrap">
  <div class="login welcome">
    <img src="./icon.svg" alt="" width="64" height="64" />
    <h1>{t('welcome')}</h1>
    <p class="muted">{t('welcomeText')}</p>
    <FolderInfo />
    <button type="button" class="choice primary" onclick={() => store.chooseStart('server')}>
      <Icon name="globe" size={20} />
      <span><b>{t('startServer')}</b><small>{t('startServerText')}</small></span>
    </button>
    <button type="button" class="choice" onclick={() => store.chooseStart('local')}>
      <Icon name="note" size={20} />
      <span><b>{t('startLocal')}</b><small>{t('startLocalText')}</small></span>
    </button>
    <button type="button" class="link" onclick={() => store.setLang(store.lang === 'ar' ? 'en' : 'ar')}>{store.lang === 'ar' ? 'English' : 'العربية'}</button>
  </div>
</div>

<style>
  .welcome { display: grid; gap: 0.7rem; }
  .choice { display: flex; align-items: center; gap: 0.8rem; text-align: start; padding: 0.85rem 1rem; border-radius: 12px; }
  .choice span { display: grid; gap: 0.15rem; }
  .choice small { font-size: 0.8rem; opacity: 0.8; line-height: 1.35; font-weight: 400; }
</style>
