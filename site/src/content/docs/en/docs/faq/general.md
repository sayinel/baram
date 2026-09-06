---
title: "General and language"
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

### How does Baram update itself?

Baram checks GitHub Releases for a new version 15 seconds after startup and once a day
after that. Turn that off with **Settings > General > Updates > Check for Updates
Automatically**; **Check Now** in the same place always checks on demand, whether the
automatic check is on or off.

When a version is found you get a dialog with the release notes and an **Install & Restart**
button. Baram downloads the update, replaces itself, and restarts — on macOS, Windows, and
Linux AppImage alike.

Two cases fall back to opening the releases page for a manual download instead:

- **Linux `.deb` and `.rpm`** installs, which the updater cannot perform.
- **Any install that fails.** The dialog says what went wrong and opens the page, so a
  failed replace never leaves you without a way forward.

> **Updating to v0.7.0 on macOS is still manual.** In-place installing arrived *in* v0.7.0,
> and the version performing an update is the one you are updating *from* — so v0.6.x asks
> you to download it by hand, and v0.7.0 onward installs on its own.

---

## Language

### What languages does Baram support?

Baram currently supports **English** and **Korean** for the entire user interface — menus, dialogs, settings, welcome screen, and all UI elements.

### How do I change the language?

Open **Settings > Language** (`Cmd+,` on macOS, `Ctrl+,` on Windows/Linux, then select the Language tab). Choose your preferred language — the UI updates immediately without restarting the app.

### Does the language setting affect my documents?

No. The language setting only changes the interface language. Your markdown documents are not affected.

---
