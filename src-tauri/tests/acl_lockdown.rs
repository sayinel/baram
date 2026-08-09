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
    // yet a bare-`allow-*` check would miss it.
    //
    // §260 Phase 3c-2a — `core:event:*` is now WITHHELD and must never come back.
    // Tauri delivers a broadcast event to any JS listener registered with the
    // default `EventTarget::Any`, and `emit_to`/`emit_filter` cannot withhold it
    // (`match_any_or_filter`, tauri/src/event/listener.rs). So `allow-listen` on a
    // plugin-* window = a sandboxed plugin with ZERO capabilities can eavesdrop on
    // `llm:token`, `file:changed`, etc. The sandbox transport therefore uses
    // per-webview IPC instead: `plugin_sandbox_connect` (inbound ipc::Channel) +
    // `plugin_sandbox_report` (outbound, caller-identified), plus the broker
    // `plugin_call`.
    //
    // This asserts the GRANTED set, which is not identical to the REACHABLE set:
    // tauri hardcodes an ACL bypass for `FETCH_CHANNEL_DATA_COMMAND`
    // (`plugin:__TAURI_CHANNEL__|fetch`, `webview/mod.rs`, marked `TODO: Remove
    // this special check in v3`), so every webview can invoke that one regardless
    // of its capability. It is how a >8 KiB `ipc::Channel` frame is delivered; see
    // `SandboxChannels::send`, which warns in dev if our frames ever get that big.
    // `norm()` maps `-`->`_`, so kebab permission ids compare stably.
    let json: serde_json::Value = serde_json::from_str(&read("capabilities/plugin-sandbox.json"))
        .expect("parse capability json");
    let perms: BTreeSet<String> = json["permissions"]
        .as_array()
        .expect("permissions array")
        .iter()
        .filter_map(|p| p.as_str())
        .map(norm)
        .collect();
    // Expected set, normalized (norm collapses `-`->`_`): the two transport
    // commands + the broker. NO core:event:* — see the note above.
    let expected: BTreeSet<String> = [
        "allow_plugin_call",
        "allow_plugin_sandbox_connect",
        "allow_plugin_sandbox_report",
    ]
    .into_iter()
    .map(str::to_string)
    .collect();
    assert_eq!(
        perms,
        expected,
        "plugin-sandbox capability must grant EXACTLY connect + report + plugin_call.\n\
         unexpected (possible boundary leak): {:?}\nmissing: {:?}",
        perms.difference(&expected).collect::<Vec<_>>(),
        expected.difference(&perms).collect::<Vec<_>>(),
    );
}

/// §260 Phase 3c-3 — the host realm must be able to CLOSE a sandbox webview.
///
/// Found by the live smoke: `WebviewWindow.close()` was denied
/// (`core:window:allow-close` missing), so from 3c-1 onward the app could create a
/// per-plugin webview but never destroy one. Every teardown logged a swallowed
/// "Sandbox stop failed" and left the plugin RUNNING with its Rust capabilities —
/// the next load then died on the taken label. Unit tests could not see it: they
/// inject a fake window whose `close()` always resolves.
///
/// Pinned here, next to the grant it belongs to, because the symptom (a label
/// collision) points nowhere near the cause (a missing permission).
#[test]
fn host_tier_can_close_the_webviews_it_creates() {
    let json: serde_json::Value =
        serde_json::from_str(&read("capabilities/default.json")).expect("parse capability json");
    let perms: BTreeSet<String> = json["permissions"]
        .as_array()
        .expect("permissions array")
        .iter()
        .filter_map(|p| p.as_str())
        .map(norm)
        .collect();
    for required in [
        "core:window:allow_create",
        "core:window:allow_close",
        "core:webview:allow_create_webview_window",
    ] {
        assert!(
            perms.contains(required),
            "host windows need {required}: creating a sandbox webview without being able \
             to close it leaves a running plugin that keeps its capabilities"
        );
    }
    // …and the sandbox tier must never get it — a plugin-* window holding
    // `allow-close` could close the MAIN window. `sandbox_tier_grants_exactly_its_
    // allowlist` enforces that exhaustively; this states the specific hazard.
    let sandbox: serde_json::Value =
        serde_json::from_str(&read("capabilities/plugin-sandbox.json"))
            .expect("parse capability json");
    let sandbox_perms = serde_json::to_string(&sandbox["permissions"]).unwrap_or_default();
    assert!(
        !sandbox_perms.contains("window"),
        "the sandbox tier must hold no window permission at all: {sandbox_perms}"
    );
}

/// §260 Phase 3c-3 (security review, M6) — the tiers are only separated if the
/// capability `windows` globs stay separated, and nothing pinned them.
///
/// Everything else in this file guards WHICH permissions each capability lists; a
/// capability is only meaningful together with WHICH windows it applies to. Adding
/// `plugin-*` (or `*`) to the host capability would hand sandbox webviews the entire
/// host command set — and, since 3c-3, the ability to close the main window.
#[test]
fn the_two_tiers_apply_to_disjoint_window_sets() {
    let windows_of = |rel: &str| -> Vec<String> {
        let json: serde_json::Value =
            serde_json::from_str(&read(rel)).expect("parse capability json");
        json["windows"]
            .as_array()
            .expect("capability must declare `windows`")
            .iter()
            .filter_map(|w| w.as_str())
            .map(str::to_string)
            .collect()
    };
    assert_eq!(
        windows_of("capabilities/default.json"),
        vec!["main".to_string(), "file-*".to_string()],
        "the host capability must apply to host windows only"
    );
    assert_eq!(
        windows_of("capabilities/plugin-sandbox.json"),
        vec!["plugin-*".to_string()],
        "the sandbox capability must apply to sandbox windows only"
    );
}

/// The logger's own IPC command must stay ungranted — to BOTH tiers.
///
/// `tauri-plugin-log` ships a `log` command (`allow-log`, default set `["allow-log"]`) that
/// lets a webview write a line of its choosing into `baram.log`. Nothing needs it: the
/// backend attaches the logger itself (`src/logging`) and no frontend code calls it.
///
/// The sandbox side is already exhaustively pinned by `sandbox_tier_grants_exactly_its_
/// allowlist`. The HOST side is not: `every_command_granted_to_exactly_one_tier` filters on
/// `!p.contains(':')`, so it ignores every plugin permission, and `log:default` could be
/// added to `default.json` without a single test noticing. That matters because trusted
/// plugins run in the main window's realm — granting it there hands any installed plugin an
/// arbitrary-line writer into the file users are told to attach to bug reports, which is
/// exactly the deception the escaping in `logging::escape_control_chars` exists to prevent.
///
/// If frontend logs are ever routed to the file (recorded in `dev/backlog.md`), this test is
/// the decision point: it must be replaced deliberately, host tier only, never `plugin-*`.
#[test]
fn no_capability_grants_the_log_plugin_command() {
    // Every file, not the two we happen to have: tauri-build parses
    // `./capabilities/**/*`, so a new `capabilities/frontend-logs.json` would be a live
    // grant that a hardcoded pair of filenames cannot see. This test's whole contract is
    // "nothing, anywhere, grants it".
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
    let files: Vec<_> = std::fs::read_dir(&dir)
        .expect("read capabilities/")
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    assert!(
        files.len() >= 2,
        "expected at least the two known capability files in {}, found {files:?}",
        dir.display()
    );

    for path in files {
        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).expect("read capability"))
                .expect("parse capability");
        let granted: Vec<String> = json["permissions"]
            .as_array()
            .expect("permissions array")
            .iter()
            // A permission entry may be a bare string OR an object with an `identifier`
            // (`PermissionEntry::ExtendedPermission`, used to attach a scope). Reading
            // only strings would let `{"identifier": "log:default"}` through.
            .filter_map(|p| {
                p.as_str()
                    .or_else(|| p.get("identifier").and_then(|i| i.as_str()))
            })
            // `log:` the PLUGIN prefix, not the substring: `allow-git-log` is one of our own
            // commands and `dialog:default` contains "log" too.
            .filter(|p| p.starts_with("log:"))
            .map(str::to_string)
            .collect();
        assert!(
            granted.is_empty(),
            "{} grants the log plugin command: {granted:?} — a webview could then write \
             arbitrary lines into the support log",
            path.display()
        );
    }
}

#[test]
fn main_tier_gets_everything_except_sandbox_only_commands() {
    let registered = generate_handler_commands();
    let main = capability_allowed_commands("capabilities/default.json");
    let mut expected = registered;
    // The sandbox-only surface: the broker plus the two transport commands whose
    // caller must be a `plugin-*` window (they'd be rejected from main anyway).
    for sandbox_only in [
        "plugin_call",
        "plugin_sandbox_connect",
        "plugin_sandbox_report",
    ] {
        expected.remove(&norm(sandbox_only));
    }
    assert_eq!(
        main,
        expected,
        "main/file-* capability must grant every command except the sandbox-only ones.\n\
         missing: {:?}\nextra: {:?}",
        expected.difference(&main).collect::<Vec<_>>(),
        main.difference(&expected).collect::<Vec<_>>(),
    );
}
