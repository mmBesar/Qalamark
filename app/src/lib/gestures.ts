// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar

/** What can happen when you act on a task. Swipes are by the finger's direction on the screen (right is right in every language). */
export type TaskAction = 'tick' | 'edit' | 'delete' | 'menu' | 'none';

export interface Gestures {
  swipeRight: TaskAction;
  swipeLeft: TaskAction;
  tap: TaskAction;
  longPress: TaskAction;
}

export const DEFAULT_GESTURES: Gestures = { swipeRight: 'tick', swipeLeft: 'delete', tap: 'tick', longPress: 'edit' };

const OK: TaskAction[] = ['tick', 'edit', 'delete', 'menu', 'none'];
export const cleanGestures = (g: Partial<Gestures> | undefined): Gestures => {
  const out = { ...DEFAULT_GESTURES };
  for (const k of Object.keys(out) as (keyof Gestures)[]) if (g && OK.includes(g[k] as TaskAction)) out[k] = g[k] as TaskAction;
  return out;
};
