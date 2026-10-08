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
    /// The incarnation the live index was published for (0: none). An index
    /// counts for a registration only if this matches its incarnation: after a
    /// remove/re-add of the same path, the old index is not evidence about the
    /// new registration's directory (`with_index_for`).
    published_incarnation: u64,
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
    /// §278 A non-markdown file appeared: a link target only (issue 790).
    Target { path: PathBuf },
    /// #824 A note that exists but cannot be read: registered, without content — what
    /// a fresh build makes of it (`LinkIndex::mark_unreadable`).
    Unreadable { path: PathBuf },
}

impl Mutation {
    /// Canonicalises `path` — outside any lock (it touches the filesystem).
    pub(super) fn update(path: &str, content: String) -> Result<Self, String> {
        Ok(Self::Update {
            path: crate::context::manager::resolve_canonical(path)?,
            content,
        })
    }

    /// A file that is gone (or unreadable) under `path` — canonicalised outside
    /// any lock, on the existing ancestor when the file itself is gone.
    pub(super) fn remove(path: &str) -> Result<Self, String> {
        Ok(Self::Remove {
            path: crate::context::manager::resolve_canonical(path)?,
        })
    }

    /// A non-markdown file under `path` — canonicalised outside any lock.
    pub(super) fn target(path: &str) -> Result<Self, String> {
        Ok(Self::Target {
            path: crate::context::manager::resolve_canonical(path)?,
        })
    }

    /// A note under `path` that cannot be read — canonicalised outside any lock.
    pub(super) fn unreadable(path: &str) -> Result<Self, String> {
        Ok(Self::Unreadable {
            path: crate::context::manager::resolve_canonical(path)?,
        })
    }

    fn apply_to(&self, index: &mut LinkIndex, root: &IndexRoot) {
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

/// What `apply_for` did with a mutation (#824).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ApplyOutcome {
    /// It reached the index published for that registration, or the journal of the
    /// build reading for it.
    Applied,
    /// Nothing is published or building for that registration yet: its first build
    /// reads the file as it is after this.
    NoIndex,
    /// The slot belongs to a newer registration of the same path; the caller resolves
    /// the covering registrations again.
    Stale,
}

/// A test-only pause inside a reconcile unit: `reached` fires when the unit for
/// `path` has read the file, then the unit waits for `release`.
#[cfg(test)]
pub(super) struct PauseAfterRead {
    pub(super) path: PathBuf,
    pub(super) reached: Arc<tokio::sync::Notify>,
    pub(super) release: Arc<tokio::sync::Notify>,
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
    pub(super) removals: AtomicU64,
    /// #824 One reconcile unit at a time per canonical path (`apply_guard`). A
    /// `std` lock held only to find or create the entry; entries whose last holder is
    /// gone are dropped on the next lookup.
    apply_guards: std::sync::Mutex<HashMap<PathBuf, std::sync::Weak<Mutex<()>>>>,
    #[cfg(test)]
    pub(super) pause_after_read: std::sync::Mutex<Option<PauseAfterRead>>,
    /// Publications so far (tests): how many builds a reconciliation ran.
    #[cfg(test)]
    pub(crate) published: std::sync::atomic::AtomicUsize,
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
            apply_guards: std::sync::Mutex::new(HashMap::new()),
            #[cfg(test)]
            pause_after_read: std::sync::Mutex::new(None),
            #[cfg(test)]
            published: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    /// #824 The guard a reconcile unit holds for `canonical` from its stat to its last
    /// apply (`reconcile::reconcile_path`): units on one path run one at a time, so
    /// the last to run reads the disk after every commit before it.
    pub(super) async fn apply_guard(&self, canonical: &Path) -> tokio::sync::OwnedMutexGuard<()> {
        let lock = {
            let mut map = self
                .apply_guards
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            map.retain(|_, held| held.strong_count() > 0);
            match map.get(canonical).and_then(std::sync::Weak::upgrade) {
                Some(lock) => lock,
                None => {
                    let lock = Arc::new(Mutex::new(()));
                    map.insert(canonical.to_path_buf(), Arc::downgrade(&lock));
                    lock
                }
            }
        };
        lock.lock_owned().await
    }

    /// How many apply guards are alive (tests).
    #[cfg(test)]
    pub(super) fn apply_guards_alive(&self) -> usize {
        let mut map = self.apply_guards.lock().unwrap();
        map.retain(|_, held| held.strong_count() > 0);
        map.len()
    }

    /// Hold the map lock (tests only): to park other tasks behind it and pin
    /// an ordering. Production code never gets a guard out of this type.
    #[cfg(test)]
    pub(super) async fn hold_slots(&self) -> tokio::sync::MutexGuard<'_, HashMap<String, Slot>> {
        self.slots.lock().await
    }

    /// Read whatever index is live under `key` while holding the lock — the
    /// tests' view; production reads go through `with_index_for`. `f` is
    /// synchronous, so nothing can await inside the critical section.
    #[cfg(test)]
    pub(super) async fn with_index<R>(
        &self,
        key: &str,
        f: impl FnOnce(Option<&LinkIndex>) -> R,
    ) -> R {
        let map = self.slots.lock().await;
        f(map.get(key).and_then(|s| s.index.as_ref()))
    }

    /// Read the index under `key` only if it was published for `incarnation`
    /// — the gate's and the renames' view. `None` for a missing index and for
    /// one an earlier registration of the same path published.
    pub(super) async fn with_index_for<R>(
        &self,
        key: &str,
        incarnation: u64,
        f: impl FnOnce(Option<&LinkIndex>) -> R,
    ) -> R {
        let map = self.slots.lock().await;
        f(map
            .get(key)
            .filter(|s| s.published_incarnation == incarnation)
            .and_then(|s| s.index.as_ref()))
    }

    /// Whether the index published for `incarnation` under `key` holds a note
    /// or a link target strictly below `canonical_dir` — what a vanished path
    /// that was a directory leaves behind (issue 790). `false` with no index.
    pub(super) async fn holds_under(
        &self,
        key: &str,
        incarnation: u64,
        canonical_dir: &Path,
    ) -> bool {
        let map = self.slots.lock().await;
        let Some(slot) = map
            .get(key)
            .filter(|s| s.published_incarnation == incarnation)
        else {
            return false;
        };
        let (Some(index), Some(root)) = (slot.index.as_ref(), slot.root.as_ref()) else {
            return false;
        };
        root.spell(canonical_dir)
            .is_some_and(|dir| index.holds_under(&dir))
    }

    /// #824 Apply `mutations` for registration `incarnation` of `key`. Every outcome
    /// bumps the epoch, as `apply` does, so a refresh cannot coalesce onto a
    /// publication older than this write (`published_since`).
    pub(super) async fn apply_for(
        &self,
        key: &str,
        incarnation: u64,
        mutations: Vec<Mutation>,
    ) -> ApplyOutcome {
        let mut map = self.slots.lock().await;
        let slot = map.entry(key.to_string()).or_default();
        slot.epoch += 1;
        let pending_incarnation = slot.pending.as_ref().map(|p| p.token.incarnation);
        let newer = slot
            .incarnation
            .max(slot.published_incarnation)
            .max(pending_incarnation.unwrap_or(0));
        if newer > incarnation {
            return ApplyOutcome::Stale;
        }
        let live = slot.published_incarnation == incarnation;
        let journaled = pending_incarnation == Some(incarnation);
        if !live && !journaled {
            return ApplyOutcome::NoIndex;
        }
        let (index, live_root, pending) = (&mut slot.index, &slot.root, &mut slot.pending);
        if live {
            if let (Some(index), Some(live_root)) = (index.as_mut(), live_root.as_ref()) {
                for mutation in &mutations {
                    mutation.apply_to(index, live_root);
                }
            }
        }
        if let Some(pending) = pending.as_mut().filter(|_| journaled) {
            pending.journal.extend(mutations);
        }
        ApplyOutcome::Applied
    }

    /// #824 Whether the index published for `incarnation` under `key` holds
    /// `canonical_path` itself, as a note or a link target. `false` with no index.
    pub(super) async fn holds_path(
        &self,
        key: &str,
        incarnation: u64,
        canonical_path: &Path,
    ) -> bool {
        let map = self.slots.lock().await;
        let Some(slot) = map
            .get(key)
            .filter(|s| s.published_incarnation == incarnation)
        else {
            return false;
        };
        let (Some(index), Some(root)) = (slot.index.as_ref(), slot.root.as_ref()) else {
            return false;
        };
        root.spell(canonical_path)
            .is_some_and(|path| index.holds_path(&path))
    }

    /// The live index's spelling of `canonical_path` under `key`, if it has one.
    pub(super) async fn spelling_of(&self, key: &str, canonical_path: &Path) -> Option<String> {
        let map = self.slots.lock().await;
        map.get(key)
            .and_then(|s| s.root.as_ref())
            .and_then(|root| root.spell(canonical_path))
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
    #[cfg(test)]
    pub(super) async fn begin_build(
        &self,
        key: &str,
        requested: &RegistrationVersion,
        root: &str,
        incarnation: u64,
    ) -> Result<BuildToken, IndexBuildError> {
        self.begin(key, requested, root, incarnation, false).await
    }

    /// `begin_build` for the caller that holds the key's build lock
    /// (`rebuild_and_publish`). A lease already pending then has no owner: every
    /// lease that caller makes is ended by its `publish` or `abort_build` while it
    /// still holds the lock, so one left over was made by a build whose future was
    /// dropped in between — a refresh cancelled mid-walk. It is replaced rather
    /// than refusing every later refresh with `INDEX_BUILD_PENDING`; its journal
    /// goes with it, since the new build reads the files afresh.
    pub(super) async fn begin_build_holding_lock(
        &self,
        key: &str,
        requested: &RegistrationVersion,
        root: &str,
        incarnation: u64,
        _held: &tokio::sync::MutexGuard<'_, ()>,
    ) -> Result<BuildToken, IndexBuildError> {
        self.begin(key, requested, root, incarnation, true).await
    }

    async fn begin(
        &self,
        key: &str,
        requested: &RegistrationVersion,
        root: &str,
        incarnation: u64,
        replace_abandoned: bool,
    ) -> Result<BuildToken, IndexBuildError> {
        // Canonicalisation touches the filesystem: before the lock.
        let root = IndexRoot::new(root).map_err(IndexBuildError::Failed)?;
        let mut map = self.slots.lock().await;
        let slot = map.entry(key.to_string()).or_default();
        if slot.generation != requested.generation {
            return Err(IndexBuildError::Invalidated);
        }
        if slot.pending.is_some() && !replace_abandoned {
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

    /// Whether a build lease is pending under `key` (tests).
    #[cfg(test)]
    pub(super) async fn has_pending(&self, key: &str) -> bool {
        self.slots
            .lock()
            .await
            .get(key)
            .is_some_and(|s| s.pending.is_some())
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
        // A build for an older registration than the slot's newest is stale
        // even when the generation still matches (the removal's `forget` has
        // not run yet): it must not become the newer registration's index.
        if slot.generation != token.generation
            || slot.incarnation > token.incarnation
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
        slot.published_incarnation = token.incarnation;
        slot.index = Some(index);
        slot.stats = Some(stats);
        slot.root = Some(pending.root);
        #[cfg(test)]
        self.published.fetch_add(1, Ordering::SeqCst);
        Some(replayed)
    }

    /// Drop the live index under `key` without touching its registration: a
    /// namespace rename moved the files but could not rebuild, so what is
    /// published describes the old layout — better no index (the gate rebuilds
    /// on the next rename) than a trusted stale one.
    pub(super) async fn drop_index(&self, key: &str) {
        let mut map = self.slots.lock().await;
        if let Some(slot) = map.get_mut(key) {
            slot.index = None;
            slot.stats = None;
            slot.root = None;
            slot.published_incarnation = 0;
            // A build that is reading right now read the layout this drop
            // invalidates; cancelling its token means `publish` rejects it
            // (the move it did not see is not a journaled mutation).
            slot.pending = None;
            slot.epoch += 1;
        }
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
        incarnation: u64,
    ) -> Option<IndexStats> {
        let map = self.slots.lock().await;
        map.get(key)
            .filter(|s| {
                s.generation == requested.generation
                    && s.published_at > requested.epoch
                    && s.published_incarnation == incarnation
            })
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
