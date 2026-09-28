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
  entries worth publishing — `baram-ai-summary` is absent not because it was
  never published (its 1.0.0 archive is still in the registry), but because
  it was withdrawn (see `registry/revoked.json`).
- A checksum is **not** filled in automatically. The release
  workflow clones `sayinel/baram-plugins` and updates only _that_ repo's
  `index.json`; nothing writes back here. After publishing a version, a
  maintainer copies the workflow's `sha256sum` output into this file by hand.
  Forgetting is now **reported but not blocked**: `validate-index.ts` warns on
  an all-zero checksum on every `npm run lint`, while still allowing a seed to
  name a release whose ZIP does not exist yet. The 64-hex shape check on its
  own could never see it, since zeros satisfy it.

## Publishing your own plugin

A plugin reaches other people through the community registry, which takes
sandboxed plugins only: you publish a GitHub Release in your own repository,
then open a pull request to
[`sayinel/baram-plugins`](https://github.com/sayinel/baram-plugins) that adds
one small descriptor file. The registry copies the release and serves it from
its own address, so users never download from your repository. The whole
procedure — the template, the release workflow, the descriptor and what the
check verifies — is in
[Publishing to the community registry](/en/docs/plugin-dev/community-registry/).

First-party plugins in this repository do not take that path: pushing a
`plugin-<dir>-v<version>` tag publishes them to the registry's `index.json`
directly (see
[Registry loading and local testing](/en/docs/plugin-dev/registry-loading-and-testing/)).
