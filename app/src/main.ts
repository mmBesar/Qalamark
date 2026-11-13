// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar

import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

mount(App, { target: document.getElementById('app')! });

// Let the app open without internet.
if ('serviceWorker' in navigator && location.protocol !== 'file:' && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* the app works fine without it */
  });
}
