// §69 Plugin Marketplace — IPC command handlers
use crate::config;
use crate::plugin;
use tauri::Manager;

#[tauri::command]
pub async fn plugin_install(
    url: String,
    checksum: Option<String>,
) -> Result<plugin::InstalledPluginInfo, String> {
    // §259 — installing untrusted plugin code is gated off in shipped builds.
    if !plugin::plugins_runtime_enabled() {
        return Err(plugin::plugins_disabled_error());
    }
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

const DEV_FOLDERS_KEY: &str = "plugin.devFolders";

fn read_dev_folders(app: &tauri::AppHandle) -> Result<Vec<String>, String> {
    let raw = config::get_config(app, DEV_FOLDERS_KEY).map_err(|e| e.to_string())?;
    Ok(plugin::parse_dev_folders(raw))
}

fn dev_info(app: &tauri::AppHandle, path: &str) -> Result<plugin::InstalledPluginInfo, String> {
    let folder = std::path::Path::new(path);
    let manifest = plugin::read_manifest_at(folder).map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(folder, true)
        .map_err(|e| e.to_string())?;
    Ok(plugin::InstalledPluginInfo {
        manifest,
        install_path: path.to_string(),
        checksum: String::new(),
        is_dev: true,
    })
}

#[tauri::command]
pub async fn plugin_add_dev_folder(
    app: tauri::AppHandle,
    path: String,
) -> Result<plugin::InstalledPluginInfo, String> {
    // §259 — side-loading untrusted plugin code is gated off in shipped builds.
    if !plugin::plugins_runtime_enabled() {
        return Err(plugin::plugins_disabled_error());
    }
    let info = dev_info(&app, &path)?; // validate manifest + grant scope BEFORE persisting
    config::update_config(&app, DEV_FOLDERS_KEY, |raw| {
        let list = plugin::normalize_dev_list(&plugin::parse_dev_folders(raw), Some(&path), None);
        serde_json::to_string(&list).unwrap_or_default()
    })
    .map_err(|e| e.to_string())?;
    Ok(info)
}

#[tauri::command]
pub async fn plugin_remove_dev_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    config::update_config(&app, DEV_FOLDERS_KEY, |raw| {
        let list = plugin::normalize_dev_list(&plugin::parse_dev_folders(raw), None, Some(&path));
        serde_json::to_string(&list).unwrap_or_default()
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn plugin_list_dev(
    app: tauri::AppHandle,
) -> Result<Vec<plugin::InstalledPluginInfo>, String> {
    let mut out = Vec::new();
    for path in read_dev_folders(&app)? {
        match dev_info(&app, &path) {
            Ok(info) => out.push(info),
            Err(e) => log::warn!("[plugin] skip dev folder {path}: {e}"),
        }
    }
    Ok(out)
}

/// Plugin network proxy — reqwest fetch bypassing browser CORS (§69 Phase D).
/// Logic + the http/https scheme guard live in `plugin::http_fetch`.
#[tauri::command]
pub async fn plugin_http_fetch(
    url: String,
    init: Option<plugin::PluginFetchInit>,
) -> Result<plugin::PluginFetchResponse, String> {
    // §259 — the CORS-free network proxy is a data-exfiltration primitive for
    // untrusted plugin code; gate it off in shipped builds.
    if !plugin::plugins_runtime_enabled() {
        return Err(plugin::plugins_disabled_error());
    }
    plugin::http_fetch(url, init).await
}

/// Plugin app-global key/value storage — read (§69 Phase D).
/// Logic + the path-traversal guard live in `plugin::storage_read`.
#[tauri::command]
pub async fn plugin_storage_read(plugin_id: String, key: String) -> Result<Option<String>, String> {
    plugin::storage_read(plugin_id, key).await
}

/// Plugin app-global key/value storage — write (§69 Phase D).
#[tauri::command]
pub async fn plugin_storage_write(
    plugin_id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    plugin::storage_write(plugin_id, key, value).await
}

/// Plugin app-global key/value storage — list keys (§69 Phase D).
#[tauri::command]
pub async fn plugin_storage_list(plugin_id: String) -> Result<Vec<String>, String> {
    plugin::storage_list(plugin_id).await
}

/// Plugin app-global key/value storage — remove a key (§69 Phase D).
#[tauri::command]
pub async fn plugin_storage_remove(plugin_id: String, key: String) -> Result<(), String> {
    plugin::storage_remove(plugin_id, key).await
}
