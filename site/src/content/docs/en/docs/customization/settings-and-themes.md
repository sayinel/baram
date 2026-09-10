---
title: "Settings and themes"
---


## Settings

Open Settings with `Cmd+,` (macOS) or `Ctrl+,` (Windows/Linux).

Available settings tabs, grouped by nav section:

| Group        | Tab              | What it holds                                                        |
| ------------ | ---------------- | --------------------------------------------------------------------------------------------------- |
| **General**  | **General**      | Startup behavior, auto-save, links, file snapshots, updates          |
| **General**  | **Editor**       | Typing, folding, vim mode                                            |
| **General**  | **Appearance**   | Theme, fonts, layout presets                                         |
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
