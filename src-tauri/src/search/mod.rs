// §5.11 Global Search — regex-based file walking search
// Searches all .md files under a root directory for a query pattern.

use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::fs;

pub(crate) mod replace;

/// A single search match with file path, line/column, and context snippet.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub file_path: String,
    pub line: usize,
    pub column: usize,
    pub snippet: String,
}

/// Options controlling search behavior.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default)]
    pub regex: bool,
    #[serde(default = "default_max_results")]
    pub max_results: usize,
    #[serde(default)]
    pub include_glob: Option<String>,
    #[serde(default)]
    pub exclude_glob: Option<String>,
}

fn default_max_results() -> usize {
    1000
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            case_sensitive: false,
            whole_word: false,
            regex: false,
            max_results: default_max_results(),
            include_glob: None,
            exclude_glob: None,
        }
    }
}

/// Directories to skip during recursive file collection.
use crate::fs::SKIP_DIRS;

/// Build a regex pattern from the query and options, for every search `search_files` runs:
/// the app's through `commands::search_cmd` with no check before it (the search panel, the
/// journal's search and the PDF highlight reference count call that command), and
/// `baram search`, the MCP `search` tool and a plugin's search after `check_query`.
///
/// `whole_word` puts the pattern in a group between the boundaries, `\b(?:…)\b`, so the
/// boundaries hold every alternative: `a|b` finds the word `a` or the word `b`, where the
/// wrap without the group, `\ba|b\b`, reads as `\ba` or `b\b`. A flag the expression sets,
/// such as `(?-u)`, ends with the group, so both boundaries keep the search's own flags.
///
/// The wrap is text, and it can turn an invalid expression into a valid one — `a)|(b`
/// becomes `\b(?:a)|(b)\b`, whose parentheses the wrap closed and opened. So a `regex` query
/// is built as typed first, and its error quotes it as typed. A verbose-mode (`(?x)`)
/// comment that runs to the end of a query valid as typed comments out the wrap's `)\b` as
/// well: that pattern does not build, and the query is refused rather than searched without
/// its closing boundary — with the regex crate's error, which quotes the wrapped pattern.
pub(crate) fn build_pattern(query: &str, opts: &SearchOptions) -> Result<Regex, regex::Error> {
    let build = |pattern: &str| {
        RegexBuilder::new(pattern)
            .case_insensitive(!opts.case_sensitive)
            .build()
    };
    if !opts.regex {
        let pattern = regex::escape(query);
        return if opts.whole_word {
            build(&format!(r"\b(?:{pattern})\b"))
        } else {
            build(&pattern)
        };
    }
    let typed = build(query)?;
    if opts.whole_word {
        build(&format!(r"\b(?:{query})\b"))
    } else {
        Ok(typed)
    }
}

/// Why `check_query` refuses a query. Each of its two callers words it in its own contract:
/// `cli::ops_search::search` (`baram search` and the MCP server's `search` tool) and a
/// plugin's search (`plugin::index_reads`).
#[derive(Debug)]
pub(crate) enum QueryRefusal {
    /// The query is empty — `search_files` would answer it with no hits.
    Empty,
    /// With `regex`, the query is not an expression: as typed, or as the search builds it.
    InvalidRegex(regex::Error),
    /// Without `regex`, the escaped query does not build — case-insensitively, a long enough
    /// literal exceeds the size limit.
    Unsearchable(regex::Error),
}

/// §387 · §393 Whether the search can build a pattern from `query` and `opts` — asked before
/// the search, because `search_files` reports a pattern it cannot build and a root it cannot
/// search both as a String, told apart only by its wording.
///
/// The pattern is built as the search builds it (`build_pattern`, which judges a `regex`
/// query as typed before the whole-word wrap), from the same options — those change what is
/// built: case-insensitively, `k{50000}` as a regex and fifty thousand `k`s as text both
/// fail, and case-sensitively both build.
pub(crate) fn check_query(query: &str, opts: &SearchOptions) -> Result<(), QueryRefusal> {
    if query.is_empty() {
        return Err(QueryRefusal::Empty);
    }
    build_pattern(query, opts).map(drop).map_err(|error| {
        if opts.regex {
            QueryRefusal::InvalidRegex(error)
        } else {
            QueryRefusal::Unsearchable(error)
        }
    })
}

/// §5.11 The lines of `content` as `str::lines` yields them, each with the ending `lines` strips
/// — `\r\n` or `\n`, or nothing for a last line without one; a lone `\r` ends no line — so the
/// text can be put back together byte for byte. `search_files` numbers its lines by this and
/// `replace::replace_matches` replaces by it, so the two count the same lines.
pub(crate) fn lines_with_endings(content: &str) -> impl Iterator<Item = (&str, &str)> {
    content.split_inclusive('\n').map(|chunk| {
        let line = chunk
            .strip_suffix('\n')
            .map(|rest| rest.strip_suffix('\r').unwrap_or(rest))
            .unwrap_or(chunk);
        (line, chunk.get(line.len()..).unwrap_or(""))
    })
}

/// The context a snippet takes on each side of a match: up to this many bytes, widened to
/// the nearest character boundary.
const SNIPPET_CONTEXT: usize = 100;

/// The most characters of the line a snippet holds, the `…` marks aside. The context before
/// a match is at most `SNIPPET_CONTEXT` bytes, so the cap never cuts into the context before
/// it or the match's start: what it cuts is a long match and what follows it. With the
/// context on both sides, a match up to 100 characters long is never cut. The number is in
/// the contracts that describe a snippet: `cli::ops_search::SearchRow::snippet`, the MCP
/// `search` tool's description (`cli::mcp::catalog`), the plugin API's
/// `IndexSearchMatch.snippet` (`src/plugins/types.ts`) and the `context-index` page.
const SNIPPET_CHARS: usize = 300;

/// The line around a match for a result row: up to `SNIPPET_CONTEXT` bytes either side of
/// the match, then at most `SNIPPET_CHARS` characters of that, with `…` where the line is
/// cut — before the snippet, after it, or both. Offsets are the regex's byte offsets, so
/// each cut is moved to a character boundary.
fn build_snippet(line_text: &str, match_start: usize, match_end: usize) -> String {
    // Snap start backward to nearest char boundary
    let mut snippet_start = match_start.saturating_sub(SNIPPET_CONTEXT);
    while snippet_start > 0 && !line_text.is_char_boundary(snippet_start) {
        snippet_start -= 1;
    }

    // Snap end forward to nearest char boundary
    let mut snippet_end = match_end
        .saturating_add(SNIPPET_CONTEXT)
        .min(line_text.len());
    while snippet_end < line_text.len() && !line_text.is_char_boundary(snippet_end) {
        snippet_end += 1;
    }

    let around = line_text.get(snippet_start..snippet_end).unwrap_or("");
    let (kept, capped) = match around.char_indices().nth(SNIPPET_CHARS) {
        Some((at, _)) => (around.get(..at).unwrap_or(""), true),
        None => (around, false),
    };
    let mut snippet = String::new();
    if snippet_start > 0 {
        snippet.push('…');
    }
    snippet.push_str(kept);
    if capped || snippet_end < line_text.len() {
        snippet.push('…');
    }
    snippet
}

/// Check whether a filename matches a `*.ext` glob pattern.
fn matches_extension(name: &str, pattern: &str) -> bool {
    if let Some(ext) = pattern.strip_prefix("*.") {
        name.ends_with(&format!(".{}", ext))
    } else {
        false
    }
}

/// Check whether a relative path starts with a directory prefix pattern
/// (e.g. `docs/**` or `drafts/`).
fn matches_path_prefix(rel_path: &str, pattern: &str) -> bool {
    let p = pattern.trim_end_matches('/').trim_end_matches("/**");
    rel_path.starts_with(p)
}

/// Returns true if the file (by name + rel_path) is accepted by the include patterns.
/// None / empty include_glob means "accept .md files" (default behaviour).
fn include_matches(name: &str, rel_path: &str, include_glob: Option<&str>) -> bool {
    match include_glob {
        None => name.ends_with(".md"),
        Some(glob) if glob.trim().is_empty() => name.ends_with(".md"),
        Some(glob) => glob
            .split(',')
            .map(|p| p.trim())
            .filter(|p| !p.is_empty())
            .any(|p| {
                if p.starts_with("*.") {
                    matches_extension(name, p)
                } else {
                    matches_path_prefix(rel_path, p)
                }
            }),
    }
}

/// Returns true if the file should be excluded by the exclude patterns.
fn exclude_matches(name: &str, rel_path: &str, exclude_glob: Option<&str>) -> bool {
    match exclude_glob {
        None => false,
        Some(glob) if glob.trim().is_empty() => false,
        Some(glob) => glob
            .split(',')
            .map(|p| p.trim())
            .filter(|p| !p.is_empty())
            .any(|p| {
                if p.starts_with("*.") {
                    matches_extension(name, p)
                } else {
                    matches_path_prefix(rel_path, p)
                }
            }),
    }
}

/// Recursively collect files under root, filtered by include/exclude glob patterns.
/// Default (no patterns): collects only `.md` files.
async fn collect_files(
    root: &Path,
    include_glob: Option<&str>,
    exclude_glob: Option<&str>,
) -> Vec<String> {
    let mut result = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let mut entries = match fs::read_dir(&dir).await {
            Ok(e) => e,
            Err(_) => continue,
        };

        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            let name = match entry.file_name().into_string() {
                Ok(n) => n,
                Err(_) => continue,
            };

            if let Ok(metadata) = entry.metadata().await {
                if metadata.is_dir() {
                    if !SKIP_DIRS.contains(&name.as_str()) && !name.starts_with('.') {
                        stack.push(path);
                    }
                } else if metadata.is_file() {
                    // Build a root-relative path for prefix matching
                    let rel_path = path
                        .strip_prefix(root)
                        .map(|p| p.to_string_lossy().into_owned())
                        .unwrap_or_else(|_| name.clone());
                    if include_matches(&name, &rel_path, include_glob)
                        && !exclude_matches(&name, &rel_path, exclude_glob)
                    {
                        result.push(path.to_string_lossy().into_owned());
                    }
                }
            }
        }
    }

    result.sort();
    result
}

/// Search all .md files under `root` for matches against `query`.
pub async fn search_files(
    root: &str,
    query: &str,
    opts: &SearchOptions,
) -> Result<Vec<SearchResult>, String> {
    search_page(root, query, opts, 0).await
}

/// `search_files` from the `skip`-th match on, in the order the search finds matches: by
/// file (the sorted paths `collect_files` gives), then line, then position in the line. The
/// first `skip` matches are counted and not kept — no snippet is built and no path copied
/// for them — and up to `opts.max_results` after them are returned, so a page far into a
/// search holds no more than one page of results (§389, the MCP server's `search` offset).
pub(crate) async fn search_page(
    root: &str,
    query: &str,
    opts: &SearchOptions,
    skip: usize,
) -> Result<Vec<SearchResult>, String> {
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let pattern =
        build_pattern(query, opts).map_err(|e| format!("Invalid search pattern: {}", e))?;
    let root_path = Path::new(root);

    if !root_path.is_dir() {
        return Err(format!("Root path is not a directory: {}", root));
    }

    let files = collect_files(
        root_path,
        opts.include_glob.as_deref(),
        opts.exclude_glob.as_deref(),
    )
    .await;
    let mut results = Vec::new();
    let mut skipped: usize = 0;

    for file_path in files {
        if results.len() >= opts.max_results {
            break;
        }

        let content = match fs::read_to_string(&file_path).await {
            Ok(c) => c,
            Err(_) => continue,
        };

        for (line_idx, (line_text, _)) in lines_with_endings(&content).enumerate() {
            if results.len() >= opts.max_results {
                break;
            }

            for mat in pattern.find_iter(line_text) {
                if results.len() >= opts.max_results {
                    break;
                }
                if skipped < skip {
                    skipped = skipped.saturating_add(1);
                    continue;
                }

                results.push(SearchResult {
                    file_path: file_path.clone(),
                    line: line_idx + 1,      // 1-based
                    column: mat.start() + 1, // 1-based
                    snippet: build_snippet(line_text, mat.start(), mat.end()),
                });
            }
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs as std_fs;
    use tempfile::TempDir;

    #[test]
    fn test_build_pattern_literal() {
        let opts = SearchOptions::default();
        let re = build_pattern("hello", &opts).unwrap();
        assert!(re.is_match("Hello World"));
        assert!(re.is_match("hello"));
    }

    #[test]
    fn test_build_pattern_case_sensitive() {
        let opts = SearchOptions {
            case_sensitive: true,
            ..Default::default()
        };
        let re = build_pattern("hello", &opts).unwrap();
        assert!(!re.is_match("Hello World"));
        assert!(re.is_match("hello world"));
    }

    #[test]
    fn test_build_pattern_whole_word() {
        let opts = SearchOptions {
            whole_word: true,
            ..Default::default()
        };
        let re = build_pattern("test", &opts).unwrap();
        assert!(re.is_match("a test case"));
        assert!(!re.is_match("testing case"));
    }

    /// `word` holds the whole expression between its boundaries: `a|b` finds the word `a`
    /// or the word `b`. What fails this: the expression wrapped without a group, `\ba|b\b`,
    /// which reads as `\ba` or `b\b` and finds the `a` of `ab` and the `b` of `xb`.
    #[test]
    fn word_holds_every_alternative_of_a_regex_between_its_boundaries() {
        let re = build_pattern("a|b", &options(true, true, false)).unwrap();
        assert!(re.is_match("x a y"));
        assert!(re.is_match("x b y"));
        assert!(!re.is_match("ab"), "a word starting with a");
        assert!(!re.is_match("xb"), "a word ending with b");
    }

    /// A verbose-mode comment runs to the end of the line, and the wrap is on that line. What
    /// fails this: a wrap that a trailing comment reduces to `\ba` without the group — the
    /// search would find `a` at the start of `ab`, with no boundary after it.
    #[test]
    fn a_trailing_verbose_comment_with_word_is_refused_not_searched_half_bounded() {
        let opts = options(true, true, false);
        assert!(Regex::new("(?x)a #c").is_ok(), "valid as typed");
        assert!(matches!(
            check_query("(?x)a #c", &opts),
            Err(QueryRefusal::InvalidRegex(_))
        ));
        assert!(
            build_pattern("(?x) a | b ", &opts).is_ok(),
            "verbose mode without a comment"
        );
    }

    #[test]
    fn test_build_pattern_regex() {
        let opts = SearchOptions {
            regex: true,
            ..Default::default()
        };
        let re = build_pattern(r"hel+o", &opts).unwrap();
        assert!(re.is_match("hello"));
        assert!(re.is_match("helllo"));
        assert!(!re.is_match("heo"));
    }

    #[test]
    fn test_build_pattern_invalid_regex() {
        let opts = SearchOptions {
            regex: true,
            ..Default::default()
        };
        assert!(build_pattern(r"[invalid", &opts).is_err());
    }

    fn options(regex: bool, word: bool, case_sensitive: bool) -> SearchOptions {
        SearchOptions {
            case_sensitive,
            whole_word: word,
            regex,
            ..Default::default()
        }
    }

    /// §393 What fails this: the empty check dropped — `build_pattern("")` builds, and
    /// `search_files` answers an empty query with no hits instead of a refusal.
    #[test]
    fn check_query_refuses_an_empty_query() {
        for opts in [options(false, false, false), options(true, true, true)] {
            assert!(matches!(check_query("", &opts), Err(QueryRefusal::Empty)));
        }
    }

    /// §393 `word` wraps the expression as text, and `a)|(b` becomes `\b(?:a)|(b)\b` — a
    /// pattern that builds (the first assertion). So `build_pattern` judges the expression
    /// as typed first, and `check_query` refuses it through `build_pattern`. What fails
    /// this: judging only the wrapped pattern, which lets `a)|(b` through, or a message
    /// quoting the wrapped pattern instead of the typed one.
    #[test]
    fn a_regex_is_judged_as_typed_before_the_word_wrap() {
        let opts = options(true, true, false);
        assert!(
            Regex::new(r"\b(?:a)|(b)\b").is_ok(),
            "the wrap alone hides it"
        );

        let Err(error) = build_pattern("a)|(b", &opts) else {
            panic!("a)|(b is not a valid expression");
        };
        let message = error.to_string();
        assert!(
            message.contains("a)|(b") && !message.contains(r"\b"),
            "{message}"
        );
        assert!(matches!(
            check_query("a)|(b", &opts),
            Err(QueryRefusal::InvalidRegex(_))
        ));
    }

    /// The app's search panel (`commands::search_cmd`) calls `search_files` without
    /// `check_query`. What fails this: the as-typed check kept in `check_query` alone — the
    /// panel would search `a)|(b` as `\b(?:a)|(b)\b` and list the `a` of `ab`.
    #[tokio::test]
    async fn search_files_refuses_a_regex_only_the_word_wrap_makes_valid() {
        let tmp = TempDir::new().unwrap();
        std_fs::write(tmp.path().join("a.md"), "ab\n").unwrap();
        let error = search_files(
            tmp.path().to_str().unwrap(),
            "a)|(b",
            &options(true, true, false),
        )
        .await
        .unwrap_err();
        assert!(error.starts_with("Invalid search pattern: "), "{error}");
    }

    /// §393 Case-insensitively, `k{50000}` as a regex and fifty thousand `k`s as text both
    /// exceed the size limit when built; each is refused under its own kind. What fails this:
    /// the build dropped from `check_query`, a build that ignores `case_sensitive` (both
    /// build case-sensitively), or the two kinds swapped. The pair: case-sensitively both
    /// build and pass.
    #[test]
    fn check_query_refuses_a_pattern_the_search_cannot_build() {
        let ks = "k".repeat(50000);
        assert!(matches!(
            check_query("k{50000}", &options(true, false, false)),
            Err(QueryRefusal::InvalidRegex(_))
        ));
        assert!(matches!(
            check_query(&ks, &options(false, false, false)),
            Err(QueryRefusal::Unsearchable(_))
        ));
        assert!(check_query("k{50000}", &options(true, false, true)).is_ok());
        assert!(check_query(&ks, &options(false, false, true)).is_ok());
    }

    /// §393 What fails this: a literal query compiled as typed — `(` is no expression, but
    /// as text it is searched for as written.
    #[test]
    fn check_query_passes_a_query_the_search_can_build() {
        assert!(check_query("(", &options(false, false, false)).is_ok());
        assert!(check_query("needle", &options(false, true, false)).is_ok());
        assert!(check_query(r"hel+o", &options(true, true, false)).is_ok());
    }

    #[test]
    fn test_build_snippet_short_line() {
        let snippet = build_snippet("hello world", 6, 11);
        assert_eq!(snippet, "hello world");
    }

    #[test]
    fn test_build_snippet_long_line() {
        let long = "a".repeat(300);
        let snippet = build_snippet(&long, 150, 155);
        assert!(snippet.starts_with('…'));
        assert!(snippet.ends_with('…'));
        assert!(snippet.len() < long.len());
    }

    /// A snippet holds at most `SNIPPET_CHARS` characters of the line, the `…` marks aside,
    /// and always the start of the match: a match longer than that is cut, and so is what
    /// follows it. A short match keeps its context on both sides.
    ///
    /// What fails this: the match kept whole (`.*` over a line of a million characters gave a
    /// snippet of a million characters); the cap counted in bytes (the Hangul snippet holds a
    /// third as many characters); the cut made from the start of the line (the match's start
    /// is lost behind its context).
    #[test]
    fn a_snippet_is_bounded_in_characters_and_keeps_the_start_of_the_match() {
        let line = "x".repeat(1_000_000);
        let snippet = build_snippet(&line, 0, line.len());
        assert_eq!(snippet, format!("{}…", "x".repeat(SNIPPET_CHARS)));
        let line = "\u{AC00}".repeat(1_000);
        let snippet = build_snippet(&line, 0, line.len());
        assert_eq!(snippet, format!("{}…", "\u{AC00}".repeat(SNIPPET_CHARS)));
        let line = format!("{}{}", "a".repeat(500), "b".repeat(1_000));
        let snippet = build_snippet(&line, 500, line.len());
        assert_eq!(
            snippet,
            format!("…{}{}…", "a".repeat(100), "b".repeat(SNIPPET_CHARS - 100))
        );
        let line = format!("{}needle{}", "a".repeat(150), "c".repeat(150));
        assert_eq!(
            build_snippet(&line, 150, 156),
            format!("…{}needle{}…", "a".repeat(100), "c".repeat(100))
        );
    }

    #[test]
    fn test_build_snippet_korean() {
        // "설정" is 6 bytes (2 chars × 3 bytes), match at byte 0..6
        let line = "설정(Preferences → 내보내기)에서 커스텀 Export 항목을 추가할 수 있다.";
        let snippet = build_snippet(line, 0, 6);
        assert!(snippet.contains("설정"));
    }

    #[test]
    fn test_build_snippet_korean_mid_context() {
        // Build a long Korean string and match in the middle
        let line = "가".repeat(200); // 200 chars × 3 bytes = 600 bytes
        let snippet = build_snippet(&line, 300, 303); // match "가" at char 100
        assert!(snippet.starts_with('…'));
        assert!(snippet.contains('가'));
    }

    #[tokio::test]
    async fn test_collect_md_files() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // Create test files
        std_fs::write(root.join("file1.md"), "# Test").unwrap();
        std_fs::write(root.join("file2.md"), "# Another").unwrap();
        std_fs::write(root.join("not-md.txt"), "skip me").unwrap();

        // Create sub-directory
        std_fs::create_dir(root.join("sub")).unwrap();
        std_fs::write(root.join("sub/nested.md"), "# Nested").unwrap();

        // Create skip-dir
        std_fs::create_dir(root.join("node_modules")).unwrap();
        std_fs::write(root.join("node_modules/skip.md"), "skip").unwrap();

        let files = collect_files(root, None, None).await;
        assert_eq!(files.len(), 3);
        assert!(files.iter().any(|f| f.ends_with("file1.md")));
        assert!(files.iter().any(|f| f.ends_with("file2.md")));
        assert!(files.iter().any(|f| f.ends_with("nested.md")));
    }

    #[tokio::test]
    async fn test_search_files_basic() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        std_fs::write(root.join("a.md"), "Hello world\nGoodbye world\n").unwrap();
        std_fs::write(root.join("b.md"), "No match here\n").unwrap();

        let opts = SearchOptions::default();
        let results = search_files(root.to_str().unwrap(), "world", &opts)
            .await
            .unwrap();

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].line, 1);
        assert_eq!(results[1].line, 2);
    }

    #[tokio::test]
    async fn test_search_files_max_results() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let content = "match\n".repeat(50);
        std_fs::write(root.join("many.md"), &content).unwrap();

        let opts = SearchOptions {
            max_results: 10,
            ..Default::default()
        };
        let results = search_files(root.to_str().unwrap(), "match", &opts)
            .await
            .unwrap();

        assert_eq!(results.len(), 10);
    }

    /// A page from `skip` is the slice `[skip, skip + max_results)` of the whole search, in
    /// the order the search finds the matches — the skip counted by match, not by line or by
    /// file: one start lands inside a line that holds three matches, another crosses from one
    /// file into the next, and a third lies past the last match.
    ///
    /// What fails this: the skip counted per line or per file (the page starts at another
    /// match); a skipped match kept, or `max_results` counted with the skipped ones (the
    /// page is longer or shorter).
    #[tokio::test]
    async fn a_page_from_an_offset_is_that_slice_of_the_whole_search() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        std_fs::write(root.join("a.md"), "x x x\nnone\nx\n").unwrap();
        std_fs::write(root.join("b.md"), "one x\nx and x\n").unwrap();
        let root = root.to_str().unwrap();
        let all = search_files(root, "x", &SearchOptions::default())
            .await
            .unwrap();
        let key = |hits: &[SearchResult]| -> Vec<(String, usize, usize, String)> {
            hits.iter()
                .map(|hit| {
                    (
                        hit.file_path.clone(),
                        hit.line,
                        hit.column,
                        hit.snippet.clone(),
                    )
                })
                .collect()
        };
        // Four matches in a.md (three on its first line), three in b.md.
        assert_eq!(all.len(), 7);
        for (skip, max) in [
            (0, 3),
            (1, 2),
            (2, 3),
            (3, 2),
            (4, 3),
            (6, 5),
            (7, 2),
            (99, 2),
        ] {
            let options = SearchOptions {
                max_results: max,
                ..Default::default()
            };
            let page = search_page(root, "x", &options, skip).await.unwrap();
            let end = skip.saturating_add(max).min(all.len());
            let expected = all.get(skip.min(all.len())..end).unwrap_or(&[]);
            assert_eq!(key(&page), key(expected), "skip {skip}, max {max}");
        }
    }

    #[tokio::test]
    async fn test_search_files_empty_query() {
        let tmp = TempDir::new().unwrap();
        let results = search_files(tmp.path().to_str().unwrap(), "", &SearchOptions::default())
            .await
            .unwrap();
        assert!(results.is_empty());
    }
}
