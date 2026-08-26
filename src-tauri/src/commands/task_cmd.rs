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

/// §312 태그 쓰기 — §303 canonical 순서상 태그는 이모지 필드 **앞**이다.
/// `on=false`는 제거. 쓸 수 없는 태그 이름은 파일을 건드리기 전에 거절한다.
#[tauri::command]
pub async fn set_task_tag(
    path: String,
    line: u32,
    expected_raw: String,
    tag: String,
    on: bool,
) -> Result<String, String> {
    crate::task::set_task_tag(&path, line, &expected_raw, &tag, on)
        .await
        .map_err(|e| e.to_string())
}

/// §305 열린 파일 경로 — 태그 토글 결과 줄.
///
/// ‼️ `normalize_line`은 여기서도 필수다. 빼면 NBSP가 남고 이형태 선택자가 붙은
/// 📅를 필드로 알아보지 못해 태그가 필드 **뒤**로 가 디스크 경로와 갈린다.
#[tauri::command]
pub fn preview_task_tag_line(raw: String, tag: String, on: bool) -> Result<String, String> {
    crate::task::apply_tag(&crate::task::normalize_line(&raw), &tag, on)
        .ok_or_else(|| format!("invalid tag: {}", tag))
}

/// §312 수집함 append — 파일이 없으면 만들고 끝에 한 줄 붙인다.
#[tauri::command]
pub async fn append_task_line(path: String, line: String) -> Result<String, String> {
    crate::task::append_line(&path, &line)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    async fn write_temp(d: &TempDir, body: &str) -> String {
        let p = d.path().join("a.md");
        tokio::fs::write(&p, body).await.unwrap();
        p.to_string_lossy().to_string()
    }

    // §305 이 설계 전체가 서 있는 불변식: 디스크 경로(`set_task_state`/`set_task_field`)와
    // 열린 문서 경로(`preview_*_line`)가 **같은 바이트**를 낸다. 성립하는 유일한 이유는
    // 양쪽 모두 변환 전에 `normalize_line`을 거치기 때문이다 — 커맨드에서 그 호출을
    // 빼면 아래 두 테스트가 깨져야 한다. 정규화된 입력만 넣는 `write.rs`의 단위
    // 테스트는 이 차이를 볼 수 없다.

    #[tokio::test]
    async fn disk_and_preview_state_paths_agree_byte_for_byte_on_a_non_breaking_space() {
        // NBSP(U+00A0)는 파일에는 그대로 있지만 인덱스의 raw와 변환 결과에서는
        // 보통 공백이어야 한다. 문서 경로가 정규화를 건너뛰면 디스크에는
        // "회의 준비"가, 열린 문서에는 "회의\u{00A0}준비"가 남아 두 진실원이 갈린다.
        let raw = "- [ ] 회의\u{00A0}준비";
        let d = TempDir::new().unwrap();
        let p = write_temp(&d, &format!("{}\n", raw)).await;

        let disk = set_task_state(
            p,
            0,
            raw.to_string(),
            "done".to_string(),
            true,
            "2026-08-24".to_string(),
        )
        .await
        .unwrap();
        let document = preview_task_state_line(
            raw.to_string(),
            "done".to_string(),
            true,
            "2026-08-24".to_string(),
        )
        .unwrap();

        assert_eq!(disk, document);
        assert_eq!(disk, "- [x] 회의 준비 ✅2026-08-24");
    }

    #[tokio::test]
    async fn disk_and_preview_field_paths_agree_byte_for_byte_on_a_variation_selector() {
        // 이모지 뒤의 이형태 선택자(U+FE0F)는 `find_field_span`이 값의 시작으로
        // 오인하는 자리에 놓인다 — 정규화가 빠지면 기존 📅를 필드로 알아보지 못해
        // 지우지 못하고, 한 줄에 모순되는 기한 두 개(옛것 + 새것)를 남긴다.
        let raw = "- [ ] 회의 📅\u{FE0F}2026-08-20";
        let d = TempDir::new().unwrap();
        let p = write_temp(&d, &format!("{}\n", raw)).await;

        let disk = set_task_field(
            p,
            0,
            raw.to_string(),
            "due".to_string(),
            "2026-08-24".to_string(),
        )
        .await
        .unwrap();
        let document =
            preview_task_field_line(raw.to_string(), "due".to_string(), "2026-08-24".to_string())
                .unwrap();

        assert_eq!(disk, document);
        assert_eq!(disk, "- [ ] 회의 📅2026-08-24");
    }

    // §312 태그 쓰기도 같은 불변식 아래 있다. 태그는 **필드 앞**에 들어가므로
    // 정규화를 빼면 위치까지 갈린다 — 값만 갈리는 필드 경로보다 눈에 띄게 어긋난다.

    #[tokio::test]
    async fn disk_and_preview_tag_paths_agree_byte_for_byte_on_a_non_breaking_space() {
        let raw = "- [ ] 회의\u{00A0}준비 📅2026-08-30";
        let d = TempDir::new().unwrap();
        let p = write_temp(&d, &format!("{}\n", raw)).await;

        let disk = set_task_tag(p, 0, raw.to_string(), "someday".to_string(), true)
            .await
            .unwrap();
        let document = preview_task_tag_line(raw.to_string(), "someday".to_string(), true).unwrap();

        assert_eq!(disk, document);
        assert_eq!(disk, "- [ ] 회의 준비 #someday 📅2026-08-30");
    }

    #[tokio::test]
    async fn disk_and_preview_tag_paths_agree_byte_for_byte_on_a_variation_selector() {
        // 정규화가 빠지면 `📅\u{FE0F}2026-08-30`을 필드로 알아보지 못해 태그가 줄 끝으로
        // 밀려난다 — §303 순서를 어긴 줄이 문서 경로에서만 만들어진다.
        let raw = "- [ ] 회의 📅\u{FE0F}2026-08-30";
        let d = TempDir::new().unwrap();
        let p = write_temp(&d, &format!("{}\n", raw)).await;

        let disk = set_task_tag(p, 0, raw.to_string(), "someday".to_string(), true)
            .await
            .unwrap();
        let document = preview_task_tag_line(raw.to_string(), "someday".to_string(), true).unwrap();

        assert_eq!(disk, document);
        assert_eq!(disk, "- [ ] 회의 #someday 📅2026-08-30");
    }

    #[tokio::test]
    async fn tag_removal_agrees_across_both_paths_on_a_nested_item() {
        let raw = "    - [ ] 중첩 #someday 📅2026-08-30";
        let d = TempDir::new().unwrap();
        let p = write_temp(&d, &format!("{}\n", raw)).await;

        let disk = set_task_tag(p, 0, raw.to_string(), "someday".to_string(), false)
            .await
            .unwrap();
        let document =
            preview_task_tag_line(raw.to_string(), "someday".to_string(), false).unwrap();

        assert_eq!(disk, document);
        assert_eq!(disk, "    - [ ] 중첩 📅2026-08-30");
    }

    /// 파일 수준 속성(줄바꿈 스타일·끝 개행)은 preview가 볼 수 없는 절반이다 —
    /// 디스크 경로가 그것을 보존하지 못하면 같은 줄을 내고도 파일이 망가진다.
    #[tokio::test]
    async fn writing_a_tag_preserves_crlf_and_a_missing_trailing_newline() {
        let d = TempDir::new().unwrap();
        let raw = "    - [ ] 중첩 📅2026-08-30";
        let p = write_temp(&d, &format!("# T\r\n{}", raw)).await;

        let updated = set_task_tag(p.clone(), 1, raw.to_string(), "someday".to_string(), true)
            .await
            .unwrap();

        assert_eq!(updated, "    - [ ] 중첩 #someday 📅2026-08-30");
        assert_eq!(
            tokio::fs::read_to_string(&p).await.unwrap(),
            "# T\r\n    - [ ] 중첩 #someday 📅2026-08-30"
        );
    }
}
