<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  // The easy way to set a reminder: quick choices, a date, a time, a repeat and the calendar. The text it writes is
  // the same one you can type by hand (2026-12-01 09:30 every week), so nothing here is a hidden format.
  import Select from './Select.svelte';
  import { describeEvery, formatRemind, occurrences, otherCalendar, parseRemind, type Every } from '../lib/reminders.ts';
  import { store } from '../lib/store.svelte.ts';

  let { value, readOnly, onchange }: { value: string; readOnly: boolean; onchange: (v: string) => void } = $props();
  const t = store.t;
  const pad = (n: number) => String(n).padStart(2, '0');

  const r = $derived(parseRemind(value));
  const tomorrow9 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); };
  const base = $derived(r?.at ?? tomorrow9());
  const hijri = $derived(r?.hijri ?? false);
  const every = $derived(r?.every);
  const dateVal = $derived(`${new Date(base).getFullYear()}-${pad(new Date(base).getMonth() + 1)}-${pad(new Date(base).getDate())}`);
  const timeVal = $derived(`${pad(new Date(base).getHours())}:${pad(new Date(base).getMinutes())}`);
  const next = $derived(r ? occurrences(r, Date.now(), 1)[0] : undefined);

  const set = (at: number, h = hijri, e: Every | undefined = every) => { onchange(formatRemind(at, h, e)); store.askNotifications(); };
  function setDate(v: string) {
    const [y, m, d] = v.split('-').map(Number);
    if (!y || !m || !d) return;
    const b = new Date(base);
    set(new Date(y, m - 1, d, b.getHours(), b.getMinutes()).getTime());
  }
  function setTime(v: string) {
    const [h, m] = v.split(':').map(Number);
    if (h === undefined || m === undefined || Number.isNaN(h)) return;
    const b = new Date(base);
    set(new Date(b.getFullYear(), b.getMonth(), b.getDate(), h, m).getTime());
  }
  const REPEATS: Array<[string, Every | undefined]> = [['none', undefined], ['day', { n: 1, unit: 'day' }], ['week', { n: 1, unit: 'week' }], ['2week', { n: 2, unit: 'week' }], ['month', { n: 1, unit: 'month' }], ['year', { n: 1, unit: 'year' }]];
  const REP_LABEL: Record<string, 'remRep_none' | 'remRep_day' | 'remRep_week' | 'remRep_2week' | 'remRep_month' | 'remRep_year'> = { none: 'remRep_none', day: 'remRep_day', week: 'remRep_week', '2week': 'remRep_2week', month: 'remRep_month', year: 'remRep_year' };
  const key = (e: Every | undefined) => (!e ? 'none' : e.n === 1 ? e.unit : e.n === 2 && e.unit === 'week' ? '2week' : 'custom');
  const repeatOptions = $derived([
    ...REPEATS.map(([k]) => ({ value: k, label: t(REP_LABEL[k]!) })),
    ...(key(every) === 'custom' ? [{ value: 'custom', label: describeEvery(every, store.lang) }] : []),
  ]);
  const setRepeat = (k: string) => { if (k === 'custom') return; set(base, hijri, REPEATS.find(([x]) => x === k)?.[1]); };

  function quick(kind: 'hour' | 'tonight' | 'tomorrow' | 'week') {
    const d = new Date();
    if (kind === 'hour') { d.setHours(d.getHours() + 1, 0, 0, 0); }
    else if (kind === 'tonight') { d.setHours(21, 0, 0, 0); if (d.getTime() < Date.now() + 60000) d.setDate(d.getDate() + 1); }
    else if (kind === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
    else { d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0); }
    set(d.getTime(), hijri, every);
  }
</script>

<div class="remind-ed">
  {#if !readOnly}
    <div class="remind-chips">
      <button type="button" class="chip" onclick={() => quick('hour')}>{t('remIn1h')}</button>
      <button type="button" class="chip" onclick={() => quick('tonight')}>{t('remTonight')}</button>
      <button type="button" class="chip" onclick={() => quick('tomorrow')}>{t('remTomorrow')}</button>
      <button type="button" class="chip" onclick={() => quick('week')}>{t('remNextWeek')}</button>
    </div>
  {/if}
  <div class="remind-row">
    <input type="date" inputmode="none" value={dateVal} disabled={readOnly} aria-label={t('remDate')} onchange={(e) => setDate(e.currentTarget.value)} />
    <input type="time" inputmode="none" value={timeVal} disabled={readOnly} aria-label={t('remTime')} onchange={(e) => setTime(e.currentTarget.value)} />
  </div>
  <div class="remind-row">
    <Select value={key(every)} options={repeatOptions} onchange={setRepeat} label={t('remRepeat')} />
    <Select value={hijri ? 'h' : 'g'} options={[{ value: 'g', label: t('remGreg') }, { value: 'h', label: t('remHijri') }]} onchange={(v) => set(base, v === 'h')} label={t('remCalendar')} />
  </div>
  <input class="remind-raw" value={value} disabled={readOnly} dir="ltr" spellcheck="false" placeholder="2026-12-01 09:30 every week" aria-label={t('remindHint')} onchange={(e) => { onchange(e.currentTarget.value); store.askNotifications(); }} />
  <small class="remind-hint" class:bad={value.trim() !== '' && !r}>
    {#if r}
      {otherCalendar(r, store.lang)}{#if r.every}{' · '}{describeEvery(r.every, store.lang)}{/if}{#if next}{' · '}{t('remNext')}: {new Date(next).toLocaleString(store.lang === 'ar' ? 'ar-EG-u-nu-latn' : undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{/if}
    {:else if value.trim()}{t('remindBad')}{:else}{t('remindHint')}{/if}
  </small>
</div>
