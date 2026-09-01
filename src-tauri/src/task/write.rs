// §305 낙관적 잠금 쓰기 — expected_raw가 일치할 때만 그 줄을 고친다.
use crate::task::fields::{insert_field, set_timer, FIELD_EMOJI};
use crate::task::parse::is_valid_date;
use crate::task::{normalize_line, TaskError, TaskState};

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
    if !matches_expected(current, expected_raw) {
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

/// §318 굴린 날짜 — 반복 태스크가 다음 회차로 넘어갈 때 함께 움직이는 세 필드.
///
/// 값은 전부 **프런트가 계산해 온 것**이다(`utils/tasks/task-recurrence.ts`).
/// `➕` 생성일이 없는 것은 실수가 아니다 — 그것은 일정이 아니라 기록이라 굴려도
/// 제자리에 남는다.
///
/// 세 필드를 `HashMap<String, String>`이 아니라 이름 있는 구조체로 둔 이유: 그래야
/// 모르는 필드 이름이라는 것이 **존재할 수 없다**. 맵이면 `apply_field`가 `None`을
/// 돌려주는 경로가 생기고, 그것을 조용히 무시하면 프런트 오타가 "성공"으로 보인다.
#[derive(Debug, Default, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RolledDates {
    pub due: Option<String>,
    pub scheduled: Option<String>,
    pub start: Option<String>,
}

impl RolledDates {
    /// 있는 것만, §303 canonical 순서로. `insert_field`가 자리를 정하므로 이 순서가
    /// 결과 줄을 바꾸지는 않지만, 읽는 사람이 표와 같은 순서를 보게 된다.
    fn entries(&self) -> impl Iterator<Item = (&'static str, &str)> {
        [
            ("start", self.start.as_deref()),
            ("scheduled", self.scheduled.as_deref()),
            ("due", self.due.as_deref()),
        ]
        .into_iter()
        .filter_map(|(field, value)| value.map(|v| (field, v)))
    }
}

/// §305/§318 한 상태 전이의 서술 — 그때 찍는 스탬프, 그때 멈추는 시계, 그때 미는 날짜.
///
/// ‼️ 묶은 이유는 인자 개수가 아니라 **넷이 따로 일어날 수 없다**는 것이다. 굴리기를
/// 별도 쓰기로 내면 상태 전이와 날짜 이동 사이에 낀 stale이 "상태는 굴렀는데 날짜는
/// 안 굴린" 줄을 만들고, 그 줄은 자기가 몇 회차인지 말하지 못한다.
/// (M4가 달았던 `#[allow(clippy::too_many_arguments)]` 둘이 이것으로 없어졌다.)
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateWrite {
    /// §318 굴린 날짜. 전부 `None`이면 날짜를 건드리지 않는다.
    #[serde(default)]
    pub dates: RolledDates,
    pub new_state: TaskState,
    pub record_done_date: bool,
    /// §18.18 M4 `⏱`의 다음 값. `None`은 "건드리지 말라"(기록 끔), `Some("")`는 제거.
    #[serde(default)]
    pub timer: Option<String>,
    pub today: String,
}

impl StateWrite {
    /// 파일을 건드리기 전에 값을 본다. `set_task_field`가 모르는 필드명을 미리 거르는
    /// 것과 같은 판단이다 — 프런트의 잘못된 값이 "성공"으로 보이면 안 되고, 무엇보다
    /// 달력에 없는 날짜가 사용자 파일에 적히면 안 된다.
    pub fn validate(&self) -> Result<(), TaskError> {
        for (field, value) in self.dates.entries() {
            if !is_valid_date(value) {
                return Err(TaskError::Custom(format!(
                    "invalid {} date: {}",
                    field, value
                )));
            }
        }
        Ok(())
    }
}

/// 상태 전이 결과 줄을 만든다 — I/O 없음.
///
/// 디스크 경로(`set_task_state`)와 열린 파일 경로(`preview_task_state_line`)가
/// **같은 구현**을 쓰게 하는 것이 이 함수의 존재 이유다. TypeScript에 재구현하면
/// 두 벌이 되어 반드시 드리프트한다.
///
/// `current`는 이미 `normalize_line`을 거친 줄이어야 한다.
pub fn apply_state(current: &str, write: &StateWrite) -> String {
    let marker = write.new_state.marker();
    // 가장 **왼쪽** 마커만 바꾼다 — 본문에 "[x]"가 들어 있어도 체크박스를 놓치지 않는다.
    let swapped = if let Some(p) = ["[ ]", "[x]", "[X]", "[/]", "[-]"]
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

    // §18.18 M4 — 시간 기록. **값은 프런트가 계산해 온다**(`task-timer.ts`의
    // `timerForState`). 여기서 다시 계산하지 않는 이유가 둘 있다: 이 규칙은 시계를
    // 읽는데 이 코드베이스는 "Rust가 시간대를 추측하지 않는다"를 지키고, 무엇보다
    // 에디터 경로(디스크를 타지 않는다)가 이미 그 함수를 쓰므로 여기 옮겨 적으면
    // **같은 규칙이 두 벌**이 된다. Rust가 아는 것은 "어디에 놓는가"뿐이다.
    //
    // `None`은 "건드리지 말라"(기록 끔), `Some("")`는 제거다.
    let swapped = match write.timer.as_deref() {
        None => swapped,
        Some(value) => set_timer(&swapped, value),
    };

    // §318 굴린 날짜. 상태·타이머와 **같은 줄 계산 안에서** 놓는다 — 이 셋이 한
    // 트랜잭션이어야 한다는 것이 `StateWrite`가 존재하는 이유다.
    let swapped = write.dates.entries().fold(swapped, |line, (field, value)| {
        // `entries()`가 `RolledDates`의 세 필드만 내므로 `None`은 도달 불가다.
        // `unwrap_or(line)`은 그 사실이 깨지는 날의 방어다 — 그때도 줄은 성한다.
        apply_field(&line, field, value).unwrap_or(line)
    });

    if !write.record_done_date {
        return swapped;
    }
    // ‼️ 종료 스탬프는 상태마다 **최대 하나**다. 새 스탬프를 붙이기 전에 둘 다 떼는
    // 이유가 여기 있다 — 완료였다가 취소된 줄에 `✅`과 `❌`이 나란히 남으면 그 줄은
    // 언제 끝났는지에 대해 서로 다른 두 가지를 말하게 되고, 어느 쪽이 참인지 알 방법이
    // 없다. §18.18 M4가 상태를 넷으로 넓히면서 처음 가능해진 전이다.
    let cleared = strip_field(&strip_field(&swapped, "done"), "cancelled");
    match write.new_state.stamp_field() {
        Some(field) => insert_field(&cleared, field, &write.today),
        None => cleared,
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
        insert_field(&stripped, field, value)
    })
}

/// 줄 하나를 **없앤다** — 자기 종결자까지 함께. 파괴적이고 되돌릴 수 없다(스냅샷 §71은
/// 파일 단위이고 이 경로를 타지 않는다). 그래서 `expected_raw` 낙관적 잠금은
/// `replace_line`과 **같은 기준**(정규화 + `trim_end`)으로 걸고, 불일치·범위 밖이면
/// 파일에 손대지 않고 `Stale`을 돌려준다.
///
/// `replace_line`과 나란한 프리미티브이지만 재조립 방식이 다르다. 그쪽은 파일 전체에서
/// 종결자 **하나**를 골라 split/join하는데, 삭제는 그 방식으로 구현할 수 없다:
/// - 끝 개행이 없는 파일의 마지막 줄을 지우면 `join` 뒤의 무조건 push가 없던 개행을
///   만들거나, push를 생략하면 그 앞 줄의 개행까지 사라진다.
/// - 혼합 EOL 파일에서는 고른 종결자와 실제 종결자가 달라 **남은 줄의 EOL이 바뀌고**,
///   줄 번호마저 파서(`str::lines()`)와 어긋난다.
///
/// 그래서 각 줄에 자기 종결자를 붙인 채 자르고 한 조각을 통째로 뺀다. 남는 바이트는
/// 손대지 않은 줄의 **원본 바이트 그대로**다.
pub async fn delete_line(path: &str, line: u32, expected_raw: &str) -> Result<(), TaskError> {
    let content = tokio::fs::read_to_string(path).await?;
    let parts = split_keeping_eol(&content);

    let idx = line as usize;
    let part = parts.get(idx).ok_or(TaskError::Stale)?;
    if !matches_expected(strip_eol(part), expected_raw) {
        return Err(TaskError::Stale);
    }

    let out = splice_out(&parts, &[idx]);

    // §3.6 원자적 쓰기(tmp → rename) — `replace_line`과 같은 이유이고, 삭제에서는 더
    // 무겁다: 반쯤 쓰인 파일로 죽으면 되돌릴 원본이 남지 않는다.
    crate::fs::write_file(path, &out)
        .await
        .map_err(|e| TaskError::Custom(e.to_string()))?;
    Ok(())
}

/// 각 줄에 **자기 종결자를 붙인 채로** 자른다. 끝 개행 뒤의 빈 꼬리는 만들지 않으므로
/// 조각 수 = 줄 수이고, 그 번호는 파서가 쓰는 `str::lines()`와 일치한다.
///
/// TypeScript 쪽 `splitKeepingEol`(src/utils/tasks/line-splice.ts)과 같은 규칙이다 —
/// 열린 문서 경로는 삭제를 그쪽에서 하므로 두 구현이 같은 바이트를 내야 한다.
pub(super) fn split_keeping_eol(content: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    // '\n'은 1바이트이므로 i+1은 항상 문자 경계다.
    for (i, _) in content.match_indices('\n') {
        parts.push(&content[start..=i]);
        start = i + 1;
    }
    if start < content.len() {
        parts.push(&content[start..]);
    }
    parts
}

/// 조각에서 종결자를 뗀다 — `str::lines()`처럼 `\r`도 뗀다.
pub(super) fn strip_eol(part: &str) -> &str {
    match part.strip_suffix('\n') {
        Some(rest) => rest.strip_suffix('\r').unwrap_or(rest),
        None => part,
    }
}

/// `split_keeping_eol`의 조각들에서 `drop`에 든 번호를 빼고 도로 붙인다. 남는 바이트는
/// 손대지 않은 줄의 **원본 그대로**다 — 조각이 자기 종결자를 이미 들고 있으므로 EOL을
/// 다시 짓지 않는다.
///
/// 삭제(§312)와 아카이브(`archive.rs`)가 같은 규칙으로 줄을 뺀다. 아카이브는 한 파일에서
/// 여러 줄을 한 번에 빼는데, `delete_line`을 N번 부르는 것으로는 대신할 수 없다 —
/// 첫 삭제가 그 아래 줄 번호를 전부 하나씩 당겨 두 번째 호출이 다른 줄을 지운다.
pub(super) fn splice_out(parts: &[&str], drop: &[usize]) -> String {
    parts
        .iter()
        .enumerate()
        .filter(|(i, _)| !drop.contains(i))
        .map(|(_, p)| *p)
        .collect()
}

/// §305 낙관적 잠금의 비교 — 양쪽을 정규화하고 뒤 공백을 떼고 견준다.
/// 쓰기·삭제·아카이브가 **같은 기준**으로 잠그도록 한 곳에 둔다.
pub(super) fn matches_expected(actual: &str, expected_raw: &str) -> bool {
    normalize_line(actual).trim_end() == normalize_line(expected_raw).trim_end()
}

pub async fn set_task_state(
    path: &str,
    line: u32,
    expected_raw: &str,
    write: StateWrite,
) -> Result<String, TaskError> {
    // 파일을 열기 **전에** 본다 — 값이 틀렸으면 아무것도 건드리지 않고 돌아간다.
    write.validate()?;
    replace_line(path, line, expected_raw, move |current| {
        apply_state(current, &write)
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
            sw(TaskState::Done, true, "2026-08-23", None),
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
            sw(TaskState::Todo, true, "2026-08-24", None),
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
            sw(TaskState::Done, true, "2026-08-23", None),
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

        let err = set_task_state(
            &p,
            99,
            "- [ ] 한 줄",
            sw(TaskState::Done, true, "2026-08-23", None),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, TaskError::Stale));
    }

    #[tokio::test]
    async fn preserves_crlf_line_endings() {
        let d = TempDir::new().unwrap();
        let p = f(&d, "# T\r\n- [ ] 할 일\r\n").await;

        set_task_state(
            &p,
            1,
            "- [ ] 할 일",
            sw(TaskState::Done, false, "2026-08-23", None),
        )
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

        let updated = set_task_state(
            &p,
            0,
            "- [ ] a",
            sw(TaskState::Done, false, "2026-08-23", None),
        )
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

        set_task_state(
            &p,
            0,
            "- [ ] 할 일",
            sw(TaskState::Done, false, "2026-08-23", None),
        )
        .await
        .unwrap();

        assert_eq!(tokio::fs::read_to_string(&p).await.unwrap(), "- [x] 할 일");
    }

    #[tokio::test]
    async fn matches_expected_raw_after_normalization() {
        // 인덱스는 정규화된 raw를 들고 있고 파일에는 NBSP가 있어도 일치해야 한다
        let d = TempDir::new().unwrap();
        let p = f(&d, "- [ ] 할\u{00A0}일\n").await;

        let updated = set_task_state(
            &p,
            0,
            "- [ ] 할 일",
            sw(TaskState::Done, false, "2026-08-23", None),
        )
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
            sw(TaskState::Todo, false, "2026-08-23", None),
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
            sw(TaskState::Todo, true, "2026-08-24", None),
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

    /// 테스트용 `StateWrite`. §318 날짜를 쓰는 테스트만 이 결과의 `dates`를 채운다 —
    /// 나머지 전부에게 굴리기는 "일어나지 않는 일"이어야 하고, 기본값이 그 사실이다.
    fn sw(
        new_state: TaskState,
        record_done_date: bool,
        today: &str,
        timer: Option<&str>,
    ) -> StateWrite {
        StateWrite {
            dates: RolledDates::default(),
            new_state,
            record_done_date,
            timer: timer.map(str::to_string),
            today: today.to_string(),
        }
    }

    #[test]
    fn apply_state_swaps_marker_and_appends_done_date() {
        let out = apply_state(
            "- [ ] 초안 📅2026-08-30",
            &sw(TaskState::Done, true, "2026-08-24", None),
        );
        assert_eq!(out, "- [x] 초안 📅2026-08-30 ✅2026-08-24");
    }

    #[test]
    fn apply_state_strips_done_date_when_reverting() {
        let out = apply_state(
            "- [x] 초안 📅2026-08-30 ✅2026-08-24",
            &sw(TaskState::Todo, true, "2026-08-24", None),
        );
        assert_eq!(out, "- [x] 초안 📅2026-08-30".replace("[x]", "[ ]"));
    }

    #[test]
    fn apply_state_leaves_done_date_alone_when_recording_is_off() {
        let out = apply_state(
            "- [ ] 초안",
            &sw(TaskState::Done, false, "2026-08-24", None),
        );
        assert_eq!(out, "- [x] 초안");
    }

    #[test]
    fn apply_state_preserves_indentation() {
        let out = apply_state(
            "    - [ ] 중첩",
            &sw(TaskState::Done, false, "2026-08-24", None),
        );
        assert_eq!(out, "    - [x] 중첩");
    }

    // --- §18.18 M4 상태 넷 ---

    #[test]
    fn apply_state_writes_every_marker() {
        assert_eq!(
            apply_state(
                "- [ ] 초안",
                &sw(TaskState::Doing, false, "2026-08-24", None)
            ),
            "- [/] 초안"
        );
        assert_eq!(
            apply_state(
                "- [/] 초안",
                &sw(TaskState::Cancelled, false, "2026-08-24", None)
            ),
            "- [-] 초안"
        );
        assert_eq!(
            apply_state(
                "- [-] 초안",
                &sw(TaskState::Todo, false, "2026-08-24", None)
            ),
            "- [ ] 초안"
        );
    }

    #[test]
    fn apply_state_stamps_a_cancelled_line_with_the_cancel_date() {
        let out = apply_state(
            "- [ ] 초안",
            &sw(TaskState::Cancelled, true, "2026-08-24", None),
        );
        assert_eq!(out, "- [-] 초안 ❌2026-08-24");
    }

    /// ‼️ 한 줄이 끝난 날짜에 대해 두 가지를 말하면 안 된다. 상태가 넷이 되면서
    /// 처음 가능해진 전이(완료 → 취소)이고, 스탬프를 떼지 않으면 `✅`과 `❌`이
    /// 나란히 남아 어느 쪽이 참인지 알 방법이 없어진다.
    #[test]
    fn apply_state_never_leaves_two_terminal_stamps() {
        let done = apply_state("- [ ] 초안", &sw(TaskState::Done, true, "2026-08-24", None));
        assert_eq!(done, "- [x] 초안 ✅2026-08-24");

        let cancelled = apply_state(&done, &sw(TaskState::Cancelled, true, "2026-08-25", None));
        assert_eq!(cancelled, "- [-] 초안 ❌2026-08-25");

        // 되살리면 스탬프가 남지 않는다 — 끝나지 않은 일에 끝난 날짜는 없다.
        let reopened = apply_state(&cancelled, &sw(TaskState::Doing, true, "2026-08-26", None));
        assert_eq!(reopened, "- [/] 초안");
    }

    #[test]
    fn apply_state_swaps_only_the_leftmost_marker() {
        let out = apply_state(
            "- [ ] 본문에 [-] 가 있다",
            &sw(TaskState::Doing, false, "2026-08-24", None),
        );
        assert_eq!(out, "- [/] 본문에 [-] 가 있다");
    }

    /// §318 굴리기 — 프런트가 계산한 날짜가 줄에 놓인다.
    ///
    /// Rust가 아는 것은 "어디에 놓는가"뿐이다. 계산은 `task-recurrence.ts` 한 곳이고,
    /// 그 규칙이 달력을 읽으므로 시간대를 아는 쪽이 갖는다(M4 `⏱`와 같은 분담).
    ///
    /// ‼️ 아래 `a_roll_moves_every_date_it_is_given`의 두 줄은 TypeScript
    /// `task-item-control.test.ts`의 "moves the dates and comes back to todo in one
    /// press"가 **같은 문자열로** 단정한다. 상태 전이는 이 코드베이스에서 두 번
    /// 구현돼 있고(에디터는 PM 트랜잭션, 아젠다는 디스크) 어느 한쪽만 고치면 같은
    /// 조작이 표면에 따라 다른 줄을 만든다 — 두 언어의 테스트가 그것을 막는다.
    fn rolled(new_state: TaskState, dates: RolledDates) -> StateWrite {
        StateWrite {
            dates,
            new_state,
            record_done_date: true,
            timer: None,
            today: "2026-09-05".to_string(),
        }
    }

    #[test]
    fn a_roll_moves_every_date_it_is_given() {
        let out = apply_state(
            "- [/] 주간 회고 🛫2026-08-30 📅2026-09-01 🔁every week",
            &rolled(
                TaskState::Todo,
                RolledDates {
                    due: Some("2026-09-08".to_string()),
                    scheduled: None,
                    start: Some("2026-09-06".to_string()),
                },
            ),
        );

        assert_eq!(
            out,
            "- [ ] 주간 회고 🛫2026-09-06 📅2026-09-08 🔁every week"
        );
    }

    /// ‼️ 굴린 줄은 완료가 **아니다**. `[ ]`인데 ✅이 붙어 있으면 그 줄은 자기가
    /// 끝났는지에 대해 두 가지를 말한다. `Todo::stamp_field()`가 `None`이라 스탬프를
    /// 떼기만 하고 새로 찍지 않는 것이 이 성질의 구현이다.
    #[test]
    fn a_rolled_line_carries_no_completion_stamp() {
        let done = apply_state(
            "- [ ] 주간 회고 📅2026-09-01 🔁every week",
            &sw(TaskState::Done, true, "2026-09-05", None),
        );
        assert!(done.contains("✅2026-09-05"));

        let out = apply_state(
            &done,
            &rolled(
                TaskState::Todo,
                RolledDates {
                    due: Some("2026-09-08".to_string()),
                    scheduled: None,
                    start: None,
                },
            ),
        );

        assert_eq!(out, "- [ ] 주간 회고 📅2026-09-08 🔁every week");
    }

    /// ‼️ 굴리기가 `record_done_date`를 **항상 참으로** 넘겨야 하는 이유. 거짓이면
    /// `apply_state`가 일찍 돌아가 남의 도구가 적어 둔 ✅을 떼지 못하고, `[ ]`인데
    /// 완료일이 붙은 줄이 남는다. 이 테스트는 그 잘못된 호출이 무엇을 만드는지를 고정해
    /// 둔다 — 호출자(`task-triage.ts`·`task-item.ts`)가 지켜야 할 계약의 근거다.
    #[test]
    fn recording_off_would_leave_the_old_stamp_behind() {
        let out = apply_state(
            "- [x] 주간 회고 📅2026-09-01 🔁every week ✅2026-09-05",
            &StateWrite {
                dates: RolledDates {
                    due: Some("2026-09-08".to_string()),
                    scheduled: None,
                    start: None,
                },
                new_state: TaskState::Todo,
                record_done_date: false,
                timer: None,
                today: "2026-09-05".to_string(),
            },
        );

        assert!(
            out.contains("✅2026-09-05"),
            "이것이 피하려는 줄이다: {}",
            out
        );
    }

    /// 굴린 날짜가 없으면 날짜를 건드리지 않는다 — 평범한 상태 전이와 바이트가 같다.
    #[test]
    fn no_rolled_dates_means_no_date_is_touched() {
        let line = "- [ ] 주간 회고 📅2026-09-01 🔁every week";
        assert_eq!(
            apply_state(line, &rolled(TaskState::Done, RolledDates::default())),
            apply_state(line, &sw(TaskState::Done, true, "2026-09-05", None)),
        );
    }

    /// 달력에 없는 날짜는 **파일을 열기 전에** 거절한다. `set_task_field`가 모르는
    /// 필드명을 미리 거르는 것과 같은 판단이다.
    #[test]
    fn an_impossible_rolled_date_is_refused() {
        let write = rolled(
            TaskState::Todo,
            RolledDates {
                due: Some("2026-02-30".to_string()),
                scheduled: None,
                start: None,
            },
        );

        assert!(write.validate().is_err());
        assert!(rolled(TaskState::Todo, RolledDates::default())
            .validate()
            .is_ok());
    }

    #[tokio::test]
    async fn a_refused_roll_leaves_the_file_alone() {
        let d = TempDir::new().unwrap();
        let raw = "- [ ] 주간 회고 📅2026-09-01 🔁every week";
        let p = f(&d, &format!("{}\n", raw)).await;

        let err = set_task_state(
            &p,
            0,
            raw,
            rolled(
                TaskState::Todo,
                RolledDates {
                    due: Some("2026-13-01".to_string()),
                    scheduled: None,
                    start: None,
                },
            ),
        )
        .await;

        assert!(err.is_err());
        assert_eq!(
            tokio::fs::read_to_string(&p).await.unwrap(),
            format!("{}\n", raw)
        );
    }

    #[tokio::test]
    async fn a_roll_reaches_the_file_in_one_write() {
        let d = TempDir::new().unwrap();
        let raw = "- [x] 주간 회고 📅2026-09-01 🔁every week ✅2026-09-05";
        let p = f(&d, &format!("{}\n다음 줄\n", raw)).await;

        let updated = set_task_state(
            &p,
            0,
            raw,
            rolled(
                TaskState::Todo,
                RolledDates {
                    due: Some("2026-09-08".to_string()),
                    scheduled: None,
                    start: None,
                },
            ),
        )
        .await
        .unwrap();

        assert_eq!(updated, "- [ ] 주간 회고 📅2026-09-08 🔁every week");
        assert_eq!(
            tokio::fs::read_to_string(&p).await.unwrap(),
            "- [ ] 주간 회고 📅2026-09-08 🔁every week\n다음 줄\n"
        );
    }

    /// ‼️ `🔁`를 날짜보다 **먼저** 적은 줄은 굴리면서 §303 canonical 순서로 재정렬된다.
    /// 굴리기가 만든 성질이 아니라 `apply_field`(strip + insert)의 오래된 동작이고,
    /// 그 줄의 기한 칩을 눌러 고쳐도 오늘 같은 일이 일어난다. 다만 굴리기는 그 재정렬을
    /// **사용자 손 없이** 일으키는 첫 조작이라 여기 못박아 둔다.
    #[test]
    fn a_roll_normalises_a_line_that_put_the_rule_first() {
        let out = apply_state(
            "- [ ] 주간 회고 🔁every week 📅2026-09-01",
            &rolled(
                TaskState::Todo,
                RolledDates {
                    due: Some("2026-09-08".to_string()),
                    scheduled: None,
                    start: None,
                },
            ),
        );

        assert_eq!(out, "- [ ] 주간 회고 📅2026-09-08 🔁every week");
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

    // --- §312 줄 삭제 ---
    //
    // ‼️ 아래 일곱 케이스는 **언어를 건너 공유되는 행렬**이다. 열린 문서·소스 버퍼 경로는
    // 삭제를 Rust에 묻지 않고 TypeScript(`removeLine`, src/utils/tasks/line-splice.ts)가
    // 직접 한다 — 상태 전이·필드·태그와 달리 지우는 데는 줄 문법 지식이 필요 없기 때문이다.
    // 그래서 두 경로의 바이트 동등성은 preview 커맨드로 확인할 수 없고, **같은 입력에 같은
    // 기대값**을 양쪽에 적어 두는 것으로만 성립한다. 한쪽을 고치면 다른 쪽도 고칠 것:
    // `src/utils/tasks/__tests__/line-splice.test.ts`의 "§312 removeLine" describe가 짝이다.

    #[tokio::test]
    async fn deletes_a_line_and_keeps_crlf() {
        let d = TempDir::new().unwrap();
        let p = f(&d, "a\r\n- [ ] 지울 것\r\nb\r\n").await;

        delete_line(&p, 1, "- [ ] 지울 것").await.unwrap();

        // 남은 줄이 아니라 **파일 전체 바이트**를 본다 — 개행 처리 실수는 이음새에 숨는다.
        assert_eq!(tokio::fs::read_to_string(&p).await.unwrap(), "a\r\nb\r\n");
    }

    #[tokio::test]
    async fn deletes_the_last_line_without_a_trailing_newline() {
        let d = TempDir::new().unwrap();
        let p = f(&d, "a\n- [ ] 지울 것").await;

        delete_line(&p, 1, "- [ ] 지울 것").await.unwrap();

        // 앞 줄의 개행은 그 줄의 것이므로 남는다. 여기서 "a"가 나오면 남의 종결자를 먹었다.
        assert_eq!(tokio::fs::read_to_string(&p).await.unwrap(), "a\n");
    }

    #[tokio::test]
    async fn deletes_a_middle_line_without_adding_a_trailing_newline() {
        // 뮤테이션이 드러낸 구멍이다. 끝 개행을 "지운 뒤 다시 붙일지"로 다루면
        // (`join` 뒤 무조건 push) 여기서 **없던 개행이 생긴다** — 다른 여섯 케이스는
        // 전부 통과하면서. 짝은 line-splice.test.ts의 같은 이름 케이스다.
        let d = TempDir::new().unwrap();
        let p = f(&d, "a\n- [ ] 지울 것\nb").await;

        delete_line(&p, 1, "- [ ] 지울 것").await.unwrap();

        assert_eq!(tokio::fs::read_to_string(&p).await.unwrap(), "a\nb");
    }

    #[tokio::test]
    async fn deletes_the_first_line() {
        let d = TempDir::new().unwrap();
        let p = f(&d, "- [ ] 지울 것\na\n").await;

        delete_line(&p, 0, "- [ ] 지울 것").await.unwrap();

        assert_eq!(tokio::fs::read_to_string(&p).await.unwrap(), "a\n");
    }

    #[tokio::test]
    async fn deletes_the_last_line_with_a_trailing_newline() {
        let d = TempDir::new().unwrap();
        let p = f(&d, "a\n- [ ] 지울 것\n").await;

        delete_line(&p, 1, "- [ ] 지울 것").await.unwrap();

        assert_eq!(tokio::fs::read_to_string(&p).await.unwrap(), "a\n");
    }

    #[tokio::test]
    async fn deleting_the_only_line_leaves_an_empty_file() {
        let d = TempDir::new().unwrap();
        let p = f(&d, "- [ ] 지울 것\n").await;

        delete_line(&p, 0, "- [ ] 지울 것").await.unwrap();

        // 빈 파일이다 — "\n"이 남으면 없던 빈 줄을 하나 만든 것이다.
        assert_eq!(tokio::fs::read_to_string(&p).await.unwrap(), "");
    }

    #[tokio::test]
    async fn deleting_the_only_line_without_a_newline_leaves_an_empty_file() {
        let d = TempDir::new().unwrap();
        let p = f(&d, "- [ ] 지울 것").await;

        delete_line(&p, 0, "- [ ] 지울 것").await.unwrap();

        assert_eq!(tokio::fs::read_to_string(&p).await.unwrap(), "");
    }

    #[tokio::test]
    async fn deletes_a_nested_item_without_touching_its_neighbours() {
        let d = TempDir::new().unwrap();
        let p = f(&d, "- [ ] 부모\n    - [ ] 하위\n- [ ] 다음\n").await;

        delete_line(&p, 1, "    - [ ] 하위").await.unwrap();

        assert_eq!(
            tokio::fs::read_to_string(&p).await.unwrap(),
            "- [ ] 부모\n- [ ] 다음\n"
        );
    }

    #[tokio::test]
    async fn deletes_one_line_of_a_file_whose_lines_end_inconsistently() {
        // C1(replace_line)이 실제 데이터 손실을 낸 형태다. 파일 전체에서 종결자 **하나**를
        // 골라 split/join하면 여기서 두 가지가 동시에 깨진다: 줄 번호가 파서(`str::lines()`)와
        // 어긋나고, 남은 줄의 EOL이 고른 쪽으로 바뀐다.
        let d = TempDir::new().unwrap();
        let p = f(&d, "- [ ] a\r\n- [ ] b\n- [ ] c\n").await;

        delete_line(&p, 1, "- [ ] b").await.unwrap();

        assert_eq!(
            tokio::fs::read_to_string(&p).await.unwrap(),
            "- [ ] a\r\n- [ ] c\n"
        );
    }

    #[tokio::test]
    async fn refuses_a_stale_line_and_leaves_the_file_untouched() {
        let d = TempDir::new().unwrap();
        let original = "a\n- [ ] 바뀐 것\n";
        let p = f(&d, original).await;

        let err = delete_line(&p, 1, "- [ ] 옛 것").await.unwrap_err();

        assert!(matches!(err, TaskError::Stale));
        // 삭제는 되돌릴 수 없으므로 이 단언이 이 파일에서 가장 중요하다.
        assert_eq!(tokio::fs::read_to_string(&p).await.unwrap(), original);
    }

    #[tokio::test]
    async fn refuses_a_line_index_past_the_end_of_the_file() {
        let d = TempDir::new().unwrap();
        let original = "a\n";
        let p = f(&d, original).await;

        let err = delete_line(&p, 99, "- [ ] 없는 줄").await.unwrap_err();

        assert!(matches!(err, TaskError::Stale));
        assert_eq!(tokio::fs::read_to_string(&p).await.unwrap(), original);
    }

    #[tokio::test]
    async fn matches_expected_raw_after_normalization_before_deleting() {
        // 인덱스의 raw는 정규화돼 있고 파일에는 NBSP가 남아 있다 — `replace_line`과 같은
        // 기준이 아니면 멀쩡한 줄이 영원히 stale이 되어 지울 수 없다.
        let d = TempDir::new().unwrap();
        let p = f(&d, "- [ ] 할\u{00A0}일\nb\n").await;

        delete_line(&p, 0, "- [ ] 할 일").await.unwrap();

        assert_eq!(tokio::fs::read_to_string(&p).await.unwrap(), "b\n");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn deletes_through_a_rename_not_by_following_a_symlink() {
        // §3.6 원자적 쓰기 — `replace_line`의 C1과 같은 판별식이다. 직접 tokio::fs::write는
        // 링크를 따라가 원본을 고쳐 쓰지만 tmp+rename은 링크 자리를 새 파일로 교체한다.
        let d = TempDir::new().unwrap();
        let real = d.path().join("real.md");
        let link = d.path().join("link.md");
        tokio::fs::write(&real, "- [ ] 할 일\nb\n").await.unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();

        delete_line(&link.to_string_lossy(), 0, "- [ ] 할 일")
            .await
            .unwrap();

        assert_eq!(tokio::fs::read_to_string(&link).await.unwrap(), "b\n");
        assert_eq!(
            tokio::fs::read_to_string(&real).await.unwrap(),
            "- [ ] 할 일\nb\n",
            "원본 파일이 심볼릭 링크를 통해 변경되면 안 된다"
        );
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
            sw(TaskState::Done, false, "2026-08-23", None),
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
