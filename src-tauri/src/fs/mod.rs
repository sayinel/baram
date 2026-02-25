// §3.6 파일 시스템 모듈 — 읽기/쓰기/디렉토리 목록/이름변경/삭제/감시

use crate::commands::fs_cmd::FileEntry;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::mpsc;
use tauri::Emitter;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum FsError {
    #[error("파일을 찾을 수 없습니다: {0}")]
    NotFound(String),
    #[error("파일 읽기 실패: {0}")]
    ReadError(#[from] std::io::Error),
    #[error("파일 감시 실패: {0}")]
    WatchError(String),
}

/// UTF-8 파일 읽기
pub async fn read_file(path: &str) -> Result<String, FsError> {
    tokio::fs::read_to_string(path)
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                FsError::NotFound(path.to_string())
            } else {
                FsError::ReadError(e)
            }
        })
}

/// 원자적 파일 쓰기 (§3.6: tmp → rename)
pub async fn write_file(path: &str, content: &str) -> Result<(), FsError> {
    let tmp_path = format!("{}.tmp", path);
    tokio::fs::write(&tmp_path, content).await?;
    tokio::fs::rename(&tmp_path, path).await.map_err(|e| {
        // 실패 시 임시 파일 삭제 시도
        let _ = std::fs::remove_file(&tmp_path);
        FsError::ReadError(e)
    })
}

/// 디렉토리 목록 조회
pub async fn list_dir(path: &str, recursive: bool) -> Result<Vec<FileEntry>, FsError> {
    let path = Path::new(path);
    let mut entries = Vec::new();
    list_dir_inner(path, recursive, &mut entries).await?;
    entries.sort_by(|a, b| {
        // 디렉토리 먼저, 그 다음 이름순
        b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name))
    });
    Ok(entries)
}

async fn list_dir_inner(
    path: &Path,
    recursive: bool,
    entries: &mut Vec<FileEntry>,
) -> Result<(), FsError> {
    let mut read_dir = tokio::fs::read_dir(path).await?;
    while let Some(entry) = read_dir.next_entry().await? {
        let metadata = entry.metadata().await?;
        let name = entry.file_name().to_string_lossy().to_string();

        // 숨김 파일 제외
        if name.starts_with('.') {
            continue;
        }

        // 무거운 디렉토리 제외
        const SKIP_DIRS: &[&str] = &[
            "node_modules", "target", "build", "dist",
            "__pycache__", ".next", ".git",
        ];
        if metadata.is_dir() && SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }

        let file_entry = FileEntry {
            name: name.clone(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified_at: metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0),
        };

        entries.push(file_entry);

        if recursive && metadata.is_dir() {
            Box::pin(list_dir_inner(&entry.path(), true, entries)).await?;
        }
    }
    Ok(())
}

/// 파일 이름 변경 / 이동
pub async fn rename_file(from: &str, to: &str) -> Result<(), FsError> {
    if !Path::new(from).exists() {
        return Err(FsError::NotFound(from.to_string()));
    }
    tokio::fs::rename(from, to).await.map_err(FsError::ReadError)
}

/// 디렉토리 생성 (중간 디렉토리 포함)
pub async fn create_dir(path: &str) -> Result<(), FsError> {
    tokio::fs::create_dir_all(path)
        .await
        .map_err(FsError::ReadError)
}

/// 디렉토리 재귀 삭제
pub async fn delete_dir(path: &str) -> Result<(), FsError> {
    if !Path::new(path).exists() {
        return Err(FsError::NotFound(path.to_string()));
    }
    tokio::fs::remove_dir_all(path)
        .await
        .map_err(FsError::ReadError)
}

/// 파일 삭제
pub async fn delete_file(path: &str) -> Result<(), FsError> {
    if !Path::new(path).exists() {
        return Err(FsError::NotFound(path.to_string()));
    }
    tokio::fs::remove_file(path)
        .await
        .map_err(FsError::ReadError)
}

/// 디렉토리 감시 시작 — notify crate 기반
/// file:changed, file:created, file:deleted 이벤트를 프론트엔드로 emit
pub fn watch_dir(path: &str, app_handle: tauri::AppHandle) -> Result<(), FsError> {
    let path = path.to_string();
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();

    let mut watcher: RecommendedWatcher =
        Watcher::new(tx, notify::Config::default()).map_err(|e| FsError::WatchError(e.to_string()))?;

    watcher
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| FsError::WatchError(e.to_string()))?;

    // Spawn a thread to receive file system events and emit to frontend
    std::thread::spawn(move || {
        // Keep watcher alive for the duration of this thread
        let _watcher = watcher;
        for result in rx {
            if let Ok(event) = result {
                for event_path in &event.paths {
                    let path_str = event_path.to_string_lossy().to_string();

                    // Skip .tmp files (atomic write intermediates)
                    if path_str.ends_with(".tmp") {
                        continue;
                    }

                    let is_dir = event_path.is_dir();
                    match event.kind {
                        EventKind::Create(_) => {
                            let _ = app_handle.emit(
                                "file:created",
                                serde_json::json!({ "path": path_str, "isDir": is_dir }),
                            );
                        }
                        EventKind::Modify(_) => {
                            let _ = app_handle.emit(
                                "file:changed",
                                serde_json::json!({ "path": path_str, "kind": "modified" }),
                            );
                        }
                        EventKind::Remove(_) => {
                            let _ = app_handle.emit(
                                "file:deleted",
                                serde_json::json!({ "path": path_str }),
                            );
                        }
                        _ => {}
                    }
                }
            }
        }
    });

    Ok(())
}
