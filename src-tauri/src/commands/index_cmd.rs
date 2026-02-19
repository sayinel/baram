// §29 인덱스 IPC 커맨드 — 백링크 조회, 인덱스 빌드/갱신
// §33 파일 이름 변경 시 wikilink 자동 갱신

use crate::index::{replace_wikilink_target, BacklinkResult, IndexStats, LinkGraph, LinkIndex};
use serde::Serialize;
use std::path::Path;
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

/// §33 Result of renaming a file with wikilink updates
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    pub updated_files: Vec<String>,
}

/// §33 Rename a file and update all wikilinks that reference it
#[tauri::command]
pub async fn rename_file_with_links(
    old_path: String,
    new_path: String,
    state: State<'_, LinkIndexState>,
) -> Result<RenameResult, String> {
    let old_target = Path::new(&old_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or("Invalid old path")?;
    let new_target = Path::new(&new_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or("Invalid new path")?;

    // 1. Get referencing files from the index (inside lock, quick read)
    let referring_files = {
        let index = state.0.lock().map_err(|e| e.to_string())?;
        index.get_files_linking_to(&old_target)
    };

    // 2. Read and update each referring file (async I/O, outside lock)
    let mut updated_files = Vec::new();
    let mut updated_contents: Vec<(String, String)> = Vec::new();

    for file_path in &referring_files {
        // Skip the file being renamed itself
        if file_path == &old_path {
            continue;
        }
        let content = match tokio::fs::read_to_string(file_path).await {
            Ok(c) => c,
            Err(_) => continue,
        };

        let new_content = replace_wikilink_target(&content, &old_target, &new_target);
        if new_content != content {
            // Atomic write (§3.6: tmp → rename)
            crate::fs::write_file(file_path, &new_content)
                .await
                .map_err(|e| e.to_string())?;
            updated_files.push(file_path.clone());
            updated_contents.push((file_path.clone(), new_content));
        }
    }

    // 3. Rename the actual file
    crate::fs::rename_file(&old_path, &new_path)
        .await
        .map_err(|e| e.to_string())?;

    // 4. Update the index (inside lock)
    {
        let mut index = state.0.lock().map_err(|e| e.to_string())?;

        // Remove old file entry, add new one
        index.remove_file(&old_path);
        // Read new file content for index (the file was just renamed, content is same)
        // We can read the content from new_path, but to avoid async inside lock,
        // we just re-read it outside first — but the file content hasn't changed,
        // only references in OTHER files changed. So for the renamed file itself
        // we can read it now.
        // For updated referring files, we already have their new content.

        for (path, content) in &updated_contents {
            index.update_file_from_content(path, content);
        }
    }

    // Read the renamed file content and update its index entry
    let renamed_content = tokio::fs::read_to_string(&new_path)
        .await
        .unwrap_or_default();
    {
        let mut index = state.0.lock().map_err(|e| e.to_string())?;
        index.update_file_from_content(&new_path, &renamed_content);
    }

    Ok(RenameResult { updated_files })
}
