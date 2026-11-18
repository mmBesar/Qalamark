// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// What the app knows: settings, who is signed in, and the list of notes.
// Two modes share one list: notes on this device only ("local"), and notes
// on a Qalamark server ("server").

import { type NoteRow, setPropText } from './base.ts';
import { type PropType, readFrontMatter } from './frontmatter.ts';
import { parseHeadings, splitTarget } from './headings.ts';
import { translate, type Key, type Lang } from './i18n.ts';
import { BUILT_IN, fill, TEMPLATES_FOLDER } from './templates.ts';
import { Api, ApiError, cleanBase, type NoteMeta } from './server.ts';
import { type Accent, applyTheme, type ThemeId } from './theme.ts';
import { inShell, notePath, onAndroid, splitPath, tls, vault } from './vault.ts';
import { setArabicFont } from './fonts.ts';
import { applyText } from './ytext.ts';
import { chooseBox, confirmBox } from './dialog.svelte.ts';
import { deleteStored, readStoredText, syncNoteNow, writeStoredText } from './session.ts';

export type Mode = 'boot' | 'welcome' | 'login' | 'local' | 'server';
export type Theme = ThemeId;

const SETTINGS = 'qm.settings';
const LOCAL_NOTES = 'qm.local.notes';
const LOCAL_FOLDERS = 'qm.local.folders';

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
  /** The apps ask once, at the first start: a server or this device only. */
  welcomed: boolean;
  fontSize: number; // px
  editorWidth: number; // rem, 0 = the whole window
  fontEn: string;
  fontAr: string;
  fontCode: string;
  sideWidth: number; // px
  sourceSize: number; // px, source mode
  fontSource: string;
  centerPage: boolean;
  /** Desktop: the sidebar can be hidden for a clean page. */
  hideSide: boolean;
  /** Self-signed servers the user chose to trust (apps): address -> certificate fingerprint. */
  trust: Record<string, string>;
  /** Apps: accept a server's self-signed certificate (the first one seen is remembered). */
  allowSelfSigned: boolean;
  /** Apps: accept plain http:// servers (no encryption). */
  allowHttp: boolean;
}

function defaultLang(): Lang {
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

class Store {
  s = $state<Settings>({ lang: 'en', theme: onAndroid() ? 'system' : 'auto', accent: 'default', serverUrl: '', token: '', username: '', admin: false, wantsLocal: false, welcomed: false, fontSize: 17, editorWidth: 50, fontEn: '', fontAr: '', fontCode: '', sideWidth: 304, sourceSize: 15, fontSource: '', centerPage: false, hideSide: false, trust: {}, allowSelfSigned: false, allowHttp: false, ...read<Partial<Settings>>(SETTINGS, { lang: defaultLang() }) });
  mode = $state<Mode>('boot');
  serverReachable = $state(false);
  setupNeeded = $state(false);
  signupOpen = $state(false);
  notes = $state<NoteMeta[]>([]);
  /** Folders that exist (also the empty ones). */
  folders = $state<string[]>([]);
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
    this.applyLayout();
    if (!this.watching) {
      this.watching = true;
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(this.s.theme, this.s.accent));
    }
  }
  private watching = false;

  /** Names of fonts the user added. */
  userFonts = $state<string[]>([]);

  /** Fonts, text size, editor width and sidebar width, as CSS variables. */
  applyLayout() {
    const css = document.documentElement.style;
    const q = (name: string) => `'${name.replace(/['"\\]/g, '')}'`;
    const en = [this.s.fontEn.trim() ? q(this.s.fontEn.trim()) : '', "'Qalamark Roboto'", 'Roboto'].filter(Boolean).join(', ');
    // Arabic letters: the chosen font (alias 'QM Arabic'), then the bundled ones. All of them only cover Arabic
    // characters, so they can stand in front of the English font without changing it.
    const ar = ["'QM Arabic'", "'Qalamark Naskh UI'", "'Qalamark Sans Arabic'"].join(', ');
    void setArabicFont(this.s.fontAr);
    const code = [
      this.s.fontCode.trim() ? q(this.s.fontCode.trim()) : '',
      "'JetBrainsMono Nerd Font Mono'",
      "'JetBrainsMono NFM'",
      "'JetBrains Mono'",
      'ui-monospace',
      'Consolas',
      'monospace',
    ]
      .filter(Boolean)
      .join(', ');
    css.setProperty('--ui', `${ar}, ${en}, system-ui, sans-serif`);
    css.setProperty('--mono', `${ar}, ${code}`);
    css.setProperty('--font-size', `${this.s.fontSize}px`);
    css.setProperty('--editor-w', this.s.editorWidth > 0 ? `${this.s.editorWidth}rem` : '100%');
    css.setProperty('--side-w', `${this.s.sideWidth}px`);
    css.setProperty('--source-size', `${this.s.sourceSize}px`);
    if (this.s.fontSource.trim()) css.setProperty('--source-font', `${ar}, ${q(this.s.fontSource.trim())}, ${code}`);
    else css.removeProperty('--source-font');
    document.documentElement.dataset.page = this.s.centerPage ? 'center' : 'side';
  }
  setLayout(patch: Partial<Pick<Settings, 'fontSize' | 'editorWidth' | 'fontEn' | 'fontAr' | 'fontCode' | 'sideWidth' | 'sourceSize' | 'fontSource' | 'centerPage'>>) {
    Object.assign(this.s, patch);
    this.save();
    this.applyLayout();
  }

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
    // a server set up before the connection choices existed keeps working the way it did
    if (!this.s.allowSelfSigned && !this.s.allowHttp) {
      const u = cleanBase(this.s.serverUrl);
      if (u.startsWith('http://')) this.s.allowHttp = true;
      else if (u && this.s.trust?.[u]) this.s.allowSelfSigned = true;
      this.save();
    }
    this.api = await this.makeApi(cleanBase(this.s.serverUrl), this.s.token);
    await this.detectServer();
    if (this.s.token && this.s.username) {
      this.mode = 'server';
      await this.loadServerNotes();
    } else if (this.s.wantsLocal) {
      this.startLocal();
    } else if (inShell() && !this.s.welcomed) {
      this.mode = 'welcome';
    } else if (!this.serverReachable) {
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
      // in the apps the web view may refuse an address it dislikes (http from an https page, a certificate...): go round it
      if (inShell() && this.api.base && this.api.transport === this.api.base) {
        try {
          const via = await this.makeApi(this.api.base, this.api.token, true);
          if (via.transport !== via.base) {
            const st = await via.status();
            this.api = via;
            this.serverReachable = true;
            this.setupNeeded = st.setup;
            this.signupOpen = st.signup;
          }
        } catch {
          /* still unreachable */
        }
      }
    }
  }

  /** The first-start question. */
  chooseStart(what: 'server' | 'local') {
    this.s.welcomed = true;
    this.save();
    if (what === 'local') this.startLocal();
    else this.showLogin();
  }

  startLocal() {
    this.s.wantsLocal = true;
    this.save();
    this.mode = 'local';
    this.notes = read<NoteMeta[]>(LOCAL_NOTES, []);
    this.folders = read<string[]>(LOCAL_FOLDERS, []);
    this.currentId = this.notes[0]?.id ?? null;
    void this.vaultStart();
  }

  // ------------------------------------------------------------ notes folder (apps only)

  /** Where the .md files are (apps only; empty in a browser). */
  vaultPath = $state('');
  vaultDefault = $state('');
  vaultError = $state('');
  /** Bumped when a file changed outside the app, so an open note reloads. */
  epoch = $state(0);
  private vaultBusy = false;
  private vaultBound = false;

  /** Each account (and the "no account" mode) gets its own notes folder, so one person's files can never be
   *  picked up as another's notes when two people use the same computer. The first account keeps the current folder. */
  private async vaultForAccount() {
    const acct = this.mode === 'server' ? `${this.api.base}|${this.s.username}` : 'local';
    const map = read<Record<string, string>>('qm.vaultFor', {});
    const info = await vault.info();
    let want = map[acct] === '@default' ? info.default_path : map[acct];
    // Android: the app's private folder gives way to Documents/Qalamark once the system allows it (the files are carried over)
    if (want && want.includes('/Android/data/') && info.default_path.startsWith('/storage/emulated/0/Documents')) want = info.default_path;
    // the folder was only reserved by "this device only" mode, which holds no notes: the first account takes it over
    if (!want && acct !== 'local' && map.local && !read<NoteMeta[]>(LOCAL_NOTES, []).length) {
      want = map[acct] = map.local;
      delete map.local;
      write('qm.vaultFor', map);
    }
    if (!want) {
      want = Object.keys(map).length ? `${info.default_path}-${acct.replace(/^https?:\/\//, '').replace(/[^\w.@-]+/g, '-').slice(0, 60)}` : info.default_path;
      map[acct] = want === info.default_path ? '@default' : want;
      write('qm.vaultFor', map);
    }
    if (want === info.default_path) {
      if (info.path !== want) await vault.set('');
    } else if (want !== info.path) await vault.set(want);
    this.vaultAccount = acct;
  }
  private vaultAccount = '';

  /** Coming back to the app (from the Android permission screen, say): the folder in use may have changed. */
  private async vaultRecheck() {
    if (!inShell() || !this.vaultOn) return;
    try {
      await this.vaultForAccount();
      const i = await vault.info();
      this.vaultPath = i.path;
      this.vaultDefault = i.default_path;
    } catch (e) {
      this.vaultError = e instanceof Error ? e.message : String(e);
    }
  }

  async vaultStart() {
    if (!inShell()) return;
    try {
      await this.vaultForAccount();
      const i = await vault.info();
      this.vaultPath = i.path;
      this.vaultDefault = i.default_path;
      await this.vaultSync();
      if (!this.vaultBound) {
        this.vaultBound = true;
        window.addEventListener('focus', () => void this.vaultRecheck().then(() => this.vaultSync()));
      }
    } catch (e) {
      this.vaultError = e instanceof Error ? e.message : String(e);
    }
  }

  private get vaultOn() {
    return !!this.vaultPath && (this.mode === 'local' || this.mode === 'server');
  }
  /** Notes the folder mirrors: all of them on this device, or (with a server) the user's own. */
  private mirrored(n: NoteMeta) {
    return this.mode === 'local' || (n.role === 'owner' && !n.id.startsWith('tmp:'));
  }
  private saveNotes() {
    if (this.mode === 'server') write(this.cacheKey(), this.notes);
    else write(LOCAL_NOTES, this.notes);
  }
  /** A file was changed outside the app: bring its text into the note (and to the server). */
  private async importText(n: NoteMeta, text: string) {
    if (this.mode === 'server') {
      if (this.currentId === n.id) {
        await writeStoredText(this.storeName(n.id), text);
        this.epoch++; // the open note reloads; it syncs the change itself
      } else if (this.serverReachable) {
        await syncNoteNow(this.storeName(n.id), this.api, n.id, (t) => applyText(t, text));
      } else {
        await writeStoredText(this.storeName(n.id), text); // sent when this note is opened next time online
      }
    } else {
      await writeStoredText(`local:${n.id}`, text);
      if (this.currentId === n.id) this.epoch++;
    }
  }

  /** Bring the app and the folder together: new or edited files come in, new notes go out. */
  async vaultSync() {
    if (!this.vaultOn || this.vaultBusy) return;
    this.vaultBusy = true;
    try {
      const files = await vault.list();
      const onDisk = new Map(files.map((f) => [f.path, f]));
      let changed = false;
      const keep: NoteMeta[] = [];
      for (const n0 of [...this.notes]) {
        let n = n0;
        if (!this.mirrored(n)) {
          keep.push(n);
          continue;
        }
        const want = notePath(n.folder ?? '', n.title);
        const f = onDisk.get(n.vp ?? want);
        if (n.vp && !f && this.mode === 'local') {
          // deleted outside the app
          deleteStored(`local:${n.id}`);
          if (this.currentId === n.id) this.currentId = null;
          changed = true;
          continue;
        }
        if (!f) {
          // (with a server the server is the truth: a file deleted outside is simply written again)
          const vm = await vault.write(want, await readStoredText(this.storeName(n.id)));
          n = { ...n, vp: want, vm };
          changed = true;
        } else if (!n.vp) {
          // a file with this name is already there: never overwrite either side
          let text = await readStoredText(this.storeName(n.id));
          if (this.mode === 'server' && !text) {
            // this note's text has not been fetched yet: get it first, so a file you already have is recognised and not copied
            if (!this.serverReachable) {
              keep.push(n);
              continue;
            }
            try {
              await syncNoteNow(this.storeName(n.id), this.api, n.id, () => {});
              text = await readStoredText(this.storeName(n.id));
            } catch {
              keep.push(n);
              continue;
            }
          }
          const theirs = await vault.read(want);
          const same = (a: string, b: string) => a.replace(/\r\n/g, '\n').trimEnd() === b.replace(/\r\n/g, '\n').trimEnd();
          if (same(theirs.text, text)) n = { ...n, vp: want, vm: theirs.mtime_ms };
          else {
            // a different file already has this name: keep both, never overwrite either side
            const title = this.uniqueLocalTitle(`${n.title} (${this.t('appCopy')})`, n.folder ?? '');
            const path = notePath(n.folder ?? '', title);
            const vm = await vault.write(path, text);
            n = { ...n, vp: path, vm };
            if (this.mode === 'local') n.title = title;
          }
          changed = true;
        } else if (f.mtime_ms !== n.vm) {
          const c = await vault.read(n.vp);
          if (c.text !== (await readStoredText(this.storeName(n.id)))) await this.importText(n, c.text);
          n = { ...n, vm: c.mtime_ms };
          changed = true;
        }
        keep.push(n);
      }
      const known = new Set(keep.map((n) => n.vp));
      for (const f of files) {
        if (known.has(f.path)) continue;
        const { folder, title } = splitPath(f.path);
        const c = await vault.read(f.path);
        let id: string = crypto.randomUUID();
        let owner = '';
        if (this.mode === 'server') {
          // a new file in the folder becomes a note on the server (or waits in the queue while offline)
          const before = this.notes.length;
          id = await this.createNote(title, c.text, folder);
          const made = this.notes.find((x) => x.id === id);
          if (!made || this.notes.length < before) continue;
          keep.unshift({ ...made, vp: f.path, vm: c.mtime_ms });
          this.notes = this.notes.filter((x) => x.id !== id);
          if (folder && !this.folders.includes(folder)) this.folders = [...this.folders, folder];
          changed = true;
          continue;
        }
        await writeStoredText(`local:${id}`, c.text);
        keep.unshift({ id, title, folder, owner, role: 'owner', updated: Math.floor(f.mtime_ms / 1000), vp: f.path, vm: c.mtime_ms });
        if (folder && !this.folders.includes(folder)) this.folders = [...this.folders, folder];
        changed = true;
      }
      if (changed) {
        this.notes = keep;
        if (this.mode === 'local') write(LOCAL_FOLDERS, this.folders);
        this.saveNotes();
        if (!this.notes.some((n) => n.id === this.currentId)) this.currentId = this.notes[0]?.id ?? null;
      }
      this.vaultError = '';
    } catch (e) {
      this.vaultError = e instanceof Error ? e.message : String(e);
    } finally {
      this.vaultBusy = false;
    }
  }

  /** Save one note's text into its file. */
  async vaultPush(id: string, text: string) {
    if (!this.vaultOn) return;
    const n = this.notes.find((x) => x.id === id);
    if (!n || !this.mirrored(n)) return;
    try {
      const path = n.vp ?? notePath(n.folder ?? '', n.title);
      const vm = await vault.write(path, text);
      this.notes = this.notes.map((x) => (x.id === id ? { ...x, vp: path, vm } : x));
      this.saveNotes();
    } catch (e) {
      this.vaultError = e instanceof Error ? e.message : String(e);
    }
  }

  /** Renames and moves in the app follow in the folder. */
  private async vaultPaths() {
    if (!this.vaultOn) return;
    let changed = false;
    const next: NoteMeta[] = [];
    for (const n of this.notes) {
      if (!this.mirrored(n)) {
        next.push(n);
        continue;
      }
      const want = notePath(n.folder ?? '', n.title);
      if (n.vp && n.vp !== want) {
        try {
          const vm = await vault.rename(n.vp, want);
          next.push({ ...n, vp: want, vm });
          changed = true;
          continue;
        } catch (e) {
          this.vaultError = e instanceof Error ? e.message : String(e);
        }
      }
      next.push(n);
    }
    if (changed) {
      this.notes = next;
      this.saveNotes();
    }
    for (const f of this.folders) await vault.mkdir(f).catch(() => {});
  }

  /** Use another folder for the notes (empty = the default). */
  async vaultChange(path: string) {
    try {
      const now = await vault.set(path);
      this.vaultPath = now;
      if (this.vaultAccount) write('qm.vaultFor', { ...read<Record<string, string>>('qm.vaultFor', {}), [this.vaultAccount]: now === this.vaultDefault ? '@default' : now });
      this.notes = this.notes.map((n) => ({ ...n, vp: undefined, vm: undefined }));
      this.saveNotes();
      await this.vaultSync();
    } catch (e) {
      this.vaultError = e instanceof Error ? e.message : String(e);
    }
  }

  // ------------------------------------------------------------ offline work

  /** Changes made while the server was away, replayed in order when it is back. */
  pending = $state(0);
  private flushing = false;
  private outboxKey = () => `qm.outbox.${this.api.base}|${this.s.username}`;
  private readOutbox = (): Op[] => read<Op[]>(this.outboxKey(), []);
  private queueOp(op: Op) {
    let ops = this.readOutbox();
    const tmpId = 'id' in op ? op.id : '';
    if (tmpId.startsWith('tmp:')) {
      // a note made offline and not on the server yet: fold the change into its "create"
      const c = ops.find((o): o is Extract<Op, { t: 'create' }> => o.t === 'create' && o.tmp === tmpId);
      if (c) {
        if (op.t === 'rename') c.title = op.title;
        else if (op.t === 'move') c.folder = op.folder;
        else if (op.t === 'delete') ops = ops.filter((o) => o !== c && !('id' in o && o.id === tmpId));
        write(this.outboxKey(), ops);
        this.pending = ops.length;
        return;
      }
    }
    ops.push(op);
    write(this.outboxKey(), ops);
    this.pending = ops.length;
  }
  /** True when a call failed because the server could not be reached (not because it said no). */
  private away(e: unknown): boolean {
    if (e instanceof ApiError) return false;
    this.serverReachable = false;
    return true;
  }

  /** Send the queued changes to the server. */
  async flushOutbox() {
    if (this.mode !== 'server' || this.flushing || !this.serverReachable) return;
    this.flushing = true;
    try {
      let ops = this.readOutbox();
      const ids = new Map<string, string>(); // temporary id -> real id
      const fix = (id: string) => ids.get(id) ?? id;
      while (ops.length) {
        const op = ops[0]!;
        try {
          if (op.t === 'create') {
            const text = await readStoredText(this.storeName(op.tmp)).catch(() => '');
            const n = await this.api.createNote(op.title, text, op.folder);
            ids.set(op.tmp, n.id);
            deleteStored(this.storeName(op.tmp));
            this.notes = this.notes.map((x) => (x.id === op.tmp ? { ...n, vp: x.vp, vm: x.vm } : x));
            if (this.currentId === op.tmp) this.currentId = n.id;
            this.recent = this.recent.map((r) => (r === op.tmp ? n.id : r));
          } else if (op.t === 'rename') {
            const n = await this.api.renameNote(fix(op.id), op.title);
            this.notes = this.notes.map((x) => (x.id === fix(op.id) ? { ...x, title: n.title } : x));
          } else if (op.t === 'move') {
            const n = await this.api.moveNote(fix(op.id), op.folder);
            this.notes = this.notes.map((x) => (x.id === fix(op.id) ? { ...x, folder: n.folder, title: n.title } : x));
          } else if (op.t === 'delete') {
            if (op.shared) await this.api.removeShare(fix(op.id), this.s.username);
            else await this.api.deleteNote(fix(op.id));
          } else if (op.t === 'folder') await this.api.createFolder(op.path);
          else if (op.t === 'mvfolder') await this.api.moveFolder(op.from, op.to);
          else if (op.t === 'rmfolder') await this.api.deleteFolder(op.path);
        } catch (e) {
          if (this.away(e)) break; // still offline: keep everything, try again later
          // the server said no (the note is gone, the name is taken…): drop this one change and go on
        }
        ops = ops.slice(1);
        write(this.outboxKey(), ops);
        this.pending = ops.length;
      }
      write(this.cacheKey(), this.notes);
    } finally {
      this.flushing = false;
    }
  }

  /** Download every note to this device so all of them can be read and edited offline. */
  private prefetching = false;
  async prefetchAll() {
    if (this.mode !== 'server' || this.prefetching || !this.serverReachable) return;
    this.prefetching = true;
    try {
      const key = `qm.fetched.${this.api.base}|${this.s.username}`;
      const done = read<Record<string, number>>(key, {});
      const todo = this.notes.filter((n) => !n.id.startsWith('tmp:') && done[n.id] !== n.updated);
      let next = 0;
      const worker = async () => {
        while (next < todo.length && this.serverReachable && this.mode === 'server') {
          const n = todo[next++]!;
          try {
            const text = await syncNoteNow(this.storeName(n.id), this.api, n.id);
            done[n.id] = n.updated;
            write(key, done);
            if (this.vaultPath) void this.vaultPush(n.id, text);
          } catch {
            /* try again next time */
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    } finally {
      this.prefetching = false;
    }
  }

  private linkWatch = false;
  /** Notice when the server comes back (or goes away) and catch up. */
  watchLink() {
    if (this.linkWatch || typeof window === 'undefined') return;
    this.linkWatch = true;
    const back = async () => {
      if (this.mode !== 'server') return;
      const was = this.serverReachable;
      // the local bridge (apps) may have gone away while the device slept: make a fresh one
      if (!was && inShell()) this.api = await this.makeApi(cleanBase(this.s.serverUrl), this.s.token);
      await this.detectServer();
      if (this.serverReachable && (!was || this.pending)) {
        await this.flushOutbox();
        await this.loadServerNotes(true);
      }
    };
    window.addEventListener('online', () => void back());
    window.addEventListener('offline', () => { if (this.mode === 'server') this.serverReachable = false; });
    // coming back to the window, and every half minute while it is open: pick up other people's (and other devices') changes
    const refresh = async () => {
      if (this.mode !== 'server' || document.visibilityState === 'hidden') return;
      if (!this.serverReachable || this.pending) await back();
      else await this.loadServerNotes(true);
    };
    window.addEventListener('focus', () => void refresh());
    document.addEventListener('visibilitychange', () => void refresh());
    setInterval(() => { if (this.mode === 'server' && (!this.serverReachable || this.pending)) void back(); }, 15000);
    setInterval(() => void refresh(), 30000);
  }

  // ------------------------------------------------------------ accounts

  /** An Api for this server. In the apps every request goes through a small bridge on this device, so
   *  the system web view never has to judge the address or the certificate itself. */
  private async makeApi(base: string, token: string, viaBridge = false): Promise<Api> {
    if (inShell() && base) {
      const selfSigned = base.startsWith('https://') && this.s.allowSelfSigned;
      // Straight to the server whenever that works (as it always did); through the bridge for a self-signed
      // certificate, or when the web view cannot reach the server by itself.
      if (selfSigned || viaBridge) {
        const pin = selfSigned ? (this.s.trust?.[base] ?? '') : '';
        try {
          return new Api(base, token, await tls.bridge(base, pin));
        } catch {
          /* fall through: try the server directly */
        }
      }
    }
    return new Api(base, token);
  }

  /** Try the server again right now (the Reconnect button). */
  async reconnect() {
    if (this.mode !== 'server') return;
    if (inShell()) this.api = await this.makeApi(cleanBase(this.s.serverUrl), this.s.token);
    await this.detectServer();
    if (this.serverReachable) {
      await this.flushOutbox();
      await this.loadServerNotes(true);
    }
  }

  /** The apps' two switches for unusual servers. Turning one on turns the other off. */
  async setNet(opt: 'selfSigned' | 'http', on: boolean) {
    if (opt === 'selfSigned') this.s.allowSelfSigned = on;
    else this.s.allowHttp = on;
    if (on) {
      if (opt === 'selfSigned') this.s.allowHttp = false;
      else this.s.allowSelfSigned = false;
    }
    this.save();
    if (this.s.serverUrl) {
      this.api = await this.makeApi(this.s.serverUrl, this.s.token);
      await this.detectServer();
    }
  }

  /** Step-by-step connection test for the sign-in page: says which hop fails (app core, web view, bridge). */
  async diagnose(serverUrl: string): Promise<string> {
    const base = cleanBase(serverUrl);
    if (!base) return this.t('cantReach');
    const out: string[] = [];
    const pin = this.s.trust?.[base] ?? '';
    const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
    const timed = <T,>(p: Promise<T>, ms = 12000) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
    try {
      const r = await timed(tls.check(base, pin));
      out.push('app core → server: ' + (r ? 'FAIL ' + r : 'ok'));
    } catch (e) {
      out.push('app core → server: FAIL ' + msg(e));
    }
    try {
      const r = await timed(fetch(base + '/api/status'));
      out.push('web view → server: ' + (r.ok ? 'ok' : 'HTTP ' + r.status));
    } catch (e) {
      out.push('web view → server: FAIL ' + msg(e));
    }
    try {
      const via = await timed(tls.bridge(base, pin));
      const r = await timed(fetch(via + '/api/status'));
      out.push('web view → local bridge: ' + (r.ok ? 'ok' : 'HTTP ' + r.status));
    } catch (e) {
      out.push('web view → local bridge: FAIL ' + msg(e));
    }
    return out.join('\n');
  }

  async connect(serverUrl: string) {
    const base = cleanBase(serverUrl);
    const app = inShell();
    if (app && base.startsWith('http://') && !this.s.allowHttp) throw new ApiError(0, this.t('httpOff'));
    if (app && base.startsWith('https://') && this.s.allowSelfSigned) {
      // The first certificate seen is remembered (ticking the box is the consent); a different one later is asked about.
      let fp = '';
      try {
        fp = await tls.probe(base);
      } catch (e) {
        throw new ApiError(0, (e instanceof Error ? e.message : String(e)) || this.t('cantReach'));
      }
      const have = this.s.trust?.[base];
      if (have !== fp) {
        if (have && !(await confirmBox(this.t('certChangedAsk', { fp })))) throw new ApiError(0, this.t('cantReach'));
        this.s.trust = { ...this.s.trust, [base]: fp };
      }
    }
    this.s.serverUrl = base;
    this.api = await this.makeApi(base, '');
    this.save();
    await this.detectServer();
    if (!this.serverReachable) {
      let why = '';
      if (app && base) why = await tls.check(base, base.startsWith('https://') && this.s.allowSelfSigned ? (this.s.trust?.[base] ?? '') : '');
      if (/certificate|secure connection/i.test(why) && !this.s.allowSelfSigned) why += '\n' + this.t('certHint');
      throw new ApiError(0, why ? `${this.t('cantReach')}: ${why}` : this.t('cantReach'));
    }
  }

  forgetCertificate() {
    const { [this.s.serverUrl]: _gone, ...rest } = this.s.trust ?? {};
    this.s.trust = rest;
    this.save();
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
    // notes made without an account: ask what to do with them (never decided silently)
    if (this.hasLocalNotes()) {
      const n = read<NoteMeta[]>(LOCAL_NOTES, []).length;
      const pick = await chooseBox(this.t('localToAccount', { n, name: ses.username }), [this.t('localUpload'), this.t('localKeep')]);
      if (pick === 0) {
        try {
          await this.uploadLocalNotes();
          // the notes folder those notes live in now belongs to this account
          const map = read<Record<string, string>>('qm.vaultFor', {});
          const acct = `${this.api.base}|${ses.username}`;
          if (map.local && !map[acct]) {
            map[acct] = map.local;
            delete map.local;
            write('qm.vaultFor', map);
          }
        } catch (e) {
          this.vaultError = e instanceof Error ? e.message : String(e);
        }
      }
    }
    await this.loadServerNotes();
  }

  /** Sign out. By default this account's notes stay on this device (they are yours, and still work offline,
   *  and changes made offline are kept until you sign in again). Nothing is ever mixed between accounts:
   *  each account has its own copies and its own notes folder. Removing the copies is a separate, explicit choice. */
  async signOut() {
    const keepLabel = this.t('signOutKeep');
    const wipeLabel = this.t('signOutWipe');
    const pick = await chooseBox(this.pending ? `${this.t('signOutAsk')}\n\n${this.t('signOutPending', { n: this.pending })}` : this.t('signOutAsk'), [keepLabel, wipeLabel]);
    if (pick === null) return;
    const wipe = pick === 1;
    if (wipe && this.pending && !(await confirmBox(this.t('signOutLose', { n: this.pending })))) return;
    try {
      await this.api.logout();
    } catch {
      /* the server may be away; we still sign out here */
    }
    const acct = `${this.api.base}|${this.s.username}`;
    if (wipe) {
      // the files in this account's notes folder go to the trash too
      for (const n of this.notes) if (n.vp && this.vaultOn) await vault.trash(n.vp).catch(() => {});
      for (const n of this.notes) {
        try {
          indexedDB.deleteDatabase(this.storeName(n.id));
        } catch {
          /* best effort */
        }
      }
      for (const k of [`qm.cache.${acct}`, `qm.cache.${acct}.f`, `qm.fetched.${acct}`, `qm.outbox.${acct}`]) {
        try {
          localStorage.removeItem(k);
        } catch {
          /* best effort */
        }
      }
    }
    this.tabs = [];
    this.saveTabs();
    this.pending = 0;
    this.s.token = '';
    this.s.username = '';
    this.s.admin = false;
    this.api.token = '';
    this.currentId = null;
    this.notes = [];
    this.folders = [];
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

  async loadServerNotes(quiet = false) {
    const cached = read<NoteMeta[]>(this.cacheKey(), []);
    if (!quiet) this.notes = cached;
    this.pending = this.readOutbox().length;
    this.folders = read<string[]>(this.cacheKey() + '.f', []);
    this.watchLink();
    try {
      await this.flushOutbox();
      const fresh = await this.api.notes();
      const mine = new Map(cached.map((n) => [n.id, n]));
      const gone = new Set(this.readOutbox().filter((o): o is Extract<Op, { t: 'delete' }> => o.t === 'delete').map((o) => o.id));
      this.notes = [
        // notes made offline that have not reached the server yet stay in the list
        ...cached.filter((n) => n.id.startsWith('tmp:')),
        ...fresh.filter((n) => !gone.has(n.id)).map((n) => ({ ...n, vp: mine.get(n.id)?.vp, vm: mine.get(n.id)?.vm })),
      ];
      this.folders = await this.api.folders().catch(() => read<string[]>(this.cacheKey() + '.f', []));
      this.serverReachable = true;
      write(this.cacheKey(), this.notes);
      write(this.cacheKey() + '.f', this.folders);
      void (async () => {
        await this.vaultStart();
        await this.prefetchAll();
        await this.vaultSync();
      })();
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
    void this.vaultPaths();
  }

  /** Name of the copy kept on this device. */
  storeName(id: string): string {
    return this.mode === 'server' ? `srv:${this.api.base}:${id}` : `local:${id}`;
  }

  async createNote(title = '', content = '', folder = ''): Promise<string> {
    const name = title.trim() || this.t('untitled');
    if (this.mode === 'server') {
      if (this.serverReachable) {
        try {
          const n = await this.api.createNote(name, content, folder);
          this.notes = [n, ...this.notes];
          write(this.cacheKey(), this.notes);
          this.currentId = n.id;
          void this.vaultSync();
          return n.id;
        } catch (e) {
          if (!this.away(e)) throw e;
        }
      }
      // offline: make it here now, send it when the server is back
      const id = 'tmp:' + crypto.randomUUID();
      const n: NoteMeta = { id, title: this.uniqueLocalTitle(name, folder), folder, owner: this.s.username, role: 'owner', updated: Math.floor(Date.now() / 1000) };
      if (content) await writeStoredText(this.storeName(id), content);
      this.queueOp({ t: 'create', tmp: id, title: n.title, folder });
      this.notes = [n, ...this.notes];
      write(this.cacheKey(), this.notes);
      this.currentId = id;
      return id;
    }
    const id = crypto.randomUUID();
    const n: NoteMeta = { id, title: this.uniqueLocalTitle(name, folder), folder, owner: '', role: 'owner', updated: Math.floor(Date.now() / 1000) };
    if (content) await writeStoredText(`local:${id}`, content);
    this.notes = [n, ...this.notes];
    this.saveLocalList();
    this.currentId = id;
    void this.vaultPush(id, content);
    return id;
  }

  private uniqueLocalTitle(title: string, folder = ''): string {
    const used = new Set(this.notes.filter((n) => (n.folder ?? '') === folder).map((n) => n.title));
    if (!used.has(title)) return title;
    for (let i = 2; ; i++) if (!used.has(`${title} ${i}`)) return `${title} ${i}`;
  }

  /** Show a note under its title: property (the file keeps its name). */
  setDisplay(id: string, display: string) {
    this.notes = this.notes.map((x) => (x.id === id && (x.display ?? '') !== display ? { ...x, display } : x));
  }

  async renameNote(id: string, title: string) {
    const name = title.trim();
    const note = this.notes.find((n) => n.id === id);
    if (!note || !name || name === note.title) return;
    if (this.mode === 'server') {
      let title = name;
      if (this.serverReachable && !id.startsWith('tmp:')) {
        try {
          title = (await this.api.renameNote(id, name)).title;
        } catch (e) {
          if (!this.away(e)) throw e;
          this.queueOp({ t: 'rename', id, title: name });
        }
      } else this.queueOp({ t: 'rename', id, title: name });
      this.notes = this.notes.map((x) => (x.id === id ? { ...x, title } : x));
      write(this.cacheKey(), this.notes);
      void this.vaultPaths();
    } else {
      this.notes = this.notes.map((x) => (x.id === id ? { ...x, title: name } : x));
      this.saveLocalList();
    }
  }

  /** The user's own templates: notes in the Templates folder. */
  get templates(): NoteMeta[] {
    return this.notes.filter((n) => (n.role === 'owner' || this.mode !== 'server') && (n.folder ?? '') === TEMPLATES_FOLDER);
  }

  /** Make a note from a ready-made template (`builtin:<id>`) or from one of your own (`note:<id>`). */
  async newFromTemplate(source: string, folder = ''): Promise<string> {
    let title: string;
    let body: string;
    if (source.startsWith('builtin:')) {
      const b = BUILT_IN.find((x) => x.id === source.slice(8));
      if (!b) throw new Error('Unknown template');
      title = fill(b.title, '', new Date(), this.s.lang);
      body = fill(b.body[this.s.lang], title, new Date(), this.s.lang);
    } else {
      const id = source.slice(5);
      const n = this.notes.find((x) => x.id === id);
      if (!n) throw new Error('Unknown template');
      title = fill(this.t('untitled'), '', new Date(), this.s.lang);
      body = fill(await this.exportText(id), title, new Date(), this.s.lang);
    }
    return this.createNote(title, body, folder);
  }

  /** Open today's daily note, making it from the Daily template the first time. */
  async openDaily(): Promise<void> {
    const d = new Date();
    const title = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const have = this.notes.find((n) => n.title === title && (n.folder ?? '') === '' && (n.role === 'owner' || this.mode !== 'server'));
    if (have) this.currentId = have.id;
    else await this.newFromTemplate('builtin:daily');
  }

  /** Search inside note text (needs the server; on-device notes only match by title). */
  async searchText(q: string): Promise<Array<{ id: string; title: string; snippet: string }>> {
    if (this.mode !== 'server') return [];
    return this.api.search(q).catch(() => []);
  }

  /** Recently opened notes, newest first. */
  /** Phones: which bottom sheet is open. */
  sheet = $state<null | 'tabs' | 'toc' | 'more' | 'links'>(null);
  /** The first lines of notes opened here, for the tab thumbnails. */
  previews = $state<Record<string, string>>(read<Record<string, string>>('qm.previews', {}));
  private previewTimer = 0;
  setPreview(id: string, text: string) {
    const clean = text.replace(/^---[\s\S]*?\n---\s*/, '').replace(/[#>*`_\[\]|-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
    if (this.previews[id] === clean) return;
    this.previews[id] = clean;
    clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => {
      const keep = Object.fromEntries(Object.entries(this.previews).filter(([k]) => this.notes.some((n) => n.id === k)).slice(-60));
      write('qm.previews', keep);
    }, 1500);
  }
  /** Zen mode: only the text, nothing else on screen. */
  zen = $state(false);
  toggleZen() {
    this.zen = !this.zen;
  }
  toggleSide() {
    this.s.hideSide = !this.s.hideSide;
    this.save();
  }

  /** Notes open in tabs, in order; the active one is `currentId`. */
  tabs = $state<string[]>(read<string[]>('qm.tabs', []));
  private lastTab: string | null = null;
  private saveTabs() {
    write('qm.tabs', this.tabs);
  }
  /** Called when the active note changes: make sure it has a tab (next to the one we came from). */
  tabsSeen(id: string | null) {
    if (!id) return;
    if (!this.tabs.includes(id)) {
      const at = this.lastTab ? this.tabs.indexOf(this.lastTab) : -1;
      this.tabs = at >= 0 ? [...this.tabs.slice(0, at + 1), id, ...this.tabs.slice(at + 1)] : [...this.tabs, id];
      this.saveTabs();
    }
    this.lastTab = id;
  }
  /** Forget tabs of notes that are gone (deleted, or unshared). */
  pruneTabs() {
    if (!this.notes.length && this.mode === 'server') return; // the list is still loading
    const ok = this.tabs.filter((id) => this.notes.some((n) => n.id === id));
    if (ok.length !== this.tabs.length) {
      this.tabs = ok;
      this.saveTabs();
    }
  }
  closeTabs(ids: string[]) {
    const at = this.currentId ? this.tabs.indexOf(this.currentId) : -1;
    const left = this.tabs.filter((t) => !ids.includes(t));
    const closingCurrent = !!this.currentId && ids.includes(this.currentId);
    this.tabs = left;
    this.saveTabs();
    if (closingCurrent) {
      this.currentId = left[Math.min(Math.max(at, 0), left.length - 1)] ?? null;
      this.lastTab = this.currentId;
    }
  }
  moveTab(id: string, before: string | null) {
    const rest = this.tabs.filter((t) => t !== id);
    const i = before ? rest.indexOf(before) : rest.length;
    this.tabs = [...rest.slice(0, i < 0 ? rest.length : i), id, ...rest.slice(i < 0 ? rest.length : i)];
    this.saveTabs();
  }
  nextTab(step: 1 | -1) {
    if (this.tabs.length < 2 || !this.currentId) return;
    const i = this.tabs.indexOf(this.currentId);
    this.currentId = this.tabs[(i + step + this.tabs.length) % this.tabs.length] ?? this.currentId;
  }

  recent = $state<string[]>(read<string[]>('qm.recent', []));
  touchRecent(id: string) {
    this.recent = [id, ...this.recent.filter((x) => x !== id)].slice(0, 12);
    write('qm.recent', this.recent);
  }

  /** Notes pinned to the top of the side panel. */
  pins = $state<string[]>(read<string[]>('qm.pins', []));
  togglePin(id: string) {
    this.pins = this.pins.includes(id) ? this.pins.filter((x) => x !== id) : [...this.pins, id];
    write('qm.pins', this.pins);
  }

  palette = $state(false);

  /** Keep a copy of a note in the Templates folder. */
  async saveAsTemplate(id: string, liveText?: string) {
    const n = this.notes.find((x) => x.id === id);
    if (!n) return;
    const text = await this.exportText(id, liveText);
    const keep = this.currentId;
    await this.createNote(n.title, text, TEMPLATES_FOLDER);
    this.currentId = keep; // stay on the note you were reading
    await this.createFolder(TEMPLATES_FOLDER).catch(() => {});
  }

  private saveFolders() {
    if (this.mode === 'server') write(this.cacheKey() + '.f', this.folders);
    else write(LOCAL_FOLDERS, this.folders);
  }

  /** "a/b/c" -> ["a", "a/b", "a/b/c"] */
  private withParents(path: string): string[] {
    const parts = path.split('/').filter(Boolean);
    return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
  }

  async createFolder(path: string) {
    const clean = path.split('/').map((p) => p.trim()).filter(Boolean).join('/');
    if (!clean) return;
    let made = clean;
    if (this.mode === 'server') {
      try {
        if (!this.serverReachable) throw new TypeError('offline');
        made = (await this.api.createFolder(clean)).path;
      } catch (e) {
        if (!this.away(e)) throw e;
        this.queueOp({ t: 'folder', path: clean });
      }
    }
    const set = new Set([...this.folders, ...this.withParents(made)]);
    this.folders = [...set].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    this.saveFolders();
  }

  async renameFolder(from: string, to: string) {
    const dest = to.split('/').map((p) => p.trim()).filter(Boolean).join('/');
    if (!dest || dest === from) return;
    if (this.mode === 'server') {
      try {
        if (!this.serverReachable) throw new TypeError('offline');
        await this.api.moveFolder(from, dest);
      } catch (e) {
        if (!this.away(e)) throw e;
        this.queueOp({ t: 'mvfolder', from, to: dest });
      }
    }
    const re = (p: string) => (p === from ? dest : p.startsWith(from + '/') ? dest + p.slice(from.length) : p);
    this.folders = [...new Set([...this.folders.map(re), ...this.withParents(dest)])].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    this.notes = this.notes.map((n) => (n.role === 'owner' ? { ...n, folder: re(n.folder ?? '') } : n));
    this.saveFolders();
    this.mode === 'server' ? write(this.cacheKey(), this.notes) : this.saveLocalList();
  }

  async deleteFolder(path: string) {
    if (this.notes.some((n) => n.role === 'owner' && ((n.folder ?? '') === path || (n.folder ?? '').startsWith(path + '/')))) {
      throw new Error(this.t('folderNotEmpty'));
    }
    if (this.mode === 'server') {
      try {
        if (!this.serverReachable) throw new TypeError('offline');
        await this.api.deleteFolder(path);
      } catch (e) {
        if (!this.away(e)) throw e;
        this.queueOp({ t: 'rmfolder', path });
      }
    }
    this.folders = this.folders.filter((f) => f !== path && !f.startsWith(path + '/'));
    this.saveFolders();
  }

  async moveNote(id: string, folder: string) {
    const note = this.notes.find((n) => n.id === id);
    if (!note || (note.folder ?? '') === folder) return;
    if (this.mode === 'server') {
      let moved = { folder, title: note.title };
      if (this.serverReachable && !id.startsWith('tmp:')) {
        try {
          const n = await this.api.moveNote(id, folder);
          moved = { folder: n.folder ?? folder, title: n.title };
        } catch (e) {
          if (!this.away(e)) throw e;
          this.queueOp({ t: 'move', id, folder });
        }
      } else this.queueOp({ t: 'move', id, folder });
      this.notes = this.notes.map((x) => (x.id === id ? { ...x, ...moved } : x));
      write(this.cacheKey(), this.notes);
      void this.vaultPaths();
    } else {
      this.notes = this.notes.map((x) => (x.id === id ? { ...x, folder, title: this.uniqueLocalTitle(x.title, folder) } : x));
      this.saveLocalList();
    }
  }

  /** A copy next to the original, called "<title> copy". */
  async copyNote(id: string) {
    const note = this.notes.find((n) => n.id === id);
    if (!note) return;
    const text = await this.exportText(id);
    await this.createNote(`${note.title} ${this.t('copySuffix')}`, text, note.role === 'owner' ? (note.folder ?? '') : '');
  }

  async deleteNote(id: string) {
    const gone = this.notes.find((n) => n.id === id);
    if (this.mode === 'server') {
      const shared = !!gone && gone.role !== 'owner';
      if (this.serverReachable && !id.startsWith('tmp:')) {
        try {
          if (shared) await this.api.removeShare(id, this.s.username);
          else await this.api.deleteNote(id);
        } catch (e) {
          if (!this.away(e)) throw e;
          this.queueOp({ t: 'delete', id, shared });
        }
      } else this.queueOp({ t: 'delete', id, shared });
    }
    deleteStored(this.storeName(id));
    if ((this.mode === 'local' || this.mode === 'server') && gone?.vp && this.vaultPath) void vault.trash(gone.vp).catch(() => {});
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

  /** A section to scroll to once the note it belongs to is open ([[Note#Heading]]). */
  pendingHeading = $state<{ id: string; heading: string } | null>(null);

  /** Follow a link: "Note", "Note#Heading" (the note may be missing for "#Heading": this note). */
  async openLink(target: string, here?: string) {
    const { note, heading } = splitTarget(target);
    if (note) await this.openTitle(note);
    else if (here) this.currentId = here;
    if (heading && this.currentId) this.pendingHeading = { id: this.currentId, heading };
  }

  /** The headings of a note by title (empty title: the note given as `here`), for link suggestions. */
  async headingsOf(title: string, here?: string, live?: string): Promise<string[]> {
    const id = title ? this.notes.find((n) => n.title.toLowerCase() === title.toLowerCase())?.id : here;
    if (!id) return [];
    const text = id === here && live !== undefined ? live : await this.exportText(id).catch(() => '');
    return parseHeadings(text).map((h) => h.text);
  }

  /** What a ```base block lists: every note you can read, with its properties. */
  async baseRows(): Promise<NoteRow[]> {
    const out: NoteRow[] = [];
    for (const n of this.notes) {
      const text = await this.exportText(n.id).catch(() => '');
      out.push({ id: n.id, title: n.title, folder: n.folder ?? '', updated: n.updated, props: readFrontMatter(text)?.props ?? [] });
    }
    return out;
  }

  canEditRow(id: string): boolean {
    const n = this.notes.find((x) => x.id === id);
    return !!n && id !== this.currentId && (this.mode !== 'server' || n.role !== 'view');
  }

  /** Change one property of another note (from a base table). */
  async setNoteProp(id: string, key: string, type: PropType, value: string): Promise<void> {
    const n = this.notes.find((x) => x.id === id);
    if (!n || !this.canEditRow(id)) return;
    const text = await this.exportText(id);
    const next = setPropText(text, key, type, value);
    if (next !== text) await this.importText(n, next);
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

type Op =
  | { t: 'create'; tmp: string; title: string; folder: string }
  | { t: 'rename'; id: string; title: string }
  | { t: 'move'; id: string; folder: string }
  | { t: 'delete'; id: string; shared: boolean }
  | { t: 'folder'; path: string }
  | { t: 'mvfolder'; from: string; to: string }
  | { t: 'rmfolder'; path: string };

export const store = new Store();
