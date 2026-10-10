//! §29 #824 A command's changes to vault content reach every link index covering them
//! before the command returns.
//!
//! A command runs its change as a commit (`committed`) that declares each effect in an
//! `EffectLog` BEFORE performing it: `Path` for an entry it writes, renames, copies or
//! deletes, `Tree` for a directory whose changed entries cannot be known in advance (a
//! Git checkout). Once the commit is over, whatever it returned, every declared effect
//! is reconciled from the disk as it is then (`reconcile::reconcile_path`,
//! `reconcile_tree`), and only then does the command answer — its own error included,
//! so a command that changed some files and then failed leaves none of them stale.
//!
//! The commit and the reconciliation run in one spawned task: cancelling the command's
//! future drops the handle, not the task, so a commit that happened is always
//! reconciled. The commit runs in a task of its own inside it, so a panic there (in
//! builds that unwind — dev and test; the release profile aborts the whole process,
//! taking the in-memory index with it, and the next launch builds it from disk) still
//! reaches the reconciliation.
//!
//! A reconciliation that could not bring an index up to date drops it (`degrade`) and
//! schedules a rebuild; `index:changed` names it only once a rebuild has published, so
//! no window is told to re-read an index that is known to be missing. Each command emits
//! at most one `index:changed`, after the whole reconciliation:
//! `{ entries: [{ canonical, spellings }], rebuilt: [key] }`. The spellings are the paths
//! as declared plus each covering index's own spelling, so a window can find the tab it
//! shows under either name.

use std::future::Future;
use std::sync::{Arc, Mutex, PoisonError};

use tauri::{Emitter, Manager, Runtime};

use super::reconcile::{reconcile_path_in, reconcile_tree_in, Batch, Reconciled};
use super::state::LinkIndexState;
use crate::context::ContextManager;

/// What a commit changes, declared before it changes it.
#[derive(Debug, Clone)]
pub(crate) enum Effect {
    Path(String),
    Tree(String),
}

#[derive(Default)]
struct Log {
    effects: Vec<Effect>,
    mtime: Option<u64>,
}

/// The effects a commit declares, shared with the reconciliation that follows it.
#[derive(Clone, Default)]
pub(crate) struct EffectLog(Arc<Mutex<Log>>);

impl EffectLog {
    pub(crate) fn path(&self, path: &str) {
        self.lock().effects.push(Effect::Path(path.to_string()));
    }

    pub(crate) fn tree(&self, dir: &str) {
        self.lock().effects.push(Effect::Tree(dir.to_string()));
    }

    /// The write landed, with this mtime: a later failure is not "the write failed".
    pub(crate) fn landed(&self, mtime: u64) {
        self.lock().mtime = Some(mtime);
    }

    fn take(&self) -> (Vec<Effect>, Option<u64>) {
        let mut log = self.lock();
        (std::mem::take(&mut log.effects), log.mtime)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Log> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// What `write_file` answers (#824): the mtime the watcher will report for the write
/// (#795), and whether every covering index already reflects it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteOutcome {
    pub mtime: u64,
    pub index_fresh: bool,
}

/// How a commit ended once its effects were reconciled.
pub(crate) struct Committed<T> {
    pub(crate) result: Result<T, String>,
    /// Every declared effect reached every covering index.
    pub(crate) index_fresh: bool,
    /// What `EffectLog::landed` recorded, if the commit got that far.
    pub(crate) mtime: Option<u64>,
}

/// Run `commit`, then reconcile what it declared (see the module doc).
pub(crate) async fn committed<R, T, F, Fut>(app: &tauri::AppHandle<R>, commit: F) -> Committed<T>
where
    R: Runtime,
    T: Send + 'static,
    F: FnOnce(EffectLog) -> Fut + Send + 'static,
    Fut: Future<Output = Result<T, String>> + Send + 'static,
{
    let app = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let log = EffectLog::default();
        let result = match tauri::async_runtime::spawn(commit(log.clone())).await {
            Ok(result) => result,
            Err(e) => Err(format!("the change stopped unexpectedly: {e}")),
        };
        let (effects, mtime) = log.take();
        let index_fresh = reconcile_effects(&app, &effects).await;
        Committed {
            result,
            index_fresh,
            mtime,
        }
    });
    match task.await {
        Ok(done) => done,
        Err(e) => Committed {
            result: Err(format!("the change stopped unexpectedly: {e}")),
            index_fresh: false,
            mtime: None,
        },
    }
}

/// `write_file`'s answer from a commit: a write that landed is `Ok`, even when what
/// followed failed.
pub(crate) fn write_outcome(done: Committed<u64>) -> Result<WriteOutcome, String> {
    match (done.result, done.mtime) {
        (Ok(mtime), _) => Ok(WriteOutcome {
            mtime,
            index_fresh: done.index_fresh,
        }),
        (Err(_), Some(mtime)) => Ok(WriteOutcome {
            mtime,
            index_fresh: false,
        }),
        (Err(e), None) => Err(e),
    }
}

/// Reconcile `effects`, drop what could not be brought up to date, and emit one
/// `index:changed`. Answers whether every covering index is fresh.
pub(crate) async fn reconcile_effects<R: Runtime>(
    app: &tauri::AppHandle<R>,
    effects: &[Effect],
) -> bool {
    let state = app.state::<LinkIndexState>();
    let ctx_mgr = app.state::<ContextManager>();
    let mut batch = Batch::default();
    let mut done: Vec<Reconciled> = Vec::new();
    for effect in effects {
        done.push(match effect {
            Effect::Path(path) => reconcile_path_in(&state, &ctx_mgr, path, &mut batch).await,
            Effect::Tree(dir) => reconcile_tree_in(&ctx_mgr, dir, &mut batch).await,
        });
    }
    batch.finish(&state, &ctx_mgr, &mut done).await;
    report(app, done).await
}

/// Drop what `done` could not bring up to date, emit one `index:changed` for the rest,
/// and answer whether everything is fresh.
pub(crate) async fn report<R: Runtime>(app: &tauri::AppHandle<R>, done: Vec<Reconciled>) -> bool {
    let fresh = done.iter().all(|d| !d.failed && d.degrade.is_empty());
    let mut degrade: Vec<(String, u64)> = done.iter().flat_map(|d| d.degrade.clone()).collect();
    degrade.sort();
    degrade.dedup();
    for (key, incarnation) in degrade {
        self::degrade(app, &key, incarnation).await;
    }
    emit_changed(app, &done);
    fresh
}

/// One `index:changed` for `done`, or nothing when no index was reached.
pub(crate) fn emit_changed<R: Runtime>(app: &tauri::AppHandle<R>, done: &[Reconciled]) {
    let mut entries: Vec<serde_json::Value> = Vec::new();
    let mut rebuilt: Vec<String> = Vec::new();
    for d in done.iter().filter(|d| d.reached) {
        // A path whose only index had to be dropped is announced by that index's rebuild
        // (`degrade`), not here: telling a window to re-read it now would read nothing.
        // A covering index that did take it (a healthy nested vault beside a dropped
        // outer one) is announced now, and so is what else the same path rebuilt.
        if ((d.degrade.is_empty() && !d.deferred) || !d.applied.is_empty())
            && !entries
                .iter()
                .any(|e| e["canonical"] == d.canonical.to_string_lossy().as_ref())
        {
            entries.push(serde_json::json!({
                "canonical": d.canonical.to_string_lossy(),
                "spellings": d.spellings,
            }));
        }
        for key in &d.rebuilt {
            if !rebuilt.contains(key) {
                rebuilt.push(key.clone());
            }
        }
    }
    if entries.is_empty() && rebuilt.is_empty() {
        return;
    }
    let _ = app.emit(
        "index:changed",
        serde_json::json!({ "entries": entries, "rebuilt": rebuilt }),
    );
}

/// Drop registration `incarnation` of `key`'s index — it no longer matches the disk and
/// must not be trusted — and hand its rebuild to the scheduler (`scheduler`), one job per
/// registration incarnation however many failures ask. A newer registration of the same
/// path keeps its index (`drop_index_for`). `index:changed` names the key once a rebuild
/// started after the last failure has published; nothing is emitted at the drop.
pub(crate) async fn degrade<R: Runtime>(app: &tauri::AppHandle<R>, key: &str, incarnation: u64) {
    let state = app.state::<LinkIndexState>();
    if !state.drop_index_for(key, incarnation).await {
        return;
    }
    // That registration is gone or replaced: the replacement builds itself.
    let Some(registered) = app
        .state::<ContextManager>()
        .context_registered_at(key)
        .await
        .filter(|r| r.incarnation == incarnation)
    else {
        return;
    };
    state.request_rebuild(key, incarnation, &registered.canonical_path);
    super::scheduler::ensure_started(app);
}

#[cfg(test)]
#[path = "commit_tests.rs"]
mod tests;
