---
title: "Editing"
---


## How does the WYSIWYG mode work?

Baram hides markdown delimiters (like `**`, `*`, `` ` ``) when your cursor is outside the formatted text. When you move your cursor into a bold word, the `**` markers reappear for editing. Move away, and only the styled text remains. This gives you a clean writing experience while maintaining full markdown access.

## Does Baram preserve my markdown exactly?

Not byte for byte in every case, but your content comes back. Baram is built for **lossless roundtrip fidelity** — when you open a markdown file, edit it, and save it, everything you wrote is still there, including syntax Baram doesn't render itself. What can change is spelling, not content: the writer normalizes a few markdown spellings (`-` for list bullets, `**` for bold and `*` for italics, `---` for horizontal rules, fenced code blocks), so a file written with `+` bullets or `__bold__` comes back with the standard spellings. No proprietary format, no hidden database. When you use layout features such as table column resizing or diagram sizing, Baram stores that metadata as plain, visible markdown comments right in the file — comments that other editors simply ignore.

One exception today that does affect content: **reference-style links and images**. Markdown lets you write `[text][name]` (or `[name][]`, `[name]`, `![alt][name]`) in the body and keep the destination on a separate definition line, `[name]: https://…`. Baram resolves those references when it opens the file, so on save the links are written in inline form, `[text](https://…)`, and every definition line is removed — including a definition nothing refers to, a definition referred to only inside a code fence (fenced text is not a reference), and the second of two definitions with the same name (the first one wins, as in CommonMark). A reference with no matching definition is not a link at all: its bracketed text stays as text (saving may add a backslash before the brackets). Keeping the reference form byte for byte is tracked in [issue #600](https://github.com/sayinel/baram/issues/600).

## Is my file still "standard" markdown?

The file is always plain text, and there is nothing to export or convert to leave — that is the part that matters for lock-in. Whether every construct in it is *standard* depends on which features you use:

- **Plain CommonMark / GFM** — headings, lists, tables, task lists, links, images, code blocks, emphasis, strikethrough, footnotes.
- **Widespread conventions other tools also read** — YAML frontmatter, `$math$` and `$$math$$`, `> [!NOTE]` callouts, `==highlight==`, `~sub~` / `^sup^`, definition lists, `[TOC]`, and the `📅`/`⏫`/`🔁` task fields (the same vocabulary the Obsidian Tasks plugin uses).
- **Wiki-style extensions** — `[[wikilinks]]`, `#tags`, `@[[mentions]]`, block references `((file#^id))`, block embeds `{{embed ((file#^id))}}`, and ` ```query ` blocks. A plain markdown reader shows these as literal text (or, for a query block, as a code block) rather than dropping them.

None of it is binary, encrypted, or stored outside your files, so any editor can open, read, and change your notes.

## What file formats does Baram support?

Baram **edits** standard markdown files (`.md`, `.markdown`). It supports CommonMark, GitHub Flavored Markdown (GFM) extensions (tables, task lists, strikethrough), and additional syntax for math (`$`, `$$`), YAML frontmatter, callouts (`> [!type]`), and wikilinks (`[[page]]`).

It also **opens** several other types in place, so you do not have to leave the app to look at them:

- **PDF** (`.pdf`) — a reader with find, zoom, a page/highlight panel, and text & area highlighting you can cite from your notes. The PDF file itself is never modified.
- **HTML** (`.html`, `.htm`) — rendered live preview with a Preview / Source toggle; the source is editable and saves normally.
- **Images** (`.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.ico`, `.webp`, `.avif`) **and SVG** (`.svg`) — read-only viewer with zoom.

See [Viewing Other File Types](/en/docs/workspace/external-files-and-perspectives/#viewing-other-file-types) in the User Guide. Plugins
can add viewers for further file types.

## How do I insert a table?

Four ways:

1. **Pipe input** — Type `| Header 1 | Header 2 |` and press Enter — a table is created with the headers filled in
2. **Grid Picker** — Type `/table` or press `Cmd+T` to select dimensions from a visual 10×10 grid
3. **TSV Paste** — Copy cells from a spreadsheet and paste — Baram auto-creates a table
4. Write GFM pipe table syntax directly

Once created, navigate cells with `Tab` and `Shift+Tab`. Drag column borders to resize (session only). Hover over the table to see ⊕ buttons for adding rows and columns. Right-click for alignment, header toggle, and copy options.

## How do I merge table cells?

1. Select the cells you want to merge by clicking and dragging across them
2. Press `Cmd+M` (macOS) / `Ctrl+M` (Windows/Linux), or right-click and select **Merge Table Cells**
3. To split a merged cell back, place your cursor in it and press `Cmd+M` again

**Persistence:** Cell merges are saved in your markdown file using `<` (colspan) and `^` (rowspan) markers inside the pipe table. This means merges survive source mode toggle (`Cmd+/`), file close/reopen, and are compatible with Obsidian Sheets Extended. In non-supporting markdown viewers, the markers simply appear as cell text.

## How do I insert math formulas?

- **Block math**: Type `$$` and press Enter, or use `Cmd+Shift+M`
- **Inline math**: Type `$formula$`

Math is rendered using KaTeX. A live preview shows while you type.

## How do I use code blocks?

Type ` ``` ` followed by a language name (e.g., `python`, `javascript`) and press Enter. Baram creates a CodeMirror 6 editor with syntax highlighting for that language. 14 languages are supported.

## How do I create a callout block?

Type `> [!info]` at the start of a line, or use the slash command `/callout`. Baram supports 12 callout types: `info`, `tip`, `warning`, `danger`, `note`, `abstract`, `todo`, `success`, `question`, `failure`, `example`, `quote`. Add `-` after the type for a collapsible callout.

## How do I create a toggle (collapsible) block?

Use the slash command `/toggle` or `/toggle heading 1` for a toggle with heading summary. Click the triangle indicator or press `Cmd+Enter` to open/close. In markdown, toggles use the HTML `<details>` / `<summary>` syntax.

## How do I insert a Mermaid diagram?

Use the slash command `/mermaid` or press `Cmd+Shift+D`. Write Mermaid syntax and a live preview renders below. Supports flowcharts, sequence diagrams, class diagrams, and more.

## How do I use footnotes?

Type `[^id]` (e.g., `[^1]` or `[^note]`) anywhere in your text to insert a footnote reference. A footnote definition block is automatically created at the end of the document — click into it to type the footnote content. References display as sequential numbers (1, 2, 3…) based on document order. Hover a reference to see a tooltip preview, click to navigate between reference and definition.

## How do I search across all files?

Press `Cmd+Shift+F` (macOS) or `Ctrl+Shift+F` (Windows/Linux) to open Global Search. It searches all files in your workspace using full-text search. Supports regex, file/folder filters, and replace across files.

## How do I fold/collapse a heading section?

Hover over any heading (H1–H6) to reveal a fold arrow in the left gutter. Click the arrow to collapse all content below that heading until the next heading of equal or higher level. Click again (or click the `...` indicator) to expand. You can also use `Cmd+Shift+[` (macOS) / `Ctrl+Shift+[` (Windows/Linux) to toggle fold at the cursor position.

## How do I fold a nested list?

List items that contain nested sub-lists (bullet, ordered, or task) show a fold arrow on hover. Click the arrow to collapse the nested children. This works at any nesting depth.

## How do I fold/unfold everything at once?

Use `Cmd+Shift+Alt+[` (macOS) / `Ctrl+Shift+Alt+[` (Windows/Linux) to fold all headings and nested list items. Use `Cmd+Shift+Alt+]` / `Ctrl+Shift+Alt+]` to unfold all.

## Does folding change my markdown file?

No. Folding is purely a view-level feature — it does not modify the document, affect undo history, or change the saved file. Fold state is preserved per file across tab switches.

## What is Source Mode?

Press `Cmd+/` (macOS) or `Ctrl+/` (Windows/Linux) to toggle Source Mode. This shows the raw markdown in a CodeMirror editor with full undo/redo support, useful for precise editing or troubleshooting formatting.

---
