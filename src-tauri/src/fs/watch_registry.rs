// §3.2 Who holds a directory watch, and for how long (issue 797).
//
// A watch used to be made per `watch_dir` call and kept for the rest of the session:
// a vault switched away from stayed watched, and a file opened outside the vault
// watched its whole folder tree. A watch is now held by LEASES. Each `watch_dir` call
// takes one — a window's vault root, an out-of-vault tab's folder, a file window's
// folder — and `unwatch_dir` or the window's destruction gives it back. The last
// lease on a folder takes its watcher down.
//
// One watcher per folder (keyed by its canonical path, so `/var/x` and `/private/var/x`
// share it). Its scope is recursive while any lease asks for recursive, otherwise
// non-recursive. When the leases change the scope, the new watcher starts before the
// old one is dropped, so no change falls between them; for that moment both report,
// and the frontend handles a second report of one write as it handles FSEvents' own
// (#795: coalesced during a reload, dropped by the save guard after it).
//
// A lease's `focus` is the file it watches the folder for. A non-recursive watch's
// filter takes its focus files as the open ones (`watch_filter`), so an atomic replace
// of that file is reported as a change even in a window that has no editor store.
//
// ‼️ Not deduplicated against ancestors: a folder inside a recursively watched vault
// gets its own watcher when a file window asks for it, as it did before.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use super::watch_filter::Focus;
use super::FsError;

/// The most leases one window may hold — far above what a window asks for (one vault
/// root per context it activated, one folder per out-of-vault tab), low enough that a
/// runaway caller cannot pile up watchers.
pub const MAX_LEASES_PER_WINDOW: usize = 512;

/// What a watcher is started for.
#[derive(Debug, Clone)]
pub(crate) struct WatchSpec {
    /// The folder as the lease that started this watcher spelled it.
    pub(crate) root: String,
    pub(crate) recursive: bool,
    pub(crate) focus: Focus,
}

struct Lease {
    window: String,
    key: PathBuf,
    spelled: String,
    recursive: bool,
    focus: Option<String>,
}

struct Watch<H> {
    handle: H,
    recursive: bool,
    focus: Focus,
}

/// The leases and the watchers they hold. `H` is the running watcher; dropping it
/// stops it.
pub(crate) struct WatchRegistry<H> {
    next_id: u64,
    leases: HashMap<u64, Lease>,
    watches: HashMap<PathBuf, Watch<H>>,
}

impl<H> Default for WatchRegistry<H> {
    fn default() -> Self {
        Self {
            next_id: 1,
            leases: HashMap::new(),
            watches: HashMap::new(),
        }
    }
}

impl<H> WatchRegistry<H> {
    /// How many watchers are running.
    #[cfg(test)]
    pub(crate) fn live_watches(&self) -> usize {
        self.watches.len()
    }

    /// How many leases are held.
    #[cfg(test)]
    pub(crate) fn leases(&self) -> usize {
        self.leases.len()
    }

    /// Take a lease on `path` for `window`. `spawn` starts a watcher; it is called
    /// only when the folder has none, or its scope must widen.
    pub(crate) fn acquire(
        &mut self,
        window: &str,
        path: &str,
        recursive: bool,
        focus: Option<&str>,
        spawn: &dyn Fn(&WatchSpec) -> Result<H, FsError>,
    ) -> Result<u64, String> {
        let held = self.leases.values().filter(|l| l.window == window).count();
        if held >= MAX_LEASES_PER_WINDOW {
            return Err(format!(
                "watch_dir: window {window} already holds {held} watches, the most allowed"
            ));
        }
        let key = canonical(path);
        let lease = Lease {
            window: window.to_string(),
            key: key.clone(),
            spelled: path.to_string(),
            recursive,
            focus: focus.map(str::to_string),
        };
        match self.watches.get_mut(&key) {
            Some(watch) if watch.recursive || !recursive => {}
            Some(watch) => {
                // Widen: the new watcher runs before the narrow one is dropped.
                let spec = WatchSpec {
                    root: path.to_string(),
                    recursive: true,
                    focus: watch.focus.clone(),
                };
                watch.handle = spawn(&spec).map_err(|e| e.to_string())?;
                watch.recursive = true;
            }
            None => {
                let spec = WatchSpec {
                    root: path.to_string(),
                    recursive,
                    focus: Focus::default(),
                };
                let handle = spawn(&spec).map_err(|e| e.to_string())?;
                self.watches.insert(
                    key.clone(),
                    Watch {
                        handle,
                        recursive,
                        focus: spec.focus,
                    },
                );
            }
        }
        let id = self.next_id;
        self.next_id += 1;
        self.leases.insert(id, lease);
        self.refresh_focus(&key);
        Ok(id)
    }

    /// Give back lease `id`, which `window` must hold. The folder's watcher stops with
    /// its last lease, and narrows when its last recursive lease goes.
    pub(crate) fn release(
        &mut self,
        window: &str,
        id: u64,
        spawn: &dyn Fn(&WatchSpec) -> Result<H, FsError>,
    ) -> Result<(), String> {
        match self.leases.get(&id) {
            Some(lease) if lease.window == window => {}
            Some(_) => return Err(format!("unwatch_dir: watch {id} belongs to another window")),
            None => return Err(format!("unwatch_dir: no watch {id}")),
        }
        let lease = self.leases.remove(&id).expect("checked above");
        self.settle(&lease.key, spawn);
        Ok(())
    }

    /// Give back every lease `window` holds — the window is gone.
    pub(crate) fn release_window(
        &mut self,
        window: &str,
        spawn: &dyn Fn(&WatchSpec) -> Result<H, FsError>,
    ) {
        let ids: Vec<u64> = self
            .leases
            .iter()
            .filter(|(_, l)| l.window == window)
            .map(|(id, _)| *id)
            .collect();
        let mut keys = HashSet::new();
        for id in ids {
            if let Some(lease) = self.leases.remove(&id) {
                keys.insert(lease.key);
            }
        }
        for key in keys {
            self.settle(&key, spawn);
        }
    }

    /// After a lease on `key` left: stop the watcher if none remain, narrow it if no
    /// recursive one does, and keep its focus set in step.
    fn settle(&mut self, key: &PathBuf, spawn: &dyn Fn(&WatchSpec) -> Result<H, FsError>) {
        let remaining: Vec<&Lease> = self.leases.values().filter(|l| &l.key == key).collect();
        if remaining.is_empty() {
            self.watches.remove(key);
            return;
        }
        let still_recursive = remaining.iter().any(|l| l.recursive);
        let spelled = remaining[0].spelled.clone();
        if let Some(watch) = self.watches.get_mut(key) {
            if watch.recursive && !still_recursive {
                let spec = WatchSpec {
                    root: spelled,
                    recursive: false,
                    focus: watch.focus.clone(),
                };
                // Narrowing that fails to start keeps the wider watcher: more events,
                // none missed.
                if let Ok(handle) = spawn(&spec) {
                    watch.handle = handle;
                    watch.recursive = false;
                }
            }
        }
        self.refresh_focus(key);
    }

    /// Rebuild the focus set of `key`'s watcher from its leases.
    fn refresh_focus(&mut self, key: &PathBuf) {
        let mut set = HashSet::new();
        for lease in self.leases.values().filter(|l| &l.key == key) {
            if let Some(file) = &lease.focus {
                set.insert(PathBuf::from(file));
                if let Ok(c) = crate::context::manager::resolve_canonical(file) {
                    set.insert(c);
                }
            }
        }
        if let Some(watch) = self.watches.get(key) {
            if let Ok(mut focus) = watch.focus.write() {
                *focus = set;
            }
        }
    }
}

fn canonical(path: &str) -> PathBuf {
    crate::context::manager::resolve_canonical(path).unwrap_or_else(|_| PathBuf::from(path))
}

#[cfg(test)]
#[path = "watch_registry_tests.rs"]
mod tests;
