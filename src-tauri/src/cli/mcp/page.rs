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
}
