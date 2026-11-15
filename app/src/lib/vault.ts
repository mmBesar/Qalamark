// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The notes folder of the Linux and Android apps (plain .md files on disk). The commands live in
// the Rust side (src-tauri); in a normal browser none of this is used.

export const inShell = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
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
  trash: (path: string) => call<void>('vault_trash', { path }),
  rename: (from: string, to: string) => call<number>('vault_rename', { from, to }),
  mkdir: (folder: string) => call<void>('vault_mkdir', { folder }),
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
