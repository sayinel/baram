// §305 낙관적 잠금 쓰기 — expected_raw가 일치할 때만 그 줄을 고친다.
use crate::task::{normalize_line, TaskError, TaskState};

const FIELD_EMOJI: &[(&str, &str)] = &[
    ("created", "➕"),
    ("start", "🛫"),
    ("scheduled", "⏳"),
    ("due", "📅"),
    ("done", "✅"),
    ("cancelled", "❌"),
];

/// 줄바꿈 스타일과 마지막 개행 유무를 보존하며 한 줄만 바꾼다.
async fn replace_line<F>(
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
    let ends_with_newline = content.ends_with('\n');

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
    tokio::fs::write(path, out).await?;
    Ok(updated)
}

fn strip_field(line: &str, field: &str) -> String {
    let Some((_, emoji)) = FIELD_EMOJI.iter().find(|(f, _)| *f == field) else {
        return line.to_string();
    };
    let Some(pos) = line.find(emoji) else {
        return line.to_string();
    };
    let after = &line[pos + emoji.len()..];
    let skipped = after.len() - after.trim_start().len();
    let value_len = after.trim_start().chars().take(10).count();
    let mut out = line.to_string();
    out.replace_range(pos..pos + emoji.len() + skipped + value_len, "");
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn append_field(line: &str, field: &str, value: &str) -> String {
    let Some((_, emoji)) = FIELD_EMOJI.iter().find(|(f, _)| *f == field) else {
        return line.to_string();
    };
    format!("{} {}{}", line.trim_end(), emoji, value)
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
        let marker = match new_state {
            TaskState::Done => "[x]",
            TaskState::Todo => "[ ]",
        };
        // 첫 "[ ]" 또는 "[x]"만 바꾼다 — 본문에 대괄호가 있어도 안전하다.
        let swapped = if let Some(p) = current
            .find("[ ]")
            .or_else(|| current.find("[x]").or_else(|| current.find("[X]")))
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
            TaskState::Done => append_field(&strip_field(&swapped, "done"), "done", &today),
            TaskState::Todo => strip_field(&swapped, "done"),
        }
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
    let field = field.to_string();
    let value = value.to_string();
    replace_line(path, line, expected_raw, move |current| {
        let stripped = strip_field(current, &field);
        if value.is_empty() {
            stripped
        } else {
            append_field(&stripped, &field, &value)
        }
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
}
