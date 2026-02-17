// Baram — Rust 백엔드 엔트리포인트

mod commands;
mod config;
mod export;
mod fs;
mod git;
mod index;
mod llm;
mod search;

use commands::{config_cmd, export_cmd, fs_cmd};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;

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
                .accelerator("CmdOrCtrl+K")
                .build(app)?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&view_source)
                .item(&view_sidebar)
                .separator()
                .item(&view_palette)
                .build()?;

            // --- App menu (macOS: first submenu = application menu with Quit) ---
            let app_menu = SubmenuBuilder::new(app, "Baram")
                .about(None)
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
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                let _ = app_handle.emit("menu-event", event.id().as_ref());
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fs_cmd::read_file,
            fs_cmd::write_file,
            fs_cmd::list_dir,
            config_cmd::get_config,
            config_cmd::set_config,
            export_cmd::export_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
