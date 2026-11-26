<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import NetOptions from './NetOptions.svelte';
  import { inShell, onAndroid, vault } from '../lib/vault.ts';
  import { hasTray, trayGet, trayOk, traySet, trayPicture, type TrayConfig } from '../lib/tray.ts';
  import { hasWidgets } from '../lib/widgets.ts';
  import Select from './Select.svelte';
  import { askBox, confirmBox } from '../lib/dialog.svelte.ts';
  import { addUserFont, removeUserFont } from '../lib/fonts';
  import FontPicker from './FontPicker.svelte';
  import { onMount } from 'svelte';
  import { store, type Theme } from '../lib/store.svelte.ts';
  import { ACCENTS, PALETTES, THEME_LIST, themeName } from '../lib/theme.ts';

  import type { TaskAction } from '../lib/gestures.ts';
  let { onClose }: { onClose: () => void } = $props();
  const ACT: TaskAction[] = ['tick', 'edit', 'delete', 'menu', 'none'];
  const tabs = $derived([
    { id: 'look', icon: 'sun', label: 'setLook' },
    { id: 'text', icon: 'type', label: 'setText' },
    { id: 'tasks', icon: 'check-box', label: 'setTasks' },
    ...(store.vaultPath ? [{ id: 'notes', icon: 'folder', label: 'notesFolder' }] : []),
    ...(hasTray() ? [{ id: 'desktop', icon: 'sliders', label: 'setDesktop' }] : []),
    { id: 'account', icon: 'user', label: 'setAccount' },
    ...(store.mode === 'server' && store.s.admin ? [{ id: 'people', icon: 'users', label: 'users' }] : []),
  ]);
  let tab = $state('look');
  // the system tray (desktop app): the native side keeps the choices
  let tray = $state<TrayConfig | null>(null);
  let trayShown = $state(true);
  /** The tone an "auto" icon has here: white on a dark theme (the text is light), black on a light one. */
  function autoTone(): 'light' | 'dark' {
    const m = /\d+/g, c = (getComputedStyle(document.body).color.match(m) ?? ['0', '0', '0']).map(Number);
    return (c[0]! * 299 + c[1]! * 587 + c[2]! * 114) / 1000 > 128 ? 'light' : 'dark';
  }
  async function loadTray() { try { tray = await trayGet(); trayShown = !tray.enabled || (await trayOk()); } catch { tray = null; } }
  async function setTray(patch: Partial<TrayConfig>) {
    if (!tray) return;
    const next = { ...tray, ...patch };
    try { tray = await traySet(next, store.t); trayShown = !tray.enabled || (await trayOk()); } catch { /* unchanged */ }
  }
  $effect(() => { if (tab === 'desktop' && !tray) void loadTray(); });
  // a phone gets its own shape: a list of categories that slides over to the page you picked (back arrow to return)
  const mq = typeof matchMedia === 'function' ? matchMedia('(max-width: 760px)') : null;
  let phone = $state(mq?.matches ?? false);
  // whether a category page is showing (phone): the system back button goes from it to the list, so the app knows about it
  const inPage = $derived(store.settingsPage);
  $effect(() => { const f = () => (phone = mq!.matches); mq?.addEventListener('change', f); return () => mq?.removeEventListener('change', f); });
  const pick = (id: string) => { tab = id; if (phone) store.settingsPage = true; };

  const t = store.t;
  let avatarInput: HTMLInputElement;
  let avatarError = $state('');
  let avatarBusy = $state(false);
  async function pickAvatar(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    avatarError = '';
    avatarBusy = true;
    try { await store.setMyAvatar(f); } catch (err) { avatarError = err instanceof Error ? err.message : String(err); } finally { avatarBusy = false; input.value = ''; }
  }
  async function removeAvatar() {
    avatarError = '';
    try { await store.removeMyAvatar(); } catch (err) { avatarError = err instanceof Error ? err.message : String(err); }
  }
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

  let folderDraft = $state(store.vaultPath);
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

<dialog class="settings" bind:this={dlg} onclose={onClose}>
  <div class="set-shell" class:phone class:in-page={phone && inPage}>
    <nav class="set-nav" aria-label={t('settings')}>
      <form method="dialog" class="set-top">
        <h2>{t('settings')}</h2>
        <button class="icon" aria-label={t('close')}>×</button>
      </form>
      <div class="set-tabs" role="tablist">
        {#each tabs as tb (tb.id)}
          <button role="tab" type="button" aria-selected={tab === tb.id} class:on={tab === tb.id} onclick={() => pick(tb.id)}><Icon name={tb.icon} size={phone ? 22 : 18} /><span>{t(tb.label as never)}</span>{#if phone}<Icon name="chevron-right" size={18} />{/if}</button>
        {/each}
      </div>
      <p class="muted tiny set-about">Qalamark · AGPL-3.0-or-later · <a href="https://github.com/mmBesar/Qalamark" target="_blank" rel="noopener">GitHub</a></p>
    </nav>

    <div class="set-main">
      {#if phone}
        <div class="set-back"><button class="icon" type="button" aria-label={t('back')} onclick={() => (store.settingsPage = false)}><Icon name="chevron-left" size={22} /></button><h2>{t(tabs.find((x) => x.id === tab)?.label as never)}</h2></div>
      {/if}
      <div class="set-page">
        {#if tab === 'look'}
          <div class="set-card">
  <div class="grid2">
    <label>
      {t('language')}
      <Select value={store.lang} options={[{ value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }]} onchange={(v) => store.setLang(v as 'en' | 'ar')} />
    </label>
    <label>
      {t('theme')}
      <Select value={store.s.theme} options={THEME_LIST.map((id) => ({ value: id, label: themeName(id, t) }))} onchange={(v) => store.setTheme(v as Theme)} />
    </label>
  </div>

          </div>
          <div class="set-card">
  <h3>{t('accent')}</h3>
  <div class="swatches" role="group" aria-label={t('accent')}>
    <button class:on={store.s.accent === 'default'} title={t('accentDefault')} aria-label={t('accentDefault')} style="background: conic-gradient(var(--accent), var(--gold), var(--accent))" onclick={() => store.setAccent('default')}></button>
    {#each ACCENTS as a (a)}
      <button class:on={store.s.accent === a} title={a} aria-label={a} style="background: {PALETTES.mocha.accents[a]}" onclick={() => store.setAccent(a)}></button>
    {/each}
  </div>

          </div>
        {:else if tab === 'text'}
          <div class="set-card">
  <div class="grid2">
    <label>
      {t('fontSize')}: {store.s.fontSize}px
      <input type="range" min="12" max="28" step="1" value={store.s.fontSize} oninput={(e) => store.setLayout({ fontSize: Number(e.currentTarget.value) })} />
    </label>
    <label>
      {t('editorWidth')}: {store.s.editorWidth > 0 ? store.s.editorWidth + ' rem' : t('widthFull')}
      <input type="range" min="30" max="100" step="2" value={store.s.editorWidth > 0 ? store.s.editorWidth : 100} oninput={(e) => store.setLayout({ editorWidth: Number(e.currentTarget.value) >= 100 ? 0 : Number(e.currentTarget.value) })} />
    </label>
    <div class="field">
      <span>{t('fontEn')}</span>
      <FontPicker value={store.s.fontEn} suggestions={["Roboto","Inter","Georgia","system-ui"]} placeholder={"Roboto · " + t('fontDefault')} onChange={(v) => store.setLayout({ fontEn: v })} />
    </div>
    <div class="field">
      <span>{t('fontAr')}</span>
      <FontPicker value={store.s.fontAr} suggestions={["Noto Naskh Arabic UI","Noto Sans Arabic","Amiri","Cairo","Scheherazade New"]} placeholder={"Noto Naskh Arabic UI · " + t('fontDefault')} onChange={(v) => store.setLayout({ fontAr: v })} />
    </div>
    <div class="field">
      <span>{t('fontCode')}</span>
      <FontPicker value={store.s.fontCode} suggestions={["JetBrainsMono Nerd Font Mono","JetBrains Mono","Fira Code","Cascadia Code"]} placeholder={"JetBrainsMono Nerd Font Mono · " + t('fontDefault')} onChange={(v) => store.setLayout({ fontCode: v })} />
    </div>
    <label>
      {t('sourceSize')}: {store.s.sourceSize}px
      <input type="range" min="11" max="26" step="1" value={store.s.sourceSize} oninput={(e) => store.setLayout({ sourceSize: Number(e.currentTarget.value) })} />
    </label>
    <div class="field">
      <span>{t('fontSource')}</span>
      <FontPicker value={store.s.fontSource} suggestions={["JetBrainsMono Nerd Font Mono","JetBrains Mono","Fira Code","Cascadia Code"]} placeholder={t('fontDefault')} onChange={(v) => store.setLayout({ fontSource: v })} />
    </div>
  </div>
  <button class="ghost" onclick={() => (store.toolbarOpen = true)}><Icon name="sliders" size={16} /> {t('toolbarEdit')}</button>
  {#if !onAndroid()}<label class="check"><input type="checkbox" checked={store.s.centerPage} onchange={(e) => store.setLayout({ centerPage: e.currentTarget.checked })} /> {t('centerPage')}</label>{/if}
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

          </div>
        {:else if tab === 'tasks'}
  <div class="set-card">
    <h3>{t('gestures')}</h3>
    <p class="muted small">{t('gesturesHelp')}</p>
    <div class="grid2">
      <label>{t('gSwipeRight')}<Select value={store.s.gestures.swipeRight} options={ACT.map((a) => ({ value: a, label: t(('act_' + a) as never) }))} onchange={(v) => store.setGestures({ swipeRight: v as TaskAction })} /></label>
      <label>{t('gSwipeLeft')}<Select value={store.s.gestures.swipeLeft} options={ACT.map((a) => ({ value: a, label: t(('act_' + a) as never) }))} onchange={(v) => store.setGestures({ swipeLeft: v as TaskAction })} /></label>
      <label>{t('gTap')}<Select value={store.s.gestures.tap} options={ACT.filter((a) => a !== 'delete').map((a) => ({ value: a, label: t(('act_' + a) as never) }))} onchange={(v) => store.setGestures({ tap: v as TaskAction })} /></label>
      <label>{t('gLong')}<Select value={store.s.gestures.longPress} options={ACT.map((a) => ({ value: a, label: t(('act_' + a) as never) }))} onchange={(v) => store.setGestures({ longPress: v as TaskAction })} /></label>
    </div>
    <p class="muted tiny">{t('gesturesRtl')}</p>
  </div>
        {:else if tab === 'desktop' && tray}
          <div class="set-card">
            <h3>{t('setDesktop')}</h3>
            <label class="check"><input type="checkbox" checked={tray.enabled} onchange={(e) => setTray({ enabled: e.currentTarget.checked })} /> {t('trayShow')}</label>
            <label class="check"><input type="checkbox" disabled={!tray.enabled} checked={tray.close_to_tray} onchange={(e) => setTray({ close_to_tray: e.currentTarget.checked })} /> {t('trayClose')}</label>
            <p class="muted small">{t('trayCloseHelp')}</p>
            <label class="check"><input type="checkbox" checked={tray.autostart} onchange={(e) => setTray({ autostart: e.currentTarget.checked })} /> {t('trayAutostart')}</label>
            <label class="check"><input type="checkbox" disabled={!tray.enabled || !tray.autostart} checked={tray.start_hidden} onchange={(e) => setTray({ start_hidden: e.currentTarget.checked })} /> {t('trayHidden')}</label>
            {#if tray.enabled && !trayShown}<p class="error" role="alert">{t('trayMissing')}</p>{/if}
          </div>
          <div class="set-card">
            <h3>{t('trayStyle')}</h3>
            <div class="tray-styles" role="radiogroup" aria-label={t('trayStyle')}>
              {#each [['pen', 'trayPen'], ['outline', 'trayOutline'], ['qaf', 'trayQaf']] as [s, label] (s)}
                {@const tone = tray.tone === 'auto' ? autoTone() : tray.tone}
                <button type="button" role="radio" aria-checked={tray.style === s} class="tray-style" class:on={tray.style === s} onclick={() => setTray({ style: s as TrayConfig['style'] })}>
                  <span class="tray-swatch" style:background={tone === 'light' ? '#2b2b36' : tone === 'dark' ? '#f4f4f7' : undefined}><img src={trayPicture(s!, tone)} alt="" width="36" height="36" /></span>
                  {t(label as 'trayPen')}
                </button>
              {/each}
            </div>
            <h3>{t('trayTone')}</h3>
            <div class="tray-tones" role="radiogroup" aria-label={t('trayTone')}>
              {#each [['colour', 'trayColour'], ['light', 'trayLight'], ['dark', 'trayDark'], ['auto', 'trayAuto']] as [x, label] (x)}
                <button type="button" role="radio" aria-checked={tray.tone === x} class:on={tray.tone === x} onclick={() => setTray({ tone: x as TrayConfig['tone'] })}>{t(label as 'trayColour')}</button>
              {/each}
            </div>
            <p class="muted small">{t('trayLeftClick')}</p>
          </div>
        {:else if tab === 'notes'}
          <div class="set-card">
  {#if store.vaultPath}
    <h3>{t('notesFolder')}</h3>
    <p class="muted small">{t('notesFolderHelp')}</p>
    <div class="row">
      <input dir="ltr" bind:value={folderDraft} placeholder={t('folderPathPlaceholder')} aria-label={t('notesFolder')} />
      {#if !onAndroid()}<button type="button" onclick={async () => { const p = await vault.pick(); if (p) folderDraft = p; }}>{t('chooseFolder')}</button>{/if}
    </div>
    <div class="row">
      <button class="primary" type="button" onclick={() => void store.vaultChange(folderDraft)}>{t('useFolder')}</button>
      <button type="button" class="ghost" onclick={() => { folderDraft = ''; void store.vaultChange(''); }}>{t('defaultFolder')}</button>
    </div>
    {#if store.vaultError}<p class="err">{store.vaultError}</p>{/if}
  {/if}

          </div>
        {:else if tab === 'people'}
          <div class="set-card">
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
          </div>
        {:else}
          {#if hasWidgets() && store.mode === 'server'}
            <div class="set-card">
              <h3>{t('background')}</h3>
              <label class="check"><input type="checkbox" checked={store.s.keepAlive} onchange={(e) => store.setKeepAlive(e.currentTarget.checked)} /> {t('keepAlive')}</label>
              <p class="muted small">{t('keepAliveHelp')}</p>
            </div>
          {/if}
          <div class="set-card">
  {#if store.mode === 'server'}
    <div class="me-card">
      <button class="me-pic" type="button" aria-label={t('avatarChange')} title={t('avatarChange')} onclick={() => avatarInput.click()}>
        <Avatar name={store.s.username} size={72} />
        <span class="me-cam"><Icon name="camera" size={16} /></span>
      </button>
      <div class="me-info">
        <h3>{store.s.username}{store.s.admin ? ' · ' + t('admin') : ''}</h3>
        <div class="me-actions">
          <button class="ghost small" type="button" onclick={() => avatarInput.click()}>{t('avatarChange')}</button>
          {#if store.avatarUrl(store.s.username)}<button class="ghost small" type="button" onclick={removeAvatar}>{t('avatarRemove')}</button>{/if}
        </div>
        {#if avatarBusy}<p class="muted tiny">…</p>{/if}{#if avatarError}<p class="error" role="alert">{avatarError}</p>{/if}
      </div>
      <input bind:this={avatarInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden onchange={pickAvatar} />
    </div>
    <p class="muted" dir="ltr">{store.api.base || location.origin}</p>
    {#if inShell()}<NetOptions />{/if}
    {#if store.s.trust?.[store.s.serverUrl]}
      <p class="muted"><Icon name="check-small" size={14} /> {t('trustedCert')} <code dir="ltr" style="font-size:0.72rem;word-break:break-all">{store.s.trust[store.s.serverUrl]}</code></p>
      <div class="row"><button onclick={() => store.forgetCertificate()}>{t('forgetCert')}</button></div>
    {/if}
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

  {:else}
    <p class="muted">{t('localMode')}</p>
    <button onclick={() => (store.showLogin(), onClose())}>{t('signIn')} / {t('server')}</button>
  {/if}

          </div>
        {/if}
        {#if msg}<p class="ok">{msg}</p>{/if}
        {#if error}<p class="error" role="alert">{error}</p>{/if}
      </div>
    </div>
  </div>
</dialog>
