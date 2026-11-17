// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// What the right-click menu holds in the editor and in plain text boxes.

import { EditorView } from '@codemirror/view';
import { cycleHeading, insertLink, insertSnippet, insertTable, SNIPPETS, toggleLinePrefix, toggleWrap } from '../editor/commands.ts';
import type { Key } from './i18n.ts';
import type { MenuItem } from './ctxmenu.svelte.ts';

type T = (k: Key, v?: Record<string, string | number>) => string;

async function clipboardText(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}

export function editorMenu(e: MouseEvent, t: T): MenuItem[] {
  const dom = (e.target as HTMLElement).closest('.cm-editor') as HTMLElement | null;
  const view = dom ? EditorView.findFromDOM(dom) : null;
  if (!view) return [];
  const sel = view.state.selection.main;
  const inside = e.clientX && e.clientY ? view.posAtCoords({ x: e.clientX, y: e.clientY }) : null;
  // Like every editor: right-clicking outside the selection moves the cursor there first.
  if (inside != null && (inside < sel.from || inside > sel.to)) view.dispatch({ selection: { anchor: inside } });
  // A long press with a finger selects the word under it (handles then stretch the selection).
  if (inside != null && view.state.selection.main.empty && matchMedia('(pointer: coarse)').matches) {
    const w = view.state.wordAt(inside);
    if (w) view.dispatch({ selection: { anchor: w.from, head: w.to } });
  }
  const s = view.state.selection.main;
  const has = !s.empty;
  const ro = view.state.readOnly;
  const text = () => view.state.sliceDoc(s.from, s.to);
  return [
    { label: t('cut'), icon: 'cut', hint: 'Ctrl+X', disabled: !has || ro, run: async () => { await navigator.clipboard.writeText(text()); view.dispatch({ changes: { from: s.from, to: s.to, insert: '' } }); view.focus(); } },
    { label: t('copy') === 'Make a copy' ? 'Copy' : t('copy'), icon: 'copy', hint: 'Ctrl+C', disabled: !has, run: async () => { await navigator.clipboard.writeText(text()); view.focus(); } },
    { label: t('paste'), icon: 'paste', hint: 'Ctrl+V', disabled: ro, run: async () => { const p = await clipboardText(); if (p) view.dispatch({ ...view.state.replaceSelection(p), userEvent: 'input.paste', scrollIntoView: true }); view.focus(); } },
    { label: t('selectLine'), icon: 'select-all', run: () => { const l = view.state.doc.lineAt(s.head); view.dispatch({ selection: { anchor: l.from, head: l.to } }); view.focus(); } },
    { label: t('selectAll'), icon: 'select-all', hint: 'Ctrl+A', run: () => { view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }); view.focus(); } },
    { sep: true },
    ...(ro ? [] : [
      { label: t('bold'), icon: 'bold', hint: 'Ctrl+B', run: () => { toggleWrap(view, '**'); view.focus(); } },
      { label: t('italic'), icon: 'italic', hint: 'Ctrl+I', run: () => { toggleWrap(view, '*'); view.focus(); } },
      { label: t('code'), icon: 'code', run: () => { toggleWrap(view, '`'); view.focus(); } },
      { label: t('link'), icon: 'link', run: () => { insertLink(view); } },
      {
        label: t('insert'),
        icon: 'plus',
        children: [
          { label: t('heading'), icon: 'heading', run: () => { cycleHeading(view); view.focus(); } },
          { label: t('bullet'), icon: 'list', run: () => { toggleLinePrefix(view, '- '); view.focus(); } },
          { label: t('task'), icon: 'check', run: () => { toggleLinePrefix(view, '- [ ] '); view.focus(); } },
          { label: t('quote'), icon: 'quote', run: () => { toggleLinePrefix(view, '> '); view.focus(); } },
          { label: t('table'), icon: 'table', run: () => { insertTable(view); } },
          { label: t('insCallout'), icon: 'layers', run: () => { insertSnippet(view, SNIPPETS.callout); } },
          { label: t('insAdmonition'), icon: 'layers', run: () => { insertSnippet(view, SNIPPETS.admonition); } },
          { label: t('insCollapsible'), icon: 'layers', run: () => { insertSnippet(view, SNIPPETS.collapsible); } },
        ] as MenuItem[],
      },
    ] as MenuItem[]),
  ];
}

export function fieldMenu(f: HTMLInputElement | HTMLTextAreaElement, t: T): MenuItem[] {
  const a = f.selectionStart ?? 0;
  const b = f.selectionEnd ?? 0;
  const has = a !== b;
  const ro = f.readOnly || f.disabled;
  const sel = () => f.value.slice(a, b);
  const put = (v: string) => {
    f.setRangeText(v, a, b, 'end');
    f.dispatchEvent(new Event('input', { bubbles: true }));
  };
  return [
    { label: t('cut'), icon: 'cut', disabled: !has || ro, run: async () => { await navigator.clipboard.writeText(sel()); put(''); f.focus(); } },
    { label: t('copy') === 'Make a copy' ? 'Copy' : t('copy'), icon: 'copy', disabled: !has, run: async () => { await navigator.clipboard.writeText(sel()); f.focus(); } },
    { label: t('paste'), icon: 'paste', disabled: ro, run: async () => { const p = await clipboardText(); if (p) put(p); f.focus(); } },
    { label: t('selectAll'), icon: 'select-all', run: () => { f.focus(); f.select(); } },
  ];
}
