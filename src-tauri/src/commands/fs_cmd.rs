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

/// §88 Validate that path is within a registered context (multi-vault aware).
///
/// Tries ContextManager first (checks against ALL registered contexts so cross-context
/// file access works). Falls back to VaultRootState for backward compatibility when no
/// contexts are registered yet (cold start before any context registration).
///
/// Canonicalizes both paths before comparison to prevent symlink traversal attacks.
async fn check_vault(
    path: &str,
    state: &tauri::State<'_, crate::VaultRootState>,
    ctx_mgr: &tauri::State<'_, crate::context::ContextManager>,
) -> Result<(), String> {
    // Try ContextManager first (multi-vault aware)
    let contexts = ctx_mgr.list().await;
    if !contexts.is_empty() {
        return ctx_mgr.validate_path_any(path).await;
    }

    // Fallback: VaultRootState (backward compat for cold start before any context registered)
    let root_guard = state.0.read().await;
    vault_fallback_decision(root_guard.as_ref().map(|p| p.as_path()), path)
}

/// Decide FS access when no ContextManager context is registered, based on the
/// optional legacy vault root. Extracted from `check_vault` for unit testing.
///
/// Deny-by-default: if neither a context nor a vault root is set — the cold-start
/// window before any folder/file is opened — the path is rejected. Legitimate open
/// flows (`openFolder`, `ensureFileContext`) register a context or vault root BEFORE
/// issuing any file IPC, so this only blocks stray access (e.g. a compromised webview
/// probing arbitrary absolute paths on launch), not normal usage.
fn vault_fallback_decision(root: Option<&std::path::Path>, path: &str) -> Result<(), String> {
    match root {
        Some(root) => {
            let canonical_root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
            let canonical_path = crate::context::manager::resolve_canonical(path)?;
            if !canonical_path.starts_with(&canonical_root) {
                return Err("Access denied: path is outside vault root".to_string());
            }
            Ok(())
        }
        None => Err("Access denied: no vault, folder, or file context is open".to_string()),
    }
}

/// Register (or update) the open vault root.
/// Called by the frontend whenever a vault folder is opened.
#[tauri::command]
pub async fn set_vault_root(
    path: String,
    state: tauri::State<'_, crate::VaultRootState>,
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    check(&path)?;

    // §backlog #3 — grant asset:// read access to this vault directory at runtime
    // (the static scope is limited to $APPDATA). Non-fatal on failure.
    {
        use tauri::Manager;
        if let Err(e) = app.asset_protocol_scope().allow_directory(&path, true) {
            log::warn!("§backlog#3 asset scope registration failed for {path}: {e}");
        }
    }

    // Keep old VaultRootState in sync (backward compat)
    let mut root = state.0.write().await;
    *root = Some(std::path::PathBuf::from(&path));
    drop(root); // Release lock before async operations

    // Also register/update in ContextManager
    let dir_name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "vault".to_string());

    // M2: Check if this path is already registered — just activate it
    {
        let contexts = ctx_mgr.list().await;
        if let Some(existing) = contexts.iter().find(|c| c.path == path) {
            ctx_mgr.set_active(&existing.id).await?;
            return Ok(());
        }
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
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
) -> Result<String, String> {
    check(&path)?;
    check_vault(&path, &state, &ctx_mgr).await?;
    crate::fs::read_file(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_file(
    path: String,
    content: String,
    state: tauri::State<'_, crate::VaultRootState>,
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
) -> Result<(), String> {
    check(&path)?;
    check_vault(&path, &state, &ctx_mgr).await?;
    crate::fs::write_file(&path, &content)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_dir(
    path: String,
    recursive: Option<bool>,
    state: tauri::State<'_, crate::VaultRootState>,
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
) -> Result<Vec<FileEntry>, String> {
    check(&path)?;
    check_vault(&path, &state, &ctx_mgr).await?;
    crate::fs::list_dir(&path, recursive.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_file(
    from: String,
    to: String,
    state: tauri::State<'_, crate::VaultRootState>,
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
) -> Result<(), String> {
    check(&from)?;
    check(&to)?;
    check_vault(&from, &state, &ctx_mgr).await?;
    check_vault(&to, &state, &ctx_mgr).await?;
    crate::fs::rename_file(&from, &to)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_file(
    path: String,
    state: tauri::State<'_, crate::VaultRootState>,
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
) -> Result<(), String> {
    check(&path)?;
    check_vault(&path, &state, &ctx_mgr).await?;
    crate::fs::delete_file(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_dir(
    path: String,
    state: tauri::State<'_, crate::VaultRootState>,
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
) -> Result<(), String> {
    check(&path)?;
    check_vault(&path, &state, &ctx_mgr).await?;
    crate::fs::create_dir(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_dir(
    path: String,
    state: tauri::State<'_, crate::VaultRootState>,
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
) -> Result<(), String> {
    check(&path)?;
    check_vault(&path, &state, &ctx_mgr).await?;
    crate::fs::delete_dir(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn copy_file(
    from: String,
    to: String,
    state: tauri::State<'_, crate::VaultRootState>,
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
) -> Result<(), String> {
    check(&from)?;
    check(&to)?;
    check_vault(&from, &state, &ctx_mgr).await?;
    check_vault(&to, &state, &ctx_mgr).await?;
    crate::fs::copy_file(&from, &to)
        .await
        .map_err(|e| e.to_string())
}

/// Import a file from any location into the vault.
/// Source path may be outside the vault (e.g., ~/Desktop, ~/Downloads);
/// only the destination is vault-confined. Same pattern as extract_zip.
#[tauri::command]
pub async fn import_file(
    from: String,
    to: String,
    state: tauri::State<'_, crate::VaultRootState>,
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
) -> Result<(), String> {
    check(&from)?;
    check(&to)?;
    check_vault(&to, &state, &ctx_mgr).await?;
    crate::fs::copy_file(&from, &to)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn watch_dir(
    path: String,
    app_handle: tauri::AppHandle,
    watcher_state: tauri::State<'_, crate::WatcherState>,
) -> Result<(), String> {
    check(&path)?;
    // No check_vault here — watching a directory only monitors events,
    // it doesn't read/write files. Security is enforced on file operations.
    let new_watcher = crate::fs::start_watching(&path, app_handle).map_err(|e| e.to_string())?;
    // Key by PATH (not context ID) to prevent watcher accumulation
    // when context IDs change due to dedup or restart
    let mut guard = watcher_state.0.lock().map_err(|e| e.to_string())?;
    guard.insert(path.clone(), new_watcher);
    Ok(())
}

/// §53 ZIP 파일 추출 — Notion 내보내기 호환
/// zip_path may be outside vault (e.g., ~/Downloads); output_dir must be inside vault.
#[tauri::command]
pub async fn extract_zip(
    zip_path: String,
    output_dir: String,
    state: tauri::State<'_, crate::VaultRootState>,
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
) -> Result<Vec<String>, String> {
    check(&zip_path)?;
    check(&output_dir)?;
    check_vault(&output_dir, &state, &ctx_mgr).await?;
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
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
) -> Result<(), String> {
    check(&path)?;
    check_vault(&path, &state, &ctx_mgr).await?;
    let tmp_path = format!("{}.{}.tmp", path, uuid::Uuid::new_v4().as_simple());
    tokio::fs::write(&tmp_path, &data)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::rename(&tmp_path, &path).await.map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        e.to_string()
    })
}

/// §5.1 사용자 지정 경로로 바이너리 내보내기 (예: SVG → PNG 다운로드).
///
/// `write_binary_file`과 달리 vault 경로 제약을 적용하지 않는다. 경로는 네이티브
/// 저장 다이얼로그에서 사용자가 직접 선택한 것이므로 vault 밖(다운로드/데스크톱
/// 등)으로의 저장이 정상 동작해야 한다. `export_pdf`/`export_document`와 동일한
/// 정책이며, null 바이트/비절대 경로 검증(`check`)은 유지한다.
#[tauri::command]
pub async fn export_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    check(&path)?;
    let tmp_path = format!("{}.{}.tmp", path, uuid::Uuid::new_v4().as_simple());
    tokio::fs::write(&tmp_path, &data)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::rename(&tmp_path, &path).await.map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        e.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // §backlog #2 — cold-start vault bypass. With no registered context, access
    // must fall back to the legacy vault root, and deny when none is set.
    #[test]
    fn fallback_denies_when_no_context_and_no_root() {
        assert!(vault_fallback_decision(None, "/etc/passwd").is_err());
        assert!(vault_fallback_decision(None, "/tmp/anything.md").is_err());
    }

    #[test]
    fn fallback_allows_inside_root_and_denies_outside() {
        let base = std::env::temp_dir().join(format!("baram-cv-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        let inside = base.join("note.md");
        std::fs::write(&inside, "x").unwrap();

        assert!(vault_fallback_decision(Some(&base), inside.to_str().unwrap()).is_ok());

        // Sibling of the root (not under it) is rejected.
        let outside = std::env::temp_dir().join("baram-cv-outside.md");
        assert!(vault_fallback_decision(Some(&base), outside.to_str().unwrap()).is_err());

        std::fs::remove_dir_all(&base).ok();
    }
}
