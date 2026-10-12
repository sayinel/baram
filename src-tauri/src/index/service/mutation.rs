//! The change an index receives: applied to the live index, journaled for a build that is
//! reading and replayed onto its snapshot when it publishes (`state::LinkIndexState`).

use super::state::IndexRoot;
use crate::index::LinkIndex;
use std::path::PathBuf;

/// An in-place change to an index — the unit that is applied, journaled and
/// replayed. It names the file by its CANONICAL path; the spelling is decided
/// by the index it meets (`apply_to`).
#[derive(Clone)]
pub(super) enum Mutation {
    /// A file was re-read (saved, or rewritten by a rename).
    Update { path: PathBuf, content: String },
    /// A file is gone under this path (renamed away).
    Remove { path: PathBuf },
    /// §278 A non-markdown file appeared: a link target only (issue 790).
    Target { path: PathBuf },
    /// #824 A note that exists but cannot be read: registered, without content — what
    /// a fresh build makes of it (`LinkIndex::mark_unreadable`).
    Unreadable { path: PathBuf },
    /// §393 Everything at or under each of these paths is gone — a folder removed, or
    /// replaced by an empty one (`LinkIndex::remove_trees`).
    RemoveTree { paths: Vec<PathBuf> },
}

impl Mutation {
    /// Canonicalises `path` — outside any lock (it touches the filesystem). Production
    /// mutations are built by the reconcile unit from the identity it is guarded under.
    #[cfg(test)]
    pub(super) fn update(path: &str, content: String) -> Result<Self, String> {
        Ok(Self::Update {
            path: crate::context::manager::resolve_canonical(path)?,
            content,
        })
    }

    /// Apply to `index`, spelled under `root`, and say what that did (`Effect`). A path not
    /// under `root` changes nothing.
    pub(super) fn apply_to(&self, index: &mut LinkIndex, root: &IndexRoot) -> Effect {
        match self {
            Self::Update { path, content } => one(index, root, path, |i, p| {
                i.update_file_from_content(p, content)
            }),
            Self::Remove { path } => one(index, root, path, |i, p| {
                let held = i.holds_path(p);
                i.remove_file(p);
                held
            }),
            // #824 judged by this index's own exclusion, as `Update` is.
            Self::Target { path } => one(index, root, path, LinkIndex::update_link_target),
            Self::Unreadable { path } => one(index, root, path, LinkIndex::mark_unreadable),
            Self::RemoveTree { paths } => {
                let spelled: Vec<String> =
                    paths.iter().filter_map(|path| root.spell(path)).collect();
                let spelled: Vec<&str> = spelled.iter().map(String::as_str).collect();
                Effect {
                    changed: !spelled.is_empty() && index.remove_trees(&spelled),
                    excluded: false,
                }
            }
        }
    }
}

/// One path's change, spelled under `root`: whether it changed the index, and whether its
/// build never walks the path — judged before the change, by the matcher the change consults.
fn one(
    index: &mut LinkIndex,
    root: &IndexRoot,
    canonical_path: &std::path::Path,
    change: impl FnOnce(&mut LinkIndex, &str) -> bool,
) -> Effect {
    let Some(spelled) = root.spell(canonical_path) else {
        return Effect::NOTHING;
    };
    let excluded = index
        .exclusion()
        .walk_skips(std::path::Path::new(&spelled), false);
    Effect {
        changed: change(index, &spelled),
        excluded,
    }
}

/// §393 What applying one or more mutations did to a live index.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Effect {
    /// The index changed: a note's links or tags differ from what it held (an `Update`
    /// whose extraction matches is not rewritten), a link target newly registered, a path
    /// it held taken out.
    pub(super) changed: bool,
    /// Every path the mutations name is one this index's build never walks (hidden, or left
    /// out by its `VaultExclusion`).
    pub(super) excluded: bool,
}

impl Effect {
    /// Nothing applied: no change, and no path this index's build would walk.
    pub(super) const NOTHING: Effect = Effect {
        changed: false,
        excluded: true,
    };

    /// What the caller cannot see: the mutations went to a journal, or behind a newer
    /// snapshot. Counted as a change of a walked path, since a missing refresh or signal is
    /// worse than an extra one.
    pub(super) const UNKNOWN: Effect = Effect {
        changed: true,
        excluded: false,
    };

    /// Both effects, as one.
    pub(super) fn and(self, other: Effect) -> Effect {
        Effect {
            changed: self.changed || other.changed,
            excluded: self.excluded && other.excluded,
        }
    }
}
