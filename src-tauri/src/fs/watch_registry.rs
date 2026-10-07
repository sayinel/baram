// §3.2 Who holds a directory watch, and for how long (issue 797).
//
// A watch used to be made per `watch_dir` call and kept for the rest of the session:
// a vault switched away from stayed watched, and a file opened outside the vault
// watched its whole folder tree. A watch is now held by LEASES. Each `watch_dir` call
// takes one — a window's vault root, an out-of-vault tab's folder, a file window's
// folder — and `unwatch_dir` or the window's destruction gives it back.
//
// Leases are served by HOSTS, one watcher each. A lease is hosted by the innermost
// folder, its own included, that a recursive lease asks for and that contains it
// (`host_of`); with none, by its own folder. A recursive lease therefore hosts itself. So a file window's folder inside a watched vault takes no watcher of its own;
// its focus file passes the vault's filter whatever folder it is in (`watch_filter`). A
// vault nested in another keeps its own watcher: the outer vault's `.baramignore` may
// exclude it, and its own would never be read. Folders are compared canonically
// (`/var/x` and `/private/var/x` are one). A host watches recursively while any of its
// leases asks for that.
//
// After every change `rebalance` brings the watchers in line with the hosts: it starts
// what is missing or of the wrong scope first and drops what no lease needs after, so
// no change falls between an old watcher and its successor. For that moment both
// report, and the frontend handles a second report of one write as it handles
// FSEvents' own (#795: coalesced during a reload, dropped by the save guard after it).
//
// A lease's `focus` is the file it watches the folder for. The host's filter takes its
// focus files as open (`watch_filter`), so an atomic replace of that file is reported
// even in a window that has no editor store, and even below an excluded folder.
//
// A lease the registry can no longer serve is ENDED, never kept unserved: its host's
// watcher stopped on its own (`watch_ended`), a host could not be started, or what
// authorized it went away (`end_leases`, #797 context removal and revocation). The
// caller tells each ended lease's window (`Ended`), which asks again — through
// `watch_dir`'s authorization, from the folder as it resolves now.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::watch_filter::{Focus, Spellings};
use super::FsError;

/// The most leases one window may hold — far above what a window asks for (one vault
/// root per context it activated, one folder per out-of-vault tab), low enough that a
/// runaway caller cannot pile up leases.
pub const MAX_LEASES_PER_WINDOW: usize = 512;

/// The most hosts — running watchers — across every window. A session needs one per
/// vault root it visited and one per folder of a file outside them that it shows. Each
/// costs two threads: the backend's loop (notify 8.2 spawns one per watcher —
/// `fsevent.rs`, `inotify.rs`, `windows.rs`) and the router in `fs::start_watching`;
/// the cap bounds that. A watch refused for it is queued by the frontend and shown, not
/// lost.
pub const MAX_WATCHED_FOLDERS: usize = 128;

/// What a refusal of `acquire` is about — the frontend queues a watch differently for
/// each (`watchRefusal` in `src/ipc/fs.ts` reads the prefix).
pub(crate) const CAPACITY: &str = "watch-capacity";
pub(crate) const UNAUTHORIZED: &str = "watch-unauthorized";
pub(crate) const STALE_PAGE: &str = "watch-stale-page";

/// What a watcher is started for.
#[derive(Debug, Clone)]
pub(crate) struct WatchSpec {
    /// The host — canonical.
    pub(crate) key: PathBuf,
    /// The host as a lease on it spelled it, resolving to `key`.
    pub(crate) root: String,
    pub(crate) recursive: bool,
    /// Which start of this host's watcher this is; its end reports it (`watch_ended`).
    pub(crate) generation: u64,
    pub(crate) focus: Focus,
    pub(crate) spellings: Spellings,
}

/// A lease to take: who asks, for what, and what authorized it.
pub(crate) struct LeaseRequest<'a> {
    pub(crate) window: &'a str,
    pub(crate) path: &'a str,
    pub(crate) recursive: bool,
    pub(crate) focus: Option<&'a str>,
    /// The canonical root that authorized it: the registered folder for a recursive
    /// lease, the focus file for a non-recursive one (`fs_cmd::authorize_watch`).
    pub(crate) authority: PathBuf,
    /// The page of `window` that asks (`begin_page`).
    pub(crate) page: u64,
}

/// A lease the registry ended; its window is told so it can ask again.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Ended {
    pub(crate) window: String,
    pub(crate) lease: u64,
}

/// A held lease, as `leases_where` shows it.
#[derive(Debug, Clone)]
pub(crate) struct LeaseView {
    pub(crate) id: u64,
    pub(crate) path: String,
    pub(crate) recursive: bool,
    pub(crate) focus: Option<String>,
    pub(crate) authority: PathBuf,
}

struct Lease {
    window: String,
    /// The lease's folder — canonical.
    key: PathBuf,
    spelled: String,
    recursive: bool,
    focus: Option<String>,
    authority: PathBuf,
}

struct Watch<H> {
    /// Kept to keep the watcher running; dropping it stops it.
    _handle: H,
    recursive: bool,
    generation: u64,
    focus: Focus,
    spellings: Spellings,
}

type SpawnFn<'a, H> = &'a dyn Fn(&WatchSpec) -> Result<H, FsError>;

/// The leases and the watchers that serve them. `H` is the running watcher; dropping
/// it stops it.
pub(crate) struct WatchRegistry<H> {
    next_id: u64,
    next_generation: u64,
    leases: HashMap<u64, Lease>,
    watches: HashMap<PathBuf, Watch<H>>,
    /// Each window's current page (`begin_page`).
    pages: HashMap<String, u64>,
    /// What happened since the caller last asked (`take_news`).
    ended: Vec<Ended>,
    freed: bool,
}

impl<H> Default for WatchRegistry<H> {
    fn default() -> Self {
        Self {
            next_id: 1,
            next_generation: 1,
            leases: HashMap::new(),
            watches: HashMap::new(),
            pages: HashMap::new(),
            ended: Vec::new(),
            freed: false,
        }
    }
}

impl<H> WatchRegistry<H> {
    /// How many watchers are running.
    #[cfg(test)]
    pub(crate) fn live_watches(&self) -> usize {
        self.watches.len()
    }

    /// The leases ended since the last call, and whether a watcher stopped — room for
    /// a watch refused at the cap. The command layer tells the windows.
    pub(crate) fn take_news(&mut self) -> (Vec<Ended>, bool) {
        (
            std::mem::take(&mut self.ended),
            std::mem::take(&mut self.freed),
        )
    }

    /// How many leases are held.
    #[cfg(test)]
    pub(crate) fn leases(&self) -> usize {
        self.leases.len()
    }

    /// A new page of `window` starts: every lease the window holds is given back, and
    /// a request from an earlier page — in flight across a reload — is refused from now
    /// on. Answers the new page's number.
    pub(crate) fn begin_page(&mut self, window: &str, spawn: SpawnFn<'_, H>) -> u64 {
        let page = self.pages.entry(window.to_string()).or_insert(0);
        *page += 1;
        let page = *page;
        self.release_window(window, spawn);
        page
    }

    /// Take a lease for `request.window`. Refused, with a prefix the frontend reads,
    /// when it comes from an earlier page, when it would need a host beyond the cap, or
    /// when its host's watcher cannot start.
    pub(crate) fn acquire(
        &mut self,
        request: LeaseRequest<'_>,
        spawn: SpawnFn<'_, H>,
    ) -> Result<u64, String> {
        let window = request.window;
        if self.pages.get(window).copied().unwrap_or(0) != request.page {
            return Err(format!(
                "{STALE_PAGE}: watch_dir from an earlier page of window {window}"
            ));
        }
        let held = self.leases.values().filter(|l| l.window == window).count();
        if held >= MAX_LEASES_PER_WINDOW {
            return Err(format!(
                "{CAPACITY}: window {window} already holds {held} watches, the most allowed"
            ));
        }
        let id = self.next_id;
        self.next_id += 1;
        self.leases.insert(
            id,
            Lease {
                window: window.to_string(),
                key: canonical(request.path),
                spelled: request.path.to_string(),
                recursive: request.recursive,
                focus: request.focus.map(str::to_string),
                authority: request.authority,
            },
        );
        let hosts = self.hosts();
        if hosts.len() > MAX_WATCHED_FOLDERS && hosts.len() > self.watches.len() {
            self.leases.remove(&id);
            return Err(format!(
                "{CAPACITY}: {MAX_WATCHED_FOLDERS} folders are already watched, the most allowed"
            ));
        }
        let failed = self.start(&hosts, spawn);
        let host = self.host_of(&self.leases[&id].key);
        if failed.contains(&host) {
            // Roll back: the lease never held anything, and what it re-homed goes home.
            self.leases.remove(&id);
            let hosts = self.hosts();
            let again = self.start(&hosts, spawn);
            self.drop_unneeded(&hosts);
            self.end_failed(again, spawn);
            return Err(format!("could not watch {}", request.path));
        }
        self.drop_unneeded(&hosts);
        self.end_failed(failed, spawn);
        Ok(id)
    }

    /// Give back lease `id`, which `window` must hold.
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
        self.leases.remove(&id);
        self.rebalance(spawn);
        Ok(())
    }

    /// Give back every lease `window` holds — the window is gone, or its page loaded
    /// again and starts over (`begin_page`).
    pub(crate) fn release_window(&mut self, window: &str, spawn: SpawnFn<'_, H>) {
        self.leases.retain(|_, l| l.window != window);
        self.rebalance(spawn);
    }

    /// The watcher of `key` started as `generation` stopped on its own. If it is still
    /// that host's watcher — not one a scope change already replaced — the leases it
    /// served end.
    pub(crate) fn watch_ended(&mut self, key: &Path, generation: u64, spawn: SpawnFn<'_, H>) {
        if self.watches.get(key).map(|w| w.generation) != Some(generation) {
            return;
        }
        self.watches.remove(key);
        self.freed = true;
        let ids: Vec<u64> = self
            .leases
            .iter()
            .filter(|(_, l)| self.host_of(&l.key) == key)
            .map(|(id, _)| *id)
            .collect();
        self.end_leases(&ids, spawn);
    }

    /// The held leases `keep` picks.
    pub(crate) fn leases_where(&self, keep: impl Fn(&LeaseView) -> bool) -> Vec<LeaseView> {
        self.leases
            .iter()
            .map(|(id, l)| LeaseView {
                id: *id,
                path: l.spelled.clone(),
                recursive: l.recursive,
                focus: l.focus.clone(),
                authority: l.authority.clone(),
            })
            .filter(|view| keep(view))
            .collect()
    }

    /// Record what authorizes lease `id` now (a re-check found another).
    pub(crate) fn set_authority(&mut self, id: u64, authority: PathBuf) {
        if let Some(lease) = self.leases.get_mut(&id) {
            lease.authority = authority;
        }
    }

    /// End leases `ids` — what authorized them is gone, or nothing can serve them. Each
    /// is reported (`take_news`).
    pub(crate) fn end_leases(&mut self, ids: &[u64], spawn: SpawnFn<'_, H>) {
        for id in ids {
            if let Some(lease) = self.leases.remove(id) {
                self.ended.push(Ended {
                    window: lease.window,
                    lease: *id,
                });
            }
        }
        self.rebalance(spawn);
    }

    /// Bring the watchers in line with the leases. A host that cannot start ends the
    /// leases it would serve, which can re-home others; repeated until none fails.
    fn rebalance(&mut self, spawn: SpawnFn<'_, H>) {
        let hosts = self.hosts();
        let failed = self.start(&hosts, spawn);
        self.drop_unneeded(&hosts);
        self.end_failed(failed, spawn);
    }

    fn end_failed(&mut self, failed: Vec<PathBuf>, spawn: SpawnFn<'_, H>) {
        if failed.is_empty() {
            return;
        }
        let ids: Vec<u64> = self
            .leases
            .iter()
            .filter(|(_, l)| failed.contains(&self.host_of(&l.key)))
            .map(|(id, _)| *id)
            .collect();
        self.end_leases(&ids, spawn);
    }

    /// The host of every lease, and the leases each serves.
    fn hosts(&self) -> BTreeMap<PathBuf, Vec<u64>> {
        let mut hosts: BTreeMap<PathBuf, Vec<u64>> = BTreeMap::new();
        for (id, lease) in &self.leases {
            hosts.entry(self.host_of(&lease.key)).or_default().push(*id);
        }
        for ids in hosts.values_mut() {
            ids.sort_unstable();
        }
        hosts
    }

    /// The host of a lease on `key`: the innermost folder holding `key` (itself
    /// included) that a recursive lease asks for, or `key` if there is none — so a
    /// recursive lease hosts itself.
    fn host_of(&self, key: &Path) -> PathBuf {
        self.leases
            .values()
            .filter(|l| l.recursive && key.starts_with(&l.key))
            .map(|l| &l.key)
            .max_by_key(|k| k.components().count())
            .unwrap_or(&key.to_path_buf())
            .clone()
    }

    /// Give each host its sets, then start a watcher where it has none or one of the
    /// wrong scope — the old one, if any, is dropped only by the replacement. Answers
    /// the hosts that could not start. A narrowing that fails keeps the wider watcher:
    /// more events, none missed.
    fn start(
        &mut self,
        hosts: &BTreeMap<PathBuf, Vec<u64>>,
        spawn: SpawnFn<'_, H>,
    ) -> Vec<PathBuf> {
        let mut failed = Vec::new();
        for (host, ids) in hosts {
            let recursive = ids.iter().any(|id| self.leases[id].recursive);
            let (focus, spellings) = self.sets(ids);
            if let Some(watch) = self.watches.get(host) {
                write(&watch.focus, focus.clone());
                write(&watch.spellings, spellings.clone());
                if watch.recursive == recursive {
                    continue;
                }
            }
            // A spelling that resolves to the host now: a folder swapped for a link
            // elsewhere since its leases were taken is not watched through them.
            let root = ids
                .iter()
                .map(|id| &self.leases[id])
                .find(|l| &l.key == host && &canonical(&l.spelled) == host)
                .map(|l| l.spelled.clone());
            let generation = self.next_generation;
            self.next_generation += 1;
            let shared = self
                .watches
                .get(host)
                .map(|w| (Arc::clone(&w.focus), Arc::clone(&w.spellings)));
            let (focus_set, spelling_set) =
                shared.unwrap_or_else(|| (Arc::new(focus.into()), Arc::new(spellings.into())));
            let started = root.ok_or(()).and_then(|root| {
                spawn(&WatchSpec {
                    key: host.clone(),
                    root,
                    recursive,
                    generation,
                    focus: Arc::clone(&focus_set),
                    spellings: Arc::clone(&spelling_set),
                })
                .map_err(|_| ())
            });
            match started {
                Ok(handle) => {
                    self.watches.insert(
                        host.clone(),
                        Watch {
                            _handle: handle,
                            recursive,
                            generation,
                            focus: focus_set,
                            spellings: spelling_set,
                        },
                    );
                }
                Err(()) if self.watches.get(host).is_some_and(|w| w.recursive) => {}
                Err(()) => failed.push(host.clone()),
            }
        }
        failed
    }

    fn drop_unneeded(&mut self, hosts: &BTreeMap<PathBuf, Vec<u64>>) {
        let before = self.watches.len();
        self.watches.retain(|key, _| hosts.contains_key(key));
        self.freed |= self.watches.len() < before;
    }

    /// The focus files (as spelled and as resolved) and the spellings (canonical
    /// folder, folder as spelled) of leases `ids`.
    fn sets(&self, ids: &[u64]) -> (HashSet<PathBuf>, Vec<(PathBuf, PathBuf)>) {
        let mut focus = HashSet::new();
        let mut spellings = Vec::new();
        for lease in ids.iter().map(|id| &self.leases[id]) {
            if let Some(file) = &lease.focus {
                focus.insert(PathBuf::from(file));
                if let Ok(c) = crate::context::manager::resolve_canonical(file) {
                    focus.insert(c);
                }
            }
            let pair = (lease.key.clone(), PathBuf::from(&lease.spelled));
            if !spellings.contains(&pair) {
                spellings.push(pair);
            }
        }
        (focus, spellings)
    }
}

fn write<T>(lock: &std::sync::RwLock<T>, value: T) {
    if let Ok(mut held) = lock.write() {
        *held = value;
    }
}

fn canonical(path: &str) -> PathBuf {
    crate::context::manager::resolve_canonical(path).unwrap_or_else(|_| PathBuf::from(path))
}

#[cfg(test)]
#[path = "watch_registry_tests.rs"]
mod tests;
