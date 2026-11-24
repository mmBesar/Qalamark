<script lang="ts">
  import { fly } from 'svelte/transition';
  import { store } from '../lib/store.svelte.ts';
  const t = store.t;
  let startY = 0;
  let dy = $state(0);
  const down = (e: PointerEvent) => { startY = e.clientY; dy = 0; };
  // the finger is only captured once it really drags, so taps on the buttons still reach them
  const move = (e: PointerEvent) => { if (!startY) return; dy = Math.min(0, e.clientY - startY); if (dy < -6) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const up = () => { if (dy < -40) store.ringing = null; dy = 0; startY = 0; };
</script>

{#if store.ringing}
  <div class="remind-banner" role="alert" style:transform={dy ? `translateY(${dy}px)` : ''} transition:fly={{ y: -90, duration: 220 }} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
    <span class="remind-bell" aria-hidden="true">🔔</span>
    <div class="remind-text">
      <small>{t('remindNow')}</small>
      <strong dir="auto">{store.ringing.title || 'Qalamark'}</strong>
    </div>
    <button class="primary small" onclick={() => store.openRinging()}>{t('remindOpen')}</button>
    <button class="ghost small" aria-label={t('remindDismiss')} onclick={() => (store.ringing = null)}>✕</button>
  </div>
{/if}
