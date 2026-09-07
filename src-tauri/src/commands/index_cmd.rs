// §29 인덱스 IPC 커맨드 — 백링크 조회, 인덱스 빌드/갱신
// §33 파일 이름 변경 시 wikilink 자동 갱신
//
// issue 263 — one key, derived one way. The per-context link indexes live in a
// map keyed by the context's REGISTERED PATH (`ContextInfo.path`). Not the
// context id: `legacy-xxx` and `ctx-xxx` ids can name the same vault, and
// `search_knowledge` used to look this map up by id — a guaranteed miss that
// `unwrap_or_default()` turned into an empty graph, so hybrid ranking's graph
// term was 0 for every query with no error and no log. And not the raw string
// the frontend happens to hold either: its `rootPath` can carry a trailing
// slash, or a spelling Rust deduplicated away at registration. So a path —
// a vault root in any spelling, or a file inside one — is mapped to the
// contexts that CONTAIN it (canonically, in ContextManager) and the key is a
// context's registered path. `owning_contexts`, `owning_index_key` and
// `active_index_key` are the only derivations, used by every command here and
// by embedding_cmd.
//
// File-scoped commands (backlinks of a file, re-indexing a saved file, the
// renames) key by the contexts CONTAINING the file, not the active one: a
// non-active tab is saved and re-indexed too, and a backlinks query can land
// while a context switch is still in flight. Nested vault roots each hold an
// index that scans the file, so a save reaches every containing index and a
// rename asks every one of them — a reference from outside a nested root
// lives only in the enclosing index. A path no context knows: a query answers
// empty and a save is a no-op (the panel would render an error as one), a
// rename refuses (nothing is known about its references). A standalone File
// context (§89) has no directory index and no other file to update: its file
// is renamed, nothing else. Only the whole-graph query without an explicit
// root and knowledge search are inherently about the active context, and
// knowledge search degrades to an empty graph term when nothing is active.
//
// The lock is never held across an await — by construction, not by review: the
// map is private and reachable only through this type's own async methods,
// each of which does only synchronous work under the guard (a read takes a
// synchronous closure). Every command derives its key BEFORE touching the map,
// so the ContextManager's own locks are never awaited while this one is held.
//
// A rebuild reads the vault's files over time, outside the map lock, and a
// save or rename can land on the live index meanwhile. Those mutations are
// journaled while a build is reading and REPLAYED onto its snapshot before it
// is published, so the published index is "what the build read, plus what
// changed since" — never older than the live one. Without this a background
// refresh that began before a rename would overwrite the rename-corrected
// index with its pre-rename snapshot, and the next rename would trust it and
// miss the references. Builds are serialised per key, and a refresh that
// queued behind a build that published meanwhile returns that build's stats
// instead of scanning the vault again. A mutation is recorded by the file's
// CANONICAL path and projected into a spelling only when it meets an index:
// the live index's root spelling when applied, the pending build's root
// spelling when replayed — so a save that lands during the first build of a
// slot registered under another spelling still lands in the right place.
//
// An index is built only from a REGISTERED directory context's root.
// `refresh_index` and `rename_namespace` take the frontend's root, which must
// be a registration itself (`context_registered_at`) — never "the deepest
// context containing it", which right after a removal is the parent, whose
// index a subtree scan would replace. The rename gate (`ensure_indexes`)
// builds a missing index from the context's registered path before a file is
// touched: that spelling was supplied by the frontend at registration, so it
// is not the guess this file refuses to make — a root derived from a FILE
// path, which with a symlink inside a vault would scan and rewrite outside
// it. The gate reaches the contexts nothing else builds (a journal or zettel
// space registered without being opened, a nested folder restored from the
// last session); the first rename there waits for one scan. Renaming before
// an index existed used to rename the file and rewrite none of its
// references, silently.
//
// An index holds paths in the spelling of the root it was built from. A nested
// root can be registered — and built — under another spelling of the same
// directory (a symlink); a canonical path that cannot be placed under a slot's
// root is skipped for that slot. Removing a context forgets its slot by
// leaving a tombstone with a new GENERATION and the removal's sequence number:
// an index from a previous registration must not satisfy the next one's
// readiness, a build started under the old registration cannot publish into
// the new one, a refresh that resolved the key just before the removal refuses
// instead of adopting the tombstone's generation, and the next registration's
// refresh cannot coalesce onto an old publication. Each build records its
// registration's INCARNATION, so a removal that arrives after the same path
// was re-registered and rebuilt (the command removes from the ContextManager
// first and forgets here after an await) is stale and ignored.

use crate::context::{ContextInfo, ContextManager, ContextType};
use crate::index::{
    collect_md_files, find_unlinked_mentions, replace_block_id_refs, replace_wikilink_target,
    rewrite_relative_wikilinks, BacklinkResult, IndexStats, LinkGraph, LinkIndex,
    UnlinkedMentionResult,
};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

/// A root an index was (or is being) built from: the exact spelling the
/// frontend supplied — the spelling `LinkIndex::build` stored its paths in —
/// and its canonical form, used only to project canonical mutation paths into
/// that spelling.
#[derive(Clone)]
struct IndexRoot {
    spelling: String,
    canonical: PathBuf,
}

impl IndexRoot {
    fn new(root: &str) -> Result<Self, String> {
        Ok(Self {
            spelling: root.to_string(),
            canonical: crate::context::manager::resolve_canonical(root)?,
        })
    }

    /// `canonical_path` as this root's index spells it; `None` when it does
    /// not sit under this root (then the index has nothing to do with it).
    fn spell(&self, canonical_path: &Path) -> Option<String> {
        let relative = canonical_path.strip_prefix(&self.canonical).ok()?;
        if relative.as_os_str().is_empty() {
            return Some(self.spelling.clone());
        }
        Some(
            Path::new(&self.spelling)
                .join(relative)
                .to_string_lossy()
                .into_owned(),
        )
    }
}

/// What a refresh saw when it asked: the slot's registration generation and
/// its epoch. A publication counts for it only if both still match.
#[derive(Clone, Copy)]
struct RegistrationVersion {
    generation: u64,
    epoch: u64,
    /// The removal sequence that last tombstoned the slot (0: never).
    removed_at: u64,
}

/// The right to publish one build into one registration generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct BuildToken {
    generation: u64,
    incarnation: u64,
}

/// The build currently reading a slot's vault: its exact root and the
/// mutations that landed since it started, to replay onto its snapshot.
struct PendingBuild {
    token: BuildToken,
    root: IndexRoot,
    journal: Vec<Mutation>,
}

/// One context's slot (see the header). A slot can exist without an index — a
/// save that lands before the first build is journaled so that build publishes
/// the saved state, not what it read before the save — and outlives its
/// context as a tombstone carrying the next generation.
#[derive(Default)]
struct Slot {
    /// Bumped by `forget`: one registration lifetime of this key.
    generation: u64,
    /// The value of `LinkIndexState::removals` when `forget` last tombstoned
    /// this slot (0: never). A refresh that read the counter before resolving
    /// its root and finds a larger stamp here was looking at a registration
    /// that is gone.
    removed_at: u64,
    /// The registration incarnation (`ContextState::incarnation`) the newest
    /// build under this key was started for. A `forget` that carries an older
    /// incarnation is stale — the path was re-registered and rebuilt before it
    /// arrived — and is ignored.
    incarnation: u64,
    /// Bumped by every publication and every mutation.
    epoch: u64,
    /// The epoch value at the last publication (0: never published).
    published_at: u64,
    index: Option<LinkIndex>,
    /// Stats of the live index, handed to a refresh that coalesces onto it.
    stats: Option<IndexStats>,
    /// The root the live index was built from — the spelling its paths use.
    root: Option<IndexRoot>,
    /// Present only while a build is reading (between begin_build and publish).
    pending: Option<PendingBuild>,
}

/// An in-place change to an index — the unit that is applied, journaled and
/// replayed. It names the file by its CANONICAL path; the spelling is decided
/// by the index it meets (`apply_to`).
#[derive(Clone)]
pub(crate) enum Mutation {
    /// A file was re-read (saved, or rewritten by a rename).
    Update { path: PathBuf, content: String },
    /// A file is gone under this path (renamed away).
    Remove { path: PathBuf },
}

impl Mutation {
    /// Canonicalises `path` — outside any lock (it touches the filesystem).
    fn update(path: &str, content: String) -> Result<Self, String> {
        Ok(Self::Update {
            path: crate::context::manager::resolve_canonical(path)?,
            content,
        })
    }

    fn remove(path: &str) -> Result<Self, String> {
        Ok(Self::Remove {
            path: crate::context::manager::resolve_canonical(path)?,
        })
    }

    fn apply_to(&self, index: &mut LinkIndex, root: &IndexRoot) {
        let canonical_path = match self {
            Self::Update { path, .. } | Self::Remove { path } => path,
        };
        let Some(spelled) = root.spell(canonical_path) else {
            return;
        };
        match self {
            Self::Update { content, .. } => index.update_file_from_content(&spelled, content),
            Self::Remove { .. } => index.remove_file(&spelled),
        }
    }
}

/// Managed state: per-context in-memory link indexes, keyed by the context's
/// registered path (see the header). Private on purpose — the closure API below
/// is the only way in.
pub struct LinkIndexState {
    slots: Mutex<HashMap<String, Slot>>,
    /// One build at a time per key (`rebuild_and_publish`). A per-key lock held
    /// across the build's file I/O — never the map lock.
    builds: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    /// Bumped by every `forget` and stamped on the tombstone it leaves
    /// (`Slot::removed_at`). A refresh reads it before resolving its root; a
    /// tombstone stamped later under the key it resolved means that very
    /// registration was removed while it looked.
    ///
    /// Neither map is ever pruned: a key is a registered context path, so the
    /// growth is bounded by the distinct paths registered in one process
    /// (about 600 bytes each). A tombstone cannot go — it is what remembers the
    /// generation — and a `builds` entry could only be reclaimed under the
    /// map lock with a strong-count check; neither is worth it at that size.
    removals: AtomicU64,
}

impl Default for LinkIndexState {
    fn default() -> Self {
        Self::new()
    }
}

impl LinkIndexState {
    pub fn new() -> Self {
        Self {
            slots: Mutex::new(HashMap::new()),
            builds: Mutex::new(HashMap::new()),
            removals: AtomicU64::new(0),
        }
    }

    /// Read the index under `key` while holding the lock. `f` is synchronous,
    /// so nothing can await inside the critical section.
    pub(crate) async fn with_index<R>(
        &self,
        key: &str,
        f: impl FnOnce(Option<&LinkIndex>) -> R,
    ) -> R {
        let map = self.slots.lock().await;
        f(map.get(key).and_then(|s| s.index.as_ref()))
    }

    /// Apply mutations under `key` while holding the lock; same discipline.
    /// Every call bumps the epoch — also when there is no index yet. The live
    /// index receives them in its own root spelling; a build that is reading
    /// receives them in its journal, canonical, to replay when it publishes.
    pub(crate) async fn apply(&self, key: &str, mutations: Vec<Mutation>) {
        let mut map = self.slots.lock().await;
        let slot = map.entry(key.to_string()).or_default();
        slot.epoch += 1;
        let (index, live_root, pending) = (&mut slot.index, &slot.root, &mut slot.pending);
        if let (Some(index), Some(live_root)) = (index.as_mut(), live_root.as_ref()) {
            for mutation in &mutations {
                mutation.apply_to(index, live_root);
            }
        }
        if let Some(pending) = pending.as_mut() {
            pending.journal.extend(mutations);
        }
    }

    /// The current epoch (publications and mutations alike) — observed by the
    /// tests; production code reads it through `version`.
    #[cfg(test)]
    async fn epoch(&self, key: &str) -> u64 {
        self.slots.lock().await.get(key).map_or(0, |s| s.epoch)
    }

    /// What a refresh must capture before it waits for the build lock. Reads
    /// only — a slot is first created by `begin_build` or `apply`, so a read
    /// cannot turn a never-seen key into a registration.
    async fn version(&self, key: &str) -> RegistrationVersion {
        let map = self.slots.lock().await;
        match map.get(key) {
            Some(slot) => RegistrationVersion {
                generation: slot.generation,
                epoch: slot.epoch,
                removed_at: slot.removed_at,
            },
            None => RegistrationVersion {
                generation: 0,
                epoch: 0,
                removed_at: 0,
            },
        }
    }

    /// Mark a build as reading `root`: mutations from now on are journaled for
    /// it. `Invalidated` when the registration changed since `requested` (the
    /// context was removed meanwhile); a build already pending is a different
    /// failure (one build per key at a time — `rebuild_and_publish` holds the
    /// build lock, so this only happens to a caller outside it).
    async fn begin_build(
        &self,
        key: &str,
        requested: &RegistrationVersion,
        root: &str,
        incarnation: u64,
    ) -> Result<BuildToken, IndexBuildError> {
        // Canonicalisation touches the filesystem: before the lock.
        let root = IndexRoot::new(root).map_err(IndexBuildError::Failed)?;
        let mut map = self.slots.lock().await;
        let slot = map.entry(key.to_string()).or_default();
        if slot.generation != requested.generation {
            return Err(IndexBuildError::Invalidated);
        }
        if slot.pending.is_some() {
            return Err(IndexBuildError::Failed(INDEX_BUILD_PENDING.to_string()));
        }
        // The slot now belongs to (at least) this registration: an older
        // registration's `forget` arriving late must not tombstone it.
        slot.incarnation = slot.incarnation.max(incarnation);
        let token = BuildToken {
            generation: slot.generation,
            incarnation,
        };
        slot.pending = Some(PendingBuild {
            token,
            root,
            journal: Vec::new(),
        });
        Ok(token)
    }

    /// The build failed before publishing: stop journaling for it.
    async fn abort_build(&self, key: &str, token: BuildToken) {
        let mut map = self.slots.lock().await;
        let Some(slot) = map.get_mut(key) else {
            return;
        };
        if slot.generation == token.generation
            && slot.pending.as_ref().is_some_and(|p| p.token == token)
        {
            slot.pending = None;
        }
    }

    /// Publish a snapshot: the mutations journaled since `begin_build` are
    /// replayed onto it, in the pending root's spelling, so a save that landed
    /// while the build was reading is never overwritten. `None` when the
    /// registration is no longer the one the build started under — a stale
    /// publisher must not recreate a slot (`get_mut`, deliberately no `entry`)
    /// nor overwrite the next registration's state. Returns how many were
    /// replayed.
    async fn publish(
        &self,
        key: &str,
        token: BuildToken,
        mut index: LinkIndex,
        stats: IndexStats,
    ) -> Option<usize> {
        let mut map = self.slots.lock().await;
        let slot = map.get_mut(key)?;
        if slot.generation != token.generation
            || !slot.pending.as_ref().is_some_and(|p| p.token == token)
        {
            return None;
        }
        let pending = slot.pending.take()?;
        let replayed = pending.journal.len();
        for mutation in pending.journal {
            mutation.apply_to(&mut index, &pending.root);
        }
        slot.epoch += 1;
        slot.published_at = slot.epoch;
        slot.index = Some(index);
        slot.stats = Some(stats);
        slot.root = Some(pending.root);
        Some(replayed)
    }

    /// The root spelling the live index under `key` was built from, if any.
    async fn build_root(&self, key: &str) -> Option<String> {
        self.slots
            .lock()
            .await
            .get(key)
            .and_then(|s| s.root.as_ref())
            .map(|r| r.spelling.clone())
    }

    /// The context under `key`, registration `incarnation`, is being removed
    /// (context_cmd): leave an empty tombstone with the next generation, so
    /// builds started under the old registration cannot publish and the next
    /// registration's refresh cannot coalesce onto an old publication. The
    /// removal sequence is stamped on it, so a refresh that resolved this key
    /// just before the removal refuses instead of adopting the tombstone's
    /// fresh generation.
    ///
    /// `remove_context` removes from the ContextManager first and calls here
    /// after an await. If the same path was re-registered AND rebuilt inside
    /// that gap, the slot already carries the newer incarnation (`begin_build`
    /// stamps it) and this removal is stale: it is ignored rather than wiping
    /// an index that belongs to a live registration.
    pub(crate) async fn forget(&self, key: &str, incarnation: u64) {
        let mut map = self.slots.lock().await;
        if map.get(key).is_some_and(|s| s.incarnation > incarnation) {
            return;
        }
        let next = map.get(key).map_or(1, |s| s.generation + 1);
        // Under the same lock `version` reads; `fetch_add` returns the value
        // BEFORE the bump, so the stamp is one more.
        let removed_at = self.removals.fetch_add(1, Ordering::SeqCst) + 1;
        map.insert(
            key.to_string(),
            Slot {
                generation: next,
                removed_at,
                incarnation,
                ..Slot::default()
            },
        );
    }

    /// The stats of a publication of the SAME registration that happened after
    /// `requested`, if any — a refresh that queued behind it has nothing left
    /// to read.
    async fn published_since(
        &self,
        key: &str,
        requested: &RegistrationVersion,
    ) -> Option<IndexStats> {
        let map = self.slots.lock().await;
        map.get(key)
            .filter(|s| s.generation == requested.generation && s.published_at > requested.epoch)
            .and_then(|s| s.stats.clone())
    }

    /// The per-key build lock (created on first use).
    async fn build_lock(&self, key: &str) -> Arc<Mutex<()>> {
        self.builds
            .lock()
            .await
            .entry(key.to_string())
            .or_default()
            .clone()
    }
}

/// The contexts a path belongs to (`ContextManager::contexts_containing`):
/// every directory context containing it, deepest first — nested roots each
/// scan the file, so a mutation must reach all of them — or the File context
/// (§89) registered for that very file when no directory context does. Empty
/// when no registered context knows the path: a query then answers empty and
/// a save is a no-op, but a rename refuses (`ensure_indexes`' callers) — with
/// no context there is no evidence about references either way.
pub(crate) async fn owning_contexts(ctx_mgr: &ContextManager, path: &str) -> Vec<ContextInfo> {
    ctx_mgr.contexts_containing(path).await
}

/// The index keys of `contexts`: their registered paths.
fn keys_of(contexts: &[ContextInfo]) -> Vec<String> {
    contexts.iter().map(|c| c.path.clone()).collect()
}

/// The contexts an index can be built for: directory contexts. A File context
/// is registered for a file path and `LinkIndex::build` reads a directory, so
/// no build can ever fill that key — requiring it would refuse forever, and a
/// standalone file has no other file whose references could need updating.
fn buildable(contexts: &[ContextInfo]) -> Vec<ContextInfo> {
    contexts
        .iter()
        .filter(|c| matches!(c.context_type, ContextType::Vault | ContextType::Folder))
        .cloned()
        .collect()
}

/// The key for an explicit graph root (`get_link_index` with a root): the
/// deepest context containing it — the one registered for that directory, in
/// whatever spelling the caller has. `Err` when no context contains it.
pub(crate) async fn owning_index_key(
    ctx_mgr: &ContextManager,
    path: &str,
) -> Result<String, String> {
    let mut contexts = owning_contexts(ctx_mgr, path).await;
    if contexts.is_empty() {
        return Err(format!("{path} is not inside any registered context"));
    }
    Ok(contexts.swap_remove(0).path)
}

/// The key of the active context's index: its registered path.
///
/// `Err` when no context is active, and when the active id names no registered
/// context (`set_active` and `remove` take separate locks, so a stale id is
/// possible — an inconsistency to surface, not a cold start). Absence is an
/// error at the IPC boundary: the whole-graph view and knowledge search only
/// exist with a vault open.
///
/// "Active context with no index built yet" is a different, legitimate state
/// (indexes are built in the background when a vault opens): queries answer
/// empty and knowledge search ranks without a graph term.
pub(crate) async fn active_index_key(ctx_mgr: &ContextManager) -> Result<String, String> {
    let id = ctx_mgr.active_id().await.ok_or("No active context")?;
    ctx_mgr
        .registered_path(&id)
        .await
        .ok_or_else(|| format!("Active context {id} is not registered"))
}

/// Outgoing edges (source → targets) of the index under `key`, for hybrid
/// ranking's graph proximity (embedding_cmd). No index yet: no edges.
pub(crate) async fn outgoing_links(
    state: &LinkIndexState,
    key: &str,
) -> HashMap<String, Vec<String>> {
    let graph = state
        .with_index(key, |idx| idx.map(LinkIndex::get_link_graph))
        .await;
    graph.map(|g| outgoing_map(&g)).unwrap_or_default()
}

/// Edge list → adjacency map, the shape `hybrid_ranker::compute_hop_distances` walks.
pub(crate) fn outgoing_map(graph: &LinkGraph) -> HashMap<String, Vec<String>> {
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    for edge in &graph.edges {
        out.entry(edge.from.clone())
            .or_default()
            .push(edge.to.clone());
    }
    out
}

/// What a rename says when an index it needs went away between the gate and
/// the read (its context was removed under the rename), or when the build the
/// gate started was invalidated the same way. The next attempt sees the new
/// registrations. Renaming without the index used to rename the file and
/// rewrite none of its references, silently.
pub(crate) const INDEX_NOT_READY: &str =
    "The link index for this vault is not ready. Try again in a moment.";

/// A refresh reports this as its error; a namespace rename that already moved
/// its files treats it as "the index will be somebody else's" (see
/// `committed_namespace_result`).
const INDEX_BUILD_INVALIDATED: &str =
    "The link index build was invalidated because its context was removed.";

/// The registration a root named was removed between resolving it and
/// reading its generation — the request would have adopted the tombstone's
/// fresh generation. Refused before any work. Asking again does not help
/// until the path is registered again, whose own refresh then follows.
const INDEX_LOOKUP_INVALIDATED: &str =
    "The context of this link index root was removed while resolving it.";

/// Outside the build lock only (tests): a build is already reading this key.
const INDEX_BUILD_PENDING: &str = "A link index build is already pending for this vault.";

/// Why a rebuild did not publish. `Invalidated` is the one outcome a caller
/// may treat as "not my index any more" rather than as a failure.
#[derive(Debug, thiserror::Error)]
enum IndexBuildError {
    #[error("{}", INDEX_BUILD_INVALIDATED)]
    Invalidated,
    #[error("{0}")]
    Failed(String),
}

/// The rename gate. Every directory context containing the file must have a
/// live index before anything is touched — a reference from outside a nested
/// root is known only to the enclosing index — and one that has none yet is
/// built here, from that context's REGISTERED path, with the same
/// serialisation and coalescing as a refresh. That root is the spelling the
/// frontend gave at registration, not a guess (the prohibition in the header
/// is about roots derived from file paths), and it covers the contexts nothing
/// else builds: a journal or zettel space registered without being opened, a
/// nested folder restored from the last session. The first rename in such a
/// context waits for one scan. A build invalidated under the gate (the context
/// went away) is reported as INDEX_NOT_READY; the next attempt sees the new
/// registrations.
async fn ensure_indexes(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    contexts: &[ContextInfo],
) -> Result<(), String> {
    for ctx in buildable(contexts) {
        if state.with_index(&ctx.path, |idx| idx.is_some()).await {
            continue;
        }
        let target = prepare_index_build(state, ctx_mgr, &ctx.path)
            .await
            .map_err(|e| e.to_string())?;
        match rebuild_and_publish(state, &target, &ctx.path, true).await {
            Ok(_) => {}
            Err(IndexBuildError::Invalidated) => return Err(INDEX_NOT_READY.to_string()),
            Err(IndexBuildError::Failed(e)) => return Err(e),
        }
    }
    Ok(())
}

/// Read `f` from every index in `keys`, concatenated. A key whose index is
/// gone — removed under the caller since `ensure_indexes` — is a refusal,
/// never a silent "no references".
async fn read_indexes<T>(
    state: &LinkIndexState,
    keys: &[String],
    f: impl Fn(&LinkIndex) -> Vec<T>,
) -> Result<Vec<T>, String> {
    let mut out = Vec::new();
    for key in keys {
        let found = state.with_index(key, |idx| idx.map(&f)).await;
        out.extend(found.ok_or(INDEX_NOT_READY)?);
    }
    Ok(out)
}

/// A build's destination: the registration's key, the generation it may
/// publish into and the incarnation it belongs to.
struct BuildTarget {
    key: String,
    generation: u64,
    incarnation: u64,
}

/// Resolve the registration a root names and the generation a build may
/// publish into. The root must be a registered directory context ITSELF
/// (`context_registered_at`), not merely lie inside one: had its context just
/// been removed, "the deepest context containing it" would be the parent, and
/// building the parent's key from this subtree would replace the parent's
/// index with a partial one. Then only a removal of THIS key that crossed the
/// lookup — its tombstone stamped after `before` — refuses the request;
/// removals of unrelated contexts are none of its business.
async fn prepare_index_build(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    root_path: &str,
) -> Result<BuildTarget, IndexBuildError> {
    let before = state.removals.load(Ordering::SeqCst);
    let (info, incarnation) = ctx_mgr
        .context_registered_at(root_path)
        .await
        .ok_or_else(|| {
            IndexBuildError::Failed(format!("{root_path} is not a registered context root"))
        })?;
    let version = state.version(&info.path).await;
    if version.removed_at > before {
        return Err(IndexBuildError::Failed(
            INDEX_LOOKUP_INVALIDATED.to_string(),
        ));
    }
    Ok(BuildTarget {
        key: info.path,
        generation: version.generation,
        incarnation,
    })
}

/// Build the index under `target.key` from `root_path` (as the caller spells
/// it — a refresh passes the frontend's string, from which the file paths it
/// will query are derived; the rename gate passes the registered path) and
/// publish it into `target.generation`, with the mutations that landed while it read
/// replayed on top. One build per key at a time; a refresh that queued behind
/// a build that published in the meantime returns that build's stats instead
/// of scanning the vault again (startup asks for the same refresh from several
/// places) — when `coalesce` is set. A namespace rename passes `false`: a
/// refresh that scanned BEFORE its directory move can publish after it (the
/// move is not a journaled mutation), and that publication, though newer than
/// the rename's request, describes the old layout; the rename must scan.
async fn rebuild_and_publish(
    state: &LinkIndexState,
    target: &BuildTarget,
    root_path: &str,
    coalesce: bool,
) -> Result<IndexStats, IndexBuildError> {
    let key = target.key.as_str();
    let requested = state.version(key).await;
    if requested.generation != target.generation {
        return Err(IndexBuildError::Invalidated);
    }
    let lock = state.build_lock(key).await;
    let _building = lock.lock().await;
    if coalesce {
        if let Some(stats) = state.published_since(key, &requested).await {
            return Ok(stats);
        }
    }
    let token = state
        .begin_build(key, &requested, root_path, target.incarnation)
        .await?;
    let mut new_index = LinkIndex::new();
    let stats = match new_index.build(root_path).await {
        Ok(stats) => stats,
        Err(e) => {
            state.abort_build(key, token).await;
            return Err(IndexBuildError::Failed(e.to_string()));
        }
    };
    publish_built_index(state, key, token, new_index, stats).await
}

/// The publication step of a build (the caller holds the key's build lock).
async fn publish_built_index(
    state: &LinkIndexState,
    key: &str,
    token: BuildToken,
    index: LinkIndex,
    stats: IndexStats,
) -> Result<IndexStats, IndexBuildError> {
    state
        .publish(key, token, index, stats.clone())
        .await
        .ok_or(IndexBuildError::Invalidated)?;
    Ok(stats)
}

/// Whether `file_path` is spelled under `root`: component-wise, so `/x/Vault`
/// does not claim `/x/Vault-secret/a.md`, a trailing slash on the root does not
/// matter, and on Windows either separator counts — never a string prefix
/// built with a hard-coded `/`, which on Windows matches nothing.
fn spelled_under(root: &str, file_path: &str) -> bool {
    Path::new(file_path).starts_with(Path::new(root))
}

/// Which of `keys` (containing indexes) cover `path`: a reference file outside
/// a nested root belongs to the enclosing index alone, and must not be written
/// into the nested one.
async fn keys_covering(ctx_mgr: &ContextManager, keys: &[String], path: &str) -> Vec<String> {
    let covering = keys_of(&owning_contexts(ctx_mgr, path).await);
    keys.iter()
        .filter(|k| covering.contains(k))
        .cloned()
        .collect()
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

// ── Commands: thin wrappers over the testable functions below ─────────────────

#[tauri::command]
pub async fn get_backlinks(
    file_path: String,
    state: State<'_, LinkIndexState>,
    ctx_mgr: State<'_, ContextManager>,
) -> Result<Vec<BacklinkResult>, String> {
    get_backlinks_inner(&state, &ctx_mgr, &file_path).await
}

#[tauri::command]
pub async fn get_link_index(
    root_path: Option<String>,
    state: State<'_, LinkIndexState>,
    ctx_mgr: State<'_, ContextManager>,
) -> Result<LinkGraph, String> {
    get_link_index_inner(&state, &ctx_mgr, root_path).await
}

#[tauri::command]
pub async fn refresh_index(
    root_path: String,
    state: State<'_, LinkIndexState>,
    ctx_mgr: State<'_, ContextManager>,
) -> Result<IndexStats, String> {
    refresh_index_inner(&state, &ctx_mgr, &root_path).await
}

#[tauri::command]
pub async fn update_file_index(
    file_path: String,
    state: State<'_, LinkIndexState>,
    ctx_mgr: State<'_, ContextManager>,
) -> Result<(), String> {
    update_file_index_inner(&state, &ctx_mgr, &file_path).await
}

/// §34 Find unlinked mentions — text occurrences of a file's name in other files
#[tauri::command]
pub async fn get_unlinked_mentions(
    file_path: String,
    root_path: String,
) -> Result<Vec<UnlinkedMentionResult>, String> {
    find_unlinked_mentions(&file_path, &root_path)
        .await
        .map_err(|e| e.to_string())
}

/// §33 Result of renaming a file with wikilink updates
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    pub updated_files: Vec<String>,
}

/// §33 Rename a file and update all wikilinks that reference it
#[tauri::command]
pub async fn rename_file_with_links(
    old_path: String,
    new_path: String,
    state: State<'_, LinkIndexState>,
    ctx_mgr: State<'_, ContextManager>,
) -> Result<RenameResult, String> {
    rename_file_with_links_inner(&state, &ctx_mgr, &old_path, &new_path).await
}

/// §30a Rename a block ID and update all references in other files
#[tauri::command]
pub async fn rename_block_id(
    file_path: String,
    old_id: String,
    new_id: String,
    state: State<'_, LinkIndexState>,
    ctx_mgr: State<'_, ContextManager>,
) -> Result<RenameResult, String> {
    rename_block_id_inner(&state, &ctx_mgr, &file_path, &old_id, &new_id).await
}

/// §61 Result of renaming a namespace (directory) with wikilink updates
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamespaceRenameResult {
    pub updated_files: Vec<String>,
    pub files_moved: u32,
}

/// §61 Rename a directory (namespace) and update all relative wikilinks that reference it
#[tauri::command]
pub async fn rename_namespace(
    old_dir: String,
    new_dir: String,
    root_path: String,
    state: State<'_, LinkIndexState>,
    ctx_mgr: State<'_, ContextManager>,
) -> Result<NamespaceRenameResult, String> {
    rename_namespace_inner(&state, &ctx_mgr, &old_dir, &new_dir, &root_path).await
}

// ── The orchestration layer the tests go through ──────────────────────────────

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

pub(crate) async fn refresh_index_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    root_path: &str,
) -> Result<IndexStats, String> {
    let target = prepare_index_build(state, ctx_mgr, root_path)
        .await
        .map_err(|e| e.to_string())?;
    rebuild_and_publish(state, &target, root_path, true)
        .await
        .map_err(|e| e.to_string())
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

pub(crate) async fn rename_file_with_links_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    old_path: &str,
    new_path: &str,
) -> Result<RenameResult, String> {
    // The contexts and their indexes first: nothing is renamed without them.
    // No context at all is a refusal (nothing is known about references); a
    // standalone File context (§89) has no directory index and no other file
    // to update, so the file is simply renamed.
    let contexts = owning_contexts(ctx_mgr, old_path).await;
    if contexts.is_empty() {
        return Err(format!("{old_path} is not inside any registered context"));
    }
    ensure_indexes(state, ctx_mgr, &contexts).await?;
    let keys = keys_of(&buildable(&contexts));
    let old_target = Path::new(old_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or("Invalid old path")?;
    let new_target = Path::new(new_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or("Invalid new path")?;

    // 1. Get referencing files from every containing index (inside lock, quick
    //    reads) — a reference from outside a nested root is known only to the
    //    enclosing index. An index gone since the gate is a refusal.
    let mut referring_files =
        read_indexes(state, &keys, |i| i.get_files_linking_to(&old_target)).await?;
    referring_files.sort();
    referring_files.dedup();

    // Canonical identities of the file being renamed, resolved before it moves
    // (the new path does not exist yet: resolve_canonical builds it on its
    // existing parent).
    let remove_old = Mutation::remove(old_path)?;
    let renamed_identity = crate::context::manager::resolve_canonical(new_path)?;

    // 2. Read and update each referring file (async I/O, outside lock)
    let mut updated_files = Vec::new();
    let mut updated_contents: Vec<(PathBuf, String)> = Vec::new();

    for file_path in &referring_files {
        // Skip the file being renamed itself
        if file_path == old_path {
            continue;
        }
        let content = match tokio::fs::read_to_string(file_path).await {
            Ok(c) => c,
            Err(_) => continue,
        };

        let new_content = replace_wikilink_target(&content, &old_target, &new_target);
        if new_content != content {
            let identity = crate::context::manager::resolve_canonical(file_path)?;
            // Atomic write (§3.6: tmp → rename)
            crate::fs::write_file(file_path, &new_content)
                .await
                .map_err(|e| e.to_string())?;
            updated_files.push(file_path.clone());
            updated_contents.push((identity, new_content));
        }
    }

    // 3. Rename the actual file
    crate::fs::rename_file(old_path, new_path)
        .await
        .map_err(|e| e.to_string())?;

    // 4. Update every containing index: drop the old entry, re-index the
    //    referring files from the content we already have — each into the
    //    indexes that cover it — then the renamed file. Each index spells the
    //    paths its own way (Mutation::apply_to).
    let renamed_content = tokio::fs::read_to_string(new_path)
        .await
        .unwrap_or_default();
    let mut per_key: HashMap<String, Vec<Mutation>> = HashMap::new();
    push_for_keys(&mut per_key, &keys, &remove_old);
    for (identity, content) in updated_contents {
        let covering = keys_covering(ctx_mgr, &keys, &identity.to_string_lossy()).await;
        push_for_keys(
            &mut per_key,
            &covering,
            &Mutation::Update {
                path: identity,
                content,
            },
        );
    }
    push_for_keys(
        &mut per_key,
        &keys,
        &Mutation::Update {
            path: renamed_identity,
            content: renamed_content,
        },
    );
    for (key, list) in per_key {
        state.apply(&key, list).await;
    }

    Ok(RenameResult { updated_files })
}

pub(crate) async fn rename_block_id_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    file_path: &str,
    old_id: &str,
    new_id: &str,
) -> Result<RenameResult, String> {
    let contexts = owning_contexts(ctx_mgr, file_path).await;
    if contexts.is_empty() {
        return Err(format!("{file_path} is not inside any registered context"));
    }
    ensure_indexes(state, ctx_mgr, &contexts).await?;
    let keys = keys_of(&buildable(&contexts));

    // 1. Get referring files from every containing index (block_id == old_id,
    //    target == this file). An index gone since the gate is a refusal.
    let mut referring_files: Vec<String> = read_indexes(state, &keys, |index| {
        index
            .get_backlinks(file_path)
            .iter()
            .filter(|b| b.block_id.as_deref() == Some(old_id))
            .map(|b| b.source_path.clone())
            .collect()
    })
    .await?;
    referring_files.sort();
    referring_files.dedup();

    // 2. Read + replace + write (outside lock)
    let mut updated_files = Vec::new();
    let mut updated_contents: Vec<(PathBuf, String)> = Vec::new();

    for ref_path in &referring_files {
        if ref_path == file_path {
            continue;
        }
        let content = match tokio::fs::read_to_string(ref_path).await {
            Ok(c) => c,
            Err(_) => continue,
        };
        let new_content = replace_block_id_refs(&content, old_id, new_id);
        if new_content != content {
            let identity = crate::context::manager::resolve_canonical(ref_path)?;
            crate::fs::write_file(ref_path, &new_content)
                .await
                .map_err(|e| e.to_string())?;
            updated_files.push(ref_path.clone());
            updated_contents.push((identity, new_content));
        }
    }

    // 3. Update the containing indexes — each rewritten file goes into the
    //    indexes that cover it, spelled each index's way.
    let mut per_key: HashMap<String, Vec<Mutation>> = HashMap::new();
    for (identity, content) in updated_contents {
        let covering = keys_covering(ctx_mgr, &keys, &identity.to_string_lossy()).await;
        push_for_keys(
            &mut per_key,
            &covering,
            &Mutation::Update {
                path: identity,
                content,
            },
        );
    }
    for (key, list) in per_key {
        state.apply(&key, list).await;
    }

    Ok(RenameResult { updated_files })
}

pub(crate) async fn rename_namespace_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    old_dir: &str,
    new_dir: &str,
    root_path: &str,
) -> Result<NamespaceRenameResult, String> {
    // The key and its generation first: a root outside every context has no
    // index to rebuild, and nothing is moved for it.
    let target = prepare_index_build(state, ctx_mgr, root_path)
        .await
        .map_err(|e| e.to_string())?;
    let committed = commit_namespace_rename(old_dir, new_dir, root_path).await?;
    // Full rebuild (many files moved), under the same key every lookup derives,
    // never coalesced onto a publication that may predate the move.
    let rebuilt = rebuild_and_publish(state, &target, root_path, false).await;
    committed_namespace_result(committed, rebuilt)
}

/// The filesystem half of a namespace rename: rewrite the relative wikilinks
/// that point into the directory, then move it.
async fn commit_namespace_rename(
    old_dir: &str,
    new_dir: &str,
    root_path: &str,
) -> Result<NamespaceRenameResult, String> {
    // 1. Collect all .md files in the vault
    let all_files = collect_md_files(root_path)
        .await
        .map_err(|e| e.to_string())?;

    let old_dir_slash = if old_dir.ends_with('/') {
        old_dir.to_string()
    } else {
        format!("{}/", old_dir)
    };

    // Count files that will be moved
    let files_moved = all_files
        .iter()
        .filter(|f| f.starts_with(&old_dir_slash))
        .count() as u32;

    // 2. Find and update files outside old_dir that have relative wikilinks pointing into old_dir
    let mut updated_files = Vec::new();

    for file_path in &all_files {
        // Skip files inside the directory being renamed (they move with it)
        if file_path.starts_with(&old_dir_slash) {
            continue;
        }

        let content = match tokio::fs::read_to_string(file_path).await {
            Ok(c) => c,
            Err(_) => continue,
        };

        let new_content = rewrite_relative_wikilinks(&content, file_path, old_dir, new_dir);

        if new_content != content {
            crate::fs::write_file(file_path, &new_content)
                .await
                .map_err(|e| e.to_string())?;
            updated_files.push(file_path.clone());
        }
    }

    // 3. Rename the directory
    crate::fs::rename_file(old_dir, new_dir)
        .await
        .map_err(|e| e.to_string())?;

    Ok(NamespaceRenameResult {
        updated_files,
        files_moved,
    })
}

/// What a namespace rename reports once its files have moved: success, also
/// when the rebuild was invalidated by the context's removal (the files moved;
/// whoever registers the path next builds their own index) — a real rebuild
/// failure is still a failure.
fn committed_namespace_result(
    committed: NamespaceRenameResult,
    rebuilt: Result<IndexStats, IndexBuildError>,
) -> Result<NamespaceRenameResult, String> {
    match rebuilt {
        Ok(_) | Err(IndexBuildError::Invalidated) => Ok(committed),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::{ContextInfo, ContextType};

    fn info(id: &str, path: &str, kind: ContextType) -> ContextInfo {
        ContextInfo {
            id: id.to_string(),
            context_type: kind,
            path: path.to_string(),
            label: id.to_string(),
            color: "#ffffff".to_string(),
            alias: None,
            vault_type: None,
            added_at: 0,
        }
    }

    /// A vault whose `a.md` links to `b.md`, registered under an id that is
    /// nothing like its path — the shape of the bug. Active unless told otherwise.
    async fn vault_with_a_link(
        ctx: &ContextManager,
        id: &str,
        active: bool,
    ) -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap().to_string();
        std::fs::write(dir.path().join("a.md"), "see [[b]]").unwrap();
        std::fs::write(dir.path().join("b.md"), "target").unwrap();
        ctx.add(info(id, &root, ContextType::Folder)).await.unwrap();
        if active {
            ctx.set_active(id).await.unwrap();
        }
        (dir, root)
    }

    /// The registration incarnation of a context, as `remove_context` would
    /// hand it to `forget`.
    async fn incarnation_of(ctx: &ContextManager, id: &str) -> u64 {
        ctx.registration(id).await.unwrap().1
    }

    fn sources(backlinks: &[BacklinkResult]) -> Vec<&str> {
        backlinks.iter().map(|b| b.source_path.as_str()).collect()
    }

    /// A build that has read the vault but not published yet — the window in
    /// which saves and renames race it.
    async fn staged_build(
        state: &LinkIndexState,
        ctx: &ContextManager,
        key: &str,
        root: &str,
    ) -> (BuildToken, LinkIndex, IndexStats) {
        let incarnation = ctx
            .context_registered_at(root)
            .await
            .map_or(0, |(_, incarnation)| incarnation);
        let requested = state.version(key).await;
        let token = state
            .begin_build(key, &requested, root, incarnation)
            .await
            .unwrap();
        let mut snapshot = LinkIndex::new();
        let stats = snapshot.build(root).await.unwrap();
        (token, snapshot, stats)
    }

    #[tokio::test]
    async fn the_active_contexts_graph_is_found_when_its_id_is_nothing_like_its_path() {
        let ctx = ContextManager::new();
        let (_dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
        let state = LinkIndexState::new();
        refresh_index_inner(&state, &ctx, &root).await.unwrap();

        // Hybrid ranking's view: the edge a → b, with the exact paths the
        // frontend will pass as `current_file`.
        let key = active_index_key(&ctx).await.unwrap();
        let outgoing = outgoing_links(&state, &key).await;
        assert_eq!(
            outgoing.get(&format!("{root}/a.md")),
            Some(&vec![format!("{root}/b.md")])
        );
        // The backlinks panel's view of the same index.
        let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
            .await
            .unwrap();
        assert_eq!(sources(&backlinks), vec![format!("{root}/a.md")]);
        // Before: the ranking side looked the map up under the id and got nothing.
        assert!(state.with_index("ctx-abc", |idx| idx.is_none()).await);
    }

    #[tokio::test]
    async fn file_commands_use_the_files_own_context_not_the_active_one() {
        let ctx = ContextManager::new();
        let (_a, root_a) = vault_with_a_link(&ctx, "ctx-a", true).await;
        let (dir_b, root_b) = vault_with_a_link(&ctx, "ctx-b", false).await;
        let state = LinkIndexState::new();
        refresh_index_inner(&state, &ctx, &root_a).await.unwrap();
        refresh_index_inner(&state, &ctx, &root_b).await.unwrap();

        // A is active; a B file is saved (a non-active tab) and re-indexed.
        std::fs::write(dir_b.path().join("a.md"), "link removed").unwrap();
        update_file_index_inner(&state, &ctx, &format!("{root_b}/a.md"))
            .await
            .unwrap();
        // B changed…
        assert!(get_backlinks_inner(&state, &ctx, &format!("{root_b}/b.md"))
            .await
            .unwrap()
            .is_empty());
        // …and A did not.
        let backlinks_a = get_backlinks_inner(&state, &ctx, &format!("{root_a}/b.md"))
            .await
            .unwrap();
        assert_eq!(sources(&backlinks_a), vec![format!("{root_a}/a.md")]);
    }

    #[tokio::test]
    async fn a_file_opened_standalone_inside_an_open_folder_belongs_to_the_folders_index() {
        // §89 single-file mode registers a File context for the file itself.
        // Its containing folder is what has links to it.
        let ctx = ContextManager::new();
        let (_dir, root) = vault_with_a_link(&ctx, "ctx-folder", true).await;
        ctx.add(info("ctx-file", &format!("{root}/b.md"), ContextType::File))
            .await
            .unwrap();
        let state = LinkIndexState::new();
        refresh_index_inner(&state, &ctx, &root).await.unwrap();
        assert_eq!(
            owning_index_key(&ctx, &format!("{root}/b.md"))
                .await
                .unwrap(),
            root
        );
        let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
            .await
            .unwrap();
        assert_eq!(sources(&backlinks), vec![format!("{root}/a.md")]);
    }

    #[tokio::test]
    async fn file_commands_work_with_no_active_context_and_a_file_outside_every_context_reads_empty(
    ) {
        let ctx = ContextManager::new();
        let (_dir, root) = vault_with_a_link(&ctx, "ctx-b", false).await;
        let state = LinkIndexState::new();
        refresh_index_inner(&state, &ctx, &root).await.unwrap();
        let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
            .await
            .unwrap();
        assert_eq!(sources(&backlinks), vec![format!("{root}/a.md")]);

        // A path no context knows: nothing to report and nothing to index —
        // empty and a no-op, not errors the backlinks panel would render as a
        // banner (and the callers' `.then(invalidate)` still runs). A rename of
        // it is refused — nothing is known about its references — and it is
        // no build root.
        let outside = tempfile::tempdir().unwrap();
        let stray = format!("{}/x.md", outside.path().to_str().unwrap());
        std::fs::write(&stray, "stray").unwrap();
        assert!(get_backlinks_inner(&state, &ctx, &stray)
            .await
            .unwrap()
            .is_empty());
        update_file_index_inner(&state, &ctx, &stray).await.unwrap();
        let err = rename_file_with_links_inner(
            &state,
            &ctx,
            &stray,
            &format!("{}/y.md", outside.path().to_str().unwrap()),
        )
        .await
        .unwrap_err();
        assert!(err.contains("not inside any registered context"), "{err}");
        assert!(std::path::Path::new(&stray).exists());
        assert!(rename_block_id_inner(&state, &ctx, &stray, "a", "b")
            .await
            .is_err());
        assert!(
            refresh_index_inner(&state, &ctx, outside.path().to_str().unwrap())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn the_active_only_commands_are_errors_without_an_active_context() {
        let ctx = ContextManager::new();
        let state = LinkIndexState::new();
        assert_eq!(
            get_link_index_inner(&state, &ctx, None).await.unwrap_err(),
            "No active context"
        );
        assert_eq!(
            active_index_key(&ctx).await.unwrap_err(),
            "No active context"
        );
    }

    #[tokio::test]
    async fn an_active_context_with_no_index_yet_answers_empty_and_a_save_is_a_no_op() {
        let ctx = ContextManager::new();
        let (_dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
        let state = LinkIndexState::new();
        assert!(get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
            .await
            .unwrap()
            .is_empty());
        assert!(get_link_index_inner(&state, &ctx, None)
            .await
            .unwrap()
            .edges
            .is_empty());
        update_file_index_inner(&state, &ctx, &format!("{root}/a.md"))
            .await
            .unwrap();
        let key = active_index_key(&ctx).await.unwrap();
        assert!(outgoing_links(&state, &key).await.is_empty());
        assert!(state.with_index(&key, |idx| idx.is_none()).await);
    }

    #[tokio::test]
    async fn a_rename_before_the_initial_build_builds_the_index_first() {
        let ctx = ContextManager::new();
        let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
        let state = LinkIndexState::new();
        // No refresh has run: the gate builds the index from the registered
        // path, then the rename rewrites the referring file. Renaming here used
        // to be refused (and, before that, to rewrite nothing at all).
        assert!(state.with_index(&root, |idx| idx.is_none()).await);
        let result = rename_file_with_links_inner(
            &state,
            &ctx,
            &format!("{root}/b.md"),
            &format!("{root}/c.md"),
        )
        .await
        .unwrap();
        assert_eq!(result.updated_files, vec![format!("{root}/a.md")]);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
            "see [[c]]"
        );
        assert!(dir.path().join("c.md").exists());
        // The index the gate built is the live one — it saw the rename too.
        assert_eq!(state.build_root(&root).await, Some(root.clone()));
        assert!(get_backlinks_inner(&state, &ctx, &format!("{root}/c.md"))
            .await
            .unwrap()
            .iter()
            .any(|b| b.source_path == format!("{root}/a.md")));
        // A block-id rename in a context with no index goes the same way.
        std::fs::write(dir.path().join("a.md"), "see ((c#^old))").unwrap();
        update_file_index_inner(&state, &ctx, &format!("{root}/a.md"))
            .await
            .unwrap();
        state
            .forget(&root, incarnation_of(&ctx, "ctx-abc").await)
            .await;
        ctx.remove("ctx-abc").await.unwrap();
        ctx.add(info("ctx-abc", &root, ContextType::Folder))
            .await
            .unwrap();
        let result = rename_block_id_inner(&state, &ctx, &format!("{root}/c.md"), "old", "new")
            .await
            .unwrap();
        assert_eq!(result.updated_files, vec![format!("{root}/a.md")]);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
            "see ((c#^new))"
        );
    }

    #[tokio::test]
    async fn a_root_in_any_spelling_lands_on_the_registered_key() {
        let ctx = ContextManager::new();
        let (_dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
        let state = LinkIndexState::new();
        // The frontend's rootPath with a trailing slash…
        refresh_index_inner(&state, &ctx, &format!("{root}/"))
            .await
            .unwrap();
        // …is the index the active lookup and the explicit-root lookup read.
        let key = active_index_key(&ctx).await.unwrap();
        assert_eq!(key, root);
        assert!(!outgoing_links(&state, &key).await.is_empty());
        assert!(
            !get_link_index_inner(&state, &ctx, Some(format!("{root}/")))
                .await
                .unwrap()
                .edges
                .is_empty()
        );
        assert!(!get_link_index_inner(&state, &ctx, Some(root.clone()))
            .await
            .unwrap()
            .edges
            .is_empty());
        // Exactly one entry: the spelling did not fork the map.
        assert!(
            state
                .with_index(&format!("{root}/"), |idx| idx.is_none())
                .await
        );
    }

    #[tokio::test]
    async fn rename_namespace_rebuilds_under_the_same_key_the_lookups_read() {
        let ctx = ContextManager::new();
        let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
        let state = LinkIndexState::new();
        refresh_index_inner(&state, &ctx, &root).await.unwrap();
        std::fs::create_dir(dir.path().join("ns")).unwrap();
        std::fs::write(dir.path().join("ns/c.md"), "see [[b]]").unwrap();
        rename_namespace_inner(
            &state,
            &ctx,
            &format!("{root}/ns"),
            &format!("{root}/ns2"),
            &root,
        )
        .await
        .unwrap();
        let key = active_index_key(&ctx).await.unwrap();
        let outgoing = outgoing_links(&state, &key).await;
        assert!(outgoing.contains_key(&format!("{root}/ns2/c.md")));
        assert!(!outgoing.contains_key(&format!("{root}/ns/c.md")));
    }

    #[tokio::test]
    async fn update_file_index_edits_the_index_in_place() {
        let ctx = ContextManager::new();
        let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
        let state = LinkIndexState::new();
        refresh_index_inner(&state, &ctx, &root).await.unwrap();
        std::fs::write(dir.path().join("a.md"), "no link any more").unwrap();
        update_file_index_inner(&state, &ctx, &format!("{root}/a.md"))
            .await
            .unwrap();
        assert!(get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn a_save_that_lands_while_a_build_reads_is_replayed_onto_the_snapshot() {
        let ctx = ContextManager::new();
        let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
        let state = LinkIndexState::new();
        refresh_index_inner(&state, &ctx, &root).await.unwrap();
        let key = active_index_key(&ctx).await.unwrap();

        // A background refresh has read a.md while it still links to b…
        let (token, snapshot, stats) = staged_build(&state, &ctx, &key, &root).await;
        // …then the user removes the link and the save re-indexes the file.
        std::fs::write(dir.path().join("a.md"), "no link any more").unwrap();
        update_file_index_inner(&state, &ctx, &format!("{root}/a.md"))
            .await
            .unwrap();
        // The snapshot is published WITH the save replayed: the newer state wins.
        assert_eq!(state.publish(&key, token, snapshot, stats).await, Some(1));
        assert!(get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
            .await
            .unwrap()
            .is_empty());

        // And the other way round: a save that ADDS a link during a build.
        let (token, snapshot, stats) = staged_build(&state, &ctx, &key, &root).await;
        std::fs::write(dir.path().join("a.md"), "see [[b]] again").unwrap();
        update_file_index_inner(&state, &ctx, &format!("{root}/a.md"))
            .await
            .unwrap();
        assert_eq!(state.publish(&key, token, snapshot, stats).await, Some(1));
        let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
            .await
            .unwrap();
        assert_eq!(sources(&backlinks), vec![format!("{root}/a.md")]);
    }

    #[tokio::test]
    async fn a_save_during_the_very_first_build_is_part_of_what_that_build_publishes() {
        let ctx = ContextManager::new();
        let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
        let state = LinkIndexState::new();
        let key = active_index_key(&ctx).await.unwrap();

        // The first build has read a.md linking to b…
        let (token, snapshot, stats) = staged_build(&state, &ctx, &key, &root).await;
        // …a save lands while there is no index at all yet: nothing to apply
        // to, but it is journaled for the build.
        std::fs::write(dir.path().join("a.md"), "no link any more").unwrap();
        update_file_index_inner(&state, &ctx, &format!("{root}/a.md"))
            .await
            .unwrap();
        assert!(state.with_index(&key, |idx| idx.is_none()).await);
        assert_eq!(state.publish(&key, token, snapshot, stats).await, Some(1));
        assert!(get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
            .await
            .unwrap()
            .is_empty());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_first_build_save_is_replayed_in_the_pending_symlink_roots_spelling() {
        // The child is registered through a symlink and is having its FIRST
        // build; the save arrives in the parent's spelling before it publishes.
        let ctx = ContextManager::new();
        let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub/target.md"), "target").unwrap();
        std::fs::write(dir.path().join("sub/inner.md"), "stale [[target]]").unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let alias_path = elsewhere.path().join("alias");
        std::os::unix::fs::symlink(dir.path().join("sub"), &alias_path).unwrap();
        let alias = alias_path.to_str().unwrap().to_string();
        ctx.add(info("ctx-child", &alias, ContextType::Folder))
            .await
            .unwrap();
        let state = LinkIndexState::new();
        let key = owning_index_key(&ctx, &alias).await.unwrap();
        let (token, snapshot, stats) = staged_build(&state, &ctx, &key, &alias).await;

        // Snapshot: /alias/inner.md → /alias/target.md. The save removes the link.
        std::fs::write(dir.path().join("sub/inner.md"), "link removed").unwrap();
        update_file_index_inner(&state, &ctx, &format!("{root}/sub/inner.md"))
            .await
            .unwrap();
        assert_eq!(state.publish(&key, token, snapshot, stats).await, Some(1));

        // Replayed in the ALIAS spelling: the stale entry is gone, nothing is
        // spelled under the parent root, no edge survives.
        let graph = state
            .with_index(&key, |idx| idx.unwrap().get_link_graph())
            .await;
        assert!(graph.nodes.contains(&format!("{alias}/inner.md")));
        assert!(!graph
            .nodes
            .iter()
            .any(|n| n.starts_with(&format!("{root}/sub/"))));
        assert!(graph.edges.is_empty());
        let stale = state
            .with_index(&key, |idx| idx.unwrap().get_files_linking_to("target"))
            .await;
        assert!(stale.is_empty());
    }

    #[tokio::test]
    async fn an_in_flight_build_cannot_resurrect_a_forgotten_registration() {
        let ctx = ContextManager::new();
        let (dir, root) = vault_with_a_link(&ctx, "ctx-old", true).await;
        let state = LinkIndexState::new();
        let key = root.clone();

        // The old registration's build holds the per-key build lock and has read.
        let build_lock = state.build_lock(&key).await;
        let old_guard = build_lock.lock().await;
        let old_request = state.version(&key).await;
        let old_incarnation = incarnation_of(&ctx, "ctx-old").await;
        let old_token = state
            .begin_build(&key, &old_request, &root, old_incarnation)
            .await
            .unwrap();
        let mut old_snapshot = LinkIndex::new();
        let old_stats = old_snapshot.build(&root).await.unwrap();

        // The context is removed (context_cmd forgets its slot) and re-added.
        ctx.remove("ctx-old").await.unwrap();
        state.forget(&key, old_incarnation).await;
        ctx.add(info("ctx-new", &root, ContextType::Folder))
            .await
            .unwrap();
        ctx.set_active("ctx-new").await.unwrap();

        // The new registration's refresh records its version while the old
        // build still owns the lock.
        let new_request = state.version(&key).await;
        assert_ne!(new_request.generation, old_request.generation);
        assert_eq!(new_request.epoch, 0);

        // A save after forget belongs to the new registration.
        std::fs::write(dir.path().join("a.md"), "link removed").unwrap();
        update_file_index_inner(&state, &ctx, &format!("{root}/a.md"))
            .await
            .unwrap();
        assert_eq!(state.version(&key).await.epoch, 1);

        // The old generation cannot publish, recreate the slot, or satisfy
        // the new refresh's coalescing.
        assert_eq!(
            state
                .publish(&key, old_token, old_snapshot, old_stats)
                .await,
            None
        );
        assert!(state.with_index(&key, |idx| idx.is_none()).await);
        assert!(state.published_since(&key, &new_request).await.is_none());

        // Nor make the rename gate read it: with no live index under the new
        // registration the gate builds one — behind the build lock the old
        // build still holds — so the rename waits rather than trusting
        // anything stale. (Dropping the parked future cancels it before it
        // could begin a build.)
        {
            use std::future::Future;
            let (old_name, new_name) = (format!("{root}/b.md"), format!("{root}/c.md"));
            let mut rename = Box::pin(rename_file_with_links_inner(
                &state, &ctx, &old_name, &new_name,
            ));
            let mut task = std::task::Context::from_waker(futures::task::noop_waker_ref());
            assert!(rename.as_mut().poll(&mut task).is_pending());
        }
        assert!(dir.path().join("b.md").exists());

        // Once the old build lets go, the new registration builds for itself
        // and reads the saved content.
        drop(old_guard);
        let _new_guard = build_lock.lock().await;
        let new_token = state
            .begin_build(
                &key,
                &new_request,
                &root,
                incarnation_of(&ctx, "ctx-new").await,
            )
            .await
            .unwrap();
        let mut new_snapshot = LinkIndex::new();
        let new_stats = new_snapshot.build(&root).await.unwrap();
        assert_eq!(
            state
                .publish(&key, new_token, new_snapshot, new_stats)
                .await,
            Some(0)
        );
        assert!(get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
            .await
            .unwrap()
            .is_empty());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_nested_root_registered_through_a_symlink_gets_mutations_in_its_own_spelling() {
        // /vault is registered; /elsewhere/alias → /vault/sub is registered as
        // its own context. Both indexes scan sub/, each in its own spelling.
        let ctx = ContextManager::new();
        let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub/target.md"), "t").unwrap();
        std::fs::write(dir.path().join("sub/inner.md"), "inner [[target]]").unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let alias = elsewhere.path().join("alias");
        std::os::unix::fs::symlink(dir.path().join("sub"), &alias).unwrap();
        let alias = alias.to_str().unwrap().to_string();
        ctx.add(info("ctx-child", &alias, ContextType::Folder))
            .await
            .unwrap();
        let state = LinkIndexState::new();
        refresh_index_inner(&state, &ctx, &root).await.unwrap();
        refresh_index_inner(&state, &ctx, &alias).await.unwrap();

        // The rename arrives in the parent's spelling.
        rename_file_with_links_inner(
            &state,
            &ctx,
            &format!("{root}/sub/target.md"),
            &format!("{root}/sub/renamed.md"),
        )
        .await
        .unwrap();
        // The child index was updated in ITS spelling: no ghost of the old
        // name, the new name present, nothing spelled under the parent root.
        let child = outgoing_links(&state, &alias).await;
        assert_eq!(
            child.get(&format!("{alias}/inner.md")),
            Some(&vec![format!("{alias}/renamed.md")])
        );
        assert!(!child.keys().any(|k| k.starts_with(&root)));
        let child_graph = get_link_index_inner(&state, &ctx, Some(alias.clone()))
            .await
            .unwrap();
        assert!(!child_graph.nodes.iter().any(|n| n.ends_with("/target.md")));
        // And the merged backlinks name inner.md once, in the query's spelling.
        let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/sub/renamed.md"))
            .await
            .unwrap();
        assert_eq!(sources(&backlinks), vec![format!("{root}/sub/inner.md")]);
    }

    #[tokio::test]
    async fn forgetting_a_context_makes_the_next_registration_build_its_own_index() {
        let ctx = ContextManager::new();
        let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
        let state = LinkIndexState::new();
        refresh_index_inner(&state, &ctx, &root).await.unwrap();
        // The context is removed (context_cmd forgets its slot) and re-added:
        // the old index is gone, and the first rename under the new
        // registration builds a fresh one instead of trusting the old.
        let old = incarnation_of(&ctx, "ctx-abc").await;
        ctx.remove("ctx-abc").await.unwrap();
        state.forget(&root, old).await;
        assert!(state.with_index(&root, |idx| idx.is_none()).await);
        // Meanwhile the vault changed on disk — the old index would have said
        // `a.md` links to `b.md`; it no longer does.
        std::fs::write(dir.path().join("a.md"), "no link").unwrap();
        ctx.add(info("ctx-abc", &root, ContextType::Folder))
            .await
            .unwrap();
        let result = rename_file_with_links_inner(
            &state,
            &ctx,
            &format!("{root}/b.md"),
            &format!("{root}/c.md"),
        )
        .await
        .unwrap();
        assert!(result.updated_files.is_empty());
        assert_eq!(
            std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
            "no link"
        );
        assert!(dir.path().join("c.md").exists());
        assert!(state.epoch(&root).await > 0);
    }

    #[tokio::test]
    async fn nested_roots_a_rename_updates_each_index_only_with_the_files_it_covers() {
        let ctx = ContextManager::new();
        let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub/target.md"), "para ^b1").unwrap();
        std::fs::write(dir.path().join("sub/inner.md"), "inner [[target]]").unwrap();
        std::fs::write(
            dir.path().join("outside.md"),
            // On separate lines: get_backlinks keeps one entry per (source, line).
            "outside [[target]]\nand ((target#^b1))",
        )
        .unwrap();
        let sub = format!("{root}/sub");
        ctx.add(info("ctx-child", &sub, ContextType::Folder))
            .await
            .unwrap();
        let state = LinkIndexState::new();
        refresh_index_inner(&state, &ctx, &root).await.unwrap();
        refresh_index_inner(&state, &ctx, &sub).await.unwrap();

        async fn child_has_outside(
            state: &LinkIndexState,
            ctx: &ContextManager,
            sub: &str,
        ) -> bool {
            get_link_index_inner(state, ctx, Some(sub.to_string()))
                .await
                .unwrap()
                .nodes
                .iter()
                .any(|n| n.ends_with("/outside.md"))
        }
        assert!(!child_has_outside(&state, &ctx, &sub).await);

        // A block-id rename rewrites outside.md, which only the parent covers.
        let result = rename_block_id_inner(&state, &ctx, &format!("{sub}/target.md"), "b1", "b2")
            .await
            .unwrap();
        assert_eq!(result.updated_files, vec![format!("{root}/outside.md")]);
        assert!(!child_has_outside(&state, &ctx, &sub).await);

        // So does a file rename.
        rename_file_with_links_inner(
            &state,
            &ctx,
            &format!("{sub}/target.md"),
            &format!("{sub}/renamed.md"),
        )
        .await
        .unwrap();
        assert!(!child_has_outside(&state, &ctx, &sub).await);
        // The parent still knows outside.md's link, to the new name.
        let outgoing = outgoing_links(&state, &root).await;
        assert_eq!(
            outgoing
                .get(&format!("{root}/outside.md"))
                .map(|t| t.contains(&format!("{sub}/renamed.md"))),
            Some(true)
        );
    }

    #[tokio::test]
    async fn nested_roots_a_rename_builds_the_missing_enclosing_index_first() {
        let ctx = ContextManager::new();
        let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub/target.md"), "t").unwrap();
        std::fs::write(dir.path().join("outside.md"), "outside [[target]]").unwrap();
        let sub = format!("{root}/sub");
        ctx.add(info("ctx-child", &sub, ContextType::Folder))
            .await
            .unwrap();
        let state = LinkIndexState::new();
        // Only the child's index has landed; the parent's (slower) has not.
        // The reference from `outside.md` is known only to the parent's index,
        // so the gate builds it before the rename — refusing here (as this
        // used to) would have left users of a never-opened nested folder
        // unable to rename anything inside it.
        refresh_index_inner(&state, &ctx, &sub).await.unwrap();
        assert!(state.with_index(&root, |idx| idx.is_none()).await);
        let result = rename_file_with_links_inner(
            &state,
            &ctx,
            &format!("{sub}/target.md"),
            &format!("{sub}/renamed.md"),
        )
        .await
        .unwrap();
        assert_eq!(result.updated_files, vec![format!("{root}/outside.md")]);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("outside.md")).unwrap(),
            "outside [[renamed]]"
        );
        assert!(dir.path().join("sub/renamed.md").exists());
        assert_eq!(state.build_root(&root).await, Some(root.clone()));
    }

    #[tokio::test]
    async fn concurrent_refreshes_of_one_vault_scan_it_once() {
        let ctx = ContextManager::new();
        let (_dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
        let state = LinkIndexState::new();
        let (a, b, c, d) = tokio::join!(
            refresh_index_inner(&state, &ctx, &root),
            refresh_index_inner(&state, &ctx, &root),
            refresh_index_inner(&state, &ctx, &root),
            refresh_index_inner(&state, &ctx, &root),
        );
        for r in [a, b, c, d] {
            r.unwrap();
        }
        let key = active_index_key(&ctx).await.unwrap();
        // One publication: the three that queued behind the first took its
        // stats instead of reading the vault again.
        assert_eq!(state.epoch(&key).await, 1);
        assert!(!outgoing_links(&state, &key).await.is_empty());
    }

    #[tokio::test]
    async fn forget_before_version_cannot_be_adopted_by_an_old_refresh() {
        use std::future::Future;

        let ctx = ContextManager::new();
        let (dir, root) = vault_with_a_link(&ctx, "ctx-reused", true).await;
        let state = LinkIndexState::new();
        let old_spelling = format!("{root}/");

        let incarnation = incarnation_of(&ctx, "ctx-reused").await;
        let mut removal = Box::pin(state.forget(&root, incarnation));
        let mut old_refresh = Box::pin(refresh_index_inner(&state, &ctx, &old_spelling));

        // Hold the slots lock so both park on it: forget first (FIFO), then the
        // refresh — which has already resolved its owning key by then.
        let map = state.slots.lock().await;
        {
            let mut task = std::task::Context::from_waker(futures::task::noop_waker_ref());
            assert!(removal.as_mut().poll(&mut task).is_pending());
            assert!(old_refresh.as_mut().poll(&mut task).is_pending());
        }
        drop(map);

        ctx.remove("ctx-reused").await.unwrap();
        removal.await;
        // The same id is reused: an id comparison would not be a lifetime check.
        ctx.add(info("ctx-reused", &root, ContextType::Folder))
            .await
            .unwrap();
        ctx.set_active("ctx-reused").await.unwrap();
        std::fs::write(dir.path().join("a.md"), "link removed").unwrap();

        // The old refresh saw the removal counter move: refused, nothing published.
        assert_eq!(old_refresh.await.unwrap_err(), INDEX_LOOKUP_INVALIDATED);
        assert!(state.with_index(&root, |idx| idx.is_none()).await);

        // The new registration's own refresh builds in its own spelling.
        refresh_index_inner(&state, &ctx, &root).await.unwrap();
        assert_eq!(state.build_root(&root).await, Some(root.clone()));
        assert_eq!(state.epoch(&root).await, 1);
        assert!(get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn an_unrelated_removal_after_preparation_does_not_cancel_a_build() {
        let ctx = ContextManager::new();
        let (_a, root_a) = vault_with_a_link(&ctx, "ctx-a", true).await;
        let (_b, root_b) = vault_with_a_link(&ctx, "ctx-b", false).await;
        let state = LinkIndexState::new();
        let target = prepare_index_build(&state, &ctx, &root_a).await.unwrap();
        let incarnation_b = incarnation_of(&ctx, "ctx-b").await;
        ctx.remove("ctx-b").await.unwrap();
        state.forget(&root_b, incarnation_b).await;
        rebuild_and_publish(&state, &target, &root_a, true)
            .await
            .unwrap();
        assert_eq!(state.epoch(&target.key).await, 1);
        assert!(!outgoing_links(&state, &target.key).await.is_empty());
    }

    /// A vault with a directory `ns/` and a relative wikilink into it.
    async fn namespace_fixture(
        ctx: &ContextManager,
    ) -> (tempfile::TempDir, String, String, String) {
        let (dir, root) = vault_with_a_link(ctx, "ctx-namespace", true).await;
        let old_dir = format!("{root}/ns");
        let new_dir = format!("{root}/ns2");
        std::fs::create_dir(&old_dir).unwrap();
        std::fs::write(dir.path().join("ns/c.md"), "target").unwrap();
        std::fs::write(dir.path().join("a.md"), "see [[./ns/c]]").unwrap();
        (dir, root, old_dir, new_dir)
    }

    #[tokio::test]
    async fn a_committed_namespace_rename_survives_a_forget_between_build_and_publish() {
        let ctx = ContextManager::new();
        let (dir, root, old_dir, new_dir) = namespace_fixture(&ctx).await;
        let state = LinkIndexState::new();
        let target = prepare_index_build(&state, &ctx, &root).await.unwrap();
        let (key, generation) = (target.key.clone(), target.generation);
        let committed = commit_namespace_rename(&old_dir, &new_dir, &root)
            .await
            .unwrap();

        let build_lock = state.build_lock(&key).await;
        let old_guard = build_lock.lock().await;
        let (token, snapshot, stats) = staged_build(&state, &ctx, &key, &root).await;
        assert_eq!(token.generation, generation);

        // Files moved and scanned; before publish the context is removed and
        // re-added.
        let old_incarnation = incarnation_of(&ctx, "ctx-namespace").await;
        ctx.remove("ctx-namespace").await.unwrap();
        state.forget(&key, old_incarnation).await;
        ctx.add(info("ctx-namespace", &root, ContextType::Folder))
            .await
            .unwrap();
        ctx.set_active("ctx-namespace").await.unwrap();
        // (The re-added registration is refreshed with the same root spelling
        // the frontend has always used; a relative wikilink such as
        // `[[./ns2/c]]` resolves against that spelling.)
        let new_root = root.clone();
        let new_target = prepare_index_build(&state, &ctx, &new_root).await.unwrap();
        let (new_key, new_generation) = (new_target.key.clone(), new_target.generation);
        let new_request = state.version(&new_key).await;
        assert_ne!(generation, new_generation);

        let rejected = publish_built_index(&state, &key, token, snapshot, stats).await;
        assert!(matches!(&rejected, Err(IndexBuildError::Invalidated)));
        // The rename still reports what it did.
        let result = committed_namespace_result(committed, rejected).unwrap();
        assert_eq!(result.files_moved, 1);
        assert_eq!(result.updated_files, vec![format!("{root}/a.md")]);
        assert!(!dir.path().join("ns").exists());
        assert!(dir.path().join("ns2/c.md").exists());
        assert_eq!(
            std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
            "see [[./ns2/c]]"
        );
        assert!(state.with_index(&key, |idx| idx.is_none()).await);
        assert!(state
            .published_since(&new_key, &new_request)
            .await
            .is_none());

        // The new registration builds for itself, in its own spelling.
        drop(old_guard);
        rebuild_and_publish(&state, &new_target, &new_root, false)
            .await
            .unwrap();
        assert_eq!(state.build_root(&new_key).await, Some(new_root));
        assert_eq!(state.epoch(&new_key).await, 1);
        // (Relative wikilinks like `[[./ns2/c]]` are keyed by their relative
        // target in the index, not by the target's stem, so the graph — not
        // get_backlinks — is where the new build shows.)
        let graph = get_link_index_inner(&state, &ctx, Some(root.clone()))
            .await
            .unwrap();
        assert!(graph.nodes.contains(&format!("{root}/a.md")));
        assert!(!graph.nodes.iter().any(|n| n.contains("/ns/")));
    }

    #[tokio::test]
    async fn a_committed_namespace_rename_survives_a_forget_before_its_rebuild_starts() {
        let ctx = ContextManager::new();
        let (dir, root, old_dir, new_dir) = namespace_fixture(&ctx).await;
        let state = LinkIndexState::new();
        let target = prepare_index_build(&state, &ctx, &root).await.unwrap();
        let key = target.key.clone();
        let committed = commit_namespace_rename(&old_dir, &new_dir, &root)
            .await
            .unwrap();
        let old_incarnation = incarnation_of(&ctx, "ctx-namespace").await;
        ctx.remove("ctx-namespace").await.unwrap();
        state.forget(&key, old_incarnation).await;
        let rebuilt = rebuild_and_publish(&state, &target, &root, false).await;
        assert!(matches!(&rebuilt, Err(IndexBuildError::Invalidated)));
        let result = committed_namespace_result(committed, rebuilt).unwrap();
        assert_eq!(result.files_moved, 1);
        assert!(!dir.path().join("ns").exists());
        assert!(dir.path().join("ns2/c.md").exists());
        assert!(state.with_index(&key, |idx| idx.is_none()).await);
    }

    #[tokio::test]
    async fn a_committed_namespace_rename_does_not_hide_a_real_rebuild_failure() {
        let ctx = ContextManager::new();
        let (_dir, root, old_dir, new_dir) = namespace_fixture(&ctx).await;
        let state = LinkIndexState::new();
        let target = prepare_index_build(&state, &ctx, &root).await.unwrap();
        let key = target.key.clone();
        let committed = commit_namespace_rename(&old_dir, &new_dir, &root)
            .await
            .unwrap();
        // A build left pending (models a failure that is not a removal).
        let (token, _snapshot, _stats) = staged_build(&state, &ctx, &key, &root).await;
        let rebuilt = rebuild_and_publish(&state, &target, &root, false).await;
        assert!(matches!(&rebuilt, Err(IndexBuildError::Failed(_))));
        assert_eq!(
            committed_namespace_result(committed, rebuilt).unwrap_err(),
            INDEX_BUILD_PENDING
        );
        state.abort_build(&key, token).await;
    }

    #[tokio::test]
    async fn a_namespace_rebuild_never_coalesces_onto_a_snapshot_scanned_before_the_move() {
        use std::future::Future;

        let ctx = ContextManager::new();
        let (dir, root, old_dir, new_dir) = namespace_fixture(&ctx).await;
        let state = LinkIndexState::new();
        refresh_index_inner(&state, &ctx, &root).await.unwrap();

        // A background refresh has scanned the OLD layout and holds the build
        // lock, about to publish.
        let build_lock = state.build_lock(&root).await;
        let guard = build_lock.lock().await;
        let (token, stale, stale_stats) = staged_build(&state, &ctx, &root, &root).await;

        // The rename commits its file moves and starts its rebuild, which
        // reads its version and parks on the build lock.
        let target = prepare_index_build(&state, &ctx, &root).await.unwrap();

        commit_namespace_rename(&old_dir, &new_dir, &root)
            .await
            .unwrap();
        let mut rebuild = Box::pin(rebuild_and_publish(&state, &target, &root, false));
        {
            let mut task = std::task::Context::from_waker(futures::task::noop_waker_ref());
            assert!(rebuild.as_mut().poll(&mut task).is_pending());
        }

        // The stale refresh publishes — newer than the rename's request, but
        // describing the old layout.
        assert!(
            publish_built_index(&state, &root, token, stale, stale_stats)
                .await
                .is_ok()
        );
        drop(guard);

        // The rename does not take that publication for its own: it scans.
        rebuild.await.unwrap();
        let graph = get_link_index_inner(&state, &ctx, Some(root.clone()))
            .await
            .unwrap();
        assert!(graph.nodes.iter().any(|n| n.contains("/ns2/")));
        assert!(!graph.nodes.iter().any(|n| n.contains("/ns/")));
        assert!(!dir.path().join("ns").exists());
    }

    #[test]
    fn outgoing_map_groups_edges_by_source() {
        let graph = LinkGraph {
            nodes: vec![],
            edges: vec![
                crate::index::LinkEdge {
                    from: "/v/a.md".into(),
                    to: "/v/b.md".into(),
                    cross_vault: false,
                },
                crate::index::LinkEdge {
                    from: "/v/a.md".into(),
                    to: "/v/c.md".into(),
                    cross_vault: false,
                },
            ],
        };
        let out = outgoing_map(&graph);
        assert_eq!(out["/v/a.md"], vec!["/v/b.md", "/v/c.md"]);
    }

    #[test]
    fn spelled_under_compares_components_not_string_prefixes() {
        assert!(spelled_under("/x/Vault", "/x/Vault/a.md"));
        assert!(spelled_under("/x/Vault/", "/x/Vault/a.md"));
        // The root itself counts — the one row a string prefix built with a
        // trailing `/` gets wrong on every platform, so it pins that this is a
        // component comparison even where the Windows row cannot run.
        assert!(spelled_under("/x/Vault", "/x/Vault"));
        assert!(spelled_under("/x/Vault", "/x/Vault/sub/deep/a.md"));
        assert!(!spelled_under("/x/Vault", "/x/Vault-secret/a.md"));
        assert!(!spelled_under("/x/Vault", "/x/vault/a.md"));
        #[cfg(windows)]
        assert!(spelled_under(r"C:\vault", r"C:\vault\a.md"));
    }

    #[tokio::test]
    async fn a_standalone_file_context_renames_with_no_cross_file_updates() {
        // §89: a file opened on its own, outside every folder. Its key is the
        // file path, which no build can fill — and there is no other file whose
        // references could need updating. The renames go through, the
        // backlinks are empty; none of it is an error.
        let dir = tempfile::tempdir().unwrap();
        let note = format!("{}/note.md", dir.path().to_str().unwrap());
        std::fs::write(&note, "block ^b1").unwrap();
        let ctx = ContextManager::new();
        ctx.add(info("ctx-file", &note, ContextType::File))
            .await
            .unwrap();
        let state = LinkIndexState::new();
        assert!(get_backlinks_inner(&state, &ctx, &note)
            .await
            .unwrap()
            .is_empty());
        let result = rename_block_id_inner(&state, &ctx, &note, "b1", "b2")
            .await
            .unwrap();
        assert!(result.updated_files.is_empty());
        let renamed = format!("{}/renamed.md", dir.path().to_str().unwrap());
        let result = rename_file_with_links_inner(&state, &ctx, &note, &renamed)
            .await
            .unwrap();
        assert!(result.updated_files.is_empty());
        assert!(!std::path::Path::new(&note).exists());
        assert!(std::path::Path::new(&renamed).exists());
        // No index was built for a file key.
        assert!(state.with_index(&note, |idx| idx.is_none()).await);
    }

    #[tokio::test]
    async fn a_hidden_nested_root_is_indexed_by_the_gate_not_covered_by_the_enclosing_index() {
        // `collect_md_files` skips dot-directories below a root but not the
        // root itself: `/vault` never scans `/vault/.journal`, while a context
        // registered AT `.journal` scans all of it. So the enclosing index is
        // not a superset of the nested one — requiring only the outermost
        // index would let this rename rewrite nothing. The gate builds the
        // nested index instead.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap().to_string();
        std::fs::write(dir.path().join("note.md"), "plain").unwrap();
        std::fs::create_dir(dir.path().join(".journal")).unwrap();
        std::fs::write(dir.path().join(".journal/2026-09-07.md"), "entry").unwrap();
        std::fs::write(dir.path().join(".journal/index.md"), "see [[2026-09-07]]").unwrap();
        let journal = format!("{root}/.journal");
        let ctx = ContextManager::new();
        ctx.add(info("ctx-vault", &root, ContextType::Folder))
            .await
            .unwrap();
        ctx.set_active("ctx-vault").await.unwrap();
        ctx.add(info("ctx-journal", &journal, ContextType::Folder))
            .await
            .unwrap();
        let state = LinkIndexState::new();
        refresh_index_inner(&state, &ctx, &root).await.unwrap();
        assert!(!outgoing_links(&state, &root)
            .await
            .keys()
            .any(|k| k.contains("/.journal/")));
        assert!(state.with_index(&journal, |idx| idx.is_none()).await);

        let result = rename_file_with_links_inner(
            &state,
            &ctx,
            &format!("{journal}/2026-09-07.md"),
            &format!("{journal}/2026-09-08.md"),
        )
        .await
        .unwrap();
        assert_eq!(result.updated_files, vec![format!("{journal}/index.md")]);
        assert_eq!(
            std::fs::read_to_string(dir.path().join(".journal/index.md")).unwrap(),
            "see [[2026-09-08]]"
        );
        assert_eq!(state.build_root(&journal).await, Some(journal.clone()));
    }

    #[tokio::test]
    async fn an_unrelated_removal_during_the_lookup_does_not_refuse_the_refresh() {
        use std::future::Future;
        // The pin of the narrowed refusal: a removal of ANOTHER context that
        // lands between resolving this root and reading its generation is none
        // of this refresh's business. (It used to refuse — and no caller asked
        // again, so that vault stayed unindexed for the session.)
        let ctx = ContextManager::new();
        let (_a, root_a) = vault_with_a_link(&ctx, "ctx-a", true).await;
        let (_b, root_b) = vault_with_a_link(&ctx, "ctx-b", false).await;
        let state = LinkIndexState::new();
        let incarnation_b = incarnation_of(&ctx, "ctx-b").await;
        let mut removal = Box::pin(state.forget(&root_b, incarnation_b));
        let mut refresh = Box::pin(refresh_index_inner(&state, &ctx, &root_a));
        // Same harness as `forget_before_version_…`: both park on the slots
        // lock, the removal first (FIFO), the refresh having resolved its key.
        let map = state.slots.lock().await;
        {
            let mut task = std::task::Context::from_waker(futures::task::noop_waker_ref());
            assert!(removal.as_mut().poll(&mut task).is_pending());
            assert!(refresh.as_mut().poll(&mut task).is_pending());
        }
        drop(map);
        ctx.remove("ctx-b").await.unwrap();
        removal.await;
        refresh.await.unwrap();
        assert_eq!(state.epoch(&root_a).await, 1);
        assert!(!outgoing_links(&state, &root_a).await.is_empty());
        assert!(state.with_index(&root_b, |idx| idx.is_none()).await);
    }

    #[tokio::test]
    async fn a_build_root_that_is_not_a_registration_never_rebuilds_its_parent() {
        // With the owning context gone mid-lookup, "the deepest context
        // containing the root" is the parent; building the parent's key from
        // the subtree would replace its index with a partial one. A root must
        // be a registration itself.
        let ctx = ContextManager::new();
        let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub/inner.md"), "inner").unwrap();
        let state = LinkIndexState::new();
        refresh_index_inner(&state, &ctx, &root).await.unwrap();
        let before = outgoing_links(&state, &root).await;
        let err = refresh_index_inner(&state, &ctx, &format!("{root}/sub"))
            .await
            .unwrap_err();
        assert!(err.contains("not a registered context root"), "{err}");
        assert_eq!(outgoing_links(&state, &root).await, before);
        assert_eq!(state.build_root(&root).await, Some(root.clone()));
        assert_eq!(state.epoch(&root).await, 1);
    }

    #[tokio::test]
    async fn a_stale_forget_does_not_wipe_the_index_of_a_newer_registration() {
        // `remove_context` removes from the ContextManager, then forgets the
        // slot after an await. If the same path is re-registered and rebuilt
        // inside that gap, the late `forget` carries the OLD incarnation and
        // must leave the new registration's index alone.
        let ctx = ContextManager::new();
        let (_dir, root) = vault_with_a_link(&ctx, "ctx-old", true).await;
        let state = LinkIndexState::new();
        refresh_index_inner(&state, &ctx, &root).await.unwrap();
        let old_incarnation = incarnation_of(&ctx, "ctx-old").await;
        ctx.remove("ctx-old").await.unwrap();
        // …the forget has not run yet; the path is registered and built again.
        ctx.add(info("ctx-new", &root, ContextType::Folder))
            .await
            .unwrap();
        ctx.set_active("ctx-new").await.unwrap();
        refresh_index_inner(&state, &ctx, &root).await.unwrap();
        assert_eq!(state.epoch(&root).await, 2);
        // The late forget of the old registration: ignored.
        state.forget(&root, old_incarnation).await;
        assert!(state.with_index(&root, |idx| idx.is_some()).await);
        assert_eq!(state.version(&root).await.generation, 0);
        // The new registration's own removal still tombstones.
        state
            .forget(&root, incarnation_of(&ctx, "ctx-new").await)
            .await;
        assert!(state.with_index(&root, |idx| idx.is_none()).await);
        assert_eq!(state.version(&root).await.generation, 1);
    }
}
