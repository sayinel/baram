// §303 canonical 필드 배치 — "무엇이 필드인가"와 "어디에 놓이는가"의 **유일한 출처**.
//
// 이 모듈이 생긴 이유는 같은 어휘가 두 벌이었기 때문이다. `tag.rs`는 태그를 끼울 자리를
// 찾으려고 필드 뭉치의 경계를 재고 있었고, `write.rs`는 필드를 **줄 끝에** 붙이고 있었다.
// 둘이 같은 줄을 다르게 읽었으므로 `📅`를 다시 주면 그것이 `⏫`를 지나가 §303 표 순서가
// 깨졌다(dev/backlog.md의 "§303 canonical 순서가 날짜 부여에서 깨진다"). 이제 경계 판정도
// 삽입 위치도 여기 하나뿐이고, 두 호출자는 그것을 **쓰기만** 한다.
use crate::task::parse::{is_valid_date, PRIORITY_MARKERS, RECURRENCE_EMOJI};

/// 날짜 필드 — §18.2 표와 **같은 순서**다. 이 배열의 인덱스가 그대로 canonical 순위이므로
/// 순서를 바꾸면 파일에 쓰이는 순서가 바뀐다. 필드를 더할 때는 표를 먼저 고칠 것.
pub(super) const FIELD_EMOJI: &[(&str, &str)] = &[
    ("created", "➕"),
    ("start", "🛫"),
    ("scheduled", "⏳"),
    ("due", "📅"),
    ("done", "✅"),
    ("cancelled", "❌"),
];

/// 우선순위는 날짜 여섯 뒤. `FIELD_EMOJI.len()`으로 쓰지 않고 상수로 둔 것은 이 두 값이
/// **날짜 배열의 길이가 아니라 §18.2 표의 자리**라는 뜻이기 때문이다.
pub(super) const PRIORITY_RANK: u8 = 6;
/// 반복은 마지막 — 값이 줄 끝까지라 뒤에 아무것도 놓을 수 없기도 하다.
pub(super) const RECURRENCE_RANK: u8 = 7;

/// 필드 이름의 canonical 순위. 모르는 이름이면 `None`.
pub(super) fn field_rank(field: &str) -> Option<u8> {
    FIELD_EMOJI
        .iter()
        .position(|(f, _)| *f == field)
        .map(|i| i as u8)
}

/// `s`가 필드 토큰으로 **시작하면** 그 바이트 길이와 canonical 순위. 아니면 `None`.
///
/// 날짜 이모지는 **뒤에 유효한 날짜가 와야** 필드다 — `strip_field`(write.rs)와 같은
/// 기준이다. 본문 중간의 장식용 📅를 필드로 세면 그 앞에 태그를 끼워 사용자 문장을
/// 갈라 놓는다. 이모지와 값 사이의 공백을 허용하는 것은 파서가 그 형태를 읽기 때문이다
/// (Obsidian Tasks가 `📅 2026-08-30`으로 쓴다).
///
/// 반복(🔁)의 값은 자유 텍스트("every week on Monday")라 **줄 끝까지**가 그 값이다
/// (`parse_task_line`이 그렇게 읽는다). 값의 끝을 잴 수 없다고 해서 필드에서 빼면 태그가
/// 반복 텍스트 **뒤**에 붙어 값 자체를 오염시킨다 — 우리 파서는 `recurrence`를
/// `"every week #someday"`로 읽고, Obsidian Tasks는 반복 문자 클래스(`[a-zA-Z0-9, !]`)에
/// `#`이 없어 그 줄의 반복을 아예 읽지 못한다. 끝을 재지 못해도 이모지를 **경계로**
/// 쓰는 데는 아무 문제가 없다: 여기부터 줄 끝까지가 통째로 반복 필드다.
pub(super) fn field_token(s: &str) -> Option<(usize, u8)> {
    if let Some((marker, _)) = PRIORITY_MARKERS.iter().find(|(m, _)| s.starts_with(m)) {
        return Some((marker.len(), PRIORITY_RANK));
    }
    if s.starts_with(RECURRENCE_EMOJI) {
        return Some((s.len(), RECURRENCE_RANK));
    }
    for (rank, (_, emoji)) in FIELD_EMOJI.iter().enumerate() {
        let Some(after) = s.strip_prefix(emoji) else {
            continue;
        };
        let pad = after.len() - after.trim_start().len();
        // 문자 수로 열 자를 세고 그 바이트 길이를 쓴다 — 바이트로 착각하면 한글처럼
        // 3바이트짜리 문자 중간을 잘라 panic("char boundary")이 된다(write.rs의 C5).
        let value: String = after[pad..].chars().take(10).collect();
        if is_valid_date(&value) {
            return Some((emoji.len() + pad + value.len(), rank as u8));
        }
    }
    None
}

/// `s`가 **전부** 필드 뭉치인가 — 필드 사이 공백만 허용한다.
pub(super) fn is_all_fields(s: &str) -> bool {
    let mut rest = s.trim();
    while !rest.is_empty() {
        let Some((len, _)) = field_token(rest) else {
            return false;
        };
        rest = rest[len..].trim_start();
    }
    true
}

/// 줄 끝의 **필드 뭉치가 시작하는** 바이트 위치. 필드가 없으면 줄 끝.
///
/// "첫 번째 이모지 앞"이 아니라 "거기서 줄 끝까지가 전부 필드인 가장 이른 자리"다.
/// 그래야 본문에 장식용 이모지가 있는 줄에서도 태그가 본문을 가르지 않는다.
///
/// 구분자는 ASCII 공백만이 아니라 **모든 공백**이다 — `is_all_fields`가 `trim`으로 전부
/// 접고 `TASK_LINE_RE`도 `\s+`라 탭으로 구분된 줄이 정상 태스크로 인덱싱된다. 여기서만
/// 어휘가 좁으면 그런 줄에서 자리를 못 찾아 태그가 필드 **뒤**, 줄 끝에 붙는다.
pub(super) fn field_run_start(trimmed: &str) -> usize {
    for (i, c) in trimmed.char_indices() {
        if !c.is_whitespace() {
            continue;
        }
        let start = i + c.len_utf8();
        if start < trimmed.len() && is_all_fields(&trimmed[start..]) {
            return start;
        }
    }
    trimmed.len()
}

/// 순위 `rank`의 필드를 끼울 바이트 위치 — 줄 끝의 필드 뭉치 안에서 **처음으로 순위가
/// 더 큰** 토큰 바로 앞. 그런 토큰이 없으면 줄 끝.
///
/// ‼️ 기존 필드를 **재배열하지 않는다**. 사용자가 손으로 적은 비정규 순서까지 우리가
/// 조용히 뒤집으면, 날짜 하나를 고쳤을 뿐인데 줄 전체의 바이트가 예고 없이 바뀐다.
/// 우리가 새로 넣는 토큰만 제자리에 넣고 나머지는 있던 그대로 둔다.
pub(super) fn insertion_point(trimmed: &str, rank: u8) -> usize {
    let mut at = field_run_start(trimmed);
    while at < trimmed.len() {
        let rest = &trimmed[at..];
        // 뭉치의 첫 토큰은 `field_run_start`가 이미 공백을 지나 가리키므로 pad가 0이고,
        // 두 번째부터는 앞선 토큰과 자신 사이의 구분 공백만큼 pad가 생긴다.
        let pad = rest.len() - rest.trim_start().len();
        let token_start = at + pad;
        let Some((len, token_rank)) = field_token(&trimmed[token_start..]) else {
            // `field_run_start`가 "여기부터 전부 필드"임을 보장하므로 도달하지 않는다.
            break;
        };
        if token_rank > rank {
            return token_start;
        }
        at = token_start + len;
    }
    trimmed.len()
}

/// §303 canonical 위치에 필드 하나를 끼운 줄. 모르는 필드 이름이면 원문 그대로.
///
/// 이것이 옛 `append_field`(항상 줄 끝)를 대체한다. 줄 끝에 붙이는 방식은 `⏫`가 이미
/// 있는 줄에 날짜를 주면 날짜를 우선순위 **뒤로** 보내 §18.2 표 순서를 깼다. 두 파서가
/// 다 정확히 읽으므로 손상은 아니었지만, 같은 vault를 Obsidian과 함께 쓰는 사용자에게는
/// 보이는 드리프트였다.
pub(super) fn insert_field(line: &str, field: &str, value: &str) -> String {
    let Some(rank) = field_rank(field) else {
        return line.to_string();
    };
    let (_, emoji) = FIELD_EMOJI[rank as usize];
    let trimmed = line.trim_end();
    let at = insertion_point(trimmed, rank);
    let head = trimmed[..at].trim_end();
    let tail = trimmed[at..].trim_start();
    if tail.is_empty() {
        format!("{} {}{}", head, emoji, value)
    } else {
        format!("{} {}{} {}", head, emoji, value, tail)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// §303 표의 순서 그 자체.
    ///
    /// ‼️ 아래 세 단정은 프런트의 `task-field-order.test.ts`에 **같은 문자열로** 있다.
    /// 캡처는 줄을 프런트에서 짓고 정리는 Rust에서 고치므로, 두 표가 갈리면 같은 vault에
    /// 두 가지 순서가 섞여 쌓인다. 언어가 달라 한 벌로 만들 수 없으니 같은 표를 양쪽에
    /// 두고 양쪽이 같은 줄을 단정한다 — 한쪽만 고치면 다른 쪽이 빨간불이 된다.
    #[test]
    fn canonical_field_order_is_the_section_303_table() {
        let glyphs: Vec<&str> = FIELD_EMOJI.iter().map(|(_, e)| *e).collect();
        assert_eq!(glyphs.join(" "), "➕ 🛫 ⏳ 📅 ✅ ❌");
        // 우선순위와 반복은 날짜 뒤, 그 순서로.
        assert_eq!(PRIORITY_RANK, 6);
        assert_eq!(RECURRENCE_RANK, 7);
    }

    #[test]
    fn a_date_lands_before_an_existing_priority_marker() {
        // dev/backlog.md가 기록한 바로 그 재현 절차.
        assert_eq!(
            insert_field(
                "- [ ] 초안 #deep-work ➕2026-08-01 🛫2026-08-02 ⏳2026-08-03 ⏫",
                "due",
                "2026-09-15"
            ),
            "- [ ] 초안 #deep-work ➕2026-08-01 🛫2026-08-02 ⏳2026-08-03 📅2026-09-15 ⏫"
        );
    }

    #[test]
    fn a_date_lands_among_the_dates_in_table_order() {
        assert_eq!(
            insert_field("- [ ] x ➕2026-08-01 📅2026-08-30", "start", "2026-08-02"),
            "- [ ] x ➕2026-08-01 🛫2026-08-02 📅2026-08-30"
        );
    }

    #[test]
    fn a_done_date_lands_before_the_priority_not_after_it() {
        // 가장 자주 쓰이는 조작(체크)이 만드는 줄이다. 옛 `append_field`는 여기서
        // "⏫ ✅2026-08-27"을 만들었다.
        assert_eq!(
            insert_field("- [x] x ⏫", "done", "2026-08-27"),
            "- [x] x ✅2026-08-27 ⏫"
        );
    }

    #[test]
    fn a_field_lands_before_a_recurrence_whose_value_runs_to_end_of_line() {
        // 🔁의 값은 줄 끝까지다. 뒤에 붙이면 날짜가 반복 텍스트로 먹힌다.
        assert_eq!(
            insert_field("- [ ] x 🔁every week", "due", "2026-09-01"),
            "- [ ] x 📅2026-09-01 🔁every week"
        );
    }

    #[test]
    fn a_line_with_no_fields_gets_the_field_at_the_end() {
        assert_eq!(
            insert_field("- [ ] 회의 준비", "due", "2026-09-01"),
            "- [ ] 회의 준비 📅2026-09-01"
        );
    }

    #[test]
    fn a_decorative_emoji_in_the_body_is_not_a_field_boundary() {
        // 본문의 📅는 뒤에 날짜가 없으므로 필드가 아니다 — 새 필드가 그 앞으로 가면
        // 사용자 문장이 갈린다.
        assert_eq!(
            insert_field("- [ ] 📅 일정 잡기 ⏫", "due", "2026-09-01"),
            "- [ ] 📅 일정 잡기 📅2026-09-01 ⏫"
        );
    }

    #[test]
    fn existing_fields_are_never_reordered() {
        // 사용자가 손으로 적은 비정규 순서(⏫가 앞)는 그대로 둔다. 새로 넣는 것만
        // 제자리에 넣는다 — 여기서는 ⏫보다 순위가 낮으므로 그 앞이 자리다.
        assert_eq!(
            insert_field("- [ ] x ⏫ 🛫2026-08-02", "due", "2026-09-01"),
            "- [ ] x 📅2026-09-01 ⏫ 🛫2026-08-02"
        );
    }

    #[test]
    fn an_unknown_field_name_leaves_the_line_untouched() {
        assert_eq!(insert_field("- [ ] x", "nope", "2026-09-01"), "- [ ] x");
    }

    #[test]
    fn a_tab_separated_field_run_is_still_found() {
        assert_eq!(
            insert_field("- [ ] x\t⏫", "due", "2026-09-01"),
            "- [ ] x 📅2026-09-01 ⏫"
        );
    }
}
