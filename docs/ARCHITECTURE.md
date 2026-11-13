# Qalamark architecture

Goals, in priority order: **light** (server and client), **files stay plain
Markdown**, **easy for any user**, **future-proof**, **nice to use**.

## Stack

| Part | Choice | Why |
|---|---|---|
| Server | Rust (axum, SQLite, `yrs`) | Smallest footprint, one static binary, `yrs` is Yjs-compatible |
| App | TypeScript, Svelte 5, Vite | Compiles away its runtime, so it stays small |
| Editor | CodeMirror 6 (live preview) | Never rewrites your text; strong right-to-left support |
| Live editing | Yjs (CRDT) | Real-time co-editing and clean offline merges |
| Desktop / Android | PWA first, then Tauri 2 shells | Same web build everywhere; one toolchain |
| Table math | `@qalamark/tables` (TypeScript, no dependencies) | Runs the same in the app, the CLI and CI |
| Licence | AGPL-3.0-or-later | Network service: keeps derivatives open |

## Storage rules

1. Notes are `.md` files in per-user folders on the server's disk.
2. Nothing the user cares about lives only in the database. The database
   holds users, sessions, shares and sync state, and can be rebuilt from the
   files plus the user list.
3. If a `.md` file is changed outside the app (editor, Syncthing, git), the
   server notices and merges the change into the live document.
4. Heavy features (math rendering, diagrams, syntax highlighting) load only
   when a note uses them.

## Table math (built: `packages/tables`)

How users write formulas is described in [TABLE-FORMULAS.md](TABLE-FORMULAS.md).
How it works inside:

- **Results in the cells, formulas in a comment.** Any Markdown viewer shows
  correct numbers; the `<!-- qalamark ... -->` comment under the table is
  invisible elsewhere.
- **Edits in place.** `recalculate()` changes only the cells whose value
  changed, keeps their width and alignment, and keeps line endings. Running it
  twice changes nothing the second time.
- **No `eval`.** A small hand-written parser builds a syntax tree (Excel
  precedence), and a separate evaluator works it out.
- **Dependencies first.** `Evaluator.prepare()` orders formula cells without
  recursion, so long chains (tested at 20,000 cells, in the worst order) cannot
  overflow the stack, and circular formulas of any length give `#CYCLE!`.
- **Mistakes never crash.** Errors become cell values (`#DIV/0!`, `#NAME?` ...)
  plus a message with a line number; formulas nested too deeply are refused.
- **Fast.** About 90 ms for 5,000 rows on first calculation (measured in the
  build sandbox), well under that when nothing changes.
- **Right-to-left friendly.** Header names in any language, Arabic digits
  (`٣٫٥`) are read, accent marks do not break column alignment.

## Server (built: `server/`)

- **Rust, axum, SQLite (bundled), yrs.** One binary, a few MB of memory when idle.
- **Notes are files.** `data/notes/<user>/<title>.md` is the truth. SQLite holds
  only accounts (argon2id), login tokens (hashed), shares, and the Yjs history
  of each note (needed so offline edits merge instead of duplicating).
- **Live editing = Yjs over WebSocket** (the y-websocket protocol, spoken by
  `yrs` on the server). Each open note is a "room"; every change goes to
  everyone in it, and ~0.6 s later the text is written to the `.md` file
  (atomically). Viewers can read but their edits are ignored.
- **Outside edits.** While a note is open, the file is checked every 3 s; if it
  changed, the difference (a small prefix/suffix diff) is merged into the
  document. When a note is opened, the file is compared with the saved history
  the same way. New `.md` files in a user's folder are adopted as notes.
- **Sharing.** `edit` or `view`, per note and per person. A note you cannot
  access answers "not found" (it does not reveal that it exists).
- **Deleting** moves the file to `data/trash/`.

## Web app (built: `app/`)

- **Svelte 5 + CodeMirror 6 + Yjs.** About 175 KB gzipped for everything, with
  code-block languages loaded only when a note uses them.
- **Live preview** is a set of decorations over the plain Markdown text (marks
  fade away except under the cursor). The text is never rewritten.
- **Tables** are drawn as an editable grid over the Markdown table. Each edit
  goes through `@qalamark/tables` (`editCell`, `tableOp`, `setFormulas`), and
  only the changed characters are applied, so other people's edits in the same
  note are not disturbed.
- **Results stay fresh by themselves.** A moment after a change, when the cursor
  is not in a table, all formulas are recalculated. After a change from someone
  else, only one computer (lowest id) recalculates, so a result is not written twice.
- **Two modes, one code path.** With a server: notes sync live, and each opened
  note is also kept on the device (IndexedDB) so it works offline. Without a
  server (for instance the GitHub Pages preview): notes stay on the device.
- **PWA:** a small service worker keeps the app itself available offline.

## Container

Multi-stage `Dockerfile` (web build, Rust build, `debian:trixie-slim`).
`PUID`/`PGID`/`TZ` are supported; the entrypoint prepares `/data` and drops
root with `setpriv`. CI builds amd64 and arm64 on native runners, smoke-tests
each image (sign up, create a note, check the file owner), and joins them
into one multi-arch tag.

## Steps

1. Skeleton and licence: done
2. Table formula engine, CLI, tests and CI: done
3. Rust server: done
4. Editor: done
5. Collaboration and offline: done
6. Container and CI: done (riscv64 later)
7. Tauri shells (Linux, Android) that sync with the server: next
