// §57b Git Basic IPC 커맨드 핸들러

use crate::git::GitError;

/// Run a blocking git operation on the thread-pool and convert errors to String
/// at the IPC boundary.
async fn git_run<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, GitError> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// §29 #824 Run a git operation that changes the worktree as a commit
/// (`index::service::committed`) that declares `effects(workdir)` first: the link
/// indexes covering what it changed are reconciled before this returns, on success
/// and on error alike — a checkout that fails part-way has still changed files.
async fn git_in_index<R, T, F>(
    app: &tauri::AppHandle<R>,
    path: String,
    effects: impl FnOnce(&std::path::Path, &crate::index::service::EffectLog) + Send + 'static,
    f: F,
) -> Result<T, String>
where
    R: tauri::Runtime,
    T: Send + 'static,
    F: FnOnce() -> Result<T, GitError> + Send + 'static,
{
    crate::index::service::committed(app, move |log| async move {
        // The repository may sit above the vault (`/r` holding `/r/notes`); the tree
        // reconciliation covers registrations under it too.
        let workdir = tokio::task::spawn_blocking(move || {
            crate::git::open_repo(&path)
                .ok()
                .and_then(|repo| repo.workdir().map(std::path::Path::to_path_buf))
                .unwrap_or_else(|| std::path::PathBuf::from(&path))
        })
        .await
        .map_err(|e| e.to_string())?;
        effects(&workdir, &log);
        git_run(f).await
    })
    .await
    .result
}

/// The whole worktree: what a checkout, a stash or a pull changes is not known in
/// advance.
fn whole_tree(workdir: &std::path::Path, log: &crate::index::service::EffectLog) {
    log.tree(&workdir.to_string_lossy());
}

/// The most paths `git_discard` reconciles one by one; past it the worktree is rebuilt
/// once instead of reading that many files. A named directory needs no special case:
/// its reconciliation rebuilds every registration that covers it.
const DISCARD_PATHS_ONE_BY_ONE: usize = 256;

#[tauri::command]
pub async fn git_status(path: String) -> Result<crate::git::GitStatusInfo, String> {
    git_run(move || crate::git::status(&path)).await
}

#[tauri::command]
pub async fn git_stage(path: String, files: Vec<String>) -> Result<(), String> {
    git_run(move || crate::git::stage(&path, &files)).await
}

#[tauri::command]
pub async fn git_unstage(path: String, files: Vec<String>) -> Result<(), String> {
    git_run(move || crate::git::unstage(&path, &files)).await
}

#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<String, String> {
    git_run(move || crate::git::commit(&path, &message)).await
}

#[tauri::command]
pub async fn git_diff_file(
    path: String,
    file_path: String,
) -> Result<crate::git::GitFileDiff, String> {
    git_run(move || crate::git::diff_file(&path, &file_path)).await
}

#[tauri::command]
pub async fn git_branches(path: String) -> Result<Vec<crate::git::GitBranchInfo>, String> {
    git_run(move || crate::git::list_branches(&path)).await
}

#[tauri::command]
pub async fn git_switch_branch<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    branch_name: String,
) -> Result<(), String> {
    let at = path.clone();
    git_in_index(&app, at, whole_tree, move || {
        crate::git::switch_branch(&path, &branch_name)
    })
    .await
}

#[tauri::command]
pub async fn git_discard<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    files: Vec<String>,
) -> Result<(), String> {
    let (at, named) = (path.clone(), files.clone());
    git_in_index(
        &app,
        at,
        move |workdir, log| {
            let paths: Vec<std::path::PathBuf> = named.iter().map(|f| workdir.join(f)).collect();
            if paths.len() > DISCARD_PATHS_ONE_BY_ONE {
                whole_tree(workdir, log);
            } else {
                for p in &paths {
                    log.path(&p.to_string_lossy());
                }
            }
        },
        move || crate::git::discard(&path, &files),
    )
    .await
}

#[tauri::command]
pub async fn git_create_branch(path: String, branch_name: String) -> Result<(), String> {
    git_run(move || crate::git::create_branch(&path, &branch_name)).await
}

// §67 Git Advanced IPC commands

#[tauri::command]
pub async fn git_log(
    path: String,
    max_count: Option<usize>,
) -> Result<Vec<crate::git::GitLogEntry>, String> {
    let count = max_count.unwrap_or(50);
    git_run(move || crate::git::log(&path, count)).await
}

#[tauri::command]
pub async fn git_stash_save<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    message: String,
    include_untracked: Option<bool>,
) -> Result<String, String> {
    let untracked = include_untracked.unwrap_or(false);
    let at = path.clone();
    git_in_index(&app, at, whole_tree, move || {
        crate::git::stash_save(&path, &message, untracked)
    })
    .await
}

#[tauri::command]
pub async fn git_stash_list(path: String) -> Result<Vec<crate::git::GitStashEntry>, String> {
    git_run(move || crate::git::stash_list(&path)).await
}

#[tauri::command]
pub async fn git_stash_pop<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    index: Option<usize>,
) -> Result<(), String> {
    let idx = index.unwrap_or(0);
    let at = path.clone();
    git_in_index(&app, at, whole_tree, move || {
        crate::git::stash_pop(&path, idx)
    })
    .await
}

#[tauri::command]
pub async fn git_stash_drop(path: String, index: Option<usize>) -> Result<(), String> {
    let idx = index.unwrap_or(0);
    git_run(move || crate::git::stash_drop(&path, idx)).await
}

#[tauri::command]
pub async fn git_remotes(path: String) -> Result<Vec<crate::git::GitRemoteInfo>, String> {
    git_run(move || crate::git::list_remotes(&path)).await
}

#[tauri::command]
pub async fn git_fetch(path: String, remote: Option<String>) -> Result<(), String> {
    let remote_name = remote.unwrap_or_else(|| "origin".to_string());
    git_run(move || crate::git::fetch(&path, &remote_name)).await
}

#[tauri::command]
pub async fn git_pull<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    remote: Option<String>,
    branch: Option<String>,
) -> Result<String, String> {
    let remote_name = remote.unwrap_or_else(|| "origin".to_string());
    let branch_name = branch.unwrap_or_else(|| "main".to_string());
    let at = path.clone();
    git_in_index(&app, at, whole_tree, move || {
        crate::git::pull(&path, &remote_name, &branch_name)
    })
    .await
}

#[tauri::command]
pub async fn git_push(
    path: String,
    remote: Option<String>,
    branch: Option<String>,
) -> Result<(), String> {
    let remote_name = remote.unwrap_or_else(|| "origin".to_string());
    let branch_name = branch.unwrap_or_else(|| "main".to_string());
    git_run(move || crate::git::push(&path, &remote_name, &branch_name)).await
}

#[tauri::command]
pub async fn git_ahead_behind(
    path: String,
    branch: Option<String>,
    remote: Option<String>,
) -> Result<crate::git::GitAheadBehind, String> {
    let branch_name = branch.unwrap_or_else(|| "main".to_string());
    let remote_name = remote.unwrap_or_else(|| "origin".to_string());
    git_run(move || crate::git::ahead_behind(&path, &branch_name, &remote_name)).await
}

#[tauri::command]
pub async fn git_delete_branch(path: String, branch_name: String) -> Result<(), String> {
    git_run(move || crate::git::delete_branch(&path, &branch_name)).await
}
