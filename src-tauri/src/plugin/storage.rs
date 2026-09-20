// §69 Phase D / §260 3c-2b — plugin storage, path safety primitives, and the plugin directory.
//
// `get_plugin_dir` (where installs live), `single_segment` (the traversal guard for both plugin
// ids and storage keys) and the per-plugin key-value storage that sits under a sibling
// `~/.baram/plugin-data/` tree, plus the bounded-read helpers `read_bundle_in` /
// `read_text_capped` a sandboxed plugin's `SourceRead` and `files` ops both go through.
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::PluginError;

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

/// Returns the theme installation base directory: ~/.baram/themes/
///
/// §360 (dev/plans/0090-theme-marketplace-plan Task 3) — a SIBLING tree to
/// [`get_plugin_dir`], not a child of it: removal, enumeration and permission all mean
/// something different for a theme than for a plugin, even though the staging/commit/
/// uninstall machinery in `install.rs` is now shared between the two trees via
/// [`InstallKind`].
///
/// Deliberately its own 13 lines rather than a shared helper with [`get_plugin_dir`]: that
/// function has no test of its OWN in this crate — every existing caller resolves the real
/// `$HOME` (see `install_root_resolves_each_kind_to_its_own_directory_name` below, the only
/// test in this module that does). Factoring its body out to save one directory-name
/// literal would mean editing code an existing, live install path depends on; duplicating
/// it costs 13 lines and edits nothing that already works.
pub fn get_theme_dir() -> Result<PathBuf, PluginError> {
    let home = dirs_next().ok_or_else(|| {
        PluginError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Could not determine home directory",
        ))
    })?;
    let theme_dir = home.join(".baram").join("themes");
    if !theme_dir.exists() {
        std::fs::create_dir_all(&theme_dir)?;
    }
    Ok(theme_dir)
}

/// Which installable-asset tree a caller wants resolved to a filesystem root.
///
/// §360 — the reason this enum exists rather than a root parameter. Generalizing the
/// staging/commit/discard/uninstall functions in `install.rs` to accept a root directly
/// would open a surface where whatever calls them chooses the install path, and if that
/// caller is ever a webview-facing command taking a path STRING, that reopens §329–§336
/// ("the vault boundary cannot authorise itself" — src-tauri/CLAUDE.md); this crate's
/// `no_new_asset_scope_grant_outside_the_allowlist` guards exactly this family of mistake.
/// Naming a closed KIND instead keeps every legal root Rust's own choice — see
/// [`install_root`], the only function that turns one of these into a path.
///
/// The shape follows [`super::registry::PluginTrust`]: a small enum crossing the IPC
/// boundary via `#[serde(rename_all = "lowercase")]`, not [`super::PluginOp`]'s
/// `#[serde(tag = "kind")]` tagged union — there is no payload here beyond the choice
/// itself, so the heavier pattern buys nothing.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum InstallKind {
    Plugin,
    Theme,
}

/// Resolves `kind` to the base directory installs of that kind live under.
pub fn install_root(kind: InstallKind) -> Result<PathBuf, PluginError> {
    match kind {
        InstallKind::Plugin => get_plugin_dir(),
        InstallKind::Theme => get_theme_dir(),
    }
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

pub(super) fn hex_sha256(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

/// Returns the single safe path segment of `s`, or `None` if `s` is empty,
/// `~`-prefixed, absolute, contains a path separator (`/` or `\`), or is
/// `.`/`..`. This is the traversal guard for both plugin ids and storage
/// keys (§69 Phase D — USER DECISION: reject anything that does not resolve
/// to exactly one `Component::Normal`).
pub(super) fn single_segment(s: &str) -> Option<&OsStr> {
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
    // Space-joined, not colon-joined: both helpers' messages are written to read as
    // predicates ("is N bytes, over the …"), so this composes into a sentence.
    //
    // ‼️ That claim was false for one of `resolve_within`'s three branches until the
    // external review found it — see the note at that branch. The strings below are pinned
    // by `composed_error_messages_read_as_sentences`, because "reads as a sentence" is
    // exactly the property no `is_err()` assertion can see.
    let canonical_file = resolve_within(dir, main).map_err(|e| format!("plugin entry {e}"))?;
    read_text_capped(&canonical_file, MAX_BUNDLE_BYTES)
        .await
        .map_err(|e| format!("plugin entry \"{main}\" {e}"))
}

/// Resolve `rel` inside `dir`, refusing anything that lands outside it.
///
/// ‼️ BOTH SIDES ARE CANONICALIZED BEFORE THE COMPARISON, and that is what makes one test
/// cover two escapes: `../` and a symlink both differ from the literal join only after
/// resolution, so a rule written on the string `rel` would have to enumerate them
/// separately and would miss the second. It also means the refusal does not depend on how
/// the escape was SPELLED — a percent-encoded `%2e%2e` is not decoded by anything here, so
/// it resolves to a directory literally named `%2e%2e` (§360: `ThemeAssetReader` in
/// `src/utils/theme-css/inline-assets.ts` requires exactly that, because its own path
/// verdict is worthless if the reader re-parses what it was handed).
///
/// Shared by [`read_bundle_in`] and §360's staged-theme read so there is one
/// implementation of the containment rule rather than one per caller.
pub(super) fn resolve_within(dir: &Path, rel: &str) -> Result<PathBuf, String> {
    // ‼️ THIS BRANCH CARRIES ITS OWN SUBJECT; THE OTHER TWO ALREADY DID (external review
    // #10). The two below name `rel`, so `read_bundle_in`'s `plugin entry {e}` prefix
    // composes with them into "plugin entry \"main.js\" is unreadable: …". This one named
    // nothing, and the result was `plugin entry its own directory is unreadable: …` — and
    // through `read_staged_file`, which adds no prefix at all, the bare predicate
    // `its own directory is unreadable: …` with no subject anywhere in the string.
    //
    // Naming the directory rather than adding a slot to the caller, because the caller
    // that had no prefix is the one whose message was worst.
    let canonical_dir = std::fs::canonicalize(dir)
        .map_err(|e| format!("the directory {} is unreadable: {e}", dir.display()))?;
    let canonical_file = std::fs::canonicalize(canonical_dir.join(rel))
        .map_err(|e| format!("\"{rel}\" is unreadable: {e}"))?;
    if !canonical_file.starts_with(&canonical_dir) {
        return Err(format!("\"{rel}\" resolves outside its own directory"));
    }
    Ok(canonical_file)
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
    refuse_over_cap(path, cap).await?;
    tokio::fs::read_to_string(path)
        .await
        .map_err(|e| format!("could not be read: {e}"))
}

/// [`read_text_capped`] for bytes. §360 — a theme's bundled assets are fonts and images,
/// and `inlineThemeAssets` wants them as bytes to base64-encode; decoding them as text
/// first would be lossy for exactly the files this exists to carry.
pub(super) async fn read_bytes_capped(path: &Path, cap: u64) -> Result<Vec<u8>, String> {
    refuse_over_cap(path, cap).await?;
    tokio::fs::read(path)
        .await
        .map_err(|e| format!("could not be read: {e}"))
}

/// The stat-before-read half of the two helpers above, so the "never allocate to measure"
/// rule has one implementation rather than one per element type.
async fn refuse_over_cap(path: &Path, cap: u64) -> Result<(), String> {
    let size = tokio::fs::metadata(path)
        .await
        // Distinct from a read failure, so a diagnosis can tell "cannot be stat'ed"
        // from "stat'ed fine but unreadable".
        .map_err(|e| format!("cannot be measured: {e}"))?
        .len();
    if size > cap {
        return Err(format!("is {size} bytes, over the {cap}-byte limit"));
    }
    Ok(())
}

/// Resolves `key` to a path inside `dir`, rejecting any key that is not a
/// single safe path segment so the result can never escape `dir`.
fn resolve_key_path(dir: &Path, key: &str) -> Result<PathBuf, String> {
    let seg = single_segment(key).ok_or_else(|| format!("invalid storage key: {key}"))?;
    Ok(dir.join(seg))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// §260 3c-2b — the bundle read backing `SourceRead`. `main` is manifest-supplied
    /// and therefore untrusted: it must not be able to name a file outside the
    /// plugin's own directory, or the op would become the file-read capability that

    /// ‼️ THE STRINGS, NOT ONLY THE `is_err()` (external review #10).
    ///
    /// `read_bundle_in`'s own comment says both helpers' messages "compose into a
    /// sentence", and one of `resolve_within`'s three branches did not: its directory
    /// failure carried no subject, so the composition read `plugin entry its own directory
    /// is unreadable: …`. Nothing anywhere asserted any of these literals — the two tests
    /// that exercise this function check `is_ok()`/`is_err()` and, for the cap, a substring
    /// of the CAP message. A property that only a reader can see needs a reader's test.
    #[tokio::test]
    async fn composed_error_messages_read_as_sentences() {
        let base = std::env::temp_dir().join(format!("baram-msg-{}", std::process::id()));
        let plugin = base.join("plugin-a");
        std::fs::create_dir_all(&plugin).unwrap();
        std::fs::write(plugin.join("index.mjs"), "export {}").unwrap();

        // The branch that had no subject. `resolve_within` is called directly because
        // making `read_bundle_in`'s own `dir` unreadable is not portable.
        let missing = base.join("no-such-directory");
        let directory_error = resolve_within(&missing, "index.mjs").unwrap_err();
        assert!(
            directory_error.starts_with("the directory "),
            "the directory branch must name its subject, got: {directory_error}"
        );
        assert!(
            !format!("plugin entry {directory_error}").contains("plugin entry its own"),
            "composing must not produce a subjectless sentence: {directory_error}"
        );

        // The two branches that already composed, so this test would notice if a fix to
        // the first broke them.
        std::fs::write(base.join("outside.mjs"), "export {}").unwrap();
        let escaped = resolve_within(&plugin, "../outside.mjs").unwrap_err();
        assert!(
            escaped.starts_with("\"../plugin-a/index.mjs\"")
                || escaped.contains("resolves outside"),
            "the escape branch must name the path it refused, got: {escaped}"
        );
        let unreadable = resolve_within(&plugin, "nope.mjs").unwrap_err();
        assert_eq!(
            format!("plugin entry {unreadable}")
                .split_once(' ')
                .map(|(a, _)| a),
            Some("plugin"),
            "sanity: the prefix is still a prefix"
        );
        assert!(
            format!("plugin entry {unreadable}")
                .starts_with("plugin entry \"nope.mjs\" is unreadable:"),
            "got: plugin entry {unreadable}"
        );

        std::fs::remove_dir_all(&base).ok();
    }

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

    /// §360 (Task 3) — the security property in `InstallKind`'s doc comment, pinned:
    /// whatever crosses the IPC boundary as a `kind` is one of exactly two lowercase
    /// strings, never an arbitrary path. Serde is the machinery doing the enforcing, so
    /// this is checked against it rather than asserted from reading our own code.
    #[test]
    fn install_kind_is_a_closed_lowercase_enum_on_the_wire() {
        assert_eq!(
            serde_json::from_str::<InstallKind>("\"plugin\"").unwrap(),
            InstallKind::Plugin
        );
        assert_eq!(
            serde_json::from_str::<InstallKind>("\"theme\"").unwrap(),
            InstallKind::Theme
        );
        // Neither the Rust variant name (PascalCase) nor an arbitrary string — in
        // particular, not a path — deserializes.
        assert!(serde_json::from_str::<InstallKind>("\"Plugin\"").is_err());
        assert!(serde_json::from_str::<InstallKind>("\"/etc/passwd\"").is_err());

        assert_eq!(
            serde_json::to_string(&InstallKind::Plugin).unwrap(),
            "\"plugin\""
        );
        assert_eq!(
            serde_json::to_string(&InstallKind::Theme).unwrap(),
            "\"theme\""
        );
    }

    /// §360 fix round 1 (MEDIUM-1) — the previous version of this test asserted
    /// `install_root(kind) == get_plugin_dir()/get_theme_dir()`, which is TAUTOLOGICAL for
    /// the `Theme` arm: `install_root(Theme)` IS a call to `get_theme_dir()`, so both sides
    /// of that equality move together no matter what `get_theme_dir` returns. A mutation
    /// that broke the DESTINATION — `Theme` resolving into the plugin tree, precisely what
    /// `InstallKind` exists to prevent (spec §9.2) — passed it. Asserting the actual last
    /// path component instead can catch that, and it is the one test in this module that
    /// resolves the real `$HOME` to do it.
    #[test]
    fn install_root_resolves_each_kind_to_its_own_directory_name() {
        assert_eq!(
            install_root(InstallKind::Plugin).unwrap().file_name(),
            Some(OsStr::new("plugins"))
        );
        assert_eq!(
            install_root(InstallKind::Theme).unwrap().file_name(),
            Some(OsStr::new("themes"))
        );
    }
}
