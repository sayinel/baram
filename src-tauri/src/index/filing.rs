//! §29 Filing keys — the one place that decides which key a reference is filed
//! under in the link index, and which keys a file answers to. What a rename
//! makes of a reference under those keys is `judgement.rs`.
//!
//! File-side key shapes are also built where `keys_for` is not called.
//! A scan of `.rs` files under `src-tauri/src`, excluding tests, comments,
//! definitions and match patterns, gives these construction/call sites
//! (repeated calls grouped by function):
//!
//! - `FilingKey::` constructions: `filing_key`, `keys_for`, `backlink_keys_for`
//!   here; `BlockTarget::judge` and `RenameTarget::expected_key` in `judgement.rs`;
//!   `index_reads_the_rename_back` in `read_back.rs`; and the same-stem
//!   predicate inside `rename_block_id_inner` in `rename/block_id.rs`.
//! - `file_key` calls: `name_key` here; `normalize_file_path` in
//!   `normalizer.rs`; and `link_reads_back_as_the_file` in `rewriter.rs`.
//! - `name_key` calls — the name a bare link to a file is filed under, a
//!   note's stem or any other file's whole name: `keys_for`,
//!   `backlink_keys_for` here; `RenameTarget::judge`, `refers_behind_alias`,
//!   `expected_key` in `judgement.rs`; `rename_file_with_links_inner` in
//!   `rename/file.rs` (the old key, the same-stem predicate, and
//!   `stem_unchanged`); and the same-stem predicate inside
//!   `rename_block_id_inner` in `rename/block_id.rs`. `RenameTarget::new_stem`
//!   spells the same name (`bare_name`), unfolded.
//! - `root_relative_key` calls: `keys_for` here; `RenameTarget::judge`,
//!   `refers_behind_alias`, `alias_root_reads_another_note`, `expected_key` in
//!   `judgement.rs`; `path_keys_of` in `mod.rs`; `register_file_path` in
//!   `resolve.rs`; and `spell_under_each_root` and `known_paths_of` in
//!   `rename/scope.rs`.
//! - `normalize_file_path` calls: `register_file_path` in `resolve.rs` and
//!   `remove_file` in `mod.rs` — `file_map`'s stem, not an `incoming` key.
//! - `extract_id_from_stem` calls: `backlink_keys_for` here and
//!   `register_file_path` in `resolve.rs`.
//!
//! `registered_path_keys`, `colliding_path_keys` and `path_key_notes` build
//! note lists or counts through `path_keys_of`; `colliding_path_keys` first
//! groups by this module's `path_key_name`. `backlink_keys` in `mod.rs` and
//! `block_target` in `rename/block_id.rs` call `backlink_keys_for`, which adds
//! a note's zettel id as a `Stem` and behind each local alias as a `Foreign`.
//! `filing_key` builds link-side keys, while `keys_for` builds file-side keys.
//! `file_map`, `relative_map` and `id_map` in `mod.rs` (filled by
//! `register_file_path`, emptied by `remove_file`) and `name_map` (filled by
//! `register_link_target`, keyed by `file_name` and `root_relative_path`)
//! resolve targets; they are not `incoming` keys. Add a new key shape here
//! and fix these sites with it.
//!
//! Every `match` on `FilingKey` names each variant, with no `_` arm. A fourth
//! variant stops compilation at five sites: `read_as_another_note`,
//! `BlockTarget::judge`, `RenameTarget::judge` and `refers_behind_alias` in
//! `judgement.rs`, and `index_reads_the_rename_back` in `read_back.rs`
//! (measured by adding a dummy variant; the device `LinkKind::pass()` uses).
//! `filing_key` and `keys_for`, which **build** keys, do not stop, so emit a
//! new variant there directly.
//!
//! The two count gates in `mod.rs` catch different things.
//! `every_reference_the_index_files_under_a_stem_is_visited_by_one_rewrite_pass`
//! builds its fixture from `LinkKind::ALL`, so a new **kind** enters on its
//! own, but it counts the `Stem` bucket only, with two spellings: a note's
//! stem and another file's whole name (`target.txt`). Its pair,
//! `every_reference_the_index_files_under_a_path_is_visited_by_one_rewrite_pass`,
//! counts the `Path` and `Foreign` buckets, but its spellings are a
//! hand-written list (`dir/target` and `./target` for each kind, and
//! `[[work::target]]`), so a new key shape that arrives through a spelling
//! not on that list is seen by **neither**. Add a new spelling to that
//! fixture first.

use super::normalizer::{
    extract_id_from_stem, file_key, fold_name, normalize_target, strip_extension_and_fold,
};
use super::relative_links::{
    path_components, resolve_components, root_components, strip_dir_prefix,
};

/// The key a reference or a file is filed under in the link index.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum FilingKey {
    /// A bare name with no separator: `[[Note]]` → `note`.
    Stem(String),
    /// A path-qualified target: resolved root-relative when it is relative
    /// (`./`, `../`) and lands under the root, else the written text folded —
    /// `fold_name`, one note extension off, and on Windows a non-relative
    /// target's `\` made `/` (`filing_key`): `[[Dir/Note.md]]` → `dir/note`.
    Path(String),
    /// A target qualified by a vault alias: `[[work::Old]]` files under the
    /// alias and the target text — its separators folded as a path's on
    /// Windows — never resolved against this vault's root.
    Foreign { alias: String, target: String },
}

/// A vault alias local to the file a reader asks about, paired with the root
/// of the vault it names. `alias` is already folded (`fold_name`) — once,
/// where it enters (`service::keys::own_aliases`), and every comparison here
/// assumes so; `filing_key` folds the alias a LINK is written with the same
/// way. `root` is that vault's path, spelled as the file paths a reader asks
/// about are — the registered path in the app, the canonical path in the CLI:
/// an alias resolves a path against it, never against the root of the index
/// being read.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct LocalAlias {
    pub alias: String,
    pub root: String,
}

/// Does `target` start with `./` or `../` (and, on Windows, `.\` or `..\`)?
pub(super) fn is_relative(target: &str, windows: bool) -> bool {
    let starts = |p: &str| target.starts_with(p);
    starts("./") || starts("../") || (windows && (starts(r".\") || starts(r"..\")))
}

fn has_separator(target: &str, windows: bool) -> bool {
    target.contains('/') || (windows && target.contains('\\'))
}

/// The file name of `path`: the last of `path_components`, found without
/// collecting them, so a Windows path is read on any host — `""` when there
/// is none.
pub(super) fn file_name(path: &str, windows: bool) -> &str {
    path.rsplit(|c| c == '/' || (windows && c == '\\'))
        .find(|part| !part.is_empty() && *part != ".")
        .unwrap_or("")
}

/// Whether the file at `path` is a note: its name ends in `.md` or
/// `.markdown` (`crate::fs::is_note_name`, the rule the build collects notes
/// by). The index reads a note's links and keys it by its stem; any other
/// file is a link target only (§278), keyed by its whole name (`bare_name`).
pub(crate) fn is_note(path: &str, windows: bool) -> bool {
    crate::fs::is_note_name(file_name(path, windows))
}

/// The name a bare link names the file at `path` by, as the disk spells
/// it: a note's stem — its file name without the last extension, `Note` for
/// `Note.md` — and any other file's whole name, `Paper.pdf` (§278). Not
/// `Paper` for the PDF: the resolver answers a bare `[[Paper]]` with the
/// note of that stem, the PDF's highlight companion among them, and never
/// with the PDF (`name_map` is read last, by the whole name).
pub(crate) fn bare_name(path: &str, windows: bool) -> &str {
    let name = file_name(path, windows);
    if !crate::fs::is_note_name(name) {
        return name;
    }
    std::path::Path::new(name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(name)
}

/// The text of the `Stem` key a bare link to the file at `path` is filed
/// under: `file_key` of its `bare_name` — `note` for `Note.md`, `paper.pdf`
/// for `Paper.pdf`. It is what `normalize_target` makes of a link that
/// spells that name (`[[Note]]`, `[[note.md]]`, `[[Paper.pdf]]`) — except
/// for a note whose stem itself ends in `.md` (`x.md.md`, see `file_key`).
pub(crate) fn name_key(path: &str, windows: bool) -> String {
    file_key(bare_name(path, windows))
}

/// The last component of the key `root_relative_key` gives `file_path` — its
/// file name, one `.md` or `.markdown` off, folded (`fold_name`) — without
/// spelling the rest. Two files whose path keys are equal have equal names
/// here, so grouping by this finds every collision
/// (`LinkIndex::colliding_path_keys`).
pub fn path_key_name(file_path: &str, windows: bool) -> String {
    strip_extension_and_fold(file_name(file_path, windows))
}

/// The components of `path` under the directory `root`, or None when `path`
/// is not under it or is the directory itself — `strip_dir_prefix` without
/// the directory itself.
pub(super) fn under_root<'a>(
    root: &[&str],
    path: &[&'a str],
    windows: bool,
) -> Option<Vec<&'a str>> {
    strip_dir_prefix(root, path, windows)
        .filter(|rest| !rest.is_empty())
        .map(|rest| rest.to_vec())
}

/// The key `target`, written in the note at `source_path`, is filed under.
/// A relative target resolves against the note's directory and is filed by
/// its path under `root`; one that leaves the root, or has no root to leave,
/// keeps its normalized text.
pub fn filing_key(
    source_path: &str,
    target: &str,
    alias: Option<&str>,
    root: Option<&str>,
    windows: bool,
) -> FilingKey {
    let normalized = normalize_target(target);
    let text = target.trim();
    if let Some(alias) = alias {
        // A path behind an alias folds its separators as an unqualified
        // path does, so it meets the `Foreign` keys `keys_for` spells with
        // `/`. A relative one keeps its text: it is never resolved.
        let target = if windows && !is_relative(text, windows) {
            strip_extension_and_fold(&text.replace('\\', "/"))
        } else {
            normalized
        };
        return FilingKey::Foreign {
            alias: fold_name(alias),
            target,
        };
    }
    if is_relative(text, windows) {
        if let Some(root) = root {
            let mut source_dir = path_components(source_path, windows);
            source_dir.pop();
            let resolved = resolve_components(
                &source_dir,
                root_components(source_path, windows),
                text,
                windows,
            );
            if let Some(rest) = under_root(&path_components(root, windows), &resolved, windows) {
                return FilingKey::Path(strip_extension_and_fold(&rest.join("/")));
            }
        }
        return FilingKey::Path(normalized);
    }
    if has_separator(text, windows) {
        let text = if windows {
            text.replace('\\', "/")
        } else {
            text.to_string()
        };
        return FilingKey::Path(strip_extension_and_fold(&text));
    }
    FilingKey::Stem(normalized)
}

/// The path of `file_path` under `root` as written: its components under
/// the root joined with `/` — whatever separator the host spells — not
/// folded, no extension removed. None when the file is not under `root`.
/// `root_relative_key` makes a `Path` key of it; the resolver's `name_map`
/// and `spelled_note_name` fold it with the extension kept.
pub(super) fn root_relative_path(root: &str, file_path: &str, windows: bool) -> Option<String> {
    let file = path_components(file_path, windows);
    under_root(&path_components(root, windows), &file, windows).map(|rest| rest.join("/"))
}

/// The path of `file_path` under `root` the way a link to it is filed:
/// `root_relative_path` folded (`fold_name`), one `.md` or `.markdown`
/// removed. None when the file is not under `root`.
pub fn root_relative_key(root: &str, file_path: &str, windows: bool) -> Option<String> {
    root_relative_path(root, file_path, windows).map(|rel| strip_extension_and_fold(&rel))
}

/// Every key a link to the file at `file_path` may be filed under, in order:
/// its name (`name_key` — a note's stem, any other file's whole name), its
/// path under `root`, then for each of `local_aliases` its name and its path
/// under THAT alias's root — not `root`. An alias resolves a path against
/// the vault it names, so with the nested vaults `/v` (alias `p`) and
/// `/v/sub` (alias `s`), `[[p::a/old]]` names `/v/a/old.md` in whichever
/// index it is read, never `/v/sub/a/old.md`. A file outside an alias's
/// vault has no path key under it.
pub fn keys_for(
    file_path: &str,
    root: Option<&str>,
    local_aliases: &[LocalAlias],
    windows: bool,
) -> Vec<FilingKey> {
    let name = name_key(file_path, windows);
    let rel = root.and_then(|root| root_relative_key(root, file_path, windows));

    let mut keys = vec![FilingKey::Stem(name.clone())];
    keys.extend(rel.map(FilingKey::Path));
    for la in local_aliases {
        keys.push(FilingKey::Foreign {
            alias: la.alias.clone(),
            target: name.clone(),
        });
        if let Some(rel) = root_relative_key(&la.root, file_path, windows) {
            keys.push(FilingKey::Foreign {
                alias: la.alias.clone(),
                target: rel,
            });
        }
    }
    keys
}

/// `keys_for` plus, for a note, the zettel id in its stem
/// (`extract_id_from_stem`), filed as a `Stem` key and behind each of
/// `local_aliases` as a `Foreign` key — `[[Zettel::202607051530]]` names the
/// note as the bare id does (the editor's id navigation and the graph's
/// `id_map` read past the alias). The keys a file's backlinks are read under
/// (`LinkIndex::backlink_keys`) and a block-ID rename's target is judged by
/// (`block_target`). One function, so the two cannot drift.
pub(crate) fn backlink_keys_for(
    file_path: &str,
    root: Option<&str>,
    local_aliases: &[LocalAlias],
    windows: bool,
) -> Vec<FilingKey> {
    let mut keys = keys_for(file_path, root, local_aliases, windows);
    // A note's id only: a bare `[[202607051530]]` resolves through
    // `id_map`, which the build fills from notes alone
    // (`register_file_path`), never to `202607051530 scan.pdf`.
    let id = is_note(file_path, windows)
        .then(|| extract_id_from_stem(&name_key(file_path, windows)))
        .flatten();
    if let Some(id) = id {
        for la in local_aliases {
            keys.push(FilingKey::Foreign {
                alias: la.alias.clone(),
                target: id.clone(),
            });
        }
        keys.push(FilingKey::Stem(id));
    }
    keys
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stem(s: &str) -> FilingKey {
        FilingKey::Stem(s.to_string())
    }
    fn path(s: &str) -> FilingKey {
        FilingKey::Path(s.to_string())
    }
    fn foreign(alias: &str, target: &str) -> FilingKey {
        FilingKey::Foreign {
            alias: alias.to_string(),
            target: target.to_string(),
        }
    }

    #[test]
    fn a_bare_target_files_under_its_stem() {
        // What fails this: making `filing_key` return `Path` for a target with no separator.
        let key = |t| filing_key("/v/r.md", t, None, Some("/v"), false);
        assert_eq!(key("Note.md"), stem("note"));
        assert_eq!(key("note.markdown"), stem("note"));
        assert_eq!(key("202607051530"), stem("202607051530"));
    }

    #[test]
    fn a_path_qualified_target_keeps_its_text_but_folds_case_separator_and_extension() {
        // What fails this: removing the `to_lowercase` fold (`Dir/Note.md` keeps its capitals).
        let key = |t, w| filing_key("/v/r.md", t, None, Some("/v"), w);
        assert_eq!(key("Dir/Note.md", false), path("dir/note"));
        assert_eq!(key("dir/note.markdown", false), path("dir/note"));
        assert_eq!(key(r"dir\note", true), path("dir/note"));
        assert_eq!(key(r"dir\note", false), stem(r"dir\note"));
        assert_eq!(key("dir//note", false), path("dir//note"));
        assert_eq!(key("dir/./note", false), path("dir/./note"));
        assert_eq!(key("/dir/note", false), path("/dir/note"));
    }

    #[test]
    fn a_relative_target_resolves_against_the_source_directory() {
        // What fails this: removing the relative branch, so `./note` is filed as its raw text.
        let unix = |t| filing_key("/v/dir/r.md", t, None, Some("/v"), false);
        assert_eq!(unix("./note"), path("dir/note"));
        assert_eq!(unix("../x"), path("x"));
        assert_eq!(unix("../../escape"), path("../../escape"));

        let win = |t| filing_key(r"C:\v\dir\r.md", t, None, Some(r"C:\v"), true);
        assert_eq!(win(r".\note"), path("dir/note"));
        assert_eq!(win("./note"), path("dir/note"));
        assert_eq!(win(r"..\x"), path("x"));
        assert_eq!(win(r"../x\y"), path("x/y"));
    }

    #[test]
    fn an_alias_target_files_as_foreign_with_the_alias_folded() {
        // What fails this: dropping the alias arm, so `[[Work::Old]]` files as a stem.
        let key = |a, t| filing_key("/v/r.md", t, Some(a), Some("/v"), false);
        assert_eq!(key("Work", "Old.md"), foreign("work", "old"));
        assert_eq!(key("work", "dir/Old"), foreign("work", "dir/old"));
    }

    #[test]
    fn an_alias_target_folds_windows_separators_like_a_path() {
        // What fails this: keying the alias target by `normalize_target`
        // alone — `dir\Old.md` on Windows then keeps its backslash and never
        // meets the `dir/old` that `keys_for` spells.
        let key = |w| filing_key("/v/r.md", r"dir\Old.md", Some("Work"), Some("/v"), w);
        assert_eq!(key(true), foreign("work", "dir/old"));
        assert_eq!(key(false), foreign("work", r"dir\old"));
    }

    #[test]
    fn the_root_relative_key_of_a_file_matches_its_own_link() {
        // What fails this: removing the `.markdown` arm of the extension rule in `strip_extension_and_fold`.
        assert_eq!(
            root_relative_key("/v", "/v/Dir/Note.md", false),
            Some("dir/note".to_string())
        );
        assert_eq!(
            root_relative_key("/v", "/v/Dir/Note.markdown", false),
            Some("dir/note".to_string())
        );
        assert_eq!(
            root_relative_key("/v", "/v/Note.md", false),
            Some("note".to_string())
        );
        assert_eq!(root_relative_key("/v", "/elsewhere/Note.md", false), None);
        assert_eq!(
            root_relative_key(r"C:\v", r"C:\v\dir\note.md", true),
            Some("dir/note".to_string())
        );
        assert_eq!(
            root_relative_key("C:/v", r"C:\v\dir\note.md", true),
            Some("dir/note".to_string())
        );
    }

    #[test]
    fn the_root_itself_has_no_path_key() {
        // What fails this: dropping the `!rest.is_empty()` filter in
        // `under_root`, which gives the root the empty key `""`.
        assert_eq!(root_relative_key("/v", "/v", false), None);
        assert_eq!(root_relative_key(r"C:\v", r"C:\v", true), None);
        assert_eq!(
            root_relative_key("/v", "/v/note.md", false),
            Some("note".to_string())
        );
    }

    fn local(alias: &str, root: &str) -> LocalAlias {
        LocalAlias {
            alias: alias.to_string(),
            root: root.to_string(),
        }
    }

    #[test]
    fn keys_for_pairs_each_local_alias_with_its_own_vaults_root() {
        // What fails this: keying an alias's path under the `root` being
        // read instead of the alias's own — `/v/sub/a/old.md` then answers
        // `Foreign { p, a/old }`, which names `/v/a/old.md`.
        let aliases = vec![local("p", "/v"), local("s", "/v/sub")];
        assert_eq!(
            keys_for("/v/sub/a/old.md", Some("/v/sub"), &aliases, false),
            vec![
                stem("old"),
                path("a/old"),
                foreign("p", "old"),
                foreign("p", "sub/a/old"),
                foreign("s", "old"),
                foreign("s", "a/old"),
            ]
        );
        // A file outside an alias's vault has no path key under it.
        assert_eq!(
            keys_for("/v/a/old.md", Some("/v"), &aliases, false),
            vec![
                stem("old"),
                path("a/old"),
                foreign("p", "old"),
                foreign("p", "a/old"),
                foreign("s", "old"),
            ]
        );
    }

    #[test]
    fn keys_for_names_the_stem_the_path_and_each_local_alias() {
        // What fails this: dropping the `Foreign` loop over `local_aliases`.
        let aliases = vec![local("work", "/v")];
        assert_eq!(
            keys_for("/v/dir/note.md", Some("/v"), &aliases, false),
            vec![
                stem("note"),
                path("dir/note"),
                foreign("work", "note"),
                foreign("work", "dir/note"),
            ]
        );
        // With no index root, the alias's own root still keys the path.
        assert_eq!(
            keys_for("/v/dir/note.md", None, &aliases, false),
            vec![
                stem("note"),
                foreign("work", "note"),
                foreign("work", "dir/note")
            ]
        );
    }
}
