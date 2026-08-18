# Plugin Command ACL Lockdown (§260 Phase 3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt every app `#[tauri::command]` into the Tauri v2 ACL so a sandboxed plugin webview (`plugin-*`) can invoke nothing but `plugin_call`, while the host windows (`main`/`file-*`) keep full command access — making completion criterion #2 ("no raw `invoke` reaches privileged commands from a sandbox") real.

**Architecture:** Tauri v2 leaves an app's own commands ungated *until* the build provides an `AppManifest`. That is an **all-or-nothing global switch**: once `build.rs` registers commands via `AppManifest::commands`, `has_app_acl_manifest` becomes true and **every** app command requires an ACL grant from the calling window's capability, or it is rejected at runtime. So this phase (1) registers all 109 commands in `build.rs`, (2) grants all-but-`plugin_call` to `main`/`file-*` in `capabilities/default.json`, (3) grants only `plugin_call` to `plugin-*` in `capabilities/plugin-sandbox.json`, and (4) adds a consistency test that fails the build if these three lists ever drift.

**Tech Stack:** Rust, `tauri-build` 2 (`AppManifest`, `Attributes`, `try_build`), Tauri v2 capability JSON, `serde_json` (already a dependency), `cargo test`.

## Global Constraints

- **All-or-nothing:** the `AppManifest::commands` list, the union of capability grants, and the `generate_handler!` list in `src/lib.rs` must be identical sets (`plugin_call` split to the sandbox tier). A command in `generate_handler!` but missing from a capability is **rejected at runtime → breaks the host app**. A command granted to `plugin-*` other than `plugin_call` is a **boundary leak**. The consistency test (Task 1) is the guardrail; it must exist and pass.
- **Source of truth = `generate_handler!` in `src/lib.rs`** (the actually-registered set). `ipc-registry.json` mixes commands, events, and nested field names and is NOT a clean command source — do not derive from it.
- **Generated permission identifier:** `tauri-build` autogenerates `allow-$command` / `deny-$command` where `$command` is the command name (snake_case). Reference them **bare** (no plugin `:` prefix) in capability `permissions`. Confirm the exact string from `src-tauri/gen/schemas/*.json` after the first build and use it verbatim; the build fails loudly if a capability references a non-existent permission.
- **Tier split:** `main`/`file-*` (capability `default.json`, `"windows": ["main", "file-*"]`) get every command **except** `plugin_call`. `plugin-*` (capability `plugin-sandbox.json`) gets **exactly** `plugin_call` (plus its existing `core:event:*` perms). Host-only `plugin_sandbox_register` / `plugin_sandbox_deregister` stay in the `main`/`file-*` tier (never `plugin-*`).
- **Scope boundary:** this phase is ACL-only. Do NOT wire the loader to route sandboxed plugins, do NOT create sandbox WebviewWindows, do NOT touch CSP or frontend loader code — those are Phase 3c. Plugins stay OFF (`plugins_runtime_enabled()` unchanged). No `plugin-*` window exists yet, so the `plugin-sandbox` grant is inert-but-correct until 3c.
- **Rust conventions (src-tauri):** update `ipc-registry.json` only if command signatures change (they do not here). Keep `cargo clippy --all-targets -- -D warnings` clean.

---

### Task 1: ACL consistency guardrail test (TDD red)

Encodes the invariant that keeps the three command lists in sync. Written first; it will FAIL (build.rs has no `AppManifest`, capabilities have no `allow-*` app-command grants) until Task 2 lands.

**Files:**
- Create: `src-tauri/tests/acl_lockdown.rs`

**Interfaces:**
- Consumes: `src/lib.rs` (`generate_handler![ ... ]`), `build.rs` (`.commands(&[ ... ])`), `capabilities/default.json`, `capabilities/plugin-sandbox.json` — all read as files via `env!("CARGO_MANIFEST_DIR")`.
- Produces: four `#[test]`s enforcing the Global-Constraints invariant. Later phases (and any new command) must keep them green.

- [ ] **Step 1: Write the failing test file**

Create `src-tauri/tests/acl_lockdown.rs`:

```rust
//! §260 Phase 3b — guardrail: the app-command ACL lockdown must stay in sync
//! across three places or the app silently breaks (a registered command with no
//! grant is rejected at runtime) or the sandbox boundary leaks (a command granted
//! to `plugin-*`). This test derives the canonical command set from the
//! `generate_handler!` list in `src/lib.rs` (the source of truth) and asserts
//! that `build.rs`'s `AppManifest` and the capability files agree.

use std::collections::BTreeSet;
use std::path::Path;

fn read(rel: &str) -> String {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join(rel);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()))
}

/// Normalize a command/permission stem so `-` and `_` compare equal. Command
/// names are snake_case; the generated permission id is `allow-<snake>`, but
/// normalizing makes the test robust if tauri-build ever kebab-cases the stem.
fn norm(s: &str) -> String {
    s.trim().replace('-', "_")
}

/// Commands registered in `generate_handler![ ... ]` in src/lib.rs, with any
/// `module::` path prefix stripped. Authoritative registered set.
fn generate_handler_commands() -> BTreeSet<String> {
    let src = read("src/lib.rs");
    let start = src.find("generate_handler![").expect("generate_handler! not found");
    let rest = &src[start + "generate_handler![".len()..];
    let end = rest.find("])").expect("generate_handler! close `])` not found");
    rest[..end]
        .split(',')
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(|t| norm(t.rsplit("::").next().unwrap()))
        .collect()
}

/// Command list passed to `AppManifest::new().commands(&[ ... ])` in build.rs.
fn build_manifest_commands() -> BTreeSet<String> {
    let src = read("build.rs");
    let start = src.find(".commands(&[").expect(".commands(&[ not found in build.rs");
    let rest = &src[start + ".commands(&[".len()..];
    let end = rest.find("])").expect(".commands close `])` not found");
    rest[..end]
        .split(',')
        .map(|t| t.trim().trim_matches('"').trim())
        .filter(|t| !t.is_empty())
        .map(norm)
        .collect()
}

/// App-command allow-permissions in a capability file: bare `allow-*` entries
/// with no plugin `:` prefix (core/plugin perms like `core:window:allow-create`
/// or `clipboard-manager:allow-write-image` are excluded by the `:` test).
fn capability_allowed_commands(rel: &str) -> BTreeSet<String> {
    let json: serde_json::Value = serde_json::from_str(&read(rel)).expect("parse capability json");
    json["permissions"]
        .as_array()
        .expect("permissions array")
        .iter()
        .filter_map(|p| p.as_str())
        .filter(|p| !p.contains(':') && p.starts_with("allow-"))
        .map(|p| norm(p.trim_start_matches("allow-")))
        .collect()
}

#[test]
fn app_manifest_matches_registered_commands() {
    let registered = generate_handler_commands();
    let manifest = build_manifest_commands();
    assert_eq!(
        registered, manifest,
        "build.rs AppManifest::commands must list exactly the generate_handler! commands.\n\
         missing from build.rs: {:?}\nextra in build.rs: {:?}",
        registered.difference(&manifest).collect::<Vec<_>>(),
        manifest.difference(&registered).collect::<Vec<_>>(),
    );
}

#[test]
fn every_command_granted_to_exactly_one_tier() {
    let registered = generate_handler_commands();
    let main = capability_allowed_commands("capabilities/default.json");
    let sandbox = capability_allowed_commands("capabilities/plugin-sandbox.json");

    let both: Vec<_> = main.intersection(&sandbox).collect();
    assert!(both.is_empty(), "commands granted to BOTH main and sandbox: {both:?}");

    let union: BTreeSet<_> = main.union(&sandbox).cloned().collect();
    assert_eq!(
        registered, union,
        "every registered command must be granted to exactly one tier.\n\
         ungranted (breaks host app): {:?}\nstray grant (no such command): {:?}",
        registered.difference(&union).collect::<Vec<_>>(),
        union.difference(&registered).collect::<Vec<_>>(),
    );
}

#[test]
fn sandbox_tier_gets_only_plugin_call() {
    let sandbox = capability_allowed_commands("capabilities/plugin-sandbox.json");
    let expected: BTreeSet<String> = [norm("plugin_call")].into_iter().collect();
    assert_eq!(
        sandbox, expected,
        "plugin-sandbox capability must grant exactly `plugin_call` (got {sandbox:?})"
    );
}

#[test]
fn main_tier_gets_everything_except_plugin_call() {
    let registered = generate_handler_commands();
    let main = capability_allowed_commands("capabilities/default.json");
    let mut expected = registered;
    expected.remove(&norm("plugin_call"));
    assert_eq!(
        main, expected,
        "main/file-* capability must grant every command except plugin_call.\n\
         missing: {:?}\nextra: {:?}",
        expected.difference(&main).collect::<Vec<_>>(),
        main.difference(&expected).collect::<Vec<_>>(),
    );
}
```

- [ ] **Step 2: Run the tests, verify they FAIL for the right reason**

Run: `cd src-tauri && cargo test --test acl_lockdown`
Expected: compiles, then FAILS — `app_manifest_matches_registered_commands` panics at `.commands(&[ not found in build.rs` (build.rs still calls bare `tauri_build::build()`), and/or the tier tests fail because `default.json`/`plugin-sandbox.json` have no `allow-*` app-command entries yet. This proves the guardrail actually checks the wiring.

- [ ] **Step 3: Commit**

```bash
cd src-tauri && git add tests/acl_lockdown.rs
git commit -m "test(§260): ACL lockdown consistency guardrail (Phase 3b, red)"
```

---

### Task 2: Register commands in the ACL and grant per tier (TDD green)

Flips the global ACL switch in `build.rs` and grants commands to the correct window tiers, making Task 1's tests pass and keeping the host app fully functional.

**Files:**
- Modify: `src-tauri/build.rs` (replace `tauri_build::build()` with the `AppManifest` form)
- Modify: `src-tauri/capabilities/default.json` (add 108 `allow-*` app-command grants + update description)
- Modify: `src-tauri/capabilities/plugin-sandbox.json` (add `allow-plugin_call` + update description)

**Interfaces:**
- Consumes: the four tests from Task 1.
- Produces: an ACL-gated command surface — after this task, invoking any app command from a window whose capability lacks its `allow-*` grant is rejected by Tauri at runtime.

- [ ] **Step 1: Replace `build.rs` with the AppManifest form**

Overwrite `src-tauri/build.rs` with (list is the exact 109 `generate_handler!` commands, alphabetical):

```rust
//! §260 Phase 3b — opt every app command into the Tauri ACL.
//!
//! Tauri v2 leaves an app's own `#[tauri::command]`s ungated by default: with no
//! AppManifest, `has_app_acl_manifest` is false and any window's JS realm (incl. a
//! loaded plugin) can invoke any command. Registering the commands here flips that
//! global switch — EVERY app command now requires an ACL grant from the calling
//! window's capability. `main`/`file-*` are granted all-but-`plugin_call` in
//! `capabilities/default.json`; `plugin-*` sandbox windows get only `plugin_call`.
//! A command listed here but granted to no window is rejected at runtime, so
//! `tests/acl_lockdown.rs` asserts this list stays identical to `generate_handler!`.
fn main() {
    let app_manifest = tauri_build::AppManifest::new().commands(&[
        "add_context", "confirm_quit", "copy_file", "create_dir",
        "create_snapshot", "delete_dir", "delete_file", "delete_snapshot",
        "detect_pandoc", "diff_texts", "embed_text", "export_binary_file",
        "export_document", "export_pandoc", "export_pdf", "extract_zip",
        "get_backlinks", "get_config", "get_contexts", "get_file_history",
        "get_files_by_tag", "get_link_index", "get_opened_urls", "get_snapshot_diff",
        "get_unlinked_mentions", "get_vault_config", "get_vault_config_by_path", "get_vault_tags",
        "git_ahead_behind", "git_branches", "git_commit", "git_create_branch",
        "git_delete_branch", "git_diff_file", "git_discard", "git_fetch",
        "git_log", "git_pull", "git_push", "git_remotes",
        "git_stage", "git_stash_drop", "git_stash_list", "git_stash_pop",
        "git_stash_save", "git_status", "git_switch_branch", "git_unstage",
        "import_file", "index_file", "index_status", "index_vault",
        "init_vault", "keyring_delete_provider_key", "keyring_provider_configured", "keyring_set_provider_key",
        "list_dir", "list_snapshots", "llm_cancel", "llm_complete",
        "llm_list_models", "merge_texts", "plugin_add_dev_folder", "plugin_call",
        "plugin_fetch_registry", "plugin_get_dir", "plugin_http_fetch", "plugin_install",
        "plugin_list_dev", "plugin_list_installed", "plugin_prepare_scopes", "plugin_read_manifest",
        "plugin_remove_dev_folder", "plugin_sandbox_deregister", "plugin_sandbox_register", "plugin_storage_list",
        "plugin_storage_read", "plugin_storage_remove", "plugin_storage_write", "plugin_uninstall",
        "read_file", "refresh_index", "remove_config", "remove_context",
        "rename_block_id", "rename_file", "rename_file_with_links", "rename_namespace",
        "rename_tag", "resolve_cross_vault_link", "resolve_settings", "restore_snapshot",
        "run_custom_export", "search_files", "search_knowledge", "set_active_context",
        "set_config", "set_vault_config", "set_vault_config_by_path", "set_vault_root",
        "update_context_alias", "update_context_color", "update_context_label", "update_file_index",
        "update_menu_locale", "update_recent_menu", "watch_dir", "write_binary_file",
        "write_file",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(app_manifest))
        .expect("failed to run tauri-build");
}
```

- [ ] **Step 2: Build once to generate permissions, then confirm the identifier format**

Run: `cd src-tauri && cargo build 2>&1 | tail -20`
Then inspect a generated schema for the exact permission id:
Run: `ls src-tauri/gen/schemas/ && grep -o '"allow-read_file"\|"allow-read-file"' src-tauri/gen/schemas/*.json | head`
Expected: the build regenerates `gen/schemas/*.json` containing `allow-<command>` permissions. Note the exact stem form (`allow-read_file` per docs). Use that exact form in Steps 3–4. If it differs from `allow-<snake>`, adjust the capability entries accordingly (the `norm()` in Task 1 already tolerates `-`/`_` differences, but the capability strings must match the generated ids verbatim or the next build fails).

- [ ] **Step 3: Grant all-but-`plugin_call` to `main`/`file-*` in `default.json`**

Overwrite `src-tauri/capabilities/default.json` — keep the existing non-command permissions, replace the `description`, and append the 108 app-command grants (every command from Step 1 **except** `plugin_call`):

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "§260 Phase 3b — capability for the main window and file-mode windows. As of Phase 3b, build.rs registers every app command in the Tauri ACL (AppManifest), so custom #[tauri::command]s ARE now ACL-gated. This capability grants host windows (main, file-*) every app command EXCEPT plugin_call (the sandbox-only broker channel). Sandbox windows (plugin-*) are governed by plugin-sandbox.json and get only plugin_call. Keep this list in sync with generate_handler! in lib.rs — tests/acl_lockdown.rs enforces it. core:window/webview allow-create are required by §89 file-mode (src/utils/file-window.ts) and MUST NOT be removed.",
  "windows": ["main", "file-*"],
  "permissions": [
    "core:default",
    "core:window:allow-create",
    "core:webview:allow-create-webview-window",
    "opener:default",
    "dialog:default",
    "clipboard-manager:allow-write-image",
    "clipboard-manager:allow-write-text",
    "opener:allow-reveal-item-in-dir",
    "updater:default",
    "process:allow-restart",
    "allow-add_context", "allow-confirm_quit", "allow-copy_file", "allow-create_dir",
    "allow-create_snapshot", "allow-delete_dir", "allow-delete_file", "allow-delete_snapshot",
    "allow-detect_pandoc", "allow-diff_texts", "allow-embed_text", "allow-export_binary_file",
    "allow-export_document", "allow-export_pandoc", "allow-export_pdf", "allow-extract_zip",
    "allow-get_backlinks", "allow-get_config", "allow-get_contexts", "allow-get_file_history",
    "allow-get_files_by_tag", "allow-get_link_index", "allow-get_opened_urls", "allow-get_snapshot_diff",
    "allow-get_unlinked_mentions", "allow-get_vault_config", "allow-get_vault_config_by_path", "allow-get_vault_tags",
    "allow-git_ahead_behind", "allow-git_branches", "allow-git_commit", "allow-git_create_branch",
    "allow-git_delete_branch", "allow-git_diff_file", "allow-git_discard", "allow-git_fetch",
    "allow-git_log", "allow-git_pull", "allow-git_push", "allow-git_remotes",
    "allow-git_stage", "allow-git_stash_drop", "allow-git_stash_list", "allow-git_stash_pop",
    "allow-git_stash_save", "allow-git_status", "allow-git_switch_branch", "allow-git_unstage",
    "allow-import_file", "allow-index_file", "allow-index_status", "allow-index_vault",
    "allow-init_vault", "allow-keyring_delete_provider_key", "allow-keyring_provider_configured", "allow-keyring_set_provider_key",
    "allow-list_dir", "allow-list_snapshots", "allow-llm_cancel", "allow-llm_complete",
    "allow-llm_list_models", "allow-merge_texts", "allow-plugin_add_dev_folder", "allow-plugin_fetch_registry",
    "allow-plugin_get_dir", "allow-plugin_http_fetch", "allow-plugin_install", "allow-plugin_list_dev",
    "allow-plugin_list_installed", "allow-plugin_prepare_scopes", "allow-plugin_read_manifest", "allow-plugin_remove_dev_folder",
    "allow-plugin_sandbox_deregister", "allow-plugin_sandbox_register", "allow-plugin_storage_list", "allow-plugin_storage_read",
    "allow-plugin_storage_remove", "allow-plugin_storage_write", "allow-plugin_uninstall", "allow-read_file",
    "allow-refresh_index", "allow-remove_config", "allow-remove_context", "allow-rename_block_id",
    "allow-rename_file", "allow-rename_file_with_links", "allow-rename_namespace", "allow-rename_tag",
    "allow-resolve_cross_vault_link", "allow-resolve_settings", "allow-restore_snapshot", "allow-run_custom_export",
    "allow-search_files", "allow-search_knowledge", "allow-set_active_context", "allow-set_config",
    "allow-set_vault_config", "allow-set_vault_config_by_path", "allow-set_vault_root", "allow-update_context_alias",
    "allow-update_context_color", "allow-update_context_label", "allow-update_file_index", "allow-update_menu_locale",
    "allow-update_recent_menu", "allow-watch_dir", "allow-write_binary_file", "allow-write_file"
  ]
}
```

- [ ] **Step 4: Grant `plugin_call` to `plugin-*` in `plugin-sandbox.json`**

Overwrite `src-tauri/capabilities/plugin-sandbox.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "plugin-sandbox",
  "description": "§260 — capability for per-plugin sandbox WebviewWindows (label plugin-*). Grants the Tauri event channel the sandbox client needs (emit for s2h, listen/unlisten for h2s) plus the single privileged broker command plugin_call. It grants NO other app command: every other #[tauri::command] is ACL-gated (Phase 3b AppManifest) and withheld here, so a sandbox webview cannot invoke fs/keyring/llm/git/etc. directly — only the authorizer-checked plugin_call. Host-only plugin_sandbox_register/deregister are intentionally NOT granted here (host windows only).",
  "windows": ["plugin-*"],
  "permissions": [
    "core:event:allow-emit",
    "core:event:allow-listen",
    "core:event:allow-unlisten",
    "allow-plugin_call"
  ]
}
```

- [ ] **Step 5: Build (validates capability permission resolution)**

Run: `cd src-tauri && cargo build 2>&1 | tail -20`
Expected: clean build. Tauri resolves every capability permission against the generated schema; a typo or a reference to a non-generated `allow-*` id fails here with a clear "permission ... not found" error. If so, fix the offending entry to match the generated id from Step 2.

- [ ] **Step 6: Run the consistency tests — verify GREEN**

Run: `cd src-tauri && cargo test --test acl_lockdown`
Expected: all four tests PASS (manifest == generate_handler; every command granted to exactly one tier; sandbox == {plugin_call}; main == all − plugin_call).

- [ ] **Step 7: Full Rust gates**

Run: `cd src-tauri && cargo test 2>&1 | tail -15 && cargo clippy --all-targets -- -D warnings 2>&1 | tail -5`
Expected: full suite passes (163 prior + 4 new = 167), clippy clean.

- [ ] **Step 8: Commit**

```bash
cd src-tauri && git add build.rs capabilities/default.json capabilities/plugin-sandbox.json
git commit -m "feat(§260): opt all app commands into ACL, grant per window tier (Phase 3b)"
```

---

## Verification (before PR / merge)

Automated (CI + local): `cargo build`, `cargo test --test acl_lockdown` (4 green), `cargo test` (167), `cargo clippy --all-targets -- -D warnings`. The frontend is untouched, so `npm run lint`/vitest are unaffected, but run `npm run lint` if CI flags anything.

**Host-app smoke (user-run, GUI — the definitive proof the ACL didn't break `main`/`file-*`):** launch `npm run tauri dev`, then exercise at least: open a file (`read_file`), edit + save (`write_file`), open a vault / switch context (`get_contexts`/`set_active_context`/`resolve_settings`), Git status panel (`git_status`), an LLM call (`llm_complete` streaming). All must work with no "command ... not allowed" errors in the devtools console. Because the ACL rejects at runtime (not build time), this smoke is the real gate; the consistency test proves the grant list is complete, and the two together give high confidence.

**Deferred to Phase 3c (do NOT attempt here):** wiring the loader to route sandboxed plugins, creating `plugin-*` WebviewWindows, verifying the sandbox webview has the minimal core perms it needs to boot, CSP `asset:` widening, and the live sandbox round-trip smoke. The `plugin-sandbox` grant added here is inert until then (no `plugin-*` window exists yet).

## Self-Review notes

- **Spec coverage:** ADR §10 Phase "3 Rust broker/authorizer + FULL sensitive-command ACL lockdown" — the "FULL ACL lockdown" half is this plan (broker/authorizer was 3a). Criterion #2 ("no raw invoke to privileged commands from sandbox") is satisfied by the `plugin-sandbox` capability withholding every command but `plugin_call`.
- **All 109 accounted for:** build.rs lists 109; default.json grants 108 (109 − `plugin_call`); plugin-sandbox grants 1 (`plugin_call`); union = 109 = `generate_handler!`. Enforced by Task 1.
- **Type/name consistency:** the command strings in build.rs Step 1, the `allow-*` strings in default.json Step 3, and the `generate_handler!` set are the same 109 names (verified against `src/lib.rs`).
- **No placeholder:** every command list is spelled out; the only "confirm at build" step (Step 2, exact permission-id stem) is a genuine external fact with a robust fallback (`norm()` + build-time validation), not a deferred decision.
