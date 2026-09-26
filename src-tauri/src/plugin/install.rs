// §69 Plugin Marketplace / #261 — staged install lifecycle.
//
// `stage_install` downloads, verifies and extracts a plugin to a staging directory without
// touching anything installed; the commit is the only destructive step, an atomic swap. The
// shared core underneath BOTH commit paths is `checked_stage_in` (resolve the stage, verify
// its digest and id, write theme CSS if any) plus `swap_checked_in` (the swap itself) —
// never `commit_staged_install`. That function is the public THEME entry point: it refuses
// `InstallKind::Plugin` outright, before touching anything, so a plugin never reaches it,
// directly or through `commit_staged_in`. A plugin commit goes through
// `commit_staged_plugin_install` instead (§379, `commands::plugin_cmd::plugin_install_commit`
// is its only caller), which runs the dev-folder-held-id refusal on the checked id between
// `checked_stage_in` and `swap_checked_in`.
// `discard_staged_install` and `uninstall_installed` are the two ways to undo. See
// `swap_into_place` for why the previously installed version survives every failure, and
// `STALE_STAGE_AFTER` / `recover_orphaned_backups` for the two kinds of interrupted install
// this module cleans up after.
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::archive::extract_zip_bytes;
use super::limits::MAX_PLUGIN_ARCHIVE_BYTES;
use super::origin::{
    error_chain, is_within_registry, redirect_within_registry, registry_base, shown,
    validate_http_url,
};
use super::registry::{InstalledPluginInfo, PluginManifest};
use super::storage::{
    get_plugin_dir, get_theme_dir, hex_sha256, install_root, read_bytes_capped, read_text_capped,
    resolve_within, single_segment, InstallKind,
};
use super::{validate_manifest, PluginError};

/// Where an in-flight install lives until something commits it: `~/.baram/plugins/.staging/`
/// (or `~/.baram/themes/.staging/` — §360, [`InstallKind`]; this constant names the leaf
/// under WHICHEVER root a caller was resolved to, never a root itself).
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

/// The manifest at the root of a plugin archive.
const PLUGIN_MANIFEST_FILE: &str = "baram-plugin.json";

/// The manifest at the root of a theme archive (§360, spec 0049 §4).
const THEME_MANIFEST_FILE: &str = "baram-theme.json";

/// §360 — where an installed theme's SANITIZED CSS lives, one file per mode
/// (`.stored/light.css`, `.stored/dark.css`), under the theme's own directory.
///
/// ‼️ A FIXED NAME, NOT A PATH OUT OF THE MANIFEST. `baram-theme.json` names the CSS the
/// AUTHOR wrote (`modes.light.css`); what gets injected at load is the output of
/// `sanitizeThemeCss` → `inlineThemeAssets`, which is a different document. Reading the
/// manifest-named path back at load would aim the injector at a file nothing sanitized, and
/// the installed directory is one a person can open afterwards — the same reason
/// `verifyStoredThemeCss` exists at all. So the load path never follows a path the manifest
/// chose. [`write_stored_theme_css`] additionally removes any `.stored/` the ARCHIVE
/// shipped before writing, so nothing under here is ever archive content.
const STORED_CSS_DIR: &str = ".stored";

/// §360 — upper bound on one mode's stored theme CSS.
///
/// ‼️ NOT DERIVABLE FROM THE ASSET BUDGET, and that is why it is a separate number.
/// `MAX_THEME_ASSET_BYTES` (2 MiB, `src/utils/theme-css/inline-assets.ts`) counts each
/// asset PATH once, but inlining re-emits the whole `data:` URI at every REFERENCE site —
/// ten rules naming one 1 MiB font produce ~14 MiB of CSS out of a budget that only ever
/// saw 1 MiB. The expansion factor is unbounded in the number of reference sites, so the
/// OUTPUT needs a bound of its own and the input budget cannot supply it.
///
/// 4 MiB, picked to sit above what a package respecting the other two caps can honestly
/// produce, so this never fires first on a legitimate theme: 2 MiB of assets base64-encode
/// to 2,796,204 characters (⌈2097152/3⌉ × 4), the authored stylesheet is capped at 512 KiB
/// before it is parsed (`MAX_THEME_CSS_BYTES`, same TypeScript file), and the
/// `data:<media type>;base64,` prefixes cost ~23 bytes per reference — 3,320,492 bytes
/// (3.17 MiB) together, leaving 873,812 bytes (853 KiB) of headroom. Every figure here is
/// a MEBIbyte; an earlier version of this comment said "3.3 MiB" for a number that is
/// 3.17 MiB, which is the MB/MiB slip the arithmetic above exists to avoid.
///
/// ‼️ `scripts/rust-constants.ts` scrapes this literal and
/// `src/themes/__tests__/stored-css-cap-parity.test.ts` binds the TypeScript copy to it, so
/// the frontend cannot refuse at a different size than the backend enforces. Written as a
/// product of integers because that scrape accepts no other form.
const MAX_STORED_THEME_CSS_BYTES: usize = 4 * 1024 * 1024;

/// §360 — upper bound on `baram-theme.json` as Rust reads it out of a staged archive.
///
/// The same 64 KiB `use-theme-import.ts` applies to an imported theme file, for the same
/// reason: a theme manifest is a few lines of metadata, so anything three orders of
/// magnitude larger is a mistake or an attempt to make the reader pay for it.
///
/// ‼️ THE FRONTEND CAPS AGAIN AT THE SAME VALUE, before its own `JSON.parse`
/// (`parseThemeManifestText`). Not redundant: this layer bounds what Rust's `serde_json`
/// walks and what crosses IPC, and the TypeScript layer is the one that runs for every
/// caller of that function — including a manifest that never came through an archive
/// (spec 0049 §12.2's dev-folder themes). Neither is entitled to assume the other ran; the
/// Pandoc image policy in this repo is built the same way, three layers deep.
const MAX_THEME_MANIFEST_BYTES: u64 = 64 * 1024;

/// §360 — upper bound on any single file [`read_staged_file`] hands the frontend.
///
/// ‼️ DELIBERATELY ABOVE `MAX_THEME_ASSET_BYTES` (2 MiB), not below. The asset budget is
/// the cap that SHOULD refuse an oversized asset, because it reports `tooLarge` naming the
/// path the author has to shrink. If this one were the lower of the two it would fire
/// first, the reader would report "no such file", and the author would go looking for a
/// missing asset that is sitting right there.
const MAX_STAGED_FILE_BYTES: u64 = 8 * 1024 * 1024;

/// A downloaded, extracted, validated plugin that is NOT yet installed.
///
/// The point of naming this state (#261) is that everything expensive and everything
/// attacker-controlled happens before anything installed is touched. The caller inspects
/// the manifest, asks the user, checks it against what was consented to — and only then
/// commits. A refusal at any of those points costs a `discard_staged_install`, never a
/// working plugin.
#[derive(Debug, Clone, Serialize)]
pub struct StagedPluginInfo {
    /// Opaque handle for [`commit_staged_plugin_install`] / [`discard_staged_install`]. A directory
    /// name under [`STAGING_DIR`], never a path — the caller cannot name anything else.
    pub stage_id: String,
    pub checksum: String,
    pub manifest: PluginManifest,
    /// SHA-256 of the staged `baram-plugin.json`, to be handed back to
    /// [`commit_staged_plugin_install`]. See [`read_staged_manifest`] for why.
    pub manifest_sha256: String,
}

/// What a committed install turned out to be, read back AFTER the swap.
#[derive(Debug, Clone, Serialize)]
pub struct CommittedPluginInfo {
    pub install_path: String,
    pub manifest: PluginManifest,
}

/// §360 — the theme counterpart of [`StagedPluginInfo`].
#[derive(Debug, Clone, Serialize)]
pub struct StagedThemeInfo {
    pub stage_id: String,
    pub checksum: String,
    /// The staged `baram-theme.json`, as TEXT.
    ///
    /// ‼️ Not a deserialized struct, and the difference is a decision rather than a
    /// convenience. Rust reads exactly one field out of a theme manifest — the id, because
    /// the id names the install directory and that is the one thing this layer cannot
    /// delegate. Everything else is decided by `validateThemeManifest`
    /// (`src/themes/theme-manifest.ts`, spec 0049 §4), which takes already-parsed data; a
    /// typed deserialize here would either duplicate those rules in a second language or,
    /// worse, silently drop the fields it did not model before the real validator ever saw
    /// them. The text is what [`manifest_sha256`](Self::manifest_sha256) digests, so the
    /// frontend validates the same bytes the commit pins.
    pub manifest: String,
    /// SHA-256 of the staged `baram-theme.json`, to be handed back to
    /// [`commit_staged_install`]. Same TOCTOU guard as the plugin one — see
    /// [`read_staged_manifest`].
    pub manifest_sha256: String,
}

/// §360 — what a committed theme install turned out to be, read back AFTER the swap.
///
/// Carries the id rather than the manifest: the frontend already holds the manifest it
/// validated, and re-serializing 64 KiB of text it just sent would buy nothing.
#[derive(Debug, Clone, Serialize)]
pub struct CommittedThemeInfo {
    pub install_path: String,
    pub id: String,
}

/// §360 — a theme's sanitized CSS, handed to [`commit_staged_install`] to be written into
/// the staged tree just before the swap publishes it.
///
/// ‼️ A CLOSED STRUCT, NOT A MAP. Each field name IS a file name under [`STORED_CSS_DIR`],
/// so a `HashMap<String, String>` would let the webview choose a path component — the
/// §329–§336 mistake in miniature. Spec 0049 §4 defines exactly two modes, and these are
/// they.
///
/// Both fields absent is legal: a theme may declare only `tokens` for every mode.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct StoredThemeCss {
    pub dark: Option<String>,
    pub light: Option<String>,
}

/// §360 — one of spec 0049 §4's two theme modes.
///
/// Its own closed enum rather than a string, for the reason above: this is what
/// [`read_stored_theme_css`] turns into a file name, and a string parameter there would be
/// a path component supplied by the caller.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    Dark,
    Light,
}

impl ThemeMode {
    /// The file this mode's stored CSS is written to under [`STORED_CSS_DIR`].
    fn file_name(self) -> &'static str {
        match self {
            ThemeMode::Dark => "dark.css",
            ThemeMode::Light => "light.css",
        }
    }
}

/// What Rust read out of the manifest at the root of a staged tree.
///
/// Both arms carry an id, and the id is the only thing the two have in common that this
/// module needs: it names the install directory. What they do NOT have in common is who
/// validates the rest — a plugin manifest decides trust tier and capabilities, so Rust
/// validates it here; a theme manifest decides neither, so the frontend does (see
/// [`StagedThemeInfo::manifest`]).
#[derive(Debug, Clone)]
pub enum StagedManifest {
    // Boxed because the two variants are otherwise wildly different sizes and clippy's
    // `large_enum_variant` is right about it: every `Theme` would otherwise carry a
    // plugin manifest's worth of unused space.
    Plugin(Box<PluginManifest>),
    Theme { id: String, text: String },
}

impl StagedManifest {
    /// The id this archive declares — what names the install directory.
    fn id(&self) -> &str {
        match self {
            StagedManifest::Plugin(manifest) => &manifest.id,
            StagedManifest::Theme { id, .. } => id,
        }
    }
}

/// A staged install of either kind, before the command layer narrows it to one.
#[derive(Debug, Clone)]
pub struct StagedInstall {
    pub stage_id: String,
    pub checksum: String,
    pub manifest: StagedManifest,
    pub manifest_sha256: String,
}

impl StagedInstall {
    /// Narrow to the plugin wire type, for `plugin_install_stage`.
    ///
    /// ‼️ The error arm is unreachable from a caller that passed [`InstallKind::Plugin`] —
    /// [`stage_install`] picks the manifest reader off the same `kind`. It is a refusal
    /// rather than an `expect` because this runs inside an IPC handler, where a panic takes
    /// the command's whole task down and tells the user nothing.
    pub fn into_plugin(self) -> Result<StagedPluginInfo, PluginError> {
        match self.manifest {
            StagedManifest::Plugin(manifest) => Ok(StagedPluginInfo {
                stage_id: self.stage_id,
                checksum: self.checksum,
                manifest: *manifest,
                manifest_sha256: self.manifest_sha256,
            }),
            StagedManifest::Theme { .. } => Err(PluginError::Refused(
                "a theme was staged where a plugin was expected".into(),
            )),
        }
    }

    /// Narrow to the theme wire type, for `theme_install_stage`. See [`Self::into_plugin`]
    /// for why the mismatch is a refusal.
    pub fn into_theme(self) -> Result<StagedThemeInfo, PluginError> {
        match self.manifest {
            StagedManifest::Theme { text, .. } => Ok(StagedThemeInfo {
                stage_id: self.stage_id,
                checksum: self.checksum,
                manifest: text,
                manifest_sha256: self.manifest_sha256,
            }),
            StagedManifest::Plugin(_) => Err(PluginError::Refused(
                "a plugin was staged where a theme was expected".into(),
            )),
        }
    }
}

/// A committed install of either kind, before the command layer narrows it to one.
#[derive(Debug, Clone)]
pub struct CommittedInstall {
    pub install_path: String,
    pub manifest: StagedManifest,
}

impl CommittedInstall {
    /// Narrow to the plugin wire type. See [`StagedInstall::into_plugin`].
    pub fn into_plugin(self) -> Result<CommittedPluginInfo, PluginError> {
        match self.manifest {
            StagedManifest::Plugin(manifest) => Ok(CommittedPluginInfo {
                install_path: self.install_path,
                manifest: *manifest,
            }),
            StagedManifest::Theme { .. } => Err(PluginError::Refused(
                "a theme was committed where a plugin was expected".into(),
            )),
        }
    }

    /// Narrow to the theme wire type. See [`StagedInstall::into_plugin`].
    pub fn into_theme(self) -> Result<CommittedThemeInfo, PluginError> {
        match self.manifest {
            StagedManifest::Theme { id, .. } => Ok(CommittedThemeInfo {
                install_path: self.install_path,
                id,
            }),
            StagedManifest::Plugin(_) => Err(PluginError::Refused(
                "a plugin was committed where a theme was expected".into(),
            )),
        }
    }
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
/// Called by [`uninstall_installed`], and the reason is [`recover_orphaned_backups`]: a
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
/// anything outside `~/.baram/plugins/.staging/` (or `~/.baram/themes/.staging/` — see
/// [`InstallKind`]; the containment argument is about the root this function is HANDED, so
/// it holds identically for either).
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
/// second half — [`commit_staged_plugin_install`] (a theme's: [`commit_staged_install`]) or
/// [`discard_staged_install`] — and until one of those runs, whatever version of this plugin
/// the user already had is still installed and still running.
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
///
/// `kind` (§360) chooses which installable-asset tree this stages into — see
/// [`InstallKind`] — AND which manifest the archive must carry: `baram-plugin.json` for a
/// plugin, `baram-theme.json` for a theme. Nothing above the extraction cares which one it
/// is: the download, the checksum check and the size cap are the same regardless of what
/// gets installed, which is why they are not duplicated per kind.
///
/// The return type is narrowed to one kind's wire shape by the command layer — see
/// [`StagedInstall::into_plugin`] / [`StagedInstall::into_theme`].
pub async fn stage_install(
    kind: InstallKind,
    url: &str,
    registry_url: &str,
    expected_checksum: Option<&str>,
    expected_id: Option<&str>,
) -> Result<StagedInstall, PluginError> {
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
        move || -> Result<(String, StagedManifest, String), PluginError> {
            stage_archive_in(&install_root(kind)?, kind, &bytes, expected_id.as_deref())
        },
    )
    .await
    // Deliberately does NOT interpolate `err`. A `JoinError` here means the closure
    // panicked, i.e. a bug in this code rather than anything about the archive, and its
    // payload can carry absolute paths straight to the frontend (review L1). Nothing in
    // it is actionable for the user; the shape of the failure is.
    .map_err(|_| PluginError::Refused("the plugin install task did not finish".into()))??;

    Ok(StagedInstall {
        stage_id,
        checksum: actual_checksum,
        manifest,
        manifest_sha256,
    })
}

/// Steps 3–5 of a stage: extract, read the manifest, check the id. Touches nothing installed.
fn stage_archive_in(
    plugin_root: &Path,
    kind: InstallKind,
    bytes: &[u8],
    expected_id: Option<&str>,
) -> Result<(String, StagedManifest, String), PluginError> {
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
    let (manifest, manifest_sha256) = read_staged_manifest_of(kind, staged.path())?;

    // 5. The archive must be the plugin the caller asked for.
    if let Some(expected) = expected_id {
        if manifest.id() != expected {
            return Err(PluginError::InvalidManifest(format!(
                "archive declares id \"{}\" but \"{expected}\" was requested",
                manifest.id()
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
    let manifest_path = dir.join(PLUGIN_MANIFEST_FILE);
    if !manifest_path.exists() {
        return Err(PluginError::InvalidManifest(format!(
            "{PLUGIN_MANIFEST_FILE} not found in archive"
        )));
    }
    let manifest_str = std::fs::read_to_string(&manifest_path)?;
    let manifest: PluginManifest = serde_json::from_str(&manifest_str)?;
    validate_manifest(&manifest)?;
    Ok((manifest, hex_sha256(manifest_str.as_bytes())))
}

/// [`read_staged_manifest`] for whichever kind is being staged (§360).
///
/// The digest contract is identical for both — see [`read_staged_manifest`] for why it
/// exists — and both commit paths re-run this function and compare, so a theme manifest is
/// pinned across the staging window exactly as a plugin one is.
fn read_staged_manifest_of(
    kind: InstallKind,
    dir: &Path,
) -> Result<(StagedManifest, String), PluginError> {
    match kind {
        InstallKind::Plugin => {
            let (manifest, digest) = read_staged_manifest(dir)?;
            Ok((StagedManifest::Plugin(Box::new(manifest)), digest))
        }
        InstallKind::Theme => {
            let (id, text, digest) = read_staged_theme_manifest(dir)?;
            Ok((StagedManifest::Theme { id, text }, digest))
        }
    }
}

/// The id Rust needs out of a staged `baram-theme.json`, and nothing else.
#[derive(Deserialize)]
struct ThemeManifestId {
    id: String,
}

/// Read the staged `baram-theme.json`, returning `(id, raw text, digest)`.
///
/// ‼️ THIS IS NOT A THEME MANIFEST VALIDATOR, and it must not grow into one. The structural
/// rules of spec 0049 §4 — `modes`, `engines.baram`, the refusal of `capabilities`/`main`,
/// the text-field limits — live in `validateThemeManifest`
/// (`src/themes/theme-manifest.ts`), in one language, with one set of error messages the UI
/// already renders. A second copy here would be a second place for them to drift, and this
/// one would be the copy nobody reads when the rules change.
///
/// What Rust does read is the `id`, because Rust cannot delegate it: the id becomes a
/// directory name under `~/.baram/themes/`, so it is checked against the same
/// `[a-z0-9-]` rule [`validate_manifest`] applies to a plugin id — and [`single_segment`]
/// in `commit_staged_in`'s join is the backstop behind that.
fn read_staged_theme_manifest(dir: &Path) -> Result<(String, String, String), PluginError> {
    let manifest_path = dir.join(THEME_MANIFEST_FILE);
    if !manifest_path.exists() {
        return Err(PluginError::InvalidManifest(format!(
            "{THEME_MANIFEST_FILE} not found in archive"
        )));
    }
    // Measured before it is read, the same "never allocate to measure" rule
    // `read_text_capped` follows: the file is attacker-shipped, and the cost of refusing
    // must not scale with the size being refused.
    let size = std::fs::metadata(&manifest_path)?.len();
    if size > MAX_THEME_MANIFEST_BYTES {
        return Err(PluginError::Refused(format!(
            "{THEME_MANIFEST_FILE} is {size} bytes, over the {MAX_THEME_MANIFEST_BYTES}-byte limit"
        )));
    }
    let text = std::fs::read_to_string(&manifest_path)?;
    let head: ThemeManifestId = serde_json::from_str(&text)?;
    if head.id.is_empty()
        || !head
            .id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(PluginError::InvalidManifest(
            "theme id must be non-empty and contain only lowercase letters, digits, and hyphens"
                .to_string(),
        ));
    }
    let digest = hex_sha256(text.as_bytes());
    Ok((head.id, text, digest))
}

/// Whether `kind` may commit through [`commit_staged_install`]. §379 — [`InstallKind::Plugin`]
/// is refused: `commands::plugin_cmd::plugin_install_commit` goes through
/// [`commit_staged_plugin_install`] instead, the only entry point that runs the
/// developer-mode refusal on the checked id, and a plugin routed through
/// [`commit_staged_install`] would skip that. Refused outright here rather than merely
/// documented as the wrong entry point — see `plugin_cmd.rs`'s
/// `the_plugin_install_commit_goes_through_the_dev_folder_boundary` (the caller is wired
/// right) and this module's `commit_staged_install_refuses_a_plugin_before_resolving_a_root`
/// (this function refuses on its own even if a caller got that wrong).
///
/// A PURE function — no `install_root`, no stage lookup, nothing on disk — on purpose: the
/// caller ([`commit_staged_install`]) runs it before anything that would resolve or create
/// the real `~/.baram/plugins` or `~/.baram/themes`, and keeping this free of I/O is what
/// lets it be unit-tested without touching either.
fn refuse_plugin_kind(kind: InstallKind) -> Result<(), PluginError> {
    if matches!(kind, InstallKind::Plugin) {
        return Err(PluginError::Refused(
            "a plugin commit must go through commit_staged_plugin_install, not \
             commit_staged_install — it is the only entry point that runs the \
             developer-mode refusal (§379)"
                .into(),
        ));
    }
    Ok(())
}

/// Atomically replace any version already installed with a staged one. `kind` (§360) still
/// takes the enum, but [`InstallKind::Plugin`] is refused as the very first thing this
/// function does, by [`refuse_plugin_kind`] — before `install_root`, before resolving the
/// stage, before anything on disk is touched — so in practice this only ever commits
/// [`InstallKind::Theme`]. See [`refuse_plugin_kind`]'s own doc for why a plugin is refused
/// rather than merely documented as the wrong entry point.
///
/// The two are the only destructive half of an install, and the only thing they can destroy
/// is the staged tree: see [`swap_into_place`] for why the previously installed version
/// survives every failure here.
///
/// ‼️ The manifest is RE-READ and RE-VALIDATED from disk rather than trusted from the
/// [`stage_install`] result. The caller chooses which stage id to commit, so treating the
/// earlier return value as authoritative would let a caller stage two plugins and commit one
/// under the other's name — and the id is what names the install directory.
///
/// `kind` (§360) MUST be the same one passed to the [`stage_install`] call that produced
/// `stage_id` — it is not recorded anywhere that ties the two together. Passing the wrong
/// one fails safely, though: `resolve_stage_in` looks for `stage_id` under the OTHER tree's
/// `.staging/`, will not find it there, and returns [`PluginError::NotFound`] rather than
/// resolving to some unrelated directory.
///
/// ‼️ `stored_css` (§360) IS WHY THE HYGIENE PIPELINE IS SAFE, and it is a parameter of the
/// COMMIT rather than a write of its own. `sanitizeThemeCss` → `inlineThemeAssets` runs on
/// the frontend against the staged tree; its output is written into that staged tree here,
/// immediately before [`swap_into_place`] publishes it. So there is no moment at which the
/// installed directory holds CSS that nothing sanitized: the swap is what creates the
/// directory, and the sanitized files are already in it. A separate "write into the stage"
/// command would have opened that window AND handed the webview a write path; this closes
/// both by making the write something only a commit can do.
///
/// `Some`, even an empty one (a theme may declare only `tokens`) — the only kind that still
/// reaches this parameter through THIS function is [`InstallKind::Theme`], since
/// [`InstallKind::Plugin`] is refused before `stored_css` is ever looked at. The
/// `(Plugin, None)` arm `checked_stage_in` still matches on is reached only through
/// [`commit_staged_plugin_install`], which is the sole remaining caller that passes
/// `InstallKind::Plugin`.
pub async fn commit_staged_install(
    kind: InstallKind,
    stage_id: &str,
    expected_id: &str,
    expected_manifest_sha256: &str,
    stored_css: Option<StoredThemeCss>,
) -> Result<CommittedInstall, PluginError> {
    refuse_plugin_kind(kind)?;
    let stage_id = stage_id.to_owned();
    let expected_id = expected_id.to_owned();
    let expected_digest = expected_manifest_sha256.to_owned();
    tokio::task::spawn_blocking(move || {
        commit_staged_in(
            &install_root(kind)?,
            kind,
            &stage_id,
            &expected_id,
            &expected_digest,
            stored_css.as_ref(),
        )
    })
    .await
    .map_err(|_| PluginError::Refused("the plugin install task did not finish".into()))?
}

/// §379 — [`commit_staged_install`] for a plugin, with `refuse` run on the checked id before
/// the swap. `commands::plugin_cmd::plugin_install_commit` passes the ids a developer-mode
/// folder holds (`plugin_dev_cmd::install_refusal`).
pub async fn commit_staged_plugin_install(
    stage_id: &str,
    expected_id: &str,
    expected_manifest_sha256: &str,
    refuse: impl FnOnce(&str) -> Result<(), PluginError> + Send + 'static,
) -> Result<CommittedInstall, PluginError> {
    let stage_id = stage_id.to_owned();
    let expected_id = expected_id.to_owned();
    let expected_digest = expected_manifest_sha256.to_owned();
    tokio::task::spawn_blocking(move || {
        commit_staged_plugin_in(
            &install_root(InstallKind::Plugin)?,
            &stage_id,
            &expected_id,
            &expected_digest,
            refuse,
        )
    })
    .await
    .map_err(|_| PluginError::Refused("the plugin install task did not finish".into()))?
}

/// The checks a commit makes before touching anything installed, up to but not including the
/// one a plugin commit adds in between: the stage resolves, its manifest is the digest the
/// caller judged and names the expected id, and the CSS argument matches the kind. Split from
/// the swap so a plugin commit can refuse on the checked id after these checks return and
/// before the swap runs (§379, `commit_staged_plugin_in`).
///
/// ‼️ For a theme this also WRITES the sanitized CSS into the stage (`write_stored_theme_css`)
/// — nothing may be inserted between it and the swap for a theme. See `stored_css` on
/// [`commit_staged_install`]: the sanitized files are safe because the very next step, the
/// swap, publishes them.
fn checked_stage_in(
    plugin_root: &Path,
    kind: InstallKind,
    stage_id: &str,
    expected_id: &str,
    expected_manifest_sha256: &str,
    stored_css: Option<&StoredThemeCss>,
) -> Result<(PathBuf, StagedManifest), PluginError> {
    let staged = resolve_stage_in(plugin_root, stage_id)?;
    let (manifest, digest) = read_staged_manifest_of(kind, &staged)?;
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
    if manifest.id() != expected_id {
        return Err(PluginError::InvalidManifest(format!(
            "staged plugin declares id \"{}\" but \"{expected_id}\" was requested",
            manifest.id()
        )));
    }
    match (&manifest, stored_css) {
        (StagedManifest::Theme { .. }, Some(css)) => write_stored_theme_css(&staged, css)?,
        (StagedManifest::Theme { .. }, None) => {
            return Err(PluginError::Refused(
                "a theme commit must carry its sanitized CSS".into(),
            ))
        }
        (StagedManifest::Plugin(_), Some(_)) => {
            return Err(PluginError::Refused(
                "a plugin commit cannot carry theme CSS".into(),
            ))
        }
        (StagedManifest::Plugin(_), None) => {}
    }
    Ok((staged, manifest))
}

/// The swap half of a commit, on a stage `checked_stage_in` has passed.
fn swap_checked_in(
    plugin_root: &Path,
    staged: &Path,
    manifest: StagedManifest,
) -> Result<CommittedInstall, PluginError> {
    // Safe to join: both manifest readers admit only `[a-z0-9-]` as an id, so it is a
    // single segment that cannot escape the install root.
    let target_dir = plugin_root.join(manifest.id());
    let backup = staging_root_in(plugin_root)?.join(backup_name(manifest.id()));
    swap_into_place(staged, &target_dir, &backup)?;
    Ok(CommittedInstall {
        install_path: target_dir.to_string_lossy().to_string(),
        manifest,
    })
}

fn commit_staged_in(
    plugin_root: &Path,
    kind: InstallKind,
    stage_id: &str,
    expected_id: &str,
    expected_manifest_sha256: &str,
    stored_css: Option<&StoredThemeCss>,
) -> Result<CommittedInstall, PluginError> {
    let (staged, manifest) = checked_stage_in(
        plugin_root,
        kind,
        stage_id,
        expected_id,
        expected_manifest_sha256,
        stored_css,
    )?;
    swap_checked_in(plugin_root, &staged, manifest)
}

/// §379 — a PLUGIN commit with one more refusal, on the id the swap is about to install: the
/// staged manifest's, after its digest and id checks and before anything moves. A refusal
/// leaves the stage for the caller's discard, like every other refusal here.
fn commit_staged_plugin_in(
    plugin_root: &Path,
    stage_id: &str,
    expected_id: &str,
    expected_manifest_sha256: &str,
    refuse: impl FnOnce(&str) -> Result<(), PluginError>,
) -> Result<CommittedInstall, PluginError> {
    let (staged, manifest) = checked_stage_in(
        plugin_root,
        InstallKind::Plugin,
        stage_id,
        expected_id,
        expected_manifest_sha256,
        None,
    )?;
    refuse(manifest.id())?;
    swap_checked_in(plugin_root, &staged, manifest)
}

/// §360 — write a theme's sanitized CSS into the STAGED tree, under [`STORED_CSS_DIR`].
///
/// ‼️ THE DIRECTORY IS REMOVED FIRST, and that is not tidiness. An archive may ship a
/// `.stored/` of its own; anything left in it would be un-sanitized author CSS sitting at
/// the exact path the load path reads, for any mode this call does not overwrite. Removing
/// the whole directory makes "everything under `.stored/` came out of the hygiene pipeline"
/// structural rather than a property of which modes happened to declare CSS.
fn write_stored_theme_css(staged: &Path, css: &StoredThemeCss) -> Result<(), PluginError> {
    let dir = staged.join(STORED_CSS_DIR);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    std::fs::create_dir_all(&dir)?;
    for (mode, body) in [
        (ThemeMode::Dark, css.dark.as_deref()),
        (ThemeMode::Light, css.light.as_deref()),
    ] {
        let Some(body) = body else { continue };
        if body.len() > MAX_STORED_THEME_CSS_BYTES {
            return Err(PluginError::Refused(format!(
                "stored theme CSS for {} is {} bytes, over the {MAX_STORED_THEME_CSS_BYTES}-byte \
                 limit",
                mode.file_name(),
                body.len()
            )));
        }
        std::fs::write(dir.join(mode.file_name()), body)?;
    }
    Ok(())
}

/// §360 — read one file out of a staged tree, for the frontend's hygiene pipeline.
///
/// This is what lets `theme-install.ts` read the authored CSS, a mode's `tokens.json` and
/// every bundled asset out of a tree that has not been installed yet. `rel` crosses the IPC
/// boundary, so containment is [`resolve_within`]'s canonicalize-and-compare rather than
/// anything spelled on the string; `stage_id` is `resolve_stage_in`'s, so the worst a
/// malformed one can name is another staging tree.
///
/// ‼️ NOTHING HERE DECODES `rel`. A reference spelled `%2e%2e/x.png` names a directory
/// literally called `%2e%2e`, which is exactly what `ThemeAssetReader`'s contract
/// (`src/utils/theme-css/inline-assets.ts`) requires: that module refuses `%` in a
/// reference precisely because a reader that percent-decoded would make its containment
/// verdict meaningless, and a reader is only as good as that promise.
///
/// ‼️ `max_bytes` IS THE CALLER'S OWN CAP, AND ITS ABSENCE IS NOT A LOOPHOLE (external
/// review #2). [`MAX_STAGED_FILE_BYTES`] still bounds every read; a caller that states a
/// TIGHTER one gets the tighter one, and one that states a larger one still gets ours —
/// `min` rather than a replacement, so the webview cannot raise the ceiling by asking.
///
/// It exists because the theme path was the one input that bypassed the rule this crate
/// already implements. `read_bytes_capped` stats before it reads, and `refuse_over_cap`'s
/// own doc calls that "the 'never allocate to measure' rule has one implementation" — but
/// the frontend's real caps for a staged manifest and stylesheet are 64 KiB and 512 KiB
/// (`src/themes/theme-store-fs.ts`), applied to a `Uint8Array` that had already been read,
/// serialized and transferred. A 7.9 MiB file passed our 8 MiB cap, crossed the IPC
/// boundary, and was refused after every one of those costs was paid.
pub async fn read_staged_file(
    kind: InstallKind,
    stage_id: &str,
    rel: &str,
    max_bytes: Option<u64>,
) -> Result<Vec<u8>, PluginError> {
    let staged = resolve_stage_in(&install_root(kind)?, stage_id)?;
    let path = resolve_within(&staged, rel).map_err(PluginError::Refused)?;
    let cap = max_bytes.map_or(MAX_STAGED_FILE_BYTES, |requested| {
        requested.min(MAX_STAGED_FILE_BYTES)
    });
    read_bytes_capped(&path, cap)
        .await
        .map_err(|e| PluginError::Refused(format!("\"{rel}\" {e}")))
}

/// §360 — read an installed theme's stored CSS for one mode.
///
/// The load-time counterpart of [`write_stored_theme_css`]. Neither argument can contribute
/// a path component the caller chose: `theme_id` goes through [`single_segment`] and `mode`
/// is a closed enum whose file name this module owns.
///
/// [`PluginError::NotFound`] when that mode has no stored CSS — a theme may declare only
/// `tokens`, so absence is ordinary rather than a failure.
pub async fn read_stored_theme_css(theme_id: &str, mode: ThemeMode) -> Result<String, PluginError> {
    let seg = single_segment(theme_id)
        .ok_or_else(|| PluginError::InvalidManifest(format!("invalid theme id: {theme_id}")))?;
    let path = get_theme_dir()?
        .join(seg)
        .join(STORED_CSS_DIR)
        .join(mode.file_name());
    if !path.exists() {
        return Err(PluginError::NotFound(format!(
            "{theme_id}/{}",
            mode.file_name()
        )));
    }
    read_text_capped(&path, MAX_STORED_THEME_CSS_BYTES as u64)
        .await
        .map_err(PluginError::Refused)
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
///
/// `kind` (§360) MUST match what the stage was created with — see [`commit_staged_install`]'s
/// doc comment for why a mismatch fails safely rather than reaching the wrong tree.
pub async fn discard_staged_install(kind: InstallKind, stage_id: &str) -> Result<(), PluginError> {
    let stage_id = stage_id.to_owned();
    tokio::task::spawn_blocking(move || discard_staged_in(&install_root(kind)?, &stage_id))
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
/// calls [`discard_staged_install`], which can only ever remove a staging directory. Nothing
/// reaches this function except a user asking to uninstall.
///
/// `kind` (§360) chooses which tree `plugin_id` is looked up in — see [`InstallKind`].
pub async fn uninstall_installed(kind: InstallKind, plugin_id: &str) -> Result<(), PluginError> {
    uninstall_in(&install_root(kind)?, plugin_id)
}

/// ‼️ AN ABSENT DIRECTORY IS SUCCESS, NOT [`PluginError::NotFound`] (0090 final review, M3).
///
/// This used to refuse, and the refusal produced a record nobody could remove. The frontend
/// keeps the list of what is installed (themes deliberately so — `theme-store-fs.ts`'s
/// header), and it deletes the directory BEFORE dropping its record. A crash between the two,
/// a manual `rm` of the install directory, a restored backup of `config.json` — any of them
/// leaves a record whose directory is gone, and every later Remove hit this branch, failed,
/// and left the record exactly where it was. The card stayed forever.
///
/// "Uninstall" asks for a postcondition, not for a deletion event: afterwards this id is not
/// installed. When the directory is already absent that postcondition already holds, so
/// reporting failure was both wrong and unrecoverable.
///
/// The backup drop below still runs in that case, and must: an interrupted swap is the other
/// way the install path goes missing, and leaving its backup behind would let
/// `recover_orphaned_backups` restore a theme the user just asked to remove.
fn uninstall_in(plugin_root: &Path, plugin_id: &str) -> Result<(), PluginError> {
    let seg = single_segment(plugin_id)
        .ok_or_else(|| PluginError::InvalidManifest(format!("invalid plugin id: {plugin_id}")))?;
    let target_dir = plugin_root.join(seg);
    if target_dir.exists() {
        std::fs::remove_dir_all(&target_dir)?;
    }
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

    /// The PLUGIN arm of [`stage_archive_in`], unwrapped.
    ///
    /// §360 gave that core a `kind` and an enum return so a theme archive could use the
    /// same sequence. Every #261 test below stages a plugin and asserts on plugin manifest
    /// fields, so they call this instead of carrying the same two-line `match` thirteen
    /// times. The panic is a test-harness assertion, not a code path: the arm is chosen by
    /// the `kind` this function itself passes.
    fn stage_plugin_archive_in(
        plugin_root: &Path,
        bytes: &[u8],
        expected_id: Option<&str>,
    ) -> Result<(String, PluginManifest, String), PluginError> {
        let (stage_id, manifest, digest) =
            stage_archive_in(plugin_root, InstallKind::Plugin, bytes, expected_id)?;
        match manifest {
            StagedManifest::Plugin(manifest) => Ok((stage_id, *manifest, digest)),
            StagedManifest::Theme { .. } => panic!("a plugin archive yielded a theme manifest"),
        }
    }

    /// The PLUGIN arm of [`commit_staged_in`], unwrapped. See [`stage_plugin_archive_in`].
    fn commit_plugin_staged_in(
        plugin_root: &Path,
        stage_id: &str,
        expected_id: &str,
        expected_manifest_sha256: &str,
    ) -> Result<CommittedPluginInfo, PluginError> {
        commit_staged_in(
            plugin_root,
            InstallKind::Plugin,
            stage_id,
            expected_id,
            expected_manifest_sha256,
            None,
        )?
        .into_plugin()
    }

    #[test]
    fn test_hex_sha256() {
        let hash = hex_sha256(b"hello");
        assert_eq!(
            hash,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    /// §379 — [`refuse_plugin_kind`] is pure, so this exercises it directly rather than
    /// through the async `commit_staged_install` (which would need a real install root to
    /// reach a stage lookup — see the source-scan test below for why this function never
    /// gets that far for a plugin).
    #[test]
    fn refuse_plugin_kind_refuses_a_plugin_and_admits_a_theme() {
        assert_eq!(
            refuse_plugin_kind(InstallKind::Plugin)
                .unwrap_err()
                .to_string(),
            "a plugin commit must go through commit_staged_plugin_install, not \
             commit_staged_install — it is the only entry point that runs the \
             developer-mode refusal (§379)"
        );
        assert!(refuse_plugin_kind(InstallKind::Theme).is_ok());
    }

    /// §379 — pins the ORDER inside `commit_staged_install`'s body: `refuse_plugin_kind(kind)?`
    /// must run before `install_root(`, because `install_root` is what resolves — and on a
    /// missing directory, CREATES — the real `~/.baram/plugins` or `~/.baram/themes`
    /// (`get_plugin_dir` / `get_theme_dir`, `storage.rs`). A regression here cannot be caught
    /// by a behavioural test the way the rest of this module's install-lifecycle tests catch
    /// regressions, because calling the real async function to observe the order would be the
    /// very thing this guards against — see `refuse_plugin_kind_refuses_a_plugin_and_admits_a_theme`
    /// above for the async function's pure half instead. Comment lines are dropped before
    /// squashing so a doc comment merely MENTIONING `install_root(` in prose (this function's
    /// own doc comment does) cannot satisfy the assertion in place of the real call.
    #[test]
    fn commit_staged_install_refuses_a_plugin_before_resolving_a_root() {
        let src = include_str!("install.rs");
        let start = src
            .find("pub async fn commit_staged_install(")
            .expect("commit_staged_install is defined in this file");
        let end = src[start..]
            .find("pub async fn commit_staged_plugin_install")
            .expect("commit_staged_plugin_install follows commit_staged_install");
        let body: String = src[start..start + end]
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n")
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect();

        let refusal = body.find("refuse_plugin_kind(kind)?");
        let root = body.find("install_root(");
        assert!(
            refusal.is_some(),
            "commit_staged_install no longer calls refuse_plugin_kind(kind)? — a plugin \
             commit routed here would no longer refuse on its own"
        );
        assert!(
            root.is_some(),
            "install_root( is missing from commit_staged_install — this scan's own \
             assumption about the function's shape is stale"
        );
        assert!(
            refusal < root,
            "refuse_plugin_kind(kind)? must run BEFORE install_root( — otherwise a plugin \
             commit resolves (and can create) the real ~/.baram/plugins or ~/.baram/themes \
             before it is refused"
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

        let (stage_id, manifest, _digest) = stage_plugin_archive_in(
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

        let (stage_id, _, digest) = stage_plugin_archive_in(
            root.path(),
            &plugin_zip("demo", "2.0.0", "v2"),
            Some("demo"),
        )
        .unwrap();
        let committed = commit_plugin_staged_in(root.path(), &stage_id, "demo", &digest).unwrap();

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
            stage_plugin_archive_in(root.path(), &plugin_zip("demo", "1.0.0", "v1"), None).unwrap();
        commit_plugin_staged_in(root.path(), &stage_id, "demo", &digest).unwrap();

        assert_eq!(
            std::fs::read_to_string(root.path().join("demo").join("main.js")).unwrap(),
            "v1"
        );
    }

    /// §379 — the plugin commit's last refusal sees the id the swap would install (the
    /// digest-checked staged manifest's), and a refusal installs nothing and leaves the stage
    /// for the caller's `plugin_install_discard`.
    #[test]
    fn a_refused_plugin_commit_installs_nothing() {
        let root = tempfile::tempdir().unwrap();
        let (stage_id, _, digest) =
            stage_plugin_archive_in(root.path(), &plugin_zip("demo", "1.0.0", "v1"), None).unwrap();
        let mut seen = None;

        let err = commit_staged_plugin_in(root.path(), &stage_id, "demo", &digest, |id| {
            seen = Some(id.to_string());
            Err(PluginError::Refused("DEV_PLUGIN_ID_HELD".into()))
        })
        .expect_err("the refusal must stop the commit");

        assert_eq!(err.to_string(), "DEV_PLUGIN_ID_HELD");
        assert_eq!(seen.as_deref(), Some("demo"));
        assert!(
            !root.path().join("demo").exists(),
            "nothing may be installed"
        );
        assert!(
            resolve_stage_in(root.path(), &stage_id).is_ok(),
            "the stage is left for the caller to discard"
        );
    }

    /// The twin: an allowing refusal installs exactly as `commit_staged_in` does.
    #[test]
    fn an_allowing_plugin_commit_installs_like_the_plain_one() {
        let root = tempfile::tempdir().unwrap();
        let (stage_id, _, digest) =
            stage_plugin_archive_in(root.path(), &plugin_zip("demo", "1.0.0", "v1"), None).unwrap();

        commit_staged_plugin_in(root.path(), &stage_id, "demo", &digest, |_| Ok(()))
            .unwrap()
            .into_plugin()
            .unwrap();

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
            stage_plugin_archive_in(root.path(), &plugin_zip("attacker", "1.0.0", "evil"), None)
                .unwrap();
        let err = commit_plugin_staged_in(root.path(), &stage_id, "victim", &digest)
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

        let err = stage_plugin_archive_in(
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
        let (stage_id, _, _digest) = stage_plugin_archive_in(
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
        let (real, _, _) = stage_plugin_archive_in(
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
        // while `discard_staged_install("<a real stage>/../../demo")` would resolve to an
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

        stage_plugin_archive_in(root.path(), &plugin_zip("other", "1.0.0", "x"), None).unwrap();

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

    /// 0090 final review (M3) — uninstalling something already gone SUCCEEDS.
    ///
    /// The frontend deletes the directory and only then drops its record, so a crash between
    /// the two leaves a record whose directory is absent. While this returned `NotFound`,
    /// every later Remove failed and the record could never be dropped: a permanent card.
    ///
    /// The sibling below is what keeps this from being satisfiable by deleting the whole
    /// function: uninstalling a plugin that IS there still removes its directory.
    #[test]
    fn uninstalling_something_already_gone_succeeds() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path()).unwrap();

        uninstall_in(root.path(), "never-installed").unwrap();

        assert!(!root.path().join("never-installed").exists());
    }

    /// The positive half of the pair above, and the reason it is here rather than assumed:
    /// "absent is fine" must not become "nothing is ever deleted".
    #[test]
    fn uninstalling_something_present_removes_its_directory() {
        let root = tempfile::tempdir().unwrap();
        install_by_hand(root.path(), "demo", "v2");
        assert!(root.path().join("demo").exists());

        uninstall_in(root.path(), "demo").unwrap();

        assert!(!root.path().join("demo").exists());
    }

    /// An id that is not a single path segment is still refused — idempotence is about a
    /// MISSING directory, not about relaxing containment.
    #[test]
    fn uninstalling_a_traversing_id_is_still_refused() {
        let root = tempfile::tempdir().unwrap();
        assert!(uninstall_in(root.path(), "../escape").is_err());
    }

    /// …but an uninstall must not leave one for the recovery to resurrect.
    ///
    /// ‼️ Driven through `uninstall_in`, NOT through `drop_backups_for`. The first version of
    /// this test called the helper directly and mutation testing walked straight past it:
    /// deleting the call from `uninstall_installed` left it green, because a test of a helper
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
        stage_plugin_archive_in(root.path(), &plugin_zip("other", "1.0.0", "x"), None).unwrap();
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
        let (stage_id, manifest, digest) = stage_plugin_archive_in(
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

        let err = commit_plugin_staged_in(root.path(), &stage_id, "demo", &digest)
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
            stage_plugin_archive_in(root.path(), &plugin_zip("one", "1.0.0", "a"), Some("one"))
                .unwrap();
        let (second, _, _) =
            stage_plugin_archive_in(root.path(), &plugin_zip("two", "1.0.0", "b"), Some("two"))
                .unwrap();

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
        let err =
            stage_plugin_archive_in(root.path(), &plugin_zip(STAGING_DIR, "1.0.0", "x"), None)
                .expect_err("a plugin claiming the staging directory's name must be refused");

        assert!(
            err.to_string().contains("lowercase letters"),
            "expected the id-charset refusal, got: {err}"
        );
    }

    // §360 fix round 1 (MEDIUM-1) — this used to be two tests, `theme_root` tempdirs
    // renamed from `root`, that drove `stage_archive_in` / `commit_staged_in` /
    // `swap_into_place` and asserted the sequence and the #261 rollback guarantee "work
    // against a theme root". They were removed: proven by mutation, they could not fail
    // for anything Task 3 introduced. Calling a `tempdir()` `theme_root` does not make it
    // one — these three functions never read the name of the root they are handed, which
    // is exactly why every test ABOVE this comment, none of which mentions a theme, already
    // covers them nineteen times over. There is no proposition left to prove here: the
    // cores are root-agnostic BY CONSTRUCTION (they take `plugin_root: &Path` and never
    // inspect it), and #261's rollback lives entirely in `swap_into_place`, which sees only
    // paths. What Task 3 actually added — `InstallKind` resolving to a DIFFERENT real
    // directory per kind — is pinned in `storage.rs`'s
    // `install_root_resolves_each_kind_to_its_own_directory_name`, the one test that
    // mentions `InstallKind` and the only one a mutation of `install_root`'s theme arm
    // could fail.

    // --- §360: the theme arm --------------------------------------------------------
    //
    // These DO have a proposition to prove, unlike the two deleted above: each one drives
    // a branch that reads `kind`, or a step that exists only for a theme. Every assertion
    // below fails if the theme arm is removed, which the tests above cannot say.

    /// A theme archive: `baram-theme.json` plus whatever else `entries` names.
    fn theme_zip(id: &str, entries: &[(&str, &[u8])]) -> Vec<u8> {
        let manifest = format!(
            r#"{{"id":"{id}","name":"N","description":"d","version":"1.0.0",
             "author":"a","license":"MIT","engines":{{"baram":">=0.1.0"}},
             "modes":{{"light":{{"css":"light/theme.css"}}}}}}"#
        );
        let mut all: Vec<(&str, &[u8])> = vec![("baram-theme.json", manifest.as_bytes())];
        all.extend_from_slice(entries);
        zip_of(&all)
    }

    fn stage_theme_archive_in(
        theme_root: &Path,
        bytes: &[u8],
        expected_id: Option<&str>,
    ) -> Result<(String, String, String), PluginError> {
        let (stage_id, manifest, digest) =
            stage_archive_in(theme_root, InstallKind::Theme, bytes, expected_id)?;
        match manifest {
            StagedManifest::Theme { id, .. } => Ok((stage_id, id, digest)),
            StagedManifest::Plugin(_) => panic!("a theme archive yielded a plugin manifest"),
        }
    }

    /// The seam Task 3 left open and this task closes: a theme archive ships
    /// `baram-theme.json`, and until `read_staged_manifest_of` branched on `kind` the theme
    /// arm refused every real package with "baram-plugin.json not found in archive".
    #[test]
    fn a_theme_archive_stages_from_its_own_manifest_file() {
        let root = tempfile::tempdir().unwrap();
        let (_stage_id, id, _digest) = stage_theme_archive_in(
            root.path(),
            &theme_zip("dracula", &[("light/theme.css", b"a{color:red}")]),
            Some("dracula"),
        )
        .unwrap();
        assert_eq!(id, "dracula");
    }

    /// The two kinds do not accept each other's manifests. Both directions, because a
    /// branch that fell through to the plugin reader would pass the first half alone.
    #[test]
    fn neither_kind_accepts_the_other_kinds_manifest() {
        let root = tempfile::tempdir().unwrap();
        let as_plugin =
            stage_plugin_archive_in(root.path(), &theme_zip("dracula", &[]), None).unwrap_err();
        assert!(
            as_plugin
                .to_string()
                .contains("baram-plugin.json not found"),
            "unexpected: {as_plugin}"
        );
        let as_theme = stage_archive_in(
            root.path(),
            InstallKind::Theme,
            &plugin_zip("demo", "1.0.0", "v1"),
            None,
        )
        .unwrap_err();
        assert!(
            as_theme.to_string().contains("baram-theme.json not found"),
            "unexpected: {as_theme}"
        );
    }

    /// The id names the install directory, so it is the one theme-manifest field Rust
    /// cannot delegate to `validateThemeManifest`.
    #[test]
    fn a_theme_id_outside_the_allowed_charset_is_refused() {
        let root = tempfile::tempdir().unwrap();
        for bad in ["../escape", "Upper", "with space", ""] {
            let manifest = format!(
                r#"{{"id":"{bad}","name":"N","version":"1.0.0","modes":{{"light":{{"css":"c"}}}}}}"#
            );
            let zip = zip_of(&[("baram-theme.json", manifest.as_bytes())]);
            let err = stage_archive_in(root.path(), InstallKind::Theme, &zip, None).unwrap_err();
            assert!(
                err.to_string().contains("theme id must be"),
                "id {bad:?} was not refused for its charset: {err}"
            );
        }
    }

    /// ‼️ The ordering property in one assertion: the sanitized CSS is already at the
    /// install path the instant that path exists. Nothing writes it afterwards, so there is
    /// no window in which the installed directory holds CSS that never went through the
    /// hygiene pipeline.
    #[test]
    fn committing_a_theme_publishes_the_stored_css_with_the_swap() {
        let root = tempfile::tempdir().unwrap();
        let (stage_id, _id, digest) = stage_theme_archive_in(
            root.path(),
            &theme_zip("dracula", &[("light/theme.css", b"a{color:red}")]),
            None,
        )
        .unwrap();
        let committed = commit_staged_in(
            root.path(),
            InstallKind::Theme,
            &stage_id,
            "dracula",
            &digest,
            Some(&StoredThemeCss {
                dark: None,
                light: Some("@layer baram-theme{a{color:red}}".into()),
            }),
        )
        .unwrap()
        .into_theme()
        .unwrap();

        assert_eq!(committed.id, "dracula");
        let stored = root.path().join("dracula").join(STORED_CSS_DIR);
        assert_eq!(
            std::fs::read_to_string(stored.join("light.css")).unwrap(),
            "@layer baram-theme{a{color:red}}"
        );
        // The mode that declared no CSS gets no file — absence is how the load path learns
        // that mode has tokens only.
        assert!(!stored.join("dark.css").exists());
        // The AUTHORED css is still in the package and still un-sanitized; that is fine,
        // and it is also why the load path reads `.stored/` rather than the manifest's
        // path. See `STORED_CSS_DIR`.
        assert!(root.path().join("dracula/light/theme.css").exists());
    }

    /// ‼️ An archive may ship its own `.stored/`, and anything left in it would be
    /// un-sanitized author CSS sitting at the exact path the load path reads. Removing the
    /// whole directory before writing is what makes "everything under `.stored/` came out
    /// of the pipeline" true for modes this commit does not write.
    #[test]
    fn an_archive_shipped_stored_directory_does_not_survive_the_commit() {
        let root = tempfile::tempdir().unwrap();
        let smuggled: &[(&str, &[u8])] = &[
            (".stored/dark.css", b"a{background:url(https://evil/x)}"),
            (".stored/extra.css", b"a{color:blue}"),
        ];
        let (stage_id, _id, digest) =
            stage_theme_archive_in(root.path(), &theme_zip("dracula", smuggled), None).unwrap();
        commit_staged_in(
            root.path(),
            InstallKind::Theme,
            &stage_id,
            "dracula",
            &digest,
            // Only `light` is written; `dark.css` and `extra.css` are the archive's.
            Some(&StoredThemeCss {
                dark: None,
                light: Some("@layer baram-theme{}".into()),
            }),
        )
        .unwrap();

        let stored = root.path().join("dracula").join(STORED_CSS_DIR);
        assert!(stored.join("light.css").exists());
        assert!(
            !stored.join("dark.css").exists(),
            "an archive-shipped .stored/dark.css survived the commit"
        );
        assert!(!stored.join("extra.css").exists());
    }

    /// The cap the frontend refuses at is the cap the backend enforces — see
    /// `MAX_STORED_THEME_CSS_BYTES`. A commit that got past the frontend's check must not
    /// write the file anyway.
    #[test]
    fn stored_css_over_the_cap_is_refused_and_nothing_is_installed() {
        let root = tempfile::tempdir().unwrap();
        let (stage_id, _id, digest) =
            stage_theme_archive_in(root.path(), &theme_zip("dracula", &[]), None).unwrap();
        let err = commit_staged_in(
            root.path(),
            InstallKind::Theme,
            &stage_id,
            "dracula",
            &digest,
            Some(&StoredThemeCss {
                dark: None,
                light: Some("x".repeat(MAX_STORED_THEME_CSS_BYTES + 1)),
            }),
        )
        .unwrap_err();
        assert!(err.to_string().contains("over the"), "unexpected: {err}");
        assert!(
            !root.path().join("dracula").exists(),
            "the refusal still installed the theme"
        );
    }

    /// The `stored_css` parameter is not optional decoration on either side: a theme
    /// commit without it, or a plugin commit with it, is refused rather than silently
    /// installing a theme whose stylesheet never arrives.
    #[test]
    fn stored_css_must_match_the_kind_being_committed() {
        let root = tempfile::tempdir().unwrap();
        let (theme_stage, _id, theme_digest) =
            stage_theme_archive_in(root.path(), &theme_zip("dracula", &[]), None).unwrap();
        let err = commit_staged_in(
            root.path(),
            InstallKind::Theme,
            &theme_stage,
            "dracula",
            &theme_digest,
            None,
        )
        .unwrap_err();
        assert!(
            err.to_string().contains("must carry its sanitized CSS"),
            "unexpected: {err}"
        );

        let (plugin_stage, _m, plugin_digest) =
            stage_plugin_archive_in(root.path(), &plugin_zip("demo", "1.0.0", "v1"), None).unwrap();
        let err = commit_staged_in(
            root.path(),
            InstallKind::Plugin,
            &plugin_stage,
            "demo",
            &plugin_digest,
            Some(&StoredThemeCss::default()),
        )
        .unwrap_err();
        assert!(
            err.to_string().contains("cannot carry theme CSS"),
            "unexpected: {err}"
        );
    }

    /// The TOCTOU digest covers a theme manifest exactly as it covers a plugin one — the
    /// frontend validates `baram-theme.json` between the two IPC calls, so the commit must
    /// refuse a file that changed since.
    #[test]
    fn a_theme_manifest_edited_after_staging_is_refused_at_commit() {
        let root = tempfile::tempdir().unwrap();
        let (stage_id, _id, digest) =
            stage_theme_archive_in(root.path(), &theme_zip("dracula", &[]), None).unwrap();
        let staged = resolve_stage_in(root.path(), &stage_id).unwrap();
        std::fs::write(
            staged.join("baram-theme.json"),
            br#"{"id":"dracula","name":"Swapped","version":"9.9.9",
                "modes":{"light":{"css":"light/theme.css"}}}"#,
        )
        .unwrap();
        let err = commit_staged_in(
            root.path(),
            InstallKind::Theme,
            &stage_id,
            "dracula",
            &digest,
            Some(&StoredThemeCss::default()),
        )
        .unwrap_err();
        assert!(
            err.to_string().contains("changed after it was checked"),
            "unexpected: {err}"
        );
        assert!(!root.path().join("dracula").exists());
    }

    /// A theme manifest past the raw cap is refused BEFORE `serde_json` walks it. Measured
    /// by metadata, so the refusal does not allocate what it is refusing.
    #[test]
    fn an_oversized_theme_manifest_is_refused() {
        let root = tempfile::tempdir().unwrap();
        let padding = "x".repeat(MAX_THEME_MANIFEST_BYTES as usize);
        let manifest =
            format!(r#"{{"id":"dracula","description":"{padding}","modes":{{"light":{{}}}}}}"#);
        let zip = zip_of(&[("baram-theme.json", manifest.as_bytes())]);
        let err = stage_archive_in(root.path(), InstallKind::Theme, &zip, None).unwrap_err();
        assert!(
            err.to_string().contains("over the") && err.to_string().contains("baram-theme.json"),
            "unexpected: {err}"
        );
    }

    /// 0091 fix round 1, Finding 3 (MAJOR) — makes the reviewer's manual probe
    /// (`task-3-review.md`) permanent. Shares `fixtures/theme-package.json` with the
    /// frontend (`src/themes/__tests__/theme-package-fixture.test.ts`): that side asserts
    /// `themePackageEntries(fixture.theme, fixture.meta)` reproduces `expectedManifest` and
    /// `expectedEntryNames` exactly; this side builds a package to that same spec and proves
    /// the REAL install functions accept it — the exact chain `theme_cmd::theme_package_build`
    /// 's bytes go through once installed (`build_zip_bytes` → `extract_zip_bytes` →
    /// `read_staged_theme_manifest`). Neither side derives from the other at test time; both
    /// independently read the fixture, the same idiom `fixtures/manifest-boundary.json`
    /// already uses for the plugin-manifest boundary (`registry.rs`).
    #[test]
    fn the_theme_package_fixture_shared_with_the_frontend_installs() {
        let doc: serde_json::Value =
            serde_json::from_str(include_str!("fixtures/theme-package.json")).unwrap();

        let manifest_bytes = serde_json::to_vec(&doc["expectedManifest"]).unwrap();

        // ‼️ 0091 fix round 2, Finding N2 (re-review) — entry paths come from `theme.modes`'
        // OWN keys and the `"{mode}/tokens.json"` convention `themePackageEntries` (TS)
        // actually uses, not three hardcoded literals. The prior version wrote
        // `"light/tokens.json"`/`"dark/tokens.json"` directly, which meant a fixture edit
        // that renamed those paths (mutation F2: `expectedEntryNames` AND
        // `expectedManifest.modes.*.tokens` both renamed) left this test on GREEN — it was
        // pinned to its own copy of the names, not to what the fixture claims.
        let theme_modes = doc["theme"]["modes"].as_object().unwrap();
        let mut entries = vec![("baram-theme.json".to_string(), manifest_bytes)];
        let mut written: std::collections::HashMap<String, Vec<u8>> =
            std::collections::HashMap::new();
        for (mode, assets) in theme_modes {
            let bytes = serde_json::to_vec(&assets["colors"]).unwrap();
            let path = format!("{mode}/tokens.json");
            entries.push((path.clone(), bytes.clone()));
            written.insert(path, bytes);
        }

        let bytes = crate::plugin::build_zip_bytes(&entries).unwrap();
        let dir = tempfile::tempdir().unwrap();
        extract_zip_bytes(&bytes, dir.path()).unwrap();

        let (id, _text, _digest) = read_staged_theme_manifest(dir.path()).unwrap();
        assert_eq!(id, doc["theme"]["id"].as_str().unwrap());

        // The assertion the hardcoded version did not have: walk what the MANIFEST ITSELF
        // (which this test just wrote to disk, unmodified from the fixture) claims each
        // mode's tokens path is, and require that exact path to exist with the exact bytes
        // this test wrote under the convention path above. If a fixture edit renames
        // `expectedManifest.modes.<mode>.tokens` without the write side following (or vice
        // versa), `declared_path` and the file this loop actually wrote diverge and
        // `std::fs::read` fails — this is what turns RED under mutation F2.
        let declared_modes = doc["expectedManifest"]["modes"].as_object().unwrap();
        for (mode, assets) in declared_modes {
            let declared_path = assets["tokens"].as_str().unwrap();
            let expected_bytes = written
                .get(&format!("{mode}/tokens.json"))
                .unwrap_or_else(|| {
                    panic!("fixture declares mode \"{mode}\" but this test never wrote it")
                });
            let on_disk = std::fs::read(dir.path().join(declared_path)).unwrap_or_else(|e| {
                panic!(
                    "{declared_path} (declared by expectedManifest.modes.{mode}.tokens) \
                     not found in the extracted package: {e}"
                )
            });
            assert_eq!(&on_disk, expected_bytes, "{declared_path}");
        }
    }

    /// ‼️ `ThemeAssetReader`'s contract, enforced at the layer that actually opens files.
    ///
    /// `inline-assets.ts` promises that a package-relative reference is handled as a FILE
    /// NAME — nothing percent-decodes it or re-reads it as a URL — because its own
    /// containment verdict is worthless otherwise. Two halves, and each fails on its own:
    /// a name that merely LOOKS encoded is read literally, and a name that would ESCAPE if
    /// decoded does not.
    #[tokio::test]
    async fn the_staged_reader_treats_a_path_as_a_literal_file_name() {
        let root = tempfile::tempdir().unwrap();
        let (stage_id, _id, _digest) = stage_theme_archive_in(
            root.path(),
            &theme_zip(
                "dracula",
                &[
                    ("assets/a%2eb.png", b"literal-percent"),
                    ("assets/with space.png", b"literal-space"),
                    ("assets/plain.png", b"plain"),
                ],
            ),
            None,
        )
        .unwrap();
        let staged = resolve_stage_in(root.path(), &stage_id).unwrap();
        // A sibling of the STAGE, i.e. what `%2e%2e/` would reach if anything decoded it.
        std::fs::write(staged.parent().unwrap().join("outside.png"), b"secret").unwrap();

        let read = |rel: &'static str| {
            let staged = staged.clone();
            async move {
                let path = resolve_within(&staged, rel)?;
                read_bytes_capped(&path, MAX_STAGED_FILE_BYTES).await
            }
        };

        // Read by the name as written, percent sequence and space intact.
        assert_eq!(read("assets/a%2eb.png").await.unwrap(), b"literal-percent");
        assert_eq!(
            read("assets/with space.png").await.unwrap(),
            b"literal-space"
        );
        assert_eq!(read("assets/plain.png").await.unwrap(), b"plain");

        // `%2e%2e` is a directory name that does not exist, NOT `..`.
        let encoded = read("%2e%2e/outside.png").await.unwrap_err();
        assert!(
            encoded.contains("is unreadable"),
            "an encoded traversal was decoded: {encoded}"
        );
        // And the un-encoded form is refused by containment rather than by spelling.
        assert!(read("../outside.png").await.is_err());
        assert!(read("/etc/hosts").await.is_err());
    }

    /// The load-time read finds what the commit wrote, and refuses an id that is not a
    /// single path segment.
    #[tokio::test]
    async fn the_stored_css_read_refuses_an_id_that_is_not_one_segment() {
        for bad in ["../plugins/demo", "a/b", ""] {
            let err = read_stored_theme_css(bad, ThemeMode::Light)
                .await
                .unwrap_err();
            assert!(
                err.to_string().contains("invalid theme id"),
                "id {bad:?} was not refused: {err}"
            );
        }
    }
}
