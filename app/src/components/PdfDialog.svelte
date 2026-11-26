<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  // Export a note as PDF: the options on one side, the real pages on the other. The PDF is made right here (no print
  // window) and saved next to the note.
  import { onMount, tick } from 'svelte';
  import Select from './Select.svelte';
  import { store } from '../lib/store.svelte.ts';
  import { downloadPdf, forgetPdfDefaults, loadPdfDefaults, savePdfDefaults } from '../lib/pdfexport.ts';
  import { onAndroid } from '../lib/vault.ts';
  import { DEFAULT_PDF, type Doc, type PdfImage, type PdfOptions } from '../pdf/index.ts';

  let { title, file, id, text, resolve, onClose }: { title: string; file: string; id: string; text: string; resolve: (url: string) => Promise<string | null>; onClose: () => void } = $props();
  const t = store.t;
  let dlg: HTMLDialogElement;
  let o = $state<PdfOptions>(loadPdfDefaults());
  let doc = $state<Doc | null>(null);
  let busy = $state(false);
  let status = $state('');
  let failed = $state(false);
  let box: HTMLDivElement | undefined = $state();
  let boxW = $state(320);
  let cvs = $state<HTMLCanvasElement[]>([]);
  let lastField: HTMLInputElement | null = null;

  onMount(() => {
    dlg.showModal();
    const ro = new ResizeObserver(() => { if (box) boxW = box.clientWidth; });
    if (box) ro.observe(box);
    return () => ro.disconnect();
  });

  // pictures are fetched once, however often the page is laid out again
  const seen = new Map<string, Promise<PdfImage | null>>();
  async function engine() {
    const [pdf, br] = await Promise.all([import('../pdf/index.ts'), import('../pdf/browser.ts')]);
    const env = br.browserEnv(resolve);
    const load = env.image!;
    env.image = (u) => { let p = seen.get(u); if (!p) seen.set(u, (p = load(u))); return p; };
    return { pdf, env };
  }

  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const opts = { ...o };
    const mine = ++seq;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const { pdf, env } = await engine();
        const d = await pdf.layoutDoc(text, { title, file }, opts, env);
        const pv = await import('../pdf/preview.ts');
        await pv.prepareImages(d);
        if (mine === seq) { doc = d; }
      } catch (e) { if (mine === seq) { status = String(e instanceof Error ? e.message : e); failed = true; } }
    }, 180);
    return () => clearTimeout(timer);
  });

  // draw the pages whenever they or the width change
  $effect(() => {
    const d = doc, w = boxW;
    if (!d) return;
    void tick().then(async () => {
      const pv = await import('../pdf/preview.ts');
      const scale = ((w - 2) / d.w) * Math.min(2, window.devicePixelRatio || 1);
      d.pages.forEach((_p, i) => { const c = cvs[i]; if (c) pv.drawPage(c, d, i, scale); });
    });
  });

  const base = $derived(title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-') || 'note');
  const canFolder = $derived(store.mode === 'server' || !!store.vaultPath);

  async function make(): Promise<Uint8Array> {
    const { pdf, env } = await engine();
    const { bytes } = await pdf.makePdf(text, { title, file }, { ...o }, env);
    return bytes;
  }
  async function saveNext() {
    busy = true; failed = false; status = t('pdfMaking');
    try {
      const bytes = await make();
      const where = await store.savePdf(id, bytes);
      if (where) status = t(where === 'folder' ? 'pdfSavedNext' : 'pdfSavedServer', { name: base + '.pdf' });
      else if (!onAndroid()) { downloadPdf(bytes, base); status = t('pdfNowhere'); }
    } catch (e) { failed = true; status = t('pdfSaveFailed', { why: e instanceof Error ? e.message : String(e) }); } finally { busy = false; }
  }
  async function download() {
    busy = true; failed = false; status = t('pdfMaking');
    try { downloadPdf(await make(), base); status = ''; } catch (e) { failed = true; status = t('pdfSaveFailed', { why: e instanceof Error ? e.message : String(e) }); } finally { busy = false; }
  }
  function makeDefault() { savePdfDefaults({ ...o }); failed = false; status = t('pdfDefaultsSaved'); }
  function resetDefault() { forgetPdfDefaults(); o = { ...DEFAULT_PDF }; failed = false; status = t('pdfDefaultsReset'); }
  function token(tok: string) {
    const el = lastField;
    if (!el) return;
    const key = el.dataset.key as keyof PdfOptions;
    const v = String(o[key] ?? '');
    const a = el.selectionStart ?? v.length, b = el.selectionEnd ?? v.length;
    (o as unknown as Record<string, string>)[key] = v.slice(0, a) + tok + v.slice(b);
    el.focus();
  }
  const opt = (v: string, label: string) => ({ value: v, label });
  const hf: Array<[string, string, keyof PdfOptions, keyof PdfOptions, keyof PdfOptions]> = [
    ['pdfHeader', 'h', 'headerL', 'headerC', 'headerR'],
    ['pdfFooter', 'f', 'footerL', 'footerC', 'footerR'],
  ];
  const toks = ['{file}', '{title}', '{date}', '{time}', '{page}', '{pages}'];
</script>

<dialog bind:this={dlg} onclose={onClose} class="wide pdf-dlg">
  <form method="dialog" class="dialog-head">
    <h2>{t('pdfTitle')}</h2>
    <button class="icon" aria-label={t('close')}>×</button>
  </form>
  <div class="pdf-body">
    <div class="pdf-opts">
      <h3>{t('pdfSecPage')}</h3>
      <div class="pdf-row">
        <label>{t('pdfPaper')}<Select value={o.paper} options={['A4', 'A5', 'A3', 'Letter', 'Legal'].map((p) => opt(p, p))} onchange={(v) => (o.paper = v as PdfOptions['paper'])} label={t('pdfPaper')} /></label>
        <label>{t('pdfOrient')}<Select value={o.landscape ? 'l' : 'p'} options={[opt('p', t('pdfPortrait')), opt('l', t('pdfLandscape'))]} onchange={(v) => (o.landscape = v === 'l')} label={t('pdfOrient')} /></label>
      </div>
      <div class="pdf-row">
        <label>{t('pdfMarginMm')}<input type="number" min="5" max="50" step="1" bind:value={o.margin} /></label>
        <label>{t('pdfSizePt')}<input type="number" min="6" max="24" step="0.5" bind:value={o.size} /></label>
      </div>
      <div class="pdf-row">
        <label>{t('pdfSpacing')}<Select value={o.spacing} options={[opt('tight', t('pdfTight')), opt('normal', t('pdfNormal')), opt('airy', t('pdfAiry'))]} onchange={(v) => (o.spacing = v as PdfOptions['spacing'])} label={t('pdfSpacing')} /></label>
        <label>{t('pdfArabic')}<Select value={o.arabic} options={[opt('naskh', t('pdfNaskh')), opt('sans', t('pdfSansAr'))]} onchange={(v) => (o.arabic = v as PdfOptions['arabic'])} label={t('pdfArabic')} /></label>
      </div>
      <label class="chk"><input type="checkbox" bind:checked={o.fitOne} /> {t('pdfFitOne')}</label>

      <h3>{t('pdfSecContent')}</h3>
      <label class="chk"><input type="checkbox" bind:checked={o.title} /> {t('pdfShowTitle')}</label>
      <label class="chk"><input type="checkbox" bind:checked={o.pictures} /> {t('pdfPictures')}</label>
      <label class="chk"><input type="checkbox" bind:checked={o.breakH1} /> {t('pdfBreakH1')}</label>
      <label class="chk"><input type="checkbox" bind:checked={o.codeBox} /> {t('pdfCodeBox')}</label>
      <label class="chk"><input type="checkbox" bind:checked={o.tableLines} /> {t('pdfTableLines')}</label>
      <label class="chk"><input type="checkbox" bind:checked={o.tableZebra} /> {t('pdfZebra')}</label>
      <p class="muted pdf-note">{t('pdfNoProps')}</p>

      <h3>{t('pdfSecLinks')}</h3>
      <label>{t('pdfLinkColor')}<Select value={o.linkColor} options={[opt('blue', t('pdfLinkBlue')), opt('black', t('pdfLinkBlack'))]} onchange={(v) => (o.linkColor = v as PdfOptions['linkColor'])} label={t('pdfLinkColor')} /></label>
      <label class="chk"><input type="checkbox" bind:checked={o.linkUnderline} /> {t('pdfLinkUnderline')}</label>
      <label class="chk"><input type="checkbox" bind:checked={o.linkShowUrl} /> {t('pdfLinkUrl')}</label>

      <h3>{t('pdfSecHF')}</h3>
      {#each hf as [label, k, l, c, r] (k)}
        <div class="pdf-hf">
          <span class="muted">{t(label as 'pdfHeader')}</span>
          <div class="pdf-hf-row">
            {#each [[l, 'pdfLeft'], [c, 'pdfCenter'], [r, 'pdfRight']] as [key, ph] (key)}
              <input dir="auto" type="text" data-key={key} placeholder={t(ph as 'pdfLeft')} aria-label={t(label as 'pdfHeader') + ' – ' + t(ph as 'pdfLeft')}
                value={o[key as keyof PdfOptions] as string} oninput={(e) => ((o as unknown as Record<string, string>)[key as string] = e.currentTarget.value)} onfocus={(e) => (lastField = e.currentTarget)} />
            {/each}
          </div>
        </div>
      {/each}
      <div class="pdf-tokens">
        {#each toks as tok (tok)}<button type="button" class="chip" onmousedown={(e) => e.preventDefault()} onclick={() => token(tok)}>{tok}</button>{/each}
      </div>
      <p class="muted pdf-note">{t('pdfTokens')}</p>
      <label class="chk"><input type="checkbox" bind:checked={o.rules} /> {t('pdfRules')}</label>

      <h3>{t('pdfSecLook')}</h3>
      <label class="chk"><input type="checkbox" bind:checked={o.plain} /> {t('pdfPlain')}</label>
      <label>{t('pdfInk')}<Select value={o.ink} options={[opt('black', t('pdfInkBlack')), opt('soft', t('pdfInkSoft'))]} onchange={(v) => (o.ink = v as PdfOptions['ink'])} label={t('pdfInk')} /></label>

      <div class="pdf-defaults">
        <button type="button" onclick={makeDefault}>{t('pdfMakeDefault')}</button>
        <button type="button" onclick={resetDefault}>{t('pdfResetDefault')}</button>
      </div>
    </div>
    <div class="pdf-side">
      <div class="pdf-info muted">
        {#if doc}
          {doc.pages.length === 1 ? t('pdfOnePage') : t('pdfPages', { n: doc.pages.length })}
          {#if doc.tooLong} · {t('pdfTooLong')}{/if}
          {#if doc.fonts.missing} · {t('pdfMissing', { n: doc.fonts.missing })}{/if}
        {/if}
      </div>
      <div class="pdf-preview" bind:this={box}>
        {#if doc}
          {#each doc.pages as _p, i (i)}
            <canvas bind:this={cvs[i]} class="pdf-page" style:aspect-ratio={doc.w + ' / ' + doc.h}></canvas>
          {/each}
        {/if}
      </div>
    </div>
  </div>
  <div class="dialog-actions">
    <span class="pdf-status" class:bad={failed} role="status">{status}</span>
    <button type="button" onclick={() => dlg.close()}>{t('cancel')}</button>
    {#if !onAndroid()}<button type="button" disabled={busy || !doc} onclick={download}>{t('pdfDownload')}</button>{/if}
    <button type="button" class="primary" disabled={busy || !doc} onclick={canFolder ? saveNext : download}>{canFolder ? t('pdfSaveNext') : t('pdfDownload')}</button>
  </div>
</dialog>
