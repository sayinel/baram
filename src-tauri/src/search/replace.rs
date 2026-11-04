// §5.11 The search panel's Replace and Replace All: a text with the search's matches replaced,
// matched as `search_files` matches them — by `build_pattern`, line by line.

use super::{build_pattern, lines_with_endings, SearchOptions};
use std::fmt;

/// How many bytes longer than the text it replaces the text built so far may be before the
/// replacement is refused. A pattern that matches the empty string matches at every position,
/// so a long replacement for it multiplies the text; past this the panel gets an error instead
/// of a text that size. The check runs after each match, so one match's replacement is built in
/// full before it can be refused.
pub(crate) const MAX_GROWTH: usize = 64 * 1024 * 1024;

/// Which matches a replacement takes. The panel names it on every call — `{"kind": "all"}` or
/// `{"kind": "one", "line": …, "column": …}` — so a payload without it is refused, not read as
/// one kind or the other.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum ReplaceTarget {
    /// Every match in the text.
    All,
    /// The match that starts at this 1-based line and 1-based byte column — where
    /// `search_files` listed one (`SearchResult::line` · `column`).
    One { line: usize, column: usize },
}

#[derive(Debug)]
pub(crate) enum ReplaceError {
    /// The query is no pattern the search builds — `build_pattern`'s error.
    Pattern(regex::Error),
    /// The replaced text would grow by more than `MAX_GROWTH`.
    TooLarge,
}

impl fmt::Display for ReplaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ReplaceError::Pattern(error) => write!(f, "Invalid search pattern: {error}"),
            ReplaceError::TooLarge => write!(
                f,
                "The replaced text would grow by more than {} MiB; this file was left as it was",
                MAX_GROWTH / (1024 * 1024)
            ),
        }
    }
}

/// `content` with the matches of `query` replaced by `replacement`, found as `search_files`
/// finds them: the pattern from `build_pattern`, each line of `lines_with_endings` matched on
/// its own, the matches `captures_iter` yields — the same matches as the `find_iter` the search
/// lists. So `ReplaceTarget::One` at a `SearchResult`'s line and column names the match the
/// search listed there, if the text is the one it searched. The line endings, and everything
/// between matches, come back as they were.
///
/// With `regex`, `replacement` refers to the match the regex crate's way (`$0`, `$1`, `${1}`,
/// `${name}`, `$$` for a `$`); without it, `replacement` is text. An empty query replaces
/// nothing, as `search_files` finds nothing for it.
pub(crate) fn replace_matches(
    content: &str,
    query: &str,
    opts: &SearchOptions,
    replacement: &str,
    target: ReplaceTarget,
) -> Result<String, ReplaceError> {
    replace_within(content, query, opts, replacement, target, MAX_GROWTH)
}

fn replace_within(
    content: &str,
    query: &str,
    opts: &SearchOptions,
    replacement: &str,
    target: ReplaceTarget,
    max_growth: usize,
) -> Result<String, ReplaceError> {
    if query.is_empty() {
        return Ok(content.to_string());
    }
    let pattern = build_pattern(query, opts).map_err(ReplaceError::Pattern)?;
    let mut out = String::with_capacity(content.len());
    // Where the current line starts in `content`, so the bytes of it already replaced are known.
    let mut offset = 0usize;
    for (index, (line, ending)) in lines_with_endings(content).enumerate() {
        let start = offset;
        offset = offset
            .saturating_add(line.len())
            .saturating_add(ending.len());
        let column = match target {
            ReplaceTarget::All => None,
            ReplaceTarget::One {
                line: number,
                column,
            } if number == index + 1 => Some(column),
            ReplaceTarget::One { .. } => {
                out.push_str(line);
                out.push_str(ending);
                continue;
            }
        };
        // What `Regex::replace_all` does, with the growth checked after each match and, for one
        // match, only the one that starts at the column replaced. Group 0 is the whole match and
        // every match has it, and the regex's offsets in `line` fall on character boundaries, so
        // neither the `else` nor a `get` below that returns `None` is taken.
        let mut last = 0;
        for caps in pattern.captures_iter(line) {
            let Some(whole) = caps.get(0) else {
                continue;
            };
            if column.is_some_and(|column| whole.start().saturating_add(1) != column) {
                continue;
            }
            out.push_str(line.get(last..whole.start()).unwrap_or(""));
            if opts.regex {
                caps.expand(replacement, &mut out);
            } else {
                out.push_str(replacement);
            }
            last = whole.end();
            let replaced = start.saturating_add(last);
            if out.len().saturating_sub(replaced) > max_growth {
                return Err(ReplaceError::TooLarge);
            }
            if column.is_some() {
                break;
            }
        }
        out.push_str(line.get(last..).unwrap_or(""));
        out.push_str(ending);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(regex: bool, word: bool, case_sensitive: bool) -> SearchOptions {
        SearchOptions {
            case_sensitive,
            whole_word: word,
            regex,
            ..Default::default()
        }
    }

    fn all(content: &str, query: &str, opts: &SearchOptions, replacement: &str) -> String {
        replace_matches(content, query, opts, replacement, ReplaceTarget::All).unwrap()
    }

    fn one(
        content: &str,
        query: &str,
        opts: &SearchOptions,
        replacement: &str,
        line: usize,
        column: usize,
    ) -> String {
        replace_matches(
            content,
            query,
            opts,
            replacement,
            ReplaceTarget::One { line, column },
        )
        .unwrap()
    }

    /// The replaced matches are the ones the search lists, where the panel's old JS pattern
    /// read `\b` another way. What fails this: a JS-dialect pattern (JS `\b` knows ASCII word
    /// characters only, with or without the `u` flag, so it rewrote the `가` inside `x가y` and
    /// the `café` inside `cafés`), or a wrap without the group.
    #[test]
    fn a_whole_word_replacement_takes_the_words_the_search_lists() {
        let word = options(false, true, false);
        assert_eq!(all("가 x가y", "가", &word, "X"), "X x가y");
        assert_eq!(all("café cafés", "café", &word, "X"), "X cafés");
        let regex_word = options(true, true, false);
        assert_eq!(
            all("a b apple web", "a|b", &regex_word, "X"),
            "X X apple web"
        );
    }

    /// `search_files` matches each line on its own. What fails this: matching the whole text —
    /// `a\sb` would run across a line break, and `^` would anchor at the start of the text
    /// only.
    #[test]
    fn a_replacement_matches_line_by_line_as_the_search_does() {
        let regex = options(true, false, true);
        assert_eq!(all("a\nb", r"a\sb", &regex, "X"), "a\nb");
        assert_eq!(all("x1\nx2\r\nx3", "^x", &regex, "Y"), "Y1\nY2\r\nY3");
        assert_eq!(all("ab\nab", "b$", &regex, "Z"), "aZ\naZ");
    }

    /// The text around the matches comes back byte for byte: line endings (`\n`, `\r\n`, none
    /// at the end), a lone `\r` inside a line, empty lines. What fails this: rebuilding the
    /// text from `lines()` and a fixed `\n`.
    #[test]
    fn a_replacement_keeps_every_line_ending() {
        let text = "a\r\n\na\rb\r\na";
        let plain = options(false, false, true);
        assert_eq!(all(text, "a", &plain, "X"), "X\r\n\nX\rb\r\nX");
        assert_eq!(all(text, "zzz", &plain, "X"), text);
        assert_eq!(all("a\n", "a", &plain, "X"), "X\n");
    }

    /// The lines are `str::lines`' lines, which `search_files` numbered by before it shared
    /// `lines_with_endings`. `^` marks where each line starts: a lone `\r` starts none. `x$`
    /// sees where one ends: a final `\r` with no `\n` after it stays in the line, so `x` is not
    /// at its end. What fails this: a split that disagrees with `lines()` on one of these —
    /// one that read the final `\r` as a line ending would replace `x` in `x\r`, a match the
    /// search never listed.
    #[test]
    fn the_lines_replaced_are_the_lines_str_lines_yields() {
        let regex = options(true, false, true);
        for text in ["a\nb", "a\r\nb\r\n", "a\rb\nc", "x\r", "\n\n", "", "only"] {
            let marked = all(text, "^", &regex, "|");
            let expected: Vec<String> = text.lines().map(|line| format!("|{line}")).collect();
            let got: Vec<&str> = marked.lines().collect();
            assert_eq!(got, expected, "{text:?}");
        }
        assert_eq!(all("x\r", "x$", &regex, "Y"), "x\r");
        assert_eq!(all("x\r\n", "x$", &regex, "Y"), "Y\r\n");
    }

    /// One match: the one that starts at that line and byte column, and no other. What fails
    /// this: replacing the first match on the line (what the panel's Replace did), counting the
    /// column in characters (`가` is three bytes), or replacing when nothing starts there.
    #[test]
    fn one_replacement_takes_only_the_match_at_its_line_and_column() {
        let plain = options(false, false, true);
        assert_eq!(one("가 가\n가", "가", &plain, "X", 1, 5), "가 X\n가");
        assert_eq!(one("가 가\n가", "가", &plain, "X", 2, 1), "가 가\nX");
        assert_eq!(
            one("가 가\n가", "가", &plain, "X", 1, 2),
            "가 가\n가",
            "byte 1"
        );
        assert_eq!(
            one("가 가\n가", "가", &plain, "X", 3, 1),
            "가 가\n가",
            "no line 3"
        );
        assert_eq!(
            one("가 가\n가", "가", &plain, "X", 1, 0),
            "가 가\n가",
            "column 0"
        );
    }

    /// With `regex`, the replacement refers to the match the regex crate's way — `$0`, `$1`,
    /// `${1}`, `${name}`, `$$` — in Replace and Replace All alike. Without it, the replacement
    /// is text in both. What fails this: expanding a text replacement, or not expanding a regex
    /// one, in either kind.
    #[test]
    fn groups_expand_in_a_regex_replacement_and_nowhere_else() {
        let regex = options(true, false, true);
        assert_eq!(all("ab-cd", r"(\w)(\w)", &regex, "$2$1"), "ba-dc");
        assert_eq!(all("ab", r"(?P<x>a)", &regex, "${x}${x}$$"), "aa$b");
        assert_eq!(all("ab", "a", &regex, "[$0]"), "[a]b");
        assert_eq!(one("ab ab", "(a)", &regex, "[$1]", 1, 4), "ab [a]b");
        let plain = options(false, false, true);
        assert_eq!(all("a", "a", &plain, "$1$$"), "$1$$");
        assert_eq!(one("a a", "a", &plain, "$0", 1, 3), "a $0");
    }

    /// The regex crate's syntax, as the search reads it: an inline flag JS refuses, and a
    /// Unicode class JS without the `u` flag reads as text. What fails this: a JS-dialect
    /// pattern.
    #[test]
    fn a_replacement_takes_the_regex_syntax_the_search_takes() {
        let regex = options(true, false, true);
        assert_eq!(all("Ab ab", "(?i)ab", &regex, "x"), "x x");
        assert_eq!(all("한a글", r"\p{Hangul}", &regex, "*"), "*a*");
    }

    /// An empty query finds nothing in the search (`search_files` returns no hits), so it
    /// replaces nothing; a query the search refuses is refused here too. What fails this:
    /// building the empty pattern, which matches at both ends and between every two
    /// characters.
    #[test]
    fn an_empty_query_replaces_nothing_and_a_refused_one_is_an_error() {
        let regex = options(true, false, true);
        assert_eq!(all("abc", "", &regex, "X"), "abc");
        assert!(matches!(
            replace_matches("abc", "(", &regex, "X", ReplaceTarget::All),
            Err(ReplaceError::Pattern(_))
        ));
        let regex_word = options(true, true, true);
        assert!(matches!(
            replace_matches("ab", "a)|(b", &regex_word, "X", ReplaceTarget::All),
            Err(ReplaceError::Pattern(_))
        ));
    }

    /// `x*` matches the empty string at every position, so a long replacement multiplies the
    /// text. Past `MAX_GROWTH` the replacement is refused instead of built. What fails this:
    /// no limit — the text grows by the replacement at every byte. The pair: a replacement
    /// that grows the text by less than the limit goes through.
    #[test]
    fn a_replacement_that_would_grow_past_the_limit_is_refused() {
        let regex = options(true, false, true);
        let line = "y".repeat(1024);
        let replacement = "z".repeat(MAX_GROWTH / 1024 + 1);
        assert!(matches!(
            replace_matches(&line, "x*", &regex, &replacement, ReplaceTarget::All),
            Err(ReplaceError::TooLarge)
        ));
        let grown = all(&line, "x*", &regex, "zz");
        assert_eq!(grown.len(), line.len() + 2 * (line.len() + 1));
    }

    /// The limit is on how much the text grows, wherever the growth is: the text still to come
    /// after the matches does not count toward it. What fails this: comparing the text built so
    /// far with the whole input plus the limit — a line of matches before a long rest grows by
    /// many times the limit and passes, since the rest is not built yet when the check runs.
    #[test]
    fn the_limit_counts_growth_not_the_text_still_to_come() {
        let plain = options(false, false, true);
        let content = format!("aaaa\n{}", "b".repeat(100));
        let grow = |limit| {
            replace_within(
                &content,
                "a",
                &plain,
                &"X".repeat(10),
                ReplaceTarget::All,
                limit,
            )
        };
        assert!(
            matches!(grow(30), Err(ReplaceError::TooLarge)),
            "grows by 36"
        );
        assert_eq!(grow(36).unwrap().len(), content.len() + 36);
    }

    /// The panel names the target in every payload. What fails this: a target that defaults
    /// when it is missing — a missing target read as `All` would turn the panel's Replace of one
    /// match into Replace All.
    #[test]
    fn a_target_is_read_from_its_kind_and_a_missing_kind_is_refused() {
        let read = |value: serde_json::Value| serde_json::from_value::<ReplaceTarget>(value);
        assert_eq!(
            read(serde_json::json!({ "kind": "all" })).unwrap(),
            ReplaceTarget::All
        );
        assert_eq!(
            read(serde_json::json!({ "kind": "one", "line": 2, "column": 5 })).unwrap(),
            ReplaceTarget::One { line: 2, column: 5 }
        );
        assert!(read(serde_json::json!({ "line": 2, "column": 5 })).is_err());
        assert!(read(serde_json::json!({ "kind": "one", "line": 2 })).is_err());
    }
}
