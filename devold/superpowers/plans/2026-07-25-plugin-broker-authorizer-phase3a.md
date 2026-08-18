# Plugin Broker + Authorizer (Phase 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the Rust side of the sandbox trust boundary: a `PluginAuthorizer` (maps a Tauri-verified `window.label()` → the plugin's granted capabilities), a `plugin_call` broker command that authorizes each op by caller identity + capability, and `plugin_sandbox_register`/`deregister` (host-only). Storage ops route through the **caller-derived** plugin id (isolation), never a user-supplied arg.

**Architecture:** A sandboxed webview (label `plugin-<id>`) will (in Phase 3c) call `invoke("plugin_call", { op })`. Tauri hands the command the calling `WebviewWindow`; the broker reads `window.label()` (unforgeable), looks up the plugin's registered capabilities in the `PluginAuthorizer` managed-state map, checks `op.required_capability()`, and only then executes a bounded operation. The host (main window) populates the authorizer via `plugin_sandbox_register` at sandbox start. This phase is **Rust-only**, unit-tested with `cargo test`.

**Tech Stack:** Rust (Tauri 2.0, serde, serde_json), `mod.rs` module pattern, `thiserror`.

## Global Constraints

- **This phase does NOT enforce the full boundary and does NOT wire the frontend.** Tauri v2 custom commands are ungated by default (the sensitive-command ACL lockdown is **Phase 3b**), the loader stays unwired and plugins OFF (**Phase 3c**), and no frontend `plugin_call` wrapper / `SandboxHost` registration lands here (3c). So a plugin could still bypass `plugin_call` until 3b — but nothing loads a plugin this phase. The authorizer + broker are the machinery 3b/3c build on.
- Rust: `mod.rs` pattern; IPC commands return `Result<T, String>`; `thiserror` for the error enum.
- **`ipc-registry.json` is canonical** — add the 3 new commands there (do NOT touch `src/ipc/types.ts` this phase; the frontend wrappers land in 3c).
- Managed state via `.manage(...)` in `lib.rs`; commands registered in `tauri::generate_handler!`.
- Conventional Commits, English, reference `§260`. `cargo clippy --all-targets -- -D warnings` must stay clean (pre-push gate).
- Storage isolation MUST derive the plugin id from the authorized caller label, never from a command argument.

---

### Task 1: PluginAuthorizer + PluginOp (the security core, pure/unit-tested)

**Files:**
- Create: `src-tauri/src/plugin/authorizer.rs`
- Modify: `src-tauri/src/plugin/mod.rs` (add `mod authorizer;` + `pub use authorizer::{PluginAuthorizer, PluginOp, plugin_id_from_label};`)

**Interfaces — Produces:**
- `plugin_id_from_label(label: &str) -> Option<String>` — `"plugin-<id>"` → `Some("<id>")`, else `None`.
- `enum PluginOp` (serde internally-tagged on `"kind"`, snake_case): `StorageRead{key}`, `StorageWrite{key,value}`, `StorageList`, `StorageRemove{key}`, `HttpFetch{url, init: Option<PluginFetchInit>}`; method `required_capability(&self) -> &'static str` (storage ops → `"storage"`, HttpFetch → `"network"`).
- `enum AuthzError` (thiserror): `NotASandbox`, `Unregistered`, `Denied(String)`.
- `struct PluginAuthorizer` (managed state): `register(&self, label: String, capabilities: Vec<String>)`, `deregister(&self, label: &str)`, `authorize(&self, label: &str, cap: &str) -> Result<String, AuthzError>` (returns the caller's plugin id on success).

- [ ] **Step 1: Write authorizer.rs with failing tests**

Create `src-tauri/src/plugin/authorizer.rs`:

```rust
// §260 Phase 3a — the sandbox authorizer. Maps a Tauri-verified window label
// (`plugin-<id>`) to the capabilities the host registered for that plugin, and
// authorizes each brokered op by caller identity + capability. The label is
// unforgeable (Tauri sets it); the granted set is populated by the host window
// via `plugin_sandbox_register` (a plugin window is rejected from registering).
use std::collections::HashMap;
use std::sync::Mutex;

use serde::Deserialize;
use thiserror::Error;

use super::PluginFetchInit;

/// `"plugin-<id>"` → `Some("<id>")`; `None` for any non-sandbox window label.
pub fn plugin_id_from_label(label: &str) -> Option<String> {
    label.strip_prefix("plugin-").map(str::to_string)
}

/// An operation a sandboxed plugin asks the broker to perform. Execution wiring
/// for network/files/ai lands in Phase 3c; their authorization lives here now.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PluginOp {
    StorageRead { key: String },
    StorageWrite { key: String, value: String },
    StorageList,
    StorageRemove { key: String },
    HttpFetch { url: String, init: Option<PluginFetchInit> },
}

impl PluginOp {
    pub fn required_capability(&self) -> &'static str {
        match self {
            PluginOp::StorageRead { .. }
            | PluginOp::StorageWrite { .. }
            | PluginOp::StorageList
            | PluginOp::StorageRemove { .. } => "storage",
            PluginOp::HttpFetch { .. } => "network",
        }
    }
}

#[derive(Debug, Error)]
pub enum AuthzError {
    #[error("caller is not a sandbox window")]
    NotASandbox,
    #[error("caller is not a registered sandbox")]
    Unregistered,
    #[error("capability \"{0}\" not granted to this plugin")]
    Denied(String),
}

/// Managed state: `label` → granted capability strings.
#[derive(Default)]
pub struct PluginAuthorizer {
    granted: Mutex<HashMap<String, Vec<String>>>,
}

impl PluginAuthorizer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, label: String, capabilities: Vec<String>) {
        self.granted.lock().unwrap().insert(label, capabilities);
    }

    pub fn deregister(&self, label: &str) {
        self.granted.lock().unwrap().remove(label);
    }

    /// On success returns the caller's plugin id (derived from the label) so the
    /// broker uses the CALLER identity — never a client-supplied id — for the op.
    pub fn authorize(&self, label: &str, cap: &str) -> Result<String, AuthzError> {
        let plugin_id = plugin_id_from_label(label).ok_or(AuthzError::NotASandbox)?;
        let map = self.granted.lock().unwrap();
        let caps = map.get(label).ok_or(AuthzError::Unregistered)?;
        if caps.iter().any(|c| c == cap) {
            Ok(plugin_id)
        } else {
            Err(AuthzError::Denied(cap.to_string()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_parsing() {
        assert_eq!(plugin_id_from_label("plugin-abc").as_deref(), Some("abc"));
        assert_eq!(plugin_id_from_label("main"), None);
        assert_eq!(plugin_id_from_label("file-123"), None);
    }

    #[test]
    fn required_capability_mapping() {
        assert_eq!(PluginOp::StorageList.required_capability(), "storage");
        assert_eq!(
            PluginOp::StorageRead { key: "k".into() }.required_capability(),
            "storage"
        );
        assert_eq!(
            PluginOp::HttpFetch { url: "http://x".into(), init: None }.required_capability(),
            "network"
        );
    }

    #[test]
    fn op_deserializes_internally_tagged() {
        let op: PluginOp =
            serde_json::from_str(r#"{"kind":"storage_write","key":"k","value":"v"}"#).unwrap();
        assert!(matches!(op, PluginOp::StorageWrite { .. }));
    }

    #[test]
    fn authorize_grants_when_capability_present_and_returns_caller_id() {
        let a = PluginAuthorizer::new();
        a.register("plugin-alpha".into(), vec!["storage".into(), "network".into()]);
        assert_eq!(a.authorize("plugin-alpha", "storage").unwrap(), "alpha");
        assert_eq!(a.authorize("plugin-alpha", "network").unwrap(), "alpha");
    }

    #[test]
    fn authorize_denies_missing_capability() {
        let a = PluginAuthorizer::new();
        a.register("plugin-alpha".into(), vec!["storage".into()]);
        assert!(matches!(
            a.authorize("plugin-alpha", "network"),
            Err(AuthzError::Denied(_))
        ));
    }

    #[test]
    fn authorize_rejects_unregistered_and_non_sandbox() {
        let a = PluginAuthorizer::new();
        assert!(matches!(a.authorize("plugin-ghost", "storage"), Err(AuthzError::Unregistered)));
        assert!(matches!(a.authorize("main", "storage"), Err(AuthzError::NotASandbox)));
    }

    #[test]
    fn deregister_revokes() {
        let a = PluginAuthorizer::new();
        a.register("plugin-alpha".into(), vec!["storage".into()]);
        a.deregister("plugin-alpha");
        assert!(matches!(a.authorize("plugin-alpha", "storage"), Err(AuthzError::Unregistered)));
    }

    #[test]
    fn distinct_plugins_isolated_identities() {
        // The isolation guarantee: each label authorizes as its OWN id, so the
        // broker (Task 2) namespaces storage by the caller, never a shared arg.
        let a = PluginAuthorizer::new();
        a.register("plugin-a".into(), vec!["storage".into()]);
        a.register("plugin-b".into(), vec!["storage".into()]);
        assert_eq!(a.authorize("plugin-a", "storage").unwrap(), "a");
        assert_eq!(a.authorize("plugin-b", "storage").unwrap(), "b");
    }
}
```

- [ ] **Step 2: Wire the module**

In `src-tauri/src/plugin/mod.rs`, add near the top (after the existing `pub fn plugins_runtime_enabled` / error enum, wherever module declarations sit — add a `mod` line and a re-export):

```rust
mod authorizer;
pub use authorizer::{plugin_id_from_label, PluginAuthorizer, PluginOp};
```

(Confirm `PluginFetchInit` is defined in `plugin/mod.rs` and is `Deserialize` — `authorizer.rs` imports it via `super::PluginFetchInit`. It is used by `plugin_http_fetch` today, so it exists; verify it derives `Deserialize` + `Clone` for the `PluginOp::HttpFetch` variant. If it is not `Clone`, drop `Clone` from `PluginOp`'s derive — nothing in this phase clones a `PluginOp`.)

- [ ] **Step 3: Run to verify the tests fail then pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml plugin::authorizer`
Expected FIRST run before Step 2 compiles: FAIL (module not found). After Step 2: the 8 tests PASS. If `PluginFetchInit` lacks a derive, fix per Step 2's note and re-run.

- [ ] **Step 4: clippy + commit**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

```bash
git add src-tauri/src/plugin/authorizer.rs src-tauri/src/plugin/mod.rs
git commit -m "feat(§260): plugin sandbox authorizer + PluginOp (Phase 3a core)"
```

---

### Task 2: plugin_call broker + register/deregister commands + wiring

**Files:**
- Modify: `src-tauri/src/commands/plugin_cmd.rs` (add `plugin_call`, `plugin_sandbox_register`, `plugin_sandbox_deregister`, an `execute_op` helper, and a `host_window_guard` helper + its test)
- Modify: `src-tauri/src/lib.rs` (`.manage(plugin::PluginAuthorizer::new())` + register the 3 commands)
- Modify: `src-tauri/ipc-registry.json` (document the 3 commands)

**Interfaces:**
- Consumes: `plugin::{PluginAuthorizer, PluginOp, plugin_id_from_label}` (Task 1), and `plugin::{storage_read, storage_write, storage_list, storage_remove, http_fetch}` (existing).
- Produces: three `#[tauri::command]`s. `plugin_call(window, op, authorizer) -> Result<serde_json::Value, String>`; `plugin_sandbox_register(window, plugin_id, capabilities, authorizer) -> Result<(), String>`; `plugin_sandbox_deregister(window, plugin_id, authorizer) -> Result<(), String>`.

- [ ] **Step 1: Write the failing host-window-guard test + execute_op routing**

At the top of the impl in `src-tauri/src/commands/plugin_cmd.rs`, the testable pure helpers. Add this test module at the end of the file:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_window_guard_rejects_plugin_windows() {
        assert!(host_window_guard("plugin-evil").is_err());
        assert!(host_window_guard("main").is_ok());
        assert!(host_window_guard("file-1").is_ok());
    }

    #[test]
    fn execute_op_maps_storage_ok_to_json_null() {
        // StorageWrite/Remove return JSON null on success; StorageList returns an
        // array. We assert the mapping shape for a list against an empty tempdir
        // id (a fresh plugin id has no storage dir yet → []).
        let out = tauri::async_runtime::block_on(execute_op(
            "phase3a-test-empty",
            PluginOp::StorageList,
        ))
        .unwrap();
        assert!(out.is_array());
    }
}
```

- [ ] **Step 2: Run to verify it fails** — `cargo test --manifest-path src-tauri/Cargo.toml plugin_cmd` → FAIL (`host_window_guard`/`execute_op` undefined).

- [ ] **Step 3: Implement the helpers + commands**

In `src-tauri/src/commands/plugin_cmd.rs`, add (near the top, after `use` lines add `use serde_json::Value;` if not present):

```rust
/// Only a host window (main / file-mode) may register or deregister a plugin's
/// capabilities — a sandbox window must never grant itself anything.
fn host_window_guard(label: &str) -> Result<(), String> {
    if plugin::plugin_id_from_label(label).is_some() {
        return Err("sandbox windows may not register/deregister capabilities".to_string());
    }
    Ok(())
}

/// Execute an authorized op using the CALLER-derived plugin id (never a
/// client-supplied id). Storage is namespaced per plugin id → isolation.
async fn execute_op(plugin_id: &str, op: plugin::PluginOp) -> Result<serde_json::Value, String> {
    use plugin::PluginOp::*;
    match op {
        StorageRead { key } => {
            Ok(serde_json::json!(plugin::storage_read(plugin_id.to_string(), key).await?))
        }
        StorageWrite { key, value } => {
            plugin::storage_write(plugin_id.to_string(), key, value).await?;
            Ok(serde_json::Value::Null)
        }
        StorageList => {
            Ok(serde_json::json!(plugin::storage_list(plugin_id.to_string()).await?))
        }
        StorageRemove { key } => {
            plugin::storage_remove(plugin_id.to_string(), key).await?;
            Ok(serde_json::Value::Null)
        }
        HttpFetch { url, init } => {
            Ok(serde_json::json!(plugin::http_fetch(url, init).await?))
        }
    }
}

#[tauri::command]
pub async fn plugin_sandbox_register(
    window: tauri::WebviewWindow,
    plugin_id: String,
    capabilities: Vec<String>,
    authorizer: tauri::State<'_, plugin::PluginAuthorizer>,
) -> Result<(), String> {
    host_window_guard(window.label())?;
    authorizer.register(format!("plugin-{plugin_id}"), capabilities);
    Ok(())
}

#[tauri::command]
pub async fn plugin_sandbox_deregister(
    window: tauri::WebviewWindow,
    plugin_id: String,
    authorizer: tauri::State<'_, plugin::PluginAuthorizer>,
) -> Result<(), String> {
    host_window_guard(window.label())?;
    authorizer.deregister(&format!("plugin-{plugin_id}"));
    Ok(())
}

/// The sole IPC entry point a sandboxed plugin may use for privileged ops. Every
/// call is authorized by the Tauri-verified caller label + registered capability.
#[tauri::command]
pub async fn plugin_call(
    window: tauri::WebviewWindow,
    op: plugin::PluginOp,
    authorizer: tauri::State<'_, plugin::PluginAuthorizer>,
) -> Result<serde_json::Value, String> {
    let plugin_id = authorizer
        .authorize(window.label(), op.required_capability())
        .map_err(|e| e.to_string())?;
    execute_op(&plugin_id, op).await
}
```

Confirm `plugin::http_fetch`, `plugin::storage_read/write/list/remove` are `pub` (they are — used by the existing `plugin_http_fetch`/`plugin_storage_*` commands). Confirm `PluginOp` derives what `serde_json::from` needs at the command boundary (Tauri deserializes the `op` arg via serde — `Deserialize` is derived in Task 1).

- [ ] **Step 4: Register state + commands in lib.rs**

In `src-tauri/src/lib.rs`, add to the `.manage(...)` chain (next to the other `.manage(...)` calls, e.g. after `.manage(embedding_cmd::EmbeddingState::new())`):

```rust
        .manage(plugin::PluginAuthorizer::new())
```

And in the `tauri::generate_handler![ ... ]` list, next to the existing `plugin_cmd::plugin_*` entries, add:

```rust
            plugin_cmd::plugin_call,
            plugin_cmd::plugin_sandbox_register,
            plugin_cmd::plugin_sandbox_deregister,
```

- [ ] **Step 5: Document in ipc-registry.json**

In `src-tauri/ipc-registry.json`, add three entries in the `plugin` module group (mirror the existing plugin command entries' shape):

```json
    {
      "name": "plugin_call",
      "input": { "op": "PluginOp (internally-tagged on \"kind\")" },
      "output": "unknown (op-specific JSON)",
      "module": "plugin",
      "spec": "§260",
      "status": "implemented",
      "description": "§260 broker — authorizes a sandbox op by window.label() + registered capability, executes bounded (caller-derived plugin id)"
    },
    {
      "name": "plugin_sandbox_register",
      "input": { "plugin_id": "string", "capabilities": "string[]" },
      "output": "void",
      "module": "plugin",
      "spec": "§260",
      "status": "implemented",
      "description": "§260 host-only — register a sandbox plugin's granted capabilities (rejects sandbox-window callers)"
    },
    {
      "name": "plugin_sandbox_deregister",
      "input": { "plugin_id": "string" },
      "output": "void",
      "module": "plugin",
      "spec": "§260",
      "status": "implemented",
      "description": "§260 host-only — drop a sandbox plugin's registered capabilities"
    },
```

- [ ] **Step 6: Run tests + build + clippy**

Run: `cargo test --manifest-path src-tauri/Cargo.toml plugin_cmd` → the 2 new tests PASS.
Run: `cargo test --manifest-path src-tauri/Cargo.toml plugin` → all plugin-module tests PASS (authorizer + plugin_cmd).
Run: `cargo build --manifest-path src-tauri/Cargo.toml` → compiles (proves the 3 commands register in `generate_handler!` + managed state resolves).
Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` → clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/plugin_cmd.rs src-tauri/src/lib.rs src-tauri/ipc-registry.json
git commit -m "feat(§260): plugin_call broker + host-only register/deregister (Phase 3a)"
```

---

## Self-Review

**Spec coverage (3a scope):** authorizer maps label→capabilities + per-op capability check (Task 1); `plugin_call` uses the Tauri-verified `window.label()` and the caller-derived plugin id, never a client arg (Task 2 `execute_op`); register/deregister are host-only (`host_window_guard`); storage isolation follows from caller-derived namespacing (existing `plugin_data_dir` guard + authorizer returning the caller's own id — tested in Task 1 `distinct_plugins_isolated_identities`); network-without-`network`-cap is denied (`authorize` → `Denied`, Task 1). Criteria #3 (caller identity + capability), #4 (A≠B storage), #5 (network reject) are satisfied at the broker layer.

**Placeholder scan:** none — full Rust for every step.

**Type/name consistency:** `PluginAuthorizer`/`PluginOp`/`plugin_id_from_label` names identical across authorizer.rs, mod.rs re-export, and plugin_cmd.rs. `authorize` returns the plugin id string used verbatim by `execute_op`. `op.required_capability()` strings (`"storage"`,`"network"`) match the frontend `PluginCapability` union.

**Known consequence (NOT a 3a gap — flag for the reviewer):** because the sensitive-command ACL lockdown is Phase 3b, a plugin window could still bypass `plugin_call` and invoke `read_file`/`plugin_storage_read`/etc. directly this phase. The boundary is only real after 3b. Safe now: loader unwired, plugins OFF, authorizer map empty → any live `plugin_call` denies with `Unregistered`.

## Out of scope (Phase 3b / 3c)

- **3b:** `AppManifest::commands` opt-in (build.rs) + per-command permission TOMLs locking down ~60 sensitive commands to main/file-* only, and granting `plugin_call` to `plugin-*` while `plugin_sandbox_register/deregister` to host windows only.
- **3c:** frontend `pluginCall`/`pluginSandboxRegister` wrappers + `SandboxHost` calling register at start / deregister at stop; brokered files/ai op execution + the sandbox client's plugin_call plumbing; CSP `asset:`; flip the loader to route `sandboxed` → `SandboxHost`; the live smoke gate.
