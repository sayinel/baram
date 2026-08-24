// §56d Photo Gallery 썸네일 IPC 커맨드 (thin layer — 로직은 crate::thumbnail)

use tauri::Manager;

/// 동시에 도는 썸네일 생성 수. 생성 한 건이 원본 하나를 통째로 디코드하므로(파노라마면
/// ~600MB) 이 숫자가 곧 순간 최대 메모리다. 첫 스캔은 사진 수만큼 한 번만 돌고 그 뒤로는
/// 캐시 히트라 처리량보다 최대치를 눌러 두는 편이 맞다.
const MAX_CONCURRENT_THUMBNAILS: usize = 2;

/// 이보다 오래 걸린 생성만 로그에 남고, 그것도 **세션당 한 줄**이다(SLOW_REPORTED).
///
/// 한때 1000ms였고 그건 잘못된 계산이었다. 실측 177장의 생성 시간이 release 평균 142ms
/// (최장 2371ms)인 데 반해 dev는 평균 453ms(최장 5703ms)라, release 기준으로 고른 문턱이
/// **정작 매일 쓰는 dev에서는 평범한 큰 사진마다** 걸렸다. 2000ms는 dev에서도 파노라마급만
/// 넘는 값이다.
///
/// 그래도 한 줄은 남기는 이유: 사용자가 "갤러리가 느리다"고 할 때 우리가 가진 유일한 증거가
/// 그 로그다. cargo 벤치를 돌려 달라고 할 수는 없다. 존재를 알리는 것이 목적이므로 한 줄로
/// 족하고, 그 뒤로는 Debug로 내려간다.
const SLOW_THUMBNAIL_MS: u128 = 2000;

/// 위 문턱을 넘은 것을 이 세션에서 이미 보고했는가. 개수를 세는 것이 아니라 **있음/없음**만
/// 알리므로 Relaxed로 충분하다.
static SLOW_REPORTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

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
            // ‼️ 평범한 생성은 Debug다 — 우리 레벨이 Info이므로 기본적으로 나오지 않는다.
            //
            // 한때 이것이 Info였다. 그때는 ACL이 모든 호출을 거부하고 있었고, 프론트엔드가
            // 원본으로 조용히 폴백해서 화면만으로는 "고쳐지지 않았다"와 "그 경로를 한 번도
            // 안 탔다"를 구분할 수 없었다. 그 진단이 끝난 뒤로는 사진 수만큼(첫 조회에 177줄)
            // 쌓이는 잡음일 뿐이다. 타깃이 LogDir + Stdout이라 터미널과 로그 파일 양쪽에 남는다.
            //
            // 타이밍을 다시 재고 싶으면 레벨을 올리는 것보다 벤치가 낫다:
            // `BARAM_THUMB_BENCH_DIR=… cargo test --lib thumbnail -- --ignored`.
            let ms = started.elapsed().as_millis();
            let first_slow_of_the_session = ms >= SLOW_THUMBNAIL_MS
                && !SLOW_REPORTED.swap(true, std::sync::atomic::Ordering::Relaxed);
            if first_slow_of_the_session {
                log::info!("§56d slow thumbnail: {ms}ms ({max_px}px) for {logged_path}");
            } else {
                log::debug!("§56d thumbnail in {ms}ms ({max_px}px): {logged_path}");
            }
            Ok(out.to_string_lossy().to_string())
        }
        Err(e) => {
            log::warn!("§56d thumbnail FAILED for {logged_path}: {e}");
            Err(e.to_string())
        }
    }
}
