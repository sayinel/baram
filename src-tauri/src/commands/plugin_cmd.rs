// §69 Plugin Marketplace — IPC command handlers
use crate::plugin;
use tauri::Manager;

#[tauri::command]
pub async fn plugin_install(
    url: String,
    checksum: Option<String>,
) -> Result<plugin::InstalledPluginInfo, String> {
    plugin::install_plugin(&url, checksum.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn plugin_uninstall(plugin_id: String) -> Result<(), String> {
    plugin::uninstall_plugin(&plugin_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn plugin_list_installed() -> Result<Vec<plugin::InstalledPluginInfo>, String> {
    plugin::list_installed().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn plugin_read_manifest(plugin_id: String) -> Result<plugin::PluginManifest, String> {
    plugin::read_manifest(&plugin_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn plugin_fetch_registry(url: String) -> Result<plugin::RegistryIndex, String> {
    plugin::fetch_registry(&url)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn plugin_get_dir() -> Result<String, String> {
    plugin::get_plugin_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

/// Grant the asset protocol runtime scope for the plugin install dir so
/// convertFileSrc(index.mjs) can load. ~/.baram/plugins is NOT covered by the
/// static $APPDATA scope, so this MUST run before any plugin loads.
#[tauri::command]
pub async fn plugin_prepare_scopes(app: tauri::AppHandle) -> Result<(), String> {
    let dir = plugin::get_plugin_dir().map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(&dir, true)
        .map_err(|e| e.to_string())?;
    Ok(())
}
