---
title: "Appearance and workspace"
---

## Themes & Appearance

### How do I change the theme?

Open **Settings > Appearance** (`Cmd+,`). You'll see a gallery of theme cards — click any card to apply it. Select **System (Auto)** to follow your OS light/dark mode setting.

### What built-in themes are available?

Baram includes 8 built-in themes: Default Light, Default Dark, Tokyo Night, Solarized Light, Solarized Dark, Nord, Baram Garden Light, and Baram Garden Dark. Built-in themes cannot be deleted.

### How do I create a custom theme?

1. Go to **Settings > Appearance** and click **Customize...**
2. Enter a name for your theme
3. Choose a base mode (Light or Dark) — this determines how code blocks and diagrams render
4. Adjust the 25 colors using the color pickers (Background, Text, Border, Accent, Editor, Status, Graph)
5. Click **Save**

Your custom theme appears in the gallery with a "Custom" badge.

### How do I share themes with others?

In the theme editor, click **Export** to save your theme as a `.json` file. Others can import it by clicking **Import Theme...** in the Appearance tab.

### How do I delete a custom theme?

Hover over a custom theme card in the gallery and click the **x** button. Built-in themes cannot be deleted.

---

## Keyboard Shortcuts

### Can I customize keyboard shortcuts?

Yes. Open **Settings > Keybindings** to see all shortcuts organized by category (File, Editing, Formatting, Blocks, View, Navigation, Tools, AI, Workspace). Click **Edit** on any shortcut, press the new key combination, and click **Apply**.

### What happens if I assign a key that's already in use?

Baram shows a conflict warning with the name of the command that already uses that key combination. You can choose to override (which removes the old binding) or cancel.

### Does Baram have Vim keybindings?

Yes — **Settings > Editor > Vim Keybindings**, off by default. One switch covers the WYSIWYG editor, Source Mode, and code blocks inside a document. Source Mode and code blocks get full vim (text objects, `.` repeat, `/` search, macros, registers); WYSIWYG has motions, operators with counts, `f`/`t`, `/` search, visual mode, and `:w` / `:q` / `:N` line jumps, but not yet text objects, `.` repeat, or marks. The status bar shows the mode and doubles as the `:` and `/` command line.

Vim commands work with the Korean IME active: in normal mode keys resolve by physical position, so `j` moves down even when it would type `ㅓ`. Vim key sequences are a separate layer and are not remappable in Settings > Keybindings. See the [full command list](/en/docs/customization/keyboard-shortcuts/#vim-mode).

### How do I reset a shortcut to its default?

Click the reset button (↺) next to any customized shortcut to restore its default key combination. To reset all shortcuts at once, click **Reset All** at the bottom of the Keybindings tab.

---

## Perspectives

### What is a perspective?

A perspective is a saved layout — sidebar panel, right panel, and theme — under a name you can apply later. Baram ships four (Writing, Zettel, Journal, Skills) and you can add your own.

### How do I switch perspectives?

Two ways:

1. **Keyboard shortcuts** — `Cmd+Alt+1` (Writing), `Cmd+Alt+2` (Zettel), `Cmd+Alt+3` (Journal), `Cmd+Alt+4` (Skills)
2. **Perspective menu** — in the menu bar

### Can I create my own?

Yes. Go to **Settings > Appearance**, arrange your layout, and click **Save Current Layout**. Custom perspectives can be renamed or deleted from the same tab.

---

## Vault & Context

### What is a vault?

A vault is a folder that contains a `.baram/config.json` file. When Baram detects this file, it treats the folder as a fully initialized workspace with vault-level settings, a configurable Journal directory, and a vault alias for cross-vault linking. A plain folder without `.baram/config.json` still works as a normal workspace — vaults simply unlock extra features.

To turn any folder into a vault, open it in Baram, then go to **Settings > Vault** and click **Initialize as Vault**.

### Can I use multiple vaults simultaneously?

Yes. Each vault (or plain folder) you open appears as a tab in the **Context Tab Bar** across the top of the window. Click any tab to switch between contexts. Each context has its own file tree, tab history, and settings.

### Why does Baram ask permission before opening a folder?

Baram reads and writes only where you have allowed it to. The first time you open a folder or a file it has not been allowed into, it asks — *Allow Baram to read and write this folder and everything under it?* An approved folder covers everything beneath it, so you are asked once per workspace rather than once per file; an approved single file also covers images sitting next to it, so the pictures in it still render.

Denying is not an error: the location simply does not open, and nothing is recorded, so you can choose it again later and be asked again. At startup, a saved context that is no longer approved is asked for again — deny it and only that one is skipped, while the rest of your workspace still restores.

Approvals are kept by Baram in its own application data directory, not inside your vault and not in any file the editor itself can write, so a document or a plugin cannot approve locations on your behalf.

### How do I see or undo what I have approved?

**Settings > Vault > Approved locations** lists every approved folder and file, each with a **Revoke** button. Revoking removes the approval and closes that vault's tab; it takes full effect after a restart.

> On macOS this is separate from the system's own Files and Folders prompt — see [macOS asks for folder access](/en/docs/faq/plugins-and-troubleshooting/#macos-asks-for-folder-access).

### How do I link files across vaults?

Use the cross-vault wikilink syntax: `[[alias::filename]]`. Replace `alias` with the target vault's short name (configured in **Settings > Vault > Alias**) and `filename` with the file name (without `.md`). For example, `[[research::climate-data]]` links to `climate-data.md` in the vault aliased `research`. If the target vault is not open, Baram prompts you to open it.

### What happens when I open a file outside a vault?

The file opens as a **File context** tab, indicated by a 📎 icon. The left sidebar is hidden — only the editor is shown. This is ideal for quick edits to files that don't belong to any workspace. There is no file tree, backlinks, or vault-level settings in this mode.

### How do I convert a folder to a vault?

1. Open the folder in Baram with **File > Open Folder**
2. Go to **Settings > Vault**
3. Click **Initialize as Vault**

Baram creates a `.baram/config.json` file inside the folder. Your existing files are not changed. To revert back to a plain folder, click **Revert to Folder** — this removes `.baram/config.json` but leaves all your markdown files intact.

### How is Journal related to vaults?

Each vault can have its own journal directory set in **Settings > Vault > Journal Directory**. When you are working in a vault context, the Calendar sidebar and @mention date chips (Today/Yesterday/Tomorrow) create journal entries in that vault's configured directory. Switching vault contexts switches the active journal, so you can maintain separate journals per vault (e.g., personal vs. work).

---
