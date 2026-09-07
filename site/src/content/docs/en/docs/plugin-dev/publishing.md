---
title: "Publishing a plugin"
---

## The committed seed

The seed exists so the repo has an offline, schema-correct `RegistryIndex`
fixture. A Rust drift-guard test (`test_committed_registry_seed_deserializes`)
deserializes it on every test run and fails if its shape stops looking like the
live registry — including a missing `trust`, since an entry without one
describes a plugin the app refuses to install.

**Installing from the seed does not work right now, and not because of the
seed.** The seed names the **next** release (`baram-word-count` 2.1.0) with a
`checksum` of **64 zeros**, so an install attempt fails on the missing ZIP until
that release ships. Older published ZIPs are no help either: §260's tier model
requires every manifest to declare `trust`, and everything published before it —
`baram-word-count` 1.0.0/1.0.1, `baram-ai-summary` 1.0.0 — has a manifest that
predates the field, so `validateManifest` rejects the download whatever the
index says about it. Until that release ships, use
the seed to exercise the marketplace **UI** — listing, capability and tier
badges, the legacy state, refresh — and dev-load from source
(**Settings → Plugins → Developer**) to exercise a plugin actually running.

Two further things the seed is **not**:

- It is not a byte-for-byte copy of the live index. It is Prettier-formatted
  (the live file is written by `update-registry-index.mjs`), and it holds only
  entries worth publishing — `baram-ai-summary` is absent because it is not
  published.
- The placeholder checksum is **not** filled in automatically. The release
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
  "downloadUrl": "https://github.com/user/my-word-count/releases/download/v1.0.0/my-word-count-1.0.0.zip",
  "checksum": "sha256-hash-of-zip",
  "capabilities": ["editor:readonly", "events", "statusbar"],
  "trust": "sandboxed",
  "keywords": ["word", "count"],
  "engines": { "baram": ">=0.5.0" }
}
```
