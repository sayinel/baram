# Plugin Dev Environment — Phase D (ai / network / storage APIs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. One fresh subagent per task.

**Goal:** Add three real, capability-gated plugin APIs on top of Phases A–C — `context.ai` (buffered `complete` / `stream` / `listModels`, reusing the existing LLM plumbing), `context.network` (`fetch` via a new Rust `plugin_http_fetch` reqwest proxy), and `context.storage` (`read`/`write`/`list`/`remove` over an app-global per-plugin dir via new Rust commands). Each is a NEW field on `ExtensionContext`, each object-level capability-gated (denied proxy when the cap is absent), mirroring how `ui`/`events` are gated in `extension-context.ts`.

**Architecture:** `ExtensionContext` today exposes `commands`/`editor`/`events`/`files`/`ui` only. We add `ai`/`network`/`storage`. `ai` reuses `llmComplete` (`src/ipc/llm.ts`) + `createLLMStream` (`src/utils/llm-stream.ts`) + `getConfigForTask` (`src/utils/model-selection.ts`) + `isLLMAllowed` (`src/utils/privacy-check.ts`) — the plugin passes only a prompt + light opts; provider/model/key come from the user's AI settings (Rust reads the key from the OS keyring, so it never crosses IPC). `network.fetch` and `storage.*` delegate to new Rust commands in `src-tauri/src/commands/plugin_cmd.rs`, with the doing-logic + testable pure guard helpers living in `src-tauri/src/plugin/mod.rs` (thin-command pattern per `src-tauri/CLAUDE.md`). `network` uses `reqwest` (already a dependency) with an http/https scheme guard + 30s timeout + response-size cap; `storage` resolves `~/.baram/plugin-data/<pluginId>/<key>` with a mandatory single-path-segment guard against traversal. These three APIs are stateless request surfaces — they register nothing and need no `Disposable`/`subscriptions` teardown; only the object-level capability gate is required.

**Tech Stack:** TypeScript/React 19, Zustand (`.getState()` outside React), Vitest (jsdom, mocked IPC), Rust (Tauri 2, reqwest 0.13, thiserror), `cargo test` for the pure guard helpers.

## Key Design Decisions

These are binding for every task. The first two are USER DECISIONS (do not re-litigate).

1. **`network` guardrail (USER DECISION):** `plugin_http_fetch` parses the URL and allows only `http` / `https` schemes — any other scheme (`file:`, `data:`, `ftp:`, …) is rejected with a clear error. It does **NOT** block loopback / private IPs (local LLMs like Ollama and dev servers are legitimate targets). This is a trust-based posture (spec §9: no hard sandbox); documenting the trust model is Phase E. reqwest client uses a **30-second** timeout and a **10 MiB** response-body cap (read bytes, error if exceeded, else `String::from_utf8_lossy`).

2. **`storage` location (USER DECISION):** app-global `~/.baram/plugin-data/<pluginId>/<key>` (NOT per-vault) — consistent with the app-global plugin install dir (`~/.baram/plugins`, `plugin::get_plugin_dir`). Both `pluginId` and `key` MUST be a single safe path segment: rejected if empty, `~`-prefixed, absolute, or resolving to anything other than exactly one `Component::Normal` (this catches `/abs`, `../escape`, `a/b`, `.`, `..`, and backslash separators). A cargo test MUST prove a `../` key cannot escape the plugin's dir.

3. **`ai.complete` buffering + `ai.stream` cleanup:** `createLLMStream(requestId, cbs)` sets up `llm:token`/`llm:done`/`llm:error` listeners and returns a `cleanup()` (it also auto-cleans on done/error — cleanup is idempotent). `complete` accumulates `onToken` tokens into a buffer and resolves it on `onDone` / rejects on `onError`; `stream` forwards each `onToken` to the caller's `onToken` callback and resolves on `onDone`. BOTH obtain the `cleanup` fn from `createLLMStream`, `await llmComplete(...)` to kick off streaming, `await` a done-promise, and call `cleanup()` in a `finally` block (CLAUDE.md rule: never `.catch()` alone). Provider/model/baseUrl come from `getConfigForTask("chat")`; `privacyMode` from `useAIStore.getState()`; a privacy check (`isLLMAllowed(privacyMode, provider)`) rejects before any request when privacy mode forbids the provider. Plugins never supply an API key — the user's configured key/quota is used (note this in the Phase E doc).

4. **`AICompleteOptions` is minimal:** `{ maxTokens?: number; systemPrompt?: string }` only. We deliberately do NOT expose the app-internal `AITask` union to plugins (avoids coupling plugins to app internals); plugin AI always uses the user's "chat" task config. `AIModel` mirrors the existing `ModelInfo` shape (`{ id: string; name: string }`) but is defined independently in the public types so the plugin surface does not import an internal IPC type.

5. **Import paths for the AI API (narrow, mockable):** `extension-context.ts` imports `llmComplete`/`llmListModels` from `../ipc/llm` (NOT the broad `../ipc/invoke` barrel) and `createLLMStream` from `../utils/llm-stream`, so per-file `vi.mock` in tests stays narrow. Network/storage import their TS wrappers from `../ipc/plugin-invoke`.

6. **TS wrappers live in `src/ipc/plugin-invoke.ts`** (the active plugin IPC file — used by `registry-client.ts` / `plugin-lifecycle.ts`, and where the Phase A dev-loop wrappers live), imported directly into `extension-context.ts`. NOTE the repo has a second, older `src/ipc/plugin.ts` re-exported via `src/ipc/invoke.ts`; do NOT add the new wrappers there. (Spec-vs-code drift flagged below.)

7. **`storage` capability is split across two layers — keep them in sync.** The Rust `validate_manifest` `valid_caps` whitelist (`src-tauri/src/plugin/mod.rs:339-351`) currently lists 11 caps and does NOT include `"storage"` — a manifest declaring `storage` fails validation (and dev-load) until Rust is updated. Task 2 adds `"storage"` to `valid_caps` (backend). Task 5 adds `"storage"` to the TS `PluginCapability` union + `CAPABILITY_DESCRIPTIONS` + `CAPABILITY_COLORS` (frontend). Neither half is user-reachable until both land; the Self-Review cross-checks both.

8. **Incremental `ExtensionContext` fields keep `typecheck` green per commit.** `ExtensionContext` is a closed interface consumed by `createExtensionContext`'s return object. Adding a field to the interface without wiring it breaks `npm run typecheck`. Therefore each API's TS type + its `ExtensionContext` field + its `create*API` impl + its gate + the return-object entry all land in the SAME task (Task 3 = `ai`, Task 4 = `network`, Task 5 = `storage`). Do not add an interface field in one task and wire it in another.

## Global Constraints

- Branch `feature/plugin-dev-environment-phase-d` (already created off `main` @ `e794877`). Stay on it.
- Each new `ExtensionContext` API is object-level capability-gated: present (real API) when the cap is declared, else a `createDeniedProxy(name, cap)` that throws on any property access. The gate must NOT be weakened. `ai`→`ai`, `network`→`network`, `storage`→`storage`. Per-method gating is NOT needed (each API = one cap).
- These three APIs are stateless — they register nothing and push no `Disposable` to `subscriptions`. (The `Disposable`/subscriptions pattern is only for registrations that need teardown.)
- `ai.complete` and `ai.stream` clean up the `createLLMStream` return value in a `try/finally` (CLAUDE.md rule; `.catch()` alone is forbidden).
- Rust: `#[tauri::command] pub async fn` in `plugin_cmd.rs`; doing-logic + pure guard helpers in `plugin/mod.rs`; register in `src-tauri/src/lib.rs` `invoke_handler![...]` (after `plugin_cmd::plugin_list_dev`, ~line 241); add every command to `src-tauri/ipc-registry.json` (a missing entry is a known Phase A defect); TS wrapper in `src/ipc/plugin-invoke.ts`. Errors return `Result<T, String>` (extend `PluginError` via `thiserror` where a typed variant helps, else map to `String`). `cargo test` for the traversal guard + scheme guard (test the pure helpers synchronously — no async/network in tests).
- reqwest is ALREADY a dependency (`Cargo.toml:24`, `version = "0.13"`, default-tls + `stream` + `json`) and is used by `plugin::install`/`fetch_registry`. Use `reqwest::Url`, `reqwest::Client`, `reqwest::Method`, `reqwest::header::{HeaderName, HeaderValue}` — **no Cargo change and no new crate** (`url` is reachable via `reqwest::Url`).
- TS strict + `verbatimModuleSyntax` — type-only imports use `import type`. Interface/union members are ALPHABETICALLY sorted (repo lint convention — see existing `UIAPI`/`ExtensionContext`). Zustand `.getState()` outside React. Files ≤ ~300 lines (`extension-context.ts` is ~350 today; keep additions tight, extract nothing new unless a task pushes a file materially over).
- `npm run typecheck` checks app + node tools + tests. Tests via vitest (jsdom), never jest; mock the IPC `invoke` / wrapper modules per-file.
- **Lint gate (CI + Husky lint-staged):** before every commit run `npx eslint --fix <files>` + `npx prettier --write <files>` + `npx eslint --max-warnings=0 <files>` (clean). Rust pre-push runs `cargo clippy --all-targets`. NEVER `git commit --no-verify` (commitlint enforces subject-case).
- Commits: Conventional Commits, English, reference `§69`.

## File Structure

- Modify: `src-tauri/src/plugin/mod.rs` — `PluginFetchInit`/`PluginFetchResponse` structs; `validate_http_url`, `single_segment`, `plugin_data_dir`, `resolve_key_path` helpers; `http_fetch`, `storage_read/write/list/remove` fns; add `"storage"` to `valid_caps`; cargo tests.
- Modify: `src-tauri/src/commands/plugin_cmd.rs` — thin `plugin_http_fetch` + `plugin_storage_read/write/list/remove` commands.
- Modify: `src-tauri/src/lib.rs` — register the 5 new commands in `invoke_handler!`.
- Modify: `src-tauri/ipc-registry.json` — 5 new command entries.
- Modify: `src/ipc/plugin-invoke.ts` — `pluginHttpFetch` + `pluginStorageRead/Write/List/Remove` wrappers.
- Modify: `src/plugins/types.ts` — `AIAPI`/`AICompleteOptions`/`AIModel`, `NetworkAPI`/`PluginFetchInit`/`PluginFetchResponse`, `StorageAPI`; add `ai`/`network`/`storage` to `ExtensionContext`; add `"storage"` to `PluginCapability` + `CAPABILITY_DESCRIPTIONS`.
- Modify: `src/plugins/extension-context.ts` — `createAIAPI`/`createNetworkAPI`/`createStorageAPI` + gates + return-object entries + imports.
- Modify: `src/components/plugins/PluginCapabilityBadge.tsx` — `CAPABILITY_COLORS.storage`.
- Tests: `src-tauri/src/plugin/mod.rs` (`mod tests`); create `src/plugins/__tests__/extension-context.ai.test.ts`, `extension-context.network.test.ts`, `extension-context.storage.test.ts`; extend `src/plugins/__tests__/extension-context.test.ts` (gate matrix).

---

### Task 1: Rust `plugin_http_fetch` (scheme guard + timeout + size cap) + TS wrapper

**Files:**
- Modify: `src-tauri/src/plugin/mod.rs` (structs + `validate_http_url` + `http_fetch` + cargo tests in `mod tests` @402)
- Modify: `src-tauri/src/commands/plugin_cmd.rs` (thin command)
- Modify: `src-tauri/src/lib.rs` (register @after 241)
- Modify: `src-tauri/ipc-registry.json` (entry)
- Modify: `src/ipc/plugin-invoke.ts` (wrapper)

**Interfaces:**
- Produces (Rust): `plugin::PluginFetchInit { body: Option<String>, headers: Option<HashMap<String,String>>, method: Option<String> }`, `plugin::PluginFetchResponse { body: String, headers: HashMap<String,String>, status: u16 }`, `fn validate_http_url(&str) -> Result<reqwest::Url, String>`, `async fn http_fetch(url, init) -> Result<PluginFetchResponse, String>`.
- Produces (TS): `pluginHttpFetch(url: string, init?: PluginFetchInit): Promise<PluginFetchResponse>` (types come in Task 4 — for now type the wrapper against inline structural types or `import type` from types.ts added in Task 4; **to keep Task 1 self-contained and typecheck-green, add the two TS response/init interfaces to `types.ts` HERE** and reuse in Task 4's `NetworkAPI`).

> Adjustment vs the "types all in Task 4" split: `PluginFetchInit`/`PluginFetchResponse` are needed by the Task 1 wrapper. Add ONLY those two interfaces to `types.ts` in Task 1 (additive, typecheck-green — they are not yet referenced by `ExtensionContext`). Task 4 adds `NetworkAPI` + the `network` field + wiring.

- [ ] **Step 1: Write the failing cargo test** (in `src-tauri/src/plugin/mod.rs` `mod tests`)

```rust
#[test]
fn test_validate_http_url_allows_http_and_https() {
    assert!(validate_http_url("http://localhost:11434/api").is_ok()); // loopback NOT blocked
    assert!(validate_http_url("https://api.example.com/x").is_ok());
}

#[test]
fn test_validate_http_url_rejects_non_http_schemes() {
    assert!(validate_http_url("file:///etc/passwd").is_err());
    assert!(validate_http_url("data:text/plain,hi").is_err());
    assert!(validate_http_url("ftp://host/x").is_err());
    assert!(validate_http_url("not a url").is_err());
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-tauri && cargo test plugin::tests::test_validate_http_url 2>&1 | tail -20`
Expected: FAIL — `validate_http_url` not found.

- [ ] **Step 3: Implement the guard + structs + fetch in `plugin/mod.rs`**

Add near the top (imports): `use std::collections::HashMap;` `use std::time::Duration;` (only if not already present — check).

```rust
const MAX_FETCH_BYTES: usize = 10 * 1024 * 1024; // 10 MiB response cap

#[derive(Debug, Clone, Deserialize)]
pub struct PluginFetchInit {
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub method: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginFetchResponse {
    pub body: String,
    pub headers: HashMap<String, String>,
    pub status: u16,
}

/// USER DECISION 1: allow only http/https; do NOT block loopback/private IPs.
pub fn validate_http_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalid URL: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(format!(
            "blocked URL scheme '{other}': only http/https are allowed"
        )),
    }
}

pub async fn http_fetch(
    url: String,
    init: Option<PluginFetchInit>,
) -> Result<PluginFetchResponse, String> {
    let parsed = validate_http_url(&url)?;
    let init = init.unwrap_or(PluginFetchInit {
        body: None,
        headers: None,
        method: None,
    });
    let method = match init.method {
        Some(m) => reqwest::Method::from_bytes(m.as_bytes())
            .map_err(|e| format!("invalid method: {e}"))?,
        None => reqwest::Method::GET,
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.request(method, parsed);
    if let Some(headers) = init.headers {
        for (k, v) in headers {
            let name = reqwest::header::HeaderName::from_bytes(k.as_bytes())
                .map_err(|e| format!("invalid header name '{k}': {e}"))?;
            let value = reqwest::header::HeaderValue::from_str(&v)
                .map_err(|e| format!("invalid header value for '{k}': {e}"))?;
            req = req.header(name, value);
        }
    }
    if let Some(body) = init.body {
        req = req.body(body);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let headers = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_FETCH_BYTES {
        return Err(format!(
            "response too large: {} bytes (max {MAX_FETCH_BYTES})",
            bytes.len()
        ));
    }
    let body = String::from_utf8_lossy(&bytes).to_string();
    Ok(PluginFetchResponse { body, headers, status })
}
```

- [ ] **Step 4: Add the thin command in `plugin_cmd.rs`**

```rust
#[tauri::command]
pub async fn plugin_http_fetch(
    url: String,
    init: Option<plugin::PluginFetchInit>,
) -> Result<plugin::PluginFetchResponse, String> {
    plugin::http_fetch(url, init).await
}
```

- [ ] **Step 5: Register in `lib.rs` + add to `ipc-registry.json`**

`lib.rs` (after `plugin_cmd::plugin_list_dev,` @241): add `plugin_cmd::plugin_http_fetch,`.
`ipc-registry.json` (after the `plugin_list_dev` entry @887): add
```json
{
  "name": "plugin_http_fetch",
  "input": { "url": "string", "init": "PluginFetchInit?" },
  "output": "PluginFetchResponse",
  "module": "plugin",
  "spec": "§69",
  "phase": 3,
  "milestone": "M10",
  "status": "implemented",
  "description": "Plugin network proxy — reqwest fetch, http/https only, 30s timeout, 10MiB cap (§69 Phase D)"
}
```

- [ ] **Step 6: Add the TS wrapper + response/init types**

In `src/plugins/types.ts` add (alphabetically placed):
```ts
export interface PluginFetchInit {
  body?: string;
  headers?: Record<string, string>;
  method?: string;
}

export interface PluginFetchResponse {
  body: string;
  headers: Record<string, string>;
  status: number;
}
```
In `src/ipc/plugin-invoke.ts` add:
```ts
import type { PluginFetchInit, PluginFetchResponse } from "../plugins/types";

export async function pluginHttpFetch(
  url: string,
  init?: PluginFetchInit,
): Promise<PluginFetchResponse> {
  return invoke<PluginFetchResponse>("plugin_http_fetch", { url, init });
}
```

- [ ] **Step 7: Run tests + build + lint**

Run: `cd src-tauri && cargo test plugin::tests 2>&1 | tail -20` (PASS), `cargo build 2>&1 | tail -20` (compiles). `cd .. && npm run typecheck 2>&1 | tail -5` (clean). eslint/prettier on the 2 TS files.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(§69): plugin_http_fetch — reqwest proxy with http/https guard + timeout + cap"
```

---

### Task 2: Rust storage commands (`~/.baram/plugin-data/<id>`, traversal guard) + `storage` in valid_caps + TS wrappers

**Files:**
- Modify: `src-tauri/src/plugin/mod.rs` (helpers + storage fns + `valid_caps` += `"storage"` + cargo tests)
- Modify: `src-tauri/src/commands/plugin_cmd.rs` (4 thin commands)
- Modify: `src-tauri/src/lib.rs` (register 4)
- Modify: `src-tauri/ipc-registry.json` (4 entries)
- Modify: `src/ipc/plugin-invoke.ts` (4 wrappers)

**Interfaces:**
- Produces (Rust): `fn single_segment(&str) -> Option<&OsStr>`, `fn plugin_data_dir(&str) -> Result<PathBuf,String>`, `fn resolve_key_path(&Path, &str) -> Result<PathBuf,String>`, and `async fn storage_read/write/list/remove`.
- Produces (TS): `pluginStorageRead(pluginId, key): Promise<null|string>`, `pluginStorageWrite(pluginId, key, value): Promise<void>`, `pluginStorageList(pluginId): Promise<string[]>`, `pluginStorageRemove(pluginId, key): Promise<void>`.

- [ ] **Step 1: Write the failing cargo tests** (in `mod tests`)

```rust
#[test]
fn test_single_segment_accepts_plain_key() {
    assert!(single_segment("notes.json").is_some());
    assert!(single_segment("my-key_1").is_some());
}

#[test]
fn test_single_segment_rejects_traversal_and_separators() {
    assert!(single_segment("").is_none());
    assert!(single_segment("..").is_none());
    assert!(single_segment(".").is_none());
    assert!(single_segment("../secret").is_none());
    assert!(single_segment("/etc/passwd").is_none());
    assert!(single_segment("a/b").is_none());
    assert!(single_segment("a\\b").is_none());
    assert!(single_segment("~evil").is_none());
}

#[test]
fn test_resolve_key_path_cannot_escape_plugin_dir() {
    let base = std::path::Path::new("/tmp/.baram/plugin-data/p1");
    // safe key resolves inside base
    let ok = resolve_key_path(base, "data.json").unwrap();
    assert!(ok.starts_with(base));
    // traversal key is rejected outright
    assert!(resolve_key_path(base, "../../escape").is_err());
}

#[test]
fn test_validate_manifest_accepts_storage_capability() {
    let mut m = valid_manifest_fixture(); // reuse existing helper OR inline a PluginManifest
    m.capabilities = vec!["storage".to_string()];
    assert!(validate_manifest(&m).is_ok());
}
```
> If there is no `valid_manifest_fixture()` helper, inline a `PluginManifest { ... capabilities: vec!["storage".to_string()], ... }` copying the shape from `test_validate_manifest_valid` (@406).

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test plugin::tests 2>&1 | tail -25`
Expected: FAIL — `single_segment`/`resolve_key_path` missing; `storage` unknown capability.

- [ ] **Step 3: Add `"storage"` to `valid_caps`** (`plugin/mod.rs` @339-351)

Append `"storage",` to the `valid_caps` array (after `"network"`).

- [ ] **Step 4: Implement the helpers + storage fns** (`plugin/mod.rs`)

Add `use std::ffi::OsStr;` if needed.
```ts
// (Rust)
```
```rust
/// Returns the single safe path segment of `s`, or None if `s` is empty,
/// `~`-prefixed, absolute, contains separators, or is `.`/`..`.
/// This is the traversal guard for both plugin ids and storage keys.
fn single_segment(s: &str) -> Option<&OsStr> {
    if s.is_empty() || s.starts_with('~') {
        return None;
    }
    let mut comps = Path::new(s).components();
    match (comps.next(), comps.next()) {
        (Some(std::path::Component::Normal(seg)), None) => Some(seg),
        _ => None,
    }
}

/// ~/.baram/plugin-data/<pluginId>/ (created if missing). App-global (USER DECISION 2).
fn plugin_data_dir(plugin_id: &str) -> Result<PathBuf, String> {
    let seg = single_segment(plugin_id)
        .ok_or_else(|| format!("invalid plugin id: {plugin_id}"))?;
    let home = dirs_next().ok_or_else(|| "could not determine home directory".to_string())?;
    let dir = home.join(".baram").join("plugin-data").join(seg);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn resolve_key_path(dir: &Path, key: &str) -> Result<PathBuf, String> {
    let seg = single_segment(key).ok_or_else(|| format!("invalid storage key: {key}"))?;
    Ok(dir.join(seg))
}

pub async fn storage_read(plugin_id: String, key: String) -> Result<Option<String>, String> {
    let path = resolve_key_path(&plugin_data_dir(&plugin_id)?, &key)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub async fn storage_write(plugin_id: String, key: String, value: String) -> Result<(), String> {
    let path = resolve_key_path(&plugin_data_dir(&plugin_id)?, &key)?;
    std::fs::write(&path, value).map_err(|e| e.to_string())
}

pub async fn storage_list(plugin_id: String) -> Result<Vec<String>, String> {
    let dir = plugin_data_dir(&plugin_id)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().is_file() {
            if let Some(name) = entry.file_name().to_str() {
                out.push(name.to_string());
            }
        }
    }
    Ok(out)
}

pub async fn storage_remove(plugin_id: String, key: String) -> Result<(), String> {
    let path = resolve_key_path(&plugin_data_dir(&plugin_id)?, &key)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
```
> `dirs_next()` (@120) is private to this module — reuse it, do not reimplement.

- [ ] **Step 5: Thin commands in `plugin_cmd.rs`**

```rust
#[tauri::command]
pub async fn plugin_storage_read(plugin_id: String, key: String) -> Result<Option<String>, String> {
    plugin::storage_read(plugin_id, key).await
}
#[tauri::command]
pub async fn plugin_storage_write(plugin_id: String, key: String, value: String) -> Result<(), String> {
    plugin::storage_write(plugin_id, key, value).await
}
#[tauri::command]
pub async fn plugin_storage_list(plugin_id: String) -> Result<Vec<String>, String> {
    plugin::storage_list(plugin_id).await
}
#[tauri::command]
pub async fn plugin_storage_remove(plugin_id: String, key: String) -> Result<(), String> {
    plugin::storage_remove(plugin_id, key).await
}
```

- [ ] **Step 6: Register in `lib.rs` + `ipc-registry.json`**

`lib.rs` (after `plugin_cmd::plugin_http_fetch,`): add the 4 `plugin_cmd::plugin_storage_*,` lines.
`ipc-registry.json`: 4 entries mirroring the Task 1 format. Inputs: read/remove `{ "pluginId": "string", "key": "string" }`, write `{ "pluginId": "string", "key": "string", "value": "string" }`, list `{ "pluginId": "string" }`. Outputs: `string?` / `void` / `string[]` / `void`. Description: "Plugin app-global key/value storage (~/.baram/plugin-data/<id>), path-traversal-guarded (§69 Phase D)".

- [ ] **Step 7: TS wrappers** (`src/ipc/plugin-invoke.ts`)

```ts
export async function pluginStorageRead(
  pluginId: string,
  key: string,
): Promise<null | string> {
  return invoke<null | string>("plugin_storage_read", { pluginId, key });
}
export async function pluginStorageWrite(
  pluginId: string,
  key: string,
  value: string,
): Promise<void> {
  return invoke<void>("plugin_storage_write", { pluginId, key, value });
}
export async function pluginStorageList(pluginId: string): Promise<string[]> {
  return invoke<string[]>("plugin_storage_list", { pluginId });
}
export async function pluginStorageRemove(
  pluginId: string,
  key: string,
): Promise<void> {
  return invoke<void>("plugin_storage_remove", { pluginId, key });
}
```

- [ ] **Step 8: Run tests + build + lint**

Run: `cd src-tauri && cargo test plugin::tests 2>&1 | tail -25` (PASS — incl. traversal + storage-cap), `cargo build 2>&1 | tail -20`. `cd .. && npm run typecheck 2>&1 | tail -5`. eslint/prettier on `plugin-invoke.ts`.

- [ ] **Step 9: Commit**

```bash
git commit -m "feat(§69): plugin storage commands (~/.baram/plugin-data) + traversal guard + storage cap in valid_caps"
```

---

### Task 3: `createAIAPI` (buffered complete + stream try/finally + listModels) + gate

**Files:**
- Modify: `src/plugins/types.ts` (`AIAPI`/`AICompleteOptions`/`AIModel`; add `ai` to `ExtensionContext`)
- Modify: `src/plugins/extension-context.ts` (imports, `createAIAPI`, gate, return)
- Test: create `src/plugins/__tests__/extension-context.ai.test.ts`

**Interfaces:**
- Produces (types):
```ts
export interface AICompleteOptions {
  maxTokens?: number;
  systemPrompt?: string;
}
export interface AIModel {
  id: string;
  name: string;
}
export interface AIAPI {
  complete(prompt: string, opts?: AICompleteOptions): Promise<string>;
  listModels(): Promise<AIModel[]>;
  stream(
    prompt: string,
    opts: AICompleteOptions,
    onToken: (token: string) => void,
  ): Promise<void>;
}
```
- `ExtensionContext` gains `ai: AIAPI;` (alphabetically FIRST member).
- Produces: `createAIAPI(pluginId: string): AIAPI`.

- [ ] **Step 1: Write the failing tests** (`extension-context.ai.test.ts`)

Mock the narrow modules; drive a fake stream:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PluginManifest } from "../types";

const llmComplete = vi.fn(async () => {});
const llmListModels = vi.fn(async () => [{ id: "m1", name: "Model One" }]);
let lastCbs: {
  onDone?: () => void;
  onError?: (e: string) => void;
  onToken: (t: string) => void;
} | null = null;
const cleanup = vi.fn();

vi.mock("../../ipc/llm", () => ({
  llmComplete: (...a: unknown[]) => llmComplete(...(a as [])),
  llmListModels: (...a: unknown[]) => llmListModels(...(a as [])),
}));
vi.mock("../../utils/llm-stream", () => ({
  createLLMStream: vi.fn(async (_id: string, cbs: typeof lastCbs) => {
    lastCbs = cbs;
    return cleanup;
  }),
}));

import { createExtensionContext } from "../extension-context";

function mf(caps: string[]): PluginManifest {
  return {
    id: "ai-plugin", name: "AI", description: "", version: "1.0.0",
    author: "", license: "MIT", main: "index.mjs",
    engines: { baram: ">=0.2.0" }, capabilities: caps as PluginManifest["capabilities"],
  };
}

describe("ExtensionContext ai API", () => {
  beforeEach(() => {
    llmComplete.mockClear();
    llmListModels.mockClear();
    cleanup.mockClear();
    lastCbs = null;
  });

  it("denies ai without the 'ai' capability", () => {
    const ctx = createExtensionContext(mf(["commands"]), "/p");
    expect(() => ctx.ai.complete("hi")).toThrow(/ai/i);
  });

  it("complete buffers tokens and resolves on done, cleaning up in finally", async () => {
    const ctx = createExtensionContext(mf(["ai"]), "/p");
    const p = ctx.ai.complete("hi");
    // llmComplete kicked off streaming; fire fake tokens + done.
    expect(lastCbs).not.toBeNull();
    lastCbs!.onToken("Hel");
    lastCbs!.onToken("lo");
    lastCbs!.onDone!();
    await expect(p).resolves.toBe("Hello");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("complete rejects on error", async () => {
    const ctx = createExtensionContext(mf(["ai"]), "/p");
    const p = ctx.ai.complete("hi");
    lastCbs!.onError!("boom");
    await expect(p).rejects.toThrow(/boom/);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("stream forwards tokens to onToken and resolves on done", async () => {
    const ctx = createExtensionContext(mf(["ai"]), "/p");
    const seen: string[] = [];
    const p = ctx.ai.stream("hi", {}, (t) => seen.push(t));
    lastCbs!.onToken("a");
    lastCbs!.onToken("b");
    lastCbs!.onDone!();
    await p;
    expect(seen).toEqual(["a", "b"]);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("listModels maps ModelInfo to AIModel", async () => {
    const ctx = createExtensionContext(mf(["ai"]), "/p");
    await expect(ctx.ai.listModels()).resolves.toEqual([
      { id: "m1", name: "Model One" },
    ]);
  });
});
```
> Note the timing: `createLLMStream` is awaited inside `complete`/`stream` before `llmComplete`. Because the mock resolves synchronously-ish (microtask), the test fires callbacks after `await ctx.ai.complete(...)` has begun — assert `lastCbs` is set. If the microtask ordering makes `lastCbs` null at assertion time, `await Promise.resolve()` once before firing (the implementer confirms empirically in Step 3). Default `privacyMode` is false and default provider `claude` → `isLLMAllowed` passes; no store setup needed.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- extension-context.ai 2>&1 | tail -25`
Expected: FAIL — `ctx.ai` undefined / `createAIAPI` missing.

- [ ] **Step 3: Add the types** (`types.ts`)

Add `AICompleteOptions`/`AIModel`/`AIAPI` (alphabetical placement — `AIAPI` etc. sort near the top). Add `ai: AIAPI;` as the FIRST member of `ExtensionContext`.

- [ ] **Step 4: Implement `createAIAPI` + gate** (`extension-context.ts`)

Add imports:
```ts
import { llmComplete, llmListModels } from "../ipc/llm";
import { useAIStore } from "../stores/ai/ai";
import { getConfigForTask } from "../utils/model-selection";
import { createLLMStream } from "../utils/llm-stream";
import { isLLMAllowed } from "../utils/privacy-check";
```
Add `AIAPI`, `AICompleteOptions`, `AIModel` to the `import type { ... } from "./types"` block.

```ts
function createAIAPI(pluginId: string): AIAPI {
  const start = async (
    prompt: string,
    opts: AICompleteOptions | undefined,
    onToken: (t: string) => void,
  ): Promise<void> => {
    const cfg = getConfigForTask("chat");
    const { privacyMode } = useAIStore.getState();
    if (!isLLMAllowed(privacyMode, cfg.provider)) {
      throw new Error(
        "Privacy mode is active — only local (Ollama) models are allowed.",
      );
    }
    const requestId = `plugin-${pluginId}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    let resolveDone: () => void;
    let rejectDone: (e: unknown) => void;
    const done = new Promise<void>((res, rej) => {
      resolveDone = res;
      rejectDone = rej;
    });
    const cleanup = await createLLMStream(requestId, {
      onToken,
      onDone: () => resolveDone(),
      onError: (e) => rejectDone(new Error(e)),
    });
    try {
      await llmComplete(
        prompt,
        cfg.model,
        requestId,
        opts?.systemPrompt,
        opts?.maxTokens,
        cfg.provider,
        cfg.baseUrl,
        privacyMode,
      );
      await done;
    } finally {
      cleanup();
    }
  };
  return {
    async complete(prompt, opts) {
      let buffer = "";
      await start(prompt, opts, (t) => {
        buffer += t;
      });
      return buffer;
    },
    async listModels() {
      const cfg = getConfigForTask("chat");
      const models = await llmListModels(
        cfg.provider,
        cfg.apiKey || undefined,
        cfg.baseUrl,
      );
      return models.map((m) => ({ id: m.id, name: m.name }));
    },
    async stream(prompt, opts, onToken) {
      await start(prompt, opts, onToken);
    },
  };
}
```
Gate + return in `createExtensionContext`:
```ts
const ai: AIAPI = hasCapability("ai")
  ? createAIAPI(manifest.id)
  : (createDeniedProxy("ai", "ai") as AIAPI);
```
Add `ai,` to the returned object (first key).

- [ ] **Step 5: Run tests + tsc + lint**

Run: `npm test -- extension-context.ai 2>&1 | tail -20` (PASS), `npm test -- "extension-context" 2>&1 | tail -10` (no regressions), `npm run typecheck 2>&1 | tail -5` (clean), eslint/prettier.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(§69): context.ai — buffered complete/stream (createLLMStream try/finally) + listModels"
```

---

### Task 4: `createNetworkAPI` + gate

**Files:**
- Modify: `src/plugins/types.ts` (`NetworkAPI`; add `network` to `ExtensionContext`)
- Modify: `src/plugins/extension-context.ts` (import wrapper, `createNetworkAPI`, gate, return)
- Test: create `src/plugins/__tests__/extension-context.network.test.ts`

**Interfaces:**
- Produces (types):
```ts
export interface NetworkAPI {
  fetch(url: string, init?: PluginFetchInit): Promise<PluginFetchResponse>;
}
```
(`PluginFetchInit`/`PluginFetchResponse` already added in Task 1.) `ExtensionContext` gains `network: NetworkAPI;`.
- Produces: `createNetworkAPI(): NetworkAPI`.

- [ ] **Step 1: Write the failing tests** (`extension-context.network.test.ts`)

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PluginManifest } from "../types";

const pluginHttpFetch = vi.fn(async () => ({
  body: "ok",
  headers: { "content-type": "text/plain" },
  status: 200,
}));
vi.mock("../../ipc/plugin-invoke", () => ({
  pluginHttpFetch: (...a: unknown[]) => pluginHttpFetch(...(a as [])),
}));

import { createExtensionContext } from "../extension-context";

function mf(caps: string[]): PluginManifest {
  return {
    id: "net-plugin", name: "Net", description: "", version: "1.0.0",
    author: "", license: "MIT", main: "index.mjs",
    engines: { baram: ">=0.2.0" }, capabilities: caps as PluginManifest["capabilities"],
  };
}

describe("ExtensionContext network API", () => {
  beforeEach(() => pluginHttpFetch.mockClear());

  it("denies network without the 'network' capability", () => {
    const ctx = createExtensionContext(mf(["commands"]), "/p");
    expect(() => ctx.network.fetch("https://x.dev")).toThrow(/network/i);
  });

  it("fetch delegates to pluginHttpFetch and returns the response", async () => {
    const ctx = createExtensionContext(mf(["network"]), "/p");
    const res = await ctx.network.fetch("https://x.dev", { method: "GET" });
    expect(pluginHttpFetch).toHaveBeenCalledWith("https://x.dev", {
      method: "GET",
    });
    expect(res).toMatchObject({ status: 200, body: "ok" });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- extension-context.network 2>&1 | tail -20` (FAIL: `ctx.network` undefined).

- [ ] **Step 3: Add `NetworkAPI` type + `network` field** (`types.ts`).

- [ ] **Step 4: Implement + gate** (`extension-context.ts`)

```ts
import { pluginHttpFetch } from "../ipc/plugin-invoke";
// ...
function createNetworkAPI(): NetworkAPI {
  return {
    fetch(url, init) {
      return pluginHttpFetch(url, init);
    },
  };
}
// gate:
const network: NetworkAPI = hasCapability("network")
  ? createNetworkAPI()
  : (createDeniedProxy("network", "network") as NetworkAPI);
```
Add `network,` to the returned object; add `NetworkAPI` to the type import block.

- [ ] **Step 5: Run tests + tsc + lint** — `npm test -- extension-context.network 2>&1 | tail -20` (PASS), `npm run typecheck 2>&1 | tail -5`, eslint/prettier.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(§69): context.network.fetch — capability-gated Rust http proxy"
```

---

### Task 5: `createStorageAPI` + `storage` capability (TS) + gate

**Files:**
- Modify: `src/plugins/types.ts` (`StorageAPI`; add `storage` to `ExtensionContext`; add `"storage"` to `PluginCapability` + `CAPABILITY_DESCRIPTIONS`)
- Modify: `src/plugins/extension-context.ts` (import wrappers, `createStorageAPI`, gate, return)
- Modify: `src/components/plugins/PluginCapabilityBadge.tsx` (`CAPABILITY_COLORS.storage`)
- Test: create `src/plugins/__tests__/extension-context.storage.test.ts`

**Interfaces:**
- Produces (types):
```ts
export interface StorageAPI {
  list(): Promise<string[]>;
  read(key: string): Promise<null | string>;
  remove(key: string): Promise<void>;
  write(key: string, value: string): Promise<void>;
}
```
`PluginCapability` gains `"storage"` (LAST member — `"statusbar"` < `"storage"`). `CAPABILITY_DESCRIPTIONS` gains a `storage` entry (Korean, matching the file's style). `ExtensionContext` gains `storage: StorageAPI;`.
- Produces: `createStorageAPI(pluginId: string): StorageAPI`.

- [ ] **Step 1: Write the failing tests** (`extension-context.storage.test.ts`)

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PluginManifest } from "../types";

const read = vi.fn(async () => "value");
const write = vi.fn(async () => {});
const list = vi.fn(async () => ["a", "b"]);
const remove = vi.fn(async () => {});
vi.mock("../../ipc/plugin-invoke", () => ({
  pluginStorageRead: (...a: unknown[]) => read(...(a as [])),
  pluginStorageWrite: (...a: unknown[]) => write(...(a as [])),
  pluginStorageList: (...a: unknown[]) => list(...(a as [])),
  pluginStorageRemove: (...a: unknown[]) => remove(...(a as [])),
}));

import { createExtensionContext } from "../extension-context";

function mf(caps: string[]): PluginManifest {
  return {
    id: "store-plugin", name: "Store", description: "", version: "1.0.0",
    author: "", license: "MIT", main: "index.mjs",
    engines: { baram: ">=0.2.0" }, capabilities: caps as PluginManifest["capabilities"],
  };
}

describe("ExtensionContext storage API", () => {
  beforeEach(() => {
    read.mockClear(); write.mockClear(); list.mockClear(); remove.mockClear();
  });

  it("denies storage without the 'storage' capability", () => {
    const ctx = createExtensionContext(mf(["commands"]), "/p");
    expect(() => ctx.storage.read("k")).toThrow(/storage/i);
  });

  it("read/write/list/remove pass the pluginId through to the wrappers", async () => {
    const ctx = createExtensionContext(mf(["storage"]), "/p");
    await expect(ctx.storage.read("k")).resolves.toBe("value");
    expect(read).toHaveBeenCalledWith("store-plugin", "k");
    await ctx.storage.write("k", "v");
    expect(write).toHaveBeenCalledWith("store-plugin", "k", "v");
    await expect(ctx.storage.list()).resolves.toEqual(["a", "b"]);
    expect(list).toHaveBeenCalledWith("store-plugin");
    await ctx.storage.remove("k");
    expect(remove).toHaveBeenCalledWith("store-plugin", "k");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- extension-context.storage 2>&1 | tail -20` (FAIL: `ctx.storage` undefined). Also `npm run typecheck` will error until the `storage` capability + description are added (see below).

- [ ] **Step 3: Add types + capability** (`types.ts`)

Add `StorageAPI`; add `storage: StorageAPI;` to `ExtensionContext`; append `| "storage"` to `PluginCapability` (last); add to `CAPABILITY_DESCRIPTIONS`:
```ts
  storage: "플러그인 전용 저장소를 사용할 수 있습니다",
```
(`CAPABILITY_DESCRIPTIONS` is `Record<PluginCapability, string>` — exhaustive — so this entry is REQUIRED for typecheck once the union grows.)

- [ ] **Step 4: Implement + gate** (`extension-context.ts`)

```ts
import {
  pluginHttpFetch, // already imported in Task 4
  pluginStorageList,
  pluginStorageRead,
  pluginStorageRemove,
  pluginStorageWrite,
} from "../ipc/plugin-invoke";
// ...
function createStorageAPI(pluginId: string): StorageAPI {
  return {
    list() {
      return pluginStorageList(pluginId);
    },
    read(key) {
      return pluginStorageRead(pluginId, key);
    },
    remove(key) {
      return pluginStorageRemove(pluginId, key);
    },
    write(key, value) {
      return pluginStorageWrite(pluginId, key, value);
    },
  };
}
// gate:
const storage: StorageAPI = hasCapability("storage")
  ? createStorageAPI(manifest.id)
  : (createDeniedProxy("storage", "storage") as StorageAPI);
```
Add `storage,` to the returned object; add `StorageAPI` to the type import block.

- [ ] **Step 5: Add the badge color** (`PluginCapabilityBadge.tsx`)

In `CAPABILITY_COLORS` add `storage: "#14b8a6",` (teal — distinct from `ai` `#ec4899` and `network` `#ef4444`).

- [ ] **Step 6: Run tests + tsc + lint** — `npm test -- extension-context.storage 2>&1 | tail -20` (PASS), `npm run typecheck 2>&1 | tail -5` (clean), eslint/prettier on the 3 TS files.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(§69): context.storage — app-global per-plugin key/value + storage capability + badge"
```

---

### Task 6: Capability-gate integration matrix + manual GUI verification note

**Files:**
- Modify: `src/plugins/__tests__/extension-context.test.ts` (extend — add an `ai/network/storage gate matrix` describe)

**Interfaces:**
- Consumes: `createExtensionContext` with the full Phase D surface.

- [ ] **Step 1: Write the matrix tests** (extend `extension-context.test.ts`, reusing its `makeManifest`)

```ts
describe("Phase D capability gate matrix", () => {
  it("no-cap context denies ai/network/storage (denied proxy throws)", () => {
    const ctx = createExtensionContext(makeManifest([]), "/p");
    expect(() => ctx.ai.complete).toThrow(/ai/i);
    expect(() => ctx.network.fetch).toThrow(/network/i);
    expect(() => ctx.storage.read).toThrow(/storage/i);
  });

  it("declared caps expose the real APIs (methods are functions)", () => {
    const ctx = createExtensionContext(
      makeManifest(["ai", "network", "storage"]),
      "/p",
    );
    expect(typeof ctx.ai.complete).toBe("function");
    expect(typeof ctx.ai.stream).toBe("function");
    expect(typeof ctx.ai.listModels).toBe("function");
    expect(typeof ctx.network.fetch).toBe("function");
    expect(typeof ctx.storage.read).toBe("function");
    expect(typeof ctx.storage.write).toBe("function");
    expect(typeof ctx.storage.list).toBe("function");
    expect(typeof ctx.storage.remove).toBe("function");
  });

  it("one cap does not unlock the others", () => {
    const ctx = createExtensionContext(makeManifest(["ai"]), "/p");
    expect(typeof ctx.ai.complete).toBe("function");
    expect(() => ctx.network.fetch).toThrow(/network/i);
    expect(() => ctx.storage.read).toThrow(/storage/i);
  });
});
```
> This file has no `vi.mock` for llm/plugin-invoke, so do NOT call the methods (only assert `typeof`/throw). Accessing `ctx.ai.complete` on the real API touches no store/IPC; accessing it on the denied proxy throws — both are import-free.

- [ ] **Step 2: Run to verify** — before this task the tests pass structurally only if Tasks 3–5 landed; run `npm test -- extension-context.test 2>&1 | tail -15` and confirm the new describe passes (the surface already exists from Tasks 3–5, so this may pass on first write — that is acceptable for an integration guard; if any assertion fails, fix the gate).

- [ ] **Step 3: Full suite + typecheck**

Run: `npm test 2>&1 | tail -15` (full TS suite green — capture exit without a pipe per CLAUDE.md: `npm test > /tmp/d.log 2>&1; echo $?`), `cd src-tauri && cargo test 2>&1 | tail -15` (Rust green), `cd .. && npm run typecheck 2>&1 | tail -5`.

- [ ] **Step 4: Manual GUI verification note (record in the commit body / impl notes)**

The automated suite mocks IPC. Before declaring Phase D done, a manual smoke is REQUIRED (the runtime paths — real reqwest, real `~/.baram/plugin-data`, real LLM — are not exercised by vitest):
1. Add a temporary dev plugin (Phase A dev-folder loader) declaring `["ai","network","storage"]`; in `activate(ctx)` call `ctx.storage.write("t.json","hi")` → `ctx.storage.read("t.json")`; verify `~/.baram/plugin-data/<id>/t.json` exists.
2. `ctx.network.fetch("https://httpbin.org/get")` → status 200; `ctx.network.fetch("file:///etc/passwd")` → rejects with a scheme error.
3. `ctx.ai.complete("Say hi")` with a configured provider → returns text; with privacy mode ON + a cloud provider → rejects.
Document results in `dev/impl-notes/`.

- [ ] **Step 5: Commit**

```bash
git commit -m "test(§69): Phase D capability-gate integration matrix (ai/network/storage)"
```

---

## Self-Review

**Spec coverage (spec §4.2 ai / §4.3 network / §4.4 storage / §9 security / §11 row D):**
- `ai.complete` (buffered) / `ai.stream` (try/finally cleanup) / `ai.listModels` reusing `llmComplete`+`createLLMStream`+`getConfigForTask` — Task 3. ✓ (§4.2)
- `network.fetch` via new Rust `plugin_http_fetch` (reqwest), http/https-only guard, 30s timeout, 10 MiB cap — Tasks 1 + 4. ✓ (§4.3, USER DECISION 1)
- `storage.read/write/list/remove` over `~/.baram/plugin-data/<pluginId>/<key>`, single-segment traversal guard with a cargo test proving `../` is rejected — Tasks 2 + 5. ✓ (§4.4, USER DECISION 2)
- New `storage` capability: Rust `valid_caps` (Task 2) + TS `PluginCapability`/`CAPABILITY_DESCRIPTIONS`/`CAPABILITY_COLORS` (Task 5). Cross-check both halves landed. ✓
- Object-level gate = denied proxy when cap absent (Task 6 matrix proves no-cap→throw, with-cap→present, one-cap-doesn't-unlock-others). ✓ (§9 trust-based; no per-method gating needed)
- Sensitive-cap approval UX (`PluginCapabilityBadge` color for `storage`; `ai`/`network` already colored) — Task 5. The spec's "민감 등급 구분 표기" beyond color is Phase E doc work. ✓ (partial — flagged)

**Type consistency:** `PluginFetchInit`/`PluginFetchResponse` defined once (Task 1, `types.ts`), consumed by the wrapper (Task 1) and `NetworkAPI` (Task 4) — identical shape to the Rust structs (`body`/`headers`/`status`; `body`/`headers`/`method`). `AIModel {id,name}` mirrors `ModelInfo {id,name}` and `listModels` maps between them. `StorageAPI` return types (`null | string`, `string[]`, `void`) match the Rust `Result<Option<String>>`/`Vec<String>`/`Result<()>` and the TS wrappers. `ExtensionContext` gains `ai`/`network`/`storage` incrementally (Tasks 3/4/5), each landing WITH its impl so `typecheck` stays green per commit (Decision 8).

**Placeholder scan:** none — all code is concrete. The only empirical check flagged is the microtask timing in the AI test (Task 3 Step 1 note) — the implementer confirms `lastCbs` is set before firing callbacks and adds one `await Promise.resolve()` if needed; the impl is complete regardless.

**Spec-vs-code drift / risks flagged:**
1. **Two plugin IPC files.** `src/ipc/plugin.ts` (older, re-exported via `invoke.ts`) and `src/ipc/plugin-invoke.ts` (newer, used by the plugin system). Phase D adds wrappers ONLY to `plugin-invoke.ts` and imports them directly (Decision 6). Risk: duplication; a future cleanup should consolidate. Not in scope.
2. **Rust `valid_caps` whitelist** (Decision 7) — the biggest correctness trap: adding `"storage"` to the TS union alone is insufficient; `validate_manifest` rejects unknown caps, so `storage` plugins fail dev-load until Task 2 adds `"storage"` to `valid_caps` (with a cargo test). Both halves cross-checked above.
3. **reqwest availability** — RESOLVED, not an open question: `Cargo.toml:24` pins `reqwest = "0.13"` with default-tls + `stream` + `json`, already used by `plugin::install`/`fetch_registry`. Use `reqwest::Url`/`Client`/`Method`/`header::*` — no Cargo change, no `url` crate.
4. **AI key retrieval path** — RESOLVED: the plugin passes only a prompt; `llmComplete` omits the API key (Rust reads it from the OS keyring — see `llm.ts:10-11` comment), and `getConfigForTask("chat")` supplies provider/model/baseUrl from `useAIStore`. `listModels` passes `cfg.apiKey` (needed for cloud model listing) exactly as the app does. Documenting that plugin AI consumes the user's key/quota is Phase E.
5. **Privacy mode** — `ai.complete`/`stream` call `isLLMAllowed(privacyMode, provider)` and reject when privacy mode forbids the provider, matching `use-llm-stream.ts`/`use-inline-ai.ts`. A plugin cannot bypass privacy mode.
6. **File size** — `extension-context.ts` is ~350 lines today and grows by ~70 (three small `create*API` + gates). If it crosses ~430 and lint/CLAUDE.md pressure warrants, extract `createAIAPI` into `src/plugins/ai-api.ts` (import back) — noted, not required.

**Out of scope (later phases):** public `.d.ts` type emission + `public-api.ts` barrel, example plugins (`word-count`/`ai-summary`), `docs/plugin-development.md` rewrite, the "sensitive capability" approval-dialog copy (Phase E); registry schema + seed (Phase F).
