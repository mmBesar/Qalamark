<div align="center">

# Qalamark · قلم

**A light, fast Markdown note app with live co-editing and spreadsheet math inside tables.**<br>
Your notes stay plain `.md` files. Self-hosted. Web, Linux and Android.

[![Tables engine](https://github.com/mmBesar/Qalamark/actions/workflows/tables.yml/badge.svg)](https://github.com/mmBesar/Qalamark/actions/workflows/tables.yml)
[![License: AGPL v3+](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-early%20development-orange.svg)](#roadmap)

</div>

> [!WARNING]
> **This is a personal project under heavy development.**
> Right now only the **table formula engine** exists (with a command line tool
> and tests). There is **no app and no server yet**. Expect big changes, and
> don't rely on it for anything important. Releases and stability promises
> will come later.

> [!NOTE]
> **Made with the help of AI.** Qalamark is built by [mmBesar](https://github.com/mmBesar)
> together with [Claude](https://claude.ai) (Anthropic's AI assistant), which
> writes much of the code and the tests. Every change is built and tested
> automatically in GitHub Actions. As with any young project: keep backups
> (easy here, since your notes are just files) and read the code before you
> trust it.

## The idea

- **Plain Markdown files.** Every note is a normal `.md` file. Open it, back it
  up, sync it or edit it with any other tool. No lock-in, no hidden database
  for your text.
- **Table math that stays Markdown.** Type `=SUM(D)` in a cell and get the
  total. The result is written into the table as normal text, and the formula
  hides in an HTML comment, so every other Markdown app still shows the right
  numbers.
- **Share and edit together.** Users, shared notes, and real-time editing by
  several people at once.
- **Light on everything.** A small Rust server (one container), a small app,
  low memory use on the server and on your phone.
- **Right-to-left from day one.** Arabic and mixed-direction text, Arabic
  digits, and Arabic table headers all work.
- **Everywhere.** Web (via container), Linux desktop, Android, from one
  codebase.

## Table math in 30 seconds

Write a normal table and type formulas into it:

```markdown
| Item | Qty | Price | Total |
|------|----:|------:|------:|
| Tea  |   2 |  3.50 |       |
| Cake |   1 |  4.25 |       |
| Milk |   3 |  1.20 |       |
| Sum  | =SUM(B) |   | =SUM(D) |
<!-- qalamark
D = B * C
format D = $0.00
-->
```

Qalamark works it out and tidies the table:

```markdown
| Item | Qty | Price |  Total |
| ---- | --: | ----: | -----: |
| Tea  |   2 |  3.50 |  $7.00 |
| Cake |   1 |  4.25 |  $4.25 |
| Milk |   3 |  1.20 |  $3.60 |
| Sum  |   6 |       | $14.85 |
<!-- qalamark
D = B * C
format D = $0.00
B5 = SUM(B)
D5 = SUM(D)
-->
```

You get spreadsheet-style cells (`B2`, `B2:D5`), whole columns (`SUM(B)`),
columns by header name (`[Price]`), functions such as `IF`, `ROUND`, `AVG` and
`MAX`, number formats, and clear errors instead of crashes.
**Full guide: [docs/TABLE-FORMULAS.md](docs/TABLE-FORMULAS.md)**. More examples
are in [`examples/`](examples), including an Arabic one.

## Try it today

Only the table engine is usable so far. You need Node 22.18 or newer.

```bash
git clone https://github.com/mmBesar/Qalamark.git
cd Qalamark/packages/tables
npm ci
npm test

node src/cli.ts recalc ../../examples/grades.md      # print a worked-out note
node src/cli.ts recalc my-note.md --write             # change your own file
node src/cli.ts eval "ROUND(10/3, 2)"                 # try a formula
```

Every push also runs the type check, the tests, the build and a check of the
example notes on Node 22 and 24 in GitHub Actions (see the badge above).

## Roadmap

- [x] **1. Skeleton:** licence, docs, repo layout
- [x] **2. Table formula engine:** parser, evaluator, command line tool, tests, CI
- [ ] **3. Server:** Rust; users, notes stored as `.md` files, sharing, live sync
- [ ] **4. Editor:** CodeMirror live preview, table editing helpers
- [ ] **5. Collaboration and offline:** real-time co-editing, sync when back online
- [ ] **6. Container:** Docker image with `PUID`/`PGID`/`TZ`, multi-arch builds on GitHub Actions
- [ ] **7. Apps:** installable web app first, then Linux and Android shells (Tauri)

Design decisions and the reasons behind them are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What is in the repository

```
packages/tables/    Table formula engine (TypeScript, no dependencies)
examples/           Example notes, kept up to date by the tests
docs/               Formula guide and architecture notes
.github/workflows/  GitHub Actions: build and test
LICENSE             GNU AGPL v3 or later
```

## Contributing

This is a personal project and it moves fast, so please open an **issue** to
talk before sending a large pull request. Bug reports, especially a Markdown
table that Qalamark gets wrong, are very welcome.

## Licence

Copyright (C) 2026 mmBesar

Qalamark is free software: you can redistribute it and/or modify it under the
terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version. See [LICENSE](LICENSE) for the full text.

AGPL was chosen on purpose: if someone runs a modified Qalamark as a network
service, they must share their changes too.
