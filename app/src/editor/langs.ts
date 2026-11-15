// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The languages the editor can colour inside code blocks, with the everyday short names
// (sh, bash, yml, ini, conf ...) people actually write after the three backticks.

import { LanguageDescription, StreamLanguage, LanguageSupport } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

const stream = (load: () => Promise<any>, key: string) => () =>
  load().then((m) => new LanguageSupport(StreamLanguage.define(m[key])));

const extra = [
  LanguageDescription.of({
    name: 'Config',
    alias: ['conf', 'cfg', 'ini', 'desktop', 'service', 'env', 'dotenv', 'systemd', 'repo', 'properties'],
    load: stream(() => import('@codemirror/legacy-modes/mode/properties'), 'properties'),
  }),
  LanguageDescription.of({
    name: 'Shell',
    alias: ['sh', 'bash', 'zsh', 'shell', 'console', 'shell-session', 'terminal', 'fish', 'ksh'],
    load: stream(() => import('@codemirror/legacy-modes/mode/shell'), 'shell'),
  }),
  LanguageDescription.of({
    name: 'YAML',
    alias: ['yml', 'yaml'],
    load: stream(() => import('@codemirror/legacy-modes/mode/yaml'), 'yaml'),
  }),
  LanguageDescription.of({
    name: 'Python',
    alias: ['py', 'python', 'python3'],
    load: stream(() => import('@codemirror/legacy-modes/mode/python'), 'python'),
  }),
];

const all = [...extra, ...languages];

/** Finds the language for the word after the backticks (``` sh, ```yml title="x" ...). */
export function findLanguage(info: string): LanguageDescription | null {
  const name = info.trim().split(/[\s{]/)[0]?.toLowerCase().replace(/^\./, '') ?? '';
  if (!name) return null;
  return (
    all.find((l) => l.name.toLowerCase() === name || l.alias.includes(name)) ??
    LanguageDescription.matchLanguageName(all, name, true)
  );
}
