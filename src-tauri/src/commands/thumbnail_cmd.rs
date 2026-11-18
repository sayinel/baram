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

/// 썸네일러가 경로를 **권한** 때문에 거절했을 때 돌려주는 값 — 지금 열린 context 어느 것도 이
/// 파일을 읽게 해 주지 않는다(`authorize_source`).
///
/// ‼️ `src/ipc/thumbnail-errors.ts` 의 리터럴과 한 글자도 다르면 안 된다 —
/// `src/ipc/__tests__/thumbnail-error-codes.test.ts` 가 이 파일을 경로로 읽어 대조한다(옮기면 그
/// 경로도 함께). 프런트엔드는 이 값을 받은 거절을 **기억하지 않는다**: 파일에 대한 답이 아니라 지금
/// 열린 context 에 대한 답이라, 사용자가 그 폴더를 열면 답이 바뀐다. 둘이 어긋나면 이 거절이 디코드
/// 실패처럼 캐시에서 밀려나기 전까지 남아, 폴더를 연 뒤에도 프리뷰 대신 원본을 그린다.
pub const THUMBNAIL_NOT_AUTHORIZED: &str = "THUMBNAIL_NOT_AUTHORIZED";

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
pub fn cache_dir<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|d| d.join("thumbnails"))
        .map_err(|e| format!("캐시 디렉터리를 찾을 수 없습니다: {e}"))
}

/// 썸네일러가 `path` 를 읽어도 되는가. 거절이면 `THUMBNAIL_NOT_AUTHORIZED`.
///
/// 원본은 사용자 사진이다 — 이 명령이 임의 절대 경로를 받으면 "썸네일"이 열린 context 밖 파일의
/// 존재와 내용을 흘리는 통로가 된다. 그래서 받는 것은 둘의 합집합뿐이다:
///
/// 1. `read_file` 과 같은 FS 가드(`fs_cmd::ensure_path_in_vault`).
/// 2. 지금 등록된 context 의 asset 부여 범위 안이고(`asset_grant::under_a_registered_grant`),
///    tauri 의 asset scope 도 내주는 파일(`asset_protocol_scope().is_allowed`).
///
/// 2가 있는 이유: 썸네일은 원본을 **대신해** 그리는 것이고 원본은 asset:// 으로 보인다. context
/// 타입 셋 가운데 asset 부여가 FS 가드보다 넓은 것은 `File` 하나다 — FS 가드는 그 .md 만 받고 asset
/// 부여는 그 폴더 아래를 연다(§329.2, §330 결정 3 이 좁히지 않기로 했다. Unix 에서는 tauri 가 숨김
/// 경로를 내주지 않는다). `Vault` · `Folder` 는 둘 다 자기 폴더이고, FS 가드가 숨김 경로까지 받으므로
/// asset 부여와 같거나(Windows) 넓다(Unix). 1만 보던 때는 단일 파일 모드(§89)에서 연
/// 노트 옆의 이미지마다 썸네일이 거절되어, 프런트엔드가 원본으로 폴백하고 에디터 본문이 원본을
/// 통째로 디코드했다(§3.3).
///
/// 2가 새로 드러내는 내용은 없다: 그 둘째 조건은 프런트엔드가 원본을 `convertFileSrc(같은 경로)` 로
/// 요청할 때 asset 프로토콜이 묻는 질문 그대로다(tauri `protocol/asset.rs`). 받아들이는 파일은 웹뷰가
/// 이미 바이트 전체를 읽을 수 있는 파일이다. 늘어나는 것은 사용자가 직접 고르지 않은 그 폴더의
/// 일반 파일을 Rust 디코더가 연다는 것(`thumbnail::ensure_thumbnail` 이 일반 파일만 받고,
/// `MAX_SOURCE_PIXELS` · `MAX_DECODE_ALLOC` 와 동시 `MAX_CONCURRENT_THUMBNAILS` 상한 아래)과 앱 캐시에
/// 쓰는 썸네일 파일이다.
///
/// ‼️ 2의 두 조건 중 어느 것도 빼지 말 것:
/// - `is_allowed` 만 보면: tauri 의 scope 는 회수되지 않아(§335) 닫은 context 의 폴더와
///   `$APPDATA/**` · 플러그인 폴더에도 예라고 답한다.
/// - context 판정만 보면: 그 판정은 context 경로를 **지금** 다시 풀고, tauri 는 부여할 때 푼 경로를
///   쥐고 있다. 등록 뒤 경로 속 symlink 의 대상이 바뀌면 asset:// 이 내주지 않는 폴더를 받게 된다.
///   부여가 실패해 경고만 남은 context(`register_asset_scope`)도 같다.
async fn authorize_source<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    path: &str,
) -> Result<(), String> {
    use tauri::Manager;
    if crate::commands::fs_cmd::ensure_path_in_vault(app, path)
        .await
        .is_ok()
    {
        return Ok(());
    }
    let contexts = app.state::<crate::context::ContextManager>();
    if crate::context::asset_grant::under_a_registered_grant(&contexts, path).await
        && app.asset_protocol_scope().is_allowed(path)
    {
        return Ok(());
    }
    Err(THUMBNAIL_NOT_AUTHORIZED.to_string())
}

/// 사진 한 장의 썸네일 경로를 돌려준다. 없으면 만들고, 있으면 그대로 쓴다.
///
/// 실패는 프론트엔드에서 원본 폴백으로 처리한다(photo-thumbnail.ts) — svg처럼 래스터가
/// 아닌 것, 확장자와 내용이 다른 것, 상한을 넘는 것이 모두 여기로 떨어진다.
#[tauri::command]
pub async fn photo_thumbnail<R: tauri::Runtime>(
    path: String,
    max_px: u32,
    app: tauri::AppHandle<R>,
    semaphore: tauri::State<'_, ThumbnailSemaphore>,
) -> Result<String, String> {
    crate::fs::validate_path(&path).map_err(|e| e.to_string())?;
    authorize_source(&app, &path).await?;

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

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use tauri::Manager;
    use tempfile::TempDir;

    use super::{photo_thumbnail, ThumbnailSemaphore, THUMBNAIL_NOT_AUTHORIZED};
    use crate::context::{ContextInfo, ContextManager, ContextType};

    /// A mock-runtime app carrying the states `photo_thumbnail` reads.
    fn app_with_states() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(crate::VaultRootState(tokio::sync::RwLock::new(None)));
        app.manage(ContextManager::new());
        app.manage(ThumbnailSemaphore::new());
        app
    }

    fn context(context_type: ContextType, path: &Path) -> ContextInfo {
        ContextInfo {
            id: "ctx-thumb".to_string(),
            context_type,
            path: path.to_string_lossy().to_string(),
            label: "test".to_string(),
            color: "#000000".to_string(),
            alias: None,
            vault_type: None,
            added_at: 0,
        }
    }

    /// A 4x4 PNG. It already fits the requested size, so `ensure_thumbnail` hands back the
    /// source path (`scale_if_needed` → `None`) and writes nothing — the mock app's cache
    /// directory is never created.
    fn tiny_png(path: &Path) -> PathBuf {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        image::RgbImage::new(4, 4).save(path).unwrap();
        path.to_path_buf()
    }

    async fn thumbnail(
        app: &tauri::App<tauri::test::MockRuntime>,
        path: &Path,
    ) -> Result<String, String> {
        photo_thumbnail(
            path.to_string_lossy().to_string(),
            2048,
            app.handle().clone(),
            app.state::<ThumbnailSemaphore>(),
        )
        .await
    }

    /// `dir/note.md` opened on its own (§89), registered and granted the way `add_context`
    /// does it: the context first, then its asset scope (`register_asset_scope`).
    async fn file_context(app: &tauri::App<tauri::test::MockRuntime>, dir: &Path) -> String {
        let added = file_context_without_its_grant(app, dir).await;
        crate::commands::context_cmd::register_asset_scope(app.handle(), &added);
        added.id
    }

    /// The context alone — what an `add_context` leaves when `register_asset_scope` only logged
    /// a failed grant.
    async fn file_context_without_its_grant(
        app: &tauri::App<tauri::test::MockRuntime>,
        dir: &Path,
    ) -> ContextInfo {
        let note = dir.join("note.md");
        std::fs::write(&note, "![](assets/photo.png)").unwrap();
        app.state::<ContextManager>()
            .add(context(ContextType::File, &note))
            .await
            .unwrap()
    }

    /// ‼️ This and the next test are a PAIR: the first fails while the thumbnailer reads only
    /// the FS guard (it admits the note itself, not its folder), the second fails if the
    /// thumbnailer stops guarding at all.
    #[tokio::test]
    async fn an_image_in_a_file_contexts_folder_gets_a_preview() {
        let app = app_with_states();
        let dir = TempDir::new().unwrap();
        file_context(&app, dir.path()).await;
        let sibling = tiny_png(&dir.path().join("photo.png"));
        let below = tiny_png(&dir.path().join("assets/photo.png"));

        assert_eq!(
            thumbnail(&app, &sibling).await,
            Ok(sibling.to_string_lossy().to_string())
        );
        assert_eq!(
            thumbnail(&app, &below).await,
            Ok(below.to_string_lossy().to_string())
        );
    }

    #[tokio::test]
    async fn an_image_outside_a_file_contexts_folder_is_refused() {
        let app = app_with_states();
        let parent = TempDir::new().unwrap();
        let dir = parent.path().join("notes");
        std::fs::create_dir_all(&dir).unwrap();
        file_context(&app, &dir).await;
        let beside = tiny_png(&parent.path().join("photo.png"));

        assert_eq!(
            thumbnail(&app, &beside).await,
            Err(THUMBNAIL_NOT_AUTHORIZED.to_string())
        );
    }

    /// tauri's asset scope does not serve a dot component below a granted folder on unix (its
    /// default `require_literal_leading_dot`), so neither may the thumbnailer — opening
    /// `~/note.md` must not let it decode `~/.config/…`. The context check covers these paths
    /// (`asset_grant`'s tests), so this fails if `authorize_source` stops asking tauri.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_hidden_path_in_a_file_contexts_folder_is_refused() {
        let app = app_with_states();
        let dir = TempDir::new().unwrap();
        file_context(&app, dir.path()).await;
        let hidden_dir = tiny_png(&dir.path().join(".private/photo.png"));
        let hidden_file = tiny_png(&dir.path().join(".photo.png"));

        for path in [hidden_dir, hidden_file] {
            assert_eq!(
                thumbnail(&app, &path).await,
                Err(THUMBNAIL_NOT_AUTHORIZED.to_string()),
                "{}",
                path.display()
            );
        }
    }

    /// The context check says yes, tauri says no: a context whose asset grant failed shows
    /// nothing of its folder, so its folder gets no previews either. Fails on every platform
    /// if `authorize_source` stops asking tauri.
    #[tokio::test]
    async fn a_file_context_without_its_asset_grant_gives_its_folder_no_previews() {
        let app = app_with_states();
        let dir = TempDir::new().unwrap();
        file_context_without_its_grant(&app, dir.path()).await;
        let photo = tiny_png(&dir.path().join("photo.png"));

        assert_eq!(
            thumbnail(&app, &photo).await,
            Err(THUMBNAIL_NOT_AUTHORIZED.to_string())
        );
    }

    /// tauri says yes, the context check says no: tauri keeps the folder after the context
    /// closes (§335), and the first assertion after the close shows that it does. Fails if
    /// `authorize_source` asks only tauri.
    #[tokio::test]
    async fn closing_the_file_context_closes_its_folder_at_once() {
        let app = app_with_states();
        let dir = TempDir::new().unwrap();
        let id = file_context(&app, dir.path()).await;
        let photo = tiny_png(&dir.path().join("photo.png"));
        assert!(thumbnail(&app, &photo).await.is_ok());

        app.state::<ContextManager>().remove(&id).await.unwrap();

        assert!(app.asset_protocol_scope().is_allowed(&photo));
        assert_eq!(
            thumbnail(&app, &photo).await,
            Err(THUMBNAIL_NOT_AUTHORIZED.to_string())
        );
    }

    /// A symlink in the folder that leads out of it is refused by both halves of the second
    /// branch: the context check resolves the link before comparing, and tauri's `is_allowed`
    /// resolves it too. Fails only if both compare the path as written.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_symlink_in_a_file_contexts_folder_that_leads_out_is_refused() {
        let app = app_with_states();
        let dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        file_context(&app, dir.path()).await;
        let target = tiny_png(&outside.path().join("photo.png"));
        let link = dir.path().join("link.png");
        std::os::unix::fs::symlink(&target, &link).unwrap();

        assert_eq!(
            thumbnail(&app, &link).await,
            Err(THUMBNAIL_NOT_AUTHORIZED.to_string())
        );
    }

    #[tokio::test]
    async fn with_no_context_open_every_path_is_refused() {
        let app = app_with_states();
        let dir = TempDir::new().unwrap();
        let photo = tiny_png(&dir.path().join("photo.png"));

        assert_eq!(
            thumbnail(&app, &photo).await,
            Err(THUMBNAIL_NOT_AUTHORIZED.to_string())
        );
    }

    /// The FS guard still admits what it admitted: a folder context's files, hidden ones
    /// included (the asset grant alone would refuse `.hidden/`). Fails if the asset-grant
    /// check replaces the FS guard instead of joining it.
    #[tokio::test]
    async fn a_folder_contexts_images_keep_their_previews() {
        let app = app_with_states();
        let dir = TempDir::new().unwrap();
        app.state::<ContextManager>()
            .add(context(ContextType::Folder, dir.path()))
            .await
            .unwrap();
        let photo = tiny_png(&dir.path().join("photo.png"));
        let hidden = tiny_png(&dir.path().join(".hidden/photo.png"));

        for path in [photo, hidden] {
            assert_eq!(
                thumbnail(&app, &path).await,
                Ok(path.to_string_lossy().to_string())
            );
        }
    }

    /// The command changed its signature (generic over the runtime), so go through the real
    /// IPC dispatcher as `lib.rs` registers it. An unknown command or an argument that failed
    /// to deserialize would carry a different message than the code this pins.
    #[test]
    fn is_dispatchable_by_name_through_generate_handler() {
        let app = tauri::test::mock_builder()
            .invoke_handler(tauri::generate_handler![super::photo_thumbnail])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app must build");
        app.manage(crate::VaultRootState(tokio::sync::RwLock::new(None)));
        app.manage(ContextManager::new());
        app.manage(ThumbnailSemaphore::new());
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock webview must build");

        let res = tauri::test::get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: "photo_thumbnail".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: if cfg!(any(windows, target_os = "android")) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                // Absolute on the platform running the test: `validate_path` refuses a
                // driveless path on Windows before the check this pins is reached.
                body: tauri::ipc::InvokeBody::Json(serde_json::json!({
                    "path": if cfg!(windows) {
                        r"C:\definitely\not\in\a\context\photo.png"
                    } else {
                        "/definitely/not/in/a/context/photo.png"
                    },
                    "maxPx": 2048,
                })),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        );

        let err = res.expect_err("a path no context covers must be refused");
        assert_eq!(err, serde_json::json!(THUMBNAIL_NOT_AUTHORIZED));
    }
}
