// §29 Link extractor — extract wikilinks, block refs, block embeds, and tags from markdown content
// §34 Unlinked mention search
//
// What a rename WRITES is elsewhere: `rewriter.rs` (§33 · §30a) and, for a
// directory rename, `relative_links.rs` (§61).

use regex::Regex;
use serde::Serialize;
use std::path::Path;
use std::sync::LazyLock;

use super::IndexError;
use super::{LinkEntry, LinkKind};
use crate::md::literal::{front_matter_end, source_lines, Literal};

// Wikilink regex: [[target]], [[alias::target]], [[target|display]], [[target#heading]], etc.
// §87: optional alias:: prefix — group 1 = alias, group 2 = target
// issue 620: no link crosses a line break — the index reads a line at a time,
// and the whole-file rewriters (`rewriter.rs`) must recognise the same candidates. A
// bare `\r` is a line break too (issue 663), so it is excluded as `\n` is.
static WIKILINK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"\[\[(?:([a-zA-Z][\w-]*)::)?([^\]|#^\n\r]+)(?:#[^\]|^\n\r]+)?(?:\^[^\]|\n\r]+)?(?:\|[^\]\n\r]+)?\]\]",
    )
    .unwrap()
});

// §30c Block reference regex: ((target#^blockId)) or ((target#^blockId|display)) or ((#^blockId))
pub(super) static BLOCK_REF_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\(\(([^)#|]*?)#\^([a-zA-Z0-9][\w-]*)(?:\|[^)]+)?\)\)").unwrap());

// §30c Block embed regex: {{embed ((target#^blockId))}}
static BLOCK_EMBED_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\{\{embed \(\(([^)#|]*?)#\^([a-zA-Z0-9][\w-]*)\)\)\}\}").unwrap()
});

// Frontmatter tags: tags: [tag1, tag2]
static FM_TAGS_INLINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^tags\s*:\s*\[([^\]]*)\]").unwrap());

// Frontmatter tags block header: tags:
static FM_TAGS_BLOCK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^tags\s*:\s*$").unwrap());

// Frontmatter tags block item:   - tag
static FM_TAGS_ITEM_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s+-\s+(.+)$").unwrap());

/// §34 Unlinked mention result returned to the frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlinkedMentionResult {
    pub source_path: String,
    pub line: u32,
    pub context: String,
    pub match_text: String,
}

/// Build a truncated context string from a line
pub(crate) fn build_context(line: &str) -> String {
    let context = line.trim().to_string();
    if context.len() > 200 {
        let mut end = 200;
        while !context.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}…", &context[..end])
    } else {
        context
    }
}

/// Get the file stem (name without .md extension) from a path
pub(crate) fn file_stem_from_path(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Extract all tags (#tag, frontmatter tags) from file content, deduplicated.
pub(crate) fn extract_file_tags(content: &str) -> Vec<String> {
    let mut tags = std::collections::HashSet::new();

    // Split frontmatter
    let (frontmatter, body) = {
        let mut lines = content.splitn(2, '\n');
        let first = lines.next().unwrap_or("").trim();
        if first == "---" {
            let rest = lines.next().unwrap_or("");
            if let Some(end) = rest.find("\n---") {
                (rest[..end].to_string(), rest[end + 4..].to_string())
            } else {
                (String::new(), content.to_string())
            }
        } else {
            (String::new(), content.to_string())
        }
    };

    // Extract frontmatter tags
    if !frontmatter.is_empty() {
        let fm_lines: Vec<&str> = frontmatter.lines().collect();
        let mut i = 0;
        while i < fm_lines.len() {
            let line = fm_lines[i];
            if let Some(cap) = FM_TAGS_INLINE_RE.captures(line) {
                let inner = cap.get(1).map(|m| m.as_str()).unwrap_or("");
                for part in inner.split(',') {
                    let t = part.trim().trim_matches('"').trim_matches('\'').to_string();
                    if !t.is_empty() {
                        tags.insert(t);
                    }
                }
            } else if FM_TAGS_BLOCK_RE.is_match(line) {
                i += 1;
                while i < fm_lines.len() {
                    if let Some(cap) = FM_TAGS_ITEM_RE.captures(fm_lines[i]) {
                        let t = cap
                            .get(1)
                            .map(|m| m.as_str())
                            .unwrap_or("")
                            .trim()
                            .trim_matches('"')
                            .trim_matches('\'')
                            .to_string();
                        if !t.is_empty() {
                            tags.insert(t);
                        }
                        i += 1;
                    } else {
                        break;
                    }
                }
                continue;
            }
            i += 1;
        }
    }

    // Extract inline #tags (outside code blocks). issue 666: the tag index's
    // reader (`get_vault_tags`) and writer (`rename_tag`) share these two
    // rules — the loose fence rule and the tag alphabet — so the graph's tag
    // node is the tag the panel names, `#deep-work` included. A third copy
    // here once read `#deep-work` as `deep`.
    let clean_body = crate::md::strip_code_blocks(&body);
    tags.extend(crate::md::extract_inline_tags(&clean_body));

    tags.into_iter().collect()
}

/// Extract all links (wikilinks, block refs, block embeds) from file content
pub(crate) fn extract_links(file_path: &str, content: &str) -> Vec<LinkEntry> {
    let mut entries = Vec::new();
    // issue 620: a match inside code, HTML, math, an image or a link
    // definition is not a link — the editor's parser never reads one there,
    // and the rewriters (`rewriter.rs`) skip the same bytes, so what the index
    // counts is exactly what a rename may touch.
    // Read once, and only if a candidate turns up: a note with no `[[` or
    // `((` at all is never parsed. This is the one reader that knows the
    // note's path, so it is the one that says when the analysis gave up on
    // a block — a reference there is left out of the index with no other
    // sign — and, quietly, when a note needed more than one read.
    let mut literal: Option<Literal> = None;
    let mut analyse = || {
        let analysis = Literal::analyse(content);
        if analysis.gave_up {
            log::warn!(
                "index: {file_path}: the literal analysis gave up after {} reads; the rest of an \
                 unsettled block is left literal and nothing in it is indexed",
                analysis.reads
            );
        } else if analysis.reads > 1 {
            log::debug!(
                "index: {file_path}: literal analysis read the body {} times",
                analysis.reads
            );
        }
        analysis.literal
    };

    // issue 667: a block reference or embed in the front matter is not a
    // reference — no rewriter touches YAML (the editor's text path holds it
    // literal, the document model keeps it raw), so counting one there would
    // show a backlink nothing can rename. An attribute wikilink there stays a
    // link (decision D2 of issue 620).
    let body_start = front_matter_end(content);
    for line in source_lines(content) {
        let mut is_prose = |m: &regex::Match| {
            !literal
                .get_or_insert_with(&mut analyse)
                .overlaps(line.offset + m.start()..line.offset + m.end())
        };
        let in_front_matter = |m: &regex::Match| line.offset + m.start() < body_start;

        // §29 Wikilinks: [[target]], [[alias::target]], [[target|display]], etc.
        for cap in WIKILINK_RE.captures_iter(line.text) {
            if !is_prose(&cap.get(0).unwrap()) {
                continue;
            }
            let vault_alias = cap.get(1).map(|m| m.as_str().to_string());
            let target = cap.get(2).map(|m| m.as_str().trim()).unwrap_or("");
            if target.is_empty() {
                continue;
            }

            entries.push(LinkEntry {
                source_path: file_path.to_string(),
                target: target.to_string(),
                line: line.number,
                context: build_context(line.text),
                link_type: LinkKind::Wikilink,
                block_id: None,
                target_vault_alias: vault_alias,
            });
        }

        // §30c Block embeds first, remembering where each stands: the block
        // reference regex matches the `((…))` inside an embed too, and only a
        // match inside an embed the grammar RECOGNISED is the embed's — a
        // `{{embed ((x#^id|caption))}}` the embed regex does not accept is a
        // plain reference, indexed as one and rewritten as one (issue 668).
        let mut embed_spans: Vec<std::ops::Range<usize>> = Vec::new();
        for cap in BLOCK_EMBED_RE.captures_iter(line.text) {
            let whole = cap.get(0).unwrap();
            embed_spans.push(whole.range());
            if in_front_matter(&whole) || !is_prose(&whole) {
                continue;
            }
            let raw_target = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
            let block_id = cap.get(2).map(|m| m.as_str()).unwrap_or("");
            if block_id.is_empty() {
                continue;
            }

            // Self-ref ((#^id)) → use current file stem as target
            let target = if raw_target.is_empty() {
                file_stem_from_path(file_path)
            } else {
                raw_target.to_string()
            };

            entries.push(LinkEntry {
                source_path: file_path.to_string(),
                target,
                line: line.number,
                context: build_context(line.text),
                link_type: LinkKind::BlockEmbed,
                block_id: Some(block_id.to_string()),
                target_vault_alias: None,
            });
        }

        // §30c Block references: ((target#^blockId))
        let mut embed_cursor = 0;
        for cap in BLOCK_REF_RE.captures_iter(line.text) {
            let whole = cap.get(0).unwrap();
            if in_front_matter(&whole) || !is_prose(&whole) {
                continue;
            }
            let raw_target = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
            let block_id = cap.get(2).map(|m| m.as_str()).unwrap_or("");
            if block_id.is_empty() {
                continue;
            }

            // The `((…))` of a recognised embed was captured above. Both
            // iterators run left to right, so one cursor over the spans
            // keeps this linear in the line, however many embeds it holds.
            while embed_cursor < embed_spans.len() && embed_spans[embed_cursor].end <= whole.start()
            {
                embed_cursor += 1;
            }
            if embed_spans
                .get(embed_cursor)
                .is_some_and(|span| span.start <= whole.start() && whole.end() <= span.end)
            {
                continue;
            }

            // Self-ref ((#^id)) → use current file stem as target
            let target = if raw_target.is_empty() {
                file_stem_from_path(file_path)
            } else {
                raw_target.to_string()
            };

            entries.push(LinkEntry {
                source_path: file_path.to_string(),
                target,
                line: line.number,
                context: build_context(line.text),
                link_type: LinkKind::BlockRef,
                block_id: Some(block_id.to_string()),
                target_vault_alias: None,
            });
        }
    }

    entries
}

/// Replace [[...]] wikilink blocks with spaces of the same byte length.
/// This allows searching for unlinked mentions without matching linked ones.
pub(crate) fn strip_wikilinks(line: &str) -> String {
    WIKILINK_RE
        .replace_all(line, |caps: &regex::Captures| " ".repeat(caps[0].len()))
        .to_string()
}

/// §34 Find unlinked mentions — text occurrences of a file stem in other files,
/// NOT inside [[wikilink]] brackets. Case-insensitive, word-boundary aware.
pub async fn find_unlinked_mentions(
    file_path: &str,
    root_path: &str,
) -> Result<Vec<UnlinkedMentionResult>, IndexError> {
    let stem = Path::new(file_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    if stem.is_empty() {
        return Ok(Vec::new());
    }

    let md_files = collect_md_files(root_path).await?;
    let mut results = Vec::new();

    // Build a word-boundary regex for the stem (case-insensitive)
    let escaped = regex::escape(&stem);
    let pattern = format!(r"(?i)\b{}\b", escaped);
    let stem_re = Regex::new(&pattern)
        .map_err(|e| IndexError::IoError(std::io::Error::other(e.to_string())))?;

    for md_path in &md_files {
        // Skip the current file itself
        if md_path == file_path {
            continue;
        }

        let content = match tokio::fs::read_to_string(md_path).await {
            Ok(c) => c,
            Err(_) => continue,
        };

        // A stem the raw text does not hold cannot turn up once literal
        // bytes are blanked: skip the parse for the notes that never
        // mention it — nearly all of them, on every query.
        if !stem_re.is_match(&content) {
            continue;
        }
        // issue 620: a stem inside code, HTML, math or an image is not a
        // mention — blank those bytes (offsets and line breaks kept) before
        // the search, as the wikilinks are blanked below.
        let blanked = Literal::of(&content).blank(&content);
        for (line, visible) in source_lines(&content).zip(source_lines(&blanked)) {
            let number = line.number;
            let line = line.text;
            // Strip all [[...]] wikilinks from the line, replacing with spaces of same length
            let stripped = strip_wikilinks(visible.text);

            // Search for the stem in the stripped text (only first match per line)
            if let Some(mat) = stem_re.find(&stripped) {
                let context = line.trim().to_string();
                let context = if context.len() > 200 {
                    let mut end = 200;
                    while !context.is_char_boundary(end) {
                        end -= 1;
                    }
                    format!("{}…", &context[..end])
                } else {
                    context
                };

                results.push(UnlinkedMentionResult {
                    source_path: md_path.clone(),
                    line: number,
                    context,
                    match_text: mat.as_str().to_string(),
                });
            }
        }
    }

    Ok(results)
}

/// Recursively collect all .md files under a root path
pub async fn collect_md_files(root: &str) -> Result<Vec<String>, IndexError> {
    let mut path_bufs = Vec::new();
    crate::fs::collect_md_files(std::path::Path::new(root), &mut path_bufs)
        .await
        .map_err(|e| IndexError::IoError(std::io::Error::other(e.to_string())))?;
    Ok(path_bufs
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
}

/// §278 Every file under root — wikilink TARGETS, not link sources.
///
/// Only markdown is scanned for outgoing links; this exists so a link pointing at a
/// non-markdown file (`[[Paper.pdf]]`) resolves to a real node instead of dangling.
pub async fn collect_all_files(root: &str) -> Result<Vec<String>, IndexError> {
    let mut path_bufs = Vec::new();
    crate::fs::collect_all_files(std::path::Path::new(root), &mut path_bufs)
        .await
        .map_err(|e| IndexError::IoError(std::io::Error::other(e.to_string())))?;
    Ok(path_bufs
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::replace_wikilink_target;

    #[test]
    fn test_extract_links_basic() {
        let entries = extract_links("/test.md", "See [[architecture]] for details.");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].target, "architecture");
        assert_eq!(entries[0].line, 1);
        assert_eq!(entries[0].link_type, LinkKind::Wikilink);
        assert!(entries[0].block_id.is_none());
    }

    #[test]
    fn test_extract_links_with_display() {
        let entries = extract_links("/test.md", "Read [[arch|the doc]] here.");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].target, "arch");
    }

    #[test]
    fn test_extract_links_with_heading() {
        let entries = extract_links("/test.md", "See [[arch#intro]] and [[arch#summary|要約]].");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].target, "arch");
        assert_eq!(entries[1].target, "arch");
    }

    #[test]
    fn test_extract_links_multiple_per_line() {
        let entries = extract_links("/test.md", "Both [[foo]] and [[bar]] are important.");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].target, "foo");
        assert_eq!(entries[1].target, "bar");
    }

    #[test]
    fn test_extract_links_multiline() {
        let content = "Line 1\nSee [[target]] here\nLine 3\n[[another]]";
        let entries = extract_links("/test.md", content);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].line, 2);
        assert_eq!(entries[1].line, 4);
    }

    // §30c Block reference tests
    #[test]
    fn test_extract_block_refs() {
        let entries = extract_links("/test.md", "See ((notes#^abc123)) for context.");
        let block_refs: Vec<_> = entries
            .iter()
            .filter(|e| e.link_type == LinkKind::BlockRef)
            .collect();
        assert_eq!(block_refs.len(), 1);
        assert_eq!(block_refs[0].target, "notes");
        assert_eq!(block_refs[0].block_id, Some("abc123".to_string()));
    }

    #[test]
    fn test_extract_block_embeds() {
        let entries = extract_links("/test.md", "{{embed ((notes#^def456))}}");
        let embeds: Vec<_> = entries
            .iter()
            .filter(|e| e.link_type == LinkKind::BlockEmbed)
            .collect();
        assert_eq!(embeds.len(), 1);
        assert_eq!(embeds[0].target, "notes");
        assert_eq!(embeds[0].block_id, Some("def456".to_string()));
        // Embed should NOT also produce a blockRef
        let refs: Vec<_> = entries
            .iter()
            .filter(|e| e.link_type == LinkKind::BlockRef)
            .collect();
        assert_eq!(refs.len(), 0);
    }

    #[test]
    fn test_self_block_ref() {
        // ((#^id)) with empty target → self-reference to current file stem
        let entries = extract_links("/vault/notes.md", "See ((#^myid)) here.");
        let block_refs: Vec<_> = entries
            .iter()
            .filter(|e| e.link_type == LinkKind::BlockRef)
            .collect();
        assert_eq!(block_refs.len(), 1);
        assert_eq!(block_refs[0].target, "notes");
        assert_eq!(block_refs[0].block_id, Some("myid".to_string()));
    }

    #[test]
    fn test_mixed_links() {
        let content = "Link: [[foo]], ref: ((bar#^id1)), embed: {{embed ((baz#^id2))}}";
        let entries = extract_links("/test.md", content);
        let wikilinks: Vec<_> = entries
            .iter()
            .filter(|e| e.link_type == LinkKind::Wikilink)
            .collect();
        let refs: Vec<_> = entries
            .iter()
            .filter(|e| e.link_type == LinkKind::BlockRef)
            .collect();
        let embeds: Vec<_> = entries
            .iter()
            .filter(|e| e.link_type == LinkKind::BlockEmbed)
            .collect();
        assert_eq!(wikilinks.len(), 1);
        assert_eq!(wikilinks[0].target, "foo");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].target, "bar");
        assert_eq!(embeds.len(), 1);
        assert_eq!(embeds[0].target, "baz");
    }

    #[test]
    fn test_block_ref_with_display() {
        let entries = extract_links("/test.md", "See ((notes#^abc|my label)) here.");
        let block_refs: Vec<_> = entries
            .iter()
            .filter(|e| e.link_type == LinkKind::BlockRef)
            .collect();
        assert_eq!(block_refs.len(), 1);
        assert_eq!(block_refs[0].target, "notes");
        assert_eq!(block_refs[0].block_id, Some("abc".to_string()));
    }

    // §34 strip_wikilinks tests
    #[test]
    fn test_strip_wikilinks_basic() {
        let line = "See [[architecture]] for details about architecture.";
        let stripped = strip_wikilinks(line);
        // [[architecture]] (18 chars) should be replaced with spaces
        assert!(!stripped.contains("[["));
        assert!(stripped.contains("architecture")); // the plain text one remains
    }

    #[test]
    fn test_strip_wikilinks_preserves_plain_text() {
        let line = "No wikilinks here, just architecture text.";
        let stripped = strip_wikilinks(line);
        assert_eq!(stripped, line);
    }

    #[test]
    fn test_strip_wikilinks_with_display() {
        let line = "See [[arch|the doc]] and architecture here.";
        let stripped = strip_wikilinks(line);
        assert!(!stripped.contains("[["));
        assert!(stripped.contains("architecture"));
    }

    #[test]
    fn test_strip_wikilinks_multiple() {
        let line = "Both [[foo]] and [[bar]] plus foo and bar text.";
        let stripped = strip_wikilinks(line);
        assert!(!stripped.contains("[["));
        assert!(stripped.contains("foo"));
        assert!(stripped.contains("bar"));
    }

    // §87 Cross-vault alias extraction tests
    #[test]
    fn test_extract_cross_vault_basic() {
        let entries = extract_links("/test.md", "See [[journal::2026-03-22]] for details.");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].target, "2026-03-22");
        assert_eq!(entries[0].target_vault_alias, Some("journal".to_string()));
        assert_eq!(entries[0].link_type, LinkKind::Wikilink);
    }

    #[test]
    fn test_extract_cross_vault_with_path() {
        let entries = extract_links("/test.md", "Check [[work::skills/analyzer]] here.");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].target, "skills/analyzer");
        assert_eq!(entries[0].target_vault_alias, Some("work".to_string()));
    }

    #[test]
    fn test_extract_cross_vault_with_display() {
        let entries = extract_links("/test.md", "See [[journal::note|My Note]] here.");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].target, "note");
        assert_eq!(entries[0].target_vault_alias, Some("journal".to_string()));
    }

    #[test]
    fn test_extract_cross_vault_with_heading() {
        let entries = extract_links("/test.md", "Read [[work::doc#intro]] section.");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].target, "doc");
        assert_eq!(entries[0].target_vault_alias, Some("work".to_string()));
    }

    #[test]
    fn test_extract_regular_link_no_alias() {
        let entries = extract_links("/test.md", "Link [[normal-page]] here.");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].target, "normal-page");
        assert_eq!(entries[0].target_vault_alias, None);
    }

    #[test]
    fn test_extract_mixed_cross_vault_and_regular() {
        let entries = extract_links("/test.md", "Both [[journal::note]] and [[regular]] links.");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].target, "note");
        assert_eq!(entries[0].target_vault_alias, Some("journal".to_string()));
        assert_eq!(entries[1].target, "regular");
        assert_eq!(entries[1].target_vault_alias, None);
    }

    #[test]
    fn test_extract_cross_vault_hyphenated_alias() {
        let entries = extract_links("/test.md", "Link [[my-vault::page]] here.");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].target, "page");
        assert_eq!(entries[0].target_vault_alias, Some("my-vault".to_string()));
    }

    #[test]
    fn test_strip_wikilinks_cross_vault() {
        let line = "See [[journal::2026-03-22]] and architecture.";
        let stripped = strip_wikilinks(line);
        assert!(!stripped.contains("[["));
        assert!(stripped.contains("architecture"));
    }

    // issue 620 — a reference inside a literal region is not a reference:
    // the index, the rewriters and the mention search share `md::literal`.
    fn indexed(content: &str) -> Vec<(String, u32)> {
        extract_links("/vault/guide.md", content)
            .into_iter()
            .map(|e| (e.target, e.line))
            .collect()
    }

    #[test]
    fn links_inside_code_html_math_images_and_definitions_are_not_indexed() {
        let content = "[[prose]] `[[span]]` ((n#^p)) `((n#^s))`\n\
                       ```\n[[fence]] ((n#^f)) {{embed ((n#^f))}}\n```\n\
                       <div>\n[[html]]\n</div>\n\n\
                       ![[[alt]]](x.png) $[[math]]$ [[after]]\n\n\
                       [r]: [[definition]]\n\
                       > ```\n> [[quoted-fence]]\n> ```\n> [[quoted]]\n";
        assert_eq!(
            indexed(content),
            [
                ("prose".to_string(), 1),
                ("n".to_string(), 1),
                ("after".to_string(), 9),
                ("quoted".to_string(), 15),
            ]
        );
    }

    #[test]
    fn a_reference_that_runs_into_a_code_span_is_not_indexed() {
        assert_eq!(indexed("((n#^id|`x`)) [[ok]]\n"), [("ok".to_string(), 1)]);
    }

    #[test]
    fn offsets_follow_the_bytes_of_a_crlf_file() {
        // With `lines()` and `len() + 1` the offsets would drift one byte per
        // line and the last link would fall inside the fence's closer.
        let content = "a `x` b\r\n[[one]]\r\n```\r\n[[two]]\r\n```\r\n[[three]]\r\n";
        assert_eq!(
            indexed(content),
            [("one".to_string(), 2), ("three".to_string(), 6)]
        );
    }

    #[test]
    fn front_matter_links_are_still_indexed() {
        assert_eq!(
            indexed("---\nrelated: \"[[prop]]\"\n    - \"[[deep]]\"\n---\n[[body]]\n"),
            [
                ("prop".to_string(), 2),
                ("deep".to_string(), 3),
                ("body".to_string(), 5),
            ]
        );
    }

    #[test]
    fn front_matter_behind_a_byte_order_mark_is_indexed_and_rewritten() {
        // Without the mark the four-space YAML line would be an indented code
        // block to the parser and the link would go stale on a rename.
        let fm = "\u{FEFF}---\nrefs:\n\n    - \"[[old]]\"\n---\n";
        assert_eq!(indexed(fm), [("old".to_string(), 4)]);
        assert_eq!(
            replace_wikilink_target(fm, "old", "new-longer"),
            "\u{FEFF}---\nrefs:\n\n    - \"[[new-longer]]\"\n---\n"
        );
    }

    #[tokio::test]
    async fn an_unlinked_mention_inside_code_is_not_a_mention() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let note = format!("{root}/note.md");
        tokio::fs::write(&note, "# note\n").await.unwrap();
        tokio::fs::write(
            format!("{root}/other.md"),
            "`note` in a span, then ```\n```\nnote in a fence\n```\n[[note]] linked, note here\n",
        )
        .await
        .unwrap();
        let found = find_unlinked_mentions(&note, &root).await.unwrap();
        assert_eq!(
            found.iter().map(|m| m.line).collect::<Vec<_>>(),
            [5],
            "{found:?}"
        );
    }

    /// issue 666 — the graph's tags are the tag index's tags: the same loose
    /// fence rule (a tilde fence closes a backtick fence) and the same
    /// alphabet (a hyphen is a tag character).
    #[test]
    fn the_graphs_tag_scanner_shares_the_tag_indexs_rules() {
        let body = "```\n#inside\n~~~\n#deep-work outside #한글\n";
        let mut tags = extract_file_tags(body);
        tags.sort();
        assert_eq!(tags, vec!["deep-work", "한글"]);
        // What the shared reader says of the same body, fences stripped.
        let mut shared = crate::md::extract_inline_tags(&crate::md::strip_code_blocks(body));
        shared.sort();
        assert_eq!(tags, shared);
    }
}
