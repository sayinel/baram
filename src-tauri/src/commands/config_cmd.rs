// §3.2 설정 IPC 커맨드

#[tauri::command]
pub async fn get_config(key: Option<String>) -> Result<serde_json::Value, String> {
    crate::config::get_config(key.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_config(key: String, value: serde_json::Value) -> Result<(), String> {
    crate::config::set_config(&key, value)
        .await
        .map_err(|e| e.to_string())
}
