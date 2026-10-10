// §389 Pages (spec 0068 §3.4): the list tools' result, and how a list is cut into one.

use crate::cli::output::VaultInfo;
use schemars::JsonSchema;
use serde::Serialize;

/// A list tool's result. `truncated`: more items come after this page. `nextOffset`: the
/// `offset` that asks for them — there only then.
#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct Page<T> {
    pub vault: VaultInfo,
    pub items: Vec<T>,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<usize>,
}

impl<T> Page<T> {
    /// Items `[offset, offset + limit)` of a list already in the order the CLI prints it. An
    /// offset at or past the end is an empty last page, and the sum saturates: `offset` has
    /// no maximum.
    pub(super) fn cut(vault: VaultInfo, items: Vec<T>, offset: usize, limit: usize) -> Self {
        let end = offset.saturating_add(limit);
        let truncated = items.len() > end;
        Page {
            vault,
            items: items.into_iter().skip(offset).take(limit).collect(),
            truncated,
            next_offset: truncated.then_some(end),
        }
    }
}

/// One page of a note (spec 0068 §3.4).
pub(super) struct Lines {
    pub content: String,
    pub total: usize,
    pub truncated: bool,
    pub next_offset: Option<usize>,
}

/// Lines `[offset, offset + limit)` of `text`. A line is a `split_inclusive('\n')` piece —
/// its line ending included, so the pages put back together are the note's bytes, CRLF too.
/// A page also stops before the line that would take it past `max_chars` characters, except
/// its first line, which it holds whole however long: cut inside a line, a page would leave
/// no line to go on from.
pub(super) fn lines(text: &str, offset: usize, limit: usize, max_chars: usize) -> Lines {
    let all: Vec<&str> = text.split_inclusive('\n').collect();
    let total = all.len();
    let mut content = String::new();
    let mut chars = 0usize;
    let mut end = offset.min(total);
    for line in all.iter().skip(offset).take(limit) {
        let length = line.chars().count();
        if end > offset && chars.saturating_add(length) > max_chars {
            break;
        }
        content.push_str(line);
        chars = chars.saturating_add(length);
        end += 1;
    }
    let truncated = end < total;
    Lines {
        content,
        total,
        truncated,
        next_offset: truncated.then_some(end),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cut(n: usize, offset: usize, limit: usize) -> Page<usize> {
        let vault = VaultInfo {
            name: "v".into(),
            path: "/v".into(),
        };
        Page::cut(vault, (0..n).collect(), offset, limit)
    }

    /// An empty list, exactly one page, one page and one more, an offset at, past and far
    /// past the end, and the largest limit.
    ///
    /// What fails this: `truncated` from `items.len() - offset` without saturating (an
    /// overflow panic in a debug build at an offset past the end); `+` instead of
    /// `saturating_add` (an overflow panic in a debug build); `nextOffset` on the last page.
    #[test]
    fn a_list_is_cut_into_pages_at_its_edges() {
        let page = cut(0, 0, 2);
        assert!(page.items.is_empty() && !page.truncated && page.next_offset.is_none());
        let page = cut(2, 0, 2);
        assert_eq!(
            (page.items, page.truncated, page.next_offset),
            (vec![0, 1], false, None)
        );
        let page = cut(3, 0, 2);
        assert_eq!(
            (page.items, page.truncated, page.next_offset),
            (vec![0, 1], true, Some(2))
        );
        let page = cut(3, 2, 2);
        assert_eq!(
            (page.items, page.truncated, page.next_offset),
            (vec![2], false, None)
        );
        for offset in [3, 4, usize::MAX] {
            let page = cut(3, offset, 2);
            assert!(page.items.is_empty() && !page.truncated, "{offset}");
        }
        let page = cut(3, 1, usize::MAX);
        assert_eq!((page.items, page.truncated), (vec![1, 2], false));
    }

    /// What fails this: `lines()` or `split('\n')` instead of `split_inclusive` (endings lost —
    /// the pages are not the bytes); `nextOffset` from `offset + limit` instead of the lines
    /// taken.
    #[test]
    fn a_note_is_paged_by_lines_and_the_pages_are_its_bytes() {
        let text = "a\r\nbb\n\nccc"; // a\r\n · bb\n · \n · ccc
        let first = lines(text, 0, 2, 100);
        assert_eq!(first.content, "a\r\nbb\n");
        assert_eq!(
            (first.total, first.truncated, first.next_offset),
            (4, true, Some(2))
        );
        let rest = lines(text, 2, 10, 100);
        assert_eq!(rest.content, "\nccc");
        assert_eq!((rest.truncated, rest.next_offset), (false, None));
        assert_eq!(first.content + &rest.content, text);
        let empty = lines("", 0, 5, 100);
        assert_eq!(
            (empty.content.as_str(), empty.total, empty.truncated),
            ("", 0, false)
        );
        for offset in [4, 5, usize::MAX] {
            let past = lines(text, offset, 5, 100);
            assert_eq!(
                (past.content.as_str(), past.truncated),
                ("", false),
                "{offset}"
            );
        }
    }

    /// Characters, not bytes: `가나다\n` is 4 characters and 10 bytes.
    ///
    /// What fails this: the cap applied to a page's first line (an empty page for a long line,
    /// with no way past it); bytes counted for characters; the cap checked after the line is
    /// added (a page past the cap).
    #[test]
    fn a_page_stops_before_the_line_that_passes_the_cap_but_holds_a_long_first_line() {
        let text = "12345\n12\n1\n"; // 6 · 3 · 2 characters
        assert_eq!(lines(text, 0, 10, 8).content, "12345\n");
        assert_eq!(lines(text, 0, 10, 8).next_offset, Some(1));
        assert_eq!(lines(text, 0, 10, 9).content, "12345\n12\n");
        assert_eq!(lines(text, 0, 10, 3).content, "12345\n");
        assert_eq!(lines(text, 1, 10, 3).content, "12\n");
        assert_eq!(lines("가나다\n가\n", 0, 10, 6).content, "가나다\n가\n");
        assert_eq!(lines("가나다\n가\n", 0, 10, 5).content, "가나다\n");
    }
}
