//! §393 Bring the link index up to date with paths the file watcher reported (spec 0072
//! §5.4, D16). The frontend batches the watcher's events (`use-vault-change-sync`) and calls
//! `sync_index_paths`; the answer — the contexts whose reads may have changed — is what it
//! announces as `vault:changed`.
//!
//! The watcher pairs nothing and filters little (`fs::start_watching`), so each path is
//! judged by what it is on disk NOW under the walkers' rules (`fs::walk_rules`), not by the
//! event that reported it — except `changed_only`, which keeps a directory's own metadata
//! change from refilling the whole directory.

use super::keys::{buildable, owning_contexts};
use super::state::{LinkIndexState, Mutation};
use crate::context::manager::{resolve_canonical, Registered};
use crate::context::ContextManager;
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

/// One path the watcher reported. `changed_only`: every event for it in the batch was
/// `file:changed`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPath {
    pub path: String,
    pub changed_only: bool,
}

/// The contexts whose reads may have changed — their ids, sorted. See the module doc.
pub(crate) async fn sync_index_paths_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    paths: &[SyncPath],
) -> Result<Vec<String>, String> {
    let mut announced: BTreeSet<String> = BTreeSet::new();
    // Phase 1: everything that is on disk now. A missing path is only collected, per holding
    // context (keyed by its registered path), for phase 2.
    let mut removed: BTreeMap<String, (String, Vec<Mutation>)> = BTreeMap::new();
    for entry in paths {
        let contexts = holding(ctx_mgr, &entry.path).await;
        if contexts.is_empty() {
            continue;
        }
        let Some(planned) = plan(entry).await else {
            continue;
        };
        match planned {
            Planned::Apply(mutations, rule) => {
                for ctx in &contexts {
                    let changed = state.apply(&ctx.info.path, mutations.clone()).await;
                    if rule.announces(changed) {
                        announced.insert(ctx.info.id.clone());
                    }
                }
            }
            Planned::Removed(tree) => {
                for ctx in &contexts {
                    removed
                        .entry(ctx.info.path.clone())
                        .or_insert_with(|| (ctx.info.id.clone(), Vec::new()))
                        .1
                        .push(tree.clone());
                }
            }
        }
    }
    // Phase 2: the missing paths, ONE removal per context — a scan of the index per path
    // measured ~1.2 ms on an 11,000-note index, so 1,000 deleted notes (`rm -rf`, a checkout)
    // were over a second. Running them after the rest is safe: a missing path P cannot have a
    // descendant updated in phase 1, since a descendant existing means P exists.
    for (key, (id, trees)) in removed {
        let changed = state
            .apply(&key, vec![Mutation::merge_removals(trees)])
            .await;
        if Announce::UnlessUnchanged.announces(changed) {
            announced.insert(id);
        }
    }
    Ok(announced.into_iter().collect())
}

/// What `plan` decided for one path.
enum Planned {
    /// Mutations to apply at once, and when they are news.
    Apply(Vec<Mutation>, Announce),
    /// The path is gone: a `RemoveTree`, merged with the batch's others in phase 2.
    Removed(Mutation),
}

/// When a context's id goes into the answer, given what its live index reported (`apply`).
enum Announce {
    /// The path is a note or a file now: tags, tasks and search read it from disk and a
    /// target may resolve differently, whatever the live index says.
    Always,
    /// A missing path, or a directory with nothing in it: unless the live index KNOWS nothing
    /// was there. With no live index it cannot know, and a missing signal is worse than an
    /// extra one (spec 0072 §5.4) — tags, tasks and search read the disk whatever the link
    /// index holds.
    UnlessUnchanged,
}

impl Announce {
    fn announces(&self, changed: Option<bool>) -> bool {
        match self {
            Announce::Always => true,
            Announce::UnlessUnchanged => changed != Some(false),
        }
    }
}

/// What a path is on disk now, by the walkers' rules: `symlink_metadata`, so a link is not
/// followed. The build never indexes one (`DirEntry::metadata`), and treating a link as
/// missing would canonicalise THROUGH it and remove its target (plan 0122 P4).
enum OnDisk {
    Note(String),
    OtherFile,
    Directory,
    Missing,
    LeaveAlone,
}

async fn on_disk(path: &str) -> OnDisk {
    let meta = match tokio::fs::symlink_metadata(path).await {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return OnDisk::Missing,
        Err(e) => {
            log::warn!("§393 sync_index_paths: {path} left as it was: {e}");
            return OnDisk::LeaveAlone;
        }
    };
    if meta.is_dir() {
        return OnDisk::Directory;
    }
    if !meta.is_file() {
        return OnDisk::LeaveAlone;
    }
    if !is_note(Path::new(path)) {
        return OnDisk::OtherFile;
    }
    // Present but unreadable (permissions, not UTF-8): the index keeps what it knew, as
    // `update_file_index_inner` does — neither an empty note nor a removal is the truth.
    match tokio::fs::read_to_string(path).await {
        Ok(content) => OnDisk::Note(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => OnDisk::Missing,
        Err(e) => {
            log::warn!("§393 sync_index_paths: {path} left as it was: {e}");
            OnDisk::LeaveAlone
        }
    }
}

/// The directory contexts holding `path`, minus those under whose root it is hidden or in a
/// `SKIP_DIRS` directory — judged on the canonical path against each root's canonical path,
/// so the watcher's spelling (`/var/…` for `/private/var/…`) does not matter. Touches the
/// disk only through `resolve_canonical`'s stat: a path no directory context holds is
/// dropped before anything walks it.
async fn holding(ctx_mgr: &ContextManager, path: &str) -> Vec<Registered> {
    let Ok(canonical) = resolve_canonical(path) else {
        return Vec::new();
    };
    buildable(&owning_contexts(ctx_mgr, path).await)
        .into_iter()
        .filter(|ctx| {
            canonical
                .strip_prefix(&ctx.canonical_path)
                .is_ok_and(|relative| !crate::fs::is_skipped_relative(relative))
        })
        .collect()
}

#[cfg(test)]
thread_local! {
    /// How many directories `refill` walked on this thread. `#[tokio::test]` runs on a
    /// current-thread runtime, so a test reads its own count (spec 0072 §8: a path no
    /// directory context holds is never walked).
    pub(super) static WALKS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

fn is_note(path: &Path) -> bool {
    path.file_name()
        .is_some_and(|name| crate::fs::is_note_name(&name.to_string_lossy()))
}

/// The mutations for one path and when they are news. `None`: leave the index alone — a
/// changed-only directory, a link or special file, an unreadable note, or a path whose
/// mutation cannot be built (no existing ancestor, plan 0122 P7).
async fn plan(entry: &SyncPath) -> Option<Planned> {
    let path = entry.path.as_str();
    let built = match on_disk(path).await {
        OnDisk::LeaveAlone => return None,
        OnDisk::Directory if entry.changed_only => return None,
        OnDisk::Note(content) => {
            Mutation::update(path, content).map(|m| Planned::Apply(vec![m], Announce::Always))
        }
        OnDisk::OtherFile => {
            Mutation::target(path).map(|m| Planned::Apply(vec![m], Announce::Always))
        }
        OnDisk::Directory => refill(path).await,
        OnDisk::Missing => Mutation::remove_tree(path).map(Planned::Removed),
    };
    match built {
        Ok(planned) => Some(planned),
        Err(e) => {
            log::warn!("§393 sync_index_paths: {path} left as it was: {e}");
            None
        }
    }
}

/// A directory as it is now: what the index held under it goes, then what the walk finds
/// comes back — one batch, so a folder replaced under the same name inside one watcher batch
/// (`mv X …; mv Y X`) loses its old children (spec 0072 §5.4). One walk with
/// `collect_all_files`: its notes are exactly what `collect_md_files` would collect (plan
/// 0122 P5, pinned by `fs::walk_rules`' tests).
async fn refill(dir: &str) -> Result<Planned, String> {
    let mut mutations = vec![Mutation::remove_tree(dir)?];
    #[cfg(test)]
    WALKS.with(|walks| walks.set(walks.get() + 1));
    let mut files = Vec::new();
    crate::fs::collect_all_files(Path::new(dir), &mut files)
        .await
        .map_err(|e| e.to_string())?;
    let announce = if files.is_empty() {
        Announce::UnlessUnchanged
    } else {
        Announce::Always
    };
    for file in files {
        let Some(path) = file.to_str() else {
            // `LinkIndex::build` keeps such a name (`to_string_lossy`), but the index keys
            // are `String`s and `Mutation`s take `&str`, so this file is missing from the
            // refilled directory until a build.
            log::warn!(
                "§393 sync_index_paths: {} has a non-UTF-8 name and is not indexed",
                file.display()
            );
            continue;
        };
        if is_note(&file) {
            // An unreadable note becomes an EMPTY `Update`: it stays a link TARGET, as the
            // build leaves it (it registers every note before reading), so `[[that note]]`
            // keeps resolving. Unlike the build, which inserts nothing into `outgoing` for it,
            // this inserts `outgoing[path] = []` — the note shows as a graph node and
            // `outgoing_resolved` returns `Some([])`.
            let content = tokio::fs::read_to_string(&file).await.unwrap_or_else(|e| {
                log::warn!(
                    "§393 sync_index_paths: {path} is unreadable ({e}); indexed without links"
                );
                String::new()
            });
            mutations.push(Mutation::update(path, content)?);
        } else {
            mutations.push(Mutation::target(path)?);
        }
    }
    Ok(Planned::Apply(mutations, announce))
}
