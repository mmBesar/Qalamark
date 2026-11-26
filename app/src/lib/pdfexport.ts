// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Export as PDF: the options a person keeps as their defaults, and where the finished file goes.

import { cleanOptions, DEFAULT_PDF, type PdfOptions } from '../pdf/options.ts';

const KEY = 'qm.pdf.defaults';
const OLD = 'qm.pdf';
/** The person's own defaults (or the app's, until they make some). */
export function loadPdfDefaults(): PdfOptions {
  try {
    const mine = localStorage.getItem(KEY);
    if (mine) return cleanOptions(JSON.parse(mine));
    const old = localStorage.getItem(OLD); // what an older version kept
    if (old) return cleanOptions(JSON.parse(old));
  } catch { /* fall through */ }
  return { ...DEFAULT_PDF };
}
export function savePdfDefaults(o: PdfOptions): void {
  try { localStorage.setItem(KEY, JSON.stringify(o)); localStorage.removeItem(OLD); } catch { /* not saved */ }
}
export function forgetPdfDefaults(): void {
  try { localStorage.removeItem(KEY); localStorage.removeItem(OLD); } catch { /* nothing to forget */ }
}

/** Give the file to the browser's downloads. */
export function downloadPdf(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-') + '.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
