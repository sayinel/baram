// §29 인덱스 IPC 커맨드 — 백링크 조회, 인덱스 빌드/갱신

use crate::index::{BacklinkResult, IndexStats, LinkGraph, LinkIndex};
use std::sync::Mutex;
use tauri::State;

/// Managed state wrapping the in-memory link index
pub struct LinkIndexState(pub Mutex<LinkIndex>);

#[tauri::command]
pub async fn get_backlinks(
    file_path: String,
    state: State<'_, LinkIndexState>,
) -> Result<Vec<BacklinkResult>, String> {
    let index = state.0.lock().map_err(|e| e.to_string())?;
    Ok(index.get_backlinks(&file_path))
}

#[tauri::command]
pub async fn get_link_index(
    state: State<'_, LinkIndexState>,
) -> Result<LinkGraph, String> {
    let index = state.0.lock().map_err(|e| e.to_string())?;
    Ok(index.get_link_graph())
}

#[tauri::command]
pub async fn refresh_index(
    root_path: String,
    state: State<'_, LinkIndexState>,
) -> Result<IndexStats, String> {
    // Build a new index outside the lock (async file I/O)
    let mut new_index = LinkIndex::new();
    let stats = new_index
        .build(&root_path)
        .await
        .map_err(|e| e.to_string())?;

    // Swap in the new index
    let mut index = state.0.lock().map_err(|e| e.to_string())?;
    *index = new_index;
    Ok(stats)
}

#[tauri::command]
pub async fn update_file_index(
    file_path: String,
    state: State<'_, LinkIndexState>,
) -> Result<(), String> {
    // Read file content outside the lock (async I/O)
    let content = tokio::fs::read_to_string(&file_path)
        .await
        .unwrap_or_default();

    // Update index synchronously inside the lock
    let mut index = state.0.lock().map_err(|e| e.to_string())?;
    index.update_file_from_content(&file_path, &content);
    Ok(())
}
