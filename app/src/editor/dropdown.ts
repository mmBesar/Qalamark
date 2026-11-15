// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Drop-down drawn by the app (the system one ignores the app theme on Linux).
// Wraps a real <select>, which stays hidden and keeps the value.

export function themed(sel: HTMLSelectElement): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'dd';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dd-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  sel.hidden = true;
  const sync = () => (btn.textContent = sel.selectedOptions[0]?.textContent ?? '');
  sel.addEventListener('change', sync);
  sync();
  let pop: HTMLElement | null = null;
  const close = () => {
    pop?.remove();
    pop = null;
    document.removeEventListener('pointerdown', away, true);
  };
  const away = (e: Event) => {
    if (pop && !pop.contains(e.target as Node) && e.target !== btn) close();
  };
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', () => {
    if (pop) return close();
    sync();
    pop = document.createElement('ul');
    pop.className = 'dd-pop';
    pop.setAttribute('role', 'listbox');
    [...sel.options].forEach((o, i) => {
      const li = document.createElement('li');
      li.textContent = o.textContent;
      li.setAttribute('role', 'option');
      if (i === sel.selectedIndex) li.className = 'on';
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        sel.selectedIndex = i;
        sel.dispatchEvent(new Event('change'));
        close();
      });
      pop!.append(li);
    });
    document.body.append(pop);
    const r = btn.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < 220;
    pop.style.left = `${r.left}px`;
    pop.style.minWidth = `${r.width}px`;
    if (up) pop.style.bottom = `${window.innerHeight - r.top + 4}px`;
    else pop.style.top = `${r.bottom + 4}px`;
    document.addEventListener('pointerdown', away, true);
  });
  wrap.append(sel, btn);
  return wrap;
}
