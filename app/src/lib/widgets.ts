// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Android home-screen widgets and keeping the app alive in the background. The widget lives in the native part of the app
// (it cannot run this code), so the two sides talk through a small bridge: we hand over a snapshot of the checklists, the
// widget hands back the ticks made on the home screen, and we apply them to the notes like any other edit (so they sync).

import { flatItems, isChecklist, parseChecklist, toggleItem } from './checklist.ts';

interface Bridge {
  widgetData?(json: string): void;
  takeTicks?(): string;
  pushTick?(json: string): void;
  keepAlive?(on: boolean): void;
}
const bridge = (): Bridge | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { QalamarkAndroid?: Bridge }).QalamarkAndroid);
export const hasWidgets = (): boolean => !!bridge()?.widgetData;

export interface WidgetItem { line: number; text: string; done: boolean; depth: number; head?: boolean }
export interface WidgetList { id: string; title: string; items: WidgetItem[]; updated: number }

/** The items of a checklist as the widget shows them, parents before their subtasks. */
export function widgetItems(text: string): WidgetItem[] {
  const out: WidgetItem[] = [];
  const tasks = (list: ReturnType<typeof parseChecklist>['sections'][number]['items'], depth: number) => {
    for (const it of list) {
      out.push({ line: it.line, text: it.text, done: it.done, depth });
      tasks(it.children, depth + 1);
    }
  };
  // sections are shown as headings with their tasks under them, sub-sections nested inside
  const section = (sec: ReturnType<typeof parseChecklist>['sections'][number], level: number) => {
    if (sec.title) out.push({ line: -1, text: sec.title, done: false, depth: level, head: true });
    tasks(sec.items, 0);
    for (const c of sec.children) section(c, level + 1);
  };
  for (const r of parseChecklist(text).roots) section(r, 0);
  return out.slice(0, 120);
}

let lastSent = '';
/** Give the widget the current checklists (only when something changed). */
export function publishLists(lists: WidgetList[]): void {
  const b = bridge();
  if (!b?.widgetData) return;
  const json = JSON.stringify(lists.map((l) => ({ id: l.id, title: l.title, items: l.items })));
  if (json === lastSent) return;
  lastSent = json;
  try { b.widgetData(json); } catch { /* the widget part is not there */ }
}

/** The ticks made on the home screen since last time: [{ id, line }]. */
export function takeTicks(): Array<{ id: string; line: number }> {
  const b = bridge();
  if (!b?.takeTicks) return [];
  try {
    const list = JSON.parse(b.takeTicks() || '[]') as Array<{ id: string; line: number }>;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
export const putBackTick = (t: { id: string; line: number }): void => { try { bridge()?.pushTick?.(JSON.stringify(t)); } catch { /* ignore */ } };

/** Keep the app running in the background (a quiet notification) so changes made elsewhere arrive before you need them. */
export function keepAlive(on: boolean): void {
  try { bridge()?.keepAlive?.(on); } catch { /* not in the Android app */ }
}

export { flatItems, isChecklist, toggleItem };
