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

## Steps

1. Skeleton and licence: done
2. Table formula engine, CLI, tests and CI: done
3. Rust server
4. Editor
5. Collaboration and offline
6. Container and CI
7. PWA, then Tauri shells (Linux, Android)
