// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatNumber, parseFormat, parseNumber } from '../src/index.ts';

test('parseNumber reads everyday number styles', () => {
  assert.equal(parseNumber('12'), 12);
  assert.equal(parseNumber('  3.5 '), 3.5);
  assert.equal(parseNumber('-4'), -4);
  assert.equal(parseNumber('1,234.5'), 1234.5);
  assert.equal(parseNumber('$3.50'), 3.5);
  assert.equal(parseNumber('-$3.50'), -3.5);
  assert.equal(parseNumber('3.50 €'), 3.5);
  assert.equal(parseNumber('(5)'), -5);
  assert.equal(parseNumber('45%'), 0.45);
  assert.equal(parseNumber('**11.25**'), 11.25);
  assert.equal(parseNumber('_7_'), 7);
});

test('parseNumber understands Arabic digits and separators', () => {
  assert.equal(parseNumber('٤٢'), 42);
  assert.equal(parseNumber('٣٫٥'), 3.5);
  assert.equal(parseNumber('۱۲'), 12);
  assert.equal(parseNumber('١٬٢٣٤٫٥'), 1234.5);
});

test('parseNumber says no to things that are not numbers', () => {
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('   '), null);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber('1.2.3'), null);
  assert.equal(parseNumber('2026-11-12'), null);
  assert.equal(parseNumber('12 apples'), null);
  assert.equal(parseNumber('#DIV/0!'), null);
});

test('default formatting hides floating point noise', () => {
  assert.equal(formatNumber(0.1 + 0.2), '0.3');
  assert.equal(formatNumber(7), '7');
  assert.equal(formatNumber(-0), '0');
  assert.equal(formatNumber(1 / 3), '0.333333333333');
});

test('format patterns', () => {
  assert.equal(formatNumber(7, '0.00'), '7.00');
  assert.equal(formatNumber(1234567.891, '#,##0.00'), '1,234,567.89');
  assert.equal(formatNumber(-3.5, '$0.00'), '-$3.50');
  assert.equal(formatNumber(0.456, '0%'), '46%');
  assert.equal(formatNumber(0.456, '0.0%'), '45.6%');
  assert.equal(formatNumber(2.5, '0'), '3');
  assert.equal(formatNumber(-2.5, '0'), '-3');
  assert.equal(formatNumber(3.1, '#.##'), '3.1');
  assert.equal(formatNumber(0.5, '#.##'), '.5');
  assert.equal(formatNumber(5, '0 kg'), '5 kg');
  assert.equal(formatNumber(5, '€0.00'), '€5.00');
  assert.equal(formatNumber(7, '000'), '007');
  assert.equal(formatNumber(2.345, '0.00'), '2.35');
  assert.equal(formatNumber(-0.001, '0.00'), '0.00');
});

test('bad patterns are rejected', () => {
  assert.equal(parseFormat('abc'), null);
  assert.equal(parseFormat(''), null);
  assert.notEqual(parseFormat('0.00'), null);
});
