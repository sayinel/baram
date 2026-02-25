// §57b Git Basic IPC 커맨드 핸들러

#[tauri::command]
pub async fn git_status(path: String) -> Result<crate::git::GitStatusInfo, String> {
    tokio::task::spawn_blocking(move || crate::git::status(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_stage(path: String, files: Vec<String>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || crate::git::stage(&path, &files))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_unstage(path: String, files: Vec<String>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || crate::git::unstage(&path, &files))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || crate::git::commit(&path, &message))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_diff_file(path: String, file_path: String) -> Result<crate::git::GitFileDiff, String> {
    tokio::task::spawn_blocking(move || crate::git::diff_file(&path, &file_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_branches(path: String) -> Result<Vec<crate::git::GitBranchInfo>, String> {
    tokio::task::spawn_blocking(move || crate::git::list_branches(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_switch_branch(path: String, branch_name: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || crate::git::switch_branch(&path, &branch_name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_discard(path: String, files: Vec<String>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || crate::git::discard(&path, &files))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_create_branch(path: String, branch_name: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || crate::git::create_branch(&path, &branch_name))
        .await
        .map_err(|e| e.to_string())?
}
