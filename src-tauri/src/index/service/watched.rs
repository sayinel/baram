//! §29 Paths the file watcher reported, brought into the link indexes that
//! contain them (issue 790). This is how a write by another program reaches the
//! index; the app's own writes reach it before their command returns (#824,
//! `commit::committed`).
//!
//! The frontend sends what the watcher saw and nothing else. A file reported in two
//! spellings (`/var/…` and `/private/var/…`, #797: the watcher reports an event once
//! per spelling its leases registered) is taken once, under the first; the others count
//! neither as applied nor as failed. Each file is then one guarded unit
//! (`reconcile::reconcile_path`), the same unit an app write goes through, so a sync
//! that read old bytes cannot apply them after a later write: what a path means —
//! note, link target, excluded, directory, gone — is decided there, per covering
//! registration.
//!
//! What this does not give: an external write is in the index only once the watcher's
//! event has travelled here, about 300 ms of batching later. The Rust-side applier is
//! #824's next step.

use std::collections::HashSet;

use crate::context::manager::resolve_canonical;
use crate::context::ContextManager;

use super::reconcile::{reconcile_path_in, Batch, Reconciled};
use super::state::LinkIndexState;

/// What a sync did: how many files reached an index, and which paths could not be
/// applied — for the caller to retry. `distinct` is how many files the paths named,
/// each spelling of one counted once. `reconciled` is what `index:changed` reports
/// (`commit::emit_changed`); it is not sent to the frontend as part of this result.
#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedSync {
    pub applied: u32,
    pub failed: Vec<String>,
    pub distinct: u32,
    #[serde(skip)]
    pub(crate) reconciled: Vec<Reconciled>,
}

/// Bring `paths` into every index containing them, one guarded unit per file
/// (`reconcile::reconcile_path`).
pub(crate) async fn sync_watched_paths_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    paths: &[String],
) -> WatchedSync {
    let mut out = WatchedSync::default();
    let mut seen: HashSet<std::path::PathBuf> = HashSet::new();
    let mut batch = Batch::default();
    for path in paths {
        let Ok(canonical) = resolve_canonical(path) else {
            out.failed.push(path.clone());
            continue;
        };
        if !seen.insert(canonical) {
            continue;
        }
        out.reconciled
            .push(reconcile_path_in(state, ctx_mgr, path, &mut batch).await);
    }
    // One rebuild per registration for the whole sync, however many paths asked.
    batch.finish(state, ctx_mgr, &mut out.reconciled).await;
    for done in &out.reconciled {
        if done.reached {
            out.applied += 1;
        }
        if done.failed {
            out.failed.extend(done.spellings.first().cloned());
        }
    }
    out.failed.sort();
    out.failed.dedup();
    out.distinct = seen.len() as u32;
    out
}
