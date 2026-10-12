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

    pub(super) fn apply_to(&self, index: &mut LinkIndex, root: &IndexRoot) {
        let canonical_path = match self {
            Self::Update { path, .. }
            | Self::Remove { path }
            | Self::Target { path }
            | Self::Unreadable { path } => path,
        };
        let Some(spelled) = root.spell(canonical_path) else {
            return;
        };
        match self {
            Self::Update { content, .. } => index.update_file_from_content(&spelled, content),
            Self::Remove { .. } => index.remove_file(&spelled),
            // #824 judged by this index's own exclusion, as `Update` is.
            Self::Target { .. } => index.update_link_target(&spelled),
            Self::Unreadable { .. } => index.mark_unreadable(&spelled),
        }
    }
}
