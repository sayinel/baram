# Baram

A lightweight, beautiful WYSIWYG markdown editor.

Baram is a desktop editor that lets you create rich content naturally without seeing raw markdown syntax. As you type, markdown formatting disappears and your finished document appears instantly.

## Features

**WYSIWYG Markdown Editing**
- Instant formatting as you type (`#`, `**`, `` ` ``, `>`, etc.)
- Source mode toggle for direct markdown editing
- Lossless MD → Editor → MD roundtrip

**Math**
- Block math: type `$$` to create a LaTeX math block with live KaTeX preview
- Inline math: type `$` to insert math within text
- Automatic equation numbering

**Code Blocks**
- Syntax highlighting powered by CodeMirror 6
- Support for many programming languages

**Tables**
- GFM table support
- Tab/Shift+Tab cell navigation

**And More**
- YAML Frontmatter
- Headings, blockquotes, lists, task lists, horizontal rules, images
- Bold, italic, code, strikethrough, links
- Undo/Redo
- Auto-save

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Tauri 2.0 |
| Frontend | React 19 + TypeScript |
| Editor Engine | Tiptap / ProseMirror |
| Math Rendering | KaTeX |
| Code Editing | CodeMirror 6 |
| State Management | Zustand |
| Backend | Rust |

## Build

```bash
# Install dependencies
npm install

# Development server
npm run tauri dev

# Production build
npm run tauri build
```

## License

Editor core: MIT / App: AGPL-3.0
