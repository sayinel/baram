//! §29 #824 The rebuilds of dropped indexes, scheduled in one place.
//!
//! An index a write or a watcher batch could not keep is dropped (`commit::degrade`) and
//! its registration incarnation gets a job here. One task schedules the jobs: it starts
//! at most one attempt per `GLOBAL_GAP`, each as a task of its own, and runs at most
//! `MAX_RUNNING` at once, never two on intersecting roots — a run of failing vaults
//! costs a bounded number of walks, and one walk stuck on a slow volume does not stop an
//! unrelated vault from recovering.
//!
//! A job waits `BACKOFF` after each failed attempt, then `TERMINAL` for as long as it
//! keeps failing — it never gives up while its registration is that incarnation, since
//! its index stays dropped meanwhile and a dropped index is never trusted. A failure also
//! postpones the due jobs of intersecting roots (a vault and one nested in it) to the
//! same time and carries its escalation to them: their walks cross the same folders, so
//! together they take turns on one schedule instead of each running its own.
//!
//! A job is due at once — no sooner than `JOB_GAP` after its last attempt — when
//! something it depends on moves: a watcher mark at or under its root (a fixed
//! `.baramignore` included, `poke_under`), a new failure (`request_rebuild`), or a
//! publication for its incarnation by anyone else (`publish` → `poke_key`), which ends
//! it. Removing the registration (`forget`) cancels it at once, aborting an attempt that
//! is running.
//!
//! The failure generation is kept (`request_rebuild` moves it on): a job that has
//! published ends, and announces, only when no failure has landed since it started the
//! attempt (`finish_rebuild`); otherwise it goes again.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::{Emitter, Manager, Runtime};
use tokio::time::Instant;

use super::reconcile::rebuild_registration;
use super::state::LinkIndexState;
use crate::context::ContextManager;

/// The waits after the first failed attempts, in order.
const BACKOFF: [Duration; 6] = [
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(4),
    Duration::from_secs(8),
    Duration::from_secs(16),
    Duration::from_secs(30),
];
/// The wait after every later failure.
pub(crate) const TERMINAL: Duration = Duration::from_secs(600);
/// The least time between two attempts of any jobs.
pub(crate) const GLOBAL_GAP: Duration = Duration::from_secs(1);
/// The least time between two attempts of one job, however often it is poked.
pub(crate) const JOB_GAP: Duration = Duration::from_secs(2);
/// The most attempts running at once — each on a root no other running one intersects,
/// so one slow walk (a stalled volume) does not hold up an unrelated vault's recovery.
pub(crate) const MAX_RUNNING: usize = 2;

/// One dropped registration incarnation waiting for its rebuild.
pub(super) struct Job {
    /// Moved on by every failure (`request_rebuild`).
    pub(super) generation: u64,
    /// The stamp (`state::tick`) of the latest request: a build that began after it has
    /// read past every change any request was for.
    pub(super) requested_at: u64,
    /// The registration's canonical root: what intersects it, what pokes it.
    pub(super) root: PathBuf,
    /// Failed attempts in a row.
    pub(super) failures: usize,
    pub(super) due: Instant,
    pub(super) last_attempt: Option<Instant>,
    /// The attempt running for it, if any: its id, and once spawned, its abort handle.
    pub(super) running: Option<(u64, Option<tokio::task::AbortHandle>)>,
}

/// The jobs, keyed by registration and incarnation (`LinkIndexState::rebuild_jobs`).
pub(super) type Jobs = HashMap<(String, u64), Job>;

/// What stands in for a walk in tests: the key in, whether it published out.
#[cfg(test)]
pub(crate) type FakeRebuild = std::sync::Arc<
    dyn Fn(String) -> std::pin::Pin<Box<dyn std::future::Future<Output = bool> + Send>>
        + Send
        + Sync,
>;

/// What the scheduler does next.
enum Next {
    Idle,
    At(Instant),
    Run {
        key: String,
        incarnation: u64,
        attempt: u64,
    },
}

fn intersect(a: &Path, b: &Path) -> bool {
    a.starts_with(b) || b.starts_with(a)
}

/// The wait after `failures` failed attempts in a row.
fn wait_after(failures: usize) -> Duration {
    BACKOFF.get(failures - 1).copied().unwrap_or(TERMINAL)
}

/// The earliest a poked job may run again.
fn soonest(job: &Job, now: Instant) -> Instant {
    job.last_attempt.map_or(now, |at| (at + JOB_GAP).max(now))
}

impl LinkIndexState {
    /// #824 A rebuild for `(key, incarnation)` after a failure dropped its index, due
    /// now (no sooner than `JOB_GAP` after its last attempt). `true`: a new job. `false`:
    /// the job's generation moved on, so an attempt already running goes again before it
    /// ends — what it publishes may predate this drop.
    pub(super) fn request_rebuild(&self, key: &str, incarnation: u64, root: &Path) -> bool {
        let now = Instant::now();
        let fresh = {
            let mut jobs = self.jobs();
            match jobs.entry((key.to_string(), incarnation)) {
                std::collections::hash_map::Entry::Occupied(mut job) => {
                    let job = job.get_mut();
                    job.generation += 1;
                    job.requested_at = super::state::tick();
                    job.due = soonest(job, now);
                    false
                }
                std::collections::hash_map::Entry::Vacant(job) => {
                    job.insert(Job {
                        generation: 0,
                        requested_at: super::state::tick(),
                        root: root.to_path_buf(),
                        failures: 0,
                        due: now,
                        last_attempt: None,
                        running: None,
                    });
                    true
                }
            }
        };
        self.scheduler_wake.notify_one();
        fresh
    }

    /// The failure generation an attempt for `(key, incarnation)` starts from, and the
    /// stamp of the latest request.
    fn rebuild_request(&self, key: &str, incarnation: u64) -> (u64, u64) {
        self.jobs()
            .get(&(key.to_string(), incarnation))
            .map_or((0, 0), |j| (j.generation, j.requested_at))
    }

    /// The job for `(key, incarnation)` ends — removed — when no failure has been requested
    /// since generation `seen` (`None`: end regardless, the registration is gone).
    /// `false`: a newer failure landed and the job stays, due at once.
    pub(super) fn finish_rebuild(&self, key: &str, incarnation: u64, seen: Option<u64>) -> bool {
        let mut jobs = self.jobs();
        let at = (key.to_string(), incarnation);
        if let (Some(seen), Some(job)) = (seen, jobs.get_mut(&at)) {
            if job.generation != seen {
                job.due = Instant::now();
                return false;
            }
        }
        jobs.remove(&at);
        true
    }

    /// Something moved at or under `path` (a watcher mark): every job whose root
    /// intersects it is due as soon as its gap allows.
    pub(crate) fn poke_under(&self, path: &Path) {
        let now = Instant::now();
        let mut woke = false;
        for job in self.jobs().values_mut() {
            if intersect(&job.root, path) {
                job.due = soonest(job, now);
                woke = true;
            }
        }
        if woke {
            self.scheduler_wake.notify_one();
        }
    }

    /// A build published for `(key, incarnation)`: its job, if any, is due now, to end.
    pub(super) fn poke_key(&self, key: &str, incarnation: u64) {
        if let Some(job) = self.jobs().get_mut(&(key.to_string(), incarnation)) {
            job.due = Instant::now();
            self.scheduler_wake.notify_one();
        }
    }

    /// The registration under `key` is removed, up to `incarnation`: its jobs go now, and
    /// an attempt running for one is aborted. Its future is dropped at once, and with it
    /// the build lock and lease (`forget` has already replaced the slot, so nothing it
    /// built could publish). The vault walk inside it runs on a blocking thread, which the
    /// drop stops at its next folder (`fs::walk_vault`'s cancel-on-drop flag); a read
    /// already blocked on a stalled volume finishes first — nothing can interrupt it.
    pub(super) fn cancel_rebuilds(&self, key: &str, incarnation: u64) {
        self.jobs().retain(|(k, at), job| {
            let removed = k == key && *at <= incarnation;
            if removed {
                if let Some((_, Some(abort))) = &job.running {
                    abort.abort();
                }
            }
            !removed
        });
        self.scheduler_wake.notify_one();
    }

    /// The attempt `attempt` for `(key, incarnation)` was spawned as `abort`. If the job
    /// went (cancelled) or moved on meanwhile, the attempt is aborted at once.
    fn spawned(&self, key: &str, incarnation: u64, attempt: u64, abort: tokio::task::AbortHandle) {
        let mut jobs = self.jobs();
        match jobs.get_mut(&(key.to_string(), incarnation)) {
            Some(job) if job.running.as_ref().is_some_and(|(id, _)| *id == attempt) => {
                job.running = Some((attempt, Some(abort)));
            }
            _ => abort.abort(),
        }
    }

    /// The attempt `attempt` for `(key, incarnation)` is over.
    fn ended(&self, key: &str, incarnation: u64, attempt: u64) {
        if let Some(job) = self.jobs().get_mut(&(key.to_string(), incarnation)) {
            if job.running.as_ref().is_some_and(|(id, _)| *id == attempt) {
                job.running = None;
            }
        }
        self.scheduler_wake.notify_one();
    }

    /// The jobs (tests).
    #[cfg(test)]
    pub(crate) fn rebuild_jobs_len(&self) -> usize {
        self.jobs().len()
    }

    /// When the job for `(key, incarnation)` is due (tests).
    #[cfg(test)]
    fn job_due(&self, key: &str, incarnation: u64) -> Option<Instant> {
        self.jobs()
            .get(&(key.to_string(), incarnation))
            .map(|j| j.due)
    }

    fn jobs(&self) -> std::sync::MutexGuard<'_, Jobs> {
        self.rebuild_jobs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// The next attempt to start — claimed as running when it is due — or when to look
    /// again. Only jobs whose root no running attempt intersects are candidates, and
    /// none while `MAX_RUNNING` run: a running attempt's end wakes the scheduler.
    fn next(&self, now: Instant) -> Next {
        let mut jobs = self.jobs();
        let running: Vec<PathBuf> = jobs
            .values()
            .filter(|j| j.running.is_some())
            .map(|j| j.root.clone())
            .collect();
        if running.len() >= MAX_RUNNING {
            return Next::Idle;
        }
        // The job due first; among those due together, the one tried longest ago, so a
        // job postponed by an intersecting failure is not passed over for ever.
        let first = jobs
            .iter()
            .filter(|(_, j)| j.running.is_none() && !running.iter().any(|r| intersect(r, &j.root)))
            .min_by_key(|(_, j)| (j.due, j.last_attempt))
            .map(|(at, j)| (at.clone(), j.due));
        match first {
            None => Next::Idle,
            Some((_, due)) if due > now => Next::At(due),
            Some(((key, incarnation), _)) => {
                let attempt = self
                    .attempts_started
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if let Some(job) = jobs.get_mut(&(key.clone(), incarnation)) {
                    job.running = Some((attempt, None));
                }
                Next::Run {
                    key,
                    incarnation,
                    attempt,
                }
            }
        }
    }

    /// An attempt for `(key, incarnation)` failed: wait, and postpone the due jobs of
    /// intersecting roots to the same time.
    fn record_failure(&self, key: &str, incarnation: u64, now: Instant) {
        let mut jobs = self.jobs();
        let Some(job) = jobs.get_mut(&(key.to_string(), incarnation)) else {
            return;
        };
        job.failures += 1;
        job.last_attempt = Some(now);
        let failures = job.failures;
        let due = now + wait_after(failures);
        job.due = due;
        let root = job.root.clone();
        // One escalation for the family: each still gets its turn (`next` prefers the
        // one tried longest ago), but together they walk about one schedule.
        for ((k, at), other) in jobs.iter_mut() {
            if (k.as_str(), *at) != (key, incarnation)
                && intersect(&other.root, &root)
                && other.due < due
            {
                other.due = due;
                other.failures = other.failures.max(failures);
            }
        }
    }

    fn record_attempt(&self, key: &str, incarnation: u64, now: Instant) {
        if let Some(job) = self.jobs().get_mut(&(key.to_string(), incarnation)) {
            job.last_attempt = Some(now);
        }
    }
}

/// Start the scheduler for `app`'s link index once, on the runtime the caller runs on.
pub(crate) fn ensure_started<R: Runtime>(app: &tauri::AppHandle<R>) {
    let state = app.state::<LinkIndexState>();
    if state
        .scheduler_started
        .swap(true, std::sync::atomic::Ordering::SeqCst)
    {
        return;
    }
    let app = app.clone();
    tokio::spawn(async move { run(app).await });
}

async fn run<R: Runtime>(app: tauri::AppHandle<R>) {
    let mut last_start: Option<Instant> = None;
    loop {
        let state = app.state::<LinkIndexState>();
        // Starts, not attempts, are spaced: an attempt that runs long does not delay
        // the next start beyond the gap.
        if let Some(at) = last_start.map(|l| l + GLOBAL_GAP) {
            if at > Instant::now() {
                tokio::time::sleep_until(at).await;
            }
        }
        match state.next(Instant::now()) {
            Next::Idle => state.scheduler_wake.notified().await,
            Next::At(at) => {
                tokio::select! {
                    () = tokio::time::sleep_until(at) => {}
                    () = state.scheduler_wake.notified() => {}
                }
            }
            Next::Run {
                key,
                incarnation,
                attempt: id,
            } => {
                last_start = Some(Instant::now());
                let task = {
                    let (app, key) = (app.clone(), key.clone());
                    tokio::spawn(async move {
                        // Ends the attempt on return and on unwind alike: a panicking
                        // attempt must not leave its family blocked for good.
                        let _ended = Ended {
                            app: app.clone(),
                            key: key.clone(),
                            incarnation,
                            attempt: id,
                        };
                        attempt(&app, &key, incarnation).await;
                    })
                };
                state.spawned(&key, incarnation, id, task.abort_handle());
            }
        }
    }
}

/// Ends an attempt when its task does, however it does — except by abort, which only
/// `cancel_rebuilds` does, after removing the job.
struct Ended<R: Runtime> {
    app: tauri::AppHandle<R>,
    key: String,
    incarnation: u64,
    attempt: u64,
}

impl<R: Runtime> Drop for Ended<R> {
    fn drop(&mut self) {
        self.app
            .state::<LinkIndexState>()
            .ended(&self.key, self.incarnation, self.attempt);
    }
}

/// One attempt for `(key, incarnation)`.
async fn attempt<R: Runtime>(app: &tauri::AppHandle<R>, key: &str, incarnation: u64) {
    let state = app.state::<LinkIndexState>();
    let ctx_mgr = app.state::<ContextManager>();
    let now = Instant::now();
    let (seen, requested_at) = state.rebuild_request(key, incarnation);
    #[cfg(test)]
    if state
        .panic_attempt
        .swap(false, std::sync::atomic::Ordering::SeqCst)
    {
        panic!("injected panic in a rebuild attempt");
    }
    // That registration is gone or replaced: the replacement builds itself.
    if ctx_mgr
        .context_registered_at(key)
        .await
        .map(|r| r.incarnation)
        != Some(incarnation)
    {
        state.finish_rebuild(key, incarnation, None);
        return;
    }
    // A build that began after the latest request has published for this incarnation —
    // ours or anyone's (a refresh, a rename's gate): it read past what the job is for. A
    // published index alone is not that: a refresh job's index was never dropped.
    let published = if state
        .covered_since(key, incarnation)
        .await
        .is_some_and(|began| began > requested_at)
    {
        true
    } else {
        #[cfg(test)]
        state
            .rebuild_attempts
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        state.record_attempt(key, incarnation, now);
        rebuild(&state, &ctx_mgr, key).await
    };
    if !published {
        // The index is known not to match the disk: a refresh's index is dropped now
        // rather than left trusted (a degraded one already is).
        state.drop_index_for(key, incarnation).await;
        state.record_failure(key, incarnation, now);
        return;
    }
    #[cfg(test)]
    pause_before_finish(&state, key).await;
    if state.finish_rebuild(key, incarnation, Some(seen)) {
        let _ = app.emit(
            "index:changed",
            serde_json::json!({ "entries": [], "rebuilt": [key] }),
        );
    }
}

#[cfg(not(test))]
async fn rebuild(state: &LinkIndexState, ctx_mgr: &ContextManager, key: &str) -> bool {
    rebuild_registration(state, ctx_mgr, key).await
}

/// Tests may stand in for the walk (`LinkIndexState::fake_rebuild`), to count attempts
/// under paused time without real I/O, or to park one.
#[cfg(test)]
async fn rebuild(state: &LinkIndexState, ctx_mgr: &ContextManager, key: &str) -> bool {
    let fake = state.fake_rebuild.lock().unwrap().clone();
    match fake {
        Some(fake) => fake(key.to_string()).await,
        None => rebuild_registration(state, ctx_mgr, key).await,
    }
}

#[cfg(test)]
async fn pause_before_finish(state: &LinkIndexState, key: &str) {
    let pause = {
        let mut slot = state.pause_before_finish.lock().unwrap();
        match slot.as_ref() {
            Some(p) if p.path == Path::new(key) => slot.take(),
            _ => None,
        }
    };
    if let Some(p) = pause {
        p.reached.notify_one();
        p.release.notified().await;
    }
}

#[cfg(test)]
#[path = "scheduler_tests.rs"]
mod tests;
