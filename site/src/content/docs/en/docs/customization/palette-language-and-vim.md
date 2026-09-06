---
title: "Command palette, language, and Vim mode"
---

## Command Palette

Press `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Windows/Linux) to open the Command Palette. Type to search for any command, setting, or action. This is the fastest way to access any feature in Baram.

## Language

Baram supports English and Korean interface languages.

1. Open **Settings > Language** (`Cmd+,` then select Language tab)
2. Select your preferred language
3. The entire UI updates immediately — menus, dialogs, settings, and the Welcome screen

The app defaults to the system language if supported, otherwise English.

## Vim Mode

Turn on **Settings > Editor > Vim Keybindings** (off by default) for modal editing. One switch covers three surfaces:

- **Source Mode** and **code files** — full vim, including text objects, `.` repeat, `/` search, macros and registers
- **WYSIWYG** — modal editing on the rendered document: motions, operators with counts, `f`/`t` find, `/` search, visual and visual-line mode, `zz`, `Space` to toggle a task, and `:w` / `:q` / `:N` line jumps. Text objects, `.` repeat and marks are not there yet
- **Code blocks inside a document** — full vim; `j`/`k` and the arrows cross in and out of the block, `Esc` in normal mode returns to the document, and your mode (normal or insert) follows the cursor across the boundary whether you move by keyboard or mouse
- **Math, Mermaid, SVG, HTML and query blocks** — `i` on a selected block opens its editor, `Esc` returns to the block

The status bar shows the current mode (`-- NORMAL --`, `-- INSERT --`, `-- VISUAL --`, or `-- INSERT (math) --` while a block editor holds the keys) and doubles as the `:` and `/` command line. Vim commands work with the Korean IME active — in normal mode keys resolve by physical position, so `j` moves down even when it would type `ㅓ`.

Vim key sequences are a separate layer from app shortcuts and are not remappable in Settings > Keybindings.

> 📖 The full command list is in the [Keyboard Shortcuts reference](/baram/en/docs/customization/keyboard-shortcuts/#vim-mode).

## Keyboard Shortcuts

All keyboard shortcuts can be customized in **Settings > Keybindings**:

1. Search for a shortcut by name or key combination
2. Click **Edit** on any shortcut to start capturing a new key combination
3. Press the desired keys — if there's a conflict, Baram shows which command already uses that combination
4. Click **Apply** to confirm, or **Cancel** to keep the current binding
5. Click the reset button to restore an individual shortcut to its default

Use **Reset All** at the bottom to restore all shortcuts to defaults.

See the full [Keyboard Shortcuts Reference](/baram/en/docs/customization/keyboard-shortcuts/) for all available shortcuts.

---
