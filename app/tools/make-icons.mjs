// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Draws every small icon of the app from one set of shapes: the system-tray icons (three styles, each in colour,
// white and black) and the Android ones (the notification icon and the monochrome "themed" launcher icon).
//   node app/tools/make-icons.mjs        (needs the e2e dependencies installed: it uses Playwright to draw)

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const req = createRequire(join(here, '../../e2e/package.json'));
const { chromium } = req('playwright');
const fk = createRequire(join(here, '../package.json'))('fontkit');

// ---- the shapes (a 512 x 512 square)
const PEN_BODY = 'M232 62h48a14 14 0 0 1 14 14v246l-38 76-38-76V76a14 14 0 0 1 14-14z';
const PEN_HOLES = 'M256 273a11 11 0 1 0 0 22a11 11 0 1 0 0-22z M251.5 300h9v94h-9z M226 116h60v9h-60z';
const WAVE = 'M84 436c38-34 66 22 108-6s64-36 100-4 56 4 78-14';
const ROT = 'rotate(38 256 256)';

/** The letter qaf (ق), the first letter of qalam, from the Naskh face the app ships, as one path in the square. */
function qafPath() {
  const f = fk.create(readFileSync(join(here, '../src/pdf/fonts/qm-naskh-ui-700.ttf')));
  const g = f.layout('ق').glyphs[0];
  const b = g.bbox;
  const k = 400 / Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const ox = 256 - ((b.minX + b.maxX) / 2) * k, oy = 256 + ((b.minY + b.maxY) / 2) * k;
  const p = (x, y) => `${(x * k + ox).toFixed(1)} ${(oy - y * k).toFixed(1)}`;
  let d = '';
  for (const c of g.path.commands) {
    const a = c.args;
    if (c.command === 'moveTo') d += `M${p(a[0], a[1])}`;
    else if (c.command === 'lineTo') d += `L${p(a[0], a[1])}`;
    else if (c.command === 'quadraticCurveTo') d += `Q${p(a[0], a[1])} ${p(a[2], a[3])}`;
    else if (c.command === 'bezierCurveTo') d += `C${p(a[0], a[1])} ${p(a[2], a[3])} ${p(a[4], a[5])}`;
    else if (c.command === 'closePath') d += 'Z';
  }
  return d;
}
const QAF = qafPath();

/** A glyph as SVG markup in the given colour (a gradient id or a plain colour). */
const glyph = {
  pen: (c) => `<g transform="${ROT}"><path fill="${c}" fill-rule="evenodd" d="${PEN_BODY} ${PEN_HOLES}"/></g><path d="${WAVE}" fill="none" stroke="${c}" stroke-width="22" stroke-linecap="round"/>`,
  outline: (c) => `<g transform="${ROT}" fill="none" stroke="${c}" stroke-width="22" stroke-linejoin="round" stroke-linecap="round"><path d="${PEN_BODY}"/><path d="M256 300v92"/><circle cx="256" cy="284" r="6" fill="${c}"/></g><path d="${WAVE}" fill="none" stroke="${c}" stroke-width="22" stroke-linecap="round"/>`,
  qaf: (c) => `<path fill="${c}" d="${QAF}"/>`,
};
const TONE = { colour: 'url(#g)', light: '#ffffff', dark: '#1b1b24' };
const defs = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ee7fc0"/><stop offset=".5" stop-color="#a875f2"/><stop offset="1" stop-color="#4f8cf7"/></linearGradient></defs>';
const svg = (style, tone, size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">${defs}${glyph[style](TONE[tone])}</svg>`;

// ---- tray icons: PNGs with a clear background
const out = join(here, '../src-tauri/icons/tray');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 160, height: 160 } });
for (const style of Object.keys(glyph)) {
  for (const tone of Object.keys(TONE)) {
    await page.setContent(`<body style="margin:0;background:transparent">${svg(style, tone, 128)}</body>`);
    await page.screenshot({ path: join(out, `${style}-${tone}.png`), omitBackground: true, clip: { x: 0, y: 0, width: 128, height: 128 } });
  }
}
await browser.close();

// ---- Android: vector drawables (white shapes on nothing; the system colours them)
const vec = (name, w, inner, group) => `<?xml version="1.0" encoding="utf-8"?>
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Made by app/tools/make-icons.mjs from the same shapes as the other icons. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${w}dp" android:height="${w}dp"
    android:viewportWidth="${group ? 108 : 512}" android:viewportHeight="${group ? 108 : 512}">
${inner}
</vector>
`;
const penDrawable = (indent = '    ') =>
  `${indent}<group android:pivotX="256" android:pivotY="256" android:rotation="38">\n${indent}    <path android:fillColor="#FFFFFFFF" android:fillType="evenOdd" android:pathData="${PEN_BODY} ${PEN_HOLES}"/>\n${indent}</group>\n` +
  `${indent}<path android:strokeColor="#FFFFFFFF" android:strokeWidth="30" android:strokeLineCap="round" android:pathData="${WAVE}"/>`;
const res = join(here, '../android-extras/res/drawable');
mkdirSync(res, { recursive: true });
// the notification icon: a bold pen and wave
writeFileSync(join(res, 'ic_stat_qalamark.xml'), vec('stat', 24, penDrawable()));
// the "themed icon" layer of the launcher icon: the same pen, inside the safe zone of the 108 dp adaptive canvas
writeFileSync(join(res, 'qm_monochrome.xml'), vec('mono', 108, `    <group android:scaleX="0.125" android:scaleY="0.125" android:translateX="22" android:translateY="22">\n${penDrawable('        ')}\n    </group>`, true));
console.log('icons written');
