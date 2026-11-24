// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Reminders: a note with a `remind` property gets a notification at that time which opens the note.
//
//   remind: 2026-12-01 09:30          (normal date, 24-hour time; time is optional, 09:00 by default)
//   remind: h1448-06-10 21:00         (Hijri date: an "h" in front, or any year between 1300 and 1600)
//   remind: [2026-12-01 09:30, 2026-12-08]   (several)
//
// Hijri dates use the Umm al-Qura calendar (the one in Saudi Arabia) through the browser's own Intl, so no tables to ship.

import { readFrontMatter } from './frontmatter.ts';

export const DEFAULT_HOUR = 9;
export type Unit = 'day' | 'week' | 'month' | 'year';
export interface Every { n: number; unit: Unit }
export interface Reminder { at: number; hijri: boolean; text: string; every?: Every }

const AR = '٠١٢٣٤٥٦٧٨٩';
const digits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

const hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { year: 'numeric', month: 'numeric', day: 'numeric' });
/** The Hijri date of a moment (in the device's time zone). */
export function toHijri(ms: number): { y: number; m: number; d: number } {
  const p = hijriFmt.formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { y: g('year'), m: g('month'), d: g('day') };
}

/** The Gregorian day (local midnight) of a Hijri date, or null when it does not exist. */
export function fromHijri(y: number, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 30) return null;
  // a Hijri year is about 354 days: start near the right Gregorian date and walk to the exact day
  const guess = new Date(Date.UTC(622, 6, 19) + ((y - 1) * 354.367 + (m - 1) * 29.53 + d) * 86400000);
  const t0 = new Date(guess.getUTCFullYear(), guess.getUTCMonth(), guess.getUTCDate(), 12);
  for (let i = 0; i < 90; i++) {
    for (const s of i === 0 ? [0] : [i, -i]) {
      const c = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + s, 12);
      const h = toHijri(c.getTime());
      if (h.y === y && h.m === m && h.d === d) return new Date(c.getFullYear(), c.getMonth(), c.getDate());
    }
  }
  return null;
}

const RE = /^\s*(h)?\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s*(h)?(?:[ T]+(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm|ص|م)?)?\s*(h)?\s*$/i;

const UNIT_WORDS: Array<[RegExp, Unit]> = [[/^(day|يوم|ايام|أيام)/i, 'day'], [/^(week|اسبوع|أسبوع|اسابيع|أسابيع)/i, 'week'], [/^(month|شهر|أشهر|اشهر|شهور)/i, 'month'], [/^(year|سنة|سنين|سنوات|عام|أعوام)/i, 'year']];
const unitOf = (w: string): Unit | null => { for (const [re, u] of UNIT_WORDS) if (re.test(w)) return u; return null; };
const KEYWORD: Record<string, Unit> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year', annually: 'year', 'يوميا': 'day', 'يومياً': 'day', 'أسبوعيا': 'week', 'أسبوعياً': 'week', 'اسبوعيا': 'week', 'شهريا': 'month', 'شهرياً': 'month', 'سنويا': 'year', 'سنوياً': 'year' };
const EVERY = /\s+(?:(?:every|each|كل)\s*(\d+)?\s*([^\s\d]+?)|(daily|weekly|monthly|yearly|annually|يوميا|يومياً|أسبوعيا|أسبوعياً|اسبوعيا|شهريا|شهرياً|سنويا|سنوياً))\s*$/i;

/** The repeat at the end of a value ("every 2 weeks", "daily", "كل أسبوع"), and the rest of the value without it. */
function splitEvery(v: string): { rest: string; every?: Every } {
  const m = EVERY.exec(v);
  if (!m) return { rest: v };
  if (m[3]) return { rest: v.slice(0, m.index), every: { n: 1, unit: KEYWORD[m[3].toLowerCase()]! } };
  const u = unitOf((m[2] ?? '').replace(/s$/i, ''));
  if (!u) return { rest: v };
  const n = Math.max(1, Math.min(365, m[1] ? Number(m[1]) : 1));
  return { rest: v.slice(0, m.index), every: { n, unit: u } };
}

/** One `remind` value as a moment, or null when it is not a date we understand. */
export function parseRemind(value: string): Reminder | null {
  const { rest, every } = splitEvery(digits(value).trim());
  const m = RE.exec(rest.trim());
  if (!m) return null;
  const y = Number(m[2]), mo = Number(m[3]), d = Number(m[4]);
  let hh = m[6] === undefined ? DEFAULT_HOUR : Number(m[6]);
  const mm = m[7] === undefined ? 0 : Number(m[7]);
  const ap = m[8]?.toLowerCase();
  if (ap === 'pm' || ap === 'م') { if (hh < 12) hh += 12; } else if ((ap === 'am' || ap === 'ص') && hh === 12) hh = 0;
  if (hh > 23 || mm > 59) return null;
  const hijri = !!(m[1] || m[5] || m[9]) || (y >= 1300 && y <= 1600);
  let day: Date | null;
  if (hijri) day = fromHijri(y, mo, d);
  else {
    day = new Date(y, mo - 1, d);
    if (day.getFullYear() !== y || day.getMonth() !== mo - 1 || day.getDate() !== d) day = null;
  }
  if (!day) return null;
  const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm).getTime();
  return { at, hijri, text: value.trim(), ...(every ? { every } : {}) };
}

/** All reminders of a note's text, soonest first. */
export function remindersOf(doc: string): Reminder[] {
  const fm = readFrontMatter(doc);
  if (!fm) return [];
  const out: Reminder[] = [];
  for (const p of fm.props) {
    if (p.key.toLowerCase() !== 'remind') continue;
    const vals = p.type === 'list' ? p.items : [p.text];
    for (const v of vals) {
      const r = parseRemind(v);
      if (r) out.push(r);
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

const HIJRI_MONTHS_AR = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];
const HIJRI_MONTHS_EN = ['Muharram', 'Safar', 'Rabiʻ I', 'Rabiʻ II', 'Jumada I', 'Jumada II', 'Rajab', 'Shaʻban', 'Ramadan', 'Shawwal', 'Dhu al-Qiʻdah', 'Dhu al-Hijjah'];

/** "10 Rajab 1448" for a moment. */
export function hijriText(ms: number, lang: string): string {
  const h = toHijri(ms);
  const ar = lang === 'ar';
  const name = (ar ? HIJRI_MONTHS_AR : HIJRI_MONTHS_EN)[h.m - 1] ?? '';
  return ar ? `${h.d.toLocaleString('ar-EG')} ${name} ${h.y.toLocaleString('ar-EG', { useGrouping: false })} هـ` : `${h.d} ${name} ${h.y} AH`;
}

/** The other calendar's name for the same moment: shows "Rajab" date for a Gregorian reminder and the reverse. */
export function otherCalendar(r: Reminder, lang: string): string {
  if (r.hijri) return new Date(r.at).toLocaleDateString(lang === 'ar' ? 'ar-EG-u-nu-latn' : undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return hijriText(r.at, lang);
}

const DAY = 86400000;
const atTime = (day: Date, base: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), base.getHours(), base.getMinutes()).getTime();

/** The k-th time a reminder rings (0 is the first one). */
function nth(r: Reminder, k: number): number | null {
  if (!r.every || k === 0) return r.at;
  const base = new Date(r.at);
  const { n, unit } = r.every;
  if (unit === 'day' || unit === 'week') return atTime(new Date(base.getFullYear(), base.getMonth(), base.getDate() + k * n * (unit === 'week' ? 7 : 1)), base);
  const months = k * n * (unit === 'year' ? 12 : 1);
  if (r.hijri) {
    const h = toHijri(r.at);
    const idx = h.y * 12 + (h.m - 1) + months;
    const y = Math.floor(idx / 12), mo = (idx % 12) + 1;
    for (let d = h.d; d >= Math.max(1, h.d - 2); d--) { const day = fromHijri(y, mo, d); if (day) return atTime(day, base); }
    return null;
  }
  const idx = base.getFullYear() * 12 + base.getMonth() + months;
  const y = Math.floor(idx / 12), mo = idx % 12;
  const last = new Date(y, mo + 1, 0).getDate();
  return atTime(new Date(y, mo, Math.min(base.getDate(), last)), base);
}

/** Up to `count` times a reminder rings from `from` on (one time for a plain reminder, the next few for a repeating one). */
export function occurrences(r: Reminder, from: number, count = 12): number[] {
  const out: number[] = [];
  let k = 0;
  if (r.every && r.every.unit !== 'month' && r.every.unit !== 'year' && from > r.at) {
    k = Math.max(0, Math.floor((from - r.at) / (r.every.n * (r.every.unit === 'week' ? 7 : 1) * DAY)) - 1); // skip the long past
  } else if (r.every && from > r.at) {
    k = Math.max(0, Math.floor((from - r.at) / (r.every.n * (r.every.unit === 'year' ? 365 : 29.5) * DAY)) - 1);
  }
  for (let guard = 0; guard < 4000 && out.length < count; guard++, k++) {
    const t = nth(r, k);
    if (t !== null && t >= from) out.push(t);
    if (!r.every) break;
  }
  return out;
}

/** The reminders still to come (or that came less than `graceMs` ago), with their note, soonest first. */
export function upcoming(all: Array<{ id: string; title: string; list: Reminder[] }>, now: number, graceMs = 0, per = 12): Array<{ id: string; title: string; at: number }> {
  const out: Array<{ id: string; title: string; at: number }> = [];
  for (const n of all) for (const r of n.list) for (const at of occurrences(r, now - graceMs, per)) out.push({ id: n.id, title: n.title, at });
  return out.sort((a, b) => a.at - b.at);
}

const pad = (n: number) => String(n).padStart(2, '0');
/** The text to store for a moment (the format `parseRemind` reads back). */
export function formatRemind(at: number, hijri: boolean, every?: Every): string {
  const d = new Date(at);
  let day: string;
  if (hijri) { const h = toHijri(at); day = `h${h.y}-${pad(h.m)}-${pad(h.d)}`; }
  else day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const rep = !every ? '' : every.n === 1 ? ` every ${every.unit}` : ` every ${every.n} ${every.unit}s`;
  return `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}${rep}`;
}

const UNIT_AR: Record<Unit, [string, string, string]> = { day: ['يوم', 'يومين', 'أيام'], week: ['أسبوع', 'أسبوعين', 'أسابيع'], month: ['شهر', 'شهرين', 'أشهر'], year: ['سنة', 'سنتين', 'سنوات'] };
/** "Every 2 weeks" / "كل أسبوعين". */
export function describeEvery(e: Every | undefined, lang: string): string {
  if (!e) return '';
  if (lang === 'ar') return e.n === 1 ? `كل ${UNIT_AR[e.unit][0]}` : e.n === 2 ? `كل ${UNIT_AR[e.unit][1]}` : `كل ${e.n.toLocaleString('ar-EG')} ${UNIT_AR[e.unit][2]}`;
  return e.n === 1 ? `Every ${e.unit}` : `Every ${e.n} ${e.unit}s`;
}
