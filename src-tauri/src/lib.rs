// Baram — Rust 백엔드 엔트리포인트

mod commands;
mod config;
mod export;
mod fs;
mod git;
mod index;
mod llm;
mod search;
mod snapshot;

use std::sync::Mutex;

use commands::{config_cmd, export_cmd, fs_cmd, git_cmd, index_cmd, keyring_cmd, llm_cmd, search_cmd, snapshot_cmd, tag_cmd};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

/// Pending file paths from macOS file open events (cold start).
struct PendingOpenFiles(Mutex<Vec<String>>);

#[tauri::command]
fn get_opened_urls(state: tauri::State<'_, PendingOpenFiles>) -> Vec<String> {
    let mut pending = state.0.lock().unwrap();
    pending.drain(..).collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // --- File menu ---
            let file_new = MenuItemBuilder::new("New File")
                .id("file_new")
                .accelerator("CmdOrCtrl+N")
                .build(app)?;
            let file_open = MenuItemBuilder::new("Open File...")
                .id("file_open")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let file_open_folder = MenuItemBuilder::new("Open Folder...")
                .id("file_open_folder")
                .accelerator("CmdOrCtrl+Shift+O")
                .build(app)?;
            let file_save = MenuItemBuilder::new("Save")
                .id("file_save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?;
            let file_save_as = MenuItemBuilder::new("Save As...")
                .id("file_save_as")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?;
            let file_close_tab = MenuItemBuilder::new("Close Tab")
                .id("file_close_tab")
                .accelerator("CmdOrCtrl+W")
                .build(app)?;
            let export_doc = MenuItemBuilder::new("Export...")
                .id("export_doc")
                .accelerator("CmdOrCtrl+Shift+E")
                .build(app)?;
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&file_new)
                .item(&file_open)
                .item(&file_open_folder)
                .separator()
                .item(&file_save)
                .item(&file_save_as)
                .item(&file_close_tab)
                .separator()
                .item(&export_doc)
                .build()?;

            // --- Edit menu (predefined OS-native items + Find) ---
            let edit_find_replace = MenuItemBuilder::new("Find & Replace")
                .id("edit_find_replace")
                .accelerator("CmdOrCtrl+H")
                .build(app)?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .separator()
                .item(&edit_find_replace)
                .build()?;

            // --- View menu ---
            let view_source = MenuItemBuilder::new("Toggle Source Mode")
                .id("view_source")
                .accelerator("CmdOrCtrl+/")
                .build(app)?;
            let view_sidebar = MenuItemBuilder::new("Toggle Sidebar")
                .id("view_sidebar")
                .accelerator("CmdOrCtrl+Shift+L")
                .build(app)?;
            let view_palette = MenuItemBuilder::new("Command Palette")
                .id("view_palette")
                .accelerator("CmdOrCtrl+P")
                .build(app)?;
            let view_quick_switcher = MenuItemBuilder::new("Quick Switcher")
                .id("go_quick_switcher")
                .accelerator("CmdOrCtrl+K")
                .build(app)?;

            // Sidebar panels
            let view_global_search = MenuItemBuilder::new("Global Search")
                .id("view_global_search")
                .accelerator("CmdOrCtrl+Shift+F")
                .build(app)?;
            let view_outline = MenuItemBuilder::new("Outline")
                .id("view_outline")
                .build(app)?;
            let view_backlinks = MenuItemBuilder::new("Backlinks")
                .id("view_backlinks")
                .accelerator("CmdOrCtrl+Shift+B")
                .build(app)?;
            let view_graph = MenuItemBuilder::new("Graph View")
                .id("view_graph")
                .build(app)?;
            let view_git = MenuItemBuilder::new("Source Control")
                .id("view_git")
                .build(app)?;
            let view_calendar = MenuItemBuilder::new("Calendar")
                .id("view_calendar")
                .build(app)?;
            let view_tags = MenuItemBuilder::new("Tags")
                .id("view_tags")
                .build(app)?;
            let view_version_history = MenuItemBuilder::new("Version History")
                .id("view_version_history")
                .build(app)?;
            let view_skills_gallery = MenuItemBuilder::new("Skills Gallery")
                .id("view_skills_gallery")
                .build(app)?;

            // Right panels
            let view_ai_chat = MenuItemBuilder::new("AI Chat")
                .id("view_ai_chat")
                .accelerator("CmdOrCtrl+Shift+A")
                .build(app)?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&view_source)
                .item(&view_sidebar)
                .separator()
                .item(&view_palette)
                .item(&view_quick_switcher)
                .separator()
                .item(&view_global_search)
                .item(&view_outline)
                .item(&view_backlinks)
                .item(&view_graph)
                .item(&view_git)
                .item(&view_calendar)
                .item(&view_tags)
                .item(&view_version_history)
                .item(&view_skills_gallery)
                .separator()
                .item(&view_ai_chat)
                .build()?;

            // --- Insert menu (§4.4) ---
            let insert_h1 = MenuItemBuilder::new("Heading 1")
                .id("insert_h1")
                .accelerator("CmdOrCtrl+1")
                .build(app)?;
            let insert_h2 = MenuItemBuilder::new("Heading 2")
                .id("insert_h2")
                .accelerator("CmdOrCtrl+2")
                .build(app)?;
            let insert_h3 = MenuItemBuilder::new("Heading 3")
                .id("insert_h3")
                .accelerator("CmdOrCtrl+3")
                .build(app)?;
            let insert_paragraph = MenuItemBuilder::new("Paragraph")
                .id("insert_paragraph")
                .accelerator("CmdOrCtrl+0")
                .build(app)?;
            let insert_bold = MenuItemBuilder::new("Bold")
                .id("insert_bold")
                .accelerator("CmdOrCtrl+B")
                .build(app)?;
            let insert_italic = MenuItemBuilder::new("Italic")
                .id("insert_italic")
                .accelerator("CmdOrCtrl+I")
                .build(app)?;
            let insert_underline = MenuItemBuilder::new("Underline")
                .id("insert_underline")
                .accelerator("CmdOrCtrl+U")
                .build(app)?;
            let insert_strikethrough = MenuItemBuilder::new("Strikethrough")
                .id("insert_strikethrough")
                .accelerator("CmdOrCtrl+Shift+X")
                .build(app)?;
            let insert_inline_code = MenuItemBuilder::new("Inline Code")
                .id("insert_inline_code")
                .accelerator("CmdOrCtrl+E")
                .build(app)?;
            let insert_link = MenuItemBuilder::new("Link")
                .id("insert_link")
                .build(app)?;
            let insert_image = MenuItemBuilder::new("Image")
                .id("insert_image")
                .build(app)?;
            let insert_table = MenuItemBuilder::new("Table")
                .id("insert_table")
                .build(app)?;
            let insert_code_block = MenuItemBuilder::new("Code Block")
                .id("insert_code_block")
                .accelerator("CmdOrCtrl+Alt+C")
                .build(app)?;
            let insert_math_block = MenuItemBuilder::new("Math Block")
                .id("insert_math_block")
                .accelerator("CmdOrCtrl+Shift+M")
                .build(app)?;
            let insert_blockquote = MenuItemBuilder::new("Blockquote")
                .id("insert_blockquote")
                .build(app)?;
            let insert_ordered_list = MenuItemBuilder::new("Ordered List")
                .id("insert_ordered_list")
                .accelerator("CmdOrCtrl+Shift+7")
                .build(app)?;
            let insert_unordered_list = MenuItemBuilder::new("Unordered List")
                .id("insert_unordered_list")
                .accelerator("CmdOrCtrl+Shift+8")
                .build(app)?;
            let insert_task_list = MenuItemBuilder::new("Task List")
                .id("insert_task_list")
                .accelerator("CmdOrCtrl+Shift+9")
                .build(app)?;
            let insert_hr = MenuItemBuilder::new("Horizontal Rule")
                .id("insert_hr")
                .build(app)?;
            let insert_frontmatter = MenuItemBuilder::new("YAML Front Matter")
                .id("insert_frontmatter")
                .build(app)?;

            // Additional block elements
            let insert_callout = MenuItemBuilder::new("Callout")
                .id("insert_callout")
                .build(app)?;
            let insert_toggle = MenuItemBuilder::new("Toggle")
                .id("insert_toggle")
                .build(app)?;
            let insert_toc = MenuItemBuilder::new("Table of Contents")
                .id("insert_toc")
                .build(app)?;
            let insert_definition_list = MenuItemBuilder::new("Definition List")
                .id("insert_definition_list")
                .build(app)?;
            let insert_mermaid = MenuItemBuilder::new("Mermaid Diagram")
                .id("insert_mermaid")
                .accelerator("CmdOrCtrl+Shift+D")
                .build(app)?;
            let insert_query_block = MenuItemBuilder::new("Query Block")
                .id("insert_query_block")
                .build(app)?;

            // Additional inline marks
            let insert_highlight = MenuItemBuilder::new("Highlight")
                .id("insert_highlight")
                .accelerator("CmdOrCtrl+Shift+H")
                .build(app)?;
            let insert_superscript = MenuItemBuilder::new("Superscript")
                .id("insert_superscript")
                .build(app)?;
            let insert_subscript = MenuItemBuilder::new("Subscript")
                .id("insert_subscript")
                .build(app)?;

            // Inline elements
            let insert_wikilink = MenuItemBuilder::new("Wiki Link")
                .id("insert_wikilink")
                .build(app)?;
            let insert_footnote = MenuItemBuilder::new("Footnote")
                .id("insert_footnote")
                .build(app)?;

            let insert_menu = SubmenuBuilder::new(app, "Insert")
                .item(&insert_h1)
                .item(&insert_h2)
                .item(&insert_h3)
                .item(&insert_paragraph)
                .separator()
                .item(&insert_bold)
                .item(&insert_italic)
                .item(&insert_underline)
                .item(&insert_strikethrough)
                .item(&insert_inline_code)
                .item(&insert_highlight)
                .item(&insert_superscript)
                .item(&insert_subscript)
                .separator()
                .item(&insert_link)
                .item(&insert_wikilink)
                .item(&insert_image)
                .separator()
                .item(&insert_table)
                .item(&insert_code_block)
                .item(&insert_math_block)
                .item(&insert_mermaid)
                .item(&insert_query_block)
                .separator()
                .item(&insert_blockquote)
                .item(&insert_callout)
                .item(&insert_toggle)
                .item(&insert_definition_list)
                .item(&insert_toc)
                .separator()
                .item(&insert_ordered_list)
                .item(&insert_unordered_list)
                .item(&insert_task_list)
                .separator()
                .item(&insert_hr)
                .item(&insert_frontmatter)
                .item(&insert_footnote)
                .build()?;

            // --- Go menu (§4.4) ---
            let go_palette = MenuItemBuilder::new("Command Palette")
                .id("go_palette")
                .accelerator("CmdOrCtrl+Shift+P")
                .build(app)?;
            let go_back = MenuItemBuilder::new("Back")
                .id("go_back")
                .accelerator("Ctrl+-")
                .build(app)?;
            let go_forward = MenuItemBuilder::new("Forward")
                .id("go_forward")
                .accelerator("Ctrl+Shift+-")
                .build(app)?;
            let go_switch_doc = MenuItemBuilder::new("Switch Document")
                .id("go_switch_doc")
                .accelerator("Ctrl+Tab")
                .build(app)?;

            let go_menu = SubmenuBuilder::new(app, "Go")
                .item(&go_palette)
                .separator()
                .item(&go_back)
                .item(&go_forward)
                .separator()
                .item(&go_switch_doc)
                .build()?;

            // --- Workspace menu (§52) ---
            let workspace_writing = MenuItemBuilder::new("Writing")
                .id("workspace_writing")
                .accelerator("Alt+CmdOrCtrl+1")
                .build(app)?;
            let workspace_journal = MenuItemBuilder::new("Journal")
                .id("workspace_journal")
                .accelerator("Alt+CmdOrCtrl+2")
                .build(app)?;
            let workspace_skills = MenuItemBuilder::new("Skills Editing")
                .id("workspace_skills")
                .accelerator("Alt+CmdOrCtrl+3")
                .build(app)?;

            let workspace_menu = SubmenuBuilder::new(app, "Workspace")
                .item(&workspace_writing)
                .item(&workspace_journal)
                .item(&workspace_skills)
                .build()?;

            // --- Window menu (macOS standard) ---
            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .separator()
                .close_window()
                .build()?;

            // --- Help menu ---
            let help_user_guide = MenuItemBuilder::new("User Guide")
                .id("help_user_guide")
                .build(app)?;
            let help_shortcuts = MenuItemBuilder::new("Keyboard Shortcuts")
                .id("help_shortcuts")
                .build(app)?;
            let help_faq = MenuItemBuilder::new("FAQ")
                .id("help_faq")
                .build(app)?;
            let help_report = MenuItemBuilder::new("Report Issue...")
                .id("help_report")
                .build(app)?;

            let help_menu = SubmenuBuilder::new(app, "Help")
                .item(&help_user_guide)
                .item(&help_shortcuts)
                .item(&help_faq)
                .separator()
                .item(&help_report)
                .build()?;

            // --- App menu (macOS: first submenu = application menu with Quit) ---
            let file_settings = MenuItemBuilder::new("Settings...")
                .id("file_settings")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let app_about = MenuItemBuilder::new("About Baram")
                .id("app_about")
                .build(app)?;

            let app_menu = SubmenuBuilder::new(app, "Baram")
                .item(&app_about)
                .separator()
                .item(&file_settings)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&insert_menu)
                .item(&go_menu)
                .item(&workspace_menu)
                .item(&window_menu)
                .item(&help_menu)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                let _ = app_handle.emit("menu-event", event.id().as_ref());
            });

            Ok(())
        })
        .manage(PendingOpenFiles(Mutex::new(Vec::new())))
        .manage(index_cmd::LinkIndexState(Mutex::new(
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
            tag_cmd::get_vault_tags,
            tag_cmd::rename_tag,
            tag_cmd::get_files_by_tag,
            snapshot_cmd::create_snapshot,
            snapshot_cmd::list_snapshots,
            snapshot_cmd::get_snapshot_diff,
            snapshot_cmd::restore_snapshot,
            snapshot_cmd::delete_snapshot,
            snapshot_cmd::get_file_history,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // macOS file association: handle files opened from Finder / "Open With"
            if let tauri::RunEvent::Opened { urls } = event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();

                // Emit to frontend (works when webview is already loaded)
                for path in &paths {
                    let _ = app_handle.emit("file:open-request", path.clone());
                }

                // Also queue for cold-start (frontend calls get_opened_urls on mount)
                if let Some(state) = app_handle.try_state::<PendingOpenFiles>() {
                    if let Ok(mut pending) = state.0.lock() {
                        for p in paths {
                            pending.push(p);
                        }
                    }
                }
            }
        });
}
