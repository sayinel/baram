---
title: "Overview and capabilities"
---

## Overview

A Baram plugin is a directory containing a manifest (`baram-plugin.json`) and
a single ESM bundle (typically `dist/index.mjs`). The bundle exports an
`activate(context)` function (and optionally `deactivate()`); the host calls
`activate` with a capability-gated `ExtensionContext` object that is the
plugin's only way to touch the app.

Every plugin declares one of two tiers in its manifest, and the tier decides what
"capability" means:

- **`"trust": "sandboxed"`** — the default, and what you should write. The plugin runs in
  its own isolated webview with no access to the app's JavaScript, and every privileged
  operation goes through a Rust broker that authorizes the call against the plugin's
  granted capabilities. Here the capability list is a **real boundary**.
- **`"trust": "trusted"`** — the same JavaScript context as the editor, Obsidian's model.
  Necessary for `tiptapExtensions`, which need direct access to the live ProseMirror
  `Schema` that an isolated plugin cannot be given. Here the capability system is only an
  **API gate**: the plugin can reach around it, so the list describes intent rather than
  limiting anything. Installing one requires an explicit acknowledgement of exactly that.

Write sandboxed unless you are contributing a Tiptap extension or DOM-mounted UI. See
[Trust model & security](/baram/en/docs/plugin-dev/trust-model-and-errors/#trust-model--security) before installing or authoring anything
sensitive.

## Capabilities

Plugins must declare every capability they need in the manifest. Users
approve these at install time (registry installs) or implicitly by choosing
to load a dev folder (see [Trust model & security](/baram/en/docs/plugin-dev/trust-model-and-errors/#trust-model--security)).
Accessing an API whose capability was not declared throws a clear error
("Plugin requires `"X"` capability to access …") instead of silently no-oping
— the context hands back a denied proxy for any ungranted API.

| Capability        | Description                             | Sensitivity   |
| ----------------- | --------------------------------------- | ------------- |
| `commands`        | Register and execute editor commands    |               |
| `editor`          | Read and modify document content        |               |
| `editor:readonly` | Read document content (no modification) |               |
| `events`          | Listen to editor events                 |               |
| `files`           | Read and write files in the vault       | sensitive     |
| `files:readonly`  | Read files in the vault (no writing)    |               |
| `sidebar`         | Add panels to the sidebar               |               |
| `statusbar`       | Display items in the status bar         |               |
| `settings`        | Declare options in the settings screen  |               |
| `ai`              | Access AI/LLM features                  | **sensitive** |
| `network`         | Make network requests                   | **sensitive** |
| `storage`         | Use a plugin-private key/value store    | sensitive     |
| `viewer`          | Register custom file-type viewers       |               |

`ai` and `network` are the highest-sensitivity capabilities — see
[Trust model & security](/baram/en/docs/plugin-dev/trust-model-and-errors/#trust-model--security) for exactly what they allow.
`files` and `storage` are also flagged because they touch data outside the
plugin's own memory (vault files / a persistent on-disk store), even though
they're vault- or plugin-scoped rather than globally unrestricted.
