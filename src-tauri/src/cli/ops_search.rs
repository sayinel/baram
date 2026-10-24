// §387 `search` — the app's full-text search over a vault, for `baram search` and the MCP
// server's `search` tool. Split from `ops.rs` by size; the contract is the same: return
// the envelope, write nothing.

use super::error::{CliError, ErrorCode};
use super::ops::{sort_by_path_and_line, vault_info};
use super::output::{Envelope, Row};
use super::paths;
use super::vault::Vault;
use crate::search::{QueryRefusal, SearchOptions, SearchResult};
use schemars::JsonSchema;
use serde::Serialize;
use std::path::Path;

pub(crate) struct SearchQuery<'a> {
    pub query: &'a str,
    pub regex: bool,
    pub case_sensitive: bool,
    pub word: bool,
    pub folder: Option<&'a str>,
    /// How many hits to skip, in the order the search finds them. The CLI passes 0.
    pub offset: usize,
    pub limit: usize,
}

#[derive(Debug, Serialize, JsonSchema)]
pub(crate) struct SearchRow {
    pub path: String,
    pub line: usize,
    pub snippet: String,
}

impl Row for SearchRow {
    fn fields(&self) -> Vec<String> {
        vec![
            self.path.clone(),
            self.line.to_string(),
            self.snippet.clone(),
        ]
    }
}

/// `baram search <query>` — the app's full-text search over `.md` files.
///
/// `--folder` MOVES THE SEARCH ROOT instead of passing `include_glob`. That option's
/// folder form is a string prefix (`docs` also takes `docs-old/`), and the limit is
/// applied while walking — `docs-old/` sorts first and would fill it, so filtering the
/// hits afterwards comes too late. With the root moved, neither can happen.
///
/// The match's `column` is left out: it is a byte offset, which is not a character
/// position in Korean text.
pub(crate) async fn search(
    vault: &Vault,
    query: SearchQuery<'_>,
) -> Result<Envelope<SearchRow>, CliError> {
    let options = SearchOptions {
        case_sensitive: query.case_sensitive,
        whole_word: query.word,
        regex: query.regex,
        // One past the end of the page, counted after the `offset` the search skips: it does
        // not say whether it stopped early. The skipped hits are counted, not kept
        // (`search_page`), so a page far into a search holds no more than this.
        max_results: query.limit.saturating_add(1),
        include_glob: None,
        exclude_glob: None,
    };
    // Before the search, which cannot tell its refusals apart (`check_query`). ‼️ No `_` arm:
    // a fourth refusal must be worded here before the crate compiles.
    if let Err(refusal) = crate::search::check_query(query.query, &options) {
        let message = match refusal {
            QueryRefusal::Empty => "the query is empty".to_string(),
            QueryRefusal::InvalidRegex(error) => format!("invalid regular expression: {error}"),
            QueryRefusal::Unsearchable(error) => {
                format!("the query cannot be searched: {error}")
            }
        };
        return Err(CliError::new(ErrorCode::InvalidArgument, message));
    }
    let start = match query.folder {
        Some(folder) => paths::folder_arg(vault, folder)?,
        None => vault.root.clone(),
    };
    let hits = crate::search::search_page(
        &start.to_string_lossy(),
        query.query,
        &options,
        query.offset,
    )
    .await
    .map_err(|_| CliError::new(ErrorCode::Io, format!("cannot search {}", start.display())))?;
    let (truncated, items) = search_rows(vault, hits, query.limit);
    Ok(Envelope {
        vault: Some(vault_info(vault)),
        truncated,
        items,
    })
}

/// One page of rows, and whether hits go on past it. `hits` start at the page — the search
/// skipped `offset` of them in the order it found them (`search::search_page`) — and the
/// first `limit` are the page, in that order, each path relative to the vault, then sorted
/// by (path, line).
///
/// The cut comes BEFORE the sort (spec 0068 §3.4). Sorted first, a hit that sorts late on
/// one page would come back on the next, and one found later that sorts early would be on
/// none. The search's own order is `search::collect_files`' sort of the absolute path
/// strings, then line order — on Unix the same as the sort here, so the two ways agree
/// there; on Windows the separators differ and only this one is right.
fn search_rows(vault: &Vault, hits: Vec<SearchResult>, limit: usize) -> (bool, Vec<SearchRow>) {
    let truncated = hits.len() > limit;
    let mut items: Vec<SearchRow> = hits
        .into_iter()
        .take(limit)
        .map(|hit| SearchRow {
            path: paths::relative(vault, Path::new(&hit.file_path)),
            line: hit.line,
            snippet: hit.snippet,
        })
        .collect();
    sort_by_path_and_line(&mut items, |row| (row.path.as_str(), row.line as u64));
    (truncated, items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn vault_in(root: &str) -> Vault {
        Vault {
            name: "v".into(),
            root: PathBuf::from(root),
            spellings: None,
        }
    }

    fn hit(rel: &str, line: usize) -> SearchResult {
        SearchResult {
            file_path: format!("/vault/{rel}"),
            line,
            column: 1,
            snippet: format!("{rel}:{line}"),
        }
    }

    fn pairs(rows: &[SearchRow]) -> Vec<(&str, usize)> {
        rows.iter()
            .map(|row| (row.path.as_str(), row.line))
            .collect()
    }

    /// The hits come in an order other than the sorted one (`a0/` before `a/`, line 10
    /// before line 2). The cut is made on that order and the sort comes after it, so with
    /// a limit of 2 the rows are the first two hits, sorted.
    #[test]
    fn search_hits_come_out_by_path_then_line_and_the_cut_is_reported() {
        let vault = vault_in("/vault");
        let hits = || vec![hit("a0/x.md", 1), hit("a/y.md", 10), hit("a/y.md", 2)];

        let (truncated, rows) = search_rows(&vault, hits(), 3);
        assert!(!truncated, "as many hits as the limit is not a cut");
        assert_eq!(
            pairs(&rows),
            [("a/y.md", 2), ("a/y.md", 10), ("a0/x.md", 1)]
        );
        assert_eq!(rows[0].snippet, "a/y.md:2");

        let (truncated, rows) = search_rows(&vault, hits(), 2);
        assert!(truncated);
        assert_eq!(pairs(&rows), [("a/y.md", 10), ("a0/x.md", 1)]);

        let (truncated, rows) = search_rows(&vault, hits(), 1);
        assert!(truncated);
        assert_eq!(pairs(&rows), [("a0/x.md", 1)]);
    }

    /// A page is the first `limit` hits in the order the search found them, and only then
    /// sorted (spec 0068 §3.4); the search has skipped the hits before the page in that order
    /// (`search::search_page`), so the page from offset 2 is what it returns from there. The
    /// hits come in an order the sort turns around — `d`, `b`, `c`, `a` — so each wrong way
    /// gives other pages.
    ///
    /// What fails this: sorting the hits before the cut (the first page is `a b`); not
    /// sorting within the page (`d b`).
    #[test]
    fn a_page_is_cut_in_match_order_and_sorted_within_itself() {
        let vault = vault_in("/vault");
        let hits = || {
            vec![
                hit("d.md", 1),
                hit("b.md", 1),
                hit("c.md", 1),
                hit("a.md", 1),
            ]
        };
        let (truncated, first) = search_rows(&vault, hits(), 2);
        assert!(truncated, "two more hits come after the first page");
        assert_eq!(pairs(&first), [("b.md", 1), ("d.md", 1)]);
        let from_two: Vec<SearchResult> = hits().into_iter().skip(2).collect();
        let (truncated, second) = search_rows(&vault, from_two, 2);
        assert!(!truncated, "nothing comes after the fourth hit");
        assert_eq!(pairs(&second), [("a.md", 1), ("c.md", 1)]);
        // Together the two pages are every hit, once.
        let mut both: Vec<(&str, usize)> =
            pairs(&first).into_iter().chain(pairs(&second)).collect();
        both.sort_unstable();
        assert_eq!(both, [("a.md", 1), ("b.md", 1), ("c.md", 1), ("d.md", 1)]);
    }

    /// A page is cut short only when hits go on past its limit: no hits — a search from an
    /// offset past the last one — is an empty last page, and a limit near `usize::MAX` takes
    /// every hit.
    ///
    /// What fails this: `truncated` read as anything but "more hits than the limit".
    #[test]
    fn a_page_is_truncated_only_when_hits_go_on_past_its_limit() {
        let vault = vault_in("/vault");
        let hits = || vec![hit("a.md", 1), hit("b.md", 1), hit("c.md", 1)];
        for (found, limit, truncated, rows) in [
            (Vec::new(), 2, false, 0),
            (hits(), 2, true, 2),
            (hits(), 3, false, 3),
            (hits(), usize::MAX, false, 3),
        ] {
            let (cut, page) = search_rows(&vault, found, limit);
            assert_eq!((cut, page.len()), (truncated, rows), "limit {limit}");
        }
    }

    /// The search skips `offset` hits and asks for one past the page, and neither count
    /// overflows at the largest offset.
    ///
    /// What fails this: `max_results` built as `offset + limit + 1` — an overflow panic in a
    /// debug build before the search runs; the offset not handed to the search (the page
    /// holds the hit).
    #[tokio::test]
    async fn a_search_from_the_largest_offset_is_an_empty_page() {
        let dir = tempfile::TempDir::new().unwrap();
        let vault = Vault {
            name: "v".into(),
            root: dir.path().canonicalize().unwrap(),
            spellings: None,
        };
        std::fs::write(vault.root.join("a.md"), "needle\n").unwrap();
        let query = |offset| SearchQuery {
            query: "needle",
            regex: false,
            case_sensitive: false,
            word: false,
            folder: None,
            offset,
            limit: 10,
        };
        let page = search(&vault, query(usize::MAX)).await.unwrap();
        assert!(page.items.is_empty());
        assert!(!page.truncated);
        // The same vault from the start finds the hit: the empty page above is the offset's.
        let page = search(&vault, query(0)).await.unwrap();
        assert_eq!(page.items.len(), 1);
    }
}
