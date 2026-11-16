<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  // The apps' two switches for servers that are not a normal https:// site. Only one can be on.
  import { store } from '../lib/store.svelte.ts';
  const t = store.t;
</script>

<div class="net">
  <label class="opt" class:dim={store.s.allowHttp} title={store.s.allowHttp ? t('netOff') : ''}>
    <input type="checkbox" checked={store.s.allowSelfSigned} disabled={store.s.allowHttp} onchange={(e) => store.setNet('selfSigned', e.currentTarget.checked)} />
    <span><b>{t('netSelfSigned')}</b><small>{t('netSelfSignedWarn')}</small></span>
  </label>
  <label class="opt" class:dim={store.s.allowSelfSigned} title={store.s.allowSelfSigned ? t('netOff') : ''}>
    <input type="checkbox" checked={store.s.allowHttp} disabled={store.s.allowSelfSigned} onchange={(e) => store.setNet('http', e.currentTarget.checked)} />
    <span><b>{t('netHttp')}</b><small class="warn">{t('netHttpWarn')}</small></span>
  </label>
</div>

<style>
  .net { display: grid; gap: 0.5rem; margin: 0.2rem 0 0.4rem; }
  .opt { display: flex; gap: 0.6rem; align-items: flex-start; padding: 0.55rem 0.7rem; border: 1px solid var(--line); border-radius: 10px; cursor: pointer; text-align: start; }
  .opt input { width: 1.15rem; height: 1.15rem; margin-top: 0.15rem; flex: none; accent-color: var(--accent); }
  .opt span { display: grid; gap: 0.15rem; }
  .opt b { font-weight: 600; font-size: 0.92rem; }
  .opt small { color: var(--muted); font-size: 0.8rem; line-height: 1.35; }
  .opt small.warn { color: var(--danger); }
  .opt.dim { opacity: 0.45; cursor: not-allowed; }
</style>
