// §312 아카이브 — 완료 태스크를 **태스크 전용 파일에서만** `Archive/YYYY-MM.md`로 옮긴다.
//
// 이 모듈은 이 코드베이스에서 **줄을 파일 사이로 옮기는 첫 조작**이다. 지금까지의 태스크
// 쓰기는 전부 한 파일 안이었고 `expected_raw` 낙관적 잠금 하나로 충분했다. 이동은 "붙이기 +
// 지우기" 두 번의 쓰기라 중간에 죽으면 상태가 갈리므로, 순서 자체가 설계다:
//
//   1. 원본을 읽고 **모든** 잠금을 먼저 검증한다 — 어긋난 항목은 아무 파일도 건드리지 않고 빠진다.
//   2. 대상 파일에 **붙인다**(대상마다 한 번의 쓰기).
//   3. **붙는 데 성공한 줄만** 원본에서 지운다(원본마다 한 번의 쓰기).
//
// 순서를 뒤집으면(지우기 먼저) 중간 실패의 최악이 **소실**이다. 이 순서에서 최악은
// **중복**이고, 중복은 눈에 보이고 사용자가 지울 수 있다. 태스크 줄 삭제는 되돌릴 통로가
// 없으므로(스냅샷 §71은 파일 단위이고 이 경로를 타지 않는다) 그 비대칭이 순서를 정한다.
//
// ‼️ 불가침 규칙(§312): 이동은 수집함·`Archive/*`에서만 일어난다. 일반 문서 안의 완료
// 태스크는 문맥의 일부라 뽑아 가면 문서가 훼손된다. 화이트리스트 **밖의 경로가 하나라도
// 인자에 있으면 파일을 하나도 건드리지 않고 거절한다** — 블랙리스트가 아니라 화이트리스트다.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::task::parse::{is_valid_date, parse_task_line};
use crate::task::write::{matches_expected, splice_out, split_keeping_eol, strip_eol};
use crate::task::{append_lines, TaskError, TaskState};

/// 아카이브 대상 폴더 — 활성 컨텍스트 루트 기준. §312가 `Archive/YYYY-MM.md`로 고정한다.
/// TypeScript 쪽 `ARCHIVE_DIR`(src/utils/tasks/task-archive.ts)과 **같은 글자**여야 한다.
pub const ARCHIVE_DIR: &str = "Archive";

/// 옮길 줄 하나 — 프런트가 인덱스에서 그대로 집어 보낸다.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveItem {
    pub path: String,
    pub line: u32,
    pub expected_raw: String,
}

/// 실행 회계. 넷을 합치지 않는 이유는 §309 배치와 같다 — `stale`은 정상 경합이고
/// `failed`는 사고다. 뭉뚱그리면 흔한 경합이 오류처럼 보인다.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveOutcome {
    /// 실제로 옮겨진 줄 수.
    pub archived: u32,
    /// 자격 미달로 그냥 둔 줄 — 경과일 미달, `✅` 없음, 들여쓴 항목, 이미 제자리.
    pub skipped: u32,
    /// 그 사이 파일이 바뀌어 건너뛴 줄. 오류가 아니다.
    pub stale: u32,
    /// I/O 실패로 옮기지 못한 줄.
    pub failed: u32,
    /// 바이트가 바뀐 파일 전부(원본 + 대상) — 호출자가 이만큼만 다시 읽는다.
    pub paths: Vec<String>,
}

/// 자격 판정의 결과. `Move`가 든 `month`가 곧 대상 파일 이름이다.
#[derive(Debug, PartialEq)]
pub(super) enum Verdict {
    Move { month: String },
    Skip,
}

/// 완료 태스크를 `Archive/YYYY-MM.md`로 옮긴다.
///
/// `today`는 프런트가 로컬 시간대로 계산해 넘긴다 — Rust가 시간대를 추측하지 않는다
/// (`set_task_state`와 같은 계약).
///
/// 화이트리스트 위반은 `Err`다. 그 밖의 실패는 항목별로 회계에 담아 계속 진행한다 —
/// 한 파일의 권한 문제가 나머지 전부를 막지 않는다.
pub async fn archive_tasks(
    root: &str,
    capture_path: &str,
    items: &[ArchiveItem],
    today: &str,
    after_days: u32,
) -> Result<ArchiveOutcome, TaskError> {
    if !is_valid_date(today) {
        return Err(TaskError::Custom(format!(
            "archive: invalid today: {}",
            today
        )));
    }
    let root = norm(root);
    let capture = norm(capture_path);
    // 프런트가 이미 `resolveCapturePath`로 만든 경로다. 여기서 다시 만들지 않고
    // **검증만** 한다 — 해석기를 두 벌 두면 갈라지지만, 부분집합 단정은 갈라질 수 없다.
    if !is_under(&capture, &root) || !capture.ends_with(".md") {
        return Err(TaskError::Custom(format!(
            "archive: capture file is not a markdown file inside the vault: {}",
            capture
        )));
    }
    let archive_root = format!("{}/{}", root, ARCHIVE_DIR);

    // ‼️ 쓰기 **전에** 전부 본다. 한 항목이라도 밖이면 파일을 하나도 건드리지 않는다.
    for item in items {
        if !is_archive_source(&item.path, &capture, &archive_root) {
            return Err(TaskError::Custom(format!(
                "archive: refusing to move a line out of a regular document: {}",
                item.path
            )));
        }
    }

    // 원본 파일별로 모은다. BTreeMap이라 순서가 결정적이다 — 회계와 `paths`가 실행마다
    // 같아야 테스트가 무엇을 고정하는지 말할 수 있다.
    let mut by_source: BTreeMap<String, Vec<&ArchiveItem>> = BTreeMap::new();
    for item in items {
        by_source.entry(norm(&item.path)).or_default().push(item);
    }

    let mut outcome = ArchiveOutcome::default();
    for (source, group) in by_source {
        drain_one_file(&source, &group, &root, today, after_days, &mut outcome).await;
    }
    Ok(outcome)
}

/// 원본 한 파일의 배수 — 검증 → 붙이기 → 지우기.
async fn drain_one_file(
    source: &str,
    group: &[&ArchiveItem],
    root: &str,
    today: &str,
    after_days: u32,
    outcome: &mut ArchiveOutcome,
) {
    let content = match tokio::fs::read_to_string(source).await {
        Ok(c) => c,
        Err(e) => {
            log::error!("[task] archive: cannot read {}: {}", source, e);
            outcome.failed += group.len() as u32;
            return;
        }
    };
    let parts = split_keeping_eol(&content);

    // 대상 파일 → (원본 줄 번호, 옮길 원문). 붙이기가 대상마다 한 번의 쓰기가 되도록 모은다.
    let mut movers: BTreeMap<String, Vec<(usize, &str)>> = BTreeMap::new();
    for item in group {
        let idx = item.line as usize;
        let Some(part) = parts.get(idx) else {
            outcome.stale += 1;
            continue;
        };
        let raw = strip_eol(part);
        // 잠금이 먼저다. 자격 판정보다 앞에 두어야 "그 사이 바뀐 줄"이 자격 판정에
        // 걸리는 일이 없다 — 지금 파일에 있는 다른 줄을 옮기게 된다.
        if !matches_expected(raw, &item.expected_raw) {
            outcome.stale += 1;
            continue;
        }
        let Verdict::Move { month } = archive_verdict(raw, today, after_days) else {
            outcome.skipped += 1;
            continue;
        };
        let dest = format!("{}/{}/{}.md", root, ARCHIVE_DIR, month);
        // 이미 제자리인 줄은 옮기지 않는다. 자기 파일에 붙였다가 지우면 줄이 파일
        // 끝으로 이사만 하고, 실행할 때마다 순서가 바뀐다.
        if dest == source {
            outcome.skipped += 1;
            continue;
        }
        movers.entry(dest).or_default().push((idx, raw));
    }

    // ── 2. 붙이기 ──────────────────────────────────────────────────────────
    let mut drop: Vec<usize> = Vec::new();
    for (dest, lines) in &movers {
        let raws: Vec<&str> = lines.iter().map(|(_, raw)| *raw).collect();
        match append_lines(dest, &raws).await {
            Ok(()) => {
                outcome.paths.push(dest.clone());
                drop.extend(lines.iter().map(|(idx, _)| *idx));
            }
            Err(e) => {
                // 붙이지 못한 줄은 지우지 않는다 — 이 한 줄이 "붙이기 먼저"가 지키는
                // 불변식 전부다. 대상 하나가 실패해도 다른 달은 그대로 옮겨진다.
                log::error!("[task] archive: cannot append to {}: {}", dest, e);
                outcome.failed += lines.len() as u32;
            }
        }
    }
    if drop.is_empty() {
        return;
    }

    // ── 3. 지우기 ──────────────────────────────────────────────────────────
    let out = splice_out(&parts, &drop);
    match crate::fs::write_file(source, &out).await {
        Ok(()) => {
            outcome.archived += drop.len() as u32;
            outcome.paths.push(source.to_string());
        }
        Err(e) => {
            // 여기가 이 설계가 받아들인 최악이다: 붙었는데 못 지웠으니 그 줄은 **두 곳에**
            // 있다. 소실이 아니므로 사용자가 지울 수 있지만 조용히 넘기면 안 된다.
            log::error!(
                "[task] archive: appended {} line(s) but could not rewrite {} — they now exist in both places: {}",
                drop.len(),
                source,
                e
            );
            outcome.failed += drop.len() as u32;
        }
    }
}

/// 이 줄을 옮겨도 되는가. 순수 함수 — I/O도 경로도 보지 않는다.
///
/// TypeScript 쪽 `isArchivable`(src/utils/tasks/task-archive.ts)과 **같은 표**다.
/// 프런트는 개수를 세어 확인 문구를 짓고 여기는 그 판정을 다시 강제한다. 두 벌인 이유는
/// 언어 경계뿐이므로, 양쪽 테스트가 같은 줄을 단정해 어느 쪽을 고쳐도 다른 쪽이 빨간불이 된다.
pub(super) fn archive_verdict(line: &str, today: &str, after_days: u32) -> Verdict {
    let Some(task) = parse_task_line(line) else {
        return Verdict::Skip;
    };
    // 들여쓴 항목은 대상이 아니다. 부모를 뽑으면 자식이 고아가 되고, 자식을 뽑으면
    // 부모의 목록이 끊긴다 — 화이트리스트 파일 안이라도 그것은 구조 훼손이다.
    // 수집함과 우리가 만드는 아카이브 파일은 평평하므로 이 규칙이 잃는 것이 없다.
    if task.indent != 0 || task.state != TaskState::Done {
        return Verdict::Skip;
    }
    // `✅` 날짜가 없으면 며칠 지났는지 알 방법이 없다(`TaskEntry`에 mtime이 없다 — §18.7).
    // 나이를 모르는 줄을 "충분히 오래됐다"고 가정하지 않는다.
    let Some(done) = task.done.as_deref().filter(|d| is_valid_date(d)) else {
        return Verdict::Skip;
    };
    match days_between(done, today) {
        Some(days) if days >= i64::from(after_days) => Verdict::Move {
            month: done[..7].to_string(),
        },
        _ => Verdict::Skip,
    }
}

/// 이 경로에서 줄을 뽑아도 되는가 — §312 불가침 규칙의 화이트리스트.
pub(super) fn is_archive_source(path: &str, capture: &str, archive_root: &str) -> bool {
    let p = norm(path);
    p == capture || is_under(&p, archive_root)
}

/// 두 ISO 날짜 사이의 일수(`to` − `from`). 어느 한쪽이 실재하지 않는 날짜면 `None`.
pub(super) fn days_between(from: &str, to: &str) -> Option<i64> {
    Some(to_days(to)? - to_days(from)?)
}

/// `path`가 `dir` **아래**인가. `dir` 자신은 포함하지 않는다.
/// 세그먼트 경계까지 보므로 `/vault/Archived`가 `/vault/Archive`에 걸리지 않는다.
fn is_under(path: &str, dir: &str) -> bool {
    path.len() > dir.len() + 1
        && path.starts_with(dir)
        && path.as_bytes().get(dir.len()) == Some(&b'/')
}

/// 경로 비교용 정규화 — 구분자를 `/`로 맞추고 끝 구분자를 뗀다.
/// `task/mod.rs`의 `rel_to_root`와 같은 규칙이다.
fn norm(path: &str) -> String {
    let p = path.replace('\\', "/");
    let trimmed = p.trim_end_matches('/');
    if trimmed.is_empty() {
        p
    } else {
        trimmed.to_string()
    }
}

/// ISO 날짜 → 그레고리력 일련번호(1970-01-01 = 0). Howard Hinnant의 `days_from_civil`.
/// chrono를 들이지 않는 이유는 이 한 함수가 이 크레이트가 필요로 하는 날짜 산술 전부이기 때문이다.
fn to_days(iso: &str) -> Option<i64> {
    if !is_valid_date(iso) {
        return None;
    }
    let y: i64 = iso[..4].parse().ok()?;
    let m: i64 = iso[5..7].parse().ok()?;
    let d: i64 = iso[8..10].parse().ok()?;

    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    Some(era * 146_097 + doe - 719_468)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const TODAY: &str = "2026-08-27";

    struct Vault {
        _dir: TempDir,
        root: String,
    }

    impl Vault {
        fn new() -> Self {
            let dir = TempDir::new().unwrap();
            let root = dir.path().to_string_lossy().to_string();
            Self { _dir: dir, root }
        }

        fn at(&self, rel: &str) -> String {
            format!("{}/{}", self.root, rel)
        }

        fn inbox(&self) -> String {
            self.at("Inbox.md")
        }

        fn read(&self, rel: &str) -> String {
            std::fs::read_to_string(self.at(rel)).unwrap()
        }

        fn write(&self, rel: &str, body: &str) -> String {
            let path = self.at(rel);
            if let Some(parent) = std::path::Path::new(&path).parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(&path, body).unwrap();
            path
        }
    }

    fn item(path: &str, line: u32, raw: &str) -> ArchiveItem {
        ArchiveItem {
            path: path.to_string(),
            line,
            expected_raw: raw.to_string(),
        }
    }

    async fn run(v: &Vault, items: &[ArchiveItem]) -> Result<ArchiveOutcome, TaskError> {
        archive_tasks(&v.root, &v.inbox(), items, TODAY, 30).await
    }

    // ── §312 불가침 규칙 (설계 문서 18.16의 네 테스트) ────────────────────────

    #[tokio::test]
    async fn moves_an_aged_done_task_out_of_the_inbox() {
        let v = Vault::new();
        let raw = "- [x] 세금 신고 ✅2026-07-04";
        let inbox = v.write("Inbox.md", &format!("- [ ] 남을 것\n{}\n", raw));

        let out = run(&v, &[item(&inbox, 1, raw)]).await.unwrap();

        assert_eq!(out.archived, 1);
        assert_eq!(v.read("Inbox.md"), "- [ ] 남을 것\n");
        assert_eq!(v.read("Archive/2026-07.md"), format!("{}\n", raw));
    }

    #[tokio::test]
    async fn a_done_task_in_a_regular_document_stays_exactly_where_it_is() {
        // §18.18 리스크 6 — 가장 파괴적인 실패 모드. 화이트리스트 밖이면 거절이고,
        // 거절은 **아무 파일도 건드리지 않는다**.
        let v = Vault::new();
        let raw = "- [x] 이 절에 그림 넣기 ✅2026-07-04";
        let before = format!("# 문서\n\n{}\n\n본문이 이어진다.\n", raw);
        let doc = v.write("notes/설계.md", &before);

        let err = run(&v, &[item(&doc, 2, raw)]).await.unwrap_err();

        assert!(err.to_string().contains("regular document"), "{}", err);
        assert_eq!(v.read("notes/설계.md"), before);
        assert!(!std::path::Path::new(&v.at("Archive")).exists());
    }

    #[tokio::test]
    async fn a_task_finished_too_recently_does_not_move() {
        let v = Vault::new();
        // 29일 전 — 문턱이 30이므로 아직 아니다.
        let raw = "- [x] 어제 일 ✅2026-07-29";
        let inbox = v.write("Inbox.md", &format!("{}\n", raw));

        let out = run(&v, &[item(&inbox, 0, raw)]).await.unwrap();

        assert_eq!((out.archived, out.skipped), (0, 1));
        assert_eq!(v.read("Inbox.md"), format!("{}\n", raw));
        assert!(!std::path::Path::new(&v.at("Archive")).exists());
    }

    #[tokio::test]
    async fn one_path_outside_the_whitelist_rejects_the_whole_batch() {
        // 나머지가 전부 적법해도 거절이다. 부분 실행이면 사용자는 "일부는 옮겨졌고
        // 일부는 아니다"를 화면 어디에서도 볼 수 없다.
        let v = Vault::new();
        let good = "- [x] 수집함 것 ✅2026-07-04";
        let bad = "- [x] 문서 것 ✅2026-07-04";
        let inbox = v.write("Inbox.md", &format!("{}\n", good));
        let doc = v.write("notes/설계.md", &format!("{}\n", bad));

        let err = run(&v, &[item(&inbox, 0, good), item(&doc, 0, bad)])
            .await
            .unwrap_err();

        assert!(err.to_string().contains("regular document"), "{}", err);
        assert_eq!(v.read("Inbox.md"), format!("{}\n", good));
        assert_eq!(v.read("notes/설계.md"), format!("{}\n", bad));
    }

    // ── 붙이기 먼저 ───────────────────────────────────────────────────────

    #[tokio::test]
    async fn a_line_that_could_not_be_appended_is_not_deleted() {
        // 이 설계 전체가 서 있는 불변식. `Archive`를 **파일로** 만들어 두면 대상
        // 디렉터리 생성이 실패하므로 붙이기가 실패한다. 순서를 뒤집으면(지우기 먼저)
        // 이 줄은 어디에도 남지 않는다.
        let v = Vault::new();
        let raw = "- [x] 세금 신고 ✅2026-07-04";
        let inbox = v.write("Inbox.md", &format!("{}\n", raw));
        v.write("Archive", "여기는 폴더가 아니라 파일이다\n");

        let out = run(&v, &[item(&inbox, 0, raw)]).await.unwrap();

        assert_eq!((out.archived, out.failed), (0, 1));
        assert_eq!(v.read("Inbox.md"), format!("{}\n", raw));
        assert!(out.paths.is_empty());
    }

    #[tokio::test]
    async fn a_destination_that_fails_does_not_hold_back_the_other_months() {
        // 대상별로 회계가 갈린다 — 7월이 막혀도 8월은 옮겨진다.
        let v = Vault::new();
        let july = "- [x] 7월 것 ✅2026-07-04";
        let june = "- [x] 6월 것 ✅2026-06-04";
        let inbox = v.write("Inbox.md", &format!("{}\n{}\n", june, july));
        // 7월 대상 자리에 **디렉터리**를 두면 그 파일 쓰기만 실패한다.
        std::fs::create_dir_all(v.at("Archive/2026-07.md")).unwrap();

        let out = run(&v, &[item(&inbox, 0, june), item(&inbox, 1, july)])
            .await
            .unwrap();

        assert_eq!((out.archived, out.failed), (1, 1));
        assert_eq!(v.read("Inbox.md"), format!("{}\n", july));
        assert_eq!(v.read("Archive/2026-06.md"), format!("{}\n", june));
    }

    // ── 자격 판정 ─────────────────────────────────────────────────────────

    #[tokio::test]
    async fn an_indented_task_is_never_moved() {
        // 부모를 뽑으면 자식이 고아가 되고, 자식을 뽑으면 부모의 목록이 끊긴다.
        let v = Vault::new();
        let child = "  - [x] 하위 항목 ✅2026-07-04";
        let before = format!("- [ ] 부모\n{}\n", child);
        let inbox = v.write("Inbox.md", &before);

        let out = run(&v, &[item(&inbox, 1, child)]).await.unwrap();

        assert_eq!((out.archived, out.skipped), (0, 1));
        assert_eq!(v.read("Inbox.md"), before);
    }

    #[tokio::test]
    async fn a_done_task_without_a_done_date_is_not_moved() {
        // `tasksRecordDoneDate`가 꺼져 있으면 이런 줄이 생긴다. 나이를 모르므로
        // "충분히 오래됐다"고 가정하지 않는다.
        let v = Vault::new();
        let raw = "- [x] 날짜 없는 완료";
        let inbox = v.write("Inbox.md", &format!("{}\n", raw));

        let out = run(&v, &[item(&inbox, 0, raw)]).await.unwrap();

        assert_eq!((out.archived, out.skipped), (0, 1));
        assert_eq!(v.read("Inbox.md"), format!("{}\n", raw));
    }

    #[tokio::test]
    async fn an_unfinished_task_is_not_moved_even_when_it_is_old() {
        let v = Vault::new();
        let raw = "- [ ] 미룬 일 ➕2026-01-01";
        let inbox = v.write("Inbox.md", &format!("{}\n", raw));

        let out = run(&v, &[item(&inbox, 0, raw)]).await.unwrap();

        assert_eq!((out.archived, out.skipped), (0, 1));
        assert_eq!(v.read("Inbox.md"), format!("{}\n", raw));
    }

    #[tokio::test]
    async fn a_line_already_in_its_own_month_file_does_not_shuffle() {
        // `Archive/*`도 원본이 될 수 있으므로(잘못 든 달의 정리) 자기 자신으로의
        // 이동을 막지 않으면 실행할 때마다 줄이 파일 끝으로 이사한다.
        let v = Vault::new();
        let raw = "- [x] 이미 제자리 ✅2026-07-04";
        let before = format!("- [x] 먼저 ✅2026-07-01\n{}\n", raw);
        let path = v.write("Archive/2026-07.md", &before);

        let out = run(&v, &[item(&path, 1, raw)]).await.unwrap();

        assert_eq!((out.archived, out.skipped), (0, 1));
        assert_eq!(v.read("Archive/2026-07.md"), before);
    }

    #[tokio::test]
    async fn a_misfiled_line_moves_between_archive_files() {
        let v = Vault::new();
        let raw = "- [x] 6월 것인데 8월 파일에 있다 ✅2026-06-04";
        let path = v.write("Archive/2026-08.md", &format!("{}\n", raw));

        let out = run(&v, &[item(&path, 0, raw)]).await.unwrap();

        assert_eq!(out.archived, 1);
        assert_eq!(v.read("Archive/2026-08.md"), "");
        assert_eq!(v.read("Archive/2026-06.md"), format!("{}\n", raw));
    }

    // ── 잠금 · 바이트 보존 ────────────────────────────────────────────────

    #[tokio::test]
    async fn a_line_that_changed_underneath_is_skipped_and_nothing_moves() {
        let v = Vault::new();
        let now_on_disk = "- [x] 세금 신고 ✅2026-07-05";
        let inbox = v.write("Inbox.md", &format!("{}\n", now_on_disk));

        let out = run(&v, &[item(&inbox, 0, "- [x] 세금 신고 ✅2026-07-04")])
            .await
            .unwrap();

        assert_eq!((out.archived, out.stale), (0, 1));
        assert_eq!(v.read("Inbox.md"), format!("{}\n", now_on_disk));
        assert!(!std::path::Path::new(&v.at("Archive")).exists());
    }

    #[tokio::test]
    async fn a_line_number_past_the_end_is_stale_not_a_panic() {
        let v = Vault::new();
        let raw = "- [x] 세금 신고 ✅2026-07-04";
        let inbox = v.write("Inbox.md", &format!("{}\n", raw));

        let out = run(&v, &[item(&inbox, 9, raw)]).await.unwrap();

        assert_eq!((out.archived, out.stale), (0, 1));
        assert_eq!(v.read("Inbox.md"), format!("{}\n", raw));
    }

    #[tokio::test]
    async fn the_lock_matches_after_normalization() {
        // NBSP가 든 파일 — 인덱스의 `raw`는 정규화된 값이므로 `write.rs`와 같은
        // 기준으로 견주지 않으면 아카이브만 조용히 아무것도 못 옮긴다.
        let v = Vault::new();
        let on_disk = "- [x] 회의\u{00A0}준비 ✅2026-07-04";
        let inbox = v.write("Inbox.md", &format!("{}\n", on_disk));

        let out = run(&v, &[item(&inbox, 0, "- [x] 회의 준비 ✅2026-07-04")])
            .await
            .unwrap();

        assert_eq!(out.archived, 1);
        assert_eq!(v.read("Inbox.md"), "");
        // 옮겨 붙는 것은 **파일의 원본 바이트**다 — 정규화된 사본이 아니다.
        assert_eq!(v.read("Archive/2026-07.md"), format!("{}\n", on_disk));
    }

    #[tokio::test]
    async fn crlf_survives_on_both_sides() {
        let v = Vault::new();
        let raw = "- [x] 세금 신고 ✅2026-07-04";
        let inbox = v.write("Inbox.md", &format!("- [ ] 남을 것\r\n{}\r\n", raw));
        v.write("Archive/2026-07.md", "- [x] 먼저 ✅2026-07-01\r\n");

        let out = run(&v, &[item(&inbox, 1, raw)]).await.unwrap();

        assert_eq!(out.archived, 1);
        assert_eq!(v.read("Inbox.md"), "- [ ] 남을 것\r\n");
        assert_eq!(
            v.read("Archive/2026-07.md"),
            format!("- [x] 먼저 ✅2026-07-01\r\n{}\r\n", raw)
        );
    }

    #[tokio::test]
    async fn a_source_without_a_trailing_newline_does_not_grow_one() {
        let v = Vault::new();
        let raw = "- [x] 세금 신고 ✅2026-07-04";
        let inbox = v.write("Inbox.md", &format!("{}\n- [ ] 남을 것", raw));

        let out = run(&v, &[item(&inbox, 0, raw)]).await.unwrap();

        assert_eq!(out.archived, 1);
        assert_eq!(v.read("Inbox.md"), "- [ ] 남을 것");
    }

    #[tokio::test]
    async fn several_lines_leave_one_file_in_a_single_pass() {
        // `delete_line`을 N번 부르면 첫 삭제가 그 아래 번호를 당겨 두 번째가 다른
        // 줄을 지운다. 한 번의 splice여야 하는 이유다.
        let v = Vault::new();
        let a = "- [x] 하나 ✅2026-07-01";
        let b = "- [x] 둘 ✅2026-07-02";
        let c = "- [x] 셋 ✅2026-07-03";
        let inbox = v.write("Inbox.md", &format!("{}\n- [ ] 남을 것\n{}\n{}\n", a, b, c));

        let out = run(
            &v,
            &[item(&inbox, 0, a), item(&inbox, 2, b), item(&inbox, 3, c)],
        )
        .await
        .unwrap();

        assert_eq!(out.archived, 3);
        assert_eq!(v.read("Inbox.md"), "- [ ] 남을 것\n");
        assert_eq!(
            v.read("Archive/2026-07.md"),
            format!("{}\n{}\n{}\n", a, b, c)
        );
    }

    #[tokio::test]
    async fn two_months_land_in_two_files() {
        let v = Vault::new();
        let june = "- [x] 6월 것 ✅2026-06-04";
        let july = "- [x] 7월 것 ✅2026-07-04";
        let inbox = v.write("Inbox.md", &format!("{}\n{}\n", june, july));

        let out = run(&v, &[item(&inbox, 0, june), item(&inbox, 1, july)])
            .await
            .unwrap();

        assert_eq!(out.archived, 2);
        assert_eq!(v.read("Inbox.md"), "");
        assert_eq!(v.read("Archive/2026-06.md"), format!("{}\n", june));
        assert_eq!(v.read("Archive/2026-07.md"), format!("{}\n", july));
    }

    #[tokio::test]
    async fn every_touched_file_is_reported_for_reindexing() {
        let v = Vault::new();
        let raw = "- [x] 세금 신고 ✅2026-07-04";
        let inbox = v.write("Inbox.md", &format!("{}\n", raw));

        let out = run(&v, &[item(&inbox, 0, raw)]).await.unwrap();

        let mut paths = out.paths.clone();
        paths.sort();
        assert_eq!(paths, vec![v.at("Archive/2026-07.md"), inbox]);
    }

    #[tokio::test]
    async fn a_capture_file_outside_the_vault_is_refused() {
        let v = Vault::new();
        let err = archive_tasks(&v.root, "/tmp/Inbox.md", &[], TODAY, 30)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("capture file"), "{}", err);
    }

    #[tokio::test]
    async fn an_invalid_today_is_refused() {
        let v = Vault::new();
        let err = archive_tasks(&v.root, &v.inbox(), &[], "2026-02-31", 30)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("invalid today"), "{}", err);
    }

    // ── 순수 함수 ─────────────────────────────────────────────────────────

    #[test]
    fn the_threshold_is_inclusive_at_exactly_after_days() {
        let at = "- [x] 딱 30일 ✅2026-07-28";
        assert_eq!(
            archive_verdict(at, TODAY, 30),
            Verdict::Move {
                month: "2026-07".to_string()
            }
        );
        let one_short = "- [x] 29일 ✅2026-07-29";
        assert_eq!(archive_verdict(one_short, TODAY, 30), Verdict::Skip);
    }

    #[test]
    fn a_done_date_in_the_future_never_qualifies() {
        let raw = "- [x] 미래 ✅2026-12-01";
        assert_eq!(archive_verdict(raw, TODAY, 30), Verdict::Skip);
    }

    #[test]
    fn a_line_that_is_not_a_task_is_skipped() {
        assert_eq!(
            archive_verdict("그냥 문장 ✅2026-01-01", TODAY, 30),
            Verdict::Skip
        );
    }

    #[test]
    fn the_month_comes_from_the_done_date_not_from_today() {
        assert_eq!(
            archive_verdict("- [x] 작년 것 ✅2025-12-31", TODAY, 30),
            Verdict::Move {
                month: "2025-12".to_string()
            }
        );
    }

    #[test]
    fn days_between_crosses_months_years_and_leap_days() {
        assert_eq!(days_between("2026-08-27", "2026-08-27"), Some(0));
        assert_eq!(days_between("2026-07-28", "2026-08-27"), Some(30));
        assert_eq!(days_between("2025-12-31", "2026-01-01"), Some(1));
        // 2024는 윤년 — 2월이 29일이다.
        assert_eq!(days_between("2024-02-28", "2024-03-01"), Some(2));
        // 2100은 윤년이 아니다(400으로 나뉘지 않는 100의 배수).
        assert_eq!(days_between("2100-02-28", "2100-03-01"), Some(1));
        assert_eq!(days_between("2026-08-27", "2026-08-26"), Some(-1));
        assert_eq!(days_between("2026-02-31", "2026-08-27"), None);
    }

    #[test]
    fn the_archive_folder_name_is_shared_with_the_front_end() {
        // TypeScript `ARCHIVE_DIR`(src/utils/tasks/task-archive.ts)에 같은 글자로
        // 있다. 갈리면 프런트가 세는 대상과 여기가 쓰는 대상이 다른 폴더가 된다.
        assert_eq!(ARCHIVE_DIR, "Archive");
    }

    #[test]
    fn a_sibling_directory_with_the_same_prefix_is_not_the_archive() {
        // `Archived/`가 `Archive`에 걸리면 불가침 규칙이 조용히 새어 나간다.
        let capture = "/v/Inbox.md";
        let archive = "/v/Archive";
        assert!(is_archive_source("/v/Archive/2026-07.md", capture, archive));
        assert!(is_archive_source("/v/Inbox.md", capture, archive));
        assert!(!is_archive_source(
            "/v/Archived/2026-07.md",
            capture,
            archive
        ));
        assert!(!is_archive_source("/v/Archive", capture, archive));
        assert!(!is_archive_source("/v/notes/설계.md", capture, archive));
        assert!(!is_archive_source("/v/Inbox.md.bak", capture, archive));
    }

    #[test]
    fn windows_separators_compare_equal_to_forward_slashes() {
        assert!(is_archive_source(
            r"C:\v\Archive\2026-07.md",
            "C:/v/Inbox.md",
            "C:/v/Archive"
        ));
    }
}
