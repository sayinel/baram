// §3.2 파일 시스템 IPC 커맨드

use serde::Serialize;

#[derive(Serialize, Debug)]
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

/// §260 Phase 3c-2c — the vault decision, reachable from another command module.
///
/// Sandboxed plugins' brokered file ops (`plugin_cmd::execute_op`) must obey the
/// SAME rule as `read_file`/`write_file`, not a copy of it: the canonicalizing,
/// multi-context, deny-when-nothing-is-open logic above is the only place that
/// rule should exist. Pulls the two states off the `AppHandle` so a caller that
/// only has one does not have to thread `State` params through.
///
/// Generic over the runtime so a test can build the states on `tauri::test::mock_app()`
/// and exercise the real decision — the same reason `logging::build` and
/// `protocol::html_preview::handle` are generic. `AppHandle` defaults to `Wry`, so every
/// existing caller infers `R` and is unchanged.
pub(crate) async fn ensure_path_in_vault<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    path: &str,
) -> Result<(), String> {
    use tauri::Manager;
    check(path)?;
    let state = app.state::<crate::VaultRootState>();
    let ctx_mgr = app.state::<crate::context::ContextManager>();
    check_vault(path, &state, &ctx_mgr).await
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
    // §333 — 이 지점에 도달할 땐 보통 add_context가 이미 승인을 받아 두었다.
    // 그래도 거는 이유: `set_vault_root`를 직접 부르는 것이 웹뷰에게 더 짧은 길이다.
    crate::commands::approval_cmd::ensure_approved(&app, &path, crate::approval::ApprovalKind::Dir)
        .await?;

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
) -> Result<u64, String> {
    check(&path)?;
    check_vault(&path, &state, &ctx_mgr).await?;
    // §3.2 The written file's mtime: what the watcher will report for this write, so
    // the frontend can tell its own save's echo from any other change (issue 795).
    crate::fs::write_file_mtime(&path, &content)
        .await
        .map_err(|e| e.to_string())
}

/// §4.3 Create a NEW file holding `content` — refused with the `ALREADY_EXISTS:` sentinel,
/// and nothing touched, if anything is already at `path` (`fs::create_file`). For callers
/// that mean "make a new one"; `write_file` replaces the target. Same boundary checks.
#[tauri::command]
pub async fn create_file(
    path: String,
    content: String,
    state: tauri::State<'_, crate::VaultRootState>,
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
) -> Result<(), String> {
    check(&path)?;
    check_vault(&path, &state, &ctx_mgr).await?;
    crate::fs::create_file(&path, &content)
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

/// §4.3 Import a whole directory from any location into the vault.
///
/// Same policy as `import_file`: the source may sit outside the vault
/// (~/Desktop, ~/Downloads) and only the destination is vault-confined. The
/// destination must not already exist — the caller picks an unused name — so a
/// folder drop never merges into unrelated content.
///
/// Returns `null` when the source is not a directory. The frontend cannot work
/// that out for itself: the source is vault-external by design, and `list_dir`
/// — the obvious probe — is vault-confined and rejects it, which is exactly how
/// an earlier version of the drop path failed to recognise any folder at all.
#[tauri::command]
pub async fn import_dir(
    from: String,
    to: String,
    state: tauri::State<'_, crate::VaultRootState>,
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
) -> Result<Option<crate::fs::CopyDirReport>, String> {
    check(&from)?;
    check(&to)?;
    check_vault(&to, &state, &ctx_mgr).await?;
    crate::fs::copy_dir_all(&from, &to)
        .await
        .map_err(|e| e.to_string())
}

/// §3.2 Watch `path` for the calling window and answer the lease that holds the watch
/// (#797); `unwatch_dir` gives it back, and the window's destruction gives back every
/// lease it holds.
///
/// Only what the app already opened may be watched (the events tell a page the names
/// and times of what changes there):
/// - recursively (the default), only a registered folder or vault root — exactly one,
///   not a folder below or above it;
/// - non-recursively, only the folder of a `focus` file that a registered context holds
///   (`check_vault`, the rule file reads follow) — `path` must be that file's folder.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn watch_dir(
    path: String,
    recursive: Option<bool>,
    focus: Option<String>,
    window: tauri::Window,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::VaultRootState>,
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
    watcher_state: tauri::State<'_, crate::WatcherState>,
) -> Result<u64, String> {
    let recursive = recursive.unwrap_or(true);
    let legacy_root = state.0.read().await.clone();
    authorize_watch(
        &ctx_mgr,
        legacy_root.as_deref(),
        &path,
        recursive,
        focus.as_deref(),
    )
    .await?;
    let mut registry = watcher_state.0.lock().map_err(|e| e.to_string())?;
    registry.acquire(
        window.label(),
        &path,
        recursive,
        focus.as_deref(),
        &|spec| spawn_watcher(&app_handle, spec),
    )
}

/// §3.2 What `watch_dir` may watch (#797) — see its doc. The file check is
/// `check_vault`'s rule: any registered context, or the legacy vault root when none is
/// registered, and nothing at all before something is open.
async fn authorize_watch(
    ctx_mgr: &crate::context::ContextManager,
    legacy_root: Option<&std::path::Path>,
    path: &str,
    recursive: bool,
    focus: Option<&str>,
) -> Result<(), String> {
    check(path)?;
    if recursive {
        if ctx_mgr.context_registered_at(path).await.is_none() {
            return Err(format!(
                "watch_dir: {path} is not a registered folder or vault"
            ));
        }
        return Ok(());
    }
    let Some(file) = focus else {
        return Err("watch_dir: a folder watched for one file must name that file".into());
    };
    check(file)?;
    if ctx_mgr.list().await.is_empty() {
        vault_fallback_decision(legacy_root, file)?;
    } else {
        ctx_mgr.validate_path_any(file).await?;
    }
    let parent = crate::context::manager::resolve_canonical(file)?
        .parent()
        .map(std::path::Path::to_path_buf);
    if parent != Some(crate::context::manager::resolve_canonical(path)?) {
        return Err(format!("watch_dir: {path} is not the folder of {file}"));
    }
    Ok(())
}

/// §3.2 Give back a watch lease the calling window holds (#797). Another window's
/// lease is refused.
#[tauri::command]
pub async fn unwatch_dir(
    lease: u64,
    window: tauri::Window,
    app_handle: tauri::AppHandle,
    watcher_state: tauri::State<'_, crate::WatcherState>,
) -> Result<(), String> {
    let mut registry = watcher_state.0.lock().map_err(|e| e.to_string())?;
    registry.release(window.label(), lease, &|spec| {
        spawn_watcher(&app_handle, spec)
    })
}

/// How many times an ended watch is tried again once its folder exists, and the
/// longest wait between tries.
const REVIVE_ATTEMPTS: u32 = 8;
const REVIVE_MAX_DELAY: std::time::Duration = std::time::Duration::from_secs(30);

/// Start a watcher whose end — an error, its folder removed — is reported to the
/// registry, which then tries to start it again a bounded number of times.
pub(crate) fn spawn_watcher(
    app: &tauri::AppHandle,
    spec: &crate::fs::watch_registry::WatchSpec,
) -> Result<notify::RecommendedWatcher, crate::fs::FsError> {
    let ended_app = app.clone();
    let key = spec.key.clone();
    crate::fs::start_watching(
        spec,
        app.clone(),
        Box::new(move || watch_ended(&ended_app, key.clone())),
    )
}

fn watch_ended(app: &tauri::AppHandle, key: std::path::PathBuf) {
    use tauri::Manager;
    if let Ok(mut registry) = app.state::<crate::WatcherState>().0.lock() {
        registry.watch_ended(&key);
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let mut delay = std::time::Duration::from_secs(1);
        for _ in 0..REVIVE_ATTEMPTS {
            std::thread::sleep(delay);
            if key.exists() {
                if let Ok(mut registry) = app.state::<crate::WatcherState>().0.lock() {
                    if registry.revive(&key, &|spec| spawn_watcher(&app, spec)) {
                        return;
                    }
                }
            }
            delay = (delay * 2).min(REVIVE_MAX_DELAY);
        }
    });
}

/// §3.2 The files open in the editor. The watcher drops events below an excluded
/// folder (issue 795) except for these: the reload and conflict checks of an open
/// file need its events wherever it lives.
#[tauri::command]
pub fn set_open_files(paths: Vec<String>) -> Result<(), String> {
    crate::fs::set_open_files(&paths)
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
/// §324-e Read a media file from ANY location as a `data:` URL.
///
/// ‼️ NO `check_vault` — deliberately, and the same policy `import_file` already
/// applies to its own source: the file being dropped comes from Finder, so it is
/// vault-external by definition. `check` still runs, which rejects null bytes,
/// relative paths and `..` segments (`crate::fs::validate_path`).
///
/// The narrowness that justifies leaving the vault check out lives in
/// `crate::fs::media` — a media-extension allowlist that doubles as the MIME table,
/// and a byte cap — and the reasoning, plus the three conditions that keep it true,
/// is in that module's header. Read it before widening anything here.
///
/// Granted to the Host tier only (`capabilities/default.json`); it must never
/// appear in `plugin-sandbox.json`, and `plugin_call` cannot reach it because that
/// broker dispatches a closed enum.
#[tauri::command]
pub async fn read_media_data_url(path: String) -> Result<String, String> {
    check(&path)?;
    crate::fs::media::read_media_data_url(&path, crate::fs::media::MAX_INLINE_MEDIA_BYTES).await
}

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

    fn context(
        id: &str,
        path: &str,
        kind: crate::context::ContextType,
    ) -> crate::context::ContextInfo {
        crate::context::ContextInfo {
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

    // §3.2 #797 — a page may watch only what the app opened: the events tell it the
    // names and times of what changes in the folder.
    #[tokio::test]
    async fn watch_dir_watches_only_what_the_app_opened() {
        use crate::context::{ContextManager, ContextType};
        let vault = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let v = vault.path().to_str().unwrap().to_string();
        let o = outside.path().to_str().unwrap().to_string();
        std::fs::create_dir(vault.path().join("sub")).unwrap();
        let ext = outside.path().join("e.md");
        std::fs::write(&ext, "x").unwrap();
        let ext = ext.to_str().unwrap().to_string();
        let ctx = ContextManager::new();
        ctx.add(context("v", &v, ContextType::Vault)).await.unwrap();
        ctx.add(context("f", &ext, ContextType::File))
            .await
            .unwrap();

        // Recursive: a registered root only.
        // 이것을 실패시키는 것: 재귀 요청에 `context_registered_at` 검사를 지운다.
        assert!(authorize_watch(&ctx, None, &v, true, None).await.is_ok());
        assert!(authorize_watch(&ctx, None, &format!("{v}/sub"), true, None)
            .await
            .is_err());
        assert!(authorize_watch(&ctx, None, &o, true, None).await.is_err());

        // Non-recursive: the folder of a file the app opened, naming that file.
        assert!(authorize_watch(&ctx, None, &o, false, Some(&ext))
            .await
            .is_ok());
        // 이것을 실패시키는 것: focus 없는 비재귀 요청을 받는다.
        assert!(authorize_watch(&ctx, None, &o, false, None).await.is_err());
        // 이것을 실패시키는 것: focus 가 `path` 의 파일인지 확인하지 않는다.
        assert!(authorize_watch(&ctx, None, &v, false, Some(&ext))
            .await
            .is_err());
        // 이것을 실패시키는 것: focus 를 `validate_path_any` 로 확인하지 않는다.
        let stray = outside.path().join("other.md");
        std::fs::write(&stray, "x").unwrap();
        assert!(
            authorize_watch(&ctx, None, &o, false, Some(stray.to_str().unwrap()))
                .await
                .is_err()
        );
    }

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
