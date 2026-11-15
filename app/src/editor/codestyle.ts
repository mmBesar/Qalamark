// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar

import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// Colours for code inside code blocks (other Markdown looks come from live preview).
export const codeStyle = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword, t.definitionKeyword], color: 'var(--c-keyword)' },
  { tag: [t.string, t.regexp, t.special(t.string), t.inserted], color: 'var(--c-string)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit, t.color], color: 'var(--c-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--c-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName), t.macroName], color: 'var(--c-function)' },
  { tag: [t.typeName, t.className, t.tagName, t.namespace], color: 'var(--c-type)' },
  { tag: [t.propertyName, t.attributeName, t.labelName], color: 'var(--c-property)' },
  { tag: [t.variableName, t.special(t.variableName)], color: 'var(--c-function)' },
  { tag: [t.deleted], color: 'var(--danger)' },
]);
