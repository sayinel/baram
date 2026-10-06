//! §29 Paths the file watcher reported, brought into the link indexes that
//! contain them (issue 790). The graph only reads the index now, so this is
//! how a write that did not go through a save — another program, or an in-app
//! writer that never calls `update_file_index` — reaches it.
//!
//! The frontend sends what the watcher saw and nothing else; the rule for
//! what each path means lives here:
//!
//! - a path a vault build would not walk (a hidden component, `SKIP_DIRS`) is
//!   ignored;
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
//! about 300 ms of batching later — #823 의 후속 sub-issue tracks moving that
//! guarantee into Rust for every writer.

use std::collections::HashMap;
use std::path::{Component, Path};

use crate::context::manager::{resolve_canonical, Registered};
use crate::context::ContextManager;

use super::build::{prepare_index_build, rebuild_and_publish};
use super::keys::buildable;
use super::query::update_file_index_inner;
use super::state::{LinkIndexState, Mutation};

/// What a sync did: how many paths reached an index, and which could not be
/// applied — for the caller to retry. A failed rebuild reports every path that
/// asked for it.
#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedSync {
    pub applied: u32,
    pub failed: Vec<String>,
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
    for path in paths {
        let Ok(canonical) = resolve_canonical(path) else {
            failed.push(path.clone());
            continue;
        };
        let contexts: Vec<Registered> = buildable(&ctx_mgr.contexts_containing(path).await)
            .into_iter()
            .filter(|ctx| walked_under(&ctx.canonical_path, &canonical))
            .collect();
        if contexts.is_empty() {
            continue;
        }
        applied += 1;
        let structural: Vec<Registered> = match tokio::fs::metadata(path).await {
            Ok(meta) if meta.is_dir() => {
                if holds_files(path).await {
                    contexts
                } else {
                    Vec::new()
                }
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
                        for ctx in &contexts {
                            state.apply(&ctx.info.path, vec![m.clone()]).await;
                        }
                    }
                    Err(_) => failed.push(path.clone()),
                }
                continue;
            }
            Err(_) => {
                let mut holding = Vec::new();
                for ctx in contexts {
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
    WatchedSync { applied, failed }
}

/// The markdown rule a vault build reads notes by (`fs::collect_md_files`).
fn is_note(path: &str) -> bool {
    path.ends_with(".md") || path.ends_with(".markdown")
}

/// Whether a vault build rooted at `root` would walk to `canonical`: no
/// component below the root is hidden or one of `SKIP_DIRS` — the rule
/// `fs::collect_md_files` and `fs::collect_all_files` apply on the way down.
fn walked_under(root: &Path, canonical: &Path) -> bool {
    let Ok(relative) = canonical.strip_prefix(root) else {
        return false;
    };
    relative.components().all(|c| match c {
        Component::Normal(name) => {
            let name = name.to_string_lossy();
            !name.starts_with('.') && !crate::fs::SKIP_DIRS.contains(&name.as_ref())
        }
        _ => true,
    })
}

/// Whether a directory holds any file a vault build would register.
async fn holds_files(dir: &str) -> bool {
    let mut files = Vec::new();
    crate::fs::collect_all_files(Path::new(dir), &mut files)
        .await
        .is_ok()
        && !files.is_empty()
}
