// §56m The front matter's tag lists — `tags: [a, b]` and a `tags:` block list.
//
// One walk (`tag_entries`) finds their entries and the reader (`extract_frontmatter_tags`)
// names them; the tag index (`get_vault_tags` · `get_files_by_tag`) and the link index's graph
// (`index::extractor::extract_file_tags`) both read through it — they were two verbatim
// copies.

use super::{bare_tag, ends_tag};
use crate::md::is_tag_char;
use regex::Regex;
use std::ops::Range;
use std::sync::LazyLock;

// Frontmatter inline array: tags: [tag1, tag2, ...]
// ‼️ `(?m)` — `extract_frontmatter_tags`는 한 줄씩 넣으므로 있으나 없으나 같지만,
// `rename_frontmatter_list`는 파일 전체를 넣는다. 줄 앵커가 없으면 파일 첫 글자에서만
// 맞아 프론트매터를 영영 못 찾는다.
static FM_TAGS_INLINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?im)^tags\s*:\s*\[([^\]]*)\]").unwrap());

// Frontmatter block list header: tags:
static FM_TAGS_BLOCK_HEADER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^tags\s*:\s*$").unwrap());

// Frontmatter block list item:   - tag
static FM_TAGS_BLOCK_ITEM_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s+-\s+(.+)$").unwrap());

/// Every entry of the front matter's tag lists, in order, as byte ranges of `frontmatter`:
/// each comma-separated part of a `tags: [a, b]` line, and the value of each indented
/// `- item` line after a `tags:` line, up to the first line that is not one. A line is read
/// without its `\n` (or `\r\n`), as `str::lines` gives it.
fn tag_entries(frontmatter: &str) -> Vec<Range<usize>> {
    let mut entries = Vec::new();
    let mut in_block = false;
    let mut line_start = 0usize;
    for piece in frontmatter.split_inclusive('\n') {
        let line = piece
            .strip_suffix('\n')
            .map_or(piece, |line| line.strip_suffix('\r').unwrap_or(line));
        let at = line_start;
        line_start = line_start.saturating_add(piece.len());
        if in_block {
            if let Some(item) = FM_TAGS_BLOCK_ITEM_RE
                .captures(line)
                .and_then(|caps| caps.get(1))
            {
                entries.push(at.saturating_add(item.start())..at.saturating_add(item.end()));
                continue;
            }
            in_block = false;
        }
        if let Some(list) = FM_TAGS_INLINE_RE
            .captures(line)
            .and_then(|caps| caps.get(1))
        {
            let mut from = at.saturating_add(list.start());
            for part in list.as_str().split(',') {
                let to = from.saturating_add(part.len());
                entries.push(from..to);
                from = to.saturating_add(','.len_utf8());
            }
        } else {
            in_block = FM_TAGS_BLOCK_HEADER_RE.is_match(line);
        }
    }
    entries
}

/// The tag an entry names: the entry less the whitespace around it, then the double quotes
/// and then the single quotes around that, then every `#` in front (`bare_tag`). `"#solo"`,
/// `'solo'`, `#solo` and `solo` all name `solo`; `"#"` names nothing.
fn entry_name(entry: &str) -> &str {
    bare_tag(entry.trim().trim_matches('"').trim_matches('\''))
}

/// The tags the front matter's lists name, in order, empty names left out. Case is as
/// written — the tag index lowercases, the graph does not.
pub(crate) fn extract_frontmatter_tags(frontmatter: &str) -> Vec<String> {
    tag_entries(frontmatter)
        .into_iter()
        .filter_map(|entry| frontmatter.get(entry))
        .map(entry_name)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect()
}

/// 프론트매터 인라인 배열 `tags: [a, old, b]` 안의 이름 하나를 바꾼다.
///
/// 대괄호 **안에서만** 바꾼다 — 본문에 우연히 같은 낱말이 있어도 건드리지 않는다.
/// 여기서도 경계는 `md::is_tag_char`다: 원래의 `(?<!\w)`/`(?!\w)`는 lookaround라
/// 컴파일되지 않았고, `\w`는 하이픈도 `/`도 태그 글자로 보지 않아 `deep-work`를
/// `deep`으로 바꿔 놓았을 것이다.
pub(super) fn rename_frontmatter_list(content: &str, old: &str, new: &str) -> (String, usize) {
    let mut out = String::with_capacity(content.len());
    let mut count = 0usize;
    let mut last = 0usize;
    // 바꿀 것은 캡처 그룹(대괄호 **안**)뿐이므로 나머지는 그대로 흘려보낸다.
    for caps in FM_TAGS_INLINE_RE.captures_iter(content) {
        let inner = caps.get(1).unwrap();
        out.push_str(&content[last..inner.start()]);
        let (replaced, n) = rename_in_list(inner.as_str(), old, new);
        out.push_str(&replaced);
        count += n;
        last = inner.end();
    }
    out.push_str(&content[last..]);
    (out, count)
}

/// 쉼표로 나열된 이름들 안에서 `old`를 통째로 만나는 자리마다 바꾼다.
fn rename_in_list(list: &str, old: &str, new: &str) -> (String, usize) {
    let mut out = String::with_capacity(list.len());
    let mut count = 0usize;
    let mut from = 0usize;
    while let Some(rel) = list[from..].find(old) {
        let start = from + rel;
        let end = start + old.len();
        let before_ok = start == 0 || !list[..start].ends_with(is_tag_char);
        out.push_str(&list[from..start]);
        if before_ok && ends_tag(list[end..].chars().next()) {
            out.push_str(new);
            count += 1;
        } else {
            out.push_str(old);
        }
        from = end;
    }
    out.push_str(&list[from..]);
    (out, count)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The rows of the investigation's table (2026-10-24): an entry names what `bare_tag`
    /// leaves of it once its quotes are off, so `"#solo"` and a body `#solo` are one tag. Case
    /// is the caller's. What fails this: reading an entry without `bare_tag` (every `#` row
    /// keeps its `#`), or stripping one `#` only (`##double` stays `#double`). The last two
    /// rows are the partner: a name without `#` is read as it is.
    #[test]
    fn a_front_matter_tag_is_named_without_its_leading_hashes() {
        for (frontmatter, want) in [
            ("tags: [\"#solo\"]", vec!["solo"]),
            ("tags: [\"#Solo\"]", vec!["Solo"]),
            ("tags: ['#sq']", vec!["sq"]),
            (
                "tags:\n  - \"#blockq\"\n  - '#blockq2'",
                vec!["blockq", "blockq2"],
            ),
            ("tags: [\"#a/b\"]", vec!["a/b"]),
            ("tags: [\"##double\"]", vec!["double"]),
            ("tags: [solo, \"plain\"]", vec!["solo", "plain"]),
            ("tags:\n  - solo\n  - 'plain'", vec!["solo", "plain"]),
        ] {
            assert_eq!(
                extract_frontmatter_tags(frontmatter),
                want,
                "{frontmatter:?}"
            );
        }
    }

    /// `[#unq]` is not YAML — `#` cannot begin a plain scalar, so a YAML parser rejects the
    /// whole front matter — and in `- #blockunq` the `#` begins a comment, so the item is
    /// `null`. Both are tags here all the same: this reader reads the line as written, not its
    /// YAML value; the property pills in the editor (`updateFrontmatterTags` in
    /// `frontmatter-view.tsx`) join the tags they parsed unquoted, so they write
    /// `tags: [#solo]` themselves; and `rename_tag` rewrites `- #x`. Skipping them would hide
    /// tags the app wrote. What fails this: a reader that drops an entry spelled with an
    /// unquoted `#`.
    #[test]
    fn an_unquoted_hash_entry_is_a_tag_though_yaml_would_not_read_one() {
        assert_eq!(extract_frontmatter_tags("tags: [#unq]"), ["unq"]);
        assert_eq!(
            extract_frontmatter_tags("tags: [plain, #unq2]"),
            ["plain", "unq2"]
        );
        assert_eq!(
            extract_frontmatter_tags("tags:\n  - #blockunq"),
            ["blockunq"]
        );
    }

    /// An entry that is only `#`s, or nothing, names no tag and is not indexed — before,
    /// `"#"` was counted as the tag `#`. What fails this: dropping the empty-name filter (an
    /// empty tag would be counted, and no query could find it: `get_files_by_tag` refuses an
    /// empty name).
    #[test]
    fn an_entry_of_only_hashes_or_nothing_is_no_tag() {
        assert_eq!(
            extract_frontmatter_tags("tags: [\"#\", ##, '', , \"#\"\"\", a]"),
            ["a"]
        );
        assert_eq!(
            extract_frontmatter_tags("tags:\n  - \"#\"\n  - ##\n  - a"),
            ["a"]
        );
    }
}
