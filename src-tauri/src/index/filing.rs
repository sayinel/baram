// §29 Filing keys — the one place that decides which key a reference is filed
// under in the link index, and which keys a file answers to.

use super::normalizer::{file_key, normalize_file_path, normalize_target};
use super::relative_links::{
    path_components, relative_components, resolve_components, root_components, same_component,
};

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
        let keys_of = |root: &String| {
            self.keys_by_root
                .iter()
                .find(|(r, _)| r == root)
                .map(|(_, keys)| keys)
        };
        keyed_under(ref_path, covering_roots, None, raw_target, self.windows)
            .any(|(root, key)| keys_of(root).is_some_and(|keys| keys.contains(&key)))
    }
}

/// `raw_target`, written in the referrer at `ref_path`, keyed by `filing_key`
/// under each of `roots` in turn — the judgement `BlockTarget::refers` and
/// `RenameTarget::refers` share. Nothing when the target is blank: a
/// self-reference names no file.
fn keyed_under<'r>(
    ref_path: &'r str,
    roots: &'r [String],
    alias: Option<&'r str>,
    raw_target: &'r str,
    windows: bool,
) -> impl Iterator<Item = (&'r String, FilingKey)> + 'r {
    let raw = raw_target.trim();
    roots
        .iter()
        .filter(move |_| !raw.is_empty())
        .map(move |root| (root, filing_key(ref_path, raw, alias, Some(root), windows)))
}

/// How a reference named the file a rename renames: by its stem, which no
/// root qualifies, or by its path under `root` — spelled from that root, or,
/// when `relative`, from the referrer's folder (`./`, `../`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Match {
    Stem,
    Path { root: String, relative: bool },
}

/// The file a file rename renames, from `old_path` to `new_path` in the same
/// directory. `local_aliases` are this vault's own aliases: a link qualified
/// by one of them names a file here, a link qualified by any other names a
/// file in another vault.
pub struct RenameTarget<'a> {
    pub old_path: &'a str,
    pub new_path: &'a str,
    pub local_aliases: &'a [String],
    pub windows: bool,
}

/// The stem of the file at `path`, read from its last component so that a
/// Windows path is read on any host: `std::path::Path::file_stem` of that
/// name — every extension a file may have, as `keys_for` reads it.
fn stem_of(path: &str, windows: bool) -> &str {
    let name = path_components(path, windows).last().copied().unwrap_or("");
    std::path::Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(name)
}

/// `name` without one trailing `.md` or `.markdown`, its case kept — the
/// spelling of a path link's last component (`strip_extension_and_fold`
/// without the fold), so the link reads back as the file's path key.
fn strip_note_extension(name: &str) -> &str {
    name.strip_suffix(".md")
        .or_else(|| name.strip_suffix(".markdown"))
        .unwrap_or(name)
}

/// The `.md` or `.markdown` a captured target ends in, as it is spelled
/// there (any case), or "".
fn note_suffix(captured: &str) -> &str {
    let t = captured.trim();
    for ext in [".markdown", ".md"] {
        if t.len() >= ext.len() && t.is_char_boundary(t.len() - ext.len()) {
            let tail = &t[t.len() - ext.len()..];
            if tail.eq_ignore_ascii_case(ext) {
                return tail;
            }
        }
    }
    ""
}

impl RenameTarget<'_> {
    /// The renamed file's stem before the rename.
    pub fn old_stem(&self) -> &str {
        stem_of(self.old_path, self.windows)
    }

    /// The renamed file's stem after the rename — what a stem link is
    /// respelled with, and what the spellability predicates judge.
    pub fn new_stem(&self) -> &str {
        stem_of(self.new_path, self.windows)
    }

    /// Does `raw_target`, written in the referrer at `ref_path` behind
    /// `alias_prefix` (the captured `word::`, or the bare alias, or ""), name
    /// the renamed file? It is keyed by `filing_key` — the rule the index
    /// files it by — under each root in `covering_roots` (the roots whose
    /// index covers the referrer), first match wins. A `Stem` key does not
    /// depend on the root but still needs a covering root, as
    /// `BlockTarget::refers`. A link behind an alias that is not one of
    /// `local_aliases` names a file in another vault and is never this
    /// file's. One behind a local alias is judged as the index files it —
    /// `filing_key(ref_path, raw, Some(alias), Some(root), windows)`, a
    /// `Foreign` key, against the `Foreign` keys `keys_for(old_path,
    /// Some(root), local_aliases, windows)` gives this file: so
    /// `[[work::old]]` and `[[work::dir/old]]` match the local alias `work`,
    /// and `[[work::./old]]` never does, because a `Foreign` target is not
    /// resolved against the referrer's folder and the index never counts it
    /// under this file.
    pub fn refers(
        &self,
        ref_path: &str,
        covering_roots: &[String],
        alias_prefix: &str,
        raw_target: &str,
    ) -> Option<Match> {
        let alias = alias_prefix.strip_suffix("::").unwrap_or(alias_prefix);
        let alias = if alias.is_empty() {
            None
        } else if self
            .local_aliases
            .iter()
            .any(|a| a.to_lowercase() == alias.to_lowercase())
        {
            Some(alias)
        } else {
            return None;
        };
        let stem = file_key(self.old_stem());
        let relative = is_relative(raw_target.trim(), self.windows);
        keyed_under(ref_path, covering_roots, alias, raw_target, self.windows).find_map(
            |(root, key)| {
                let rel = root_relative_key(root, self.old_path, self.windows);
                let path_match = || Match::Path {
                    root: root.clone(),
                    relative,
                };
                match key {
                    FilingKey::Stem(s) if s == stem => Some(Match::Stem),
                    FilingKey::Path(p) if Some(&p) == rel.as_ref() => Some(path_match()),
                    FilingKey::Foreign { target, .. } if target == stem => Some(Match::Stem),
                    FilingKey::Foreign { target, .. } if Some(&target) == rel.as_ref() => {
                        Some(Match::Path {
                            root: root.clone(),
                            relative: false,
                        })
                    }
                    _ => None,
                }
            },
        )
    }

    /// The components of the renamed file after the rename, its last one
    /// spelled as a path link spells it (`strip_note_extension`).
    fn new_components(&self) -> Vec<&str> {
        let mut components = path_components(self.new_path, self.windows);
        if let Some(last) = components.last_mut() {
            *last = strip_note_extension(last);
        }
        components
    }

    /// The new target TEXT for a reference `refers` matched — no alias
    /// prefix, no heading, block or display: the new stem for `Stem`; the
    /// file's components under `root` joined with `/` for `Path`, or, when
    /// `relative`, the way from the referrer's folder (`relative_components`)
    /// — spelled as `new_path` spells them, whatever the link's case or
    /// separator was. A captured target ending in `.md` or `.markdown` keeps
    /// that suffix as it was spelled.
    pub fn respell(&self, ref_path: &str, m: &Match, captured_target: &str) -> String {
        let suffix = note_suffix(captured_target);
        let target = match m {
            Match::Stem => self.new_stem().to_string(),
            Match::Path { relative: true, .. } => {
                let mut source_dir = path_components(ref_path, self.windows);
                source_dir.pop();
                relative_components(&source_dir, &self.new_components(), self.windows)
            }
            Match::Path { root, .. } => {
                let new = self.new_components();
                under_root(&path_components(root, self.windows), &new, self.windows)
                    .map_or_else(|| self.new_stem().to_string(), |rest| rest.join("/"))
            }
        };
        format!("{target}{suffix}")
    }

    /// The key the index files a reference `respell` wrote under, in the
    /// index whose root the match was made under — the read-back gate's
    /// expectation: `Stem(file_key(new stem))`, or the new file's
    /// `root_relative_key` under `root`. A new path outside `root` (which a
    /// rename in place never makes) falls back to the new stem's key, which
    /// the gate then finds unequal and the file is left and reported.
    pub fn expected_key(&self, m: &Match) -> FilingKey {
        let stem = file_key(self.new_stem());
        match m {
            Match::Stem => FilingKey::Stem(stem),
            Match::Path { root, .. } => FilingKey::Path(
                root_relative_key(root, self.new_path, self.windows).unwrap_or(stem),
            ),
        }
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
