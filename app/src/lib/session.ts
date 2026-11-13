// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// One open note: its text (a Yjs document), the copy kept on this device, and -
// when there is a server - the live connection that keeps everyone in step.

import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import type { Api } from './server.ts';

export type LinkStatus = 'local' | 'connecting' | 'online' | 'offline';

const COLORS = ['#d9480f', '#1c7ed6', '#2f9e44', '#9c36b5', '#e8590c', '#0b7285', '#c2255c', '#5f3dc4'];

export function colorFor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length]!;
}

export class NoteSession {
  readonly doc = new Y.Doc();
  readonly ytext = this.doc.getText('content');
  readonly idb: IndexeddbPersistence;
  readonly provider: WebsocketProvider | null;
  readonly awareness: WebsocketProvider['awareness'] | null;
  status: LinkStatus;

  /**
   * @param storeName name of the copy on this device
   * @param api       set when the note lives on a server
   * @param noteId    server id of the note
   */
  constructor(
    storeName: string,
    user: string,
    onStatus: (s: LinkStatus) => void,
    api?: Api,
    noteId?: string,
  ) {
    this.idb = new IndexeddbPersistence(storeName, this.doc);
    if (api && noteId) {
      this.status = 'connecting';
      this.provider = new WebsocketProvider(api.wsBase(), noteId, this.doc, {
        params: { token: api.token },
        disableBc: false,
      });
      this.awareness = this.provider.awareness;
      this.awareness.setLocalStateField('user', {
        name: user,
        color: colorFor(user),
        colorLight: colorFor(user) + '33',
      });
      this.provider.on('status', (e: { status: string }) => {
        this.status = e.status === 'connected' ? 'online' : e.status === 'connecting' ? 'connecting' : 'offline';
        onStatus(this.status);
      });
    } else {
      this.status = 'local';
      this.provider = null;
      this.awareness = null;
    }
    onStatus(this.status);
  }

  destroy(): void {
    this.provider?.destroy();
    void this.idb.destroy();
    this.doc.destroy();
  }
}

/** Read the text of a note kept on this device. */
export async function readStoredText(storeName: string): Promise<string> {
  const doc = new Y.Doc();
  const idb = new IndexeddbPersistence(storeName, doc);
  await idb.whenSynced;
  const text = doc.getText('content').toString();
  await idb.destroy();
  doc.destroy();
  return text;
}

/** Put text into a note kept on this device. */
export async function writeStoredText(storeName: string, text: string): Promise<void> {
  const doc = new Y.Doc();
  const idb = new IndexeddbPersistence(storeName, doc);
  await idb.whenSynced;
  const t = doc.getText('content');
  if (t.length > 0) t.delete(0, t.length);
  t.insert(0, text);
  await idb.destroy();
  doc.destroy();
}

export function deleteStored(storeName: string): void {
  try {
    indexedDB.deleteDatabase(storeName);
  } catch {
    /* nothing to remove */
  }
}
