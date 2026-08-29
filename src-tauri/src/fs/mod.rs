// §3.6 파일 시스템 모듈 — 읽기/쓰기/디렉토리 목록/이름변경/삭제/감시

pub(crate) mod archive;
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

/// §313 앱이 방금 만든 mtime과 **그것을 기록한 시각**.
struct AppWrite {
    /// 단조 시계다(`Instant`). 벽시계를 쓰면 NTP 보정이나 사용자의 시계 변경이 기록을
    /// 임의로 늙게/젊게 만든다. 맥이 잠든 동안 `Instant`가 멈추는 것은 기록을 실제보다
    /// **젊게** 만들 뿐이라, 아래 두 방향 중 위험한 쪽(앱 자신의 쓰기가 외부 변경으로
    /// 둔갑하는 쪽)으로는 절대 기울지 않는다.
    at: std::time::Instant,
    mtime: u64,
}

/// §313 기록이 유효한 시간.
///
/// **왜 시간 제한이 필요한가.** 판정 기준이 mtime 값 하나의 일치이므로, 기록을 영원히
/// 두면 그 값에 대한 영구 주장이 된다. mtime을 **복원하는** 외부 쓰기 — `cp -p`,
/// `rsync -t`, `tar -x`/`unzip`, Time Machine, 되돌린 버전을 내려받는 동기화 클라이언트
/// — 는 정확히 그 값에 착지할 수 있고, 그러면 남의 편집이 "앱 자신의 쓰기"로 둔갑한다.
/// 대가는 토스트가 사라지는 것에서 끝나지 않는다: 실행 취소 스택이 남의 편집 위로
/// 살아남아(`patchEditorContent`는 `addToHistory: false`), Ctrl+Z 한 번이 화면을 그
/// 편집 **너머로** 되돌리고 다음 저장이 그것을 파일에 쓴다.
///
/// **왜 하필 1분인가.** 좁히면 반대 방향이 깨진다 — 창을 넘긴 앱 자신의 쓰기는 "외부
/// 변경"이 되어 토스트와 히스토리 폐기를 부른다. 창이 견뎌야 하는 것은 쓰기에 걸리는
/// 시간이 아니라(쓰기는 기록 시점에 이미 끝나 있다) **워처 스레드가 밀린 시간**이다.
/// 측정값: 조용할 때 FSEvents 팬아웃은 최악 25ms. 같은 디렉토리에 파일이 쏟아지고(git
/// checkout·vault 임포트·압축 해제) 이벤트 소비가 느릴 때는 앱 자신의 이벤트가 처리되기
/// 까지 **6.4~7.2초**가 걸렸다(flood 2,000~20,000개 × 이벤트당 0.1~1ms). 1분은 그
/// 최악값의 8배로, 더 느린 기계와 디버그 빌드에도 여유를 둔다. 반대로 내주는 것은 "앱이
/// 이 파일에 쓴 지 1분 안에, 하필 그 mtime을 복원하는 외부 쓰기가 온다"는 우연 하나뿐이다.
const APP_WRITE_TTL: std::time::Duration = std::time::Duration::from_secs(60);

/// §313 앱이 마지막으로 한 쓰기의 기록 — 경로별 한 칸.
///
/// 워처는 자기 프로세스가 쓴 파일도 남이 쓴 파일과 똑같은 `Modify(Data(Content))`로
/// 본다. 그래서 판정을 **이벤트를 받는 자리가 아니라 쓰는 자리**에 둔다: 앱 안의 모든
/// 문서 쓰기가 `write_file` 하나를 지나므로, 새 호출자가 스스로를 "이건 내 쓰기다"라고
/// 신고할 필요가 없다 — 신고를 잊을 수 있는 자리를 아예 만들지 않는 것이 요점이다.
fn app_writes() -> &'static std::sync::Mutex<std::collections::HashMap<String, AppWrite>> {
    static APP_WRITES: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, AppWrite>>,
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
/// 조건은 둘이고 둘 다 필요하다: 앱이 그 파일에 마지막으로 쓴 mtime과 워처가 보고한
/// mtime이 같을 것, 그리고 그 기록이 `APP_WRITE_TTL` 안일 것. 앞의 조건만으로는 mtime을
/// **복원하는** 외부 쓰기를 막지 못한다(`APP_WRITE_TTL` 주석 참조). 남이 평범하게 쓰면
/// mtime이 앞으로 움직이므로 즉시 일치가 깨진다 — 외부 편집을 화면에 반영하는 경로는
/// 그대로 산다.
///
/// 항목을 **소비하지 않는다**(peek). FSEvents는 한 번의 쓰기에 여러 이벤트를 올릴 수
/// 있어서, 첫 이벤트가 항목을 가져가 버리면 뒤따르는 같은 쓰기의 이벤트가 외부 변경으로
/// 둔갑한다. 이 자리는 워처 스레드가 이벤트마다 도는 뜨거운 경로라 읽기만 하고, 만료된
/// 기록을 치우는 일은 `note_app_write`가 맡는다.
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
        .and_then(|m| {
            m.get(&app_write_key(path))
                .map(|w| w.mtime == mtime && w.at.elapsed() <= APP_WRITE_TTL)
        })
        .unwrap_or(false)
}

fn note_app_write(path: &Path) {
    let mtime = mtime_ms(path);
    if mtime == 0 {
        return;
    }
    if let Ok(mut map) = app_writes().lock() {
        // 만료된 기록은 여기서 쓸어낸다. 이 청소가 없으면 맵은 앱이 쓴 **서로 다른 파일
        // 수**만큼 영구히 자란다 — 이제 상한은 "최근 1분 안에 쓴 파일 수"다.
        map.retain(|_, w| w.at.elapsed() <= APP_WRITE_TTL);
        map.insert(
            app_write_key(path),
            AppWrite {
                at: std::time::Instant::now(),
                mtime,
            },
        );
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

/// §D6 `extract_zip`이 적용하는 zip bomb 방어 한계.
///
/// `plugin::extract_zip_bounded`(§69)보다 전반적으로 넉넉하다 — Notion vault export는
/// 설치되는 코드가 아니라 사용자가 직접 고른 자신의 데이터이고, 페이지마다 마크다운·이미지·
/// PDF·비디오 첨부가 딸려 수천 개 엔트리와 수백 메가바이트급 단일 파일이 정상적으로 발생한다.
///
/// - `max_entries = 10_000`: 플러그인의 2,000(§69, "ESM 번들 하나"라는 다른 성격)의 5배.
///   대형 Notion 워크스페이스는 페이지 수천 개 + 페이지마다 딸린 자산까지 합쳐 이 자릿수에
///   실제로 닿는다.
/// - `max_entry_bytes = 512 MiB`: 내보내기에 흔한 단일 비디오/PDF 첨부 하나가 걸릴 수 있는
///   현실적 상한. 플러그인의 64 MiB(ESM 청크 기준)와 자릿수가 다른 이유가 바로 이것이다.
/// - `max_total_bytes = 2 GiB`: 전체 워크스페이스 export 하나의 현실적 상한. 폭탄은 이 값의
///   수십~수백 배를 목표로 만들어지므로, 이 정도로 넉넉해도 방어력은 그대로 유지된다.
/// - `max_ratio = 100`, `ratio_floor_bytes = 1 MiB`: 플러그인과 동일한 값을 그대로 가져온다
///   — 텍스트/마크다운의 실제 압축비(3~10:1)와 폭탄에 필요한 압축비(수백~수천:1) 사이의
///   간극은 콘텐츠의 출처와 무관하게 같다. 바꿀 근거가 없다.
/// - `max_path_depth = 16`: 플러그인과 동일. Notion의 페이지 계층이 이보다 깊게 중첩된
///   사례가 없고, 동일하게 유지하면 entries × depth 최악값이 플러그인 측정치(2,000 × 16 =
///   32,000 mkdir)의 5배(≈160,000)로만 늘어난다 — 두 한계를 독립적으로 함께 풀어
///   최악값을 곱절로 키우지 않기 위함이다.
const EXTRACT_BOUNDS: archive::ExtractBounds = archive::ExtractBounds {
    max_entries: 10_000,
    max_entry_bytes: 512 * 1024 * 1024,
    max_total_bytes: 2 * 1024 * 1024 * 1024,
    max_ratio: 100,
    ratio_floor_bytes: 1024 * 1024,
    max_path_depth: 16,
    allowed_compression: &[
        zip::CompressionMethod::Stored,
        zip::CompressionMethod::Deflated,
    ],
};

/// `archive::ArchiveError`를 이 모듈의 에러 관례로 접는다. `Refused`는 이미 이 함수가 Zip
/// Slip 거부에 쓰던 것과 같은 모양(`ReadError(InvalidInput)`)으로 맞춘다.
fn archive_error_to_fs_error(e: archive::ArchiveError) -> FsError {
    match e {
        archive::ArchiveError::Io(io) => FsError::ReadError(io),
        archive::ArchiveError::Refused(msg) => {
            FsError::ReadError(std::io::Error::new(std::io::ErrorKind::InvalidInput, msg))
        }
    }
}

/// A relative path an entry may safely extract to, given what `ZipFile::enclosed_name()`
/// (called by the caller — it needs the open entry, not just its name) made of it. Used both
/// as a display name (error messages, the returned path list) and, joined onto a directory,
/// as the write target itself.
///
/// §D6 security review, BLOCKER fix — replaces a hand-rolled lexical normalize-then-
/// `starts_with` check whose `_ => {}` arm silently dropped `RootDir`/`Prefix` components, so
/// an absolute entry name (e.g. `/tmp/owned`) replaced `output_dir` outright in the old
/// `Path::join` and then passed containment trivially because the check compared against an
/// unrelated synthetic path it built beneath `canonical_output`. `enclosed_name()` operates
/// purely on the entry's own components: a leading root/prefix is re-rooted into a relative
/// path rather than rejected (the same safe behaviour `plugin::extract_zip_bounded` already
/// relies on), and any `..` that would climb above the top yields `None`, which is a hard
/// error here — fs's contract (unlike plugin's silent skip) has always been to refuse a Zip
/// Slip attempt loudly.
fn reject_escaping_entry(name: &str, enclosed: Option<PathBuf>) -> Result<PathBuf, FsError> {
    let escapes = || {
        FsError::ReadError(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("Zip entry escapes output directory: {name}"),
        ))
    };
    // `enclosed_name()` can also legally return an empty path (an entry literally named `/`
    // or `.`) — joining that onto a directory yields the directory itself, and creating that
    // as a "file" fails confusingly rather than safely. Treat it the same as an escape.
    match enclosed {
        Some(relative) if !relative.as_os_str().is_empty() => Ok(relative),
        _ => Err(escapes()),
    }
}

/// After every entry has passed every bound, move the staged tree into `output_dir` in TWO
/// passes: PREFLIGHT walks the staged tree read-only and rejects every failure condition that
/// can be determined ahead of time; only once the entire tree preflights clean does COMMIT
/// walk it again to actually `create_dir_all`/`rename`. A single combined "check this entry,
/// then move it" pass (the previous shape of this function) could reject entry N *after*
/// entries `1..N-1` had already been renamed into `output_dir` — a refusal that still left the
/// vault partially rewritten, contradicting the "refused ⇒ untouched" contract the rest of
/// this module relies on.
///
/// Directories are `create_dir_all`'d (merging into whatever already exists, so a repeat
/// extraction into a non-empty vault folder still succeeds); files are `fs::rename`'d, which
/// atomically replaces an existing file of the same name — preserving the extractor's
/// pre-existing overwrite behaviour — and, being on the same filesystem (`staged` is a
/// `tempdir_in(output_dir)`), cannot fail with a cross-device error partway through.
///
/// PREFLIGHT rejects, for every path in the staged tree, before a single directory is created
/// or file renamed:
/// - a symlink anywhere on the path an entry would land on or pass through in `output_dir`
///   (`reject_symlink_ancestors`, using `symlink_metadata` so it is never followed) — §D6
///   security review, BLOCKER, see below;
/// - a file/directory kind conflict: the staged entry is a directory but `output_dir` already
///   has a plain file at that path, or vice versa. `create_dir_all`/`rename` would otherwise
///   only discover this mid-walk — `rename`ing a file onto an existing directory, or
///   `create_dir_all`ing through an existing file, fails as a plain I/O error with whatever
///   earlier siblings already moved left in place.
///
/// Once PREFLIGHT passes clean, the failures COMMIT can still hit are ones a read-only pass
/// cannot rule out: any commit-stage I/O error — a read-only or full filesystem, quota or
/// inode exhaustion, a file lock, a parent whose ACL allows stat but not write — or something
/// outside this app changing `output_dir` in the window between the two passes. A COMMIT-stage
/// failure can therefore still leave a partial write behind; this is the one gap the "refused
/// ⇒ untouched" guarantee does not close, and is accepted for this app's threat model (a local
/// desktop user extracting an archive they just chose to import, not a multi-tenant server
/// under adversarial load). Building and tearing down the staging `TempDir` itself also
/// touches `output_dir`'s mtime — accepted as harmless, since nothing here reads that
/// timestamp as a content signal.
///
/// ‼️ Guards against a pre-existing symlink inside `output_dir`: before creating or renaming
/// into any path, every already-existing ancestor component (PREFLIGHT) — and, defensively,
/// again right before the syscall (COMMIT) — is checked with `symlink_metadata` (which does
/// not follow) and rejected if it is a symlink — otherwise `create_dir_all`/`rename` would
/// transparently follow it and land the write somewhere outside `output_dir` (§D6 security
/// review, BLOCKER). This still has a TOCTOU window between each check and the syscall that
/// follows it: closing it fully needs `openat`-style no-follow-by-directory-handle primitives
/// that Rust's std does not expose portably. The threat model here is a local desktop attacker
/// racing the app's own extraction of an archive the user just chose to import — not a
/// multi-tenant server — so that residual window is accepted rather than addressed with
/// platform-specific unsafe code.
fn commit_staged_extraction(staged_root: &Path, output_dir: &Path) -> Result<(), FsError> {
    fn reject_symlink_ancestors(output_dir: &Path, relative: &Path) -> Result<(), FsError> {
        let mut probe = output_dir.to_path_buf();
        for component in relative.components() {
            probe.push(component);
            // Fail closed: only a clean NotFound means "nothing there". Any other
            // metadata error (permission, I/O) must abort PREFLIGHT — treating it as
            // absence would wave the path through and let COMMIT discover the problem
            // mid-walk, after earlier siblings already moved (§review, MAJOR).
            match std::fs::symlink_metadata(&probe) {
                Ok(meta) => {
                    if meta.file_type().is_symlink() {
                        return Err(FsError::ReadError(std::io::Error::new(
                            std::io::ErrorKind::InvalidInput,
                            format!(
                                "refusing to extract through an existing symlink at {}",
                                probe.display()
                            ),
                        )));
                    }
                }
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => return Err(FsError::ReadError(err)),
            }
        }
        Ok(())
    }

    /// Read-only: verifies every path in the staged tree can be committed, without creating
    /// or renaming anything. Recurses into staged directories regardless of whether
    /// `output_dir` already has something at that path (merge is fine as long as the kinds
    /// match); the first path that cannot be committed aborts the whole preflight via `?`,
    /// before COMMIT ever runs.
    fn preflight(staged_root: &Path, dir: &Path, output_dir: &Path) -> Result<(), FsError> {
        // Deterministic order: `read_dir` order is filesystem-specific, which would make
        // both the walk and its regression pins depend on where the test happens to run.
        let mut entries = std::fs::read_dir(dir)?.collect::<Result<Vec<_>, _>>()?;
        entries.sort_unstable_by_key(|e| e.file_name());
        for entry in entries {
            let path = entry.path();
            let relative = path
                .strip_prefix(staged_root)
                .expect("walked path is always under staged_root");
            reject_symlink_ancestors(output_dir, relative)?;

            let target = output_dir.join(relative);
            let staged_is_dir = entry.file_type()?.is_dir();
            // `reject_symlink_ancestors` above already ruled out `target` being a symlink, so
            // if `symlink_metadata` finds something here it is a plain file or directory.
            // Fail closed on metadata errors — only NotFound means the path is free.
            match std::fs::symlink_metadata(&target) {
                Ok(existing) => {
                    if existing.is_dir() != staged_is_dir {
                        return Err(FsError::ReadError(std::io::Error::new(
                            std::io::ErrorKind::AlreadyExists,
                            format!(
                            "refusing to extract {} over an existing {} of a different kind at {}",
                            relative.display(),
                            if existing.is_dir() {
                                "directory"
                            } else {
                                "file"
                            },
                            target.display()
                        ),
                        )));
                    }
                }
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => return Err(FsError::ReadError(err)),
            }

            if staged_is_dir {
                preflight(staged_root, &path, output_dir)?;
            }
        }
        Ok(())
    }

    /// Only reached once `preflight` has cleared the entire staged tree. Every failure from
    /// here on is, by construction, one preflight could not have predicted — see the doc
    /// comment on `commit_staged_extraction`.
    fn commit(staged_root: &Path, dir: &Path, output_dir: &Path) -> Result<(), FsError> {
        let mut entries = std::fs::read_dir(dir)?.collect::<Result<Vec<_>, _>>()?;
        entries.sort_unstable_by_key(|e| e.file_name());
        for entry in entries {
            let path = entry.path();
            let relative = path
                .strip_prefix(staged_root)
                .expect("walked path is always under staged_root");
            reject_symlink_ancestors(output_dir, relative)?;
            let target = output_dir.join(relative);
            if entry.file_type()?.is_dir() {
                std::fs::create_dir_all(&target)?;
                commit(staged_root, &path, output_dir)?;
            } else {
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::rename(&path, &target)?;
            }
        }
        Ok(())
    }

    preflight(staged_root, staged_root, output_dir)?;
    commit(staged_root, staged_root, output_dir)
}

/// §53 ZIP 파일 추출 — Notion 내보내기 호환. §D6부터 zip bomb 방어(entry 수 · per-entry ·
/// total · ratio · path depth · compression method)가 걸린다 — 자세한 근거는
/// `EXTRACT_BOUNDS`.
///
/// §D6 security review, MAJOR fix — every entry extracts into a scratch directory staged
/// beneath `output_dir` (same filesystem, so the final commit can `rename` rather than copy)
/// and is only moved into `output_dir` once the ENTIRE archive has passed every bound. Before
/// this, `File::create` truncated the real destination — possibly an existing vault file —
/// before the per-entry cap was even checked, so a rejected archive could leave that file
/// overwritten with `cap + 1` attacker bytes and every earlier entry already extracted.
///
/// A refusal from any per-entry bound check in the loop below never touches `output_dir` at
/// all — nothing has been written anywhere but `staged` yet — and the staging `TempDir` is
/// dropped (removing everything written so far) the moment this function returns an `Err`, on
/// every return path, including a panic unwind. A refusal from the commit step that follows
/// (`commit_staged_extraction`) carries its own, narrower guarantee: see that function's doc
/// comment for exactly which failures it still leaves `output_dir` untouched against, and
/// which residual class it does not.
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
        // 아카이브가 스스로 주장하는 크기가 아니라, wire 위에 실제로 있는 바이트 수 — ratio
        // 계산의 분모다. `ZipArchive::new`가 `file`을 소유해 버리기 전에 읽어 둔다.
        let compressed_len = file.metadata().map(|m| m.len()).unwrap_or(0);
        let mut archive = zip::ZipArchive::new(file).map_err(|e| {
            FsError::ReadError(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                e.to_string(),
            ))
        })?;

        archive::check_entry_count(archive.len(), &EXTRACT_BOUNDS, "zip archive")
            .map_err(archive_error_to_fs_error)?;

        let output_dir_path = Path::new(&output_dir);
        // Same filesystem as `output_dir` (a *sibling* tempdir under the OS temp root would
        // not be, defeating the atomic `rename` in `commit_staged_extraction`), and fresh —
        // nothing an attacker placed inside `output_dir` earlier (a symlink, say) is anywhere
        // on the path an entry writes to until the commit step, which checks for exactly
        // that.
        let staged = tempfile::Builder::new()
            .prefix(".baram-extract-")
            .tempdir_in(output_dir_path)
            .map_err(FsError::ReadError)?;

        let mut extracted_relative_paths: Vec<PathBuf> = Vec::new();
        let mut total_written: u64 = 0;

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

            let raw_name = file.name().to_string();
            let relative_path = reject_escaping_entry(&raw_name, file.enclosed_name())?;
            let out_path = staged.path().join(&relative_path);

            let is_dir = file.is_dir();
            let method = file.compression();
            let depth = relative_path.components().count();

            let written = archive::extract_entry(
                &mut file,
                archive::EntryContext {
                    method,
                    is_dir,
                    depth,
                    raw_name: &raw_name,
                    relative_path: &relative_path,
                    out_path: &out_path,
                    compressed_len,
                    total_written,
                },
                &EXTRACT_BOUNDS,
                "zip archive",
            )
            .map_err(archive_error_to_fs_error)?;
            total_written += written;

            if !is_dir {
                extracted_relative_paths.push(relative_path);
            }
        }

        // Every entry passed every bound: commit the staged tree in one pass. `staged` is
        // dropped (deleting whatever remains of it) when this function returns either way.
        commit_staged_extraction(staged.path(), output_dir_path)?;

        Ok(extracted_relative_paths
            .into_iter()
            .map(|relative| {
                output_dir_path
                    .join(relative)
                    .to_string_lossy()
                    .into_owned()
            })
            .collect())
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

/// §D6 zip bomb 방어 — `plugin::extract_zip_bounded`(§69)가 이미 갖췄던 여섯 방어 중
/// `extract_zip`에는 없었던 나머지를 `crate::fs::archive`를 통해 채웠는지 검증한다.
///
/// 값을 축소해 주입할 파라미터가 없으므로(§53 IPC 표면은 경로 문자열 두 개뿐, `EXTRACT_BOUNDS`는
/// 상수) 실제 운영 한계 그대로 검사한다 — plugin의 `refuses_a_real_bomb_through_the_production_bounds`
/// 와 같은 방식: entry 수는 정확히 한계 + 1개의 빈 엔트리로, ratio는 2 MiB 제로가 수 킬로바이트로
/// 압축되는 모양으로 값싸게 트리거한다.
#[cfg(test)]
mod extract_zip_bomb_tests {
    use super::*;

    fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        let mut buf = std::io::Cursor::new(Vec::<u8>::new());
        {
            let mut writer = zip::write::ZipWriter::new(&mut buf);
            let opts = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            for (name, body) in entries {
                writer.start_file(*name, opts).unwrap();
                writer.write_all(body).unwrap();
            }
            writer.finish().unwrap();
        }
        buf.into_inner()
    }

    fn write_zip(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }

    /// 이전에는 이 검사 자체가 없었다 — `probe_entry_count_currently_unbounded`(임시 검증,
    /// 이 커밋에서 이미 제거됨)로 지금 이 한계가 없으면 10,001개짜리 아카이브가 그대로
    /// 성공한다는 것을 먼저 확인한 뒤에 이 한계를 추가했다.
    #[tokio::test]
    async fn refuses_more_entries_than_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        let names: Vec<String> = (0..=EXTRACT_BOUNDS.max_entries)
            .map(|i| format!("f{i}"))
            .collect();
        let entries: Vec<(&str, &[u8])> =
            names.iter().map(|n| (n.as_str(), b"" as &[u8])).collect();
        let zip_path = write_zip(dir.path(), "bomb-entries.zip", &zip_bytes(&entries));
        let out = dir.path().join("out");
        std::fs::create_dir_all(&out).unwrap();

        let err = extract_zip(zip_path.to_str().unwrap(), out.to_str().unwrap())
            .await
            .expect_err("an archive declaring more entries than the limit must be refused");

        assert!(
            err.to_string()
                .contains(&format!("over the {} limit", EXTRACT_BOUNDS.max_entries)),
            "{err}"
        );
        assert!(
            std::fs::read_dir(&out).unwrap().next().is_none(),
            "the entry-count check must run before any entry is touched"
        );
    }

    /// The canonical zip-bomb shape — `plugin::a_bomb_is_refused_before_it_can_fill_the_disk`
    /// pins the same property for the plugin installer.
    #[tokio::test]
    async fn refuses_a_high_ratio_archive() {
        let dir = tempfile::tempdir().unwrap();
        let bomb_body = vec![0u8; 2 * 1024 * 1024];
        let bytes = zip_bytes(&[("bomb.bin", &bomb_body)]);
        assert!(
            bytes.len() < 64 * 1024,
            "fixture must actually be a bomb: {} bytes on the wire",
            bytes.len()
        );
        let zip_path = write_zip(dir.path(), "bomb-ratio.zip", &bytes);
        let out = dir.path().join("out");
        std::fs::create_dir_all(&out).unwrap();

        let err = extract_zip(zip_path.to_str().unwrap(), out.to_str().unwrap())
            .await
            .expect_err("a high compression-ratio entry must be refused");

        assert!(err.to_string().contains("bytes allowed for its"), "{err}");
        // §D6 MAJOR fix — every entry now extracts into a staged `TempDir` and is only
        // moved into `output_dir` once the whole archive has passed every bound, so a
        // refusal must leave `output_dir` with nothing at all: not the `cap + 1` bytes the
        // bounded read let through, not the staging directory that briefly held them
        // (dropped on the way out). Before that fix this only asserted `written <
        // bomb_body.len()`, which a decoder writing almost the entire bomb would still pass.
        assert!(
            std::fs::read_dir(&out).unwrap().next().is_none(),
            "a refused archive must leave output_dir exactly as it was"
        );
    }

    /// The control — every refusal above only means something if ordinary Notion exports
    /// still extract untouched.
    #[tokio::test]
    async fn extracts_a_normal_archive_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = zip_bytes(&[("note.md", b"# hello"), ("sub/child.md", b"world")]);
        let zip_path = write_zip(dir.path(), "normal.zip", &bytes);
        let out = dir.path().join("out");
        std::fs::create_dir_all(&out).unwrap();

        let paths = extract_zip(zip_path.to_str().unwrap(), out.to_str().unwrap())
            .await
            .expect("an ordinary archive within every bound must extract");

        assert_eq!(paths.len(), 2);
        assert_eq!(
            std::fs::read_to_string(out.join("note.md")).unwrap(),
            "# hello"
        );
        assert_eq!(
            std::fs::read_to_string(out.join("sub/child.md")).unwrap(),
            "world"
        );
    }

    /// Regression — the bomb bounds must not have loosened the pre-existing Zip Slip check
    /// (`normalized.starts_with(&canonical_output)` above), which predates this change and
    /// runs before any of the new bounds are even reached.
    #[tokio::test]
    async fn refuses_a_path_that_escapes_the_output_dir() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = zip_bytes(&[("../escape.txt", b"pwned")]);
        let zip_path = write_zip(dir.path(), "slip.zip", &bytes);
        let out = dir.path().join("out");
        std::fs::create_dir_all(&out).unwrap();

        let err = extract_zip(zip_path.to_str().unwrap(), out.to_str().unwrap())
            .await
            .expect_err("an entry that escapes the output dir must still be refused");

        assert!(
            err.to_string().contains("escapes output directory"),
            "{err}"
        );
        assert!(!dir.path().join("escape.txt").exists());
    }

    /// §D6 security review, BLOCKER — an absolute entry name must never land outside
    /// `output_dir`. `zip::ZipEntry::enclosed_name()` (used below in place of the old manual
    /// lexical loop) does not error on an absolute name; it re-roots it as a relative path
    /// (`/tmp/owned` → `tmp/owned`), which is the crate's documented-safe behaviour and the
    /// same one `plugin::extract_zip_bounded` already relies on. So the assertion that
    /// matters is CONTAINMENT, not refusal: regardless of whether the call succeeds, the
    /// absolute target must not have been touched.
    ///
    /// Before this fix, `probe_absolute_entry_writes_outside_output_dir` (removed once this
    /// landed) reproduced the escape against the unpatched code: the entry's absolute name
    /// replaced `output_dir` in `Path::join` outright, and the old lexical check's `_ => {}`
    /// arm ignored the leading `RootDir` component, so the file was written straight to the
    /// absolute path with `Ok(..)` returned.
    #[tokio::test]
    async fn refuses_to_let_an_absolute_entry_escape_output_dir() {
        let dir = tempfile::tempdir().unwrap();
        let victim = dir.path().join("victim");
        std::fs::create_dir_all(&victim).unwrap();
        let victim_target = victim.join("owned.txt");

        let absolute_name = victim_target.to_str().unwrap().to_string();
        let bytes = zip_bytes(&[(absolute_name.as_str(), b"pwned")]);
        let zip_path = write_zip(dir.path(), "absolute.zip", &bytes);

        let out = dir.path().join("out");
        std::fs::create_dir_all(&out).unwrap();

        let _ = extract_zip(zip_path.to_str().unwrap(), out.to_str().unwrap()).await;

        assert!(
            !victim_target.exists(),
            "an absolute entry name must never write outside output_dir"
        );
    }

    /// §D6 security review, BLOCKER — a symlink an attacker (or an earlier, unrelated
    /// operation) left inside `output_dir` before this extraction runs must not be followed.
    /// Every entry stages into a FRESH `TempDir` first, so the symlink is never on the path
    /// anything writes to until the final commit — which is exactly where this is checked,
    /// in `commit_staged_extraction`'s `reject_symlink_ancestors`.
    #[cfg(unix)]
    #[tokio::test]
    async fn refuses_to_extract_through_an_existing_symlink_directory() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("out");
        std::fs::create_dir_all(&out).unwrap();
        // A directory OUTSIDE `out` that `out/sub` will point at.
        let elsewhere = dir.path().join("elsewhere");
        std::fs::create_dir_all(&elsewhere).unwrap();
        std::os::unix::fs::symlink(&elsewhere, out.join("sub")).unwrap();

        let bytes = zip_bytes(&[("sub/pwned.txt", b"pwned")]);
        let zip_path = write_zip(dir.path(), "symlink-escape.zip", &bytes);

        let err = extract_zip(zip_path.to_str().unwrap(), out.to_str().unwrap())
            .await
            .expect_err("writing beneath an existing symlink directory must be refused");

        assert!(err.to_string().contains("existing symlink"), "{err}");
        assert!(
            !elsewhere.join("pwned.txt").exists(),
            "the entry must not have been written through the symlink"
        );
        assert!(
            std::fs::symlink_metadata(out.join("sub"))
                .unwrap()
                .file_type()
                .is_symlink(),
            "the pre-existing symlink itself must be left alone, not replaced"
        );
    }

    /// §D6 security review, MAJOR — a refused archive must leave what was already at
    /// `output_dir` untouched. Before staging, `File::create` opened (and so truncated) the
    /// FINAL destination before the per-entry bound was even checked, so a bomb entry
    /// sharing a name with an existing vault file overwrote it with `cap + 1` attacker bytes
    /// and left it that way even though the call returned `Err`.
    #[tokio::test]
    async fn refusal_leaves_an_existing_file_at_the_same_name_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("out");
        std::fs::create_dir_all(&out).unwrap();
        std::fs::write(out.join("bomb.bin"), b"the user's actual file").unwrap();

        let bomb_body = vec![0u8; 2 * 1024 * 1024];
        let bytes = zip_bytes(&[("bomb.bin", &bomb_body)]);
        let zip_path = write_zip(dir.path(), "bomb-overwrite.zip", &bytes);

        let err = extract_zip(zip_path.to_str().unwrap(), out.to_str().unwrap())
            .await
            .expect_err("a bomb sharing a name with an existing file must still be refused");
        assert!(err.to_string().contains("bytes allowed for its"), "{err}");

        assert_eq!(
            std::fs::read_to_string(out.join("bomb.bin")).unwrap(),
            "the user's actual file",
            "a refused archive must not have touched the file it tried to overwrite"
        );
        let residue: Vec<_> = std::fs::read_dir(&out).unwrap().collect();
        assert_eq!(
            residue.len(),
            1,
            "no partial extraction residue may remain alongside it: {residue:?}"
        );
    }

    /// §D6 follow-up, MAJOR — `commit_staged_extraction` used to walk the staged tree and
    /// `rename` each entry into place as it went, so a later entry's rejection (here: a
    /// symlink `output_dir` already has at `sub`) could be discovered only after an earlier,
    /// wholly unrelated entry (`alpha.md`) had already been renamed in. The call still
    /// returned `Err`, but `output_dir` was left partially rewritten — contradicting every
    /// other test in this module, which all assume a refusal leaves `output_dir` untouched.
    /// Reproduced directly against the unpatched single-pass `commit_staged_extraction` before
    /// this fix: the rename for `alpha.md` had already landed in `output_dir` by the time the
    /// walk reached `sub/pwned.txt` and errored out. Both walks now sort entries by file
    /// name, so `alpha.md` deterministically precedes `sub` — this pin no longer depends on
    /// whatever order the filesystem happens to return `read_dir` entries in, and would catch
    /// a regression to the single-pass walk on any platform.
    ///
    /// The fix splits the function into a read-only PREFLIGHT pass that walks the whole staged
    /// tree and rejects every predictable failure — including this one — before COMMIT renames
    /// a single thing, so this now holds regardless of which order the filesystem happens to
    /// return entries in.
    #[cfg(unix)]
    #[tokio::test]
    async fn refusal_partway_through_leaves_earlier_entries_uncommitted() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("out");
        std::fs::create_dir_all(&out).unwrap();
        let elsewhere = dir.path().join("elsewhere");
        std::fs::create_dir_all(&elsewhere).unwrap();
        std::os::unix::fs::symlink(&elsewhere, out.join("sub")).unwrap();

        let bytes = zip_bytes(&[("alpha.md", b"hello A"), ("sub/pwned.txt", b"pwned")]);
        let zip_path = write_zip(dir.path(), "partial-reflection.zip", &bytes);

        let err = extract_zip(zip_path.to_str().unwrap(), out.to_str().unwrap())
            .await
            .expect_err("the symlink ancestor must still refuse the whole archive");
        assert!(err.to_string().contains("existing symlink"), "{err}");

        assert!(
            !out.join("alpha.md").exists(),
            "a normal entry earlier in the walk must not have been committed \
             once a later entry in the same archive was refused"
        );
        assert!(
            !elsewhere.join("pwned.txt").exists(),
            "the rejected entry itself must not have been written through the symlink"
        );
        assert!(
            std::fs::symlink_metadata(out.join("sub"))
                .unwrap()
                .file_type()
                .is_symlink(),
            "the pre-existing symlink itself must be left alone, not replaced"
        );
        let residue: Vec<_> = std::fs::read_dir(&out).unwrap().collect();
        assert_eq!(
            residue.len(),
            1,
            "output_dir must have nothing beyond what was already there: {residue:?}"
        );
    }

    /// PREFLIGHT's second rejection: a staged entry and an existing entry at the same path
    /// disagree on file vs. directory. Before PREFLIGHT existed, this surfaced only when
    /// `commit_staged_extraction`'s single pass reached that entry and `fs::rename`/
    /// `create_dir_all` failed on it directly — after any earlier siblings had already moved.
    #[tokio::test]
    async fn refuses_a_staged_file_over_an_existing_directory_of_the_same_name() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("out");
        std::fs::create_dir_all(out.join("x")).unwrap();
        std::fs::write(out.join("x/keep.txt"), "already here").unwrap();

        let bytes = zip_bytes(&[("x", b"pwned")]);
        let zip_path = write_zip(dir.path(), "kind-conflict.zip", &bytes);

        let err = extract_zip(zip_path.to_str().unwrap(), out.to_str().unwrap())
            .await
            .expect_err("a staged file must not silently replace an existing directory");
        assert!(err.to_string().contains("different kind"), "{err}");

        assert!(
            out.join("x").is_dir(),
            "the existing directory must survive the refusal"
        );
        assert_eq!(
            std::fs::read_to_string(out.join("x/keep.txt")).unwrap(),
            "already here",
            "content inside the existing directory must be untouched"
        );
    }

    /// The mirror rejection: a staged DIRECTORY over an existing FILE. `create_dir_all`
    /// through the existing file would otherwise fail mid-COMMIT as a plain I/O error.
    #[tokio::test]
    async fn refuses_a_staged_directory_over_an_existing_file_of_the_same_name() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("out");
        std::fs::create_dir_all(&out).unwrap();
        std::fs::write(out.join("y"), "a plain file").unwrap();

        let bytes = zip_bytes(&[("y/inner.txt", b"nested")]);
        let zip_path = write_zip(dir.path(), "kind-conflict-dir.zip", &bytes);

        let err = extract_zip(zip_path.to_str().unwrap(), out.to_str().unwrap())
            .await
            .expect_err("a staged directory must not silently replace an existing file");
        assert!(err.to_string().contains("different kind"), "{err}");

        assert_eq!(
            std::fs::read_to_string(out.join("y")).unwrap(),
            "a plain file",
            "the existing file must survive the refusal"
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

    /// 기록을 실제로 기다리지 않고 창 밖(또는 창 안의 특정 지점)으로 밀어 놓는다.
    /// 프로덕션이 쓰는 바로 그 맵을 건드리므로, 기록의 모양이 바뀌면 여기도 같이 깨진다.
    fn rewind_record(path: &Path, by: std::time::Duration) {
        let mut map = app_writes().lock().unwrap();
        let entry = map
            .get_mut(&app_write_key(path))
            .expect("방금 쓴 파일의 기록이 있어야 한다");
        entry.at = entry
            .at
            .checked_sub(by)
            .expect("Instant를 되감을 수 없다 — 부팅 직후인가?");
    }

    /// §313 mtime을 **복원하는** 외부 쓰기가 앱 자신의 쓰기로 둔갑하면 안 된다.
    ///
    /// 판정이 mtime 값 하나의 일치이므로 기록을 영원히 두면 그 값에 대한 영구 주장이
    /// 된다. `cp -p`·`rsync -t`·`tar -x`·Time Machine·되돌린 버전을 내려받는 동기화
    /// 클라이언트는 정확히 그 값에 착지할 수 있다. 여기서 참이 되면 남의 편집 위로
    /// `patchEditorContent`가 돌아 실행 취소 스택이 살아남고, Ctrl+Z 한 번이 화면을 남의
    /// 편집 **너머로** 되돌린 뒤 다음 저장이 그것을 파일에 쓴다 — 토스트도 없이 조용히.
    #[cfg(unix)]
    #[tokio::test]
    async fn an_external_write_that_restores_our_mtime_is_not_the_apps_own() {
        let d = TempDir::new().unwrap();
        let p = d.path().join("note.md");
        write_file(p.to_str().unwrap(), "- [ ] 할 일\n")
            .await
            .unwrap();
        let ours = mtime_ms(&p);

        // mtime 도장을 떠 둔다 — `cp -p`가 타임스탬프를 함께 복사한다.
        let stamp = d.path().join("stamp");
        assert!(
            std::process::Command::new("cp")
                .args(["-p", p.to_str().unwrap(), stamp.to_str().unwrap()])
                .status()
                .unwrap()
                .success(),
            "cp -p 실패"
        );

        // 이 파일에 쓴 지 한참 지났다 — 백업이 만들어지고 복원되기까지의 시간.
        rewind_record(&p, APP_WRITE_TTL + std::time::Duration::from_secs(1));

        // 남이 쓴다. 그리고 그 도구가 원래 mtime을 되돌려 놓는다.
        std::fs::write(&p, "복원된, 우리가 쓰지 않은 내용\n").unwrap();
        assert!(
            std::process::Command::new("touch")
                .args(["-r", stamp.to_str().unwrap(), p.to_str().unwrap()])
                .status()
                .unwrap()
                .success(),
            "touch -r 실패"
        );

        let restored = mtime_ms(&p);
        assert_eq!(
            restored, ours,
            "이 테스트의 전제 — 외부 도구가 mtime을 정확히 복원할 수 있어야 한다"
        );
        assert_ne!(
            std::fs::read_to_string(&p).unwrap(),
            "- [ ] 할 일\n",
            "디스크의 내용은 앱이 쓴 것이 아니어야 한다"
        );

        assert!(
            !is_app_write(&p, restored),
            "mtime만 같을 뿐 남이 쓴 내용이다 — 앱의 쓰기로 판정되면 실행 취소 스택이 \
             남의 편집 위로 살아남는다"
        );
    }

    /// 반대 방향 — 창이 좁으면 앱 자신의 쓰기가 다시 "외부 변경"이 된다.
    ///
    /// 창이 견뎌야 하는 것은 쓰기 시간이 아니라 **워처 스레드가 밀린 시간**이다(쓰기는
    /// 기록 시점에 이미 끝나 있다). 같은 디렉토리에 파일이 쏟아지고(git checkout·vault
    /// 임포트) 이벤트 소비가 느릴 때를 측정한 최악값이 7.2초였다. 그만큼 늦게 처리된
    /// 이벤트도 여전히 우리 것으로 읽혀야 한다 — 아니면 토스트가 뜨고 히스토리가 버려진다.
    #[tokio::test]
    async fn an_event_delayed_by_a_watcher_backlog_is_still_the_apps_own() {
        let d = TempDir::new().unwrap();
        let p = d.path().join("note.md");
        write_file(p.to_str().unwrap(), "- [ ] 할 일\n")
            .await
            .unwrap();
        let ours = mtime_ms(&p);

        rewind_record(&p, std::time::Duration::from_millis(7200));

        assert!(
            is_app_write(&p, ours),
            "측정된 최악의 이벤트 지연(7.2초)보다 창이 좁다 — 파일 이벤트가 몰리는 동안 \
             앱 자신의 저장이 외부 변경으로 둔갑한다"
        );
    }

    /// 만료된 기록은 맵에 남지 않는다 — 예전에는 쓴 파일 수만큼 영구히 자랐다.
    #[tokio::test]
    async fn an_expired_record_is_swept_out_of_the_registry() {
        let d = TempDir::new().unwrap();
        let old = d.path().join("old.md");
        let fresh = d.path().join("fresh.md");
        write_file(old.to_str().unwrap(), "옛날 것\n")
            .await
            .unwrap();
        let old_key = app_write_key(&old);
        assert!(app_writes().lock().unwrap().contains_key(&old_key));

        rewind_record(&old, APP_WRITE_TTL + std::time::Duration::from_secs(1));
        // 다음 쓰기가 만료된 기록을 쓸어낸다.
        write_file(fresh.to_str().unwrap(), "새 것\n")
            .await
            .unwrap();

        assert!(
            !app_writes().lock().unwrap().contains_key(&old_key),
            "만료된 기록이 남으면 맵은 앱이 지금까지 쓴 파일 수만큼 자란다"
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
