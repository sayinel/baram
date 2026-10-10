// §3.2 Which watcher events reach the webview (issue 795).
//
// The watcher sees every write below the folder it watches — a cold `cargo build`
// inside a vault writes thousands of files under `target/`. Each event that got
// through used to cost a metadata read here and one IPC event to the webview, whose
// filter then threw build output away. This decides, BEFORE any metadata read, which
// events to drop, by the same rule the vault walk uses: `VaultExclusion`, judged
// relative to the watched root — so a vault whose root folder is itself named `build`
// keeps its events, and `!build/` in `.baramignore` lets a build folder's back in.
//
// Two departures from the walk, both deliberate:
//
// 1. A file the user has OPEN passes whatever folder it is in. `file:changed` is how
//    the editor learns that an open file changed on disk — the reload, the conflict
//    modal and the auto-save guard depend on it — and an atomic replace of that file
//    arrives as a rename, so every event kind for an open path passes, not only
//    `file:changed`. The frontend registers its open files (`set_open_files`).
// 2. Hidden NAMES are dropped only as folders. The walk skips a hidden file too, but
//    the frontend keeps hidden files (`.notes.md`) and this keeps feeding it the same
//    events it had: an event's last component is judged only by the matcher.
//
// One matcher per watcher, loaded when the watch starts and again whenever an event
// names `<root>/.baramignore`. A `.baramignore` that cannot be used (the walkers
// refuse to run) leaves the watcher on the default list alone: the flood must stay
// out either way, and a folder the broken file meant to bring back only costs events
// the frontend already drops.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, RwLock};

use notify::event::ModifyKind;
use notify::{Event, EventKind};

use super::exclusion::{VaultExclusion, BARAMIGNORE};

/// What the watchers know of the editor's open files — each as the frontend spelled it
/// and as it resolves, since the watcher reports paths in the spelling the OS gives
/// (on macOS the canonical one).
///
/// `Unknown` until the first `set_open_files` succeeds, and again after any call that
/// fails. While it is unknown, no path can be ruled out as open, so the filter drops
/// nothing but Baram's own write intermediates: a registration that did not land must
/// never leave a filtered watcher hiding an open file's changes (issue 795). The cost
/// is the build-output events this filter exists to drop, for as long as it lasts.
#[derive(Debug, Default)]
enum OpenSet {
    #[default]
    Unknown,
    Known(HashSet<PathBuf>),
}

type OpenFiles = Arc<RwLock<OpenSet>>;
static OPEN_FILES: LazyLock<OpenFiles> = LazyLock::new(OpenFiles::default);

/// The most paths one `set_open_files` call may name — far above any number of open
/// tabs, low enough that the synchronous canonicalisation stays bounded.
pub const MAX_OPEN_FILES: usize = 2_000;

/// The most bytes the paths of one `set_open_files` call may add up to.
pub const MAX_OPEN_FILES_BYTES: usize = 1024 * 1024;

/// Replace the set of open files every watcher consults (`set_open_files`).
pub fn set_open_files(paths: &[String]) -> Result<(), String> {
    replace_open_files(&OPEN_FILES, paths)
}

/// A call over `MAX_OPEN_FILES` or `MAX_OPEN_FILES_BYTES` is refused before any path
/// is resolved, and leaves the set `Unknown` — not the previous set, which may lack a
/// file opened since. A path that is not an absolute file path (an untitled or plugin
/// tab) is skipped rather than refusing the call.
fn replace_open_files(open: &OpenFiles, paths: &[String]) -> Result<(), String> {
    let refuse = |reason: String| {
        if let Ok(mut state) = open.write() {
            *state = OpenSet::Unknown;
        }
        Err(format!("set_open_files: {reason}"))
    };
    if paths.len() > MAX_OPEN_FILES {
        return refuse(format!("{} paths, more than {MAX_OPEN_FILES}", paths.len()));
    }
    let bytes: usize = paths.iter().map(String::len).sum();
    if bytes > MAX_OPEN_FILES_BYTES {
        return refuse(format!(
            "{bytes} bytes of paths, more than {MAX_OPEN_FILES_BYTES}"
        ));
    }
    let mut set = HashSet::new();
    for p in paths.iter().filter(|p| super::validate_path(p).is_ok()) {
        set.insert(PathBuf::from(p));
        if let Ok(canonical) = crate::context::manager::resolve_canonical(p) {
            set.insert(canonical);
        }
    }
    match open.write() {
        Ok(mut state) => {
            *state = OpenSet::Known(set);
            Ok(())
        }
        Err(_) => Err("set_open_files: the open-file registry is poisoned".to_string()),
    }
}

/// One metadata read of a path that exists.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Stat {
    pub(crate) is_dir: bool,
    /// Milliseconds since the epoch; 0 when the OS gives no modification time.
    pub(crate) mtime: u64,
}

/// The filesystem read routing needs — one per routed path. A trait so the tests can
/// count it and stage a file that vanished.
pub(crate) trait Probe {
    /// `None` when the path is gone.
    fn stat(&self, path: &Path) -> Option<Stat>;
}

pub(crate) struct RealProbe;

impl Probe for RealProbe {
    fn stat(&self, path: &Path) -> Option<Stat> {
        let meta = std::fs::metadata(path).ok()?;
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as u64);
        Some(Stat {
            is_dir: meta.is_dir(),
            mtime,
        })
    }
}

/// Whether `path` is one of `fs::write_file`'s own intermediates,
/// `<target>.<32 hex digits>.tmp` — not any file a user named `*.tmp`.
fn is_write_intermediate(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    let Some(stem) = name.strip_suffix(".tmp") else {
        return false;
    };
    match stem.rsplit_once('.') {
        Some((target, id)) => {
            !target.is_empty()
                && id.len() == 32
                && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        }
        None => false,
    }
}

/// What one event becomes for the webview.
#[derive(Debug, PartialEq)]
pub(crate) enum Emit {
    Created {
        path: String,
        is_dir: bool,
        origin: &'static str,
    },
    Deleted {
        path: String,
    },
    Changed {
        path: String,
        mtime: u64,
        origin: &'static str,
    },
}

/// The files one watch is for — what its leases name as `focus` (issue 797), each as
/// spelled and as it resolves. Shared with `fs::watch_registry`, which updates it as
/// leases come and go.
pub(crate) type Focus = Arc<RwLock<HashSet<PathBuf>>>;

/// The folders the leases of one watch registered, each as (canonical, as spelled)
/// (#797). The watcher reports paths in the spelling the OS gives (on macOS
/// `/private/var/…` for a folder opened as `/var/…`), while the frontend compares paths
/// byte for byte with the ones it opened — so an event is reported once per spelling
/// whose folder holds it. A lease served by an ancestor's watcher registers its own
/// folder here.
pub(crate) type Spellings = Arc<RwLock<Vec<(PathBuf, PathBuf)>>>;

/// The drop rule of one watched root.
///
/// A recursive watch is a vault's: it judges by that vault's `VaultExclusion` and the
/// editor's open files (`set_open_files`). A non-recursive watch is a folder watched
/// for the files one tab or file window shows (#797): that folder is not a vault, so it
/// judges by the default list alone — no `.baramignore` read from, say, `$HOME` — and
/// its focus files are the open ones. Focus files count as open for a recursive watch
/// too.
pub(crate) struct WatchFilter {
    root: PathBuf,
    /// The root's canonical key (`with_host`).
    host: Option<PathBuf>,
    recursive: bool,
    exclusion: VaultExclusion,
    open: OpenFiles,
    focus: Focus,
    spellings: Spellings,
}

impl WatchFilter {
    /// The filter of a watch on `root` as spelled — for a vault, the root as the context
    /// registered it, so the root-relative judgement holds whichever spelling the
    /// watcher reports paths in (`VaultExclusion::relative`).
    pub(crate) fn for_watch(
        root: &Path,
        recursive: bool,
        focus: Focus,
        spellings: Spellings,
    ) -> Self {
        let mut filter = Self::with_open_files(root, recursive, Arc::clone(&OPEN_FILES), focus);
        filter.spellings = spellings;
        filter
    }

    fn with_open_files(root: &Path, recursive: bool, open: OpenFiles, focus: Focus) -> Self {
        Self {
            spellings: Spellings::default(),
            root: root.to_path_buf(),
            host: None,
            recursive,
            exclusion: if recursive {
                load_or_defaults(root)
            } else {
                VaultExclusion::defaults_only(root)
            },
            open,
            focus,
        }
    }

    /// Whether `path` may be open: a focus file of this watch — as reported, or read
    /// back to canonical through the spelling it came in — or, for a vault's watch, in
    /// the editor's open set, or that set is unknown.
    fn may_be_open(&self, path: &Path) -> bool {
        let canonical = self.canonical_of(path);
        if self
            .focus
            .read()
            .is_ok_and(|focus| focus.contains(path) || focus.contains(&canonical))
        {
            return true;
        }
        if !self.recursive {
            return false;
        }
        match self.open.read().as_deref() {
            Ok(OpenSet::Known(set)) => set.contains(path),
            Ok(OpenSet::Unknown) | Err(_) => true,
        }
    }

    /// Whether the event of `path`, not an open file, is dropped. No filesystem read
    /// on the way: the walk's rule for the folders above it, the matcher alone for the
    /// entry itself.
    fn drops(&self, path: &Path) -> bool {
        let folders_skipped = path
            .parent()
            .is_some_and(|parent| self.exclusion.walk_skips(parent, true));
        folders_skipped || self.exclusion.excludes_entry(path, false)
    }

    /// Reload the matcher when the event names this root's `.baramignore` — a vault's
    /// only; a non-recursive watch never reads one.
    fn notice(&mut self, path: &Path) {
        if self.recursive
            && path.file_name().is_some_and(|n| n == BARAMIGNORE)
            && path.parent().is_some_and(|p| self.is_root(p))
        {
            self.exclusion = load_or_defaults(&self.root);
        }
    }

    fn is_root(&self, dir: &Path) -> bool {
        dir == self.root
            || std::fs::canonicalize(&self.root).is_ok_and(|canonical| dir == canonical)
    }

    /// `route_identified` without the identities (the filter's own tests).
    #[cfg(test)]
    pub(crate) fn route(&mut self, event: &Event, probe: &impl Probe) -> Vec<Emit> {
        self.route_identified(event, probe)
            .into_iter()
            .map(|(_, emit)| emit)
            .collect()
    }

    /// The webview events `event` becomes, each tagged with the canonical identity of the
    /// watcher path it came from (`identity_of`), computed once before respelling — so
    /// every spelling it is reported in names the same file. Dropped paths are decided
    /// before `probe` is asked anything, and each routed path is read once: every event
    /// it yields describes that one snapshot, and a path gone by then becomes `Deleted`,
    /// never a change with no modification time.
    pub(crate) fn route_identified(
        &mut self,
        event: &Event,
        probe: &impl Probe,
    ) -> Vec<(PathBuf, Emit)> {
        let mut out = Vec::new();
        for event_path in &event.paths {
            let identity = self.identity_of(event_path);
            for emit in self.route_path(&event.kind, event_path, probe) {
                out.push((identity.clone(), emit));
            }
        }
        self.respell(out)
    }

    /// What one path of an event becomes.
    fn route_path(&mut self, kind: &EventKind, event_path: &Path, probe: &impl Probe) -> Vec<Emit> {
        let mut out = Vec::new();
        if is_write_intermediate(event_path) {
            return out;
        }
        self.notice(event_path);
        // A file that may be open passes whatever folder it is in.
        let open = self.may_be_open(event_path);
        if !open && self.drops(event_path) {
            return out;
        }
        let path = event_path.to_string_lossy().to_string();
        if matches!(*kind, EventKind::Remove(_)) {
            out.push(Emit::Deleted { path });
            return out;
        }
        if !matches!(*kind, EventKind::Create(_) | EventKind::Modify(_)) {
            return out;
        }
        let Some(stat) = probe.stat(event_path) else {
            out.push(Emit::Deleted { path });
            return out;
        };
        let origin = origin(event_path, stat.mtime);
        match *kind {
            EventKind::Create(_) => out.push(Emit::Created {
                path,
                is_dir: stat.is_dir,
                origin,
            }),
            // macOS FSEvents reports an atomic-write rename and an external move
            // as Modify(Name), not Create/Remove.
            EventKind::Modify(ModifyKind::Name(_)) => {
                out.push(Emit::Created {
                    path: path.clone(),
                    is_dir: stat.is_dir,
                    origin,
                });
                // Another program's atomic save of an OPEN file arrives as a
                // rename onto it. Only `file:changed` reaches the editor's reload
                // and conflict checks — `file:created` feeds the tree — so the
                // rename is reported as a change as well, from the same snapshot.
                // FSEvents also sent a Modify(Data) for the destination in the
                // replaces we measured, but nothing promises that flag; the
                // frontend handles each (path, mtime) once.
                if open {
                    out.push(Emit::Changed {
                        path,
                        mtime: stat.mtime,
                        origin,
                    });
                }
            }
            _ => out.push(Emit::Changed {
                path,
                mtime: stat.mtime,
                origin,
            }),
        }
        out
    }

    /// Each event once per registered spelling whose folder holds it, the path rebuilt
    /// below that spelling. The event's path is first read back to canonical through
    /// whichever spelling it came in. With no spelling holding it, the OS spelling stands.
    fn respell(&self, emits: Vec<(PathBuf, Emit)>) -> Vec<(PathBuf, Emit)> {
        let spellings = self.spellings.read().map(|s| s.clone()).unwrap_or_default();
        if spellings.is_empty() {
            return emits;
        }
        let mut out = Vec::new();
        for (identity, emit) in emits {
            let path = PathBuf::from(emit.path());
            let canonical = self.canonical_of(&path);
            let mut seen = HashSet::new();
            for (folder, spelled) in &spellings {
                let Ok(relative) = canonical.strip_prefix(folder) else {
                    continue;
                };
                let respelled = if relative.as_os_str().is_empty() {
                    spelled.clone()
                } else {
                    spelled.join(relative)
                };
                if seen.insert(respelled.clone()) {
                    out.push((
                        identity.clone(),
                        emit.with_path(respelled.to_string_lossy().into_owned()),
                    ));
                }
            }
            if seen.is_empty() {
                out.push((identity, emit));
            }
        }
        out
    }
}

impl WatchFilter {
    /// `path` read back to canonical through the registered spelling it lies under; as
    /// given when it lies under none.
    fn canonical_of(&self, path: &Path) -> PathBuf {
        self.through_spelling(path)
            .unwrap_or_else(|| path.to_path_buf())
    }

    /// §29 #824 `path` read back through the MOST SPECIFIC registered spelling holding
    /// it — spellings nest (a vault `/v` and a file window's `/v/link`, a link to
    /// `/v/sub`), and the first that holds a path is not the one it came through.
    fn through_spelling(&self, path: &Path) -> Option<PathBuf> {
        let spellings = self.spellings.read().ok()?;
        spellings
            .iter()
            .filter_map(|(canonical, spelled)| {
                let relative = path.strip_prefix(spelled).ok()?;
                Some((spelled.components().count(), canonical.join(relative)))
            })
            .max_by_key(|(depth, _)| *depth)
            .map(|(_, canonical)| canonical)
    }

    /// §29 #824 The canonical identity of a path this watcher reported, without the
    /// filesystem: through the most specific registered spelling, else from the host as
    /// watched onto its canonical key (`with_host`), else as the OS spelled it (FSEvents
    /// reports canonical paths).
    pub(crate) fn identity_of(&self, path: &Path) -> PathBuf {
        if let Some(canonical) = self.through_spelling(path) {
            return canonical;
        }
        match (&self.host, path.strip_prefix(&self.root)) {
            (Some(host), Ok(relative)) => host.join(relative),
            _ => path.to_path_buf(),
        }
    }

    /// The canonical key of the host this filter routes for: the root, as spelled,
    /// resolves to it.
    pub(crate) fn with_host(mut self, host: &Path) -> Self {
        self.host = Some(host.to_path_buf());
        self
    }
}

impl Emit {
    pub(crate) fn path(&self) -> &str {
        match self {
            Emit::Created { path, .. } | Emit::Deleted { path } | Emit::Changed { path, .. } => {
                path
            }
        }
    }

    fn with_path(&self, path: String) -> Emit {
        match self {
            Emit::Created { is_dir, origin, .. } => Emit::Created {
                path,
                is_dir: *is_dir,
                origin,
            },
            Emit::Deleted { .. } => Emit::Deleted { path },
            Emit::Changed { mtime, origin, .. } => Emit::Changed {
                path,
                mtime: *mtime,
                origin,
            },
        }
    }
}

/// §313 Whether the write was this app's own. An app save renames a temporary file
/// over the note, which macOS reports as `file:created` of the saved path, so the
/// created event carries the same judgement as `file:changed` (issue 790).
fn origin(path: &Path, mtime: u64) -> &'static str {
    if super::is_app_write(path, mtime) {
        "app"
    } else {
        "external"
    }
}

fn load_or_defaults(root: &Path) -> VaultExclusion {
    VaultExclusion::load(root).unwrap_or_else(|e| {
        log::warn!("§3.2 watcher: {e}; filtering by the default list alone");
        VaultExclusion::defaults_only(root)
    })
}

#[cfg(test)]
#[path = "watch_filter_tests.rs"]
mod tests;
