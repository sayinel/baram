// §387 `search` — the app's full-text search over a vault, for `baram search` and the MCP
// server's `search` tool. Split from `ops.rs` by size; the contract is the same: return
// the envelope, write nothing.

use super::error::{CliError, ErrorCode};
use super::ops::{sort_by_path_and_line, vault_info};
use super::output::{Envelope, Row};
use super::paths;
use super::vault::Vault;
use crate::search::{SearchOptions, SearchResult};
use serde::Serialize;
use std::path::Path;

pub(crate) struct SearchQuery<'a> {
    pub query: &'a str,
    pub regex: bool,
    pub case_sensitive: bool,
    pub word: bool,
    pub folder: Option<&'a str>,
    pub limit: usize,
}

#[derive(Debug, Serialize)]
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
    if query.query.is_empty() {
        return Err(CliError::new(
            ErrorCode::InvalidArgument,
            "the query is empty",
        ));
    }
    let options = SearchOptions {
        case_sensitive: query.case_sensitive,
        whole_word: query.word,
        regex: query.regex,
        // One more than asked for: `search_files` does not say whether it stopped early.
        max_results: query.limit + 1,
        include_glob: None,
        exclude_glob: None,
    };
    // The two checks below run before the search because `search_files` returns a String:
    // a pattern it cannot build and a root it cannot search could only be told apart by
    // wording.
    //
    // First, a `--regex` query as typed. `--word` wraps it as text, `\b…\b`, and the wrap
    // can turn an invalid expression into a valid one — `a\` becomes `\ba\\b`, a valid
    // pattern that matches `a\b` after a word boundary — so only the query itself says
    // whether it is one.
    if query.regex {
        if let Err(error) = regex::Regex::new(query.query) {
            return Err(CliError::new(
                ErrorCode::InvalidArgument,
                format!("invalid regular expression: {error}"),
            ));
        }
    }
    // Then the pattern, built as the search builds it, from the same options — those
    // change what is built: case-insensitively, `k{50000}` with `--regex` and fifty
    // thousand `k`s without it both fail, and with `--case-sensitive` both build.
    if let Err(error) = crate::search::build_pattern(query.query, &options) {
        let message = if query.regex {
            format!("invalid regular expression: {error}")
        } else {
            format!("the query cannot be searched: {error}")
        };
        return Err(CliError::new(ErrorCode::InvalidArgument, message));
    }
    let start = match query.folder {
        Some(folder) => paths::folder_arg(vault, folder)?,
        None => vault.root.clone(),
    };
    let hits = crate::search::search_files(&start.to_string_lossy(), query.query, &options)
        .await
        .map_err(|_| CliError::new(ErrorCode::Io, format!("cannot search {}", start.display())))?;
    let (truncated, items) = search_rows(vault, hits, query.limit);
    Ok(Envelope {
        vault: Some(vault_info(vault)),
        truncated,
        items,
    })
}

/// The rows `search` prints, and whether `hits` held more than `limit`: the first `limit`
/// hits the search gave, each path relative to the vault, in (path, line) order.
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
}
