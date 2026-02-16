<p align="center">
  <img src="src/assets/baram-logo.png" alt="Baram" width="280" />
</p>

<p align="center">
  A lightweight, beautiful WYSIWYG markdown editor with AI integration.
</p>

<p align="center">
  <strong>Beautiful WYSIWYG &middot; Lossless Markdown &middot; AI-native Editing</strong>
</p>

<p align="center">
  <a href="#installation">Installation</a> &nbsp;|&nbsp;
  <a href="#features">Features</a> &nbsp;|&nbsp;
  <a href="#keyboard-shortcuts">Shortcuts</a> &nbsp;|&nbsp;
  <a href="#ai-integration">AI</a> &nbsp;|&nbsp;
  <a href="#build-from-source">Build</a>
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

- **Syntax Reveal** — Delimiters (`**`, `*`, `` ` ``, `~~`, `[](url)`, `<u></u>`) appear on focus, vanish on exit
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
| Code Block | Type ` ``` ` and press Enter, or `Cmd+Shift+C` |
| Math Block | Type `$$` and press Enter, or `Cmd+Shift+M` |
| Table | Slash command `/table` |
| Image | Type `![alt](url)`, drag-and-drop, or paste from clipboard |
| YAML Frontmatter | Auto-detected at document start |

### Inline Formatting

| Format | Syntax | Shortcut |
|--------|--------|----------|
| **Bold** | `**text**` | `Cmd+B` |
| *Italic* | `*text*` | `Cmd+I` |
| `Code` | `` `text` `` | `Cmd+E` |
| ~~Strikethrough~~ | `~~text~~` | `Cmd+Shift+X` |
| <u>Underline</u> | `<u>text</u>` | `Cmd+U` |
| Link | `[text](url)` | `Cmd+K` |
| Inline Math | `$formula$` | Type `$` |

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

### Tables

GFM (GitHub Flavored Markdown) pipe table support:

- **Tab** / **Shift+Tab** to navigate between cells
- Column alignment (`:---`, `:---:`, `---:`) preserved on roundtrip
- Add/remove rows and columns

### Images

- **Drag-and-drop** image files directly into the editor
- **Paste** images from clipboard
- Hover toolbar: resize (25% / 50% / 75% / 100%), edit alt text
- Click to reveal and edit `![alt](url)` syntax

### Export

Export your documents to share or publish:

- **HTML** — Clean, self-contained HTML with inline styles
- **PDF** — Print-ready PDF via system print dialog

## AI Integration

Baram has built-in AI writing assistance powered by Claude API.

### Setup

1. Open Settings with `Cmd+,`
2. Go to the **AI** tab
3. Enter your Claude API key
4. Choose your preferred model

### Inline AI Editing (`Cmd+K`)

1. Select text in the editor
2. Press `Cmd+K`
3. Type your instruction (e.g., "make this more concise", "translate to Korean")
4. Review the AI suggestion with **character-level diff** highlighting
5. **Accept** or **Reject** the changes

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
| Code Block | `Cmd+Shift+C` |
| Math Block | `Cmd+Shift+M` |
| Blockquote | `Cmd+Shift+>` |
| Bullet List | `Cmd+Shift+8` |
| Ordered List | `Cmd+Shift+7` |

### Navigation & Tools

| Action | Shortcut |
|--------|----------|
| Source Mode Toggle | `Cmd+/` |
| Command Palette | `Cmd+Shift+P` |
| AI Inline Edit | `Cmd+K` (with text selected) |
| Settings | `Cmd+,` |
| Undo | `Cmd+Z` |
| Redo | `Cmd+Shift+Z` |

## User Interface

### 3-Column Layout

- **Left Sidebar** — File tree for navigating your documents (`Cmd+Shift+L` to toggle)
- **Editor** — Main editing area with WYSIWYG or Source mode
- **Right Sidebar** — Document outline with heading navigation

### Toolbar & Menus

- **Floating Toolbar** — Appears on text selection with formatting buttons
- **Block Handle** — Drag handle on the left side of each block for reordering
- **Slash Commands** — Type `/` at the start of a line for quick block insertion
- **Command Palette** — `Cmd+Shift+P` for searching and running any command
- **Context Menu** — Right-click for context-aware options

### Status Bar

Shows word count, line count, and cursor position at the bottom of the editor.

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
│  │ Zustand    │              │ Search (tantivy)│ │
│  │ CodeMirror │              │ Git Integration│  │
│  │ KaTeX      │              │ Export Engine  │  │
│  └────────────┘              └────────────────┘  │
└─────────────────────────────────────────────────┘
```

Markdown pipeline — bidirectional, lossless:

```
Forward:  remark-parse → mdast → ProseMirror Document
Reverse:  ProseMirror Document → mdast → remark-stringify
```

## Roadmap

**Phase 1 — MVP** (current)

| Milestone | Status | Description |
|-----------|--------|-------------|
| M1 Project Setup | ✅ Done | Tauri + React + Tiptap + Zustand + Rust modules + CI/CD |
| M2 Basic Editing | ✅ Done | MD pipeline, 11 nodes, 5 marks, history, auto-save |
| M3 Rich Content | ✅ Done | KaTeX math, CodeMirror 6, tables, frontmatter, source mode |
| M4 UI Framework | ✅ Done | 3-column layout, sidebar, command palette, slash commands, toolbar |
| M5 AI Level 2 | ✅ Done | Claude SSE streaming, inline editing, AI diff, settings |
| M6 MVP Release | 🚧 In Progress | PDF/HTML export, performance optimization, release build |

**Phase 2 — Extensions**

- Callout blocks, wikilinks, backlinks, find & replace
- Highlight, subscript, superscript marks
- Mermaid diagrams, table of contents
- Plugin marketplace

## License

Editor core: **MIT** / Application: **AGPL-3.0**
