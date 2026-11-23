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
- **Tables you can type in** that always stay a grid: formulas, results, add/delete rows and columns with the buttons under the table, undo from inside a table.
- **Obsidian-style extras:** `[[links]]` between notes (with `[[` autocomplete, click to open, create-on-click and a *Linked from* list), callouts (`> [!tip] ...`), `==highlights==`, `#tags`.
- **Users, sharing, real-time co-editing.** Share a note with someone as *can edit* or *can view*; you both see each other's typing and cursors live.
- **Files edited from outside** (Syncthing, a text editor) are merged in and shown live.
- **Works offline.** The app installs as a PWA; a note you opened keeps working without internet and syncs when you are back.
- **Without any server** the same app keeps notes on your device. This is what the GitHub Pages **preview** shows. Real use is your own server.
- **Themes:** all four Catppuccin flavours with the 14 accent colours to choose from, AMOLED, and the **System** theme: Material You on Android (wallpaper colours), your KDE colour scheme or GNOME accent on Linux; plus two of our own (Paper and Nile). **Focus mode** (Alt+Z) shows only the page. **Pinned notes** stay at the top of the side panel, and **Version history** keeps up to 25 snapshots of each note on your device (⋯ menu) so you can look back and restore.
- **Three ways to view a note:** Live preview (like Obsidian), Reading, and Source.
- **Folders and subfolders** with a tree in the sidebar: create, rename, move (menu or drag and drop), copy. A note's file name does not have to be its title: a `title:` property is shown instead.
- **Properties** (YAML front matter): a panel above the note to edit title, tags, aliases or your own properties; the text stays plain YAML at the top of the file.
- **Templates:** ready-made ones (daily note, meeting, expenses with total, meter readings) and your own: any note in a `Templates` folder.
- **Pictures:** paste or drop an image; it is stored next to your notes and shown in the note.
- **Material for MkDocs blocks:** `!!! note`, `??? tip` (collapsible), `=== "Tab"` tabs and code block titles are drawn nicely, and the text stays as it is.
- **Source mode like VS Code:** multiple cursors, move and copy lines, line numbers, folding, comment toggle.
- **Your fonts, your size:** Roboto, Noto Naskh Arabic UI and JetBrains Mono Nerd Font are built in; pick any other or add your own font file. The editor can be centered with a width of your choice.
- **Plain-words table formulas** next to the usual spreadsheet ones, with a point-and-click formula builder.
- **Works on a phone:** the layout adapts, controls stay reachable.
- **Code blocks in many languages:** bash/sh, yml, ini/conf, toml, nginx, Dockerfile, Python, JS and more, also inside tabs and boxes. In Reading mode, tabs are real clickable tabs.
- **Properties follow the mode:** hidden behind the panel in Live and Reading, plain text in Source.
- **Kanban boards from any note:** a note with a `kanban` property gets a *Board* view. Every `##` heading is a column, every task line is a card; drag cards, tick them, add columns. The file stays plain Markdown (use *Show as Kanban board* in the note menu, or the Kanban template). Cards have a checklist of steps (indented `- [ ]` lines), due dates (`📅 2026-12-01`), tags, a progress bar, a tag/text filter, and a *Move to* menu (or Alt+←/→) to send a card to another column. **Pipeline** mode (`kanban: pipeline`) turns each column into a stage: a card's bar has one equal segment per column, filled as it moves along and as the steps of its current stage are ticked. On a phone, *Board | List* is always one tap away (tap *List* again to pick Live, Read or Source). **Cards can be notes:** a card holding a `[[link]]` shows that note's properties (choose them with `card-props: [number, scheduled]` in the board's properties), takes its due date from the note's `due`/`scheduled`/`publish` property, and moving the card writes the column name into the note's `status` property (change the name with `status-prop`). If the note's status is edited elsewhere, the card shows a ↻ chip to follow it. The 📄+ button in the add-card box makes a new note for the card (in `card-folder`). Ready-made templates: *Video production board*, *Video note* and *Videos index*.
- **An Obsidian-style side panel:** Files / Search / Recent views, a file tree with guide lines, *collapse all folders*, and one themed menu everywhere: **right-click** (or **press and hold** on a touchscreen) a note or folder to rename, copy, move, delete or *show it in your file manager* (Linux app). Right-click in the editor for cut/copy/paste and formatting.
- **Checklists:** add `view: checklist` to a note's properties (or use *Show as a checklist*, or the Shopping list template) and it becomes a list with big tap targets, a progress ring, sections, a done group, quick add, swipe to remove with undo, and Uncheck all / Clear done. Still plain `- [ ]` Markdown underneath.
- **Your own tool bar:** pick which tools show (undo, redo, bold … numbered list, indent, divider, code block, link to a note) and in which order, from the slider button at the end of the bar or from Settings. It scrolls sideways on phones. Bullet and task on an empty line start an empty item to fill in.
- **Panels on their own:** the sidebar and the contents panel each have their own button; hiding one never hides the other.
- **Touch friendly:** swipe the side panel in from the screen side (it never needs the very edge, which belongs to the system's back gesture), swipe the other way to bring up the note's contents, swipe up on the bottom bar for the menu and down on any sheet to put it away. Every gesture has a visible button too. Full-screen reading lets the system bars float over the note instead of pushing it around.
- **Type `/`** at the start of a line to insert a heading, list, table, code block, callout, MkDocs box or tabs. Tabbed code shows as real tabs in live view and reading; code blocks are clean (language badge + copy button instead of the ``` lines).
- **Quick switcher** (`Ctrl+P` / `Ctrl+K`): jump to a note, search inside note text, or run a command. Also: an **outline** of the headings, a **today's note** button, and a *recent notes* list.
- **Rename keeps everything in step:** the file name, the `title:` property and every `[[link]]` to the note change together (server).
- **First start (apps):** a server, or this device only, with the notes folder shown. On Android, allow "All files access" once so the notes can live in `Documents/Qalamark` (the app asks; notes made earlier are carried over).
- **Phone layout:** the text gets the whole screen. The title bar and a floating bar (menu, search, new note, contents) hide while you scroll down, return when you scroll up or tap, and on Android the system bars hide too. While typing, the editing tools sit above the keyboard.
- **Colourful text:** each heading level, bold and italic have their own colour in every theme.
- **Notes folder in the apps:** the Linux and Android apps keep your notes as real `.md` files in `Documents/Qalamark` (change it in Settings). Edits made outside show up when you return to the app.
- **Tabs:** open several notes at once; close, close others, drag to reorder, middle-click to close, `Alt+W` closes, `Ctrl+Tab` switches.
- **Contents panel** (any view): the headings of the note as a tree; click to jump, fold or unfold sections, and move, promote or demote a whole section from its menu.
- **Links to sections:** `[[Note#Heading]]` and `[[#Heading]]`, with a list of notes (then headings) as you type `[[`; Kanban cards can hold links too.
- **Lists of notes from their properties:** put a `base` block in a note (`/` → *List of notes*), e.g. `folder: Projects`, `where: status = open`, `show: status, due, done`, `sort: due`. It is drawn as a table: the first column links to the note, and you edit a value right there to change that note's property. Click a header to sort, type in the filter box, and statuses and tags are drawn as coloured badges.
- **Works offline in full:** create, rename, move and edit notes without a connection; changes queue ("waiting to sync") and are sent when the server is back. Notes you have not opened are fetched in the background for offline use.
- **Servers on your own network (apps):** two switches on the sign-in screen, never both: *Allow a self-signed certificate* (the first certificate is remembered and you are warned if it changes) and *Allow plain http* (unencrypted, for a trusted home network). All connections go through a small bridge inside the app, which also tells you why a server cannot be reached.
- **Touch:** press and hold in the editor for a menu with cut, copy, paste, select all and formatting.
- **Checklists with structure:** `view: checklist` turns a note into a task list. Headings nest (a higher heading contains the lower ones), tasks can have subtasks, and every level folds. A parent is done when all its subtasks are. Tap a task to tick it (or set `tap: box` to tick only on the box, so a tap edits); press and hold, or the pencil, to edit. On a phone, swipe a task toward the end to tick, toward the start to delete (with undo) in the middle of the screen; the edges stay with the side panels.
- **Properties:** pick the icon of any property, choose `view` (note, checklist, board, pipeline) from a list, and add your own names from a themed suggestion list that also offers the names used in your other notes.
- **Task gestures you choose:** Settings → Tasks sets what swiping right, swiping left, tapping and pressing and holding do. Swipes go by the finger's direction on screen, the same in English and Arabic.
- **Android widget and background running:** a home-screen checklist widget (pick the list with the arrows, tick items without opening the app) and an optional quiet notification that keeps the app alive so notes are already up to date. Nothing polls on a timer: it wakes only for real changes, like Syncthing. Native code lives in `app/android-extras` and is added to the Android project by CI.
- **Profile picture:** set it in Settings; it is stored on the server and shown with a coloured-letters fallback.
- **Motion rule:** every menu, sheet and window enters from somewhere and leaves toward it. On Android the bottom menu and both side panels follow the finger.
- **English and Arabic** interface, right-to-left; Arabic lines are always aligned to the right.

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
- [x] **7. Apps (first version):** Linux (AppImage, deb, rpm) and Android (APK) shells with Tauri 2, built by the *Apps* workflow; they connect to your server or keep notes on the device. Still to come: Android dynamic colour (Material You), system colours on Linux
- [ ] **Later:** search inside notes, note embeds `![[note]]`, math and diagrams, renaming a note updates links, offline note creation, riscv64 image, version history

Design decisions and the reasons behind them are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What is in the repository

```
server/             The server (Rust): accounts, notes, sharing, live sync
app/                The web app (Svelte + CodeMirror); app/src-tauri is the Linux/Android shell
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

## Where are my notes?

- **Server:** in the `/data` volume you mount (see the run command above): `data/notes/<user>/...` holds the `.md` files, `data/trash/` deleted ones, `data/qalamark.db` the accounts and live-editing state.
- **Linux and Android apps (without a server):** in `Documents/Qalamark` by default, or any folder you choose in *Settings → Notes folder*. On Android the default is the app's own documents folder, because Android only lets apps write to the shared Documents folder with special permission; pick another path in Settings if you grant that.
- **Browser without a server:** inside the browser's own storage (the preview).

## Linux and Android apps

Run the **Apps (Linux + Android)** workflow in GitHub Actions (or push a `v*` tag): it builds
AppImage, deb, rpm and an APK. Optional repository secrets for a release-signed APK:
`ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
Plain `http://` servers on your home network work on Android. On first start, type your server
address on the sign-in screen, or choose to keep notes on the device only.


## Is my text safe?

Notes are plain files, and the editing code is tested hard for exactly that reason (`e2e/`, run in CI):

- **Property tests** (`editing.test.ts`): thousands of random documents (Arabic with diacritics, emoji, tabs, lists, blank lines) and random selections; every formatting command is checked to be undone by repeating it, to touch only what it was asked to, and to keep the selection valid.
- **Browser tests** (`browser.test.mjs`, “trust” rounds): what you type is what is on disk, byte for byte; switching Live, Reading and Source never changes the text; undo and redo walk back and forward exactly; select all takes the whole note; two people typing into the same note at once end with identical text and lose nothing; the phone tool bar and swipe gestures work by touch.
- **Real WebKitGTK harness** (`e2e/webkit/`): for Linux-only text rendering bugs such as shifted Arabic diacritics.
