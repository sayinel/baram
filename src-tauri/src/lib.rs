// Baram — Rust 백엔드 엔트리포인트

mod commands;
mod config;
mod export;
mod fs;
mod git;
mod index;
mod llm;
mod search;

use std::sync::Mutex;

use commands::{config_cmd, export_cmd, fs_cmd, index_cmd, llm_cmd};
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
            let export_html = MenuItemBuilder::new("Export as HTML")
                .id("export_html")
                .build(app)?;
            let export_pdf = MenuItemBuilder::new("Export as PDF")
                .id("export_pdf")
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
                .item(&export_html)
                .item(&export_pdf)
                .build()?;

            // --- Edit menu (predefined OS-native items) ---
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
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

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&view_source)
                .item(&view_sidebar)
                .separator()
                .item(&view_palette)
                .item(&view_quick_switcher)
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
                .build(app)?;
            let insert_inline_code = MenuItemBuilder::new("Inline Code")
                .id("insert_inline_code")
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
                .build(app)?;
            let insert_math_block = MenuItemBuilder::new("Math Block")
                .id("insert_math_block")
                .build(app)?;
            let insert_blockquote = MenuItemBuilder::new("Blockquote")
                .id("insert_blockquote")
                .build(app)?;
            let insert_ordered_list = MenuItemBuilder::new("Ordered List")
                .id("insert_ordered_list")
                .build(app)?;
            let insert_unordered_list = MenuItemBuilder::new("Unordered List")
                .id("insert_unordered_list")
                .build(app)?;
            let insert_task_list = MenuItemBuilder::new("Task List")
                .id("insert_task_list")
                .build(app)?;
            let insert_hr = MenuItemBuilder::new("Horizontal Rule")
                .id("insert_hr")
                .build(app)?;
            let insert_frontmatter = MenuItemBuilder::new("YAML Front Matter")
                .id("insert_frontmatter")
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
                .separator()
                .item(&insert_link)
                .item(&insert_image)
                .separator()
                .item(&insert_table)
                .item(&insert_code_block)
                .item(&insert_math_block)
                .separator()
                .item(&insert_blockquote)
                .item(&insert_ordered_list)
                .item(&insert_unordered_list)
                .item(&insert_task_list)
                .separator()
                .item(&insert_hr)
                .item(&insert_frontmatter)
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

            // --- App menu (macOS: first submenu = application menu with Quit) ---
            let file_settings = MenuItemBuilder::new("Settings...")
                .id("file_settings")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let app_menu = SubmenuBuilder::new(app, "Baram")
                .about(None)
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
        .invoke_handler(tauri::generate_handler![
            fs_cmd::read_file,
            fs_cmd::write_file,
            fs_cmd::list_dir,
            fs_cmd::rename_file,
            fs_cmd::delete_file,
            fs_cmd::create_dir,
            fs_cmd::delete_dir,
            fs_cmd::watch_dir,
            config_cmd::get_config,
            config_cmd::set_config,
            export_cmd::export_pdf,
            export_cmd::export_document,
            llm_cmd::llm_complete,
            index_cmd::get_backlinks,
            index_cmd::get_link_index,
            index_cmd::refresh_index,
            index_cmd::update_file_index,
            index_cmd::rename_file_with_links,
            index_cmd::get_unlinked_mentions,
            index_cmd::rename_block_id,
            get_opened_urls,
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
