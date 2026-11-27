// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The notes folder of the Linux and Android apps (plain .md files on disk). The commands live in
// the Rust side (src-tauri); in a normal browser none of this is used.

export const inShell = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
/** Android: hide (or bring back) the status and navigation bars, so reading gets the whole screen. */
export const immersive = (on: boolean): void => {
  try {
    (window as unknown as { QalamarkAndroid?: { immersive(on: boolean): void } }).QalamarkAndroid?.immersive(on);
  } catch {
    /* not in the Android app */
  }
};
/** Android: colour the status and navigation bars like the page. `light` = dark icons for a light page. */
export const androidBars = (color: string, light: boolean): void => {
  try {
    (window as unknown as { QalamarkAndroid?: { bars(c: string, l: boolean): void } }).QalamarkAndroid?.bars(color, light);
  } catch {
    /* not in the Android app */
  }
};
/** The phone's or desktop's own colours, when the app can read them (Material You, KDE scheme, GNOME accent). */
export interface SystemColors { bg?: string; side?: string; fg?: string; accent?: string; dark?: boolean; you?: Record<string, string> }
export async function systemColors(): Promise<SystemColors | null> {
  try {
    const a = (window as unknown as { QalamarkAndroid?: { dynamicColors?(): string } }).QalamarkAndroid;
    if (a?.dynamicColors) {
      const raw = a.dynamicColors();
      return raw ? { you: JSON.parse(raw) as Record<string, string> } : null;
    }
    if (inShell()) {
      const r = await call<Record<string, unknown>>('system_colors');
      const out: SystemColors = {};
      for (const k of ['bg', 'side', 'fg', 'accent'] as const) if (typeof r[k] === 'string') out[k] = r[k] as string;
      if (typeof r.dark === 'boolean') out.dark = r.dark;
      return Object.keys(out).length ? out : null;
    }
  } catch {
    /* not available */
  }
  return null;
}
export const onAndroid = (): boolean => typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export interface VaultInfo {
  path: string;
  default_path: string;
}
export interface VaultEntry {
  path: string;
  mtime_ms: number;
}

export const vault = {
  info: () => call<VaultInfo>('vault_info'),
  set: (path: string) => call<string>('vault_set', { path }),
  list: () => call<VaultEntry[]>('vault_list'),
  read: (path: string) => call<{ text: string; mtime_ms: number }>('vault_read', { path }),
  write: (path: string, text: string) => call<number>('vault_write', { path, text }),
  /** A file made from a note (its PDF), written next to it. */
  async writeFile(path: string, bytes: Uint8Array): Promise<number> {
    const { toBase64 } = await import('./pdfexport.ts');
    return call<number>('vault_write_file', { path, data: toBase64(bytes) });
  },
  trash: (path: string) => call<void>('vault_trash', { path }),
  rename: (from: string, to: string) => call<number>('vault_rename', { from, to }),
  mkdir: (folder: string) => call<void>('vault_mkdir', { folder }),
  reveal: (path: string) => call<void>('vault_reveal', { path }),
  /** Ask the system for a folder (desktop only). */
  async pick(): Promise<string | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const r = await open({ directory: true, multiple: false });
    return typeof r === 'string' ? r : null;
  },
};

/** File name for a note: the title, without characters a file system dislikes. */
export function fileName(title: string): string {
  return (title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^\.+/, '').trim() || 'Untitled') + '.md';
}

export const notePath = (folder: string, title: string): string => (folder ? folder + '/' : '') + fileName(title);

/** "Work/Plans/Big.md" → folder "Work/Plans", title "Big" */
export function splitPath(path: string): { folder: string; title: string } {
  const i = path.lastIndexOf('/');
  return { folder: i < 0 ? '' : path.slice(0, i), title: path.slice(i + 1).replace(/\.md$/i, '') };
}

/** Self-signed servers (apps only): look at a certificate, and reach a server through the trusted-certificate bridge. */
export const tls = {
  probe: (url: string) => call<string>('tls_probe', { url }),
  /** Why this server cannot be reached (an empty string when it can). */
  check: (url: string, pin: string) => call<void>('net_check', { url, pin }).then(() => '', (e) => (e instanceof Error ? e.message : String(e))),
  /** The address on this device that reaches the server (the web view never talks to it directly). */
  bridge: (url: string, pin: string) => call<string>('net_bridge', { url, pin }),
};
