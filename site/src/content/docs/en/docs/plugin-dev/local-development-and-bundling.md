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
  pick up code changes without restarting the app. If the reloaded manifest
  declares `tiptapExtensions`, you'll see a toast reminding you a full
  restart is still required for schema changes (see above) — Reload alone
  never rebuilds the schema.
- **Remove** — unloads the plugin and forgets the dev folder (does not
  delete anything on disk).

Dev-loaded plugins **skip checksum verification** (there is no download URL
or checksum for a local folder) — this is a deliberate local-trust
shortcut, not a security check that was accidentally missed. See
[Trust model & security](/en/docs/plugin-dev/trust-model-and-errors/#trust-model--security).

## Bundling

Use esbuild to produce a single ESM bundle. **What you may leave external depends on your
tier**, and getting it wrong fails at activate rather than at build time:

**Sandboxed — bundle everything, no `--external` at all:**

```bash
npx esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs
```

A sandboxed plugin is imported from a `blob:` URL, and a blob module has **no base URL**, so
any bare `import` left in the output cannot resolve. Mark something external and the plugin
loads to a resolution error. (This tier also cannot use Tiptap at all — extensions are
injected into the main realm's ProseMirror instance, which is exactly what it has no access
to.)

**Trusted — keep `@tiptap/core` and `@tiptap/pm` external**, since the host provides them at
runtime and bundling them in would duplicate — and likely desync — the app's own ProseMirror
instance:

```bash
npx esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs \
  --external:@tiptap/core --external:@tiptap/pm
```

`package.json` script — `word-count` (sandboxed) and `ai-summary` (trusted) differ exactly
here, which is the difference worth copying carefully:

```json
{
  "scripts": {
    "build": "esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs"
  }
}
```

```json
{
  "scripts": {
    "build": "esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs --external:@tiptap/core --external:@tiptap/pm"
  }
}
```
