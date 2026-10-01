// §33 Rename judgement — what a file or block rename makes of one reference,
// keyed by `filing.rs`: it names the renamed file, names another, or is
// ambiguous; and, for a file rename, how the reference is respelled.

use super::filing::{
    filing_key, is_relative, root_relative_key, under_root, FilingKey, LocalAlias,
};
use super::normalizer::{file_key, strip_note_extension};
use super::relative_links::{path_components, relative_components};
use std::collections::HashMap;

/// What the rename knows of the notes under each root that holds a
/// referrer, by that root — every directory context holding one, not only
/// the renamed file's. The rename judgement reads it to tell whether another
/// root that holds the referrer reads a path link as an existing note. A
/// root with no entry holds none of the referrers.
pub type KnownPaths = HashMap<String, RootNotes>;

/// The notes one root holds, as far as the rename can tell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RootNotes {
    /// Its index is built: the `Path`-key text of every note in it, with
    /// how many of its notes fold to that key
    /// (`LinkIndex::registered_path_keys`). More than one is a collision —
    /// `A/note.md` and `a/note.md` on a file system that keeps case — and a
    /// link filed under that key names neither note alone.
    Known(HashMap<String, usize>),
    /// Its index is built and it is the only root holding the renamed file
    /// or a referrer: the `Path` keys two or more of its notes fold to, with
    /// how many (`LinkIndex::colliding_path_keys`), and not the rest. With
    /// one holding root, a path link matched under it is read by no other
    /// root, and under it the link reads as the renamed file's own key, so a
    /// collision is the one thing that can make it ambiguous. Any other
    /// reading counts as a note that exists, as `Unknown` does, so a key
    /// this map leaves out never lets a link through that `Known` would stop.
    Sole(HashMap<String, usize>),
    /// Its index could not be built or read. Any `Path` reading under it
    /// may be another note, so a link it could read is left and its file
    /// reported — never rewritten on the assumption that nothing is there.
    Unknown,
}

/// What a rename makes of one reference: it names the renamed file (with
/// how it matched), it names another file, or it is AMBIGUOUS — it names the
/// renamed file by its path under one covering root while a root that holds
/// the referrer reads the same text as a different note that exists: another
/// root's note under that path, or a second note of one root that folds to
/// the same path key (`read_as_another_note`). An ambiguous reference is
/// left as written and its file is reported: rewriting it would break the
/// other reading.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Judgement<M> {
    Ours(M),
    Ambiguous,
    NotOurs,
}

impl<M> Judgement<M> {
    /// The match, when the reference names the renamed file unambiguously.
    pub fn ours(self) -> Option<M> {
        match self {
            Judgement::Ours(m) => Some(m),
            _ => None,
        }
    }
}

/// Does a root of `known_paths` whose folder holds the referrer at
/// `ref_path` — compared lexically, as every key is — read `raw_target` as a
/// note that exists under it and is not the renamed file (`is_the_target`,
/// given that root and the path key)? It does when that root holds a note
/// under the key that is not the renamed file, and when more than one of its
/// notes folds to the key, whichever they are: on a file system that keeps
/// case, `/v/A/note.md` and `/v/a/note.md` both answer `[[a/note]]`, so
/// renaming either would rewrite the other's link. That second reading is
/// the only way the root the reference matched under answers yes; otherwise
/// it reads the text as the renamed file's own key. The roots
/// are every directory context holding the renamed file or a referrer, not
/// only the renamed file's contexts: renaming the parent's `/v/a/old.md` must
/// still see that the child root `/v/sub`, which does not contain that file,
/// reads `/v/sub/r.md`'s `[[a/old]]` as `/v/sub/a/old.md`. A root whose notes
/// are `Unknown` (its index could not be built) is read as holding every path
/// but the renamed file's. Only a `Path` reading counts: a bare name is filed
/// by its stem in every root alike, which is the stem contract a rename
/// already follows. With an empty map nothing is ambiguous.
fn read_as_another_note(
    ref_path: &str,
    raw_target: &str,
    known_paths: &KnownPaths,
    is_the_target: impl Fn(&str, &str) -> bool,
    windows: bool,
) -> bool {
    let raw = raw_target.trim();
    let referrer = path_components(ref_path, windows);
    known_paths.iter().any(|(root, known)| {
        under_root(&path_components(root, windows), &referrer, windows).is_some()
            && match filing_key(ref_path, raw, None, Some(root), windows) {
                FilingKey::Path(p) => match known {
                    RootNotes::Known(notes) => notes
                        .get(&p)
                        .is_some_and(|&n| n > 1 || !is_the_target(root, &p)),
                    RootNotes::Sole(colliding) => {
                        colliding.contains_key(&p) || !is_the_target(root, &p)
                    }
                    RootNotes::Unknown => !is_the_target(root, &p),
                },
                FilingKey::Stem(_) | FilingKey::Foreign { .. } => false,
            }
    })
}

/// The file whose block a block-ID rename renames, as the keys a reference to
/// it may be filed under in each index that holds it: one `(root, keys)` pair
/// per containing root, because a path-qualified key is the file's path under
/// THAT root.
pub struct BlockTarget {
    pub keys_by_root: Vec<(String, Vec<FilingKey>)>,
    /// The notes each index holds, for the ambiguity judgement (`judge`).
    pub known_paths: KnownPaths,
    pub windows: bool,
}

impl BlockTarget {
    /// Does `raw_target`, written in the referrer at `ref_path`, name this
    /// file unambiguously? `judge` says `Ours`.
    pub fn refers(&self, ref_path: &str, covering_roots: &[String], raw_target: &str) -> bool {
        self.judge(ref_path, covering_roots, raw_target) == Judgement::Ours(())
    }

    /// `raw_target`, written in the referrer at `ref_path`, keyed by
    /// `filing_key` — the rule the index files it by — under each root in
    /// `covering_roots` (the roots whose index covers the referrer), first
    /// match wins: it names this file when that root's keys hold the result.
    /// A `Stem` key does not depend on the root, so any covering root answers
    /// a bare reference; a referrer that no root covers matches nothing. A
    /// `Path` match is `Ambiguous` when a root holding the referrer reads
    /// the same text as a different note that exists, another root's or a
    /// second note of one root folding to the same key
    /// (`read_as_another_note`).
    pub fn judge(
        &self,
        ref_path: &str,
        covering_roots: &[String],
        raw_target: &str,
    ) -> Judgement<()> {
        let keys_of = |root: &str| {
            self.keys_by_root
                .iter()
                .find(|(r, _)| r == root)
                .map(|(_, keys)| keys)
        };
        let matched = keyed_under(ref_path, covering_roots, None, raw_target, self.windows)
            .find(|(root, key)| keys_of(root).is_some_and(|keys| keys.contains(key)));
        match matched {
            None => Judgement::NotOurs,
            Some((_, FilingKey::Path(_)))
                if read_as_another_note(
                    ref_path,
                    raw_target,
                    &self.known_paths,
                    |r, p| {
                        keys_of(r)
                            .is_some_and(|keys| keys.contains(&FilingKey::Path(p.to_string())))
                    },
                    self.windows,
                ) =>
            {
                Judgement::Ambiguous
            }
            Some((_, FilingKey::Stem(_) | FilingKey::Path(_) | FilingKey::Foreign { .. })) => {
                Judgement::Ours(())
            }
        }
    }
}

/// `raw_target`, written in the referrer at `ref_path`, keyed by `filing_key`
/// under each of `roots` in turn — the judgement `BlockTarget::judge` and
/// `RenameTarget::judge` share. Nothing when the target is blank: a
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
/// directory. `local_aliases` are the aliases of the vaults that hold it,
/// each with its vault's root: a link qualified by one of them names a file
/// in that vault, a link qualified by any other names a file elsewhere.
pub struct RenameTarget<'a> {
    pub old_path: &'a str,
    pub new_path: &'a str,
    pub local_aliases: &'a [LocalAlias],
    /// The notes each index holds, for the ambiguity judgement (`judge`).
    pub known_paths: KnownPaths,
    pub windows: bool,
}

/// The stem of the file at `path`, read from its last component so that a
/// Windows path is read on any host: `std::path::Path::file_stem` of that
/// name — the name without its last extension, as `keys_for` reads it.
fn stem_of(path: &str, windows: bool) -> &str {
    let name = path_components(path, windows).last().copied().unwrap_or("");
    std::path::Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
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
    /// `alias_prefix`, name the renamed file unambiguously? `judge` says
    /// `Ours`, with how it matched.
    pub fn refers(
        &self,
        ref_path: &str,
        covering_roots: &[String],
        alias_prefix: &str,
        raw_target: &str,
    ) -> Option<Match> {
        self.judge(ref_path, covering_roots, alias_prefix, raw_target)
            .ours()
    }

    /// What `raw_target`, written in the referrer at `ref_path` behind
    /// `alias_prefix` (the captured `word::`, or the bare alias, or ""), is
    /// to this rename. It is keyed by `filing_key` — the rule the index
    /// files it by — under each root in `covering_roots` (the roots whose
    /// index covers the referrer), first match wins. A `Stem` key does not
    /// depend on the root but still needs a covering root, as
    /// `BlockTarget::judge`. A `Path` match under one root is `Ambiguous`
    /// when another root holding the referrer reads the same text as a
    /// different note that exists (`read_as_another_note`) — the referrer of
    /// nested roots `/v` and `/v/sub` whose `[[a/old]]` is `/v/sub/a/old.md`
    /// under one and `/v/a/old.md` under the other — and when two notes of
    /// one root fold to the matched key, as `/v/A/old.md` beside
    /// `/v/a/old.md` on a file system that keeps case. A link behind an alias
    /// that is not one of `local_aliases` names a file in another vault and
    /// is never this file's (`refers_behind_alias`); one behind a local alias
    /// resolves against that alias's own root, so no other root reads it.
    pub fn judge(
        &self,
        ref_path: &str,
        covering_roots: &[String],
        alias_prefix: &str,
        raw_target: &str,
    ) -> Judgement<Match> {
        let alias = alias_prefix.strip_suffix("::").unwrap_or(alias_prefix);
        if !alias.is_empty() {
            return match self.refers_behind_alias(ref_path, covering_roots, alias, raw_target) {
                Some(m) => Judgement::Ours(m),
                None => Judgement::NotOurs,
            };
        }
        let stem = file_key(self.old_stem());
        let relative = is_relative(raw_target.trim(), self.windows);
        let matched = keyed_under(ref_path, covering_roots, None, raw_target, self.windows)
            .find_map(|(root, key)| {
                let rel = root_relative_key(root, self.old_path, self.windows);
                let path_match = || Match::Path {
                    root: root.clone(),
                    relative,
                };
                match key {
                    FilingKey::Stem(s) if s == stem => Some(Match::Stem),
                    FilingKey::Path(p) if Some(&p) == rel.as_ref() => Some(path_match()),
                    FilingKey::Stem(_) | FilingKey::Path(_) | FilingKey::Foreign { .. } => None,
                }
            });
        match matched {
            None => Judgement::NotOurs,
            Some(Match::Path { .. })
                if read_as_another_note(
                    ref_path,
                    raw_target,
                    &self.known_paths,
                    |r, p| root_relative_key(r, self.old_path, self.windows).as_deref() == Some(p),
                    self.windows,
                ) =>
            {
                Judgement::Ambiguous
            }
            Some(m) => Judgement::Ours(m),
        }
    }

    /// `refers` for a link behind `alias`: judged as the index files it —
    /// `filing_key(.., Some(alias), ..)`, a `Foreign` key whatever the root —
    /// against the two `Foreign` keys `keys_for` gives this file under each
    /// local alias of that name: its stem (a `Stem` match), or its path under
    /// THAT alias's root (a `Path` match under that root, which `respell`
    /// spells from it and `expected_key` keys under it; the read-back gate
    /// wraps the alias around that key). So `[[work::old]]` and
    /// `[[work::dir/old]]` match the local alias `work`, and `[[work::./old]]`
    /// never does: a `Foreign` target is not resolved against the referrer's
    /// folder and the index never counts it under this file. A covering root
    /// is still needed, as for any link.
    fn refers_behind_alias(
        &self,
        ref_path: &str,
        covering_roots: &[String],
        alias: &str,
        raw_target: &str,
    ) -> Option<Match> {
        let alias = alias.to_lowercase();
        let stem = file_key(self.old_stem());
        let (_, key) = keyed_under(
            ref_path,
            covering_roots,
            Some(&alias),
            raw_target,
            self.windows,
        )
        .next()?;
        let target = match key {
            FilingKey::Foreign { target, .. } => target,
            // `filing_key` given an alias answers `Foreign` and nothing else.
            FilingKey::Stem(_) | FilingKey::Path(_) => return None,
        };
        self.local_aliases
            .iter()
            .filter(|la| la.alias == alias)
            .find_map(|la| {
                if target == stem {
                    Some(Match::Stem)
                } else if Some(&target)
                    == root_relative_key(&la.root, self.old_path, self.windows).as_ref()
                {
                    Some(Match::Path {
                        root: la.root.clone(),
                        relative: false,
                    })
                } else {
                    None
                }
            })
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
    /// that suffix as it was spelled only when the new file name itself ends
    /// in `.md` or `.markdown`: after `a/old.md` → `a/old.txt`, `[[a/old.md]]`
    /// becomes `[[a/old.txt]]` and `[[old.md]]` becomes `[[old]]` — a kept
    /// `.md` would spell `a/old.txt.md`, which names no file.
    pub fn respell(&self, ref_path: &str, m: &Match, captured_target: &str) -> String {
        let new_name = path_components(self.new_path, self.windows)
            .last()
            .copied()
            .unwrap_or("");
        let suffix = if note_suffix(new_name).is_empty() {
            ""
        } else {
            note_suffix(captured_target)
        };
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
    use crate::index::keys_for;

    /// `known_paths` for the one root `/v`, where `count` notes fold to
    /// `a/note`.
    fn notes_folding_to_a_note(count: usize) -> KnownPaths {
        [(
            "/v".to_string(),
            RootNotes::Known([("a/note".to_string(), count)].into()),
        )]
        .into()
    }

    #[test]
    fn a_sole_root_reads_a_path_link_as_ambiguous_only_on_a_collision() {
        // With one holding root the rename collects only the keys its notes
        // collide on (`RootNotes::Sole`): a key there is ambiguous, and a key
        // left out is the renamed file's own, since no other root reads it.
        // What fails this: reading `Sole` the way `Unknown` is read, its map
        // ignored — `[[a/note]]` is then `Ours` beside its twin.
        let roots = vec!["/v".to_string()];
        let rename = |colliding: HashMap<String, usize>| RenameTarget {
            old_path: "/v/a/note.md",
            new_path: "/v/a/new.md",
            local_aliases: &[],
            known_paths: [("/v".to_string(), RootNotes::Sole(colliding))].into(),
            windows: false,
        };
        assert_eq!(
            rename([("a/note".to_string(), 2)].into()).judge("/v/r.md", &roots, "", "a/note"),
            Judgement::Ambiguous
        );
        assert_eq!(
            rename(HashMap::new()).judge("/v/r.md", &roots, "", "a/note"),
            Judgement::Ours(Match::Path {
                root: "/v".to_string(),
                relative: false,
            })
        );
    }

    #[test]
    fn a_path_key_two_notes_of_one_root_fold_to_is_ambiguous() {
        // On a file system that keeps case, `/v/A/note.md` and
        // `/v/a/note.md` both file `[[A/note]]` and `[[a/note]]` under
        // `a/note`: the link names neither alone, so renaming either leaves
        // it. One note under the key is the renamed file itself, and its
        // links are its own.
        // What fails this: dropping the `n > 1` reading from
        // `read_as_another_note` — the one root the link matched under then
        // reads it as the renamed file, and both judgements say `Ours`.
        let roots = vec!["/v".to_string()];
        let rename = |known_paths| RenameTarget {
            old_path: "/v/a/note.md",
            new_path: "/v/a/new.md",
            local_aliases: &[],
            known_paths,
            windows: false,
        };
        let block = |known_paths| BlockTarget {
            keys_by_root: vec![(
                "/v".to_string(),
                keys_for("/v/a/note.md", Some("/v"), &[], false),
            )],
            known_paths,
            windows: false,
        };
        for spelled in ["A/note", "a/note", "./a/note"] {
            assert_eq!(
                rename(notes_folding_to_a_note(2)).judge("/v/r.md", &roots, "", spelled),
                Judgement::Ambiguous,
                "{spelled}"
            );
            assert_eq!(
                block(notes_folding_to_a_note(2)).judge("/v/r.md", &roots, spelled),
                Judgement::Ambiguous,
                "{spelled}"
            );
            assert_eq!(
                rename(notes_folding_to_a_note(1)).judge("/v/r.md", &roots, "", spelled),
                Judgement::Ours(Match::Path {
                    root: "/v".to_string(),
                    relative: spelled.starts_with("./"),
                }),
                "{spelled}"
            );
            assert_eq!(
                block(notes_folding_to_a_note(1)).judge("/v/r.md", &roots, spelled),
                Judgement::Ours(()),
                "{spelled}"
            );
        }
        // A bare name is filed by its stem, which the collision does not
        // touch: the stem contract a rename already follows.
        assert_eq!(
            rename(notes_folding_to_a_note(2)).judge("/v/r.md", &roots, "", "note"),
            Judgement::Ours(Match::Stem)
        );
    }
}
