---
title: "Registry loading and local testing"
---

## How Baram loads the registry

The marketplace (`PluginMarketplace.tsx`, via `fetchRegistryIndex()` in
`src/plugins/registry-client.ts`) fetches the URL held in `registryUrl` in the
plugin Zustand store (`src/stores/system/plugin.ts`), read by the Rust
`fetch_registry` command. It is fixed to `DEFAULT_REGISTRY_URL`:

```
https://sayinel.github.io/baram-plugins/index.json
```

**It is not configurable, by design.** There is no settings field, and — since
2026-08-04 — the value is deliberately *not* persisted: `partialize` leaves it
out and `merge` restores the default on every launch. A registry URL that
survived a restart turned out to be a stronger foothold than anything else in
the plugin system (a `trusted` plugin could point the app at its own registry
once, and the startup check would then ask that registry what is revoked —
permanently, since the request that would undo it was the poisoned one).
Keeping it in memory only bounds that to a single session.

Practical consequences for you as a plugin author:

- **Self-hosted registries are unsupported.** The registry accepts first-party
  plugins only for now regardless, so this does not remove an option you had.
- **Editing `config.json` has no effect.** Any `registryUrl` written there is
  discarded when the app rehydrates.
- Distributing outside the registry means the **Developer** section at the
  bottom of **Settings → Plugins**: a user turns on **Developer mode**, picks
  your plugin's folder and approves its capabilities. On a release build that
  path takes **sandboxed plugins only**, and not one whose id is already
  installed — side-loading skips the checksum and the registry listing, so it
  stays inside the tier the Rust broker enforces (see
  [Local development loop](/en/docs/plugin-dev/local-development-and-bundling/#local-development-loop)).
  A `trusted` plugin has no way onto a release build except the registry.

The registry lives at
[`sayinel/baram-plugins`](https://github.com/sayinel/baram-plugins) — a
public repo served via GitHub Pages that hosts `index.json` plus the plugin
ZIPs under `plugins/`. It accepts **first-party plugins only** for now;
community submissions are a future consideration.

Publishing is driven from this repo's CI: pushing a tag
`plugin-<dir>-v<version>` (e.g. `plugin-word-count-v1.0.0`, where `<dir>` is
the directory under `examples/plugins/` and the version must match that
plugin's `baram-plugin.json`) runs `.github/workflows/plugin-release.yml`,
which builds the plugin, packages the ZIP per the contract above, computes
its SHA-256, and pushes the ZIP plus an updated `index.json` to the registry
repo.

Two refusals happen before anything is built, and they answer different
questions. **Which directory** may ship: the workflow holds a publish
allowlist that denies by default, so a mistyped tag cannot publish a test
fixture, and adding an example does not make it publishable. **At which
tier** it ships: the same allowlist names one tier per directory, and a
manifest whose `trust` is not that tier fails the release rather than
publishing an entry the marketplace would present behind a different consent
dialog.

Both tiers can be published, but `trusted` is a per-directory decision rather
than a default. A plugin that contributes a Tiptap extension runs in the main
realm and is therefore `trusted` by construction — the sandboxed tier refuses
`tiptapExtensions` — so refusing that tier as a class would mean the registry
could never carry an editor plugin at all.

## Local testing

To exercise the marketplace UI without a live registry, point the app at the
repo's own committed seed instead of the default:
[`registry/index.json`](https://github.com/sayinel/baram/blob/main/registry/index.json).

> ⚠️ **The old procedure no longer works.** Earlier versions of this page said
> to close the app and edit `state.registryUrl` inside
> `app_data_dir/config.json`. Since 2026-08-04 that value is not persisted and
> is discarded on launch (see *How Baram loads the registry* above), so the
> edit is silently ignored — the app still fetches the live registry and shows
> no error.

In a development checkout, change `DEFAULT_REGISTRY_URL` in
`src/stores/system/plugin.ts` and run `npm run tauri dev`. It is the initial
store value, which is exactly what `merge` now restores on every launch:

- **Local static server** (recommended) — serve `registry/` with any static
  file server, e.g. `npx serve registry` or
  `python3 -m http.server --directory registry 8000`, and set the constant to
  `http://localhost:8000/index.json`.
- **File path** — some platforms accept a `file://` path directly at your
  local checkout's `registry/index.json`; a local static server is more
  portable since Tauri's webview may restrict `file://` fetches.

Note that a non-first-party URL also turns **off** revocation-signature
enforcement: Rust only verifies a list served under
`FIRST_PARTY_REVOCATION_PREFIX`, and reports anything else as unverified. That
is the intended behaviour, and it is worth knowing so a local run's
"unverified" state is not mistaken for a bug.

Once the constant points at the local seed, open **Settings → Plugins**
(the "Browse" tab) — it calls `fetchRegistryIndex()` on mount. Note the
registry response is cached for 24 hours; the **Browse** and **Updates** tabs
show an always-available **↻ Refresh** button that bypasses the cache
(`fetchRegistryIndex(true)`) and re-runs the update check
(`checkForUpdates()`) against the fresh index, so you don't need to restart
the app to pick up a new `registry/index.json`. The **Retry** button shown
when the fetch errored does the same thing. The cache lives in memory only,
so restarting the app also forces a fresh fetch if needed.
`registry/index.json` is the canonical
example of a valid `RegistryIndex`: it lists `baram-word-count` and
`baram-bullet-threading` with every required field — including `trust` —
populated from their real manifests. Their `downloadUrl`s point at the live
registry, so an app pointed at a local copy lists them but refuses to install
them — see
[The committed seed](/en/docs/plugin-dev/publishing/#the-committed-seed).
