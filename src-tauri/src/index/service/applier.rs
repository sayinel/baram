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
//! The applier takes a batch after `SETTLE` without a new mark, or `MAX_LATENCY` after the
//! first mark of a burst, whichever comes first. Each rescan is a tree effect, and each
//! path a unit at its identity (`reconcile::reconcile_identity_in`), all in one `Batch`,
//! then `commit::report` — one `index:changed`, and a drop with a scheduled rebuild for
//! what could not be judged. A path every covering registration has already rebuilt
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
use super::reconcile::{reconcile_identity_in, reconcile_tree_at, Batch};
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

#[derive(Default)]
struct Dirty {
    paths: HashMap<PathBuf, Entry>,
    /// Host canonical → the stamp it was marked at.
    rescans: HashMap<PathBuf, u64>,
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
    /// Batches taken, units run, entries skipped as covered (tests).
    #[cfg(test)]
    pub(crate) counts: std::sync::Mutex<Counts>,
}

#[cfg(test)]
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Counts {
    pub(crate) takes: usize,
    pub(crate) units: usize,
    pub(crate) covered: usize,
    pub(crate) rescans: usize,
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
            // A rescan of this host is waiting: it reads this path.
            if dirty.rescans.contains_key(host) && identity.starts_with(host) {
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
                    dirty.rescans.entry(host.to_path_buf()).or_insert(stamp);
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

    /// Everything under `host` (canonical) may have changed unseen.
    pub(crate) fn mark_rescan(&self, host: &Path) {
        let now = Instant::now();
        let mut dirty = self.dirty();
        dirty.rescans.entry(host.to_path_buf()).or_insert_with(tick);
        dirty.last_mark = Some(now);
        dirty.first_mark.get_or_insert(now);
        drop(dirty);
        self.wake.notify_one();
    }

    /// The watcher on `host` ended; its next start rescans it.
    pub(crate) fn note_ended(&self, host: &Path) {
        self.ended
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(host.to_path_buf());
    }

    /// A watcher on `host` is starting: if the last one ended, what changed meanwhile was
    /// never reported, so the host is rescanned.
    pub(crate) fn starting(&self, host: &Path) {
        let ended = self
            .ended
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(host);
        if ended {
            self.mark_rescan(host);
        }
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

    /// Host rescans waiting (tests).
    #[cfg(test)]
    pub(crate) fn pending_rescans(&self) -> usize {
        self.dirty().rescans.len()
    }

    fn take(&self) -> (HashMap<PathBuf, Entry>, HashMap<PathBuf, u64>) {
        let mut dirty = self.dirty();
        dirty.first_mark = None;
        dirty.last_mark = None;
        (
            std::mem::take(&mut dirty.paths),
            std::mem::take(&mut dirty.rescans),
        )
    }
}

/// The applier: one batch per burst, for as long as the app runs.
pub(crate) async fn run<R: Runtime>(app: tauri::AppHandle<R>) {
    loop {
        app.state::<ExternalChanges>().burst().await;
        apply_batch(&app).await;
    }
}

/// Take what is marked and bring it into the index: one `index:changed`.
pub(crate) async fn apply_batch<R: Runtime>(app: &tauri::AppHandle<R>) {
    let changes = app.state::<ExternalChanges>();
    let (paths, rescans) = changes.take();
    if paths.is_empty() && rescans.is_empty() {
        return;
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
    for host in rescans.keys() {
        state.poke_under(host);
        done.push(reconcile_tree_at(&ctx_mgr, &host.to_string_lossy(), host, &mut batch).await);
        #[cfg(test)]
        {
            counts.rescans += 1;
        }
    }
    let mut paths: Vec<(PathBuf, Entry)> = paths.into_iter().collect();
    paths.sort_by(|a, b| a.0.cmp(&b.0));
    for (identity, entry) in paths {
        // A rescan of a host it came through reads it: every registration covering it
        // contains that host or lies under it.
        if entry.hosts.iter().any(|h| rescans.contains_key(h)) {
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
    batch.finish(&state, &ctx_mgr, &mut done).await;
    report(app, done).await;
    #[cfg(test)]
    {
        let mut total = changes.counts.lock().unwrap();
        total.takes += counts.takes;
        total.units += counts.units;
        total.covered += counts.covered;
        total.rescans += counts.rescans;
    }
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
