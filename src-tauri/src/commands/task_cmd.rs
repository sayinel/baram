// §304 Vault-wide task index — IPC command (thin layer)

#[tauri::command]
pub async fn get_vault_tasks(
    root_path: String,
    exclude: Vec<String>,
) -> Result<Vec<crate::task::TaskEntry>, String> {
    crate::task::get_vault_tasks(&root_path, &exclude)
        .await
        .map_err(|e| e.to_string())
}

/// `root_path`/`exclude`는 §304 vault 전체 스캔과 같은 제외 규칙을 워처 기반
/// 증분 갱신에도 적용하기 위한 것이다(I1) — 생략하면(None) 걸러지지 않는다.
#[tauri::command]
pub async fn get_file_tasks(
    path: String,
    root_path: Option<String>,
    exclude: Vec<String>,
) -> Result<Vec<crate::task::TaskEntry>, String> {
    crate::task::get_file_tasks(&path, root_path.as_deref(), &exclude)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_tasks_linking_to(
    root_path: String,
    target: String,
    exclude: Vec<String>,
) -> Result<Vec<crate::task::TaskEntry>, String> {
    crate::task::get_tasks_linking_to(&root_path, &target, &exclude)
        .await
        .map_err(|e| e.to_string())
}

/// `today`는 프론트가 로컬 시간대로 계산해 넘긴다 — Rust가 시간대를 추측하지 않는다.
#[tauri::command]
pub async fn set_task_state(
    path: String,
    line: u32,
    expected_raw: String,
    new_state: String,
    record_done_date: bool,
    today: String,
) -> Result<String, String> {
    let state = match new_state.as_str() {
        "done" => crate::task::TaskState::Done,
        "todo" => crate::task::TaskState::Todo,
        other => return Err(format!("unknown state: {}", other)),
    };
    crate::task::set_task_state(&path, line, &expected_raw, state, record_done_date, &today)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_task_field(
    path: String,
    line: u32,
    expected_raw: String,
    field: String,
    value: String,
) -> Result<String, String> {
    crate::task::set_task_field(&path, line, &expected_raw, &field, &value)
        .await
        .map_err(|e| e.to_string())
}

/// §305 열린 파일 경로 — 디스크를 건드리지 않고 상태 전이 결과 줄만 돌려준다.
/// 프론트가 이 줄을 `useFileStore.openFiles`의 문자열에 갈아끼운다.
#[tauri::command]
pub fn preview_task_state_line(
    raw: String,
    new_state: String,
    record_done_date: bool,
    today: String,
) -> Result<String, String> {
    let state = match new_state.as_str() {
        "done" => crate::task::TaskState::Done,
        "todo" => crate::task::TaskState::Todo,
        other => return Err(format!("unknown state: {}", other)),
    };
    // `replace_line`이 transform에 정규화된 줄을 넘기므로(write.rs) 여기서도 같아야
    // 디스크 경로와 열린 파일 경로의 결과가 바이트 단위로 일치한다.
    Ok(crate::task::apply_state(
        &crate::task::normalize_line(&raw),
        state,
        record_done_date,
        &today,
    ))
}

/// §305 열린 파일 경로 — 필드 설정 결과 줄. 빈 `value`는 필드 제거.
#[tauri::command]
pub fn preview_task_field_line(
    raw: String,
    field: String,
    value: String,
) -> Result<String, String> {
    crate::task::apply_field(&crate::task::normalize_line(&raw), &field, &value)
        .ok_or_else(|| format!("unknown field: {}", field))
}
