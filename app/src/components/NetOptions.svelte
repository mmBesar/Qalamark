<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  // How the app may reach the server. Exactly one is chosen, so nothing unusual is allowed by accident.
  import { store } from '../lib/store.svelte.ts';
  const t = store.t;
  const mode = $derived(store.s.allowSelfSigned ? 'selfsigned' : store.s.allowHttp ? 'http' : 'https');
  async function pick(m: 'https' | 'selfsigned' | 'http') {
    if (m === 'https') {
      await store.setNet('selfSigned', false);
      await store.setNet('http', false);
    } else await store.setNet(m === 'selfsigned' ? 'selfSigned' : 'http', true);
  }
  const opts = $derived([
    { id: 'https', title: t('netSecure'), note: t('netSecureNote') },
    { id: 'selfsigned', title: t('netSelfSigned'), note: t('netSelfSignedWarn') },
    { id: 'http', title: t('netHttp'), note: t('netHttpWarn'), warn: true },
  ] as const);
</script>

<fieldset class="net">
  <legend>{t('netConnection')}</legend>
  {#each opts as o (o.id)}
    <label class="opt" class:on={mode === o.id}>
      <input type="radio" name="net" checked={mode === o.id} onchange={() => pick(o.id)} />
      <span>
        <b>{o.title}</b>
        {#if mode === o.id}<small class:warn={'warn' in o && o.warn}>{o.note}</small>{/if}
      </span>
    </label>
  {/each}
</fieldset>

<style>
  .net { border: 0; margin: 0.2rem 0 0.5rem; padding: 0; display: grid; gap: 0.35rem; min-width: 0; }
  legend { padding: 0 0 0.3rem; font-size: 0.9rem; color: var(--muted); }
  .opt { display: flex; gap: 0.65rem; align-items: flex-start; padding: 0.6rem 0.75rem; border: 1px solid var(--line); border-radius: 10px; cursor: pointer; text-align: start; }
  .opt.on { border-color: var(--accent); background: var(--accent-soft, color-mix(in srgb, var(--accent) 10%, transparent)); }
  .opt input { width: 1.1rem; height: 1.1rem; margin-top: 0.15rem; flex: none; accent-color: var(--accent); }
  .opt span { display: grid; gap: 0.2rem; min-width: 0; }
  .opt b { font-weight: 600; font-size: 0.93rem; }
  .opt small { color: var(--muted); font-size: 0.8rem; line-height: 1.4; }
  .opt small.warn { color: var(--danger); }
</style>
