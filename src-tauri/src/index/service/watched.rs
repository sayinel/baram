//! §29 Paths the file watcher reported, brought into the link indexes that
//! contain them (issue 790). The graph only reads the index now, so this is
//! how a write that did not go through a save — another program, or an in-app
//! writer that never calls `update_file_index` — reaches it.
//!
//! The frontend sends what the watcher saw and nothing else; the rule for
//! what each path means lives here:
//!
//! - a file reported in two spellings (`/var/…` and `/private/var/…`, #797: the watcher
//!   reports an event once per spelling its leases registered) is taken once, under the
//!   first; the others count neither as applied nor as failed;
//! - a path a vault build would not walk is ignored — judged per containing
//!   context by that root's `VaultExclusion` (issue 794: a hidden component, the
//!   default list, the root's `.baramignore`), the judgement the build's walk uses.
//!   A context whose `.baramignore` cannot be used gets nothing and the path is
//!   reported failed, as a build of that context fails: never judged by the
//!   defaults alone;
//! - an existing note is re-read through `update_file_index_inner`;
//! - an existing non-markdown file is registered as a link target (§278);
//! - an existing directory with files in it — moved in from elsewhere —
//!   rebuilds every context containing it, because its files arrive without
//!   events of their own;
//! - a vanished path is removed, unless an index still holds something below
//!   it: then it was a directory and those contexts rebuild. That is judged
//!   from the index, not from any tree the frontend holds.
//!
//! Rebuilds do not coalesce: a build that started before the directory moved
//! read the old layout, and publishing it would satisfy this request with a
//! state older than the event (the namespace rename's reason, too).
//!
//! What this does not give: an index fresh at the moment a rename judges. A
//! write lands in the index only when the watcher's event has travelled here,
//! about 300 ms of batching later — #824 tracks moving that guarantee into
//! Rust for every writer.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::context::manager::{resolve_canonical, Registered};
use crate::context::ContextManager;
use crate::fs::VaultExclusion;

use super::build::{prepare_index_build, rebuild_and_publish};
use super::keys::buildable;
use super::query::update_file_index_inner;
use super::state::{LinkIndexState, Mutation};

/// What a sync did: how many files reached an index, and which paths could not
/// be applied — for the caller to retry. A failed rebuild reports every path that
/// asked for it. `distinct` is how many files the paths named, each spelling of
/// one counted once.
#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedSync {
    pub applied: u32,
    pub failed: Vec<String>,
    pub distinct: u32,
}

/// Bring `paths` into every index containing them.
pub(crate) async fn sync_watched_paths_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    paths: &[String],
) -> WatchedSync {
    let mut applied: u32 = 0;
    let mut failed: Vec<String> = Vec::new();
    // Key → (the registration to rebuild, the paths that asked for it).
    let mut rebuilds: HashMap<String, (Registered, Vec<String>)> = HashMap::new();
    // Key → that root's matcher, read once per sync; `None` when its
    // `.baramignore` cannot be used.
    let mut exclusions: HashMap<String, Option<VaultExclusion>> = HashMap::new();
    let mut seen: HashSet<std::path::PathBuf> = HashSet::new();
    for path in paths {
        let Ok(canonical) = resolve_canonical(path) else {
            failed.push(path.clone());
            continue;
        };
        if !seen.insert(canonical.clone()) {
            continue;
        }
        let metadata = tokio::fs::metadata(path).await;
        let is_dir = metadata.as_ref().is_ok_and(|m| m.is_dir());
        let mut contexts: Vec<(Registered, VaultExclusion)> = Vec::new();
        for ctx in buildable(&ctx_mgr.contexts_containing(path).await) {
            let exclusion = exclusions
                .entry(ctx.info.path.clone())
                .or_insert_with(|| VaultExclusion::load(Path::new(&ctx.info.path)).ok());
            match exclusion {
                None => failed.push(path.clone()),
                Some(exclusion) if !exclusion.walk_skips(&canonical, is_dir) => {
                    contexts.push((ctx, exclusion.clone()));
                }
                Some(_) => {}
            }
        }
        if contexts.is_empty() {
            continue;
        }
        applied += 1;
        let structural: Vec<Registered> = match metadata {
            Ok(meta) if meta.is_dir() => {
                let mut holding = Vec::new();
                for (ctx, exclusion) in contexts {
                    if holds_files(path, &exclusion).await {
                        holding.push(ctx);
                    }
                }
                holding
            }
            Ok(_) if is_note(path) => {
                if update_file_index_inner(state, ctx_mgr, path).await.is_err() {
                    failed.push(path.clone());
                }
                continue;
            }
            Ok(_) => {
                match Mutation::target(path) {
                    Ok(m) => {
                        for (ctx, _) in &contexts {
                            state.apply(&ctx.info.path, vec![m.clone()]).await;
                        }
                    }
                    Err(_) => failed.push(path.clone()),
                }
                continue;
            }
            Err(_) => {
                let mut holding = Vec::new();
                for (ctx, _) in contexts {
                    if state
                        .holds_under(&ctx.info.path, ctx.incarnation, &canonical)
                        .await
                    {
                        holding.push(ctx);
                    }
                }
                if holding.is_empty() {
                    // A file: the single-file path removes a note or a target.
                    if update_file_index_inner(state, ctx_mgr, path).await.is_err() {
                        failed.push(path.clone());
                    }
                    continue;
                }
                holding
            }
        };
        for ctx in structural {
            rebuilds
                .entry(ctx.info.path.clone())
                .or_insert_with(|| (ctx, Vec::new()))
                .1
                .push(path.clone());
        }
    }
    for (key, (_, asked)) in rebuilds {
        let rebuilt = match prepare_index_build(state, ctx_mgr, &key).await {
            Ok(target) => rebuild_and_publish(state, &target, &key, false)
                .await
                .is_ok(),
            Err(_) => false,
        };
        if !rebuilt {
            failed.extend(asked);
        }
    }
    failed.sort();
    failed.dedup();
    WatchedSync {
        applied,
        failed,
        distinct: seen.len() as u32,
    }
}

/// The markdown rule a vault build reads notes by (`fs::collect_md_files`).
fn is_note(path: &str) -> bool {
    path.ends_with(".md") || path.ends_with(".markdown")
}

/// Whether a directory holds any file a vault build would register.
async fn holds_files(dir: &str, exclusion: &VaultExclusion) -> bool {
    let mut files = Vec::new();
    crate::fs::collect_all_files(Path::new(dir), exclusion, &mut files)
        .await
        .is_ok()
        && !files.is_empty()
}
