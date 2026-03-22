// §3.2 파일 시스템 IPC 커맨드

use serde::Serialize;

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    pub size: u64,
    #[serde(rename = "modifiedAt")]
    pub modified_at: u64,
}

/// Validate path at IPC boundary: reject null bytes and non-absolute paths.
fn check(path: &str) -> Result<(), String> {
    crate::fs::validate_path(path).map_err(|e| e.to_string())
}

/// Validate that path is within the currently open vault root (when set).
/// If no vault root is set (cold start / folder picker not yet used), allows all paths.
///
/// Canonicalizes both paths before comparison to prevent symlink traversal attacks
/// (a symlink inside the vault that points to a location outside the vault).
/// For paths that do not yet exist (write_file, create_dir), the parent directory
/// is canonicalized instead to resolve any symlinks in the parent chain.
async fn check_vault(
    path: &str,
    state: &tauri::State<'_, crate::VaultRootState>,
) -> Result<(), String> {
    let root_guard = state.0.read().await;
    if let Some(root) = root_guard.as_ref() {
        let canonical_root = std::fs::canonicalize(root).unwrap_or_else(|_| root.clone());

        let canonical_path = match std::fs::canonicalize(path) {
            Ok(p) => p,
            Err(_) => {
                // Path does not exist yet (e.g., write_file / create_dir target).
                // Walk up the ancestor chain to find the nearest existing directory,
                // canonicalize it, then append the remaining (non-existent) components.
                let target = std::path::Path::new(path);
                let mut pending: Vec<std::ffi::OsString> = Vec::new();
                let mut current = target;
                loop {
                    match std::fs::canonicalize(current) {
                        Ok(canonical) => {
                            let mut result = canonical;
                            for component in pending.into_iter().rev() {
                                result = result.join(component);
                            }
                            break result;
                        }
                        Err(_) => {
                            let name = current.file_name().ok_or_else(|| {
                                "Access denied: path is outside vault root".to_string()
                            })?;
                            pending.push(name.to_os_string());
                            current = current.parent().ok_or_else(|| {
                                "Access denied: path is outside vault root".to_string()
                            })?;
                        }
                    }
                }
            }
        };

        // PathBuf::starts_with is component-aware: "/vault2" does NOT start_with "/vault"
        if !canonical_path.starts_with(&canonical_root) {
            return Err("Access denied: path is outside vault root".to_string());
        }
    }
    Ok(())
}

/// Register (or update) the open vault root.
/// Called by the frontend whenever a vault folder is opened.
#[tauri::command]
pub async fn set_vault_root(
    path: String,
    state: tauri::State<'_, crate::VaultRootState>,
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
) -> Result<(), String> {
    check(&path)?;

    // Keep old VaultRootState in sync (backward compat)
    let mut root = state.0.write().await;
    *root = Some(std::path::PathBuf::from(&path));
    drop(root); // Release lock before async operations

    // Also register/update in ContextManager
    let dir_name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "vault".to_string());

    // Remove previous active context if any
    if let Some(prev_id) = ctx_mgr.active_id().await {
        let _ = ctx_mgr.remove(&prev_id).await;
    }

    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let info = crate::context::ContextInfo {
        id: format!(
            "legacy-{:x}{:x}",
            now_secs.as_secs(),
            now_secs.subsec_nanos()
        ),
        context_type: crate::context::ContextType::Folder,
        path: path.clone(),
        label: dir_name,
        color: "#3b82f6".to_string(),
        alias: None,
        vault_type: None,
        added_at: now_secs.as_millis() as u64,
    };

    let added = ctx_mgr.add(info).await?;
    ctx_mgr.set_active(&added.id).await?;

    Ok(())
}

#[tauri::command]
pub async fn read_file(
    path: String,
    state: tauri::State<'_, crate::VaultRootState>,
) -> Result<String, String> {
    check(&path)?;
    check_vault(&path, &state).await?;
    crate::fs::read_file(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_file(
    path: String,
    content: String,
    state: tauri::State<'_, crate::VaultRootState>,
) -> Result<(), String> {
    check(&path)?;
    check_vault(&path, &state).await?;
    crate::fs::write_file(&path, &content)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_dir(
    path: String,
    recursive: Option<bool>,
    state: tauri::State<'_, crate::VaultRootState>,
) -> Result<Vec<FileEntry>, String> {
    check(&path)?;
    check_vault(&path, &state).await?;
    crate::fs::list_dir(&path, recursive.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_file(
    from: String,
    to: String,
    state: tauri::State<'_, crate::VaultRootState>,
) -> Result<(), String> {
    check(&from)?;
    check(&to)?;
    check_vault(&from, &state).await?;
    check_vault(&to, &state).await?;
    crate::fs::rename_file(&from, &to)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_file(
    path: String,
    state: tauri::State<'_, crate::VaultRootState>,
) -> Result<(), String> {
    check(&path)?;
    check_vault(&path, &state).await?;
    crate::fs::delete_file(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_dir(
    path: String,
    state: tauri::State<'_, crate::VaultRootState>,
) -> Result<(), String> {
    check(&path)?;
    check_vault(&path, &state).await?;
    crate::fs::create_dir(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_dir(
    path: String,
    state: tauri::State<'_, crate::VaultRootState>,
) -> Result<(), String> {
    check(&path)?;
    check_vault(&path, &state).await?;
    crate::fs::delete_dir(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn copy_file(
    from: String,
    to: String,
    state: tauri::State<'_, crate::VaultRootState>,
) -> Result<(), String> {
    check(&from)?;
    check(&to)?;
    check_vault(&from, &state).await?;
    check_vault(&to, &state).await?;
    crate::fs::copy_file(&from, &to)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn watch_dir(
    path: String,
    app_handle: tauri::AppHandle,
    vault_state: tauri::State<'_, crate::VaultRootState>,
    watcher_state: tauri::State<'_, crate::WatcherState>,
) -> Result<(), String> {
    check(&path)?;
    check_vault(&path, &vault_state).await?;
    let new_watcher = crate::fs::start_watching(&path, app_handle).map_err(|e| e.to_string())?;
    // Replace old watcher — drops it, which closes the event channel,
    // causing the previous watcher thread to exit naturally.
    let mut guard = watcher_state.0.lock().map_err(|e| e.to_string())?;
    *guard = Some(new_watcher);
    Ok(())
}

/// §53 ZIP 파일 추출 — Notion 내보내기 호환
/// zip_path may be outside vault (e.g., ~/Downloads); output_dir must be inside vault.
#[tauri::command]
pub async fn extract_zip(
    zip_path: String,
    output_dir: String,
    state: tauri::State<'_, crate::VaultRootState>,
) -> Result<Vec<String>, String> {
    check(&zip_path)?;
    check(&output_dir)?;
    check_vault(&output_dir, &state).await?;
    crate::fs::extract_zip(&zip_path, &output_dir)
        .await
        .map_err(|e| e.to_string())
}

/// §56d 바이너리 파일 쓰기 — 이미지 등 비텍스트 파일용
#[tauri::command]
pub async fn write_binary_file(
    path: String,
    data: Vec<u8>,
    state: tauri::State<'_, crate::VaultRootState>,
) -> Result<(), String> {
    check(&path)?;
    check_vault(&path, &state).await?;
    let tmp_path = format!("{}.{}.tmp", path, uuid::Uuid::new_v4().as_simple());
    tokio::fs::write(&tmp_path, &data)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::rename(&tmp_path, &path).await.map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        e.to_string()
    })
}
