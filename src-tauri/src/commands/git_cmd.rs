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
pub async fn git_switch_branch(path: String, branch_name: String) -> Result<(), String> {
    git_run(move || crate::git::switch_branch(&path, &branch_name)).await
}

#[tauri::command]
pub async fn git_discard(path: String, files: Vec<String>) -> Result<(), String> {
    git_run(move || crate::git::discard(&path, &files)).await
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
pub async fn git_stash_save(
    path: String,
    message: String,
    include_untracked: Option<bool>,
) -> Result<String, String> {
    let untracked = include_untracked.unwrap_or(false);
    git_run(move || crate::git::stash_save(&path, &message, untracked)).await
}

#[tauri::command]
pub async fn git_stash_list(path: String) -> Result<Vec<crate::git::GitStashEntry>, String> {
    git_run(move || crate::git::stash_list(&path)).await
}

#[tauri::command]
pub async fn git_stash_pop(path: String, index: Option<usize>) -> Result<(), String> {
    let idx = index.unwrap_or(0);
    git_run(move || crate::git::stash_pop(&path, idx)).await
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
pub async fn git_pull(
    path: String,
    remote: Option<String>,
    branch: Option<String>,
) -> Result<String, String> {
    let remote_name = remote.unwrap_or_else(|| "origin".to_string());
    let branch_name = branch.unwrap_or_else(|| "main".to_string());
    git_run(move || crate::git::pull(&path, &remote_name, &branch_name)).await
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
