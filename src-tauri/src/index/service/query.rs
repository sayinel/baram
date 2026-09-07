use crate::context::ContextManager;
use crate::index::{BacklinkResult, LinkGraph, LinkIndex};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use super::keys::{active_index_key, keys_of, owning_contexts, owning_index_key};
use super::state::{LinkIndexState, Mutation};

/// Whether `file_path` is spelled under `root`: component-wise, so `/x/Vault`
/// does not claim `/x/Vault-secret/a.md`, a trailing slash on the root does not
/// matter, and on Windows either separator counts — never a string prefix
/// built with a hard-coded `/`, which on Windows matches nothing.
pub(super) fn spelled_under(root: &str, file_path: &str) -> bool {
    Path::new(file_path).starts_with(Path::new(root))
}

pub(crate) async fn get_backlinks_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    file_path: &str,
) -> Result<Vec<BacklinkResult>, String> {
    // A path in no context, or one whose index is not built yet, has no
    // backlinks to report — an empty answer, not an error the panel would
    // render as one.
    let keys = keys_of(&owning_contexts(ctx_mgr, file_path).await);
    let mut answered: Vec<(String, Vec<BacklinkResult>)> = Vec::new();
    for key in &keys {
        let found = state
            .with_index(key, |idx| {
                idx.map(|i| i.get_backlinks(file_path)).unwrap_or_default()
            })
            .await;
        if !found.is_empty() {
            answered.push((key.clone(), found));
        }
    }
    // The common case — one index answered (no nested roots, or only one of
    // them holds anything) — is a pure in-memory read: a single index already
    // dedups by (source, line), and the merge key below is a superset of that.
    if answered.len() <= 1 {
        return Ok(answered.pop().map(|(_, found)| found).unwrap_or_default());
    }
    // Nested roots that both answered: the enclosing index holds the same
    // entries as the nested one plus those from outside it — merge, once per
    // (source, line, block), comparing sources canonically because two slots
    // may spell the same file differently; the slot spelled like the query
    // comes first so its spelling is the one returned. Component-wise
    // `Path::starts_with`, never a string prefix with a hard-coded separator.
    let mut spelled: Vec<(bool, Vec<BacklinkResult>)> = Vec::new();
    for (key, found) in answered {
        let same_spelling = match state.build_root(&key).await {
            Some(root) => spelled_under(&root, file_path),
            None => false,
        };
        spelled.push((!same_spelling, found));
    }
    spelled.sort_by_key(|(later, _)| *later);
    let mut canonical: HashMap<String, PathBuf> = HashMap::new();
    let mut seen: HashSet<(PathBuf, u32, Option<String>)> = HashSet::new();
    let mut merged = Vec::new();
    for (_, found) in spelled {
        for b in found {
            let identity = canonical
                .entry(b.source_path.clone())
                .or_insert_with(|| {
                    crate::context::manager::resolve_canonical(&b.source_path)
                        .unwrap_or_else(|_| PathBuf::from(&b.source_path))
                })
                .clone();
            if seen.insert((identity, b.line, b.block_id.clone())) {
                merged.push(b);
            }
        }
    }
    Ok(merged)
}

pub(crate) async fn get_link_index_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    root_path: Option<String>,
) -> Result<LinkGraph, String> {
    // §87 An explicit root (multi-vault graph merge) names a context in
    // whatever spelling the frontend holds; otherwise the active context.
    let key = match root_path {
        Some(p) if !p.is_empty() => owning_index_key(ctx_mgr, &p).await?,
        _ => active_index_key(ctx_mgr).await?,
    };
    Ok(state
        .with_index(&key, |idx| {
            idx.map(LinkIndex::get_link_graph).unwrap_or_default()
        })
        .await)
}

pub(crate) async fn update_file_index_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    file_path: &str,
) -> Result<(), String> {
    // A save of a file no context knows is nothing to the index: a no-op, so
    // the caller's `.then(invalidate)` still runs.
    let keys = keys_of(&owning_contexts(ctx_mgr, file_path).await);
    if keys.is_empty() {
        return Ok(());
    }
    // Read outside the lock. With no index yet this only bumps the epoch, so
    // the initial build that is still reading cannot publish a state older
    // than this save; it will read again.
    let content = tokio::fs::read_to_string(file_path)
        .await
        .unwrap_or_default();
    // One canonical identity; each slot projects it into its own live and
    // pending root spelling while holding the map lock.
    let mutation = Mutation::update(file_path, content)?;
    for key in &keys {
        state.apply(key, vec![mutation.clone()]).await;
    }
    Ok(())
}
