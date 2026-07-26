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
    // §259 — don't widen the asset-protocol scope when plugins are gated off.
    if !plugin::plugins_runtime_enabled() {
        return Err(plugin::plugins_disabled_error());
    }
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
    // §259 — no plugin runs when disabled, so nothing should be writing plugin
    // storage; reject to keep the surface inert.
    if !plugin::plugins_runtime_enabled() {
        return Err(plugin::plugins_disabled_error());
    }
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

/// Only a host window (main / file-mode) may register or deregister a plugin's
/// capabilities — a sandbox window must never grant itself anything.
fn host_window_guard(label: &str) -> Result<(), String> {
    if plugin::plugin_id_from_label(label).is_some() {
        return Err("sandbox windows may not register/deregister capabilities".to_string());
    }
    Ok(())
}

/// Upper bound on one sandbox→host frame (§260 Phase 3c-2a). Today's frames
/// (ready / emitEvent / callResult) are kilobytes, but a Phase-4 document-transform
/// contribution returns whole documents, and Baram targets 10,000-line files — so
/// the ceiling is set to bound a monster frame, not to police normal traffic.
/// Rate limiting is a separate follow-up (a cap alone does not stop a flood).
const MAX_SANDBOX_REPORT_BYTES: usize = 8 * 1024 * 1024;

/// Bound an attacker-controlled sandbox→host frame before forwarding it: the emit
/// re-serializes into the main window's event loop and JS heap, so one plugin must
/// not be able to stall the editor with a multi-MB frame. Tauri has already parsed
/// `msg` by the time a command runs, so this caps the FORWARD, not the initial
/// parse — the latter would need an IPC-layer limit Tauri v2 does not expose.
fn check_report_size(msg: &serde_json::Value) -> Result<(), String> {
    let len = serde_json::to_vec(msg).map_err(|e| e.to_string())?.len();
    if len > MAX_SANDBOX_REPORT_BYTES {
        return Err(format!(
            "sandbox message too large: {len} bytes (max {MAX_SANDBOX_REPORT_BYTES})"
        ));
    }
    Ok(())
}

/// The mirror of `host_window_guard`: only a `plugin-<id>` window may use the
/// sandbox-side channel commands, and the id it acts as is derived from the
/// Tauri-verified label — never from an argument.
fn sandbox_window_guard(label: &str) -> Result<String, String> {
    plugin::plugin_id_from_label(label)
        .ok_or_else(|| "only sandbox windows may use the sandbox message channel".to_string())
}

/// Execute an authorized op using the CALLER-derived plugin id (never a
/// client-supplied id). Storage is namespaced per plugin id → isolation.
async fn execute_op(plugin_id: &str, op: plugin::PluginOp) -> Result<serde_json::Value, String> {
    use plugin::PluginOp::*;
    match op {
        StorageRead { key } => Ok(serde_json::json!(
            plugin::storage_read(plugin_id.to_string(), key).await?
        )),
        StorageWrite { key, value } => {
            plugin::storage_write(plugin_id.to_string(), key, value).await?;
            Ok(serde_json::Value::Null)
        }
        StorageList => Ok(serde_json::json!(
            plugin::storage_list(plugin_id.to_string()).await?
        )),
        StorageRemove { key } => {
            plugin::storage_remove(plugin_id.to_string(), key).await?;
            Ok(serde_json::Value::Null)
        }
        HttpFetch { url, init } => Ok(serde_json::json!(plugin::http_fetch(url, init).await?)),
    }
}

/// §260 host-only — register a sandbox plugin's granted capabilities. Rejects
/// callers whose window label is itself a sandbox (`plugin-<id>`).
#[tauri::command]
pub async fn plugin_sandbox_register(
    window: tauri::WebviewWindow,
    plugin_id: String,
    capabilities: Vec<String>,
    authorizer: tauri::State<'_, plugin::PluginAuthorizer>,
) -> Result<(), String> {
    host_window_guard(window.label())?;
    authorizer.register(format!("plugin-{plugin_id}"), capabilities);
    Ok(())
}

/// §260 host-only — drop a sandbox plugin's registered capabilities. Also drops
/// its inbound channel (Phase 3c-2a) so a stopped sandbox cannot be messaged.
#[tauri::command]
pub async fn plugin_sandbox_deregister(
    window: tauri::WebviewWindow,
    plugin_id: String,
    authorizer: tauri::State<'_, plugin::PluginAuthorizer>,
    channels: tauri::State<'_, plugin::SandboxChannels>,
) -> Result<(), String> {
    host_window_guard(window.label())?;
    let label = format!("plugin-{plugin_id}");
    authorizer.deregister(&label);
    channels.disconnect(&label);
    Ok(())
}

/// §260 Phase 3c-2a sandbox-only — hand the host an IPC channel for inbound
/// messages. Called once when the sandbox client boots. Requires the host to
/// have registered this plugin first (fail closed: a window nobody started
/// cannot park a channel).
#[tauri::command]
pub async fn plugin_sandbox_connect(
    window: tauri::WebviewWindow,
    channel: tauri::ipc::Channel<serde_json::Value>,
    authorizer: tauri::State<'_, plugin::PluginAuthorizer>,
    channels: tauri::State<'_, plugin::SandboxChannels>,
) -> Result<(), String> {
    let label = window.label().to_string();
    sandbox_window_guard(&label)?;
    if !authorizer.is_registered(&label) {
        return Err("this sandbox is not registered".to_string());
    }
    channels.connect(label, channel);
    Ok(())
}

/// §260 Phase 3c-2a sandbox-only — the sandbox→host direction. The plugin id is
/// stamped from the caller's label, so a sandbox cannot impersonate another on
/// the host's `plugin:s2h` channel.
///
/// A plain broadcast `emit` is safe here: no `plugin-*` window holds any
/// `core:event:*` permission, so only host windows can receive it. `emit_filter`
/// is deliberately NOT used — it cannot withhold an event from a JS listener
/// registered with the default `EventTarget::Any` (`match_any_or_filter`,
/// tauri/src/event/listener.rs), so it would imply a guarantee it does not give.
#[tauri::command]
pub async fn plugin_sandbox_report(
    window: tauri::WebviewWindow,
    msg: serde_json::Value,
    app: tauri::AppHandle,
    authorizer: tauri::State<'_, plugin::PluginAuthorizer>,
) -> Result<(), String> {
    use tauri::Emitter;
    let plugin_id = sandbox_window_guard(window.label())?;
    // Symmetric with connect, and it makes a deregistered sandbox fully mute: the
    // host registers capabilities BEFORE creating the webview, so a live session
    // is always registered; a stopped one can no longer talk to the host at all.
    if !authorizer.is_registered(window.label()) {
        return Err("this sandbox is not registered".to_string());
    }
    check_report_size(&msg)?;
    app.emit(
        "plugin:s2h",
        serde_json::json!({ "pluginId": plugin_id, "msg": msg }),
    )
    .map_err(|e| e.to_string())
}

/// §260 Phase 3c-2a host-only — the host→sandbox direction, delivered over the
/// target sandbox's own IPC channel (never an event, so no other window sees it).
#[tauri::command]
pub async fn plugin_sandbox_send(
    window: tauri::WebviewWindow,
    plugin_id: String,
    msg: serde_json::Value,
    channels: tauri::State<'_, plugin::SandboxChannels>,
) -> Result<(), String> {
    host_window_guard(window.label())?;
    channels.send(&format!("plugin-{plugin_id}"), msg)
}

/// The sole IPC entry point a sandboxed plugin may use for privileged ops. Every
/// call is authorized by the Tauri-verified caller label + registered capability.
///
/// §260 — unlike the §259-gated plugin_install/plugin_http_fetch, plugin_call is
/// intentionally NOT behind `plugins_runtime_enabled()`: it is the sandboxed
/// channel that #260 Phase 5's release-gate transition will *allow* in release
/// builds. Its control is the authorizer (an unregistered/empty map denies every
/// call) plus that future release-gate — never the §259 kill-switch, which Phase 5
/// lifts for sandboxed plugins.
#[tauri::command]
pub async fn plugin_call(
    window: tauri::WebviewWindow,
    op: plugin::PluginOp,
    authorizer: tauri::State<'_, plugin::PluginAuthorizer>,
) -> Result<serde_json::Value, String> {
    let plugin_id = authorizer
        .authorize(window.label(), op.required_capability())
        .map_err(|e| e.to_string())?;
    execute_op(&plugin_id, op).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_window_guard_rejects_plugin_windows() {
        assert!(host_window_guard("plugin-evil").is_err());
        assert!(host_window_guard("main").is_ok());
        assert!(host_window_guard("file-1").is_ok());
    }

    #[test]
    fn report_size_cap_admits_control_frames_and_rejects_oversized() {
        let ready = serde_json::json!({
            "type": "ready",
            "registered": { "commands": ["hello"], "events": [] }
        });
        assert!(check_report_size(&ready).is_ok());
        // A frame just over the cap is refused rather than forwarded to the host.
        let huge = serde_json::json!({ "type": "emitEvent", "args": ["x".repeat(MAX_SANDBOX_REPORT_BYTES)] });
        let err = check_report_size(&huge).expect_err("oversized frame must be refused");
        assert!(err.contains("too large"), "unexpected error: {err}");
    }

    #[test]
    fn sandbox_window_guard_is_the_mirror_and_derives_the_id() {
        assert_eq!(sandbox_window_guard("plugin-alpha").unwrap(), "alpha");
        assert!(sandbox_window_guard("main").is_err());
        assert!(sandbox_window_guard("file-1").is_err());
    }
}
