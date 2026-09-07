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

/// §33 Result of renaming a file with wikilink updates
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    pub updated_files: Vec<String>,
}

/// §61 Result of renaming a namespace (directory) with wikilink updates
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamespaceRenameResult {
    pub updated_files: Vec<String>,
    pub files_moved: u32,
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

    // 2. Rename the actual file — the one step that can still fail. It comes
    //    BEFORE the reference rewrites so that an `Err` from this command
    //    always means nothing was changed; the frontend treats it that way.
    crate::fs::rename_file(old_path, new_path)
        .await
        .map_err(|e| e.to_string())?;

    // 3. Read and update each referring file (async I/O, outside lock). The
    //    file has moved, so a failure here is logged and the file skipped,
    //    never reported as a failed rename.
    let mut updated_files = Vec::new();
    let mut updated_contents: Vec<(PathBuf, String)> = Vec::new();

    for file_path in &referring_files {
        // Skip the file being renamed itself
        if file_path == old_path {
            continue;
        }
        let content = match tokio::fs::read_to_string(file_path).await {
            Ok(c) => c,
            Err(_) => continue,
        };

        let new_content = replace_wikilink_target(&content, &old_target, &new_target);
        if new_content != content {
            let Ok(identity) = resolve_canonical(file_path) else {
                continue;
            };
            if !confined_by(&identity, &dirs) {
                continue;
            }
            // Atomic write (§3.6: tmp → rename)
            if let Err(e) = crate::fs::write_file(file_path, &new_content).await {
                log::warn!(
                    "§33 rename_file_with_links: {old_path} moved, but {file_path} could not be rewritten: {e}"
                );
                continue;
            }
            updated_files.push(file_path.clone());
            updated_contents.push((identity, new_content));
        }
    }

    // 4. Update every containing index: drop the old entry, re-index the
    //    referring files from the content we already have — each into the
    //    indexes that cover it — then the renamed file. Each index spells the
    //    paths its own way (Mutation::apply_to).
    let renamed_content = tokio::fs::read_to_string(new_path)
        .await
        .unwrap_or_default();
    let mut per_key: HashMap<String, Vec<Mutation>> = HashMap::new();
    push_for_keys(&mut per_key, &keys, &remove_old);
    for (identity, content) in updated_contents {
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

    Ok(RenameResult { updated_files })
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

    // 2. Read + replace + write (outside lock)
    let mut updated_files = Vec::new();
    let mut updated_contents: Vec<(PathBuf, String)> = Vec::new();

    for ref_path in &referring_files {
        if ref_path == file_path {
            continue;
        }
        let content = match tokio::fs::read_to_string(ref_path).await {
            Ok(c) => c,
            Err(_) => continue,
        };
        let new_content = replace_block_id_refs(&content, old_id, new_id);
        if new_content != content {
            let identity = resolve_canonical(ref_path)?;
            if !confined_by(&identity, &dirs) {
                continue;
            }
            crate::fs::write_file(ref_path, &new_content)
                .await
                .map_err(|e| e.to_string())?;
            updated_files.push(ref_path.clone());
            updated_contents.push((identity, new_content));
        }
    }

    // 3. Update the containing indexes — each rewritten file goes into the
    //    indexes that cover it, spelled each index's way.
    let mut per_key: HashMap<String, Vec<Mutation>> = HashMap::new();
    for (identity, content) in updated_contents {
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

    Ok(RenameResult { updated_files })
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
    let committed = commit_namespace_rename(old_dir, new_dir, root_path).await?;
    // Full rebuild (many files moved), under the same key every lookup derives,
    // never coalesced onto a publication that may predate the move.
    let rebuilt = rebuild_and_publish(state, &target, root_path, false).await;
    settle_namespace_rebuild(state, &target.key, rebuilt).await;
    Ok(committed)
}

/// The filesystem half of a namespace rename: rewrite the relative wikilinks
/// that point into the directory, then move it.
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

    // 2. Find and update files outside old_dir that have relative wikilinks pointing into old_dir
    let mut updated_files = Vec::new();

    for file_path in &all_files {
        // Skip files inside the directory being renamed (they move with it)
        if file_path.starts_with(&old_dir_slash) {
            continue;
        }

        let content = match tokio::fs::read_to_string(file_path).await {
            Ok(c) => c,
            Err(_) => continue,
        };

        let new_content = rewrite_relative_wikilinks(&content, file_path, old_dir, new_dir);

        if new_content != content {
            crate::fs::write_file(file_path, &new_content)
                .await
                .map_err(|e| e.to_string())?;
            updated_files.push(file_path.clone());
        }
    }

    // 3. Rename the directory
    crate::fs::rename_file(old_dir, new_dir)
        .await
        .map_err(|e| e.to_string())?;

    Ok(NamespaceRenameResult {
        updated_files,
        files_moved,
    })
}

/// Once a namespace rename has moved its files, the command reports the move
/// whatever the rebuild did — an `Err` from it means nothing was changed, and
/// the frontend relies on that. A rebuild invalidated by the context's removal
/// leaves the index to whoever registers the path next. A rebuild that FAILED
/// leaves an index describing the old layout: that index is dropped (the next
/// rename rebuilds through the gate) rather than trusted.
pub(super) async fn settle_namespace_rebuild(
    state: &LinkIndexState,
    key: &str,
    rebuilt: Result<IndexStats, IndexBuildError>,
) {
    match rebuilt {
        Ok(_) | Err(IndexBuildError::Invalidated) => {}
        Err(IndexBuildError::Failed(e)) => {
            log::warn!(
                "§61 rename_namespace: files moved, but the index rebuild failed ({e}); the stale index under {key} is dropped"
            );
            state.drop_index(key).await;
        }
    }
}
