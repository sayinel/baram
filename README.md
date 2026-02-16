<p align="center">
  <img src="src/assets/baram-logo.png" alt="Baram" width="280" />
</p>

<p align="center">
  A lightweight, beautiful WYSIWYG markdown editor with AI integration.
</p>

<p align="center">
  <strong>Typora's WYSIWYG quality + Obsidian's extensibility + AI-native editing</strong>
</p>

---

Baram(바람) is a desktop markdown editor where formatting syntax disappears as you type. Cursor into a heading and the `## ` prefix reappears for editing; move away and only the styled text remains. This Typora-style experience extends to bold, italic, links, images, math, and more — all while maintaining lossless markdown roundtrip fidelity.

## Features

### WYSIWYG Editing

- **Syntax Reveal** — Markdown delimiters (`**`, `*`, `` ` ``, `~~`, `[](url)`, `![](url)`, `<u></u>`) appear only when the cursor enters the formatted range, then vanish on exit
- **Source Mode** — Toggle between WYSIWYG and raw markdown (CodeMirror 6) with `Cmd+/`
- **Roundtrip Fidelity** — MD → ProseMirror → MD conversion preserves the original document exactly

### Block Elements

| Element | Syntax | Input Trigger |
|---------|--------|---------------|
| Heading (H1-H6) | `# ` ~ `###### ` | Type `# ` + Space |
| Blockquote | `> ` | Type `> ` + Space |
| Bullet List | `- ` / `* ` | Type `- ` + Space |
| Ordered List | `1. ` | Type `1. ` + Space |
| Task List | `- [ ] ` / `- [x] ` | Type `- [ ] ` + Space |
| Horizontal Rule | `---` / `***` | Type `---` + Enter |
| Code Block | ` ``` ` | Type ` ``` ` + Enter |
| Math Block | `$$` | Type `$$` + Enter |
| Table | GFM pipe syntax | Slash command `/table` |
| Image | `![alt](url)` | Type or drag-and-drop |
| YAML Frontmatter | `---` yaml `---` | Auto-detected at document start |

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

### Math

- **Block math** — Type `$$` to create a LaTeX block with live KaTeX preview (`Cmd+Shift+M`)
- **Inline math** — Type `$...$` for inline equations; cursor entering shows LaTeX source, exiting shows rendered formula
- Powered by KaTeX for fast, high-quality typesetting

### Code Blocks

- Syntax highlighting powered by **CodeMirror 6**
- Language detection and selection dropdown
- Full CodeMirror editing experience inside the block

### Tables

- GFM (GitHub Flavored Markdown) pipe table support
- Tab / Shift+Tab cell navigation
- Column alignment markers preserved on roundtrip

### Images

- **NodeView** with hover toolbar (resize 25%/50%/75%/100%, alt-text editing)
- Drag-and-drop image files into the editor
- Paste images from clipboard
- Click to expand and edit `![alt](url)` syntax directly

### AI Integration

- **LLM Provider** — Claude API via Rust SSE streaming proxy
- **Inline AI Editing** — Select text and press `Cmd+K` to give AI instructions
- **AI Diff Engine** — Character-level diff visualization (insert/delete decorations) with accept/reject
- **Slash AI Commands** — 7 AI-powered commands via `/` menu (summarize, expand, fix grammar, translate, etc.)
- **Settings** — Configure provider, API key, model, and privacy options (`Cmd+,`)

### UI

- **3-Column Layout** — File tree sidebar, editor area, outline sidebar
- **Command Palette** — `Cmd+Shift+P` for quick access to all commands
- **Slash Commands** — Type `/` for block insertion menu
- **Floating Toolbar** — Context-aware formatting toolbar on text selection
- **Block Handle** — Drag handle for block reordering
- **Status Bar** — Word count, line count, cursor position

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Heading 1-6 | `Cmd+1` ~ `Cmd+6` |
| Increase heading level | `Cmd+=` |
| Decrease heading level | `Cmd+-` |
| Bold | `Cmd+B` |
| Italic | `Cmd+I` |
| Underline | `Cmd+U` |
| Inline code | `Cmd+E` |
| Strikethrough | `Cmd+Shift+X` |
| Link | `Cmd+K` |
| Code block | `Cmd+Shift+C` |
| Math block | `Cmd+Shift+M` |
| Blockquote | `Cmd+Shift+>` |
| Bullet list | `Cmd+Shift+8` |
| Ordered list | `Cmd+Shift+7` |
| Source mode toggle | `Cmd+/` |
| AI inline edit | `Cmd+K` (with selection) |
| Command palette | `Cmd+Shift+P` |
| Settings | `Cmd+,` |
| Undo / Redo | `Cmd+Z` / `Cmd+Shift+Z` |

## Architecture

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

### Markdown Pipeline

Bidirectional, lossless conversion between markdown and ProseMirror:

```
Forward:  remark-parse → mdast → ProseMirror Document
Reverse:  ProseMirror Document → mdast → remark-stringify
```

Each node/mark type has a dedicated transformer file in `src/pipeline/transformers/` that handles both directions.

### Extension System

All editor features are implemented as Tiptap Extensions (Extension-First architecture):

- **13 Node Extensions** — heading, paragraph, blockquote, bulletList, orderedList, taskList, horizontalRule, image, codeBlock, mathBlock, table, frontmatter (+2 planned)
- **8 Mark Extensions** — bold, italic, code, strike, link, underline, inlineMath (+2 planned)
- **6 Plugin Extensions** — history, slashCommands, syntaxReveal, dropHandler, dragHandle (+1 planned)

## Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Desktop Framework | Tauri | 2.0 |
| Backend | Rust | latest stable |
| Frontend | React + TypeScript | 19 |
| Bundler | Vite | 6 |
| Styling | Tailwind CSS | 4 |
| Editor Engine | Tiptap / ProseMirror | v2 |
| Math Rendering | KaTeX | latest |
| Code Editing | CodeMirror | 6 |
| State Management | Zustand | latest |

## Project Structure

```
baram/
├── src/                    # React frontend
│   ├── extensions/         # Tiptap extensions (nodes/, marks/, plugins/)
│   ├── pipeline/           # MD ↔ ProseMirror conversion
│   ├── stores/             # Zustand stores (editor, file, ui, settings, ai)
│   ├── components/         # React UI components
│   ├── hooks/              # Custom React hooks
│   └── ipc/                # Tauri IPC wrappers
├── src-tauri/              # Rust backend
│   └── src/
│       ├── commands/       # IPC command handlers
│       ├── fs/             # File system operations
│       ├── llm/            # LLM API proxy (SSE streaming)
│       ├── search/         # Full-text search (tantivy)
│       ├── git/            # Git integration
│       ├── export/         # PDF/HTML export
│       └── config/         # Settings management
├── docs/design/            # Design documents (Part 1-9)
└── tests/                  # E2E tests (Playwright)
```

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [Rust](https://rustup.rs/) (latest stable)
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)

### Setup

```bash
# Install dependencies
npm install

# Development (frontend only)
npm run dev

# Development (full Tauri app)
npm run tauri dev

# Production build
npm run tauri build
```

### Testing

```bash
# Run all frontend tests (Vitest)
npx vitest run

# Run Rust tests
cd src-tauri && cargo test

# Type checking
npx tsc --noEmit
```

**Test coverage (98 tests):**

| Suite | Tests | Description |
|-------|-------|-------------|
| Roundtrip (M2) | 27 | Headings, paragraphs, blockquotes, lists, images, marks |
| Roundtrip (M3) | 14 | Math, code blocks, tables, frontmatter |
| Roundtrip Stability | 6 | Multi-cycle conversion stability |
| Tiptap Toggle | 5 | Source mode ↔ WYSIWYG roundtrip |
| Stores | 6 | Zustand store behavior |
| AI Diff | 13 | Inline diff engine |
| Heading Shortcuts | 15 | Level increase/decrease/toggle commands |
| Syntax Reveal | 9 | Mark expansion/collapse behavior |
| Rust SSE Parser | 3 | LLM streaming parser |

## Roadmap

**Phase 1 — MVP** (M1-M6)

| Milestone | Status | Description |
|-----------|--------|-------------|
| M1 Project Setup | Done | Tauri + React + Tiptap + Zustand + Rust modules + CI/CD |
| M2 Basic Editing | Done | MD pipeline, 11 nodes, 5 marks, history, auto-save |
| M3 Rich Content | Done | KaTeX math, CodeMirror 6, tables, frontmatter, source mode |
| M4 UI Framework | Done | 3-column layout, sidebar, command palette, slash commands, toolbar |
| M5 AI Level 2 | Done | Claude SSE streaming, inline editing (Cmd+K), AI diff, settings |
| M6 MVP Release | Next | PDF/HTML export, performance optimization, release build |

**Phase 2 — Extensions** (M7-M10)

- Callout blocks, wikilinks, backlinks, find & replace
- Highlight, subscript, superscript marks
- Mermaid diagrams, table of contents
- Plugin marketplace

## License

Editor core: MIT / App: AGPL-3.0
