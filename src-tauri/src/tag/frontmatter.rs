// §56m The front matter's tag lists — `tags: [a, b]` and a `tags:` block list.
//
// One walk (`tag_entries`) finds their entries. The reader (`extract_frontmatter_tags`) names
// them; the tag index (`get_vault_tags` · `get_files_by_tag`) and the link index's graph
// (`index::extractor::extract_file_tags`) both read through it — they were two verbatim
// copies. The writer (`rename_frontmatter_tags`, for `rename_tag`) rewrites the names it
// matches, so a rename touches exactly the entries a reader counts.

use super::bare_tag;
use regex::Regex;
use std::ops::Range;
use std::sync::LazyLock;

// Frontmatter inline array: tags: [tag1, tag2, ...]
static FM_TAGS_INLINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^tags\s*:\s*\[([^\]]*)\]").unwrap());

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

/// Renames the tag `old` to `new` in the front matter's tag lists and says in how many
/// entries. An entry is renamed when it names `old` or a child of it (`project/baram`
/// follows `project`, as in the body); only the name is replaced, so the quotes and the `#`s
/// written around it stay. Both names are bare (`bare_tag`).
pub(super) fn rename_frontmatter_tags(frontmatter: &str, old: &str, new: &str) -> (String, usize) {
    let mut out = String::with_capacity(frontmatter.len());
    let mut count = 0usize;
    let mut copied = 0usize;
    for entry in tag_entries(frontmatter) {
        let Some(text) = frontmatter.get(entry.clone()) else {
            continue;
        };
        let name = entry_name(text);
        let names_old = name
            .strip_prefix(old)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'));
        if !names_old {
            continue;
        }
        // `entry_name` only shortens `text` at its ends, so `name` is a slice of it and
        // begins where its pointer does.
        let start = entry.start + (name.as_ptr() as usize - text.as_ptr() as usize);
        out.push_str(&frontmatter[copied..start]);
        out.push_str(new);
        copied = start + old.len();
        count += 1;
    }
    out.push_str(&frontmatter[copied..]);
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
