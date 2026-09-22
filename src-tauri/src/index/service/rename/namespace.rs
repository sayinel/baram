//! §61 Namespace (directory) rename with link updates — see rename/mod.rs.

use crate::context::manager::resolve_canonical;
use crate::context::ContextManager;
use crate::index::{collect_md_files, rewrite_relative_wikilinks, IndexStats};
use std::path::Path;

use super::super::build::{prepare_index_build, rebuild_and_publish, IndexBuildError};
use super::super::state::LinkIndexState;
use super::NamespaceRenameResult;

pub(crate) async fn rename_namespace_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    old_dir: &str,
    new_dir: &str,
    root_path: &str,
) -> Result<NamespaceRenameResult, String> {
    // The key and its generation first: a root outside every context has no
    // index to rebuild, and nothing is moved for it.
    let target = prepare_index_build(state, ctx_mgr, root_path)
        .await
        .map_err(|e| e.to_string())?;
    // Both ends of the move stay under the root that authorised it — the root
    // itself is not a namespace to rename. (`resolve_canonical` walks to an
    // existing ancestor, so a not-yet-existing new_dir resolves too.)
    let old_canonical = resolve_canonical(old_dir)?;
    let new_canonical = resolve_canonical(new_dir)?;
    if old_canonical == target.canonical
        || !old_canonical.starts_with(&target.canonical)
        || !new_canonical.starts_with(&target.canonical)
    {
        return Err(format!(
            "{old_dir} -> {new_dir} is not a move inside {root_path}"
        ));
    }
    if Path::new(new_dir).exists() {
        return Err(format!("{new_dir} already exists"));
    }
    // A symlink is not a namespace: moving the link entry moves none of the
    // files its target holds, while the checks below would reason about the
    // target. Rename the target directory instead.
    if std::fs::symlink_metadata(old_dir)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(format!(
            "{old_dir} is a symlink; rename the directory it points to"
        ));
    }
    // A directory that IS a registered context, or holds one, is not a
    // namespace to move: the registration would keep pointing at the old path
    // and its index would describe files that are no longer there (issue 591).
    // The user closes that context first. The reservation also keeps a
    // registration from landing at or below old_dir while the files move.
    let _reserved = ctx_mgr.reserve_subtree(&old_canonical).await?;
    // Every other directory context whose index covers the moved files —
    // nested roots that hold old_dir, and those that hold the destination and
    // will hold them from now on — must not keep the old layout as a live
    // index (issue 591). Resolved before the move, while old_dir exists (the
    // destination resolves on its existing parent).
    let mut others: Vec<String> = ctx_mgr
        .contexts_containing(old_dir)
        .await
        .into_iter()
        .chain(ctx_mgr.contexts_containing(new_dir).await)
        .map(|c| c.info.path)
        .filter(|k| *k != target.key)
        .collect();
    others.sort();
    others.dedup();
    let mut committed = commit_namespace_rename(old_dir, new_dir, root_path).await?;
    // Full rebuild (many files moved), under the same key every lookup derives,
    // never coalesced onto a publication that may predate the move.
    let rebuilt = rebuild_and_publish(state, &target, root_path, false).await;
    committed.index_rebuilt = settle_namespace_rebuild(state, &target.key, rebuilt).await;
    // The other covering indexes are dropped rather than rebuilt here: the
    // rename gate rebuilds each the next time it is needed, from its own
    // registered path.
    for key in &others {
        state.drop_index(key).await;
    }
    Ok(committed)
}

/// The filesystem half of a namespace rename: move the directory, then rewrite
/// the relative wikilinks that point into it.
///
/// The move comes FIRST, so that an `Err` from here still means nothing
/// changed; the referrers are then read, rewritten and written one at a time,
/// straight from what is on disk at that moment. A referrer that cannot be
/// written once the directory has moved is reported in `skipped_files`, never
/// left pointing at a `new_dir` that does not exist, and never held as a
/// snapshot that a write would later stamp over someone else's edit
/// (issue 594). The files outside `old_dir` are unaffected by the move, which
/// is what makes reading them afterwards correct.
pub(crate) async fn commit_namespace_rename(
    old_dir: &str,
    new_dir: &str,
    root_path: &str,
) -> Result<NamespaceRenameResult, String> {
    // 1. Collect all .md files in the vault
    let all_files = collect_md_files(root_path)
        .await
        .map_err(|e| e.to_string())?;

    // A file inside the directory being renamed moves with it. issue 595:
    // component-wise, as the crate compares paths everywhere else — a string
    // prefix with a hard-coded `/` matched nothing on Windows, where
    // `collect_md_files` spells paths with `\`, so `files_moved` read 0 and
    // every moved note was reported as unchecked once its old path failed
    // to read.
    let inside = |file: &str| Path::new(file).starts_with(Path::new(old_dir));

    // Count the markdown files that will be moved
    let files_moved = all_files.iter().filter(|f| inside(f)).count() as u32;

    // 2. Rename the directory — the last step that may fail with nothing done.
    crate::fs::rename_file(old_dir, new_dir)
        .await
        .map_err(|e| e.to_string())?;

    // 3. Rewrite the relative wikilinks of every file outside old_dir that
    //    point into it. Each file is read and written in turn; failures are
    //    reported, not returned. A file that cannot be READ was never
    //    inspected — it may or may not refer to the directory — so it is
    //    reported apart from a referrer whose rewrite failed.
    let mut updated_files = Vec::new();
    let mut skipped_files = Vec::new();
    let mut unchecked_files = Vec::new();

    for file_path in &all_files {
        // Skip files inside the directory being renamed (they move with it)
        if inside(file_path) {
            continue;
        }

        let content = match tokio::fs::read_to_string(file_path).await {
            Ok(c) => c,
            Err(e) => {
                log::warn!(
                    "§61 rename_namespace: {file_path} could not be read, so its links were not checked: {e}"
                );
                unchecked_files.push(file_path.clone());
                continue;
            }
        };

        let new_content = rewrite_relative_wikilinks(&content, file_path, old_dir, new_dir);
        if new_content == content {
            continue;
        }
        if let Err(e) = crate::fs::write_file(file_path, &new_content).await {
            log::warn!(
                "§61 rename_namespace: {old_dir} moved, but {file_path} could not be rewritten: {e}"
            );
            skipped_files.push(file_path.clone());
            continue;
        }
        updated_files.push(file_path.clone());
    }

    Ok(NamespaceRenameResult {
        updated_files,
        skipped_files,
        unchecked_files,
        files_moved,
        // Decided by `settle_namespace_rebuild` once the rebuild has run.
        index_rebuilt: false,
    })
}

/// Once a namespace rename has moved its files, the command reports the move
/// whatever the rebuild did — an `Err` from it means nothing was changed, and
/// the frontend relies on that. A rebuild invalidated by the context's removal
/// leaves the index to whoever registers the path next. A rebuild that FAILED
/// leaves an index describing the old layout: that index is dropped (the next
/// rename rebuilds through the gate) rather than trusted.
///
/// Returns whether the index under `key` now describes the new layout, for the
/// result's `index_rebuilt` (issue 594): `false` for both failure kinds, since
/// in neither case is there a live index to read.
pub(crate) async fn settle_namespace_rebuild(
    state: &LinkIndexState,
    key: &str,
    rebuilt: Result<IndexStats, IndexBuildError>,
) -> bool {
    match rebuilt {
        Ok(_) => true,
        Err(IndexBuildError::Invalidated) => false,
        Err(IndexBuildError::Failed(e)) => {
            log::warn!(
                "§61 rename_namespace: files moved, but the index rebuild failed ({e}); the stale index under {key} is dropped"
            );
            state.drop_index(key).await;
            false
        }
    }
}
