// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// base './' lets the same build run at a site root, under a sub-path
// (GitHub Pages) and inside the desktop / Android apps.
export default defineConfig({
  base: './',
  plugins: [svelte()],
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  server: { proxy: { '/api': 'http://127.0.0.1:8080', '/ws': { target: 'ws://127.0.0.1:8080', ws: true } } },
});
