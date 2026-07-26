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
///
/// Measured through `plugin::serialized_len_capped` rather than `to_vec().len()`
/// (§260 3c-2a review, M6): the naive form allocates the whole frame just to learn
/// its size, so the cost of refusing scaled with the input the check exists to
/// refuse. Soundness of attributing failure to the cap depends on the parameter
/// being concretely `&serde_json::Value` — widen it to `impl Serialize` and a custom
/// `Serialize` could fail for its own reasons, making "too large" a lie.
fn check_report_size(msg: &serde_json::Value) -> Result<(), String> {
    match plugin::serialized_len_capped(msg, MAX_SANDBOX_REPORT_BYTES) {
        Some(_) => Ok(()),
        None => Err(format!(
            "sandbox message too large: over {MAX_SANDBOX_REPORT_BYTES} bytes"
        )),
    }
}

/// The mirror of `host_window_guard`: only a `plugin-<id>` window may use the
/// sandbox-side channel commands, and the id it acts as is derived from the
/// Tauri-verified label — never from an argument.
fn sandbox_window_guard(label: &str) -> Result<String, String> {
    plugin::plugin_id_from_label(label)
        .ok_or_else(|| "only sandbox windows may use the sandbox message channel".to_string())
}

// §260 3c-2a review (M4) — the boundary checks live in free functions so the
// wiring that actually enforces them is unit-testable; the `#[tauri::command]`s
// below are thin adapters that only supply `window.label()` and managed state.

/// Gate for both sandbox-side transport commands: the caller must be a sandbox
/// window AND still be registered by the host. Returns the caller-derived id.
fn authorize_sandbox_caller(
    label: &str,
    authorizer: &plugin::PluginAuthorizer,
) -> Result<String, String> {
    let plugin_id = sandbox_window_guard(label)?;
    // The host registers capabilities BEFORE creating the webview, so a live
    // session is always registered; a stopped one is fully mute (fail closed).
    if !authorizer.is_registered(label) {
        return Err("this sandbox is not registered".to_string());
    }
    Ok(plugin_id)
}

/// Host-only: revoke a sandbox's capabilities AND its inbound channel together, so
/// a stopped plugin can neither act nor be messaged.
fn deregister_sandbox(
    caller_label: &str,
    plugin_id: &str,
    authorizer: &plugin::PluginAuthorizer,
    channels: &plugin::SandboxChannels,
) -> Result<(), String> {
    host_window_guard(caller_label)?;
    let label = format!("plugin-{plugin_id}");
    authorizer.deregister(&label);
    channels.disconnect(&label);
    Ok(())
}

/// Host-only: deliver one frame to a sandbox over its own IPC channel.
fn send_to_sandbox(
    caller_label: &str,
    plugin_id: &str,
    msg: serde_json::Value,
    channels: &plugin::SandboxChannels,
) -> Result<(), String> {
    host_window_guard(caller_label)?;
    channels.send(&format!("plugin-{plugin_id}"), msg)
}

/// §260 3c-2b — read the caller's entry bundle from the directory the host BOUND at
/// registration, not from a directory re-derived here.
///
/// The earlier version searched (installed dir first, then dev folders) and got the
/// precedence backwards: the host deliberately lets a dev folder override an
/// installed copy of the same id (`plugin-lifecycle.ts`), so a search could return
/// the installed bundle while the host had validated and authorized the DEV
/// manifest — executing one plugin's code under another's grants, silently
/// (3c-2b review, I2).
///
/// The path comes from the trusted host, once, at register time; the sandbox still
/// cannot name a file, so `SourceRead` remains argument-free. The containment check
/// is defence in depth: even a buggy host cannot point a sandbox at somewhere that
/// is not a plugin directory.
fn read_own_source(
    app: &tauri::AppHandle,
    label: &str,
    authorizer: &plugin::PluginAuthorizer,
) -> Result<String, String> {
    let dir = authorizer
        .source_dir(label)
        .ok_or_else(|| "this sandbox is not registered".to_string())?;
    let dir = std::path::Path::new(&dir);
    if !is_plugin_directory(app, dir)? {
        return Err("plugin source directory is not a plugin location".to_string());
    }
    let manifest = plugin::read_manifest_at(dir).map_err(|e| e.to_string())?;
    plugin::read_bundle_in(dir, &manifest.main)
}

/// Is `dir` a plugin location — the installed plugin dir's child, or a registered
/// dev folder? Canonicalized on both sides so a symlink cannot disguise the answer.
fn is_plugin_directory(app: &tauri::AppHandle, dir: &std::path::Path) -> Result<bool, String> {
    let canonical = std::fs::canonicalize(dir)
        .map_err(|e| format!("plugin source directory is unreadable: {e}"))?;
    if let Ok(root) = plugin::get_plugin_dir() {
        if let Ok(canonical_root) = std::fs::canonicalize(&root) {
            if canonical.parent() == Some(canonical_root.as_path()) {
                return Ok(true);
            }
        }
    }
    for folder in read_dev_folders(app)? {
        if std::fs::canonicalize(&folder).is_ok_and(|dev| dev == canonical) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Upper bound on one brokered file payload (§260 Phase 3c-2c) — 8 MiB, in both
/// directions. Baram targets 10,000-line documents (~hundreds of KiB), so this
/// bounds a pathological call without touching real notes: a read is refused by
/// `metadata` before allocating, and a write is refused before touching the disk.
/// It bounds SIZE PER CALL, not total bytes written — the rate limiter bounds the
/// loop, and neither claims to bound a patient plugin's cumulative writes.
const MAX_PLUGIN_FILE_BYTES: u64 = 8 * 1024 * 1024;

/// The app's own per-vault state directory, which brokered file ops refuse.
const VAULT_STATE_DIR: &str = ".baram";

/// §260 Phase 3c-2c — refuse the `.baram` tree even inside an open vault.
///
/// The `files` capability is consented to as "read and write notes in the vault",
/// and `.baram/` is not notes — it is app state, and letting a plugin write it is a
/// strictly larger privilege than the grant describes:
///
/// - `.baram/config.json` holds the vault's `ai` section, **including `baseUrl`**.
///   A plugin that can rewrite it redirects every later LLM call in the app — the
///   user's own prompts and document context — to an endpoint of its choosing. That
///   is an exfiltration channel obtained without the `network` capability.
/// - `.baram/snapshots/` holds copies of earlier file versions (§71), i.e. content
///   the user may believe they deleted.
///
/// Matched on path COMPONENTS after canonicalization, so `..` tricks, a nested
/// `sub/.baram/x`, and a symlink into the tree are all covered, while a file merely
/// named `.baramish` is not.
/// Returns the resolved path so the caller can operate on THAT, not the original —
/// see `check_plugin_file_path`.
fn reject_app_state_path(path: &str) -> Result<std::path::PathBuf, String> {
    let resolved = crate::context::manager::resolve_canonical(path)?;
    if resolved
        .components()
        .any(|c| c.as_os_str() == VAULT_STATE_DIR)
    {
        return Err(format!(
            "access denied: {VAULT_STATE_DIR}/ is app state, not vault content"
        ));
    }
    Ok(resolved)
}

/// Every check a brokered file op needs, cheapest-failing first: the vault rule
/// shared with `read_file` (§88 multi-context, canonicalizing, deny-by-default when
/// nothing is open), then the app-state carve-out.
///
/// Returns the CANONICAL path, and the ops use it instead of the caller's string.
/// Unlike the app's own file commands, both halves of a symlink swap are available to
/// this caller: a `files`-granted plugin can create a symlink inside the vault
/// (pointing in-vault, so the check passes) and repoint it at `/etc` before the read
/// lands. Acting on the canonical path closes that window — it names only real
/// directories, so no later symlink change can redirect it.
async fn check_plugin_file_path(
    app: &tauri::AppHandle,
    path: &str,
) -> Result<std::path::PathBuf, String> {
    super::fs_cmd::ensure_path_in_vault(app, path).await?;
    reject_app_state_path(path)
}

/// The canonical path as a `&str` for the `crate::fs` helpers, which take one. A
/// non-UTF-8 path is refused rather than lossily converted: a lossy string would
/// name a DIFFERENT file than the one just authorized.
fn authorized_path_str(path: &std::path::Path) -> Result<&str, String> {
    path.to_str()
        .ok_or_else(|| "path is not valid UTF-8".to_string())
}

/// Execute an authorized op using the CALLER-derived plugin id (never a
/// client-supplied id). Storage is namespaced per plugin id → isolation.
async fn execute_op(
    app: &tauri::AppHandle,
    label: &str,
    plugin_id: &str,
    op: plugin::PluginOp,
    authorizer: &plugin::PluginAuthorizer,
) -> Result<serde_json::Value, String> {
    use plugin::PluginOp::*;
    match op {
        // §260 3c-2b — the caller's OWN bundle, from the directory the host bound at
        // registration. No path argument exists, so a sandbox cannot name a file.
        SourceRead => Ok(serde_json::json!(read_own_source(app, label, authorizer)?)),
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
        // §260 3c-2c — vault-bounded file ops. Authorization (files / files:readonly)
        // already happened in `plugin_call`; what is left is WHERE, which is the same
        // decision `read_file` makes, plus the `.baram` carve-out.
        FilesRead { path } => {
            let resolved = check_plugin_file_path(app, &path).await?;
            let text = plugin::read_text_capped(&resolved, MAX_PLUGIN_FILE_BYTES)
                .map_err(|e| format!("file \"{path}\" {e}"))?;
            Ok(serde_json::json!(text))
        }
        FilesWrite { path, content } => {
            let resolved = check_plugin_file_path(app, &path).await?;
            // Measured on the string we already hold (Tauri parsed the op before this
            // command ran), so unlike the read there is nothing to save by checking
            // first — this bounds what reaches the DISK, not what reaches memory.
            let len = content.len() as u64;
            if len > MAX_PLUGIN_FILE_BYTES {
                return Err(format!(
                    "file \"{path}\" write is {len} bytes, over the {MAX_PLUGIN_FILE_BYTES}-byte limit"
                ));
            }
            crate::fs::write_file(authorized_path_str(&resolved)?, &content)
                .await
                .map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }
        FilesList { path } => {
            let resolved = check_plugin_file_path(app, &path).await?;
            // Names only — parity with the trusted tier's `FilesAPI.listDir`, and
            // strictly less than `FileEntry` (no sizes, no mtimes) for the same call.
            // Non-recursive: a recursive walk of a large vault is a cost a plugin
            // should have to pay per directory, where the rate limiter can see it.
            let entries = crate::fs::list_dir(authorized_path_str(&resolved)?, false)
                .await
                .map_err(|e| e.to_string())?;
            Ok(serde_json::json!(entries
                .into_iter()
                .map(|e| e.name)
                .collect::<Vec<_>>()))
        }
    }
}

/// §260 host-only — register a sandbox plugin's granted capabilities. Rejects
/// callers whose window label is itself a sandbox (`plugin-<id>`).
#[tauri::command]
pub async fn plugin_sandbox_register(
    window: tauri::WebviewWindow,
    plugin_id: String,
    capabilities: Vec<String>,
    install_path: String,
    authorizer: tauri::State<'_, plugin::PluginAuthorizer>,
) -> Result<(), String> {
    host_window_guard(window.label())?;
    // §260 3c-2b — the host binds the directory it resolved and validated together
    // with the grants, so `SourceRead` reads the code that matches THIS manifest (a
    // dev folder legitimately shadows an installed copy of the same id).
    authorizer.register(format!("plugin-{plugin_id}"), capabilities, install_path);
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
    deregister_sandbox(window.label(), &plugin_id, &authorizer, &channels)
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
    // The derived id is unused here (the label IS the channel key); connect only
    // needs the gate. `report` below is what acts as the id.
    authorize_sandbox_caller(&label, &authorizer)?;
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
    let plugin_id = authorize_sandbox_caller(window.label(), &authorizer)?;
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
    send_to_sandbox(window.label(), &plugin_id, msg, &channels)
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
    app: tauri::AppHandle,
    authorizer: tauri::State<'_, plugin::PluginAuthorizer>,
) -> Result<serde_json::Value, String> {
    // `authorize_op` keeps the "does this op need a grant?" decision on the op
    // (§260 3c-2b: `SourceRead` needs none), so no call site can get it wrong.
    let plugin_id = authorizer
        .authorize_op(window.label(), &op)
        .map_err(|e| e.to_string())?;
    execute_op(&app, window.label(), &plugin_id, op, &authorizer).await
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

    /// A registered authorizer + an empty channel map, the state every sandbox
    /// transport command runs against.
    fn state() -> (plugin::PluginAuthorizer, plugin::SandboxChannels) {
        (
            plugin::PluginAuthorizer::new(),
            plugin::SandboxChannels::new(),
        )
    }

    fn dummy_channel() -> tauri::ipc::Channel<serde_json::Value> {
        tauri::ipc::Channel::new(|_| Ok(()))
    }

    #[test]
    fn sandbox_caller_gate_requires_a_sandbox_label_and_registration() {
        let (authorizer, _) = state();
        // A host window may never use the sandbox-side transport commands.
        assert!(authorize_sandbox_caller("main", &authorizer).is_err());
        assert!(authorize_sandbox_caller("file-1", &authorizer).is_err());
        // A sandbox window the host never registered is refused (fail closed).
        assert!(authorize_sandbox_caller("plugin-alpha", &authorizer).is_err());
        authorizer.register("plugin-alpha".into(), vec![], "/p/alpha".into());
        assert_eq!(
            authorize_sandbox_caller("plugin-alpha", &authorizer).unwrap(),
            "alpha"
        );
    }

    #[test]
    fn deregister_revokes_capabilities_and_the_channel_together() {
        let (authorizer, channels) = state();
        authorizer.register(
            "plugin-alpha".into(),
            vec!["storage".into()],
            "/p/alpha".into(),
        );
        channels.connect("plugin-alpha".into(), dummy_channel());
        assert!(channels.send("plugin-alpha", serde_json::json!({})).is_ok());

        deregister_sandbox("main", "alpha", &authorizer, &channels).unwrap();

        // Mute in both directions: cannot be messaged, cannot report or broker.
        assert!(channels
            .send("plugin-alpha", serde_json::json!({}))
            .is_err());
        assert!(authorize_sandbox_caller("plugin-alpha", &authorizer).is_err());
        assert!(authorizer
            .authorize_any("plugin-alpha", &["storage"])
            .is_err());
    }

    #[test]
    fn deregister_and_send_are_host_only() {
        let (authorizer, channels) = state();
        authorizer.register("plugin-alpha".into(), vec![], "/p/alpha".into());
        channels.connect("plugin-alpha".into(), dummy_channel());
        // A sandbox must not be able to revoke, or message, another sandbox.
        assert!(deregister_sandbox("plugin-evil", "alpha", &authorizer, &channels).is_err());
        assert!(send_to_sandbox("plugin-evil", "alpha", serde_json::json!({}), &channels).is_err());
        // …and the host still can, proving the guard is what rejected above.
        assert!(send_to_sandbox("main", "alpha", serde_json::json!({}), &channels).is_ok());
    }

    #[test]
    fn send_targets_the_label_derived_from_the_plugin_id() {
        let (_, channels) = state();
        channels.connect("plugin-alpha".into(), dummy_channel());
        assert!(send_to_sandbox("main", "alpha", serde_json::json!({}), &channels).is_ok());
        // Guards against passing a label where an id belongs (would key plugin-plugin-alpha).
        assert!(send_to_sandbox("main", "plugin-alpha", serde_json::json!({}), &channels).is_err());
    }

    #[test]
    fn report_size_cap_admits_control_frames_and_rejects_oversized() {
        let ready = serde_json::json!({
            "type": "ready",
            "registered": { "commands": ["hello"], "events": [] }
        });
        assert!(check_report_size(&ready).is_ok());

        // Pin the boundary (the check is `>`, not `>=`): a JSON string serializes to
        // its length plus the two quotes, so this frame is EXACTLY the cap.
        let exact = serde_json::Value::String("x".repeat(MAX_SANDBOX_REPORT_BYTES - 2));
        assert!(
            check_report_size(&exact).is_ok(),
            "a frame of exactly the cap must be admitted"
        );
        let one_over = serde_json::Value::String("x".repeat(MAX_SANDBOX_REPORT_BYTES - 1));
        assert!(
            check_report_size(&one_over).is_err(),
            "one byte over the cap must be refused"
        );

        // A frame well over the cap is refused rather than forwarded to the host.
        let huge = serde_json::json!({ "type": "emitEvent", "args": ["x".repeat(MAX_SANDBOX_REPORT_BYTES)] });
        let err = check_report_size(&huge).expect_err("oversized frame must be refused");
        assert!(err.contains("too large"), "unexpected error: {err}");
    }

    /// §260 3c-2c — `.baram/` is app state, and a plugin that can WRITE
    /// `.baram/config.json` can repoint the vault's AI `baseUrl` and exfiltrate every
    /// later prompt without holding `network`. Component-matched after
    /// canonicalization, so nesting and `..` are covered and a similarly-named file
    /// is not.
    #[test]
    fn app_state_paths_are_refused_at_any_depth() {
        let base = std::env::temp_dir().join(format!("baram-state-{}", std::process::id()));
        let state = base.join(VAULT_STATE_DIR);
        let nested = base.join("notes").join(VAULT_STATE_DIR);
        std::fs::create_dir_all(state.join("snapshots").join("data")).unwrap();
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(state.join("config.json"), "{}").unwrap();
        std::fs::write(base.join("note.md").as_path(), "# hi").unwrap();
        std::fs::write(base.join(".baramish").as_path(), "not app state").unwrap();

        let denied = |p: std::path::PathBuf| {
            let e = reject_app_state_path(p.to_str().unwrap())
                .expect_err(&format!("must be refused: {}", p.display()));
            assert!(e.contains("app state"), "unexpected error: {e}");
        };
        denied(state.join("config.json"));
        denied(state.join("snapshots").join("data").join("old.md"));
        denied(nested.join("anything.md")); // not just at the vault root
        denied(state.join("does-not-exist-yet.json")); // a WRITE target need not exist
                                                       // Nor can a traversal launder it.
        denied(
            base.join("notes")
                .join("..")
                .join(VAULT_STATE_DIR)
                .join("config.json"),
        );

        // Ordinary content, and a file merely NAMED like the state dir, are fine.
        assert!(reject_app_state_path(base.join("note.md").to_str().unwrap()).is_ok());
        assert!(reject_app_state_path(base.join(".baramish").to_str().unwrap()).is_ok());

        std::fs::remove_dir_all(&base).ok();
    }

    /// §260 3c-2c — the ops act on the RESOLVED path, which is what closes the
    /// symlink-swap window a `files`-granted plugin could otherwise open (it controls
    /// both the path it asks for and, inside the vault, what that path points at).
    #[cfg(unix)]
    #[test]
    fn the_authorized_path_is_the_resolved_one() {
        let base = std::env::temp_dir().join(format!("baram-link-{}", std::process::id()));
        std::fs::create_dir_all(base.join("real")).unwrap();
        let target = base.join("real").join("note.md");
        std::fs::write(&target, "# hi").unwrap();
        let link = base.join("link.md");
        std::os::unix::fs::symlink(&target, &link).unwrap();

        let resolved = reject_app_state_path(link.to_str().unwrap()).unwrap();
        assert_eq!(
            resolved,
            std::fs::canonicalize(&target).unwrap(),
            "a symlinked path must resolve to its target before the op runs"
        );

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn sandbox_window_guard_is_the_mirror_and_derives_the_id() {
        assert_eq!(sandbox_window_guard("plugin-alpha").unwrap(), "alpha");
        assert!(sandbox_window_guard("main").is_err());
        assert!(sandbox_window_guard("file-1").is_err());
    }
}
