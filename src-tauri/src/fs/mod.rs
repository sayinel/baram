// §3.6 파일 시스템 모듈 — 읽기/쓰기/디렉토리 목록

use crate::commands::fs_cmd::FileEntry;
use std::path::Path;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum FsError {
    #[error("파일을 찾을 수 없습니다: {0}")]
    NotFound(String),
    #[error("파일 읽기 실패: {0}")]
    ReadError(#[from] std::io::Error),
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
