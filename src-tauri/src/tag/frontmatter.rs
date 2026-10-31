// §56m The front matter's tag lists — `tags: [a, b]` and a `tags:` block list.
//
// One walk (`tag_entries`) finds their entries. The reader (`extract_frontmatter_tags`) names
// them and is the backend's one reader of them: the tag index (`get_vault_tags` ·
// `get_files_by_tag`) and the link index's graph (`index::extractor::extract_file_tags`) both
// read through it, where each had its own copy of the same patterns and loop. The app reads
// these lists in TypeScript too (the editor's tag pills, the journal and the zettel code).
// The writer (`rename_frontmatter_tags`, for `rename_tag`) rewrites the entries whose name is
// `old` or under it, compared byte for byte, so a rename touches only entries a reader counts.
// The tag index also counts `"#Solo"` under `solo`; renaming `solo` leaves it, as the body's
// writer leaves `#Solo`.

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

// Frontmatter block list item: `  - tag`, or `- tag` at the key's own indentation — YAML
// reads `tags:\n- a` as the list `[a]` too.
static FM_TAGS_BLOCK_ITEM_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*-\s+(.+)$").unwrap());

/// The plain spellings a bare entry may keep: a letter, digit or `_` first, then letters, marks,
/// digits and `_-./`, with single spaces between parts. YAML reads such a spelling as one plain
/// scalar of exactly this text, whose type `READS_AS_NON_STRING_RE` then judges.
static SAFE_PLAIN_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\A[\p{L}\p{N}_][\p{L}\p{M}\p{N}_./-]*(?: [\p{L}\p{M}\p{N}_./-]+)*\z").unwrap()
});

/// Plain spellings some YAML reader resolves to something other than a string: booleans and
/// null (`yes` · `no` · `on` · `off` · `y` · `n` too, as YAML 1.1 readers do) and anything that
/// starts with a digit and could be a number or a date.
static READS_AS_NON_STRING_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\A(?:true|false|yes|no|on|off|y|n|null|[0-9][0-9a-fA-FxXoO_.:+-]*)\z").unwrap()
});

/// `value` quoted for a bare entry: double quotes when nothing in it needs an escape (always so
/// for a name `rename_tag` accepts); else single quotes when it holds no `'` and no line break;
/// else a JSON string, which YAML reads back and the quote-stripping readers do not.
fn quoted_scalar(value: &str) -> String {
    let needs_escape = |c: char| c == '"' || c == '\\' || c < ' ';
    if !value.contains(needs_escape) {
        format!("\"{value}\"")
    } else if !value.contains(['\'', '\n', '\r']) {
        format!("'{value}'")
    } else {
        serde_json::to_string(value).unwrap_or_else(|_| format!("\"{value}\""))
    }
}

/// A tag name as a bare (unquoted) list entry spells it: plain when `SAFE_PLAIN_RE` allows the
/// spelling and no YAML reader resolves it to something other than a string
/// (`READS_AS_NON_STRING_RE`); quoted otherwise, which also quotes some spellings YAML reads as
/// this text (`-x`, `a‿b`). The `names` rows of `tag/fixtures/frontmatter-tags.json` are the
/// contract any copy of this rule, in Rust or another language, is held to: each accepted name
/// with the spelling it gets here (`the_new_name_rule_agrees_with_the_shared_fixture`).
pub(super) fn yaml_string(value: &str) -> String {
    if SAFE_PLAIN_RE.is_match(value) && !READS_AS_NON_STRING_RE.is_match(value) {
        value.to_string()
    } else {
        quoted_scalar(value)
    }
}

/// Every entry of the front matter's tag lists, in order, as byte ranges of `frontmatter`:
/// each comma-separated part of a `tags: [a, b]` line, and the value of each `- item` line
/// after a `tags:` line, indented or not, up to the first line that is not one — so the next
/// key ends the list, and its own `- x` items are not tags. A line is read without its `\n`
/// (or `\r\n`), as `str::lines` gives it.
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
/// written around it stay. A bare entry — no quote character anywhere in it, no leading `#` —
/// gets the renamed name as `yaml_string` spells it, so `null` or `123` is written quoted and
/// YAML still reads text.
/// Both names are bare (`bare_tag`).
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
        let renamed = format!("{new}{}", &name[old.len()..]);
        let bare = !text.contains(['"', '\'']) && !text.trim_start().starts_with('#');
        out.push_str(&frontmatter[copied..start]);
        out.push_str(&if bare { yaml_string(&renamed) } else { renamed });
        copied = start + name.len();
        count += 1;
    }
    out.push_str(&frontmatter[copied..]);
    (out, count)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Each spelling of an entry: it names what `bare_tag` leaves of it once its quotes are off, so `"#solo"` and a body `#solo` are one tag. Case
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
    /// YAML value; the app's own tag writers have written such lines (the editor's property
    /// pills, `updateFrontmatterTags` in `frontmatter-view.tsx`, joined the tags they parsed
    /// unquoted), and notes written that way keep them; and `rename_tag` rewrites `- #x`.
    /// Skipping them would hide tags the app wrote. What fails this: a reader that drops an entry spelled with an
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

    /// A block list may sit at its key's own indentation — `yaml` 2.9.1 and `js-yaml` 4.3.2
    /// both read `tags:\n- solo` as `tags: [solo]` (measured 2026-10-24) — and such a list is
    /// read as far as an indented one: to the first line that is not an item. A later key's
    /// `- x` list, and one before `tags:`, are not tags. What fails this: an item pattern that
    /// requires indentation (every row but the last reads nothing), or a list that runs on past
    /// `related:` (its `x` and `y` are read).
    #[test]
    fn an_unindented_block_list_is_read_up_to_the_next_key() {
        for (frontmatter, want) in [
            ("tags:\n- solo\n- \"#b\"", vec!["solo", "b"]),
            ("tags:\n- '#solo'\r\n- c\r", vec!["solo", "c"]),
            (
                "aliases:\n- x\ntags:\n- a\n- b\nrelated:\n- x\n- y",
                vec!["a", "b"],
            ),
            ("related:\n- x\ntitle: t", vec![]),
        ] {
            assert_eq!(
                extract_frontmatter_tags(frontmatter),
                want,
                "{frontmatter:?}"
            );
        }
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

    /// One case of `tag/fixtures/frontmatter-tags.json`.
    #[derive(serde::Deserialize)]
    struct FixtureCase {
        frontmatter: String,
        tags: Vec<String>,
        why: String,
    }

    /// One row of the fixture's `names`.
    #[derive(serde::Deserialize)]
    struct NameCase {
        name: String,
        accepted: bool,
        bare: Option<String>,
        why: String,
    }

    #[derive(serde::Deserialize)]
    struct Fixture {
        cases: Vec<FixtureCase>,
        names: Vec<NameCase>,
    }

    /// The shared fixture: every row of the reader tests above, the key's spellings and the
    /// other cases its `why`s give, in one file another reader of front-matter tags can read
    /// too. What fails this: a change to what the reader names for any of them — for one, a
    /// key matched with case (`Tags: [a]`, `TAGS:`), which only this test has.
    #[test]
    fn the_reader_agrees_with_the_shared_fixture() {
        let fixture: Fixture =
            serde_json::from_str(include_str!("fixtures/frontmatter-tags.json")).unwrap();
        assert!(!fixture.cases.is_empty());
        for case in &fixture.cases {
            assert_eq!(
                extract_frontmatter_tags(&case.frontmatter),
                case.tags,
                "{:?}: {}",
                case.frontmatter,
                case.why
            );
        }
    }

    /// The fixture's `names`: the rule on `rename_tag` (`tag::refusal`) and, for an accepted
    /// name, the spelling the writer gives it in a bare entry — through the writer itself, so
    /// the row pins what lands in the file. What fails this: a change to either — dropping a
    /// refusal (`-`, a filler, `²`) or the quoting (`null`, `-x`, the ZWNJ word).
    #[test]
    fn the_new_name_rule_agrees_with_the_shared_fixture() {
        let fixture: Fixture =
            serde_json::from_str(include_str!("fixtures/frontmatter-tags.json")).unwrap();
        assert!(fixture.names.iter().any(|row| row.accepted));
        assert!(fixture.names.iter().any(|row| !row.accepted));
        for row in &fixture.names {
            assert_eq!(
                crate::tag::refusal(&row.name).is_none(),
                row.accepted,
                "{:?}: {}",
                row.name,
                row.why
            );
            let written = row
                .accepted
                .then(|| rename_frontmatter_tags("tags: [solo]", "solo", &row.name).0);
            assert_eq!(
                written,
                row.bare.as_ref().map(|bare| format!("tags: [{bare}]")),
                "{:?}: {}",
                row.name,
                row.why
            );
        }
    }
}
