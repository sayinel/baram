// §3.2 설정 IPC 커맨드 — app_data_dir/config.json 기반 영속화

#[tauri::command]
pub fn get_config(key: String, app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    crate::config::get_config(&app_handle, &key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_config(key: String, value: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    crate::config::set_config(&app_handle, &key, &value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_config(key: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    crate::config::remove_config(&app_handle, &key)
        .map_err(|e| e.to_string())
}
