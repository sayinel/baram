// §350 시스템 폰트 열거 — IPC 커맨드 (thin layer)

use tauri::State;

use crate::font::{FontCache, FontFamily};

/// 설치된 서체 패밀리 목록. 경로 인자를 받지 않으므로 승인 게이트 대상이 아니다.
#[tauri::command]
pub async fn font_list(
    refresh: bool,
    cache: State<'_, FontCache>,
) -> Result<Vec<FontFamily>, String> {
    if refresh {
        cache.0.lock().map_err(|e| e.to_string())?.take();
    }
    {
        let guard = cache.0.lock().map_err(|e| e.to_string())?;
        if let Some(cached) = guard.as_ref() {
            return Ok(cached.clone());
        }
    }
    let families = crate::font::aggregate(crate::font::enumerate_faces());
    let mut guard = cache.0.lock().map_err(|e| e.to_string())?;
    *guard = Some(families.clone());
    Ok(families)
}
