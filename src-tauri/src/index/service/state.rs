use crate::index::{IndexStats, LinkIndex};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;

use super::build::{IndexBuildError, INDEX_BUILD_PENDING};

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
pub(super) struct RegistrationVersion {
    pub(super) generation: u64,
    pub(super) epoch: u64,
    /// The removal sequence that last tombstoned the slot (0: never).
    pub(super) removed_at: u64,
}

/// The right to publish one build into one registration generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct BuildToken {
    pub(super) generation: u64,
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
pub(super) struct Slot {
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
pub(super) enum Mutation {
    /// A file was re-read (saved, or rewritten by a rename).
    Update { path: PathBuf, content: String },
    /// A file is gone under this path (renamed away).
    Remove { path: PathBuf },
}

impl Mutation {
    /// Canonicalises `path` — outside any lock (it touches the filesystem).
    pub(super) fn update(path: &str, content: String) -> Result<Self, String> {
        Ok(Self::Update {
            path: crate::context::manager::resolve_canonical(path)?,
            content,
        })
    }

    pub(super) fn remove(path: &str) -> Result<Self, String> {
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
    pub(super) slots: Mutex<HashMap<String, Slot>>,
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
    pub(super) removals: AtomicU64,
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
    pub(super) async fn with_index<R>(
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
    pub(super) async fn apply(&self, key: &str, mutations: Vec<Mutation>) {
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
    pub(super) async fn epoch(&self, key: &str) -> u64 {
        self.slots.lock().await.get(key).map_or(0, |s| s.epoch)
    }

    /// What a refresh must capture before it waits for the build lock. Reads
    /// only — a slot is first created by `begin_build` or `apply`, so a read
    /// cannot turn a never-seen key into a registration.
    pub(super) async fn version(&self, key: &str) -> RegistrationVersion {
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
    pub(super) async fn begin_build(
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
    pub(super) async fn abort_build(&self, key: &str, token: BuildToken) {
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
    pub(super) async fn publish(
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
    pub(super) async fn build_root(&self, key: &str) -> Option<String> {
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
    pub(super) async fn published_since(
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
    pub(super) async fn build_lock(&self, key: &str) -> Arc<Mutex<()>> {
        self.builds
            .lock()
            .await
            .entry(key.to_string())
            .or_default()
            .clone()
    }
}
