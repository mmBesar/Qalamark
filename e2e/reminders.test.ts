import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRemind, remindersOf, fromHijri, toHijri, upcoming } from '../app/src/lib/reminders.ts';

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
