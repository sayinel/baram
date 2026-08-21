// §56d Photo Gallery 썸네일 IPC 커맨드 (thin layer — 로직은 crate::thumbnail)

use tauri::Manager;

/// 동시에 도는 썸네일 생성 수. 생성 한 건이 원본 하나를 통째로 디코드하므로(파노라마면
/// ~600MB) 이 숫자가 곧 순간 최대 메모리다. 첫 스캔은 사진 수만큼 한 번만 돌고 그 뒤로는
/// 캐시 히트라 처리량보다 최대치를 눌러 두는 편이 맞다.
const MAX_CONCURRENT_THUMBNAILS: usize = 2;

pub struct ThumbnailSemaphore(pub tokio::sync::Semaphore);

impl ThumbnailSemaphore {
    pub fn new() -> Self {
        Self(tokio::sync::Semaphore::new(MAX_CONCURRENT_THUMBNAILS))
    }
}

impl Default for ThumbnailSemaphore {
    fn default() -> Self {
        Self::new()
    }
}

/// 캐시 디렉터리. `setup`이 여기에 asset 프로토콜 읽기 권한을 준다(lib.rs).
pub fn cache_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|d| d.join("thumbnails"))
        .map_err(|e| format!("캐시 디렉터리를 찾을 수 없습니다: {e}"))
}

/// 사진 한 장의 썸네일 경로를 돌려준다. 없으면 만들고, 있으면 그대로 쓴다.
///
/// 실패는 프론트엔드에서 원본 폴백으로 처리한다(photo-thumbnail.ts) — svg처럼 래스터가
/// 아닌 것, 확장자와 내용이 다른 것, 상한을 넘는 것이 모두 여기로 떨어진다.
#[tauri::command]
pub async fn photo_thumbnail(
    path: String,
    max_px: u32,
    app: tauri::AppHandle,
    semaphore: tauri::State<'_, ThumbnailSemaphore>,
) -> Result<String, String> {
    crate::fs::validate_path(&path).map_err(|e| e.to_string())?;
    // 원본은 사용자 사진이다 — 다른 IPC 읽기와 **같은** 규칙을 받아야 한다. 이 명령이
    // 임의 절대 경로를 받으면 "썸네일"이 vault 밖 파일의 존재와 내용을 흘리는 통로가 된다.
    crate::commands::fs_cmd::ensure_path_in_vault(&app, &path).await?;

    let cache = cache_dir(&app)?;
    let _permit = semaphore.0.acquire().await.map_err(|e| e.to_string())?;

    let started = std::time::Instant::now();
    let logged_path = path.clone();
    let result = tokio::task::spawn_blocking(move || {
        crate::thumbnail::ensure_thumbnail(std::path::Path::new(&path), &cache, max_px)
    })
    .await
    .map_err(|e| e.to_string())?;

    // ‼️ 실패를 반드시 로그에 남긴다. 프론트엔드는 실패하면 원본으로 폴백하는데(그게 유일하게
    // 합리적인 폴백이다) 그 화면은 **수정 전과 똑같다** — 로그가 없으면 "안 고쳐졌다"와
    // "고친 경로를 한 번도 못 탔다"가 화면상 구별되지 않는다.
    match result {
        Ok(out) => {
            // 성공은 **새로 만든 것만** Info로 남긴다(로그 정책의 우리 레벨이 Info다).
            // 캐시 히트는 파일 존재 확인 한 번이라 1ms도 안 걸리므로, 이 문턱을 넘은 것은
            // 곧 디코드를 한 것이다 — 캐시 히트까지 남기면 세션마다 사진 수만큼 줄이 쌓인다.
            let ms = started.elapsed().as_millis();
            if ms >= 50 {
                log::info!("§56d thumbnail generated in {ms}ms ({max_px}px): {logged_path}");
            }
            Ok(out.to_string_lossy().to_string())
        }
        Err(e) => {
            log::warn!("§56d thumbnail FAILED for {logged_path}: {e}");
            Err(e.to_string())
        }
    }
}
