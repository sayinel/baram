// §29 Link extractor — extract wikilinks, block refs, block embeds, and tags from markdown content
// §30a Block reference/embed replacement
// §33 Wikilink target replacement
// §34 Unlinked mention search
// §61 Relative wikilink rewriting

use regex::Regex;
use serde::Serialize;
use std::path::Path;
use std::sync::LazyLock;

use super::normalizer::{make_relative_path, resolve_relative_path};
use super::{IndexError, LinkEntry};
use crate::md::literal::{source_lines, Literal};

// Wikilink regex: [[target]], [[alias::target]], [[target|display]], [[target#heading]], etc.
// §87: optional alias:: prefix — group 1 = alias, group 2 = target
// issue 620: no link crosses a line break — the index reads a line at a time,
// and the whole-file rewriters below must recognise the same candidates.
static WIKILINK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"\[\[(?:([a-zA-Z][\w-]*)::)?([^\]|#^\n]+)(?:#[^\]|^\n]+)?(?:\^[^\]|\n]+)?(?:\|[^\]\n]+)?\]\]",
    )
    .unwrap()
});

// §30c Block reference regex: ((target#^blockId)) or ((target#^blockId|display)) or ((#^blockId))
static BLOCK_REF_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\(\(([^)#|]*?)#\^([a-zA-Z0-9][\w-]*)(?:\|[^)]+)?\)\)").unwrap());

// §30c Block embed regex: {{embed ((target#^blockId))}}
static BLOCK_EMBED_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\{\{embed \(\(([^)#|]*?)#\^([a-zA-Z0-9][\w-]*)\)\)\}\}").unwrap()
});

// Inline #tag regex: #tag, #parent/child, #한국어태그
static TAG_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:^|[\s\(])#([\w\p{Script=Hangul}]+(?:/[\w\p{Script=Hangul}]+)*)").unwrap()
});

// Frontmatter tags: tags: [tag1, tag2]
static FM_TAGS_INLINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^tags\s*:\s*\[([^\]]*)\]").unwrap());

// Frontmatter tags block header: tags:
static FM_TAGS_BLOCK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^tags\s*:\s*$").unwrap());

// Frontmatter tags block item:   - tag
static FM_TAGS_ITEM_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s+-\s+(.+)$").unwrap());

// §33 Wikilink replace regex: captures (alias, target, rest) for replace_wikilink_target
// §87: optional alias:: prefix — group 1 = alias, group 2 = target, group 3 = rest
static REPLACE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"\[\[((?:[a-zA-Z][\w-]*::)?)([^\]|#^\n]+)((?:#[^\]|^\n]+)?(?:\^[^\]|\n]+)?(?:\|[^\]\n]+)?)\]\]",
    )
    .unwrap()
});

// §30a Block ref replace regex: ((target#^ID)) or ((target#^ID|display)) — also the
// `((…))` inside `{{embed ((target#^ID))}}`, so an embed needs no pass of its own.
static REF_REPLACE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\(\(([^)#|]*?)#\^([a-zA-Z0-9][\w-]*)(\|[^)]+)?\)\)").unwrap());

// §61 Relative wikilink regex: [[./path...]] or [[../path...]]
static RELATIVE_WIKILINK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[\[(\.\.?/[^\]|#^\n]+)((?:#[^\]|^\n]+)?(?:\^[^\]|\n]+)?(?:\|[^\]\n]+)?)\]\]")
        .unwrap()
});

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

/// Strip fenced code blocks from content (for tag extraction)
fn strip_code_blocks_for_tags(content: &str) -> String {
    let mut result = String::with_capacity(content.len());
    let mut in_fence = false;
    for line in content.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            result.push('\n');
            continue;
        }
        if in_fence {
            result.push('\n');
        } else {
            result.push_str(line);
            result.push('\n');
        }
    }
    result
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

    // Extract inline #tags (outside code blocks)
    let clean_body = strip_code_blocks_for_tags(&body);
    for cap in TAG_RE.captures_iter(&clean_body) {
        if let Some(m) = cap.get(1) {
            tags.insert(m.as_str().to_string());
        }
    }

    tags.into_iter().collect()
}

/// Extract all links (wikilinks, block refs, block embeds) from file content
pub(crate) fn extract_links(file_path: &str, content: &str) -> Vec<LinkEntry> {
    let mut entries = Vec::new();
    // issue 620: a match inside code, HTML, math, an image or a link
    // definition is not a link — the editor's parser never reads one there,
    // and the rewriters (below) skip the same bytes, so what the index
    // counts is exactly what a rename may touch.
    let literal = Literal::of(content);

    for line in source_lines(content) {
        let is_prose =
            |m: &regex::Match| !literal.overlaps(line.offset + m.start()..line.offset + m.end());

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
                link_type: "wikilink".to_string(),
                block_id: None,
                target_vault_alias: vault_alias,
            });
        }

        // §30c Block embeds first (so we can skip them in block ref matching)
        for cap in BLOCK_EMBED_RE.captures_iter(line.text) {
            if !is_prose(&cap.get(0).unwrap()) {
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
                link_type: "blockEmbed".to_string(),
                block_id: Some(block_id.to_string()),
                target_vault_alias: None,
            });
        }

        // §30c Block references: ((target#^blockId))
        for cap in BLOCK_REF_RE.captures_iter(line.text) {
            if !is_prose(&cap.get(0).unwrap()) {
                continue;
            }
            let raw_target = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
            let block_id = cap.get(2).map(|m| m.as_str()).unwrap_or("");
            if block_id.is_empty() {
                continue;
            }

            // Skip if this match is part of a block embed (already captured above)
            let match_start = cap.get(0).unwrap().start();
            if match_start >= 8 {
                let prefix = &line.text[..match_start];
                if prefix.ends_with("{{embed ") {
                    continue;
                }
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
                link_type: "blockRef".to_string(),
                block_id: Some(block_id.to_string()),
                target_vault_alias: None,
            });
        }
    }

    entries
}

/// §33 Replace wikilink targets in file content.
/// Handles [[old]], [[old|display]], [[old#heading]], [[old#heading|display]], [[old^blockId]], etc.
/// Only replaces the target portion, preserving display, heading, and blockId.
pub fn replace_wikilink_target(content: &str, old_target: &str, new_target: &str) -> String {
    // Match all wikilink forms: [[target]], [[target|display]], [[target#heading]], etc.
    // Capture groups: (1) target, (2) rest — #heading, ^blockId, |display in any combo
    // issue 620: a match inside a literal region is left as it is — the index
    // never counted it, the editor never read it.
    let literal = Literal::of(content);
    REPLACE_RE
        .replace_all(content, |caps: &regex::Captures| {
            let whole = caps.get(0).unwrap();
            let alias_prefix = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let captured_target = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            let rest = caps.get(3).map(|m| m.as_str()).unwrap_or("");

            // Case-insensitive comparison for target matching
            if captured_target
                .trim()
                .eq_ignore_ascii_case(old_target.trim())
                && !literal.overlaps(whole.range())
            {
                format!("[[{alias_prefix}{}{rest}]]", new_target)
            } else {
                // No match — return original
                whole.as_str().to_string()
            }
        })
        .to_string()
}

/// §30a Replace block ID references in file content.
/// Updates ((target#^oldId)), ((target#^oldId|display)), ((#^oldId)),
/// and {{embed ((target#^oldId))}} patterns.
/// §30a Rename `^old_id` → `^new_id` in the references a file makes TO ONE
/// target — the file whose block is being renamed — and nowhere else. Two notes
/// may carry the same block ID; a referrer that says `((target#^id))` and
/// `((other#^id))` must change only the first (issue 594). The index already
/// decided which of this file's lines refer to the target (`lines`, 1-based,
/// from `get_backlinks`); within those lines a reference is rewritten only if
/// its target normalizes to one of the target's keys (`backlink_keys`) — an
/// empty target names the referrer itself, never the target.
pub fn replace_block_id_refs_to(
    content: &str,
    lines: &std::collections::HashSet<u32>,
    target_keys: &[String],
    old_id: &str,
    new_id: &str,
) -> String {
    let refers_to_target = |raw_target: &str| {
        let t = raw_target.trim();
        !t.is_empty() && target_keys.contains(&super::normalizer::normalize_file_path(t))
    };
    // issue 620: the literal regions of THIS content — an index built before
    // a line became code may still name it. One pass per line: the reference
    // regex matches the `((…))` inside an embed too, and every offset stays
    // an offset into the original line, so the interval check is exact
    // whatever the new ID's length.
    let literal = Literal::of(content);
    let mut out = String::with_capacity(content.len());
    for line in source_lines(content) {
        if lines.contains(&line.number) {
            let rewritten = REF_REPLACE_RE.replace_all(line.text, |caps: &regex::Captures| {
                let whole = caps.get(0).unwrap();
                let target = caps.get(1).map(|m| m.as_str()).unwrap_or("");
                let id = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                let display = caps.get(3).map(|m| m.as_str()).unwrap_or("");
                let in_prose =
                    !literal.overlaps(line.offset + whole.start()..line.offset + whole.end());
                if id == old_id && refers_to_target(target) && in_prose {
                    format!("(({target}#^{new_id}{display}))")
                } else {
                    whole.as_str().to_string()
                }
            });
            out.push_str(&rewritten);
        } else {
            out.push_str(line.text);
        }
        out.push_str(line.terminator);
    }
    out
}

/// Replace [[...]] wikilink blocks with spaces of the same byte length.
/// This allows searching for unlinked mentions without matching linked ones.
pub(crate) fn strip_wikilinks(line: &str) -> String {
    WIKILINK_RE
        .replace_all(line, |caps: &regex::Captures| " ".repeat(caps[0].len()))
        .to_string()
}

/// §61 Rewrite relative wikilinks in content that resolve into old_dir to point to new_dir instead.
/// source_path is the file containing the content (used for relative path resolution).
pub fn rewrite_relative_wikilinks(
    content: &str,
    source_path: &str,
    old_dir: &str,
    new_dir: &str,
) -> String {
    let source_dir = Path::new(source_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let old_dir_slash = if old_dir.ends_with('/') {
        old_dir.to_string()
    } else {
        format!("{}/", old_dir)
    };

    // issue 620: a match inside a literal region is left as it is.
    let literal = Literal::of(content);
    RELATIVE_WIKILINK_RE
        .replace_all(content, |caps: &regex::Captures| {
            let whole = caps.get(0).unwrap();
            let rel_target = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let rest = caps.get(2).map(|m| m.as_str()).unwrap_or("");

            // Resolve the relative target to an absolute path (without .md)
            let resolved = resolve_relative_path(&source_dir, rel_target);

            // Check if this resolved path points into old_dir
            if (resolved.starts_with(&old_dir_slash) || resolved == old_dir)
                && !literal.overlaps(whole.range())
            {
                // Compute the new absolute path
                let suffix = &resolved[old_dir.len()..];
                let new_resolved = format!("{}{}", new_dir, suffix);
                // Convert back to relative path from source_dir
                let new_rel = make_relative_path(&source_dir, &new_resolved);
                format!("[[{new_rel}{rest}]]")
            } else {
                caps[0].to_string()
            }
        })
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

    #[test]
    fn test_extract_links_basic() {
        let entries = extract_links("/test.md", "See [[architecture]] for details.");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].target, "architecture");
        assert_eq!(entries[0].line, 1);
        assert_eq!(entries[0].link_type, "wikilink");
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
            .filter(|e| e.link_type == "blockRef")
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
            .filter(|e| e.link_type == "blockEmbed")
            .collect();
        assert_eq!(embeds.len(), 1);
        assert_eq!(embeds[0].target, "notes");
        assert_eq!(embeds[0].block_id, Some("def456".to_string()));
        // Embed should NOT also produce a blockRef
        let refs: Vec<_> = entries
            .iter()
            .filter(|e| e.link_type == "blockRef")
            .collect();
        assert_eq!(refs.len(), 0);
    }

    #[test]
    fn test_self_block_ref() {
        // ((#^id)) with empty target → self-reference to current file stem
        let entries = extract_links("/vault/notes.md", "See ((#^myid)) here.");
        let block_refs: Vec<_> = entries
            .iter()
            .filter(|e| e.link_type == "blockRef")
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
            .filter(|e| e.link_type == "wikilink")
            .collect();
        let refs: Vec<_> = entries
            .iter()
            .filter(|e| e.link_type == "blockRef")
            .collect();
        let embeds: Vec<_> = entries
            .iter()
            .filter(|e| e.link_type == "blockEmbed")
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
            .filter(|e| e.link_type == "blockRef")
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

    // §30a replace_block_id_refs_to tests
    fn lines(list: &[u32]) -> std::collections::HashSet<u32> {
        list.iter().copied().collect()
    }
    fn keys(list: &[&str]) -> Vec<String> {
        list.iter().map(|k| k.to_string()).collect()
    }

    #[test]
    fn test_replace_block_id_refs_to_basic_display_embed() {
        let content =
            "See ((notes#^abc123)) and ((notes#^abc123|my label)).\n{{embed ((notes#^abc123))}}";
        let result = replace_block_id_refs_to(
            content,
            &lines(&[1, 2]),
            &keys(&["notes"]),
            "abc123",
            "xyz789",
        );
        assert_eq!(
            result,
            "See ((notes#^xyz789)) and ((notes#^xyz789|my label)).\n{{embed ((notes#^xyz789))}}"
        );
    }

    #[test]
    fn test_replace_block_id_refs_to_leaves_other_targets_with_the_same_id() {
        // issue 594: two notes carry ^id1; only the reference to `a` changes.
        let content = "((a#^id1)) and ((b#^id1)) and ((a#^id2))";
        let result = replace_block_id_refs_to(content, &lines(&[1]), &keys(&["a"]), "id1", "newId");
        assert_eq!(result, "((a#^newId)) and ((b#^id1)) and ((a#^id2))");
    }

    #[test]
    fn test_replace_block_id_refs_to_never_touches_a_self_reference() {
        // `((#^id))` in a referrer names the referrer's own block.
        let content = "See ((#^abc123)) and ((notes#^abc123)).";
        let result =
            replace_block_id_refs_to(content, &lines(&[1]), &keys(&["notes"]), "abc123", "xyz789");
        assert_eq!(result, "See ((#^abc123)) and ((notes#^xyz789)).");
    }

    #[test]
    fn test_replace_block_id_refs_to_only_on_the_lines_the_index_named() {
        let content = "((notes#^abc)) first\n((notes#^abc)) second\n((notes#^abc)) third";
        let result =
            replace_block_id_refs_to(content, &lines(&[2]), &keys(&["notes"]), "abc", "xyz");
        assert_eq!(
            result,
            "((notes#^abc)) first\n((notes#^xyz)) second\n((notes#^abc)) third"
        );
    }

    #[test]
    fn test_replace_block_id_refs_to_matches_the_target_the_way_the_index_does() {
        // Case, extension and a path prefix normalize away, as `get_backlinks` keys do.
        let content = "((Notes#^abc)) ((dir/notes.md#^abc)) ((other#^abc))";
        let result =
            replace_block_id_refs_to(content, &lines(&[1]), &keys(&["notes"]), "abc", "xyz");
        assert_eq!(
            result,
            "((Notes#^xyz)) ((dir/notes.md#^xyz)) ((other#^abc))"
        );
    }

    #[test]
    fn test_replace_block_id_refs_to_no_match_is_byte_identical() {
        let content = "See ((notes#^other)) and {{embed ((notes#^other))}}\r\nend";
        let result =
            replace_block_id_refs_to(content, &lines(&[1, 2]), &keys(&["notes"]), "abc", "xyz");
        assert_eq!(result, content);
    }

    // §33 replace_wikilink_target tests
    #[test]
    fn test_replace_wikilink_target_basic() {
        let content = "See [[old-note]] for details.";
        let result = replace_wikilink_target(content, "old-note", "new-note");
        assert_eq!(result, "See [[new-note]] for details.");
    }

    #[test]
    fn test_replace_wikilink_target_with_display() {
        let content = "Read [[old-note|my alias]] here.";
        let result = replace_wikilink_target(content, "old-note", "new-note");
        assert_eq!(result, "Read [[new-note|my alias]] here.");
    }

    #[test]
    fn test_replace_wikilink_target_with_heading() {
        let content = "See [[old-note#intro]] and [[old-note#summary|要約]].";
        let result = replace_wikilink_target(content, "old-note", "new-note");
        assert_eq!(
            result,
            "See [[new-note#intro]] and [[new-note#summary|要約]]."
        );
    }

    #[test]
    fn test_replace_wikilink_target_case_insensitive() {
        let content = "Links: [[Old-Note]] and [[old-note]].";
        let result = replace_wikilink_target(content, "old-note", "new-note");
        assert_eq!(result, "Links: [[new-note]] and [[new-note]].");
    }

    #[test]
    fn test_replace_wikilink_target_multiple_per_line() {
        let content = "Both [[old]] and [[other]] and [[old|display]].";
        let result = replace_wikilink_target(content, "old", "new");
        assert_eq!(result, "Both [[new]] and [[other]] and [[new|display]].");
    }

    #[test]
    fn test_replace_wikilink_target_no_match() {
        let content = "See [[unrelated]] for details.";
        let result = replace_wikilink_target(content, "old", "new");
        assert_eq!(result, "See [[unrelated]] for details.");
    }

    // §61 rewrite_relative_wikilinks tests
    #[test]
    fn test_rewrite_relative_wikilinks() {
        // From notes/meeting.md: [[./ai/prompt]] → [[./ml/prompt]]
        let content = "See [[./ai/prompt]] for details.";
        let result = rewrite_relative_wikilinks(
            content,
            "/vault/notes/meeting.md",
            "/vault/notes/ai",
            "/vault/notes/ml",
        );
        assert_eq!(result, "See [[./ml/prompt]] for details.");

        // With heading: [[./ai/prompt#intro]] → [[./ml/prompt#intro]]
        let content = "See [[./ai/prompt#intro]] here.";
        let result = rewrite_relative_wikilinks(
            content,
            "/vault/notes/meeting.md",
            "/vault/notes/ai",
            "/vault/notes/ml",
        );
        assert_eq!(result, "See [[./ml/prompt#intro]] here.");

        // Non-matching relative link is unchanged
        let content = "See [[./other/file]] here.";
        let result = rewrite_relative_wikilinks(
            content,
            "/vault/notes/meeting.md",
            "/vault/notes/ai",
            "/vault/notes/ml",
        );
        assert_eq!(result, "See [[./other/file]] here.");

        // Global wikilinks are unchanged
        let content = "See [[prompt]] here.";
        let result = rewrite_relative_wikilinks(
            content,
            "/vault/notes/meeting.md",
            "/vault/notes/ai",
            "/vault/notes/ml",
        );
        assert_eq!(result, "See [[prompt]] here.");

        // From deeper path: [[../ai/models]] → [[../ml/models]]
        let content = "Link [[../ai/models]] from sub.";
        let result = rewrite_relative_wikilinks(
            content,
            "/vault/notes/sub/file.md",
            "/vault/notes/ai",
            "/vault/notes/ml",
        );
        assert_eq!(result, "Link [[../ml/models]] from sub.");
    }

    // §87 Cross-vault alias extraction tests
    #[test]
    fn test_extract_cross_vault_basic() {
        let entries = extract_links("/test.md", "See [[journal::2026-03-22]] for details.");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].target, "2026-03-22");
        assert_eq!(entries[0].target_vault_alias, Some("journal".to_string()));
        assert_eq!(entries[0].link_type, "wikilink");
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
    fn test_replace_wikilink_target_preserves_alias() {
        let content = "See [[work::old-note]] for details.";
        let result = replace_wikilink_target(content, "old-note", "new-note");
        assert_eq!(result, "See [[work::new-note]] for details.");
    }

    #[test]
    fn test_replace_wikilink_target_cross_vault_with_heading() {
        let content = "See [[work::old-note#intro]] here.";
        let result = replace_wikilink_target(content, "old-note", "new-note");
        assert_eq!(result, "See [[work::new-note#intro]] here.");
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

    #[test]
    fn a_block_id_rename_leaves_a_fenced_line_alone_even_when_the_index_named_it() {
        // Defence in depth: an index built before this change may still
        // point at a line inside a fence.
        let content = "```\n((notes#^abc))\n```\n((notes#^abc)) `((notes#^abc))`\n";
        assert_eq!(
            replace_block_id_refs_to(
                content,
                &lines(&[1, 2, 3, 4]),
                &keys(&["notes"]),
                "abc",
                "xyz"
            ),
            "```\n((notes#^abc))\n```\n((notes#^xyz)) `((notes#^abc))`\n"
        );
    }

    #[test]
    fn a_block_id_rename_on_one_line_keeps_the_code_span_whatever_the_new_length() {
        let content = "{{embed ((notes#^abc))}} `((notes#^abc))` ((notes#^abc|show))\n";
        assert_eq!(
            replace_block_id_refs_to(content, &lines(&[1]), &keys(&["notes"]), "abc", "a-much-longer-id"),
            "{{embed ((notes#^a-much-longer-id))}} `((notes#^abc))` ((notes#^a-much-longer-id|show))\n"
        );
        assert_eq!(
            replace_block_id_refs_to(content, &lines(&[1]), &keys(&["notes"]), "abc", "z"),
            "{{embed ((notes#^z))}} `((notes#^abc))` ((notes#^z|show))\n"
        );
    }

    #[test]
    fn a_block_id_rename_keeps_crlf_and_finds_its_lines_in_a_crlf_file() {
        let content = "((notes#^abc))\r\n```\r\n((notes#^abc))\r\n```\r\n((notes#^abc))\r\n";
        assert_eq!(
            replace_block_id_refs_to(content, &lines(&[1, 3, 5]), &keys(&["notes"]), "abc", "xyz"),
            "((notes#^xyz))\r\n```\r\n((notes#^abc))\r\n```\r\n((notes#^xyz))\r\n"
        );
    }

    #[test]
    fn a_wikilink_target_rename_skips_code_and_a_link_broken_across_lines() {
        let content = "[[old]] `[[old]]`\n```\n[[old]]\n```\n    [[old]]\n[[old|shown]]\n";
        assert_eq!(
            replace_wikilink_target(content, "old", "new"),
            "[[new]] `[[old]]`\n```\n[[old]]\n```\n    [[old]]\n[[new|shown]]\n"
        );
        // The index reads a line at a time and never sees `[[a\nb]]`; the
        // rewriter must not either.
        assert_eq!(replace_wikilink_target("[[a\nb]]", "a\nb", "c"), "[[a\nb]]");
    }

    #[test]
    fn a_relative_wikilink_rewrite_skips_code() {
        let content = "[[../old/x]] `[[../old/x]]`\n```\n[[../old/x]]\n```\n";
        assert_eq!(
            rewrite_relative_wikilinks(content, "/v/a/note.md", "/v/old", "/v/new"),
            "[[../new/x]] `[[../old/x]]`\n```\n[[../old/x]]\n```\n"
        );
    }

    /// issue 620 — the cross-language contract: the editor's text path
    /// (`block-id-rename-markdown.ts`) and this reader→writer chain rewrite
    /// the same references. The expectations live in the JSON, not in
    /// either implementation; the vitest side reads the same file.
    #[test]
    fn the_rename_fixtures_shared_with_the_frontend_hold() {
        let doc: serde_json::Value =
            serde_json::from_str(include_str!("../md/fixtures/literal-regions.json")).unwrap();
        let referrer = doc["referrer"].as_str().unwrap();
        let target = doc["target"].as_str().unwrap();
        let (old, new) = (doc["old"].as_str().unwrap(), doc["new"].as_str().unwrap());
        for case in doc["cases"].as_array().unwrap() {
            let (name, markdown) = (
                case["name"].as_str().unwrap(),
                case["markdown"].as_str().unwrap(),
            );
            let mut index = crate::index::LinkIndex::new();
            index.update_file_from_content(referrer, markdown);
            let lines: std::collections::HashSet<u32> = index
                .block_reference_lines(target, old)
                .into_iter()
                .filter(|(source, _)| source == referrer)
                .map(|(_, line)| line)
                .collect();
            let keys = crate::index::backlink_keys(target);
            assert_eq!(
                replace_block_id_refs_to(markdown, &lines, &keys, old, new),
                case["expected"].as_str().unwrap(),
                "{name}"
            );
        }
    }
}
