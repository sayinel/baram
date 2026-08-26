// §305 낙관적 잠금 쓰기 — expected_raw가 일치할 때만 그 줄을 고친다.
use crate::task::parse::is_valid_date;
use crate::task::{normalize_line, TaskError, TaskState};

pub(super) const FIELD_EMOJI: &[(&str, &str)] = &[
    ("created", "➕"),
    ("start", "🛫"),
    ("scheduled", "⏳"),
    ("due", "📅"),
    ("done", "✅"),
    ("cancelled", "❌"),
];

/// 줄바꿈 스타일과 마지막 개행 유무를 보존하며 한 줄만 바꾼다.
pub(super) async fn replace_line<F>(
    path: &str,
    line: u32,
    expected_raw: &str,
    transform: F,
) -> Result<String, TaskError>
where
    F: FnOnce(&str) -> String,
{
    let content = tokio::fs::read_to_string(path).await?;
    let newline = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let ends_with_newline = content.ends_with(newline);

    let mut lines: Vec<String> = content.split(newline).map(|s| s.to_string()).collect();
    // split은 끝 개행 뒤의 빈 조각을 남긴다 — 재조립 때 되살릴 것이므로 떼어 둔다.
    if ends_with_newline {
        lines.pop();
    }

    let idx = line as usize;
    let current = lines.get(idx).ok_or(TaskError::Stale)?;
    if normalize_line(current).trim_end() != normalize_line(expected_raw).trim_end() {
        return Err(TaskError::Stale);
    }

    let updated = transform(&normalize_line(current));
    lines[idx] = updated.clone();

    let mut out = lines.join(newline);
    if ends_with_newline {
        out.push_str(newline);
    }
    // §3.6 원자적 쓰기(tmp → rename) — 직접 tokio::fs::write를 쓰면 중간에 죽었을 때
    // 낙관적 잠금이 막으려던 것과 같은 부류의 손상(반쯤 쓰인 파일)을 자초한다.
    crate::fs::write_file(path, &out)
        .await
        .map_err(|e| TaskError::Custom(e.to_string()))?;
    Ok(updated)
}

/// `line`에서 `emoji` 뒤에 유효한 10자 ISO 날짜가 오는 **마지막** 위치를 찾는다.
/// 그런 위치가 없으면(본문에 등장하는 장식용 이모지뿐이면) `None` — 해당 필드는 "없음"으로 취급한다.
/// 반환값은 (이모지 시작 바이트 오프셋, 값 끝 바이트 오프셋) — 항상 문자 경계.
fn find_field_span(line: &str, emoji: &str) -> Option<(usize, usize)> {
    let mut found = None;
    let mut search_from = 0;
    while let Some(rel) = line[search_from..].find(emoji) {
        let pos = search_from + rel;
        let after = &line[pos + emoji.len()..];
        let skipped = after.len() - after.trim_start().len();
        let value_start = pos + emoji.len() + skipped;
        // 문자 수 기준으로 10번째 문자의 바이트 경계를 찾는다 — 바이트 길이로 착각하면
        // 멀티바이트 문자(한글 등) 중간을 잘라 panic("char boundary")로 이어진다.
        let value_end = line[value_start..]
            .char_indices()
            .nth(10)
            .map(|(i, _)| value_start + i)
            .unwrap_or(line.len());
        if is_valid_date(&line[value_start..value_end]) {
            // 정규 포맷은 필드를 줄 끝에 모아 두므로, 여러 곳이 조건을 만족하면 마지막
            // 것이 "진짜" 필드다 — 그 앞의 동일 이모지는 본문에 등장한 장식일 뿐이다.
            found = Some((pos, value_end));
        }
        search_from = pos + emoji.len();
    }
    found
}

/// 유효한 날짜값을 동반한 마지막 `field` 이모지만 제거한다. 그런 이모지가 없으면(본문에만
/// 등장하면) 아무것도 건드리지 않는다. 제거 범위 **주변**의 공백 하나만 흡수해 중복 공백을
/// 막을 뿐, 줄 전체를 재정규화하지 않는다 — 그래야 하위 항목의 들여쓰기가 살아남는다.
fn strip_field(line: &str, field: &str) -> String {
    let Some((_, emoji)) = FIELD_EMOJI.iter().find(|(f, _)| *f == field) else {
        return line.to_string();
    };
    let Some((mut start, end)) = find_field_span(line, emoji) else {
        return line.to_string();
    };
    if start > 0 && line.as_bytes()[start - 1] == b' ' {
        // 필드 앞의 구분 공백 하나만 함께 지운다 — 남은 텍스트 사이의 공백은 이미
        // 필드 뒤쪽이 담당하고 있으므로 양쪽을 다 지우면 오히려 붙어버린다.
        start -= 1;
    }
    let mut out = line.to_string();
    out.replace_range(start..end, "");
    out.trim_end().to_string()
}

fn append_field(line: &str, field: &str, value: &str) -> String {
    let Some((_, emoji)) = FIELD_EMOJI.iter().find(|(f, _)| *f == field) else {
        return line.to_string();
    };
    format!("{} {}{}", line.trim_end(), emoji, value)
}

/// 상태 전이 결과 줄을 만든다 — I/O 없음.
///
/// 디스크 경로(`set_task_state`)와 열린 파일 경로(`preview_task_state_line`)가
/// **같은 구현**을 쓰게 하는 것이 이 함수의 존재 이유다. TypeScript에 재구현하면
/// 두 벌이 되어 반드시 드리프트한다.
///
/// `current`는 이미 `normalize_line`을 거친 줄이어야 한다.
pub fn apply_state(
    current: &str,
    new_state: TaskState,
    record_done_date: bool,
    today: &str,
) -> String {
    let marker = match new_state {
        TaskState::Done => "[x]",
        TaskState::Todo => "[ ]",
    };
    // 가장 **왼쪽** 마커만 바꾼다 — 본문에 "[x]"가 들어 있어도 체크박스를 놓치지 않는다.
    let swapped = if let Some(p) = ["[ ]", "[x]", "[X]"]
        .iter()
        .filter_map(|pat| current.find(pat))
        .min()
    {
        let mut s = current.to_string();
        s.replace_range(p..p + 3, marker);
        s
    } else {
        current.to_string()
    };

    if !record_done_date {
        return swapped;
    }
    match new_state {
        TaskState::Done => append_field(&strip_field(&swapped, "done"), "done", today),
        TaskState::Todo => strip_field(&swapped, "done"),
    }
}

/// 필드 설정 결과 줄 — I/O 없음. 빈 `value`는 필드를 제거한다.
/// 알 수 없는 필드 이름이면 `None`.
///
/// `current`는 이미 `normalize_line`을 거친 줄이어야 한다.
pub fn apply_field(current: &str, field: &str, value: &str) -> Option<String> {
    if !FIELD_EMOJI.iter().any(|(f, _)| *f == field) {
        return None;
    }
    let stripped = strip_field(current, field);
    Some(if value.is_empty() {
        stripped
    } else {
        append_field(&stripped, field, value)
    })
}

pub async fn set_task_state(
    path: &str,
    line: u32,
    expected_raw: &str,
    new_state: TaskState,
    record_done_date: bool,
    today: &str,
) -> Result<String, TaskError> {
    let today = today.to_string();
    replace_line(path, line, expected_raw, move |current| {
        apply_state(current, new_state, record_done_date, &today)
    })
    .await
}

/// `value`가 빈 문자열이면 필드를 제거한다.
pub async fn set_task_field(
    path: &str,
    line: u32,
    expected_raw: &str,
    field: &str,
    value: &str,
) -> Result<String, TaskError> {
    // 모르는 필드명은 조용히 성공한 것처럼 보이면 안 된다 — 프론트 오타가 그대로
    // "성공"으로 보이는 것을 막는다. 파일을 건드리기 전에 걸러낸다.
    if !FIELD_EMOJI.iter().any(|(f, _)| *f == field) {
        return Err(TaskError::Custom(format!("unknown field: {}", field)));
    }
    let field = field.to_string();
    let value = value.to_string();
    replace_line(path, line, expected_raw, move |current| {
        // 위에서 이름을 이미 검증했으므로 `None`은 도달 불가다.
        apply_field(current, &field, &value).unwrap_or_else(|| current.to_string())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    async fn f(d: &TempDir, body: &str) -> String {
        let p = d.path().join("a.md");
        tokio::fs::write(&p, body).await.unwrap();
        p.to_string_lossy().to_string()
    }

    #[tokio::test]
    async fn checks_a_task_and_records_the_done_date() {
        let d = TempDir::new().unwrap();
        let p = f(&d, "# T\n- [ ] 할 일 📅2026-08-30\n").await;

        let updated = set_task_state(
            &p,
            1,
            "- [ ] 할 일 📅2026-08-30",
            TaskState::Done,
            true,
            "2026-08-23",
        )
        .await
        .unwrap();

        assert_eq!(updated, "- [x] 할 일 📅2026-08-30 ✅2026-08-23");
        let after = tokio::fs::read_to_string(&p).await.unwrap();
        assert!(after.contains("- [x] 할 일 📅2026-08-30 ✅2026-08-23"));
        assert!(after.starts_with("# T\n"));
    }

    #[tokio::test]
    async fn unchecking_removes_the_done_date() {
        let d = TempDir::new().unwrap();
        let p = f(&d, "- [x] 할 일 ✅2026-08-23\n").await;

        let updated = set_task_state(
            &p,
            0,
            "- [x] 할 일 ✅2026-08-23",
            TaskState::Todo,
            true,
            "2026-08-24",
        )
        .await
        .unwrap();

        assert_eq!(updated, "- [ ] 할 일");
    }

    #[tokio::test]
    async fn refuses_and_leaves_the_file_untouched_when_stale() {
        let d = TempDir::new().unwrap();
        let original = "- [ ] 그 사이 바뀐 줄\n";
        let p = f(&d, original).await;

        let err = set_task_state(
            &p,
            0,
            "- [ ] 예전 내용",
            TaskState::Done,
            true,
            "2026-08-23",
        )
        .await
        .unwrap_err();

        assert!(matches!(err, TaskError::Stale));
        // 가장 중요한 단언: 파일이 그대로다
        assert_eq!(tokio::fs::read_to_string(&p).await.unwrap(), original);
    }

    #[tokio::test]
    async fn refuses_when_the_line_index_is_out_of_range() {
        let d = TempDir::new().unwrap();
        let p = f(&d, "- [ ] 한 줄\n").await;

        let err = set_task_state(&p, 99, "- [ ] 한 줄", TaskState::Done, true, "2026-08-23")
            .await
            .unwrap_err();
        assert!(matches!(err, TaskError::Stale));
    }

    #[tokio::test]
    async fn preserves_crlf_line_endings() {
        let d = TempDir::new().unwrap();
        let p = f(&d, "# T\r\n- [ ] 할 일\r\n").await;

        set_task_state(&p, 1, "- [ ] 할 일", TaskState::Done, false, "2026-08-23")
            .await
            .unwrap();

        let after = tokio::fs::read_to_string(&p).await.unwrap();
        assert_eq!(after, "# T\r\n- [x] 할 일\r\n");
    }

    #[tokio::test]
    async fn mixed_eol_toggle_does_not_truncate_the_rest_of_the_file() {
        // C1: 파일이 "\r\n"을 포함하면 구분자로 "\r\n"을 고르지만, 그 판정과
        // 무관하게 파일이 bare "\n"으로 끝나기만 해도 `ends_with('\n')`이 참이
        // 됐다. split("\r\n")은 이 경우 끝에 빈 조각을 남기지 않으므로(마지막
        // 조각이 실제 나머지 두 줄을 통째로 담고 있다) pop()이 그 실제 내용을
        // 지워버렸다 — 반환값은 멀쩡해 보여도 디스크에는 2줄이 사라진 채 쓰였다.
        let d = TempDir::new().unwrap();
        let original = "- [ ] a\r\n- [ ] b\n- [ ] c\n";
        let p = f(&d, original).await;

        let updated = set_task_state(&p, 0, "- [ ] a", TaskState::Done, false, "2026-08-23")
            .await
            .unwrap();
        assert_eq!(updated, "- [x] a");

        // 가장 중요한 단언: 반환된 한 줄이 아니라 파일 전체가 온전해야 한다.
        let after = tokio::fs::read_to_string(&p).await.unwrap();
        assert_eq!(after, "- [x] a\r\n- [ ] b\n- [ ] c\n");
    }

    #[tokio::test]
    async fn preserves_a_missing_trailing_newline() {
        let d = TempDir::new().unwrap();
        let p = f(&d, "- [ ] 할 일").await;

        set_task_state(&p, 0, "- [ ] 할 일", TaskState::Done, false, "2026-08-23")
            .await
            .unwrap();

        assert_eq!(tokio::fs::read_to_string(&p).await.unwrap(), "- [x] 할 일");
    }

    #[tokio::test]
    async fn matches_expected_raw_after_normalization() {
        // 인덱스는 정규화된 raw를 들고 있고 파일에는 NBSP가 있어도 일치해야 한다
        let d = TempDir::new().unwrap();
        let p = f(&d, "- [ ] 할\u{00A0}일\n").await;

        let updated = set_task_state(&p, 0, "- [ ] 할 일", TaskState::Done, false, "2026-08-23")
            .await
            .unwrap();
        assert_eq!(updated, "- [x] 할 일");
    }

    #[tokio::test]
    async fn sets_a_due_date_on_a_task_without_one() {
        let d = TempDir::new().unwrap();
        let p = f(&d, "- [ ] 할 일\n").await;

        let updated = set_task_field(&p, 0, "- [ ] 할 일", "due", "2026-09-01")
            .await
            .unwrap();
        assert_eq!(updated, "- [ ] 할 일 📅2026-09-01");
    }

    #[tokio::test]
    async fn replaces_an_existing_due_date() {
        let d = TempDir::new().unwrap();
        let p = f(&d, "- [ ] 할 일 📅2026-08-30\n").await;

        let updated = set_task_field(&p, 0, "- [ ] 할 일 📅2026-08-30", "due", "2026-09-01")
            .await
            .unwrap();
        assert_eq!(updated, "- [ ] 할 일 📅2026-09-01");
    }

    #[tokio::test]
    async fn clears_a_field_when_the_value_is_empty() {
        let d = TempDir::new().unwrap();
        let p = f(&d, "- [ ] 할 일 📅2026-08-30\n").await;

        let updated = set_task_field(&p, 0, "- [ ] 할 일 📅2026-08-30", "due", "")
            .await
            .unwrap();
        assert_eq!(updated, "- [ ] 할 일");
    }

    // --- Fix round 1 회귀 테스트 ---

    #[tokio::test]
    async fn toggling_state_touches_the_leftmost_checkbox_marker_not_a_pattern_match_in_the_body() {
        // C2: 옛 코드는 "[ ]"를 항상 먼저 찾았다 — 실제 마커가 "[x]"이고 본문에
        // "[ ]"가 있으면 본문 쪽을 건드리고 실제 마커는 그대로 둔 채 Ok를 반환했다
        // (조용한 거짓 성공).
        let d = TempDir::new().unwrap();
        let original = "- [x] 완료: 예시로 [ ] 형식 사용\n";
        let p = f(&d, original).await;

        let updated = set_task_state(
            &p,
            0,
            "- [x] 완료: 예시로 [ ] 형식 사용",
            TaskState::Todo,
            false,
            "2026-08-23",
        )
        .await
        .unwrap();

        assert_eq!(updated, "- [ ] 완료: 예시로 [ ] 형식 사용");
    }

    #[tokio::test]
    async fn strip_field_ignores_a_decorative_emoji_and_keeps_body_text_intact() {
        // C3: 이모지 뒤에 유효한 날짜가 와야만 "필드"다. 본문 중간의 장식용 📅는
        // 절대 지우거나 그 뒤 텍스트를 갉아먹으면 안 된다 — 여러 개가 유효하면
        // 마지막(정규 포맷은 필드를 줄 끝에 모은다) 것이 진짜 필드다.
        let d = TempDir::new().unwrap();
        let original = "- [ ] 회의 📅 초대장 확인 필요 📅2026-08-30\n";
        let p = f(&d, original).await;

        let updated = set_task_field(
            &p,
            0,
            "- [ ] 회의 📅 초대장 확인 필요 📅2026-08-30",
            "due",
            "",
        )
        .await
        .unwrap();

        assert_eq!(updated, "- [ ] 회의 📅 초대장 확인 필요");
    }

    #[tokio::test]
    async fn unchecking_a_nested_task_preserves_its_indentation() {
        // C4: done 필드를 지우며 줄 전체를 split_whitespace+join으로 재조립하면
        // 하위 항목의 들여쓰기가 사라져 리스트에서 승격돼 버린다 — 실제 조작(하위
        // 완료 항목 체크 해제)에서 매번 일어나는 일이었다.
        let d = TempDir::new().unwrap();
        let original = "    - [x] 완료된 하위 항목 ✅2026-08-20\n";
        let p = f(&d, original).await;

        let updated = set_task_state(
            &p,
            0,
            "    - [x] 완료된 하위 항목 ✅2026-08-20",
            TaskState::Todo,
            true,
            "2026-08-24",
        )
        .await
        .unwrap();

        assert_eq!(updated, "    - [ ] 완료된 하위 항목");
    }

    #[tokio::test]
    async fn strip_field_does_not_panic_on_a_multibyte_value_and_leaves_it_as_a_decoration() {
        // C5: 예전 코드는 문자 수(chars().take(10).count())를 바이트 길이인 것처럼
        // replace_range에 넘겨 한글처럼 3바이트짜리 문자 중간을 잘라 panic했다.
        // 이 값은 유효한 ISO 날짜가 아니므로(C3 규칙)애초에 "필드 없음"으로 취급돼
        // 지워지지 않아야 한다 — panic도, 본문 훼손도 없어야 한다.
        let d = TempDir::new().unwrap();
        let original = "- [ ] 본문 📅한글값입니다열자이상\n";
        let p = f(&d, original).await;

        let updated = set_task_field(&p, 0, "- [ ] 본문 📅한글값입니다열자이상", "due", "")
            .await
            .unwrap();

        assert_eq!(updated, "- [ ] 본문 📅한글값입니다열자이상");
    }

    #[tokio::test]
    async fn set_task_field_rejects_an_unknown_field_name() {
        // I1: 프론트 오타(`duee`)가 "성공"처럼 보이면 안 된다. 파일에도 손대지 않는다.
        let d = TempDir::new().unwrap();
        let original = "- [ ] 할 일\n";
        let p = f(&d, original).await;

        let err = set_task_field(&p, 0, "- [ ] 할 일", "duee", "2026-09-01")
            .await
            .unwrap_err();

        assert!(matches!(err, TaskError::Custom(ref msg) if msg.contains("duee")));
        assert_eq!(tokio::fs::read_to_string(&p).await.unwrap(), original);
    }

    #[test]
    fn apply_state_swaps_marker_and_appends_done_date() {
        let out = apply_state(
            "- [ ] 초안 📅2026-08-30",
            TaskState::Done,
            true,
            "2026-08-24",
        );
        assert_eq!(out, "- [x] 초안 📅2026-08-30 ✅2026-08-24");
    }

    #[test]
    fn apply_state_strips_done_date_when_reverting() {
        let out = apply_state(
            "- [x] 초안 📅2026-08-30 ✅2026-08-24",
            TaskState::Todo,
            true,
            "2026-08-24",
        );
        assert_eq!(out, "- [x] 초안 📅2026-08-30".replace("[x]", "[ ]"));
    }

    #[test]
    fn apply_state_leaves_done_date_alone_when_recording_is_off() {
        let out = apply_state("- [ ] 초안", TaskState::Done, false, "2026-08-24");
        assert_eq!(out, "- [x] 초안");
    }

    #[test]
    fn apply_state_preserves_indentation() {
        let out = apply_state("    - [ ] 중첩", TaskState::Done, false, "2026-08-24");
        assert_eq!(out, "    - [x] 중첩");
    }

    #[test]
    fn apply_field_sets_and_clears() {
        let set = apply_field("- [ ] 초안", "due", "2026-08-30").unwrap();
        assert_eq!(set, "- [ ] 초안 📅2026-08-30");
        let cleared = apply_field(&set, "due", "").unwrap();
        assert_eq!(cleared, "- [ ] 초안");
    }

    #[test]
    fn apply_field_rejects_unknown_field() {
        assert!(apply_field("- [ ] 초안", "priority", "high").is_none());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn writes_through_a_rename_not_by_following_a_symlink() {
        // C1: §3.6은 tmp→rename 원자적 쓰기를 요구한다. 심볼릭 링크를 통해 쓰면
        // 두 구현이 관찰 가능하게 갈린다 — 직접 tokio::fs::write는 링크를 "따라가"
        // 원본(real.md)을 고쳐 쓰지만, tmp+rename은 링크 자리를 새 파일로 통째로
        // 교체하므로 원본은 그대로 남는다.
        let d = TempDir::new().unwrap();
        let real = d.path().join("real.md");
        let link = d.path().join("link.md");
        tokio::fs::write(&real, "- [ ] 할 일\n").await.unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let link_path = link.to_string_lossy().to_string();
        set_task_state(
            &link_path,
            0,
            "- [ ] 할 일",
            TaskState::Done,
            false,
            "2026-08-23",
        )
        .await
        .unwrap();

        let via_link = tokio::fs::read_to_string(&link).await.unwrap();
        assert_eq!(via_link, "- [x] 할 일\n");

        let real_content = tokio::fs::read_to_string(&real).await.unwrap();
        assert_eq!(
            real_content, "- [ ] 할 일\n",
            "원본 파일이 심볼릭 링크를 통해 변경되면 안 된다"
        );
        assert!(
            !std::fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink(),
            "rename은 심볼릭 링크 자체를 새 파일로 교체해야 한다"
        );
    }
}
