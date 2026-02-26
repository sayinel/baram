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

### Bidirectional Links (Wikilinks)

Connect your notes with `[[wikilinks]]`:

- **Type `[[`** to insert a wikilink with autocomplete — matching files appear as you type
- **Heading links** — `[[page#heading]]` links to a specific heading
- **Block links** — `[[page#^block-id]]` links to a specific block
- **Display text** — `[[page|custom text]]` shows custom text
- **Cmd+click** to navigate to the linked page
- **Hover preview** — hover over a wikilink to see a preview of the target

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

### Graph View

Visual map of your note connections. See how your documents are linked through wikilinks — nodes represent files, edges represent links.

### Export

Export your documents to share or publish:

- **HTML** — Clean, self-contained HTML with inline styles
- **PDF** — Print-ready PDF via system print dialog
- **Notion** — Notion-compatible Markdown with automatic conversion of wikilinks, callouts, math, highlight, subscript/superscript (Unicode), footnotes, and other Baram-specific syntax

### Git Integration

Built-in source control without leaving the editor:

- **Source Control sidebar** — View changed files, stage/unstage, write commit messages
- **Diff viewer** — Inline diff with additions and deletions highlighted
- **Branch management** — Switch branches, create new branches
- **Status bar** — Current branch displayed at the bottom

### Themes

Customize the look and feel of Baram with built-in themes or create your own:

- **6 built-in themes** — Default Light, Default Dark, Tokyo Night, Solarized Light, Solarized Dark, Nord
- **System (Auto)** — Automatically follows your OS light/dark mode preference
- **Theme Gallery** — Visual card grid in **Settings > Appearance** — click to switch
- **Color Editor** — Customize any theme with a full 16-color picker (backgrounds, text, borders, accent, editor)
- **Import / Export** — Share themes as `.json` files

### Workspace Presets

Save and restore your workspace layout:

- **3 built-in presets** — Writing (`Cmd+Alt+1`), Skills (`Cmd+Alt+2`), Research (`Cmd+Alt+3`)
- **Custom presets** — Save your current sidebar, panel, and theme configuration as a named preset
- **Quick switch** — Apply presets via keyboard shortcuts, Command Palette, or the Workspace menu

## AI Integration

Baram has built-in AI writing assistance powered by Claude, OpenAI, Google Gemini, and Ollama (local).

### Setup

1. Open Settings with `Cmd+,`
2. Go to the **AI** tab
3. Select your AI provider (Claude, OpenAI, Gemini, or Ollama)
4. Enter your API key (per-provider — each provider has its own key field; Ollama requires no key)
5. Choose your preferred model (models are loaded dynamically from the provider)

### Inline AI Editing

1. Select text in the editor
2. Click the AI button in the **Floating Toolbar** or type a custom prompt
3. Type your instruction (e.g., "make this more concise", "translate to Korean")
4. Review the AI suggestion with **character-level diff** highlighting
5. **Accept** or **Reject** the changes

### Ghost Text (AI Autocomplete)

AI-powered autocomplete suggestions appear as you type:

- **Tab** — Accept the full suggestion
- **Cmd+Right** — Accept only the first word
- **Escape** — Dismiss the suggestion

Enable or disable Ghost Text in **Settings > AI**.

### AI Chat Panel (`Cmd+Shift+A`)

A dedicated chat panel for conversing with AI about your documents:

- **@references** — Mention context: `@selection`, `@current` (current file), `@file` (any file), `@clipboard`
- Streaming responses with markdown rendering
- Conversation history per session

### Slash AI Commands

Type `/` to open the slash menu. AI-powered commands include:

| Command | Description |
|---------|-------------|
| `/ai-summarize` | Summarize selected text |
| `/ai-expand` | Expand and elaborate on selected text |
| `/ai-grammar` | Fix grammar and spelling |
| `/ai-translate` | Translate to another language |
| `/ai-tone` | Change writing tone |
| `/ai-simplify` | Simplify complex text |
| `/ai-continue` | Continue writing from cursor position |

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
| Workspace: Skills | `Cmd+Alt+2` |
| Workspace: Research | `Cmd+Alt+3` |
| Settings | `Cmd+,` |
| Undo | `Cmd+Z` |
| Redo | `Cmd+Shift+Z` |

## User Interface

### 3-Column Layout

- **Left Sidebar** — File tree + Backlinks + Bookmarks (`Cmd+Shift+L` to toggle)
- **Editor** — Main editing area with WYSIWYG or Source mode
- **Right Sidebar** — Document outline, AI Chat, or Help panel

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
cd src-tauri && cargo test        # Rust backend

# Lint & format
npm run lint
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
│  │ Mermaid    │              │ Export Engine  │  │
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

**Phase 2 — Productivity** (in progress)

| Milestone | Status | Description |
|-----------|--------|-------------|
| M9 Productivity | ✅ Done | Highlight / subscript / superscript marks, Table of Contents, Table Tier 3, Footnotes, Help panel, Global Search, Definition List, Mermaid enhanced, Git Basic, Theme System, Extension Settings, Workspace Presets, Export for Notion |

**Phase 3 — Advanced** (upcoming)

| Feature | Description |
|---------|-------------|
| Table Cell Merge | Merge/split table cells, virtual scroll for 50+ rows |
| Plugin Marketplace | Community extensions |

## License

Editor core: **MIT** / Application: **AGPL-3.0**
