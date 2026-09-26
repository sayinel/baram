// §69 Plugin Marketplace — Rust 백엔드 모듈
use std::path::Path;

use thiserror::Error;

#[derive(Error, Debug)]
pub enum PluginError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("ZIP extraction error: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Checksum mismatch: expected {expected}, got {actual}")]
    ChecksumMismatch { expected: String, actual: String },
    #[error("Invalid manifest: {0}")]
    InvalidManifest(String),
    #[error("Plugin not found: {0}")]
    NotFound(String),
    /// A request or a job this layer declined to make, or could not finish — a blocked URL
    /// scheme, a response past its size cap, an archive past its expansion bounds, a
    /// staging task that did not return. Its own variant because the alternative was
    /// `InvalidManifest`, whose Display prefix would tell the user their manifest was
    /// broken when nothing had been downloaded yet.
    #[error("{0}")]
    Refused(String),
}

/// Serialized byte length of `value`, or `None` once it would exceed `cap` — the
/// serializer is aborted at that point, so an oversized value is never allocated
/// and never fully walked. One home for the "count, never allocate" rule, shared by
/// the sandbox report cap and the h2s frame warning (§260 3c-2a review, M6).
pub fn serialized_len_capped(value: &serde_json::Value, cap: usize) -> Option<usize> {
    struct CapCounter {
        cap: usize,
        written: usize,
    }
    impl std::io::Write for CapCounter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.written += buf.len();
            if self.written > self.cap {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "over cap",
                ));
            }
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut counter = CapCounter { cap, written: 0 };
    // A `serde_json::Value` cannot fail to serialize for any reason but the writer:
    // it holds no non-finite floats (`Number::from_f64` rejects them), all keys are
    // strings, and serde_json's deserializer caps nesting at 128 so Tauri rejects an
    // over-deep payload before we see it. So an error here means the cap tripped.
    match serde_json::to_writer(&mut counter, value) {
        Ok(()) => Some(counter.written),
        Err(_) => None,
    }
}

mod authorizer;
mod channels;
mod label_map;
mod rate_limit;
mod staging;
// `pub(crate)` (not bare `mod`) — unlike the sibling submodules above,
// commands::plugin_cmd (outside this module's descendant tree) reaches
// vault_path's pub(crate) items directly.
pub(crate) mod vault_path;
// §379 개발자 모드의 상태와 판정. `pub(crate)` 인 이유는 `vault_path` 와 같다 —
// `commands::plugin_dev_cmd` 가 이 모듈의 항목을 직접 쓴다.
pub(crate) mod dev_mode;
// Re-exported for the `plugin_call` broker + sandbox register/deregister
// commands (Phase 3a Task 2, src-tauri/src/commands/plugin_cmd.rs).
pub use authorizer::{plugin_id_from_label, PluginAuthorizer, PluginOp};
// Phase 3c-2a — host→sandbox message channels (src-tauri/src/commands/plugin_cmd.rs).
pub use channels::SandboxChannels;
// Phase 3c-2c — per-plugin, per-op-class rate limiting for `plugin_call`.
pub use rate_limit::{PluginRateLimiter, RateClass};
pub use staging::StagedPayloads;

mod archive;
mod fetch;
mod install;
mod limits;
mod origin;
mod registry;
mod storage;
#[cfg(test)]
mod test_support;
// Re-exported: `install.rs` staging/commit/discard/uninstall lifecycle
// (src-tauri/src/commands/plugin_cmd.rs).
pub use install::{
    commit_staged_install, discard_staged_install, list_installed, read_manifest, read_staged_file,
    read_stored_theme_css, stage_install, staging_dir_of, uninstall_installed, CommittedInstall,
    CommittedPluginInfo, CommittedThemeInfo, StagedInstall, StagedPluginInfo, StagedThemeInfo,
    StoredThemeCss, ThemeMode,
};
// Re-exported: manifest/registry data models (src-tauri/src/commands/plugin_cmd.rs).
pub use registry::{InstalledPluginInfo, PluginManifest, RegistryIndex};
// Re-exported: the plugin storage primitives + plugin directory accessor
// (src-tauri/src/commands/plugin_cmd.rs). `InstallKind` is §360's generalized entry point
// (dev/plans/0090-theme-marketplace-plan Task 3) — `get_theme_dir`/`install_root`
// themselves have no caller yet outside `plugin::install`, which reaches them directly via
// `super::storage`, so they are not re-exported here until something outside this module
// needs them (the next unused-import warning this file will get if that changes).
pub use storage::{
    get_plugin_dir, plugin_data_root, read_bundle_in, read_text_capped, storage_list, storage_read,
    storage_remove, storage_write, InstallKind,
};
// Re-exported: registry/revocation network fetch (src-tauri/src/commands/plugin_cmd.rs).
pub use fetch::{fetch_registry, fetch_registry_readme, fetch_revocations, FetchedRevocations};
// Re-exported: the plugin network proxy + its request/response shape
// (src-tauri/src/commands/plugin_cmd.rs, and plugin/authorizer.rs for the request shape).
pub use origin::{http_fetch, PluginFetchInit, PluginFetchResponse};
// Re-exported: §363's pure zip byte-builder (src-tauri/src/commands/theme_cmd.rs). Every
// other `archive` item stays `pub(super)` — install/extraction, reached only from
// `install.rs` inside this module — because this is the one write-side function a command
// outside `plugin` needs.
pub use archive::build_zip_bytes;

// ‼️ THE THREE DECLARATIONS BELOW STAY IN THIS FILE, not in `fetch.rs` / `origin.rs` where they
// are used. `scripts/rust-constants.ts` (`revocationByteCap`, `shippedRevocationPublicKey`) and
// two vitest tests (`src/plugins/__tests__/revocation-client.test.ts`,
// `revocation-signature-verify.test.ts`) `readFileSync` this exact path
// (`src-tauri/src/plugin/mod.rs`) and regex-scan its TEXT for these three declarations, each
// asserted to match exactly once. Moving a declaration elsewhere in the module tree does not
// fail the Rust build — it fails those TypeScript checks at runtime, silently, the next time
// someone publishes a revocation list or a registry index. See `fetch.rs`'s own module doc.
/// Largest revocation list we will read. Obsidian's comparable removal list is 369
/// entries and well under 100 KiB, so this is generous by an order of magnitude while
/// still bounding a hostile or misconfigured host.
const MAX_REVOCATION_BYTES: usize = 1024 * 1024;

/// The registry whose revocation list this build verifies.
///
/// Verification can only apply where we hold the key, and we hold one key. A user pointing at
/// their own registry keeps today's behaviour — their list is theirs, and there is no
/// mechanism for distributing a key per registry. ‼️ That asymmetry is logged rather than
/// silent: "unverified" must never look like "verified".
pub const FIRST_PARTY_REVOCATION_PREFIX: &str = "https://sayinel.github.io/baram-plugins/";

/// The key the first-party revocation list is signed with.
///
/// ‼️ ARMED SINCE 2026-08-04 — this constant is filled and in `main`, so the branches below that
/// describe the unarmed state are history plus a fallback, not a pending step (security re-review
/// Q5: the previous version of this docstring still told a reader not to fill it in).
///
/// The rollout order it describes was real and is worth keeping, because it is why the empty case
/// is handled at all: a signed list had to be PUBLISHED before clients demanded one, since a client
/// that demands a signature before one exists rejects the live list, keeps whatever it has, and
/// gives a fresh install no revocations at all. While the constant was empty the fetch path logged
/// loudly and accepted.
///
/// That path is now unreachable in a shipped build and deliberately kept: emptying this constant is
/// a one-line edit, `an_armed_key_must_actually_be_a_minisign_public_key` refuses it in CI, and if
/// it ever landed anyway the fetch must degrade audibly rather than silently claim verification.
pub const REVOCATION_PUBLIC_KEY: &str =
    "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDE2RTZCRUIwQTc4QTNCQjQKUldTME80cW5zTDdtRnVSMTI0WGpadUR0QjVUdmlINWFub1h1RjBNaXFEWUhGNVBwN3Rxa0hJK2gK";

fn validate_manifest(manifest: &PluginManifest) -> Result<(), PluginError> {
    if manifest.id.is_empty() {
        return Err(PluginError::InvalidManifest("id is required".to_string()));
    }
    if manifest.name.is_empty() {
        return Err(PluginError::InvalidManifest("name is required".to_string()));
    }
    if manifest.version.is_empty() {
        return Err(PluginError::InvalidManifest(
            "version is required".to_string(),
        ));
    }
    if manifest.main.is_empty() {
        return Err(PluginError::InvalidManifest("main is required".to_string()));
    }
    // Validate ID format: lowercase alphanumeric + hyphens
    if !manifest
        .id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(PluginError::InvalidManifest(
            "id must contain only lowercase letters, digits, and hyphens".to_string(),
        ));
    }
    // Validate capabilities
    let valid_caps = [
        "editor",
        "editor:readonly",
        "files",
        "files:readonly",
        "commands",
        "sidebar",
        "statusbar",
        "settings",
        "events",
        "extensions",
        "ai",
        "network",
        "storage",
        "viewer",
    ];
    for cap in &manifest.capabilities {
        if !valid_caps.contains(&cap.as_str()) {
            return Err(PluginError::InvalidManifest(format!(
                "unknown capability: {cap}"
            )));
        }
    }
    Ok(())
}

/// Read + validate a manifest from an arbitrary folder (dev plugin source).
pub fn read_manifest_at(folder: &Path) -> Result<PluginManifest, PluginError> {
    let manifest_path = folder.join("baram-plugin.json");
    if !manifest_path.exists() {
        return Err(PluginError::InvalidManifest(
            "baram-plugin.json not found in dev folder".to_string(),
        ));
    }
    let content = std::fs::read_to_string(&manifest_path)?;
    let manifest: PluginManifest = serde_json::from_str(&content)?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use super::registry::{EngineRequirement, PluginTrust};
    use super::*;

    /// §260 3c-3 — the live smoke fixture is loaded through the dev-folder path
    /// (`plugin_dev_cmd::admit_folder`), which calls `read_manifest_at`, which applies the RUST
    /// validator (a separate list from the TS one: its own capability allowlist and id rules).
    /// The TS test beside the fixture cannot see those, so a fixture that passes there could
    /// still fail at "Add dev folder" — during a scarce user-run smoke.
    #[test]
    fn the_smoke_fixture_loads_through_the_rust_dev_folder_path() {
        let dir = Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../examples/plugins/sandbox-smoke"
        ));
        let manifest = read_manifest_at(dir).expect("the smoke fixture must load");
        assert_eq!(manifest.id, "baram-sandbox-smoke");
        assert_eq!(manifest.trust, Some(PluginTrust::Sandboxed));
        // The entry must exist on disk too: the manifest naming a missing file is the
        // other way this fails, and it fails later — inside the sandbox, at activate.
        assert!(
            dir.join(&manifest.main).is_file(),
            "manifest.main must point at a real file"
        );
    }

    /// §260 3c-2a final pass (Q3) — two callers want OPPOSITE comparisons off this
    /// helper (`>` for the report cap, `>=` for the 8 KiB channel-queue threshold,
    /// hence its `threshold - 1`), so pin the boundary here rather than leaving the
    /// `-1` safe only by careful reading. A JSON string is `len + 2` bytes.
    #[test]
    fn serialized_len_capped_admits_exactly_cap_and_refuses_one_over() {
        let five = serde_json::Value::String("xyz".to_string()); // "xyz" → 5 bytes
        assert_eq!(serialized_len_capped(&five, 5), Some(5)); // == cap → admitted
        assert_eq!(serialized_len_capped(&five, 6), Some(5)); // under cap
        assert_eq!(serialized_len_capped(&five, 4), None); // one over → refused
    }

    #[test]
    fn test_validate_manifest_valid() {
        let manifest = PluginManifest {
            id: "baram-word-count".to_string(),
            name: "Word Count".to_string(),
            description: "Counts words".to_string(),
            version: "1.0.0".to_string(),
            author: "Test".to_string(),
            license: "MIT".to_string(),
            main: "index.mjs".to_string(),
            engines: EngineRequirement {
                baram: ">=0.2.0".to_string(),
            },
            capabilities: vec!["editor:readonly".to_string(), "statusbar".to_string()],
            dependencies: vec![],
            tiptap_extensions: vec![],
            repository: None,
            homepage: None,
            icon: None,
            keywords: vec![],
            trust: None,
            contributions: None,
        };
        assert!(validate_manifest(&manifest).is_ok());
    }

    #[test]
    fn test_validate_manifest_empty_id() {
        let manifest = PluginManifest {
            id: "".to_string(),
            name: "Test".to_string(),
            description: "".to_string(),
            version: "1.0.0".to_string(),
            author: "".to_string(),
            license: "MIT".to_string(),
            main: "index.mjs".to_string(),
            engines: EngineRequirement {
                baram: ">=0.2.0".to_string(),
            },
            capabilities: vec![],
            dependencies: vec![],
            tiptap_extensions: vec![],
            repository: None,
            homepage: None,
            icon: None,
            keywords: vec![],
            trust: None,
            contributions: None,
        };
        assert!(validate_manifest(&manifest).is_err());
    }

    #[test]
    fn test_validate_manifest_invalid_capability() {
        let manifest = PluginManifest {
            id: "test-plugin".to_string(),
            name: "Test".to_string(),
            description: "".to_string(),
            version: "1.0.0".to_string(),
            author: "".to_string(),
            license: "MIT".to_string(),
            main: "index.mjs".to_string(),
            engines: EngineRequirement {
                baram: ">=0.2.0".to_string(),
            },
            capabilities: vec!["dangerous-capability".to_string()],
            dependencies: vec![],
            tiptap_extensions: vec![],
            repository: None,
            homepage: None,
            icon: None,
            keywords: vec![],
            trust: None,
            contributions: None,
        };
        assert!(validate_manifest(&manifest).is_err());
    }

    #[test]
    fn test_validate_manifest_invalid_id_format() {
        let manifest = PluginManifest {
            id: "Test_Plugin".to_string(),
            name: "Test".to_string(),
            description: "".to_string(),
            version: "1.0.0".to_string(),
            author: "".to_string(),
            license: "MIT".to_string(),
            main: "index.mjs".to_string(),
            engines: EngineRequirement {
                baram: ">=0.2.0".to_string(),
            },
            capabilities: vec![],
            dependencies: vec![],
            tiptap_extensions: vec![],
            repository: None,
            homepage: None,
            icon: None,
            keywords: vec![],
            trust: None,
            contributions: None,
        };
        assert!(validate_manifest(&manifest).is_err());
    }

    #[test]
    fn test_validate_manifest_accepts_storage_capability() {
        let manifest = PluginManifest {
            id: "test-plugin".to_string(),
            name: "Test".to_string(),
            description: "".to_string(),
            version: "1.0.0".to_string(),
            author: "".to_string(),
            license: "MIT".to_string(),
            main: "index.mjs".to_string(),
            engines: EngineRequirement {
                baram: ">=0.2.0".to_string(),
            },
            capabilities: vec!["storage".to_string()],
            dependencies: vec![],
            tiptap_extensions: vec![],
            repository: None,
            homepage: None,
            icon: None,
            keywords: vec![],
            trust: None,
            contributions: None,
        };
        assert!(validate_manifest(&manifest).is_ok());
    }

    #[test]
    fn test_read_manifest_at_missing() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(read_manifest_at(tmp.path()).is_err());
    }

    #[test]
    fn test_read_manifest_at_valid() {
        let tmp = tempfile::tempdir().unwrap();
        let json = r#"{"id":"dev-x","name":"Dev X","description":"","version":"1.0.0","author":"","license":"MIT","main":"index.mjs","engines":{"baram":">=0.2.0"},"capabilities":["statusbar"]}"#;
        std::fs::write(tmp.path().join("baram-plugin.json"), json).unwrap();
        let m = read_manifest_at(tmp.path()).unwrap();
        assert_eq!(m.id, "dev-x");
    }
}
