// §303 태스크 줄 파서 — 순수 함수. IO 없음.
use crate::md::extract_inline_tags;
use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;

/// §18.18 M4 — 네 상태. `[/]`(진행 중)·`[-]`(취소)는 GFM이 아니므로 GitHub 등 다른
/// 뷰어에서는 체크박스가 아니라 글자로 보인다. 설계가 그 대가를 받아들였다.
///
/// ‼️ 문자 집합이 닫혀 있는 것이 요점이다. `[<아무 글자>]`로 넓히면 `- [1] 참조`·
/// `- [TODO] 나중에` 같은 평범한 줄이 태스크가 되어 인덱스와 아젠다에 들어온다.
/// 클래스 안 맨 뒤의 `-`는 리터럴 하이픈이다(범위가 아니다).
static TASK_LINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\s*)[-*+]\s+\[([ xX/-])\]\s+(.*)$").unwrap());

static WIKILINK_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[\[([^\]]+)\]\]").unwrap());

static DATAVIEW_FIELD_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[(\w+)::\s*([^\]]+)\]").unwrap());

static ISO_DATE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{4}-\d{2}-\d{2}$").unwrap());

/// (이모지, 필드명) — §303 canonical 순서
const DATE_MARKERS: &[(&str, &str)] = &[
    ("➕", "created"),
    ("🛫", "start"),
    ("⏳", "scheduled"),
    ("📅", "due"),
    ("✅", "done"),
    ("❌", "cancelled"),
];

pub(super) const PRIORITY_MARKERS: &[(&str, i8)] = &[("🔺", 2), ("⏫", 1), ("🔽", -1), ("⏬", -2)];

/// 반복 규칙 이모지. 값이 자유 텍스트라 **줄 끝까지**가 그 값이다(아래 `parse_task_line`).
/// `tag.rs`가 필드 뭉치의 경계를 잴 때 같은 글자를 봐야 하므로 여기에 둔다.
pub(super) const RECURRENCE_EMOJI: char = '🔁';

/// §18.18 M4 시간 기록 이모지 — **U+23F1 하나**다.
///
/// ‼️ `⏱️`(U+23F1 U+FE0F)로 쓰는 것이 더 흔하지만, `normalize_line`이 파싱 전에
/// U+FE0F를 지우고 쓰기 경로가 그 정규화된 줄을 되쓰므로 파일에 남는 것은 짧은 쪽뿐이다.
/// 여기서 짧은 쪽만 보는 것은 그래서 옳다 — 이 상수를 쓰는 코드는 전부 정규화 뒤에 있다.
pub(super) const TIMER_EMOJI: char = '⏱';

/// §18.18 M4 — 네 상태.
///
/// ‼️ `Doing`도 `Cancelled`도 "완료의 일종"이 아니다. "이 일이 끝났는가"를 묻는
/// 코드는 반드시 `== Done`으로 물을 것 — `!= Todo`로 물으면 취소된 일이 완료된
/// 일로 집계된다. (`archive.rs`가 이미 `== Done` 쪽이다.)
///
/// serde의 camelCase가 TypeScript `TaskState`의 문자열과 정확히 같은 네 낱말을
/// 만든다 — 아래 `FromStr`이 그 역방향이고, 두 방향이 어긋나면 IPC가 조용히
/// 상태를 잃는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskState {
    Todo,
    Doing,
    Done,
    Cancelled,
}

impl TaskState {
    /// 이 상태가 남기는 **종료 스탬프** 필드 — 완료는 `✅`, 취소는 `❌`.
    /// 진행 중과 할 일은 종료가 아니므로 아무것도 남기지 않는다.
    pub(super) fn stamp_field(self) -> Option<&'static str> {
        match self {
            TaskState::Cancelled => Some("cancelled"),
            TaskState::Done => Some("done"),
            TaskState::Doing | TaskState::Todo => None,
        }
    }

    /// 줄에 쓰이는 마커. 읽기(`TASK_LINE_RE`)와 쓰기(`write.rs`)가 같은 표를 본다.
    pub(super) fn marker(self) -> &'static str {
        match self {
            TaskState::Cancelled => "[-]",
            TaskState::Doing => "[/]",
            TaskState::Done => "[x]",
            TaskState::Todo => "[ ]",
        }
    }
}

impl std::str::FromStr for TaskState {
    type Err = String;

    /// IPC에서 오는 이름 → 상태. `Serialize`의 camelCase와 짝이다.
    fn from_str(name: &str) -> Result<Self, Self::Err> {
        match name {
            "cancelled" => Ok(TaskState::Cancelled),
            "doing" => Ok(TaskState::Doing),
            "done" => Ok(TaskState::Done),
            "todo" => Ok(TaskState::Todo),
            other => Err(format!("unknown state: {}", other)),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ParsedTask {
    pub indent: u8,
    pub state: TaskState,
    pub text: String,
    pub created: Option<String>,
    pub start: Option<String>,
    pub scheduled: Option<String>,
    pub due: Option<String>,
    pub done: Option<String>,
    pub cancelled: Option<String>,
    pub priority: i8,
    pub recurrence: Option<String>,
    /// §18.18 M4 `⏱` 값 그대로 — `1h27m` 또는 `1h27m@2026-08-31T14:03`.
    /// 해석은 프런트(`src/utils/tasks/task-timer.ts`)가 한다. Rust가 아는 것은
    /// "이만큼이 이 필드다"뿐이고, 그것이 태그 삽입 자리와 상태 전이에 필요한 전부다.
    pub timer: Option<String>,
    pub links: Vec<String>,
    pub tags: Vec<String>,
}

/// NBSP·narrow NBSP → 공백, variation selector 제거.
/// Obsidian Tasks가 처리하지 않아 파싱이 조용히 실패하는 지점(§303).
pub fn normalize_line(line: &str) -> String {
    line.chars()
        .filter(|c| *c != '\u{FE0E}' && *c != '\u{FE0F}')
        .map(|c| {
            if c == '\u{00A0}' || c == '\u{202F}' {
                ' '
            } else {
                c
            }
        })
        .collect()
}

/// 달력상 실재하는 날짜인지 확인한다. 2026-13-99 같은 값은 버린다.
/// `write.rs`가 필드 위치를 판정할 때도 같은 기준을 써야 하므로 `task` 모듈 내부에 공개한다.
pub(super) fn is_valid_date(s: &str) -> bool {
    if !ISO_DATE_RE.is_match(s) {
        return false;
    }
    let (y, rest) = s.split_at(4);
    let month: u32 = rest[1..3].parse().unwrap_or(0);
    let day: u32 = rest[4..6].parse().unwrap_or(0);
    let year: i32 = y.parse().unwrap_or(0);
    if !(1..=12).contains(&month) || day == 0 {
        return false;
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let max = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => 0,
    };
    day <= max
}

fn set_field(t: &mut ParsedTask, name: &str, value: &str) {
    let v = Some(value.to_string());
    match name {
        "created" => t.created = v,
        "start" => t.start = v,
        "scheduled" => t.scheduled = v,
        "due" => t.due = v,
        "done" => t.done = v,
        "cancelled" => t.cancelled = v,
        _ => {}
    }
}

pub fn parse_task_line(line: &str) -> Option<ParsedTask> {
    let normalized = normalize_line(line);
    let caps = TASK_LINE_RE.captures(&normalized)?;

    let indent = caps.get(1).map_or(0, |m| m.as_str().len()).min(255) as u8;
    let state = match &caps[2] {
        "x" | "X" => TaskState::Done,
        "/" => TaskState::Doing,
        "-" => TaskState::Cancelled,
        _ => TaskState::Todo,
    };
    let body = caps[3].to_string();

    let mut task = ParsedTask {
        indent,
        state,
        text: String::new(),
        created: None,
        start: None,
        scheduled: None,
        due: None,
        done: None,
        cancelled: None,
        priority: 0,
        recurrence: None,
        timer: None,
        links: Vec::new(),
        tags: Vec::new(),
    };

    // 링크·태그는 본문에 남긴 채 수집만 한다 — 제목 해석은 프론트가 한다.
    for c in WIKILINK_RE.captures_iter(&body) {
        let target = c[1].split('|').next().unwrap_or("").trim();
        if !target.is_empty() {
            task.links.push(target.to_string());
        }
    }
    task.tags = extract_inline_tags(&body);

    // 이모지 필드를 본문에서 떼어낸다.
    let mut text = body.clone();
    for (emoji, field) in DATE_MARKERS {
        let Some(pos) = text.find(emoji) else {
            continue;
        };
        let after = &text[pos + emoji.len()..];
        let value: String = after.trim_start().chars().take(10).collect();
        let consumed = if is_valid_date(&value) {
            set_field(&mut task, field, &value);
            after.len() - after.trim_start().len() + value.len()
        } else {
            0
        };
        text.replace_range(pos..pos + emoji.len() + consumed, "");
    }
    for (emoji, weight) in PRIORITY_MARKERS {
        if let Some(pos) = text.find(emoji) {
            task.priority = *weight;
            text.replace_range(pos..pos + emoji.len(), "");
        }
    }
    // ‼️ 반복보다 **먼저** 떼어낸다. 반복은 남은 텍스트를 통째로 값으로 삼으므로,
    // 뒤에 있으면 기록한 시간이 반복 규칙 안으로 삼켜져 인덱스에서 사라진다.
    if let Some(pos) = text.find(TIMER_EMOJI) {
        let after = &text[pos + TIMER_EMOJI.len_utf8()..];
        let value: String = after
            .chars()
            .take_while(|c| !c.is_whitespace())
            .collect();
        if !value.is_empty() {
            task.timer = Some(value.clone());
            text.replace_range(pos..pos + TIMER_EMOJI.len_utf8() + value.len(), "");
        }
    }
    if let Some(pos) = text.find(RECURRENCE_EMOJI) {
        let after = text[pos + RECURRENCE_EMOJI.len_utf8()..].trim().to_string();
        if !after.is_empty() {
            task.recurrence = Some(after.clone());
        }
        text.truncate(pos);
    }

    // Dataview 인라인 필드도 읽는다(쓰지는 않는다).
    let mut leftovers = Vec::new();
    for c in DATAVIEW_FIELD_RE.captures_iter(&text) {
        let name = c[1].to_lowercase();
        let value = c[2].trim().to_string();
        if name == "priority" {
            task.priority = match value.as_str() {
                "highest" => 2,
                "high" => 1,
                "low" => -1,
                "lowest" => -2,
                _ => task.priority,
            };
        } else if is_valid_date(&value) {
            set_field(&mut task, &name, &value);
        }
        leftovers.push(c[0].to_string());
    }
    for l in leftovers {
        text = text.replace(&l, "");
    }

    task.text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    Some(task)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_bare_todo() {
        let t = parse_task_line("- [ ] 보고서 초안").unwrap();
        assert_eq!(t.state, TaskState::Todo);
        assert_eq!(t.text, "보고서 초안");
        assert_eq!(t.priority, 0);
        assert_eq!(t.indent, 0);
    }

    #[test]
    fn parses_done_with_completion_date() {
        let t = parse_task_line("- [x] 끝난 것 ✅2026-08-22").unwrap();
        assert_eq!(t.state, TaskState::Done);
        assert_eq!(t.done.as_deref(), Some("2026-08-22"));
        assert_eq!(t.text, "끝난 것");
    }

    #[test]
    fn parses_every_emoji_field() {
        let t = parse_task_line("- [ ] 본문 ➕2026-08-01 🛫2026-08-25 ⏳2026-08-27 📅2026-08-30")
            .unwrap();
        assert_eq!(t.created.as_deref(), Some("2026-08-01"));
        assert_eq!(t.start.as_deref(), Some("2026-08-25"));
        assert_eq!(t.scheduled.as_deref(), Some("2026-08-27"));
        assert_eq!(t.due.as_deref(), Some("2026-08-30"));
        assert_eq!(t.text, "본문");
    }

    #[test]
    fn parses_all_five_priorities() {
        for (marker, expected) in [("🔺", 2i8), ("⏫", 1), ("🔽", -1), ("⏬", -2)] {
            let line = format!("- [ ] p {}", marker);
            assert_eq!(
                parse_task_line(&line).unwrap().priority,
                expected,
                "{}",
                marker
            );
        }
        assert_eq!(parse_task_line("- [ ] p").unwrap().priority, 0);
    }

    #[test]
    fn accepts_dataview_inline_fields_on_read() {
        let t = parse_task_line("- [ ] 본문 [due:: 2026-08-30]").unwrap();
        assert_eq!(t.due.as_deref(), Some("2026-08-30"));
        assert_eq!(t.text, "본문");
    }

    #[test]
    fn normalizes_nbsp_and_variation_selectors() {
        // Obsidian Tasks가 조용히 실패하는 입력 — 우리는 정규화해서 받는다
        let t = parse_task_line("- [ ] 본문\u{00A0}📅\u{FE0F}2026-08-30").unwrap();
        assert_eq!(t.due.as_deref(), Some("2026-08-30"));
    }

    #[test]
    fn collects_wikilinks_and_tags_from_the_line() {
        let t = parse_task_line("- [ ] 본문 [[202607051530]] #deepwork 📅2026-08-30").unwrap();
        assert_eq!(t.links, vec!["202607051530".to_string()]);
        assert_eq!(t.tags, vec!["deepwork".to_string()]);
    }

    #[test]
    fn a_hyphen_is_part_of_the_tag_not_a_boundary() {
        // §304는 태그 추출을 §56m의 `INLINE_TAG_RE`와 **공유**하라고 못박는다. 한때 그
        // 정규식이 하이픈에서 끊어 `#deep-work`를 "deep"으로 읽었고, 쓰는 쪽
        // (`task/tag.rs`의 `is_tag_char`)은 하이픈까지 태그로 보았다 — 아젠다가 보여주는
        // 이름과 지울 수 있는 이름이 달라 "미룸 해제"가 조용히 무동작이 되는 원인이었다.
        let t = parse_task_line("- [ ] 본문 #deep-work").unwrap();
        assert_eq!(t.tags, vec!["deep-work".to_string()]);

        // 이 슬라이스가 겨냥한 바로 그 줄. 읽는 이름과 쓰는 이름이 같아야 조작이 산다.
        let s = parse_task_line("- [ ] 초안 #someday-maybe").unwrap();
        assert_eq!(s.tags, vec!["someday-maybe".to_string()]);
    }

    #[test]
    fn keeps_wikilink_markup_in_text_for_the_ui_to_resolve() {
        // 제목 해석은 프론트의 zettel-index가 한다 — 파서는 원문을 보존한다
        let t = parse_task_line("- [ ] 검토 [[202607051530]] 📅2026-08-30").unwrap();
        assert_eq!(t.text, "검토 [[202607051530]]");
    }

    #[test]
    fn takes_link_target_before_the_display_pipe() {
        let t = parse_task_line("- [ ] x [[202607051530|어떤 노트]]").unwrap();
        assert_eq!(t.links, vec!["202607051530".to_string()]);
    }

    #[test]
    fn records_indent_depth() {
        assert_eq!(parse_task_line("    - [ ] 하위").unwrap().indent, 4);
        assert_eq!(parse_task_line("\t- [ ] 탭").unwrap().indent, 1);
    }

    #[test]
    fn accepts_all_three_bullet_markers() {
        for m in ["-", "*", "+"] {
            assert!(parse_task_line(&format!("{} [ ] x", m)).is_some(), "{}", m);
        }
    }

    #[test]
    fn rejects_non_task_lines() {
        assert!(parse_task_line("일반 문단").is_none());
        assert!(parse_task_line("- 그냥 리스트").is_none());
        assert!(parse_task_line("- [] 대괄호만").is_none());
        // ‼️ §18.18 M4가 문자 집합을 넓혔지만 **닫힌 채로** 넓혔다. 아래 셋은
        // 사람들이 다른 이유로 쓰는 평범한 줄이고, 태스크가 되면 인덱스와 아젠다에
        // 남의 문장이 섞인다.
        assert!(parse_task_line("- [1] 참조").is_none());
        assert!(parse_task_line("- [TODO] 나중에").is_none());
        assert!(parse_task_line("- [text](url) 링크").is_none());
        // 마커 뒤 공백도 여전히 필수다.
        assert!(parse_task_line("- [/]붙여쓰기").is_none());
    }

    /// §18.18 M4 — 네 상태 전부가 읽힌다. 하나라도 빠지면 그 줄은 태스크가
    /// 아닌 것이 되어 인덱스에서 조용히 사라진다.
    #[test]
    fn reads_all_four_states() {
        assert_eq!(parse_task_line("- [ ] 할 일").unwrap().state, TaskState::Todo);
        assert_eq!(
            parse_task_line("- [/] 하는 중").unwrap().state,
            TaskState::Doing
        );
        assert_eq!(parse_task_line("- [x] 끝").unwrap().state, TaskState::Done);
        assert_eq!(parse_task_line("- [X] 끝").unwrap().state, TaskState::Done);
        assert_eq!(
            parse_task_line("- [-] 접음").unwrap().state,
            TaskState::Cancelled
        );
    }

    /// IPC의 두 방향이 같은 낱말을 쓰는지 — `Serialize`(camelCase)와 `FromStr`.
    /// 어긋나면 프론트가 보낸 상태가 조용히 거절되거나, 받은 상태가 알 수 없는
    /// 문자열이 된다.
    #[test]
    fn state_names_round_trip_through_ipc() {
        for state in [
            TaskState::Todo,
            TaskState::Doing,
            TaskState::Done,
            TaskState::Cancelled,
        ] {
            let json = serde_json::to_string(&state).unwrap();
            let name = json.trim_matches('"');
            assert_eq!(name.parse::<TaskState>().unwrap(), state, "name: {}", name);
        }
    }

    /// 마커 표는 파서가 읽는 문자와 같아야 한다 — 쓰기가 만든 줄을 읽기가 다시
    /// 알아보지 못하면 상태가 저장될 때마다 사라진다.
    #[test]
    fn every_marker_parses_back_to_its_own_state() {
        for state in [
            TaskState::Todo,
            TaskState::Doing,
            TaskState::Done,
            TaskState::Cancelled,
        ] {
            let line = format!("- {} 본문", state.marker());
            assert_eq!(parse_task_line(&line).unwrap().state, state, "{}", line);
        }
    }

    /// §18.18 M4 — 반복 값의 **경계**. 프런트 스캐너(`src/utils/tasks/task-field-scan.ts`)가
    /// 칩을 그릴 때 같은 줄을 같게 읽어야 한다: 저기서 줄 끝까지를 반복으로 삼으면
    /// 화면에서 기한 칩이 사라지고, 그 자리를 눌러 고치면 반복 규칙 한가운데를 덮는다.
    /// 두 언어의 테스트가 **같은 줄**을 든다 — 한쪽을 고치면 다른 쪽이 빨간불이 된다.
    #[test]
    fn recurrence_value_stops_where_a_date_field_starts() {
        let t = parse_task_line("- [ ] 회고 🔁every week 📅2026-09-01").unwrap();
        assert_eq!(t.due.as_deref(), Some("2026-09-01"));
        assert_eq!(t.recurrence.as_deref(), Some("every week"));
    }

    /// 값이 없는 맨 🔁는 필드가 아니다 — 뒤의 날짜는 그대로 기한이다.
    #[test]
    fn a_bare_recurrence_emoji_is_not_a_field() {
        let t = parse_task_line("- [ ] 주간 회고 🔁 📅2026-08-30").unwrap();
        assert_eq!(t.recurrence, None);
        assert_eq!(t.due.as_deref(), Some("2026-08-30"));
    }

    /// canonical 순서(반복이 맨 뒤)에서는 줄 끝까지가 값이다.
    #[test]
    fn recurrence_last_takes_the_rest_of_the_line() {
        let t = parse_task_line("- [ ] 회고 📅2026-09-01 ⏫ 🔁every week").unwrap();
        assert_eq!(t.recurrence.as_deref(), Some("every week"));
        assert_eq!(t.due.as_deref(), Some("2026-09-01"));
        assert_eq!(t.priority, 1);
    }

    #[test]
    fn ignores_a_malformed_date_value() {
        let t = parse_task_line("- [ ] 본문 📅2026-13-99").unwrap();
        assert_eq!(t.due, None);
    }
}
