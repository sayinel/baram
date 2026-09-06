---
title: "Getting started"
---

## Getting Started

### Installation

Download the latest release for your platform from the [Releases](https://github.com/sayinel/baram/releases) page.

| Platform                      | Format              |
| ----------------------------- | ------------------- |
| macOS (Apple Silicon / Intel) | `.dmg`              |
| Windows (x64 / ARM)           | `.msi`, `.exe`      |
| Linux (x64)                   | `.deb`, `.AppImage` |

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
│ Backlinks│                              │             │
│ Bookmarks│                              │             │
├──────────┴──────────────────────────────┴─────────────┤
│                     Status Bar                        │
└───────────────────────────────────────────────────────┘
```

- **Left Sidebar** — File tree, backlinks panel, bookmarks, global search, Git source control, and version history. Toggle with `Cmd+Shift+L` (macOS) / `Ctrl+Shift+L` (Windows/Linux).
- **Main Editor** — The WYSIWYG editing area where you write.
- **Right Sidebar** — Document outline showing heading structure, or AI Chat panel.
- **Status Bar** — Shows word count, line count, and cursor position.

> By default, both sidebars are hidden to maximize writing space. The editor follows the principle of **minimal interface** — only showing what you need, when you need it.

---

## Help Menu

The **Help** menu opens this guide, the keyboard shortcut reference, and the FAQ in your browser, plus links to the project homepage and issue tracker — there is no in-app panel:

| Menu item | Opens |
| --------- | ----- |
| **User Guide** | This guide |
| **Keyboard Shortcuts** | Complete keyboard shortcut reference |
| **FAQ** | Frequently asked questions and answers |
| **Baram Homepage** | The project homepage |
| **Report Issue...** | GitHub Issues |

---

## Getting Help

- **Help Menu** — Opens the User Guide, Keyboard Shortcuts, and FAQ in your browser
- **Command Palette** (`Cmd+P` or `Cmd+Shift+P`) — Search for any feature
- **Quick Switcher** (`Cmd+K`) — Quickly open files and jump to headings
- **Slash Commands** (`/`) — Quick block insertion
- [**FAQ**](/baram/en/docs/faq/general/) — Frequently asked questions
- [**GitHub Issues**](https://github.com/sayinel/baram/issues) — Report bugs or request features
