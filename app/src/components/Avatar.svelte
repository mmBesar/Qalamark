<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  // A person's picture, or, when they have not set one, nice letters on a colour made from their name.
  import { store } from '../lib/store.svelte.ts';
  let { name, size = 28 }: { name: string; size?: number } = $props();
  const url = $derived(store.avatarUrl(name));
  const initials = $derived.by(() => {
    const words = name.trim().split(/[\s._-]+/).filter(Boolean);
    const first = [...(words[0] ?? '?')][0] ?? '?';
    const second = words.length > 1 ? ([...words[1]!][0] ?? '') : '';
    return (first + second).toUpperCase();
  });
  // a steady hue per name, so the same person always has the same colour
  const hue = $derived([...name.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
</script>

<span class="avatar-c" style:width="{size}px" style:height="{size}px" style:font-size="{size * 0.4}px" style:--h={hue} title={name}>
  {#if url}<img src={url} alt={name} draggable="false" />{:else}<b>{initials}</b>{/if}
</span>

<style>
  .avatar-c { display: inline-grid; place-items: center; flex: none; border-radius: 50%; overflow: hidden; color: #fff; font-weight: 700; user-select: none; background: linear-gradient(135deg, hsl(var(--h) 62% 52%), hsl(calc(var(--h) + 40) 58% 42%)); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.18); }
  .avatar-c img { width: 100%; height: 100%; object-fit: cover; display: block; }
  b { font-weight: 700; letter-spacing: 0.02em; line-height: 1; }
</style>
