// §29 Filing keys — the one place that decides which key a reference is filed
// under in the link index, and which keys a file answers to.

use super::normalizer::{normalize_file_path, normalize_target};
use super::relative_links::{path_components, resolve_components, root_components, same_component};

/// The key a reference or a file is filed under in the link index.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum FilingKey {
    /// A bare name with no separator: `[[Note]]` → `note`.
    Stem(String),
    /// A target with a separator, as a lowercase root-relative path without
    /// its note extension: `[[Dir/Note.md]]` → `dir/note`.
    Path(String),
    /// A target qualified by a vault alias: `[[work:Old]]` files under the
    /// alias and the target text, never resolved against this vault's root.
    Foreign { alias: String, target: String },
}

/// Does `target` start with `./` or `../` (and, on Windows, `.\` or `..\`)?
fn is_relative(target: &str, windows: bool) -> bool {
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

/// The components of `path` under the directory `root`, or None when `path`
/// is not under it or is the directory itself.
fn under_root<'a>(root: &[&str], path: &[&'a str], windows: bool) -> Option<Vec<&'a str>> {
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
    if let Some(alias) = alias {
        return FilingKey::Foreign {
            alias: alias.to_lowercase(),
            target: normalized,
        };
    }
    let text = target.trim();
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
/// its stem, its path under `root`, then each of `local_aliases` paired with
/// both.
pub fn keys_for(
    file_path: &str,
    root: Option<&str>,
    local_aliases: &[String],
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
    keys.extend(rel.clone().map(FilingKey::Path));
    for alias in local_aliases {
        let alias = alias.to_lowercase();
        keys.push(FilingKey::Foreign {
            alias: alias.clone(),
            target: stem.clone(),
        });
        if let Some(rel) = &rel {
            keys.push(FilingKey::Foreign {
                alias,
                target: rel.clone(),
            });
        }
    }
    keys
}

/// The file whose block a block-ID rename renames, as the keys a reference to
/// it may be filed under in each index that holds it: one `(root, keys)` pair
/// per containing root, because a path-qualified key is the file's path under
/// THAT root.
pub struct BlockTarget {
    pub keys_by_root: Vec<(String, Vec<FilingKey>)>,
    pub windows: bool,
}

impl BlockTarget {
    /// Does `raw_target`, written in the referrer at `ref_path`, name this
    /// file? It is keyed by `filing_key` — the rule the index files it by —
    /// under each root in `covering_roots` (the roots whose index covers the
    /// referrer), and matches when that root's keys hold the result. A `Stem`
    /// key does not depend on the root, so any covering root answers a bare
    /// reference; a referrer that no root covers matches nothing.
    pub fn refers(&self, ref_path: &str, covering_roots: &[String], raw_target: &str) -> bool {
        let raw = raw_target.trim();
        if raw.is_empty() {
            return false;
        }
        self.keys_by_root
            .iter()
            .filter(|(root, _)| covering_roots.contains(root))
            .any(|(root, keys)| {
                keys.contains(&filing_key(ref_path, raw, None, Some(root), self.windows))
            })
    }
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
        // What fails this: dropping the alias arm, so `[[Work:Old]]` files as a stem.
        let key = |a, t| filing_key("/v/r.md", t, Some(a), Some("/v"), false);
        assert_eq!(key("Work", "Old.md"), foreign("work", "old"));
        assert_eq!(key("work", "dir/Old"), foreign("work", "dir/old"));
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
    fn keys_for_names_the_stem_the_path_and_each_local_alias() {
        // What fails this: dropping the `Foreign` loop over `local_aliases`.
        let aliases = vec!["work".to_string()];
        assert_eq!(
            keys_for("/v/dir/note.md", Some("/v"), &aliases, false),
            vec![
                stem("note"),
                path("dir/note"),
                foreign("work", "note"),
                foreign("work", "dir/note"),
            ]
        );
        assert_eq!(
            keys_for("/v/dir/note.md", None, &aliases, false),
            vec![stem("note"), foreign("work", "note")]
        );
    }
}
