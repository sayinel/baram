// Baram — Rust 백엔드 엔트리포인트

mod approval;
pub mod cli;
mod commands;
mod config;
mod context;
mod embedding;
mod export;
mod font;
mod fs;
mod git;
mod index;
mod llm;
/// Public only so `tests/logging_install*.rs` can reach it. `install` ends in
/// `log::set_boxed_logger`, which is process-global and one-shot, so the only place it
/// can be exercised is an integration test binary that owns its own process — and an
/// integration test links the library as an external crate. Nothing outside the crate
/// calls this.
pub mod logging;
mod md;
mod menu;
mod plugin;
mod protocol;
mod search;
mod snapshot;
mod tag;
mod task;
mod thumbnail;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use commands::{
    approval_cmd, config_cmd, context_cmd, embedding_cmd, export_cmd, font_cmd, fs_cmd, git_cmd,
    index_cmd, keyring_cmd, llm_cmd, plugin_cmd, plugin_dev_cmd, plugin_index_cmd,
    plugin_note_link_cmd, search_cmd, snapshot_cmd, tag_cmd, task_cmd, theme_cmd, thumbnail_cmd,
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

/// §341 기능이 꺼진 메뉴 항목을 회색 처리한다.
///
/// `update_menu_locale` 과 같은 `MenuState.items` 조회를 쓰고 `set_text` 대신
/// `set_enabled` 를 부른다. 비활성 항목은 accelerator 도 발화하지 않으므로, 이것이
/// 네이티브 레이어의 우회를 닫는 방법이다.
#[tauri::command]
fn update_menu_enabled(
    state: tauri::State<'_, menu::MenuState>,
    items: HashMap<String, bool>,
) -> Result<(), String> {
    for (id, enabled) in &items {
        if let Some(item) = state.items.get(id.as_str()) {
            item.set_enabled(*enabled).map_err(|e| e.to_string())?;
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

/// What the close guard does about one `CloseRequested`.
#[derive(Debug, PartialEq, Eq)]
enum CloseAction {
    /// Let the window close.
    Allow,
    /// Cancel the close and ask the frontend to resolve unsaved changes first.
    PreventAndAsk,
}

/// The whole close-guard decision, in one testable place.
///
/// §260 Phase 3c-3 — the guard must NOT apply to a `plugin-*` sandbox window. Those
/// are opened and closed programmatically by the plugin loader, never by a user
/// gesture, and intercepting their close did two things at once:
///
/// 1. `api.prevent_close()` cancelled the close, so unloading a plugin left its
///    webview running with its capabilities — the orphan this phase set out to fix.
/// 2. `window.emit("app://close-requested")` is a BROADCAST, so the main window's
///    `useCloseGuard` received it, found no dirty tabs, and called `confirm_quit`,
///    which calls `app.exit(0)`. **Unloading a plugin quit the app.**
///
/// Invisible until this phase only because `core:window:allow-close` was missing, so
/// the close never reached the window manager and `CloseRequested` never fired for a
/// plugin window. The main window keeps the guard: closing it IS a user gesture that may
/// need the unsaved-changes prompt, and it ends the app.
///
/// §89 A `file-*` window must not reach that broadcast either, for the same reason: closing
/// one quit the app whenever the main window had nothing unsaved. It answers for itself in
/// `use-file-window-guard.ts`; its `onCloseRequested` listener makes tauri hold the close,
/// and a window whose page never got that far has nothing to ask about.
///
/// A function rather than a predicate the handler combines with the quit flag (3c-3
/// code review, M4): the previous shape let a test pass while the guard's only call
/// site was deleted, leaving the defect above untested.
fn close_action(label: &str, quit_confirmed: bool) -> CloseAction {
    if plugin::plugin_id_from_label(label).is_some() || is_file_window(label) || quit_confirmed {
        return CloseAction::Allow;
    }
    CloseAction::PreventAndAsk
}

/// §89 The window the user last brought to the front. The menu is one for the whole app and does
/// not say which window it was used from.
///
/// Remembered from focus events rather than asked when a command arrives, because the window in
/// use does not always read as focused: a native dialog sheet on macOS takes focus while its menu
/// shortcuts still fire. Losing focus therefore does not clear it. A window closing does.
#[derive(Default)]
struct LastFocusedWindow(Mutex<Option<String>>);

impl LastFocusedWindow {
    fn note(&self, label: &str) {
        if let Ok(mut last) = self.0.lock() {
            *last = Some(label.to_string());
        }
    }

    fn forget(&self, label: &str) {
        if let Ok(mut last) = self.0.lock() {
            if last.as_deref() == Some(label) {
                *last = None;
            }
        }
    }

    fn label(&self) -> Option<String> {
        self.0.lock().ok().and_then(|last| last.clone())
    }
}

fn deliver_menu_command<R: tauri::Runtime>(app: &tauri::AppHandle<R>, id: &str) {
    let focused = app.state::<LastFocusedWindow>().label();
    match menu_target(id, focused.as_deref()) {
        MenuTarget::FileWindow(label) => {
            let _ = app.emit_to(label, "menu-event", id);
        }
        MenuTarget::Main { raise } => {
            let _ = app.emit_to("main", "menu-event", id);
            if raise {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.unminimize();
                    let _ = main.set_focus();
                }
            }
        }
    }
}

/// §89 Where a native menu command goes.
#[derive(Debug, PartialEq)]
enum MenuTarget<'a> {
    /// The file window in front, which answers it (`use-file-window-menu.ts`).
    FileWindow(&'a str),
    /// The main window. `raise` when a file window is in front and the command would otherwise act
    /// where the user cannot see it: Settings opening behind the window they are in.
    Main { raise: bool },
}

fn menu_target<'a>(id: &str, focused: Option<&'a str>) -> MenuTarget<'a> {
    match focused {
        Some(label) if is_file_window(label) => {
            if concerns_the_document_in_front(id) {
                MenuTarget::FileWindow(label)
            } else {
                MenuTarget::Main {
                    raise: shows_something_in_the_main_window(id),
                }
            }
        }
        _ => MenuTarget::Main { raise: false },
    }
}

/// The commands about the document in front, besides the `insert_` ones. Sent to the main window
/// instead, they act on its active tab: Cmd+W closes a tab the user is not looking at, and Insert >
/// Bold edits it. Cmd+Shift+W is one key from Cmd+W and would close the whole workspace. A file
/// window does what it can with these and says so for the rest (`use-file-window-menu.ts`).
const DOCUMENT_MENU_COMMANDS: [&str; 11] = [
    "edit_find_replace",
    "export_doc",
    "file_close_folder",
    "file_close_tab",
    "file_save",
    "file_save_as",
    "go_back",
    "go_forward",
    "view_inline_ai",
    "view_reload",
    "view_source",
];

fn concerns_the_document_in_front(id: &str) -> bool {
    id.starts_with("insert_") || DOCUMENT_MENU_COMMANDS.contains(&id)
}

/// A browser opens for Help, and clearing the recent list shows nothing.
fn shows_something_in_the_main_window(id: &str) -> bool {
    !id.starts_with("help_") && id != "recent_clear"
}

/// §89 A file window is gone, whatever closed it. A window that fell to the `ErrorBoundary` screen
/// closes without running any of its code, so this cannot be left to the window.
///
/// The main window counts what file windows hold (`services/file-windows.ts`): left counted, every
/// later quit would ask about it and wait on a save it cannot answer. And the window's hold on the
/// file it had open goes with it.
fn when_file_window_destroyed<R: tauri::Runtime>(
    window: &tauri::Window<R>,
) -> tauri::async_runtime::JoinHandle<()> {
    let _ = window.emit_to("main", "file-window://closed", window.label());
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    tauri::async_runtime::spawn(async move {
        context_cmd::release_window_contexts(&app, &label).await;
    })
}

/// §89 The label `openFileWindow` gives a torn-off tab's window (`src/utils/file-window.ts`).
fn is_file_window(label: &str) -> bool {
    label.starts_with("file-")
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
        // FIRST, and a plugin rather than a line in `.setup()`: plugin setup hooks run
        // inside `Builder::build()`, while `.setup()` runs after tauri has created every
        // window — so a window that fails to open would log its cause into a facade
        // with no implementation behind it. `logging::plugin` explains why it also
        // cannot fail. `logging::tests` pins both the position and the count.
        .plugin(logging::plugin())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // §313 전역 캡처 단축키. 핸들러를 여기서 달지 않는다 — 등록도 해제도 프런트가
        // 설정 값에 맞춰 하고(기본값 `null` = 아무것도 등록하지 않음), 조합이 이미
        // 점유되어 있으면 `register`가 거절한다. 그 거절을 설정 화면이 받아 보여 주는
        // 것이 §313의 필수 요건이라, 등록 주체는 실패를 사용자에게 말할 수 있는 쪽에
        // 있어야 한다.
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // §5.1 The HTML preview loads through this rather than asset:, so that relative
        // references inside a previewed document resolve — see protocol/html_preview.rs
        // for why asset: cannot serve them. Access is governed by the asset scope all
        // the same, so this adds a route, not a permission.
        .register_uri_scheme_protocol(
            protocol::html_preview::SCHEME,
            protocol::html_preview::handle,
        )
        .setup(|app| {
            // The log file is appended to across sessions, so this doubles as a
            // session separator — and it answers the first question asked of any
            // report ("which version?") without the reporter having to know. Not
            // necessarily the session's first line: the logger is installed earlier
            // still (see the plugin above), so tauri's own window-creation failures
            // are recorded ahead of it. That is the point.
            //
            // ‼️ The explicit target is what keeps this out of the console. Both
            // reasons above are about the FILE, and a line printed on every
            // `tauri dev` launch is noise there; `logging::stdout_keeps` drops
            // exactly this target. Remove the `target:` and it comes back.
            log::info!(
                target: logging::SESSION_TARGET,
                "Baram {} starting ({}, {})",
                app.package_info().version,
                std::env::consts::OS,
                if cfg!(debug_assertions) {
                    "debug"
                } else {
                    "release"
                }
            );

            // §56d 썸네일 캐시는 vault 밖(앱 캐시 디렉터리)에 있으므로 asset:// 스코프에
            // 따로 넣어 줘야 한다 — 정적 스코프는 $APPDATA뿐이고, vault는 set_vault_root가
            // 런타임에 등록한다. 실패는 비치명적이다: 갤러리가 원본으로 폴백한다.
            match thumbnail_cmd::cache_dir(app.handle()) {
                Ok(dir) => {
                    if let Err(e) = std::fs::create_dir_all(&dir) {
                        log::warn!("§56d thumbnail cache dir creation failed: {e}");
                    } else if let Err(e) = app.asset_protocol_scope().allow_directory(&dir, true) {
                        log::warn!("§56d thumbnail asset scope registration failed: {e}");
                    } else {
                        // 낡은 세대 정리. 세션당 한 번, 디렉터리 목록만 보는 일이므로 여기서
                        // 해도 시작을 지연시키지 않는다(사진도 vault도 읽지 않는다).
                        let removed = thumbnail::purge_stale_generations(&dir);
                        if removed > 0 {
                            log::info!("§56d purged {removed} stale thumbnail cache entries");
                        }
                    }
                }
                Err(e) => log::warn!("§56d thumbnail cache dir unavailable: {e}"),
            }

            // §379 — where developer mode keeps its list (`plugin-dev.json`), and the two roots its
            // id checks read (installed plugins, plugin storage). Without it every dev command
            // answers tauri's "state not managed" error, so no dev folder loads — the closed way
            // to be broken.
            match plugin_dev_cmd::DevModeHost::native(app.handle()) {
                Ok(host) => {
                    app.manage(host);
                }
                Err(e) => log::warn!("§379 developer mode unavailable: {e}"),
            }

            let (built_menu, menu_state) = menu::build_menu(app)?;
            app.set_menu(built_menu)?;
            app.manage(menu_state);

            app.on_menu_event(move |app_handle, event| {
                deliver_menu_command(app_handle, event.id().as_ref());
            });

            Ok(())
        })
        .manage(PendingOpenFiles(Mutex::new(Vec::new())))
        .manage(QuitGuard(AtomicBool::new(false)))
        .manage(LastFocusedWindow::default())
        .manage(VaultRootState(tokio::sync::RwLock::new(None)))
        .manage(WatcherState(std::sync::Mutex::new(
            std::collections::HashMap::new(),
        )))
        .manage(context::ContextManager::new())
        .manage(index::service::LinkIndexState::new())
        .manage(llm::cancel::CancelRegistry::new())
        .manage(embedding_cmd::EmbeddingState::new())
        .manage(plugin::PluginAuthorizer::new())
        .manage(plugin::SandboxChannels::new())
        .manage(plugin::PluginRateLimiter::new())
        .manage(plugin::StagedPayloads::new())
        .manage(thumbnail_cmd::ThumbnailSemaphore::new())
        .manage(font::FontCache::new())
        .invoke_handler(tauri::generate_handler![
            fs_cmd::set_vault_root,
            fs_cmd::read_file,
            fs_cmd::write_file,
            fs_cmd::create_file,
            fs_cmd::list_dir,
            fs_cmd::rename_file,
            fs_cmd::delete_file,
            fs_cmd::create_dir,
            fs_cmd::delete_dir,
            fs_cmd::copy_file,
            fs_cmd::import_dir,
            fs_cmd::import_file,
            fs_cmd::watch_dir,
            fs_cmd::extract_zip,
            fs_cmd::write_binary_file,
            fs_cmd::export_binary_file,
            fs_cmd::read_media_data_url,
            thumbnail_cmd::photo_thumbnail,
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
            index_cmd::sync_index_paths,
            index_cmd::rename_file_with_links,
            index_cmd::get_unlinked_mentions,
            index_cmd::rename_block_id,
            index_cmd::rename_namespace,
            keyring_cmd::keyring_set_provider_key,
            keyring_cmd::keyring_provider_configured,
            keyring_cmd::keyring_delete_provider_key,
            search_cmd::search_files,
            search_cmd::replace_search_matches,
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
            update_menu_enabled,
            update_recent_menu,
            confirm_quit,
            tag_cmd::get_vault_tags,
            tag_cmd::rename_tag,
            tag_cmd::get_files_by_tag,
            task_cmd::get_vault_tasks,
            task_cmd::get_file_tasks,
            task_cmd::get_tasks_linking_to,
            task_cmd::set_task_state,
            task_cmd::set_task_field,
            task_cmd::set_task_tag,
            task_cmd::preview_task_state_line,
            task_cmd::preview_task_field_line,
            task_cmd::preview_task_tag_line,
            task_cmd::append_task_line,
            task_cmd::delete_task_line,
            task_cmd::archive_task_lines,
            snapshot_cmd::create_snapshot,
            snapshot_cmd::list_snapshots,
            snapshot_cmd::get_snapshot_diff,
            snapshot_cmd::restore_snapshot,
            snapshot_cmd::delete_snapshot,
            snapshot_cmd::get_file_history,
            snapshot_cmd::diff_texts,
            snapshot_cmd::merge_texts,
            plugin_cmd::plugin_install_stage,
            plugin_cmd::plugin_install_commit,
            plugin_cmd::plugin_install_discard,
            plugin_cmd::plugin_uninstall,
            plugin_cmd::plugin_list_installed,
            plugin_cmd::plugin_read_manifest,
            plugin_cmd::plugin_fetch_registry,
            plugin_cmd::plugin_fetch_community_registry,
            plugin_cmd::plugin_fetch_readme,
            plugin_cmd::plugin_fetch_revocations,
            plugin_cmd::plugin_get_dir,
            plugin_cmd::plugin_prepare_scopes,
            plugin_dev_cmd::plugin_list_dev,
            plugin_dev_cmd::plugin_reload_dev_folder,
            plugin_dev_cmd::plugin_remove_dev_folder,
            plugin_dev_cmd::plugin_pick_dev_folder,
            plugin_dev_cmd::plugin_record_dev_consent,
            plugin_dev_cmd::plugin_set_developer_mode,
            plugin_cmd::plugin_http_fetch,
            plugin_index_cmd::plugin_index_read,
            plugin_note_link_cmd::plugin_note_link,
            plugin_cmd::plugin_storage_read,
            plugin_cmd::plugin_storage_write,
            plugin_cmd::plugin_storage_list,
            plugin_cmd::plugin_storage_remove,
            plugin_cmd::plugin_call,
            plugin_cmd::plugin_sandbox_register,
            plugin_cmd::plugin_sandbox_deregister,
            plugin_cmd::plugin_sandbox_connect,
            plugin_cmd::plugin_sandbox_report,
            plugin_cmd::plugin_sandbox_send,
            plugin_cmd::plugin_sandbox_stage,
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
            approval_cmd::pick_approved_dir,
            approval_cmd::pick_approved_file,
            approval_cmd::is_path_approved,
            approval_cmd::list_approved_roots,
            approval_cmd::revoke_approved_root,
            font_cmd::font_list,
            theme_cmd::theme_import_pick,
            theme_cmd::theme_install_stage,
            theme_cmd::theme_install_commit,
            theme_cmd::theme_install_discard,
            theme_cmd::theme_stage_read,
            theme_cmd::theme_read_stored_css,
            theme_cmd::theme_uninstall,
            theme_cmd::theme_package_build,
        ])
        // Unsaved-changes guard: intercept the window close (red X) and ask the
        // frontend to confirm. `confirm_quit` flips QuitGuard to let it through.
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                let guard = window.state::<QuitGuard>();
                if close_action(window.label(), guard.0.load(Ordering::Relaxed))
                    == CloseAction::PreventAndAsk
                {
                    api.prevent_close();
                    let _ = window.emit("app://close-requested", ());
                }
            }
            tauri::WindowEvent::Focused(true) => {
                window.state::<LastFocusedWindow>().note(window.label());
            }
            tauri::WindowEvent::Destroyed => {
                window.state::<LastFocusedWindow>().forget(window.label());
                if is_file_window(window.label()) {
                    when_file_window_destroyed(window);
                }
            }
            _ => {}
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_menu_command_about_the_document_goes_to_the_file_window_in_front() {
        for id in [
            "file_save",
            "file_close_tab",
            "file_close_folder",
            "view_source",
            "view_inline_ai",
            "go_back",
            "insert_bold",
        ] {
            assert_eq!(
                menu_target(id, Some("file-1")),
                MenuTarget::FileWindow("file-1"),
                "{id} would act on the main window's active tab"
            );
        }
    }

    #[test]
    fn any_other_menu_command_raises_the_main_window_from_a_file_window() {
        for id in ["file_new", "file_settings", "go_palette", "view_sidebar"] {
            assert_eq!(
                menu_target(id, Some("file-1")),
                MenuTarget::Main { raise: true },
                "{id} would open behind the window the user is in"
            );
        }
    }

    // Help opens a browser and clearing the recent list shows nothing, so main stays where it is.
    #[test]
    fn a_command_with_nothing_to_show_does_not_raise_the_main_window() {
        for id in ["help_faq", "help_user_guide", "recent_clear"] {
            assert_eq!(
                menu_target(id, Some("file-1")),
                MenuTarget::Main { raise: false },
                "{id} has nothing to show in the main window"
            );
        }
    }

    /// Two windows and a listener on each, as the two webviews listen.
    fn delivered(last_focused: Option<&str>, id: &str) -> (usize, usize) {
        use std::sync::atomic::AtomicUsize;
        use std::sync::Arc;
        use tauri::Listener;

        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app must build");
        app.manage(LastFocusedWindow::default());
        let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock webview must build");
        let file = tauri::WebviewWindowBuilder::new(&app, "file-1", Default::default())
            .build()
            .expect("mock webview must build");
        let at_main = Arc::new(AtomicUsize::new(0));
        let at_file = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&at_main);
        main.listen("menu-event", move |_| {
            count.fetch_add(1, Ordering::SeqCst);
        });
        let count = Arc::clone(&at_file);
        file.listen("menu-event", move |_| {
            count.fetch_add(1, Ordering::SeqCst);
        });
        if let Some(label) = last_focused {
            app.state::<LastFocusedWindow>().note(label);
        }

        deliver_menu_command(app.handle(), id);

        (
            at_main.load(Ordering::SeqCst),
            at_file.load(Ordering::SeqCst),
        )
    }

    // 이것을 실패시키는 것: 브로드캐스트로 돌아가면 파일 창의 Cmd+W 가 main 의 탭까지 닫는다.
    #[test]
    fn a_document_command_reaches_only_the_file_window_in_front() {
        assert_eq!(delivered(Some("file-1"), "file_save"), (0, 1));
    }

    #[test]
    fn any_other_command_reaches_only_the_main_window() {
        assert_eq!(delivered(Some("file-1"), "file_new"), (1, 0));
    }

    #[test]
    fn with_the_main_window_in_front_every_command_reaches_only_it() {
        assert_eq!(delivered(Some("main"), "file_save"), (1, 0));
        assert_eq!(delivered(None, "file_save"), (1, 0));
    }

    // 이것을 실패시키는 것: 초점 해제로 지우면, 네이티브 시트가 뜬 파일 창의 Cmd+S 가 main 의 탭을 저장한다.
    #[test]
    fn the_last_focused_window_is_kept_until_another_takes_over_or_it_closes() {
        let last = LastFocusedWindow::default();
        last.note("file-1");
        assert_eq!(last.label().as_deref(), Some("file-1"));

        last.forget("main");
        assert_eq!(last.label().as_deref(), Some("file-1"));

        last.note("main");
        last.forget("file-1");
        assert_eq!(last.label().as_deref(), Some("main"));

        last.forget("main");
        assert_eq!(last.label(), None);
    }

    // The pair: with no file window in front, every command goes where it always went.
    #[test]
    fn a_menu_command_goes_to_the_main_window_otherwise() {
        for focused in [Some("main"), Some("plugin-x"), None] {
            for id in ["file_save", "insert_bold", "file_new"] {
                assert_eq!(
                    menu_target(id, focused),
                    MenuTarget::Main { raise: false },
                    "{id} with {focused:?} in front"
                );
            }
        }
    }

    // A misspelt id would quietly send that command to the main window again.
    #[test]
    fn the_document_menu_commands_are_items_of_the_menu() {
        let menu = include_str!("menu.rs");
        for id in DOCUMENT_MENU_COMMANDS {
            assert!(
                menu.contains(&format!("\"{id}\"")),
                "{id} is not in menu.rs"
            );
        }
        assert!(menu.contains("\"insert_"), "no insert_ command in menu.rs");
    }

    /// §260 Phase 3c-3, found by the live smoke: unloading a sandboxed plugin quit
    /// the app. The close guard ran for the `plugin-*` webview the loader was
    /// closing, cancelled that close, and broadcast `app://close-requested`, which
    /// the main window answers by running its quit flow.
    // 이것을 실패시키는 것: 이 호출이 빠지면 파일 창이 닫혀도 등록이 앱을 끌 때까지 남고, main 이 그 창을 계속 센다.
    #[test]
    fn a_destroyed_file_window_lets_go_of_its_file_and_is_no_longer_counted() {
        use tauri::Listener;

        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app must build");
        app.manage(context::ContextManager::new());
        app.manage(VaultRootState(tokio::sync::RwLock::new(None)));
        app.manage(index::service::LinkIndexState::new());
        let closed = std::sync::Arc::new(Mutex::new(Vec::new()));
        let heard = std::sync::Arc::clone(&closed);
        app.listen_any("file-window://closed", move |event| {
            heard.lock().unwrap().push(event.payload().to_string());
        });
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        std::fs::write(&path, "x").unwrap();
        let manager = app.state::<context::ContextManager>();
        tauri::async_runtime::block_on(manager.add_held_by(
            context::ContextInfo {
                id: "f".into(),
                context_type: context::ContextType::File,
                path: path.to_str().unwrap().into(),
                label: "note.md".into(),
                color: "#fff".into(),
                alias: None,
                vault_type: None,
                added_at: 0,
            },
            "file-1",
        ))
        .unwrap();
        let file_window = tauri::WebviewWindowBuilder::new(&app, "file-1", Default::default())
            .build()
            .expect("mock webview must build");

        tauri::async_runtime::block_on(when_file_window_destroyed(&file_window.as_ref().window()))
            .unwrap();

        assert!(tauri::async_runtime::block_on(manager.list()).is_empty());
        assert_eq!(*closed.lock().unwrap(), vec!["\"file-1\"".to_string()]);
    }

    #[test]
    fn the_close_guard_is_for_the_main_window_only() {
        // The main window keeps the guard — closing it IS a user gesture that may need
        // the unsaved-changes prompt.
        assert_eq!(close_action("main", false), CloseAction::PreventAndAsk);
        // …and once the user has confirmed the quit, it goes through.
        assert_eq!(close_action("main", true), CloseAction::Allow);
        // §89 A file window asks for itself in the webview. Intercepting it here broadcast
        // `app://close-requested`, which the main window answers by quitting the app.
        for file_window in ["file-1", "file-abc123"] {
            assert_eq!(
                close_action(file_window, false),
                CloseAction::Allow,
                "{file_window} must not reach the main window's quit flow"
            );
        }
        // Sandbox windows are opened and closed by the loader, never by the user.
        // Intercepting one cancelled the loader's close AND broadcast
        // `app://close-requested`, which the main window answers by quitting the app.
        for sandbox in ["plugin-baram-sandbox-smoke", "plugin-x"] {
            assert_eq!(
                close_action(sandbox, false),
                CloseAction::Allow,
                "{sandbox} must never be intercepted"
            );
        }
    }
}
