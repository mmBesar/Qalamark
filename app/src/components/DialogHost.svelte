<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import { dialogs } from '../lib/dialog.svelte.ts';
  import { store } from '../lib/store.svelte.ts';
  const t = store.t;
  let value = $state('');
  let dlg: HTMLDialogElement | undefined = $state();
  $effect(() => {
    if (dialogs.current) {
      value = '';
      if (dlg && !dlg.open) dlg.showModal();
    } else if (dlg?.open) dlg.close();
  });
  function done(ok: boolean) {
    const p = dialogs.current;
    dialogs.current = null;
    p?.resolve(p.input ? (ok ? value : null) : ok);
  }
</script>

<dialog bind:this={dlg} class="askdialog" oncancel={(e) => { e.preventDefault(); done(false); }}>
  {#if dialogs.current}
    <form onsubmit={(e) => { e.preventDefault(); done(true); }}>
      <p>{dialogs.current.message}</p>
      {#if dialogs.current.input}
        <!-- svelte-ignore a11y_autofocus -->
        <input autofocus type={dialogs.current.secret ? 'password' : 'text'} bind:value />
      {/if}
      <div class="btns">
        <button type="button" class="ghost" onclick={() => done(false)}>{t('cancel')}</button>
        <button class="primary" type="submit">OK</button>
      </div>
    </form>
  {/if}
</dialog>

<style>
  .askdialog { padding: 1.2rem; min-width: min(22rem, 90vw); background: var(--surface); color: var(--ink); }
  form { display: grid; gap: 0.9rem; }
  p { margin: 0; }
  .btns { display: flex; gap: 0.5rem; justify-content: flex-end; }
</style>
