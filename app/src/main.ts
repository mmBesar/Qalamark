// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar

import { mount } from 'svelte';
import App from './App.svelte';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/400-italic.css';
import '@fontsource/roboto/700.css';
import '@fontsource/noto-naskh-arabic/arabic-400.css';
import '@fontsource/noto-naskh-arabic/arabic-700.css';
import '@fontsource/noto-sans-arabic/arabic-400.css';
import '@fontsource/noto-sans-arabic/arabic-700.css';
import './fonts/fonts.css';
import './app.css';

import { loadUserFonts } from './lib/fonts';
import { store } from './lib/store.svelte';

void loadUserFonts().then((names) => (store.userFonts = names));
mount(App, { target: document.getElementById('app')! });

// Let the app open without internet.
if ('serviceWorker' in navigator && location.protocol !== 'file:' && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* the app works fine without it */
  });
}
