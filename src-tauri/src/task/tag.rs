// §312 태그 쓰기 — §303 canonical 줄 형식에서 태그는 **이모지 필드 앞**이다.
//
// `write.rs`의 `append_field`를 재사용할 수 없는 이유가 정확히 이것이다: 그것은 항상 줄
// **끝**에 붙이므로 `- [ ] 초안 📅2026-08-30 ⏫ #someday`가 되어 순서를 어긴다. 캡처가
// 새 줄을 짓는 순서(`buildCaptureLine`, src/services/task-capture.ts:101)와도 갈린다.
use crate::task::parse::{is_valid_date, PRIORITY_MARKERS};
use crate::task::write::{replace_line, FIELD_EMOJI};
use crate::task::TaskError;

/// 태그 이름에 쓸 수 있는 글자 — **경계 판정의 어휘**다.
///
/// `md::INLINE_TAG_RE`의 어휘(`\w` + 한글 + `/`)에 하이픈을 **더한다**. 그 정규식은
/// 하이픈에서 잘려 `#deep-work`를 `#deep`으로 읽는 P2 결함이 있는데(dev/backlog.md),
/// 여기서 그 어휘를 그대로 베끼면 `#someday`가 `#someday-maybe` 안에서 "이미 있다"로
/// 읽히고 제거는 남의 태그를 `-maybe`로 잘라 놓는다. 경계는 **넓은 쪽이 안전하다** —
/// 태그 글자로 인정하는 범위가 넓을수록 부분 일치를 더 많이 거절한다. 인덱서 쪽 결함은
/// 태그 패널·태그 인덱스와 공유된 규칙이라 이 슬라이스 밖이다.
fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-' || c == '/'
}

/// 프론트가 넘긴 태그 이름을 쓸 수 있는가. `"#someday"`처럼 `#`을 붙여 넘겼거나 공백이
/// 섞였으면 거절한다 — `set_task_field`가 모르는 필드명을 파일을 건드리기 **전에**
/// 거절하는 것과 같은 이유다(프론트 오타가 "성공"으로 보이면 안 된다).
fn is_valid_tag(tag: &str) -> bool {
    !tag.is_empty() && tag.chars().all(is_tag_char)
}

/// 줄 맨 앞이 필드 하나면 그 바이트 길이. 아니면 `None`.
///
/// 이모지 **뒤에 유효한 날짜가 와야** 필드다 — `strip_field`(write.rs)와 같은 기준이다.
/// 본문 중간의 장식용 📅를 필드로 세면 그 앞에 태그를 끼워 사용자 문장을 갈라 놓는다.
/// 이모지와 값 사이의 공백을 허용하는 것은 파서가 그 형태를 읽기 때문이다
/// (Obsidian Tasks가 `📅 2026-08-30`으로 쓴다).
///
/// 반복(🔁)은 값이 길이가 정해지지 않은 자유 텍스트("every week on Monday")라 여기서
/// 끝을 잴 수 없다 — 필드로 세지 않으므로 반복이 있는 줄에서는 태그가 그 뒤에 붙는다.
fn field_len(s: &str) -> Option<usize> {
    if let Some((marker, _)) = PRIORITY_MARKERS.iter().find(|(m, _)| s.starts_with(m)) {
        return Some(marker.len());
    }
    for (_, emoji) in FIELD_EMOJI {
        let Some(after) = s.strip_prefix(emoji) else {
            continue;
        };
        let pad = after.len() - after.trim_start().len();
        // 문자 수로 열 자를 세고 그 바이트 길이를 쓴다 — 바이트로 착각하면 한글처럼
        // 3바이트짜리 문자 중간을 잘라 panic("char boundary")이 된다(write.rs의 C5).
        let value: String = after[pad..].chars().take(10).collect();
        if is_valid_date(&value) {
            return Some(emoji.len() + pad + value.len());
        }
    }
    None
}

/// `s`가 **전부** 필드 뭉치인가 — 필드 사이 공백만 허용한다.
fn is_all_fields(s: &str) -> bool {
    let mut rest = s.trim();
    while !rest.is_empty() {
        let Some(len) = field_len(rest) else {
            return false;
        };
        rest = rest[len..].trim_start();
    }
    true
}

/// 태그를 끼울 자리 — 줄 끝의 **필드 뭉치가 시작하는** 바이트 위치. 필드가 없으면 줄 끝.
///
/// "첫 번째 이모지 앞"이 아니라 "거기서 줄 끝까지가 전부 필드인 가장 이른 자리"다.
/// 그래야 본문에 장식용 이모지가 있는 줄에서도 태그가 본문을 가르지 않는다.
fn field_run_start(trimmed: &str) -> usize {
    for (i, _) in trimmed.match_indices(' ') {
        let start = i + 1;
        if start < trimmed.len() && is_all_fields(&trimmed[start..]) {
            return start;
        }
    }
    trimmed.len()
}

/// `line`에 있는 `#tag`의 구간들을 등장 순서로 찾는다 — **경계를 요구한다**.
fn find_tag(line: &str, tag: &str) -> Vec<(usize, usize)> {
    let needle = format!("#{}", tag);
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(rel) = line[from..].find(&needle) {
        let start = from + rel;
        let end = start + needle.len();
        // 앞: 줄 시작이거나 공백·여는 괄호. `INLINE_TAG_RE`의 `(?:^|[\s\(])`와 같은 규칙 —
        // 단어 안이나 URL 조각(`.../#someday`)을 태그로 읽으면 제거가 남의 글자를 잘라낸다.
        let before_ok =
            start == 0 || line[..start].ends_with(|c: char| c.is_whitespace() || c == '(');
        // 뒤: 태그 글자가 이어지면 **다른 태그**다(`#somedaymaybe` `#someday-maybe` `#someday/maybe`).
        let after_ok = !line[end..].starts_with(is_tag_char);
        if before_ok && after_ok {
            out.push((start, end));
        }
        from = end;
    }
    out
}

/// 태그 토글 결과 줄 — I/O 없음. `on=false`는 제거.
///
/// 디스크 경로(`set_task_tag`)와 열린 파일 경로(`preview_task_tag_line`)가 **같은
/// 구현**을 쓰게 하는 것이 이 함수의 존재 이유다(`apply_state`·`apply_field`와 같다).
/// TypeScript에 재구현하면 두 벌이 되어 반드시 드리프트한다.
///
/// `current`는 이미 `normalize_line`을 거친 줄이어야 한다.
/// 쓸 수 없는 태그 이름이면 `None`.
pub fn apply_tag(current: &str, tag: &str, on: bool) -> Option<String> {
    if !is_valid_tag(tag) {
        return None;
    }
    let trimmed = current.trim_end();
    let found = find_tag(trimmed, tag);

    if on {
        // 이미 있으면 그대로 둔다 — 두 번째 `#someday`를 붙이지 않는다.
        if !found.is_empty() {
            return Some(trimmed.to_string());
        }
        let at = field_run_start(trimmed);
        let head = trimmed[..at].trim_end();
        let tail = trimmed[at..].trim_start();
        return Some(if tail.is_empty() {
            format!("{} #{}", head, tag)
        } else {
            format!("{} #{} {}", head, tag, tail)
        });
    }

    let mut out = trimmed.to_string();
    // 뒤에서부터 지운다 — 앞에서 지우면 뒤 구간의 오프셋이 어긋난다. 하나만 지우고
    // "해제했다"고 말하면 거짓이므로 등장한 것을 모두 지운다.
    for (mut start, end) in found.into_iter().rev() {
        // 구분 공백 하나만 함께 흡수한다(`strip_field`와 같은 규칙) — 양쪽을 다 지우면
        // 남은 글자가 서로 붙는다.
        if start > 0 && out.as_bytes()[start - 1] == b' ' {
            start -= 1;
        }
        out.replace_range(start..end, "");
    }
    Some(out.trim_end().to_string())
}

pub async fn set_task_tag(
    path: &str,
    line: u32,
    expected_raw: &str,
    tag: &str,
    on: bool,
) -> Result<String, TaskError> {
    if !is_valid_tag(tag) {
        return Err(TaskError::Custom(format!("invalid tag: {}", tag)));
    }
    let tag = tag.to_string();
    replace_line(path, line, expected_raw, move |current| {
        // 위에서 이름을 이미 검증했으므로 `None`은 도달 불가다.
        apply_tag(current, &tag, on).unwrap_or_else(|| current.to_string())
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

    #[test]
    fn adds_a_tag_before_the_emoji_fields() {
        let out = apply_tag("- [ ] 초안 📅2026-08-30 ⏫", "someday", true).unwrap();
        assert_eq!(out, "- [ ] 초안 #someday 📅2026-08-30 ⏫");
    }

    #[test]
    fn adds_a_tag_to_a_line_with_no_fields() {
        let out = apply_tag("- [ ] 초안", "someday", true).unwrap();
        assert_eq!(out, "- [ ] 초안 #someday");
    }

    #[test]
    fn adding_an_existing_tag_is_a_no_op() {
        let line = "- [ ] 초안 #someday 📅2026-08-30";
        assert_eq!(apply_tag(line, "someday", true).unwrap(), line);
    }

    #[test]
    fn removes_a_tag_and_its_surrounding_space() {
        let out = apply_tag("- [ ] 초안 #someday 📅2026-08-30", "someday", false).unwrap();
        assert_eq!(out, "- [ ] 초안 📅2026-08-30");
    }

    #[test]
    fn removes_a_tag_at_the_end_of_the_line() {
        let out = apply_tag("- [ ] 초안 #someday", "someday", false).unwrap();
        assert_eq!(out, "- [ ] 초안");
    }

    /// 구분자가 탭이면 공백 하나를 흡수하는 규칙이 걸리지 않는다 — 남은 탭을 줄 끝에
    /// 그대로 두면 눈에 보이지 않는 공백만 남은 줄이 저장된다(`strip_field`도 같은 이유로
    /// 마지막에 다듬는다).
    #[test]
    fn removes_a_tab_separated_tag_without_leaving_trailing_whitespace() {
        let out = apply_tag("- [ ] 초안\t#someday", "someday", false).unwrap();
        assert_eq!(out, "- [ ] 초안");
    }

    #[test]
    fn removing_a_tag_that_is_not_there_is_a_no_op() {
        let line = "- [ ] 초안 📅2026-08-30";
        assert_eq!(apply_tag(line, "someday", false).unwrap(), line);
    }

    #[test]
    fn preserves_indentation_of_a_nested_item() {
        let out = apply_tag("    - [ ] 중첩 📅2026-08-30", "someday", true).unwrap();
        assert_eq!(out, "    - [ ] 중첩 #someday 📅2026-08-30");
    }

    /// `#someday`가 `#somedaymaybe`를 건드리면 안 된다.
    #[test]
    fn does_not_match_a_longer_tag_with_the_same_prefix() {
        let line = "- [ ] 초안 #somedaymaybe";
        assert_eq!(
            apply_tag(line, "someday", true).unwrap(),
            "- [ ] 초안 #somedaymaybe #someday"
        );
        assert_eq!(apply_tag(line, "someday", false).unwrap(), line);
    }

    /// `INLINE_TAG_RE`의 하이픈 결함(dev/backlog.md P2)을 복제하면 이 테스트가 죽는다 —
    /// 하이픈에서 잘리는 어휘로 경계를 재면 `#someday-maybe`가 "someday가 이미 있다"로
    /// 읽히고, 제거는 남의 태그를 `-maybe`로 잘라 놓는다.
    #[test]
    fn does_not_match_a_hyphenated_tag_with_the_same_prefix() {
        let line = "- [ ] 초안 #someday-maybe";
        assert_eq!(
            apply_tag(line, "someday", true).unwrap(),
            "- [ ] 초안 #someday-maybe #someday"
        );
        assert_eq!(apply_tag(line, "someday", false).unwrap(), line);
    }

    /// 중첩 태그도 다른 태그다 — `#someday/maybe`는 `#someday`가 아니다.
    #[test]
    fn does_not_match_a_nested_tag_with_the_same_prefix() {
        let line = "- [ ] 초안 #someday/maybe";
        assert_eq!(apply_tag(line, "someday", false).unwrap(), line);
    }

    /// 단어 안의 `#`은 태그가 아니다(`INLINE_TAG_RE`의 `(?:^|[\s\(])`와 같은 규칙) —
    /// URL 조각을 태그로 읽으면 제거가 남의 링크를 잘라 놓는다.
    #[test]
    fn does_not_match_a_hash_inside_a_word() {
        let line = "- [ ] 초안 http://x/#someday";
        assert_eq!(apply_tag(line, "someday", false).unwrap(), line);
    }

    #[test]
    fn inserts_before_a_bare_priority_marker() {
        let out = apply_tag("- [ ] 초안 ⏫", "someday", true).unwrap();
        assert_eq!(out, "- [ ] 초안 #someday ⏫");
    }

    /// 이모지 뒤에 유효한 날짜가 와야 필드다(`strip_field`의 C3와 같은 규칙) —
    /// 본문 중간의 장식용 📅 앞에 태그를 끼우면 사용자 문장을 갈라 놓는다.
    #[test]
    fn inserts_before_the_real_field_not_a_decorative_emoji() {
        let out = apply_tag(
            "- [ ] 회의 📅 초대장 확인 필요 📅2026-08-30",
            "someday",
            true,
        )
        .unwrap();
        assert_eq!(out, "- [ ] 회의 📅 초대장 확인 필요 #someday 📅2026-08-30");
    }

    /// Obsidian Tasks가 쓰는 띄어쓰기 형태(`📅 2026-08-30`)도 필드다 — 파서가 그것을
    /// 읽으므로(`parse.rs`의 `trim_start`) 여기서 못 알아보면 남의 파일에서만 순서가
    /// 어긋난다.
    #[test]
    fn inserts_before_a_space_separated_field() {
        let out = apply_tag("- [ ] 초안 📅 2026-08-30", "someday", true).unwrap();
        assert_eq!(out, "- [ ] 초안 #someday 📅 2026-08-30");
    }

    /// 값이 날짜가 아니면 필드가 아니다 — 본문으로 남고 태그는 그 뒤에 붙는다.
    #[test]
    fn treats_an_emoji_without_a_date_as_body_text() {
        let out = apply_tag("- [ ] 본문 📅한글값입니다열자이상", "someday", true).unwrap();
        assert_eq!(out, "- [ ] 본문 📅한글값입니다열자이상 #someday");
    }

    #[test]
    fn removing_keeps_the_fields_and_the_body() {
        let out = apply_tag("- [ ] 초안 #someday 📅2026-08-30 ⏫", "someday", false).unwrap();
        assert_eq!(out, "- [ ] 초안 📅2026-08-30 ⏫");
    }

    /// 한 줄에 같은 태그가 둘이면 하나만 지우고 "해제했다"고 말하는 것은 거짓이다.
    #[test]
    fn removes_every_occurrence_of_the_tag() {
        let out = apply_tag(
            "- [ ] #someday 초안 #someday 📅2026-08-30",
            "someday",
            false,
        )
        .unwrap();
        assert_eq!(out, "- [ ] 초안 📅2026-08-30");
    }

    #[test]
    fn rejects_a_tag_name_that_cannot_be_written() {
        assert!(apply_tag("- [ ] 초안", "", true).is_none());
        assert!(apply_tag("- [ ] 초안", "some day", true).is_none());
        // 프론트가 `#`까지 붙여 넘긴 경우 — 그대로 쓰면 `##someday`가 된다.
        assert!(apply_tag("- [ ] 초안", "#someday", true).is_none());
    }

    #[tokio::test]
    async fn writes_the_tag_to_disk_under_the_optimistic_lock() {
        let d = TempDir::new().unwrap();
        let p = f(&d, "# T\n- [ ] 초안 📅2026-08-30\n").await;

        let updated = set_task_tag(&p, 1, "- [ ] 초안 📅2026-08-30", "someday", true)
            .await
            .unwrap();

        assert_eq!(updated, "- [ ] 초안 #someday 📅2026-08-30");
        assert_eq!(
            tokio::fs::read_to_string(&p).await.unwrap(),
            "# T\n- [ ] 초안 #someday 📅2026-08-30\n"
        );
    }

    #[tokio::test]
    async fn refuses_and_leaves_the_file_untouched_when_stale() {
        let d = TempDir::new().unwrap();
        let original = "- [ ] 그 사이 바뀐 줄\n";
        let p = f(&d, original).await;

        let err = set_task_tag(&p, 0, "- [ ] 예전 내용", "someday", true)
            .await
            .unwrap_err();

        assert!(matches!(err, TaskError::Stale));
        assert_eq!(tokio::fs::read_to_string(&p).await.unwrap(), original);
    }

    #[tokio::test]
    async fn rejects_an_invalid_tag_before_touching_the_file() {
        let d = TempDir::new().unwrap();
        let original = "- [ ] 초안\n";
        let p = f(&d, original).await;

        let err = set_task_tag(&p, 0, "- [ ] 초안", "some day", true)
            .await
            .unwrap_err();

        assert!(matches!(err, TaskError::Custom(ref m) if m.contains("some day")));
        assert_eq!(tokio::fs::read_to_string(&p).await.unwrap(), original);
    }
}
