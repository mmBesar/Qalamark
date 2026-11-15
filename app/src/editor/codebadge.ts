// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// A code block in Live preview shows no ``` lines. Instead a small badge in the corner names the
// language and copies the code.

import { WidgetType } from '@codemirror/view';

export class CodeBadge extends WidgetType {
  constructor(
    readonly lang: string,
    readonly code: string,
  ) {
    super();
  }
  eq(o: CodeBadge) {
    return o.lang === this.lang && o.code === this.code;
  }
  toDOM() {
    const b = document.createElement('span');
    b.className = 'cm-code-badge';
    const name = document.createElement('span');
    name.textContent = this.lang;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'cm-code-copy';
    copy.setAttribute('aria-label', 'Copy');
    copy.title = 'Copy';
    copy.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
    copy.onmousedown = (e) => {
      e.preventDefault();
      void navigator.clipboard?.writeText(this.code).then(() => {
        copy.classList.add('done');
        setTimeout(() => copy.classList.remove('done'), 1200);
      });
    };
    b.append(name, copy);
    return b;
  }
  ignoreEvent() {
    return true;
  }
}

/** The language word of a fence line: "```bash title=x" -> "bash" */
export const fenceLang = (line: string): string => /^[ \t]*(?:```|~~~)[ \t]*([^\s{`]*)/.exec(line)?.[1] ?? '';
