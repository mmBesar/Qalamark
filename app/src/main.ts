// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar

// engine flag for engine-specific style fixes (WebKitGTK: the Linux app and GNOME Web)
if (/AppleWebKit/.test(navigator.userAgent) && /Linux/.test(navigator.userAgent) && !/Chrome|Chromium|Android/.test(navigator.userAgent)) document.documentElement.dataset.engine = 'webkitgtk';

import { mount } from 'svelte';
import App from './App.svelte';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/400-italic.css';
import '@fontsource/roboto/700.css';
import './fonts/fonts.css';
import './app.css';

import { loadUserFonts } from './lib/fonts';
import { store } from './lib/store.svelte';

void loadUserFonts().then((names) => { store.userFonts = names; store.applyLayout(); });
mount(App, { target: document.getElementById('app')! });

// Let the app open without internet.
if ('serviceWorker' in navigator && location.protocol !== 'file:' && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* the app works fine without it */
  });
}
