use super::build::*;
use super::keys::*;
use super::mutation::*;
use super::query::*;
use super::rename::*;
use super::state::*;
use super::sync::*;
use crate::context::{ContextInfo, ContextManager, ContextType, VaultType};
use crate::index::{BacklinkResult, IndexStats, LinkGraph, LinkIndex};

mod alias;
mod block_id;
mod boundary;
mod builds;
mod contexts;
mod file_rename;
mod namespace;
mod nested_roots;
mod normalization;
mod same_stem;
mod stem_spelling;
mod sync;

fn info(id: &str, path: &str, kind: ContextType) -> ContextInfo {
    ContextInfo {
        id: id.to_string(),
        context_type: kind,
        path: path.to_string(),
        label: id.to_string(),
        color: "#ffffff".to_string(),
        alias: None,
        vault_type: None,
        added_at: 0,
    }
}

/// `info` for a folder carrying the vault alias `alias` — registered through
/// `ContextManager::add`, which claims it (last writer wins).
fn aliased(id: &str, path: &str, alias: &str) -> ContextInfo {
    ContextInfo {
        alias: Some(alias.to_string()),
        ..info(id, path, ContextType::Folder)
    }
}

/// A vault whose `a.md` links to `b.md`, registered under an id that is
/// nothing like its path — the shape of the bug. Active unless told otherwise.
async fn vault_with_a_link(
    ctx: &ContextManager,
    id: &str,
    active: bool,
) -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_str().unwrap().to_string();
    std::fs::write(dir.path().join("a.md"), "see [[b]]").unwrap();
    std::fs::write(dir.path().join("b.md"), "target").unwrap();
    ctx.add(info(id, &root, ContextType::Folder)).await.unwrap();
    if active {
        ctx.set_active(id).await.unwrap();
    }
    (dir, root)
}

/// The registration incarnation of a context, as `remove_context` would
/// hand it to `forget`.
async fn incarnation_of(ctx: &ContextManager, id: &str) -> u64 {
    ctx.registration(id).await.unwrap().1
}

fn sources(backlinks: &[BacklinkResult]) -> Vec<&str> {
    backlinks.iter().map(|b| b.source_path.as_str()).collect()
}

/// A build that has read the vault but not published yet — the window in
/// which saves and renames race it.
async fn staged_build(
    state: &LinkIndexState,
    ctx: &ContextManager,
    key: &str,
    root: &str,
) -> (BuildToken, LinkIndex, IndexStats) {
    let incarnation = ctx
        .context_registered_at(root)
        .await
        .map_or(0, |r| r.incarnation);
    let requested = state.version(key).await;
    let token = state
        .begin_build(key, &requested, root, incarnation)
        .await
        .unwrap();
    let mut snapshot = LinkIndex::new();
    let stats = snapshot.build(root).await.unwrap();
    (token, snapshot, stats)
}

/// A directory nobody can create files in. `fs::write_file` writes a tmp file
/// beside its target and renames it over, so a read-only FILE does not stop
/// it — a read-only PARENT does. Returns whether the lock took (it does not
/// as root); the caller restores the mode before the TempDir is dropped.
#[cfg(unix)]
fn lock_directory(dir: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o555)).unwrap();
    std::fs::write(dir.join("probe.tmp"), "").is_err()
}

#[cfg(unix)]
fn unlock_directory(dir: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o755)).unwrap();
}

/// A folder context registered under `id` with the vault alias `alias`,
/// holding `files` (path under the root, content); its root path.
async fn aliased_vault(
    ctx: &ContextManager,
    id: &str,
    alias: &str,
    files: &[(&str, &str)],
) -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_str().unwrap().to_string();
    for (path, content) in files {
        let path = dir.path().join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }
    ctx.add(aliased(id, &root, alias)).await.unwrap();
    (dir, root)
}

/// The lines of `source` among the backlinks of `file`, sorted.
async fn backlink_lines(
    state: &LinkIndexState,
    ctx: &ContextManager,
    file: &str,
    source: &str,
) -> Vec<u32> {
    let mut lines: Vec<u32> = get_backlinks_inner(state, ctx, file)
        .await
        .unwrap()
        .iter()
        .filter(|b| b.source_path == source)
        .map(|b| b.line)
        .collect();
    lines.sort_unstable();
    lines
}

/// The entry names in `dir`, sorted — as the directory spells them, which
/// `Path::exists` cannot tell apart on a file system that folds case.
fn names_in(dir: &std::path::Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    names
}
