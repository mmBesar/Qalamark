// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Public API of @qalamark/tables.

export { recalculate, evaluateFormula } from './engine.ts';
export type { Diagnostic, RecalcOptions, RecalcResult } from './engine.ts';

export { formatTables, findTables } from './markdown.ts';
export type { FormatResult, TableInfo } from './markdown.ts';

export { parseNumber, formatNumber, parseFormat } from './numbers.ts';
export type { NumberFormat } from './numbers.ts';

export { parseFormula, FormulaSyntaxError, FUNCTION_NAMES } from './parser.ts';
export type { Node } from './parser.ts';

export { CellError, ERR, toText } from './value.ts';
export type { Scalar } from './value.ts';

export { describeTables, editCell, setFormulas, tableOp, escapeCell } from './edit.ts';
export type { TableView, TableOp, CellFormula } from './edit.ts';
