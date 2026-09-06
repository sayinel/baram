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
| `capabilities`  | string\[] | Required permissions — see [Capabilities](/baram/en/docs/plugin-dev/overview-and-capabilities/#capabilities)                   |

## Optional Fields

| Field              | Type      | Description                                                                                           |
| ------------------ | --------- | ----------------------------------------------------------------------------------------------------- |
| `dependencies`     | string\[] | Other plugin IDs this plugin depends on                                                               |
| `tiptapExtensions` | object\[] | Tiptap extensions exported by this plugin — see [Tiptap Extension plugins](/baram/en/docs/plugin-dev/commands-and-tiptap-extensions/#tiptap-extension-plugins) |
| `repository`       | string    | Source code URL                                                                                       |
| `homepage`         | string    | Documentation URL                                                                                     |
| `icon`             | string    | Emoji icon for the marketplace/dev-list                                                               |
| `keywords`         | string\[] | Search keywords                                                                                       |

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
