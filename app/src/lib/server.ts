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
  vp?: string; // notes folder (apps): the file this note was last written to
  vm?: number; // and that file's modified time, to notice edits made outside
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
  /** The server's address as the user knows it (also the name of its on-device cache). */
  base: string;
  token: string;
  /** Where requests really go: the server itself, or the local bridge for a trusted self-signed certificate. */
  transport: string;

  constructor(base = '', token = '', transport = '') {
    this.base = base;
    this.token = token;
    this.transport = transport || base;
  }

  async call<T>(method: string, path: string, body?: unknown, timeoutMs = 15000): Promise<T> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(this.transport + path, {
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
    return this.call<Status>('GET', '/api/status', undefined, 10000);
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
  /** `requestId` makes the call safe to repeat: the server answers a second call with the note the first one made. */
  createNote(title: string, content = '', folder = '', requestId = '') {
    return this.call<NoteMeta>('POST', '/api/notes', { title, content, folder, request_id: requestId });
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
    const r = await fetch(this.transport + '/api/images', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': blob.type || 'image/png' },
      body: blob,
    });
    if (!r.ok) throw new ApiError(r.status, await r.text());
    return r.json();
  }
  /** Pictures no note uses any more (older than a day). */
  unusedImages() {
    return this.call<{ names: string[] }>('GET', '/api/images/unused');
  }
  /** Delete them. */
  pruneImages() {
    return this.call<{ names: string[] }>('DELETE', '/api/images/unused');
  }
  /** A picture as a blob: the page cannot send the sign-in header from a plain <img>. */
  async imageBlob(owner: string, file: string): Promise<Blob> {
    const r = await fetch(`${this.transport}/api/images/${encodeURIComponent(owner)}/${encodeURIComponent(file)}`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!r.ok) throw new ApiError(r.status, 'No such picture');
    return r.blob();
  }
  /** Someone's profile picture as a blob, or null when they have none. */
  async avatarBlob(name: string): Promise<Blob | null> {
    const r = await fetch(`${this.transport}/api/avatars/${encodeURIComponent(name)}`, { headers: { authorization: `Bearer ${this.token}` } });
    if (r.status === 404) return null;
    if (!r.ok) throw new ApiError(r.status, 'No picture');
    return r.blob();
  }
  async setAvatar(blob: Blob): Promise<void> {
    const r = await fetch(this.transport + '/api/me/avatar', { method: 'PUT', headers: { authorization: `Bearer ${this.token}`, 'content-type': blob.type }, body: blob });
    if (!r.ok) throw new ApiError(r.status, await r.text());
  }
  deleteAvatar() {
    return this.call<void>('DELETE', '/api/me/avatar');
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
    const origin = this.transport || location.origin;
    return origin.replace(/^http/i, 'ws') + '/ws';
  }
}
