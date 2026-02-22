// §3.2 파일 시스템 IPC 커맨드

use serde::Serialize;

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    pub size: u64,
    #[serde(rename = "modifiedAt")]
    pub modified_at: u64,
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    crate::fs::read_file(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    crate::fs::write_file(&path, &content)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_dir(path: String, recursive: Option<bool>) -> Result<Vec<FileEntry>, String> {
    crate::fs::list_dir(&path, recursive.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_file(from: String, to: String) -> Result<(), String> {
    crate::fs::rename_file(&from, &to)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    crate::fs::delete_file(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_dir(path: String) -> Result<(), String> {
    crate::fs::create_dir(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_dir(path: String) -> Result<(), String> {
    crate::fs::delete_dir(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn watch_dir(path: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    crate::fs::watch_dir(&path, app_handle).map_err(|e| e.to_string())
}
