// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Export as PDF: the options a person keeps as their defaults, and where the finished file goes.

import { inShell, onAndroid } from './vault.ts';
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

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Where a PDF went when it was handed to the device: Downloads (Android), a place the person chose (desktop), the browser's downloads. Null: they cancelled. */
export type Handed = { how: 'downloads' | 'chosen' | 'browser'; where: string } | null;

/** Hand the finished PDF to the device in the way that suits it. */
export async function handToDevice(bytes: Uint8Array, name: string): Promise<Handed> {
  const file = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-') + '.pdf';
  if (onAndroid()) {
    const b = (window as unknown as { QalamarkAndroid?: { savePdf?(b64: string, n: string): string } }).QalamarkAndroid;
    if (b?.savePdf) {
      const got = b.savePdf(toBase64(bytes), file);
      if (!got) throw new Error('Android refused the file');
      return { how: 'downloads', where: got };
    }
  } else if (inShell()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke<string | null>('save_file_as', { name: file, data: toBase64(bytes) });
    return path ? { how: 'chosen', where: path } : null;
  }
  downloadPdf(bytes, name);
  return { how: 'browser', where: file };
}
