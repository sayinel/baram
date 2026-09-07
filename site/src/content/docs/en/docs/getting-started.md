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

Alternatively, [build from source](https://github.com/sayinel/baram#build-from-source).

### First Launch

When you first open Baram, a Welcome screen greets you with two options:

- **Open Folder** — Open an existing folder of markdown files
- **New File** — Create a fresh document

### Interface Overview

Baram uses a 3-column layout:

<figure class="ui-map not-content">
  <div class="ui-map-frame">
    <div class="ui-map-chrome" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="ui-map-cell ui-map-contexts">
      <strong>Context Tab Bar</strong>
      <span>one tab per vault or folder</span>
    </div>
    <div class="ui-map-cell ui-map-rail" aria-label="Activity Bar">
      <span class="ui-map-icons" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <strong>Activity Bar</strong>
    </div>
    <div class="ui-map-cell ui-map-left">
      <strong>Left Sidebar</strong>
      <span>File tree · Backlinks · Search</span>
    </div>
    <div class="ui-map-center">
      <div class="ui-map-cell"><strong>Document Tab Bar</strong></div>
      <div class="ui-map-cell ui-map-editor">
        <strong>Main Editor</strong>
        <span>WYSIWYG</span>
      </div>
    </div>
    <div class="ui-map-cell ui-map-right">
      <strong>Right Sidebar</strong>
      <span>Outline · AI chat</span>
    </div>
    <div class="ui-map-cell ui-map-status"><strong>Status Bar</strong></div>
  </div>
</figure>

- **Context Tab Bar** — one tab for every vault or folder you have open. It spans the full width at the very top of the window, and hides when no vault or folder is open.
- **Activity Bar** — the icon strip that chooses what the left sidebar and the right panel show. Pick which icons appear, and in what order, under **Settings > Activity Bar**. It hides when no folder is open.
- **Left Sidebar** — File tree, backlinks panel, bookmarks, global search, Git source control, and version history. Toggle with `Cmd+Shift+L` (macOS) / `Ctrl+Shift+L` (Windows/Linux).
- **Document Tab Bar** — the documents open in the current context. Drag a tab out of the bar to tear it off into its own window.
- **Main Editor** — The WYSIWYG editing area where you write.
- **Right Sidebar** — Document outline showing heading structure, or AI Chat panel.
- **Status Bar** — Shows word count, line count, and cursor position.

> The left sidebar opens with a workspace and the right one starts closed, so the window stays mostly writing space. The editor follows the principle of **minimal interface** — only showing what you need, when you need it.

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
