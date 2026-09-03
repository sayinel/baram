# Frequently Asked Questions

---

## General

### What is Baram?

Baram(바람) is a lightweight desktop WYSIWYG markdown editor built with Tauri 2.0, React, and Tiptap/ProseMirror. It combines Typora-style "disappearing syntax" WYSIWYG editing with bidirectional links and AI-powered writing assistance.

### What platforms does Baram support?

Baram runs on macOS 13+ (one universal build for Apple Silicon and Intel), Windows (x64), and Linux (x64).

### Is Baram free?

Yes. Baram is free and open source software, licensed under the Apache License 2.0.

### What makes Baram different from other markdown editors?

- **WYSIWYG with lossless roundtrip** — Formatting syntax disappears as you type, but your files stay plain markdown text with no data loss — including markup Baram doesn't render itself
- **Bidirectional links** — Wikilinks, backlinks, hover preview, block references, and auto-rename — like Obsidian, but with true WYSIWYG
- **AI-native editing** — Built-in inline AI editing with character-level diff review
- **Lightweight** — ~8MB (Windows) to ~23MB (the universal macOS build, which carries both architectures), powered by Tauri instead of Electron
- **Rich content** — KaTeX math, CodeMirror 6 code blocks, Mermaid diagrams, GFM tables, callouts, toggles, all within the WYSIWYG experience

---

## Themes & Appearance

### How do I change the theme?

Open **Settings > Appearance** (`Cmd+,`). You'll see a gallery of theme cards — click any card to apply it. Select **System (Auto)** to follow your OS light/dark mode setting.

### What built-in themes are available?

Baram includes 8 built-in themes: Default Light, Default Dark, Tokyo Night, Solarized Light, Solarized Dark, Nord, Baram Garden Light, and Baram Garden Dark. Built-in themes cannot be deleted.

### How do I create a custom theme?

1. Go to **Settings > Appearance** and click **Customize...**
2. Enter a name for your theme
3. Choose a base mode (Light or Dark) — this determines how code blocks and diagrams render
4. Adjust the 25 colors using the color pickers (Background, Text, Border, Accent, Editor, Status, Graph)
5. Click **Save**

Your custom theme appears in the gallery with a "Custom" badge.

### How do I share themes with others?

In the theme editor, click **Export** to save your theme as a `.json` file. Others can import it by clicking **Import Theme...** in the Appearance tab.

### How do I delete a custom theme?

Hover over a custom theme card in the gallery and click the **x** button. Built-in themes cannot be deleted.

---

## Language

### What languages does Baram support?

Baram currently supports **English** and **Korean** for the entire user interface — menus, dialogs, settings, welcome screen, and all UI elements.

### How do I change the language?

Open **Settings > Language** (`Cmd+,` on macOS, `Ctrl+,` on Windows/Linux, then select the Language tab). Choose your preferred language — the UI updates immediately without restarting the app.

### Does the language setting affect my documents?

No. The language setting only changes the interface language. Your markdown documents are not affected.

---

## Keyboard Shortcuts

### Can I customize keyboard shortcuts?

Yes. Open **Settings > Keybindings** to see all shortcuts organized by category (File, Editing, Formatting, Blocks, View, Navigation, Tools, AI, Workspace). Click **Edit** on any shortcut, press the new key combination, and click **Apply**.

### What happens if I assign a key that's already in use?

Baram shows a conflict warning with the name of the command that already uses that key combination. You can choose to override (which removes the old binding) or cancel.

### Does Baram have Vim keybindings?

Yes — **Settings > Editor > Vim Keybindings**, off by default. One switch covers the WYSIWYG editor, Source Mode, and code blocks inside a document. Source Mode and code blocks get full vim (text objects, `.` repeat, `/` search, macros, registers); WYSIWYG has motions, operators with counts, `f`/`t`, `/` search, visual mode, and `:w` / `:q` / `:N` line jumps, but not yet text objects, `.` repeat, or marks. The status bar shows the mode and doubles as the `:` and `/` command line.

Vim commands work with the Korean IME active: in normal mode keys resolve by physical position, so `j` moves down even when it would type `ㅓ`. Vim key sequences are a separate layer and are not remappable in Settings > Keybindings. See the [full command list](keyboard-shortcuts.md#vim-mode).

### How do I reset a shortcut to its default?

Click the reset button (↺) next to any customized shortcut to restore its default key combination. To reset all shortcuts at once, click **Reset All** at the bottom of the Keybindings tab.

---

## Editing

### How does the WYSIWYG mode work?

Baram hides markdown delimiters (like `**`, `*`, `` ` ``) when your cursor is outside the formatted text. When you move your cursor into a bold word, the `**` markers reappear for editing. Move away, and only the styled text remains. This gives you a clean writing experience while maintaining full markdown access.

### Does Baram preserve my markdown exactly?

Yes. Baram's core principle is **lossless roundtrip fidelity** — when you open a markdown file, edit it, and save it, your content is preserved exactly, including syntax Baram doesn't render itself. No proprietary format, no hidden database. When you use layout features such as table column resizing or diagram sizing, Baram stores that metadata as plain, visible markdown comments right in the file — comments that other editors simply ignore.

### Is my file still "standard" markdown?

The file is always plain text, and there is nothing to export or convert to leave — that is the part that matters for lock-in. Whether every construct in it is *standard* depends on which features you use:

- **Plain CommonMark / GFM** — headings, lists, tables, task lists, links, images, code blocks, emphasis, strikethrough, footnotes.
- **Widespread conventions other tools also read** — YAML frontmatter, `$math$` and `$$math$$`, `> [!NOTE]` callouts, `==highlight==`, `~sub~` / `^sup^`, definition lists, `[TOC]`, and the `📅`/`⏫`/`🔁` task fields (the same vocabulary the Obsidian Tasks plugin uses).
- **Wiki-style extensions** — `[[wikilinks]]`, `#tags`, `@[[mentions]]`, block references `((file#^id))`, block embeds `{{embed ((file#^id))}}`, and ` ```query ` blocks. A plain markdown reader shows these as literal text (or, for a query block, as a code block) rather than dropping them.

None of it is binary, encrypted, or stored outside your files, so any editor can open, read, and change your notes.

### What file formats does Baram support?

Baram **edits** standard markdown files (`.md`, `.markdown`). It supports CommonMark, GitHub Flavored Markdown (GFM) extensions (tables, task lists, strikethrough), and additional syntax for math (`$`, `$$`), YAML frontmatter, callouts (`> [!type]`), and wikilinks (`[[page]]`).

It also **opens** several other types in place, so you do not have to leave the app to look at them:

- **PDF** (`.pdf`) — a reader with find, zoom, a page/highlight panel, and text & area highlighting you can cite from your notes. The PDF file itself is never modified.
- **HTML** (`.html`, `.htm`) — rendered live preview with a Preview / Source toggle; the source is editable and saves normally.
- **Images** (`.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.ico`, `.webp`, `.avif`) **and SVG** (`.svg`) — read-only viewer with zoom.

See [Viewing Other File Types](user-guide.md#viewing-other-file-types) in the User Guide. Plugins
can add viewers for further file types.

### How do I insert a table?

Four ways:

1. **Pipe input** — Type `| Header 1 | Header 2 |` and press Enter — a table is created with the headers filled in
2. **Grid Picker** — Type `/table` or press `Cmd+T` to select dimensions from a visual 10×10 grid
3. **TSV Paste** — Copy cells from a spreadsheet and paste — Baram auto-creates a table
4. Write GFM pipe table syntax directly

Once created, navigate cells with `Tab` and `Shift+Tab`. Drag column borders to resize (session only). Hover over the table to see ⊕ buttons for adding rows and columns. Right-click for alignment, header toggle, and copy options.

### How do I merge table cells?

1. Select the cells you want to merge by clicking and dragging across them
2. Press `Cmd+M` (macOS) / `Ctrl+M` (Windows/Linux), or right-click and select **Merge Cells**
3. To split a merged cell back, place your cursor in it and press `Cmd+M` again

**Persistence:** Cell merges are saved in your markdown file using `<` (colspan) and `^` (rowspan) markers inside the pipe table. This means merges survive source mode toggle (`Cmd+/`), file close/reopen, and are compatible with Obsidian Sheets Extended. In non-supporting markdown viewers, the markers simply appear as cell text.

### How do I insert math formulas?

- **Block math**: Type `$$` and press Enter, or use `Cmd+Shift+M`
- **Inline math**: Type `$formula$`

Math is rendered using KaTeX. A live preview shows while you type.

### How do I use code blocks?

Type ` ``` ` followed by a language name (e.g., `python`, `javascript`) and press Enter. Baram creates a CodeMirror 6 editor with syntax highlighting for that language. 14 languages are supported.

### How do I create a callout block?

Type `> [!info]` at the start of a line, or use the slash command `/callout`. Baram supports 12 callout types: `info`, `tip`, `warning`, `danger`, `note`, `abstract`, `todo`, `success`, `question`, `failure`, `example`, `quote`. Add `-` after the type for a collapsible callout.

### How do I create a toggle (collapsible) block?

Use the slash command `/toggle` or `/toggle heading 1` for a toggle with heading summary. Click the triangle indicator or press `Cmd+Enter` to open/close. In markdown, toggles use the HTML `<details>` / `<summary>` syntax.

### How do I insert a Mermaid diagram?

Use the slash command `/mermaid` or press `Cmd+Shift+D`. Write Mermaid syntax and a live preview renders below. Supports flowcharts, sequence diagrams, class diagrams, and more.

### How do I use footnotes?

Type `[^id]` (e.g., `[^1]` or `[^note]`) anywhere in your text to insert a footnote reference. A footnote definition block is automatically created at the end of the document — click into it to type the footnote content. References display as sequential numbers (1, 2, 3…) based on document order. Hover a reference to see a tooltip preview, click to navigate between reference and definition.

### How do I search across all files?

Press `Cmd+Shift+F` (macOS) or `Ctrl+Shift+F` (Windows/Linux) to open Global Search. It searches all files in your workspace using full-text search. Supports regex, file/folder filters, and replace across files.

### How do I fold/collapse a heading section?

Hover over any heading (H1–H6) to reveal a fold arrow in the left gutter. Click the arrow to collapse all content below that heading until the next heading of equal or higher level. Click again (or click the `...` indicator) to expand. You can also use `Cmd+Shift+[` (macOS) / `Ctrl+Shift+[` (Windows/Linux) to toggle fold at the cursor position.

### How do I fold a nested list?

List items that contain nested sub-lists (bullet, ordered, or task) show a fold arrow on hover. Click the arrow to collapse the nested children. This works at any nesting depth.

### How do I fold/unfold everything at once?

Use `Cmd+Shift+Alt+[` (macOS) / `Ctrl+Shift+Alt+[` (Windows/Linux) to fold all headings and nested list items. Use `Cmd+Shift+Alt+]` / `Ctrl+Shift+Alt+]` to unfold all.

### Does folding change my markdown file?

No. Folding is purely a view-level feature — it does not modify the document, affect undo history, or change the saved file. Fold state is preserved per file across tab switches.

### What is Source Mode?

Press `Cmd+/` (macOS) or `Ctrl+/` (Windows/Linux) to toggle Source Mode. This shows the raw markdown in a CodeMirror editor with full undo/redo support, useful for precise editing or troubleshooting formatting.

---

## Tasks

### How do I turn tasks on or off?

They are on by default. **Settings > General > Tasks > Enable Tasks** controls both the vault-wide index and the Tasks icon in the activity bar.

### What are the four checkbox states?

`- [ ]` to do, `- [/]` in progress, `- [x]` done, `- [-]` cancelled. Clicking the checkbox cycles through the first three. Cancelled is deliberately off that ring — use `/cancel-task` in the editor or **Cancel task** in the agenda's row menu — so a stray extra click can never land there.

`[/]` and `[-]` are not part of GitHub Flavored Markdown, so an editor that doesn't know them shows the raw `[/]` instead of a checkbox. The line itself is never lost.

### How do I set a due date without typing an emoji?

Three ways, all of which write the same `📅2026-09-30`:

- **Word trigger** — type `due:2026-09-30` (or `due:t`, `due:m`, `due:+3`, `due:9/30`) followed by a space
- **Plain language** — write "by friday" or "내일"; Baram underlines what it recognized and `Tab` confirms it
- **Slash command** — `/due` opens a calendar

`sched:` / `/sched` sets `⏳` and `start:` / `/start` sets `🛫` the same way.

### How do I set a priority?

Type `prio:1` through `prio:5` (or the short `!1`…`!5`) followed by a space, or use `/priority`. P1 is the most urgent: `🔺 ⏫` (nothing) `🔽 ⏬`.

### How do I make a task repeat?

`/repeat` — it's the only entry point, because the rule contains spaces and so can't be a word trigger. Rules look like `every day`, `every 2 weeks`, `every weekday`, `every week on Monday`, `every month on the 15th`.

Completing or cancelling a repeating task **rolls it forward**: the dates move to the next occurrence and the state returns to `[ ]`, all on the same line. If the chip says *(no date to move)* the task has a rule but no date to roll; *(not understood)* means the rule doesn't match the grammar above.

### Where does the Tasks panel get its tasks from?

Every markdown file in the roots covered by **Agenda scope** (**Settings > General > Tasks**), which defaults to All vaults. Folders listed under **Exclude folders** are skipped. Query blocks are different — they always search the vault the note lives in, so a note shows everyone the same list.

### Why is my task in "Past scheduled" instead of "Overdue"?

Overdue means a missed `📅` **due** date — a commitment you made. Past scheduled means a missed `⏳` **scheduled** date — a day you meant to start, which is a much softer signal. Keeping them apart stops every undated capture from turning the panel red.

### Does completing a task record the date?

Yes, `✅` with today's date, controlled by **Record completion date** (on by default). **Record created date** does the same with `➕` when you finish typing a new task line.

### Can Baram track how long a task takes?

Turn on **Settings > General > Tasks > Track time on tasks in progress**. While a task sits in `[/]` it carries a `⏱` field, and the elapsed time is banked when it leaves that state. It's off by default because switching a task to "in progress" would otherwise write a new field into a file other apps also read.

### What happens to old completed tasks?

Nothing, until you ask. **Archive completed tasks** in the panel moves anything finished more than *N* days ago (default 30) into `tasks/archive/YYYY-MM.md`. Archived tasks stay indexed and searchable. Nothing is ever archived automatically.

### Where else do tasks show up besides the Tasks panel?

Two places. The **Backlinks** panel has a **Tasks in this note** section listing every task in your vault whose line links to the open note. The **Zettel hub** shows a compact Tasks section — overdue and due today only, up to seven rows, with **See all** opening the full agenda. Both use the same rows as the agenda, so you can check tasks off from either.

### What do the `−5d` and `12d` badges on a task row mean?

`−5d` counts days past the date that put the task in its bucket — the due date in **Overdue**, the scheduled date in **Past scheduled**. `12d` with a *Stale* tooltip means the task has gone 30 days or more since its `➕` created date without being finished; it's there to surface things quietly rotting in the inbox.

### Can AI pull tasks out of my meeting notes?

Yes — select the prose and run `/extract-tasks` (**Extract Action Items**). The proposed task lines go through the usual AI diff preview, so nothing is written until you accept.

---

## Query Blocks

### What is a query block?

A saved search that lives inside a note and renders its results there. Insert one with `/query`, or write a ` ```query ` fenced code block by hand. It can list **notes** or **tasks**.

### Do query results update by themselves?

Not continuously. A block re-runs when you close its builder, when the query text changes, when you press **Run query**, and when you check off a task in its own results. A note query reads every markdown file in the vault, so running it on every keystroke would mean scanning the vault non-stop.

### How do I write a query by hand?

Each line is `key: value` — `source`, `filter`, `sort`, `display`, `limit`. All are optional:

````markdown
```query
source: tasks
filter: state = "todo" AND due before "+7d"
sort: due asc
display: list
limit: 10
```
````

The full field and operator tables are in the [User Guide](user-guide.md#query-blocks).

### Why does my query return nothing?

Most often a field/operator combination that doesn't exist — an unknown pair matches nothing rather than raising an error, so the block just looks empty. Open the builder and re-pick the field; it only ever offers operators that work. The other common cause is `priority`: queries filter on a signed weight (`🔺`=2, `⏫`=1, normal=0, `🔽`=-1, `⏬`=-2), not on the P1–P5 rank you type, so high-priority tasks are `priority > "0"`.

### Can I check off a task from inside a query block?

Yes, in the default `display: list`. The checkbox writes to the task's own file and the block re-runs. That's what makes a Map of Content usable as a project board. Clicking a row jumps to the task in its source file.

### Do query blocks break my file for other editors?

No. On disk a query block is an ordinary fenced code block with the `query` info string, so other tools show it as a code block.

---

## Linking & Navigation

### How do wikilinks work?

Type `[[` to start a wikilink. An autocomplete popup appears with matching files from your workspace. Select a file to insert a link like `[[My Note]]`. Cmd+click (or Ctrl+click on Windows) to navigate to the linked page.

Advanced syntax:

- `[[page|custom text]]` — Display custom text
- `[[page#heading]]` — Link to a specific heading
- `[[page#^block-id]]` — Link to a specific block
- `[[paper.pdf]]` — Link to a non-markdown file Baram can view

A wikilink can also point at a file Baram opens in place — a PDF, an HTML file, an image or SVG —
by writing its extension. The autocomplete offers those files and labels each with its type, so
`report.pdf` is distinguishable from `report.md` before you pick. Plain markdown links such as
`[the paper](papers/attention.pdf)` open in Baram too, and all of these are indexed like ordinary
links, so they appear in backlinks and in the Graph View.

### What are backlinks?

Backlinks are the reverse of wikilinks — they show you which documents link *to* the current file. Press `Cmd+Shift+B` to open the backlinks panel in the sidebar. Each backlink shows the source file and context.

### What are unlinked mentions?

Unlinked mentions show files that contain the current file's name in their text, but don't include an actual `[[wikilink]]`. This helps you discover connections you might want to formalize.

### What are block references and block embeds?

- **Block reference** `((file#^id))` — An inline reference to a specific block in another file. Cmd+click to navigate.
- **Block embed** `{{embed ((file#^id))}}` — Embeds a live preview of the referenced block. You can edit the embedded content directly.

To create a referenceable block, add `^my-id` at the end of a paragraph or heading.

### What are @mentions and how are they different from wikilinks?

@Mentions (`@[[page]]`) and wikilinks (`[[page]]`) both link to pages in your workspace, but they serve different purposes:

- **Wikilinks** (`[[page]]`) render as styled inline text links — ideal for flowing prose
- **Mentions** (`@[[page]]`) render as chip badges with icons (📅 for dates, 📄 for pages) — visually distinct for quick scanning

Type `@` to open the mention popup with Quick Dates (Today, Yesterday, Tomorrow) at the top and workspace pages below. Mentions are especially useful for referencing dates (journal entries) and for cases where you want a more prominent visual indicator.

In markdown, mentions serialize as `@[[value]]` — the `@` prefix distinguishes them from regular wikilinks.

### How do tags work?

Type `#tag` inline (with autocomplete) or add a `tags:` list to YAML frontmatter — both are indexed across the whole vault. Use `#parent/child` for nested tags. `Cmd/Ctrl+click` a tag to search every file that uses it. The Tags panel (from the Activity Bar) shows a tree or a frequency-sized cloud where you can rename a tag vault-wide, assign colors, filter the file tree by tag, or get AI tag suggestions for the current note.

### What happens when I rename a file?

When you rename a file in the file tree (press `F2`), all wikilinks pointing to that file are automatically updated across your workspace. No broken links.

### How do I navigate between recently viewed files?

Use `Cmd+[` (macOS) or `Ctrl+[` (Windows/Linux) to go back, and `Cmd+]` / `Ctrl+]` to go forward. This works like browser navigation history.

### How do I bookmark files?

Press `Cmd+D` (macOS) or `Ctrl+D` (Windows/Linux) to bookmark the current file. Bookmarked files appear in the Bookmarks section of the left sidebar. Press again to remove.

### How do I quickly switch between files?

Press `Cmd+K` (macOS) or `Ctrl+K` (Windows/Linux) to open the Quick Switcher. Type to search files by name. Type `#` to search by heading. The switcher also supports `Ctrl+Tab` for MRU (Most Recently Used) tab switching.

---

## PDF Reading & Highlights

### Can I edit a PDF in Baram?

No. Baram reads PDFs and lets you annotate them, but it never writes to the PDF file. Your
highlights are stored beside it in your vault as separate plain-text files.

### How do I highlight text in a PDF?

Turn on **Text highlight mode** in the PDF toolbar, then select text. A popup offers five colours
— yellow, green, blue, pink, purple. The mode is off by default so that an ordinary drag-select
and `Cmd+C` works the way it does in any other PDF reader.

### How do I highlight a figure, table, or equation?

Use an **area highlight**: turn on *Area highlight mode* and drag a rectangle, or just hold
**Alt** and drag anywhere without switching modes. Press `Escape` mid-drag to cancel. Area
highlights capture the region as an image, which is what you want for anything whose meaning is
not in the PDF's text layer.

### How do I quote a PDF highlight in my notes?

Click the highlight, choose **Copy reference**, and paste into any markdown file. You get a block
reference that renders inline as the quoted sentence — or, for an area highlight, as the cropped
region of the page. `Cmd+click` it to jump back to that spot in the PDF.

If you want the plain text with no link, use **Copy text** on the same popup — it is offered for
text highlights, since an area highlight has no text behind it to copy.

### An area reference is too big or too small

Drag its right edge, or write the width into the markdown yourself:
`((highlights/papers/attention#^a1b2c3|w=60))`. `w=` is an integer percentage from 10 to 100 of
the available width. Because it lives in the markdown, the size travels with the file.

### Where are my PDF highlights stored?

Two plain files inside your vault, per PDF:

- `highlights/<path-to-pdf>.md` — a companion markdown note holding the quoted text, one
  block-ID'd paragraph per highlight. It is an ordinary note; open and read it like any other.
- `.baram/pdf-highlights/<path-to-pdf>.json` — the geometry: page, rectangles, colour, kind.

Nothing is kept in a hidden database and nothing is written into the PDF, so highlights diff,
merge, and sync alongside your notes.

### I deleted a highlight by mistake

Deleting is a soft delete. Open the side panel, go to the **Highlights** tab and its **Deleted**
sub-tab, and press **Restore** — the highlight comes back exactly as it was, and so do any
references to it.

Deleting is soft on purpose: the quoted text lives in the companion note and the geometry in the
sidecar, so discarding the record outright would strip every reference back to a bare label, and
an area reference would lose its crop rectangle and become unrecoverable.

**Delete permanently** on that same tab removes it for good. Baram counts the references pointing
at it first and tells you the number, since those references will lose their preview. The quoted
text stays in the companion note either way.

### Can I search inside a PDF?

Yes — `Cmd+F` in a PDF tab opens **Find in PDF**. `Enter` and `Shift+Enter` step through matches,
there is a **Match case** option, and the counter shows your position (`3 / 17`).

### The highlight buttons aren't showing

Highlighting requires a vault, because the highlight has to be written somewhere. A PDF opened
through **File > Open File** from outside a vault gets the reader, find, zoom, and the page list,
but no highlight controls.

---

## AI

### Where do I get an API key?

Baram supports multiple AI providers. Get your API key from the respective provider:

| Provider               | Where to Get Key                                                     |
| ---------------------- | -------------------------------------------------------------------- |
| **Claude** (Anthropic) | [console.anthropic.com](https://console.anthropic.com/)              |
| **OpenAI**             | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **Google Gemini**      | [aistudio.google.com/apikey](https://aistudio.google.com/apikey)     |
| **Ollama** (local)     | No API key required — runs locally on your machine                   |

Each provider has its own API key field in **Settings > AI**.

### What AI models are supported?

Baram dynamically loads available models from your selected provider. Go to **Settings > AI**, select a provider, and the model dropdown shows the available models for that provider.

### How much does AI usage cost?

AI usage is billed by your API provider. Baram itself does not charge for AI features — you pay only for the API calls based on your provider's pricing. **Ollama** is free as it runs models locally on your machine.

### How do I use the AI inline editing?

Press `Cmd+J` (macOS) / `Ctrl+J` (Windows/Linux) to open the inline AI prompt. Type a natural language instruction (e.g., "translate to English", "fix grammar"), review the diff (green = added, red = removed), then accept or reject the changes.

### What is the ✨ (Sparkles) button?

The ✨ button provides contextual AI actions that adapt to the content you're working with. It appears in three places:

1. **Floating Toolbar** — Select text and click ✨ for text-aware actions (Improve, Shorten, Translate, etc.)
2. **Block Handle** — Hover near the left edge of a block, click ⋮, then hover ✨ for block-level actions
3. **NodeView Buttons** — Hover over code blocks, math blocks, tables, images, callouts, or Mermaid diagrams to see a ✨ button with specialized actions (e.g., "Find Bugs" for code, "Fix LaTeX" for math)

### What are Smart Templates?

Type `/ai-template` in the slash menu to generate structured documents from AI. Choose a preset template (Meeting Notes, Project Plan, etc.) or write a custom description. The AI generates formatted content (headings, lists, tables) and inserts it directly as WYSIWYG blocks.

### What is Ghost Text?

Ghost Text is AI-powered autocomplete that shows suggestions as faded text ahead of your cursor as you type. Press `Tab` to accept the full suggestion, `Cmd+Right` (macOS) / `Ctrl+Right` (Windows/Linux) for just the first word, or `Escape` to dismiss. Enable or disable it in **Settings > AI**.

### What is the AI Chat Panel?

Press `Cmd+Shift+A` (macOS) or `Ctrl+Shift+A` (Windows/Linux) to open a chat panel where you can converse with AI about your documents. Use `@references` to provide context: `@selection` (selected text), `@current` (current file), `@file` (any file), `@clipboard` (clipboard contents). Use **Apply to Editor** to insert AI responses directly into your document as formatted content.

### What are Custom AI Commands?

Create your own reusable AI commands in **Settings > AI > Custom Commands**. Each command has a name, description, and prompt template with variable substitution (`{selection}`, `{document}`, `{clipboard}`). Custom commands appear in the slash menu alongside built-in AI commands.

### What are Slash AI commands?

Type `/` to open the slash menu and scroll to the AI section, or type `/ai-` to filter. Available commands: write, brainstorm, summarize, expand, fix grammar, translate, explain, and smart templates. Custom AI commands also appear here.

### Can I use AI without sending data to the cloud?

Yes. Select **Ollama** as your provider and enable **Privacy Mode** in **Settings > AI**. Ollama runs models locally on your machine — no data leaves your computer. When Privacy Mode is enabled, only Ollama is allowed.

### What is Privacy Mode?

When enabled, Privacy Mode prevents your document content from being sent to cloud AI providers. Only Ollama (local) is allowed. Enable it globally in **Settings > AI**, or per-file by adding `privacy: true` to the YAML frontmatter.

### How do I search and replace text?

Press `Cmd+F` (macOS) / `Ctrl+F` (Windows/Linux) to open Find. Press `Cmd+H` / `Ctrl+H` for Find & Replace. Use `Enter` / `Shift+Enter` to navigate matches. Replace one or all matches.

### The AI features don't work. What should I check?

1. **API key** — Make sure you've entered a valid API key for your selected provider in **Settings > AI**
2. **Provider** — Verify the correct provider is selected
3. **Network** — Cloud providers (Claude, OpenAI, Gemini) need internet access; Ollama needs to be running locally
4. **Model selection** — Ensure a valid model is selected
5. **Privacy Mode** — When Privacy Mode is enabled, only Ollama works. Check that it is not enabled unintentionally

---

## Git Integration

### Does Baram support Git?

Yes. When your workspace is a Git repository, Baram shows a **Source Control** section in the left sidebar. You can view changes, stage/unstage files, write commit messages, view diffs, and switch branches — all without leaving the editor.

### How do I commit changes?

Open the Source Control sidebar, stage the files you want to commit (click the `+` button), type a commit message, and click the commit button.

### How do I switch branches?

Click the branch name in the Status Bar at the bottom of the editor. A dropdown appears where you can switch to an existing branch or create a new one.

---

## Version History (File Snapshots)

### What is Version History?

Baram automatically saves snapshots of your changed `.md` files at regular intervals (default: every 30 minutes). This provides a safety net independent of Git — you can browse past versions, view diffs, and restore files at any time.

### How do I open Version History?

Click the **clock icon** in the Activity Bar (left sidebar) to open the Version History panel. It shows a timeline of all snapshots.

### How do I create a manual snapshot?

Click the **+** button in the Version History panel header. You can optionally enter a label (e.g., "Before refactoring"). Manual snapshots with labels are never automatically deleted.

### How do I restore a file from a snapshot?

1. Click a snapshot in the timeline to see its file list
2. Check the files you want to restore (or use "Restore All")
3. Click **Restore** — Baram saves the current state first, so the restore itself is undoable

### How do I view a diff between a snapshot and the current file?

Click a snapshot in the timeline, then click any file name. A line-by-line diff appears showing additions (green) and deletions (red).

### How long are snapshots kept?

Snapshots are automatically thinned over time: all kept for the last 24 hours, then hourly for 1–7 days, daily for 7–30 days, and weekly beyond 30 days. The default limit is 50 snapshots and 500 MB total. Manual snapshots with labels are never auto-deleted.

### Can I disable automatic snapshots?

Yes. Go to **Settings > General** and set the **Snapshot Interval** to 0 minutes.

### How is Version History different from Git?

Version History is automatic and file-level — it silently saves changed files without requiring commits or messages. Git is intentional and semantic — you decide when and what to commit. Both systems work independently; Git users who prefer commits can disable snapshots.

---

## Workspace Presets

### What are Workspace Presets?

Workspace Presets save your current layout (sidebar panel, right panel, theme) as a named configuration that you can quickly apply later. Think of them as "workspace snapshots."

### How do I switch workspace presets?

Three ways:

1. **Keyboard shortcuts** — `Cmd+Alt+1` (Writing), `Cmd+Alt+2` (Zettel), `Cmd+Alt+3` (Journal), `Cmd+Alt+4` (Skills)
2. **Command Palette** — `Cmd+Shift+P` then search for "Workspace"
3. **Workspace menu** — Use the menu bar

### Can I create custom presets?

Yes. Go to **Settings > Appearance**, arrange your layout, and click **Save Current Layout**. Custom presets can be renamed or deleted.

---

## Zettel (Zettelkasten Notes)

### What is the Zettel space?

Zettel is a dedicated space for atomic, densely-linked notes, separate from the diary-oriented Journal. It centers on the fleeting → permanent workflow: quickly capture ideas into an `inbox/`, then refine the good ones into permanent, titled notes in `notes/` and connect them with links.

### How do I capture a quick note?

Press `Cmd+Shift+N` (or type `/capture`) to open Quick Capture. Your thought is saved as a fleeting note in the Zettel `inbox/`. Add tags (stored in the note's frontmatter) and an optional source URL.

### How do I turn an inbox note into a permanent note?

Open the inbox note and press `Cmd+Shift+U` (Promote). Give it a title — it moves to `notes/{id} {title}.md`, keeping its body and tags. You can also create a permanent note directly with `Cmd+Shift+V` (New Zettel), or turn a selection into a new note with `Cmd+Shift+Y`.

### Why do links look like `[[id]]` on disk but show titles in the editor?

Zettel notes are addressed by a timestamp `id`, so links are stored as `[[id]]`. Baram renders the note's current title in the editor, so links never break when you rename a note. Type `[[` to search by title.

### How do I enable it?

Go to **Settings > General > Zettel**, toggle it on, and choose a directory. Then open the space from the space menu (status bar), the Command Palette ("Open Zettel"), or `Cmd+Alt+3`.

---

## Journal / Daily Notes

### What is the Journal feature?

Baram includes a built-in journal system that automatically creates daily notes, provides a calendar sidebar for browsing, and supports @mentions for quick date linking.

### How do I enable the Journal?

Open **Settings > General > Journal**, enable the toggle, and select a folder for your journal files. The journal directory must be an absolute path (e.g., `/Users/me/journals`).

### How do I create a daily note?

Three ways:

1. **Calendar** — Open the Calendar sidebar (`Cmd+Alt+2`) and click any date
2. **@Mention** — Type `@` in the editor and select Today/Yesterday/Tomorrow from the popup, then click the resulting 📅 date chip
3. **Auto-create** — Set "On Startup" to "Open today's journal" in Settings — today's entry auto-opens when you launch Baram

### Can I use a custom template for daily notes?

Yes. In **Settings > General > Journal**, select a `.md` template file. Templates support variables: `{{date}}`, `{{year}}`, `{{month}}`, `{{day}}`, `{{dayName}}`, `{{monthName}}`. If no template is set, Baram generates a default entry with frontmatter and a date heading.

### How do I navigate between journal entries?

Use the Calendar sidebar. Days with existing entries are marked with a dot. Click any date to open or create that day's journal.

---

## Export

### What export formats are supported?

Baram supports seven export formats:

- **HTML** — Self-contained HTML with inline styles, math rendering, and code highlighting
- **PDF** — Print-ready PDF via the system print dialog
- **Notion** — Notion-compatible Markdown that converts Baram-specific syntax
- **Word (DOCX)** — Editable Word document via Pandoc, with optional template
- **LaTeX** — Typesetting format for academic/scientific documents via Pandoc
- **EPUB** — E-book format via Pandoc
- **RST** — reStructuredText for Sphinx documentation via Pandoc

The last four formats require [Pandoc](https://pandoc.org/) to be installed.

### How do I export a document?

Go to **File > Export** to open the Export dialog. Select your desired format, enter a title, and click Export. You can also use the Command Palette (`Cmd+Shift+P`) and search for "Export".

### What is Pandoc and do I need it?

[Pandoc](https://pandoc.org/) is a free document converter. You only need it if you want to export to Word, LaTeX, EPUB, or RST. Baram auto-detects Pandoc — if it's installed, the Pandoc formats become available in the Export dialog. If not, those formats are grayed out.

### How do I install Pandoc?

Visit [pandoc.org/installing.html](https://pandoc.org/installing.html) for your platform. On macOS: `brew install pandoc`. On Windows: download the installer. On Linux: `apt install pandoc` or equivalent.

### Can I use a Word template for DOCX export?

Yes. When you select the Word format in the Export dialog, a template browser appears. Select a `.docx` reference template and Pandoc will apply its styles (headings, fonts, colors, headers/footers) to the exported document.

### What does "Export for Notion" convert?

It automatically converts Baram-specific markdown syntax that Notion can't import directly: `[[wikilinks]]` become standard `[links](url)`, callouts become emoji-prefixed blockquotes, inline math `$...$` becomes block math `$$...$$`, highlight `==text==` becomes bold, subscript/superscript use Unicode characters or math fallback, and footnotes are converted to inline references with a Notes section.

### Are images included in exports?

Images referenced by URL are included in HTML exports as links. For PDF exports, images are rendered via the system print engine.

---

### Where is the Help panel?

Open the **Help** menu and select **User Guide**, **Keyboard Shortcuts**, or **FAQ**. The Help panel opens in the right sidebar with three tabs for quick in-app reference.

---

## Vault & Context

### What is a vault?

A vault is a folder that contains a `.baram/config.json` file. When Baram detects this file, it treats the folder as a fully initialized workspace with vault-level settings, a configurable Journal directory, and a vault alias for cross-vault linking. A plain folder without `.baram/config.json` still works as a normal workspace — vaults simply unlock extra features.

To turn any folder into a vault, open it in Baram, then go to **Settings > Vault** and click **Initialize as Vault**.

### Can I use multiple vaults simultaneously?

Yes. Each vault (or plain folder) you open appears as a tab in the **Context Tab Bar** at the top of the left sidebar. Click any tab to switch between contexts. Each context has its own file tree, tab history, and settings.

### How do I link files across vaults?

Use the cross-vault wikilink syntax: `[[alias::filename]]`. Replace `alias` with the target vault's short name (configured in **Settings > Vault > Alias**) and `filename` with the file name (without `.md`). For example, `[[research::climate-data]]` links to `climate-data.md` in the vault aliased `research`. If the target vault is not open, Baram prompts you to open it.

### What happens when I open a file outside a vault?

The file opens as a **File context** tab, indicated by a 📎 icon. The left sidebar is hidden — only the editor is shown. This is ideal for quick edits to files that don't belong to any workspace. There is no file tree, backlinks, or vault-level settings in this mode.

### How do I convert a folder to a vault?

1. Open the folder in Baram with **File > Open Folder**
2. Go to **Settings > Vault**
3. Click **Initialize as Vault**

Baram creates a `.baram/config.json` file inside the folder. Your existing files are not changed. To revert back to a plain folder, click **Revert to Folder** — this removes `.baram/config.json` but leaves all your markdown files intact.

### How is Journal related to vaults?

Each vault can have its own journal directory set in **Settings > Vault > Journal Directory**. When you are working in a vault context, the Calendar sidebar and @mention date chips (Today/Yesterday/Tomorrow) create journal entries in that vault's configured directory. Switching vault contexts switches the active journal, so you can maintain separate journals per vault (e.g., personal vs. work).

---

## Plugins

### Does Baram support plugins?

Yes. Open **Settings > Plugins** to browse, install, update, and manage plugins. The tab has three sections: Browse (discover plugins), Installed (everything you have, grouped into Built-in, Community, and In development), and Updates (apply new versions).

Clicking a plugin opens its detail page in an editor tab, with the full description, its rendered
README, the capabilities it asks for, and links to its repository and homepage.

### Can I turn off a plugin that ships with Baram?

Yes. Built-in plugins — the Media Viewer, for example — have the same **On / Off** toggle as any
other, and your choice is remembered across restarts. Turning one off deactivates it without
uninstalling anything.

### One of my plugins says "Withdrawn"

A plugin version can be withdrawn after you install it, either because a security issue was found
or because its author pulled it. Baram checks your installed plugins against a signed withdrawal
list, marks that plugin **Withdrawn**, shows the reason, and **does not run it**.

Its files are left where they are — nothing is deleted without you — and a **Remove it** action is
offered. If the report is a vulnerability rather than a withdrawal, the plugin keeps running and
Baram asks you to update once a newer version is published.

Baram also tells you when it cannot trust that list — if it has never been received, could not be
signature-verified, or has gone stale — rather than implying everything is fine.

### Are plugins safe?

Plugins are capability-gated: each declares the permissions it needs (editor, files, commands, UI, etc.), and you review and approve them before installing. Downloads are verified with a SHA-256 checksum, and installation is staged — unpacked and validated elsewhere, then swapped into place only once every check passes — so an interrupted install cannot leave a half-written plugin behind.

How strongly that approval is enforced depends on the plugin's kind:

- **Sandboxed** — the default, and the only kind published in the marketplace. The plugin's code is isolated from the editor and every privileged action is checked against the capabilities you approved, so the list you saw is a real boundary.
- **Full trust** — runs inside Baram itself with no isolation. The capability list describes what such a plugin intends to do but does not limit it; it can reach any file your account can, any network host, and every credential the app holds. Baram shows a red warning and asks for a separate confirmation before installing one, so you cannot get there by accident.

### I updated Baram and my plugin stopped working

Plugins installed with **v0.4.x** cannot be loaded by v0.5.0 or later. Those versions installed
plugins before Baram had a plugin trust model, so the installed copy does not record whether it
runs sandboxed or with full trust — and Baram will not run a plugin whose kind it cannot
determine. You will see an error on the plugin in **Settings > Plugins > Installed**.

Checking for updates does not fix it, because the plugin has to be re-approved rather than
upgraded. Use **Remove** on the Installed tab, then install it again from the marketplace if a
current version is published there. Some plugins from that era have not been republished; for
those, removing the old copy is all there is to do.

This applies once, to plugins installed before v0.5.0. Anything installed since is unaffected.

### How do I build a plugin?

See the [Plugin Development Guide](plugin-development.md). A plugin is a directory with a `baram-plugin.json` manifest and an ESM entry point, using the `ExtensionContext` API to add commands, Tiptap extensions, UI, and more.

---

## Troubleshooting

### The app won't start

- **macOS**: Builds from v0.6.0 on are notarized and should open normally. A "damaged" or "can't verify" warning means the copy you have is older, or the download was corrupted — re-download the current release. The prompt asking you to confirm an app downloaded from the internet is normal and not an error.
- **Windows**: If SmartScreen blocks the app, click "More info" then "Run anyway"
- **Linux**: Make sure the AppImage has execute permissions: `chmod +x Baram-*.AppImage`

### macOS asks for folder access

macOS shows a system permission prompt the first time an app reads files in a protected location — **Documents, Desktop, Downloads, or iCloud Drive**. Allow it once and the grant is remembered, including across updates.

**Upgrading from v0.5.x or earlier?** You will be asked once more, even though you already allowed it. Those builds were ad-hoc signed, which gave the app no identity that survived a rebuild, so macOS treated every version as a different app and re-asked every time. From v0.6.0 Baram is signed with an Apple Developer ID certificate, and the identity is stable — this is the last time you should see it.

If the prompt still repeats on v0.6.0 or later, grant **Full Disk Access** under **System Settings > Privacy & Security**, or keep your vault outside the protected folders (e.g. `~/Notes`).

### The editor feels slow

- **Large files**: Files over 10,000 lines may take up to 1 second to open. Consider splitting very large files
- **Many code blocks**: Each code block runs a CodeMirror instance. Documents with many code blocks use more memory
- **Math rendering**: Complex LaTeX formulas render quickly (under 50ms), but documents with hundreds of math blocks may affect scrolling performance

### Keyboard shortcuts aren't working

- Make sure you're focused on the editor area (click in the editor first)
- On macOS, check that the system hasn't assigned the same shortcut to another action in **System Preferences > Keyboard > Shortcuts**
- Some shortcuts change behavior based on context: `Cmd+K` opens the Quick Switcher, and AI inline editing is accessed via the Floating Toolbar when text is selected

### My markdown file looks different after editing

Baram preserves your markdown with lossless roundtrip fidelity. If something looks different, it may be because:

- Trailing whitespace was normalized
- The file used non-standard markdown syntax that Baram doesn't support

If you believe there's a roundtrip bug, please [report it on GitHub](https://github.com/sayinel/baram/issues).

### Wikilinks aren't working

- Make sure you have a workspace (folder) open — wikilinks link to files within your workspace
- File names are matched case-insensitively
- If autocomplete doesn't show a file, check that the file exists in your workspace folder

### Where are the log files?

Baram writes a plain-text log as it runs. Attaching it to a bug report saves a lot of guesswork:

- **macOS**: `~/Library/Logs/com.inel.baram/baram.log`
- **Windows**: `%LOCALAPPDATA%\com.inel.baram\logs\baram.log`
- **Linux**: `~/.local/share/com.inel.baram/logs/baram.log`

Each launch appends a line naming the version, so one file usually covers several sessions. It rotates at 2 MB, and up to two older files are kept beside it, named `baram_<date>_<time>.log`. Timestamps are UTC.

The log holds Baram's own diagnostics — a file it could not read, a plugin it refused to load, and similar. Your API keys are never written to it. **Names are**, though: file and folder paths, plugin ids, and text taken from a document when something in it could not be loaded — a broken image path, for instance. So a log line can quote a piece of a note, and the paths reveal how your vault is organised. Have a look before posting it in a public issue.

---

See the [User Guide](user-guide.md) and [Keyboard Shortcuts](keyboard-shortcuts.md) for more information.
