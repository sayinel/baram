// §33 Rename judgement — what a file or block rename makes of one reference,
// keyed by `filing.rs`: it names the renamed file, names another, or is
// ambiguous; and, for a file rename, how the reference is respelled.

use super::filing::{
    filing_key, is_relative, root_relative_key, under_root, FilingKey, LocalAlias,
};
use super::normalizer::{file_key, fold_name, nfc, strip_note_extension};
use super::relative_links::{path_components, relative_components};
use std::collections::{HashMap, HashSet};

/// What the rename knows of the notes under each root that holds a
/// referrer, by that root — every directory context holding one, not only
/// the renamed file's. The rename judgement reads it to tell whether another
/// root that holds the referrer reads a path link as an existing note. A
/// root with no entry holds none of the referrers.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct KnownPaths {
    pub roots: HashMap<String, RootNotes>,
    /// A referrer, as the renamed file's indexes spell it, by each holding
    /// root that contains it only as resolved and the spelling it has under
    /// that root. `ContextManager::contexts_containing` compares canonical
    /// paths, so a child root registered through a symlink
    /// (`/elsewhere/alias` → `/v/sub`), in another spelling of the same
    /// folder (`/private/var/…` beside `/var/…`), or in another case where
    /// case folds, holds `/v/sub/r.md` though its spelling is no prefix of
    /// it. The judgement reads that root's notes with the referrer spelled
    /// under it (`/elsewhere/alias/r.md`), as it reads any root
    /// (`read_as_another_note`).
    pub spelled: HashMap<String, HashMap<String, String>>,
    /// The renamed file's `Path` key under each holding root that contains
    /// it only as resolved, as `spelled` maps a referrer: the key that
    /// root's notes count the renamed file under, which its spelling gives
    /// no other way.
    pub renamed: HashMap<String, String>,
    /// The referrers some holding root contains as resolved but whose
    /// spelling under it could not be found (`spelled` has no entry). Every
    /// `Path` reading in such a referrer is ambiguous: left and reported,
    /// never rewritten.
    pub unplaced: HashSet<String>,
}

impl<const N: usize> From<[(String, RootNotes); N]> for KnownPaths {
    fn from(roots: [(String, RootNotes); N]) -> Self {
        KnownPaths {
            roots: roots.into(),
            ..KnownPaths::default()
        }
    }
}

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
    /// how many (`LinkIndex::colliding_path_keys`), and for a file rename
    /// the new name's key with how many notes fold to it now, one or none
    /// included (`LinkIndex::path_key_notes`) — and not the rest. With one
    /// holding root, a path link matched under it is read by no other root,
    /// and under it the old text reads as the renamed file's own key and the
    /// respelled text as the new one, so a note already under either key is
    /// the one thing that can make it ambiguous. Any other reading counts as
    /// a note that exists, as `Unknown` does, so a key this map leaves out
    /// never lets a link through that `Known` would stop. Read as counts,
    /// like `Known`: a key is another note's when it counts more notes than
    /// the renamed file.
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

/// Does `root`, as spelled, hold the file at `ref_path` as spelled — the
/// lexical containment every key is read under? The judgement asks it of
/// each root (`read_as_another_note`); the rename's scope asks it of each
/// root that holds a referrer as resolved, and a no sends it to
/// `KnownPaths::spelled` (or `unplaced`).
pub(crate) fn root_places(root: &str, ref_path: &str, windows: bool) -> bool {
    under_root(
        &path_components(root, windows),
        &path_components(ref_path, windows),
        windows,
    )
    .is_some()
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
/// already follows. A root that holds the referrer only as resolved reads it
/// under the spelling `KnownPaths::spelled` gives it there, and counts the
/// renamed file under `KnownPaths::renamed` too. The callers ask only of a
/// `Path` match, so a referrer whose spelling under some holding root was
/// not found (`KnownPaths::unplaced`) answers yes before any root is read.
/// With an empty map nothing is ambiguous.
fn read_as_another_note(
    ref_path: &str,
    raw_target: &str,
    known_paths: &KnownPaths,
    is_the_target: impl Fn(&str, &str) -> bool,
    windows: bool,
) -> bool {
    if known_paths.unplaced.contains(ref_path) {
        return true;
    }
    let raw = raw_target.trim();
    let spelled = known_paths.spelled.get(ref_path);
    let is_the_target = |root: &str, p: &str| {
        is_the_target(root, p) || known_paths.renamed.get(root).is_some_and(|k| k == p)
    };
    known_paths.roots.iter().any(|(root, known)| {
        let here = if root_places(root, ref_path, windows) {
            ref_path
        } else if let Some(here) = spelled.and_then(|by_root| by_root.get(root)) {
            here.as_str()
        } else {
            return false;
        };
        match filing_key(here, raw, None, Some(root), windows) {
            FilingKey::Path(p) => another_note_under(known, root, &p, is_the_target),
            FilingKey::Stem(_) | FilingKey::Foreign { .. } => false,
        }
    })
}

/// Does the root `root`, knowing its notes as `known`, hold a note under the
/// path key `p` other than the renamed file (`is_the_target`)? The count
/// read of `read_as_another_note`, for one root and one key: a link behind a
/// local alias is read under that alias's root alone (`RenameTarget::judge`).
fn another_note_under(
    known: &RootNotes,
    root: &str,
    p: &str,
    is_the_target: impl Fn(&str, &str) -> bool,
) -> bool {
    match known {
        RootNotes::Known(notes) => notes
            .get(p)
            .is_some_and(|&n| n > 1 || !is_the_target(root, p)),
        RootNotes::Sole(counted) => match counted.get(p) {
            Some(&n) => n > usize::from(is_the_target(root, p)),
            None => !is_the_target(root, p),
        },
        RootNotes::Unknown => !is_the_target(root, p),
    }
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

/// The note extension `strip_note_extension` removes from a captured
/// target, as spelled there, or "". Uses the index's lower-case suffix rule.
fn note_suffix(captured: &str) -> &str {
    let t = captured.trim();
    &t[strip_note_extension(t).len()..]
}

impl RenameTarget<'_> {
    /// The renamed file's stem before the rename.
    pub fn old_stem(&self) -> &str {
        stem_of(self.old_path, self.windows)
    }

    /// The renamed file's stem after the rename, in NFC (§390, spec 0069
    /// D7): what a stem link is respelled with, and what the spellability
    /// predicates judge — one string, so they judge what is written.
    pub fn new_stem(&self) -> String {
        nfc(stem_of(self.new_path, self.windows)).into_owned()
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
    /// `/v/a/old.md` on a file system that keeps case. The respelled text
    /// (`respell`) is read the same way: a rename must not write a link that
    /// a root holding the referrer reads as another existing note — `/v/sub`
    /// holding `a/new.md` while `/v/a/old.md` becomes `/v/a/new.md`, or
    /// `/v/a/New.md` already beside it where case is kept. A link behind an alias
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
                Some(Match::Path { ref root, .. }) if self.alias_root_reads_another_note(root) => {
                    Judgement::Ambiguous
                }
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
        // The renamed file is read by its OLD key in every count: the notes
        // are those before the move, so a note under the new key is another
        // note unless the key is the old one too (a case-only rename).
        let other_note = |text: &str| {
            read_as_another_note(
                ref_path,
                text,
                &self.known_paths,
                |r, p| root_relative_key(r, self.old_path, self.windows).as_deref() == Some(p),
                self.windows,
            )
        };
        match matched {
            None => Judgement::NotOurs,
            Some(m @ Match::Path { .. })
                if other_note(raw_target)
                    || other_note(&self.respell(ref_path, &m, raw_target)) =>
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
        let alias = fold_name(alias);
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

    /// Whether a path link behind a local alias, matched under that alias's
    /// root `root`, names another note there before or after the rename: two
    /// notes folding to the renamed file's old path key (`A/old.md` beside
    /// `a/old.md` where case is kept), or a note already under its new one
    /// (`a/New.md` beside the new `a/new.md`). The alias resolves the link
    /// against that root alone, so no other root is read; a root the rename
    /// does not know of reads nothing.
    fn alias_root_reads_another_note(&self, root: &str) -> bool {
        let Some(known) = self.known_paths.roots.get(root) else {
            return false;
        };
        let is_the_target = |r: &str, p: &str| {
            root_relative_key(r, self.old_path, self.windows).as_deref() == Some(p)
        };
        [self.old_path, self.new_path]
            .into_iter()
            .filter_map(|path| root_relative_key(root, path, self.windows))
            .any(|p| another_note_under(known, root, &p, is_the_target))
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
    /// separator was, and the finished text put in NFC (§390): a name stored
    /// decomposed is written as it is typed. `note_suffix` keeps the
    /// lower-case `.md` or `.markdown` that `strip_note_extension` removes
    /// from the captured target when the new file name also has one of those
    /// lower-case suffixes. After `a/old.md` → `a/old.txt`, `[[a/old.md]]`
    /// becomes `[[a/old.txt]]` and `[[old.md]]` becomes `[[old]]` — a kept
    /// `.md` would spell `a/old.txt.md`, which names no file.
    pub fn respell(&self, ref_path: &str, m: &Match, captured_target: &str) -> String {
        let new_name = path_components(self.new_path, self.windows)
            .last()
            .copied()
            .unwrap_or("");
        // The new name is a note only by a lower-case extension, as the
        // index reads it (`strip_note_extension`); `a/new.MD` is no note.
        let suffix = if strip_note_extension(new_name) == new_name {
            ""
        } else {
            note_suffix(captured_target)
        };
        let target = match m {
            Match::Stem => self.new_stem(),
            Match::Path { relative: true, .. } => {
                let mut source_dir = path_components(ref_path, self.windows);
                source_dir.pop();
                relative_components(&source_dir, &self.new_components(), self.windows)
            }
            Match::Path { root, .. } => {
                let new = self.new_components();
                under_root(&path_components(root, self.windows), &new, self.windows)
                    .map_or_else(|| self.new_stem(), |rest| rest.join("/"))
            }
        };
        // §390 (spec 0069 D7): composed only now, after `under_root` and
        // `relative_components` compared the disk spellings byte for byte
        // (`same_component`) — composing the components first would make a
        // folder stored decomposed another folder to them.
        nfc(&format!("{target}{suffix}")).into_owned()
    }

    /// The key the index files a reference `respell` wrote under, in the
    /// index whose root the match was made under — the read-back gate's
    /// expectation: `Stem(file_key(new stem))`, or the new file's
    /// `root_relative_key` under `root`. A new path outside `root` (which a
    /// rename in place never makes) falls back to the new stem's key, which
    /// the gate then finds unequal and the file is left and reported.
    pub fn expected_key(&self, m: &Match) -> FilingKey {
        let stem = file_key(&self.new_stem());
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
        // collide on, and the new name's key however many notes it counts
        // (`RootNotes::Sole`): an old key there is ambiguous, an old key left
        // out is the renamed file's own, since no other root reads it, and
        // the new key is ambiguous when a note already folds to it.
        // What fails this: reading `Sole` the way `Unknown` is read, its map
        // ignored — `[[a/note]]` is then `Ours` beside its twin; or ignoring
        // the new key's count — `[[a/note]]` is `Ours` with `a/New.md` there.
        let roots = vec!["/v".to_string()];
        let rename = |counted: HashMap<String, usize>| RenameTarget {
            old_path: "/v/a/note.md",
            new_path: "/v/a/new.md",
            local_aliases: &[],
            known_paths: [("/v".to_string(), RootNotes::Sole(counted))].into(),
            windows: false,
        };
        let new_key = |n: usize| ("a/new".to_string(), n);
        assert_eq!(
            rename([("a/note".to_string(), 2), new_key(0)].into())
                .judge("/v/r.md", &roots, "", "a/note"),
            Judgement::Ambiguous
        );
        assert_eq!(
            rename([new_key(1)].into()).judge("/v/r.md", &roots, "", "a/note"),
            Judgement::Ambiguous
        );
        assert_eq!(
            rename([new_key(0)].into()).judge("/v/r.md", &roots, "", "a/note"),
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
