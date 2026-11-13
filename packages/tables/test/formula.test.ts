// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CellError, ERR, evaluateFormula, FormulaSyntaxError, parseFormula, toText } from '../src/index.ts';

const calc = (src: string): string => toText(evaluateFormula(src));

const shop = [
  ['Item', 'Qty', 'Price'],
  ['Tea', '2', '3.5'],
  ['Cake', '1', '4.25'],
];

test('arithmetic and precedence follow spreadsheets', () => {
  assert.equal(calc('1+2*3'), '7');
  assert.equal(calc('(1+2)*3'), '9');
  assert.equal(calc('10-4-3'), '3');
  assert.equal(calc('8/2/2'), '2');
  assert.equal(calc('2^3^2'), '64'); // left to right, like Excel
  assert.equal(calc('-2^2'), '4'); // minus binds first, like Excel
  assert.equal(calc('2*-3'), '-6');
  assert.equal(calc('=1+1'), '2'); // leading = is optional
  assert.equal(calc('0.1+0.2'), '0.3');
});

test('percent', () => {
  assert.equal(calc('10%'), '0.1');
  assert.equal(calc('50%*200'), '100');
  assert.equal(calc('200*10%'), '20');
});

test('text, comparison and logic', () => {
  assert.equal(calc('"a"&"b"'), 'ab');
  assert.equal(calc('"x"&1+1'), 'x2');
  assert.equal(calc('1=1'), 'TRUE');
  assert.equal(calc('"A"="a"'), 'TRUE');
  assert.equal(calc('2<>3'), 'TRUE');
  assert.equal(calc('3>=4'), 'FALSE');
  assert.equal(calc('IF(1>2,"big","small")'), 'small');
  assert.equal(calc('IF(TRUE,1,2)'), '1');
  assert.equal(calc('IF(FALSE,1)'), '');
  assert.equal(calc('AND(1,2>1)'), 'TRUE');
  assert.equal(calc('OR(0,0)'), 'FALSE');
  assert.equal(calc('NOT(0)'), 'TRUE');
  assert.equal(calc('"say ""hi"""'), 'say "hi"');
});

test('functions', () => {
  assert.equal(calc('SUM(1,2,3)'), '6');
  assert.equal(calc('AVG(2,4)'), '3');
  assert.equal(calc('AVERAGE(1,2)'), '1.5');
  assert.equal(calc('MIN(4,2,9)'), '2');
  assert.equal(calc('MAX(4,2,9)'), '9');
  assert.equal(calc('COUNT(1,2,3)'), '3');
  assert.equal(calc('PRODUCT(2,3,4)'), '24');
  assert.equal(calc('MEDIAN(5,1,3)'), '3');
  assert.equal(calc('MEDIAN(1,2,3,4)'), '2.5');
  assert.equal(calc('ROUND(2.345,2)'), '2.35');
  assert.equal(calc('ROUND(-2.5)'), '-3');
  assert.equal(calc('ROUND(1234,-2)'), '1200');
  assert.equal(calc('FLOOR(2.9)'), '2');
  assert.equal(calc('CEIL(2.1)'), '3');
  assert.equal(calc('ABS(-4)'), '4');
  assert.equal(calc('SQRT(16)'), '4');
  assert.equal(calc('MOD(-3,2)'), '1');
  assert.equal(calc('MOD(3,-2)'), '-1');
  assert.equal(calc('sum(1,2)'), '3'); // names are not case sensitive
});

test('errors are values, not crashes', () => {
  assert.equal(calc('1/0'), ERR.DIV0);
  assert.equal(calc('SQRT(-1)'), ERR.VALUE);
  assert.equal(calc('"a"+1'), ERR.VALUE);
  assert.equal(calc('MOD(1,0)'), ERR.DIV0);
  assert.equal(calc('AVG("x")'), ERR.VALUE);
  assert.equal(calc('1+'), ERR.SYNTAX);
  assert.equal(calc('FOO(1)'), ERR.NAME);
  assert.equal(calc('SUM(1,'), ERR.SYNTAX);
  assert.equal(calc('(1+2'), ERR.SYNTAX);
  assert.equal(calc('1 2'), ERR.SYNTAX);
  assert.equal(calc('ROUND()'), ERR.SYNTAX);
  assert.equal(calc('IF(1)'), ERR.SYNTAX);
  assert.equal(calc('"open'), ERR.SYNTAX);
  assert.equal(calc('1 # 2'), ERR.SYNTAX);
  assert.ok(evaluateFormula('1/0') instanceof CellError);
});

test('syntax errors explain themselves', () => {
  assert.throws(() => parseFormula('1+'), FormulaSyntaxError);
  assert.throws(() => parseFormula('ROUND(1,2,3)'), /ROUND needs 1 to 2 argument/);
  assert.throws(() => parseFormula('B:C'), /ranges with rows/);
});

test('cells, ranges and columns', () => {
  const at = (src: string, row?: number) => toText(evaluateFormula(src, shop, row));
  assert.equal(at('B2'), '2');
  assert.equal(at('B2+B3'), '3');
  assert.equal(at('SUM(B2:B3)'), '3');
  assert.equal(at('SUM(B2:C3)'), '10.75');
  assert.equal(at('SUM(C3:B2)'), '10.75'); // corners in any order
  assert.equal(at('SUM($B$2:$B$3)'), '3');
  assert.equal(at('B2*C2'), '7'); // 2 x 3.5
  assert.equal(at('A2'), 'Tea');
  assert.equal(at('A2&"!"'), 'Tea!');
  assert.equal(at('B9'), ERR.REF);
  assert.equal(at('SUM(B2:B9)'), ERR.REF);
});

test('a bare column means "this row", or "every row above" inside a function', () => {
  const at = (src: string, row?: number) => toText(evaluateFormula(src, shop, row));
  assert.equal(at('B*C', 2), '7'); // 2 x 3.5
  assert.equal(at('B*C', 3), '4.25');
  assert.equal(at('SUM(B)'), '3'); // new row under the table: rows 2..3
  assert.equal(at('SUM(B)', 3), '2'); // inside row 3: only row 2 is above
  assert.equal(at('SUM(B)', 2), '0'); // nothing above the first row
  assert.equal(at('COUNT(B)'), '2');
  assert.equal(at('AVG(C)'), '3.875');
  assert.equal(at('MAX(C)'), '4.25');
});

test('columns by header name', () => {
  const at = (src: string, row?: number) => toText(evaluateFormula(src, shop, row));
  assert.equal(at('[Price]*[Qty]', 2), '7');
  assert.equal(at('[price] * [ QTY ]', 3), '4.25');
  assert.equal(at('SUM([Price])'), '7.75');
  assert.equal(at('[Nope]', 2), ERR.NAME);
});

test('text in ranges is skipped, text in plain arithmetic is an error', () => {
  const t = [['A', 'B'], ['x', '1'], ['y', 'oops'], ['z', '3']];
  assert.equal(toText(evaluateFormula('SUM(B)', t)), '4');
  assert.equal(toText(evaluateFormula('COUNT(B)', t)), '2');
  assert.equal(toText(evaluateFormula('B3+1', t)), ERR.VALUE);
});

test('Arabic digits work inside formulas', () => {
  assert.equal(calc('٢*٣'), '6');
  assert.equal(calc('١٫٥+١'), '2.5');
});
