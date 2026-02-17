# Baram User Guide

Welcome to Baram — a lightweight, beautiful WYSIWYG markdown editor with AI integration.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Writing Documents](#writing-documents)
- [Formatting](#formatting)
- [Rich Content](#rich-content)
- [Source Mode](#source-mode)
- [AI Features](#ai-features)
- [Export](#export)
- [Customization](#customization)

---

## Getting Started

### Installation

Download the latest release for your platform from the [Releases](https://github.com/sayinel/baram/releases) page.

| Platform | Format |
|----------|--------|
| macOS (Apple Silicon / Intel) | `.dmg` |
| Windows (x64 / ARM) | `.msi`, `.exe` |
| Linux (x64) | `.deb`, `.AppImage` |

Alternatively, [build from source](../README.md#build-from-source).

### First Launch

When you first open Baram, a Welcome screen greets you with two options:

- **Open Folder** — Open an existing folder of markdown files
- **New File** — Create a fresh document

### Interface Overview

Baram uses a 3-column layout:

```
┌──────────┬──────────────────────────────┬─────────────┐
│          │         Tab Bar              │             │
│  Left    │                              │   Right     │
│ Sidebar  │       Main Editor            │  Sidebar    │
│          │       (WYSIWYG)              │             │
│ File Tree│                              │  Outline    │
│          │                              │             │
├──────────┴──────────────────────────────┴─────────────┤
│                     Status Bar                        │
└───────────────────────────────────────────────────────┘
```

- **Left Sidebar** — File tree for navigating your documents. Toggle with `Cmd+Shift+L` (macOS) / `Ctrl+Shift+L` (Windows/Linux).
- **Main Editor** — The WYSIWYG editing area where you write.
- **Right Sidebar** — Document outline showing heading structure.
- **Status Bar** — Shows word count, line count, and cursor position.

> By default, both sidebars are hidden to maximize writing space. The editor follows the principle of **minimal interface** — only showing what you need, when you need it.

---

## Writing Documents

### Creating and Opening Files

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| New File | `Cmd+N` | `Ctrl+N` |
| Open File | `Cmd+O` | `Ctrl+O` |
| Save | `Cmd+S` | `Ctrl+S` |
| Save As | `Cmd+Shift+S` | `Ctrl+Shift+S` |
| Close Tab | `Cmd+W` | `Ctrl+W` |

You can also open files from the file tree in the left sidebar, or use the **File** menu.

### Tabs

Baram supports multiple open files via tabs at the top of the editor.

- **Switch tabs** — Click on a tab, or use `Ctrl+Tab` / `Ctrl+Shift+Tab`
- **Close tab** — Click the `×` on the tab, or press `Cmd+W`

### Auto-Save

Your documents are automatically saved as you type. A dot indicator on the tab shows unsaved changes — they are saved shortly after you stop typing.

### Undo and Redo

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Undo | `Cmd+Z` | `Ctrl+Z` |
| Redo | `Cmd+Shift+Z` | `Ctrl+Shift+Z` |

---

## Formatting

### Inline Formatting

Baram hides markdown syntax while you write. The delimiters appear when your cursor enters the formatted text, and vanish when you move away.

| Format | Syntax | Shortcut (macOS) | Shortcut (Win/Linux) |
|--------|--------|-------------------|----------------------|
| **Bold** | `**text**` | `Cmd+B` | `Ctrl+B` |
| *Italic* | `*text*` | `Cmd+I` | `Ctrl+I` |
| <u>Underline</u> | `<u>text</u>` | `Cmd+U` | `Ctrl+U` |
| ~~Strikethrough~~ | `~~text~~` | `Cmd+Shift+X` | `Ctrl+Shift+X` |
| `Inline Code` | `` `text` `` | `Cmd+E` | `Ctrl+E` |
| [Link](url) | `[text](url)` | `Cmd+K` | `Ctrl+K` |
| Inline Math | `$formula$` | Type `$...$` | Type `$...$` |

You can also apply formatting by selecting text and using the **Floating Toolbar** that appears above the selection.

### Block Formatting

#### Headings

Type `#` through `######` followed by a space to create headings H1–H6. You can also use shortcuts:

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Heading 1 | `Cmd+1` | `Ctrl+1` |
| Heading 2 | `Cmd+2` | `Ctrl+2` |
| Heading 3 | `Cmd+3` | `Ctrl+3` |
| Heading 4–6 | `Cmd+4` – `Cmd+6` | `Ctrl+4` – `Ctrl+6` |
| Increase Level | `Cmd+=` | `Ctrl+=` |
| Decrease Level | `Cmd+-` | `Ctrl+-` |

#### Lists

| List Type | How to Create | Shortcut (macOS) | Shortcut (Win/Linux) |
|-----------|---------------|-------------------|----------------------|
| Bullet List | Type `- ` or `* ` | `Cmd+Shift+8` | `Ctrl+Shift+8` |
| Ordered List | Type `1. ` | `Cmd+Shift+7` | `Ctrl+Shift+7` |
| Task List | Type `- [ ] ` or `- [x] ` | — | — |

Use `Tab` to indent and `Shift+Tab` to outdent list items.

#### Other Blocks

| Block | How to Create | Shortcut (macOS) | Shortcut (Win/Linux) |
|-------|---------------|-------------------|----------------------|
| Blockquote | Type `> ` | `Cmd+Shift+>` | `Ctrl+Shift+>` |
| Horizontal Rule | Type `---` and press Enter | — | — |
| Code Block | Type ` ``` ` and press Enter | `Cmd+Shift+C` | `Ctrl+Shift+C` |
| Math Block | Type `$$` and press Enter | `Cmd+Shift+M` | `Ctrl+Shift+M` |

### Slash Commands

Type `/` at the beginning of an empty line to open the slash command menu. This provides a quick way to insert any block element:

- `/heading1` – `/heading6` — Insert headings
- `/table` — Insert a table
- `/code` — Insert a code block
- `/math` — Insert a math block
- `/quote` — Insert a blockquote
- `/bullet` — Insert a bullet list
- `/ordered` — Insert an ordered list
- `/hr` — Insert a horizontal rule
- `/image` — Insert an image

Type to filter the menu items. AI commands are also available from the slash menu (see [AI Features](#ai-features)).

### Floating Toolbar

When you select text, a floating toolbar appears above the selection with formatting buttons: **Bold**, **Italic**, **Underline**, **Strikethrough**, **Code**, **Link**, and more.

### Block Handle

Hover over any block (paragraph, heading, etc.) to see a drag handle on the left. Use it to:
- **Drag** the block to reorder it
- **Click** to open a menu with options like block type conversion, duplicate, and delete

---

## Rich Content

### Math (KaTeX)

Baram supports LaTeX math rendering powered by KaTeX.

**Block Math:**

1. Type `$$` and press Enter, or use `Cmd+Shift+M`
2. Write your LaTeX formula in the editing area
3. A live preview renders below as you type

```
$$
E = mc^2
$$
```

**Inline Math:**

Type `$formula$` to create an inline equation. When your cursor is inside the formula, you see the LaTeX source. Move away to see the rendered result.

### Code Blocks (CodeMirror 6)

Baram embeds a full CodeMirror 6 editor for each code block:

- **14 supported languages**: JavaScript, TypeScript, Python, Rust, Go, Java, C++, HTML, CSS, JSON, SQL, PHP, XML, YAML
- Language selection dropdown at the top of each block
- Syntax highlighting
- Languages are lazy-loaded for performance

To create a code block, type ` ``` ` followed by an optional language name and press Enter:

````
```python
def hello():
    print("Hello, Baram!")
```
````

### Tables

Baram supports GFM (GitHub Flavored Markdown) pipe tables.

- Create a table via the slash command `/table`
- **Tab** / **Shift+Tab** to navigate between cells
- Column alignment (`:---`, `:---:`, `---:`) is preserved
- Hover over the table to see buttons for adding rows and columns

### Images

Insert images in multiple ways:

1. **Drag and drop** an image file into the editor
2. **Paste** an image from your clipboard (`Cmd+V`)
3. Type markdown syntax: `![alt text](image-url)`
4. Use the slash command `/image`

Hover over an image to access the toolbar for resizing (25% / 50% / 75% / 100%) and editing alt text.

### YAML Frontmatter

YAML frontmatter at the top of a document is automatically detected and rendered as a structured block:

```yaml
---
title: My Document
tags: [baram, markdown]
date: 2026-02-17
---
```

---

## Source Mode

Press `Cmd+/` (macOS) or `Ctrl+/` (Windows/Linux) to toggle between WYSIWYG mode and Source Mode.

In Source Mode, you edit raw markdown text in a CodeMirror 6 editor with:
- Syntax highlighting
- Full markdown source visibility
- All changes sync back to WYSIWYG mode when you switch

This is useful for precise markdown editing or debugging formatting issues.

---

## AI Features

Baram has built-in AI writing assistance powered by the Claude API.

### Setup

1. Open Settings with `Cmd+,` (macOS) or `Ctrl+,` (Windows/Linux)
2. Go to the **AI** tab
3. Select your provider (Claude is the default)
4. Enter your API key
5. Choose your preferred model

### Inline AI Editing (Cmd+K)

1. **Select text** in the editor
2. Press `Cmd+K` (macOS) or `Ctrl+K` (Windows/Linux)
3. Type your instruction (e.g., "make this more concise", "translate to Korean")
4. The AI processes your request with real-time streaming
5. Review the suggestion with **character-level diff** highlighting:
   - Green text = additions
   - Red text = deletions
6. Click **Accept** to apply or **Reject** to discard

> **Tip:** Without text selected, `Cmd+K` opens the Command Palette instead.

### Slash AI Commands

Type `/` in the editor to access AI commands:

| Command | Description |
|---------|-------------|
| `/ai-summarize` | Summarize selected text |
| `/ai-expand` | Expand and elaborate on selected text |
| `/ai-grammar` | Fix grammar and spelling |
| `/ai-translate` | Translate to another language |
| `/ai-tone` | Change writing tone |
| `/ai-simplify` | Simplify complex text |
| `/ai-continue` | Continue writing from cursor position |

### Privacy Mode

Enable Privacy Mode in **Settings > AI** to prevent document content from being sent to the AI provider. This can be set globally or per-file using frontmatter:

```yaml
---
privacy: true
---
```

---

## Export

Export your documents from the **File > Export** menu.

### HTML

Generates clean, self-contained HTML with inline styles. The exported file includes all formatting, math rendering, and code highlighting.

### PDF

Creates a print-ready PDF via the system print dialog. Supports customization of paper size, margins, and layout.

---

## Customization

### Settings

Open Settings with `Cmd+,` (macOS) or `Ctrl+,` (Windows/Linux).

Available settings tabs:

| Tab | What You Can Configure |
|-----|------------------------|
| **General** | Startup behavior, language |
| **Editor** | Indentation, line endings, editor max width |
| **Markdown** | Extended syntax toggles, strict mode |
| **AI** | Provider, model, API key, privacy mode |
| **Export** | PDF/HTML export options |

### Command Palette

Press `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Windows/Linux) to open the Command Palette. Type to search for any command, setting, or action. This is the fastest way to access any feature in Baram.

### Keyboard Shortcuts

See the full [Keyboard Shortcuts Reference](keyboard-shortcuts.md) for all available shortcuts.

---

## Getting Help

- **Command Palette** (`Cmd+Shift+P`) — Search for any feature
- **Slash Commands** (`/`) — Quick block insertion
- **[FAQ](faq.md)** — Frequently asked questions
- **[GitHub Issues](https://github.com/sayinel/baram/issues)** — Report bugs or request features
