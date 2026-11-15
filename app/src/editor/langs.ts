// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The languages the editor can colour inside code blocks, with the everyday short names
// (sh, bash, yml, ini, conf ...) people actually write after the three backticks.

import { LanguageDescription, StreamLanguage, LanguageSupport } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

const stream = (load: () => Promise<any>, key: string) => () =>
  load().then((m) => new LanguageSupport(StreamLanguage.define(m[key])));

/** Nix (NixOS configs, flakes, shells): not part of the standard language packs, so a small one lives here. */
interface NixState {
  comment: boolean;
  indented: boolean;
}
const NIX_WORDS = new Set(['let', 'in', 'if', 'then', 'else', 'rec', 'with', 'inherit', 'assert', 'or']);
const NIX_BUILTIN = new Set(['import', 'builtins', 'throw', 'abort', 'derivation', 'toString', 'map', 'removeAttrs', 'fetchurl', 'fetchTarball', 'fetchGit', 'mkDerivation', 'mkOption', 'mkIf', 'mkForce', 'mkDefault', 'mkEnableOption', 'lib', 'pkgs', 'config', 'options']);
const nix = StreamLanguage.define<NixState>({
  name: 'nix',
  startState: () => ({ comment: false, indented: false }),
  languageData: { commentTokens: { line: '#', block: { open: '/*', close: '*/' } } },
  token(stream, st) {
    if (st.comment) {
      if (stream.match(/^.*?\*\//)) st.comment = false;
      else stream.skipToEnd();
      return 'comment';
    }
    if (st.indented) {
      while (!stream.eol()) {
        if (stream.match("''$") || stream.match("'''") || stream.match("''\\")) continue;
        if (stream.match("''")) {
          st.indented = false;
          break;
        }
        stream.next();
      }
      return 'string';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('/*')) {
      st.comment = true;
      if (stream.match(/^.*?\*\//)) st.comment = false;
      else stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('#')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match("''")) {
      st.indented = true;
      return 'string';
    }
    if (stream.match('"')) {
      let esc = false;
      while (!stream.eol()) {
        const c = stream.next();
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') break;
      }
      return 'string';
    }
    if (stream.match(/^<[\w./-]+>/) || stream.match(/^~?\.{0,2}\/[\w./+-]+/) || stream.match(/^[a-z][a-z0-9+.-]*:\/\/[^\s;)\]]+/)) return 'string';
    if (stream.match(/^\d+(\.\d+)?([eE][+-]?\d+)?/)) return 'number';
    if (stream.match(/^\$\{|^\}/)) return 'punctuation';
    if (stream.match(/^(\/\/|\+\+|->|==|!=|<=|>=|&&|\|\||\?|@|:|=|!|<|>|\+|-|\*|\/)/)) return 'operator';
    if (stream.match(/^[\[\](){},;.]/)) return 'punctuation';
    if (stream.match(/^[A-Za-z_][\w'-]*/)) {
      const w = stream.current();
      if (NIX_WORDS.has(w)) return 'keyword';
      if (w === 'true' || w === 'false' || w === 'null') return 'atom';
      if (NIX_BUILTIN.has(w)) return 'builtin';
      if (stream.match(/^\s*(\.[\w'-]+\s*)*=(?!=)/, false)) return 'propertyName';
      return 'variableName';
    }
    stream.next();
    return null;
  },
});

const extra = [
  LanguageDescription.of({ name: 'Nix', alias: ['nix', 'nixos', 'flake'], load: async () => new LanguageSupport(nix) }),
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

/** Other names people use for the same thing (Linux files, Docker/Kubernetes, ...). */
const SAME_AS: Record<string, string> = {
  compose: 'yaml', 'docker-compose': 'yaml', k8s: 'yaml', kubernetes: 'yaml', netplan: 'yaml', ansible: 'yaml', 'cloud-init': 'yaml', helm: 'yaml',
  fstab: 'conf', crontab: 'conf', cron: 'conf', hosts: 'conf', sudoers: 'conf', sshd_config: 'conf', 'ssh-config': 'conf', ssh: 'conf',
  udev: 'conf', rules: 'conf', unit: 'conf', timer: 'conf', socket: 'conf', mount: 'conf', grub: 'conf', kconfig: 'conf', sysctl: 'conf',
  modprobe: 'conf', 'resolv.conf': 'conf', hcl: 'conf', terraform: 'conf', tf: 'conf', gitconfig: 'conf', editorconfig: 'conf', pacman: 'conf',
  makefile: 'sh', make: 'sh', mk: 'sh', containerfile: 'dockerfile', podman: 'dockerfile', patch: 'diff', jsonc: 'json', json5: 'json',
  caddyfile: 'nginx', caddy: 'nginx', haproxy: 'nginx', apache: 'nginx', httpd: 'nginx', vhost: 'nginx', ps1: 'powershell', pwsh: 'powershell',
  rs: 'rust', golang: 'go', kt: 'kotlin', 'c++': 'cpp', 'objective-c': 'c', ex: 'elixir', rb: 'ruby', js: 'javascript', ts: 'typescript', mjs: 'javascript', md: 'markdown', yml: 'yaml',
};

/** Finds the language for the word after the backticks (``` sh, ```yml title="x" ...). */
export function findLanguage(info: string): LanguageDescription | null {
  let name = info.trim().split(/[\s{]/)[0]?.toLowerCase().replace(/^\./, '') ?? '';
  if (!name) return null;
  name = SAME_AS[name] ?? name;
  return (
    all.find((l) => l.name.toLowerCase() === name || l.alias.includes(name)) ??
    LanguageDescription.matchLanguageName(all, name, true)
  );
}
