# @qalamark/tables

The table formula engine behind Qalamark: spreadsheet-style formulas inside
plain Markdown tables. No dependencies, no `eval`, about 15 KB gzipped.

See [docs/TABLE-FORMULAS.md](../../docs/TABLE-FORMULAS.md) for how formulas
are written. This page is for people building and testing the package.

## Try it

You need Node 22.18 or newer (the CI uses 24).

```bash
cd packages/tables
npm ci

npm test                  # run the tests
npm run typecheck         # check the types
npm run build             # plain JavaScript into dist/

# try it on a real note
node src/cli.ts recalc ../../examples/shopping.md          # print the result
node src/cli.ts recalc my-note.md --write                  # change the file
node src/cli.ts format my-note.md --write                  # tidy the tables
node src/cli.ts eval "ROUND(10/3, 2)"                      # try a formula
```

`recalc --check` and `format --check` change nothing and exit with 1 when the
file is not up to date, which is handy in CI.

## Use it from code

```ts
import { recalculate, formatTables, evaluateFormula } from '@qalamark/tables';

const { markdown, changed, diagnostics } = recalculate(noteText);
```

- `recalculate(md)` works out every table formula and returns the new text.
  Only the cells that changed are touched.
- `formatTables(md)` lines up the pipes of every table.
- `evaluateFormula(src, cells?)` evaluates a single formula.

## Layout

| File | What it does |
|---|---|
| `src/parser.ts` | formula text to syntax tree |
| `src/evaluator.ts` | works out cell values, finds circular formulas |
| `src/program.ts` | reads the `<!-- qalamark -->` comment |
| `src/markdown.ts` | finds tables and edits single cells in place |
| `src/numbers.ts` | reading and writing numbers and formats |
| `src/engine.ts` | `recalculate()` ties it all together |
| `src/cli.ts` | the command line tool |
