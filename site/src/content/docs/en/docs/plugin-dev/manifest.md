---
title: "The plugin manifest"
---


```json
{
  "id": "my-word-count",
  "name": "Word Count",
  "description": "Displays word and character count in the status bar",
  "version": "1.0.0",
  "author": "Your Name",
  "license": "MIT",
  "main": "dist/index.mjs",
  "engines": {
    "baram": ">=0.5.0"
  },
  "trust": "sandboxed",
  "capabilities": ["editor:readonly", "events", "statusbar"],
  "contributions": {
    "statusBar": [{ "id": "count", "text": "— words" }]
  },
  "keywords": ["word", "count", "statistics"],
  "repository": "https://github.com/user/my-word-count",
  "homepage": "https://example.com"
}
```

## Required Fields

| Field           | Type      | Description                                                                |
| --------------- | --------- | -------------------------------------------------------------------------- |
| `id`            | string    | Unique identifier. Lowercase letters, digits, hyphens only.                |
| `name`          | string    | Human-readable display name                                                |
| `description`   | string    | Short description                                                          |
| `version`       | string    | Semver version                                                             |
| `author`        | string    | Author name                                                                |
| `license`       | string    | SPDX license identifier                                                    |
| `main`          | string    | Entry point file, relative to the plugin directory (e.g. `dist/index.mjs`) |
| `engines.baram` | string    | Minimum Baram version, written `>=X.Y.Z` — see [Version floor](#version-floor)  |
| `capabilities`  | string\[] | Required permissions — see [Capabilities](/en/docs/plugin-dev/overview-and-capabilities/#capabilities)                   |

## Optional Fields

| Field              | Type      | Description                                                                                           |
| ------------------ | --------- | ----------------------------------------------------------------------------------------------------- |
| `contributions`    | object    | What the app draws for the plugin — commands, status-bar items, settings, right-click and slash items — see [Contributions](#contributions) |
| `dependencies`     | string\[] | Other plugin IDs this plugin depends on                                                               |
| `tiptapExtensions` | object\[] | Tiptap extensions exported by this plugin — see [Tiptap Extension plugins](/en/docs/plugin-dev/commands-and-tiptap-extensions/#tiptap-extension-plugins) |
| `repository`       | string    | Source code URL                                                                                       |
| `homepage`         | string    | Documentation URL                                                                                     |
| `icon`             | string    | Emoji icon for the marketplace/dev-list                                                               |
| `keywords`         | string\[] | Search keywords                                                                                       |

## Contributions

`contributions` is data: Baram reads it from the manifest and draws it itself — no plugin code
runs to put an item on screen.

| Key         | Each entry                              | At most |
| ----------- | --------------------------------------- | ------- |
| `commands`  | `{ id, title, palette? }`               | 50      |
| `statusBar` | `{ id, text, tooltip?, command? }`      | 5       |
| `settings`  | a settings field                        | 16      |
| `menu`      | `{ id, command, title?, when? }`        | 5       |
| `slash`     | `{ id, command, title?, description? }` | 10      |

`menu` adds items to the editor's right-click menu, and `slash` adds items to the slash menu.
Each names one of your `commands` by its `id` and shows that command's `title`, unless it has a
`title` of its own (1–64 characters). A slash item's `description` is 1–120 characters. `when`
is either left out — the item always shows — or `"selection"`, and then the item shows only
while text is selected. Neither appears in source mode.

```json
{
  "contributions": {
    "commands": [{ "id": "cite", "title": "Insert citation" }],
    "menu": [{ "id": "cite", "command": "cite", "when": "selection" }],
    "slash": [
      { "id": "cite", "command": "cite", "description": "Insert a citation at the caret" }
    ]
  }
}
```

There is no field for a keyboard shortcut. While the plugin is on, its commands are listed
under **Plugins** in **Settings > Keybindings** with no key, for the user to assign one. A
trusted plugin also needs the `commands` capability and registers each declared command — see
[Command palette and Tiptap extensions](/en/docs/plugin-dev/commands-and-tiptap-extensions/).

## Version floor

`engines.baram` is the oldest Baram your plugin runs on, and it is **enforced**: Baram
refuses to install or update to a version whose floor it does not meet, and says which
version is needed. Getting it wrong is not cosmetic — declaring a floor higher than
necessary makes your plugin uninstallable for users who could have run it.

Write it as `>=X.Y.Z`, with all three numbers:

```json
{ "engines": { "baram": ">=0.5.0" } }
```

That is the only form both Baram and the publish workflow read. Anything else — `^0.5.0`,
`~0.5`, `0.5.0`, a two-bound range — is treated by the app as *no floor stated*, so it
silently stops protecting your users; the publish workflow rejects it outright, so a
first-party release never ships that way. A prerelease build (`0.6.0-beta.1`) does not
satisfy `>=0.6.0`, per semver.
