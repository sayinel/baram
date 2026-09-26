---
title: "Settings and themes"
---


## Settings

Open Settings with `Cmd+,` (macOS) or `Ctrl+,` (Windows/Linux).

Available settings tabs, grouped by nav section:

| Group        | Tab              | What it holds                                                        |
| ------------ | ---------------- | --------------------------------------------------------------------------------------------------- |
| **General**  | **General**      | Startup behavior, auto-save, links, file snapshots, updates          |
| **General**  | **Editor**       | Fonts, typing behavior, vim mode, and [document dials](#appearance-dials) — width, spacing, line breaking, emphasis, lists |
| **General**  | **Appearance**   | Theme gallery, custom themes, and [accent, background, density, and corner dials](#appearance-dials) |
| **General**  | **Markdown**     | Extended syntax, typography ([smart punctuation and symbol suggestions](/en/docs/editing/symbols-and-punctuation/)), code block and diagram options |
| **General**  | **Language**     | UI language                                                          |
| **General**  | **Keybindings**  | Shortcut customization                                               |
| **Features** | **Journal**      | Enable Journal, its directory, templates, periodic notes             |
| **Features** | **Zettel**       | Enable Zettel, its directory, startup action, home note              |
| **Features** | **Tasks**        | Enable Tasks, tasks home, capture, agenda scope                      |
| **Features** | **AI**           | Enable AI, provider, models, privacy, Ghost Text                     |
| **System**   | **Layout**       | Show/hide the activity bar, status bar, and tab bar; perspective presets; activity bar icon order |
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

## Appearance dials

A dial adjusts one part of how Baram looks. A dial you have changed shows **Custom** and a
revert button that puts just that dial back, without touching the others. A dial your theme
suggests a value for shows **Theme**. A dial with no badge is on Baram's default and writes
nothing, so the theme and stylesheet decide.

**Settings > Appearance** changes the whole app:

| Dial                          | Choices                      | What it changes                                                                                  |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| **Accent hue**                | −180° to +180°               | Turns the current theme's accent color around the color wheel                                    |
| **Accent saturation**         | −50% to +50%                 | Makes the accent more or less vivid                                                              |
| **Light background contrast** | Default · Flat · All white   | In light mode, how far the sidebars, activity bar, tab bar, and status bar stand apart from the document |
| **Dark background contrast**  | Default · Flat · True black  | The same, in dark mode                                                                           |
| **Density**                   | Compact · Default · Spacious | Spacing in and around interface elements                                                         |
| **Corners**                   | Sharp · Default · Round      | How rounded buttons, panels, and fields are; pills and circles keep their shape                  |

The accent dials shift the theme's own accent rather than replacing it, so the same shift
carries over when you change themes. **Flat** gives the bars the document's color; **All
white** and **True black** paint the document and the bars alike. Each background dial acts
only in its own mode, so with **System (Auto)** the matching one takes over when your OS
switches.

**Settings > Editor**, under **Display**, changes the document:

| Dial                      | Choices                              | What it changes                                                             |
| ------------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| **Line breaking**         | Default · Keep words whole (Korean)  | Keeps a Korean word on one line instead of breaking it; long URLs still wrap |
| **Letter spacing**        | −0.05em to +0.1em                    | Space between characters                                                    |
| **Paragraph spacing**     | 0 to 2em                             | Space between paragraphs                                                    |
| **Emphasis style**        | Italic · Accent colour · Bolder      | How `*emphasis*` is drawn                                                   |
| **Line width**            | 20–120 characters, or up to 4000px; the far left is no limit | Maximum content width. Shown in characters measured from your body font (the Hangul 가 in Korean, a–z in English), or switch the row to px |
| **Editor padding**        | 0 to 16rem                           | Space around the content                                                    |
| **List guide strength**   | 0 to 40                              | How strongly the indent guide in nested lists stands out; 0 hides it        |
| **List number alignment** | Align numbers · Align periods        | Which edge list numbers grow from                                           |

**Density** and **Corners** leave paragraph spacing and editor padding alone — those are the
editor dials. The list guide's color is a theme color (**List Guide** in the theme editor);
the dial only sets how strongly it shows.

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
| **From theme**          | Declared by the theme you are wearing, which ships the font file itself                     |
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
further. On the code slot the Monospace chip starts out already on, because that slot is
monospace-only by default — so there it is turning the chip *off* that widens the list to
every family. **Refresh** re-reads the machine's fonts after you install one, and when they
cannot be read at all the browser says so and falls back to the bundled families rather
than showing an empty pane.

The right pane previews body and code together, in Latin, Hangul, and the glyphs that
typefaces most often disagree about. It carries the same size and line-height sliders as the
settings rows — one setting seen from two places, not two settings.

To use a family Baram did not find, click the pencil beside the slot and type the name. It
is saved as written once surrounding whitespace is dropped, and carries the **Not on this
machine** badge if nothing can render it.

### Size and spacing

**Font Size** (8–32px) and **Line Height** (1.0–3.0) apply to body text. **Match Body Text**
derives the code size and line height from them; turn it off and the two code sliders below
become editable. Either way the sliders keep showing the values code is actually rendering
at, so the answer to "how big is my code right now?" is always on screen.

Your theme can suggest the body font, the code font, the font size, and the line height. Those
rows then show **Theme**, and changing one shows **Custom** with a revert button, the same as the
dials under **Display**.
