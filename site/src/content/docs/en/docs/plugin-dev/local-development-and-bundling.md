---
title: "Local development and bundling"
---

## Local development loop

**Settings → Plugins → Developer** lets you iterate on a plugin without
packaging or installing it.

**Developer mode.** A release build keeps folder loading off until you turn on
**Developer mode** in that section; Baram shows a warning first. While it is on:

- only a `trust: "sandboxed"` plugin loads from a folder — a `trusted` manifest
  is refused with "Release builds can only load sandboxed plugins from a folder";
- a plugin's storage (`~/.baram/plugin-data/<id>`) is keyed by its id, so a
  folder cannot take an id that belongs to someone else: not one starting with
  `baram-` (reserved for Baram's own plugins — the examples in this repository
  all use `baram-` ids, so copy one and change its `id` first), not the id of a
  plugin you have installed, and not an id whose storage another plugin left
  behind (uninstalling keeps `plugin-data/<id>`). Baram records the id of each
  folder it loads, so your own plugin's storage does not block it next time.
  While a folder holds an id, installing that id from the marketplace is refused;
- each folder asks for its capabilities before its code runs — the same dialog an
  install shows — and Baram records the answer. A later build that asks for more
  is asked about again when you press **Reload**;
- the revocation list applies to a folder's plugin by its id.

Turning it off unloads the folders' plugins and keeps the list for next
time. Turning it off or removing a folder does not delete what the folder's
plugin stored in `~/.baram/plugin-data/<id>`: a plugin you later install
with the same id starts with that data, so delete the directory first if
you do not want that. A development build (`npm run tauri dev`) has no
switch: developer mode is always on there, a `trusted` folder loads, a
folder may stand in for an installed plugin of the same id (how you develop
the next version of a published one), none of the id rules above apply, and
nothing asks.

- **Load dev plugin folder** — opens a native folder picker. Pick a directory
  containing a `baram-plugin.json` + built `main` bundle; it joins the list and
  loads immediately. Picking is the only way onto the list — Baram keeps it in its
  own `plugin-dev.json`, a file separate from the app's settings (`config.json`).
- **Reload** — re-reads the manifest from disk and reloads the plugin's
  module (unload the old instance, re-`import()` the bundle, re-run
  `activate`). Use this after rebuilding your bundle (`npm run build`) to
  pick up code changes without restarting the app. A changed `tiptapExtensions`
  contribution takes effect the same way — unload removes the old
  contribution's ProseMirror plugin from the editor, and the fresh `activate`
  installs the new one (see above). No restart, and nothing schema-related
  to wait on.
- **Remove** — unloads the plugin and forgets the dev folder (does not
  delete anything on disk).

Dev-loaded plugins **skip checksum verification** (there is no download URL
or checksum for a local folder) — this is a deliberate local-trust
shortcut, not a security check that was accidentally missed. See
[Trust model & security](/en/docs/plugin-dev/trust-model-and-errors/#trust-model--security).

## Bundling

Use esbuild to produce a single ESM bundle. **Bundle everything. Leave nothing external,
in either tier:**

```bash
npx esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs
```

A bare specifier like `@tiptap/pm/state` needs an import map to resolve, and the app
declares none — so whatever you mark external stays in the output as an import nothing can
satisfy, and the plugin fails to load at all. A sandboxed plugin is additionally imported
from a `blob:` URL, which has **no base URL**, so not even a relative import would resolve
there.

**Getting ProseMirror.** A plugin that contributes to the editor does not import it —
`ctx.pm` carries the app's own `Decoration`, `DecorationSet`, `Plugin` and `PluginKey`.
That is not a convenience: a second copy of prosemirror-view does not interoperate with
the app's, and the crash it produces is silent until something else is also decorating.
See [Build with `ctx.pm`](/en/docs/plugin-dev/commands-and-tiptap-extensions/#build-with-ctxpm-never-with-your-own-import).
The sandboxed tier cannot contribute to the editor at all, so the question does not arise
there.

A plugin built this way needs no `@tiptap` dependency:
`examples/plugins/bullet-threading` produces a bundle with no ProseMirror in it, and a
test asserts that.

`package.json` script — the same one for every tier:

```json
{
  "scripts": {
    "build": "esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs"
  }
}
```
