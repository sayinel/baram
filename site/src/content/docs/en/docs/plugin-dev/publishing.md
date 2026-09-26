---
title: "Publishing a plugin"
---

## The committed seed

The seed exists so the repo has an offline, schema-correct `RegistryIndex`
fixture. A Rust drift-guard test (`test_committed_registry_seed_deserializes`)
deserializes it on every test run and fails if its shape stops looking like the
live registry — including a missing `trust`, since an entry without one
describes a plugin the app refuses to install.

**The seed's entries match the live registry's, and installing from a local
copy of it still fails — by design.** Each entry carries the version and
checksum the live `index.json` carries, and its `downloadUrl` points at the
live registry. The app
downloads archives only from under the registry it fetched the index from
(`registry_base` / `is_within_registry` in
`src-tauri/src/plugin/origin.rs`), so an app pointed at a local server (see
[Local testing](/en/docs/plugin-dev/registry-loading-and-testing/#local-testing))
lists those entries and refuses to install them. Use the seed to exercise the
marketplace **UI** — listing, capability and tier badges, the legacy state,
refresh — and dev-load from source (**Settings → Plugins → Developer**) to
exercise a plugin actually running. To exercise the install path itself, serve
the ZIPs next to your copy of the index and rewrite each `downloadUrl` to that
server.

Two further things the seed is **not**:

- It is not a byte-for-byte copy of the live index. It is Prettier-formatted
  (the live file is written by `update-registry-index.mjs`), and it holds only
  entries worth publishing — `baram-ai-summary` is absent because it is not
  published.
- A checksum is **not** filled in automatically. The release
  workflow clones `sayinel/baram-plugins` and updates only _that_ repo's
  `index.json`; nothing writes back here. After publishing a version, a
  maintainer copies the workflow's `sha256sum` output into this file by hand.
  Forgetting is now **reported but not blocked**: `validate-index.ts` warns on
  an all-zero checksum on every `npm run lint`, while still allowing a seed to
  name a release whose ZIP does not exist yet. The 64-hex shape check on its
  own could never see it, since zeros satisfy it.

## Publishing your own plugin

1. Create a GitHub repository for your plugin.
2. Build your plugin: `npm run build`.
3. Create a ZIP containing `baram-plugin.json`, your built `main` bundle
   (e.g. `dist/index.mjs`), and `assets/` (if any).
4. Create a GitHub Release with the ZIP as an asset, and compute its SHA-256
   checksum (e.g. `shasum -a 256 your-plugin-1.0.0.zip`).
5. Add a `RegistryEntry` to the `RegistryIndex` you're publishing to. ⚠️ Today
   that means the first-party registry only: Baram fetches a fixed URL and a
   self-hosted `index.json` cannot be pointed at (see *How Baram loads the
   registry*), so an entry in your own index reaches no users. Until community
   submissions open, the only way to hand someone a plugin is the **Developer**
   section of **Settings → Plugins** — which is development-builds only, so a
   user on a release build cannot load it at all. (First-party plugins in
   this repo don't add entries by hand: pushing a `plugin-<dir>-v<version>` tag
   drives [`sayinel/baram-plugins`](https://github.com/sayinel/baram-plugins)'
   `index.json` automatically, as described above.)

```json
{
  "id": "my-word-count",
  "name": "Word Count",
  "description": "Displays word and character count",
  "version": "1.0.0",
  "author": "Your Name",
  "license": "MIT",
  "downloadUrl": "https://sayinel.github.io/baram-plugins/plugins/my-word-count-1.0.0.zip",
  "checksum": "sha256-hash-of-zip",
  "capabilities": ["editor:readonly", "events", "statusbar"],
  "trust": "sandboxed",
  "keywords": ["word", "count"],
  "engines": { "baram": ">=0.5.0" }
}
```

`downloadUrl` has to sit under the registry's own base URL: the app downloads
archives only from under the registry it fetched the index from and refuses
any other host (`registry_base` / `is_within_registry` in
`src-tauri/src/plugin/origin.rs`). That is why the example points into
`sayinel.github.io/baram-plugins/plugins/` rather than at the GitHub Release
from step 4 — an entry naming the Release URL directly is listed and then
fails to install.
