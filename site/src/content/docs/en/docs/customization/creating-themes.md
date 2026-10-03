---
title: "Creating themes"
---

A theme you can give to others is a package: one `.zip` file that anyone installs with **Import
Theme...**. This page covers what goes in it, what Baram checks when it installs one, and how to
test and share it. Choosing and installing themes is on [Themes](/en/docs/customization/themes/).

## The package

- `baram-theme.json`, the manifest, at the **root** of the zip. A package whose manifest sits
  inside a folder is refused.
- For each mode, a `tokens.json` with the colors, a CSS file, or both. The manifest names their
  paths, relative to the root of the package. Packages Baram exports use `light/tokens.json` and
  `dark/tokens.json`.

## The manifest

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "description": "Warm paper tones for long reading.",
  "author": "Your Name",
  "license": "MIT",
  "version": "1.0.0",
  "engines": { "baram": ">=0.7.6" },
  "modes": {
    "light": { "tokens": "light/tokens.json", "css": "theme.css" },
    "dark": { "tokens": "dark/tokens.json", "css": "theme.css" }
  },
  "dials": { "density": "compact", "editorFontSize": 17 },
  "chrome": { "statusBar": false }
}
```

| Field | Required | What it holds |
| ----- | -------- | ------------- |
| `id` | Yes | Lowercase letters, digits, and `-` only. Installing a theme whose id you already have replaces that theme, after Baram asks. Reserved — the built-in themes' ids and `system`: `default-light`, `default-dark`, `tokyo-night`, `solarized-light`, `solarized-dark`, `nord`, `baram-garden-light`, `baram-garden-dark`, and `system` |
| `name`, `description` | Yes | At most 100 characters each, with no control or bidi-override characters |
| `author`, `license`, `version` | Yes | Text. The gallery card shows the author and the version |
| `engines.baram` | Yes | The oldest Baram the theme needs, written `>=X.Y.Z`; older versions refuse to install it. Baram reads only this form — anything else counts as no minimum |
| `modes` | Yes | `light`, `dark`, or both, each with a `tokens` path, a `css` path, or both |
| `dials` | No | Appearance settings the theme suggests — [below](#suggested-settings) |
| `chrome` | No | Bars the theme suggests hiding: `activityBar`, `statusBar`, and `tabBar`, each `false` to suggest hiding it or `true` to suggest showing it. What people see is on [Themes](/en/docs/customization/themes/#when-a-theme-suggests-hiding-bars) |

A manifest that declares `capabilities` or `main` is refused — those fields belong to plugins.

## Colors

Each mode's `tokens.json` is a JSON object that gives the theme editor's 25 colors by their CSS
variable names, as opaque hex colors (`#rgb` or `#rrggbb`) — for example
`"--color-bg-default": "#fbf9f4"`. The names are easiest to get from an exported package. If a
color is missing or a value is not such a hex color, Baram drops that mode's colors when it
installs the theme, without an error, and Baram's default colors show instead. The one exception
is `--color-editor-guide-tint` (**List Guide**): when it is missing, it takes the value of
`--color-editor-text`.

## Suggested settings

`dials` suggests values for appearance settings. A suggested value shows **Theme** in its
settings row, and a value the user sets wins over it. What each setting does is under
[Appearance dials](/en/docs/customization/settings-and-themes/#appearance-dials) and
[Fonts](/en/docs/customization/settings-and-themes/#fonts).

| `id` | Setting | Value |
| ---- | ------- | ----- |
| `accentHueShift` | **Accent hue** | -180 to 180 |
| `accentSaturationShift` | **Accent saturation** | -50 to 50 |
| `backgroundContrastLight` | **Light background contrast** | `"default"`, `"flat"`, `"white"` (All white) |
| `backgroundContrastDark` | **Dark background contrast** | `"default"`, `"flat"`, `"black"` (True black) |
| `density` | **Density** | `"compact"`, `"default"`, `"spacious"` |
| `cornerRadius` | **Corners** | `"sharp"`, `"default"`, `"round"` |
| `editorLineBreak` | **Line breaking** | `"normal"` (Default), `"keepAll"` (Keep words whole (Korean)) |
| `editorLetterSpacing` | **Letter spacing** | -0.05 to 0.1 (em) |
| `editorParagraphSpacing` | **Paragraph spacing** | 0 to 2 (em) |
| `editorEmphasisStyle` | **Emphasis style** | `"italic"`, `"color"` (Accent colour), `"weight"` (Bolder) |
| `editorMaxWidth` | **Line width** | 0 to 4000 (px; 0 is no limit) |
| `editorPadding` | **Editor padding** | 0 to 16 (rem) |
| `editorListGuideStrength` | **List guide strength** | 0 to 40 |
| `editorOrderedMarkerAlign` | **List number alignment** | `"number"` (Align numbers), `"period"` (Align periods) |
| `editorFontFamily` | **Font Family** | A family name, up to 128 characters |
| `editorCodeFontFamily` | **Code Font** | A family name, up to 128 characters |
| `editorFontSize` | **Font Size** | 8 to 32 (px) |
| `editorLineHeight` | **Line Height** | 1 to 3 |

An id this Baram does not know, or a value it does not accept, is dropped when the theme
installs, without an error — and updating Baram later does not bring it back; install the theme
again. The same goes for `chrome`: a bar name Baram does not know, or a value that is not `true`
or `false`, is dropped.

## Theme CSS

- Baram wraps your stylesheet in a cascade layer, `@layer baram-theme`. Baram's own component
  styles are outside any layer, and in the CSS cascade a rule outside a layer beats one inside, so
  where both set the same property on the same element, Baram's rule wins.
- Set colors in `tokens.json`, not in CSS. Baram declares the 25 color variables, and the colors
  it derives from them, on the root element outside any layer — and when a mode's colors come from
  `tokens.json`, it writes them inline there too — so declaring them on `:root` or `html` in your
  CSS has no effect.
- A theme cannot use `!important`: installing removes it, and a stylesheet where some is left is
  refused.
- Images and fonts your CSS refers to (`url()` and the like) must be files in the package,
  referred to by a relative path. Installing copies them into the stylesheet. Allowed types:
  `.gif`, `.jpeg`, `.jpg`, `.otf`, `.png`, `.svg`, `.ttf`, `.webp`, `.woff`, `.woff2`.
- Refused: `@import`; an address outside the package, such as `https:` or a `data:` URI you write
  yourself; a path that contains `#`, `?`, `%`, or `\`, starts with `/`, or leads out of the
  package; an address built with `var()`, `env()`, or `attr()`; a file the package does not have.
- Start nested style rules with `&` (`.card { & .title { … } }`): Baram cannot read other nested
  style rules, and a stylesheet it cannot read is refused — as is one with a block left unclosed.

| What | Limit | Over the limit |
| ---- | ----- | -------------- |
| The package (`.zip`) | 32 MiB | Refused |
| `baram-theme.json` | 64 KiB | Refused |
| One mode's stylesheet, as written | 512 KiB | Refused |
| The files one mode's stylesheet refers to, together — each file counted once | 2 MiB | Refused |
| One mode's stylesheet with those files copied in | 4 MiB | Refused |
| One mode's `tokens.json` | 64 KiB | That mode's colors are dropped |

## Three ways to start

- **Export your look.** **Export Look as Theme...** in **Settings > Appearance** saves the colors
  you are wearing, the dial and font settings that differ from Baram's defaults, and — if you
  ask — the bars you hid, as a package;
  see [Export your look as a theme](/en/docs/customization/themes/#export-your-look-as-a-theme).
  Unzip it and edit from there.
- **Start from the theme editor.** In **Customize...**, fill in the package details and click
  **Export Theme Package** to save the palette you are editing as a package with colors only.
  **Export Colors** saves the same colors as a color settings file instead — **Import Theme...**
  takes it, but it is not a package: it has no id, version, or license.
- **Write it by hand**, following this page. Baram Hangul's source in
  [`examples/themes/hangul/`](https://github.com/sayinel/baram/tree/main/examples/themes/hangul)
  is a complete example: `baram-theme.json` and the two `tokens.json` files are what its package
  holds, and the `README.md` and `SHA256SUMS` beside them are notes for Baram's maintainers.

## Test your theme

Install the package with **Import Theme...** in **Settings > Appearance** — see [Install a theme
from a file](/en/docs/customization/themes/#install-a-theme-from-a-file). Baram does not reload a
theme from a folder as you edit it: change the files, zip them again with `baram-theme.json` at
the root, and install the package again. Because the id is the same, Baram asks before it
replaces the installed copy. If text in the theme's colors falls below the AA contrast minimum,
the install toast says how many text pairs do — a note, not a refusal.

## Share your theme

Give people the `.zip` file; they install it with **Import Theme...**. **Browse Themes** lists
only themes Baram publishes, and the community list that carries plugins does not take themes.
