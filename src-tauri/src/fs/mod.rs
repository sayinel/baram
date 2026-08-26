// §3.6 파일 시스템 모듈 — 읽기/쓰기/디렉토리 목록/이름변경/삭제/감시

mod copy_dir;

pub use copy_dir::{copy_dir_all, CopyDirReport};

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
    #[error("휴지통 이동 실패: {0}")]
    TrashError(String),
    /// §4.3 Folder access denied (macOS TCC / Unix EACCES). The Display string is a
    /// stable, locale-independent sentinel parsed by the frontend `listDir` wrapper.
    #[error("PERMISSION_DENIED:{0}")]
    PermissionDenied(String),
}

/// Directories excluded from markdown file collection.
pub const SKIP_DIRS: &[&str] = &["node_modules", ".git", ".obsidian", ".baram"];

/// §278 Recursively collect EVERY file under root, skipping hidden entries and SKIP_DIRS.
///
/// The link index scans only markdown for outgoing links, but a wikilink may *point* at
/// any file — `[[Paper.pdf]]`. Those targets have to be registered somewhere or the link
/// shows up as a dangling node in the graph and produces no backlink.
///
/// ‼️ No extension filter, deliberately. Enumerating the viewable types here would put a
/// second copy of a list that already lives in the frontend (`utils/file-type.ts`), and a
/// rule kept in two places is one that eventually only gets updated in one — the 1%
/// quantisation defect in the zoom path was exactly that. A target map entry for a file
/// nobody links to costs a string; it can only ever be reached by someone writing that
/// exact name.
pub async fn collect_all_files(root: &Path, files: &mut Vec<PathBuf>) -> Result<(), FsError> {
    let mut read_dir = tokio::fs::read_dir(root).await?;
    while let Some(entry) = read_dir.next_entry().await? {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let metadata = match entry.metadata().await {
            Ok(m) => m,
            Err(_) => continue,
        };
        if metadata.is_dir() {
            if !SKIP_DIRS.contains(&name.as_str()) {
                Box::pin(collect_all_files(&entry.path(), files)).await?;
            }
        } else if metadata.is_file() {
            files.push(entry.path());
        }
    }
    Ok(())
}

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
    })?;
    // §313 방금 만든 mtime을 남긴다 — 이 자리가 "앱의 쓰기"와 "남의 쓰기"를 가르는
    // 유일한 지점이다. 아래 `is_app_write` 주석 참조.
    note_app_write(Path::new(path));
    Ok(())
}

/// §313 앱이 마지막으로 만든 mtime — 경로별 한 칸.
///
/// 워처는 자기 프로세스가 쓴 파일도 남이 쓴 파일과 똑같은 `Modify(Data(Content))`로
/// 본다. 그래서 판정을 **이벤트를 받는 자리가 아니라 쓰는 자리**에 둔다: 앱 안의 모든
/// 문서 쓰기가 `write_file` 하나를 지나므로, 새 호출자가 스스로를 "이건 내 쓰기다"라고
/// 신고할 필요가 없다 — 신고를 잊을 수 있는 자리를 아예 만들지 않는 것이 요점이다.
fn app_writes() -> &'static std::sync::Mutex<std::collections::HashMap<String, u64>> {
    static APP_WRITES: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, u64>>,
    > = std::sync::OnceLock::new();
    APP_WRITES.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// 파일의 mtime(밀리초). 읽을 수 없으면 `0` — `file:changed` 페이로드가 싣는 값과
/// **같은 함수**여야 한다. 두 벌로 두면 단위나 반올림이 갈리는 순간 판정이 조용히 죽는다.
pub fn mtime_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 이 `file:changed`가 **앱 자신의 쓰기**인가.
///
/// 판정 기준은 mtime 일치 하나다. 앱이 그 파일에 마지막으로 쓴 mtime과 워처가 보고한
/// mtime이 같으면 그것은 우리가 만든 이벤트다. 그 뒤에 남이 쓰면 mtime이 앞으로
/// 움직이므로 즉시 일치가 깨진다 — 외부 편집을 화면에 반영하는 경로는 그대로 산다.
///
/// 항목을 **소비하지 않는다**(peek). FSEvents는 한 번의 쓰기에 여러 이벤트를 올릴 수
/// 있어서, 첫 이벤트가 항목을 가져가 버리면 뒤따르는 같은 쓰기의 이벤트가 외부 변경으로
/// 둔갑한다. 다음 쓰기가 그 자리를 덮으므로 맵은 쓴 파일 수만큼만 자란다.
///
/// `mtime == 0`(워처가 metadata를 못 읽음)은 언제나 거짓이다 — 0을 일치로 읽으면
/// metadata를 못 읽는 모든 이벤트가 앱의 쓰기로 둔갑한다.
pub fn is_app_write(path: &Path, mtime: u64) -> bool {
    if mtime == 0 {
        return false;
    }
    app_writes()
        .lock()
        .ok()
        .and_then(|m| m.get(&app_write_key(path)).copied())
        == Some(mtime)
}

fn note_app_write(path: &Path) {
    let mtime = mtime_ms(path);
    if mtime == 0 {
        return;
    }
    if let Ok(mut map) = app_writes().lock() {
        map.insert(app_write_key(path), mtime);
    }
}

/// 쓰는 쪽은 프론트엔드가 준 경로를, 워처는 FSEvents가 준 경로를 들고 온다. macOS에서
/// 그 둘은 심볼릭 링크(`/tmp` → `/private/tmp`) 때문에 다른 문자열일 수 있으므로 양쪽을
/// 같은 방식으로 정규화한다. 정규화가 실패하면(파일이 사라진 뒤) 원문을 쓴다.
fn app_write_key(path: &Path) -> String {
    std::fs::canonicalize(path)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| path.to_string_lossy().into_owned())
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
    let mut read_dir = tokio::fs::read_dir(path).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            // §4.3 Surface a specific, path-tagged error the frontend can recognize.
            FsError::PermissionDenied(path.to_string_lossy().to_string())
        } else {
            FsError::ReadError(e)
        }
    })?;
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

/// 디렉토리를 OS 휴지통으로 이동 (영구 삭제 아님)
pub async fn delete_dir(path: &str) -> Result<(), FsError> {
    if !Path::new(path).exists() {
        return Err(FsError::NotFound(path.to_string()));
    }
    move_to_trash(path).await
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

/// 파일을 OS 휴지통으로 이동 (영구 삭제 아님)
pub async fn delete_file(path: &str) -> Result<(), FsError> {
    if !Path::new(path).exists() {
        return Err(FsError::NotFound(path.to_string()));
    }
    move_to_trash(path).await
}

/// trash crate는 blocking API이므로 spawn_blocking으로 감싼다.
/// 실패 시 영구 삭제로 폴백하지 않는다 (안전 우선 — spec §4.2).
async fn move_to_trash(path: &str) -> Result<(), FsError> {
    let owned = path.to_string();
    tokio::task::spawn_blocking(move || trash::delete(&owned))
        .await
        .map_err(|e| FsError::TrashError(e.to_string()))?
        .map_err(|e| FsError::TrashError(e.to_string()))
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
                        let mtime = mtime_ms(event_path);
                        // §313 앱 자신의 쓰기인지 여기서 답한다. 프론트엔드는 이 값으로
                        // "외부 변경"과 "우리가 방금 한 일"을 가른다 — 토스트를 띄울지,
                        // 실행 취소 스택을 버릴지가 여기서 갈린다.
                        let origin = if is_app_write(event_path, mtime) {
                            "app"
                        } else {
                            "external"
                        };
                        let _ = app_handle.emit(
                            "file:changed",
                            serde_json::json!({ "path": path_str, "mtime": mtime, "origin": origin }),
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

    /// §275.4 B.1 — `src/ipc/fs.ts`'s `isFileNotFoundError` parses a rejection
    /// string by `startsWith`-matching this exact prefix (its own
    /// `READ_FILE_NOT_FOUND_PREFIX` constant). The two sides are coupled only
    /// through this string, with nothing enforcing it at compile time — a
    /// rewording here makes `isFileNotFoundError` return false for a genuine
    /// not-found, which sends `appendHighlightBlock`
    /// (`pdf-highlight-store.ts`) down its `throw e` branch instead of
    /// treating a missing companion note as "safe to create", breaking every
    /// first highlight on every PDF. Pin the prefix so a wording change here
    /// is caught here, not by that call failing silently in the app.
    #[test]
    fn not_found_display_prefix_is_what_the_frontend_parses() {
        assert!(FsError::NotFound("x".into())
            .to_string()
            .starts_with("파일을 찾을 수 없습니다:"));
    }

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

    /// delete_file은 영구 삭제가 아니라 휴지통 이동이어야 한다.
    /// CI 컨테이너 등 휴지통 백엔드가 없는 환경에서는 TrashError로 조기 반환(스킵).
    #[tokio::test]
    async fn delete_file_moves_entry_out_of_place() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("trash-me.md");
        std::fs::write(&file, "bye").unwrap();
        let res = delete_file(file.to_str().unwrap()).await;
        if let Err(FsError::TrashError(_)) = res {
            return; // trash 백엔드 없는 환경 — 스킵
        }
        res.unwrap();
        assert!(!file.exists());
    }

    #[tokio::test]
    async fn delete_dir_moves_entry_out_of_place() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("subdir");
        std::fs::create_dir(&sub).unwrap();
        std::fs::write(sub.join("inner.md"), "x").unwrap();
        let res = delete_dir(sub.to_str().unwrap()).await;
        if let Err(FsError::TrashError(_)) = res {
            return;
        }
        res.unwrap();
        assert!(!sub.exists());
    }
    /// §53 must DEGRADE, not crash, now that only deflate is compiled.
    ///
    /// Dropping `zip`'s default features removed the LZMA, PPMd, zstd, xz, bzip2 and AES
    /// decoders from the binary (#261 — the LZMA one allocates from a number in the archive
    /// before any byte is produced, and a failed alloc aborts the process). This importer is
    /// the user-facing consequence: a Notion export is Deflated, but somebody will eventually
    /// hand it an archive that is not, and the outcome has to be a readable error rather than
    /// a panic or a hang.
    #[tokio::test]
    async fn extract_zip_reports_a_codec_it_no_longer_compiles() {
        // Deflated on the wire, then the method field rewritten to 14 (LZMA) in both the
        // local and central headers — a codec this build has no decoder for.
        use std::io::Write;
        let mut buf = std::io::Cursor::new(Vec::<u8>::new());
        {
            let mut writer = zip::write::ZipWriter::new(&mut buf);
            writer
                .start_file("note.md", zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"# hello").unwrap();
            writer.finish().unwrap();
        }
        let mut data = buf.into_inner();
        let mut patched = 0;
        for i in 0..data.len().saturating_sub(4) {
            let offset = match &data[i..i + 4] {
                b"PK\x03\x04" => 8,
                b"PK\x01\x02" => 10,
                _ => continue,
            };
            data[i + offset..i + offset + 2].copy_from_slice(&14u16.to_le_bytes());
            patched += 1;
        }
        assert_eq!(
            patched, 2,
            "both headers must be patched, or this proves nothing"
        );

        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("export.zip");
        std::fs::write(&archive, &data).unwrap();
        let out = dir.path().join("out");
        std::fs::create_dir_all(&out).unwrap();

        let err = extract_zip(archive.to_str().unwrap(), out.to_str().unwrap())
            .await
            .expect_err("a codec we do not compile must not silently succeed");

        // An error the user can read, and nothing half-written left behind.
        assert!(!err.to_string().is_empty());
        assert!(
            std::fs::read_dir(&out).unwrap().next().is_none(),
            "nothing should have been extracted"
        );
    }
}

#[cfg(all(test, unix))]
mod permission_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::TempDir;

    #[tokio::test]
    async fn list_dir_maps_permission_denied_to_sentinel() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("locked");
        std::fs::create_dir(&dir).unwrap();
        // Remove all permissions so read_dir fails with EACCES (mirrors macOS TCC EPERM,
        // both map to std::io::ErrorKind::PermissionDenied).
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o000)).unwrap();

        let result = list_dir(dir.to_str().unwrap(), false).await;

        // Restore permissions so TempDir cleanup succeeds.
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();

        let err = result.expect_err("read of a 0o000 dir must fail");
        assert!(
            matches!(err, FsError::PermissionDenied(_)),
            "expected PermissionDenied, got {err:?}"
        );
        assert_eq!(
            err.to_string(),
            format!("PERMISSION_DENIED:{}", dir.to_str().unwrap())
        );
    }
}

/// §313 앱 자신의 쓰기와 남의 쓰기를 가르는 판정의 시험대.
#[cfg(test)]
mod app_write_tests {
    use super::*;
    use tempfile::TempDir;

    /// mtime이 실제로 바뀔 때까지 앱 밖에서 다시 쓴다. 파일시스템의 mtime 해상도가
    /// 거칠어도(HFS+는 1초) 결정적으로 끝나도록 한 번씩 기다리며 재시도한다.
    fn foreign_write_until_mtime_changes(path: &Path, was: u64) -> u64 {
        for _ in 0..120 {
            std::fs::write(path, "외부 편집기가 쓴 내용\n").unwrap();
            let now = mtime_ms(path);
            if now != was {
                return now;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        panic!("mtime이 바뀌지 않았다 — 파일시스템 해상도를 확인할 것");
    }

    #[tokio::test]
    async fn a_write_through_write_file_is_recognised_as_the_apps_own() {
        let d = TempDir::new().unwrap();
        let p = d.path().join("note.md");
        write_file(p.to_str().unwrap(), "- [ ] 할 일\n")
            .await
            .unwrap();

        let mtime = mtime_ms(&p);
        assert!(mtime > 0, "쓰기 직후 mtime을 읽을 수 있어야 한다");
        assert!(
            is_app_write(&p, mtime),
            "write_file이 만든 mtime은 앱 자신의 쓰기로 판정돼야 한다"
        );
    }

    #[tokio::test]
    async fn an_edit_by_another_program_is_not_the_apps_own() {
        let d = TempDir::new().unwrap();
        let p = d.path().join("note.md");
        write_file(p.to_str().unwrap(), "- [ ] 할 일\n")
            .await
            .unwrap();
        let ours = mtime_ms(&p);

        let theirs = foreign_write_until_mtime_changes(&p, ours);

        assert!(
            !is_app_write(&p, theirs),
            "앱을 거치지 않은 쓰기는 외부 변경으로 남아야 한다 — 여기서 참이 되면 \
             외부 편집을 화면에 반영하는 경로 전체가 죽는다"
        );
    }

    #[tokio::test]
    async fn a_file_the_app_never_wrote_is_not_the_apps_own() {
        let d = TempDir::new().unwrap();
        let p = d.path().join("stranger.md");
        std::fs::write(&p, "남이 만든 파일\n").unwrap();

        assert!(!is_app_write(&p, mtime_ms(&p)));
    }

    #[tokio::test]
    async fn an_unreadable_mtime_is_never_the_apps_own() {
        let d = TempDir::new().unwrap();
        let p = d.path().join("note.md");
        write_file(p.to_str().unwrap(), "- [ ] 할 일\n")
            .await
            .unwrap();

        // 워처가 metadata를 못 읽으면 0을 싣는다. 0을 "일치"로 읽으면 mtime을 못
        // 읽는 모든 이벤트가 앱의 쓰기로 둔갑한다.
        assert!(!is_app_write(&p, 0));
    }

    #[tokio::test]
    async fn only_the_most_recent_app_write_matches() {
        let d = TempDir::new().unwrap();
        let p = d.path().join("note.md");
        write_file(p.to_str().unwrap(), "첫 번째\n").await.unwrap();
        let first = mtime_ms(&p);

        for _ in 0..120 {
            write_file(p.to_str().unwrap(), "두 번째\n").await.unwrap();
            if mtime_ms(&p) != first {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let second = mtime_ms(&p);
        assert_ne!(first, second, "mtime이 바뀌지 않았다");

        assert!(is_app_write(&p, second));
        assert!(
            !is_app_write(&p, first),
            "지나간 쓰기의 mtime은 더 이상 일치하지 않아야 한다"
        );
    }

    #[tokio::test]
    async fn two_files_do_not_share_one_verdict() {
        let d = TempDir::new().unwrap();
        let a = d.path().join("a.md");
        let b = d.path().join("b.md");
        write_file(a.to_str().unwrap(), "A\n").await.unwrap();
        std::fs::write(&b, "B\n").unwrap();

        assert!(is_app_write(&a, mtime_ms(&a)));
        assert!(
            !is_app_write(&b, mtime_ms(&a)),
            "판정은 경로별이어야 한다 — 한 파일의 쓰기가 다른 파일까지 덮으면 안 된다"
        );
    }
}
