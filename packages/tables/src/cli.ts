// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Small command line tool to try the engine on real files:
//
//   node src/cli.ts recalc note.md           print the note with formulas worked out
//   node src/cli.ts recalc note.md --write   change the file in place
//   node src/cli.ts recalc note.md --check   exit 1 if anything would change
//   node src/cli.ts format note.md           tidy the tables (aligned pipes)
//   node src/cli.ts eval "SUM(1,2,3)*2"      try a formula

import { readFileSync, writeFileSync } from 'node:fs';
import { argv, exit, stderr, stdin, stdout } from 'node:process';
import { evaluateFormula, formatTables, recalculate, toText } from './index.ts';

const USAGE = `Qalamark table tools

  recalc <file|-> [--write] [--check] [--no-lift]
  format <file|-> [--write] [--check]
  eval "<formula>"
`;

// If the next program in a pipe (for example "head") closes early, just stop.
stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') exit(0);
  throw e;
});

/** Read all of standard input (works for pipes, files and terminals). */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function read(file: string): Promise<string> {
  if (file === '-') return readStdin();
  try {
    return readFileSync(file, 'utf8');
  } catch (e) {
    stderr.write(`Cannot read "${file}": ${(e as NodeJS.ErrnoException).code ?? 'unknown error'}\n`);
    exit(2);
  }
}

async function main(): Promise<void> {
  const [cmd, target, ...flags] = argv.slice(2);
  const has = (f: string) => flags.includes(f);

  if (cmd === 'eval' && target !== undefined) {
    stdout.write(`${toText(evaluateFormula(target))}\n`);
    return;
  }

  if ((cmd !== 'recalc' && cmd !== 'format') || target === undefined) {
    stderr.write(USAGE);
    exit(2);
  }

  const input = await read(target);
  let output: string;
  let changed: boolean;
  let problems = 0;

  if (cmd === 'recalc') {
    const r = recalculate(input, { lift: !has('--no-lift') });
    output = r.markdown;
    changed = r.changed;
    for (const d of r.diagnostics) {
      stderr.write(`${target}:${d.line}: ${d.message}\n`);
      problems++;
    }
  } else {
    const r = formatTables(input);
    output = r.markdown;
    changed = r.changed;
  }

  if (has('--check')) {
    if (changed) stderr.write(`${target}: would change (run without --check to see how)\n`);
    exit(changed || problems > 0 ? 1 : 0);
  }
  if (has('--write') && target !== '-') {
    if (changed) writeFileSync(target, output);
    stderr.write(changed ? `${target}: updated\n` : `${target}: already up to date\n`);
    return;
  }
  stdout.write(output);
}

main().catch((e: unknown) => {
  stderr.write(`Unexpected error: ${e instanceof Error ? e.message : String(e)}\n`);
  exit(1);
});
