import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRemind, remindersOf, fromHijri, toHijri, upcoming, occurrences, formatRemind } from '../app/src/lib/reminders.ts';

const at = (y: number, m: number, d: number, h = 9, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();

test('gregorian reminders, with and without time', () => {
  assert.equal(parseRemind('2026-12-01 09:30')!.at, at(2026, 12, 1, 9, 30));
  assert.equal(parseRemind('2026-12-01')!.at, at(2026, 12, 1, 9, 0));
  assert.equal(parseRemind('2026-12-01T21:05')!.at, at(2026, 12, 1, 21, 5));
  assert.equal(parseRemind('2026-12-01 9pm')!.at, at(2026, 12, 1, 21, 0));
  assert.equal(parseRemind('٢٠٢٦-١٢-٠١ ٢١:٠٠')!.at, at(2026, 12, 1, 21, 0), 'Arabic digits');
  assert.equal(parseRemind('2026-12-01 09:30:00')!.at, at(2026, 12, 1, 9, 30), 'seconds are ignored');
  assert.equal(parseRemind('2026-02-30'), null);
  assert.equal(parseRemind('tomorrow'), null);
  assert.equal(parseRemind('2026-12-01 25:00'), null);
});

test('hijri reminders round-trip through the calendar', () => {
  const r = parseRemind('h1448-06-10 21:00')!;
  assert.ok(r.hijri);
  const back = toHijri(r.at);
  assert.deepEqual(back, { y: 1448, m: 6, d: 10 });
  assert.equal(new Date(r.at).getHours(), 21);
  assert.equal(parseRemind('1448-06-10 21:00')!.at, r.at, 'a 14xx year is Hijri by itself');
  const d = fromHijri(1447, 9, 1)!; // first of Ramadan 1447 is in February 2026
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 1);
  assert.equal(fromHijri(1447, 13, 1), null);
});

test('reminders come from the remind property, one or several', () => {
  const doc = '---\ntitle: x\nremind: [2026-12-08, 2026-12-01 09:30]\n---\nbody';
  assert.deepEqual(remindersOf(doc).map((r) => r.at), [at(2026, 12, 1, 9, 30), at(2026, 12, 8)]);
  assert.deepEqual(remindersOf('---\nremind: 2026-12-01\n---\n').length, 1);
  assert.deepEqual(remindersOf('no properties'), []);
});

test('upcoming lists what is still to come, soonest first', () => {
  const now = at(2026, 12, 1, 12);
  const l = upcoming([{ id: 'a', title: 'A', list: [{ at: at(2026, 12, 3), hijri: false, text: '' }, { at: at(2026, 11, 1), hijri: false, text: '' }] }, { id: 'b', title: 'B', list: [{ at: at(2026, 12, 2), hijri: false, text: '' }] }], now);
  assert.deepEqual(l.map((x) => x.id), ['b', 'a']);
});

test('repeats are read in English and Arabic', () => {
  assert.deepEqual(parseRemind('2026-12-01 09:30 every week')!.every, { n: 1, unit: 'week' });
  assert.deepEqual(parseRemind('2026-12-01 every 2 weeks')!.every, { n: 2, unit: 'week' });
  assert.deepEqual(parseRemind('2026-12-01 daily')!.every, { n: 1, unit: 'day' });
  assert.deepEqual(parseRemind('2026-12-01 09:30 كل يوم')!.every, { n: 1, unit: 'day' });
  assert.deepEqual(parseRemind('2026-12-01 09:30 شهريا')!.every, { n: 1, unit: 'month' });
  assert.deepEqual(parseRemind('h1448-06-13 20:00 every month')!.every, { n: 1, unit: 'month' });
  assert.equal(parseRemind('2026-12-01 09:30')!.every, undefined);
});

test('a daily reminder keeps its time of day, a weekly one its weekday, and a long-past start still works', () => {
  const r = parseRemind('2026-01-01 07:15 every day')!;
  const from = at(2026, 11, 24, 8);
  const o = occurrences(r, from, 3);
  assert.deepEqual(o, [at(2026, 11, 25, 7, 15), at(2026, 11, 26, 7, 15), at(2026, 11, 27, 7, 15)]);
  const w = parseRemind('2026-11-02 18:00 every week')!; // a Monday
  assert.deepEqual(occurrences(w, from, 2), [at(2026, 11, 30, 18), at(2026, 12, 7, 18)]);
});

test('monthly reminders clamp to the end of short months; yearly ones come back each year', () => {
  const m = parseRemind('2026-01-31 10:00 every month')!;
  assert.deepEqual(occurrences(m, at(2026, 1, 1), 3), [at(2026, 1, 31, 10), at(2026, 2, 28, 10), at(2026, 3, 31, 10)]);
  const y = parseRemind('2024-02-29 10:00 every year')!;
  assert.equal(occurrences(y, at(2026, 1, 1), 1)[0], at(2026, 2, 28, 10));
});

test('a Hijri monthly reminder lands on the same Hijri day each month (the white days)', () => {
  const r = parseRemind('h1448-06-13 20:00 every month')!;
  const got = occurrences(r, r.at, 4).map((t) => toHijri(t));
  assert.deepEqual(got.map((h) => h.d), [13, 13, 13, 13]);
  assert.deepEqual(got.map((h) => h.m), [6, 7, 8, 9]);
});

test('formatRemind reads back as the same moment and repeat', () => {
  const t = at(2026, 12, 1, 21, 5);
  for (const hijri of [false, true]) {
    for (const every of [undefined, { n: 1, unit: 'week' as const }, { n: 3, unit: 'month' as const }]) {
      const back = parseRemind(formatRemind(t, hijri, every))!;
      assert.equal(back.at, t);
      assert.equal(back.hijri, hijri);
      assert.deepEqual(back.every, every);
    }
  }
});
