// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar

//
// Colour themes: the four Catppuccin flavours (with all 14 accents to pick
// from), AMOLED, the system's own colours, and two themes of our own.
// A theme is a list of colours; applyTheme() turns it into CSS variables.

import { androidBars, onAndroid, systemColors, type SystemColors } from './vault.ts';

export type ThemeId = 'auto' | 'system' | 'latte' | 'frappe' | 'macchiato' | 'mocha' | 'amoled' | 'paper' | 'nile';

export const ACCENTS = [
  'rosewater', 'flamingo', 'pink', 'mauve', 'red', 'maroon', 'peach',
  'yellow', 'green', 'teal', 'sky', 'sapphire', 'blue', 'lavender',
] as const;
export type Accent = (typeof ACCENTS)[number] | 'default';

type Colors = Record<(typeof ACCENTS)[number], string>;

interface Palette {
  name: string;
  dark: boolean;
  base: string;
  mantle: string;
  crust: string;
  surface0: string;
  surface1: string;
  overlay0: string;
  subtext0: string;
  text: string;
  accents: Colors;
  /** Accent used when the person has not chosen one. */
  accent: (typeof ACCENTS)[number] | string;
  code?: string; // background of code and table headers
}

const latteAccents: Colors = {
  rosewater: '#dc8a78', flamingo: '#dd7878', pink: '#ea76cb', mauve: '#8839ef', red: '#d20f39', maroon: '#e64553', peach: '#fe640b',
  yellow: '#df8e1d', green: '#40a02b', teal: '#179299', sky: '#04a5e5', sapphire: '#209fb5', blue: '#1e66f5', lavender: '#7287fd',
};
const frappeAccents: Colors = {
  rosewater: '#f2d5cf', flamingo: '#eebebe', pink: '#f4b8e4', mauve: '#ca9ee6', red: '#e78284', maroon: '#ea999c', peach: '#ef9f76',
  yellow: '#e5c890', green: '#a6d189', teal: '#81c8be', sky: '#99d1db', sapphire: '#85c1dc', blue: '#8caaee', lavender: '#babbf1',
};
const macchiatoAccents: Colors = {
  rosewater: '#f4dbd6', flamingo: '#f0c6c6', pink: '#f5bde6', mauve: '#c6a0f6', red: '#ed8796', maroon: '#ee99a0', peach: '#f5a97f',
  yellow: '#eed49f', green: '#a6da95', teal: '#8bd5ca', sky: '#91d7e3', sapphire: '#7dc4e4', blue: '#8aadf4', lavender: '#b7bdf8',
};
const mochaAccents: Colors = {
  rosewater: '#f5e0dc', flamingo: '#f2cdcd', pink: '#f5c2e7', mauve: '#cba6f7', red: '#f38ba8', maroon: '#eba0ac', peach: '#fab387',
  yellow: '#f9e2af', green: '#a6e3a1', teal: '#94e2d5', sky: '#89dceb', sapphire: '#74c7ec', blue: '#89b4fa', lavender: '#b4befe',
};

export const PALETTES: Record<Exclude<ThemeId, 'auto' | 'system'>, Palette> = {
  latte: { name: 'Catppuccin Latte', dark: false, base: '#eff1f5', mantle: '#e6e9ef', crust: '#dce0e8', surface0: '#ccd0da', surface1: '#bcc0cc', overlay0: '#9ca0b0', subtext0: '#6c6f85', text: '#4c4f69', accents: latteAccents, accent: 'mauve', code: '#e6e9ef' },
  frappe: { name: 'Catppuccin Frappé', dark: true, base: '#303446', mantle: '#292c3c', crust: '#232634', surface0: '#414559', surface1: '#51576d', overlay0: '#737994', subtext0: '#a5adce', text: '#c6d0f5', accents: frappeAccents, accent: 'mauve' },
  macchiato: { name: 'Catppuccin Macchiato', dark: true, base: '#24273a', mantle: '#1e2030', crust: '#181926', surface0: '#363a4f', surface1: '#494d64', overlay0: '#6e738d', subtext0: '#a5adcb', text: '#cad3f5', accents: macchiatoAccents, accent: 'mauve' },
  mocha: { name: 'Catppuccin Mocha', dark: true, base: '#1e1e2e', mantle: '#181825', crust: '#11111b', surface0: '#313244', surface1: '#45475a', overlay0: '#6c7086', subtext0: '#a6adc8', text: '#cdd6f4', accents: mochaAccents, accent: 'mauve' },
  // Pure black for OLED screens (Mocha accents).
  amoled: { name: 'AMOLED', dark: true, base: '#000000', mantle: '#000000', crust: '#000000', surface0: '#161618', surface1: '#26262a', overlay0: '#6c7086', subtext0: '#a6adc8', text: '#e4e7f5', accents: mochaAccents, accent: 'mauve', code: '#121214' },
  // Our own: warm paper, and the Nile at night.
  paper: { name: 'Paper', dark: false, base: '#fffdf8', mantle: '#ebe5d6', crust: '#f4efe4', surface0: '#ddd5c4', surface1: '#cfc6b2', overlay0: '#9a9282', subtext0: '#7b7367', text: '#2a2622', accents: { ...latteAccents, green: '#1f5c4d', teal: '#1f6f78' }, accent: '#1f5c4d', code: '#efe9db' },
  nile: { name: 'Nile', dark: true, base: '#0f1f20', mantle: '#0a1718', crust: '#071112', surface0: '#193234', surface1: '#244547', overlay0: '#5f8083', subtext0: '#9ab8b6', text: '#e3efe9', accents: { ...mochaAccents, yellow: '#e8c46a', peach: '#f0a868', teal: '#5ed1b9', green: '#9fdc8e' }, accent: '#e8c46a', code: '#152a2b' },
};

export const THEME_LIST: ThemeId[] = ['auto', 'system', 'latte', 'frappe', 'macchiato', 'mocha', 'amoled', 'paper', 'nile'];

function setVars(vars: Record<string, string>) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

function paletteVars(p: Palette, accent: Accent): Record<string, string> {
  const a = accent === 'default' ? (p.accents[p.accent as keyof Colors] ?? p.accent) : p.accents[accent];
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  };
  const dangerOk = p.dark ? { danger: p.accents.red, ok: p.accents.green } : { danger: p.accents.red, ok: p.accents.green };
  return {
    '--bg': p.crust,
    '--surface': p.base,
    '--side': p.mantle,
    '--ink': p.text,
    '--muted': p.subtext0,
    '--line': p.surface0,
    '--accent': a,
    '--accent-soft': `color-mix(in srgb, ${a} 18%, ${p.base})`,
    '--accent-ink': lum(a) > 0.6 ? '#11111b' : '#ffffff',
    '--gold': p.accents.yellow,
    '--danger': dangerOk.danger,
    '--ok': dangerOk.ok,
    '--code-bg': p.code ?? p.surface0,
    '--formula-bg': `color-mix(in srgb, ${a} 14%, ${p.base})`,
    '--shadow': p.dark ? '0 8px 30px rgba(0,0,0,0.55)' : '0 8px 30px rgba(40,40,60,0.18)',
    '--c-keyword': p.accents.mauve,
    '--c-string': p.accents.green,
    '--c-number': p.accents.peach,
    '--c-comment': p.overlay0,
    '--c-function': p.accents.blue,
    '--c-type': p.accents.yellow,
    '--c-property': p.accents.teal,
    // headings and text styles in colour (a little darker on light themes so they stay readable)
    '--h1': tone(p, p.accents.red),
    '--h2': tone(p, p.accents.peach),
    '--h3': tone(p, p.accents.yellow),
    '--h4': tone(p, p.accents.green),
    '--h5': tone(p, p.accents.sapphire),
    '--h6': tone(p, p.accents.mauve),
    '--c-strong': tone(p, p.accents.maroon),
    '--c-em': tone(p, p.accents.pink),
    '--c-mark': `color-mix(in srgb, ${p.accents.yellow} 35%, transparent)`,
    'color-scheme': p.dark ? 'dark' : 'light',
  };
}

/** An accent as a text colour: as is on dark themes, a little toward the text colour on light ones. */
function tone(p: Palette, c: string): string {
  return p.dark ? c : `color-mix(in srgb, ${c} 78%, ${p.text})`;
}

/** The colours of the operating system itself (CSS system colours). */
function systemVars(accent: Accent): Record<string, string> {
  const a = accent === 'default' ? 'AccentColor' : mochaAccents[accent];
  return {
    '--bg': 'color-mix(in srgb, Canvas 94%, CanvasText)',
    '--surface': 'Canvas',
    '--side': 'color-mix(in srgb, Canvas 92%, CanvasText)',
    '--ink': 'CanvasText',
    '--muted': 'color-mix(in srgb, CanvasText 58%, Canvas)',
    '--line': 'color-mix(in srgb, CanvasText 16%, Canvas)',
    '--accent': a,
    '--accent-soft': `color-mix(in srgb, ${a} 18%, Canvas)`,
    '--accent-ink': 'AccentColorText',
    '--gold': '#d9a21b',
    '--danger': '#d23b3b',
    '--ok': '#2f9e5a',
    '--code-bg': 'color-mix(in srgb, Canvas 90%, CanvasText)',
    '--formula-bg': `color-mix(in srgb, ${a} 14%, Canvas)`,
    '--shadow': '0 8px 30px rgba(0,0,0,0.25)',
    '--c-keyword': '#a3359b',
    '--c-string': '#2b8a4b',
    '--c-number': '#c0620a',
    '--c-comment': 'color-mix(in srgb, CanvasText 50%, Canvas)',
    '--c-function': '#2f6fd0',
    '--c-type': '#a0701a',
    '--c-property': '#0b7a8f',
    '--h1': '#c0392b', '--h2': '#c0620a', '--h3': '#9a7400', '--h4': '#2b8a4b', '--h5': '#0b7a8f', '--h6': '#8e44ad',
    '--c-strong': '#b0394b', '--c-em': '#b8368f', '--c-mark': 'color-mix(in srgb, #e8b04a 40%, transparent)',
    'color-scheme': 'light dark',
  };
}

let sysCache: SystemColors | null | undefined;

/** A palette made of the system's own colours: Material You on Android, the KDE scheme or GNOME accent on Linux. */
function systemPalette(c: SystemColors, osDark: boolean): Palette {
  const y = c.you;
  if (y) {
    const dark = osDark;
    const g = (k: string, d: string) => y[k] ?? d;
    return dark
      ? { name: 'Material You', dark, base: g('neutral1_900', '#1c1b1f'), mantle: g('neutral1_1000', '#000'), crust: g('neutral1_1000', '#000'), surface0: g('neutral1_800', '#303033'), surface1: g('neutral1_800', '#303033'), overlay0: g('neutral2_300', '#c7c5d0'), subtext0: g('neutral2_300', '#c7c5d0'), text: g('neutral1_100', '#e6e1e5'), accents: mochaAccents, accent: g('accent1_200', '#cba6f7'), code: g('neutral1_800', '#303033') }
      : { name: 'Material You', dark, base: g('neutral1_10', '#fffbff'), mantle: g('neutral1_50', '#f4eff4'), crust: g('neutral1_100', '#e6e1e5'), surface0: g('neutral1_200', '#c9c5ca'), surface1: g('neutral1_200', '#c9c5ca'), overlay0: g('neutral2_700', '#49454f'), subtext0: g('neutral2_700', '#49454f'), text: g('neutral1_900', '#1c1b1f'), accents: latteAccents, accent: g('accent1_600', '#8839ef'), code: g('neutral1_50', '#f4eff4') };
  }
  const dark = c.dark ?? osDark;
  const base = c.bg ?? (dark ? '#1e1e1e' : '#fafafa');
  const text = c.fg ?? (dark ? '#f0f0f0' : '#242424');
  return {
    name: 'System', dark, base,
    mantle: c.side ?? `color-mix(in srgb, ${base} 94%, ${text})`,
    crust: `color-mix(in srgb, ${base} 90%, ${text})`,
    surface0: `color-mix(in srgb, ${base} 84%, ${text})`,
    surface1: `color-mix(in srgb, ${base} 76%, ${text})`,
    overlay0: `color-mix(in srgb, ${text} 45%, ${base})`,
    subtext0: `color-mix(in srgb, ${text} 62%, ${base})`,
    text, accents: dark ? mochaAccents : latteAccents,
    accent: c.accent ?? (dark ? '#78aeed' : '#3584e4'),
    code: `color-mix(in srgb, ${base} 92%, ${text})`,
  };
}

export function applyTheme(theme: ThemeId, accent: Accent): void {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (theme === 'system' && sysCache === undefined) {
    // ask the system once, then apply again with its colours
    sysCache = null;
    void systemColors().then((c) => {
      sysCache = c;
      if (c) applyTheme(theme, accent);
    });
  }
  let vars: Record<string, string>;
  let meta = '#eff1f5';
  if (theme === 'system' && sysCache) {
    const p = systemPalette(sysCache, dark);
    vars = paletteVars(p, accent);
    meta = p.base;
  } else if (theme === 'system') {
    vars = systemVars(accent);
    meta = dark ? '#1e1e1e' : '#ffffff';
  } else {
    const id = theme === 'auto' ? (dark ? 'mocha' : 'latte') : theme;
    const p = PALETTES[id];
    vars = paletteVars(p, accent);
    meta = p.base;
  }
  setVars(vars);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', meta);
  // Android: the status and navigation bars take the colour of the page
  const m = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g);
  if (m && m.length >= 3) {
    const [r, g, b] = m.map(Number);
    const hex = '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
    androidBars(hex, (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6);
  }
}

export function themeName(id: ThemeId, t: (k: 'themeAuto' | 'themeSystem') => string): string {
  if (id === 'auto') return t('themeAuto');
  if (id === 'system') return onAndroid() ? 'Material You' : t('themeSystem');
  return PALETTES[id].name;
}
