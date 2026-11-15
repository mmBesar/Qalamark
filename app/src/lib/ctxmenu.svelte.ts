// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// One themed context menu for the whole app (right-click on desktop, press-and-hold on touch).

export interface MenuItem {
  label?: string;
  icon?: string;
  run?: () => void | Promise<void>;
  danger?: boolean;
  disabled?: boolean;
  /** A sub-list: choosing the item shows these instead (with a way back). */
  children?: MenuItem[];
  /** A thin divider (other fields ignored). */
  sep?: boolean;
  /** Shown dimmed on the right (a shortcut hint). */
  hint?: string;
}

class CtxMenu {
  open = $state(false);
  x = $state(0);
  y = $state(0);
  items = $state<MenuItem[]>([]);
  show(x: number, y: number, items: MenuItem[]) {
    this.x = x;
    this.y = y;
    this.items = items.filter((i, k, a) => !(i.sep && (k === 0 || k === a.length - 1 || a[k - 1].sep)));
    this.open = this.items.length > 0;
  }
  close() {
    this.open = false;
  }
}
export const ctxmenu = new CtxMenu();
