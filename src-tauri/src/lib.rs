// Baram — Rust 백엔드 엔트리포인트

mod commands;
mod config;
mod context;
mod embedding;
mod export;
mod fs;
mod git;
mod index;
mod llm;
mod menu;
mod plugin;
mod search;
mod snapshot;
mod tag;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use commands::{
    config_cmd, context_cmd, embedding_cmd, export_cmd, fs_cmd, git_cmd, index_cmd, keyring_cmd,
    llm_cmd, plugin_cmd, search_cmd, snapshot_cmd, tag_cmd,
};
use tauri::{Emitter, Manager};

/// Pending file paths from macOS file open events (cold start).
struct PendingOpenFiles(Mutex<Vec<String>>);

/// Currently open vault root path — used to confine fs IPC commands to the vault.
/// None means no vault is open yet (cold start); all paths are allowed until set.
pub struct VaultRootState(pub tokio::sync::RwLock<Option<std::path::PathBuf>>);

/// Per-context directory watchers. Keyed by context id (or path as fallback).
/// Dropping a value closes the internal event channel and causes the watcher thread to exit naturally (RAII).
pub struct WatcherState(
    pub std::sync::Mutex<std::collections::HashMap<String, notify::RecommendedWatcher>>,
);

/// Unsaved-changes guard for app close/quit. When false, close/quit is
/// intercepted and the frontend is asked to confirm (via the `app://close-requested`
/// event). `confirm_quit` flips it to true so the subsequent exit proceeds.
pub struct QuitGuard(pub AtomicBool);

#[tauri::command]
fn get_opened_urls(state: tauri::State<'_, PendingOpenFiles>) -> Result<Vec<String>, String> {
    let mut pending = state.0.lock().map_err(|e| e.to_string())?;
    Ok(pending.drain(..).collect())
}

#[tauri::command]
fn update_menu_locale(
    state: tauri::State<'_, menu::MenuState>,
    labels: HashMap<String, String>,
) -> Result<(), String> {
    for (id, text) in &labels {
        if let Some(item) = state.items.get(id.as_str()) {
            item.set_text(text).map_err(|e| e.to_string())?;
        }
        if let Some(submenu) = state.submenus.get(id.as_str()) {
            submenu.set_text(text).map_err(|e| e.to_string())?;
        }
        if let Some(predef) = state.predefined.get(id.as_str()) {
            predef.set_text(text).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentMenuEntry {
    kind: String, // "item" | "separator"
    id: Option<String>,
    label: Option<String>,
    enabled: Option<bool>,
}

#[tauri::command]
fn update_recent_menu(
    app: tauri::AppHandle,
    state: tauri::State<'_, menu::MenuState>,
    entries: Vec<RecentMenuEntry>,
) -> Result<(), String> {
    let submenu = state
        .submenus
        .get("menu_file_open_recent")
        .ok_or_else(|| "open-recent submenu not found".to_string())?;

    // Clear existing children (remove-then-append avoids duplicate accumulation).
    let count = submenu.items().map_err(|e| e.to_string())?.len();
    for _ in 0..count {
        submenu.remove_at(0).map_err(|e| e.to_string())?;
    }

    for entry in &entries {
        if entry.kind == "separator" {
            let sep =
                tauri::menu::PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
            submenu.append(&sep).map_err(|e| e.to_string())?;
        } else {
            let label = entry.label.clone().unwrap_or_default();
            let enabled = entry.enabled.unwrap_or(true);
            let mut builder = tauri::menu::MenuItemBuilder::new(label).enabled(enabled);
            if let Some(id) = &entry.id {
                builder = builder.id(id.clone());
            }
            let item = builder.build(&app).map_err(|e| e.to_string())?;
            submenu.append(&item).map_err(|e| e.to_string())?;
        }
    }

    // Empty recents => grey out the whole submenu.
    submenu
        .set_enabled(!entries.is_empty())
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Frontend calls this after the user resolves the unsaved-changes prompt and
/// chooses to quit. Flips the guard so the CloseRequested/ExitRequested
/// interceptors let the exit through, then exits the app.
#[tauri::command]
fn confirm_quit(app: tauri::AppHandle, guard: tauri::State<QuitGuard>) {
    guard.0.store(true, Ordering::Relaxed);
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let (built_menu, menu_state) = menu::build_menu(app)?;
            app.set_menu(built_menu)?;
            app.manage(menu_state);

            app.on_menu_event(move |app_handle, event| {
                let _ = app_handle.emit("menu-event", event.id().as_ref());
            });

            Ok(())
        })
        .manage(PendingOpenFiles(Mutex::new(Vec::new())))
        .manage(QuitGuard(AtomicBool::new(false)))
        .manage(VaultRootState(tokio::sync::RwLock::new(None)))
        .manage(WatcherState(std::sync::Mutex::new(
            std::collections::HashMap::new(),
        )))
        .manage(context::ContextManager::new())
        .manage(index_cmd::LinkIndexState(tokio::sync::Mutex::new(
            std::collections::HashMap::new(),
        )))
        .manage(llm::cancel::CancelRegistry::new())
        .manage(embedding_cmd::EmbeddingState::new())
        .invoke_handler(tauri::generate_handler![
            fs_cmd::set_vault_root,
            fs_cmd::read_file,
            fs_cmd::write_file,
            fs_cmd::list_dir,
            fs_cmd::rename_file,
            fs_cmd::delete_file,
            fs_cmd::create_dir,
            fs_cmd::delete_dir,
            fs_cmd::copy_file,
            fs_cmd::import_file,
            fs_cmd::watch_dir,
            fs_cmd::extract_zip,
            fs_cmd::write_binary_file,
            fs_cmd::export_binary_file,
            config_cmd::get_config,
            config_cmd::set_config,
            config_cmd::remove_config,
            export_cmd::export_pdf,
            export_cmd::export_document,
            export_cmd::detect_pandoc,
            export_cmd::export_pandoc,
            export_cmd::run_custom_export,
            llm_cmd::llm_complete,
            llm_cmd::llm_list_models,
            llm_cmd::llm_cancel,
            index_cmd::get_backlinks,
            index_cmd::get_link_index,
            index_cmd::refresh_index,
            index_cmd::update_file_index,
            index_cmd::rename_file_with_links,
            index_cmd::get_unlinked_mentions,
            index_cmd::rename_block_id,
            index_cmd::rename_namespace,
            keyring_cmd::keyring_store,
            keyring_cmd::keyring_get,
            keyring_cmd::keyring_delete,
            search_cmd::search_files,
            git_cmd::git_status,
            git_cmd::git_stage,
            git_cmd::git_unstage,
            git_cmd::git_commit,
            git_cmd::git_diff_file,
            git_cmd::git_branches,
            git_cmd::git_switch_branch,
            git_cmd::git_discard,
            git_cmd::git_create_branch,
            git_cmd::git_log,
            git_cmd::git_stash_save,
            git_cmd::git_stash_list,
            git_cmd::git_stash_pop,
            git_cmd::git_stash_drop,
            git_cmd::git_remotes,
            git_cmd::git_fetch,
            git_cmd::git_pull,
            git_cmd::git_push,
            git_cmd::git_ahead_behind,
            git_cmd::git_delete_branch,
            get_opened_urls,
            update_menu_locale,
            update_recent_menu,
            confirm_quit,
            tag_cmd::get_vault_tags,
            tag_cmd::rename_tag,
            tag_cmd::get_files_by_tag,
            snapshot_cmd::create_snapshot,
            snapshot_cmd::list_snapshots,
            snapshot_cmd::get_snapshot_diff,
            snapshot_cmd::restore_snapshot,
            snapshot_cmd::delete_snapshot,
            snapshot_cmd::get_file_history,
            snapshot_cmd::diff_texts,
            snapshot_cmd::merge_texts,
            plugin_cmd::plugin_install,
            plugin_cmd::plugin_uninstall,
            plugin_cmd::plugin_list_installed,
            plugin_cmd::plugin_read_manifest,
            plugin_cmd::plugin_fetch_registry,
            plugin_cmd::plugin_get_dir,
            plugin_cmd::plugin_prepare_scopes,
            embedding_cmd::embed_text,
            embedding_cmd::search_knowledge,
            embedding_cmd::index_vault,
            embedding_cmd::index_status,
            embedding_cmd::index_file,
            context_cmd::add_context,
            context_cmd::remove_context,
            context_cmd::set_active_context,
            context_cmd::get_contexts,
            context_cmd::get_vault_config,
            context_cmd::init_vault,
            context_cmd::resolve_cross_vault_link,
            context_cmd::update_context_alias,
            context_cmd::update_context_label,
            context_cmd::update_context_color,
            context_cmd::set_vault_config,
            context_cmd::get_vault_config_by_path,
            context_cmd::set_vault_config_by_path,
            context_cmd::resolve_settings,
        ])
        // Unsaved-changes guard: intercept the window close (red X) and ask the
        // frontend to confirm. `confirm_quit` flips QuitGuard to let it through.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let guard = window.state::<QuitGuard>();
                if !guard.0.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.emit("app://close-requested", ());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            // Unsaved-changes guard: intercept Cmd+Q / Quit menu / Dock Quit.
            // `code.is_none()` means a user-initiated quit (not app.exit(code)).
            #[cfg(desktop)]
            if let tauri::RunEvent::ExitRequested { api, code, .. } = &_event {
                if code.is_none() {
                    let guard = _app_handle.state::<QuitGuard>();
                    if !guard.0.load(Ordering::Relaxed) {
                        api.prevent_exit();
                        if let Some(win) = _app_handle.get_webview_window("main") {
                            let _ = win.emit("app://close-requested", ());
                        }
                    }
                }
            }

            // macOS file association: handle files opened from Finder / "Open With"
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = &_event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u: &tauri::Url| u.to_file_path().ok())
                    .map(|p: std::path::PathBuf| p.to_string_lossy().into_owned())
                    .collect();

                // Emit to frontend (works when webview is already loaded)
                for path in &paths {
                    let _ = _app_handle.emit("file:open-request", path.clone());
                }

                // Also queue for cold-start (frontend calls get_opened_urls on mount)
                if let Some(state) = _app_handle.try_state::<PendingOpenFiles>() {
                    if let Ok(mut pending) = state.0.lock() {
                        for p in paths {
                            pending.push(p);
                        }
                    }
                }
            }
        });
}
