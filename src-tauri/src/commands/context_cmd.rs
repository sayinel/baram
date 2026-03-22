// §88 Context IPC commands — add/remove/set_active/get/init_vault

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
) -> Result<(), String> {
    state.remove(&context_id).await
}

#[tauri::command]
pub async fn set_active_context(
    context_id: String,
    state: tauri::State<'_, ContextManager>,
) -> Result<(), String> {
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
