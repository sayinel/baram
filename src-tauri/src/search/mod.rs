// §5.11 Global Search — regex-based file walking search
// Searches all .md files under a root directory for a query pattern.

use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::fs;

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

/// Build a regex pattern from the query and options.
///
/// `check_query` builds it too, before a caller searches.
pub(crate) fn build_pattern(query: &str, opts: &SearchOptions) -> Result<Regex, regex::Error> {
    let pattern = if opts.regex {
        query.to_string()
    } else {
        regex::escape(query)
    };

    let pattern = if opts.whole_word {
        format!(r"\b{}\b", pattern)
    } else {
        pattern
    };

    RegexBuilder::new(&pattern)
        .case_insensitive(!opts.case_sensitive)
        .build()
}

/// Why `check_query` refuses a query. Each of its two callers words it in its own contract:
/// `baram search` (`cli::ops::search`) and a plugin's search (`plugin::index_reads`).
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
/// First, a `regex` query as typed. `whole_word` wraps it as text, `\b…\b`, and the wrap can
/// turn an invalid expression into a valid one — `a\` becomes `\ba\\b`, a valid pattern that
/// matches `a\b` after a word boundary — so only the query itself says whether it is one.
/// Then the pattern, built as the search builds it (`build_pattern`), from the same options —
/// those change what is built: case-insensitively, `k{50000}` as a regex and fifty thousand
/// `k`s as text both fail, and case-sensitively both build.
pub(crate) fn check_query(query: &str, opts: &SearchOptions) -> Result<(), QueryRefusal> {
    if query.is_empty() {
        return Err(QueryRefusal::Empty);
    }
    if opts.regex {
        Regex::new(query).map_err(QueryRefusal::InvalidRegex)?;
    }
    build_pattern(query, opts).map(drop).map_err(|error| {
        if opts.regex {
            QueryRefusal::InvalidRegex(error)
        } else {
            QueryRefusal::Unsearchable(error)
        }
    })
}

/// Build a snippet around a match, showing up to ~100 chars of context on each side.
/// All offsets are byte-based (from regex::Match), so we must snap to char boundaries.
fn build_snippet(line_text: &str, match_start: usize, match_end: usize) -> String {
    let max_context = 100;

    // Snap start backward to nearest char boundary
    let mut snippet_start = match_start.saturating_sub(max_context);
    while snippet_start > 0 && !line_text.is_char_boundary(snippet_start) {
        snippet_start -= 1;
    }

    // Snap end forward to nearest char boundary
    let mut snippet_end = (match_end + max_context).min(line_text.len());
    while snippet_end < line_text.len() && !line_text.is_char_boundary(snippet_end) {
        snippet_end += 1;
    }

    let mut snippet = String::new();
    if snippet_start > 0 {
        snippet.push('…');
    }
    snippet.push_str(&line_text[snippet_start..snippet_end]);
    if snippet_end < line_text.len() {
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

    for file_path in files {
        if results.len() >= opts.max_results {
            break;
        }

        let content = match fs::read_to_string(&file_path).await {
            Ok(c) => c,
            Err(_) => continue,
        };

        for (line_idx, line_text) in content.lines().enumerate() {
            if results.len() >= opts.max_results {
                break;
            }

            for mat in pattern.find_iter(line_text) {
                if results.len() >= opts.max_results {
                    break;
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

    /// §393 `word` wraps the expression as text, and `a\` becomes `\ba\\b` — a pattern that
    /// builds (the pair below). What fails this: judging only the built pattern, which lets
    /// `a\` through, or a message quoting the wrapped pattern instead of the typed one.
    #[test]
    fn check_query_judges_a_regex_as_typed_before_the_word_wrap() {
        let opts = options(true, true, false);
        assert!(build_pattern(r"a\", &opts).is_ok(), "the wrap hides it");

        let Err(QueryRefusal::InvalidRegex(error)) = check_query(r"a\", &opts) else {
            panic!("a\\ is not a valid expression");
        };
        let message = error.to_string();
        assert!(
            message.contains(r"a\") && !message.contains(r"\b"),
            "{message}"
        );
    }

    /// §393 Case-insensitively, `k{50000}` as a regex and fifty thousand `k`s as text both
    /// exceed the size limit when built; each is refused under its own kind. What fails this:
    /// the build check dropped (`k{50000}` compiles as typed, case-sensitively, and a literal
    /// is not compiled as typed at all), or the two kinds swapped. The pair: case-sensitively
    /// both build and pass.
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

    #[tokio::test]
    async fn test_search_files_empty_query() {
        let tmp = TempDir::new().unwrap();
        let results = search_files(tmp.path().to_str().unwrap(), "", &SearchOptions::default())
            .await
            .unwrap();
        assert!(results.is_empty());
    }
}
