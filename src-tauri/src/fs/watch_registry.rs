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
// A watcher can end on its own — its folder deleted, the OS backend failing. It then
// reports that (`watch_ended`); the entry keeps its leases but holds no handle, the
// next lease on that folder starts it again, and `revive` restarts it once the folder
// is back (the command layer retries a bounded number of times).
//
// ‼️ Not deduplicated against ancestors: a folder inside a recursively watched vault
// gets its own watcher when a file window asks for it, as it did before.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::watch_filter::{Focus, Spellings};
use super::FsError;

/// The most leases one window may hold — far above what a window asks for (one vault
/// root per context it activated, one folder per out-of-vault tab), low enough that a
/// runaway caller cannot pile up watchers.
pub const MAX_LEASES_PER_WINDOW: usize = 512;

/// The most folders watched at once, across every window. A session watches the
/// vault roots it visited and one folder per open out-of-vault file.
pub const MAX_WATCHED_FOLDERS: usize = 128;

/// What a watcher is started for.
#[derive(Debug, Clone)]
pub(crate) struct WatchSpec {
    /// The registry's key for this folder — canonical.
    pub(crate) key: PathBuf,
    /// The folder as the lease that started this watcher spelled it.
    pub(crate) root: String,
    pub(crate) recursive: bool,
    pub(crate) focus: Focus,
    pub(crate) spellings: Spellings,
}

struct Lease {
    window: String,
    key: PathBuf,
    spelled: String,
    recursive: bool,
    focus: Option<String>,
}

struct Watch<H> {
    /// `None` once the watcher ended on its own (`watch_ended`).
    handle: Option<H>,
    recursive: bool,
    focus: Focus,
    spellings: Spellings,
}

type SpawnFn<'a, H> = &'a dyn Fn(&WatchSpec) -> Result<H, FsError>;

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
        self.watches.values().filter(|w| w.handle.is_some()).count()
    }

    /// How many leases are held.
    #[cfg(test)]
    pub(crate) fn leases(&self) -> usize {
        self.leases.len()
    }

    /// Take a lease on `path` for `window`. `spawn` starts a watcher; it is called
    /// when the folder has none (or its watcher ended), or its scope must widen. The
    /// focus file and the spelling are in the watcher's sets before it starts.
    pub(crate) fn acquire(
        &mut self,
        window: &str,
        path: &str,
        recursive: bool,
        focus: Option<&str>,
        spawn: SpawnFn<'_, H>,
    ) -> Result<u64, String> {
        let held = self.leases.values().filter(|l| l.window == window).count();
        if held >= MAX_LEASES_PER_WINDOW {
            return Err(format!(
                "watch_dir: window {window} already holds {held} watches, the most allowed"
            ));
        }
        let key = canonical(path);
        if !self.watches.contains_key(&key) && self.watches.len() >= MAX_WATCHED_FOLDERS {
            return Err(format!(
                "watch_dir: {MAX_WATCHED_FOLDERS} folders are already watched, the most allowed"
            ));
        }
        let lease = Lease {
            window: window.to_string(),
            key: key.clone(),
            spelled: path.to_string(),
            recursive,
            focus: focus.map(str::to_string),
        };
        let id = self.next_id;
        self.next_id += 1;
        self.leases.insert(id, lease);
        let result = self.install(&key, path, spawn);
        if let Err(e) = result {
            // Roll back: the lease never held anything.
            self.leases.remove(&id);
            if self.leases.values().all(|l| l.key != key) {
                self.watches.remove(&key);
            } else {
                self.refresh_sets(&key);
            }
            return Err(e);
        }
        Ok(id)
    }

    /// Bring `key`'s watcher in line with its leases, the lease just added included:
    /// its sets first, then a watcher of the right scope — started if there is none,
    /// replaced (new before old) if it must widen.
    fn install(
        &mut self,
        key: &PathBuf,
        spelled: &str,
        spawn: SpawnFn<'_, H>,
    ) -> Result<(), String> {
        let recursive = self.leases.values().any(|l| &l.key == key && l.recursive);
        let watch = self.watches.entry(key.clone()).or_insert_with(|| Watch {
            handle: None,
            recursive,
            focus: Focus::default(),
            spellings: Spellings::default(),
        });
        let needs_start = watch.handle.is_none() || (recursive && !watch.recursive);
        let (focus, spellings) = (Arc::clone(&watch.focus), Arc::clone(&watch.spellings));
        self.refresh_sets(key);
        if !needs_start {
            return Ok(());
        }
        let spec = WatchSpec {
            key: key.clone(),
            root: spelled.to_string(),
            recursive,
            focus,
            spellings,
        };
        let handle = spawn(&spec).map_err(|e| e.to_string())?;
        if let Some(watch) = self.watches.get_mut(key) {
            watch.handle = Some(handle);
            watch.recursive = recursive;
        }
        Ok(())
    }

    /// Give back lease `id`, which `window` must hold. The folder's watcher stops with
    /// its last lease, and narrows when its last recursive lease goes.
    pub(crate) fn release(
        &mut self,
        window: &str,
        id: u64,
        spawn: SpawnFn<'_, H>,
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

    /// Give back every lease `window` holds — the window is gone, or its page loaded
    /// again and starts over (`release_window_watches`).
    pub(crate) fn release_window(&mut self, window: &str, spawn: SpawnFn<'_, H>) {
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

    /// The watcher of `key` ended on its own. Its leases stay; it holds no handle until
    /// `revive` or the next lease starts it again.
    pub(crate) fn watch_ended(&mut self, key: &Path) {
        if let Some(watch) = self.watches.get_mut(key) {
            watch.handle = None;
        }
    }

    /// Start `key`'s ended watcher again, if it still has leases. Answers whether it is
    /// running afterwards.
    pub(crate) fn revive(&mut self, key: &Path, spawn: SpawnFn<'_, H>) -> bool {
        let key = key.to_path_buf();
        let Some(spelled) = self
            .leases
            .values()
            .find(|l| l.key == key)
            .map(|l| l.spelled.clone())
        else {
            return false;
        };
        self.install(&key, &spelled, spawn).is_ok()
    }

    /// After a lease on `key` left: stop the watcher if none remain, narrow it if no
    /// recursive one does, and keep its sets in step.
    fn settle(&mut self, key: &PathBuf, spawn: SpawnFn<'_, H>) {
        let remaining: Vec<&Lease> = self.leases.values().filter(|l| &l.key == key).collect();
        if remaining.is_empty() {
            self.watches.remove(key);
            return;
        }
        let still_recursive = remaining.iter().any(|l| l.recursive);
        let spelled = remaining[0].spelled.clone();
        self.refresh_sets(key);
        if let Some(watch) = self.watches.get_mut(key) {
            if watch.handle.is_some() && watch.recursive && !still_recursive {
                let spec = WatchSpec {
                    key: key.clone(),
                    root: spelled,
                    recursive: false,
                    focus: Arc::clone(&watch.focus),
                    spellings: Arc::clone(&watch.spellings),
                };
                // Narrowing that fails to start keeps the wider watcher: more events,
                // none missed.
                if let Ok(handle) = spawn(&spec) {
                    watch.handle = Some(handle);
                    watch.recursive = false;
                }
            }
        }
    }

    /// Rebuild the focus files and the spellings of `key`'s watcher from its leases.
    fn refresh_sets(&mut self, key: &PathBuf) {
        let mut focus = HashSet::new();
        let mut spellings: Vec<PathBuf> = Vec::new();
        for lease in self.leases.values().filter(|l| &l.key == key) {
            if let Some(file) = &lease.focus {
                focus.insert(PathBuf::from(file));
                if let Ok(c) = crate::context::manager::resolve_canonical(file) {
                    focus.insert(c);
                }
            }
            let spelled = PathBuf::from(&lease.spelled);
            if !spellings.contains(&spelled) {
                spellings.push(spelled);
            }
        }
        if let Some(watch) = self.watches.get(key) {
            if let Ok(mut set) = watch.focus.write() {
                *set = focus;
            }
            if let Ok(mut list) = watch.spellings.write() {
                *list = spellings;
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
