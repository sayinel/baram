# Plugin Sandbox Transport Hardening (§260 Phase 3c-2a) Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Implement task-by-task, run the stated test after each step, commit per task.

**Goal:** Close a boundary hole found while auditing 3c-1: a `plugin-*` sandbox webview holds `core:event:allow-listen`, and Tauri v2 delivers **every** broadcast event to a JS listener registered with the default `Any` target — so a sandboxed plugin with **zero capabilities** can eavesdrop on `llm:token` (the user's whole AI output), `file:changed/created/deleted` (vault paths), `file:open-request`, and `menu-event`. Replace the sandbox's event-based transport with per-webview IPC primitives so `core:event:*` can be withheld from `plugin-*` entirely, making eavesdropping structurally impossible. Also fix the sandbox `<meta>` CSP that still blocks plugin ESM.

**Why the emitter side cannot fix it (verified in tauri 2.11.5 source):**

```rust
// src/event/listener.rs:306
fn match_any_or_filter<F>(target: &EventTarget, filter: &Option<F>) -> bool {
  *target == EventTarget::Any || filter.as_ref().map(|f| f(target)).unwrap_or(true)
}
```

`emit_to`/`emit_filter` both route through `emit_js_filter` → `match_any_or_filter`, which short-circuits on `EventTarget::Any`. The JS `listen(name, cb)` call registers `{kind:'Any'}` when no `target` option is given (`@tauri-apps/api/event.js:75`), so an `Any` listener receives events regardless of any emitter-side filter or target. **Switching the app's ~24 `app_handle.emit()` calls to `emit_to`/`emit_filter` would not withhold anything.** The only effective lever is the ACL: do not grant `core:event:allow-listen` to `plugin-*`.

**Architecture:** the sandbox transport stops using Tauri events in both directions.

```
host realm (main)                         Rust                        sandbox realm (plugin-<id>)
  session.transport.send(m) ──invoke──▶ plugin_sandbox_send(pluginId,msg)
                                          host_window_guard(label)
                                          channels[plugin-<id>].send(msg) ──IPC Channel──▶ channel.onmessage(m)
                                                                                            (direct to caller webview,
                                                                                             never broadcast)
  listen("plugin:s2h") ◀──emit──────── plugin_sandbox_report(msg)  ◀────invoke──────────── transport.send(m)
   (filter by pluginId)                  sandbox_window_guard(label)
                                         pluginId = label (unforgeable)
                                                                    ◀────invoke──────────── plugin_sandbox_connect(channel)
                                                                                             (once, at sandbox boot)
```

- **h2s** = a `tauri::ipc::Channel` the sandbox hands to Rust once at boot. `Channel::send` resolves that webview's own IPC callback — it is not an event and reaches no other window.
- **s2h** = `plugin_sandbox_report`; Rust re-emits as `plugin:s2h` with the **caller-derived** `pluginId`. Broadcast is safe because no `plugin-*` window can listen at all any more.
- **The per-session token disappears.** It existed only so another sandbox could not guess this session's event-channel name; identity is now `window.label()`, verified by Tauri. Strictly stronger, one less secret.
- Resulting **granted** sandbox IPC surface: `plugin_call` + `plugin_sandbox_connect` + `plugin_sandbox_report` — no events, no other app command. (Not identical to the **reachable** surface: tauri's `FETCH_CHANNEL_DATA_COMMAND` is hardcoded ACL-exempt. Recorded in the ADR after the 3c-2a review; keep h2s frames under 8 KiB so that path is never taken.)

**Tech Stack:** Rust (Tauri v2 `ipc::Channel`, managed state, `#[tauri::command]`), TypeScript (`@tauri-apps/api/core` `Channel`/`invoke`), Vitest + `cargo test`.

## Global Constraints

- **Scope = the transport + its ACL + the sandbox CSP fix.** In: Rust channel registry + 3 commands + ACL/capability/build.rs wiring; TS host/sandbox transport adapters + `SandboxHost` token removal; `sandbox.html` CSP; ADR note. **Deferred (do NOT build here):** brokered `files` ops + `ai` host-mediated RPC → **3c-2b**; the real-WebviewWindow LIVE round-trip smoke → **3c-3**; declarative statusbar/menu/settings/sidebar mapping → Phase 4.
- **Do NOT touch the app's `app_handle.emit()` call sites.** Proven ineffective above; changing them would imply a protection that does not exist.
- **Plugins stay OFF** (`VITE_ENABLE_PLUGINS`) and sandbox-webview creation stays dev-gated (`isSandboxRuntimeAllowed`). No behavior change to either gate.
- **No test may create a real webview.** Rust tests construct `Channel::new(|body| …)` directly; TS tests mock `invoke`/`listen`/`Channel`.
- **Guardrail parity:** `tests/acl_lockdown.rs` derives the command set from `generate_handler!`; every new command must land in `build.rs` **and** exactly one capability file, and the sandbox capability's *full* permission array assertion must be updated.
- **TS conventions:** `import type` (`verbatimModuleSyntax`), files ≤ ~300 lines, no bare Zustand calls (none expected here).

---

### Task 1: Rust — sandbox channel registry + `connect`/`report`/`send` commands

**Files:**

- Create: `src-tauri/src/plugin/channels.rs` (registry + unit tests)
- Modify: `src-tauri/src/plugin/mod.rs` (re-export), `src-tauri/src/commands/plugin_cmd.rs` (3 commands + deregister cleanup), `src-tauri/src/lib.rs` (`manage` + `generate_handler!`), `src-tauri/build.rs` (AppManifest commands)

**Interfaces:**

- Produces: `SandboxChannels` managed state with `connect(label, Channel)`, `disconnect(label)`, `send(label, Value) -> Result<(), String>`; commands `plugin_sandbox_connect`, `plugin_sandbox_report`, `plugin_sandbox_send`.
- Consumes: `plugin_id_from_label` (authorizer), the existing `host_window_guard` in `plugin_cmd.rs`.

- [ ] **Step 1: Write the failing tests** in `src-tauri/src/plugin/channels.rs` — `Channel::new(move |body| { captured.lock().push(body); Ok(()) })`, then: `send` to a connected label delivers; `send` to an unknown label is `Err`; `disconnect` makes a subsequent `send` `Err`; two labels are isolated (a send to `plugin-a` never reaches `plugin-b`'s sink).
- [ ] **Step 2: Run them, watch them fail** — `cd src-tauri && cargo test plugin::channels` (module missing).
- [ ] **Step 3: Implement `channels.rs`** — `Mutex<HashMap<String, Channel<serde_json::Value>>>`, keyed by the **window label** (`plugin-<id>`). `send` clones the channel out of the lock before sending (never hold the mutex across `send`). Errors are user-legible strings (`Result<T, String>` at the IPC edge).
- [ ] **Step 4: Add a `sandbox_window_guard`** next to the existing `host_window_guard` in `plugin_cmd.rs` — the mirror check: caller label MUST parse as `plugin-<id>`, returning the id. Add the 3 commands:
  - `plugin_sandbox_connect(window, channel: tauri::ipc::Channel<serde_json::Value>, channels: State<SandboxChannels>)` — sandbox-guard; additionally require the authorizer already knows this label (`is_registered`) so an unregistered window cannot park a channel; store it.
  - `plugin_sandbox_report(window, msg: serde_json::Value, app: AppHandle)` — sandbox-guard; `app.emit("plugin:s2h", json!({"pluginId": id, "msg": msg}))`. Comment WHY a plain broadcast is safe here (no `plugin-*` window holds `core:event:allow-listen`) and WHY `emit_filter` is not used (the `Any`-target bypass, cite `event/listener.rs:306`).
  - `plugin_sandbox_send(window, plugin_id, msg, channels: State<SandboxChannels>)` — `host_window_guard`; `channels.send(&format!("plugin-{plugin_id}"), msg)`.
- [ ] **Step 5: Add `PluginAuthorizer::is_registered(&self, label) -> bool`** + a unit test (registered → true, after `deregister` → false, non-sandbox label → false).
- [ ] **Step 6: Clean up on deregister** — `plugin_sandbox_deregister` also calls `channels.disconnect(&format!("plugin-{plugin_id}"))` so a stopped plugin's channel cannot be sent to.
- [ ] **Step 7: Wire `lib.rs`** — `.manage(plugin::SandboxChannels::default())` next to the authorizer; add the 3 commands to `generate_handler!` (keep the existing ordering convention).
- [ ] **Step 8: Wire `build.rs`** — add `"plugin_sandbox_connect"`, `"plugin_sandbox_report"`, `"plugin_sandbox_send"` to `AppManifest::commands` (alphabetical, beside the existing `plugin_sandbox_*`).
- [ ] **Step 9: Run** — `cargo test plugin::` green; `cargo test --test acl_lockdown` now FAILS (capabilities not yet updated) — expected, fixed in Task 2.
- [ ] **Step 10: Commit** — `feat(§260): Rust sandbox IPC-channel transport (connect/report/send) (Phase 3c-2a)`.

---

### Task 2: ACL — withhold `core:event:*` from `plugin-*`, grant the new commands

**Files:**

- Modify: `src-tauri/capabilities/plugin-sandbox.json`, `src-tauri/capabilities/default.json`, `src-tauri/tests/acl_lockdown.rs`

**Interfaces:** none (config). This is the step that actually closes the eavesdropping hole.

- [ ] **Step 1: Update the guardrail test first** — in `sandbox_tier_grants_exactly_its_allowlist`, replace the expected set with `allow_plugin_call`, `allow_plugin_sandbox_connect`, `allow_plugin_sandbox_report` (**no** `core:event:*`), and rewrite the doc comment to state the new invariant: a `plugin-*` window holds NO event permission, because Tauri delivers broadcasts to any `Any`-target listener regardless of emitter filtering. Update `main_tier_gets_everything_except_plugin_call` to expect main = registered − {`plugin_call`, `plugin_sandbox_connect`, `plugin_sandbox_report`} and rename it accordingly (`main_tier_gets_everything_except_sandbox_only_commands`).
- [ ] **Step 2: Run it, watch it fail** — `cargo test --test acl_lockdown`.
- [ ] **Step 3: Edit `plugin-sandbox.json`** — permissions become exactly `["allow-plugin-call", "allow-plugin-sandbox-connect", "allow-plugin-sandbox-report"]`; rewrite `description` to explain the event-permission withdrawal and the `Any`-target reason.
- [ ] **Step 4: Edit `default.json`** — add `"allow-plugin-sandbox-send"` (host-only). Do **not** add connect/report (the XOR guardrail enforces this).
- [ ] **Step 5: Run** — `cargo test --test acl_lockdown` green (4/4); `cargo build` clean (regenerates `permissions/autogenerated`, which is gitignored).
- [ ] **Step 6: Commit** — `feat(§260): drop core:event from sandbox ACL, grant channel commands (Phase 3c-2a)`.

---

### Task 3: TS — host/sandbox transport adapters over the new commands

**Files:**

- Modify: `src/ipc/plugin-invoke.ts` (3 wrappers)
- Create: `src/plugins/sandbox/tauri-host-transport.ts`, `src/plugins/sandbox/tauri-sandbox-transport.ts`
- Delete: `src/plugins/sandbox/tauri-transport.ts`
- Modify: `src/plugins/sandbox/sandbox-host.ts` (drop the token; use the host transport), `src/sandbox/sandbox-entry.ts` (use the sandbox transport)
- Test: `src/plugins/sandbox/__tests__/tauri-host-transport.test.ts`, `src/plugins/sandbox/__tests__/tauri-sandbox-transport.test.ts`; update `src/plugins/sandbox/__tests__/sandbox-host.test.ts`

**Interfaces:**

- Produces: `pluginSandboxSend(pluginId, msg)`, `pluginSandboxReport(msg)`, `pluginSandboxConnect(channel)`; `createHostTransport(pluginId): Promise<SandboxTransport<SandboxToHost, HostToSandbox>>`; `createSandboxTransport(): Promise<SandboxTransport<HostToSandbox, SandboxToHost>>`.
- Split into two files so the sandbox bundle never pulls `listen` and the host bundle never pulls `Channel` — the boundary should be visible in the import graph, not only in comments.

- [ ] **Step 1: Write the failing tests.**
  - `tauri-host-transport.test.ts`: mock `@tauri-apps/api/event`'s `listen` and `@tauri-apps/api/core`'s `invoke`. Assert (a) `send(m)` invokes `plugin_sandbox_send` with `{pluginId, msg: m}`; (b) a `plugin:s2h` event whose payload `pluginId` matches is delivered to `onMessage` handlers; (c) a payload for a **different** `pluginId` is NOT delivered; (d) a rejected `plugin_sandbox_send` does not produce an unhandled rejection (the pre-connect activate-retry window is normal); (e) `close()` unlistens.
  - `tauri-sandbox-transport.test.ts`: stub `Channel` with a class exposing `onmessage`; assert (a) `plugin_sandbox_connect` is invoked once with the channel; (b) a `channel.onmessage(m)` reaches `onMessage` handlers; (c) `send(m)` invokes `plugin_sandbox_report` with `{msg: m}`.
- [ ] **Step 2: Run them, watch them fail** — modules do not exist.
- [ ] **Step 3: Add the 3 wrappers** to `src/ipc/plugin-invoke.ts`, following the file's existing `invoke<T>("cmd", {args})` style.
- [ ] **Step 4: Implement the two transports.** The host transport awaits its `listen` before resolving (unchanged reason: never miss a fast `ready`); its `send` catches and debug-logs rejections. The sandbox transport creates the `Channel`, sets `onmessage`, then awaits `pluginSandboxConnect(channel)` **before** resolving, so no h2s message can arrive before the handler set exists.
- [ ] **Step 5: Update `sandbox-host.ts`** — delete the `token`/`crypto.randomUUID()` line, change `SandboxWindowFactory` to `(label: string, pluginId: string) => …`, drop `&token=` from the sandbox URL, and have `defaultWindowFactory` build the host transport via `createHostTransport(pluginId)`. Update the file's header comment (no more token-scoped event transport).
- [ ] **Step 6: Update `sandbox-entry.ts`** — replace the hand-rolled emit/listen transport with `await createSandboxTransport()`; drop the `token` URL param read. Keep `pluginCall` as the broker.
- [ ] **Step 7: Update `sandbox-host.test.ts`** for the factory signature change; delete any token assertions.
- [ ] **Step 8: Run** — `npm test -- sandbox` green; `npm run typecheck` clean.
- [ ] **Step 9: Commit** — `feat(§260): replace sandbox event transport with per-webview IPC channel (Phase 3c-2a)`.

---

### Task 4: `sandbox.html` CSP — allow the plugin ESM the sandbox is supposed to import

**Files:** Modify `sandbox.html`

**Interfaces:** none (config). A `<meta>` CSP can only **tighten** the header CSP, so the Phase-2 `script-src 'self'` silently overrides 3c-1's global `asset:` widening *inside the sandbox* — the one realm that must import plugin ESM. Left as-is, the 3c-3 live smoke fails at `import(pluginUrl)`.

- [ ] **Step 1: Widen the meta `script-src`** to `'self' asset: http://asset.localhost` (mirroring the global CSP). Leave `default-src 'none'`, `connect-src ipc: http://ipc.localhost` (invoke + the Channel large-payload fetch path) unchanged — the sandbox still has no network, no styles, no images.
- [ ] **Step 2: Update the stale comment** — it says the `asset:` allowance "lands in Phase 3"; state instead that the sandbox mirrors the global `script-src` for plugin ESM only, and that everything else stays `'none'`.
- [ ] **Step 3: Verify** — `npm run build` succeeds (sandbox.html is a Vite entry). Effective-CSP proof is part of the 3c-3 live smoke.
- [ ] **Step 4: Commit** — `fix(§260): allow asset: script-src in sandbox CSP so plugin ESM loads (Phase 3c-2a)`.

---

### Task 5: Record the Tauri event-target finding in the ADR

**Files:** Modify `dev/superpowers/specs/2026-07-23-plugin-execution-model-260-design.md`

- [ ] **Step 1: Add a note** after the existing "Tauri v2 ACL note", titled `### Tauri v2 event-target note (surfaced 2026-07-26, shapes Phase 3c-2a)`: `emit_to`/`emit_filter` cannot withhold an event from a webview whose JS listener uses the default `Any` target (`match_any_or_filter`, `src/event/listener.rs:306`); therefore a sandbox realm must hold **no** `core:event:*` permission, and its transport must use per-webview IPC (`ipc::Channel` inbound, a caller-identified command outbound). Note the consequence for §12's criteria: "no raw Tauri invoke" is necessary but not sufficient — event eavesdropping is a separate boundary property.
- [ ] **Step 2: Commit** — `docs(§260): record Tauri Any-target event finding in the ADR (Phase 3c-2a)`.

---

## Verification (before PR / merge)

- `npm test` — full Vitest suite green (new transport suites + updated `sandbox-host`).
- `npm run typecheck` — clean (3 projects).
- `npm run lint` — clean (format + knip; the deleted `tauri-transport.ts` must leave no dangling import).
- `cd src-tauri && cargo test` — green, incl. `plugin::channels`, the new authorizer test, and `acl_lockdown` (4/4).
- `cd src-tauri && cargo clippy --all-targets` — clean (pre-push hook runs it).
- `npm run build` + `cargo build` — clean (Vite entry + `tauri.conf.json`/permission regeneration).
- **Boundary re-audit (manual reasoning, recorded in the PR body):** enumerate the sandbox capability's permissions and confirm the only GRANTED IPC is (reachable additionally includes tauri's ACL-exempt `FETCH_CHANNEL_DATA_COMMAND` — see the ADR) `plugin_call` (authorizer-gated), `plugin_sandbox_connect` (sandbox-guard + must be registered), `plugin_sandbox_report` (sandbox-guard, caller-derived id).

**Deferred:** brokered `files` + host-mediated `ai` (3c-2b); LIVE real-webview round-trip smoke — activate a real sandboxed plugin, invoke a command, round-trip a `storage` op, and confirm the plugin ESM loads under the sandbox CSP (3c-3, user-run, the definitive proof); trusted opt-in + release-gate lift (Phase 5); reference-plugin port + malicious-fixture CI (Phase 6).

## Self-Review notes

- **Does this actually close the hole?** Yes, and at the only effective layer. Eavesdropping needed `listen`; `listen` is an ACL-gated command (`core:event:allow-listen`); after Task 2 a `plugin-*` window has no event permission at all, so `listen`/`emit`/`unlisten` are all rejected before reaching the event system. The `Any`-target bypass is irrelevant once no listener can be registered.
- **Did we lose anything?** Only the per-session token, whose sole purpose (unguessable channel name) is superseded by Tauri-verified `window.label()`. h2s is now point-to-point by construction rather than by secrecy.
- **New attack surface?** Two new commands, both label-guarded and mirror-imaged: `connect`/`report` are sandbox-only (a host window is rejected), `send` is host-only (a sandbox cannot push into another sandbox). `report` carries no caller-supplied id — Rust stamps the id from the label, so plugin A cannot impersonate plugin B on the host's `plugin:s2h` channel. `connect` additionally requires prior host registration.
- **Fail-closed?** `send` to an unconnected/disconnected label errors instead of silently dropping; `deregister` disconnects, so a stopped plugin's channel is unreachable.
- **Regression risk to trusted plugins:** none — the trusted tier never touches the sandbox transport.
- **Live-smoke risk acknowledged:** the activate handshake still relies on the existing 250 ms retry until the sandbox's `connect` lands (`plugin_sandbox_send` errors until then). If the 3c-3 smoke shows the 5 s activate budget is tight on a cold Vite dev transform, raising `ACTIVATE_TIMEOUT_MS` is the fix — deliberately not pre-tuned here without evidence.
