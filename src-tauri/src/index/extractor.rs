// §29 Link extractor — extract wikilinks, block refs, block embeds, and tags from markdown content
// §30a Block reference/embed replacement
// §33 Wikilink target replacement
// §34 Unlinked mention search
// §61 Relative wikilink rewriting

use regex::Regex;
use serde::Serialize;
use std::path::Path;
use std::sync::LazyLock;

use super::normalizer::normalize_target;
use super::{IndexError, LinkEntry};
use crate::md::literal::{front_matter_end, source_lines, Literal};

// Wikilink regex: [[target]], [[alias::target]], [[target|display]], [[target#heading]], etc.
// §87: optional alias:: prefix — group 1 = alias, group 2 = target
// issue 620: no link crosses a line break — the index reads a line at a time,
// and the whole-file rewriters below must recognise the same candidates. A
// bare `\r` is a line break too (issue 663), so it is excluded as `\n` is.
static WIKILINK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"\[\[(?:([a-zA-Z][\w-]*)::)?([^\]|#^\n\r]+)(?:#[^\]|^\n\r]+)?(?:\^[^\]|\n\r]+)?(?:\|[^\]\n\r]+)?\]\]",
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
        r"\[\[((?:[a-zA-Z][\w-]*::)?)([^\]|#^\n\r]+)((?:#[^\]|^\n\r]+)?(?:\^[^\]|\n\r]+)?(?:\|[^\]\n\r]+)?)\]\]",
    )
    .unwrap()
});

// §30a Block ref replace regex: ((target#^ID)) or ((target#^ID|display)) — also the
// `((…))` inside `{{embed ((target#^ID))}}`, so an embed needs no pass of its own.
static REF_REPLACE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\(\(([^)#|]*?)#\^([a-zA-Z0-9][\w-]*)(\|[^)]+)?\)\)").unwrap());

// §61 Relative wikilink regex: [[./path...]] or [[../path...]]
static RELATIVE_WIKILINK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"\[\[(\.\.?/[^\]|#^\n\r]+)((?:#[^\]|^\n\r]+)?(?:\^[^\]|\n\r]+)?(?:\|[^\]\n\r]+)?)\]\]",
    )
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
    // and the rewriters (below) skip the same bytes, so what the index
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
                link_type: "wikilink".to_string(),
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
                link_type: "blockEmbed".to_string(),
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
///
/// issue 678: the target test is the index's filing rule, `normalize_target`
/// — `.md` stripped, case folded — so every link the index counted for the
/// old name is rewritten, and none is left to be reported as stale. A link
/// spelled with `.md` keeps that spelling on the new name.
pub fn replace_wikilink_target(content: &str, old_target: &str, new_target: &str) -> String {
    // Match all wikilink forms: [[target]], [[target|display]], [[target#heading]], etc.
    // Capture groups: (1) target, (2) rest — #heading, ^blockId, |display in any combo
    // issue 620: a match inside a literal region is left as it is — the index
    // never counted it, the editor never read it. The literal set is read
    // only once a match names the old target: a vault-wide rename visits
    // every note, and most hold no such link.
    let old_key = normalize_target(old_target);
    let mut literal: Option<Literal> = None;
    REPLACE_RE
        .replace_all(content, |caps: &regex::Captures| {
            let whole = caps.get(0).unwrap();
            let alias_prefix = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let captured_target = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            let rest = caps.get(3).map(|m| m.as_str()).unwrap_or("");

            if normalize_target(captured_target) == old_key
                && !literal
                    .get_or_insert_with(|| Literal::of(content))
                    .overlaps(whole.range())
            {
                let suffix = if captured_target.trim().ends_with(".md") {
                    ".md"
                } else {
                    ""
                };
                format!("[[{alias_prefix}{new_target}{suffix}{rest}]]")
            } else {
                // No match — return original
                whole.as_str().to_string()
            }
        })
        .to_string()
}

/// §30a Rename `^old_id` → `^new_id` in the references a file makes TO ONE
/// target — the file whose block is being renamed — and nowhere else. Two notes
/// may carry the same block ID; a referrer that says `((target#^id))` and
/// `((other#^id))` must change only the first (issue 594). Handles
/// `((target#^oldId))`, `((target#^oldId|display))` and the `((…))` inside
/// `{{embed ((target#^oldId))}}`.
///
/// issue 668: the lines to rewrite come from reading THIS content with the
/// index's own grammar (`extract_links`) — a reference to the target with the
/// old ID, on whichever line it stands NOW. The index once handed the line
/// numbers it remembered, and a file edited outside the app since (a closed
/// tab, a `git pull`) had moved its reference off them: nothing changed, and
/// the definition took the new ID alone. The target test is the index's
/// filing rule, `normalize_target` — path-qualified `((b/note#^id))` names
/// another file's block and is left alone, exactly as the index leaves it out
/// (issue 619). `ref_path` is the referrer, for its self-references.
pub fn replace_block_id_refs_to(
    content: &str,
    ref_path: &str,
    target_keys: &[String],
    old_id: &str,
    new_id: &str,
) -> String {
    let refers_to_target = |raw_target: &str| {
        let t = raw_target.trim();
        !t.is_empty() && target_keys.contains(&normalize_target(t))
    };
    let lines: std::collections::HashSet<u32> = extract_links(ref_path, content)
        .into_iter()
        .filter(|entry| {
            entry.link_type != "wikilink"
                && entry.block_id.as_deref() == Some(old_id)
                && refers_to_target(&entry.target)
        })
        .map(|entry| entry.line)
        .collect();
    if lines.is_empty() {
        return content.to_owned();
    }
    // issue 620: the literal regions of THIS content — the lines above were
    // read with them, and the interval check here keeps a `((…))` inside a
    // code span on a prose line as it is. One pass per line: the reference
    // regex matches the `((…))` inside an embed too, and every offset stays
    // an offset into the original line, so the check is exact whatever the
    // new ID's length.
    let mut literal: Option<Literal> = None;
    let mut out = String::with_capacity(content.len());
    for line in source_lines(content) {
        if lines.contains(&line.number) {
            let rewritten = REF_REPLACE_RE.replace_all(line.text, |caps: &regex::Captures| {
                let whole = caps.get(0).unwrap();
                let target = caps.get(1).map(|m| m.as_str()).unwrap_or("");
                let id = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                let display = caps.get(3).map(|m| m.as_str()).unwrap_or("");
                let mut in_prose = || {
                    !literal
                        .get_or_insert_with(|| Literal::of(content))
                        .overlaps(line.offset + whole.start()..line.offset + whole.end())
                };
                if id == old_id && refers_to_target(target) && in_prose() {
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

/// issue 678: a file rename's block references — `((old#^id))`, with a
/// display, and the `((…))` inside `{{embed ((old#^id))}}` — spelled with the
/// new stem, in every referrer line the index's own grammar reads as a
/// reference to the old one (`extract_links`, as `replace_block_id_refs_to`
/// does since issue 668). The target test is `normalize_target`: a
/// path-qualified `((dir/old#^id))` is filed elsewhere and stays (issue 619),
/// a self-reference names no target and stays, and a literal region is
/// never touched (issue 620).
///
/// A stem no reference can spell — one holding `)`, `#` or `|`, which end the
/// target of `REF_REPLACE_RE` — is not written: the reference would parse as
/// nothing, silently. The content comes back as it is, and the caller reports
/// the file as one whose references still say the old name. The frontend's
/// percent-escapes (§275.4) have no reader on this side, so escaping here
/// would file the reference under a key nothing resolves.
pub fn replace_block_reference_target(
    content: &str,
    ref_path: &str,
    old_target: &str,
    new_target: &str,
) -> String {
    if new_target.contains([')', '#', '|']) {
        return content.to_owned();
    }
    let old_key = normalize_target(old_target);
    let refers_to_old = |raw_target: &str| {
        let t = raw_target.trim();
        !t.is_empty() && normalize_target(t) == old_key
    };
    let lines: std::collections::HashSet<u32> = extract_links(ref_path, content)
        .into_iter()
        .filter(|entry| entry.link_type != "wikilink" && refers_to_old(&entry.target))
        .map(|entry| entry.line)
        .collect();
    if lines.is_empty() {
        return content.to_owned();
    }
    let mut literal: Option<Literal> = None;
    let mut out = String::with_capacity(content.len());
    for line in source_lines(content) {
        if lines.contains(&line.number) {
            let rewritten = REF_REPLACE_RE.replace_all(line.text, |caps: &regex::Captures| {
                let whole = caps.get(0).unwrap();
                let target = caps.get(1).map(|m| m.as_str()).unwrap_or("");
                let id = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                let display = caps.get(3).map(|m| m.as_str()).unwrap_or("");
                let mut in_prose = || {
                    !literal
                        .get_or_insert_with(|| Literal::of(content))
                        .overlaps(line.offset + whole.start()..line.offset + whole.end())
                };
                if refers_to_old(target) && in_prose() {
                    format!("(({new_target}#^{id}{display}))")
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

/// issue 668: how many lines of `content` refer, in prose, to ITS OWN block
/// `^id` naming no target — `((#^id))`, or that inside `{{embed ((#^id))}}`.
/// The index files such a reference under the note's own stem, so renaming
/// the block of another note with that stem names this file as a referrer,
/// one `(file, line)` per reference, and the rewrite rightly leaves those
/// alone. Against the lines the index named the file for, this tells whether
/// it was named for them alone: a same-stem note whose `((note#^id))` to the
/// target has gone since holds fewer, and is stale like any other.
///
/// issue 678: with no `id`, every own block counts — a file rename names a
/// same-stem note for all of its self-references, whatever the block.
pub fn own_block_reference_lines(content: &str, id: Option<&str>) -> usize {
    let body_start = front_matter_end(content);
    let mut literal: Option<Literal> = None;
    let mut lines = 0;
    for line in source_lines(content) {
        let holds_one = BLOCK_REF_RE.captures_iter(line.text).any(|cap| {
            let raw_target = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
            let block_id = cap.get(2).map(|m| m.as_str()).unwrap_or("");
            if !raw_target.is_empty() || id.is_some_and(|id| block_id != id) {
                return false;
            }
            let whole = cap.get(0).unwrap();
            let range = line.offset + whole.start()..line.offset + whole.end();
            range.start >= body_start
                && !literal
                    .get_or_insert_with(|| Literal::of(content))
                    .overlaps(range)
        });
        if holds_one {
            lines += 1;
        }
    }
    lines
}

/// Replace [[...]] wikilink blocks with spaces of the same byte length.
/// This allows searching for unlinked mentions without matching linked ones.
pub(crate) fn strip_wikilinks(line: &str) -> String {
    WIKILINK_RE
        .replace_all(line, |caps: &regex::Captures| " ".repeat(caps[0].len()))
        .to_string()
}

/// §61 Rewrite the relative wikilinks of `content` that resolve into
/// `old_dir` so that they point into `new_dir` instead. `source_path` is the
/// note that holds `content`; a relative target resolves against its
/// directory.
pub fn rewrite_relative_wikilinks(
    content: &str,
    source_path: &str,
    old_dir: &str,
    new_dir: &str,
) -> String {
    rewrite_relative_wikilinks_with(content, source_path, old_dir, new_dir, cfg!(windows))
}

/// The rewrite proper, with the platform's separator rule as a parameter.
///
/// issue 595: `collect_md_files` spells paths with the OS separator — `\` on
/// Windows — and the webview's `old_dir` may spell either. A comparison that
/// split on `/` alone read `C:\vault\notes` as one component, so `..` popped
/// the whole path and no link ever resolved into the directory. Paths are
/// handled as components here (`/`, and `\` when `windows`), a leading drive
/// letter compares without regard to case as `std::path` does, and the
/// wikilink the rewrite writes is joined with `/`: it is markdown, not a
/// native path. The Rust tests run on Linux, so the Windows shape is tested
/// by passing `windows = true`, never behind `cfg(windows)`.
fn rewrite_relative_wikilinks_with(
    content: &str,
    source_path: &str,
    old_dir: &str,
    new_dir: &str,
    windows: bool,
) -> String {
    let mut source_dir = path_components(source_path, windows);
    source_dir.pop();
    let root = root_components(source_path, windows);
    let old = path_components(old_dir, windows);
    let new = path_components(new_dir, windows);

    // issue 620: a match inside a literal region is left as it is. The
    // literal set is read only once a link resolves into the old
    // directory — a namespace rename visits every note in the vault.
    let mut literal: Option<Literal> = None;
    RELATIVE_WIKILINK_RE
        .replace_all(content, |caps: &regex::Captures| {
            let whole = caps.get(0).unwrap();
            let rel_target = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let rest = caps.get(2).map(|m| m.as_str()).unwrap_or("");

            let resolved = resolve_components(&source_dir, root, rel_target, windows);
            let Some(inside) = strip_dir_prefix(&old, &resolved, windows) else {
                return caps[0].to_string();
            };
            if literal
                .get_or_insert_with(|| Literal::of(content))
                .overlaps(whole.range())
            {
                return caps[0].to_string();
            }
            let new_resolved: Vec<&str> = new.iter().chain(inside).copied().collect();
            let new_rel = relative_components(&source_dir, &new_resolved, windows);
            format!("[[{new_rel}{rest}]]")
        })
        .to_string()
}

/// The components of `path`: split on `/` — and on `\` when `windows` —
/// with empty parts and `.` dropped. A backslash in a Unix file name is a
/// character, not a separator.
fn path_components(path: &str, windows: bool) -> Vec<&str> {
    path.split(|c| c == '/' || (windows && c == '\\'))
        .filter(|part| !part.is_empty() && *part != ".")
        .collect()
}

/// How many leading components of `path` are its root and never step up: a
/// Windows drive (`C:`) is one, a UNC share (`\\server\share`) is two, a Unix
/// path has none to keep — `..` above `/` stays at `/`, which an empty
/// component list already is.
fn root_components(path: &str, windows: bool) -> usize {
    if !windows {
        return 0;
    }
    // The UNC form first: `\\C:\share` names a server called `C:`, not a
    // drive, so the share is its root.
    if path.starts_with(r"\\") || path.starts_with("//") {
        return 2;
    }
    match path_components(path, true).first() {
        Some(first) if is_drive(first) => 1,
        _ => 0,
    }
}

/// A wikilink target such as `./ai/prompt` or `../x`, resolved against the
/// directory `base`, whose first `root` components are the path's root: `..`
/// steps up, and never above the root — `C:\vault` + `../../x` is `C:\x`, as
/// it is to Windows.
fn resolve_components<'a>(
    base: &[&'a str],
    root: usize,
    relative: &'a str,
    windows: bool,
) -> Vec<&'a str> {
    let mut resolved = base.to_vec();
    for part in path_components(relative, windows) {
        if part == ".." {
            if resolved.len() > root {
                resolved.pop();
            }
        } else {
            resolved.push(part);
        }
    }
    resolved
}

/// Do two components name the same entry? Equal bytes — or, as the first
/// component of a Windows path, the same drive letter in either case, the
/// one exception `std::path` makes to case-sensitive comparison.
fn same_component(a: &str, b: &str, first: bool, windows: bool) -> bool {
    a == b || (first && windows && is_drive(a) && is_drive(b) && a.eq_ignore_ascii_case(b))
}

fn is_drive(part: &str) -> bool {
    let bytes = part.as_bytes();
    bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

/// What of `path` lies under the directory `dir`: the components after
/// `dir`'s — empty when `path` IS the directory — or None when it is not
/// under it. Component-wise, so `ns` does not claim `ns-old`.
fn strip_dir_prefix<'a>(dir: &[&str], path: &'a [&'a str], windows: bool) -> Option<&'a [&'a str]> {
    if path.len() < dir.len() {
        return None;
    }
    let under = dir
        .iter()
        .zip(path)
        .enumerate()
        .all(|(k, (d, p))| same_component(d, p, k == 0, windows));
    under.then(|| &path[dir.len()..])
}

/// The relative wikilink target that leads from the directory `source_dir`
/// to `target`: `./` when the target lies under it, else `../` per step up,
/// then the rest — joined with `/`, whatever the platform.
fn relative_components(source_dir: &[&str], target: &[&str], windows: bool) -> String {
    let common = source_dir
        .iter()
        .zip(target)
        .enumerate()
        .take_while(|(k, (a, b))| same_component(a, b, *k == 0, windows))
        .count();
    let ups = source_dir.len() - common;
    let mut result = String::new();
    if ups == 0 {
        result.push_str("./");
    } else {
        for _ in 0..ups {
            result.push_str("../");
        }
    }
    result.push_str(&target[common..].join("/"));
    result
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
    fn keys(list: &[&str]) -> Vec<String> {
        list.iter().map(|k| k.to_string()).collect()
    }

    #[test]
    fn test_replace_block_id_refs_to_basic_display_embed() {
        let content =
            "See ((notes#^abc123)) and ((notes#^abc123|my label)).\n{{embed ((notes#^abc123))}}";
        let result = replace_block_id_refs_to(
            content,
            "/v/referrer.md",
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
        let result =
            replace_block_id_refs_to(content, "/v/referrer.md", &keys(&["a"]), "id1", "newId");
        assert_eq!(result, "((a#^newId)) and ((b#^id1)) and ((a#^id2))");
    }

    #[test]
    fn test_replace_block_id_refs_to_never_touches_a_self_reference() {
        // `((#^id))` in a referrer names the referrer's own block.
        let content = "See ((#^abc123)) and ((notes#^abc123)).";
        let result = replace_block_id_refs_to(
            content,
            "/v/referrer.md",
            &keys(&["notes"]),
            "abc123",
            "xyz789",
        );
        assert_eq!(result, "See ((#^abc123)) and ((notes#^xyz789)).");
    }

    #[test]
    fn test_replace_block_id_refs_to_rewrites_every_line_that_refers() {
        // issue 668: the rewriter reads the content as it is, not the line
        // numbers an index remembered — every reference to the target changes.
        let content = "((notes#^abc)) first\n((notes#^abc)) second\n((notes#^abc)) third";
        let result =
            replace_block_id_refs_to(content, "/v/referrer.md", &keys(&["notes"]), "abc", "xyz");
        assert_eq!(
            result,
            "((notes#^xyz)) first\n((notes#^xyz)) second\n((notes#^xyz)) third"
        );
    }

    #[test]
    fn test_replace_block_id_refs_to_matches_the_target_the_way_the_index_does() {
        // Case and the `.md` extension normalize away, as the index's keys do.
        // A path-qualified target does NOT: the index files `dir/notes` under
        // that key, never under `notes` (issue 619), so the rewriter leaves it
        // alone too — what the index counts is what a rename may touch.
        let content = "((Notes#^abc)) ((notes.md#^abc)) ((dir/notes.md#^abc)) ((other#^abc))";
        let result =
            replace_block_id_refs_to(content, "/v/referrer.md", &keys(&["notes"]), "abc", "xyz");
        assert_eq!(
            result,
            "((Notes#^xyz)) ((notes.md#^xyz)) ((dir/notes.md#^abc)) ((other#^abc))"
        );
    }

    #[test]
    fn test_replace_block_id_refs_to_no_match_is_byte_identical() {
        let content = "See ((notes#^other)) and {{embed ((notes#^other))}}\r\nend";
        let result =
            replace_block_id_refs_to(content, "/v/referrer.md", &keys(&["notes"]), "abc", "xyz");
        assert_eq!(result, content);
    }

    #[test]
    fn a_note_refers_to_its_own_block_only_by_a_prose_reference_that_names_no_target() {
        // issue 668: what exempts a same-stem referrer from the stale report
        // is the self-references the index filed under its stem — in prose,
        // past the front matter, with the block ID in question, counted by
        // line as the index names them. A reference that names the target,
        // even its own stem, is the rewriter's.
        let b1 = Some("b1");
        assert_eq!(own_block_reference_lines("mine ^b1 ((#^b1))\n", b1), 1);
        assert_eq!(own_block_reference_lines("{{embed ((#^b1))}}\n", b1), 1);
        assert_eq!(own_block_reference_lines("see ((#^b1|shown))\n", b1), 1);
        assert_eq!(
            own_block_reference_lines("((#^b1)) ((#^b1))\n((#^b1))\n", b1),
            2
        );
        assert_eq!(own_block_reference_lines("see ((note#^b1))\n", b1), 0);
        assert_eq!(own_block_reference_lines("mine ((#^b2))\n", b1), 0);
        assert_eq!(own_block_reference_lines("`((#^b1))`\n", b1), 0);
        assert_eq!(
            own_block_reference_lines("---\nrelated: ((#^b1))\n---\nbody\n", b1),
            0
        );
        assert_eq!(own_block_reference_lines("the reference is gone\n", b1), 0);
    }

    #[test]
    fn a_notes_own_references_of_any_block_count_when_no_id_is_asked() {
        // issue 678: a file rename names a same-stem note for every
        // self-reference it holds, whatever the block, so the exemption
        // counts them all — still one per line, in prose, past the front
        // matter, and never a reference that names a target.
        assert_eq!(
            own_block_reference_lines("((#^b1)) and ((#^b2))\n((#^c3))\n", None),
            2
        );
        assert_eq!(own_block_reference_lines("see ((note#^b1))\n", None), 0);
        assert_eq!(own_block_reference_lines("`((#^b1))`\n", None), 0);
        assert_eq!(
            own_block_reference_lines("---\nrelated: ((#^b1))\n---\nbody\n", None),
            0
        );
    }

    // issue 678 — replace_block_reference_target: a file rename's block references
    #[test]
    fn a_file_rename_rewrites_block_references_and_embeds_to_the_new_stem() {
        let content =
            "See ((old#^abc)) and ((old#^abc|label)).\n{{embed ((old#^abc))}} and [[old]]";
        assert_eq!(
            replace_block_reference_target(content, "/v/referrer.md", "old", "new"),
            "See ((new#^abc)) and ((new#^abc|label)).\n{{embed ((new#^abc))}} and [[old]]"
        );
    }

    #[test]
    fn a_file_rename_matches_the_target_the_way_the_index_does_and_keeps_the_rest() {
        // Case and `.md` normalize away as the index's key does; a
        // path-qualified target is filed elsewhere (issue 619) and a
        // self-reference names no target — both stay. Another note's block
        // with the same ID is another note's.
        let content = "((Old#^a)) ((old.md#^a)) ((dir/old#^a)) ((#^a)) ((other#^a))";
        assert_eq!(
            replace_block_reference_target(content, "/v/referrer.md", "old", "new"),
            "((new#^a)) ((new#^a)) ((dir/old#^a)) ((#^a)) ((other#^a))"
        );
    }

    #[test]
    fn a_file_rename_leaves_a_block_reference_inside_code_and_keeps_offsets_and_crlf() {
        // issue 620: the reference in the code span is literal; the prose one
        // beside it is rewritten with a stem of another length, and the line
        // after keeps its CRLF.
        let content = "`((old#^a))` then ((old#^a)) end\r\nnext ((old#^b))\r\n";
        assert_eq!(
            replace_block_reference_target(content, "/v/referrer.md", "old", "longer-name"),
            "`((old#^a))` then ((longer-name#^a)) end\r\nnext ((longer-name#^b))\r\n"
        );
        let untouched = "no reference here\n((other#^a))";
        assert_eq!(
            replace_block_reference_target(untouched, "/v/referrer.md", "old", "new"),
            untouched
        );
    }

    #[test]
    fn a_file_rename_to_a_stem_no_block_reference_can_spell_leaves_the_references_alone() {
        // `((target#^id))` cannot hold `)`, `#` or `|` in its target — the
        // reference regex stops at them — and the Rust side has no escape
        // convention (the frontend's percent-escapes are its own). Writing
        // such a stem would leave a reference nothing parses, silently; the
        // references stay, and the rename reports the file instead.
        for stem in ["note (draft)", "c#", "a|b"] {
            let content = "see ((old#^a)) and {{embed ((old#^a))}}";
            assert_eq!(
                replace_block_reference_target(content, "/v/referrer.md", "old", stem),
                content,
                "{stem}"
            );
        }
    }

    #[test]
    fn a_wikilink_rename_matches_the_target_the_way_the_index_does() {
        // issue 678: the index files `[[old.md]]` and `[[OLD]]` under the key
        // `old` (normalize_target); a rename that left them would report the
        // file as stale. The `.md` spelling is kept on the new name; the
        // rest of the link — heading, block, display — is untouched.
        assert_eq!(
            replace_wikilink_target(
                "[[old.md]] [[OLD|shown]] [[old#h]] [[Old.md^b1]]",
                "old",
                "new"
            ),
            "[[new.md]] [[new|shown]] [[new#h]] [[new.md^b1]]"
        );
        // Unicode case folds as the index folds it.
        assert_eq!(
            replace_wikilink_target("[[ÉCOLE]]", "école", "school"),
            "[[school]]"
        );
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
            replace_block_id_refs_to(content, "/v/referrer.md", &keys(&["notes"]), "abc", "xyz"),
            "```\n((notes#^abc))\n```\n((notes#^xyz)) `((notes#^abc))`\n"
        );
    }

    #[test]
    fn a_block_id_rename_on_one_line_keeps_the_code_span_whatever_the_new_length() {
        let content = "{{embed ((notes#^abc))}} `((notes#^abc))` ((notes#^abc|show))\n";
        assert_eq!(
            replace_block_id_refs_to(content, "/v/referrer.md", &keys(&["notes"]), "abc", "a-much-longer-id"),
            "{{embed ((notes#^a-much-longer-id))}} `((notes#^abc))` ((notes#^a-much-longer-id|show))\n"
        );
        assert_eq!(
            replace_block_id_refs_to(content, "/v/referrer.md", &keys(&["notes"]), "abc", "z"),
            "{{embed ((notes#^z))}} `((notes#^abc))` ((notes#^z|show))\n"
        );
    }

    #[test]
    fn a_block_id_rename_keeps_crlf_and_finds_its_lines_in_a_crlf_file() {
        let content = "((notes#^abc))\r\n```\r\n((notes#^abc))\r\n```\r\n((notes#^abc))\r\n";
        assert_eq!(
            replace_block_id_refs_to(content, "/v/referrer.md", &keys(&["notes"]), "abc", "xyz"),
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

    /// issue 668 — the rewriter judges the CURRENT content, not the line
    /// numbers an index remembered, and by the index's own target rule.
    #[test]
    fn the_block_id_rewriter_finds_the_reference_where_it_stands_now() {
        let keys = crate::index::backlink_keys("/v/note.md");
        // A line inserted above the reference after the index was built: the
        // reference is found on its new line and rewritten.
        assert_eq!(
            replace_block_id_refs_to("new line\nsee ((note#^b1))\n", "/v/a.md", &keys, "b1", "b2"),
            "new line\nsee ((note#^b2))\n"
        );
        // Path-qualified target on its own line names another file's block:
        // the index files it under `b/note`, and the rewriter leaves it alone.
        assert_eq!(
            replace_block_id_refs_to(
                "((note#^b1))\n((b/note#^b1))\n",
                "/v/a.md",
                &keys,
                "b1",
                "b2"
            ),
            "((note#^b2))\n((b/note#^b1))\n"
        );
        // An embed with a display part is a plain reference to the grammar —
        // indexed as one, rewritten as one.
        assert_eq!(
            replace_block_id_refs_to(
                "{{embed ((note#^b1|caption))}}\n",
                "/v/a.md",
                &keys,
                "b1",
                "b2"
            ),
            "{{embed ((note#^b2|caption))}}\n"
        );
        // Nothing to the target: byte for byte.
        let untouched = "((other#^b1)) `((note#^b1))`\n";
        assert_eq!(
            replace_block_id_refs_to(untouched, "/v/a.md", &keys, "b1", "b2"),
            untouched
        );
    }

    /// issue 667 — a block reference in the front matter is neither indexed
    /// nor rewritten; an attribute wikilink there is still a link.
    #[test]
    fn a_block_reference_in_the_front_matter_is_not_a_reference() {
        let md = "---\nrelated: ((#^b1)) ((note#^b1))\nlink: \"[[x]]\"\n---\nbody ((note#^b1))\n";
        let entries = extract_links("/v/a.md", md);
        let kinds: Vec<(&str, &str, u32)> = entries
            .iter()
            .map(|e| (e.link_type.as_str(), e.target.as_str(), e.line))
            .collect();
        assert_eq!(kinds, vec![("wikilink", "x", 3), ("blockRef", "note", 5)]);
        let keys = crate::index::backlink_keys("/v/note.md");
        assert_eq!(
            replace_block_id_refs_to(md, "/v/a.md", &keys, "b1", "b2"),
            "---\nrelated: ((#^b1)) ((note#^b1))\nlink: \"[[x]]\"\n---\nbody ((note#^b2))\n"
        );
        // Behind a byte order mark, and an embed in the front matter, the same.
        let bom = "\u{FEFF}---\nx: {{embed ((note#^b1))}}\n---\n{{embed ((note#^b1))}}\n";
        let kinds: Vec<(String, u32)> = extract_links("/v/a.md", bom)
            .into_iter()
            .map(|e| (e.link_type, e.line))
            .collect();
        assert_eq!(kinds, vec![("blockEmbed".to_string(), 4)]);
    }

    /// issue 595 — Windows spells the note's path and the directories with
    /// `\`; the rewrite compares components and writes `/` into the link.
    /// Tested with `windows = true` because the Rust tests run on Linux.
    #[test]
    fn a_relative_wikilink_rewrite_reads_windows_paths_as_components() {
        let rewrite = |content: &str, source: &str, old: &str, new: &str| {
            rewrite_relative_wikilinks_with(content, source, old, new, true)
        };
        // Into the directory, through `./` and `../`; a sibling that merely
        // shares the prefix (`ns-old`) and a global link are left alone.
        assert_eq!(
            rewrite(
                "[[./ns/c]] [[../a/ns/d#h|D]] [[./ns-old/e]] [[ns/f]]",
                r"C:\vault\a\note.md",
                r"C:\vault\a\ns",
                r"C:\vault\a\ns2",
            ),
            "[[./ns2/c]] [[./ns2/d#h|D]] [[./ns-old/e]] [[ns/f]]"
        );
        // The directory itself, and a link from a deeper note that steps up;
        // `./ns` from that note names `deep/ns`, not the directory, and stays.
        assert_eq!(
            rewrite(
                "[[../../ns]] [[../../ns/g]] [[./ns]]",
                r"C:\vault\a\sub\deep\note.md",
                r"C:\vault\a\ns",
                r"C:\vault\a\ns2",
            ),
            "[[../../ns2]] [[../../ns2/g]] [[./ns]]"
        );
        // Too many `..` stop at the drive, as they do to Windows: the link
        // still resolves into the directory and is rewritten. And on a UNC
        // share the root is the share.
        assert_eq!(
            rewrite(
                "[[../../vault/ns/x#h|X]]",
                r"C:\vault\note.md",
                r"C:\vault\ns",
                r"C:\vault\ns2",
            ),
            "[[./ns2/x#h|X]]"
        );
        assert_eq!(
            rewrite(
                "[[../../../vault/ns/x]]",
                r"\\server\share\vault\note.md",
                r"\\server\share\vault\ns",
                r"\\server\share\vault\ns2",
            ),
            "[[./ns2/x]]"
        );
        // Mixed separators and a drive letter in the other case name the
        // same directory, as they do to std::path on Windows.
        assert_eq!(
            rewrite(
                "[[./ns/c]]",
                r"c:\vault/a\note.md",
                "C:/vault/a/ns",
                r"C:\vault\a\ns2",
            ),
            "[[./ns2/c]]"
        );
        // Without the Windows rule a backslash is a character of the name:
        // `ns\c` is one component and does not lie under `ns`.
        assert_eq!(
            rewrite_relative_wikilinks_with(
                r"[[./ns\c]] [[./ns/c]]",
                "/v/a/note.md",
                "/v/a/ns",
                "/v/a/ns2",
                false,
            ),
            r"[[./ns\c]] [[./ns2/c]]"
        );
    }

    #[test]
    fn windows_paths_resolve_and_compare_as_components() {
        assert_eq!(
            path_components(r"C:\vault\notes/ai", true),
            ["C:", "vault", "notes", "ai"]
        );
        assert_eq!(path_components(r"/v/my\dir", false), ["v", r"my\dir"]);
        assert_eq!(
            resolve_components(&["C:", "vault", "notes"], 1, r"..\x/./y", true),
            ["C:", "vault", "x", "y"]
        );
        assert_eq!(resolve_components(&["v"], 0, "../../up", false), ["up"]);
        // `..` never steps above the root: the drive, or the UNC share.
        assert_eq!(
            resolve_components(&["C:", "vault"], 1, "../../../x", true),
            ["C:", "x"]
        );
        assert_eq!(
            resolve_components(&["server", "share", "v"], 2, "../../x", true),
            ["server", "share", "x"]
        );
        assert_eq!(root_components(r"C:\vault\note.md", true), 1);
        assert_eq!(root_components(r"\\server\share\note.md", true), 2);
        assert_eq!(root_components("//server/share/note.md", true), 2);
        // A server that happens to be spelled like a drive is still a share.
        assert_eq!(root_components(r"\\C:\share\note.md", true), 2);
        assert_eq!(root_components(r"\vault\note.md", true), 0);
        // A drive-relative path (`C:note.md`) names no absolute root here.
        assert_eq!(root_components("C:note.md", true), 0);
        assert_eq!(root_components(r"C:\", true), 1);
        assert_eq!(root_components("/v/note.md", false), 0);
        assert_eq!(root_components("//v/note.md", false), 0);
        assert_eq!(
            strip_dir_prefix(&["c:", "v", "ns"], &["C:", "v", "ns", "x"], true),
            Some(&["x"][..])
        );
        assert_eq!(
            strip_dir_prefix(&["c:", "v", "ns"], &["C:", "v", "ns", "x"], false),
            None
        );
        assert_eq!(
            strip_dir_prefix(&["v", "ns"], &["v", "ns-old", "x"], true),
            None
        );
        assert_eq!(
            relative_components(&["v", "notes"], &["v", "notes", "ml", "p"], false),
            "./ml/p"
        );
        assert_eq!(
            relative_components(&["v", "notes", "sub"], &["v", "ml"], false),
            "../../ml"
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
            let keys = crate::index::backlink_keys(target);
            assert_eq!(
                replace_block_id_refs_to(markdown, referrer, &keys, old, new),
                case["expected"].as_str().unwrap(),
                "{name}"
            );
        }
    }
}
