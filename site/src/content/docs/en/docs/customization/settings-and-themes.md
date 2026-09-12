---
title: "Settings and themes"
---


## Settings

Open Settings with `Cmd+,` (macOS) or `Ctrl+,` (Windows/Linux).

Available settings tabs, grouped by nav section:

| Group        | Tab              | What it holds                                                        |
| ------------ | ---------------- | --------------------------------------------------------------------------------------------------- |
| **General**  | **General**      | Startup behavior, auto-save, links, file snapshots, updates          |
| **General**  | **Editor**       | Fonts, typing behavior, vim mode, editor width                      |
| **General**  | **Appearance**   | Theme gallery, custom themes, layout presets                         |
| **General**  | **Markdown**     | Serialization rules                                                  |
| **General**  | **Language**     | UI language                                                          |
| **General**  | **Keybindings**  | Shortcut customization                                               |
| **Features** | **Journal**      | Enable Journal, its directory, templates, periodic notes             |
| **Features** | **Zettel**       | Enable Zettel, its directory, startup action, home note              |
| **Features** | **Tasks**        | Enable Tasks, tasks home, capture, agenda scope                      |
| **Features** | **AI**           | Enable AI, provider, models, privacy, Ghost Text                     |
| **System**   | **Activity Bar** | Which icons show, and in what order                                  |
| **System**   | **Plugins**      | Install, enable, and configure plugins                               |
| **System**   | **Vault**        | Initialize vaults, approved folders                                  |

Each feature tab (Journal, Zettel, Tasks, AI) carries its **Enable** toggle at the top; turning a feature off dims its tab instead of removing it, so it can always be turned back on.

Turning a feature off also hides the surfaces it owns — its Activity Bar icons, its slash-menu group, and its Command Palette entries all disappear, and for AI the ✨ buttons go with them. Its keyboard shortcuts stay bound: pressing one tells you the feature is off rather than doing nothing.

## Themes

Baram comes with 8 built-in themes and supports custom theme creation.

**Built-in themes:**

| Theme              | Style                                 |
| ------------------ | ------------------------------------- |
| Default Light      | Clean light theme (default)           |
| Default Dark       | Dark theme with blue tones            |
| Tokyo Night        | Popular dark theme, cool blue palette |
| Solarized Light    | Ethan Schoonover's warm light palette |
| Solarized Dark     | Ethan Schoonover's dark palette       |
| Nord               | Arctic-inspired dark theme            |
| Baram Garden Light | Warm, garden-inspired light theme     |
| Baram Garden Dark  | Warm, garden-inspired dark theme      |

**Using themes:**

1. Open **Settings > Appearance** to see the theme gallery
2. Click any theme card to apply it immediately
3. Select **System (Auto)** to follow your OS light/dark mode

**Creating custom themes:**

1. Click **Customize...** in the Appearance tab
2. Edit the theme name and choose a base mode (Light or Dark)
3. Adjust any of the 25 color values using the color pickers (grouped by Background, Text, Border, Accent, Editor, Status, and Graph)
4. Colors update live as you pick — preview changes in real-time
5. Click **Save** to keep the theme, or **Cancel** to discard

**Import / Export:**

- Click **Import Theme...** to load a `.json` theme file
- Click **Export** in the theme editor to save the current theme as a `.json` file for sharing

## Fonts

Fonts live in **Settings > Editor**, under the **Font** heading. They change the editor, not
the app's own interface.

Baram ships two faces, so a document looks the same on macOS, Windows, and Linux:
**Pretendard Variable** for body text and **JetBrains Mono Variable** for code. Both are
licensed under the SIL Open Font License 1.1; **Baram > About Baram > Bundled fonts >
View font licenses** shows the full text of each.

### Two slots

| Slot     | Setting         | What it covers                     |
| -------- | --------------- | ---------------------------------- |
| **Body** | **Font Family** | Editor body text                   |
| **Code** | **Code Font**   | Code blocks, math, and inline code |

Each slot shows its family with a preview strip at the real size, and a badge saying where
that family comes from:

| Badge                   | Meaning                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| **Included**            | One of the faces Baram ships, so it is present on every machine                                |
| **System**              | Found among this machine's installed fonts (**System · Korean** when it also covers Hangul)    |
| **Not on this machine** | The name is saved, but nothing here can render it — the text falls back to another face        |

The badge is the reason the row looks the way it does: a font that is not installed still
renders through a fallback, which used to make a broken choice look like a working one.

### The font browser

Click the family name, or **Browse…**, to open a two-pane browser. **Body** and **Code**
tabs switch slots without leaving it.

The left pane lists families in three groups — **Included**, **Recent**, and **Installed** —
each name drawn in its own face. **Search** narrows the list by name, and the count tells
you how many of the total still match. The **Korean** and **Monospace** chips narrow it
further, with one twist: the code slot starts out monospace-only, so there the Monospace
chip works in reverse and releases the list to every family. **Refresh** re-reads the
machine's fonts after you install one — and when they cannot be read at all, the browser
says so and falls back to the bundled families rather than showing an empty pane.

The right pane previews body and code together, in Latin, Hangul, and the glyphs that
typefaces most often disagree about. It carries the same size and line-height sliders as the
settings rows — one setting seen from two places, not two settings.

To use a family Baram did not find, click the pencil beside the slot and type the name. It
is saved exactly as typed, and carries the **Not on this machine** badge if nothing can
render it.

### Size and spacing

**Font Size** (8–32px) and **Line Height** (1.0–3.0) apply to body text. **Match Body Text**
derives the code size and line height from them; turn it off and the two code sliders below
become editable. Either way the sliders keep showing the values code is actually rendering
at, so the answer to "how big is my code right now?" is always on screen.
