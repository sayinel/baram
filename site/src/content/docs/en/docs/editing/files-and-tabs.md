---
title: "Files, tabs, and saving"
---


## Creating and Opening Files

| Action         | macOS         | Windows/Linux  |
| -------------- | ------------- | -------------- |
| New File       | `Cmd+N`       | `Ctrl+N`       |
| Open File      | `Cmd+O`       | `Ctrl+O`       |
| Save           | `Cmd+S`       | `Ctrl+S`       |
| Save As        | `Cmd+Shift+S` | `Ctrl+Shift+S` |
| Close Tab      | `Cmd+W`       | `Ctrl+W`       |
| Quick Switcher | `Cmd+K`       | `Ctrl+K`       |

You can also open files from the file tree in the left sidebar, or use the **Quick Switcher** (`Cmd+K`) for fast file and heading navigation.

## Importing files by drag and drop

Drag files or folders from Finder or Explorer onto the file tree and Baram copies them into your
vault at the drop target. Folders are copied recursively.

- If a name is already taken, Baram picks a free one rather than overwriting anything.
- Symbolic links are skipped rather than followed, and Baram tells you how many it skipped — a
  count of copied files would otherwise be a true sentence about an incomplete copy.
- Dropping onto empty space below the tree — or onto a top-level row — lands at the vault root.

## Tabs

Baram supports multiple open files via tabs at the top of the editor.

- **Switch tabs** — Click on a tab, or use `Ctrl+Tab` / `Ctrl+Shift+Tab` for MRU (Most Recently Used) tab switching
- **Close tab** — Click the `×` on the tab, or press `Cmd+W`
- **Pin tab** — Right-click a tab and select "Pin Tab". Pinned tabs show as compact icons and can't be accidentally closed
- **Undo history preserved** — Each tab maintains its own undo/redo history, even when switching between tabs

## Quick Switcher

Press `Cmd+K` (macOS) or `Ctrl+K` (Windows/Linux) to open the Quick Switcher. Type to search for:

- **Files** — Quickly open any file in your workspace
- **Headings** — Type `#` to filter by heading, then jump directly to a heading in any file

## Auto-Save

Your documents are automatically saved as you type. A dot indicator on the tab shows unsaved changes — they are saved shortly after you stop typing.

## Undo and Redo

| Action | macOS         | Windows/Linux  |
| ------ | ------------- | -------------- |
| Undo   | `Cmd+Z`       | `Ctrl+Z`       |
| Redo   | `Cmd+Shift+Z` | `Ctrl+Shift+Z` |

---
