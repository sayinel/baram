// §312 수집함 append — 없으면 만들고 끝에 한 줄 붙인다.
//
// 이 코드베이스에는 append 원시가 없다. `crate::fs::write_file`이 tmp→rename
// 원자적 전체 쓰기이고, 태스크 줄 수정(`write.rs`의 replace_line)도 "전체 읽기 →
// 메모리에서 고치기 → 전체 원자적 쓰기"로 한다. 같은 관용구를 따른다 — OS 레벨
// append를 들이면 그 원자성 보장이 깨진다.

use crate::task::TaskError;

/// `path` 끝에 `line` 한 줄을 붙인다. 파일이 없으면 부모 디렉터리까지 만들어
/// 생성한다. 그 파일의 줄바꿈 스타일과 끝 개행 유무를 보존한다.
/// 붙인 줄의 원문을 돌려준다.
pub async fn append_line(path: &str, line: &str) -> Result<String, TaskError> {
    append_lines(path, std::slice::from_ref(&line)).await?;
    Ok(line.to_string())
}

/// 여러 줄을 **한 번의 쓰기로** 붙인다. 아카이브(§312)가 한 대상 파일에 그 달의 줄을
/// 통째로 옮길 때 쓴다 — 줄마다 read/write를 반복하면 실패 창이 줄 수만큼 늘어나고,
/// 그 창 하나하나가 "붙었는데 못 지운" 중복을 만들 수 있다.
///
/// 빈 목록은 파일을 만들지도 건드리지도 않는다 — 그래야 옮길 것이 없는 달의 빈
/// `tasks/archive/YYYY-MM.md`가 생기지 않는다.
pub async fn append_lines(path: &str, lines: &[&str]) -> Result<(), TaskError> {
    if lines.iter().any(|l| l.contains('\n') || l.contains('\r')) {
        return Err(TaskError::Custom(
            "append_lines: a line must not contain a newline".to_string(),
        ));
    }
    if lines.is_empty() {
        return Ok(());
    }

    let existing = match tokio::fs::read_to_string(path).await {
        Ok(c) => Some(c),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(TaskError::Io(e)),
    };

    if existing.is_none() {
        if let Some(parent) = std::path::Path::new(path).parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
    }

    let content = existing.unwrap_or_default();
    // 파일이 이미 CRLF를 쓰면 새 줄도 CRLF로 끝낸다.
    let newline = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };

    let added: usize = lines.iter().map(|l| l.len() + 2).sum();
    let mut out = String::with_capacity(content.len() + added);
    out.push_str(&content);
    // 빈 파일에 앞 개행을 넣으면 첫 줄이 빈 줄이 된다. 내용이 있는데 끝 개행이
    // 없을 때만 넣는다.
    if !content.is_empty() && !content.ends_with('\n') {
        out.push_str(newline);
    }
    for line in lines {
        out.push_str(line);
        out.push_str(newline);
    }

    crate::fs::write_file(path, &out)
        .await
        .map_err(|e| TaskError::Custom(e.to_string()))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> String {
        let mut p = std::env::temp_dir();
        p.push(format!("baram-append-{}-{}.md", name, std::process::id()));
        p.to_string_lossy().to_string()
    }

    #[tokio::test]
    async fn creates_the_file_when_missing() {
        let p = tmp("missing");
        let _ = std::fs::remove_file(&p);
        append_line(&p, "- [ ] 우유 사기").await.unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "- [ ] 우유 사기\n");
        let _ = std::fs::remove_file(&p);
    }

    #[tokio::test]
    async fn appends_after_a_trailing_newline() {
        let p = tmp("trailing");
        std::fs::write(&p, "- [ ] 먼저\n").unwrap();
        append_line(&p, "- [ ] 나중").await.unwrap();
        assert_eq!(
            std::fs::read_to_string(&p).unwrap(),
            "- [ ] 먼저\n- [ ] 나중\n"
        );
        let _ = std::fs::remove_file(&p);
    }

    #[tokio::test]
    async fn adds_the_missing_newline_before_appending() {
        let p = tmp("nonewline");
        std::fs::write(&p, "- [ ] 먼저").unwrap();
        append_line(&p, "- [ ] 나중").await.unwrap();
        assert_eq!(
            std::fs::read_to_string(&p).unwrap(),
            "- [ ] 먼저\n- [ ] 나중\n"
        );
        let _ = std::fs::remove_file(&p);
    }

    #[tokio::test]
    async fn preserves_crlf() {
        let p = tmp("crlf");
        std::fs::write(&p, "- [ ] 먼저\r\n").unwrap();
        append_line(&p, "- [ ] 나중").await.unwrap();
        assert_eq!(
            std::fs::read_to_string(&p).unwrap(),
            "- [ ] 먼저\r\n- [ ] 나중\r\n"
        );
        let _ = std::fs::remove_file(&p);
    }

    #[tokio::test]
    async fn does_not_lead_an_empty_file_with_a_blank_line() {
        let p = tmp("empty");
        std::fs::write(&p, "").unwrap();
        append_line(&p, "- [ ] 하나").await.unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "- [ ] 하나\n");
        let _ = std::fs::remove_file(&p);
    }

    #[tokio::test]
    async fn returns_the_appended_line() {
        let p = tmp("ret");
        let _ = std::fs::remove_file(&p);
        let got = append_line(&p, "- [ ] 반환값").await.unwrap();
        assert_eq!(got, "- [ ] 반환값");
        let _ = std::fs::remove_file(&p);
    }

    #[tokio::test]
    async fn appends_several_lines_in_order_with_one_write() {
        let p = tmp("many");
        std::fs::write(&p, "머리말\n").unwrap();
        append_lines(&p, &["- [x] 하나", "- [x] 둘"]).await.unwrap();
        assert_eq!(
            std::fs::read_to_string(&p).unwrap(),
            "머리말\n- [x] 하나\n- [x] 둘\n"
        );
        let _ = std::fs::remove_file(&p);
    }

    #[tokio::test]
    async fn appends_several_lines_with_the_files_crlf() {
        let p = tmp("many-crlf");
        std::fs::write(&p, "머리말\r\n").unwrap();
        append_lines(&p, &["- [x] 하나", "- [x] 둘"]).await.unwrap();
        assert_eq!(
            std::fs::read_to_string(&p).unwrap(),
            "머리말\r\n- [x] 하나\r\n- [x] 둘\r\n"
        );
        let _ = std::fs::remove_file(&p);
    }

    #[tokio::test]
    async fn an_empty_list_does_not_create_the_file() {
        // 옮길 것이 없는 달에 빈 `Archive/YYYY-MM.md`를 만들지 않기 위한 계약.
        let p = tmp("emptylist");
        let _ = std::fs::remove_file(&p);
        append_lines(&p, &[]).await.unwrap();
        assert!(!std::path::Path::new(&p).exists());
    }

    #[tokio::test]
    async fn rejects_a_multi_line_argument() {
        let p = tmp("multi");
        let _ = std::fs::remove_file(&p);
        assert!(append_line(&p, "- [ ] 하나\n- [ ] 둘").await.is_err());
        assert!(!std::path::Path::new(&p).exists());
    }
}
