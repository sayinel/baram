// §312 태그 쓰기 — §303 canonical 줄 형식에서 태그는 **이모지 필드 앞**이다.
//
// 자리를 재는 규칙은 `fields.rs`가 갖는다(`field_run_start`). 한때 이 파일이 그 규칙을
// 혼자 갖고 있었고 `write.rs`는 필드를 줄 **끝**에 붙였는데, 그 둘이 같은 줄을 다르게
// 읽은 것이 §303 순서 드리프트의 원인이었다. 이제 태그도 필드도 같은 자를 쓴다.
use crate::task::fields::field_run_start;
use crate::task::write::replace_line;
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
    for (mut start, mut end) in found.into_iter().rev() {
        // `(#someday)`처럼 태그 하나만 감싼 괄호는 짝째로 지운다. 여는 괄호를 태그 경계로
        // 인정한 것이 `find_tag`(=`INLINE_TAG_RE`의 규칙)이므로 태그만 빼고 남는 `()`도
        // 우리가 만든 쓰레기다. 안에 다른 글자가 더 있으면 사용자 괄호이므로 손대지 않는다.
        if start > 0 && out.as_bytes()[start - 1] == b'(' && out.as_bytes().get(end) == Some(&b')')
        {
            start -= 1;
            end += 1;
        }
        // 앞의 공백을 **전부** 흡수한다. 뒤쪽 공백이 구분자로 남으므로 남은 글자가 서로
        // 붙지 않고, 앞을 하나만 먹으면 `a  #someday  b`가 `a   b`로 **늘어난다** —
        // 제거가 공백을 늘리면 붙였다 떼는 것이 제자리로 오지 않는다. 탭·U+3000처럼
        // ASCII 공백이 아닌 구분자도 이 규칙 하나로 함께 사라진다.
        while let Some(c) = out[..start].chars().next_back() {
            if !c.is_whitespace() {
                break;
            }
            start -= c.len_utf8();
        }
        out.replace_range(start..end, "");
    }
    // `trimmed`에 끝 공백이 없고 흡수가 앞쪽 공백을 남기지 않으므로 다시 다듬을 것이 없다.
    Some(out)
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

    /// F1: 반복(🔁)의 값은 줄 끝까지 이어지는 자유 텍스트다 — 그 **뒤**에 태그를 넣으면
    /// 태그가 반복 값의 일부가 된다. 값의 끝을 잴 수 없어도 이모지를 **경계로** 쓰는 데는
    /// 아무 문제가 없다: 필드 뭉치는 🔁 앞에서 시작한다.
    #[test]
    fn inserts_before_a_recurrence_rule() {
        let out = apply_tag("- [ ] draft 🔁 every week 📅2026-08-30", "someday", true).unwrap();
        assert_eq!(out, "- [ ] draft #someday 🔁 every week 📅2026-08-30");
    }

    /// 문자열이 아니라 **파서가 읽는 값**이 이 결함의 실체다. 태그를 켠 뒤에도 반복 규칙은
    /// `"every week"`여야 한다 — `"every week #someday"`가 되면 Baram은 값이 오염되고
    /// Obsidian Tasks는 반복 문자 클래스(`[a-zA-Z0-9, !]`)에 `#`이 없어 그 줄의 반복을
    /// 아예 읽지 못한다. 한 번의 태그 토글이 옆 필드의 뜻을 두 앱에서 모두 바꾼다.
    #[test]
    fn tagging_a_recurring_task_leaves_the_recurrence_value_intact() {
        let out = apply_tag("- [ ] draft 🔁 every week 📅2026-08-30", "someday", true).unwrap();
        let parsed = crate::task::parse_task_line(&out).unwrap();

        assert_eq!(parsed.recurrence.as_deref(), Some("every week"));
        assert_eq!(parsed.due.as_deref(), Some("2026-08-30"));
        assert_eq!(parsed.tags, vec!["someday".to_string()]);
        assert_eq!(parsed.text, "draft #someday");
    }

    /// 반복만 있는 줄에서도 마찬가지다 — 뒤따르는 날짜 필드가 경계를 대신 그어 주지 않는다.
    #[test]
    fn inserts_before_a_recurrence_rule_that_ends_the_line() {
        let out = apply_tag("- [ ] draft 🔁 every week", "someday", true).unwrap();
        assert_eq!(out, "- [ ] draft #someday 🔁 every week");
        assert_eq!(
            crate::task::parse_task_line(&out).unwrap().recurrence,
            Some("every week".to_string())
        );
    }

    /// 🔁만은 "장식용 이모지"를 가려낼 수 없다 — 값이 자유 텍스트라 파서도 그 줄을 이미
    /// 반복 태스크로 읽는다(`recurrence = "재확인 필요"`). 그러니 날짜 이모지와 달리
    /// 본문처럼 취급할 수 없고, 취급하면 태그가 반복 값 안으로 들어간다. 의도된 차이다.
    #[test]
    fn treats_a_recurrence_emoji_as_a_boundary_even_when_it_reads_like_body_text() {
        let out = apply_tag("- [ ] 회의 🔁 재확인 필요", "someday", true).unwrap();
        assert_eq!(out, "- [ ] 회의 #someday 🔁 재확인 필요");

        let parsed = crate::task::parse_task_line(&out).unwrap();
        assert_eq!(parsed.recurrence.as_deref(), Some("재확인 필요"));
        assert_eq!(parsed.tags, vec!["someday".to_string()]);
    }

    /// F2: `TASK_LINE_RE`가 `\s+`라 탭으로 구분된 줄도 정상적인 태스크로 인덱싱된다.
    /// 삽입 지점 탐색이 ASCII 공백만 훑으면 그런 줄에서는 자리를 못 찾아 태그가 줄 **끝**,
    /// 즉 필드 뒤에 붙는다 — §303 순서를 어긴 바이트가 사용자 vault에 쓰인다.
    #[test]
    fn inserts_before_a_tab_separated_field() {
        let out = apply_tag("- [ ] 초안\t📅2026-08-30", "someday", true).unwrap();
        assert_eq!(out, "- [ ] 초안 #someday 📅2026-08-30");
    }

    /// 필드 사이가 탭이어도 뭉치의 시작을 찾아야 한다. 삽입 지점의 구분자만 공백으로
    /// 정규화되고 뒤쪽은 사용자가 쓴 그대로 둔다.
    #[test]
    fn inserts_before_a_run_of_tab_separated_fields() {
        let out = apply_tag("- [ ] 초안\t📅2026-08-30\t⏫", "someday", true).unwrap();
        assert_eq!(out, "- [ ] 초안 #someday 📅2026-08-30\t⏫");
    }

    /// F3: `find_tag`이 여는 괄호를 태그 경계로 인정하므로(`INLINE_TAG_RE`와 같은 규칙)
    /// `(#someday)`도 태그다. 태그만 지우고 나면 남는 `()`는 우리가 만든 쓰레기다.
    #[test]
    fn removing_a_parenthesised_tag_does_not_leave_empty_parentheses() {
        let out = apply_tag("- [ ] 초안 (#someday) 📅2026-08-30", "someday", false).unwrap();
        assert_eq!(out, "- [ ] 초안 📅2026-08-30");
    }

    /// F4: 제거가 공백을 **늘리는** 일은 없어야 한다. 앞의 공백을 하나만 흡수하면
    /// 둘이 셋이 되어 붙였다 떼는 것이 항등이 아니게 된다.
    #[test]
    fn removing_a_tag_never_grows_the_surrounding_whitespace() {
        let out = apply_tag("- [ ] a  #someday  📅2026-08-30", "someday", false).unwrap();
        assert_eq!(out, "- [ ] a  📅2026-08-30");
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

    /// §312 이 어휘의 **다른 절반**은 TypeScript에 있다.
    ///
    /// 아젠다 메뉴가 "#someday 해제"를 보일지 말지는 `src/utils/tasks/task-tag-token.ts`의
    /// `lineHasTag`가 정하고, 그것은 위 `find_tag`/`is_tag_char`를 옮겨 적은 것이다.
    /// 둘이 갈라지면 메뉴가 할 수 없는 일을 약속하거나(제거가 줄을 안 바꾼다) 멀쩡한
    /// 행에서 항목이 죽는다. 언어가 달라 한 벌로 만들 수는 없으므로, **같은 표**를 양쪽에
    /// 두고 어느 쪽을 고쳐도 다른 쪽이 빨간불이 되게 한다.
    ///
    /// 표를 바꿀 일이 생기면 `task-tag-token.test.ts`의 같은 표도 함께 바꿀 것.
    #[test]
    fn tag_boundary_table_is_shared_with_the_front_end() {
        // (줄, 이 줄에 태그 `someday`가 있는가)
        let cases: &[(&str, bool)] = &[
            ("- [ ] 여행 #someday", true),
            ("- [ ] #someday 여행", true),
            ("- [ ] 여행 #someday 준비", true),
            ("#someday", true),
            ("- [ ] 여행 (#someday)", true),
            ("- [ ] 여행 #someday.", true),
            ("- [ ] 여행 #someday,", true),
            ("- [ ] 여행 #someday-maybe #someday", true),
            // ‼️ 인덱서(`md::INLINE_TAG_RE`)는 하이픈에서 끊어 이 줄들을 `someday`로
            // 읽는다. 여기서는 아니다 — 그 어긋남이 MODERATE-1이었다.
            ("- [ ] 여행 #someday-maybe", false),
            ("- [ ] 여행 #someday-", false),
            ("- [ ] 여행 #someday/maybe", false),
            ("- [ ] 여행 #someday_maybe", false),
            ("- [ ] 여행 #somedaymaybe", false),
            ("- [ ] 여행 #someday언젠가", false),
            ("- [ ] 여행 #someday2", false),
            ("- [ ] a#someday", false),
            ("- [ ] https://x/#someday", false),
            ("- [ ] 여행", false),
        ];
        for (line, expected) in cases {
            assert_eq!(
                !find_tag(line, "someday").is_empty(),
                *expected,
                "find_tag disagrees on {:?}",
                line
            );
            // 그리고 그것이 곧 "해제가 줄을 바꾸는가"와 같아야 한다 — 프론트가 라벨을
            // 그 답에 걸기 때문이다.
            let removed = apply_tag(line, "someday", false).unwrap();
            assert_eq!(
                removed != line.trim_end(),
                *expected,
                "apply_tag(off) disagrees on {:?} -> {:?}",
                line,
                removed
            );
        }
    }
}
