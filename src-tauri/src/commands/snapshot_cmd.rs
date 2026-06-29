// §71 File Snapshots / Version History IPC 커맨드 핸들러

#[tauri::command]
pub async fn create_snapshot(
    vault_path: String,
    snapshot_type: String,
    label: Option<String>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        crate::snapshot::io::create_snapshot(&vault_path, &snapshot_type, label)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_snapshots(
    vault_path: String,
) -> Result<Vec<crate::snapshot::SnapshotEntry>, String> {
    tokio::task::spawn_blocking(move || {
        crate::snapshot::index::load_index(&vault_path).map(|idx| idx.snapshots)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_snapshot_diff(
    vault_path: String,
    snapshot_id: String,
    file_path: String,
) -> Result<crate::snapshot::DiffResult, String> {
    tokio::task::spawn_blocking(move || {
        crate::snapshot::diff::diff_snapshot_file(&vault_path, &snapshot_id, &file_path)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restore_snapshot(
    vault_path: String,
    snapshot_id: String,
    files: Option<Vec<String>>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        crate::snapshot::io::restore_files(&vault_path, &snapshot_id, files)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_snapshot(vault_path: String, snapshot_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut index =
            crate::snapshot::index::load_index(&vault_path).map_err(|e| e.to_string())?;

        let entry = crate::snapshot::index::remove_entry(&mut index, &snapshot_id)
            .ok_or_else(|| format!("Snapshot not found: {}", snapshot_id))?;

        crate::snapshot::io::delete_snapshot_data(&vault_path, &snapshot_id, &entry.timestamp)
            .map_err(|e| e.to_string())?;

        crate::snapshot::index::save_index(&vault_path, &index).map_err(|e| e.to_string())?;

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_file_history(
    vault_path: String,
    file_path: String,
) -> Result<Vec<crate::snapshot::SnapshotEntry>, String> {
    tokio::task::spawn_blocking(move || {
        let index = crate::snapshot::index::load_index(&vault_path).map_err(|e| e.to_string())?;

        let history: Vec<crate::snapshot::SnapshotEntry> =
            crate::snapshot::index::find_file_history(&index, &file_path)
                .into_iter()
                .cloned()
                .collect();

        Ok(history)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// §3.6 Generic line-level diff between two in-memory texts.
/// Used by the external-change conflict UI to show external vs local content.
#[tauri::command]
pub async fn diff_texts(
    old_text: String,
    new_text: String,
) -> Result<crate::snapshot::DiffResult, String> {
    tokio::task::spawn_blocking(move || crate::snapshot::diff::compute_diff(&old_text, &new_text))
        .await
        .map_err(|e| e.to_string())
}
