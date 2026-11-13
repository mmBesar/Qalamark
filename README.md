<div align="center">

# Qalamark · قلم

**A light, fast Markdown note app with live co-editing and spreadsheet math inside tables.**<br>
Your notes stay plain `.md` files. Self-hosted. Web, Linux and Android.

[![Tables engine](https://github.com/mmBesar/Qalamark/actions/workflows/tables.yml/badge.svg)](https://github.com/mmBesar/Qalamark/actions/workflows/tables.yml)
[![Server](https://github.com/mmBesar/Qalamark/actions/workflows/server.yml/badge.svg)](https://github.com/mmBesar/Qalamark/actions/workflows/server.yml)
[![App](https://github.com/mmBesar/Qalamark/actions/workflows/app.yml/badge.svg)](https://github.com/mmBesar/Qalamark/actions/workflows/app.yml)
[![Container](https://github.com/mmBesar/Qalamark/actions/workflows/docker.yml/badge.svg)](https://github.com/mmBesar/Qalamark/actions/workflows/docker.yml)
[![License: AGPL v3+](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-early%20development-orange.svg)](#roadmap)

</div>

> [!WARNING]
> **This is a personal project under heavy development.**
> The server, the web app and the container work and are tested, but nothing
> here is stable yet: expect big changes and rough edges, and keep backups
> (easy, your notes are just `.md` files). The Linux and Android apps are not
> built yet.

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

## Run your own server

One container: the server, the web app and your notes.

```bash
docker run -d --name qalamark -p 8080:8080 \
  -e PUID=1000 -e PGID=1000 -e TZ=Africa/Cairo \
  -v ./qalamark-data:/data \
  ghcr.io/mmbesar/qalamark:latest
```

Open `http://your-server:8080`. The **first account you create is the admin**;
the admin adds everyone else (Settings, "Add a user"). Your notes appear as
plain files in `qalamark-data/notes/<username>/`, and any `.md` file you drop
there becomes a note. More in **[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)**
(compose file, reverse proxy, backups).

> Images are published when a release tag is made. Until the first release you
> can build it yourself: `docker build -t qalamark .`

## What works today

- **Notes as `.md` files**, per user, with rename, delete (to a trash folder), import and export.
- **Live preview editor** (CodeMirror 6): headings, bold, italic, strikethrough, code, fenced code with colours, quotes, lists, task checkboxes, links, images, rules. The text is never rewritten, only drawn nicely.
- **Tables you can type in**, with formulas, results and a formula box (see below).
- **Users, sharing, real-time co-editing.** Share a note with someone as *can edit* or *can view*; you both see each other's typing and cursors live.
- **Files edited from outside** (Syncthing, a text editor) are merged in and shown live.
- **Works offline.** The app installs as a PWA; a note you opened keeps working without internet and syncs when you are back.
- **Without any server** the same app keeps notes on your device. This is what the GitHub Pages **preview** shows. Real use is your own server.
- **English and Arabic** interface, right-to-left, light and dark themes.

## Try the pieces from source

```bash
# 1) the server (Rust) and the web app (Node 22+)
(cd app && npm ci && npm run build)
(cd server && cargo run --release)          # then open http://localhost:8080

# 2) all the tests
(cd packages/tables && npm ci && npm test)  # table engine
(cd e2e && npm ci && npm test)              # real server + real co-editing clients
(cd e2e && npx playwright install chromium && npm run test:browser)  # real browser

# 3) the table engine alone, from the command line
node packages/tables/src/cli.ts recalc examples/grades.md
```

Everything also runs in GitHub Actions on every push (see the badges).

## Roadmap

- [x] **1. Skeleton:** licence, docs, repo layout
- [x] **2. Table formula engine:** parser, evaluator, command line tool, tests, CI
- [x] **3. Server:** Rust; users, notes as `.md` files, sharing, live sync
- [x] **4. Editor:** CodeMirror live preview, editable tables with formulas
- [x] **5. Collaboration and offline:** real-time co-editing, works offline (PWA)
- [x] **6. Container:** Docker image with `PUID`/`PGID`/`TZ`, amd64 + arm64 on native runners
- [ ] **7. Apps:** Linux desktop and Android shells (Tauri) that sync with your server
- [ ] **Later:** folders, search inside notes, offline note creation, riscv64 image, version history

Design decisions and the reasons behind them are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What is in the repository

```
server/             The server (Rust): accounts, notes, sharing, live sync
app/                The web app (Svelte + CodeMirror), base of the desktop/Android apps
packages/tables/    Table formula engine (TypeScript, no dependencies)
e2e/                End-to-end tests: real server, real clients, real browser
docker/ Dockerfile  The container image
examples/           Example notes, kept up to date by the tests
docs/               Formula guide, architecture, self-hosting
.github/workflows/  GitHub Actions: build, test, publish
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
