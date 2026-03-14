// Baram — Rust 백엔드 엔트리포인트

mod commands;
mod config;
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
use std::sync::Mutex;

use commands::{
    config_cmd, export_cmd, fs_cmd, git_cmd, index_cmd, keyring_cmd, llm_cmd, plugin_cmd,
    search_cmd, snapshot_cmd, tag_cmd,
};
use tauri::{Emitter, Manager};

/// Pending file paths from macOS file open events (cold start).
struct PendingOpenFiles(Mutex<Vec<String>>);

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
        .manage(index_cmd::LinkIndexState(tokio::sync::Mutex::new(
            index::LinkIndex::new(),
        )))
        .manage(llm::cancel::CancelRegistry::new())
        .invoke_handler(tauri::generate_handler![
            fs_cmd::read_file,
            fs_cmd::write_file,
            fs_cmd::list_dir,
            fs_cmd::rename_file,
            fs_cmd::delete_file,
            fs_cmd::create_dir,
            fs_cmd::delete_dir,
            fs_cmd::copy_file,
            fs_cmd::watch_dir,
            fs_cmd::extract_zip,
            fs_cmd::write_binary_file,
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
            tag_cmd::get_vault_tags,
            tag_cmd::rename_tag,
            tag_cmd::get_files_by_tag,
            snapshot_cmd::create_snapshot,
            snapshot_cmd::list_snapshots,
            snapshot_cmd::get_snapshot_diff,
            snapshot_cmd::restore_snapshot,
            snapshot_cmd::delete_snapshot,
            snapshot_cmd::get_file_history,
            plugin_cmd::plugin_install,
            plugin_cmd::plugin_uninstall,
            plugin_cmd::plugin_list_installed,
            plugin_cmd::plugin_read_manifest,
            plugin_cmd::plugin_fetch_registry,
            plugin_cmd::plugin_get_dir,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
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
