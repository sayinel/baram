//! §33 The checks a file rename's destination passes: inside the file's
//! contexts in both views, in the same directory, and not another entry.

use crate::context::manager::{resolve_canonical, Registered};
use crate::index::relative_links::{path_components, same_component};
use std::path::{Path, PathBuf};

use super::confined_by;

/// The old path as an entry the rename may move: what it resolves to
/// (`identity`), and that file's parent — the directory a file opened on its
/// own (§89) must stay in (`parent`).
pub(super) struct Source {
    /// The index knows a note by what its path resolves to: the build never
    /// indexes a symlink entry (`collect_md_files` does not follow one) and a
    /// save files under the resolved path (`Mutation::update`). The rename
    /// does the same — it drops what the old path resolved to before the move
    /// and files the note under what the new path resolves to after it. For a
    /// plain note that is the new path; after a case-only rename on a file
    /// system that folds case, the new spelling on disk; for a symlinked note,
    /// its target, which the index already held.
    pub(super) identity: PathBuf,
    pub(super) parent: Option<PathBuf>,
}

/// Both ends stay inside the file's contexts (`dirs`). The old path is judged
/// by its directory entry (`entry_confined`): what it resolves to is inside
/// already, since `owning_contexts` found the contexts by that very path.
/// The new path is judged in both views (`confined_both_ways`), what it
/// resolves to and the entry itself. A rename that would carry the file out
/// of every context, or that acts on an entry outside them — a symlink
/// outside the vault pointing into it — is refused before anything is
/// written. Then the move refusal below. Judged in that order: old entry,
/// new path both ways, move.
///
/// The plain file rename, `fs_cmd::rename_file`, checks each end through
/// `check` (`fs::validate_path`) and `check_vault`. The two renames share
/// two checks: an absolute path (`validate_path`; here `absolute`, in
/// `rename/mod.rs`), and the resolved path inside a registered context
/// (`check_vault` through `ContextManager::validate_path_any`, ANY context;
/// here only the file's own, `dirs`). `fs_cmd::rename_file` alone refuses a
/// null byte and a `..` segment (`validate_path`), and with no context
/// registered it falls back to the legacy vault root and refuses when that
/// is unset too (`vault_fallback_decision`). This rename alone runs four:
/// the directory entry judged as well as the resolved path (`entry_confined`,
/// `confined_both_ways`), the file's own contexts rather than any registered
/// one, the same directory (`stays_in_its_directory`), and no other entry at
/// the destination (`another_entry_at`, called by `rename/file.rs`).
pub(super) fn judge(old_path: &str, new_path: &str, dirs: &[Registered]) -> Result<Source, String> {
    let identity = resolve_canonical(old_path)?;
    let parent = identity.parent().map(Path::to_path_buf);
    if !entry_confined(old_path, dirs, parent.as_deref()) {
        return Err(format!("{old_path} is outside the contexts that hold it"));
    }
    if !confined_both_ways(new_path, dirs, parent.as_deref()) {
        return Err(format!("{new_path} is outside the contexts of {old_path}"));
    }
    // issue 619: a rename keeps the note in its directory. A path-qualified
    // or relative reference names the note by where it is, and a move would
    // need every one of them respelled for a new folder — and the note's own
    // relative links for the new place it reads them from — which is not
    // what this command rewrites. Refused before anything is written. The
    // parents are compared as spelled, not as resolved: the respelling
    // writes `new_path`'s components into links, so `a/../a/new.md`, whose
    // parent resolves to `a`, would write `[[a/../a/new]]`, a link to no
    // note. Both paths are absolute (`absolute`, checked by the caller), so
    // a relative spelling cannot pass as the same parent either.
    if !stays_in_its_directory(old_path, new_path, cfg!(windows)) {
        return Err(format!(
            "{new_path} would move the note out of its directory; a rename keeps the note where it is"
        ));
    }
    Ok(Source { identity, parent })
}

/// The directory entry `path` names: its parent resolved canonically, joined
/// with its own file name as spelled, the last component not followed. Used
/// for the boundary only (`confined_both_ways`) — the rename moves this
/// entry, so the entry must lie inside the contexts too. The index files a
/// note by what its path resolves to, not by this.
fn entry_path(path: &str) -> Result<std::path::PathBuf, String> {
    let path = Path::new(path);
    let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
        return Err(format!("{} names no file", path.display()));
    };
    Ok(resolve_canonical(&parent.to_string_lossy())?.join(name))
}

/// Whether `new_path` names a directory entry other than the one at
/// `old_path`. Judged by the entries, never by what they resolve to: neither
/// last component is followed. Following it would call a symlinked
/// `note.md -> x.md`, renamed to `x.md`, the "same" file, and `rename(2)`
/// would replace the real `x.md` with the link. Nothing at `new_path`, or
/// nothing `symlink_metadata` can read (as `Path::exists` reads it), is no
/// entry.
///
/// On Unix the destination is the source's own entry only when both are the
/// same inode on the same device (`symlink_metadata`, which reads a link
/// itself) AND the two names differ at most by ASCII case. That is a
/// case-only rename (`Note.md` → `note.md`) on a file system that folds
/// case, where both spellings reach the one entry. Only ASCII case counts:
/// `Élan.md` → `élan.md` on such a file system finds the destination, fails
/// the name comparison, and is refused. The same inode under a name that
/// differs by more than ASCII case is a hard link of the source, and a
/// rename between hard links is a silent no-op, so it is refused as another
/// entry. A hard link whose name differs from the source's only by ASCII
/// case, which a file system that keeps case allows, looks the same as a
/// case alias from these two reads, so it passes: the move is then a no-op,
/// the rename answers `Ok`, and links are respelled, with no content lost.
/// Telling the two apart would mean asking the file system whether it folds
/// case. Any other inode is another entry.
///
/// Elsewhere (Windows) there is no inode here to compare. The destination
/// counts as the source's entry when its canonical parent is the source's
/// and the names differ at most by ASCII case, since Windows folds case by
/// default. This is an approximation, and a hard link there is not told
/// apart from a case alias.
///
/// So a symlinked source renamed onto its target's name is refused, and a
/// symlinked source renamed to another spelling of its own name goes ahead.
/// A dangling symlink at the destination is an entry too and is refused,
/// where `Path::exists`, which follows the link, used to let the rename
/// replace it.
pub(super) fn another_entry_at(old_path: &str, new_path: &str) -> bool {
    let Ok(new_meta) = std::fs::symlink_metadata(new_path) else {
        return false;
    };
    let names_differ_only_by_case = match (
        Path::new(old_path).file_name(),
        Path::new(new_path).file_name(),
    ) {
        (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
        _ => false,
    };
    !(names_differ_only_by_case && same_entry(old_path, new_path, &new_meta))
}

/// Whether the existing entry at `new_path` (`new_meta`, not followed) is the
/// entry at `old_path` — see `another_entry_at`.
#[cfg(unix)]
fn same_entry(old_path: &str, _new_path: &str, new_meta: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    std::fs::symlink_metadata(old_path)
        .is_ok_and(|old| old.dev() == new_meta.dev() && old.ino() == new_meta.ino())
}

/// Whether the existing entry at `new_path` is the entry at `old_path`,
/// approximated by canonical parents — see `another_entry_at`.
#[cfg(not(unix))]
fn same_entry(old_path: &str, new_path: &str, _new_meta: &std::fs::Metadata) -> bool {
    let parent = |p: &str| {
        Path::new(p)
            .parent()
            .and_then(|parent| std::fs::canonicalize(parent).ok())
    };
    parent(old_path).is_some_and(|old| parent(new_path) == Some(old))
}

/// Whether `new_path` names an entry in the directory `old_path` is in:
/// the same parent components, compared as `same_component` compares them
/// (ASCII case folded on Windows). Pure, so the Windows spelling is tested
/// with `windows = true` on any host.
fn stays_in_its_directory(old_path: &str, new_path: &str, windows: bool) -> bool {
    let parent = |path| {
        let mut components = path_components(path, windows);
        components.pop();
        components
    };
    let (old, new) = (parent(old_path), parent(new_path));
    old.len() == new.len()
        && old
            .iter()
            .zip(&new)
            .all(|(a, b)| same_component(a, b, windows))
}

pub(super) fn stem_of(path: &str) -> Option<String> {
    Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
}

/// Whether the directory entry `path` names (`entry_path`) lies inside the
/// file's contexts, judged by `destination_confined` — so for a standalone
/// File context (§89) it must sit in the directory the file was in. The
/// rename acts on the entry: it moves it, and `rewrite_renamed_note` writes
/// through it. Judging only the resolved file let `/outside/Link.md`, a
/// symlink outside every context pointing at `/v/x.md`, pass: a case-only
/// rename then moved the outside entry and the note's rewrite replaced the
/// link with a regular file outside the vault.
fn entry_confined(path: &str, dirs: &[Registered], old_parent: Option<&Path>) -> bool {
    entry_path(path).is_ok_and(|entry| destination_confined(&entry, dirs, old_parent))
}

/// Whether `path` lies inside the file's contexts in both views: what it
/// resolves to (`resolve_canonical`, following a link) AND its entry
/// (`entry_confined`). This is the new path's check, before the move and
/// again before the renamed note is written, where it matches what
/// `write_file` touches: the entry it replaces and the file it resolves to.
/// For every rename that passes `another_entry_at`, the resolved view before
/// the move refuses nothing that the entry view and `owning_contexts` pass —
/// the new path then does not exist, so both views are one path, or it is
/// the source's own entry. After the move it refuses an entry whose target
/// was changed since.
pub(super) fn confined_both_ways(
    path: &str,
    dirs: &[Registered],
    old_parent: Option<&Path>,
) -> bool {
    resolve_canonical(path).is_ok_and(|identity| destination_confined(&identity, dirs, old_parent))
        && entry_confined(path, dirs, old_parent)
}

/// Whether a renamed file's destination stays inside the file's contexts:
/// under one of its directory contexts, or — for a file opened on its own
/// (§89, no directory context) — in the directory the file was in.
fn destination_confined(identity: &Path, dirs: &[Registered], old_parent: Option<&Path>) -> bool {
    if dirs.is_empty() {
        identity.parent() == old_parent
    } else {
        confined_by(identity, dirs)
    }
}

#[cfg(test)]
mod tests {
    use super::stays_in_its_directory;

    #[test]
    fn a_rename_that_would_move_the_note_is_refused_in_windows_spelling_too() {
        // What fails this: splitting on `/` alone — `C:\v\sub\note.md` is
        // then one component, the parents are both empty, and the move reads
        // as staying.
        assert!(!stays_in_its_directory(
            r"C:\v\note.md",
            r"C:\v\sub\other.md",
            true
        ));
        assert!(!stays_in_its_directory(
            r"C:\v\a\note.md",
            r"C:\v\b\note.md",
            true
        ));
        assert!(stays_in_its_directory(
            r"C:\V\a\note.md",
            r"c:\v\A\new.md",
            true
        ));
        assert!(stays_in_its_directory("/v/a/note.md", "/v/a/new.md", false));
        assert!(!stays_in_its_directory(
            "/v/a/note.md",
            "/v/A/new.md",
            false
        ));
    }
}
