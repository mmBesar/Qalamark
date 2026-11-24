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
export interface Reminder { at: number; hijri: boolean; text: string }

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

/** One `remind` value as a moment, or null when it is not a date we understand. */
export function parseRemind(value: string): Reminder | null {
  const m = RE.exec(digits(value).trim());
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
  return { at, hijri, text: value.trim() };
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

/** The reminders that are still to come (or that came less than `graceMs` ago while the app was closed), with their note. */
export function upcoming(all: Array<{ id: string; title: string; list: Reminder[] }>, now: number, graceMs = 0): Array<{ id: string; title: string; at: number }> {
  const out: Array<{ id: string; title: string; at: number }> = [];
  for (const n of all) for (const r of n.list) if (r.at >= now - graceMs) out.push({ id: n.id, title: n.title, at: r.at });
  return out.sort((a, b) => a.at - b.at);
}
