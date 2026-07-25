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
    let start = src
        .find("generate_handler![")
        .expect("generate_handler! not found");
    let rest = &src[start + "generate_handler![".len()..];
    let end = rest
        .find("])")
        .expect("generate_handler! close `])` not found");
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
    let start = src
        .find(".commands(&[")
        .expect(".commands(&[ not found in build.rs");
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
        registered,
        manifest,
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
    assert!(
        both.is_empty(),
        "commands granted to BOTH main and sandbox: {both:?}"
    );

    let union: BTreeSet<_> = main.union(&sandbox).cloned().collect();
    assert_eq!(
        registered,
        union,
        "every registered command must be granted to exactly one tier.\n\
         ungranted (breaks host app): {:?}\nstray grant (no such command): {:?}",
        registered.difference(&union).collect::<Vec<_>>(),
        union.difference(&registered).collect::<Vec<_>>(),
    );
}

#[test]
fn sandbox_tier_grants_exactly_its_allowlist() {
    // Guard the WHOLE permissions array of the sandbox capability, not just its
    // bare app-command (allow-*) grants. A future colon-prefixed core/plugin
    // permission added to plugin-sandbox.json — e.g. `core:webview:allow-create-
    // webview-window`, `core:default`, or a plugin scope like `fs:allow-read` —
    // would be a boundary leak, exactly the class this lockdown exists to prevent,
    // yet a bare-`allow-*` check would miss it. A plugin-* window may hold ONLY
    // the event channel the sandbox client needs plus the single broker command.
    // `norm()` maps `-`->`_` on both sides, so `allow-plugin-call` (kebab, as
    // tauri-build generates) and `core:event:allow-emit` compare stably.
    let json: serde_json::Value = serde_json::from_str(&read("capabilities/plugin-sandbox.json"))
        .expect("parse capability json");
    let perms: BTreeSet<String> = json["permissions"]
        .as_array()
        .expect("permissions array")
        .iter()
        .filter_map(|p| p.as_str())
        .map(norm)
        .collect();
    // Expected set, normalized (norm collapses `-`->`_`):
    //   core:event:allow-emit / -listen / -unlisten  + the broker  allow-plugin-call
    let expected: BTreeSet<String> = [
        "core:event:allow_emit",
        "core:event:allow_listen",
        "core:event:allow_unlisten",
        "allow_plugin_call",
    ]
    .into_iter()
    .map(str::to_string)
    .collect();
    assert_eq!(
        perms,
        expected,
        "plugin-sandbox capability must grant EXACTLY the event channel + plugin_call.\n\
         unexpected (possible boundary leak): {:?}\nmissing: {:?}",
        perms.difference(&expected).collect::<Vec<_>>(),
        expected.difference(&perms).collect::<Vec<_>>(),
    );
}

#[test]
fn main_tier_gets_everything_except_plugin_call() {
    let registered = generate_handler_commands();
    let main = capability_allowed_commands("capabilities/default.json");
    let mut expected = registered;
    expected.remove(&norm("plugin_call"));
    assert_eq!(
        main,
        expected,
        "main/file-* capability must grant every command except plugin_call.\n\
         missing: {:?}\nextra: {:?}",
        expected.difference(&main).collect::<Vec<_>>(),
        main.difference(&expected).collect::<Vec<_>>(),
    );
}
