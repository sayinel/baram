<p align="center">
  <img src="src/assets/baram-logo.png" alt="Baram" width="280" />
</p>

<p align="center">
  A lightweight, beautiful WYSIWYG markdown editor with AI integration.
</p>

<p align="center">
  <strong>Beautiful WYSIWYG &middot; Lossless Markdown &middot; AI-native Editing &middot; Bidirectional Links</strong>
</p>

<p align="center">
  <a href="#installation">Installation</a> &nbsp;|&nbsp;
  <a href="#features">Features</a> &nbsp;|&nbsp;
  <a href="#keyboard-shortcuts">Shortcuts</a> &nbsp;|&nbsp;
  <a href="#ai-integration">AI</a> &nbsp;|&nbsp;
  <a href="#build-from-source">Build</a> &nbsp;|&nbsp;
  <a href="docs/user-guide.md">User Guide</a> &nbsp;|&nbsp;
  <a href="docs/keyboard-shortcuts.md">Shortcut Reference</a> &nbsp;|&nbsp;
  <a href="docs/faq.md">FAQ</a>
</p>

---

## What is Baram?

Baram(바람) is a desktop markdown editor where formatting syntax disappears as you type. Move your cursor into a heading and the `## ` prefix reappears for editing; move away and only the styled text remains. This experience extends to bold, italic, links, images, math, and more — all while maintaining **lossless markdown roundtrip fidelity**.

Your `.md` files stay 100% standard markdown. No proprietary format, no lock-in.

## Installation

### Download

Pre-built binaries for macOS, Windows, and Linux are available on the [Releases](https://github.com/sayinel/baram/releases) page.

| Platform | Architecture | Format |
|----------|-------------|--------|
| macOS | Apple Silicon (M1+) / Intel | `.dmg` |
| Windows | x64 / ARM | `.msi`, `.exe` |
| Linux | x64 | `.deb`, `.AppImage` |

### Build from Source

**Prerequisites:**
- [Node.js](https://nodejs.org/) v20+
- [Rust](https://rustup.rs/) (latest stable)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

```bash
git clone https://github.com/sayinel/baram.git
cd baram
npm install
npm run tauri build
```

The built application will be in `src-tauri/target/release/bundle/`.

## Features

### WYSIWYG with Disappearing Syntax

Baram hides markdown syntax while you write and reveals it only when your cursor enters the formatted range. What you see is what you get — without losing access to the underlying markdown.

- **Syntax Reveal** — Delimiters (`**`, `*`, `` ` ``, `~~`, `==`, `~`, `^`, `[](url)`, `<u></u>`) appear on focus, vanish on exit
- **Source Mode** — Instantly switch to raw markdown editing with `Cmd+/` (CodeMirror 6 powered)
- **Roundtrip Fidelity** — MD → Editor → MD preserves your document exactly

### Rich Block Elements

| Element | How to Create |
|---------|---------------|
| Heading (H1–H6) | Type `# ` through `###### ` or press `Cmd+1` – `Cmd+6` |
| Blockquote | Type `> ` at the start of a line |
| Bullet List | Type `- ` or `* ` |
| Ordered List | Type `1. ` |
| Task List | Type `- [ ] ` or `- [x] ` |
| Horizontal Rule | Type `---` and press Enter |
| Code Block | Type ` ``` ` and press Enter, or `Cmd+Alt+C` |
| Math Block | Type `$$` and press Enter, or `Cmd+Shift+M` |
| Table | Type `| H1 | H2 |` + Enter, `/table`, or `Cmd+T` |
| Image | Type `![alt](url)`, drag-and-drop, or paste from clipboard |
| Callout | Type `> [!info]` (supports info, tip, warning, danger, note, etc.) |
| Toggle | Slash command `/toggle` — collapsible details block |
| Toggle Heading | Slash command `/toggle heading 1` – `/toggle heading 3` |
| Mermaid Diagram | Slash command `/mermaid` or `Cmd+Shift+D` |
| Table of Contents | Type `[TOC]` or slash command `/toc` |
| Definition List | Type `Term` then `: Definition` on next line, or slash command `/definition-list` |
| Footnote Reference | Type `[^id]` inline |
| Footnote Definition | Auto-created at document end when `[^id]` is typed |
| YAML Frontmatter | Auto-detected at document start |

### Inline Formatting

| Format | Syntax | Shortcut |
|--------|--------|----------|
| **Bold** | `**text**` | `Cmd+B` |
| *Italic* | `*text*` | `Cmd+I` |
| `Code` | `` `text` `` | `Cmd+E` |
| ~~Strikethrough~~ | `~~text~~` | `Cmd+Shift+X` |
| <u>Underline</u> | `<u>text</u>` | `Cmd+U` |
| ==Highlight== | `==text==` | `Cmd+Shift+H` |
| Superscript | `^text^` | — |
| Subscript | `~text~` | — |
| Link | `[text](url)` | `Cmd+K` |
| Inline Math | `$formula$` | Type `$` |

### Footnotes

Add references and definitions using standard markdown footnote syntax:

- **Type `[^id]`** in text to insert a footnote reference (displays as a superscript number)
- A **footnote definition** block is automatically created at the end of the document
- References are numbered by document order (1, 2, 3…) regardless of identifier name
- **Hover** a reference to see a tooltip preview of the definition content
- **Click** a reference to scroll to its definition; click the number or ↩ in the definition to scroll back

```markdown
Here is some text[^note] with a footnote[^2].

[^note]: This is the footnote content.
[^2]: Another footnote.
```

### Vaults & Multi-Context Workspaces

Baram organizes your work into **contexts** shown as tabs in the Context Tab Bar at the top of the left sidebar:

- **Vault** 🏠 — A folder initialized as a first-class workspace (contains `.baram/config.json`), unlocking vault-level settings, a configurable Journal directory, and a vault alias for cross-vault linking
- **Folder** 📁 — Any plain folder opened without vault initialization — works as a normal workspace
- **File** 📄 — A single file opened outside any workspace (no file tree, just the editor)
- **Multiple vaults at once** — Open several vaults/folders simultaneously, each with its own file tree, tab history, and settings
- **Cross-vault links** — Link across vaults with `[[alias::filename]]`; the graph and backlinks span vaults
- **3-tier settings** — Global → vault → context settings resolution
- **Initialize / revert** — Turn any folder into a vault (or back) from **Settings > Vault**

### Bidirectional Links (Wikilinks)

Connect your notes with `[[wikilinks]]`:

- **Type `[[`** to insert a wikilink with autocomplete — matching files appear as you type
- **Heading links** — `[[page#heading]]` links to a specific heading
- **Block links** — `[[page#^block-id]]` links to a specific block
- **Display text** — `[[page|custom text]]` shows custom text
- **Relative / namespace links** — `[[./sibling]]` and `[[../parent-folder/note]]` resolve relative to the current file; filter by namespace in the Quick Switcher (`ns:`) and color the graph by namespace
- **Cross-vault links** — `[[alias::filename]]` links to a file in another vault
- **Cmd+click** to navigate to the linked page
- **Hover preview** — hover over a wikilink to see a preview of the target

### @Mentions

Mention pages and dates with inline chip badges using `@[[...]]` syntax:

- **Type `@`** to open the mention autocomplete popup
- **Quick Dates** — Today, Yesterday, Tomorrow appear at the top for instant date insertion
- **Page search** — Type to fuzzy-filter workspace pages
- **Date mention** — `@[[2026-02-27]]` inserts a 📅 date chip (navigates to journal on click)
- **Page mention** — `@[[My Note]]` inserts a 📄 page chip (navigates on Cmd+click)
- Mentions are visually distinct from wikilinks — styled as inline chips with icons

### Tags

Organize and filter notes with `#tags`:

- **Type `#tag`** inline, or add `tags:` to YAML frontmatter — both are indexed vault-wide
- **Nested tags** — `#parent/child` for hierarchical organization
- **Autocomplete** — Type `#` to get suggestions from the vault-wide tag index
- **Click to search** — `Cmd/Ctrl+click` a tag to search all files that use it
- **Tag panel** — Browse tags as a tree or a frequency-sized cloud; rename tags across the whole vault, assign colors, or filter the file tree by tag
- **AI tag suggestions** — Let AI suggest relevant tags for the current note

### Backlinks

See which documents link to the current one:

- **Backlink Panel** — Press `Cmd+Shift+B` to open the backlinks sidebar
- **Unlinked Mentions** — Shows pages that mention the current file name but don't link to it
- **Auto-rename** — Renaming a file automatically updates all wikilinks pointing to it

### Block References

Reference and embed specific blocks from other documents:

- **Block ID** — Add `^block-id` to any paragraph or heading to create a referenceable block
- **Block Reference** — `((file#^id))` inserts an inline reference that navigates on Cmd+click
- **Block Embed** — `{{embed ((file#^id))}}` embeds a live preview of the referenced block
- Embedded blocks are editable — changes sync back to the source file

### Callout Blocks

Obsidian-compatible callout syntax with 12 types:

```markdown
> [!info] Title
> Content goes here.
```

Supported types: `info`, `tip`, `warning`, `danger`, `note`, `abstract`, `todo`, `success`, `question`, `failure`, `example`, `quote`. Collapsible callouts supported with `> [!info]-`.

### Toggle Blocks

Collapsible content blocks using HTML `<details>` syntax:

```markdown
<details>
<summary>Click to expand</summary>

Hidden content here.

</details>
```

- **Toggle Heading** — Use a heading as the toggle summary for collapsible sections
- **Cmd+Enter** to toggle open/close
- Nested toggles supported

### Math (KaTeX)

Write LaTeX formulas with live preview powered by KaTeX.

- **Block math** — Type `$$` to create a display equation. Edit the LaTeX source in a textarea while a live preview renders below.
- **Inline math** — Type `$...$` to insert inline equations. Cursor entering shows the LaTeX source; moving away shows the rendered formula.
- Equation numbering is automatic.

### Code Blocks (CodeMirror 6)

Full-featured code editing inside your markdown:

- **14 languages** — JavaScript, TypeScript, Python, Rust, Go, Java, C++, HTML, CSS, JSON, SQL, PHP, XML, YAML
- Language auto-detection and selection dropdown
- Syntax highlighting with a CodeMirror 6 editor instance per block
- Languages are lazy-loaded — only the language you select gets downloaded

### Mermaid Diagrams

Create flowcharts, sequence diagrams, and more with Mermaid.js:

- Type `/mermaid` or press `Cmd+Shift+D` to insert a diagram block
- Edit Mermaid source code with live preview rendering below
- Supports all Mermaid diagram types: flowchart, sequence, class, state, ER, gantt, pie, etc.

### Tables

GFM (GitHub Flavored Markdown) pipe table support:

- **Auto-create** — Type `| Header 1 | Header 2 |` and press Enter to instantly create a table
- **Grid Picker** — Slash command `/table` or `Cmd+T` to select table dimensions visually
- **TSV Paste** — Paste tab-separated data from spreadsheets to auto-create a table
- **Tab** / **Shift+Tab** to navigate between cells
- Column alignment (`:---`, `:---:`, `---:`) preserved on roundtrip
- **Column resize** — Drag column borders to adjust width (session only, not saved to markdown)
- Add/remove rows and columns via hover buttons or right-click context menu
- **Context menu** — Right-click for alignment, header toggle, copy as Markdown/HTML, delete

### Images

- **Drag-and-drop** image files directly into the editor
- **Paste** images from clipboard
- Hover toolbar: resize (25% / 50% / 75% / 100%), edit alt text
- Click to reveal and edit `![alt](url)` syntax

### Find & Replace

- **Find** (`Cmd+F`) — Search for text with match highlighting, navigate matches with Enter / Shift+Enter
- **Replace** (`Cmd+H`) — Replace one or all matches

### Global Search

- **`Cmd+Shift+F`** — Full-text search across all files in the workspace using tantivy
- Supports regex, file/folder filters, and replace across files

### Query Blocks

Embed live, dynamic content that updates as your vault changes:

- Insert a query block (` ```query ` fence) and build filters with a visual query builder
- Results (matching files, tasks, or notes) render inline and refresh automatically

### Graph View

Visual map of your note connections. See how your documents are linked through wikilinks — nodes represent files, edges represent links.

### Export

Export your documents to share or publish:

- **HTML** — Clean, self-contained HTML with inline styles
- **PDF** — Print-ready PDF via system print dialog
- **Notion** — Notion-compatible Markdown with automatic conversion of wikilinks, callouts, math, highlight, subscript/superscript (Unicode), footnotes, and other Baram-specific syntax
- **Word (DOCX)** — Editable Word document via Pandoc, with optional reference template
- **LaTeX** — Typesetting format for academic/scientific documents via Pandoc
- **EPUB** — E-book format for Kindle, Apple Books via Pandoc
- **RST** — reStructuredText for Sphinx documentation via Pandoc

Pandoc-based formats require [Pandoc](https://pandoc.org/) installed on your system. Baram auto-detects Pandoc and shows available formats in the Export dialog.

### Git Integration

Built-in source control without leaving the editor:

- **Source Control sidebar** — View changed files, stage/unstage, write commit messages
- **Diff viewer** — Inline diff with additions and deletions highlighted
- **Branch management** — Switch branches, create new branches
- **History** — Browse commit log with author, date, and message
- **Stash** — Save and restore work-in-progress changes
- **Remote** — Push, pull, and fetch from remote repositories
- **Status bar** — Current branch displayed at the bottom

### Version History (File Snapshots)

Automatic file versioning independent of Git — a safety net for your work:

- **Automatic snapshots** — Baram periodically saves snapshots of changed `.md` files (default: every 30 minutes, configurable)
- **Manual snapshots** — Create a labeled snapshot anytime from the Version History sidebar
- **Timeline view** — Browse all snapshots in chronological order with file counts and sizes
- **Diff viewer** — Click any file in a snapshot to see a line-by-line diff against the current version
- **Selective restore** — Choose individual files to restore using checkboxes, or restore all files at once
- **Safe restore** — Before restoring, Baram auto-saves the current state so you can always undo a restore
- **Retention policy** — Old snapshots are automatically thinned (hourly → daily → weekly) to save space; manual snapshots with labels are never auto-deleted
- **Settings** — Configure snapshot interval and max count in **Settings > General**

Version History works alongside Git but is independent — Git users who prefer commits can disable snapshots by setting the interval to 0.

### Themes

Customize the look and feel of Baram with built-in themes or create your own:

- **8 built-in themes** — Default Light, Default Dark, Tokyo Night, Solarized Light, Solarized Dark, Nord, Baram Garden Light, Baram Garden Dark
- **System (Auto)** — Automatically follows your OS light/dark mode preference
- **Theme Gallery** — Visual card grid in **Settings > Appearance** — click to switch
- **Color Editor** — Customize any theme with a full 25-color picker (backgrounds, text, borders, accent, editor, status, graph)
- **Import / Export** — Share themes as `.json` files

### Journal / Daily Notes

A focused daily-diary workspace, not just a dated file:

- **Auto-create** — Today's journal entry is automatically created on startup (configurable)
- **Calendar sidebar** — Interactive mini calendar showing which days have entries; click a date to open/create
- **Periodic notes** — Weekly, monthly, and yearly notes with their own templates
- **@Mentions for dates** — Type `@` and select Today / Yesterday / Tomorrow, or `@[[YYYY-MM-DD]]` to link a specific day
- **Photo journal** — Drag, paste, or `/photo` to add images (auto-saved to `assets/`); browse them in a gallery with a lightbox
- **Memories view** — Revisit past entries by year (Journal / Photos tabs), with inline one-line editing
- **Streaks & stats** — Consecutive-day streaks, monthly/yearly stats, and a contribution heatmap
- **Templates** — Custom `.md` templates with variables (`{{date}}`, `{{dayName}}`, etc.)
- **Journal themes** — Dedicated calendar/journal themes independent of the app theme
- **Settings** — Enable and configure directory, filename format, hierarchy, templates, and startup behavior in **Settings > General > Journal**

### Zettel (Zettelkasten Notes)

A dedicated space for atomic, densely-linked notes — capture fast, refine into permanent notes, connect with `[[links]]`:

- **Quick capture** — Drop a fleeting thought into `inbox/` with `Cmd+Shift+N` (or `/capture`); tags go to frontmatter, source URL optional
- **Fleeting → permanent** — Promote an inbox note into a titled permanent note in `notes/` with `Cmd+Shift+U`
- **New Zettel** — Create a permanent atomic note directly (`Cmd+Shift+V`), or turn a text selection into a new note + `[[link]]` with `Cmd+Shift+Y`
- **ID-based links** — Notes are `{id} {title}.md`; `[[id]]` links render the live title and stay valid across renames. `[[` autocomplete searches by title
- **MOCs** — Create a Map of Content index note (`#moc`) with `Cmd+Shift+C` to organize entry points
- **Hub panel** — In the Zettel space the sidebar becomes a dedicated hub: quick actions (New / Capture / MOC), an inbox queue (promote ↑ or delete ✕ inline, click to open), your MOCs, and recent notes — and it refreshes automatically as you capture and promote
- **Enable** — Turn on and set a directory in **Settings > General > Zettel**; open the space via the space menu, Command Palette, or `Cmd+Alt+3`

### Workspace Presets

Save and restore your workspace layout:

- **4 built-in presets** — Writing (`Cmd+Alt+1`), Journal (`Cmd+Alt+2`), Zettel (`Cmd+Alt+3`), Skills Editing (`Cmd+Alt+4`)
- **Custom presets** — Save your current sidebar, panel, and theme configuration as a named preset
- **Quick switch** — Apply presets via keyboard shortcuts, Command Palette, or the Workspace menu. Switching spaces never force-closes an open folder tree

### Internationalization

Baram supports multiple interface languages:

- **English** and **Korean** built-in
- Switch languages in **Settings > Language** — the entire UI updates immediately including menus, dialogs, and the Welcome screen

### Keyboard Shortcut Customization

Remap any keyboard shortcut to your preference:

- Open **Settings > Keybindings** to see all shortcuts organized by category
- Click **Edit** on any shortcut, then press the new key combination to rebind
- **Conflict detection** warns when a key combination is already in use
- **Reset** individual shortcuts or reset all to defaults

### Plugins

Extend Baram with community plugins:

- **Marketplace** — Browse, search, install, and update plugins from **Settings > Plugins** (Browse / Installed / Updates tabs)
- **Capability-gated** — Each plugin declares the permissions it needs (editor, files, commands, UI, …); you review and approve them before install
- **Safe by design** — Dynamic ESM loading with crash isolation (error boundaries), SHA-256 checksum verification on download, and an activation timeout
- **Developer guide** — See [docs/plugin-development.md](docs/plugin-development.md) for the manifest format, the `ExtensionContext` API, and how to bundle and publish

## AI Integration

Baram has built-in AI writing assistance powered by Claude, OpenAI, Google Gemini, and Ollama (local).

### Setup

1. Open Settings with `Cmd+,`
2. Go to the **AI** tab
3. Select your AI provider (Claude, OpenAI, Gemini, or Ollama)
4. Enter your API key (per-provider — each provider has its own key field; Ollama requires no key)
5. Choose your preferred model (models are loaded dynamically from the provider)

### Inline AI Editing (`Cmd+J`)

Press `Cmd+J` to open the inline AI prompt anywhere in your document:

1. Type your instruction (e.g., "make this more concise", "translate to Korean")
2. The AI processes your request with real-time streaming
3. Review the suggestion with **character-level diff** highlighting
4. **Accept** or **Reject** the changes

### Contextual AI Actions (✨ Sparkles)

AI actions appear contextually throughout the editor via the ✨ button:

- **Floating Toolbar** — Select text and click ✨ for actions like Improve, Shorten, Expand, Translate, Tone Change, Explain
- **Block Handle** — Hover near the left gutter, click ⋮, then ✨ for block-level AI actions
- **NodeView Buttons** — Hover over code blocks, math blocks, tables, images, callouts, and Mermaid diagrams for specialized AI actions

Actions are content-aware — code blocks show "Add Comments", "Optimize", "Find Bugs"; math blocks show "Show Steps", "Fix LaTeX"; tables show "Analyze Data", "Fill Cells", etc.

### Ghost Text (AI Autocomplete)

AI-powered autocomplete suggestions appear as you type:

- **Tab** — Accept the full suggestion
- **Cmd+Right** — Accept only the first word
- **Escape** — Dismiss the suggestion

Enable or disable Ghost Text in **Settings > AI**.

### AI Chat Panel (`Cmd+Shift+A`)

A dedicated chat panel for conversing with AI about your documents:

- **@references** — Mention context: `@selection`, `@current` (current file), `@file` (any file), `@clipboard`
- **Apply to Editor** — Insert AI responses directly into the editor as WYSIWYG content
- Streaming responses with markdown rendering
- Conversation history per session

### Smart Templates (`/ai-template`)

Type `/ai-template` in the slash menu to generate document content from AI-powered templates:

- Choose from template categories (e.g., Meeting Notes, Project Plan, Technical Spec)
- Or write a custom description for any template
- Generated content is inserted as fully rendered WYSIWYG blocks

### Slash AI Commands

Type `/` to open the slash menu. AI-powered commands include:

| Command | Description |
|---------|-------------|
| `/ai-write` | Write or continue from current context |
| `/ai-brainstorm` | Brainstorm ideas from current context |
| `/ai-summarize` | Summarize selected text |
| `/ai-expand` | Expand and elaborate on selected text |
| `/ai-fix-grammar` | Fix grammar and spelling |
| `/ai-translate` | Translate to another language |
| `/ai-explain` | Explain selected text in simple terms |
| `/ai-template` | Generate content from AI templates |

### Custom AI Commands

Create your own slash commands in **Settings > AI > Custom Commands**. Use variable substitution (`{selection}`, `{document}`, `{clipboard}`) to build reusable AI workflows.

## Keyboard Shortcuts

> On Windows/Linux, replace `Cmd` with `Ctrl`.

### Formatting

| Action | Shortcut |
|--------|----------|
| Bold | `Cmd+B` |
| Italic | `Cmd+I` |
| Underline | `Cmd+U` |
| Inline Code | `Cmd+E` |
| Strikethrough | `Cmd+Shift+X` |
| Highlight | `Cmd+Shift+H` |
| Link | `Cmd+K` |

### Headings

| Action | Shortcut |
|--------|----------|
| Heading 1–6 | `Cmd+1` through `Cmd+6` |
| Increase Heading Level | `Cmd+=` |
| Decrease Heading Level | `Cmd+-` |

### Blocks

| Action | Shortcut |
|--------|----------|
| Code Block | `Cmd+Alt+C` |
| Math Block | `Cmd+Shift+M` |
| Blockquote | `Cmd+Shift+B` |
| Bullet List | `Cmd+Shift+8` |
| Ordered List | `Cmd+Shift+7` |
| Task List | `Cmd+Shift+9` |
| Table | `Cmd+T` |
| Mermaid Diagram | `Cmd+Shift+D` |
| Toggle Open/Close | `Cmd+Enter` |

### Navigation & Tools

| Action | Shortcut |
|--------|----------|
| Source Mode Toggle | `Cmd+/` |
| Quick Switcher | `Cmd+K` |
| Command Palette | `Cmd+P` / `Cmd+Shift+P` |
| Find | `Cmd+F` |
| Replace | `Cmd+H` |
| AI Chat Panel | `Cmd+Shift+A` |
| Backlink Panel | `Cmd+Shift+B` |
| Bookmark | `Cmd+D` |
| Navigate Back | `Ctrl+-` |
| Navigate Forward | `Ctrl+Shift+-` |
| Global Search | `Cmd+Shift+F` |
| Tab Switcher (MRU) | `Ctrl+Tab` |
| Workspace: Writing | `Cmd+Alt+1` |
| Workspace: Journal | `Cmd+Alt+2` |
| Workspace: Zettel | `Cmd+Alt+3` |
| Workspace: Skills Editing | `Cmd+Alt+4` |
| Quick Capture (→ Zettel inbox) | `Cmd+Shift+N` |
| Open Today's Journal | `Cmd+Shift+J` |
| New Zettel | `Cmd+Shift+V` |
| Promote to Permanent Note | `Cmd+Shift+U` |
| New Note from Selection | `Cmd+Shift+Y` |
| New MOC | `Cmd+Shift+C` |
| Settings | `Cmd+,` |
| Undo | `Cmd+Z` |
| Redo | `Cmd+Shift+Z` |

## User Interface

### 3-Column Layout

- **Context Tab Bar** — Switch between open vaults, folders, and files
- **Left Sidebar** — File tree, Search, Backlinks, Bookmarks, Tags, Calendar, Git, and Version History (`Cmd+Shift+L` to toggle)
- **Editor** — Main editing area with WYSIWYG or Source mode
- **Right Sidebar** — Document outline, AI Chat, Memories, Photo Gallery, or Help panel

### Toolbar & Menus

- **Floating Toolbar** — Appears on text selection with formatting buttons
- **Block Handle** — Drag handle on the left side of each block for reordering
- **Slash Commands** — Type `/` at the start of a line for quick block insertion
- **Command Palette** — `Cmd+P` or `Cmd+Shift+P` for searching and running any command
- **Quick Switcher** — `Cmd+K` for quickly opening files and jumping to headings
- **Context Menu** — Right-click for context-aware options (copy, paste, block type, pin tab, etc.)

### Tabs

- **Multiple tabs** — Open several files at once
- **Tab Pin** — Right-click a tab to pin it (pinned tabs show as icons, can't be accidentally closed)
- **Tab Switcher** — `Ctrl+Tab` opens MRU (Most Recently Used) tab switcher
- **Undo history preserved** — Switching tabs preserves your undo/redo history per tab

### Help Panel

Access built-in documentation from the **Help** menu:

- **User Guide** — Feature overview and usage instructions
- **Keyboard Shortcuts** — Complete shortcut reference
- **FAQ** — Frequently asked questions

The Help panel opens in the right sidebar.

### Status Bar

Shows word count, line count, cursor position, and current Git branch at the bottom of the editor.

## Development

For contributors who want to work on Baram:

```bash
# Install dependencies
npm install

# Start development server (frontend only)
npm run dev

# Start full Tauri desktop app in dev mode
npm run tauri dev

# Run tests
npm test                          # Vitest (frontend)
npm run rust:test                 # Rust backend
npm run rust:check                # fmt + frontend build + clippy + cargo test

# Lint & format
npm run lint
npm run check                     # frontend lint + tests
npm run verify:ci                 # local equivalent of CI gates
npm run format
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop Framework | Tauri 2.0 |
| Backend | Rust |
| Frontend | React 19 + TypeScript |
| Bundler | Vite 6 |
| Styling | Tailwind CSS 4 |
| Editor Engine | Tiptap / ProseMirror |
| Math | KaTeX |
| Code | CodeMirror 6 |
| Diagrams | Mermaid.js |
| State | Zustand |

### Architecture

```
┌─────────────────────────────────────────────────┐
│                   Tauri 2.0                      │
│  ┌────────────┐              ┌────────────────┐  │
│  │   React    │   IPC/Events │     Rust       │  │
│  │  Frontend  │◄────────────►│    Backend     │  │
│  │            │              │                │  │
│  │ Tiptap     │              │ File System    │  │
│  │ ProseMirror│              │ LLM Proxy      │  │
│  │ Zustand    │              │ Link Index     │  │
│  │ CodeMirror │              │ Search (tantivy)│ │
│  │ KaTeX      │              │ Git Integration│  │
│  │ Mermaid    │              │ Snapshots      │  │
│  │            │              │ Export Engine  │  │
│  └────────────┘              └────────────────┘  │
└─────────────────────────────────────────────────┘
```

Markdown pipeline — bidirectional, lossless:

```
Forward:  remark-parse → mdast → ProseMirror Document
Reverse:  ProseMirror Document → mdast → remark-stringify
```

## Roadmap

**Phase 1 — MVP** (completed)

| Milestone | Status | Description |
|-----------|--------|-------------|
| M1 Project Setup | ✅ Done | Tauri + React + Tiptap + Zustand + Rust modules + CI/CD |
| M2 Basic Editing | ✅ Done | MD pipeline, 11 nodes, 5 marks, history, auto-save |
| M3 Rich Content | ✅ Done | KaTeX math, CodeMirror 6, tables, frontmatter, source mode |
| M4 UI Framework | ✅ Done | 3-column layout, sidebar, command palette, slash commands, toolbar |
| M5 AI Level 2 | ✅ Done | Claude SSE streaming, inline editing, AI diff, settings |
| M6 MVP Release | ✅ Done | PDF/HTML export, performance optimization, release build |

**Phase 2 — Connection System & AI** (completed)

| Milestone | Status | Description |
|-----------|--------|-------------|
| M7 Connection & Navigation | ✅ Done | Wikilinks, backlinks, block references, callouts, toggles, mermaid, graph view, quick switcher, bookmarks, tab features |
| M8 AI & Skills | ✅ Done | Multi-provider AI (Claude/OpenAI/Gemini/Ollama), Ghost Text, AI Chat, Find/Replace, Custom AI Commands, Skills editing |

**Phase 2 — Productivity** (completed)

| Milestone | Status | Description |
|-----------|--------|-------------|
| M9 Productivity | ✅ Done | Highlight / subscript / superscript marks, Table of Contents, Table Tier 3, Footnotes, Help panel, Global Search, Definition List, Mermaid enhanced, Git Basic, Theme System, Extension Settings, Workspace Presets, Export for Notion, Pandoc Extended Export (Word/LaTeX/EPUB/RST), Journal / Daily Notes |

**Phase 3 — Advanced** (in progress)

| Feature | Status | Description |
|---------|--------|-------------|
| Table Cell Merge & Virtual Scroll | ✅ Done | Merge/split table cells, virtual scroll for 50+ rows |
| Query Block | ✅ Done | Visual query builder for dynamic content filtering |
| Git Advanced | ✅ Done | Log, stash, remote push/pull/fetch, branch delete |
| File Snapshots / Version History | ✅ Done | Automatic file versioning, timeline, diff viewer, selective restore |
| Namespace | ✅ Done | Relative wikilinks, namespace filtering, graph coloring |
| Skills Dedicated Mode | ✅ Done | Editing UI optimized for LLM Skills files |
| Tag System | ✅ Done | Vault-wide index, nested tags, rename, colors, cloud view, AI suggestions |
| Journal Workspace | ✅ Done | Diary-focused daily notes: calendar, photos, memories, streaks, periodic notes, templates |
| Zettel (Zettelkasten) | ✅ Done | Atomic-notes space: inbox capture, fleeting→permanent promote, `[[id]]` links with live titles, MOCs |
| Settings Redesign & Keybinding Customization | ✅ Done | 9-tab settings, search, remap shortcuts with conflict detection |
| Heading & List Folding | ✅ Done | Obsidian-style view-only folding |
| Vault System | ✅ Done | Multi-context workspaces, context tabs, cross-vault links, 3-tier settings |
| Plugin Marketplace | ✅ Done | Community plugins with capability-gated install and crash isolation |
| Canvas | Planned | Infinite canvas with free-form layout |
| Agent Mode | Planned | Multi-file autonomous AI editing |
| Knowledge Q&A | Planned | Vault-wide vector search with cited answers |
| Real-time Collaboration | Planned | Yjs CRDT-based live editing |

## License

Editor core: **MIT** / Application: **AGPL-3.0**
