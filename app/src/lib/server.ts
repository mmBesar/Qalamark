// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Talking to the Qalamark server.

export interface NoteMeta {
  id: string;
  title: string;
  folder?: string; // "" or "Work/Projects"
  display?: string; // the title: property, when the note has one
  owner: string;
  role: 'owner' | 'edit' | 'view';
  updated: number;
}

export interface Status {
  setup: boolean;
  signup: boolean;
  version: string;
}

export interface Session {
  token: string;
  username: string;
  admin: boolean;
}

export interface Share {
  username: string;
  role: 'edit' | 'view';
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Turn what the user typed ("notes.example.com") into a base URL without a trailing slash. */
export function cleanBase(input: string): string {
  let s = input.trim();
  if (s === '') return '';
  if (!/^https?:\/\//i.test(s)) s = (/^(localhost|127\.|10\.|192\.168\.)/.test(s) ? 'http://' : 'https://') + s;
  return s.replace(/\/+$/, '');
}

export class Api {
  base: string;
  token: string;

  constructor(base = '', token = '') {
    this.base = base;
    this.token = token;
  }

  async call<T>(method: string, path: string, body?: unknown, timeoutMs = 15000): Promise<T> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(this.base + path, {
        method,
        signal: ctl.signal,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      if (!res.ok) throw new ApiError(res.status, text || res.statusText);
      return (text ? JSON.parse(text) : undefined) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  status() {
    return this.call<Status>('GET', '/api/status', undefined, 4000);
  }
  register(username: string, password: string, label = '') {
    return this.call<Session>('POST', '/api/register', { username, password, label });
  }
  login(username: string, password: string, label = '') {
    return this.call<Session>('POST', '/api/login', { username, password, label });
  }
  logout() {
    return this.call<void>('POST', '/api/logout');
  }
  me() {
    return this.call<{ username: string; admin: boolean }>('GET', '/api/me', undefined, 6000);
  }
  notes() {
    return this.call<NoteMeta[]>('GET', '/api/notes', undefined, 8000);
  }
  createNote(title: string, content = '', folder = '') {
    return this.call<NoteMeta>('POST', '/api/notes', { title, content, folder });
  }
  folders() {
    return this.call<string[]>('GET', '/api/folders');
  }
  createFolder(path: string) {
    return this.call<{ path: string }>('POST', '/api/folders', { path });
  }
  moveFolder(from: string, to: string) {
    return this.call<{ path: string }>('PATCH', '/api/folders', { from, to });
  }
  deleteFolder(path: string) {
    return this.call<void>('DELETE', `/api/folders?path=${encodeURIComponent(path)}`);
  }
  moveNote(id: string, folder: string) {
    return this.call<NoteMeta>('PATCH', `/api/notes/${id}`, { folder });
  }
  /** Upload a picture; returns the markdown to put in the note. */
  async uploadImage(blob: Blob): Promise<{ name: string; markdown: string }> {
    const r = await fetch(this.base + '/api/images', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': blob.type || 'image/png' },
      body: blob,
    });
    if (!r.ok) throw new ApiError(r.status, await r.text());
    return r.json();
  }
  /** A picture as a blob: the page cannot send the sign-in header from a plain <img>. */
  async imageBlob(owner: string, file: string): Promise<Blob> {
    const r = await fetch(`${this.base}/api/images/${encodeURIComponent(owner)}/${encodeURIComponent(file)}`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!r.ok) throw new ApiError(r.status, 'No such picture');
    return r.blob();
  }
  getNote(id: string) {
    return this.call<NoteMeta & { content: string }>('GET', `/api/notes/${id}`);
  }
  renameNote(id: string, title: string) {
    return this.call<NoteMeta>('PATCH', `/api/notes/${id}`, { title });
  }
  deleteNote(id: string) {
    return this.call<void>('DELETE', `/api/notes/${id}`);
  }
  search(q: string) {
    return this.call<Array<{ id: string; title: string; snippet: string }>>('GET', `/api/search?q=${encodeURIComponent(q)}`);
  }

  backlinks(id: string) {
    return this.call<Array<{ id: string; title: string }>>('GET', `/api/notes/${id}/backlinks`);
  }
  shares(id: string) {
    return this.call<Share[]>('GET', `/api/notes/${id}/shares`);
  }
  addShare(id: string, username: string, role: 'edit' | 'view') {
    return this.call<Share>('POST', `/api/notes/${id}/shares`, { username, role });
  }
  removeShare(id: string, username: string) {
    return this.call<void>('DELETE', `/api/notes/${id}/shares/${encodeURIComponent(username)}`);
  }
  addUser(username: string, password: string, admin = false) {
    return this.call<void>('POST', '/api/users', { username, password, admin });
  }
  people() {
    return this.call<string[]>('GET', '/api/people');
  }
  listUsers() {
    return this.call<Array<{ username: string; admin: boolean }>>('GET', '/api/users');
  }
  updateUser(name: string, patch: { password?: string; admin?: boolean }) {
    return this.call<void>('PATCH', `/api/users/${encodeURIComponent(name)}`, patch);
  }
  deleteUser(name: string) {
    return this.call<void>('DELETE', `/api/users/${encodeURIComponent(name)}`);
  }
  getAdminSettings() {
    return this.call<{ signup: boolean }>('GET', '/api/admin/settings');
  }
  setSignup(signup: boolean) {
    return this.call<{ signup: boolean }>('PUT', '/api/admin/settings', { signup });
  }
  changePassword(oldPw: string, newPw: string) {
    return this.call<void>('POST', '/api/password', { old: oldPw, new: newPw });
  }
  /** Address for the live-editing connection. */
  wsBase(): string {
    const origin = this.base || location.origin;
    return origin.replace(/^http/i, 'ws') + '/ws';
  }
}
