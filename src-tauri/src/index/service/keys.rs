use crate::context::manager::Registered;
use crate::context::{ContextManager, ContextType};
use crate::index::{LinkGraph, LinkIndex};
use std::collections::HashMap;

use super::state::LinkIndexState;

/// The contexts a path belongs to (`ContextManager::contexts_containing`):
/// every directory context containing it, deepest first — nested roots each
/// scan the file, so a mutation must reach all of them — or the File context
/// (§89) registered for that very file when no directory context does. Empty
/// when no registered context knows the path: a query then answers empty and
/// a save is a no-op, but a rename refuses (`ensure_indexes`' callers) — with
/// no context there is no evidence about references either way.
pub(super) async fn owning_contexts(ctx_mgr: &ContextManager, path: &str) -> Vec<Registered> {
    ctx_mgr.contexts_containing(path).await
}

/// The index keys of `contexts`: their registered paths.
pub(super) fn keys_of(contexts: &[Registered]) -> Vec<String> {
    contexts.iter().map(|c| c.info.path.clone()).collect()
}

/// The contexts an index can be built for: directory contexts. A File context
/// is registered for a file path and `LinkIndex::build` reads a directory, so
/// no build can ever fill that key — requiring it would refuse forever, and a
/// standalone file has no other file whose references could need updating.
pub(super) fn buildable(contexts: &[Registered]) -> Vec<Registered> {
    contexts
        .iter()
        .filter(|c| {
            matches!(
                c.info.context_type,
                ContextType::Vault | ContextType::Folder
            )
        })
        .cloned()
        .collect()
}

/// The registration an explicit graph root (`get_link_index` with a root)
/// names: the deepest context containing it — the one registered for that
/// directory, in whatever spelling the caller has. `Err` when no context
/// contains it.
pub(super) async fn owning_registration(
    ctx_mgr: &ContextManager,
    path: &str,
) -> Result<Registered, String> {
    let mut contexts = owning_contexts(ctx_mgr, path).await;
    if contexts.is_empty() {
        return Err(format!("{path} is not inside any registered context"));
    }
    Ok(contexts.swap_remove(0))
}

/// The key an explicit root resolves to (tests).
#[cfg(test)]
pub(super) async fn owning_index_key(
    ctx_mgr: &ContextManager,
    path: &str,
) -> Result<String, String> {
    Ok(owning_registration(ctx_mgr, path).await?.info.path)
}

/// The active context's registration — its key is its registered path.
///
/// `Err` when no context is active, and when the active id names no registered
/// context (`set_active` and `remove` take separate locks, so a stale id is
/// possible — an inconsistency to surface, not a cold start). Absence is an
/// error at the IPC boundary: the whole-graph view only exists with a vault
/// open; knowledge search degrades to an empty graph term.
///
/// "Active context with no index built yet" is a different, legitimate state
/// (indexes are built in the background when a vault opens): queries answer
/// empty and knowledge search ranks without a graph term.
pub(crate) async fn active_registration(ctx_mgr: &ContextManager) -> Result<Registered, String> {
    let id = ctx_mgr.active_id().await.ok_or("No active context")?;
    ctx_mgr
        .registered(&id)
        .await
        .ok_or_else(|| format!("Active context {id} is not registered"))
}

/// The active context's key (tests).
#[cfg(test)]
pub(super) async fn active_index_key(ctx_mgr: &ContextManager) -> Result<String, String> {
    Ok(active_registration(ctx_mgr).await?.info.path)
}

/// Hybrid ranking's graph term (embedding_cmd): the outgoing edges of the
/// active context's index. No active context, or no index for it yet, is not
/// an error here — the chunk index is in memory regardless — but an empty
/// map: the search ranks by BM25 and vector alone, as it did before issue 263
/// made this lookup hit at all.
pub(crate) async fn graph_term_for(
    state: &LinkIndexState,
    registered: Option<&Registered>,
) -> HashMap<String, Vec<String>> {
    match registered {
        Some(registered) => outgoing_links_for(state, registered).await,
        None => HashMap::new(),
    }
}

/// The graph term of the active context in one step (tests; the search
/// command resolves the registration before its network request and reads the
/// graph after it, so a save during the request is not missed).
#[cfg(test)]
pub(super) async fn graph_term_for_active(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
) -> HashMap<String, Vec<String>> {
    graph_term_for(state, active_registration(ctx_mgr).await.ok().as_ref()).await
}

/// `Err` unless `root_path` is inside a registered directory context — the
/// gate for the one read-only command that walks a directory the webview
/// names (`get_unlinked_mentions`).
pub(crate) async fn require_registered_root(
    ctx_mgr: &ContextManager,
    root_path: &str,
) -> Result<(), String> {
    owning_registration(ctx_mgr, root_path).await.map(|_| ())
}

/// Outgoing edges (source → targets) of the index published for `registered`.
/// No index for this registration yet: no edges.
pub(super) async fn outgoing_links_for(
    state: &LinkIndexState,
    registered: &Registered,
) -> HashMap<String, Vec<String>> {
    let graph = state
        .with_index_for(&registered.info.path, registered.incarnation, |idx| {
            idx.map(LinkIndex::get_link_graph)
        })
        .await;
    graph.map(|g| outgoing_map(&g)).unwrap_or_default()
}

/// Outgoing edges of whatever index is live under `key` (tests).
#[cfg(test)]
pub(super) async fn outgoing_links(
    state: &LinkIndexState,
    key: &str,
) -> HashMap<String, Vec<String>> {
    let graph = state
        .with_index(key, |idx| idx.map(LinkIndex::get_link_graph))
        .await;
    graph.map(|g| outgoing_map(&g)).unwrap_or_default()
}

/// Edge list → adjacency map, the shape `hybrid_ranker::compute_hop_distances` walks.
pub(super) fn outgoing_map(graph: &LinkGraph) -> HashMap<String, Vec<String>> {
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    for edge in &graph.edges {
        out.entry(edge.from.clone())
            .or_default()
            .push(edge.to.clone());
    }
    out
}
