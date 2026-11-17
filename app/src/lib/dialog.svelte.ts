// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// In-app replacements for confirm() and prompt(), which app shells (Android, desktop) may block.

export interface Pending {
  message: string;
  input: boolean;
  secret: boolean;
  choices?: string[];
  resolve: (v: string | boolean | null) => void;
}

export const dialogs = $state<{ current: Pending | null }>({ current: null });

export const confirmBox = (message: string) =>
  new Promise<boolean>((resolve) => {
    dialogs.current = { message, input: false, secret: false, resolve: (v) => resolve(v === true) };
  });

export const askBox = (message: string, secret = false) =>
  new Promise<string | null>((resolve) => {
    dialogs.current = { message, input: true, secret, resolve: (v) => resolve(typeof v === 'string' ? v : null) };
  });

/** Several buttons: resolves with the number of the one pressed, or null for Cancel. */
export const chooseBox = (message: string, choices: string[]) =>
  new Promise<number | null>((resolve) => {
    dialogs.current = { message, input: false, secret: false, choices, resolve: (v) => resolve(typeof v === 'string' ? Number(v) : null) };
  });
