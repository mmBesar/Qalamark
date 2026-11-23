// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Motion. A rule of the app: every menu, sheet and window comes from somewhere and goes somewhere; nothing just
// appears or disappears. Svelte parts use `pop` (menus) and `fly`/`fade`; the browser's own <dialog>s are
// animated by `animateDialogs()`, which makes close() (and Esc, and forms that close a dialog) play an exit.

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A small menu that grows out of the corner it hangs from. */
export function pop(_node: Element, { duration = 150, from = 0.92 }: { duration?: number; from?: number } = {}) {
  return {
    duration: reduced() ? 0 : duration,
    css: (t: number) => `opacity:${t};transform:scale(${from + (1 - from) * t}) translateY(${(1 - t) * -6}px)`,
  };
}

/** Windows made with <dialog> animate out as well as in. Call once at start-up. */
export function animateDialogs() {
  if (typeof HTMLDialogElement === 'undefined' || (HTMLDialogElement.prototype as { __animated?: boolean }).__animated) return;
  const orig = HTMLDialogElement.prototype.close;
  (HTMLDialogElement.prototype as { __animated?: boolean }).__animated = true;
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement, rv?: string) {
    if (!this.open || this.classList.contains('closing') || reduced()) return orig.call(this, rv);
    this.classList.add('closing');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      this.classList.remove('closing');
      orig.call(this, rv);
    };
    this.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 320);
  };
  // Esc: let the dialog leave the way it came
  document.addEventListener('cancel', (e) => {
    const d = e.target as HTMLDialogElement;
    if (d instanceof HTMLDialogElement && !e.defaultPrevented && !reduced()) {
      e.preventDefault();
      d.close();
    }
  }, true);
  // <form method="dialog"> buttons
  document.addEventListener('submit', (e) => {
    const f = e.target as HTMLFormElement;
    const d = f.closest?.('dialog');
    if (d && f.method === 'dialog' && !e.defaultPrevented && !reduced()) {
      e.preventDefault();
      d.close((e as SubmitEvent).submitter?.getAttribute('value') ?? '');
    }
  }, true);
}
