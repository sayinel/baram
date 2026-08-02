// §69 Plugin Marketplace — Rust 백엔드 모듈
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;
use thiserror::Error;

/// §260 Phase 5 — dev-folder side-loading stays a dev-build affordance.
///
/// This was `plugins_runtime_enabled`, and it also gated install, asset scopes, the
/// network proxy and storage writes. Phase 5 opened those: the sandboxed tier cannot
/// function without them, and the boundary is now the Rust authorizer plus the install
/// consent record rather than a build flag.
///
/// Side-loading is the one that did NOT open. Pointing the app at a directory skips the
/// checksum, the registry listing and the consent step entirely, and it exists to serve
/// plugin authors — who run dev builds. The name says what it actually gates, because
/// the old one read as "plugins work at all" and would invite exactly the wrong edit.
pub fn dev_plugin_loading_enabled() -> bool {
    cfg!(debug_assertions)
}

/// Error surfaced when a dev-only plugin command is invoked in a release build.
pub fn plugins_disabled_error() -> String {
    "Loading plugins from a folder is only available in development builds.".to_string()
}

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
// Re-exported for the `plugin_call` broker + sandbox register/deregister
// commands (Phase 3a Task 2, src-tauri/src/commands/plugin_cmd.rs).
pub use authorizer::{plugin_id_from_label, PluginAuthorizer, PluginOp};
// Phase 3c-2a — host→sandbox message channels (src-tauri/src/commands/plugin_cmd.rs).
pub use channels::SandboxChannels;
// Phase 3c-2c — per-plugin, per-op-class rate limiting for `plugin_call`.
pub use rate_limit::{PluginRateLimiter, RateClass};
pub use staging::StagedPayloads;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PluginTrust {
    Sandboxed,
    Trusted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub license: String,
    pub main: String,
    pub engines: EngineRequirement,
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default, rename = "tiptapExtensions")]
    pub tiptap_extensions: Vec<TiptapExtensionDef>,
    #[serde(default)]
    pub repository: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub trust: Option<PluginTrust>,
    #[serde(default)]
    pub contributions: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineRequirement {
    pub baram: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TiptapExtensionDef {
    #[serde(rename = "type")]
    pub ext_type: String, // "node" | "mark" | "plugin"
    pub name: String,
    #[serde(rename = "exportName")]
    pub export_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPluginInfo {
    pub manifest: PluginManifest,
    pub install_path: String,
    pub checksum: String,
    #[serde(default)]
    pub is_dev: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub license: String,
    #[serde(rename = "downloadUrl")]
    pub download_url: String,
    pub checksum: String,
    pub capabilities: Vec<String>,
    /// §260 Phase 6 — the trust tier, carried THROUGH to the frontend.
    ///
    /// Rust decides nothing with it: consent is collected in the frontend against this
    /// entry, and `plugin_call`'s authorizer is keyed on the window label, not on anything
    /// the registry claims. But the field must exist here, because `fetch_registry`
    /// deserializes the live index into this struct and Tauri re-serializes it on the way
    /// back — so a tier that is not a field is a tier the frontend never sees. Publishing
    /// `trust` in `index.json` without this makes every entry look legacy and disables
    /// Install (§260 Phase 5), which is exactly the state Phase 6 found shipped.
    ///
    /// `Option<String>` rather than an enum: this layer is a pipe, and refusing an unknown
    /// tier here would turn a future registry addition into a hard fetch failure for the
    /// whole index. The frontend normalizes it (`fetchRegistryIndex`) and fails closed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trust: Option<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub downloads: u64,
    #[serde(default)]
    pub repository: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    /// The declared minimum app version — ABSENT is a legal state here, meaning "no floor".
    ///
    /// Authors are still required to declare it (`docs/plugin-development.md`, and
    /// `scripts/validate-index.ts` fails the publish without it). This is the reader being
    /// liberal, not the spec going soft: `unmetBaramFloor` already treats an unparseable or
    /// missing floor as "no opinion" and installs anyway, so an entry without `engines` is
    /// one the app is perfectly willing to serve. Refusing to *deserialize* it would have
    /// been the only place that disagreed — and, before the tolerant `plugins` below, it
    /// took the whole index down with it.
    ///
    /// ‼️ WHY THIS IS NOT A FAIL-OPEN (§69 security review, question (a)). Omitting the
    /// field DEFERS the floor check, it does not remove it: `handleInstall` re-checks
    /// against `result.manifest.engines` after the download, and `PluginManifest.engines` is
    /// still REQUIRED here and in `validateManifest`. So the cost of an omission is a wasted
    /// download and a rollback, not an unprotected install. The listing's floor was never a
    /// security control anyway — it is self-declared by the party being gated, and
    /// `"baram": "*"` already bypassed it at zero cost before this change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engines: Option<EngineRequirement>,
}

/// Entries this build cannot read are DROPPED; the rest of the index stands.
///
/// `fetch_revocations`, thirty lines below `fetch_registry`, already carries this argument
/// in its docstring — it returns raw text precisely so that "a serde struct here would
/// reject the whole document on one bad entry". That reasoning was never applied to the
/// index, which is the list where the blast radius is larger: the revocation list failing
/// open costs one protection, but the index failing to parse empties the marketplace for
/// every user at once. A single community entry missing `license` did that.
///
/// Not the text-and-validate-in-TS shape of its sibling, deliberately. `RegistryEntry` is a
/// typed IPC contract the frontend consumes field-by-field, and moving parsing across the
/// boundary would mean writing a second full validator in TS to replace the one serde gives
/// us here. Per-entry tolerance buys the same property — one bad entry costs one entry —
/// without that.
///
/// ‼️ TOLERANCE IS FOR PARTIAL DAMAGE ONLY. A non-empty array from which NOTHING survives
/// is still a hard error, and that distinction is the whole safety of this design.
///
/// Turning a parse failure into `Ok` with fewer entries turns it into `Ok` with ZERO entries
/// when the cause is systemic rather than per-entry — a renamed field, a script emitting
/// `version` as a number, a schema change on either side. `fetchRegistryIndex` would then
/// cache that empty index for 24 hours, and its stale-cache fallback only runs on a throw,
/// so the user's previously-working listing would be replaced by a silent empty Browse tab.
/// That trades an observable outage for an unobservable one — worse than the bug this
/// tolerance fixes. Erroring on total loss keeps the old behaviour for exactly the case the
/// old behaviour was right about.
///
/// How many were dropped reaches the frontend in `dropped_count`, because nothing on this
/// side can report it: `src-tauri` installs no `log` implementation, so the `log::warn!` in
/// the impl below is a no-op in every build today. It is kept for the day one is installed;
/// the field is what actually carries the signal now.
#[derive(Debug, Clone, Serialize)]
pub struct RegistryIndex {
    pub plugins: Vec<RegistryEntry>,
    #[serde(rename = "updatedAt")]
    pub updated_at: Option<String>,
    /// How many entries the deserializer discarded, for the frontend to report.
    ///
    /// Never read off the wire — see the `Deserialize` impl. Same argument `normalizeIndex`
    /// makes for stripping a registry-supplied `demotedBecause`: a remote document must not
    /// be able to claim a diagnostic the app produces.
    #[serde(rename = "droppedCount")]
    pub dropped_count: usize,
}

/// The shape actually on the wire. `plugins` lands as raw `Value`s so each can be tried
/// independently; `dropped_count` has no counterpart here, which is what makes it un-forgeable.
#[derive(Deserialize)]
struct RawRegistryIndex {
    /// No `#[serde(default)]`: a document with no `plugins` array is not a partly-broken
    /// index, it is not an index. That stays a hard error.
    plugins: Vec<serde_json::Value>,
    #[serde(default, rename = "updatedAt")]
    updated_at: Option<String>,
}

impl<'de> Deserialize<'de> for RegistryIndex {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = RawRegistryIndex::deserialize(deserializer)?;
        let total = raw.plugins.len();
        // NOT `with_capacity(total)`: `RegistryEntry` is ~368 bytes, so a 4 MiB document of
        // millions of junk elements would reserve hundreds of MiB for entries that will
        // never be kept. Growing on demand costs a few reallocations for a real index.
        let mut kept: Vec<RegistryEntry> = Vec::new();
        for value in raw.plugins {
            // Captured before the move, so the warning can name the offender.
            let label = value
                .get("id")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned);
            match serde_json::from_value::<RegistryEntry>(value) {
                Ok(entry) => kept.push(entry),
                Err(err) => log::warn!(
                    "[registry] dropping unreadable index entry {}: {err}",
                    label.as_deref().unwrap_or("<no id>")
                ),
            }
        }
        if total > 0 && kept.is_empty() {
            return Err(serde::de::Error::custom(format!(
                "every one of the {total} entries in this index was unreadable — treating \
                 it as a broken document rather than an empty registry"
            )));
        }
        Ok(RegistryIndex {
            dropped_count: total - kept.len(),
            plugins: kept,
            updated_at: raw.updated_at,
        })
    }
}

/// Response body cap for `http_fetch` (§69 Phase D network API).
const MAX_FETCH_BYTES: usize = 10 * 1024 * 1024; // 10 MiB

/// Largest plugin archive we will download.
///
/// This is a MEMORY bound, not a policy about plugin size: `extract_zip_bytes` reads the
/// archive from a slice, so whatever arrives is held whole regardless. Without a cap a
/// hostile or compromised registry can name a `downloadUrl` that allocates until the
/// process dies — and it is reached before the checksum can say anything, because there is
/// nothing to hash until the download ends.
///
/// 32 MiB is far above anything legitimate. A sandboxed plugin is an ESM bundle and cannot
/// ship native code at all; the entire Baram binary targets under 15 MiB.
const MAX_PLUGIN_ARCHIVE_BYTES: usize = 32 * 1024 * 1024;

// ‼️ THE DOWNLOAD CAP ABOVE DOES NOT BOUND THE EXTRACTION (#261). DEFLATE's theoretical
// ceiling is about 1032:1, so 32 MiB on the wire can become roughly 33 GB on disk — and
// `extract_zip_bytes` read each entry with `read_to_end` into an unbounded `Vec`, so memory
// went first. §69's earlier "guard the plugin download too" work bounded the wire and left
// this open; the two are different limits and only one of them existed.
//
// Every bound below is enforced on bytes ACTUALLY read, never on the sizes the archive
// declares about itself — those are written by whoever built the archive.

/// Most files one plugin archive may contain.
///
/// A sandboxed plugin is a bundle: a manifest, one or a few ESM chunks, a README, maybe
/// icons. Two thousand leaves enormous room while bounding the per-entry syscall storm that
/// a million-empty-file archive would otherwise buy for a few kilobytes on the wire.
const MAX_ARCHIVE_ENTRIES: usize = 2_000;

/// Largest single file an archive may expand to.
const MAX_ENTRY_BYTES: u64 = 64 * 1024 * 1024;

/// Largest total an archive may expand to across all entries.
///
/// Generous on purpose. The one published plugin expands to tens of kilobytes, but a plugin
/// bundling a dictionary, a font or a WASM module is a legitimate future shape, and a limit
/// that forbids those buys nothing — a bomb is orders of magnitude past this, not just over.
const MAX_TOTAL_EXPANDED_BYTES: u64 = 256 * 1024 * 1024;

/// Largest expanded:compressed ratio tolerated once the output is big enough to judge.
///
/// Text and JS compress at roughly 3–10:1, so 100:1 is well clear of anything real while a
/// zip bomb needs hundreds or thousands to one to be worth building.
const MAX_COMPRESSION_RATIO: u64 = 100;

/// Deepest path any entry may carry.
///
/// ‼️ Directories cost nothing the BYTE bounds can see (review M2). An entry contributes no
/// expanded bytes for its parents, so 2,000 entries each ~400 components deep fit in a
/// 3.2 MiB download and buy 800,000 `mkdir` calls — measured at ~57 s of blocking-pool time
/// to create and ~104 s to clean up, with `copy_dir_recursive` paying it a third time after
/// the destructive `remove_dir_all`. Every byte ceiling saw zero.
///
/// A plugin bundle is `dist/chunks/x.mjs`: depth 3. Sixteen is far past anything real and
/// takes the worst case to 2,000 × 16, which is seconds rather than minutes.
const MAX_PATH_DEPTH: usize = 16;

/// Below this much output the ratio is not evidence of anything.
///
/// Without a floor a 2 KiB archive of highly compressible text trips 100:1 at 200 KiB —
/// a plausible plugin refused for a statistic computed on too little data. A bomb has to
/// clear this floor before the ratio applies, which costs it nothing it can exploit: the
/// absolute totals above still bound it.
const RATIO_FLOOR_BYTES: u64 = 1024 * 1024;

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

/// Returns the plugin installation base directory: ~/.baram/plugins/
pub fn get_plugin_dir() -> Result<PathBuf, PluginError> {
    let home = dirs_next().ok_or_else(|| {
        PluginError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Could not determine home directory",
        ))
    })?;
    let plugin_dir = home.join(".baram").join("plugins");
    if !plugin_dir.exists() {
        std::fs::create_dir_all(&plugin_dir)?;
    }
    Ok(plugin_dir)
}

fn dirs_next() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

/// Download a plugin ZIP from URL, verify checksum, extract to plugin dir.
///
/// `expected_id` is the id the caller was told to expect — the registry listing's. It is
/// checked BEFORE the extracted files are moved into place (§260 Phase 5 re-review, R5),
/// and that ordering is the whole point: step 6 does `remove_dir_all` on a directory named
/// by the id inside the ARCHIVE, so an archive declaring some other installed plugin's id
/// destroyed that plugin's files as a side effect of downloading this one. The frontend
/// could only notice afterwards, by which time the only repair left was to delete the
/// remains. Refusing here means the damage never happens.
///
/// `None` skips the check, for a caller that has no prior expectation.
pub async fn install_plugin(
    url: &str,
    expected_checksum: Option<&str>,
    expected_id: Option<&str>,
) -> Result<InstalledPluginInfo, PluginError> {
    // 1. Download the ZIP.
    //
    // Guarded like `fetch_registry` and `fetch_revocations`, and this is the path where it
    // matters most: what arrives is third-party code, its URL comes from the registry
    // index rather than from us, and every check downstream — checksum, manifest, tier —
    // can only run once the download has ENDED. So an unbounded or never-ending download
    // is not caught later by anything; it simply never reaches the checks.
    //
    // `read_timeout` rather than only a total `timeout`: a legitimate multi-megabyte
    // archive on a slow link must be allowed to finish, while a connection that stops
    // delivering bytes must not hold the install open. A flat 15s total, as the two
    // metadata fetches use, would trade the first away for the second.
    //
    // But per-read alone is not enough (§69 code review): a host delivering one byte every
    // 29s resets the read deadline forever, and `setInstalling` is only cleared in the
    // `finally` of the caller — so that plugin's Install button stays disabled, with no
    // cancel, until the app restarts. Hence a generous TOTAL deadline as well. Ten minutes
    // bounds the drip while staying far outside any real download: the archives this
    // registry serves are tens of kilobytes, and even the 32 MiB ceiling only needs about
    // 55 KiB/s sustained.
    let parsed = validate_http_url(url).map_err(PluginError::Refused)?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(600))
        .build()?;
    let mut response = client.get(parsed).send().await?;
    let status = response.status();
    if !status.is_success() {
        return Err(PluginError::Refused(format!(
            "plugin download returned HTTP {status}"
        )));
    }
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if buf.len() + chunk.len() > MAX_PLUGIN_ARCHIVE_BYTES {
            return Err(PluginError::Refused(format!(
                "plugin archive too large: exceeds {MAX_PLUGIN_ARCHIVE_BYTES} byte limit"
            )));
        }
        buf.extend_from_slice(&chunk);
    }
    let bytes = buf;

    // 2. Verify checksum if provided
    let actual_checksum = hex_sha256(&bytes);
    if let Some(expected) = expected_checksum {
        if actual_checksum != expected {
            return Err(PluginError::ChecksumMismatch {
                expected: expected.to_string(),
                actual: actual_checksum,
            });
        }
    }

    // 3–6, moved OFF the async runtime (#261).
    //
    // Inflating a ZIP and copying a directory tree are CPU- and syscall-bound, and they were
    // running inline in an `async fn` — so one large archive parked a Tokio worker for the
    // entire install and delayed every other task sharing it. `spawn_blocking` is where work
    // that blocks belongs; the caps in `extract_zip_bytes` bound how long it can hold the
    // thread it is handed.
    //
    // Steps 4–6 move with it rather than staying behind: they are all synchronous
    // filesystem work on the same temp directory, and splitting them would mean either
    // keeping the `TempDir` alive across an await or two round trips to the blocking pool
    // for no gain.
    let expected_id = expected_id.map(str::to_owned);
    let (manifest, target_dir) =
        tokio::task::spawn_blocking(move || -> Result<(PluginManifest, PathBuf), PluginError> {
            // 3. Extract to temp dir first to read manifest
            let temp_dir = tempfile::tempdir()?;
            extract_zip_bytes(&bytes, temp_dir.path())?;

            // 4. Read manifest
            let manifest_path = temp_dir.path().join("baram-plugin.json");
            if !manifest_path.exists() {
                return Err(PluginError::InvalidManifest(
                    "baram-plugin.json not found in archive".to_string(),
                ));
            }
            let manifest_str = std::fs::read_to_string(&manifest_path)?;
            let manifest: PluginManifest = serde_json::from_str(&manifest_str)?;

            // 5. Validate manifest
            validate_manifest(&manifest)?;

            // 5b. The archive must be the plugin the caller asked for — checked here, before
            // the destructive move below, and never after it.
            if let Some(expected) = expected_id.as_deref() {
                if manifest.id != expected {
                    return Err(PluginError::InvalidManifest(format!(
                        "archive declares id \"{}\" but \"{}\" was requested",
                        manifest.id, expected
                    )));
                }
            }

            // 6. Move to final location
            //
            // ‼️ STILL DESTRUCTIVE-FIRST, deliberately unchanged here. A failure between the
            // remove and the end of the copy leaves the user with neither version. Replacing
            // this with a staged rename plus rollback is the second half of #261 and changes
            // the install/update contract; this change is bounds and threading only, so the
            // two land as separate reviewable pieces.
            let plugin_dir = get_plugin_dir()?;
            let target_dir = plugin_dir.join(&manifest.id);
            if target_dir.exists() {
                std::fs::remove_dir_all(&target_dir)?;
            }

            // Copy temp dir contents to target
            copy_dir_recursive(temp_dir.path(), &target_dir)?;

            Ok((manifest, target_dir))
        })
        .await
        // Deliberately does NOT interpolate `err`. A `JoinError` here means the closure
        // panicked, i.e. a bug in this code rather than anything about the archive, and its
        // payload can carry absolute paths straight to the frontend (review L1). Nothing in
        // it is actionable for the user; the shape of the failure is.
        .map_err(|_| PluginError::Refused("the plugin install task did not finish".into()))??;

    Ok(InstalledPluginInfo {
        install_path: target_dir.to_string_lossy().to_string(),
        checksum: actual_checksum,
        manifest,
        is_dev: false,
    })
}

/// Uninstall a plugin by removing its directory.
///
/// §260 Phase 5 code review — the id is `single_segment`-checked, matching
/// [`plugin_data_dir`]. This function does `remove_dir_all`, so it is the one place where
/// an id containing `..` or a separator would be worst, and it was the only one of the two
/// without the guard. Not reachable today (Rust's own `validate_manifest` constrains the
/// id before the files land), but the rollback path now passes an id read from a manifest
/// that may have just FAILED validation — so the asymmetry stops being merely untidy.
pub async fn uninstall_plugin(plugin_id: &str) -> Result<(), PluginError> {
    let seg = single_segment(plugin_id)
        .ok_or_else(|| PluginError::InvalidManifest(format!("invalid plugin id: {plugin_id}")))?;
    let plugin_dir = get_plugin_dir()?;
    let target_dir = plugin_dir.join(seg);
    if !target_dir.exists() {
        return Err(PluginError::NotFound(plugin_id.to_string()));
    }
    std::fs::remove_dir_all(&target_dir)?;
    Ok(())
}

/// List all installed plugins by reading their manifests.
pub async fn list_installed() -> Result<Vec<InstalledPluginInfo>, PluginError> {
    let plugin_dir = get_plugin_dir()?;
    if !plugin_dir.exists() {
        return Ok(Vec::new());
    }

    let mut plugins = Vec::new();
    let entries = std::fs::read_dir(&plugin_dir)?;
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("baram-plugin.json");
        if !manifest_path.exists() {
            continue;
        }
        match std::fs::read_to_string(&manifest_path) {
            Ok(content) => match serde_json::from_str::<PluginManifest>(&content) {
                Ok(manifest) => {
                    // Compute checksum of the manifest file for integrity
                    let checksum = hex_sha256(content.as_bytes());
                    plugins.push(InstalledPluginInfo {
                        manifest,
                        install_path: path.to_string_lossy().to_string(),
                        checksum,
                        is_dev: false,
                    });
                }
                Err(_) => continue,
            },
            Err(_) => continue,
        }
    }
    Ok(plugins)
}

/// Read manifest for a specific installed plugin.
pub async fn read_manifest(plugin_id: &str) -> Result<PluginManifest, PluginError> {
    let plugin_dir = get_plugin_dir()?;
    let manifest_path = plugin_dir.join(plugin_id).join("baram-plugin.json");
    if !manifest_path.exists() {
        return Err(PluginError::NotFound(plugin_id.to_string()));
    }
    let content = std::fs::read_to_string(&manifest_path)?;
    let manifest: PluginManifest = serde_json::from_str(&content)?;
    Ok(manifest)
}

/// Largest registry index we will read.
///
/// Four times the revocation cap, because this file grows with the registry itself:
/// Obsidian's community index is roughly 2,000 entries and about 1 MB, and an index that
/// outgrew its own cap would take the marketplace down for every user at once. Still a
/// bound — without one, a misconfigured or hostile host streams unbounded bytes into
/// memory.
const MAX_REGISTRY_BYTES: usize = 4 * 1024 * 1024;

/// Fetch registry index.json from a URL. Caching is handled at the frontend level.
///
/// Guarded the way `fetch_revocations` is: scheme, timeout, streamed size cap. It had
/// none of the three — `reqwest::get` honours whatever scheme the URL names, waits with
/// no deadline, and `text()` buffers a body of any length before anything can inspect it.
///
/// No UI sets the registry URL today; it is persisted store state with a default. That is
/// not the same as trusted input — it is read back from disk on every start, and a
/// trusted-tier plugin shares the realm that writes it. The guards therefore do not
/// depend on where the string came from.
pub async fn fetch_registry(url: &str) -> Result<RegistryIndex, PluginError> {
    let parsed = validate_http_url(url).map_err(PluginError::Refused)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;
    let mut response = client.get(parsed).send().await?;
    let status = response.status();
    if !status.is_success() {
        // `Refused`, not `InvalidManifest`. A 404 reached the user as "Invalid manifest:
        // Registry returned HTTP 404" — blaming a document that had not been downloaded,
        // which is the exact miscue `Refused` was added to remove (§69 code review).
        return Err(PluginError::Refused(format!(
            "registry returned HTTP {status}"
        )));
    }
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if buf.len() + chunk.len() > MAX_REGISTRY_BYTES {
            return Err(PluginError::Refused(format!(
                "registry index too large: exceeds {MAX_REGISTRY_BYTES} byte limit"
            )));
        }
        buf.extend_from_slice(&chunk);
    }
    let index: RegistryIndex = serde_json::from_slice(&buf)?;
    Ok(index)
}

/// Largest revocation list we will read. Obsidian's comparable removal list is 369
/// entries and well under 100 KiB, so this is generous by an order of magnitude while
/// still bounding a hostile or misconfigured host.
const MAX_REVOCATION_BYTES: usize = 1024 * 1024;

/// Fetch the plugin revocation list as raw JSON text (§69).
///
/// Text, not a typed struct, on purpose. The TypeScript side already owns the
/// validator (`normalizeRevocationList`), and its rule is to drop malformed ENTRIES
/// while keeping the rest of the list. A serde struct here would reject the whole
/// document on one bad entry — silently disabling revocation, which is the exact
/// failure that validator was written to avoid. One validator, not two that can
/// disagree.
///
/// Enforces the scheme guard, a timeout and a size cap. It runs on a background path
/// during startup, so a hanging host must not be able to hold that open. `fetch_registry`
/// above lacked all three until it was brought to the same shape; the two now differ only
/// in their size cap and in returning text rather than a struct.
pub async fn fetch_revocations(url: &str) -> Result<String, String> {
    let parsed = validate_http_url(url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client.get(parsed).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("Revocation list returned HTTP {status}"));
    }
    // Streamed for the same reason as `http_fetch`: reqwest imposes no response-size
    // limit, and reading the body whole would buffer it before any check could run.
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if buf.len() + chunk.len() > MAX_REVOCATION_BYTES {
            return Err(format!(
                "revocation list too large: exceeds {MAX_REVOCATION_BYTES} byte limit"
            ));
        }
        buf.extend_from_slice(&chunk);
    }
    String::from_utf8(buf).map_err(|e| format!("revocation list is not UTF-8: {e}"))
}

/// USER DECISION: allow only http/https; do NOT block loopback/private IPs
/// (local LLMs / dev servers are legitimate plugin fetch targets).
pub fn validate_http_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalid URL: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(format!(
            "blocked URL scheme '{other}': only http/https are allowed"
        )),
    }
}

/// Plugin network proxy — bypasses browser CORS via a Rust-side reqwest call.
/// Enforces the http/https scheme guard, a 30s timeout, and a 10 MiB response cap.
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
        Some(m) => {
            reqwest::Method::from_bytes(m.as_bytes()).map_err(|e| format!("invalid method: {e}"))?
        }
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
    let mut resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let headers = resp
        .headers()
        .iter()
        // Non-UTF8/opaque header values decode to "" (most HTTP headers are ASCII).
        .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    // Stream the body incrementally so an unbounded/hostile response can never
    // buffer past MAX_FETCH_BYTES in memory before we notice — reqwest has no
    // default response-size limit, and `resp.bytes()` would read the whole
    // body before any check ran.
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if buf.len() + chunk.len() > MAX_FETCH_BYTES {
            return Err(format!(
                "response too large: exceeds {MAX_FETCH_BYTES} byte limit"
            ));
        }
        buf.extend_from_slice(&chunk);
    }
    let body = String::from_utf8_lossy(&buf).to_string();
    Ok(PluginFetchResponse {
        body,
        headers,
        status,
    })
}

/// Read a value from a plugin's app-global storage. `None` if the key is absent.
/// App-global at `~/.baram/plugin-data/<pluginId>/<key>` (USER DECISION, §69 Phase D).
pub async fn storage_read(plugin_id: String, key: String) -> Result<Option<String>, String> {
    let path = resolve_key_path(&plugin_data_dir(&plugin_id)?, &key)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Write a value into a plugin's app-global storage, creating the plugin's
/// storage directory if it does not yet exist. Writes atomically (same
/// pattern as `fs::mod::write_file`): write to a uniquely-suffixed `.tmp`
/// sibling in the same directory, then `rename()` over the target so a
/// crash mid-write can never leave a corrupt/partial value (src-tauri/CLAUDE.md
/// "파일 쓰기 규칙").
pub async fn storage_write(plugin_id: String, key: String, value: String) -> Result<(), String> {
    let path = resolve_key_path(&plugin_data_dir(&plugin_id)?, &key)?;
    let tmp_path = PathBuf::from(format!(
        "{}.{}.tmp",
        path.display(),
        uuid::Uuid::new_v4().as_simple()
    ));
    std::fs::write(&tmp_path, value).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        e.to_string()
    })
}

/// List the storage keys (file names) recorded for a plugin. Empty if the
/// plugin has no storage directory yet.
pub async fn storage_list(plugin_id: String) -> Result<Vec<String>, String> {
    let dir = plugin_data_dir(&plugin_id)?;
    list_storage_keys(&dir)
}

/// Pure directory-listing helper behind `storage_list` — kept separate (and
/// synchronous) so it is unit-testable against an arbitrary tempdir without
/// depending on `plugin_data_dir`'s real-HOME resolution. Skips `.tmp`
/// intermediates — the atomic `storage_write` above briefly creates
/// `{key}.{uuid}.tmp` siblings, and a crash mid-write can leave one orphaned;
/// neither should surface as a storage key (same pattern as
/// `fs::mod::start_watching`'s `.tmp` skip).
fn list_storage_keys(dir: &Path) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().is_file() {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".tmp") {
                    continue;
                }
                out.push(name.to_string());
            }
        }
    }
    Ok(out)
}

/// Remove a key from a plugin's app-global storage. Ok if already absent.
pub async fn storage_remove(plugin_id: String, key: String) -> Result<(), String> {
    let path = resolve_key_path(&plugin_data_dir(&plugin_id)?, &key)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// --- Helper functions ---

fn hex_sha256(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

/// Returns the single safe path segment of `s`, or `None` if `s` is empty,
/// `~`-prefixed, absolute, contains a path separator (`/` or `\`), or is
/// `.`/`..`. This is the traversal guard for both plugin ids and storage
/// keys (§69 Phase D — USER DECISION: reject anything that does not resolve
/// to exactly one `Component::Normal`).
fn single_segment(s: &str) -> Option<&OsStr> {
    if s.is_empty() || s.starts_with('~') || s.contains('/') || s.contains('\\') {
        return None;
    }
    let mut comps = Path::new(s).components();
    match (comps.next(), comps.next()) {
        (Some(std::path::Component::Normal(seg)), None) => Some(seg),
        _ => None,
    }
}

/// `~/.baram/plugin-data/<pluginId>/` (created if missing). App-global, NOT
/// per-vault (USER DECISION, §69 Phase D) — resolved the same way as
/// [`get_plugin_dir`] (via [`dirs_next`]), just under a sibling `plugin-data` dir.
fn plugin_data_dir(plugin_id: &str) -> Result<PathBuf, String> {
    let seg = single_segment(plugin_id).ok_or_else(|| format!("invalid plugin id: {plugin_id}"))?;
    let home = dirs_next().ok_or_else(|| "could not determine home directory".to_string())?;
    let dir = home.join(".baram").join("plugin-data").join(seg);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Upper bound on a sandboxed plugin's entry bundle (§260 3c-2b). A bundled ESM is
/// normally well under 1 MiB; this exists to bound what one plugin can pull across
/// IPC per activate, not to police normal sizes. Rate limiting `plugin_call` is a
/// separate concern that applies to every op, not just this one.
const MAX_BUNDLE_BYTES: u64 = 4 * 1024 * 1024;

/// §260 Phase 3c-2b — read a plugin's entry bundle out of ITS OWN directory, for
/// the `SourceRead` broker op that lets a sandbox `blob:`-import its code without
/// any `asset:` (i.e. without a file-read capability).
///
/// `main` comes from the manifest, not from the caller, but it is still treated as
/// untrusted input: both paths are canonicalized and the file must resolve inside
/// `dir`, so a crafted manifest cannot walk out with `../` or a symlink.
pub async fn read_bundle_in(dir: &Path, main: &str) -> Result<String, String> {
    let canonical_dir =
        std::fs::canonicalize(dir).map_err(|e| format!("plugin directory is unreadable: {e}"))?;
    let candidate = canonical_dir.join(main);
    let canonical_file = std::fs::canonicalize(&candidate)
        .map_err(|e| format!("plugin entry \"{main}\" is unreadable: {e}"))?;
    if !canonical_file.starts_with(&canonical_dir) {
        return Err(format!(
            "plugin entry \"{main}\" resolves outside its own directory"
        ));
    }
    // Space-joined, not colon-joined: the helper's messages are written to read as
    // predicates ("is N bytes, over the …"), so this composes into a sentence.
    read_text_capped(&canonical_file, MAX_BUNDLE_BYTES)
        .await
        .map_err(|e| format!("plugin entry \"{main}\" {e}"))
}

/// Read a file as text, refusing an over-cap file by `metadata` FIRST.
///
/// The "never allocate to measure" rule (§260 3c-2b security review, F2, and M6
/// before it): every byte here crosses IPC into a sandbox's JS heap, so the cost of
/// refusing must not scale with the input being refused. Shared by the bundle read
/// and the brokered `files` read (Phase 3c-2c) so there is one implementation of it.
///
/// `tokio::fs`, not `std::fs` (§260 3c-2c security review, F2): both callers run
/// inside `plugin_call`, an async command on the tokio runtime, and a plugin can ask
/// for up to the cap at up to the rate limit. Blocking reads there would let one
/// plugin stall unrelated IPC — autosave, search, the editor's own file work — which
/// is a denial of service on the app rather than on the plugin.
pub async fn read_text_capped(path: &Path, cap: u64) -> Result<String, String> {
    let size = tokio::fs::metadata(path)
        .await
        // Distinct from a read failure, so a diagnosis can tell "cannot be stat'ed"
        // from "stat'ed fine but unreadable".
        .map_err(|e| format!("cannot be measured: {e}"))?
        .len();
    if size > cap {
        return Err(format!("is {size} bytes, over the {cap}-byte limit"));
    }
    tokio::fs::read_to_string(path)
        .await
        .map_err(|e| format!("could not be read: {e}"))
}

/// Resolves `key` to a path inside `dir`, rejecting any key that is not a
/// single safe path segment so the result can never escape `dir`.
fn resolve_key_path(dir: &Path, key: &str) -> Result<PathBuf, String> {
    let seg = single_segment(key).ok_or_else(|| format!("invalid storage key: {key}"))?;
    Ok(dir.join(seg))
}

/// Extract `data` into `output_dir`, bounded (#261).
///
/// ‼️ Every limit is checked against bytes THIS FUNCTION READ, never against `file.size()`
/// or `file.compressed_size()`. Those come out of the archive's own headers, so trusting
/// them to police the archive is asking the input whether it is allowed. A header may claim
/// 4 KiB and stream gigabytes; the `take` in `extract_zip_bounded` is what makes that claim
/// irrelevant.
///
/// Streams entry-by-entry into the output file rather than `read_to_end` into a `Vec`, so
/// the previous behaviour — an oversized entry exhausting memory before anything could
/// notice — is gone even for the bytes that are under the limit.
///
/// ‼️ THAT GUARANTEE DEPENDS ON WHICH `zip` APIS WE USE, so it was checked against the
/// crate source rather than assumed. In zip 8.6.0 exactly two read-path sites allocate from
/// a header-declared size — `read.rs:417` and `read/stream.rs:72`, both
/// `Vec::with_capacity(file.size() as usize)` — and neither is reachable from here: the
/// first is inside `ZipArchive::extract`, the crate's own bulk-extract convenience, and the
/// second is the streaming reader. This function drives `by_index` and its own loop, which
/// allocate nothing from declared sizes.
///
/// So: do not "simplify" this to `archive.extract(dir)`. That call reintroduces the
/// declared-size allocation AND materialises symlink entries (`make_symlink`, `read.rs:419`)
/// — see `a_symlink_entry_becomes_a_regular_file` for why the second one matters.
fn extract_zip_bytes(data: &[u8], output_dir: &Path) -> Result<(), PluginError> {
    extract_zip_bounded(data, output_dir, ExtractBounds::DEFAULT)
}

/// The limits `extract_zip_bounded` enforces.
///
/// A parameter rather than five constants read directly, so the tests can drive the same
/// code with kilobyte-sized limits. Asserting the real 256 MiB total would mean writing a
/// quarter of a gigabyte per run to prove arithmetic, and a test that slow gets skipped.
/// `ExtractBounds::DEFAULT` is what production uses, and one test still drives the real
/// constants end to end through the ratio limit, which a 2 MiB archive can reach.
#[derive(Clone, Copy)]
struct ExtractBounds {
    max_entries: usize,
    max_entry_bytes: u64,
    max_path_depth: usize,
    max_ratio: u64,
    max_total_bytes: u64,
    ratio_floor_bytes: u64,
}

impl ExtractBounds {
    const DEFAULT: Self = Self {
        max_entries: MAX_ARCHIVE_ENTRIES,
        max_entry_bytes: MAX_ENTRY_BYTES,
        max_path_depth: MAX_PATH_DEPTH,
        max_ratio: MAX_COMPRESSION_RATIO,
        max_total_bytes: MAX_TOTAL_EXPANDED_BYTES,
        ratio_floor_bytes: RATIO_FLOOR_BYTES,
    };
}

fn extract_zip_bounded(
    data: &[u8],
    output_dir: &Path,
    bounds: ExtractBounds,
) -> Result<(), PluginError> {
    let cursor = std::io::Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor)?;

    // First of OUR checks, and safe to read from the central directory: an archive claiming
    // fewer entries than it holds simply gets fewer extracted.
    //
    // ‼️ Not cheap in absolute terms, and nothing here can make it so (review M3):
    // `ZipArchive::new` above has already parsed every central-directory record into memory
    // before `archive.len()` exists, at roughly 251 resident bytes per 46-byte record — so a
    // 32 MiB download can hold ~175 MiB of parsed records before this line runs. Bounded by
    // the download cap and transient, but it is upstream of every limit below. Backlogged;
    // the only real fix is a streaming central-directory reader the `zip` crate does not
    // expose.
    if archive.len() > bounds.max_entries {
        return Err(PluginError::Refused(format!(
            "plugin archive declares {} entries, over the {} limit",
            archive.len(),
            bounds.max_entries
        )));
    }

    let compressed_len = data.len() as u64;
    let mut total_written: u64 = 0;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let Some(enclosed_name) = file.enclosed_name() else {
            continue; // skip invalid paths (path traversal protection)
        };

        // ‼️ Checked BEFORE any `create_dir_all`, because directories are the one thing the
        // byte ceilings below cannot see: parents cost no expanded bytes, so depth is free
        // to the attacker and expensive to us (review M2).
        let depth = enclosed_name.components().count();
        if depth > bounds.max_path_depth {
            return Err(PluginError::Refused(format!(
                "plugin archive entry {} is {depth} directories deep, over the {} limit",
                enclosed_name.display(),
                bounds.max_path_depth
            )));
        }
        let out_path = output_dir.join(enclosed_name);

        if file.is_dir() {
            std::fs::create_dir_all(&out_path)?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // ‼️ ALL THREE ceilings fold into the read, so none can be overshot even by one
        // entry.
        //
        // The ratio used to be checked AFTER writing, which made it a limit on what
        // survived rather than on what the archive could make us do. Measured (review M1):
        // a 64 KiB archive holding one 64 MiB entry cleared the per-file and total
        // ceilings, wrote all 64 MiB to disk, and only then hit the "100:1" refusal — 1027:1
        // of transient amplification against a documented 100:1. The comment here used to
        // say the refusal came "while unpacking rather than after"; for a single-entry
        // archive, the canonical bomb shape and the one this module's own bomb test uses,
        // it was entirely after.
        let by_entry = bounds.max_entry_bytes;
        let by_total = bounds.max_total_bytes.saturating_sub(total_written);
        // `max(floor)` is what the ratio floor means now: an archive may always produce at
        // least this much before the ratio can say anything, so a small archive of ordinary
        // compressible text is not refused over a statistic computed on too little data.
        // Same intent as the old post-hoc floor, moved to where it can actually act.
        let by_ratio = compressed_len
            .saturating_mul(bounds.max_ratio)
            .max(bounds.ratio_floor_bytes)
            .saturating_sub(total_written);
        let cap = by_entry.min(by_total).min(by_ratio);

        let mut out = std::fs::File::create(&out_path)?;
        // `cap + 1`: reading exactly `cap` is legal, so the extra byte is what distinguishes
        // "filled the budget" from "would have gone past it".
        let mut limited = (&mut file).take(cap + 1);
        let written = std::io::copy(&mut limited, &mut out)?;
        if written > cap {
            // Which ceiling bound this entry, so the message names the limit to raise.
            // Ratio first: where it ties with another it is the more useful answer, because
            // it is the one that says "this is shaped like a bomb".
            return Err(PluginError::Refused(if cap == by_ratio {
                format!(
                    "plugin archive expands more than {}:1 from its {compressed_len} bytes",
                    bounds.max_ratio
                )
            } else if cap == by_total {
                format!(
                    "plugin archive expands past the {} byte total limit",
                    bounds.max_total_bytes
                )
            } else {
                format!(
                    "plugin archive entry {} exceeds the {} byte per-file limit",
                    out_path.display(),
                    bounds.max_entry_bytes
                )
            }));
        }
        total_written += written;
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), PluginError> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

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

/// Dedup-aware add/remove for the persisted dev-folder list.
pub fn normalize_dev_list(
    existing: &[String],
    add: Option<&str>,
    remove: Option<&str>,
) -> Vec<String> {
    let mut out: Vec<String> = existing.to_vec();
    if let Some(r) = remove {
        out.retain(|p| p != r);
    }
    if let Some(a) = add {
        if !out.iter().any(|p| p == a) {
            out.push(a.to_string());
        }
    }
    out
}

/// Parse the persisted dev-folder list; corrupt/missing values degrade to empty.
pub fn parse_dev_folders(raw: Option<String>) -> Vec<String> {
    match raw {
        Some(s) => serde_json::from_str(&s).unwrap_or_default(),
        None => Vec::new(),
    }
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
    use super::*;

    /// §260 3c-2b — the bundle read backing `SourceRead`. `main` is manifest-supplied
    /// and therefore untrusted: it must not be able to name a file outside the
    /// plugin's own directory, or the op would become the file-read capability that
    /// dropping `asset:` exists to remove.
    #[tokio::test]
    async fn read_bundle_in_reads_own_entry_and_refuses_escapes() {
        let base = std::env::temp_dir().join(format!("baram-src-{}", std::process::id()));
        let plugin = base.join("plugin-a");
        std::fs::create_dir_all(plugin.join("nested")).unwrap();
        std::fs::write(
            plugin.join("index.mjs"),
            "export const activate = () => {};",
        )
        .unwrap();
        std::fs::write(plugin.join("nested").join("deep.mjs"), "// deep").unwrap();
        std::fs::write(base.join("secret.mjs"), "// another plugin's code").unwrap();

        // The declared entry, and a nested file inside the plugin, are both fine.
        assert!(read_bundle_in(&plugin, "index.mjs")
            .await
            .unwrap()
            .contains("activate"));
        assert!(read_bundle_in(&plugin, "nested/deep.mjs").await.is_ok());

        // Traversal out of the plugin dir is refused, as is a missing entry.
        let escaped = read_bundle_in(&plugin, "../secret.mjs").await;
        assert!(escaped.is_err(), "traversal must be refused: {escaped:?}");
        assert!(read_bundle_in(&plugin, "nope.mjs").await.is_err());

        std::fs::remove_dir_all(&base).ok();
    }

    /// §260 3c-2b security review (F2) — the bundle is attacker-shipped and crosses
    /// IPC into the sandbox's heap on every activate, so an oversized entry must be
    /// refused. Checked by metadata, so the refusal never allocates the file.
    #[tokio::test]
    async fn read_bundle_in_refuses_an_oversized_entry() {
        let base = std::env::temp_dir().join(format!("baram-big-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        let big = vec![b'x'; (MAX_BUNDLE_BYTES + 1) as usize];
        std::fs::write(base.join("big.mjs"), &big).unwrap();
        std::fs::write(base.join("ok.mjs"), "// small").unwrap();

        let err = read_bundle_in(&base, "big.mjs")
            .await
            .expect_err("oversized must be refused");
        assert!(err.contains("over the"), "unexpected error: {err}");
        assert!(read_bundle_in(&base, "ok.mjs").await.is_ok());

        std::fs::remove_dir_all(&base).ok();
    }

    /// §260 3c-3 — the live smoke fixture is loaded through `plugin_add_dev_folder`,
    /// which calls `read_manifest_at`, which applies the RUST validator (a separate
    /// list from the TS one: its own capability allowlist and id rules). The TS test
    /// beside the fixture cannot see those, so a fixture that passes there could still
    /// fail at "Add dev folder" — during a scarce user-run smoke.
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

    /// §260 3c-2c — the extracted helper keeps the stat-before-read rule for the
    /// brokered `files` read too, and reports the size it refused (so a plugin author
    /// can tell "too big" from "unreadable").
    #[tokio::test]
    async fn read_text_capped_refuses_over_cap_and_admits_at_cap() {
        let base = std::env::temp_dir().join(format!("baram-capped-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        let exact = base.join("exact.md");
        std::fs::write(&exact, "12345").unwrap();

        assert_eq!(read_text_capped(&exact, 5).await.unwrap(), "12345"); // == cap → admitted
        let err = read_text_capped(&exact, 4)
            .await
            .expect_err("one over the cap must be refused");
        assert!(err.contains("is 5 bytes"), "unexpected error: {err}");
        assert!(
            err.contains("over the 4-byte limit"),
            "unexpected error: {err}"
        );
        // A missing file is a distinct failure, not "too large".
        let missing = read_text_capped(&base.join("nope.md"), 5)
            .await
            .expect_err("missing must fail");
        assert!(
            missing.contains("cannot be measured"),
            "unexpected: {missing}"
        );

        std::fs::remove_dir_all(&base).ok();
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
    fn test_hex_sha256() {
        let hash = hex_sha256(b"hello");
        assert_eq!(
            hash,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn test_normalize_dev_list_add_dedups() {
        let list = vec!["/a".to_string(), "/b".to_string()];
        let out = normalize_dev_list(&list, Some("/a"), None);
        assert_eq!(out, vec!["/a".to_string(), "/b".to_string()]); // no dupe
        let out2 = normalize_dev_list(&list, Some("/c"), None);
        assert_eq!(
            out2,
            vec!["/a".to_string(), "/b".to_string(), "/c".to_string()]
        );
    }

    #[test]
    fn test_normalize_dev_list_remove() {
        let list = vec!["/a".to_string(), "/b".to_string()];
        let out = normalize_dev_list(&list, None, Some("/a"));
        assert_eq!(out, vec!["/b".to_string()]);
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

    #[test]
    fn test_parse_dev_folders_none() {
        assert_eq!(parse_dev_folders(None), Vec::<String>::new());
    }

    #[test]
    fn test_parse_dev_folders_corrupt_degrades() {
        assert_eq!(
            parse_dev_folders(Some("not json".to_string())),
            Vec::<String>::new()
        );
    }

    #[test]
    fn test_parse_dev_folders_valid() {
        assert_eq!(
            parse_dev_folders(Some(r#"["/a","/b"]"#.to_string())),
            vec!["/a".to_string(), "/b".to_string()]
        );
    }

    #[test]
    fn test_validate_http_url_allows_http_and_https() {
        assert!(validate_http_url("http://localhost:11434/api").is_ok()); // loopback NOT blocked
        assert!(validate_http_url("https://api.example.com/x").is_ok());
        assert!(validate_http_url("HTTP://example.com").is_ok()); // scheme matching is case-insensitive
    }

    #[test]
    fn test_validate_http_url_rejects_non_http_schemes() {
        assert!(validate_http_url("file:///etc/passwd").is_err());
        assert!(validate_http_url("data:text/plain,hi").is_err());
        assert!(validate_http_url("ftp://host/x").is_err());
        assert!(validate_http_url("not a url").is_err());
        assert!(validate_http_url("javascript:alert(1)").is_err());
    }

    /// §69 — the scheme guard is WIRED INTO `fetch_registry`, not merely available.
    ///
    /// Asserting `is_err()` here would prove nothing: reqwest rejects a `file:` URL on its
    /// own, so a `fetch_registry` with the guard deleted still fails this input — with a
    /// builder error, after constructing a client. The assertion is therefore on the
    /// guard's OWN words, which is what breaks when the call goes away. Nothing here
    /// touches the network: both paths refuse before any request is sent.
    /// §69 — the same guard on the path that downloads third-party CODE.
    ///
    /// Asserted on the guard's own words for the reason given below: reqwest refuses a
    /// `file:` URL by itself, so `is_err()` holds with or without the guard. Nothing here
    /// reaches the network.
    #[tokio::test]
    async fn test_install_plugin_refuses_non_http_schemes() {
        let err = install_plugin("file:///etc/passwd", None, None)
            .await
            .expect_err("a file:// download URL must be refused");
        assert!(
            err.to_string().contains("blocked URL scheme 'file'"),
            "expected the scheme guard's refusal, got: {err}"
        );
    }

    #[tokio::test]
    async fn test_fetch_registry_refuses_non_http_schemes() {
        let err = fetch_registry("file:///etc/passwd")
            .await
            .expect_err("a file:// registry URL must be refused");
        assert!(
            err.to_string().contains("blocked URL scheme 'file'"),
            "expected the scheme guard's refusal, got: {err}"
        );
    }

    /// §260 Phase 5 re-review (R5) — the id check must sit BEFORE the move, so an archive
    /// declaring another installed plugin's id cannot destroy it on the way in.
    ///
    /// Asserted on source order rather than by running an install, because the failure mode
    /// is purely positional: both the check and the `remove_dir_all` are trivially correct
    /// in isolation, and a refactor moving either past the other would leave every
    /// behavioural test green while restoring the data loss.
    ///
    /// ‼️ WINDOWED to `install_plugin`'s body, and the match COUNT is asserted (re-review,
    /// F2). Searching the whole file found *a* match rather than *the* match: there are two
    /// `remove_dir_all(&target_dir)` in this file, the second in `uninstall_plugin`, so
    /// renaming or refactoring away `install_plugin`'s destructive move silently retargeted
    /// the assertion at an unrelated function and stayed green. That is the same shape as
    /// every hollow source-scan guard this phase produced.
    #[test]
    fn expected_id_is_checked_before_the_destructive_move() {
        let src = include_str!("mod.rs");
        let start = src
            .find("pub async fn install_plugin")
            .expect("install_plugin must exist");
        // Body = up to the next top-level item, so nothing outside this function counts.
        let end = src[start + 1..]
            .find("\npub ")
            .map(|i| i + start + 1)
            .unwrap_or(src.len());
        let body = &src[start..end];

        assert_eq!(
            body.matches("remove_dir_all(&target_dir)").count(),
            1,
            "install_plugin must contain exactly one destructive move — if it moved into a \
             helper, this guard no longer sees it and must be rewritten, not deleted"
        );
        let refusal = body
            .find("was requested")
            .expect("the expected_id refusal must live inside install_plugin");
        let remove = body
            .find("remove_dir_all(&target_dir)")
            .expect("the destructive move must exist");

        assert!(
            refusal < remove,
            "the id refusal ({refusal}) must come before remove_dir_all ({remove}) — \
             otherwise the archive has already clobbered the target directory"
        );
    }

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
    fn test_resolve_key_path_write_read_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let path = resolve_key_path(tmp.path(), "data.json").unwrap();
        std::fs::write(&path, "hello").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello");
    }

    #[test]
    fn test_storage_list_filters_tmp_intermediates() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("foo"), "value").unwrap();
        // Orphaned/in-flight atomic-write intermediate — must never be listed.
        std::fs::write(tmp.path().join("foo.9c1f2b3a4e5d6789.tmp"), "partial").unwrap();

        let out = list_storage_keys(tmp.path()).unwrap();
        assert_eq!(out, vec!["foo".to_string()]);
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
    fn test_registry_index_deserializes_camelcase() {
        const JSON: &str = r#"{
            "plugins": [
                {
                    "id": "test-plugin",
                    "name": "Test Plugin",
                    "description": "A test plugin",
                    "version": "1.0.0",
                    "author": "Test Author",
                    "license": "MIT",
                    "downloadUrl": "https://x/p.zip",
                    "checksum": "abc123",
                    "capabilities": ["editor:readonly"],
                    "engines": { "baram": ">=0.2.0" }
                }
            ],
            "updatedAt": "2026-01-01"
        }"#;
        let idx: RegistryIndex = serde_json::from_str(JSON).unwrap();
        assert_eq!(idx.plugins[0].download_url, "https://x/p.zip");
        assert_eq!(idx.updated_at, Some("2026-01-01".to_string()));
    }

    #[test]
    fn manifest_parses_trust_sandboxed() {
        let json = r#"{"id":"x","name":"X","description":"d","version":"1.0.0","author":"a","license":"MIT","main":"index.mjs","engines":{"baram":"*"},"capabilities":[],"trust":"sandboxed"}"#;
        let m: PluginManifest = serde_json::from_str(json).unwrap();
        assert_eq!(m.trust, Some(PluginTrust::Sandboxed));
    }

    #[test]
    fn manifest_without_trust_is_none_for_legacy() {
        let json = r#"{"id":"x","name":"X","description":"d","version":"1.0.0","author":"a","license":"MIT","main":"index.mjs","engines":{"baram":"*"},"capabilities":[]}"#;
        let m: PluginManifest = serde_json::from_str(json).unwrap();
        assert_eq!(m.trust, None);
    }

    #[test]
    fn test_committed_registry_seed_deserializes() {
        const SEED: &str = include_str!("../../../registry/index.json");
        let idx: RegistryIndex = serde_json::from_str(SEED).unwrap();
        // §260 Phase 6 — one entry: `baram-ai-summary` was withdrawn from the index because
        // it needs a declarative `sidebar` contribution that does not exist yet, so it
        // cannot be a sandboxed plugin and must not be published as a trusted one.
        let ids: Vec<&str> = idx.plugins.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["baram-word-count"]);
        for entry in &idx.plugins {
            assert!(
                entry
                    .download_url
                    .starts_with("https://sayinel.github.io/baram-plugins/plugins/"),
                "downloadUrl should point at the live registry: {}",
                entry.download_url
            );
            // ‼️ SHAPE ONLY — 64 zeros satisfy this, deliberately, because a seed may name a
            // release whose ZIP does not exist yet (§260 Phase 6 code review, M4).
            //
            // The hazard this comment used to describe as uncatchable — the placeholder
            // becoming PERMANENT — is now caught, and it had in fact happened: word-count
            // 2.0.0 shipped on 2026-07-30 and this file still carried all zeros three days
            // later, because the release workflow writes only the registry repo's index and a
            // maintainer pastes the real checksum here by hand. `scripts/validate-index.ts`
            // WARNS on an all-zero checksum every time it runs, which is now every
            // `npm run lint` — it found this on its first run. Still a warning rather than an
            // error, so seeding an unreleased entry stays possible.
            assert_eq!(entry.checksum.len(), 64, "checksum must be sha256 hex");
            assert!(entry.checksum.chars().all(|c| c.is_ascii_hexdigit()));
            // §260 Phase 6 — an entry without a tier is one the app refuses to install
            // (Phase 5 reads it as legacy), so a seed missing it would model a dead registry.
            assert_eq!(
                entry.trust.as_deref(),
                Some("sandboxed"),
                "{} must declare its tier",
                entry.id
            );
        }
    }

    /// §260 Phase 6 — `trust` must survive the round trip through this struct.
    ///
    /// THE DEFECT THIS PINS: `fetch_registry` deserializes the live index into
    /// `RegistryEntry` and Tauri re-serializes it to the frontend. `trust` was not a field,
    /// so serde dropped it silently — every entry reached the marketplace as `trust:
    /// undefined`, i.e. legacy, i.e. Install disabled. Publishing the field in `index.json`
    /// fixed nothing on its own. Asserting deserialization alone would NOT have caught it
    /// (unknown fields are ignored, so the old struct parsed the new JSON happily); it is
    /// the re-serialize half that carries the bug.
    #[test]
    fn registry_entry_carries_trust_back_out() {
        let json = r#"{"id":"p","name":"P","description":"d","version":"1.0.0",
            "author":"a","license":"MIT","downloadUrl":"https://example.test/p.zip",
            "checksum":"ab","capabilities":["events"],"trust":"sandboxed",
            "engines":{"baram":">=0.4.0"}}"#;
        let entry: RegistryEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.trust.as_deref(), Some("sandboxed"));

        let back = serde_json::to_value(&entry).unwrap();
        assert_eq!(back["trust"], "sandboxed", "the frontend must see the tier");

        // A legacy entry stays legacy rather than acquiring a default tier: the key is
        // absent, not `null`, so `!entry.trust` in the frontend is the whole test.
        let legacy: RegistryEntry =
            serde_json::from_str(&json.replace(r#""trust":"sandboxed","#, "")).unwrap();
        assert_eq!(legacy.trust, None);
        assert!(
            serde_json::to_value(&legacy)
                .unwrap()
                .get("trust")
                .is_none(),
            "an absent tier must not be serialized as null"
        );
    }

    /// A `RegistryEntry` template with every field this struct requires.
    ///
    /// Built as a `Value` so a test can REMOVE a field, which is the mutation that matters
    /// here — a literal with one field edited proves nothing about the missing-field path.
    fn entry_json(id: &str) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "name": "P",
            "description": "d",
            "version": "1.0.0",
            "author": "a",
            "license": "MIT",
            "downloadUrl": "https://example.test/p.zip",
            "checksum": "ab",
            "capabilities": ["events"],
            "trust": "sandboxed",
            "engines": { "baram": ">=0.4.0" }
        })
    }

    /// THE DEFECT THIS PINS: one unreadable entry emptied the marketplace for everyone.
    ///
    /// `plugins` was a plain `Vec<RegistryEntry>`, so serde failed the WHOLE document on the
    /// first entry missing a required field — `fetch_registry` returned `Err`, and every
    /// user's Browse tab went blank until the registry operator noticed. The index is shared,
    /// so the cost of one contributor's typo was borne by all of them.
    #[test]
    fn registry_index_drops_only_the_unreadable_entry() {
        let mut broken = entry_json("broken");
        broken.as_object_mut().unwrap().remove("license");
        let doc = serde_json::json!({
            "plugins": [entry_json("first"), broken, entry_json("last")],
        });

        let idx: RegistryIndex = serde_json::from_value(doc).unwrap();

        // By ID, not by count. A comparator that dropped everything, or kept the broken entry
        // and dropped a good one, would satisfy `len() == 2`.
        let ids: Vec<&str> = idx.plugins.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["first", "last"]);
    }

    /// An absent `engines` costs the entry nothing, because it costs the app nothing.
    ///
    /// The frontend's floor gate reads a missing or unparseable range as "no opinion" and
    /// installs (`src/plugins/engines.ts`), so refusing to deserialize the entry would have
    /// been the one layer with a stronger view than the layer that decides. Absence must also
    /// survive re-serialization as ABSENCE — same argument as `trust` above: the frontend
    /// tests `engines?.baram`, and a `null` would reach it as a present-but-broken field.
    #[test]
    fn registry_entry_without_engines_keeps_the_entry() {
        let mut json = entry_json("no-floor");
        json.as_object_mut().unwrap().remove("engines");

        // Deliberately NOT `assert!(entry.engines.is_none())`. That reads on the field's
        // type, so reverting the field to a required `EngineRequirement` breaks this test at
        // COMPILE time — and a module that will not compile cannot demonstrate what its
        // assertions catch. Without that line the mutation runs, and what it produces is the
        // failure worth pinning: `from_value` returns Err, so at index level `tolerant_entries`
        // PRUNES the entry instead of raising anything. Absence is proved by the serialized
        // form below, which is the half the frontend actually reads.
        let entry: RegistryEntry = serde_json::from_value(json).unwrap();
        assert!(
            serde_json::to_value(&entry)
                .unwrap()
                .get("engines")
                .is_none(),
            "an absent floor must not be serialized as null"
        );

        // And the floor still round-trips when it IS declared — the tolerance must not have
        // been bought by dropping the field on the way back out (the `trust` defect, again).
        let declared: RegistryEntry = serde_json::from_value(entry_json("has-floor")).unwrap();
        assert_eq!(
            serde_json::to_value(&declared).unwrap()["engines"]["baram"],
            ">=0.4.0"
        );
    }

    /// The two changes MEET here, and the meeting point is where the silent loss would be.
    ///
    /// Per-entry tolerance is what makes a required `engines` dangerous rather than loud: if
    /// the field goes back to mandatory, nothing errors and nothing fails to compile — the
    /// entry is simply pruned on the way in, and a perfectly installable plugin disappears
    /// from every user's marketplace with a line in a log nobody reads. Asserted at INDEX
    /// level for exactly that reason; the entry-level test cannot see a pruning decision.
    #[test]
    fn registry_index_keeps_an_entry_that_declares_no_floor() {
        let mut no_floor = entry_json("no-floor");
        no_floor.as_object_mut().unwrap().remove("engines");
        let doc = serde_json::json!({ "plugins": [entry_json("has-floor"), no_floor] });

        let idx: RegistryIndex = serde_json::from_value(doc).unwrap();

        let ids: Vec<&str> = idx.plugins.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["has-floor", "no-floor"],
            "an entry that declares no floor is still installable, so it must still be listed"
        );
    }

    /// Keeps `scripts/validate-index.ts` honest about what this struct actually requires.
    ///
    /// That script's `REQUIRED_FIELDS` is a hand-copy of the fields below that carry no
    /// `#[serde(default)]`, and it is the list the publish gate refuses on. The dangerous
    /// drift is this struct growing a required field the script does not know about: the
    /// gate would pass an entry that `tolerant_entries` then silently prunes, which is
    /// precisely the invisible-plugin failure both were written to prevent. This entry holds
    /// EXACTLY the script's list, so that addition fails here.
    ///
    /// The reverse drift is deliberately not caught — a script asking for more than the
    /// struct needs costs a publish, not a user.
    #[test]
    fn registry_entry_minimal_required_fields_deserializes() {
        let minimal = serde_json::json!({
            "id": "m",
            "name": "M",
            "description": "d",
            "version": "1.0.0",
            "author": "a",
            "license": "MIT",
            "downloadUrl": "https://example.test/m.zip",
            "checksum": "ab",
            "capabilities": []
        });
        let entry = serde_json::from_value::<RegistryEntry>(minimal);
        assert!(
            entry.is_ok(),
            "a field became required without being added to REQUIRED_FIELDS in \
             scripts/validate-index.ts — entries missing it would be pruned, not reported: {:?}",
            entry.err()
        );
    }

    /// THE DEFECT THIS PINS (code review HIGH-1): tolerance that swallows TOTAL loss.
    ///
    /// Dropping bad entries makes "the whole document is unreadable" indistinguishable from
    /// "the registry is empty" — and the empty answer is the more dangerous one, because
    /// `fetchRegistryIndex` caches a successful result for 24 hours and only falls back to
    /// the stale cache on a throw. A schema mismatch would therefore replace every user's
    /// working listing with a silent empty Browse tab, for a day, with no error anywhere.
    #[test]
    fn registry_index_errors_when_no_entry_survives() {
        let doc = serde_json::json!({ "plugins": [{ "id": "a" }, { "id": "b" }] });
        let err = serde_json::from_value::<RegistryIndex>(doc).unwrap_err();
        // Names the count, so the message distinguishes this from a genuinely empty registry.
        assert!(
            err.to_string().contains("every one of the 2 entries"),
            "unexpected message: {err}"
        );

        // An index that is genuinely empty is NOT an error — nothing was lost.
        let empty: RegistryIndex =
            serde_json::from_value(serde_json::json!({ "plugins": [] })).unwrap();
        assert!(empty.plugins.is_empty());
        assert_eq!(empty.dropped_count, 0);
    }

    /// Partial loss is survivable but must not be silent. `log::warn!` cannot carry it —
    /// this crate installs no `log` implementation — so the count goes over the wire.
    #[test]
    fn registry_index_reports_how_many_entries_it_dropped() {
        let mut broken = entry_json("broken");
        broken.as_object_mut().unwrap().remove("license");
        let doc = serde_json::json!({ "plugins": [entry_json("kept"), broken] });

        let idx: RegistryIndex = serde_json::from_value(doc).unwrap();

        assert_eq!(idx.dropped_count, 1);
        let ids: Vec<&str> = idx.plugins.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["kept"]);
        assert_eq!(
            serde_json::to_value(&idx).unwrap()["droppedCount"],
            1,
            "the frontend is the only layer that can report this"
        );
    }

    /// `droppedCount` is a diagnostic this app produces, so the registry must not be able to
    /// assert one — the same rule `normalizeIndex` enforces for `demotedBecause`.
    #[test]
    fn registry_index_ignores_a_registry_supplied_dropped_count() {
        let doc = serde_json::json!({
            "plugins": [entry_json("fine")],
            "droppedCount": 99
        });
        let idx: RegistryIndex = serde_json::from_value(doc).unwrap();
        assert_eq!(idx.dropped_count, 0);
    }

    /// Backs the claim `scripts/validate-index.ts` makes in its own error text.
    ///
    /// That script tells the operator a wrong-typed field means the app "DROPS an entry it
    /// cannot deserialize". Worth pinning, because the intuition for the `#[serde(default)]`
    /// fields runs the other way — `default` looks like it should absorb anything. It does
    /// not: it applies only when the key is ABSENT. A key that is present with the wrong type
    /// is a hard deserialization error, so an optional field is every bit as fatal as a
    /// required one once someone actually writes it.
    #[test]
    fn a_wrong_typed_field_drops_the_entry_even_when_optional() {
        for (field, bad) in [
            ("license", serde_json::Value::Null),
            ("version", serde_json::json!(123)),
            ("name", serde_json::json!(["N"])),
            ("capabilities", serde_json::json!([1, 2])),
            // …and the `#[serde(default)]` ones, which is the counter-intuitive half.
            ("downloads", serde_json::json!("many")),
            ("keywords", serde_json::json!("word")),
            ("repository", serde_json::json!(5)),
            ("icon", serde_json::json!(true)),
            // ‼️ `downloads` is `u64`, and JS has ONE numeric type — so "is it a number?"
            // is not the same question on the two sides. Review round 3 found these three
            // still passing the publish gate after the presence-vs-type fix. It is also the
            // likeliest field to hold a computed value rather than a typed one: a rate
            // arrives as a float, "unknown" arrives as -1.
            ("downloads", serde_json::json!(1.5)),
            ("downloads", serde_json::json!(-1)),
            ("downloads", serde_json::json!(1e20)),
        ] {
            let mut json = entry_json("x");
            json.as_object_mut().unwrap().insert(field.into(), bad);
            assert!(
                serde_json::from_value::<RegistryEntry>(json).is_err(),
                "a wrong-typed `{field}` must fail to deserialize — validate-index.ts tells \
                 operators it does"
            );
        }

        // The contrast that makes the point: OMITTING the same optional fields is fine.
        let mut json = entry_json("x");
        for field in ["downloads", "keywords", "repository", "icon"] {
            json.as_object_mut().unwrap().remove(field);
        }
        assert!(serde_json::from_value::<RegistryEntry>(json).is_ok());
    }

    /// Tolerance is per-ENTRY, not per-document. A payload with no `plugins` array is not a
    /// partly-broken index, and answering it with an empty marketplace would hide a registry
    /// that is serving the wrong file entirely.
    #[test]
    fn registry_index_without_plugins_array_is_an_error() {
        let err = serde_json::from_str::<RegistryIndex>(r#"{"updatedAt":"2026-01-01"}"#);
        assert!(err.is_err());
    }

    // ── #261 archive expansion bounds ────────────────────────────────────────────────
    //
    // The download cap (32 MiB) never bounded the extraction. DEFLATE tops out around
    // 1032:1, so that archive could expand to roughly 33 GB, and `read_to_end` into an
    // unbounded `Vec` meant memory went before disk did.

    /// A deflated archive of `entries`, built in memory.
    fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        let mut buf = std::io::Cursor::new(Vec::<u8>::new());
        {
            let mut writer = zip::write::ZipWriter::new(&mut buf);
            let opts = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            for (name, body) in entries {
                writer.start_file(*name, opts).unwrap();
                writer.write_all(body).unwrap();
            }
            writer.finish().unwrap();
        }
        buf.into_inner()
    }

    /// Kilobyte-scale limits, so the arithmetic can be tested without writing a quarter of
    /// a gigabyte. `refuses_a_real_bomb_through_the_production_bounds` covers the shipped
    /// constants; these cover the branches.
    ///
    /// ‼️ The ratio has to be small (3:1) for a different reason than the others: at these
    /// sizes the ZIP container's own headers are a large fraction of the archive, so a
    /// realistic 10:1 is unreachable inside a 8 KiB total budget no matter how compressible
    /// the payload. The first draft of these tests set 10 and two of them silently could not
    /// trip the limit they were named after.
    fn tiny_bounds() -> ExtractBounds {
        ExtractBounds {
            max_entries: 4,
            max_entry_bytes: 4096,
            max_path_depth: 3,
            max_ratio: 3,
            max_total_bytes: 8192,
            ratio_floor_bytes: 2000,
        }
    }

    /// Bytes deflate cannot shrink, so the ratio limit stays out of the way.
    ///
    /// The total- and per-file-limit tests need this: zeros compress so well that the RATIO
    /// refusal fires first and the test passes while proving the wrong thing.
    fn incompressible(n: usize) -> Vec<u8> {
        let mut x: u32 = 0x1234_5678;
        (0..n)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                (x & 0xff) as u8
            })
            .collect()
    }

    #[test]
    fn extracts_a_normal_archive_unchanged() {
        // The control. Every refusal below is only meaningful if the ordinary case still
        // works, byte for byte.
        let data = zip_of(&[
            ("baram-plugin.json", b"{}"),
            ("dist/index.mjs", b"export {}"),
        ]);
        let dir = tempfile::tempdir().unwrap();
        extract_zip_bounded(&data, dir.path(), tiny_bounds()).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.path().join("dist/index.mjs")).unwrap(),
            "export {}"
        );
    }

    #[test]
    fn refuses_more_entries_than_the_limit() {
        let names: Vec<String> = (0..5).map(|i| format!("f{i}.txt")).collect();
        let entries: Vec<(&str, &[u8])> =
            names.iter().map(|n| (n.as_str(), b"x" as &[u8])).collect();
        let dir = tempfile::tempdir().unwrap();

        let err = extract_zip_bounded(&zip_of(&entries), dir.path(), tiny_bounds()).unwrap_err();

        // Names the limit, not just "refused" — five different bounds live in this function
        // and "it errored" would not tell them apart.
        assert!(err.to_string().contains("over the 4 limit"), "{err}");
    }

    #[test]
    fn refuses_an_entry_over_the_per_file_limit() {
        let dir = tempfile::tempdir().unwrap();
        let data = zip_of(&[("big.bin", &incompressible(5000))]);

        let err = extract_zip_bounded(&data, dir.path(), tiny_bounds()).unwrap_err();

        assert!(err.to_string().contains("per-file limit"), "{err}");
    }

    #[test]
    fn refuses_an_archive_over_the_total_limit() {
        // Each entry is under the 4096 per-file limit; together they pass 8192. The
        // distinction matters because the message tells the operator which limit to raise.
        let body = incompressible(3000);
        let dir = tempfile::tempdir().unwrap();
        let data = zip_of(&[("a", &body), ("b", &body), ("c", &body)]);

        let err = extract_zip_bounded(&data, dir.path(), tiny_bounds()).unwrap_err();

        assert!(err.to_string().contains("total limit"), "{err}");
        assert!(
            !err.to_string().contains("per-file"),
            "the total is what bound this, and the message must say so: {err}"
        );
    }

    #[test]
    fn does_not_apply_the_ratio_below_its_floor() {
        // Compressible enough to blow past 3:1, but under the 2000-byte floor — where the
        // ratio is a statistic computed on too little output to mean anything. Refusing here
        // would reject ordinary small archives of text.
        let dir = tempfile::tempdir().unwrap();
        let expanded = 1500;
        let data = zip_of(&[("small.txt", &vec![0u8; expanded])]);
        let bounds = tiny_bounds();
        assert!(
            expanded as u64 > data.len() as u64 * bounds.max_ratio,
            "the fixture must exceed the ratio, or the floor is not what let it through: \
             {expanded} expanded from {} on the wire",
            data.len()
        );
        assert!((expanded as u64) < bounds.ratio_floor_bytes);

        extract_zip_bounded(&data, dir.path(), bounds).unwrap();
    }

    #[test]
    fn refuses_a_high_ratio_archive_once_past_the_floor() {
        let dir = tempfile::tempdir().unwrap();
        // Two entries of zeros: together they clear the 2000-byte floor and pass 3:1, while
        // each stays under the per-file limit and the pair stays under the total.
        let data = zip_of(&[("a.bin", &vec![0u8; 1500]), ("b.bin", &vec![0u8; 1500])]);

        let err = extract_zip_bounded(&data, dir.path(), tiny_bounds()).unwrap_err();

        assert!(err.to_string().contains("expands more than 3:1"), "{err}");
    }

    /// Total bytes sitting under `dir` after a refusal.
    fn bytes_on_disk(dir: &Path) -> u64 {
        fn walk(dir: &Path, total: &mut u64) {
            let Ok(entries) = std::fs::read_dir(dir) else {
                return;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(&path, total);
                } else if let Ok(meta) = entry.metadata() {
                    *total += meta.len();
                }
            }
        }
        let mut total = 0;
        walk(dir, &mut total);
        total
    }

    /// THE DEFECT THIS PINS (review M1): the ratio limit bounded what SURVIVED, not what the
    /// archive could make us write.
    ///
    /// Measured before the fix: a 64 KiB archive holding one 64 MiB entry cleared the
    /// per-file and total ceilings, put all 64 MiB on disk, and only then hit the "100:1"
    /// refusal — 1027:1 of transient amplification against a documented 100:1. Asserting the
    /// message alone could not see it; the refusal fired either way. This asserts the BYTES.
    #[test]
    fn a_bomb_is_refused_before_it_can_fill_the_disk() {
        let dir = tempfile::tempdir().unwrap();
        let data = zip_of(&[("bomb.bin", &vec![0u8; 64 * 1024 * 1024])]);
        let wire = data.len() as u64;

        let err = extract_zip_bytes(&data, dir.path()).unwrap_err();
        assert!(err.to_string().contains("expands more than 100:1"), "{err}");

        // The allowance is `max(wire × 100, 1 MiB)`, and one byte over it is what triggers
        // the refusal — so anything materially past that means the cap is not in the read.
        let written = bytes_on_disk(dir.path());
        let allowance = (wire * MAX_COMPRESSION_RATIO).max(RATIO_FLOOR_BYTES);
        assert!(
            written <= allowance + 1,
            "{written} bytes reached disk from a {wire} byte archive; the {MAX_COMPRESSION_RATIO}:1 \
             ratio allows {allowance}"
        );
    }

    /// The shipped constants, end to end — the others drive injected limits.
    ///
    /// Reachable cheaply only through the ratio: 2 MiB of zeros deflates to a couple of
    /// kilobytes, which clears the 1 MiB floor at roughly 1000:1 while staying far under
    /// the 64 MiB per-file and 256 MiB total ceilings. Those two are covered above with
    /// injected bounds precisely so this test does not have to write 256 MiB.
    #[test]
    fn refuses_a_real_bomb_through_the_production_bounds() {
        let dir = tempfile::tempdir().unwrap();
        let data = zip_of(&[("bomb.bin", &vec![0u8; 2 * 1024 * 1024])]);
        assert!(
            data.len() < 64 * 1024,
            "the fixture must actually be a bomb: {} bytes on the wire",
            data.len()
        );

        let err = extract_zip_bytes(&data, dir.path()).unwrap_err();

        assert!(err.to_string().contains("expands more than 100:1"), "{err}");
    }

    // ── At the boundary ──────────────────────────────────────────────────────────────
    //
    // ‼️ Every fixture above sits comfortably on one side of its limit, so `>` → `>=` on any
    // of these comparisons is invisible: a mutation that spuriously refuses an entry of
    // EXACTLY the ceiling passes the whole suite. Ten mutations were run on the first draft
    // and every one was a removal — the same blind spot as [[mutation-removal-vs-substitution]],
    // recurring in the phase that recorded it. These three fixtures land on the value.

    #[test]
    fn admits_an_entry_of_exactly_the_per_file_limit() {
        let bounds = tiny_bounds();
        let dir = tempfile::tempdir().unwrap();
        let data = zip_of(&[(
            "exact.bin",
            &incompressible(bounds.max_entry_bytes as usize),
        )]);

        extract_zip_bounded(&data, dir.path(), bounds).expect("exactly the limit is legal");
    }

    #[test]
    fn admits_an_archive_of_exactly_the_total_limit() {
        let bounds = tiny_bounds();
        let half = (bounds.max_total_bytes / 2) as usize;
        let dir = tempfile::tempdir().unwrap();
        let data = zip_of(&[("a", &incompressible(half)), ("b", &incompressible(half))]);

        extract_zip_bounded(&data, dir.path(), bounds).expect("exactly the limit is legal");
    }

    #[test]
    fn admits_exactly_the_entry_count_limit() {
        let bounds = tiny_bounds();
        let names: Vec<String> = (0..bounds.max_entries).map(|i| format!("f{i}")).collect();
        let entries: Vec<(&str, &[u8])> =
            names.iter().map(|n| (n.as_str(), b"x" as &[u8])).collect();
        let dir = tempfile::tempdir().unwrap();

        extract_zip_bounded(&zip_of(&entries), dir.path(), bounds)
            .expect("exactly the limit is legal");
    }

    /// ‼️ A symlink entry must not become a symlink.
    ///
    /// ZIP can carry them, and the `zip` crate's own `ZipArchive::extract` materialises them
    /// (`make_symlink`, zip-8.6.0 `read.rs:419`). This loop never consults `is_symlink()`, so
    /// such an entry takes the ordinary file path and its CONTENT — the target string — is
    /// written as text. Nothing links anywhere, so `copy_dir_recursive` afterwards has
    /// nothing to follow out of the temp directory and into the user's filesystem.
    ///
    /// That safety is currently a consequence of what this loop does NOT do, which is
    /// exactly the kind of property a refactor toward the crate's `extract()` would delete
    /// silently. `enclosed_name` would not save us there: it constrains the entry's own path,
    /// not where a link it creates may point.
    #[test]
    fn a_symlink_entry_becomes_a_regular_file() {
        let mut buf = std::io::Cursor::new(Vec::<u8>::new());
        {
            let mut writer = zip::write::ZipWriter::new(&mut buf);
            writer
                .add_symlink(
                    "escape",
                    "../../../../etc/passwd",
                    zip::write::SimpleFileOptions::default(),
                )
                .unwrap();
            writer.finish().unwrap();
        }
        let dir = tempfile::tempdir().unwrap();

        extract_zip_bounded(&buf.into_inner(), dir.path(), tiny_bounds()).unwrap();

        let made = dir.path().join("escape");
        // `symlink_metadata` does not follow, so this sees what was actually created.
        let kind = std::fs::symlink_metadata(&made).unwrap().file_type();
        assert!(
            !kind.is_symlink(),
            "a symlink entry was materialised as a link; copy_dir_recursive would follow it"
        );
        assert_eq!(
            std::fs::read_to_string(&made).unwrap(),
            "../../../../etc/passwd",
            "the target should have landed as inert text"
        );
    }

    #[test]
    fn refuses_a_path_deeper_than_the_limit() {
        // Directories are free to the byte ceilings — an entry's parents contribute no
        // expanded bytes — so depth is the one dimension they cannot bound (review M2).
        let dir = tempfile::tempdir().unwrap();
        let deep = "a/b/c/d/e/f.txt";
        let data = zip_of(&[(deep, b"x")]);

        let err = extract_zip_bounded(&data, dir.path(), tiny_bounds()).unwrap_err();

        assert!(err.to_string().contains("directories deep"), "{err}");
        assert!(
            !dir.path().join("a").exists(),
            "the depth check must run BEFORE create_dir_all, or it charges nothing"
        );
    }

    #[test]
    fn admits_a_path_at_the_depth_limit() {
        // `dist/chunks/x.mjs` is depth 3 and must keep working; the production limit is 16.
        let dir = tempfile::tempdir().unwrap();
        let data = zip_of(&[("a/b/c.txt", b"x")]);

        extract_zip_bounded(&data, dir.path(), tiny_bounds()).unwrap();

        assert_eq!(
            std::fs::read_to_string(dir.path().join("a/b/c.txt")).unwrap(),
            "x"
        );
    }

    // ── Network caps, over a real socket ─────────────────────────────────────────────
    //
    // Four streaming caps and three timeouts shipped with no test of any kind, because the
    // scheme guard refuses before a request is made and everything past it needs a real
    // response. One loopback server covers THREE of the four caps — `MAX_FETCH_BYTES` is on
    // the plugin `http_fetch` path, reached through `ExtensionContext` rather than a bare
    // function, so it needs its own wiring. The SIX timeouts in this module remain untested
    // and are recorded in the backlog: the shortest is 30s, and a suite nobody will wait for
    // is worse than an honest gap.

    /// A one-shot HTTP server on loopback that will send more than it should.
    ///
    /// Hand-rolled on `std::net::TcpListener` rather than pulling in a test HTTP crate:
    /// what these caps need is a server that OVERSHOOTS, which well-behaved libraries make
    /// awkward, and a dev-dependency would have to earn its place in the `deny` job for a
    /// handful of assertions.
    fn serve_once(status: &str, body: Vec<u8>) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let header = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            use std::io::{Read, Write};
            // Drain the request line and headers first; writing a response to a peer that is
            // still sending can deadlock on a full socket buffer.
            let mut scratch = [0u8; 2048];
            let _ = stream.read(&mut scratch);
            // Errors ignored throughout: the client ABORTING mid-body is the pass condition
            // for the cap tests, and it reaches this thread as EPIPE.
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.write_all(&body);
            let _ = stream.flush();
        });
        format!("http://{addr}/doc.json")
    }

    #[tokio::test]
    async fn fetch_registry_refuses_a_body_over_its_cap() {
        let url = serve_once("200 OK", vec![b' '; MAX_REGISTRY_BYTES + 1]);
        let err = fetch_registry(&url).await.expect_err("over the cap");
        assert!(
            err.to_string().contains("registry index too large"),
            "{err}"
        );
    }

    #[tokio::test]
    async fn fetch_registry_admits_a_body_at_the_cap() {
        // The other side of the boundary. Without this the cap could be off by a whole
        // document and every "refuses" test above would still pass.
        let mut body = vec![b' '; MAX_REGISTRY_BYTES];
        body[..14].copy_from_slice(br#"{"plugins":[]}"#);
        let url = serve_once("200 OK", body);
        let index = fetch_registry(&url)
            .await
            .expect("exactly at the cap is legal");
        assert!(index.plugins.is_empty());
    }

    #[tokio::test]
    async fn fetch_registry_refuses_a_non_success_status() {
        let url = serve_once("404 Not Found", b"nope".to_vec());
        let err = fetch_registry(&url).await.expect_err("404 is not an index");
        // `Refused`, not `InvalidManifest` — a 404 must not be reported as a broken document,
        // because no document was received.
        assert!(
            err.to_string().contains("registry returned HTTP 404"),
            "{err}"
        );
    }

    #[tokio::test]
    async fn fetch_revocations_refuses_a_body_over_its_cap() {
        let url = serve_once("200 OK", vec![b' '; MAX_REVOCATION_BYTES + 1]);
        let err = fetch_revocations(&url).await.expect_err("over the cap");
        assert!(err.contains("revocation list too large"), "{err}");
    }

    #[tokio::test]
    async fn install_plugin_refuses_an_archive_over_its_cap() {
        // 32 MiB over loopback, which is the whole point: this cap is reached before the
        // checksum, the manifest or the tier can say anything, so nothing downstream would
        // ever catch an unbounded download.
        let url = serve_once("200 OK", vec![0u8; MAX_PLUGIN_ARCHIVE_BYTES + 1]);
        let err = install_plugin(&url, None, None)
            .await
            .expect_err("over the cap");
        assert!(
            err.to_string().contains("plugin archive too large"),
            "{err}"
        );
    }

    #[tokio::test]
    async fn install_plugin_refuses_a_non_success_status() {
        let url = serve_once("503 Service Unavailable", b"down".to_vec());
        let err = install_plugin(&url, None, None)
            .await
            .expect_err("503 is not an archive");
        assert!(
            err.to_string()
                .contains("plugin download returned HTTP 503"),
            "{err}"
        );
    }

    /// ‼️ The bounds must never be computed from what the archive says about itself.
    ///
    /// `file.size()` and `file.compressed_size()` are read out of the archive's own headers,
    /// so a check against them asks the attacker whether the attack is allowed: a header can
    /// claim 4 KiB and the stream can deliver gigabytes. The code reads through `take`
    /// instead, and this asserts it stays that way — the plausible regression is someone
    /// adding a "fast path" that skips an entry whose declared size looks small.
    ///
    /// Windowed to the function body and asserting ABSENCE, so it cannot pass by matching
    /// something elsewhere in the file.
    #[test]
    fn extraction_never_consults_the_declared_size() {
        const SOURCE: &str = include_str!("mod.rs");
        let start = SOURCE
            .find("fn extract_zip_bounded(")
            .expect("the function must still exist under this name");
        let body = &SOURCE[start..];
        let end = body.find("\n}\n").expect("the function must end");
        let body = &body[..end];

        // ‼️ A positive anchor FIRST. The window ends at the next column-0 `}`, so a future
        // edit that shortens the function — or a rename — leaves an absence assertion that
        // passes over nothing at all (review L4). This line fails loudly instead.
        assert!(
            body.contains("take(cap + 1)"),
            "the window no longer contains the bounded read, so the absence checks below \
             would be vacuous"
        );
        for header_field in [".size()", ".compressed_size()"] {
            assert!(
                !body.contains(header_field),
                "extract_zip_bounded reads `{header_field}` from the archive header — the \
                 bounds must be enforced on bytes actually read"
            );
        }
    }

    /// M5 — something has to execute the `spawn_blocking` closure.
    ///
    /// Both install tests above refuse during the DOWNLOAD, so nothing reached the relocated
    /// steps 3–6 at all: not the extraction, not the manifest checks, not the `JoinError`
    /// mapping. This serves a real, well-formed ZIP that simply has no `baram-plugin.json`,
    /// which gets past the download and the checksum and stops inside the closure — before
    /// anything writes to the user's real plugin directory, which a fully successful install
    /// would do.
    #[tokio::test]
    async fn install_plugin_reaches_the_blocking_stage_and_reports_from_inside_it() {
        let archive = zip_of(&[("not-a-manifest.txt", b"hello")]);
        let url = serve_once("200 OK", archive);

        let err = install_plugin(&url, None, None)
            .await
            .expect_err("an archive with no manifest cannot install");

        assert!(
            err.to_string().contains("baram-plugin.json not found"),
            "expected the refusal raised inside the blocking closure, got: {err}"
        );
    }
}
