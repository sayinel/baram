// §3.6 파일 시스템 모듈 — 읽기/쓰기/디렉토리 목록/이름변경/삭제/감시

use crate::commands::fs_cmd::FileEntry;
use notify::{event::ModifyKind, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::UNIX_EPOCH;
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

/// Directories excluded from markdown file collection.
pub const SKIP_DIRS: &[&str] = &["node_modules", ".git", ".obsidian", ".baram"];

/// Recursively collect all .md file paths under root, skipping hidden dirs and SKIP_DIRS.
pub async fn collect_md_files(root: &Path, files: &mut Vec<PathBuf>) -> Result<(), FsError> {
    let mut read_dir = tokio::fs::read_dir(root).await?;
    while let Some(entry) = read_dir.next_entry().await? {
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/dirs
        if name.starts_with('.') {
            continue;
        }

        let metadata = match entry.metadata().await {
            Ok(m) => m,
            Err(_) => continue,
        };

        if metadata.is_dir() {
            if !SKIP_DIRS.contains(&name.as_str()) {
                Box::pin(collect_md_files(&entry.path(), files)).await?;
            }
        } else if metadata.is_file() && (name.ends_with(".md") || name.ends_with(".markdown")) {
            files.push(entry.path());
        }
    }
    Ok(())
}

/// Validate a user-supplied path: reject null bytes and non-absolute paths.
pub fn validate_path(path: &str) -> Result<(), FsError> {
    if path.contains('\0') {
        return Err(FsError::ReadError(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Path contains null byte",
        )));
    }
    if !Path::new(path).is_absolute() {
        return Err(FsError::ReadError(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Only absolute paths are allowed",
        )));
    }
    // Defense-in-depth: reject any parent-dir (`..`) segment before path
    // resolution. The vault boundary (check_vault) already canonicalizes and
    // range-checks, but rejecting traversal here stops it one layer earlier and
    // also guards the vault-unconstrained callers (export commands).
    if path.split(['/', '\\']).any(|seg| seg == "..") {
        return Err(FsError::ReadError(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Path traversal is not allowed",
        )));
    }
    Ok(())
}

/// UTF-8 파일 읽기
pub async fn read_file(path: &str) -> Result<String, FsError> {
    tokio::fs::read_to_string(path).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            FsError::NotFound(path.to_string())
        } else {
            FsError::ReadError(e)
        }
    })
}

/// 원자적 파일 쓰기 (§3.6: tmp → rename)
/// Unique tmp suffix per call prevents concurrent writes from overwriting
/// each other's tmp file (auto-save vs manual-save race).
pub async fn write_file(path: &str, content: &str) -> Result<(), FsError> {
    let tmp_path = format!("{}.{}.tmp", path, uuid::Uuid::new_v4().as_simple());
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

        // Build/cache dirs excluded from directory listing.
        const SKIP_HEAVY_DIRS: &[&str] = &[
            "node_modules",
            "target",
            "build",
            "dist",
            "__pycache__",
            ".next",
            ".git",
        ];
        if metadata.is_dir() && SKIP_HEAVY_DIRS.contains(&name.as_str()) {
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
    tokio::fs::rename(from, to)
        .await
        .map_err(FsError::ReadError)
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

/// 바이너리 파일 복사
pub async fn copy_file(from: &str, to: &str) -> Result<(), FsError> {
    if !Path::new(from).exists() {
        return Err(FsError::NotFound(from.to_string()));
    }
    tokio::fs::copy(from, to)
        .await
        .map_err(FsError::ReadError)?;
    Ok(())
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

/// §53 ZIP 파일 추출 — Notion 내보내기 호환
pub async fn extract_zip(zip_path: &str, output_dir: &str) -> Result<Vec<String>, FsError> {
    let zip_path = zip_path.to_string();
    let output_dir = output_dir.to_string();

    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::open(&zip_path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                FsError::NotFound(zip_path.clone())
            } else {
                FsError::ReadError(e)
            }
        })?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| {
            FsError::ReadError(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                e.to_string(),
            ))
        })?;

        let mut extracted_paths = Vec::new();

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| {
                FsError::ReadError(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    e.to_string(),
                ))
            })?;

            // Skip __MACOSX and .DS_Store before any path operations
            if file.name().starts_with("__MACOSX") || file.name().ends_with(".DS_Store") {
                continue;
            }

            let outpath = std::path::Path::new(&output_dir).join(file.name());

            // Zip Slip prevention: normalize path and check containment
            // BEFORE creating any directories or files.
            let canonical_output =
                std::fs::canonicalize(&output_dir).map_err(FsError::ReadError)?;

            // Build a normalized check path without touching the filesystem.
            // Iterate components and resolve ".." manually.
            let mut normalized = canonical_output.clone();
            for component in std::path::Path::new(file.name()).components() {
                match component {
                    std::path::Component::Normal(c) => normalized.push(c),
                    std::path::Component::ParentDir => {
                        normalized.pop();
                    }
                    std::path::Component::CurDir => {}
                    _ => {}
                }
            }
            if !normalized.starts_with(&canonical_output) {
                return Err(FsError::ReadError(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!("Zip entry escapes output directory: {}", file.name()),
                )));
            }

            if file.is_dir() {
                std::fs::create_dir_all(&outpath).map_err(FsError::ReadError)?;
            } else {
                if let Some(parent) = outpath.parent() {
                    std::fs::create_dir_all(parent).map_err(FsError::ReadError)?;
                }
                let mut outfile = std::fs::File::create(&outpath).map_err(FsError::ReadError)?;
                std::io::copy(&mut file, &mut outfile).map_err(FsError::ReadError)?;

                extracted_paths.push(outpath.to_string_lossy().into_owned());
            }
        }

        Ok(extracted_paths)
    })
    .await
    .map_err(|e| FsError::ReadError(std::io::Error::other(e.to_string())))?
}

/// 디렉토리 감시 시작 — notify crate 기반
/// file:changed, file:created, file:deleted 이벤트를 프론트엔드로 emit
///
/// Returns the watcher, which must be kept alive by the caller.
/// Dropping the returned watcher closes the internal channel, causing the
/// background thread to exit naturally (RAII cleanup — no thread leak).
pub fn start_watching(
    path: &str,
    app_handle: tauri::AppHandle,
) -> Result<RecommendedWatcher, FsError> {
    let path = path.to_string();
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();

    let mut watcher: RecommendedWatcher = Watcher::new(tx, notify::Config::default())
        .map_err(|e| FsError::WatchError(e.to_string()))?;

    watcher
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| FsError::WatchError(e.to_string()))?;

    // Spawn a thread to receive file system events and emit to frontend.
    // The watcher is NOT moved here; it is returned to the caller who stores it
    // in managed state. When the managed state drops the watcher, the internal
    // tx is dropped, rx becomes disconnected, and this thread exits on its own.
    std::thread::spawn(move || {
        for event in rx.into_iter().flatten() {
            for event_path in &event.paths {
                let path_str = event_path.to_string_lossy().to_string();

                // Skip .tmp files (atomic write intermediates)
                if path_str.ends_with(".tmp") {
                    continue;
                }

                // Skip internal directories to prevent event floods
                // (e.g., git operations can generate hundreds of .git/ events)
                if path_str.contains("/.git/")
                    || path_str.contains("/.baram/")
                    || path_str.contains("/node_modules/")
                    || path_str.contains("/.next/")
                    || path_str.contains("/__pycache__/")
                {
                    continue;
                }

                match event.kind {
                    EventKind::Create(_) => {
                        let is_dir = event_path.is_dir();
                        let _ = app_handle.emit(
                            "file:created",
                            serde_json::json!({ "path": path_str, "isDir": is_dir }),
                        );
                    }
                    // Rename: macOS FSEvents reports atomic-write rename
                    // and external moves as Modify(Name), not Create/Remove
                    EventKind::Modify(ModifyKind::Name(_)) => {
                        if event_path.exists() {
                            let is_dir = event_path.is_dir();
                            let _ = app_handle.emit(
                                "file:created",
                                serde_json::json!({ "path": path_str, "isDir": is_dir }),
                            );
                        } else {
                            let _ = app_handle
                                .emit("file:deleted", serde_json::json!({ "path": path_str }));
                        }
                    }
                    EventKind::Modify(_) => {
                        // §Phase2: include mtime so frontend can detect external changes
                        let mtime = std::fs::metadata(event_path)
                            .and_then(|m| m.modified())
                            .ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_millis() as u64)
                            .unwrap_or(0);
                        let _ = app_handle.emit(
                            "file:changed",
                            serde_json::json!({ "path": path_str, "mtime": mtime }),
                        );
                    }
                    EventKind::Remove(_) => {
                        let _ = app_handle
                            .emit("file:deleted", serde_json::json!({ "path": path_str }));
                    }
                    _ => {}
                }
            }
        }
    });

    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_path_rejects_null_byte() {
        assert!(validate_path("/tmp/a\0b.md").is_err());
    }

    #[test]
    fn validate_path_rejects_relative() {
        assert!(validate_path("notes/file.md").is_err());
        assert!(validate_path("./file.md").is_err());
    }

    // §backlog #7 — defense-in-depth: reject `..` traversal segments.
    #[test]
    fn validate_path_rejects_traversal() {
        assert!(validate_path("/vault/../etc/passwd").is_err());
        assert!(validate_path("/vault/notes/../../etc").is_err());
        assert!(validate_path("/vault/..").is_err());
    }

    #[test]
    fn validate_path_accepts_clean_absolute() {
        assert!(validate_path("/vault/notes/file.md").is_ok());
        // A filename that merely contains dots (not a `..` segment) is fine.
        assert!(validate_path("/vault/a..b.md").is_ok());
    }
}
