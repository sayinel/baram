---
title: "Source mode, find and replace"
---

## Source Mode

Press `Cmd+/` (macOS) or `Ctrl+/` (Windows/Linux) to toggle between WYSIWYG mode and Source Mode.

In Source Mode, you edit raw markdown text in a CodeMirror 6 editor with:

- Syntax highlighting
- Full markdown source visibility
- Undo/Redo (`Cmd+Z` / `Cmd+Shift+Z`)
- Line numbers (configurable in Settings > Editor)
- Optional **Vim keybindings** (Settings > Editor > Vim Keybindings) — one switch enables modal editing in Source Mode, in the WYSIWYG editor, and inside code blocks, with `/` search, `:w`/`:q`/`:N` ex commands and Korean-IME support (verified on macOS; Windows/Linux not yet validated); see [Keyboard Shortcuts](/baram/en/docs/customization/keyboard-shortcuts/#vim-mode)
- All changes sync back to WYSIWYG mode when you switch

This is useful for precise markdown editing or debugging formatting issues.

---

## Find & Replace

### Find (`Cmd+F`)

Press `Cmd+F` (macOS) or `Ctrl+F` (Windows/Linux) to open the Find bar:

- Type to search — matching text is highlighted in the editor
- **Enter** — Jump to next match
- **Shift+Enter** — Jump to previous match
- **Escape** — Close the Find bar

### Replace (`Cmd+H`)

Press `Cmd+H` (macOS) or `Ctrl+H` (Windows/Linux) to open Find & Replace:

- Enter search text and replacement text
- **Replace** — Replace the current match
- **Replace All** — Replace all matches at once

---
