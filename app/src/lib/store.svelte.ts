// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// What the app knows: settings, who is signed in, and the list of notes.
// Two modes share one list: notes on this device only ("local"), and notes
// on a Qalamark server ("server").

import { translate, type Key, type Lang } from './i18n.ts';
import { Api, ApiError, cleanBase, type NoteMeta } from './server.ts';
import { type Accent, applyTheme, type ThemeId } from './theme.ts';
import { deleteStored, readStoredText, writeStoredText } from './session.ts';

export type Mode = 'boot' | 'login' | 'local' | 'server';
export type Theme = ThemeId;

const SETTINGS = 'qm.settings';
const LOCAL_NOTES = 'qm.local.notes';

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be blocked */
  }
}

interface Settings {
  lang: Lang;
  theme: Theme;
  accent: Accent;
  serverUrl: string;
  token: string;
  username: string;
  admin: boolean;
  wantsLocal: boolean;
}

function defaultLang(): Lang {
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

class Store {
  s = $state<Settings>({ lang: 'en', theme: 'auto', accent: 'default', serverUrl: '', token: '', username: '', admin: false, wantsLocal: false, ...read<Partial<Settings>>(SETTINGS, { lang: defaultLang() }) });
  mode = $state<Mode>('boot');
  serverReachable = $state(false);
  setupNeeded = $state(false);
  signupOpen = $state(false);
  notes = $state<NoteMeta[]>([]);
  currentId = $state<string | null>(null);
  message = $state('');
  api = new Api();

  get lang(): Lang {
    return this.s.lang;
  }
  t = (key: Key, vars?: Record<string, string | number>) => translate(this.s.lang, key, vars);

  get current(): NoteMeta | undefined {
    return this.notes.find((n) => n.id === this.currentId);
  }

  private save() {
    write(SETTINGS, this.s);
  }

  /** Apply language and theme to the page. */
  applyLook() {
    const root = document.documentElement;
    root.lang = this.s.lang;
    root.dir = this.s.lang === 'ar' ? 'rtl' : 'ltr';
    // Older versions stored 'light' and 'dark'.
    const legacy: Record<string, Theme> = { light: 'paper', dark: 'mocha' };
    if (legacy[this.s.theme as string]) this.s.theme = legacy[this.s.theme as string]!;
    applyTheme(this.s.theme, this.s.accent);
    if (!this.watching) {
      this.watching = true;
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(this.s.theme, this.s.accent));
    }
  }
  private watching = false;

  setLang(l: Lang) {
    this.s.lang = l;
    this.save();
    this.applyLook();
  }
  setTheme(t: Theme) {
    this.s.theme = t;
    this.save();
    this.applyLook();
  }
  setAccent(a: Accent) {
    this.s.accent = a;
    this.save();
    this.applyLook();
  }

  // -------------------------------------------------------------- start

  async boot() {
    this.applyLook();
    this.api = new Api(cleanBase(this.s.serverUrl), this.s.token);
    await this.detectServer();
    if (this.s.token && this.s.username) {
      this.mode = 'server';
      await this.loadServerNotes();
    } else if (this.s.wantsLocal || !this.serverReachable) {
      this.startLocal();
    } else {
      this.mode = 'login';
    }
  }

  async detectServer() {
    try {
      const st = await this.api.status();
      this.serverReachable = true;
      this.setupNeeded = st.setup;
      this.signupOpen = st.signup;
    } catch {
      this.serverReachable = false;
    }
  }

  startLocal() {
    this.s.wantsLocal = true;
    this.save();
    this.mode = 'local';
    this.notes = read<NoteMeta[]>(LOCAL_NOTES, []);
    this.currentId = this.notes[0]?.id ?? null;
  }

  // ------------------------------------------------------------ accounts

  async connect(serverUrl: string) {
    this.s.serverUrl = cleanBase(serverUrl);
    this.api = new Api(this.s.serverUrl, '');
    this.save();
    await this.detectServer();
    if (!this.serverReachable) throw new ApiError(0, this.t('cantReach'));
  }

  async signIn(username: string, password: string, create: boolean) {
    const label = navigator.userAgent.slice(0, 60);
    const ses = create ? await this.api.register(username, password, label) : await this.api.login(username, password, label);
    this.s.token = ses.token;
    this.s.username = ses.username;
    this.s.admin = ses.admin;
    this.s.wantsLocal = false;
    this.save();
    this.api.token = ses.token;
    this.mode = 'server';
    await this.loadServerNotes();
  }

  async signOut() {
    try {
      await this.api.logout();
    } catch {
      /* the server may be away; we still sign out here */
    }
    this.s.token = '';
    this.s.username = '';
    this.s.admin = false;
    this.api.token = '';
    this.currentId = null;
    this.notes = [];
    this.save();
    await this.detectServer();
    if (this.serverReachable) this.mode = 'login';
    else this.startLocal();
  }

  showLogin() {
    this.s.wantsLocal = false;
    this.save();
    this.mode = 'login';
  }

  // --------------------------------------------------------------- notes

  private cacheKey() {
    return `qm.cache.${this.api.base}|${this.s.username}`;
  }

  async loadServerNotes() {
    this.notes = read<NoteMeta[]>(this.cacheKey(), []);
    try {
      this.notes = await this.api.notes();
      this.serverReachable = true;
      write(this.cacheKey(), this.notes);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await this.signOut();
        return;
      }
      this.serverReachable = false; // keep the cached list: we are offline
    }
    if (!this.notes.some((n) => n.id === this.currentId)) this.currentId = this.notes[0]?.id ?? null;
  }

  private saveLocalList() {
    write(LOCAL_NOTES, this.notes);
  }

  /** Name of the copy kept on this device. */
  storeName(id: string): string {
    return this.mode === 'server' ? `srv:${this.api.base}:${id}` : `local:${id}`;
  }

  async createNote(title = '', content = ''): Promise<string> {
    const name = title.trim() || this.t('untitled');
    if (this.mode === 'server') {
      const n = await this.api.createNote(name, content);
      this.notes = [n, ...this.notes];
      write(this.cacheKey(), this.notes);
      this.currentId = n.id;
      return n.id;
    }
    const id = crypto.randomUUID();
    const n: NoteMeta = { id, title: this.uniqueLocalTitle(name), owner: '', role: 'owner', updated: Math.floor(Date.now() / 1000) };
    if (content) await writeStoredText(`local:${id}`, content);
    this.notes = [n, ...this.notes];
    this.saveLocalList();
    this.currentId = id;
    return id;
  }

  private uniqueLocalTitle(title: string): string {
    const used = new Set(this.notes.map((n) => n.title));
    if (!used.has(title)) return title;
    for (let i = 2; ; i++) if (!used.has(`${title} ${i}`)) return `${title} ${i}`;
  }

  async renameNote(id: string, title: string) {
    const name = title.trim();
    const note = this.notes.find((n) => n.id === id);
    if (!note || !name || name === note.title) return;
    if (this.mode === 'server') {
      const n = await this.api.renameNote(id, name);
      this.notes = this.notes.map((x) => (x.id === id ? { ...x, title: n.title } : x));
      write(this.cacheKey(), this.notes);
    } else {
      this.notes = this.notes.map((x) => (x.id === id ? { ...x, title: name } : x));
      this.saveLocalList();
    }
  }

  async deleteNote(id: string) {
    if (this.mode === 'server') {
      const n = this.notes.find((x) => x.id === id);
      if (n && n.role !== 'owner') await this.api.removeShare(id, this.s.username);
      else await this.api.deleteNote(id);
    }
    deleteStored(this.storeName(id));
    this.notes = this.notes.filter((n) => n.id !== id);
    if (this.mode === 'server') write(this.cacheKey(), this.notes);
    else this.saveLocalList();
    if (this.currentId === id) this.currentId = this.notes[0]?.id ?? null;
  }

  /** Open the note called `title`; make it if it does not exist yet (like Obsidian). */
  async openTitle(title: string) {
    const want = title.trim().toLowerCase();
    const found = this.notes.find((n) => n.title.toLowerCase() === want);
    if (found) this.currentId = found.id;
    else await this.createNote(title.trim());
  }

  /** Notes that link to this one with [[its title]]. */
  async backlinks(id: string): Promise<Array<{ id: string; title: string }>> {
    if (this.mode === 'server') return this.api.backlinks(id);
    const me = this.notes.find((n) => n.id === id);
    if (!me) return [];
    const want = me.title.toLowerCase();
    const out: Array<{ id: string; title: string }> = [];
    for (const n of this.notes) {
      if (n.id === id) continue;
      const text = await readStoredText(`local:${n.id}`);
      for (const m of text.matchAll(/(?<!!)\[\[([^\]\n|#]*)/g)) {
        if (m[1]!.trim().toLowerCase() === want) {
          out.push({ id: n.id, title: n.title });
          break;
        }
      }
    }
    return out;
  }

  async importFiles(files: FileList | File[]) {
    let last = '';
    for (const f of Array.from(files)) {
      const text = await f.text();
      last = await this.createNote(f.name.replace(/\.(md|markdown|txt)$/i, ''), text);
    }
    if (last) this.currentId = last;
  }

  async exportText(id: string, liveText?: string): Promise<string> {
    if (liveText !== undefined) return liveText;
    return readStoredText(this.storeName(id));
  }

  /** Move the notes kept on this device to the server. */
  async uploadLocalNotes(): Promise<number> {
    const local = read<NoteMeta[]>(LOCAL_NOTES, []);
    let n = 0;
    for (const note of local) {
      const text = await readStoredText(`local:${note.id}`);
      const made = await this.api.createNote(note.title, text);
      this.notes = [made, ...this.notes];
      deleteStored(`local:${note.id}`);
      n++;
    }
    write(LOCAL_NOTES, []);
    write(this.cacheKey(), this.notes);
    return n;
  }

  hasLocalNotes(): boolean {
    return read<NoteMeta[]>(LOCAL_NOTES, []).length > 0;
  }

  touch(id: string) {
    const n = this.notes.find((x) => x.id === id);
    if (n) n.updated = Math.floor(Date.now() / 1000);
    if (this.mode === 'local') this.saveLocalList();
  }
}

export const store = new Store();
