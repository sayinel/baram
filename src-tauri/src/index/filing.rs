// §29 Filing keys — the one place that decides which key a reference is filed
// under in the link index, and which keys a file answers to. What a rename
// makes of a reference under those keys is `judgement.rs`.

use super::normalizer::{normalize_file_path, normalize_target};
use super::relative_links::{path_components, resolve_components, root_components, same_component};

/// The key a reference or a file is filed under in the link index.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum FilingKey {
    /// A bare name with no separator: `[[Note]]` → `note`.
    Stem(String),
    /// A path-qualified target: resolved root-relative when it is relative
    /// (`./`, `../`) and lands under the root, else the written text folded —
    /// lowercase, one note extension off, and on Windows a non-relative
    /// target's `\` made `/` (`filing_key`): `[[Dir/Note.md]]` → `dir/note`.
    Path(String),
    /// A target qualified by a vault alias: `[[work::Old]]` files under the
    /// alias and the target text — its separators folded as a path's on
    /// Windows — never resolved against this vault's root.
    Foreign { alias: String, target: String },
}

/// A vault alias local to the file a reader asks about, paired with the root
/// of the vault it names. `alias` is already lowercase — it is folded once,
/// where it enters (`service::keys::local_aliases_of`), and every comparison
/// here assumes so; `filing_key` folds the alias a LINK is written with.
/// `root` is that vault's registered path: an alias resolves a path against
/// it, never against the root of the index being read.
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

/// `name` without one trailing `.md` or `.markdown`, lowercase.
fn strip_extension_and_fold(name: &str) -> String {
    let name = name
        .strip_suffix(".md")
        .or_else(|| name.strip_suffix(".markdown"))
        .unwrap_or(name);
    name.to_lowercase()
}

/// The last component of the key `root_relative_key` gives `file_path` — its
/// file name, one `.md` or `.markdown` off, lowercase — without spelling the
/// rest. Two files whose path keys are equal have equal names here, so
/// grouping by this finds every collision (`LinkIndex::colliding_path_keys`).
/// The name is the last of `path_components`, found without collecting them.
pub fn path_key_name(file_path: &str, windows: bool) -> String {
    let name = file_path
        .rsplit(|c| c == '/' || (windows && c == '\\'))
        .find(|part| !part.is_empty() && *part != ".")
        .unwrap_or("");
    strip_extension_and_fold(name)
}

/// The components of `path` under the directory `root`, or None when `path`
/// is not under it or is the directory itself.
pub(super) fn under_root<'a>(
    root: &[&str],
    path: &[&'a str],
    windows: bool,
) -> Option<Vec<&'a str>> {
    if path.len() <= root.len() {
        return None;
    }
    let under = root
        .iter()
        .zip(path)
        .all(|(r, p)| same_component(r, p, windows));
    under.then(|| path[root.len()..].to_vec())
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
            alias: alias.to_lowercase(),
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

/// The path of `file_path` under `root` the way a link to it is filed:
/// components joined with `/`, lowercase, one `.md` or `.markdown` removed.
/// None when the file is not under `root`.
pub fn root_relative_key(root: &str, file_path: &str, windows: bool) -> Option<String> {
    let file = path_components(file_path, windows);
    under_root(&path_components(root, windows), &file, windows)
        .map(|rest| strip_extension_and_fold(&rest.join("/")))
}

/// Every key a link to the file at `file_path` may be filed under, in order:
/// its stem, its path under `root`, then for each of `local_aliases` its
/// stem and its path under THAT alias's root — not `root`. An alias resolves
/// a path against the vault it names, so with the nested vaults `/v` (alias
/// `p`) and `/v/sub` (alias `s`), `[[p::a/old]]` names `/v/a/old.md` in
/// whichever index it is read, never `/v/sub/a/old.md`. A file outside an
/// alias's vault has no path key under it.
pub fn keys_for(
    file_path: &str,
    root: Option<&str>,
    local_aliases: &[LocalAlias],
    windows: bool,
) -> Vec<FilingKey> {
    // The file name alone, so a Windows path is read on any host.
    let name = path_components(file_path, windows)
        .last()
        .copied()
        .unwrap_or_default();
    let stem = normalize_file_path(name);
    let rel = root.and_then(|root| root_relative_key(root, file_path, windows));

    let mut keys = vec![FilingKey::Stem(stem.clone())];
    keys.extend(rel.map(FilingKey::Path));
    for la in local_aliases {
        keys.push(FilingKey::Foreign {
            alias: la.alias.clone(),
            target: stem.clone(),
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
