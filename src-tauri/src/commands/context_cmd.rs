// §88 Context IPC commands — add/remove/set_active/get/init_vault
// §86 Settings resolution (global + vault merge)
// §87 Cross-vault link resolution

use crate::context::vault_config::{self, ResolvedSettings, VaultConfig, VaultSection};
use crate::context::{ContextInfo, ContextManager, ContextType};

/// §backlog #3 / §89 — the `asset://` scope a context should be granted.
#[derive(Debug, PartialEq)]
enum AssetScopeGrant {
    /// Allow a single file (fallback when a file path has no parent directory).
    File(std::path::PathBuf),
    /// Allow a directory (recursively).
    Dir(std::path::PathBuf),
}

/// Decide the asset-protocol scope grant for a context.
///
/// §89 A standalone external `File` context grants its *parent directory*
/// (recursive) — not just the `.md` file — so images referenced relative to the
/// file (siblings and subfolders such as the Typora-style `./assets/img.png`)
/// resolve over `asset://`. `Vault`/`Folder` contexts grant their own directory.
fn asset_scope_grant(ctx: &ContextInfo) -> AssetScopeGrant {
    match ctx.context_type {
        ContextType::File => match std::path::Path::new(&ctx.path).parent() {
            Some(dir) => AssetScopeGrant::Dir(dir.to_path_buf()),
            None => AssetScopeGrant::File(std::path::PathBuf::from(&ctx.path)),
        },
        ContextType::Vault | ContextType::Folder => {
            AssetScopeGrant::Dir(std::path::PathBuf::from(&ctx.path))
        }
    }
}

/// §backlog #3 — grant the `asset://` protocol read access to an opened context's
/// location at runtime, so images render without a broad static Documents/Downloads
/// scope. Failure is non-fatal (only asset:// images under this path won't load).
pub fn register_asset_scope(app: &tauri::AppHandle, ctx: &ContextInfo) {
    use tauri::Manager;
    let scope = app.asset_protocol_scope();
    let result = match asset_scope_grant(ctx) {
        AssetScopeGrant::File(path) => scope.allow_file(&path),
        AssetScopeGrant::Dir(path) => scope.allow_directory(&path, true),
    };
    if let Err(e) = result {
        log::warn!(
            "§backlog#3 asset scope registration failed for {}: {e}",
            ctx.path
        );
    }
}

#[tauri::command]
pub async fn add_context(
    info: ContextInfo,
    state: tauri::State<'_, ContextManager>,
    app: tauri::AppHandle,
) -> Result<ContextInfo, String> {
    let added = state.add(info).await?;
    register_asset_scope(&app, &added);
    Ok(added)
}

#[tauri::command]
pub async fn remove_context(
    context_id: String,
    state: tauri::State<'_, ContextManager>,
    vault_root: tauri::State<'_, crate::VaultRootState>,
) -> Result<(), String> {
    state.remove(&context_id).await?;

    // §81 Update VaultRootState to the new active context (or clear if none)
    match state.active_id().await {
        Some(active_id) => {
            let contexts = state.list().await;
            if let Some(ctx) = contexts.iter().find(|c| c.id == active_id) {
                let mut root = vault_root.0.write().await;
                *root = Some(std::path::PathBuf::from(&ctx.path));
            }
        }
        None => {
            let mut root = vault_root.0.write().await;
            *root = None;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn set_active_context(
    context_id: String,
    state: tauri::State<'_, ContextManager>,
    vault_root: tauri::State<'_, crate::VaultRootState>,
) -> Result<(), String> {
    // §88 Atomic: resolve path BEFORE making any changes (eliminates TOCTOU window)
    let ctx_path = {
        let contexts = state.list().await;
        contexts
            .iter()
            .find(|c| c.id == context_id)
            .map(|c| c.path.clone())
            .ok_or_else(|| format!("Context not found: {}", context_id))?
    };

    // Update VaultRootState FIRST so check_vault sees the new path immediately
    {
        let mut root = vault_root.0.write().await;
        *root = Some(std::path::PathBuf::from(&ctx_path));
    }

    // Then update active_id
    state.set_active(&context_id).await
}

#[tauri::command]
pub async fn get_contexts(
    state: tauri::State<'_, ContextManager>,
) -> Result<Vec<ContextInfo>, String> {
    Ok(state.list().await)
}

#[tauri::command]
pub async fn get_vault_config(
    context_id: String,
    state: tauri::State<'_, ContextManager>,
) -> Result<Option<VaultConfig>, String> {
    state.get_config(&context_id).await
}

#[tauri::command]
pub async fn init_vault(path: String, alias: String) -> Result<VaultConfig, String> {
    let vault_path = std::path::Path::new(&path);
    if !vault_path.is_dir() {
        return Err(format!("Directory not found: {}", path));
    }
    let config = VaultConfig {
        vault: Some(VaultSection {
            vault_type: Some("general".to_string()),
            alias: Some(alias),
        }),
        ..Default::default()
    };
    vault_config::save_vault_config(vault_path, &config)?;
    Ok(config)
}

/// §86 Save vault config overrides to .baram/config.json
#[tauri::command]
pub async fn set_vault_config(
    context_id: String,
    config: crate::context::vault_config::VaultConfig,
    state: tauri::State<'_, ContextManager>,
) -> Result<(), String> {
    let contexts = state.list().await;
    let ctx = contexts
        .iter()
        .find(|c| c.id == context_id)
        .ok_or_else(|| format!("Context not found: {}", context_id))?;
    crate::context::vault_config::save_vault_config(std::path::Path::new(&ctx.path), &config)
}

/// §86 Load vault config directly by path (no context ID lookup needed).
#[tauri::command]
pub async fn get_vault_config_by_path(path: String) -> Result<VaultConfig, String> {
    crate::context::vault_config::load_vault_config(std::path::Path::new(&path))
}

/// §86 Save vault config directly by path (no context ID lookup needed).
#[tauri::command]
pub async fn set_vault_config_by_path(path: String, config: VaultConfig) -> Result<(), String> {
    crate::context::vault_config::save_vault_config(std::path::Path::new(&path), &config)
}

/// §88 Update alias for a context (syncs to ContextManager alias map).
#[tauri::command]
pub async fn update_context_alias(
    context_id: String,
    alias: String,
    state: tauri::State<'_, ContextManager>,
) -> Result<(), String> {
    state.update_alias(&context_id, alias).await
}

/// §88 Update label for a context.
#[tauri::command]
pub async fn update_context_label(
    context_id: String,
    label: String,
    state: tauri::State<'_, ContextManager>,
) -> Result<(), String> {
    state.update_label(&context_id, label).await
}

/// §88 Update color for a context.
#[tauri::command]
pub async fn update_context_color(
    context_id: String,
    color: String,
    state: tauri::State<'_, ContextManager>,
) -> Result<(), String> {
    state.update_color(&context_id, color).await
}

/// §87 Resolve a cross-vault link target by alias + target name.
/// Returns the absolute file path if found, None if not resolvable.
#[tauri::command]
pub async fn resolve_cross_vault_link(
    alias: String,
    target: String,
    state: tauri::State<'_, ContextManager>,
) -> Result<Option<String>, String> {
    // §87 Reject path traversal attempts upfront
    if target.contains("..") {
        return Ok(None);
    }

    // Find context by alias
    let context_id = match state.resolve_alias(&alias).await {
        Some(id) => id,
        None => return Ok(None),
    };

    // Get context info to find its root path
    let contexts = state.list().await;
    let ctx = match contexts.iter().find(|c| c.id == context_id) {
        Some(c) => c,
        None => return Ok(None),
    };

    let root = std::path::Path::new(&ctx.path);

    // Try exact match: root/target.md
    let candidate = root.join(format!("{}.md", target));
    if candidate.exists() {
        return Ok(Some(verify_within_root(&candidate, root)?));
    }

    // Try with path separators: root/path/to/target.md
    let candidate_with_path = root.join(format!(
        "{}.md",
        target.replace('/', std::path::MAIN_SEPARATOR_STR)
    ));
    if candidate_with_path.exists() {
        return Ok(Some(verify_within_root(&candidate_with_path, root)?));
    }

    // Try recursive file stem search (case-insensitive)
    let target_lower = target.to_lowercase();
    if let Ok(found) = find_file_by_stem(root, &target_lower) {
        // verify_within_root on the found path
        let found_path = std::path::Path::new(&found);
        return Ok(Some(verify_within_root(found_path, root)?));
    }

    Ok(None)
}

/// §87 Verify resolved path is canonically within the vault root (symlink protection).
fn verify_within_root(
    resolved: &std::path::Path,
    root: &std::path::Path,
) -> Result<String, String> {
    let canonical =
        std::fs::canonicalize(resolved).map_err(|e| format!("Failed to canonicalize: {}", e))?;
    let canonical_root =
        std::fs::canonicalize(root).map_err(|e| format!("Failed to canonicalize root: {}", e))?;
    if !canonical.starts_with(&canonical_root) {
        return Err("Access denied: resolved path is outside vault root".to_string());
    }
    Ok(canonical.to_string_lossy().to_string())
}

/// Recursively search for a file by stem (case-insensitive).
fn find_file_by_stem(dir: &std::path::Path, stem_lower: &str) -> Result<String, String> {
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Ok(found) = find_file_by_stem(&path, stem_lower) {
                return Ok(found);
            }
        } else if path.extension().map(|e| e == "md").unwrap_or(false) {
            if let Some(stem) = path.file_stem() {
                if stem.to_string_lossy().to_lowercase() == *stem_lower {
                    return Ok(path.to_string_lossy().to_string());
                }
            }
        }
    }
    Err("not found".to_string())
}

/// §86 Resolve merged settings: global config + vault overrides.
#[tauri::command]
pub async fn resolve_settings(
    context_id: String,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, ContextManager>,
) -> Result<ResolvedSettings, String> {
    // Read global settings from app config.json
    let keys = [
        "aiModel",
        "privacyMode",
        "enableWikilink",
        "enableMermaid",
        "dailyNotesFolder",
        "skillsFolder",
        "themeId",
    ];
    let mut global = std::collections::HashMap::new();
    for key in &keys {
        if let Ok(Some(val)) = crate::config::get_config(&app_handle, key) {
            global.insert(key.to_string(), val);
        }
    }

    // Get vault config (if context is a vault)
    let vault_config = state.get_config(&context_id).await.ok().flatten();

    Ok(vault_config::resolve_settings(
        &global,
        vault_config.as_ref(),
    ))
}

#[cfg(test)]
mod asset_scope_tests {
    use super::*;

    fn ctx(context_type: ContextType, path: &str) -> ContextInfo {
        ContextInfo {
            id: "id".into(),
            context_type,
            path: path.into(),
            label: "label".into(),
            color: "#ffffff".into(),
            alias: None,
            vault_type: None,
            added_at: 0,
        }
    }

    #[test]
    fn file_context_grants_parent_directory() {
        // §89 external single file → grant its parent dir (recursive) so sibling
        // and subfolder images resolve over asset:// (they were previously
        // outside the scope because only the .md file itself was allowed).
        let grant = asset_scope_grant(&ctx(ContextType::File, "/Users/x/Desktop/note.md"));
        assert_eq!(
            grant,
            AssetScopeGrant::Dir(std::path::PathBuf::from("/Users/x/Desktop"))
        );
    }

    #[test]
    fn vault_context_grants_own_directory() {
        let grant = asset_scope_grant(&ctx(ContextType::Vault, "/Users/x/vault"));
        assert_eq!(
            grant,
            AssetScopeGrant::Dir(std::path::PathBuf::from("/Users/x/vault"))
        );
    }

    #[test]
    fn folder_context_grants_own_directory() {
        let grant = asset_scope_grant(&ctx(ContextType::Folder, "/Users/x/folder"));
        assert_eq!(
            grant,
            AssetScopeGrant::Dir(std::path::PathBuf::from("/Users/x/folder"))
        );
    }
}
