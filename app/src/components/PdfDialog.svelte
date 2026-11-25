<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  // Export a note as PDF: options on one side, the page as it will print on the other. No properties on the page.
  import { onMount } from 'svelte';
  import Select from './Select.svelte';
  import { store } from '../lib/store.svelte.ts';
  import { loadPdfOptions, pageFor, paperPx, printPage, savePdfOptions } from '../lib/pdfexport.ts';
  import { onAndroid } from '../lib/vault.ts';
  import type { PdfOptions } from '../lib/pdf.ts';

  let { title, text, resolve, onClose }: { title: string; text: string; resolve: (url: string) => Promise<string | null>; onClose: () => void } = $props();
  const t = store.t;
  let dlg: HTMLDialogElement;
  let o = $state<PdfOptions>(loadPdfOptions());
  let html = $state('');
  let busy = $state(false);
  let box: HTMLDivElement | undefined = $state();
  let boxW = $state(320);
  const px = $derived(paperPx(o));
  const scale = $derived(Math.min(1, (boxW - 2) / px.w));

  onMount(() => {
    dlg.showModal();
    const ro = new ResizeObserver(() => { if (box) boxW = box.clientWidth; });
    if (box) ro.observe(box);
    return () => ro.disconnect();
  });

  let seq = 0;
  $effect(() => {
    const mine = ++seq;
    const opts = { ...o };
    savePdfOptions(opts);
    void pageFor(text, title, opts, resolve).then((h) => { if (mine === seq) html = h; });
  });

  // the preview shows paper on a grey desk, at the paper's real width, shrunk to fit
  const preview = $derived(html.replace('</style>', `@media screen { html { background: #d9d9d9; } body { width: ${px.w}px; min-height: ${px.h}px; margin: 0 auto; padding: var(--m); background: #fff; box-shadow: 0 2px 12px rgb(0 0 0 / .25); } :root { --m: ${o.margin === 'narrow' ? '12mm' : o.margin === 'wide' ? '28mm' : '20mm'}; } }</style>`));

  async function save() {
    busy = true;
    try { await printPage(html, title || 'note'); onClose(); } finally { busy = false; }
  }
  const opt = (v: string, label: string) => ({ value: v, label });
</script>

<dialog bind:this={dlg} onclose={onClose} class="wide pdf-dlg">
  <form method="dialog" class="dialog-head">
    <h2>{t('pdfTitle')}</h2>
    <button class="icon" aria-label={t('close')}>×</button>
  </form>
  <div class="pdf-body">
    <div class="pdf-opts">
      <label>{t('pdfPaper')}<Select value={o.paper} options={[opt('A4', 'A4'), opt('Letter', 'Letter'), opt('A5', 'A5')]} onchange={(v) => (o.paper = v as PdfOptions['paper'])} label={t('pdfPaper')} /></label>
      <label>{t('pdfOrient')}<Select value={o.landscape ? 'l' : 'p'} options={[opt('p', t('pdfPortrait')), opt('l', t('pdfLandscape'))]} onchange={(v) => (o.landscape = v === 'l')} label={t('pdfOrient')} /></label>
      <label>{t('pdfMargin')}<Select value={o.margin} options={[opt('narrow', t('pdfNarrow')), opt('normal', t('pdfNormal')), opt('wide', t('pdfWide'))]} onchange={(v) => (o.margin = v as PdfOptions['margin'])} label={t('pdfMargin')} /></label>
      <label>{t('pdfSize')}<Select value={o.size} options={[opt('small', t('pdfSmall')), opt('medium', t('pdfMedium')), opt('large', t('pdfLarge'))]} onchange={(v) => (o.size = v as PdfOptions['size'])} label={t('pdfSize')} /></label>
      <label class="chk"><input type="checkbox" bind:checked={o.title} /> {t('pdfShowTitle')}</label>
      <label class="chk"><input type="checkbox" bind:checked={o.pageNumbers} /> {t('pdfPageNumbers')}</label>
      <p class="muted pdf-note">{t('pdfNoProps')}</p>
      {#if !onAndroid()}<p class="muted pdf-note">{t('pdfHow')}</p>{/if}
    </div>
    <div class="pdf-preview" bind:this={box}>
      <div class="pdf-sheet" style:height={Math.round(px.h * scale) + 'px'}>
        {#if html}<iframe title={t('pdfTitle')} srcdoc={preview} sandbox="allow-same-origin" style:width={px.w + 'px'} style:height={px.h + 'px'} style:transform={`scale(${scale})`}></iframe>{/if}
      </div>
    </div>
  </div>
  <div class="dialog-actions">
    <button type="button" onclick={() => dlg.close()}>{t('cancel')}</button>
    <button type="button" class="primary" disabled={busy || !html} onclick={save}>{t('pdfSave')}</button>
  </div>
</dialog>
