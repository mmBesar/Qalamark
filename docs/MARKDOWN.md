# The Qalamark Markdown profile

Qalamark notes are plain `.md` files. Writing should be easy in the app (type `[[` for a note list, paste a picture,
press `/` for blocks) while the file on disk stays **standard Markdown that other editors understand**. The two are
separate layers: the app does the convenience, the file keeps the standard.

Compatibility targets, in this order: **GitHub** (what it renders in a repository) and **VSCodium / VS Code** (the
built-in Markdown preview). Hugo, Zola and others are welcome but are not goals.

## The three tiers

| Tier | What | Rule |
|---|---|---|
| **Core** | [CommonMark](https://spec.commonmark.org) + [GFM](https://github.github.com/gfm/): headings, emphasis, `~~strikethrough~~`, lists, task lists `- [ ]`, quotes, fenced code, tables, links, images, rules, autolinks, raw HTML | What the app writes by default. Works everywhere. |
| **Extended** | Features CommonMark/GFM lack, taken from an existing, widely used **FOSS** convention (GitHub's own additions first, then the Material for MkDocs / PyMdown family) | Each one is listed below with its source and how it looks in other apps. It must stay *readable as plain text* elsewhere. |
| **Ours** | Things nobody defines (table formulas, property-driven lists) | Hidden in an HTML comment, or in a fenced block that other apps show as code. Never a new inline syntax. |

Obsidian is a source of *ideas* only. Its syntax is never written, though old notes using it are still read.

## Constructs

### Core (written by the app)

`# Heading`, `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, fenced blocks, `- item`, `1. item`, `- [ ] task`,
`> quote`, tables, `---`, `[text](url)`, `![alt](path)`.

### Extended (written by the app)

| Construct | Looks like | Source | In other apps |
|---|---|---|---|
| **Note boxes** | `> [!NOTE]` then `> text` (also `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`) | GitHub alerts | GitHub: a coloured box. VSCodium: a plain quote starting with `[!NOTE]`. |
| **Footnotes** | `text[^1]` and `[^1]: note` | GitHub | GitHub: footnotes. VSCodium: plain text (an extension adds them). |
| **Properties** | a `---` YAML block at the top | Jekyll/Hugo convention | GitHub shows it as a table. VSCodium shows the text. |
| **Tabs** | `=== "Title"` + 4-space indented body | Material / PyMdown | Reads as a titled indented block. |
| **Collapsible** | `??? note "Title"` + indented body | Material / PyMdown | Reads as a titled indented block. |
| **Code title** | `` ```py title="a.py" `` | Material / PyMdown | The language still works; the title is ignored. |
| **Highlight** | `==text==` | PyMdown `mark` | Shows the `==` marks. |
| **Picture size** | `<img src="…" width="300">`, only on a picture you resized | HTML in Markdown (CommonMark) | Shown at that width. |

### Ours

| Construct | Looks like | In other apps |
|---|---|---|
| **Table formulas** | `<!-- qalamark … -->` under a table; results are stored in the cells | Invisible; the table shows its results. |
| **Property-driven lists** | a fenced block tagged `base` | Shown as a small code block. |
| **Reminders** | a `remind:` property | Shown as a property. |
| **Boards** | `##` headings (columns) and task lines (cards) | Shown as a normal outline. |

### Read, but no longer written

- `!!! note "Title"` boxes (Material). Replaced by `> [!NOTE]` boxes. Other apps show the body as an indented code block, which is why we stopped writing it.
- `[[Wiki links]]` and `![[embeds]]` from other tools. The app understands them in imported notes.

## Links and pictures (agreed design)

- Links to other notes are **standard relative links**: `[Title](../Folder/other-note.md)`. The app's `[[` picker inserts them;
  renaming or moving a note updates the links that point to it.
- Pictures live in one `_images/` folder at the top of the notes folder, named by a fingerprint of the picture
  (`img-3fa9c2d1.png`), and are linked relative to the note: `![](../_images/img-3fa9c2d1.png)`.
  Because everything is relative, moving the whole folder keeps every link working.
- Large photos are shrunk to 2000 px on the long side (a setting keeps originals); screenshots, logos, GIF and SVG are kept as they are.

Some of this is still being built; this page says what the app *will* write once it is, and the test in
`e2e/profile.test.ts` keeps what it writes today on the list.

## Adding something new

1. Is it in CommonMark or GFM? Use that.
2. Does GitHub render it? Use GitHub's form.
3. Does Material for MkDocs / PyMdown (MIT) have it? Use that form.
4. Otherwise hide it in an HTML comment. Add a row to the tables above and a case to the test.

## How it is drawn

Live preview and reading view draw the file the way it prints: an empty line between blocks is a paragraph gap (not a whole blank line), a `---` rule is one thin line, and table cells show their `**bold**`, `` `code` ``, links and `==highlight==` drawn until you edit the cell. Nested quotes (`> >`) are indented, backslash escapes (`\*`) and `<autolinks>` hide their punctuation, footnotes (`[^1]`) show as a small raised number, and `<sub>`, `<sup>`, `<kbd>`, `<mark>`, `<u>` and `<br>` are drawn. Other raw HTML (such as `<details>`) is shown as source, never run. The PDF export follows the same rules.
