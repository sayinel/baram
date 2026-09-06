---
title: "Formatting text and blocks"
---


## Inline Formatting

Baram hides markdown syntax while you write. The delimiters appear when your cursor enters the formatted text, and vanish when you move away.

| Format            | Syntax        | Shortcut (macOS) | Shortcut (Win/Linux) |
| ----------------- | ------------- | ---------------- | -------------------- |
| **Bold**          | `**text**`    | `Cmd+B`          | `Ctrl+B`             |
| *Italic*          | `*text*`      | `Cmd+I`          | `Ctrl+I`             |
| <u>Underline</u>  | `<u>text</u>` | `Cmd+U`          | `Ctrl+U`             |
| ~~Strikethrough~~ | `~~text~~`    | `Cmd+Shift+X`    | `Ctrl+Shift+X`       |
| ==Highlight==     | `==text==`    | `Cmd+Shift+H`    | `Ctrl+Shift+H`       |
| Superscript       | `^text^`      | —                | —                    |
| Subscript         | `~text~`      | —                | —                    |
| `Inline Code`     | `` `text` ``  | `Cmd+E`          | `Ctrl+E`             |
| [Link](url)       | `[text](url)` | —                | —                    |
| Inline Math       | `$formula$`   | Type `$...$`     | Type `$...$`         |

You can also apply formatting by selecting text and using the **Floating Toolbar** that appears above the selection. The toolbar includes buttons for Bold, Italic, Strikethrough, Highlight, Superscript, Subscript, Code, and more.

## Block Formatting

### Headings

Type `#` through `######` followed by a space to create headings H1–H6. You can also use shortcuts:

| Action         | macOS             | Windows/Linux       |
| -------------- | ----------------- | ------------------- |
| Heading 1      | `Cmd+1`           | `Ctrl+1`            |
| Heading 2      | `Cmd+2`           | `Ctrl+2`            |
| Heading 3      | `Cmd+3`           | `Ctrl+3`            |
| Heading 4–6    | `Cmd+4` – `Cmd+6` | `Ctrl+4` – `Ctrl+6` |

### Lists

| List Type    | How to Create             | Shortcut (macOS) | Shortcut (Win/Linux) |
| ------------ | ------------------------- | ---------------- | -------------------- |
| Bullet List  | Type `- ` or `* `         | `Cmd+Shift+8`    | `Ctrl+Shift+8`       |
| Ordered List | Type `1. `                | `Cmd+Shift+7`    | `Ctrl+Shift+7`       |
| Task List    | Type `- [ ] ` or `- [x] ` | `Cmd+Shift+9`    | `Ctrl+Shift+9`       |

Use `Tab` to indent and `Shift+Tab` to outdent list items.

### Folding (Headings & Lists)

Baram supports Obsidian-style folding for headings and nested list items.

**How it works:**

- **Headings**: Hover over any heading (H1–H6) to reveal a fold arrow in the gutter. Click the arrow or use the keyboard shortcut to collapse all content below that heading until the next heading of equal or higher level.
- **Nested lists**: List items that contain nested sub-lists show a fold arrow. Clicking it collapses the nested children.
- **Ellipsis indicator**: When a section is folded, a `...` badge appears after the heading or list item text, indicating hidden content. Click the `...` or the arrow to expand.

**Keyboard shortcuts:**

| Action      | macOS             | Windows/Linux      |
| ----------- | ----------------- | ------------------ |
| Toggle Fold | `Cmd+Shift+[`     | `Ctrl+Shift+[`     |
| Fold All    | `Cmd+Shift+Alt+[` | `Ctrl+Shift+Alt+[` |
| Unfold All  | `Cmd+Shift+Alt+]` | `Ctrl+Shift+Alt+]` |

**Key behaviors:**

- Fold state is **view-only** — it does not modify the markdown document, affect undo history, or change the saved file
- Fold state is **preserved per file** — when you switch tabs and come back, your folds are restored
- **Find & Replace** automatically unfolds a section if a search match is inside a folded region
- **TOC clicks** automatically unfold the target heading section

### Other Blocks

| Block             | How to Create                | Shortcut (macOS) | Shortcut (Win/Linux) |
| ----------------- | ---------------------------- | ---------------- | -------------------- |
| Blockquote        | Type `> `                    | `Cmd+Shift+B`    | `Ctrl+Shift+B`       |
| Horizontal Rule   | Type `---` and press Enter   | —                | —                    |
| Code Block        | Type ` ``` ` and press Enter | `Cmd+Alt+C`      | `Ctrl+Alt+C`         |
| Math Block        | Type `$$` and press Enter    | `Cmd+Shift+M`    | `Ctrl+Shift+M`       |
| Mermaid Diagram   | Slash command `/mermaid`     | `Cmd+Shift+D`    | `Ctrl+Shift+D`       |
| Table of Contents | Type `[TOC]` or `/toc`       | —                | —                    |
