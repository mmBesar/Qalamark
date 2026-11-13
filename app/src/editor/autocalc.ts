// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Keeps table results up to date. A moment after a change - and only when
// the cursor is not inside a table - every formula is recalculated and the
// changed cells are written back.
//
// With several people in one note, two computers could write the same
// result twice. So after a change that came from someone else, only one
// computer (the one with the lowest id) does the recalculation.

import { findTables, recalculate } from '@qalamark/tables';
import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { ySyncAnnotation } from 'y-codemirror.next';
import type { Awareness } from 'y-protocols/awareness';
import { applyDiff } from './tables.ts';

const MARKERS = /<!--\s*qalamark\b|\|\s*=/i;

function insideTable(view: EditorView): boolean {
  const lines = view.state.doc.toString().split('\n');
  const spans = findTables(lines);
  const doc = view.state.doc;
  return spans.some((t) => {
    const from = doc.line(t.rows[0]!.line + 1).from;
    const to = doc.line((t.block ? t.block.end : t.lastLine) + 1).to;
    return view.state.selection.ranges.some((r) => r.from <= to && r.to >= from);
  });
}

export function autoCalc(awareness: Awareness | null): Extension {
  const isLeader = () => {
    if (!awareness) return true;
    const ids = [...awareness.getStates().keys()];
    return ids.length === 0 || Math.min(...ids) === awareness.clientID;
  };

  return ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | undefined;
      fromOthers = false;
      constructor(readonly view: EditorView) {
        this.schedule();
      }
      update(u: ViewUpdate) {
        if (u.docChanged) {
          const remote = u.transactions.every((tr) => tr.annotation(ySyncAnnotation) !== undefined);
          this.fromOthers = remote && !u.transactions.some((tr) => tr.isUserEvent('input.table'));
          this.schedule();
        } else if (u.selectionSet) this.schedule();
      }
      schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.run(), this.fromOthers ? 900 : 500);
      }
      run() {
        const view = this.view;
        if (view.state.readOnly || !view.dom.isConnected) return;
        const md = view.state.doc.toString();
        if (!MARKERS.test(md) || insideTable(view)) return;
        if (this.fromOthers && !isLeader()) return;
        const out = recalculate(md);
        if (out.changed) {
          this.fromOthers = false;
          applyDiff(view, md, out.markdown);
        }
      }
      destroy() {
        clearTimeout(this.timer);
      }
    },
  );
}
