use crate::context::ContextManager;
use crate::index::{BacklinkResult, LinkGraph, LinkIndex};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use super::build::ensure_indexes;
use super::keys::{active_registration, local_aliases_of, owning_contexts, owning_registration};
use super::state::LinkIndexState;

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
    // render as one. Only an index published for the CURRENT registration of
    // each context counts (`with_index_for`): one left by an earlier
    // registration of the same path could describe another directory.
    let contexts = owning_contexts(ctx_mgr, file_path).await;
    // A link behind one of the file's own vault aliases names it too (§87).
    let local_aliases = local_aliases_of(ctx_mgr, &contexts).await.local;
    let mut answered: Vec<(String, Vec<BacklinkResult>)> = Vec::new();
    for ctx in &contexts {
        let found = state
            .with_index_for(&ctx.info.path, ctx.incarnation, |idx| {
                idx.map(|i| i.get_backlinks(file_path, &local_aliases))
                    .unwrap_or_default()
            })
            .await;
        if !found.is_empty() {
            answered.push((ctx.info.path.clone(), found));
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
    // comes first so its spelling is the one returned — then sorted by
    // source path and line, as a single index's answer is. Component-wise
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
    merged.sort_by(|a, b| (a.source_path.as_str(), a.line).cmp(&(b.source_path.as_str(), b.line)));
    Ok(merged)
}

pub(crate) async fn get_link_index_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    root_path: Option<String>,
) -> Result<LinkGraph, String> {
    // §87 An explicit root (multi-vault graph merge) names a context in
    // whatever spelling the frontend holds; otherwise the active context.
    let registered = match root_path {
        Some(p) if !p.is_empty() => owning_registration(ctx_mgr, &p).await?,
        _ => active_registration(ctx_mgr).await?,
    };
    // §30 The graph reads the index the saves keep current and never rebuilds
    // it per save (issue 790). A context with no index for this registration
    // yet — the graph opened before the vault-open build published, a space
    // registered without being opened — is built once here, through the same
    // gate the renames use: it joins a build already in flight instead of
    // scanning again, and once published every later read is a pure read.
    // Every app write is in the index before its command returns (#824,
    // `commit::committed`); a write by another program arrives through the
    // watcher applier (`applier`), one settle window after its event.
    ensure_indexes(state, ctx_mgr, std::slice::from_ref(&registered)).await?;
    Ok(state
        .with_index_for(&registered.info.path, registered.incarnation, |idx| {
            idx.map(LinkIndex::get_link_graph).unwrap_or_default()
        })
        .await)
}

/// Re-index one file from disk (#824): the guarded unit every writer and the watcher
/// sync use (`reconcile::reconcile_path`), so this cannot land an old read after a
/// later write. A file no context knows is a no-op.
#[cfg(test)]
pub(crate) async fn update_file_index_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    file_path: &str,
) -> Result<(), String> {
    let done = super::reconcile::reconcile_path(state, ctx_mgr, file_path).await;
    if done.failed {
        return Err(format!(
            "{file_path} could not be brought into the link index"
        ));
    }
    Ok(())
}
