---
title: "Themes"
---

Baram comes with 8 built-in themes and supports custom theme creation. To make a theme you can
give to others, see [Creating themes](/en/docs/customization/creating-themes/).

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

- Click **Import Theme...** to load a theme package or a color settings file — see [Install a theme from a file](#install-a-theme-from-a-file)
- Click **Export Colors** in the theme editor to save the current theme's colors as a `.json` file for sharing

## Export your look as a theme

**Export Look as Theme...** in the Appearance tab saves what you see now as a theme package
(`.zip`): the colors of the theme you are wearing, every
[dial](/en/docs/customization/settings-and-themes/#appearance-dials) and font setting (Font
Family, Code Font, Font Size, Line Height) that differs from Baram's default, and — if you tick
**Also suggest hiding the bars I hid** — the bars you have hidden. The screen lists all of this,
with the same names and values as the settings rows, before you export. Fill in the name and
every package detail to turn on **Export Theme Package**.

The theme's CSS and any font files it ships are not included, so a font setting that points at
one of those fonts shows **Not on this machine** for whoever installs the package. A package
that carries settings or hidden bars needs the Baram version you exported it from, or newer.

## Browse and install themes

**Browse Themes**, next to **Import Theme...** in **Settings > Appearance**, opens the theme
registry in place of the tab; **Back** returns to the gallery. Unlike plugins, themes have no
community channel: the list holds only themes Baram publishes itself. **Search themes...**
narrows it by name, description, author, id, or keyword, and **Refresh** loads it again. While
the registry lists no themes, the screen says **No themes are available yet**.

Each card shows the theme's name, version, description, and author, and — when the listing
provides one — a light and a dark preview drawn the same way as the gallery cards.

**Install** asks for the same consent as a package from a file: the dialog says the theme changes
the whole app's appearance, runs no code, and makes no network connection. Once you confirm,
Baram installs the theme and puts it on at once. The toast that says so has an **Undo** button,
which goes back to the theme you had before; the new theme stays installed. A theme that needs a
newer Baram is refused, and its card says *This theme needs Baram X.Y.Z or newer — update Baram
first.* with the version it needs.

A theme you already have reads **Installed** — or **Installed: v**… with the version you have,
when the registry lists another — and its button reads **Reinstall**. Updates are not made on
this screen: when the registry lists another version of a theme you installed from it, the
theme's gallery card shows **Update to v**…, and clicking it installs that version. A theme whose
listed version was pulled from the registry does not appear in this list, and a withdrawn version
is not offered as an update.

If a theme with the same id was installed from a file, the card says **A theme with this id is
installed from a file** and the button reads **Replace**. **Replace** asks first — *Replace '…'
v…, installed from a file, with v… from the theme registry? It will get updates from the registry
after that.* — and then asks for consent as usual. From then on the theme gets updates from the
registry. Until then, its gallery card carries a **From file** badge and shows no update.

## Install a theme from a file

**Import Theme...** takes two kinds of file: a theme package (`.zip`) and a color settings file
(`.json`, what **Export Colors** saves). Baram tells them apart by their content, not by the
extension. A package asks for the same consent as a theme from **Browse Themes**; the consent
title shows the package name followed by the file name. A theme installed from a file does not
receive updates from the theme registry. If a theme with the same id is already installed, Baram
asks before replacing it — showing both versions when that theme also came from a file, or
warning that it will stop receiving registry updates when it came from the registry. A package
over 32 MB and a color settings file over 64 KB are refused.

## When a theme suggests hiding bars

A theme can suggest hiding the activity bar, the status bar, or the tab bar. Baram applies the
suggestion when you put the theme on and each time Baram starts — but not to a bar you have
turned on or off yourself during the current session.

If you turn one of those bars back on, or off against the suggestion, Baram remembers that for
this theme and leaves that bar alone from then on, across restarts. Turning a bar on or off
yourself means the switches under **Settings > Layout > Show or Hide**, the shortcuts
(**Toggle Activity Bar**, **Toggle Status Bar**, **Toggle Tab Bar**), or the **Reveal hidden
bars** button; choosing a perspective does not count.

To take the theme's suggestion again, choose the theme in the gallery (installing it again does
the same): Baram forgets the bars you changed for it. The suggestion then applies the next time
the theme is put on — when Baram starts, or when you switch to it from another theme — except
that a bar you changed during the current session stays as it is until Baram restarts.
