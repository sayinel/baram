// §69 Plugin Marketplace / #261 — staged install lifecycle.
//
// `stage_plugin` downloads, verifies and extracts a plugin to a staging directory without
// touching anything installed; `commit_staged_plugin` is the only destructive step, an atomic
// swap; `discard_staged_plugin` and `uninstall_plugin` are the two ways to undo. See
// `swap_into_place` for why the previously installed version survives every failure, and
// `STALE_STAGE_AFTER` / `recover_orphaned_backups` for the two kinds of interrupted install
// this module cleans up after.
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

use super::archive::extract_zip_bytes;
use super::limits::MAX_PLUGIN_ARCHIVE_BYTES;
use super::origin::{
    error_chain, is_within_registry, redirect_within_registry, registry_base, shown,
    validate_http_url,
};
use super::registry::{InstalledPluginInfo, PluginManifest};
use super::storage::{get_plugin_dir, hex_sha256, single_segment};
use super::{validate_manifest, PluginError};

/// Where an in-flight install lives until something commits it: `~/.baram/plugins/.staging/`.
///
/// Inside the plugin directory rather than the OS temp directory, and that is the whole
/// mechanism (#261): `std::fs::rename` is atomic only WITHIN a filesystem, and on Linux
/// `/tmp` is routinely a tmpfs while `~` is not, so a staged tree in `tempfile::tempdir()`
/// could only ever be COPIED into place — which is the destructive-first install this
/// replaces. Same directory, therefore same filesystem, therefore a real swap.
///
/// The leading dot cannot collide with a plugin id: `validate_manifest` admits only
/// `[a-z0-9-]`, so no manifest can name this directory. And `list_installed` skips it for
/// free, because it only reports children holding a `baram-plugin.json` at their root.
const STAGING_DIR: &str = ".staging";

/// Names of directories under [`STAGING_DIR`] that hold a downloaded-but-uncommitted tree.
const STAGE_PREFIX: &str = "stage-";

/// Names of directories under [`STAGING_DIR`] that hold a DISPLACED INSTALLED VERSION.
///
/// `backup-<pid>-<counter>-<plugin id>`. The id is last and the two numeric fields are
/// fixed, so `splitn(4, '-')` recovers an id that itself contains hyphens.
const BACKUP_PREFIX: &str = "backup-";

/// How long an abandoned STAGE is left alone before a later install reclaims it.
///
/// Only a hard kill between staging and committing can leave one behind — every in-process
/// failure path removes its own. A day is far longer than any real gap between staging and
/// committing (a few synchronous checks and an `unloadPlugin`; consent is collected BEFORE
/// the download), so the sweep cannot plausibly delete a stage someone still intends to
/// commit. If it ever did, the commit fails closed with "no such staged install" and
/// nothing installed is touched.
///
/// ‼️ THIS DOES NOT APPLY TO BACKUPS, and applying it to them was a data-loss bug (#261
/// security review). `std::fs::rename` PRESERVES mtime, so a backup inherits the mtime of
/// the plugin directory it came from — for any plugin installed more than a day ago the
/// backup is stale the instant it is created. A hard kill between the two renames would
/// then leave the user's only copy in the staging area, and the next install would sweep
/// it away permanently. Backups are reclaimed by [`recover_orphaned_backups`] instead,
/// which decides by whether the plugin is present rather than by age.
const STALE_STAGE_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

/// A downloaded, extracted, validated plugin that is NOT yet installed.
///
/// The point of naming this state (#261) is that everything expensive and everything
/// attacker-controlled happens before anything installed is touched. The caller inspects
/// the manifest, asks the user, checks it against what was consented to — and only then
/// commits. A refusal at any of those points costs a `discard_staged_plugin`, never a
/// working plugin.
#[derive(Debug, Clone, Serialize)]
pub struct StagedPluginInfo {
    /// Opaque handle for [`commit_staged_plugin`] / [`discard_staged_plugin`]. A directory
    /// name under [`STAGING_DIR`], never a path — the caller cannot name anything else.
    pub stage_id: String,
    pub checksum: String,
    pub manifest: PluginManifest,
    /// SHA-256 of the staged `baram-plugin.json`, to be handed back to
    /// [`commit_staged_plugin`]. See [`read_staged_manifest`] for why.
    pub manifest_sha256: String,
}

/// What a committed install turned out to be, read back AFTER the swap.
#[derive(Debug, Clone, Serialize)]
pub struct CommittedPluginInfo {
    pub install_path: String,
    pub manifest: PluginManifest,
}

/// `<plugin_root>/.staging/` — the path only, no side effects.
///
/// Exposed so `plugin_prepare_scopes` can carve this directory back out of the recursive
/// asset grant over the plugin root without hardcoding the name a second time.
pub fn staging_dir_of(plugin_root: &Path) -> PathBuf {
    plugin_root.join(STAGING_DIR)
}

/// `<plugin_root>/.staging/`, created if absent.
///
/// Takes the plugin root rather than calling [`get_plugin_dir`] so the whole staging
/// lifecycle is unit-testable against a temporary directory — the same reason
/// [`read_bundle_in`] takes one. Every function below follows that shape: a `*_in` core that
/// knows only paths, and a thin async wrapper that supplies the real root.
fn staging_root_in(plugin_root: &Path) -> Result<PathBuf, PluginError> {
    let root = staging_dir_of(plugin_root);
    if !root.exists() {
        std::fs::create_dir_all(&root)?;
    }
    Ok(root)
}

/// A name no concurrent operation in this process will pick.
///
/// Process id plus a counter, not randomness: two installs racing inside one process are
/// separated by the counter, and two processes by the pid. Across a RESTART both repeat, so
/// every caller pre-clears the name it is about to use — see `swap_into_place`.
fn unique_suffix() -> String {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    format!(
        "{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}

/// Delete abandoned STAGES older than `older_than`. Best-effort throughout.
///
/// Age-based rather than "clear the directory", because a second install may be staged at
/// this moment and clearing would delete its tree out from under it. Stage directories are
/// created by `tempfile`, so their mtime really is their creation time.
///
/// ‼️ Only entries named `stage-*`. Anything else in the staging root — a backup, or a name
/// a future version introduces — is left alone; see [`STALE_STAGE_AFTER`] for the data-loss
/// bug that "sweep everything by age" caused.
///
/// Every failure is ignored on purpose: this is housekeeping for a directory the user never
/// sees, and failing an install because a week-old orphan could not be removed would be the
/// worse outcome.
///
/// The cutoff is a parameter so a test can drive both directions without having to backdate
/// an mtime; production always passes [`STALE_STAGE_AFTER`].
fn sweep_stale_stages(root: &Path, older_than: Duration) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        if !entry
            .file_name()
            .to_string_lossy()
            .starts_with(STAGE_PREFIX)
        {
            continue;
        }
        let stale = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .and_then(|modified| {
                std::time::SystemTime::now()
                    .duration_since(modified)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
            })
            .map(|age| age > older_than)
            .unwrap_or(false);
        if stale {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// Put back — or throw away — any backup a previous run left behind. Best-effort.
///
/// [`swap_into_place`] is two renames, and while each is atomic the PAIR is not. A hard
/// kill between them (SIGKILL, power loss, an OOM kill) leaves the user's working version
/// under `.staging/backup-…` with nothing at the install path, and until this existed
/// nothing anywhere put it back (#261 code review, MEDIUM-2).
///
/// The decision is presence, never age:
///
/// - the plugin directory is MISSING → the swap was interrupted; rename the backup back.
/// - the plugin directory EXISTS → the swap finished and only the removal was lost; the
///   backup is garbage and is deleted.
///
/// A name this cannot parse is left alone rather than guessed at.
fn recover_orphaned_backups(root: &Path, plugin_root: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with(BACKUP_PREFIX) {
            continue;
        }
        // `backup-<pid>-<counter>-<id>`; the id is the remainder, so an id containing
        // hyphens survives.
        let mut parts = name.splitn(4, '-');
        let (Some(_), Some(_), Some(_), Some(id)) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let Some(seg) = single_segment(id) else {
            continue;
        };
        let target = plugin_root.join(seg);
        if target.exists() {
            let _ = std::fs::remove_dir_all(entry.path());
        } else {
            let _ = std::fs::rename(entry.path(), &target);
        }
    }
}

/// The staging-directory name a displaced version of `plugin_id` is parked under.
///
/// ‼️ THE ID GOES LAST, and that is a contract with [`recover_orphaned_backups`], which has
/// to read it back out. An id may itself contain hyphens (`baram-word-count`), so putting it
/// after the two fixed numeric fields is what makes `splitn(4, '-')` unambiguous. Shared by
/// the producer and pinned by `a_hyphenated_plugin_id_survives_the_backup_name_round_trip`,
/// because a test that builds the name by hand cannot notice the two disagreeing.
fn backup_name(plugin_id: &str) -> String {
    format!("{BACKUP_PREFIX}{}-{plugin_id}", unique_suffix())
}

/// Drop any backup held for `plugin_id`. Best-effort.
///
/// Called by [`uninstall_plugin`], and the reason is [`recover_orphaned_backups`]: a
/// deliberate uninstall also leaves the install path missing, which is the same shape as an
/// interrupted swap. Without this, uninstalling a plugin whose backup survived a crash would
/// see it RESURRECTED by the next install.
fn drop_backups_for(root: &Path, plugin_id: &str) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let suffix = format!("-{plugin_id}");
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(BACKUP_PREFIX) && name.ends_with(&suffix) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// Turn a caller-supplied stage id into a directory, or refuse.
///
/// ‼️ The id crosses the IPC boundary, so it is treated as hostile input even though only
/// our own frontend sends one. `single_segment` rejects anything with a separator or a
/// `..`, and the prefix check rejects every OTHER child of the staging directory — so the
/// worst a malformed id can name is a staging tree, never an installed plugin and never
/// anything outside `~/.baram/plugins/.staging/`.
fn resolve_stage_in(plugin_root: &Path, stage_id: &str) -> Result<PathBuf, PluginError> {
    let seg = single_segment(stage_id)
        .filter(|_| stage_id.starts_with(STAGE_PREFIX))
        .ok_or_else(|| PluginError::Refused(format!("invalid stage id: {stage_id}")))?;
    let dir = staging_root_in(plugin_root)?.join(seg);
    if !dir.is_dir() {
        return Err(PluginError::NotFound(format!(
            "no staged install {stage_id}"
        )));
    }
    Ok(dir)
}

/// Replace `target` with `staged`, keeping whatever was at `target` if anything fails.
///
/// ‼️ THE POINT OF #261. What this replaces was:
///
/// ```text
/// remove_dir_all(&target)?;              // the working version, gone
/// copy_dir_recursive(staged, &target)?;  // ...and now anything may fail
/// ```
///
/// so a failure anywhere in the copy — disk full, a permission change, the process being
/// killed — left the user with neither the old version nor the new one, and the only repair
/// the frontend could offer was "reinstall it from the registry".
///
/// Each step here is a `rename` within one directory, which the OS performs atomically, and
/// after every one of them SOME complete version is reachable:
///
/// 1. `target` → `backup` — if this fails, `target` is untouched. Old version, still installed.
/// 2. `staged` → `target` — if this fails, step 1 is undone and we return the original error.
///    Old version, still installed.
/// 3. remove `backup` — best-effort. A failure here leaves a directory that
///    [`recover_orphaned_backups`] reclaims; the new version is already in place, so turning
///    this into an error would report a successful install as a failed one.
///
/// ‼️ EACH STEP IS ATOMIC; THE PAIR IS NOT (#261 code review, MEDIUM-2). A hard kill between
/// steps 1 and 2 leaves the old version under `backup` and nothing at `target`. The window is
/// microseconds rather than the whole copy this replaces, but it is not zero, which is why
/// [`recover_orphaned_backups`] runs before every stage and renames such a backup back.
///
/// `backup` is a path the caller has chosen and this function creates; it must be on the
/// same filesystem as `target`. It is pre-cleared because `unique_suffix` repeats across a
/// restart and `rename` onto a non-empty directory fails with `ENOTEMPTY` rather than
/// overwriting it.
///
/// Windows note: `MoveFileEx` refuses an existing destination outright, which is why step 2
/// renames into a name that step 1 has just vacated rather than over the live directory.
fn swap_into_place(staged: &Path, target: &Path, backup: &Path) -> Result<(), PluginError> {
    if !target.exists() {
        std::fs::rename(staged, target)?;
        return Ok(());
    }

    let _ = std::fs::remove_dir_all(backup);
    std::fs::rename(target, backup)?;

    match std::fs::rename(staged, target) {
        Ok(()) => {
            let _ = std::fs::remove_dir_all(backup);
            Ok(())
        }
        Err(err) => match std::fs::rename(backup, target) {
            Ok(()) => Err(PluginError::Io(err)),
            // Both renames failed, which takes a filesystem in real trouble. The previous
            // version still EXISTS and is intact — it is just not where the app looks — so
            // the message names the directory instead of pretending the data is gone.
            Err(restore) => Err(PluginError::Refused(format!(
                "installing the new version failed ({err}), and restoring the previous one \
                 failed too ({restore}); it is intact at {}",
                backup.display()
            ))),
        },
    }
}

/// Download a plugin ZIP, verify its checksum, and extract it to a staging directory.
///
/// Installs NOTHING. The returned [`StagedPluginInfo::stage_id`] is the handle for the
/// second half — [`commit_staged_plugin`] or [`discard_staged_plugin`] — and until one of
/// those runs, whatever version of this plugin the user already had is still installed and
/// still running.
///
/// `expected_id` is the id the caller was told to expect — the registry listing's. It is
/// checked here, before staging even returns (§260 Phase 5 re-review, R5): the install
/// directory is named by the id inside the ARCHIVE, so an archive declaring some other
/// installed plugin's id used to destroy that plugin's files as a side effect of
/// downloading this one. Refusing here means the damage never happens.
///
/// `None` skips the check, for a caller that has no prior expectation.
/// `registry_url` is the index this listing came from. The archive must live under it —
/// see `registry_base`. Required, not `Option`: a caller that omits it would otherwise
/// download from anywhere, which is the protection being opt-out by forgetfulness.
pub async fn stage_plugin(
    url: &str,
    registry_url: &str,
    expected_checksum: Option<&str>,
    expected_id: Option<&str>,
) -> Result<StagedPluginInfo, PluginError> {
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
    //
    // ‼️ AND THE ARCHIVE MUST COME FROM THE REGISTRY THAT LISTED IT. Until this, the only
    // guard on `url` was the scheme: any host was accepted, and the checksum beside it
    // offers nothing here because it comes from the SAME index — it attests bytes, not
    // provenance, so an entry saying "download from evil.example, hash X" is internally
    // consistent. The one thing anywhere that said where a plugin may come from was
    // `scripts/validate-registry-assets.ts`, which (a) runs only over registries whose CI we
    // own and (b) is a layer a review already proved bypassable. This is the runtime rule.
    let base = registry_base(registry_url).map_err(PluginError::Refused)?;
    let parsed = validate_http_url(url).map_err(PluginError::Refused)?;
    if !is_within_registry(&parsed, &base) {
        return Err(PluginError::Refused(format!(
            "plugin download {} is not under the registry that listed it ({}) — an index may \
             not send the download elsewhere, because its checksum attests the bytes rather \
             than where they came from",
            shown(&parsed),
            shown(&base)
        )));
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(600))
        // ‼️ Without this the check above is decorative: reqwest follows up to 10 redirects
        // by default, so a compliant URL could hand the download to any host on the first
        // hop. Every hop is re-checked against the same base.
        .redirect(redirect_within_registry(base.clone()))
        .build()?;
    // ‼️ THE REDIRECT REFUSAL'S REASON DOES NOT SURVIVE `?` (code review MEDIUM-1). reqwest
    // WRAPS a custom-policy error, and `to_string()` does not walk `source()`, so the message
    // the policy took care to write arrived as "Network error: error following redirect for url
    // (…)" — no reason, the ORIGINAL url rather than the hop, and it reads like connectivity.
    // Choosing `error()` over `stop()` bought nothing until this walked the chain.
    let mut response = match client.get(parsed).send().await {
        Ok(response) => response,
        Err(err) if err.is_redirect() => {
            return Err(PluginError::Refused(error_chain(&err)));
        }
        Err(err) => return Err(err.into()),
    };
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

    // 3–5, moved OFF the async runtime (#261).
    //
    // Inflating a ZIP is CPU- and syscall-bound, and it was running inline in an `async fn`
    // — so one large archive parked a Tokio worker for the entire install and delayed every
    // other task sharing it. `spawn_blocking` is where work that blocks belongs; the caps in
    // `extract_zip_bytes` bound how long it can hold the thread it is handed.
    //
    // Steps 4–5 move with it rather than staying behind: they are synchronous filesystem
    // work on the same directory, and splitting them would mean two round trips to the
    // blocking pool for no gain.
    let expected_id = expected_id.map(str::to_owned);
    let (stage_id, manifest, manifest_sha256) = tokio::task::spawn_blocking(
        move || -> Result<(String, PluginManifest, String), PluginError> {
            stage_archive_in(&get_plugin_dir()?, &bytes, expected_id.as_deref())
        },
    )
    .await
    // Deliberately does NOT interpolate `err`. A `JoinError` here means the closure
    // panicked, i.e. a bug in this code rather than anything about the archive, and its
    // payload can carry absolute paths straight to the frontend (review L1). Nothing in
    // it is actionable for the user; the shape of the failure is.
    .map_err(|_| PluginError::Refused("the plugin install task did not finish".into()))??;

    Ok(StagedPluginInfo {
        stage_id,
        checksum: actual_checksum,
        manifest,
        manifest_sha256,
    })
}

/// Steps 3–5 of a stage: extract, read the manifest, check the id. Touches nothing installed.
fn stage_archive_in(
    plugin_root: &Path,
    bytes: &[u8],
    expected_id: Option<&str>,
) -> Result<(String, PluginManifest, String), PluginError> {
    let root = staging_root_in(plugin_root)?;
    // ‼️ BEFORE the sweep and before anything else this install does: a backup stranded by
    // an interrupted swap is the user's ONLY copy of that plugin, and putting it back
    // matters more than anything happening here.
    recover_orphaned_backups(&root, plugin_root);
    sweep_stale_stages(&root, STALE_STAGE_AFTER);

    // 3. Extract into a staging directory to read the manifest.
    //
    // A `TempDir` for the whole of this function, so every refusal below removes the
    // extracted tree on the way out — including a panic. Only the last line, once the
    // archive has passed everything, defuses it into a directory we keep.
    let staged = tempfile::Builder::new()
        .prefix(STAGE_PREFIX)
        .tempdir_in(&root)?;
    extract_zip_bytes(bytes, staged.path())?;

    // 4. Read and validate the manifest.
    let (manifest, manifest_sha256) = read_staged_manifest(staged.path())?;

    // 5. The archive must be the plugin the caller asked for.
    if let Some(expected) = expected_id {
        if manifest.id != expected {
            return Err(PluginError::InvalidManifest(format!(
                "archive declares id \"{}\" but \"{expected}\" was requested",
                manifest.id
            )));
        }
    }

    let stage_id = staged
        .path()
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| PluginError::Refused("staging directory has no usable name".into()))?
        .to_owned();
    // Past every check: stop auto-deleting it, the caller owns it now.
    let _ = staged.keep();
    Ok((stage_id, manifest, manifest_sha256))
}

/// Read and validate the manifest at the root of a staged tree, with its digest.
///
/// ‼️ THE DIGEST IS A TOCTOU GUARD (#261 security review, area 1). A stage sits on disk
/// between two IPC calls, and the frontend decides during that gap: it compares the STAGED
/// manifest against what the user consented to — tier, capabilities, version floor — and
/// then commits. Commit re-reads from disk, so without a digest the manifest that gets
/// recorded, granted and loaded need not be the one any of those checks judged.
///
/// The window is not theoretical: it spans an app-version IPC and the whole `unloadPlugin`
/// teardown, during which a trusted-tier plugin is still running in the main realm. A
/// sandboxed plugin holding `files` would do just as well. Rewriting the staged manifest to
/// `"trust": "trusted"` is the escalation this closes.
///
/// Only `baram-plugin.json` is covered. The rest of the tree is not, deliberately: hashing
/// it costs a second full read, and swapping the CODE requires the same write access while
/// buying an attacker nothing the manifest does not already gate — the manifest is what
/// decides which realm the code runs in and which capabilities it gets.
fn read_staged_manifest(dir: &Path) -> Result<(PluginManifest, String), PluginError> {
    let manifest_path = dir.join("baram-plugin.json");
    if !manifest_path.exists() {
        return Err(PluginError::InvalidManifest(
            "baram-plugin.json not found in archive".to_string(),
        ));
    }
    let manifest_str = std::fs::read_to_string(&manifest_path)?;
    let manifest: PluginManifest = serde_json::from_str(&manifest_str)?;
    validate_manifest(&manifest)?;
    Ok((manifest, hex_sha256(manifest_str.as_bytes())))
}

/// Install a staged plugin, atomically replacing any version already installed.
///
/// This is the only destructive half of an install, and the only thing it can destroy is the
/// staged tree: see [`swap_into_place`] for why the previously installed version survives
/// every failure here.
///
/// ‼️ The manifest is RE-READ and RE-VALIDATED from disk rather than trusted from the
/// [`stage_plugin`] result. The caller chooses which stage id to commit, so treating the
/// earlier return value as authoritative would let a caller stage two plugins and commit one
/// under the other's name — and the id is what names the install directory.
pub async fn commit_staged_plugin(
    stage_id: &str,
    expected_id: &str,
    expected_manifest_sha256: &str,
) -> Result<CommittedPluginInfo, PluginError> {
    let stage_id = stage_id.to_owned();
    let expected_id = expected_id.to_owned();
    let expected_digest = expected_manifest_sha256.to_owned();
    tokio::task::spawn_blocking(move || {
        commit_staged_in(
            &get_plugin_dir()?,
            &stage_id,
            &expected_id,
            &expected_digest,
        )
    })
    .await
    .map_err(|_| PluginError::Refused("the plugin install task did not finish".into()))?
}

fn commit_staged_in(
    plugin_root: &Path,
    stage_id: &str,
    expected_id: &str,
    expected_manifest_sha256: &str,
) -> Result<CommittedPluginInfo, PluginError> {
    let staged = resolve_stage_in(plugin_root, stage_id)?;
    let (manifest, digest) = read_staged_manifest(&staged)?;
    // ‼️ The manifest must be the one the caller judged, byte for byte. See
    // `read_staged_manifest`: everything the caller checked between staging and now — tier,
    // capabilities, version floor — was checked against a file that anything with write
    // access to the staging directory could have replaced since.
    if digest != expected_manifest_sha256 {
        return Err(PluginError::Refused(format!(
            "the staged manifest changed after it was checked (expected \
             {expected_manifest_sha256}, found {digest})"
        )));
    }
    if manifest.id != expected_id {
        return Err(PluginError::InvalidManifest(format!(
            "staged plugin declares id \"{}\" but \"{expected_id}\" was requested",
            manifest.id
        )));
    }
    // Safe to join: `validate_manifest` admits only `[a-z0-9-]`, so the id is a single
    // segment that cannot escape the plugin directory.
    let target_dir = plugin_root.join(&manifest.id);
    let backup = staging_root_in(plugin_root)?.join(backup_name(&manifest.id));
    swap_into_place(&staged, &target_dir, &backup)?;
    Ok(CommittedPluginInfo {
        install_path: target_dir.to_string_lossy().to_string(),
        manifest,
    })
}

/// Throw away a staged plugin without installing it.
///
/// The counterpart to every refusal a caller can only make after seeing the manifest —
/// consent escalation, a version floor the listing under-declared, a capability the user
/// did not approve. Discarding is not a repair: nothing installed was ever touched.
///
/// An unknown id is an error rather than a silent success, so a caller cannot mistake
/// "already swept" for "cleaned up". Callers that discard on an error path should log and
/// swallow it — the failure they are handling is the one worth reporting.
pub async fn discard_staged_plugin(stage_id: &str) -> Result<(), PluginError> {
    let stage_id = stage_id.to_owned();
    tokio::task::spawn_blocking(move || discard_staged_in(&get_plugin_dir()?, &stage_id))
        .await
        .map_err(|_| PluginError::Refused("the plugin discard task did not finish".into()))?
}

fn discard_staged_in(plugin_root: &Path, stage_id: &str) -> Result<(), PluginError> {
    std::fs::remove_dir_all(resolve_stage_in(plugin_root, stage_id)?)?;
    Ok(())
}

/// Uninstall a plugin by removing its directory.
///
/// §260 Phase 5 code review — the id is `single_segment`-checked, matching
/// [`plugin_data_dir`]. This function does `remove_dir_all`, so it is the one place where
/// an id containing `..` or a separator would be worst, and it was the only one of the two
/// without the guard. Not reachable today (Rust's own `validate_manifest` constrains the id
/// before the files land) — but this is the function an id crossing the IPC boundary can
/// aim at a directory, so it is checked rather than assumed.
///
/// ‼️ Not the install rollback path (#261). An install that fails its post-download checks
/// calls [`discard_staged_plugin`], which can only ever remove a staging directory. Nothing
/// reaches this function except a user asking to uninstall.
pub async fn uninstall_plugin(plugin_id: &str) -> Result<(), PluginError> {
    uninstall_in(&get_plugin_dir()?, plugin_id)
}

fn uninstall_in(plugin_root: &Path, plugin_id: &str) -> Result<(), PluginError> {
    let seg = single_segment(plugin_id)
        .ok_or_else(|| PluginError::InvalidManifest(format!("invalid plugin id: {plugin_id}")))?;
    let target_dir = plugin_root.join(seg);
    if !target_dir.exists() {
        return Err(PluginError::NotFound(plugin_id.to_string()));
    }
    std::fs::remove_dir_all(&target_dir)?;
    // ‼️ Or `recover_orphaned_backups` would put it straight back: a deliberate uninstall
    // leaves the install path missing, which is the same shape as an interrupted swap.
    if let Ok(root) = staging_root_in(plugin_root) {
        drop_backups_for(&root, &seg.to_string_lossy());
    }
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

#[cfg(test)]
mod tests {
    use super::super::test_support::zip_of;
    use super::*;

    #[test]
    fn test_hex_sha256() {
        let hash = hex_sha256(b"hello");
        assert_eq!(
            hash,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    // --- #261: staging, atomic commit, rollback -------------------------------------
    //
    // Every test below drives the `*_in` cores against a temporary plugin root, so none of
    // them reads `$HOME` or touches a real installation. That is the reason those cores
    // exist: the property under test is "what is on disk after a failure", which a mocked
    // filesystem cannot answer.

    /// A manifest that passes `validate_manifest`, plus one payload file to move around.
    fn plugin_zip(id: &str, version: &str, payload: &str) -> Vec<u8> {
        let manifest = format!(
            r#"{{"id":"{id}","name":"N","description":"d","version":"{version}",
             "author":"a","license":"MIT","main":"main.js",
             "engines":{{"baram":">=0.1.0"}},"capabilities":[]}}"#
        );
        zip_of(&[
            ("baram-plugin.json", manifest.as_bytes()),
            ("main.js", payload.as_bytes()),
        ])
    }

    /// An already-installed plugin, written the way a previous install would have left it.
    fn install_by_hand(plugin_root: &Path, id: &str, payload: &str) -> PathBuf {
        let dir = plugin_root.join(id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("main.js"), payload).unwrap();
        std::fs::write(dir.join("baram-plugin.json"), format!(r#"{{"id":"{id}"}}"#)).unwrap();
        dir
    }

    fn stage_dirs(plugin_root: &Path) -> Vec<String> {
        let root = plugin_root.join(STAGING_DIR);
        let Ok(entries) = std::fs::read_dir(root) else {
            return Vec::new();
        };
        let mut names: Vec<String> = entries
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    /// ‼️ THE POINT OF #261, stated as one assertion: staging writes nothing into the
    /// installed tree.
    ///
    /// This is what the old install could not do. It ran `remove_dir_all(&target_dir)`
    /// before the copy, so by the time any post-download check could refuse the archive the
    /// working version was already gone.
    #[test]
    fn staging_leaves_the_installed_version_untouched() {
        let root = tempfile::tempdir().unwrap();
        let installed = install_by_hand(root.path(), "demo", "v1");

        let (stage_id, manifest, _digest) = stage_archive_in(
            root.path(),
            &plugin_zip("demo", "2.0.0", "v2"),
            Some("demo"),
        )
        .unwrap();

        assert_eq!(manifest.version, "2.0.0");
        assert_eq!(
            std::fs::read_to_string(installed.join("main.js")).unwrap(),
            "v1",
            "staging must not touch the installed version"
        );
        assert!(stage_id.starts_with(STAGE_PREFIX));
        assert!(root.path().join(STAGING_DIR).join(&stage_id).is_dir());
    }

    /// The other half: commit swaps, and leaves no backup behind.
    #[test]
    fn commit_replaces_the_installed_version_and_cleans_up() {
        let root = tempfile::tempdir().unwrap();
        let installed = install_by_hand(root.path(), "demo", "v1");

        let (stage_id, _, digest) = stage_archive_in(
            root.path(),
            &plugin_zip("demo", "2.0.0", "v2"),
            Some("demo"),
        )
        .unwrap();
        let committed = commit_staged_in(root.path(), &stage_id, "demo", &digest).unwrap();

        assert_eq!(committed.install_path, installed.to_string_lossy());
        assert_eq!(
            std::fs::read_to_string(installed.join("main.js")).unwrap(),
            "v2"
        );
        assert_eq!(
            stage_dirs(root.path()),
            Vec::<String>::new(),
            "the staged tree and its backup must both be gone after a successful commit"
        );
    }

    /// A first install: nothing to back up, nothing to restore.
    #[test]
    fn commit_installs_when_no_previous_version_exists() {
        let root = tempfile::tempdir().unwrap();

        let (stage_id, _, digest) =
            stage_archive_in(root.path(), &plugin_zip("demo", "1.0.0", "v1"), None).unwrap();
        commit_staged_in(root.path(), &stage_id, "demo", &digest).unwrap();

        assert_eq!(
            std::fs::read_to_string(root.path().join("demo").join("main.js")).unwrap(),
            "v1"
        );
    }

    /// ‼️ THE ROLLBACK. The second rename fails, and the previous version comes back.
    ///
    /// Injected by handing `swap_into_place` a `staged` path that does not exist, so
    /// `rename(staged, target)` fails with `ENOENT` after `target` has already been moved
    /// aside — precisely the window the old code could not survive.
    ///
    /// The both-renames-failed branch below it is not exercised here. Restoring renames into
    /// a name this function has just vacated, so within one process nothing short of a
    /// filesystem fault reaches it — but it is NOT unreachable: two installs of the same
    /// plugin can interleave so the second occupies `target` before the first restores
    /// (#261 review, LOW-1). The frontend's in-flight guard is what makes that unreachable
    /// in practice, so this stays a message-only path rather than a tested one.
    #[test]
    fn a_failed_swap_restores_the_previous_version() {
        let root = tempfile::tempdir().unwrap();
        let installed = install_by_hand(root.path(), "demo", "v1");
        let backup = root.path().join(STAGING_DIR).join("backup-demo-test");
        std::fs::create_dir_all(root.path().join(STAGING_DIR)).unwrap();

        let err = swap_into_place(&root.path().join("nonexistent"), &installed, &backup)
            .expect_err("renaming a nonexistent staged tree must fail");

        assert!(
            matches!(err, PluginError::Io(_)),
            "the caller must see the rename's own error, got: {err}"
        );
        assert_eq!(
            std::fs::read_to_string(installed.join("main.js")).unwrap(),
            "v1",
            "the previous version must be back where the app looks for it"
        );
        assert!(!backup.exists(), "the backup must not be left behind");
    }

    /// A stale backup from a previous run must not wedge the next install.
    ///
    /// `unique_suffix` repeats across a restart (pid + a counter that resets), and `rename`
    /// onto a NON-EMPTY directory fails with `ENOTEMPTY` instead of overwriting — so without
    /// the pre-clear a crashed install could make every later one fail.
    #[test]
    fn a_leftover_backup_name_does_not_block_the_swap() {
        let root = tempfile::tempdir().unwrap();
        let installed = install_by_hand(root.path(), "demo", "v1");
        let backup = root.path().join(STAGING_DIR).join("backup-demo-test");
        std::fs::create_dir_all(&backup).unwrap();
        std::fs::write(backup.join("junk.txt"), "from a crashed run").unwrap();

        let staged = root.path().join(STAGING_DIR).join("stage-x");
        std::fs::create_dir_all(&staged).unwrap();
        std::fs::write(staged.join("main.js"), "v2").unwrap();

        swap_into_place(&staged, &installed, &backup).unwrap();

        assert_eq!(
            std::fs::read_to_string(installed.join("main.js")).unwrap(),
            "v2"
        );
    }

    /// The install directory is named by the id, so committing under the wrong one would
    /// overwrite an unrelated plugin. Refused — and refused BEFORE the swap.
    #[test]
    fn commit_refuses_a_stage_whose_manifest_names_another_plugin() {
        let root = tempfile::tempdir().unwrap();
        let victim = install_by_hand(root.path(), "victim", "untouched");

        let (stage_id, _, digest) =
            stage_archive_in(root.path(), &plugin_zip("attacker", "1.0.0", "evil"), None).unwrap();
        let err = commit_staged_in(root.path(), &stage_id, "victim", &digest)
            .expect_err("a stage declaring another id must not install as that id");

        assert!(err.to_string().contains("was requested"), "{err}");
        assert_eq!(
            std::fs::read_to_string(victim.join("main.js")).unwrap(),
            "untouched"
        );
        assert!(
            !root.path().join("attacker").exists(),
            "a refused commit must not install under the archive's own id either"
        );
    }

    /// The same check one step earlier: staging already refuses the mismatch, so the
    /// frontend never sees a stage id it could commit by accident.
    #[test]
    fn staging_refuses_an_archive_declaring_another_plugins_id() {
        let root = tempfile::tempdir().unwrap();

        let err = stage_archive_in(
            root.path(),
            &plugin_zip("attacker", "1.0.0", "evil"),
            Some("victim"),
        )
        .expect_err("the archive is not the plugin that was asked for");

        assert!(err.to_string().contains("was requested"), "{err}");
        assert_eq!(
            stage_dirs(root.path()),
            Vec::<String>::new(),
            "a refused stage must remove its own extracted tree"
        );
    }

    #[test]
    fn discard_removes_the_stage_and_leaves_installs_alone() {
        let root = tempfile::tempdir().unwrap();
        let installed = install_by_hand(root.path(), "demo", "v1");
        let (stage_id, _, _digest) = stage_archive_in(
            root.path(),
            &plugin_zip("demo", "2.0.0", "v2"),
            Some("demo"),
        )
        .unwrap();

        discard_staged_in(root.path(), &stage_id).unwrap();

        assert_eq!(stage_dirs(root.path()), Vec::<String>::new());
        assert_eq!(
            std::fs::read_to_string(installed.join("main.js")).unwrap(),
            "v1"
        );
        assert!(
            discard_staged_in(root.path(), &stage_id).is_err(),
            "discarding twice must report the second one as unknown, not succeed silently"
        );
    }

    /// ‼️ A stage id crosses the IPC boundary, so it is checked, not trusted.
    ///
    /// Each of these names something a caller might want to delete or overwrite; all of them
    /// must fail to RESOLVE, which is what keeps `commit`/`discard` pointed inside the
    /// staging directory.
    ///
    /// `backup-demo-1` is the case the `stage-` prefix check exists for, and the only one it
    /// alone catches: it is a real directory in the staging root, so `single_segment` and
    /// the `is_dir` check both pass. Committing or discarding a backup mid-swap is the
    /// damage. The traversal cases are `single_segment`'s, and the installed-plugin id fails
    /// for a third reason — the join is relative to the staging directory, not to the
    /// plugin root — which is worth pinning precisely because it is easy to lose.
    #[test]
    fn a_stage_id_cannot_name_anything_outside_the_staging_directory() {
        let root = tempfile::tempdir().unwrap();
        install_by_hand(root.path(), "demo", "v1");
        // A real staged tree, so the failures below are about the ID and not about an
        // empty staging directory.
        let (real, _, _) = stage_archive_in(
            root.path(),
            &plugin_zip("demo", "2.0.0", "v2"),
            Some("demo"),
        )
        .unwrap();
        std::fs::create_dir_all(root.path().join(STAGING_DIR).join("backup-999-0-demo")).unwrap();

        // ‼️ THE FIRST TWO ARE THE ONLY INPUTS `single_segment` CATCHES, and without them
        // this test did not exercise it at all (#261 code review, MEDIUM-3). Every other
        // entry below fails for a DIFFERENT reason — the `stage-` prefix, or a path that
        // simply does not exist — so deleting `single_segment` left the whole array green,
        // while `discard_staged_plugin("<a real stage>/../../demo")` would resolve to an
        // INSTALLED plugin and `remove_dir_all` it. A traversal only reaches the `is_dir`
        // check if it is rooted at a stage that exists, and the loop never used the one the
        // test had just created.
        let rooted = format!("{real}/../../demo");
        let rooted_backslash = format!("{real}\\..\\..\\demo");
        for hostile in [
            rooted.as_str(),
            rooted_backslash.as_str(),
            "../demo",
            "../../.baram",
            "stage-../demo",
            "backup-999-0-demo",
            "demo",
            ".",
            "..",
            "",
            "stage-a/b",
        ] {
            assert!(
                resolve_stage_in(root.path(), hostile).is_err(),
                "stage id {hostile:?} must not resolve"
            );
        }
        assert!(
            std::fs::read_to_string(root.path().join("demo").join("main.js")).is_ok(),
            "nothing above may have deleted the installed plugin"
        );
    }

    /// ‼️ A HARD KILL BETWEEN THE TWO RENAMES MUST NOT COST THE USER THEIR PLUGIN.
    ///
    /// Simulated exactly: `swap_into_place` with a nonexistent `staged` leaves the backup
    /// written and the target missing after its restore is skipped — so the state below is
    /// built by hand to be the one a SIGKILL produces, and the next stage must undo it.
    #[test]
    fn an_interrupted_swap_is_recovered_by_the_next_stage() {
        let root = tempfile::tempdir().unwrap();
        let staging = staging_root_in(root.path()).unwrap();
        // What a kill between rename #1 and rename #2 leaves behind.
        let backup = staging.join(format!("{BACKUP_PREFIX}999-0-demo"));
        std::fs::create_dir_all(&backup).unwrap();
        std::fs::write(backup.join("main.js"), "v1").unwrap();
        assert!(!root.path().join("demo").exists());

        stage_archive_in(root.path(), &plugin_zip("other", "1.0.0", "x"), None).unwrap();

        assert_eq!(
            std::fs::read_to_string(root.path().join("demo").join("main.js")).unwrap(),
            "v1",
            "the only copy of demo must be back where the app looks for it"
        );
        assert!(!backup.exists());
    }

    /// ‼️ THE BUG THAT MADE THAT NECESSARY (#261 security review).
    ///
    /// `std::fs::rename` PRESERVES mtime, so a backup inherits the mtime of the plugin
    /// directory it displaced. For any plugin installed more than `STALE_STAGE_AFTER` ago
    /// the backup is stale the moment it exists — and an age-based sweep over the whole
    /// staging root would delete the user's only copy.
    ///
    /// Both halves are asserted: that rename really does preserve the mtime (otherwise this
    /// test proves nothing), and that the sweep leaves the backup alone anyway.
    #[test]
    fn the_sweep_never_touches_a_backup_however_old_it_looks() {
        let root = tempfile::tempdir().unwrap();
        let staging = staging_root_in(root.path()).unwrap();
        let installed = install_by_hand(root.path(), "demo", "v1");
        let before = std::fs::metadata(&installed).unwrap().modified().unwrap();

        let backup = staging.join(format!("{BACKUP_PREFIX}999-0-demo"));
        std::fs::rename(&installed, &backup).unwrap();
        assert_eq!(
            std::fs::metadata(&backup).unwrap().modified().unwrap(),
            before,
            "rename must preserve mtime, or this test is about nothing"
        );

        // The harshest cutoff there is. A backup must survive it regardless.
        sweep_stale_stages(&staging, Duration::ZERO);

        assert!(
            backup.exists(),
            "the sweep deleted a backup — this is the user's only copy of the plugin"
        );
    }

    /// …but an uninstall must not leave one for the recovery to resurrect.
    ///
    /// ‼️ Driven through `uninstall_in`, NOT through `drop_backups_for`. The first version of
    /// this test called the helper directly and mutation testing walked straight past it:
    /// deleting the call from `uninstall_plugin` left it green, because a test of a helper
    /// says nothing about whether anything invokes the helper.
    #[test]
    fn uninstalling_drops_a_backup_so_it_cannot_come_back() {
        let root = tempfile::tempdir().unwrap();
        let staging = staging_root_in(root.path()).unwrap();
        install_by_hand(root.path(), "demo", "v2");
        // A backup that survived a crash during an earlier update of the same plugin.
        let backup = staging.join(format!("{BACKUP_PREFIX}999-0-demo"));
        std::fs::create_dir_all(&backup).unwrap();
        std::fs::write(backup.join("main.js"), "v1").unwrap();

        uninstall_in(root.path(), "demo").unwrap();
        assert!(!root.path().join("demo").exists());

        // The next install must NOT bring the plugin back from that backup.
        stage_archive_in(root.path(), &plugin_zip("other", "1.0.0", "x"), None).unwrap();
        assert!(
            !root.path().join("demo").exists(),
            "an uninstalled plugin was resurrected by backup recovery"
        );
    }

    /// A completed swap whose cleanup was lost leaves a backup that is simply garbage.
    #[test]
    fn recovery_discards_a_backup_whose_plugin_is_already_installed() {
        let root = tempfile::tempdir().unwrap();
        let staging = staging_root_in(root.path()).unwrap();
        install_by_hand(root.path(), "demo", "v2");
        let backup = staging.join(format!("{BACKUP_PREFIX}999-0-demo"));
        std::fs::create_dir_all(&backup).unwrap();
        std::fs::write(backup.join("main.js"), "v1").unwrap();

        recover_orphaned_backups(&staging, root.path());

        assert!(!backup.exists(), "a superseded backup must be reclaimed");
        assert_eq!(
            std::fs::read_to_string(root.path().join("demo").join("main.js")).unwrap(),
            "v2",
            "and it must not overwrite the version that won"
        );
    }

    /// ‼️ THE ROUND TRIP, through the PRODUCER — not a name written by hand.
    ///
    /// The recovery tests above build `backup-999-0-demo` themselves, so they say nothing
    /// about whether `commit_staged_in` produces a name recovery can parse. Mutation testing
    /// caught that: swapping the id and the counter in the producer left every one of them
    /// green. `backup_name` is the shared definition and this drives it end to end with an id
    /// that contains hyphens, which is the case the field order exists for — the live
    /// registry's only plugin is `baram-word-count`.
    #[test]
    fn a_hyphenated_plugin_id_survives_the_backup_name_round_trip() {
        let root = tempfile::tempdir().unwrap();
        let staging = staging_root_in(root.path()).unwrap();
        let backup = staging.join(backup_name("my-word-count"));
        std::fs::create_dir_all(&backup).unwrap();
        std::fs::write(backup.join("main.js"), "v1").unwrap();

        recover_orphaned_backups(&staging, root.path());

        assert_eq!(
            std::fs::read_to_string(root.path().join("my-word-count").join("main.js")).unwrap(),
            "v1",
            "the name the commit path writes must be the name recovery reads"
        );
    }

    /// ‼️ THE MANIFEST MAY NOT CHANGE BETWEEN THE CHECKS AND THE COMMIT.
    ///
    /// Everything the caller decides — tier, capabilities, version floor — is decided
    /// against the STAGED manifest, and the commit re-reads from disk. Anything with write
    /// access to the staging directory during that gap could otherwise install a plugin
    /// nothing had judged. `"trust": "trusted"` is the escalation that matters.
    #[test]
    fn commit_refuses_a_manifest_edited_after_it_was_staged() {
        let root = tempfile::tempdir().unwrap();
        let installed = install_by_hand(root.path(), "demo", "v1");
        let (stage_id, manifest, digest) = stage_archive_in(
            root.path(),
            &plugin_zip("demo", "2.0.0", "v2"),
            Some("demo"),
        )
        .unwrap();
        assert_eq!(manifest.trust, None);

        // The attacker rewrites the staged manifest, keeping the id so the id check passes.
        let staged = root.path().join(STAGING_DIR).join(&stage_id);
        let tampered = std::fs::read_to_string(staged.join("baram-plugin.json"))
            .unwrap()
            .replace(
                r#""capabilities":[]"#,
                r#""capabilities":["files"],"trust":"trusted""#,
            );
        std::fs::write(staged.join("baram-plugin.json"), &tampered).unwrap();

        let err = commit_staged_in(root.path(), &stage_id, "demo", &digest)
            .expect_err("a manifest that changed after it was checked must not install");

        assert!(
            err.to_string().contains("changed after it was checked"),
            "{err}"
        );
        assert_eq!(
            std::fs::read_to_string(installed.join("main.js")).unwrap(),
            "v1",
            "and the refusal must not have disturbed the installed version"
        );
    }

    /// The sweep must reclaim orphans without touching an install that is staging right now.
    #[test]
    fn the_sweep_reclaims_by_age_only() {
        let root = tempfile::tempdir().unwrap();
        let staging = staging_root_in(root.path()).unwrap();
        let orphan = staging.join("stage-orphan");
        std::fs::create_dir_all(&orphan).unwrap();

        // The real cutoff: a directory created a moment ago is not stale.
        sweep_stale_stages(&staging, STALE_STAGE_AFTER);
        assert!(
            orphan.exists(),
            "a fresh stage must survive the real cutoff"
        );

        // Everything is older than nothing.
        sweep_stale_stages(&staging, Duration::ZERO);
        assert!(!orphan.exists(), "an aged-out stage must be reclaimed");
    }

    /// …and the production path calls it, without eating a concurrent stage.
    #[test]
    fn staging_does_not_sweep_another_install_in_flight() {
        let root = tempfile::tempdir().unwrap();
        let (first, _, _) =
            stage_archive_in(root.path(), &plugin_zip("one", "1.0.0", "a"), Some("one")).unwrap();
        let (second, _, _) =
            stage_archive_in(root.path(), &plugin_zip("two", "1.0.0", "b"), Some("two")).unwrap();

        assert_ne!(first, second);
        assert_eq!(stage_dirs(root.path()), {
            let mut both = vec![first, second];
            both.sort();
            both
        });
    }

    /// `.staging` must not look like an installed plugin.
    ///
    /// `list_installed` reports every child of the plugin directory holding a manifest at
    /// its root. A stage holds one — one level deeper — so the staging directory itself is
    /// skipped, and no id can ever collide with the name because `validate_manifest` admits
    /// only `[a-z0-9-]`.
    #[test]
    fn the_staging_directory_can_never_be_mistaken_for_a_plugin() {
        let root = tempfile::tempdir().unwrap();
        let err = stage_archive_in(root.path(), &plugin_zip(STAGING_DIR, "1.0.0", "x"), None)
            .expect_err("a plugin claiming the staging directory's name must be refused");

        assert!(
            err.to_string().contains("lowercase letters"),
            "expected the id-charset refusal, got: {err}"
        );
    }
}
