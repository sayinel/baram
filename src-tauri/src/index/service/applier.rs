//! §29 #824 The watcher applier: what the routers report, brought into the link index in
//! Rust, with one `index:changed` per batch.
//!
//! A router (`fs::start_watching`, one std thread per watched host) marks every path it
//! routes BEFORE it emits that event's `file:*` events, which keep their count and order.
//! Marking takes `ExternalChanges`' std mutex for a map insert and a `Notify` — never an
//! index lock, the watch registry, a tokio lock or the filesystem — so a router never
//! waits on the index.
//!
//! An entry is keyed by the canonical identity the router derived without the
//! filesystem (the registered spelling map, else the host's spelled root mapped onto its
//! canonical key). It keeps every spelling and host it was reported through, and the
//! stamp (`state::tick`) of its newest mark. The applier never resolves it again: an alias
//! retargeted since the event cannot move it to another vault.
//!
//! At most `CAP` paths wait. A path past it marks its host for a rescan instead, and so does
//! the OS saying it dropped events (`Event::need_rescan`) or a host restarting after it
//! ended (`watch_cmd`): a rescan rebuilds every registration containing the host or under
//! it, and while one waits, no path under that host is added.
//!
//! #852 A host that starts watching recursively for the first time, or widens to it, marks
//! a CONDITIONAL rescan with the stamp of that start: an index that read before it may hold
//! a change no watcher reported. At the take it rebuilds only the registrations holding a
//! read — published, or a build still reading — that began before the newest such start,
//! unless the registration's own root has been watched recursively since before that read.
//! An unconditional rescan of the host dominates it. A conditional one may come to nothing,
//! so paths under it are still added and applied.
//!
//! The applier takes a batch after `SETTLE` without a new mark, or `MAX_LATENCY` after the
//! first mark of a burst, whichever comes first. Each rescan is a tree effect, and each
//! path a unit at its identity (`reconcile::reconcile_identity_in`), all in one `Batch`,
//! then `commit::report` — one `index:changed`, and a drop with a scheduled rebuild for
//! what could not be judged. The rebuilds the units ask for (rescans, structural changes,
//! a changed `.baramignore`) are not run here but handed to the scheduler, which
//! announces each once it publishes: a walk under a stalled volume holds up its own root
//! family, not every vault's next batch. A path every covering registration has already rebuilt
//! past (a publication whose build began after the path's newest mark,
//! `LinkIndexState::covered_since`) is skipped: that build read it.
//!
//! What it converges to: for each path, the disk as the final unit for it observed it.
//! Every write is followed by an event whose unit reads after it, so the final unit sees
//! the final state; a state no event follows is not promised. What it cannot see: a
//! change no router reported — a vault no window watches, a host between its end and its
//! restart without a restart, a path the host's filter drops but an unwatched nested
//! registration would hold (824-c owns the watches).

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::{Manager, Runtime};
use tokio::time::Instant;

use super::commit::report;
use super::keys::buildable;
use super::reconcile::{
    reconcile_identity_in, reconcile_registrations, tree_registrations, Batch, RegistrationAt,
};
use super::state::{tick, LinkIndexState};
use crate::context::ContextManager;

/// The most paths waiting at once; past it, their host is rescanned.
pub(crate) const CAP: usize = 20_000;
/// The quiet that ends a burst.
pub(crate) const SETTLE: Duration = Duration::from_millis(300);
/// The longest a mark waits under a stream of marks.
pub(crate) const MAX_LATENCY: Duration = Duration::from_secs(2);

/// One path waiting to be applied.
#[derive(Debug, Default)]
struct Entry {
    spellings: BTreeSet<String>,
    hosts: BTreeSet<PathBuf>,
    stamp: u64,
}

/// What a waiting rescan of a host asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Rescan {
    /// Everything under the host may have changed unseen: rebuild every registration.
    Unconditional,
    /// #852 The host started watching recursively at `newest_start` (the latest of the
    /// starts it stands for): rebuild what read before it.
    Conditional { newest_start: u64 },
}

#[derive(Default)]
struct Dirty {
    paths: HashMap<PathBuf, Entry>,
    /// Host canonical → the rescan it waits for.
    rescans: HashMap<PathBuf, Rescan>,
    first_mark: Option<Instant>,
    last_mark: Option<Instant>,
}

/// Managed state: what the routers marked and the applier has not taken yet.
#[derive(Default)]
pub struct ExternalChanges {
    dirty: std::sync::Mutex<Dirty>,
    wake: tokio::sync::Notify,
    /// Hosts whose watcher ended: the next start of one is a rescan (`watch_cmd`).
    ended: std::sync::Mutex<HashSet<PathBuf>>,
    /// #852 Hosts watched recursively now, and the stamp since which they have been: a
    /// registration whose root has been watched since before its index read misses nothing.
    watching_since: std::sync::Mutex<HashMap<PathBuf, u64>>,
    /// Batches taken, units run, entries skipped as covered (tests).
    #[cfg(test)]
    pub(crate) counts: std::sync::Mutex<Counts>,
    /// The next batch panics right after its take (tests).
    #[cfg(test)]
    pub(crate) panic_next: std::sync::atomic::AtomicBool,
}

#[cfg(test)]
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Counts {
    pub(crate) takes: usize,
    pub(crate) units: usize,
    pub(crate) covered: usize,
    pub(crate) rescans: usize,
    /// #852 Conditional rescans that found nothing read before their start.
    pub(crate) rescans_skipped: usize,
}

impl ExternalChanges {
    pub fn new() -> Self {
        Self::default()
    }

    fn dirty(&self) -> std::sync::MutexGuard<'_, Dirty> {
        self.dirty
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// What one router routed for one event: `(identity, spelling)` per emitted path,
    /// from the watcher on `host` (canonical).
    pub(crate) fn mark(&self, host: &Path, routed: &[(PathBuf, String)]) {
        if routed.is_empty() {
            return;
        }
        let now = Instant::now();
        let mut dirty = self.dirty();
        for (identity, spelling) in routed {
            // A rescan of this host is waiting: it reads this path. A conditional one may
            // read nothing, so it does not stand in for the path.
            if dirty.rescans.get(host) == Some(&Rescan::Unconditional) && identity.starts_with(host)
            {
                continue;
            }
            let stamp = tick();
            let full = dirty.paths.len() >= CAP;
            match dirty.paths.get_mut(identity) {
                Some(entry) => {
                    entry.spellings.insert(spelling.clone());
                    entry.hosts.insert(host.to_path_buf());
                    entry.stamp = entry.stamp.max(stamp);
                }
                None if full => {
                    dirty
                        .rescans
                        .insert(host.to_path_buf(), Rescan::Unconditional);
                }
                None => {
                    dirty.paths.insert(
                        identity.clone(),
                        Entry {
                            spellings: BTreeSet::from([spelling.clone()]),
                            hosts: BTreeSet::from([host.to_path_buf()]),
                            stamp,
                        },
                    );
                }
            }
        }
        dirty.last_mark = Some(now);
        dirty.first_mark.get_or_insert(now);
        drop(dirty);
        self.wake.notify_one();
    }

    /// Everything under `host` (canonical) may have changed unseen. Replaces a
    /// conditional rescan of it.
    pub(crate) fn mark_rescan(&self, host: &Path) {
        self.mark_host(host, |_| Rescan::Unconditional);
    }

    /// #852 `host` started watching recursively at `start`: what read before it is
    /// rescanned. Stands with an unconditional rescan of it, and keeps the newest start
    /// of earlier conditional ones — a build that published between two starts read
    /// before the second.
    fn mark_started(&self, host: &Path, start: u64) {
        self.mark_host(host, |waiting| match waiting {
            Some(Rescan::Unconditional) => Rescan::Unconditional,
            Some(Rescan::Conditional { newest_start }) => Rescan::Conditional {
                newest_start: newest_start.max(start),
            },
            None => Rescan::Conditional {
                newest_start: start,
            },
        });
    }

    fn mark_host(&self, host: &Path, rescan: impl FnOnce(Option<Rescan>) -> Rescan) {
        let now = Instant::now();
        let mut dirty = self.dirty();
        let next = rescan(dirty.rescans.get(host).copied());
        dirty.rescans.insert(host.to_path_buf(), next);
        dirty.last_mark = Some(now);
        dirty.first_mark.get_or_insert(now);
        drop(dirty);
        self.wake.notify_one();
    }

    /// The watcher on `host` ended; its next start rescans it.
    pub(crate) fn note_ended(&self, host: &Path) {
        self.watching().remove(host);
        self.ended
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(host.to_path_buf());
    }

    fn watching(&self) -> std::sync::MutexGuard<'_, HashMap<PathBuf, u64>> {
        self.watching_since
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// A watcher on `host` now watches, `recursive` or not: if the last one ended, what
    /// changed meanwhile was never reported, so the host is rescanned. #852 Otherwise a
    /// recursive start — a host's first, or a widening — rescans what read before it.
    /// Called after the start succeeded, so a failed start keeps the mark for the next and
    /// a rescan is never taken before the watcher reports.
    pub(crate) fn started(&self, host: &Path, recursive: bool) {
        let ended = self
            .ended
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(host);
        if !recursive {
            // A narrowing replaces the recursive watcher: the host's subtree is unwatched
            // from now on.
            self.watching().remove(host);
        }
        if ended {
            if recursive {
                self.watching().insert(host.to_path_buf(), tick());
            }
            self.mark_rescan(host);
        } else if recursive {
            let start = tick();
            self.watching().insert(host.to_path_buf(), start);
            self.mark_started(host, start);
        }
    }

    /// #852 Since when `root` (canonical) has been watched recursively, if it is.
    fn watched_since(&self, root: &Path) -> Option<u64> {
        self.watching().get(root).copied()
    }

    /// Wait until a burst is over: `SETTLE` without a mark, or `MAX_LATENCY` after its first.
    async fn burst(&self) {
        loop {
            let (first, last) = {
                let dirty = self.dirty();
                (dirty.first_mark, dirty.last_mark)
            };
            let (Some(first), Some(last)) = (first, last) else {
                self.wake.notified().await;
                continue;
            };
            let at = (last + SETTLE).min(first + MAX_LATENCY);
            if Instant::now() >= at {
                return;
            }
            tokio::select! {
                () = tokio::time::sleep_until(at) => {}
                () = self.wake.notified() => {}
            }
        }
    }

    /// Paths waiting (tests).
    #[cfg(test)]
    pub(crate) fn pending(&self) -> usize {
        self.dirty().paths.len()
    }

    /// The identities waiting, sorted (tests).
    #[cfg(test)]
    pub(crate) fn pending_identities(&self) -> Vec<PathBuf> {
        let mut identities: Vec<PathBuf> = self.dirty().paths.keys().cloned().collect();
        identities.sort();
        identities
    }

    /// Unconditional host rescans waiting (tests).
    #[cfg(test)]
    pub(crate) fn pending_rescans(&self) -> usize {
        self.dirty()
            .rescans
            .values()
            .filter(|r| **r == Rescan::Unconditional)
            .count()
    }

    /// #852 Conditional host rescans waiting, with their newest start (tests).
    #[cfg(test)]
    pub(crate) fn pending_started(&self) -> Vec<(PathBuf, u64)> {
        self.dirty()
            .rescans
            .iter()
            .filter_map(|(host, r)| match r {
                Rescan::Conditional { newest_start } => Some((host.clone(), *newest_start)),
                Rescan::Unconditional => None,
            })
            .collect()
    }

    fn take(&self) -> (HashMap<PathBuf, Entry>, HashMap<PathBuf, Rescan>) {
        let mut dirty = self.dirty();
        dirty.first_mark = None;
        dirty.last_mark = None;
        (
            std::mem::take(&mut dirty.paths),
            std::mem::take(&mut dirty.rescans),
        )
    }
}

/// The applier: one batch per burst, for as long as the app runs. Each batch runs as a
/// task of its own, so a panic in one (builds that unwind: dev and test — release aborts)
/// does not end the applier. What that batch had taken is gone with it, so every
/// directory registration is marked for a rescan, and the loop goes on.
pub(crate) async fn run<R: Runtime>(app: tauri::AppHandle<R>) {
    loop {
        app.state::<ExternalChanges>().burst().await;
        let batch = {
            let app = app.clone();
            tokio::spawn(async move { apply_batch(&app).await })
        };
        if let Err(e) = batch.await {
            log::error!("§29 #824 a watcher batch failed ({e}); rescanning every vault");
            recover(&app).await;
        }
    }
}

/// After a batch that did not finish: every directory registration is rescanned.
async fn recover<R: Runtime>(app: &tauri::AppHandle<R>) {
    let changes = app.state::<ExternalChanges>();
    for registration in app
        .state::<ContextManager>()
        .directory_registrations()
        .await
    {
        changes.mark_rescan(&registration.canonical_path);
    }
}

/// Take what is marked and bring it into the index: one `index:changed`.
pub(crate) async fn apply_batch<R: Runtime>(app: &tauri::AppHandle<R>) {
    let changes = app.state::<ExternalChanges>();
    let (paths, rescans) = changes.take();
    if paths.is_empty() && rescans.is_empty() {
        return;
    }
    #[cfg(test)]
    if changes
        .panic_next
        .swap(false, std::sync::atomic::Ordering::SeqCst)
    {
        panic!("injected panic in a watcher batch");
    }
    let state = app.state::<LinkIndexState>();
    let ctx_mgr = app.state::<ContextManager>();
    let mut batch = Batch::default();
    let mut done = Vec::new();
    #[cfg(test)]
    let mut counts = Counts {
        takes: 1,
        ..Counts::default()
    };
    for (host, rescan) in &rescans {
        let registrations = match rescan {
            Rescan::Unconditional => tree_registrations(&ctx_mgr, host).await,
            Rescan::Conditional { newest_start } => {
                read_before(&state, &changes, &ctx_mgr, host, *newest_start).await
            }
        };
        if registrations.is_empty() && matches!(rescan, Rescan::Conditional { .. }) {
            #[cfg(test)]
            {
                counts.rescans_skipped += 1;
            }
            continue;
        }
        state.poke_under(host);
        done.push(reconcile_registrations(
            &host.to_string_lossy(),
            host,
            registrations,
            &mut batch,
        ));
        #[cfg(test)]
        {
            counts.rescans += 1;
        }
    }
    let mut paths: Vec<(PathBuf, Entry)> = paths.into_iter().collect();
    paths.sort_by(|a, b| a.0.cmp(&b.0));
    for (identity, entry) in paths {
        // A rescan of a host it came through reads it: every registration covering it
        // contains that host or lies under it. Not a conditional one, which rebuilds only
        // what read before its start.
        if entry
            .hosts
            .iter()
            .any(|h| rescans.get(h) == Some(&Rescan::Unconditional))
        {
            continue;
        }
        state.poke_under(&identity);
        if covered(&state, &ctx_mgr, &identity, entry.stamp).await {
            #[cfg(test)]
            {
                counts.covered += 1;
            }
            continue;
        }
        #[cfg(test)]
        {
            counts.units += 1;
        }
        let spellings = entry.spellings.into_iter().collect();
        done.push(reconcile_identity_in(&state, &ctx_mgr, &identity, spellings, &mut batch).await);
    }
    // The rebuilds go to the scheduler: a walk under a stalled volume holds up its own
    // root family there, not this applier's next batch for every vault. A path that only
    // waits for one is announced by the scheduler once it publishes.
    for d in done.iter_mut().filter(|d| !d.wants.is_empty()) {
        d.deferred = true;
    }
    let mut asked = false;
    for (key, incarnation) in batch.into_rebuilds() {
        if let Some(registered) = ctx_mgr
            .context_registered_at(&key)
            .await
            .filter(|r| r.incarnation == incarnation)
        {
            state.request_rebuild(&key, incarnation, &registered.canonical_path);
            asked = true;
        }
    }
    if asked {
        super::scheduler::ensure_started(app);
    }
    report(app, done).await;
    #[cfg(test)]
    {
        let mut total = changes.counts.lock().unwrap();
        total.takes += counts.takes;
        total.units += counts.units;
        total.covered += counts.covered;
        total.rescans += counts.rescans;
        total.rescans_skipped += counts.rescans_skipped;
    }
}

/// #852 The registrations a rescan of `host` would rebuild that hold a read begun before
/// `start` — their published index, or a build still reading — and whose own root has not
/// been watched recursively since before that read.
async fn read_before(
    state: &LinkIndexState,
    changes: &ExternalChanges,
    ctx_mgr: &ContextManager,
    host: &Path,
    start: u64,
) -> BTreeSet<RegistrationAt> {
    let mut stale = BTreeSet::new();
    for (key, incarnation) in tree_registrations(ctx_mgr, host).await {
        let Some(began) = state.earliest_read(&key, incarnation).await else {
            continue;
        };
        if began >= start {
            continue;
        }
        let watched = ctx_mgr
            .context_registered_at(&key)
            .await
            .and_then(|r| changes.watched_since(&r.canonical_path));
        if watched.is_some_and(|since| since < began) {
            continue;
        }
        stale.insert((key, incarnation));
    }
    stale
}

/// Whether every registration covering `identity` has published, for its incarnation, a
/// build that began after `stamp`.
async fn covered(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    identity: &Path,
    stamp: u64,
) -> bool {
    let covering = buildable(&ctx_mgr.contexts_holding(identity).await);
    if covering.is_empty() {
        return false;
    }
    for registration in covering {
        match state
            .covered_since(&registration.info.path, registration.incarnation)
            .await
        {
            Some(began) if began > stamp => {}
            _ => return false,
        }
    }
    true
}

#[cfg(test)]
#[path = "applier_tests.rs"]
mod tests;
