// §88 Context IPC commands — add/remove/set_active/get/init_vault
// §87 Cross-vault link resolution

use crate::context::vault_config::{self, VaultConfig, VaultSection};
use crate::context::{ContextInfo, ContextManager};

#[tauri::command]
pub async fn add_context(
    info: ContextInfo,
    state: tauri::State<'_, ContextManager>,
) -> Result<ContextInfo, String> {
    state.add(info).await
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
    // Update ContextManager active id
    state.set_active(&context_id).await?;

    // §81 Also update VaultRootState so file IPC commands (check_vault) work
    let contexts = state.list().await;
    if let Some(ctx) = contexts.iter().find(|c| c.id == context_id) {
        let mut root = vault_root.0.write().await;
        *root = Some(std::path::PathBuf::from(&ctx.path));
    }

    Ok(())
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

/// §87 Resolve a cross-vault link target by alias + target name.
/// Returns the absolute file path if found, None if not resolvable.
#[tauri::command]
pub async fn resolve_cross_vault_link(
    alias: String,
    target: String,
    state: tauri::State<'_, ContextManager>,
) -> Result<Option<String>, String> {
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
        return Ok(Some(candidate.to_string_lossy().to_string()));
    }

    // Try with path separators: root/path/to/target.md
    let candidate_with_path = root.join(format!(
        "{}.md",
        target.replace('/', std::path::MAIN_SEPARATOR_STR)
    ));
    if candidate_with_path.exists() {
        return Ok(Some(candidate_with_path.to_string_lossy().to_string()));
    }

    // Try recursive file stem search (case-insensitive)
    let target_lower = target.to_lowercase();
    if let Ok(found) = find_file_by_stem(root, &target_lower) {
        return Ok(Some(found));
    }

    Ok(None)
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
