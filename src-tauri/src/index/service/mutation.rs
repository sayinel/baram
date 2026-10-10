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
    /// §393 A non-markdown file to register as a link target (§278) — the build registers
    /// every file it finds; this is the one that appeared since.
    Target { path: PathBuf },
    /// §393 Everything at or under each of these paths is gone — removed or replaced
    /// folders and files, as one change (one scan of the index however many paths).
    RemoveTree { paths: Vec<PathBuf> },
}

impl Mutation {
    /// Canonicalises `path` — outside any lock (it touches the filesystem).
    pub(super) fn update(path: &str, content: String) -> Result<Self, String> {
        Ok(Self::Update {
            path: crate::context::manager::resolve_canonical(path)?,
            content,
        })
    }

    /// A file that is gone (or unreadable) under `path` — canonicalised outside
    /// any lock, on the existing ancestor when the file itself is gone.
    pub(super) fn remove(path: &str) -> Result<Self, String> {
        Ok(Self::Remove {
            path: crate::context::manager::resolve_canonical(path)?,
        })
    }

    /// §393 A link target — canonicalised outside any lock.
    pub(super) fn target(path: &str) -> Result<Self, String> {
        Ok(Self::Target {
            path: crate::context::manager::resolve_canonical(path)?,
        })
    }

    /// §393 A removed tree — canonicalised outside any lock.
    pub(super) fn remove_tree(path: &str) -> Result<Self, String> {
        Self::remove_trees(&[path])
    }

    /// §393 Several removed trees as one mutation. Each path may be gone, so it is
    /// canonicalised through its PARENT and the final component is joined on as written: a
    /// symlink that appears at the path after the caller looked is never followed (following
    /// it would remove its TARGET — the hazard `sync::on_disk` leaves links alone for).
    pub(super) fn remove_trees(paths: &[&str]) -> Result<Self, String> {
        let paths = paths
            .iter()
            .map(|path| canonical_entry(path))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self::RemoveTree { paths })
    }

    /// §393 The removal of `path` as written, when that spelling is not the name the volume
    /// resolves it to; `None` when it is. On a volume that folds case, a case-only rename done
    /// outside the app (`Note.md` → `note.md`) leaves both spellings reachable, so the watcher
    /// reports both as created (`fs::start_watching` asks `exists()`) and both read as the
    /// one file. `update` and `target` file it under the resolved name, so the old spelling's
    /// key would stay beside it: it names no entry any more and goes like a missing path's.
    /// The parent is canonicalised the same way in both, so what can differ is the name. A
    /// platform whose canonicalisation returns the name as written rather than as stored
    /// sees no difference, and there the old spelling stays until a build.
    pub(super) fn stale_spelling(path: &str) -> Result<Option<Self>, String> {
        let written = canonical_entry(path)?;
        let resolved = crate::context::manager::resolve_canonical(path)?;
        Ok((written != resolved).then(|| Self::RemoveTree {
            paths: vec![written],
        }))
    }

    /// The `RemoveTree` mutations among `trees` merged into one (the others contribute
    /// nothing): the same removal, one `apply`.
    pub(super) fn merge_removals(trees: Vec<Mutation>) -> Self {
        let paths = trees
            .into_iter()
            .flat_map(|tree| match tree {
                Self::RemoveTree { paths } => paths,
                Self::Update { .. } | Self::Remove { .. } | Self::Target { .. } => Vec::new(),
            })
            .collect();
        Self::RemoveTree { paths }
    }

    /// Apply to `index`, spelled under `root`. Whether the index changed: `Update` counts only
    /// when the note reads differently from what the index holds for it (§393
    /// `LinkIndex::update_file_unless_held` — otherwise it writes nothing); `Remove` and
    /// `Target` rewrite what they name and count as a change; `RemoveTree` counts only when
    /// something was under its path. A path not under `root` changes nothing.
    pub(super) fn apply_to(&self, index: &mut LinkIndex, root: &IndexRoot) -> bool {
        match self {
            Self::Update { path, content } => match root.spell(path) {
                Some(spelled) => index.update_file_unless_held(&spelled, content),
                None => false,
            },
            Self::Remove { path } => match root.spell(path) {
                Some(spelled) => {
                    index.remove_file(&spelled);
                    true
                }
                None => false,
            },
            Self::Target { path } => match root.spell(path) {
                Some(spelled) => {
                    index.add_link_target(&spelled);
                    true
                }
                None => false,
            },
            Self::RemoveTree { paths } => {
                let spelled: Vec<String> =
                    paths.iter().filter_map(|path| root.spell(path)).collect();
                let spelled: Vec<&str> = spelled.iter().map(String::as_str).collect();
                !spelled.is_empty() && index.remove_trees(&spelled)
            }
        }
    }
}

/// `path` with its parent canonicalised and its last component kept as written; a path with
/// no last component (`/`, `..`) falls back to `resolve_canonical`.
fn canonical_entry(path: &str) -> Result<PathBuf, String> {
    let path = std::path::Path::new(path);
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) if !parent.as_os_str().is_empty() => {
            let parent = parent.to_str().ok_or("path is not UTF-8")?;
            Ok(crate::context::manager::resolve_canonical(parent)?.join(name))
        }
        _ => crate::context::manager::resolve_canonical(path.to_str().ok_or("path is not UTF-8")?),
    }
}
