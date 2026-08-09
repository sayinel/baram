//! §260 Phase 3b — guardrail: the app-command ACL lockdown must stay in sync
//! across three places or the app silently breaks (a registered command with no
//! grant is rejected at runtime) or the sandbox boundary leaks (a command granted
//! to `plugin-*`). This test derives the canonical command set from the
//! `generate_handler!` list in `src/lib.rs` (the source of truth) and asserts
//! that `build.rs`'s `AppManifest` and the capability files agree.
//!
//! ‼️ Everything here keys on **which webviews a capability applies to**, never on the
//! file it lives in. Until 2026-08-09 five of these tests read exactly two hardcoded
//! paths — `capabilities/default.json` and `capabilities/plugin-sandbox.json` — so a
//! third file granting anything it liked to `plugin-*` was invisible. Verified rather
//! than reasoned: adding `capabilities/zz-leak.json` with `core:window:allow-close` on
//! `"windows": ["plugin-*"]` (a sandboxed plugin able to close the main window) left all
//! 7 tests green, including `host_tier_can_close_the_webviews_it_creates`, which asserts
//! in so many words that "the sandbox tier must hold no window permission at all".
//!
//! Discovery therefore mirrors tauri's, which was read out of the crates rather than
//! assumed (tauri-utils 2.9.3, tauri-build 2.6.3, tauri 2.11.5):
//!
//! - `parse_capabilities("./capabilities/**/*")` — **recursive**, so one directory level
//!   is not enough either; skips files whose parent directory is `schemas`.
//! - The extension filter is `["json", "toml"]` plus `"json5"` under `config-json5`.
//!   **`toml` is not feature-gated**: a `.toml` capability is live today, and a
//!   `.json`-only reader would not see it. This file refuses those extensions instead
//!   (see `capability_json_files`).
//! - `get_capabilities` (tauri-utils `acl/mod.rs:353`): if `app.security.capabilities` in
//!   `tauri.conf.json` is **empty**, every parsed file is live; if it is non-empty, only
//!   the listed ones are — a `Reference(id)` pulls a file in, an `Inlined(capability)` is
//!   defined in the config itself and lives nowhere else. Both are handled here, and
//!   `capability_discovery_sees_both_known_tiers` fails if that list ever silences one.
//! - A capability applies where `cmd.webviews.iter().any(…) || cmd.windows.iter().any(…)`
//!   (tauri `ipc/authority.rs:459`). **`webviews` is an independent second axis**, so
//!   `"webviews": ["plugin-*"]` with no `windows` reaches the sandbox — the per-plugin
//!   `WebviewWindow` of §260 has one webview whose label is the window label. Both axes
//!   are unioned into `targets` below. Empty on both = matches nothing.
//! - `platforms` is deliberately ignored: a capability limited to `["linux"]` is still a
//!   grant on Linux, and filtering by the host target would hide it from a macOS dev.
//!
//! Two things are NOT guarded here because tauri already makes them hard errors:
//! duplicate identifiers across files (`Error::CapabilityAlreadyExists`) and permissions
//! that name no known command (`validate_capabilities` in tauri-build).

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read(rel: &str) -> String {
    let p = manifest_dir().join(rel);
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

/// The window/webview globs the host realm owns. `file-*` is the single-file viewer.
const HOST_TARGETS: [&str; 2] = ["main", "file-*"];
/// The globs the sandbox owns — one per-plugin webview window, label `plugin-<id>`.
const SANDBOX_TARGETS: [&str; 1] = ["plugin-*"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Tier {
    Host,
    Sandbox,
}

/// One capability as tauri will apply it, wherever it was declared.
#[derive(Clone, Debug)]
struct Capability {
    /// Where it came from, for failure messages: a path, or the config.
    source: String,
    identifier: String,
    /// `windows` ∪ `webviews` — the two axes tauri ORs at invoke time.
    targets: BTreeSet<String>,
    /// Permission identifiers, `norm`-alized. Colon-prefixed plugin/core
    /// permissions are kept whole; bare app-command grants keep their `allow_` stem.
    permissions: BTreeSet<String>,
}

/// Every `*.json` under `capabilities/`, recursively.
///
/// `.toml` / `.json5` are refused rather than skipped. tauri parses `.toml`
/// unconditionally, so skipping it would be the same hole this file exists to close;
/// this repo has one capability format, and a policy is cheaper than a second parser.
/// Anything that is not a capability format at all (`.DS_Store`, notes) is ignored,
/// because tauri ignores it too.
fn capability_json_files() -> Vec<PathBuf> {
    let dir = manifest_dir().join("capabilities");
    let mut files = Vec::new();
    let mut stack = vec![dir.clone()];
    while let Some(d) = stack.pop() {
        for entry in std::fs::read_dir(&d)
            .unwrap_or_else(|e| panic!("read {}: {e}", d.display()))
            .flatten()
        {
            let path = entry.path();
            if path.is_dir() {
                // tauri skips a file whose PARENT is `schemas`; skipping the whole
                // subtree is stricter, which is the safe direction for a guard.
                if path.file_name().is_some_and(|n| n != "schemas") {
                    stack.push(path);
                }
                continue;
            }
            match path.extension().and_then(|x| x.to_str()) {
                Some("json") => files.push(path),
                Some(other @ ("toml" | "json5")) => panic!(
                    "{} is a `{other}` capability. tauri's CAPABILITY_FILE_EXTENSIONS accepts \
                     it (`toml` needs no cargo feature), so it is a LIVE grant, but this \
                     lockdown only parses JSON and would audit nothing. Convert it to JSON, \
                     or teach this file that format.",
                    path.display()
                ),
                _ => {}
            }
        }
    }
    files.sort();
    files
}

/// Build one `Capability` from its JSON object.
fn capability_from_json(json: &serde_json::Value, source: &str) -> Capability {
    let identifier = json["identifier"]
        .as_str()
        .unwrap_or_else(|| panic!("{source}: capability has no `identifier`: {json}"))
        .to_string();

    let globs = |key: &str| -> Vec<String> {
        json[key]
            .as_array()
            .map(|a| a.as_slice())
            .unwrap_or_default()
            .iter()
            .filter_map(|w| w.as_str())
            .map(str::to_string)
            .collect()
    };
    let targets: BTreeSet<String> = globs("windows")
        .into_iter()
        .chain(globs("webviews"))
        .collect();
    assert!(
        !targets.is_empty(),
        "{source}: capability `{identifier}` declares neither `windows` nor `webviews`, so \
         tauri matches it to nothing (`ipc/authority.rs`: both `any()` calls are false on an \
         empty list). Silently inert config is the failure mode this file guards; declare a \
         target or delete it."
    );

    let permissions: BTreeSet<String> = json["permissions"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or_default()
        .iter()
        // A permission entry is a bare string OR an object with an `identifier`
        // (`PermissionEntry::ExtendedPermission`, used to attach a scope). Reading only
        // strings would let `{"identifier": "log:default"}` through.
        .filter_map(|p| {
            p.as_str()
                .or_else(|| p.get("identifier").and_then(|i| i.as_str()))
        })
        .map(norm)
        .collect();

    Capability {
        source: source.to_string(),
        identifier,
        targets,
        permissions,
    }
}

/// One file may hold a single capability, a bare array of them, or
/// `{"capabilities": [...]}` — tauri's `CapabilityFile` accepts all three, so reading
/// `json["permissions"]` alone would panic on two of them, and a panicking test never
/// gets to inspect the grants it exists to inspect.
fn capabilities_in_file(path: &Path) -> Vec<Capability> {
    let source = path
        .strip_prefix(manifest_dir())
        .unwrap_or(path)
        .display()
        .to_string();
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).expect("read capability"))
            .unwrap_or_else(|e| panic!("{source}: parse capability: {e}"));

    let objects: Vec<&serde_json::Value> = if let Some(list) = json.as_array() {
        list.iter().collect()
    } else if let Some(list) = json.get("capabilities").and_then(|c| c.as_array()) {
        list.iter().collect()
    } else {
        vec![&json]
    };
    objects
        .into_iter()
        .map(|o| capability_from_json(o, &source))
        .collect()
}

/// `app.security.capabilities` from `tauri.conf.json`. Empty (or absent) means every
/// parsed file is live; see the module header.
fn config_capability_entries() -> Vec<serde_json::Value> {
    let json: serde_json::Value =
        serde_json::from_str(&read("tauri.conf.json")).expect("parse tauri.conf.json");
    json["app"]["security"]["capabilities"]
        .as_array()
        .cloned()
        .unwrap_or_default()
}

/// Every capability that will actually be applied, from every place tauri looks.
fn live_capabilities() -> Vec<Capability> {
    let from_files: Vec<Capability> = capability_json_files()
        .iter()
        .flat_map(|p| capabilities_in_file(p))
        .collect();

    let entries = config_capability_entries();
    if entries.is_empty() {
        return from_files;
    }

    let by_id: BTreeMap<&str, &Capability> = from_files
        .iter()
        .map(|c| (c.identifier.as_str(), c))
        .collect();
    entries
        .iter()
        .map(|entry| match entry.as_str() {
            Some(id) => (*by_id.get(id).unwrap_or_else(|| {
                panic!(
                    "tauri.conf.json references capability `{id}`, which no file under \
                     capabilities/ defines"
                )
            }))
            .clone(),
            None => capability_from_json(entry, "tauri.conf.json#app.security.capabilities"),
        })
        .collect()
}

/// Which tier a capability applies to, by its target globs — `None` if it reaches
/// somewhere this lockdown has no model for (a new glob, a `*`, or a mix of tiers).
fn tier_of(capability: &Capability) -> Option<Tier> {
    let all_in = |known: &[&str]| {
        capability
            .targets
            .iter()
            .all(|t| known.contains(&t.as_str()))
    };
    if all_in(&HOST_TARGETS) {
        Some(Tier::Host)
    } else if all_in(&SANDBOX_TARGETS) {
        Some(Tier::Sandbox)
    } else {
        None
    }
}

/// Union of the permissions every capability in `tier` grants.
///
/// Panics on an unclassifiable capability rather than dropping it: dropping would make
/// every aggregate assertion below silently blind to exactly the file that needs
/// auditing. `every_capability_targets_exactly_one_known_tier` reports it properly.
fn permissions_of(tier: Tier) -> BTreeSet<String> {
    let mut perms = BTreeSet::new();
    for capability in live_capabilities() {
        match tier_of(&capability) {
            Some(t) if t == tier => perms.extend(capability.permissions),
            Some(_) => {}
            None => panic!(
                "{} declares capability `{}` on {:?}, which is neither the host tier {:?} nor \
                 the sandbox tier {:?} — this lockdown cannot say who it grants to",
                capability.source,
                capability.identifier,
                capability.targets,
                HOST_TARGETS,
                SANDBOX_TARGETS,
            ),
        }
    }
    perms
}

/// App-command allow-permissions within a permission set: bare `allow_*` entries with
/// no plugin `:` prefix (core/plugin perms like `core:window:allow_create` or
/// `clipboard-manager:allow_write_image` are excluded by the `:` test).
fn app_commands(permissions: &BTreeSet<String>) -> BTreeSet<String> {
    permissions
        .iter()
        .filter(|p| !p.contains(':') && p.starts_with("allow_"))
        .map(|p| p.trim_start_matches("allow_").to_string())
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

/// Non-vacuity anchor for every aggregate assertion in this file.
///
/// All of them are "the union over tier T grants exactly X". A discovery that finds
/// nothing makes an empty union, and several of those assertions would then be arguing
/// about nothing. This one fails first, and names what went missing.
#[test]
fn capability_discovery_sees_both_known_tiers() {
    let live = live_capabilities();
    let ids: BTreeSet<&str> = live.iter().map(|c| c.identifier.as_str()).collect();
    for required in ["default", "plugin-sandbox"] {
        assert!(
            ids.contains(required),
            "capability `{required}` is not live. Either its file moved or was renamed, or \
             `app.security.capabilities` in tauri.conf.json now lists a subset that leaves it \
             out (a non-empty list silences every file it does not name). Live: {ids:?}"
        );
    }
    for tier in [Tier::Host, Tier::Sandbox] {
        assert!(
            live.iter().any(|c| tier_of(c) == Some(tier)),
            "no live capability applies to the {tier:?} tier; the per-tier assertions below \
             would be comparing empty sets"
        );
    }
}

/// Everything above walks `capabilities/` because that is tauri-build's default
/// (`parse_capabilities("./capabilities/**/*")`, taken when `Attributes` carries no
/// `capabilities_path_pattern` — verified: `build.rs` passes only `app_manifest`).
///
/// Overriding the pattern would point tauri at a different tree while this file kept
/// auditing the old one — the whole suite green about files nobody applies. That is the
/// one assumption the discovery cannot detect from its own results, so it is asserted
/// against the source instead.
#[test]
fn capability_discovery_uses_the_same_root_as_tauri_build() {
    // Comment lines are stripped first. build.rs is heavily commented, and a naive
    // `contains` would turn any future note that merely NAMES the method into a failure —
    // the same defect a guard in `src/logging` shipped with, where a `.setup(` inside its
    // own comment was counted as a call site.
    let build_rs: String = read("build.rs")
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        !build_rs.contains("capabilities_path_pattern"),
        "build.rs overrides the capability path pattern, so `capabilities/` is no longer \
         where tauri looks. Point `capability_json_files` at the same tree, or this lockdown \
         audits files that are not applied and misses the ones that are."
    );
}

/// §260 Phase 3c-3 (security review, M6) — the tiers are only separated if their target
/// globs stay separated, and until 2026-08-09 only two known files were checked.
///
/// Adding `plugin-*` (or `*`) to the host capability would hand sandbox webviews the
/// entire host command set — and, since 3c-3, the ability to close the main window.
#[test]
fn every_capability_targets_exactly_one_known_tier() {
    for capability in live_capabilities() {
        let tier = tier_of(&capability);
        assert!(
            tier.is_some(),
            "{} declares capability `{}` on {:?}. A capability is only meaningful together \
             with the webviews it applies to, and this one reaches outside both known tiers \
             (host {:?}, sandbox {:?}) — a `*`, a new window label, or one capability \
             spanning both. Split it per tier, or extend the tier constants deliberately.",
            capability.source,
            capability.identifier,
            capability.targets,
            HOST_TARGETS,
            SANDBOX_TARGETS,
        );
    }
}

#[test]
fn the_two_tiers_apply_to_disjoint_window_sets() {
    let mut host: BTreeSet<String> = BTreeSet::new();
    let mut sandbox: BTreeSet<String> = BTreeSet::new();
    for capability in live_capabilities() {
        match tier_of(&capability) {
            Some(Tier::Host) => host.extend(capability.targets),
            Some(Tier::Sandbox) => sandbox.extend(capability.targets),
            // Reported by `every_capability_targets_exactly_one_known_tier`.
            None => {}
        }
    }
    assert_eq!(
        host,
        HOST_TARGETS.iter().map(|s| s.to_string()).collect(),
        "host capabilities must apply to host windows only"
    );
    assert_eq!(
        sandbox,
        SANDBOX_TARGETS.iter().map(|s| s.to_string()).collect(),
        "sandbox capabilities must apply to sandbox windows only"
    );
    assert!(
        host.is_disjoint(&sandbox),
        "the two tiers share a target glob: {:?}",
        host.intersection(&sandbox).collect::<Vec<_>>()
    );
}

#[test]
fn sandbox_tier_grants_exactly_its_allowlist() {
    // Guard the WHOLE permission set of the sandbox tier, not just its bare app-command
    // (allow-*) grants. A colon-prefixed core/plugin permission — e.g.
    // `core:webview:allow-create-webview-window`, `core:default`, or a plugin scope like
    // `fs:allow-read` — would be a boundary leak, exactly the class this lockdown exists
    // to prevent, yet a bare-`allow-*` check would miss it.
    //
    // §260 Phase 3c-2a — `core:event:*` is WITHHELD and must never come back.
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
    let granted = permissions_of(Tier::Sandbox);
    let expected: BTreeSet<String> = [
        "allow_plugin_call",
        "allow_plugin_sandbox_connect",
        "allow_plugin_sandbox_report",
    ]
    .into_iter()
    .map(str::to_string)
    .collect();
    assert_eq!(
        granted,
        expected,
        "the sandbox tier must grant EXACTLY connect + report + plugin_call, summed over \
         every capability that reaches `plugin-*`.\n\
         unexpected (possible boundary leak): {:?}\nmissing: {:?}",
        granted.difference(&expected).collect::<Vec<_>>(),
        expected.difference(&granted).collect::<Vec<_>>(),
    );
}

#[test]
fn every_command_granted_to_exactly_one_tier() {
    let registered = generate_handler_commands();
    let main = app_commands(&permissions_of(Tier::Host));
    let sandbox = app_commands(&permissions_of(Tier::Sandbox));

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
    let host = permissions_of(Tier::Host);
    for required in [
        "core:window:allow_create",
        "core:window:allow_close",
        "core:webview:allow_create_webview_window",
    ] {
        assert!(
            host.contains(required),
            "host windows need {required}: creating a sandbox webview without being able \
             to close it leaves a running plugin that keeps its capabilities"
        );
    }
    // …and the sandbox tier must never get it — a plugin-* window holding
    // `allow-close` could close the MAIN window. `sandbox_tier_grants_exactly_its_
    // allowlist` enforces that exhaustively; this states the specific hazard.
    let window_perms: Vec<String> = permissions_of(Tier::Sandbox)
        .into_iter()
        .filter(|p| p.contains("window"))
        .collect();
    assert!(
        window_perms.is_empty(),
        "the sandbox tier must hold no window permission at all: {window_perms:?}"
    );
}

/// The logger's own IPC command must stay ungranted — to BOTH tiers.
///
/// `tauri-plugin-log` ships a `log` command (`allow-log`, default set `["allow-log"]`) that
/// lets a webview write a line of its choosing into `baram.log`. Nothing needs it: the
/// backend attaches the logger itself (`src/logging`) and no frontend code calls it.
///
/// Unlike the tier assertions, this one does not care which tier: trusted plugins run in
/// the main window's realm, so granting it there hands any installed plugin an
/// arbitrary-line writer into the file users are told to attach to bug reports — exactly
/// the deception `logging::escape_control_chars` exists to prevent.
///
/// If frontend logs are ever routed to the file (recorded in `dev/backlog.md`), this test
/// is the decision point: it must be replaced deliberately, host tier only, never
/// `plugin-*`.
#[test]
fn no_capability_grants_the_log_plugin_command() {
    for capability in live_capabilities() {
        let granted: Vec<&String> = capability
            .permissions
            .iter()
            // `log:` the PLUGIN prefix, not the substring: `allow-git-log` is one of our
            // own commands and `dialog:default` contains "log" too.
            .filter(|p| p.starts_with("log:"))
            .collect();
        assert!(
            granted.is_empty(),
            "{} grants the log plugin command to `{}`: {granted:?} — a webview could then \
             write arbitrary lines into the support log",
            capability.source,
            capability.identifier,
        );
    }
}

#[test]
fn main_tier_gets_everything_except_sandbox_only_commands() {
    let registered = generate_handler_commands();
    let main = app_commands(&permissions_of(Tier::Host));
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
