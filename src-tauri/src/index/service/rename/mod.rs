//! §33/§61 Rename with link updates — the result types and the helpers its parts share.

mod block_id;
mod file;
mod namespace;
mod referrers;

pub(crate) use block_id::rename_block_id_inner;
pub(crate) use file::rename_file_with_links_inner;
pub(crate) use namespace::rename_namespace_inner;
// `rename_namespace_inner` calls these itself; only the service's tests reach
// them from outside this module.
#[cfg(test)]
pub(super) use namespace::{commit_namespace_rename, settle_namespace_rebuild};

use crate::context::manager::Registered;
use crate::context::ContextManager;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

use super::keys::{buildable, keys_of, owning_contexts};
use super::state::{LinkIndexState, Mutation};
use crate::index::{KnownPaths, LinkIndex};

/// §33 Result of renaming a file (or a block ID) with wikilink updates.
///
/// An `Err` from these commands means nothing on disk changed. Everything that
/// fails AFTER the point of no return (the file has moved, a first referrer has
/// been rewritten) is reported here instead — the log is not a channel the
/// user can see (issue 594).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    pub updated_files: Vec<String>,
    /// Files the rename cannot vouch for: each MAY still spell the old name.
    /// A referrer the index named that is unreadable, unwritable, covered by
    /// none of the file's contexts, or resolves outside them; one named but
    /// holding nothing to rename now (a stale index, issue 668 — the
    /// reference may live elsewhere).
    /// And, for a file rename only (issue 678): a file holding links that
    /// cannot spell the new stem — it may be in `updated_files` too, for the
    /// links that were rewritten — and the renamed note itself, under its
    /// new path, on the same terms. For both renames: a file holding a path
    /// reference another root reads as a different existing note, which is
    /// left as written (`filing::Judgement::Ambiguous`), updated or not. A
    /// block ID rename lists referrers only.
    pub skipped_files: Vec<String>,
}

/// §61 Result of renaming a namespace (directory) with wikilink updates
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamespaceRenameResult {
    pub updated_files: Vec<String>,
    /// See [`RenameResult::skipped_files`] — here, only files whose rewrite
    /// was attempted and failed.
    pub skipped_files: Vec<String>,
    /// Files outside the moved directory that could not be read, so whether
    /// they refer to it was never checked. Their links MAY still spell the old
    /// directory.
    pub unchecked_files: Vec<String>,
    pub files_moved: u32,
    /// `false`: the files moved, but the index under the root was not rebuilt —
    /// the rebuild failed and the stale index was dropped, or the context was
    /// removed while it ran. Backlinks read empty until the next build.
    pub index_rebuilt: bool,
}

/// The notes each built directory index holds, by its root
/// (`LinkIndex::registered_path_keys`) — every registered directory context,
/// not only the renamed file's, since a root that does not contain the file
/// may still hold a referrer and read its path link as another note
/// (`filing::read_as_another_note`). A context whose index is not built
/// contributes nothing: its root is read as holding no note, and a link it
/// would read is judged as if that root were not registered.
async fn known_paths_of(state: &LinkIndexState, ctx_mgr: &ContextManager) -> KnownPaths {
    let mut known = KnownPaths::new();
    for info in ctx_mgr.list().await {
        let Some(registered) = ctx_mgr.registered(&info.id).await else {
            continue;
        };
        if buildable(std::slice::from_ref(&registered)).is_empty() {
            continue;
        }
        let keys = state
            .with_index_for(&registered.info.path, registered.incarnation, |idx| {
                idx.map(LinkIndex::registered_path_keys)
            })
            .await;
        if let Some(keys) = keys {
            known.insert(registered.info.path, keys);
        }
    }
    known
}

/// The contexts among `keys` (containing indexes) that cover `path`: a
/// reference file outside a nested root belongs to the enclosing index alone,
/// and must not be written into, or judged under, the nested one.
async fn contexts_covering(
    ctx_mgr: &ContextManager,
    keys: &[String],
    path: &str,
) -> Vec<Registered> {
    owning_contexts(ctx_mgr, path)
        .await
        .into_iter()
        .filter(|c| keys.contains(&c.info.path))
        .collect()
}

/// Which of `keys` cover `path` (`contexts_covering`), in `keys`' order.
async fn keys_covering(ctx_mgr: &ContextManager, keys: &[String], path: &str) -> Vec<String> {
    let covering = keys_of(&contexts_covering(ctx_mgr, keys, path).await);
    keys.iter()
        .filter(|k| covering.contains(k))
        .cloned()
        .collect()
}

/// Whether a canonical path lies under one of these directory contexts. The
/// renames confine every path they write to the file's own contexts: a
/// destination outside them, or a "referring file" an index names that now
/// resolves elsewhere (a symlink planted after the scan), is never written.
fn confined_by(canonical: &Path, dirs: &[Registered]) -> bool {
    dirs.iter()
        .any(|d| canonical.starts_with(&d.canonical_path))
}

/// Queue `mutation` for every key in `keys`. Spelling is decided later, per
/// index (`Mutation::apply_to`).
fn push_for_keys(
    per_key: &mut HashMap<String, Vec<Mutation>>,
    keys: &[String],
    mutation: &Mutation,
) {
    for key in keys {
        per_key
            .entry(key.clone())
            .or_default()
            .push(mutation.clone());
    }
}
