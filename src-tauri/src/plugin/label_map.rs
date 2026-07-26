// §260 — label-keyed per-sandbox state, with one invariant worth its own module.
use std::collections::HashMap;
use std::sync::Mutex;

/// Label → value map that guarantees **no value is ever dropped, or used, while the
/// lock is held**.
///
/// That is not a style preference. The original motivating case (§260 3c-2a review, I1)
/// is `tauri::ipc::Channel`: one obtained from a command argument carries an `on_drop`
/// that evals `{end:true}` into its webview (tauri `ipc/channel.rs`), and `Webview::eval`
/// reaches the event loop — under the `tracing` feature it blocks on a reply from the main
/// thread, and on the main thread it runs `handle_user_message` inline. Holding a lock
/// across that is a deadlock waiting for a main-thread caller.
///
/// The subtlety this type exists to contain: `map.lock().unwrap().insert(k, v);` as a bare
/// statement drops the **returned old value first** (temporaries drop in reverse creation
/// order, and the guard was created first), i.e. under the lock. Returning the displaced
/// value to the caller moves that drop past the guard.
///
/// §260 Phase 4b — now shared with `StagedPayloads`, whose values are plain `String`s and
/// so have no `Drop` side effects. The discipline still earns its keep there: a staged
/// document can be megabytes, and freeing megabytes under a lock other threads are waiting
/// on is a measurable stall rather than a deadlock. One implementation of the rule beats
/// two, which is the whole reason this moved out of `channels.rs`.
pub(super) struct LabelMap<T> {
    inner: Mutex<HashMap<String, T>>,
}

impl<T> Default for LabelMap<T> {
    fn default() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }
}

impl<T> LabelMap<T> {
    /// Test-only probe: is the map lockable right now? Used to prove that values drop
    /// with the lock released (a same-thread `try_lock` fails while held).
    #[cfg(test)]
    pub(super) fn is_unlocked(&self) -> bool {
        self.inner.try_lock().is_ok()
    }

    /// Remove, returning the value so it drops in the CALLER, lock-free.
    #[must_use = "the removed value must drop outside the lock"]
    pub(super) fn remove(&self, label: &str) -> Option<T> {
        self.inner.lock().unwrap().remove(label)
    }
}

impl<T: Clone> LabelMap<T> {
    /// Clone out of the lock so the caller can use the value lock-free.
    pub(super) fn get(&self, label: &str) -> Option<T> {
        self.inner.lock().unwrap().get(label).cloned()
    }

    /// Insert, returning any displaced value so it drops in the CALLER, lock-free.
    #[must_use = "the displaced value must drop outside the lock"]
    pub(super) fn insert(&self, label: String, value: T) -> Option<T> {
        self.inner.lock().unwrap().insert(label, value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    /// §260 3c-2a review (I1) — the real `Channel`'s `Drop` evals into its webview, so a
    /// value must never drop while the map's lock is held. `Channel::new` cannot carry an
    /// `on_drop` (only the command-argument path does), so the property is pinned on
    /// `LabelMap` itself with a probe that observes lock state at drop.
    #[test]
    fn displaced_and_removed_values_drop_with_the_lock_released() {
        #[derive(Clone)]
        struct Probe {
            map: Arc<LabelMap<Probe>>,
            observations: Arc<Mutex<Vec<bool>>>,
        }
        impl Drop for Probe {
            fn drop(&mut self) {
                let unlocked = self.map.is_unlocked();
                if let Ok(mut o) = self.observations.lock() {
                    o.push(unlocked);
                }
            }
        }

        let map: Arc<LabelMap<Probe>> = Arc::new(LabelMap::default());
        let observations = Arc::new(Mutex::new(Vec::new()));
        let probe = |m: &Arc<LabelMap<Probe>>| Probe {
            map: m.clone(),
            observations: observations.clone(),
        };

        drop(map.insert("plugin-a".into(), probe(&map))); // first insert: nothing displaced
        drop(map.insert("plugin-a".into(), probe(&map))); // replace → old value drops
        drop(map.remove("plugin-a")); // remove → value drops
        drop(map.get("plugin-a")); // absent, no clone

        let seen = observations.lock().unwrap().clone();
        assert!(
            seen.len() >= 2,
            "expected the displaced + removed values to drop, saw {} drops",
            seen.len()
        );
        assert!(
            seen.iter().all(|&unlocked| unlocked),
            "a value dropped while the map lock was held: {seen:?}"
        );
    }
}
