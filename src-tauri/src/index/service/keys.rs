use crate::context::manager::Registered;
use crate::context::{ContextInfo, ContextManager, ContextType, VaultType};
use crate::index::{LinkGraph, LinkIndex, LocalAlias};
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

/// The canonical space name a vault type answers to (§317), lowercase as
/// every `LocalAlias` is: the frontend's `SPACE_ALIASES`
/// (`src/utils/editor/wikilink-nav.ts`) — `Journal` for a journal space,
/// `Zettel` for a zettelkasten one, none for a general vault. No `_` arm, so
/// a new vault type does not compile until it is given a name or `None`;
/// `space_names_match_the_frontends` reads the TypeScript table.
fn space_name(vault_type: &VaultType) -> Option<&'static str> {
    match vault_type {
        VaultType::General => None,
        VaultType::Journal => Some("journal"),
        VaultType::Zettelkasten => Some("zettel"),
    }
}

fn space_name_of(info: &ContextInfo) -> Option<&'static str> {
    info.vault_type.as_ref().and_then(space_name)
}

/// The vault aliases local to `contexts` (§87), lowercase, each with its
/// registered path as the root the alias resolves paths against. A context
/// answers to two kinds of name, in the order the frontend's
/// `findAliasContext` (`src/utils/editor/wikilink-nav.ts`) tries them:
///
/// 1. Its explicit `info.alias` — local when no OTHER registered context
///    (`ctx_mgr.list()`) carries the same alias in any case.
/// 2. Its space name by vault type (`space_name`: `journal`, `zettel`) —
///    local when NO registered context carries that string as an explicit
///    alias (`findAliasContext` returns an explicit match first, whichever
///    context it is, so an explicit alias outranks the space name) and no
///    OTHER registered context has the same space name.
///
/// These conditions are the whole rule, for three reasons:
///
/// - Uniqueness is the condition the frontend's alias match resolves by.
///   `findAliasContext` compares case-insensitively and takes the first
///   context in its list in each pass, while the backend's cross-vault
///   resolver (`resolve_cross_vault_link`) reads the alias map, keyed by the
///   exact string, last writer wins. With `Work` and `work` on two vaults,
///   `work` on both, or two journal spaces, they can name different vaults,
///   so a link behind that name is ambiguous and foreign to all of them: the
///   rename leaves it and the backlinks do not claim it.
/// - The alias map can go stale. When a later vault claims the name and is
///   then removed, its removal drops the map entry, so the backend resolver
///   answers nothing for that alias while the frontend still resolves it to
///   the first vault, now the only one carrying it. Uniqueness among the
///   registered vaults is the one condition no other vault can contradict,
///   so the map is not consulted; an ownership check against it would keep
///   the first vault foreign.
/// - With uniqueness checked, an ownership check has no test that fails
///   without it, and a condition nothing can fail does not stay.
///
/// The registrations are read when this is called — a rename reads them
/// once, at its start, and does not see a registration made while it runs.
/// Lowercase because `filing_key` lowercases a `Foreign` key's alias; this is
/// the one fold on this side (`LocalAlias`). Sorted, without repeats.
pub(super) async fn local_aliases_of(
    ctx_mgr: &ContextManager,
    contexts: &[Registered],
) -> Vec<LocalAlias> {
    let registered = ctx_mgr.list().await;
    let explicit = |info: &ContextInfo| info.alias.as_deref().map(str::to_lowercase);
    let mut aliases = Vec::new();
    for c in contexts {
        if let Some(folded) = explicit(&c.info) {
            let unique = !registered
                .iter()
                .any(|other| other.id != c.info.id && explicit(other).as_ref() == Some(&folded));
            if unique {
                aliases.push(LocalAlias {
                    alias: folded,
                    root: c.info.path.clone(),
                });
            }
        }
        if let Some(name) = space_name_of(&c.info) {
            let outranked = registered
                .iter()
                .any(|other| explicit(other).as_deref() == Some(name));
            let shared = registered
                .iter()
                .any(|other| other.id != c.info.id && space_name_of(other) == Some(name));
            if !outranked && !shared {
                aliases.push(LocalAlias {
                    alias: name.to_string(),
                    root: c.info.path.clone(),
                });
            }
        }
    }
    aliases.sort();
    aliases.dedup();
    aliases
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn space_names_match_the_frontends() {
        // `space_name` and the frontend's `SPACE_ALIASES` must name the same
        // spaces: a link the frontend resolves into a journal is one the
        // index files as local. The TypeScript file is read from the repo
        // root, the parent of the crate directory.
        // What fails this: `space_name` answering `Some("journals")` for
        // `VaultType::Journal` — the loop's assertion.
        let ts = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../src/utils/editor/wikilink-nav.ts"
        ))
        .unwrap();
        for (vault_type, key) in [
            (VaultType::Journal, "journal"),
            (VaultType::Zettelkasten, "zettelkasten"),
        ] {
            let name = space_name(&vault_type).unwrap();
            let spelled = format!("{}{}", name[..1].to_uppercase(), &name[1..]);
            let entry = format!("{key}: \"{spelled}\"");
            assert!(ts.contains(&entry), "wikilink-nav.ts lacks {entry}");
        }
        assert_eq!(space_name(&VaultType::General), None);
        assert!(!ts.contains("general: \""), "a general vault gained a name");
    }
}
