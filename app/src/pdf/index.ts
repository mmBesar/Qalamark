// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Notes as PDF files, made inside the app: no print window, the same pages on every system.

import { emitPdf } from './emit.ts';
import { layoutDoc, type Doc, type Env, type Meta } from './flow.ts';
import type { PdfOptions } from './options.ts';

export { layoutDoc, stripProperties } from './flow.ts';
export { emitPdf } from './emit.ts';
export type { Doc, Env, Meta, PdfImage } from './flow.ts';
export { DEFAULT_PDF, cleanOptions, PAPERS } from './options.ts';
export type { PdfOptions } from './options.ts';

/** A note as the bytes of a PDF file. */
export async function makePdf(md: string, meta: Meta, o: PdfOptions, env: Env): Promise<{ bytes: Uint8Array; doc: Doc }> {
  const doc = await layoutDoc(md, meta, o, env);
  return { bytes: await emitPdf(doc), doc };
}
