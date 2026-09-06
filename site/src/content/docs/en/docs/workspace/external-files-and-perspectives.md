---
title: "External files and perspectives"
---

## Cross-Vault Wikilinks

To link to a file in a different vault, use the vault alias prefix:

```
[[alias::filename]]
```

- `alias` is the vault's short name as configured in **Settings > Vault > Alias**
- `filename` is the target file name (without `.md`)

Example: `[[work::meeting-notes]]` links to `meeting-notes.md` in the vault with alias `work`.

Cross-vault links appear with a distinct style and open the target in its own vault context. If the target vault is not currently open, Baram prompts you to open it.

## Opening External Files

You can open any `.md` file from outside your current vault using **File > Open File** (`Cmd+O` / `Ctrl+O`). The file opens as a **File context** tab with a 📎 icon and no sidebar — just the editor. This is useful for quick edits to files outside your workspace.

## Viewing Other File Types

Baram is a markdown editor, but it opens several other file types in place rather than handing
them to another application. Click one in the file tree, or use **File > Open File**.

| Type | Extensions | What you get |
| ---- | ---------- | ------------ |
| **PDF** | `.pdf` | A reader with page navigation, find, zoom, a page/highlight side panel, and text & area highlighting you can reference from your notes. The PDF file itself is never modified. See [PDF Reading & Highlights](/baram/en/docs/pdf/toolbar-zoom-and-find/). |
| **HTML** | `.html`, `.htm` | A rendered live preview by default, with a **Preview / Source** toggle in the corner. Switch to Source to edit the markup with syntax highlighting; saving works as it does for any file. The preview is sandboxed, so scripts in the file cannot reach your vault or the app. |
| **Images** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.ico`, `.webp`, `.avif` | A viewer that fits the image to the window without upscaling small ones. |
| **SVG** | `.svg` | The same viewer, rendered as vector — it stays sharp at any zoom. Scripts inside an SVG do not execute. |

Images and SVG are handled by **Media Viewer**, a plugin that ships with Baram. It is built on the
same public `viewer` extension point third-party plugins use, so a plugin can add a viewer for a
file type Baram does not handle itself — see the
[Plugin Development Guide](/baram/en/docs/plugin-dev/overview-and-capabilities/).

## Tab Tear-Off (Separate Window)

Drag any editor tab outside the tab bar to detach it into a separate window. The window operates independently with its own editor state. Drag the tab back into the tab bar to re-dock it.

## Perspectives

A **perspective** is a saved layout — sidebar panel, right panel, and theme — that you can restore in one keystroke. Baram ships four and you can add your own.

### Built-in Perspectives

| Perspective    | Shortcut (macOS) | Shortcut (Win/Linux) | Layout                                                        |
| -------------- | ---------------- | -------------------- | ------------------------------------------------------------ |
| Writing | `Cmd+Alt+1`      | `Ctrl+Alt+1`         | Editor focus — right panel closed                            |
| Zettel  | `Cmd+Alt+2`      | `Ctrl+Alt+2`         | Zettel hub (actions + inbox + MOCs + recent) — atomic Zettelkasten notes |
| Journal | `Cmd+Alt+3`      | `Ctrl+Alt+3`         | Calendar sidebar + today's journal + Memories view           |
| Skills  | `Cmd+Alt+4`      | `Ctrl+Alt+4`         | File tree + Properties panel — LLM Skills editing            |

> All four are customizable in **Settings > Keybindings** (category **Perspective**) and available from the **Perspective** menu. Switching to a space never force-closes an open folder tree.

### Custom Perspectives

Create your own in **Settings > Appearance**:

1. Arrange the layout you want (sidebar panel, right panel, theme)
2. Go to **Settings > Appearance** and click **Save Current Layout**
3. Give it a name

Custom perspectives can be renamed, deleted, and applied from the same Settings tab.

### Applying a Perspective

- **Keyboard shortcuts** — `Cmd+Alt+1` (Writing), `Cmd+Alt+2` (Zettel), `Cmd+Alt+3` (Journal), `Cmd+Alt+4` (Skills)
- **Perspective menu** — in the menu bar
- **Settings > Appearance** — for custom perspectives

---
