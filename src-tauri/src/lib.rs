// Baram — Rust 백엔드 엔트리포인트

mod commands;
mod config;
mod export;
mod fs;
mod git;
mod index;
mod llm;
mod search;

use commands::{config_cmd, fs_cmd};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            fs_cmd::read_file,
            fs_cmd::write_file,
            fs_cmd::list_dir,
            config_cmd::get_config,
            config_cmd::set_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
