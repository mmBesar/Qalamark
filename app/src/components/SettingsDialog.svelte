<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import { askBox, confirmBox } from '../lib/dialog.svelte.ts';
  import { addUserFont, removeUserFont } from '../lib/fonts';
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

  async function addFont(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    for (const file of Array.from(input.files ?? [])) {
      try {
        const fam = await addUserFont(file);
        if (!store.userFonts.includes(fam)) store.userFonts = [...store.userFonts, fam];
      } catch {
        error = 'Not a usable font file: ' + file.name;
      }
    }
    input.value = '';
  }
  async function dropFont(family: string) {
    await removeUserFont(family);
    store.userFonts = store.userFonts.filter((f) => f !== family);
  }
  let users = $state<Array<{ username: string; admin: boolean }>>([]);
  let signup = $state(false);
  async function loadUsers() {
    if (store.mode !== 'server' || !store.s.admin) return;
    try {
      users = await store.api.listUsers();
      signup = (await store.api.getAdminSettings()).signup;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  onMount(() => {
    dlg.showModal();
    void loadUsers();
  });
  const toggleSignup = (on: boolean) => attempt(async () => { signup = (await store.api.setSignup(on)).signup; });
  const resetPw = async (name: string) => {
    const pw = await askBox(t('newPasswordFor', { name }), true);
    if (pw) void attempt(async () => { await store.api.updateUser(name, { password: pw }); return '✓'; });
  };
  const setAdmin = (name: string, admin: boolean) => attempt(async () => { await store.api.updateUser(name, { admin }); await loadUsers(); });
  const removeUser = async (name: string) => {
    if (await confirmBox(t('confirmDeleteUser', { name }))) void attempt(async () => { await store.api.deleteUser(name); await loadUsers(); });
  };

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
      await loadUsers();
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

  <h3>{t('appearance')}</h3>
  <div class="grid2">
    <label>
      {t('fontSize')}: {store.s.fontSize}px
      <input type="range" min="12" max="28" step="1" value={store.s.fontSize} oninput={(e) => store.setLayout({ fontSize: Number(e.currentTarget.value) })} />
    </label>
    <label>
      {t('editorWidth')}: {store.s.editorWidth > 0 ? store.s.editorWidth + ' rem' : t('widthFull')}
      <input type="range" min="30" max="100" step="2" value={store.s.editorWidth > 0 ? store.s.editorWidth : 100} oninput={(e) => store.setLayout({ editorWidth: Number(e.currentTarget.value) >= 100 ? 0 : Number(e.currentTarget.value) })} />
    </label>
    <label>
      {t('fontEn')}
      <input list="fonts-en" value={store.s.fontEn} placeholder="Roboto · {t('fontDefault')}" dir="ltr" spellcheck="false" onchange={(e) => store.setLayout({ fontEn: e.currentTarget.value })} />
    </label>
    <label>
      {t('fontAr')}
      <input list="fonts-ar" value={store.s.fontAr} placeholder="Noto Naskh Arabic UI · {t('fontDefault')}" dir="ltr" spellcheck="false" onchange={(e) => store.setLayout({ fontAr: e.currentTarget.value })} />
    </label>
    <label>
      {t('fontCode')}
      <input list="fonts-code" value={store.s.fontCode} placeholder="JetBrainsMono Nerd Font Mono · {t('fontDefault')}" dir="ltr" spellcheck="false" onchange={(e) => store.setLayout({ fontCode: e.currentTarget.value })} />
    </label>
    <label>
      {t('sourceSize')}: {store.s.sourceSize}px
      <input type="range" min="11" max="26" step="1" value={store.s.sourceSize} oninput={(e) => store.setLayout({ sourceSize: Number(e.currentTarget.value) })} />
    </label>
    <label>
      {t('fontSource')}
      <input list="fonts-code" value={store.s.fontSource} placeholder={t('fontDefault')} dir="ltr" spellcheck="false" onchange={(e) => store.setLayout({ fontSource: e.currentTarget.value })} />
    </label>
  </div>
  <label class="check"><input type="checkbox" checked={store.s.centerPage} onchange={(e) => store.setLayout({ centerPage: e.currentTarget.checked })} /> {t('centerPage')}</label>
  <label class="filebtn ghost">
    {t('addFont')}
    <input type="file" accept=".ttf,.otf,.woff,.woff2" hidden onchange={addFont} />
  </label>
  {#if store.userFonts.length > 0}
    <div class="fontlist">
      {#each store.userFonts as f (f)}
        <span class="chip" style:font-family="'{f}'">{f} <button class="ghost small" onclick={() => dropFont(f)}>✕</button></span>
      {/each}
    </div>
  {/if}
  <p class="muted tiny">{t('fontHint')}</p>
  <datalist id="fonts-en">{#each store.userFonts as f}<option value={f}></option>{/each}<option value="Roboto"></option><option value="Inter"></option><option value="Georgia"></option><option value="system-ui"></option></datalist>
  <datalist id="fonts-ar">{#each store.userFonts as f}<option value={f}></option>{/each}<option value="Noto Naskh Arabic UI"></option><option value="Noto Sans Arabic"></option><option value="Amiri"></option><option value="Cairo"></option></datalist>
  <datalist id="fonts-code">{#each store.userFonts as f}<option value={f}></option>{/each}<option value="JetBrainsMono Nerd Font Mono"></option><option value="JetBrains Mono"></option><option value="Fira Code"></option><option value="Cascadia Code"></option></datalist>

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
      <h3>{t('users')}</h3>
      <label class="check"><input type="checkbox" checked={signup} onchange={(e) => toggleSignup(e.currentTarget.checked)} /> {t('allowSignup')}</label>
      <ul class="userlist">
        {#each users as u (u.username)}
          <li>
            <span class="uname" dir="ltr">{u.username}{u.admin ? ' · ' + t('admin') : ''}</span>
            <button class="ghost small" onclick={() => resetPw(u.username)}>{t('resetPassword')}</button>
            {#if u.username !== store.s.username}
              <button class="ghost small" onclick={() => setAdmin(u.username, !u.admin)}>{u.admin ? t('removeAdmin') : t('makeAdmin')}</button>
              <button class="ghost small danger" onclick={() => removeUser(u.username)}>{t('deleteUser')}</button>
            {/if}
          </li>
        {/each}
      </ul>
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
