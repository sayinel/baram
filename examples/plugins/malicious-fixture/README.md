# Malicious Fixture — do not publish

The adversary for §260's last completion criterion: _"a malicious plugin fixture verifies the
deny paths in CI."_

It declares `commands` and `statusbar`, and then asks for everything it was not granted —
storage (including another plugin's), the network, vault files (by relative path, by absolute
path, by traversal, and inside the app's own `.baram` state), the document (read _and_ write),
the user's settings, and a status-bar item it never declared.

**A `denied(...)` on every line is a pass. One `ADMITTED(...)` is the boundary failing.**

## Why it is split across two test suites

A sandboxed plugin's capabilities are enforced in **two different places**, and the split is
architectural rather than a testing compromise — `sandbox-client.ts` exposes the brokered
members unconditionally _on purpose_, because the Rust authorizer keyed on the Tauri-verified
`window.label()` is the real gate:

| what it attacks                      | refused by                                     | asserted in                            |
| ------------------------------------ | ---------------------------------------------- | -------------------------------------- |
| `storage_*`, `http_fetch`, `files_*` | Rust `PluginAuthorizer::authorize_op`          | `cargo test` (`authorizer.rs`)         |
| `ai`, `editor`, `settings`, `ui`     | `capability-gate.ts`, main realm               | `vitest` (`malicious-fixture.test.ts`) |
| raw invoke of app commands           | Tauri ACL (`capabilities/plugin-sandbox.json`) | `cargo test` (`tests/acl_lockdown.rs`) |

The vitest half runs **this file** through the real `startSandboxClient`, a real
`SandboxSession` and the real host bridges, so it proves the wiring: each attack left the
sandbox, carried no forgeable identity, and its refusal reached plugin code un-softened. It
does **not** pretend to be the Rust authorizer — its broker stand-in only records and denies,
and the _decision_ is asserted where it is actually made.

A new `PluginOp` variant breaks **both** suites until someone classifies it: the TS side keys
an exhaustive `Record<PluginOp["kind"], …>` and the Rust side a `match` with no wildcard arm.

## Running it by hand

1. Settings → Plugins → Developer → "Load dev plugin folder" → this directory.
2. The status bar shows `😈 armed` — the one call this fixture is allowed to make. It is there
   so a failure to reach the host at all cannot be mistaken for a capability refusal.
3. Run **Malicious Fixture: run every denied call** from the command palette. The command
   returns the report; the sandbox console shows the refusals as they happen.

## Never published

`plugin-release.yml` refuses this directory (and `sandbox-smoke`) by name in its tag-parsing
step, so a mistyped `plugin-malicious-fixture-v1.0.0` tag cannot push an attack plugin to the
public registry. `malicious-fixture.test.ts` pins that refusal, and the fixture is absent from
`registry/index.json`.
