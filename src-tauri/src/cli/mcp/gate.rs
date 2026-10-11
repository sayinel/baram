// §389 The link index is built for one call at a time (spec 0068 D13). rmcp runs each
// request in a task of its own (`spawn_service_task` in its `service.rs`), so two `backlinks`
// calls at once would build two indexes at once — twice the memory.

use std::future::Future;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::Mutex;

#[derive(Default)]
pub(super) struct IndexGate {
    turn: Mutex<()>,
    /// Runs under way now, and the most there have been at once — what the tests read.
    running: AtomicUsize,
    peak: AtomicUsize,
}

impl IndexGate {
    /// Runs `work` when no other work of this gate is running.
    pub(super) async fn run<F: Future>(&self, work: F) -> F::Output {
        let _turn = self.turn.lock().await;
        let _running = Running::start(self);
        work.await
    }

    #[cfg(test)]
    pub(super) fn peak(&self) -> usize {
        self.peak.load(Ordering::SeqCst)
    }
}

/// Counts one run while it lives — also when the call is dropped part way.
struct Running<'a>(&'a IndexGate);

impl<'a> Running<'a> {
    fn start(gate: &'a IndexGate) -> Self {
        let now = gate
            .running
            .fetch_add(1, Ordering::SeqCst)
            .saturating_add(1);
        gate.peak.fetch_max(now, Ordering::SeqCst);
        Running(gate)
    }
}

impl Drop for Running<'_> {
    fn drop(&mut self) {
        self.0.running.fetch_sub(1, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::app_config::AppConfig;
    use crate::cli::ops_links;
    use crate::cli::vault::Vault;

    /// The count itself: two runs alive at once are a peak of 2, and a dropped run is no
    /// longer counted. The sibling of the test below — it shows the count can see what that
    /// test says does not happen.
    ///
    /// What fails this: `Drop for Running` without its `fetch_sub` (the third run then makes
    /// a peak of 3); `Running::start` without its `fetch_max` (a peak of 0).
    #[test]
    fn the_peak_counts_runs_that_overlap() {
        let gate = IndexGate::default();
        let first = Running::start(&gate);
        let second = Running::start(&gate);
        assert_eq!(gate.peak(), 2);
        drop((first, second));
        let _third = Running::start(&gate);
        assert_eq!(gate.peak(), 2, "the peak stays");
        assert_eq!(gate.running.load(Ordering::SeqCst), 1);
    }

    /// Two builds asked for at once run one after the other: at most one is under way. The
    /// count is of builds RUNNING AT ONCE — with no cache, the number built is two with or
    /// without the lock, so it would tell nothing.
    ///
    /// What fails this: `run` without its lock — the first build waits on a file read and the
    /// second starts beside it, a peak of 2.
    #[tokio::test]
    async fn two_index_builds_asked_for_at_once_run_one_at_a_time() {
        let dir = tempfile::TempDir::new().unwrap();
        let vault = Vault {
            name: "v".into(),
            root: dir.path().canonicalize().unwrap(),
        };
        for name in ["a.md", "b.md", "c.md"] {
            std::fs::write(vault.root.join(name), "[[a]]\n").unwrap();
        }
        let gate = IndexGate::default();
        let config = AppConfig::default();
        let (backlinks, links) = tokio::join!(
            gate.run(ops_links::backlinks(&vault, "a.md", &config)),
            gate.run(ops_links::links(&vault, "b.md")),
        );
        assert!(backlinks.is_ok() && links.is_ok());
        assert_eq!(gate.peak(), 1);
    }
}
