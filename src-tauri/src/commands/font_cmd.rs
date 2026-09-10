// §350 시스템 폰트 열거 — IPC 커맨드 (thin layer)

use tauri::State;

use crate::font::{FontCache, FontFamily};

/// 설치된 서체 패밀리 목록. 경로 인자를 받지 않으므로 승인 게이트 대상이 아니다.
///
/// 캐시 락을 "확인 → 계산 → 저장" 전체 구간 동안 쥔다(리뷰 Important #1) — 캐시가 빈
/// 동안 동시에 두 호출이 들어와도 계산은 한 번만 돈다. 두 번째 호출자는 첫 번째가 다 쓸
/// 때까지 기다렸다가 캐시를 읽는다. `enumerate_faces`+`aggregate` 는 ~250-270ms 짜리
/// 동기 I/O 라 `spawn_blocking` 으로 돌린다(리뷰 Important #2) — 그러지 않으면 그 시간
/// 동안 Tokio 워커 스레드 하나가 막혀 다른 IPC 커맨드를 굶길 수 있다.
#[tauri::command]
pub async fn font_list(
    refresh: bool,
    cache: State<'_, FontCache>,
) -> Result<Vec<FontFamily>, String> {
    let mut guard = cache.0.lock().await;
    if refresh {
        guard.take();
    }
    if let Some(cached) = guard.as_ref() {
        return Ok(cached.clone());
    }
    let families =
        tokio::task::spawn_blocking(|| crate::font::aggregate(crate::font::enumerate_faces()))
            .await
            .map_err(|e| e.to_string())?;
    *guard = Some(families.clone());
    Ok(families)
}
