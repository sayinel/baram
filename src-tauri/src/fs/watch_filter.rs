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

/// The files open in the editor, each as the frontend spelled it and as it resolves —
/// the watcher reports paths in the spelling the OS gives (on macOS the canonical one).
type OpenFiles = Arc<RwLock<HashSet<PathBuf>>>;
static OPEN_FILES: LazyLock<OpenFiles> = LazyLock::new(OpenFiles::default);

/// Replace the set of open files every watcher consults (`set_open_files`).
pub fn set_open_files(paths: &[String]) {
    replace_open_files(&OPEN_FILES, paths);
}

/// A path that is not an absolute file path (an untitled or plugin tab) is skipped
/// rather than refusing the call, which would leave every open file without its events.
fn replace_open_files(open: &OpenFiles, paths: &[String]) {
    let mut set = HashSet::new();
    for p in paths.iter().filter(|p| super::validate_path(p).is_ok()) {
        set.insert(PathBuf::from(p));
        if let Ok(canonical) = crate::context::manager::resolve_canonical(p) {
            set.insert(canonical);
        }
    }
    if let Ok(mut open) = open.write() {
        *open = set;
    }
}

/// The filesystem reads routing needs. A trait so the tests can count them.
pub(crate) trait Probe {
    fn is_dir(&self, path: &Path) -> bool;
    fn exists(&self, path: &Path) -> bool;
    fn mtime(&self, path: &Path) -> u64;
}

pub(crate) struct RealProbe;

impl Probe for RealProbe {
    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }
    fn exists(&self, path: &Path) -> bool {
        path.exists()
    }
    fn mtime(&self, path: &Path) -> u64 {
        super::mtime_ms(path)
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

/// The drop rule of one watched root.
pub(crate) struct WatchFilter {
    root: PathBuf,
    exclusion: VaultExclusion,
    open: OpenFiles,
}

impl WatchFilter {
    pub(crate) fn new(root: &Path) -> Self {
        Self::with_open_files(root, Arc::clone(&OPEN_FILES))
    }

    fn with_open_files(root: &Path, open: OpenFiles) -> Self {
        Self {
            root: root.to_path_buf(),
            exclusion: load_or_defaults(root),
            open,
        }
    }

    /// Whether `path`'s event is dropped. No filesystem read on the way: the walk's
    /// rule for the folders above it, the matcher alone for the entry itself.
    fn drops(&self, path: &Path) -> bool {
        if self.open.read().is_ok_and(|open| open.contains(path)) {
            return false;
        }
        let folders_skipped = path
            .parent()
            .is_some_and(|parent| self.exclusion.walk_skips(parent, true));
        folders_skipped || self.exclusion.excludes_entry(path, false)
    }

    /// Reload the matcher when the event names this root's `.baramignore`.
    fn notice(&mut self, path: &Path) {
        if path.file_name().is_some_and(|n| n == BARAMIGNORE)
            && path.parent().is_some_and(|p| self.is_root(p))
        {
            self.exclusion = load_or_defaults(&self.root);
        }
    }

    fn is_root(&self, dir: &Path) -> bool {
        dir == self.root
            || std::fs::canonicalize(&self.root).is_ok_and(|canonical| dir == canonical)
    }

    /// The webview events `event` becomes. Dropped paths are decided before `probe`
    /// is asked anything.
    pub(crate) fn route(&mut self, event: &Event, probe: &impl Probe) -> Vec<Emit> {
        let mut out = Vec::new();
        for event_path in &event.paths {
            let path_str = event_path.to_string_lossy().to_string();
            // Atomic-write intermediates.
            if path_str.ends_with(".tmp") {
                continue;
            }
            self.notice(event_path);
            if self.drops(event_path) {
                continue;
            }
            match event.kind {
                EventKind::Create(_) => out.push(created(event_path, path_str, probe)),
                // macOS FSEvents reports an atomic-write rename and an external move
                // as Modify(Name), not Create/Remove.
                EventKind::Modify(ModifyKind::Name(_)) => {
                    if probe.exists(event_path) {
                        out.push(created(event_path, path_str, probe));
                    } else {
                        out.push(Emit::Deleted { path: path_str });
                    }
                }
                EventKind::Modify(_) => {
                    let mtime = probe.mtime(event_path);
                    out.push(Emit::Changed {
                        path: path_str,
                        mtime,
                        origin: origin(event_path, mtime),
                    });
                }
                EventKind::Remove(_) => out.push(Emit::Deleted { path: path_str }),
                _ => {}
            }
        }
        out
    }
}

fn created(event_path: &Path, path: String, probe: &impl Probe) -> Emit {
    let is_dir = probe.is_dir(event_path);
    Emit::Created {
        path,
        is_dir,
        origin: origin(event_path, probe.mtime(event_path)),
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
