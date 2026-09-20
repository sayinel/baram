---
title: "Local development and bundling"
---

## Local development loop

**Settings → Plugins → Developer** lets you iterate on a plugin without
packaging or installing it:

- **Load dev plugin folder** — opens a native folder picker
  (`@tauri-apps/plugin-dialog`); pick any directory containing a
  `baram-plugin.json` + built `main` bundle. The plugin is registered as a
  dev plugin and loaded immediately.
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
