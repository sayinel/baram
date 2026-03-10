// Baram — Rust 백엔드 엔트리포인트

mod commands;
mod config;
mod export;
mod fs;
mod git;
mod index;
mod llm;
mod plugin;
mod search;
mod snapshot;

use std::collections::HashMap;
use std::sync::Mutex;

use commands::{
    config_cmd, export_cmd, fs_cmd, git_cmd, index_cmd, keyring_cmd, llm_cmd, plugin_cmd,
    search_cmd, snapshot_cmd, tag_cmd,
};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager};

/// Pending file paths from macOS file open events (cold start).
struct PendingOpenFiles(Mutex<Vec<String>>);

#[tauri::command]
fn get_opened_urls(state: tauri::State<'_, PendingOpenFiles>) -> Vec<String> {
    let mut pending = state.0.lock().unwrap();
    pending.drain(..).collect()
}

/// Stores references to custom menu items and submenus for locale updates.
struct MenuState {
    items: HashMap<String, tauri::menu::MenuItem<tauri::Wry>>,
    submenus: HashMap<String, tauri::menu::Submenu<tauri::Wry>>,
    predefined: HashMap<String, PredefinedMenuItem<tauri::Wry>>,
}

#[tauri::command]
fn update_menu_locale(
    state: tauri::State<'_, MenuState>,
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

            let edit_undo = PredefinedMenuItem::undo(app, None)?;
            let edit_redo = PredefinedMenuItem::redo(app, None)?;
            let edit_cut = PredefinedMenuItem::cut(app, None)?;
            let edit_copy = PredefinedMenuItem::copy(app, None)?;
            let edit_paste = PredefinedMenuItem::paste(app, None)?;
            let edit_select_all = PredefinedMenuItem::select_all(app, None)?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .item(&edit_undo)
                .item(&edit_redo)
                .separator()
                .item(&edit_cut)
                .item(&edit_copy)
                .item(&edit_paste)
                .item(&edit_select_all)
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
            let view_tags = MenuItemBuilder::new("Tags").id("view_tags").build(app)?;
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

            let view_fullscreen = PredefinedMenuItem::fullscreen(app, None)?;

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
                .separator()
                .item(&view_fullscreen)
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
            let insert_link = MenuItemBuilder::new("Link").id("insert_link").build(app)?;
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
            let win_minimize = PredefinedMenuItem::minimize(app, None)?;
            let win_maximize = PredefinedMenuItem::maximize(app, None)?;
            let win_close = PredefinedMenuItem::close_window(app, None)?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .item(&win_minimize)
                .item(&win_maximize)
                .separator()
                .item(&win_close)
                .build()?;

            // --- Help menu ---
            let help_user_guide = MenuItemBuilder::new("User Guide")
                .id("help_user_guide")
                .build(app)?;
            let help_shortcuts = MenuItemBuilder::new("Keyboard Shortcuts")
                .id("help_shortcuts")
                .build(app)?;
            let help_faq = MenuItemBuilder::new("FAQ").id("help_faq").build(app)?;
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

            // Store menu items/submenus for dynamic locale updates
            let mut menu_items: HashMap<String, tauri::menu::MenuItem<tauri::Wry>> = HashMap::new();
            menu_items.insert("file_new".into(), file_new);
            menu_items.insert("file_open".into(), file_open);
            menu_items.insert("file_open_folder".into(), file_open_folder);
            menu_items.insert("file_save".into(), file_save);
            menu_items.insert("file_save_as".into(), file_save_as);
            menu_items.insert("file_close_tab".into(), file_close_tab);
            menu_items.insert("export_doc".into(), export_doc);
            menu_items.insert("edit_find_replace".into(), edit_find_replace);
            menu_items.insert("view_source".into(), view_source);
            menu_items.insert("view_sidebar".into(), view_sidebar);
            menu_items.insert("view_palette".into(), view_palette);
            menu_items.insert("go_quick_switcher".into(), view_quick_switcher);
            menu_items.insert("view_global_search".into(), view_global_search);
            menu_items.insert("view_outline".into(), view_outline);
            menu_items.insert("view_backlinks".into(), view_backlinks);
            menu_items.insert("view_graph".into(), view_graph);
            menu_items.insert("view_git".into(), view_git);
            menu_items.insert("view_calendar".into(), view_calendar);
            menu_items.insert("view_tags".into(), view_tags);
            menu_items.insert("view_version_history".into(), view_version_history);
            menu_items.insert("view_skills_gallery".into(), view_skills_gallery);
            menu_items.insert("view_ai_chat".into(), view_ai_chat);
            menu_items.insert("insert_h1".into(), insert_h1);
            menu_items.insert("insert_h2".into(), insert_h2);
            menu_items.insert("insert_h3".into(), insert_h3);
            menu_items.insert("insert_paragraph".into(), insert_paragraph);
            menu_items.insert("insert_bold".into(), insert_bold);
            menu_items.insert("insert_italic".into(), insert_italic);
            menu_items.insert("insert_underline".into(), insert_underline);
            menu_items.insert("insert_strikethrough".into(), insert_strikethrough);
            menu_items.insert("insert_inline_code".into(), insert_inline_code);
            menu_items.insert("insert_highlight".into(), insert_highlight);
            menu_items.insert("insert_superscript".into(), insert_superscript);
            menu_items.insert("insert_subscript".into(), insert_subscript);
            menu_items.insert("insert_link".into(), insert_link);
            menu_items.insert("insert_wikilink".into(), insert_wikilink);
            menu_items.insert("insert_image".into(), insert_image);
            menu_items.insert("insert_table".into(), insert_table);
            menu_items.insert("insert_code_block".into(), insert_code_block);
            menu_items.insert("insert_math_block".into(), insert_math_block);
            menu_items.insert("insert_mermaid".into(), insert_mermaid);
            menu_items.insert("insert_query_block".into(), insert_query_block);
            menu_items.insert("insert_blockquote".into(), insert_blockquote);
            menu_items.insert("insert_callout".into(), insert_callout);
            menu_items.insert("insert_toggle".into(), insert_toggle);
            menu_items.insert("insert_definition_list".into(), insert_definition_list);
            menu_items.insert("insert_toc".into(), insert_toc);
            menu_items.insert("insert_ordered_list".into(), insert_ordered_list);
            menu_items.insert("insert_unordered_list".into(), insert_unordered_list);
            menu_items.insert("insert_task_list".into(), insert_task_list);
            menu_items.insert("insert_hr".into(), insert_hr);
            menu_items.insert("insert_frontmatter".into(), insert_frontmatter);
            menu_items.insert("insert_footnote".into(), insert_footnote);
            menu_items.insert("go_palette".into(), go_palette);
            menu_items.insert("go_back".into(), go_back);
            menu_items.insert("go_forward".into(), go_forward);
            menu_items.insert("go_switch_doc".into(), go_switch_doc);
            menu_items.insert("workspace_writing".into(), workspace_writing);
            menu_items.insert("workspace_journal".into(), workspace_journal);
            menu_items.insert("workspace_skills".into(), workspace_skills);
            menu_items.insert("help_user_guide".into(), help_user_guide);
            menu_items.insert("help_shortcuts".into(), help_shortcuts);
            menu_items.insert("help_faq".into(), help_faq);
            menu_items.insert("help_report".into(), help_report);
            menu_items.insert("app_about".into(), app_about);
            menu_items.insert("file_settings".into(), file_settings);

            let mut menu_subs: HashMap<String, tauri::menu::Submenu<tauri::Wry>> = HashMap::new();
            menu_subs.insert("menu_file".into(), file_menu);
            menu_subs.insert("menu_edit".into(), edit_menu);
            menu_subs.insert("menu_view".into(), view_menu);
            menu_subs.insert("menu_insert".into(), insert_menu);
            menu_subs.insert("menu_go".into(), go_menu);
            menu_subs.insert("menu_workspace".into(), workspace_menu);
            menu_subs.insert("menu_window".into(), window_menu);
            menu_subs.insert("menu_help".into(), help_menu);
            menu_subs.insert("menu_app".into(), app_menu);

            let mut menu_predef: HashMap<String, PredefinedMenuItem<tauri::Wry>> = HashMap::new();
            menu_predef.insert("edit_undo".into(), edit_undo);
            menu_predef.insert("edit_redo".into(), edit_redo);
            menu_predef.insert("edit_cut".into(), edit_cut);
            menu_predef.insert("edit_copy".into(), edit_copy);
            menu_predef.insert("edit_paste".into(), edit_paste);
            menu_predef.insert("edit_select_all".into(), edit_select_all);
            menu_predef.insert("view_fullscreen".into(), view_fullscreen);
            menu_predef.insert("win_minimize".into(), win_minimize);
            menu_predef.insert("win_maximize".into(), win_maximize);
            menu_predef.insert("win_close".into(), win_close);

            app.manage(MenuState {
                items: menu_items,
                submenus: menu_subs,
                predefined: menu_predef,
            });

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
