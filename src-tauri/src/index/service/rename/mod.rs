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
use crate::index::{KnownPaths, RootNotes};

use super::build::ensure_indexes;

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
    /// left as written (`judgement::Judgement::Ambiguous`), updated or not. A
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

/// The directory contexts that hold the renamed file (`dirs`) or any of
/// `referrers` — the roots whose reading of a referrer's path link the rename
/// judgement consults — with each one's index built. `dirs` are built
/// already (the rename's gate); every other holding context is built here
/// the same way (`ensure_indexes`), since a vault registered but never opened
/// has no index and the judgement must not read that as "no note there". A
/// build that fails is logged and its root is left unbuilt, which
/// `known_paths_of` reports as `Unknown`.
async fn holding_contexts(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    dirs: &[Registered],
    referrers: &[String],
) -> Vec<Registered> {
    let mut holding: Vec<Registered> = dirs.to_vec();
    for referrer in referrers {
        for c in buildable(&owning_contexts(ctx_mgr, referrer).await) {
            if !holding.iter().any(|h| h.info.path == c.info.path) {
                holding.push(c);
            }
        }
    }
    for c in &holding[dirs.len()..] {
        if let Err(e) = ensure_indexes(state, ctx_mgr, std::slice::from_ref(c)).await {
            log::warn!(
                "rename: the index of {} could not be built ({e}); its path links are left as they are",
                c.info.path
            );
        }
    }
    holding
}

/// What each of `holding` knows of its notes, by its root: `Known` with
/// `LinkIndex::registered_path_keys` when its index is built for that
/// registration, `Unknown` when it is not — a build that failed, or a
/// context removed since. An `Unknown` root never lets a path link through
/// (`judgement::read_as_another_note`) that another root's note would stop.
/// With one holding root there is no other root to read a link, so only the
/// keys its notes collide on are collected (`RootNotes::Sole`,
/// `LinkIndex::colliding_path_keys`) — under the index lock, which every
/// index read and save waits on, that is a key per same-named note instead
/// of a key per note.
async fn known_paths_of(state: &LinkIndexState, holding: &[Registered]) -> KnownPaths {
    let sole = holding.len() == 1;
    let mut known = KnownPaths::new();
    for c in holding {
        let notes = state
            .with_index_for(&c.info.path, c.incarnation, |idx| {
                idx.map(|idx| {
                    if sole {
                        RootNotes::Sole(idx.colliding_path_keys())
                    } else {
                        RootNotes::Known(idx.registered_path_keys())
                    }
                })
            })
            .await;
        known.insert(c.info.path.clone(), notes.unwrap_or(RootNotes::Unknown));
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

/// `Err` unless `path` is absolute as the host reads it (`Path::is_absolute`).
/// The renames take the paths the webview's file tree holds, which are
/// absolute; a relative one would resolve against the process's working
/// directory, a place no registered context names, and the checks that
/// follow read it lexically as well as canonically. Refused before anything
/// is read or written.
fn absolute(path: &str) -> Result<(), String> {
    if Path::new(path).is_absolute() {
        Ok(())
    } else {
        Err(format!("{path} is not an absolute path"))
    }
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
