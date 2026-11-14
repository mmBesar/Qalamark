# Table formulas

Qalamark can calculate inside ordinary Markdown tables, like a small
spreadsheet. The note stays a plain `.md` file that every other Markdown app
can open, because:

- the **results** are written into the cells as normal text, and
- the **formulas** live in an invisible HTML comment under the table.

```markdown
| Item | Qty | Price | Total |
|------|----:|------:|------:|
| Tea  |   2 |  3.50 |  7.00 |
| Cake |   1 |  4.25 |  4.25 |
<!-- qalamark
D = B * C
format D = 0.00
-->
```

Other apps show the table with the right numbers and hide the comment.

## Three ways to add a formula

1. **Type `=` in a cell.** `=SUM(D)` in a Total row gives the sum of the column.
   Qalamark moves the formula into the comment and shows the result.
2. **Type `==` in a cell** to use the formula for the *whole column*. `==B*C`
   in the first row of the Total column fills every row.
3. **Write it in the comment** yourself (the table above does this).

## Referring to cells and columns

Rows are numbered like a spreadsheet: **the header row is row 1**, the first
data row is row 2. Columns are lettered A, B, C ... in the order they appear.

| Write | Meaning |
|---|---|
| `B2` | the cell in column B, row 2 |
| `B2:D5` | a block of cells (for functions like `SUM`) |
| `B` | column B, **same row** as the formula |
| `SUM(B)` | column B, **every row above** the formula |
| `[Price]` | the column whose header is "Price", same row |
| `SUM([Price])` | the "Price" column, every row above |
| `$B$2` | same as `B2` (the `$` signs are ignored) |

Header names are matched ignoring capital letters, bold marks and extra
spaces, and work in any language, including Arabic.

`SUM(B)` is the easiest way to total a column: it keeps working when you add
rows in the middle, with no ranges to fix.

## Operators

`+  -  *  /  ^` (power), `%` (percent: `50%` is `0.5`), `&` (join text),
comparisons `=  <>  <  >  <=  >=`, and parentheses.

Precedence follows Excel and Google Sheets, so results match what you expect
from a spreadsheet. For example `-2^2` is `4` and `2^3^2` is `64`.

## Functions

Names are not case sensitive.

| Function | Result |
|---|---|
| `SUM(...)` `AVG(...)` / `AVERAGE(...)` | total, average |
| `MIN(...)` `MAX(...)` `MEDIAN(...)` | smallest, largest, middle |
| `COUNT(...)` | how many numbers |
| `PRODUCT(...)` | everything multiplied |
| `ROUND(x, digits)` | rounds half away from zero; `digits` can be negative |
| `FLOOR(x)` `INT(x)` `CEIL(x)` | round down, round up |
| `ABS(x)` `SQRT(x)` `MOD(x, y)` | absolute value, square root, remainder |
| `IF(test, a, b)` | `a` if the test is true, otherwise `b` (empty if left out) |
| `AND(...)` `OR(...)` `NOT(x)` | logic |
| `ROW()` | the formula's row number |

Text and empty cells inside a column or range are skipped by `SUM`, `AVG` and
friends.

## What counts as a number

`12`, `3.5`, `1,234.50`, `$3.50`, `-$3`, `3.50 €`, `(5)` for -5, `45%` for
0.45, `**11.25**` (bold) and Arabic digits such as `٣٫٥`.

Results are written with ordinary digits (0-9).

## Rows that stay blank

If a formula reads cells and **all of them are empty**, its result stays empty.
A half-filled table does not fill up with zeros.

## Total rows

A row that has formulas of its own (like a Total row) is skipped by column
formulas, so `D = B * C` does not run on the Sum row.

## Number formats

Add a `format` line to the comment to control how results look:

| Line | Example result |
|---|---|
| `format D = 0.00` | `7.00` |
| `format D = #,##0.00` | `1,234,567.89` |
| `format D = $0.00` | `$7.00` |
| `format D = 0.0%` | `45.6%` |
| `format D = 0 kg` | `5 kg` |
| `format D5 = 0.0` | one cell only (beats a column format) |

`0` is a digit that is always shown, `#` is a digit shown only when needed,
`,` turns on thousands separators, and a `%` after the digits multiplies by 100.
Formats only apply to cells that get their value from a formula.

Without a format, results are written plainly (`0.1 + 0.2` gives `0.3`).

## The formula comment

```markdown
<!-- qalamark
// lines starting with // or # are notes to yourself
D = B * C                     every row of column D
D5 = SUM(D)                   one cell
[Total] = [Qty] * [Price]     a column named by its header
format D = 0.00
E = B + 1; F = C + 1          several on one line, separated by ;
-->
```

- It must be **directly under the table** (no blank line between).
- A later formula for the same cell or column replaces an earlier one.
- A one-line version works too: `<!-- qalamark: D = B * C -->`.
- To name a column by its header, use brackets: `[Total]`. Without brackets,
  letters mean column letters.

## Errors

Mistakes show up in the cell, never as a crash:

| Shows | Meaning |
|---|---|
| `#DIV/0!` | divided by zero |
| `#VALUE!` | text where a number is needed |
| `#REF!` | a cell or range outside the table |
| `#NAME?` | an unknown function or column name |
| `#CYCLE!` | formulas that depend on each other in a circle |
| `#ERR!` | the formula could not be read |

Tools also get a message with the line number, for example
`"D = B * :": Unexpected ":"`.

## Not supported yet

- References to other tables or other notes
- Date and text functions
- Dragging a formula to fill cells (use a column formula instead)
- Output with Arabic-Indic digits

## Plain-words formulas (optional)

Normal spreadsheet formulas (`D = B * C`, `D5 = SUM(D)`) always work. These words are an extra, for people who prefer to read a sentence. They use column letters, so nothing depends on header names (header names in `[brackets]` still work if you like them).

| Write | Meaning |
|---|---|
| `D = change in C` | this row minus the row above (0 on the first row) |
| `D = previous C` | the value one row above |
| `D = days since previous B` | days between the dates in the row above and this row (`hours`, `minutes` too) |
| `D = days between B and C` | days between two date columns (dates like `2022-04-01` or `2022-04-01 14:30`) |
| `D in last row = total of D` | the bottom row adds the column up; stays at the bottom when rows are added |
| `average of D`, `highest D`, `lowest D`, `count of D` | other column summaries |

Press **ƒ** under a table to build these by picking from lists.
