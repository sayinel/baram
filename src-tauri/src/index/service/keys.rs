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
///   rename leaves it — reporting a file inside the renamed file's
///   contexts when the name is one of that file's own (`ambiguous`, below)
///   — and the backlinks do not claim it.
/// - The alias map can go stale. When a later vault claims the name and is
///   then removed, its removal drops the map entry, so the backend resolver
///   answers nothing for that alias while the frontend still resolves it to
///   the first vault, now the only one carrying it. Uniqueness among the
///   registered vaults is the one condition no other vault can contradict,
///   so the map is not consulted; an ownership check against it would keep
///   the first vault foreign.
///
/// The names of `contexts` that are NOT local because another registered
/// context carries the same name at the same tier — an explicit alias another
/// context's explicit alias matches, a space name another space of the same
/// type has — come back as `ambiguous`, with the same roots. A link behind
/// one may mean this vault's note, so a file rename that leaves it reports
/// the file (issue 678's ③, as for an ambiguous path link) — when the
/// rename visits it: it reads only the indexes holding the renamed file, so a
/// referrer in the other vault is neither visited nor reported. The backlinks
/// read `local` alone, and the block-ID rename reads no alias (its grammars
/// have none). A space name an explicit alias outranks is in neither list:
/// the link names that alias's vault.
///
/// The registrations are read when this is called — a rename reads them
/// once, at its start, and does not see a registration made while it runs.
/// One read for both lists, so they describe the same registrations.
/// Lowercase because `filing_key` lowercases a `Foreign` key's alias; this is
/// the one fold on this side (`LocalAlias`). Each list sorted, without
/// repeats.
pub(super) async fn local_aliases_of(
    ctx_mgr: &ContextManager,
    contexts: &[Registered],
) -> OwnAliases {
    let registered = ctx_mgr.list().await;
    let explicit = |info: &ContextInfo| info.alias.as_deref().map(str::to_lowercase);
    let mut own = OwnAliases {
        local: Vec::new(),
        ambiguous: Vec::new(),
    };
    for c in contexts {
        let name_of_this = |alias: String| LocalAlias {
            alias,
            root: c.info.path.clone(),
        };
        if let Some(folded) = explicit(&c.info) {
            let unique = !registered
                .iter()
                .any(|other| other.id != c.info.id && explicit(other).as_ref() == Some(&folded));
            if unique {
                own.local.push(name_of_this(folded));
            } else {
                own.ambiguous.push(name_of_this(folded));
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
                own.local.push(name_of_this(name.to_string()));
            } else if !outranked {
                own.ambiguous.push(name_of_this(name.to_string()));
            }
        }
    }
    for list in [&mut own.local, &mut own.ambiguous] {
        list.sort();
        list.dedup();
    }
    own
}

/// What `local_aliases_of` found for a file's contexts: the names a link
/// behind which names the file (`local`), and the names it carries that
/// another registered context carries too (`ambiguous`).
pub(super) struct OwnAliases {
    pub(super) local: Vec<LocalAlias>,
    pub(super) ambiguous: Vec<LocalAlias>,
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

    /// Every `VaultType` variant. The `match` has no `_` arm, so a new
    /// variant does not compile until it is listed here too.
    fn every_vault_type() -> [VaultType; 3] {
        let all = [
            VaultType::General,
            VaultType::Journal,
            VaultType::Zettelkasten,
        ];
        for vault_type in &all {
            match vault_type {
                VaultType::General | VaultType::Journal | VaultType::Zettelkasten => {}
            }
        }
        all
    }

    #[test]
    fn space_names_match_the_frontends() {
        // `space_name` and the frontend's `SPACE_ALIASES` must name the same
        // spaces, both ways: a link the frontend resolves into a space is one
        // the index files as local, and no more. The `key: "Name"` pairs of
        // the TypeScript object literal are compared with the Rust mapping
        // over every variant, keyed by the variant's serialized name (the
        // `VaultType` the frontend receives), names lowercased on both sides.
        // The TypeScript file is compiled in (`include_str!`), so the CI rust
        // job's path filter must list it — `rust-job-path-filter.test.ts`
        // fails until it does; a runtime read escaped that check, and a
        // frontend-only PR could change the table with the rust job skipped.
        // What fails this: adding `general: "Vault",` to the TypeScript
        // object, or mapping `VaultType::Zettelkasten` to `None` in
        // `space_name` — the sets differ either way.
        let ts = include_str!("../../../../src/utils/editor/wikilink-nav.ts");
        let start = ts
            .find("const SPACE_ALIASES")
            .expect("SPACE_ALIASES in wikilink-nav.ts");
        let block = &ts[start..];
        let block = &block[..block.find("\n};").expect("the end of SPACE_ALIASES")];
        let frontend: std::collections::BTreeSet<(String, String)> = block
            .lines()
            .skip(1)
            .map(|line| {
                let (key, name) = line.trim().split_once(':').expect(line);
                let name = name.trim().trim_end_matches(',').trim_matches('"');
                (key.trim().to_string(), name.to_lowercase())
            })
            .collect();
        let backend: std::collections::BTreeSet<(String, String)> = every_vault_type()
            .iter()
            .filter_map(|vault_type| {
                let key = serde_json::to_value(vault_type).ok()?.as_str()?.to_string();
                Some((key, space_name(vault_type)?.to_string()))
            })
            .collect();
        assert!(!backend.is_empty());
        assert_eq!(frontend, backend);
    }
}
