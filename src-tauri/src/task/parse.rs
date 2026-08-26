// §303 태스크 줄 파서 — 순수 함수. IO 없음.
use crate::md::extract_inline_tags;
use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;

/// M1은 GFM 2진 상태만. [/] [-]는 M4(§18.18 리스크 1).
static TASK_LINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$").unwrap());

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskState {
    Todo,
    Done,
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
    let state = if caps[2].eq_ignore_ascii_case("x") {
        TaskState::Done
    } else {
        TaskState::Todo
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
    fn tags_stop_at_a_hyphen_just_like_the_tag_panel_does() {
        // §304는 태그 추출을 §56m의 INLINE_TAG_RE와 **공유**하라고 못박는다. 그 정규식의
        // `\w`는 하이픈(Pd)을 포함하지 않으므로 #deep-work는 "deep"이 된다. 아젠다와 태그
        // 패널이 같은 답을 내는 것이, Obsidian과 같아지는 것보다 중요하다. 하이픈 지원은
        // 두 인덱스를 함께 바꿔야 하는 별도 작업이다.
        let t = parse_task_line("- [ ] 본문 #deep-work").unwrap();
        assert_eq!(t.tags, vec!["deep".to_string()]);
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
        // M1은 2진 상태만 — [/] [-] 는 M4
        assert!(parse_task_line("- [/] 진행중").is_none());
    }

    #[test]
    fn ignores_a_malformed_date_value() {
        let t = parse_task_line("- [ ] 본문 📅2026-13-99").unwrap();
        assert_eq!(t.due, None);
    }
}
