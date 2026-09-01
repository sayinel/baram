// §304 Vault-wide task index
mod append;
mod archive;
mod fields;
mod parse;
mod tag;
mod write;

pub use append::{append_line, append_lines};
pub use archive::{archive_tasks, ArchiveItem, ArchiveOutcome};
pub use parse::normalize_line;
pub use parse::{parse_task_line, TaskState};
pub use tag::{apply_tag, set_task_tag};
pub use write::{apply_field, apply_state, delete_line, set_task_field, set_task_state};

use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TaskError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("stale")]
    Stale,
    #[error("{0}")]
    Custom(String),
}

/// 한 줄의 태스크. `raw`는 §305 낙관적 잠금의 비교 기준이다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEntry {
    pub path: String,
    pub line: u32,
    pub indent: u8,
    pub state: TaskState,
    pub text: String,
    pub raw: String,
    pub created: Option<String>,
    pub start: Option<String>,
    pub scheduled: Option<String>,
    pub due: Option<String>,
    pub done: Option<String>,
    pub cancelled: Option<String>,
    pub priority: i8,
    pub recurrence: Option<String>,
    /// §18.18 M4 `⏱` 값 그대로 — 해석은 프런트 `task-timer.ts`가 한다.
    pub timer: Option<String>,
    pub links: Vec<String>,
    pub tags: Vec<String>,
}

use crate::md::{split_frontmatter, strip_code_blocks};
use std::path::{Path, PathBuf};

/// 프론트매터 줄 수만큼 앞을 비워 원본 라인 번호를 보존한 본문을 만든다.
fn body_aligned_with_source(content: &str) -> String {
    let (fm, body) = split_frontmatter(content);
    if fm.is_empty() {
        return strip_code_blocks(&body);
    }
    // split_frontmatter는 body를 `rest[end + 4..]`로 자르므로 **선행 \n을 이미 포함**한다.
    // 따라서 채울 것은 여는 "---" 한 줄 + 프론트매터 줄 수뿐이다(닫는 "---"는 그 \n이 담당).
    //   ---\ntags: [a]\n---\nbody  →  body="\nbody", 정답 index 3, offset=1+1=2
    let offset = fm.lines().count() + 1;
    let mut out = "\n".repeat(offset);
    out.push_str(&strip_code_blocks(&body));
    out
}

/// `path`는 **절대 경로**다 — 워처 이벤트(`file:changed`)가 절대 경로를 주므로
/// 스토어의 증분 교체(`replaceFile`)가 매칭되려면 전 경로가 같은 형태여야 한다.
fn tasks_in_content(path: &str, content: &str) -> Vec<TaskEntry> {
    let source_lines: Vec<&str> = content.lines().collect();
    body_aligned_with_source(content)
        .lines()
        .enumerate()
        .filter_map(|(i, line)| {
            let p = parse_task_line(line)?;
            Some(TaskEntry {
                path: path.to_string(),
                line: i as u32,
                indent: p.indent,
                state: p.state,
                text: p.text,
                raw: source_lines.get(i).unwrap_or(&"").to_string(),
                created: p.created,
                start: p.start,
                scheduled: p.scheduled,
                due: p.due,
                done: p.done,
                cancelled: p.cancelled,
                priority: p.priority,
                recurrence: p.recurrence,
                timer: p.timer,
                links: p.links,
                tags: p.tags,
            })
        })
        .collect()
}

fn is_excluded(rel: &str, exclude: &[String]) -> bool {
    exclude.iter().any(|e| {
        let e = e.trim_end_matches('/');
        !e.is_empty() && (rel == e || rel.starts_with(&format!("{}/", e)))
    })
}

/// `root` 기준 상대 경로 문자열(제외 판정 전용) — 구분자를 `/`로 정규화한다.
/// vault 전체 스캔과 증분 갱신(`get_file_tasks`)이 같은 판정을 공유하도록 뽑아 뒀다(I1).
fn rel_to_root(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

async fn collect(root: &Path, exclude: &[String]) -> Result<Vec<TaskEntry>, TaskError> {
    let mut files: Vec<PathBuf> = Vec::new();
    crate::fs::collect_md_files(root, &mut files)
        .await
        .map_err(|e| TaskError::Custom(e.to_string()))?;

    let mut out = Vec::new();
    for file in &files {
        // 상대 경로는 제외 판정에만 쓴다. 엔트리에 담기는 것은 절대 경로다.
        if is_excluded(&rel_to_root(file, root), exclude) {
            continue;
        }
        let Ok(content) = tokio::fs::read_to_string(file).await else {
            continue;
        };
        out.extend(tasks_in_content(&file.to_string_lossy(), &content));
    }
    Ok(out)
}

pub async fn get_vault_tasks(
    root_path: &str,
    exclude: &[String],
) -> Result<Vec<TaskEntry>, TaskError> {
    let root = PathBuf::from(root_path);
    if !root.exists() {
        return Err(TaskError::Custom(format!(
            "Path does not exist: {}",
            root_path
        )));
    }
    collect(&root, exclude).await
}

/// 증분 갱신용 — 파일 하나만 다시 읽는다. `path`는 절대 경로.
/// `root_path`가 주어지면 vault 전체 스캔과 같은 `is_excluded` 규칙을 적용한다 —
/// 그러지 않으면 exclude 설정이 워처 기반 증분 경로에서만 조용히 무시된다(I1).
pub async fn get_file_tasks(
    path: &str,
    root_path: Option<&str>,
    exclude: &[String],
) -> Result<Vec<TaskEntry>, TaskError> {
    if let Some(root) = root_path {
        if is_excluded(&rel_to_root(Path::new(path), Path::new(root)), exclude) {
            return Ok(Vec::new());
        }
    }
    let content = tokio::fs::read_to_string(path).await?;
    Ok(tasks_in_content(path, &content))
}

pub async fn get_tasks_linking_to(
    root_path: &str,
    target: &str,
    exclude: &[String],
) -> Result<Vec<TaskEntry>, TaskError> {
    let all = get_vault_tasks(root_path, exclude).await?;
    Ok(all
        .into_iter()
        .filter(|t| t.links.iter().any(|l| l == target))
        .collect())
}

#[cfg(test)]
mod scan_tests {
    use super::*;
    use tempfile::TempDir;

    async fn write(dir: &TempDir, name: &str, body: &str) -> String {
        let p = dir.path().join(name);
        if let Some(parent) = p.parent() {
            tokio::fs::create_dir_all(parent).await.unwrap();
        }
        tokio::fs::write(&p, body).await.unwrap();
        p.to_string_lossy().to_string()
    }

    #[tokio::test]
    async fn scans_tasks_across_the_vault() {
        let d = TempDir::new().unwrap();
        write(&d, "a.md", "# A\n- [ ] 하나 📅2026-08-30\n- [x] 둘\n").await;
        write(&d, "sub/b.md", "- [ ] 셋\n").await;

        let tasks = get_vault_tasks(d.path().to_str().unwrap(), &[])
            .await
            .unwrap();
        assert_eq!(tasks.len(), 3);
        assert!(tasks
            .iter()
            .any(|t| t.text == "하나" && t.due.as_deref() == Some("2026-08-30")));
    }

    #[tokio::test]
    async fn ignores_checkboxes_inside_code_fences() {
        let d = TempDir::new().unwrap();
        write(&d, "a.md", "- [ ] 진짜\n\n```md\n- [ ] 예시일 뿐\n```\n").await;

        let tasks = get_vault_tasks(d.path().to_str().unwrap(), &[])
            .await
            .unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].text, "진짜");
    }

    #[tokio::test]
    async fn ignores_checkbox_like_lines_in_frontmatter() {
        let d = TempDir::new().unwrap();
        write(
            &d,
            "a.md",
            "---\nlist:\n  - [ ] not a task\n---\n- [ ] 진짜\n",
        )
        .await;

        let tasks = get_vault_tasks(d.path().to_str().unwrap(), &[])
            .await
            .unwrap();
        assert_eq!(tasks.len(), 1);
    }

    #[tokio::test]
    async fn reports_zero_based_line_numbers_of_the_original_file() {
        let d = TempDir::new().unwrap();
        write(&d, "a.md", "# 제목\n\n- [ ] 셋째 줄\n").await;

        let tasks = get_vault_tasks(d.path().to_str().unwrap(), &[])
            .await
            .unwrap();
        assert_eq!(tasks[0].line, 2);
        assert_eq!(tasks[0].raw, "- [ ] 셋째 줄");
    }

    #[tokio::test]
    async fn honours_the_exclude_list() {
        let d = TempDir::new().unwrap();
        write(&d, "keep.md", "- [ ] 남김\n").await;
        write(&d, "archive/old.md", "- [ ] 제외\n").await;

        let tasks = get_vault_tasks(d.path().to_str().unwrap(), &["archive".to_string()])
            .await
            .unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].text, "남김");
    }

    #[tokio::test]
    async fn filters_by_link_target() {
        let d = TempDir::new().unwrap();
        write(
            &d,
            "a.md",
            "- [ ] 걸림 [[202607051530]]\n- [ ] 안걸림 [[999]]\n",
        )
        .await;

        let tasks = get_tasks_linking_to(d.path().to_str().unwrap(), "202607051530", &[])
            .await
            .unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].text, "걸림 [[202607051530]]");
    }

    #[tokio::test]
    async fn reports_absolute_paths_identically_from_both_entry_points() {
        // 워처 증분 갱신이 전체 스캔 결과를 교체하려면 두 경로 형태가 같아야 한다.
        let d = TempDir::new().unwrap();
        let abs = write(&d, "a.md", "- [ ] 하나\n").await;

        let from_vault = get_vault_tasks(d.path().to_str().unwrap(), &[])
            .await
            .unwrap();
        let from_file = get_file_tasks(&abs, None, &[]).await.unwrap();

        assert_eq!(from_vault[0].path, from_file[0].path);
        assert!(from_vault[0].path.ends_with("a.md"));
        assert!(std::path::Path::new(&from_vault[0].path).is_absolute());
    }

    #[tokio::test]
    async fn scans_a_single_file() {
        let d = TempDir::new().unwrap();
        let p = write(&d, "a.md", "- [ ] 하나\n- [ ] 둘\n").await;

        let tasks = get_file_tasks(&p, None, &[]).await.unwrap();
        assert_eq!(tasks.len(), 2);
    }

    #[tokio::test]
    async fn get_file_tasks_honours_the_exclude_list_like_the_vault_scan() {
        // I1: 워처가 부르는 증분 경로가 vault 전체 스캔과 다른 규칙을 쓰면 exclude
        // 설정이 조용히 무력화된다 — 마운트 시 한 번 걸러지고, 이후 그 파일이
        // 바뀔 때마다 캐시에 도로 들어온다.
        let d = TempDir::new().unwrap();
        let p = write(&d, "archive/old.md", "- [ ] 제외\n").await;
        let root = d.path().to_str().unwrap();

        let tasks = get_file_tasks(&p, Some(root), &["archive".to_string()])
            .await
            .unwrap();
        assert_eq!(tasks.len(), 0);
    }

    #[tokio::test]
    async fn get_file_tasks_exclude_ignores_a_trailing_slash_on_the_entry() {
        let d = TempDir::new().unwrap();
        let p = write(&d, "archive/old.md", "- [ ] 제외\n").await;
        let root = d.path().to_str().unwrap();

        let tasks = get_file_tasks(&p, Some(root), &["archive/".to_string()])
            .await
            .unwrap();
        assert_eq!(tasks.len(), 0);
    }

    #[tokio::test]
    async fn get_file_tasks_exclude_matches_a_nested_path() {
        let d = TempDir::new().unwrap();
        let p = write(&d, "archive/2026/old.md", "- [ ] 제외\n").await;
        let root = d.path().to_str().unwrap();

        let tasks = get_file_tasks(&p, Some(root), &["archive".to_string()])
            .await
            .unwrap();
        assert_eq!(tasks.len(), 0);
    }

    #[tokio::test]
    async fn get_file_tasks_exclude_does_not_match_a_prefix_collision() {
        // "archive"를 제외해도 "archived-notes/"는 별개 디렉터리다 — 문자열
        // prefix가 아니라 경로 세그먼트 경계로 판정해야 한다.
        let d = TempDir::new().unwrap();
        let p = write(&d, "archived-notes/keep.md", "- [ ] 남김\n").await;
        let root = d.path().to_str().unwrap();

        let tasks = get_file_tasks(&p, Some(root), &["archive".to_string()])
            .await
            .unwrap();
        assert_eq!(tasks.len(), 1);
    }

    /// 리스크 2 측정용. 평소 CI에서는 건너뛴다.
    /// 실행: cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture scan_10k
    #[tokio::test]
    #[ignore]
    async fn scan_10k_files_timing() {
        let d = TempDir::new().unwrap();
        for i in 0..10_000 {
            let body = format!(
                "---\ntags: [t{}]\n---\n# 문서 {}\n\n본문 한 줄.\n\n- [ ] 할 일 {} 📅2026-08-30 ⏫\n- [x] 끝난 것 {} ✅2026-08-01\n",
                i % 50, i, i, i
            );
            write(&d, &format!("d{}/f{}.md", i % 100, i), &body).await;
        }

        let started = std::time::Instant::now();
        let tasks = get_vault_tasks(d.path().to_str().unwrap(), &[])
            .await
            .unwrap();
        let elapsed = started.elapsed();

        println!("scanned {} tasks in {:?}", tasks.len(), elapsed);
        assert_eq!(tasks.len(), 20_000);
    }

    /// §312.1 측정용 — 아젠다 스캔 범위 "전체"(열려 있는 vault 모두)의 비용.
    ///
    /// 기본 범위를 "전체"로 정했으므로(§18.7.1) 이 숫자가 그 기본값이 예산 안인지를
    /// 답한다. `collect`는 파일을 하나씩 `await`로 읽는 **완전 순차** 구현이라 루트가
    /// N개면 그대로 N배가 예상값이고, 그 예상이 맞는지와 **동시 실행이 그것을 깎는지**를
    /// 함께 잰다. 프런트가 `Promise.all`로 부르면 IPC 호출 N개가 동시에 뜨므로
    /// concurrent 쪽이 실제로 벌어질 일이다.
    ///
    /// ‼️ 반드시 릴리스로 잴 것 — 디버그 프로파일은 정규식·문자열 처리가 한 자릿수 배
    /// 느려 판단을 뒤집는다(리스크 2와 같은 이유).
    /// 실행: cargo test --release --manifest-path src-tauri/Cargo.toml \
    ///         -- --ignored --nocapture scan_multi_root
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn scan_multi_root_timing() {
        const ROOTS: usize = 3;
        const FILES_PER_ROOT: usize = 10_000;

        let dirs: Vec<TempDir> = (0..ROOTS).map(|_| TempDir::new().unwrap()).collect();
        for d in &dirs {
            for i in 0..FILES_PER_ROOT {
                let body = format!(
                    "---\ntags: [t{}]\n---\n# 문서 {}\n\n본문 한 줄.\n\n- [ ] 할 일 {} 📅2026-08-30 ⏫\n- [x] 끝난 것 {} ✅2026-08-01\n",
                    i % 50, i, i, i
                );
                write(d, &format!("d{}/f{}.md", i % 100, i), &body).await;
            }
        }
        let roots: Vec<String> = dirs
            .iter()
            .map(|d| d.path().to_string_lossy().to_string())
            .collect();

        // ── 기준선: 루트 하나 ────────────────────────────────────────────
        let started = std::time::Instant::now();
        let one = get_vault_tasks(&roots[0], &[]).await.unwrap();
        let single = started.elapsed();
        println!("[1 root ] {} tasks in {:?}", one.len(), single);

        // ── 순차: 프런트가 for-await로 부를 때 ───────────────────────────
        let started = std::time::Instant::now();
        let mut total = 0usize;
        for root in &roots {
            total += get_vault_tasks(root, &[]).await.unwrap().len();
        }
        let sequential = started.elapsed();
        println!("[{} seq ] {} tasks in {:?}", ROOTS, total, sequential);

        // ── 동시: 프런트가 Promise.all로 부를 때 ─────────────────────────
        let started = std::time::Instant::now();
        let handles: Vec<_> = roots
            .iter()
            .map(|root| {
                let root = root.clone();
                tokio::spawn(async move { get_vault_tasks(&root, &[]).await.unwrap().len() })
            })
            .collect();
        let mut total_concurrent = 0usize;
        for h in handles {
            total_concurrent += h.await.unwrap();
        }
        let concurrent = started.elapsed();
        println!(
            "[{} conc] {} tasks in {:?}",
            ROOTS, total_concurrent, concurrent
        );

        println!(
            "--- 순차/기준선 = {:.2}배, 동시/기준선 = {:.2}배, 동시가 순차 대비 {:.2}배",
            sequential.as_secs_f64() / single.as_secs_f64(),
            concurrent.as_secs_f64() / single.as_secs_f64(),
            sequential.as_secs_f64() / concurrent.as_secs_f64(),
        );

        assert_eq!(one.len(), FILES_PER_ROOT * 2);
        assert_eq!(total, ROOTS * FILES_PER_ROOT * 2);
        assert_eq!(total_concurrent, total);
    }
}
