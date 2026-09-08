use crate::context::manager::{resolve_canonical, Registered};
use crate::context::ContextManager;
use crate::index::{
    collect_md_files, replace_block_id_refs, replace_wikilink_target, rewrite_relative_wikilinks,
    IndexStats,
};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::build::{
    ensure_indexes, prepare_index_build, read_indexes, rebuild_and_publish, IndexBuildError,
};
use super::keys::{buildable, keys_of, owning_contexts};
use super::state::{LinkIndexState, Mutation};

/// §33 Result of renaming a file (or a block ID) with wikilink updates.
///
/// An `Err` from these commands means nothing on disk changed. Everything that
/// fails AFTER the point of no return (the file has moved, a first referrer has
/// been rewritten) is reported here instead — the log is not a channel the
/// user can see (issue 594).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    pub updated_files: Vec<String>,
    /// Referring files the index named that could not be rewritten: unreadable,
    /// unwritable, or resolving outside the file's contexts. Their references
    /// still spell the old name.
    pub skipped_files: Vec<String>,
}

/// §61 Result of renaming a namespace (directory) with wikilink updates
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamespaceRenameResult {
    pub updated_files: Vec<String>,
    /// See [`RenameResult::skipped_files`].
    pub skipped_files: Vec<String>,
    pub files_moved: u32,
    /// `false`: the files moved, but the index under the root was not rebuilt —
    /// the rebuild failed and the stale index was dropped, or the context was
    /// removed while it ran. Backlinks read empty until the next build.
    pub index_rebuilt: bool,
}

/// Which of `keys` (containing indexes) cover `path`: a reference file outside
/// a nested root belongs to the enclosing index alone, and must not be written
/// into the nested one.
async fn keys_covering(ctx_mgr: &ContextManager, keys: &[String], path: &str) -> Vec<String> {
    let covering = keys_of(&owning_contexts(ctx_mgr, path).await);
    keys.iter()
        .filter(|k| covering.contains(k))
        .cloned()
        .collect()
}

/// Whether a canonical path lies under one of these directory contexts. The
/// renames confine every path they write to the file's own contexts: a
/// destination outside them, or a "referring file" an index names that now
/// resolves elsewhere (a symlink planted after the scan), is never written.
fn confined_by(canonical: &Path, dirs: &[Registered]) -> bool {
    dirs.iter()
        .any(|d| canonical.starts_with(&d.canonical_path))
}

/// Queue `mutation` for every key in `keys`. Spelling is decided later, per
/// index (`Mutation::apply_to`).
fn push_for_keys(
    per_key: &mut HashMap<String, Vec<Mutation>>,
    keys: &[String],
    mutation: &Mutation,
) {
    for key in keys {
        per_key
            .entry(key.clone())
            .or_default()
            .push(mutation.clone());
    }
}

pub(crate) async fn rename_file_with_links_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    old_path: &str,
    new_path: &str,
) -> Result<RenameResult, String> {
    // The contexts and their indexes first: nothing is renamed without them.
    // No context at all is a refusal (nothing is known about references); a
    // standalone File context (§89) has no directory index and no other file
    // to update, so the file is simply renamed.
    let contexts = owning_contexts(ctx_mgr, old_path).await;
    if contexts.is_empty() {
        return Err(format!("{old_path} is not inside any registered context"));
    }
    ensure_indexes(state, ctx_mgr, &contexts).await?;
    let dirs = buildable(&contexts);
    let keys = keys_of(&dirs);
    // The destination stays inside the file's contexts: under one of its
    // directory contexts, or — for a file opened on its own — in the same
    // directory. A rename that would carry the file out of every context is
    // refused before anything is written (fs_cmd's rename validates both ends
    // the same way).
    let old_identity = resolve_canonical(old_path)?;
    let renamed_identity = resolve_canonical(new_path)?;
    let allowed = if dirs.is_empty() {
        renamed_identity.parent() == old_identity.parent()
    } else {
        confined_by(&renamed_identity, &dirs)
    };
    if !allowed {
        return Err(format!("{new_path} is outside the contexts of {old_path}"));
    }
    // `fs::rename` replaces an existing destination on Unix; a rename is not a
    // way to overwrite another note.
    if Path::new(new_path).exists() {
        return Err(format!("{new_path} already exists"));
    }
    let old_target = Path::new(old_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or("Invalid old path")?;
    let new_target = Path::new(new_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or("Invalid new path")?;

    // 1. Get referencing files from every containing index (inside lock, quick
    //    reads) — a reference from outside a nested root is known only to the
    //    enclosing index. An index gone since the gate is a refusal.
    let mut referring_files =
        read_indexes(state, &dirs, |i| i.get_files_linking_to(&old_target)).await?;
    referring_files.sort();
    referring_files.dedup();

    // The canonical identity of the file being renamed, resolved before it
    // moves (the new path does not exist yet: resolve_canonical builds it on
    // its existing parent).
    let remove_old = Mutation::Remove { path: old_identity };

    // The file's own content, read BEFORE it moves: it is what the index will
    // hold under the new path. Unreadable here means nothing has changed yet,
    // so this is an honest `Err` (not a file that vanishes from the index).
    let renamed_content = tokio::fs::read_to_string(old_path)
        .await
        .map_err(|e| format!("{old_path} could not be read: {e}"))?;

    // 2. Rename the actual file — the one step that can still fail. It comes
    //    BEFORE the reference rewrites so that an `Err` from this command
    //    always means nothing was changed; the frontend treats it that way.
    crate::fs::rename_file(old_path, new_path)
        .await
        .map_err(|e| e.to_string())?;

    // 3. Read and update each referring file (async I/O, outside lock). The
    //    file has moved, so a failure here is never a failed rename: the
    //    referrer is skipped and REPORTED (issue 594) — its links still spell
    //    the old name, and only the user can do something about that.
    let rewritten = rewrite_referrers(&referring_files, old_path, &dirs, |content| {
        replace_wikilink_target(content, &old_target, &new_target)
    })
    .await;

    // 4. Update every containing index: drop the old entry, re-index the
    //    referring files from the content we already have — each into the
    //    indexes that cover it — then the renamed file. Each index spells the
    //    paths its own way (Mutation::apply_to).
    let mut per_key: HashMap<String, Vec<Mutation>> = HashMap::new();
    push_for_keys(&mut per_key, &keys, &remove_old);
    for (identity, content) in rewritten.contents {
        let covering = keys_covering(ctx_mgr, &keys, &identity.to_string_lossy()).await;
        push_for_keys(
            &mut per_key,
            &covering,
            &Mutation::Update {
                path: identity,
                content,
            },
        );
    }
    push_for_keys(
        &mut per_key,
        &keys,
        &Mutation::Update {
            path: renamed_identity,
            content: renamed_content,
        },
    );
    for (key, list) in per_key {
        state.apply(&key, list).await;
    }

    Ok(RenameResult {
        updated_files: rewritten.updated,
        skipped_files: rewritten.skipped,
    })
}

pub(crate) async fn rename_block_id_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    file_path: &str,
    old_id: &str,
    new_id: &str,
) -> Result<RenameResult, String> {
    let contexts = owning_contexts(ctx_mgr, file_path).await;
    if contexts.is_empty() {
        return Err(format!("{file_path} is not inside any registered context"));
    }
    ensure_indexes(state, ctx_mgr, &contexts).await?;
    let dirs = buildable(&contexts);
    let keys = keys_of(&dirs);

    // 1. Get referring files from every containing index (block_id == old_id,
    //    target == this file). An index gone since the gate is a refusal.
    let mut referring_files: Vec<String> = read_indexes(state, &dirs, |index| {
        index
            .get_backlinks(file_path)
            .iter()
            .filter(|b| b.block_id.as_deref() == Some(old_id))
            .map(|b| b.source_path.clone())
            .collect()
    })
    .await?;
    referring_files.sort();
    referring_files.dedup();

    // 2. Read + replace + write (outside lock). The first referrer written is
    //    this command's point of no return: a later one that cannot be
    //    rewritten is skipped and reported, not turned into an `Err` that
    //    would claim nothing changed while some files already say `new_id`
    //    (issue 594).
    let rewritten = rewrite_referrers(&referring_files, file_path, &dirs, |content| {
        replace_block_id_refs(content, old_id, new_id)
    })
    .await;

    // 3. Update the containing indexes — each rewritten file goes into the
    //    indexes that cover it, spelled each index's way.
    let mut per_key: HashMap<String, Vec<Mutation>> = HashMap::new();
    for (identity, content) in rewritten.contents {
        let covering = keys_covering(ctx_mgr, &keys, &identity.to_string_lossy()).await;
        push_for_keys(
            &mut per_key,
            &covering,
            &Mutation::Update {
                path: identity,
                content,
            },
        );
    }
    for (key, list) in per_key {
        state.apply(&key, list).await;
    }

    Ok(RenameResult {
        updated_files: rewritten.updated,
        skipped_files: rewritten.skipped,
    })
}

/// What rewriting a set of referring files produced: the files rewritten (and
/// their new content, for the index), and the files that could not be.
struct Rewritten {
    updated: Vec<String>,
    skipped: Vec<String>,
    contents: Vec<(PathBuf, String)>,
}

/// Rewrite every referring file with `rewrite`, skipping `own_path` (the file
/// whose links are being renamed). A referrer that cannot be read, resolves
/// outside `dirs`, or cannot be written is reported in `skipped`; nothing here
/// fails the rename, because the caller is past its point of no return.
async fn rewrite_referrers(
    referring_files: &[String],
    own_path: &str,
    dirs: &[Registered],
    rewrite: impl Fn(&str) -> String,
) -> Rewritten {
    let mut result = Rewritten {
        updated: Vec::new(),
        skipped: Vec::new(),
        contents: Vec::new(),
    };
    for ref_path in referring_files {
        if ref_path == own_path {
            continue;
        }
        let content = match tokio::fs::read_to_string(ref_path).await {
            Ok(c) => c,
            Err(e) => {
                log::warn!(
                    "rename: {ref_path} could not be read, its links are left as they are: {e}"
                );
                result.skipped.push(ref_path.clone());
                continue;
            }
        };
        let new_content = rewrite(&content);
        if new_content == content {
            continue;
        }
        // A referrer the index names that cannot be resolved, or that now
        // resolves elsewhere (a symlink planted after the scan), is never
        // written — and the user hears that its links were not updated,
        // without being told why.
        let confined = resolve_canonical(ref_path)
            .map(|identity| confined_by(&identity, dirs).then_some(identity))
            .ok()
            .flatten();
        let Some(identity) = confined else {
            log::warn!("rename: {ref_path} does not resolve inside the file's contexts, its links are left as they are");
            result.skipped.push(ref_path.clone());
            continue;
        };
        // Atomic write (§3.6: tmp → rename)
        if let Err(e) = crate::fs::write_file(ref_path, &new_content).await {
            log::warn!(
                "rename: {ref_path} could not be rewritten, its links are left as they are: {e}"
            );
            result.skipped.push(ref_path.clone());
            continue;
        }
        result.updated.push(ref_path.clone());
        result.contents.push((identity, new_content));
    }
    result
}

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
/// The rewrites are computed BEFORE the move and written AFTER it, so that an
/// `Err` from here still means nothing changed: a referrer that cannot be
/// written once the directory has moved is reported in `skipped_files`, never
/// left pointing at a `new_dir` that does not exist (issue 594). Reading before
/// the move is not what makes this correct — these files live outside
/// `old_dir` — it just keeps the read and the rewrite in one pass.
pub(super) async fn commit_namespace_rename(
    old_dir: &str,
    new_dir: &str,
    root_path: &str,
) -> Result<NamespaceRenameResult, String> {
    // 1. Collect all .md files in the vault
    let all_files = collect_md_files(root_path)
        .await
        .map_err(|e| e.to_string())?;

    let old_dir_slash = if old_dir.ends_with('/') {
        old_dir.to_string()
    } else {
        format!("{}/", old_dir)
    };

    // Count files that will be moved
    let files_moved = all_files
        .iter()
        .filter(|f| f.starts_with(&old_dir_slash))
        .count() as u32;

    // 2. Find the files outside old_dir whose relative wikilinks point into it,
    //    and compute their new content. Nothing is written yet.
    let mut rewrites: Vec<(String, String)> = Vec::new();
    let mut skipped_files = Vec::new();

    for file_path in &all_files {
        // Skip files inside the directory being renamed (they move with it)
        if file_path.starts_with(&old_dir_slash) {
            continue;
        }

        let content = match tokio::fs::read_to_string(file_path).await {
            Ok(c) => c,
            Err(e) => {
                log::warn!(
                    "§61 rename_namespace: {file_path} could not be read, its links are left as they are: {e}"
                );
                skipped_files.push(file_path.clone());
                continue;
            }
        };

        let new_content = rewrite_relative_wikilinks(&content, file_path, old_dir, new_dir);

        if new_content != content {
            rewrites.push((file_path.clone(), new_content));
        }
    }

    // 3. Rename the directory — the last step that may fail with nothing done.
    crate::fs::rename_file(old_dir, new_dir)
        .await
        .map_err(|e| e.to_string())?;

    // 4. Write the rewrites. The files have moved; a referrer that cannot be
    //    written is reported, its links still spell the old directory.
    let mut updated_files = Vec::new();
    for (file_path, new_content) in rewrites {
        if let Err(e) = crate::fs::write_file(&file_path, &new_content).await {
            log::warn!(
                "§61 rename_namespace: {old_dir} moved, but {file_path} could not be rewritten: {e}"
            );
            skipped_files.push(file_path);
            continue;
        }
        updated_files.push(file_path);
    }

    Ok(NamespaceRenameResult {
        updated_files,
        skipped_files,
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
pub(super) async fn settle_namespace_rebuild(
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
