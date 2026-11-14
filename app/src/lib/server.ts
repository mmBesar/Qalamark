// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Talking to the Qalamark server.

export interface NoteMeta {
  id: string;
  title: string;
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
  createNote(title: string, content = '') {
    return this.call<NoteMeta>('POST', '/api/notes', { title, content });
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
