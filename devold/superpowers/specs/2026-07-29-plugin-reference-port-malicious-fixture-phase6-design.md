# §260 Phase 6 — reference-plugin port + malicious-fixture CI (design)

**Status:** approved 2026-07-29. Last phase of issue #260.
**Predecessor:** Phase 5 (`2026-07-28-plugin-release-gate-lift-phase5-design.md`, merged `d484774`).
**ADR:** `2026-07-23-plugin-execution-model-260-design.md` §10 phase 6.

## 1. Goal

Close the two remaining items of #260:

- the reference plugins become the canonical **sandboxed** examples that validate the runtime;
- a **malicious plugin fixture verifies the deny paths in CI**, which is #260's last unticked
  completion criterion.

Scoping surfaced a third item that must go first — see §2.

## 2. The registry is currently un-installable (found while scoping)

`scripts/update-registry-index.mjs` builds each index entry from an allowlist of manifest
fields, and `trust` is not in it. So both live entries lack `trust`; Phase 5 reads a
`trust`-less entry as **legacy** and disables Install (`PluginCard`, `PluginDetail`,
`LEGACY_ENTRY_MESSAGE`). The consequence is not theoretical: the next release ships a
marketplace with **zero installable plugins**.

This is the same defect class the phase is about — a boundary that is enforced in one place
and unrepresented in the pipeline that feeds it — so it is fixed here, first, and pinned by a
test that fails a release rather than publishing a dead entry.

### 2.1 A SECOND drop, found during implementation

Fixing the script alone would have changed **nothing observable**. The index also crosses Rust:

```
remote index.json → serde_json::from_str::<RegistryIndex> → Tauri re-serializes → TS RegistryEntry
```

Rust's `RegistryEntry` had no `trust` field, so **serde discarded it on the way back out**.
Both drops had to be closed for either to matter.

Why no existing test could see it: serde ignores unknown fields, so the old struct parsed the
new JSON happily — a "does it deserialize?" assertion stays green. Only the **re-serialize**
direction carries the bug, so the regression pin is a round-trip test
(`registry_entry_carries_trust_back_out`).

Design consequence: Rust stays a **pipe, not a validator** — `Option<String>`, because
refusing an unknown tier there would hard-fail the whole index on a future addition. The
value is validated where it is consumed (`fetchRegistryIndex` normalizes an unrecognised tier
away, before caching, failing closed to legacy).

Generalized into a reference memory: *pass-through layer drops unknown fields*.

### 2.2 Prerequisite discovered: the sandboxed tier had no published context type

`SandboxContext` lived in `src/plugins/sandbox/sandbox-client.ts`, and `public-api.ts`
re-exports only from `types.ts` — so a sandboxed author had **no type to name** for
`activate(ctx)`, which blocked writing the port in TypeScript at all. Moving it to `types.ts`
(where every sibling `Sandbox*API` already lived) and exporting it is therefore part of this
phase, not a nicety. Pulling it from the runtime module instead would have dragged the
internal transport/protocol declarations into the published `examples/plugins` surface.

## 3. Decisions

### 3.1 The release pipeline requires `trust`

`trust` joins `MANIFEST_REQUIRED` in `update-registry-index.mjs`, is validated against the two
legal values, and is copied into the entry. A manifest without it **fails the release** instead
of publishing something the app will refuse to install.

Required rather than optional-with-passthrough: a missing `trust` already makes a manifest
invalid for the loader (`validateManifest`), so an index entry without one can only ever
describe a plugin nobody can install. Failing loudly at release time is the only outcome that
tells the maintainer something.

`contributions` stays out of the index. Consent is `(trust, capabilities)` and the cross-check
compares those two against the downloaded manifest; contributions are read from the manifest
after download and are not part of what the user approves.

### 3.2 `baram-word-count` → sandboxed, v2.0.0

Ported, not rewritten — the plugin is the tier's proof that a real plugin needs nothing from
the main realm:

| trusted (v1.0.1) | sandboxed (v2.0.0) |
| --- | --- |
| `ctx.ui.showStatusBarItem("0 words", "right")` → item handle | `contributions.statusBar: [{ id: "count", … }]` + `ctx.ui.setStatusBarText("count", …)` |
| `ctx.editor.getContent()` (sync) | `await ctx.editor.getMarkdown()` |
| `ctx.ui.addStyle(STYLE)` | **dropped** — no DOM or CSS in this tier |
| `ctx.events.on(…)` × 3 | unchanged; all three events are deliverable |

Confirmed available: `editor:ready`, `file:open`, `file:save` are the whole `PluginEventName`
union and all three are in `sandbox-event-bridge`'s delivery table.

**Major version, not minor.** The manifest's `trust` changes and the plugin's realm changes with
it; an existing v1.0.1 install is a legacy record that Phase 5 already refuses to auto-run, so
the update is a re-consent, not a patch. `engines.baram` rises to `>=0.5.0` — the sandboxed
runtime has never shipped in a release before that (see §7 step 0).

**Accepted loss:** the `font-variant-numeric: tabular-nums` styling. The count now inherits the
host's status-bar styling. Giving the tier a way to style host-rendered items is a real gap, but
it is a contribution-surface feature, not something to smuggle into a port.

### 3.3 `baram-ai-summary` — withdrawn from the registry, kept in-repo as the trusted example

`PluginContributions` has no `sidebar` member, and the sandboxed tier has **no surface that can
display a summary**: `showNotification` is transient, `setStatusBarText` is capped at 64
characters, and `editor.insertText` needs a write grant the plugin does not have and should not
get for this. So it cannot be ported without first building a declarative panel — Phase 4's
remaining contribution surface, not this phase's.

- **Registry:** the entry is removed from `index.json`. The published ZIP stays (the registry's
  immutable-versions policy), it is simply no longer indexed.
- **In-repo:** the manifest gains `trust: "trusted"`, which is what it actually is. Without it
  the example fails `validateManifest` and cannot even be dev-loaded — today it is dead code.
  Its README states it is not published pending a declarative sidebar contribution.

Not shipped as a *published* trusted plugin: teaching users to click through a full-trust
warning for something as ordinary as summarising a document is the opposite of what the consent
dialog is for.

### 3.4 The malicious fixture is split by enforcement layer, not by convenience

A sandboxed plugin's capabilities are enforced in **two different places**, and the split is
architectural — `sandbox-client.ts` exposes the brokered members unconditionally *by design*,
because the Rust authorizer keyed on `window.label()` is the real gate:

| attack surface | refused by | testable in |
| --- | --- | --- |
| `storage_*`, `http_fetch`, `files_*`, `staged_read`, `source_read` | Rust `PluginAuthorizer::authorize_op` | **cargo** |
| `ai`, `editor`, `settings`, `ui` | `capability-gate.ts` in the main realm | **vitest** |
| raw invoke of app commands (`read_file`, `keyring_*`, …) | Tauri ACL (`capabilities/plugin-sandbox.json`) | already pinned by `tests/acl_lockdown.rs` |

So the fixture drives **both** suites, and neither suite fakes the other's decision:

- **vitest** (`malicious-fixture.test.ts`) runs the real fixture module through the real
  `startSandboxClient` ↔ `createChannelPair` ↔ real `SandboxSession` + real
  `createHostRequestHandler`, with capabilities `["commands", "statusbar"]`. It asserts that
  every host-mediated attack is refused **by the real gate's message**, and that a broker
  denial **propagates to plugin code** rather than being softened to `undefined`.
- **cargo** (`plugin::authorizer` tests) asserts the decision for the brokered ops: a plugin
  registered with `["commands", "statusbar"]` is refused every op that needs a grant.

The broker in the vitest half is a **recorder that denies**. It is not pretending to be the
authorizer: what that half asserts is *reachability and propagation* (the op left the sandbox,
carried no forgeable identity, and its refusal reached plugin code), while *the decision* is
asserted where it is actually made. Stating this in the test file matters — a reader who thinks
the JS broker is the gate would "improve" it into a second capability model that drifts.

### 3.5 Anti-drift is compiler-enforced, not a source scan

Both halves key their attack table off an **exhaustive record over the `PluginOp` discriminant**:

```ts
// TS: fails typecheck if a variant is added
const ATTACKED: Record<PluginOp["kind"], "attacked" | { exempt: string }> = { … };
```

```rust
// Rust: a match over &PluginOp that names every variant fails to compile if one is added
fn adversary_ops() -> Vec<PluginOp> { … } // built from an exhaustive match, no `_` arm
```

A new op therefore breaks **both builds** until someone decides whether the adversary attacks
it. Chosen deliberately over a shared `attacks.json` cross-check or a source scan: four guards
in Phase 5 were hollow because a source scan found *a* match rather than *the* match
(`source-scan-guards-find-a-match`), and the type system does this job without a regex.

Exempt variants carry their reason in the record. `source_read` is the honest one: it needs no
grant, because reading one's own bundle is how the sandbox boots (`required_capability()` is
`Option`).

## 4. Files

*As built. Two entries moved from the original sketch, noted inline.*

**Create**
- `examples/plugins/malicious-fixture/baram-plugin.json` — sandboxed, `["commands","statusbar"]`
- `examples/plugins/malicious-fixture/index.mjs` — single-file ESM adversary, 20 attacks
- `examples/plugins/malicious-fixture/README.md` — what it is, why it must never be published
- `src/plugins/__tests__/malicious-fixture.test.ts` — the vitest half + fixture guards
- `src/plugins/__tests__/registry-index-script.test.ts` — the release script, run as a child
  process. *(Sketched as `scripts/__tests__/…`; vitest's `include` is `src/**`, and widening it
  would pull `scripts/` into the wrong tsconfig project. Location is irrelevant — the test
  spawns `node`.)*
- `src/plugins/__tests__/registry-client.test.ts` — the unknown-tier normalization
- `src/plugins/__tests__/reference-plugins.test.ts` — both reference plugins, and the seed
  agreeing with the manifest
- *(the cargo half went into `src-tauri/src/plugin/authorizer.rs`'s existing `mod tests`, not a
  new file — it reuses that module's `register`/`authorize_op` conventions)*

**Modify**
- `scripts/update-registry-index.mjs` — require + carry `trust`
- `src-tauri/src/plugin/mod.rs` — `RegistryEntry.trust` (§2.1), the round-trip pin, tightened
  seed guard
- `src/plugins/registry-client.ts` — `normalizeIndex`, before caching
- `src/plugins/{types.ts,public-api.ts}`, `src/plugins/sandbox/sandbox-client.ts` + the eight
  test files that imported `SandboxContext` from it (§2.2)
- `src-tauri/src/plugin/authorizer.rs` — the adversary sweep + the two-sided oracle
- `.github/workflows/plugin-release.yml` — fixture-directory denylist, before any build
- `registry/index.json` — local seed: word-count 2.0.0 + `trust`, ai-summary removed
- `examples/plugins/word-count/{baram-plugin.json,package.json,src/index.ts,README.md}`;
  `styles.css` **deleted** (it mirrored the dropped `addStyle` CSS)
- `examples/plugins/ai-summary/{baram-plugin.json,README.md}` — `trust: "trusted"` + not-published note
- `docs/plugin-development.md` — the two tiers, and two instructions that were **wrong** for the
  sandboxed tier (`--external` bundling, `deactivate` as a lifecycle hook)
- `dev/superpowers/specs/2026-07-23-plugin-execution-model-260-design.md` — phase 6 DONE + the
  §7/§8 amendments
- issue #260 — the last completion criterion

## 5. Non-goals

- Declarative `sidebar` contribution (Phase 4 remainder; brings ai-summary back).
- Status-bar styling for host-rendered items.
- Publishing the malicious fixture. It is a repo fixture; the release workflow only builds a
  tagged directory, and no tag will ever name this one.
- A per-plugin origin. The `BroadcastChannel` / `indexedDB` collusion residuals recorded in the
  ADR stay open; the fixture does not attack them because nothing today refuses them.

## 6. Test plan

| what | how |
| --- | --- |
| release refuses a `trust`-less manifest | vitest over `update-registry-index.mjs`, run as a child process, asserting exit 1 + message |
| release carries `trust` through | same suite, asserting the written entry |
| word-count stays loadable & sandboxed | `validateManifest` + `pluginTrustOf`, the `sandbox-smoke-fixture.test.ts` pattern |
| word-count's declared ids match the ones it addresses | regex-extracted `setStatusBarText` ids vs `contributions.statusBar` |
| ai-summary stays a valid trusted manifest | `validateManifest` + `pluginTrustOf` === `"trusted"` |
| host-mediated attacks refused | vitest, real client ↔ real session, real gate messages |
| broker denials propagate unsoftened | vitest, recorder-broker rejects → fixture reports a denial |
| every `PluginOp` is attacked or exempt | exhaustive `Record<PluginOp["kind"], …>` (TS) + no-`_`-arm match (Rust) |
| brokered ops refused | cargo, `authorize_op` per adversary op |
| fixture is a single self-contained ESM | no `import`/`require` in source; `export … activate` |

Mutation-test every guard: break the subject, watch the guard fail. A guard that still passes
is not a guard.

## 7. Release (user-gated, after merge) — ORDER IS LOAD-BEARING

‼️ **Step 0 comes first, and skipping it is a user-visible break** (§260 Phase 6 code review,
H1). `engines.baram` is validated as a non-empty string and **never compared** — nothing
enforces it. The app is at 0.4.1, and v0.4.1 has no `sandbox-host.ts`, no `trust` in
`validateManifest`, and no legacy gate in the marketplace. So if the plugin is published first,
a v0.4.1 user gets an **enabled** Install, the bundle loads in the main realm against a trusted
`ExtensionContext` that has neither `ui.setStatusBarText` nor `editor.getMarkdown`, and
`activate` throws. Worse for someone holding v1.0.0: `checkForUpdates` offers 2.0.0 and that
build's `handleUpdate` is the pre-fix uninstall-then-install, so a **working plugin is destroyed
and replaced with a broken one**.

0. **Release the app first** — the version carrying Phases 5+6 (`v0.5.0`, which is what
   `engines.baram: ">=0.5.0"` names).
1. `plugin-word-count-v2.0.0` tag → workflow publishes ZIP + index entry **with `trust`**.
2. Paste the workflow's `sha256sum` output into this repo's `registry/index.json`, replacing the
   all-zero placeholder. **Nothing automates this and no test catches it** — the workflow updates
   only the registry repo's index, and the seed guard checks that the checksum is 64 hex
   characters, which zeros satisfy.
3. A direct commit on `sayinel/baram-plugins` removes the ai-summary entry from `index.json`.
4. Verify in the app: word-count installs behind the consent dialog and counts.

Each step is outward-facing and needs explicit approval at the time — not covered by approval
of this design.

## 8. Bounds

- The vitest half cannot prove the Rust decision, and the cargo half cannot prove the wiring.
  Only the packaged live smoke (`sandbox-smoke`) runs the whole chain, and it stays manual.
- An existing word-count v1.0.1 install is not migrated. It is a legacy record: Phase 5 will not
  auto-run it, and the user re-consents on update. Nothing removes the stale record if the user
  never opens the marketplace again.
- The adversary holds `["commands","statusbar"]`. A *differently* malicious plugin holding real
  grants (a `files`-granted plugin overwriting user content) is not an attack the fixture can
  assert on — that is the capability working as designed, and it stays an ADR residual.
