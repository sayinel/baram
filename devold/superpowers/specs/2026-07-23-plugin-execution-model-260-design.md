# Plugin Execution Model Redesign — trusted/sandboxed tiers + Rust authorization

**Issue:** #260 (P0, CRITICAL) — root fix for the plugin trust boundary.
**Predecessor:** #259 (containment, merged PR #290) — removed secret-over-IPC and
gated plugins OFF by default. This design lifts that blanket gate safely.
**Status:** ADR / design spec. This cycle produces the decision only;
implementation follows in planned phases (§10).
**Date:** 2026-07-23

---

## 1. Context & problem

Plugins currently execute in the app's **own JavaScript realm** — `plugin-loader.ts`
does a bare `import()` and calls `module.activate(createExtensionContext(...))`.
The `ExtensionContext` capability checks (`DeniedProxy`) are therefore only a
cooperative convention: a plugin can `import { invoke } from "@tauri-apps/api/core"`
and call any of ~60 Tauri commands directly, bypassing the capability layer. The
Rust backend cannot distinguish an app call from a plugin call in the same realm,
so an ACL alone can never be a trust boundary (documented in `extension-context.ts`
and `capabilities/default.json` by #259).

**Why we cannot simply move plugins to a worker/webview.** The current plugin API
injects **non-serializable execution objects** — Tiptap extension objects,
NodeViews, callbacks — directly into the main ProseMirror instance
(`plugin-loader.getTiptapExtensions()` pushes `manifest.tiptapExtensions` exports
into the editor). These cannot cross a realm boundary. So isolation is impossible
without first deciding *which* plugins keep in-realm schema access and which give
it up for a sandbox.

## 2. Decision — two trust tiers

A required manifest field `trust` splits plugins:

| | **trusted** | **sandboxed** |
|---|---|---|
| Runs in | main editor realm (same as today) | per-plugin isolated realm |
| May contribute | arbitrary Tiptap extensions, NodeViews, function-bearing PM schema | declarative contributions only (§4) |
| Tauri invoke | full (same as app) | none — only `plugin_call` |
| Security guarantee | **none** (full-trust) | OS/Tauri-enforced boundary + per-call authz |
| Install gate | explicit full-trust opt-in + registry `trusted` flag | allowed in release builds |

The tiers exist because the PM-schema constraint (§1) is irreducible: arbitrary
editor-schema extension **requires** same-realm execution, which **cannot** be made
safe. Rather than pretend otherwise, we make the unsafe path explicit and opt-in,
and give everything else a real boundary.

## 3. Sandboxed runtime architecture

```
main app realm                        plugin realm (one per sandboxed plugin)
┌─────────────────────┐   messages    ┌──────────────────────────────┐
│ SandboxHost          │◀─────────────▶│ hidden WebviewWindow          │
│  · start/stop/suspend │  postMessage  │  label = "plugin-<id>"        │
│  · RPC router         │               │  · runs plugin JS             │
│  · contribution reg   │               │  · NO fs/keyring/llm invoke   │
└──────────┬───────────┘               │  · capability: plugin_call only│
           │ invoke("plugin_call", op)  └──────────────────────────────┘
           ▼
┌──────────────────────────────────────────────────────┐
│ Rust PluginAuthorizer / broker                         │
│  caller = plugin_for_window(window.label())  (unforgeable)
│  require(caller, op.required_capability())   (every call)
│  execute_bounded(caller, op)                           │
└──────────────────────────────────────────────────────┘
```

- **One hidden `WebviewWindow` per sandboxed plugin**, label `plugin-<id>`. A fresh
  webview is a distinct JS realm — true isolation from the main app.
- **Tauri command permissions lock the plugin webview to `plugin_call` only.** A
  dedicated capability file scoped to `plugin-*` windows grants no `core:*` FS/window
  commands and none of the app's custom commands except `plugin_call`. This closes
  the "#259 custom commands are not ACL-gated" hole at the OS/Tauri level.
- **Caller identity = `window.label()`**, derived by Tauri, not asserted by app
  logic and not a user-supplied `plugin_id`.
- **Lifecycle:** lazy-start on first need; idle-suspend to bound memory; explicit
  stop on disable/uninstall. Crash/timeout isolates to the plugin (§8).

## 4. Sandboxed contribution schema (v1)

`manifest.contributions` declares the static surface; a typed message protocol
carries execution. Everything here is serializable.

- **commands** — declarative `{id, title, palette?}`; invocation is an
  "invoke command" message to the plugin realm; result returned by message.
- **menu / command-palette entries** — declarative `{id, title, when?}`.
- **status bar items** — declarative `{id, text, tooltip?, command?}`; updates via RPC.
- **document / selection transform** — serialized content in → transformed content out.
- **editor text ops** — get/set content, get selection, insert text (RPC), gated by
  `editor` / `editor:readonly`.
- **settings** — declarative form schema (field definitions); values stored per-plugin.
  (No arbitrary DOM settings tab — that is trusted-tier.)
- **brokered services** — `files`, `ai`, `network`, `storage`: each operation is an
  RPC op verified in Rust (§5).
- **events** — subscribe to app events / emit, delivered as messages.

**Custom editor schema (nodes/marks) is a documented future extension**, not v1.
A data-only NodeSpec representation (attrs, render template, markdown parse/serialize
as data) is a substantial sub-project; arbitrary nodes/NodeViews remain trusted-tier.

## 5. Authorization (Rust broker)

- `PluginOp` enum; each variant declares `required_capability()`.
- Every `plugin_call`: (1) resolve `window.label()` → plugin identity;
  (2) check the op's required capability is in that plugin's granted set;
  (3) on pass, run a **bounded** implementation; on fail, return a typed deny error.
- **Per-plugin storage/session isolation** — storage ops key off the resolved caller
  identity, never a `plugin_id` argument, so plugin A cannot read plugin B's storage.
- **Network** — a sandboxed plugin without the `network` capability has its HTTP-proxy
  op rejected by the broker.
- Capabilities are the granted set recorded at install (from the manifest, shown in
  the install UI); the broker is the single enforcement point.

## 6. Trusted tier

- **Reuses the existing path unchanged** — same-realm `import()` +
  `createExtensionContext`. Minimal new code; the bulk of #260 is the sandboxed runtime.
- Install requires a **full-trust opt-in dialog** ("runs with full app access, no
  sandbox; install only if you trust the author/source") plus a `trusted` flag in the
  curated registry (soft allowlist).
- **Code signing is a documented future extension**, not v1 — opt-in + curated
  registry manages v1 risk for a small distribution.

## 7. Manifest & migration

- New manifest fields: `trust: "trusted" | "sandboxed"` (required),
  `contributions` (sandboxed). Manifest schema handling is versioned; the validator
  rejects a missing/unknown `trust`.
- **Legacy installs without `trust`** are not auto-run and are surfaced in the UI as
  "needs re-validation" (disabled pending user action). Blast radius is minimal —
  #259 already disabled auto-load and the feature is new.
- **Reference plugins** (`baram-word-count`, `baram-ai-summary` in the separate
  `sayinel/baram-plugins` repo) are ported to `sandboxed` as the canonical examples
  that validate the runtime. This porting is implementation-phase work in that repo;
  this ADR only fixes the direction.

  **Amended in Phase 6.** Both claims were wrong in detail. The source lives in *this*
  repo under `examples/plugins/`; the registry repo receives only the built ZIP and an
  `index.json` entry, pushed by `plugin-release.yml`. And only `baram-word-count` could be
  ported: `baram-ai-summary` renders a Shadow-DOM sidebar panel, `PluginContributions` has
  no declarative `sidebar` member, and the sandboxed tier has **nowhere to display a
  summary** (`showNotification` is transient, `setStatusBarText` caps at 64 characters,
  `editor.insertText` needs a write grant it should not have for this). It therefore stays
  `trusted` and left the registry index — publishing it as a trusted plugin would train
  users to click through the full-trust warning for something as ordinary as summarising a
  document. It returns when the `sidebar` contribution exists (Phase 4 remainder).

  One accepted regression in the port: the count now includes markdown syntax. The trusted
  tier's `editor.getContent()` returned flat text (`editor.getText()`); this tier has only
  `getMarkdown()`. Left visible rather than hidden behind a regex stripper in the reference
  plugin — the real gap is a missing flat-text read on `SandboxEditorAPI`.

## 8. Release gate transition

- #259's `VITE_ENABLE_PLUGINS` blanket gate is **replaced** by the tier model:
  sandboxed plugins are allowed in release builds (real boundary + per-op authz);
  trusted plugins require the full-trust opt-in.
- A master kill-switch is retained for emergencies.

**Phase 6 found the tier being dropped TWICE on its way to the install UI**, which made the
whole live registry un-installable after Phase 5 started reading a `trust`-less entry as
legacy. Neither place is where anyone would look:

1. `scripts/update-registry-index.mjs` builds an entry from an allowlist of manifest fields,
   and `trust` was not in it — so every *published* entry lacked it.
2. `fetch_registry` deserializes the live index into Rust's `RegistryEntry` and Tauri
   re-serializes it to the frontend. `trust` was not a field there either, so **serde
   dropped it silently**. Fixing (1) alone would have changed nothing observable — the
   deserialize half cannot catch this, because unknown fields are ignored and the old struct
   parsed the new JSON happily. It is the re-serialize half that carries the bug.

Same shape as the `protocol-union-runtime-validator-gap` lesson: a feature ships dead because
a pass-through layer does not know the field. The release script now *requires* `trust`, the
Rust struct carries it as an `Option<String>` pipe, and `fetchRegistryIndex` normalizes an
unrecognised tier away (before caching) so it fails closed to legacy rather than storing a
tier the app cannot enforce as consent.

## 9. Error handling

- Sandbox crash or `activate` timeout → plugin marked failed/isolated; the app core
  is unaffected.
- RPC timeouts / malformed messages → rejected and logged.
- Denied ops → typed, user-legible error returned to the plugin realm.

## 10. This cycle's scope & implementation phases

**This cycle delivers this ADR only.** Recommended implementation phases (each its
own plan → implementation cycle):

1. **[DONE — PR #291 @2b9096e]** Manifest `trust`/`contributions` + validator + install-UI tier display + legacy handling.
2. **[refined]** Sandbox runtime **machinery + webview wiring** — message protocol, injectable transport (DI), host-side `SandboxSession` router, sandbox-side client shim, `sandbox.html` entry, `plugin-*` capability granting `allow-plugin-call`, sandbox-strict CSP via meta tag. CI-unit-tested via a fake transport; the real WebviewWindow round-trip is dev/manual-verified. **The live loader does NOT yet route sandboxed plugins to execution, and the hard boundary is not yet enforced** (see the Tauri ACL note below) — this avoids a boundary-less load window. Plugins remain OFF (`VITE_ENABLE_PLUGINS`).
3. Rust `PluginAuthorizer`/broker (`plugin_call`, `PluginOp`, `window.label()` identity, per-call authz, storage isolation) **+ the full sensitive-command ACL lockdown** (below) **+ flip the loader** to route sandboxed → SandboxHost. Criteria 2·3·4·5 all land together here, the moment the boundary is real.
4. Contribution mapping (commands/menu/statusbar/transform/editor/settings/events/brokered services).
5. **[DONE — Phase 5]** Trusted-tier full-trust opt-in dialog + registry `trusted` flag +
   release-gate transition. The registry flag became a *cross-check* rather than a display
   field: consent is collected against the registry entry (a claim) and the downloaded
   manifest must not exceed it, or the install is rolled back before anything is persisted.
6. **[DONE — Phase 6]** Reference-plugin port + malicious-plugin fixture CI (deny paths).
   Two corrections to the sketch above: the port lands in **this** repo (the plugin SOURCE
   lives under `examples/plugins/` and `plugin-release.yml` publishes it to the registry
   repo — the separate repo holds only ZIPs and `index.json`), and only
   `baram-word-count` was ported. `baram-ai-summary` renders a Shadow-DOM panel and this
   tier has no surface that can display a summary, so it stays trusted and was **withdrawn
   from the index** rather than published as a trusted plugin — see §7's amendment below.
   Scoping also found the tier being dropped twice on its way to the UI (§8 amendment).

### Tauri v2 ACL note (surfaced 2026-07-24, shapes Phase 3)

In Tauri v2, app-defined `#[tauri::command]`s are **NOT capability-gated by default** — every
window can call every custom command. A `plugin-*` capability granting only `plugin_call` does
**not** stop a sandbox webview from calling `read_file`/keyring/etc. directly. The real boundary
("sandboxed realm has no raw Tauri invoke", criterion 2) requires opting **every** sensitive
command into the ACL via `tauri_build::AppManifest::commands(&[...])` in `build.rs` + a permission
file per command, then granting them only to `main`/`file-*` (never `plugin-*`). This is a
cross-cutting backend change (build.rs + ~dozens of permission TOMLs + capability files) and is
**deliberately scoped into Phase 3** alongside the broker, so the enforced boundary and the
sandbox's legitimate `plugin_call` channel land in the same cycle. `plugin_call` itself must be in
`AppManifest::commands` (making it deny-by-default) and granted to `main` too if `main` needs it.

### Tauri v2 event-target note (surfaced 2026-07-26, shapes Phase 3c-2a)

"No raw Tauri invoke" (§12) is **necessary but not sufficient**: event eavesdropping is a
separate boundary property. Tauri v2 delivers a broadcast event to any JS listener registered
with the default `EventTarget::Any`, and **no emitter-side filtering can prevent it** —

```rust
// tauri/src/event/listener.rs
fn match_any_or_filter<F>(target: &EventTarget, filter: &Option<F>) -> bool {
  *target == EventTarget::Any || filter.as_ref().map(|f| f(target)).unwrap_or(true)
}
```

`emit_to` is itself implemented via `emit_filter`, so it is short-circuited too, and the JS
`listen(name, cb)` call registers `{kind:'Any'}` unless a `target` option is passed
(`@tauri-apps/api/event.js`). Consequence: a `plugin-*` window holding `core:event:allow-listen`
can read every app event — `llm:token` (the user's whole AI output), `file:changed/created/deleted`
(vault paths), `file:open-request`, `menu-event` — with **zero granted capabilities**. Rewriting
the app's `app_handle.emit()` calls would buy nothing.

Therefore: a sandbox realm holds **no** `core:event:*` permission, and the host↔sandbox transport
uses per-webview IPC instead — an `ipc::Channel` the sandbox hands to Rust at boot for inbound
messages (point-to-point to that webview) plus a caller-identified command outbound
(`plugin_sandbox_report`, whose plugin id comes from `window.label()`). The per-session channel
token this replaced is gone: identity is Tauri-verified rather than secret-based.

The **granted** sandbox surface is `plugin_call` + `plugin_sandbox_connect` +
`plugin_sandbox_report`. That is not the same as the **reachable** surface, and the difference must
be written down rather than rounded off to "nothing else": `FETCH_CHANNEL_DATA_COMMAND`
(`plugin:__TAURI_CHANNEL__|fetch`) is hardcoded to bypass the ACL check (`webview/mod.rs`, marked
`TODO: Remove this special check in v3`), so any webview may invoke it, and it takes only a
sequential — therefore guessable — data id. It is how tauri delivers an `ipc::Channel` frame at or
above the 8 KiB direct-eval threshold, which is also what makes it exploitable: a sandbox can race
the target's fetch to read a large frame addressed to another sandbox, and because the JS `Channel`
buffers strictly by index, the stolen index wedges that channel permanently rather than costing one
message. Mitigation for now is to keep h2s frames small — `SandboxChannels::send` warns in dev at
8 KiB — with chunking owed before any large frame ships.

Related trap found in the same audit: a `<meta>` CSP can only **tighten** the global one, so
`sandbox.html` must mirror the global `script-src ... asset:` allowance or the plugin ESM the
sandbox exists to import is blocked in that realm only.

### Brokered services: `files` in Rust, `ai` host-mediated (IMPLEMENTED in Phase 3c-2c)

§5 said "each operation is an RPC op verified in Rust". That is right for `files` and wrong for
`ai`, and the difference is worth recording because it looked like an inconsistency:

- **`files` → Rust.** The vault boundary already lives there (`check_vault` → §88
  `validate_path_any`, canonicalizing both sides). `plugin_cmd` reaches it through
  `fs_cmd::ensure_path_in_vault` rather than growing a second copy of the rule. Authorization is
  any-of (`files` **or** `files:readonly` for read/list; `files` for write), expressed as
  `CapabilityRequirement::AnyOf` **on the op**, so no call site re-derives it.
- **`ai` → the host.** Its policy is frontend state: privacy mode (`useAIStore`), the per-task
  model/provider/baseUrl choice (`getConfigForTask`), `isLLMAllowed`. A Rust `Ai*` op would have to
  accept a model and provider **from the sandbox** — precisely the power a sandboxed plugin must not
  have, since it could name its own endpoint and route the user's prompts there regardless of
  privacy mode. So `SandboxHostRequest` (`ai_complete`/`ai_stream`/`ai_list_models`) carries a
  prompt and nothing else, travels over the 3c-2a transport as `hostRequest`, and the host answers
  with `hostResponse` (+ `hostStreamToken` frames for a stream). The check is host-side and still
  **enforcing**: a `plugin-*` window holds no `llm_*` ACL grant, so the host is the only route from
  a sandbox to a model. `createAIAPI` is shared with the trusted tier rather than reimplemented, so
  privacy mode cannot drift between tiers.

Bounds that shipped with them, all deliberately stated as bounds rather than guarantees:

- **`.baram/` is refused** inside every registered context. It is the app's own state, not user
  content: `.baram/config.json` is the vault's **settings-override layer** (§86), so a plugin able
  to write it could turn `ai.privacyMode` **off** — after which the app itself is permitted to send
  document content to a cloud provider — or rewrite `markdown.serializationRules`, which changes how
  every document in the vault is written back to disk; `.baram/snapshots/` holds earlier copies of
  user files. Matched on path components after canonicalization.
  (3c-2c review F6 corrected an earlier claim here that the AI `baseUrl` lives in this file. It does
  not — `AiSection` is model/privacyMode/contextScope; `baseUrl` comes from the app-global settings
  store. The carve-out stands on what the file actually contains.)
- **File ops act on the canonical path, resolved once.** Unlike the app's own file commands, a
  `files`-granted plugin controls both the path it asks for and (in-context) what that path points
  at, so check-then-swap of a symlink is reachable; a canonical path names only real directories.
  The vault rule, the app-state guard and the operation all judge the *same* resolved `PathBuf`
  (F7) — checking one resolution and acting on another leaves a window where they disagree.
- **8 MiB per call**, both directions (reads refused by `metadata` before allocating), and the reads
  use `tokio::fs`: blocking the runtime inside `plugin_call` would let one plugin stall the app's own
  IPC rather than only its own work (F2).
- **Rate limiting per (plugin, class)** — the residual 3c-2a wrote down: default 200 burst /
  100 per second, network 20 / 5, and the sandbox→host **frame pipe** 300 / 150 in its own bucket
  (F3 — `plugin_sandbox_report` was unlimited, which also left host-mediated `ai` with no Rust-side
  bound). Keyed by the Tauri-verified label, so no plugin can spend or throttle another's budget;
  dropped on deregister.
- **In-flight bound of 4 host requests per plugin**, held until the handler **settles**, not until
  the sandbox is answered (F4): nothing cancels a provider stream at timeout, so releasing early let
  a plugin hold unbounded concurrent LLM streams.

Residuals — the "consented to" caveat recorded here (the install UI merely *displayed* capabilities
in a `window.confirm`, with no grant step) was closed in Phase 5: `PluginConsentDialog` collects the
grant, the approved shape is persisted, and `consentRequired` re-asks when a later version exceeds
it. What remains:

- A `files`-granted plugin can overwrite user content in any registered context — that is what the
  capability *means*. Only per-call size and call rate are bounded, not cumulative bytes written.
- A **dev folder inside an open vault** is writable by any `files`-granted plugin, so in that layout
  a plugin could rewrite another plugin's bundle; the installed plugin dir (`~/.baram/plugins`) is
  outside the vault and unaffected.
- A stalled `ai` request still costs its tokens: holding the slot bounds concurrency, not spend.
  Real cancellation needs `createAIAPI` to expose one (`llm_cancel` exists; the API does not use it).
- **Every `plugin-*` webview shares an origin with the main window and with the other sandboxes**
  (§260 Phase 5). `sandbox-host.ts` creates them with a relative url, so the origin is the app's own;
  Tauri v2 has no per-window origin. Phase 5 closed the part that mattered — `localStorage` held vault
  paths and was readable by a plugin with **zero** capabilities, and everything now persists through
  `tauriStorage` (Rust `config.json`), guarded by a source scan. What remains is COLLUSION: two
  installed plugins can talk over `BroadcastChannel`, so a `network`-less plugin could use a
  `network`-granted accomplice as a proxy. Materially weaker than the storage read it replaced — it
  needs the user to have installed both, and both to be malicious — but it is not zero, and only a
  per-plugin origin (a custom URI scheme serving the sandbox document) would close it.
  `SharedWorker` was a second channel of the same kind and IS closed: the sandbox CSP now says
  `worker-src 'none'` explicitly, because the fallback is `script-src` and would otherwise have
  allowed it (Phase 5 security review). Dedicated workers go with it, which is the intended trade
  while no plugin depends on them.
- **`install_plugin`'s id enforcement is opt-in at the call site.** `expected_id` is an `Option`, and
  passing `None` restores the destructive move: step 6 does `remove_dir_all` on a directory named by
  the id INSIDE the archive, so an archive declaring another installed plugin's id would destroy it
  as a side effect of the download (§260 Phase 5 re-review, R5/Q2). Every current caller passes the
  registry entry's id, and the frontend keeps its own id check as defence in depth, but a future
  caller that omits it re-opens the path — the guard is a parameter, not an invariant. Verified that
  nothing else in `install_plugin` touches the plugins tree before the refusal: extraction writes
  only under `tempfile::tempdir()` (and `enclosed_name()` refuses traversal), everything between is
  reads and pure functions, and `get_plugin_dir()`'s `create_dir_all` runs after the check and only
  creates the shared root.
- **A sandboxed plugin can persist without the `storage` grant**, via `indexedDB` or the Cache API
  (Phase 5 security review, two LOW findings). Both are origin-scoped browser APIs; CSP has no
  directive for either, so nothing short of a per-plugin origin bounds them. Scope of the gap: the
  app itself stores nothing in either, so there is nothing to *read* — what leaks is the capability
  model's claim to be the only route to persistence, plus one more collusion channel of the same
  class as `BroadcastChannel`. `plugin_call`-brokered storage remains the only route to storage that
  survives an uninstall or that the user can inspect.

Phase 4 still owes the rest of the contribution surface: `editor`, `commands` beyond invoke,
`events`, `ui`, `settings`, document transforms.

### Sandbox code delivery: drop `asset:`, `blob:`-import the source (IMPLEMENTED in Phase 3c-2b)

**Shipped shape (differs from the sketch below in one important way):** the bundle does **not** ride
the activate frame. It returns as a `plugin_call` **result** from a `SourceRead` op, because any
`ipc::Channel` frame ≥8 KiB is staged in tauri's app-global `ChannelDataIpcQueue` and fetched via the
ACL-exempt `FETCH_CHANNEL_DATA_COMMAND` — so a bundle in the frame would be stealable (and the
channel wedgeable) by another sandbox. An invoke result touches none of that, which also means h2s
chunking is **not** needed for code delivery.

`SourceRead` takes **no path**: Rust resolves the caller's own directory from the label-derived id
(installed dir, else a registered dev folder matched by manifest id) and reads its declared `main`,
canonicalizing to refuse an escape. So the op is not a file-read capability in disguise, and
`required_capability()` became `Option<&'static str>` — reading one's own code needs no grant, only a
verified, registered identity. The sandbox CSP is now `script-src 'self' blob:`; `asset:` is gone
from that realm, so **F1 is closed rather than mitigated**. Author-visible consequence: a sandboxed
plugin must ship a single self-contained ESM (a blob module has no base URL), enforced in
`validateManifest` along with rejecting `tiptapExtensions` on the sandboxed tier.

Original decision, kept for the reasoning:

### Sandbox code delivery: drop `asset:`, hand over source for a `blob:` import (decided 2026-07-26, for Phase 3c-2b)

Allowing `asset:` in the sandbox's `script-src` (needed above, or no plugin loads) hands the
sandbox realm a **file-read capability the broker never granted**. Tauri v2's asset-protocol scope
is **app-global** — there is no per-webview scope — and it currently covers `$APPDATA/**`, the
plugins directory **recursively from the parent** (`plugin_prepare_scopes` →
`allow_directory(dir, true)`), dev plugin folders, and the **open vault root**
(`set_vault_root` → `allow_directory(path, true)`). So a malicious sandboxed plugin can
`import('asset://localhost/…')` any valid-JS file in those trees — another plugin's bundle, a `.js`
note in the user's vault — and probe path existence from the error shape. `connect-src` omits
`asset:`, so non-JS content cannot be fetched as text, which bounds but does not close it.

Narrowing `plugin_prepare_scopes` to per-plugin subdirectories only kills the cross-plugin vector;
the vault stays readable, and the vault must remain in the asset scope for the main realm's own
images/attachments.

**Decision:** remove `asset:` from the sandbox realm entirely. The host reads the plugin's `main`
bundle (a new host-only Rust command, because `read_file` is vault-constrained and the plugin
directory is outside the vault), passes the **source** in the activate frame, and the sandbox
imports a `blob:` URL built from it — `script-src 'self' blob:`. `blob:` grants no file access: the
sandbox can only execute bytes the host already handed it, and running attacker code is not a new
privilege (it is the plugin's own code either way). Cost: a sandboxed plugin must ship a single
bundled ESM, since relative sibling imports do not resolve from a blob URL — already the de facto
contract via `manifest.main`.

Also accepted as residual (Tauri-architectural, not introduced by us): `FETCH_CHANNEL_DATA_COMMAND`
is exempt from the ACL check (`webview/mod.rs`, marked `TODO: Remove this special check in v3`) and
channel data ids are sequential `u32`, so a sandbox can race the host's eval to steal a **≥8 KiB**
channel payload addressed to another sandbox. Small payloads never enter that queue. Revisit when
Tauri v3 removes the exemption.

## 11. Non-goals / future extensions

**Non-goals:** claiming arbitrary same-realm JS is safe; full VS Code/Obsidian API
compatibility in one step; reusing the frontend `Proxy` as a security boundary.

**Future extensions:** declarative custom editor schema for the sandboxed tier;
enforced code signing for the trusted tier.

## 12. Completion criteria (issue #260)

- [x] ADR decides trusted/sandboxed tiers + the Tiptap-extension constraint — **this doc**
- [x] Sandboxed plugin realm has no raw Tauri invoke — §3 (Phase 3b AppManifest lockdown +
      `capabilities/plugin-sandbox.json`, guarded by `tests/acl_lockdown.rs`). **With the two written
      residuals above:** the ACL-exempt `FETCH_CHANNEL_DATA_COMMAND`, and no `core:event:*` (3c-2a)
      because emitter-side filtering cannot withhold an event from an `Any`-target listener.
- [x] Rust authorization verifies caller identity + capability together — §5 (`authorize_op` on
      `window.label()`; Phase 3c-2c added the any-of form for `files`)
- [x] Plugin A cannot use plugin B's storage/session — §5 (storage keys off the label-derived id;
      `SourceRead` reads only the directory the host bound for that label)
- [x] Sandboxed plugin without `network` has its HTTP proxy request rejected — §5
- [x] Trusted install requires a full-trust warning + separate opt-in — Phase 5
      (`PluginConsentDialog`: a danger panel stating that the capability list does NOT bound a
      trusted plugin, plus an acknowledgement checkbox that gates the confirm button). The
      approved `(trust, capabilities)` is recorded on the installed-plugin record, and an update
      that exceeds it re-asks — which also closes the silent `sandboxed` → `trusted` escalation
      the update path had.
- [x] Malicious-plugin fixture verifies the deny paths in CI — Phase 6
      (`examples/plugins/malicious-fixture`: holds `commands`+`statusbar`, asks for everything
      else). Split by enforcement layer, neither half faking the other's decision: **vitest**
      runs the real bundle through the real client/session/host bridges and asserts the
      host-mediated refusals *by the gate's wording* (a broken transport or an exhausted
      in-flight budget would otherwise look identical), that no subject is reached, that broker
      denials propagate un-softened, that no op carries a forgeable identity, and that hostile
      paths leave verbatim; **cargo** sweeps every `PluginOp` variant against one
      minimally-granted plugin, plus unregistered and non-sandbox callers. Anti-drift is
      compiler-enforced — a new op fails `tsc` (exhaustive `Record`) and `cargo`
      (wildcard-free `match`) — and `plugin-release.yml` refuses to publish either fixture
      directory.
