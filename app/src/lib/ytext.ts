// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar

import type { Text as YText } from 'yjs';

/** Put new text into a shared text, changing only the part that differs (keeps live co-editing smooth). */
export function applyText(ytext: YText, next: string) {
  const cur = ytext.toString();
  if (next === cur) return;
  let a = 0;
  while (a < cur.length && a < next.length && cur[a] === next[a]) a++;
  let b = 0;
  while (b < cur.length - a && b < next.length - a && cur[cur.length - 1 - b] === next[next.length - 1 - b]) b++;
  ytext.doc?.transact(() => {
    if (cur.length - a - b > 0) ytext.delete(a, cur.length - a - b);
    if (next.length - a - b > 0) ytext.insert(a, next.slice(a, next.length - b));
  });
}
