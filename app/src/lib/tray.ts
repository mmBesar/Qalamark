// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The system tray of the desktop app: the choices, kept by the native side, and the events its menu sends back.

import { inShell, onAndroid } from './vault.ts';
import type { Key } from './i18n.ts';

export interface TrayConfig {
  enabled: boolean;
  close_to_tray: boolean;
  autostart: boolean;
  start_hidden: boolean;
  style: 'pen' | 'outline' | 'qaf';
  tone: 'colour' | 'light' | 'dark' | 'auto';
}

/** Only the Linux desktop app has a tray (not the browser, not Android). */
export const hasTray = (): boolean => inShell() && !onAndroid();

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export const labels = (t: (k: Key) => string) => ({ open: t('trayOpen'), new_note: t('trayNew'), settings: t('trayMenuSettings'), quit: t('trayQuit'), tooltip: 'Qalamark' });

export const trayGet = (): Promise<TrayConfig> => call('tray_get');
export const trayOk = (): Promise<boolean> => call('tray_ok');
export const traySet = (config: TrayConfig, t: (k: Key) => string): Promise<TrayConfig> => call('tray_set', { config, labels: labels(t) });

/** Tell the native side the words of the menu again (after the language changed), if the tray is on. */
export async function trayRefresh(t: (k: Key) => string): Promise<void> {
  try {
    const c = await trayGet();
    if (c.enabled) await traySet(c, t);
  } catch { /* no tray here */ }
}

/** Menu choices that need the web app: "New note" and "Settings". */
export async function listenTray(onNew: () => void, onSettings: () => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  const a = await listen('tray-new-note', onNew);
  const b = await listen('tray-settings', onSettings);
  return () => { a(); b(); };
}

const icons = import.meta.glob('../../src-tauri/icons/tray/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
/** The picture of an icon (for the settings page). */
export const trayPicture = (style: string, tone: string): string => icons[`../../src-tauri/icons/tray/${style}-${tone}.png`] ?? '';
