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

/// Validate path at IPC boundary before delegating to fs module
fn check(path: &str) -> Result<(), String> {
    crate::fs::validate_path(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    check(&path)?;
    crate::fs::read_file(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    check(&path)?;
    crate::fs::write_file(&path, &content)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_dir(path: String, recursive: Option<bool>) -> Result<Vec<FileEntry>, String> {
    check(&path)?;
    crate::fs::list_dir(&path, recursive.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_file(from: String, to: String) -> Result<(), String> {
    check(&from)?;
    check(&to)?;
    crate::fs::rename_file(&from, &to)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    check(&path)?;
    crate::fs::delete_file(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_dir(path: String) -> Result<(), String> {
    check(&path)?;
    crate::fs::create_dir(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_dir(path: String) -> Result<(), String> {
    check(&path)?;
    crate::fs::delete_dir(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn copy_file(from: String, to: String) -> Result<(), String> {
    check(&from)?;
    check(&to)?;
    crate::fs::copy_file(&from, &to)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn watch_dir(path: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    check(&path)?;
    crate::fs::watch_dir(&path, app_handle).map_err(|e| e.to_string())
}

/// §53 ZIP 파일 추출 — Notion 내보내기 호환
#[tauri::command]
pub async fn extract_zip(zip_path: String, output_dir: String) -> Result<Vec<String>, String> {
    check(&zip_path)?;
    check(&output_dir)?;
    crate::fs::extract_zip(&zip_path, &output_dir)
        .await
        .map_err(|e| e.to_string())
}

/// §56d 바이너리 파일 쓰기 — 이미지 등 비텍스트 파일용
#[tauri::command]
pub async fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    check(&path)?;
    let tmp_path = format!("{}.{}.tmp", path, uuid::Uuid::new_v4().as_simple());
    tokio::fs::write(&tmp_path, &data)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::rename(&tmp_path, &path).await.map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        e.to_string()
    })
}
