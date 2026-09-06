---
title: "Trust model, security, and errors"
---

## Trust model & security

Read this before installing a plugin you didn't write, and before writing a
plugin others will install. **Capabilities are install-time-approved intent
declarations plus API gating — they are not a hard sandbox.** Only the
Shadow-DOM boundary (see above) provides real isolation, and it isolates CSS
only, not JavaScript. Plugins execute in the same JS context as the editor;
a plugin with `editor` or `files` capability can, in principle, do anything
that capability's API surface allows, and a malicious or buggy plugin can
still misbehave within its granted APIs.

**`network` is unrestricted egress by design.** `context.network.fetch()`
can reach loopback addresses, private/RFC1918 IP ranges, and cloud
instance-metadata endpoints — none of these are blocked. This is a
deliberate choice (not an oversight): it's what makes talking to a local
Ollama server or a local dev server useful from a plugin. Concretely:

- Only `http://` and `https://` URL schemes are allowed; anything else is
  rejected before the request is made.
- The response body is always decoded as a UTF-8 string — **there is no
  binary/bytes mode**; fetching a binary resource will silently corrupt it.
- Duplicate response headers collapse to a **last-wins** single value (no
  multi-value header support).
- Every request has a **30-second timeout** and a **10 MiB** response-size
  cap (streamed and enforced incrementally, so an unbounded response is
  rejected once it crosses the cap rather than after buffering the whole
  thing).

**`storage` is app-global, not per-vault**, and stored in plaintext at
`~/.baram/plugin-data/<pluginId>/<key>` on disk — a plugin's storage is
shared across every vault you open, not scoped to "the current vault". Keys
are constrained to a single safe path segment (no `/`, no `..`) so a key
can't escape the plugin's own storage directory, but this is **not
symlink-hardened**: it's purely a filename-shape check, not a
canonicalize-and-verify-real-path check.

**`ai` consumes the user's own configured provider, model, and API
key/quota** — a plugin cannot bring its own key, and every `complete`/
`stream` call is billed against whatever the user has configured in
Settings → AI. **Privacy mode only gates `complete` and `stream`** — when
privacy mode (or a per-file `privacy: true` frontmatter flag) is active,
those two calls reject unless the configured provider is a local one
(currently only Ollama). **`listModels()` is not gated by privacy mode** and
may still call out to a cloud provider's API to enumerate models even while
privacy mode is otherwise blocking `complete`/`stream` — don't assume
calling `listModels()` is privacy-safe just because privacy mode is on.

**Checksums are registry-only.** Plugins installed from the registry are
verified against a SHA-256 checksum before install; **dev-folder loads
(the Developer section) skip this entirely** — loading a local folder is an
explicit, deliberate act of trusting that code, with no cryptographic check
in between. Dev-folder loading is also **development-builds only**: it bypasses
the checksum, the registry listing and the consent record all at once, so a
packaged build refuses it.

**Installing records what you approved.** The install dialog lists the requested
capabilities and, for `trust: "trusted"`, states plainly that the capability list does
_not_ bound the plugin — a trusted plugin runs inside Baram itself and holds everything
regardless of what it declared, so that one needs an explicit acknowledgement. The
approved `(trust, capabilities)` is stored with the plugin, and an **update that exceeds
it asks again**: a plugin installed as `sandboxed` cannot quietly become `trusted`, and
a new capability is shown as new. An update that asks for _less_ installs without a
prompt and narrows the record.

**Sandboxes share an origin with the app and with each other.** Tauri v2 has no
per-window origin, so a `plugin-*` webview cannot be given its own. Three consequences,
all of them bounds rather than bugs:

- The app keeps nothing in `localStorage` — everything persists through Rust's config
  file — precisely because a plugin could otherwise read it with no capabilities at all.
- Two installed plugins can still reach each other through `BroadcastChannel`, so a
  plugin without `network` could use a `network`-granted plugin as a proxy if both are
  malicious. Capability grants bound one plugin, not a pair that cooperate.
  `SharedWorker` was the same kind of channel and is blocked — the sandbox denies
  `worker-src` outright, which also means **no `Worker` at all in a sandboxed plugin**.
- `indexedDB` and the Cache API are reachable without the `storage` capability. They give
  a plugin persistence that the capability system does not gate; they do not give it
  anything of the app's, because the app stores nothing in either. Prefer `ctx.storage`:
  it is the only plugin storage the user can see and that uninstalling actually removes.

**Bottom line: only install plugins you trust**, especially any declaring
`ai`, `network`, `files`, or `storage`. New capabilities added in a plugin
update require re-approval before the update takes effect.

## Timeouts & error handling

- `activate()`: 5 second timeout.
- `deactivate()` and other lifecycle hooks: 1 second timeout.
- If a plugin times out, it is marked as errored and can be manually
  re-enabled.
- Plugin errors never crash the main app.
- React components rendered from plugin UI are wrapped in Error Boundaries.
- Failed plugins are marked with an error state in the marketplace/dev UI.
- Check the browser console for detailed plugin error logs.
