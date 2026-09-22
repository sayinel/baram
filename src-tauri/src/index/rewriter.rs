// §33 · §30a Reference rewriting — what a file or block rename reads and
// writes in a referrer. Extraction stays in `extractor.rs`.

use regex::Regex;
use std::sync::LazyLock;

use super::extractor::{extract_links, BLOCK_REF_RE};
use super::normalizer::{file_key, normalize_target};
use super::RewritePass;
use crate::md::literal::{front_matter_end, source_lines, Literal};

// §33 Wikilink replace regex: captures (alias, target, rest) for replace_wikilink_target
// §87: optional alias:: prefix — group 1 = alias, group 2 = target, group 3 = rest
static REPLACE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"\[\[((?:[a-zA-Z][\w-]*::)?)([^\]|#^\n\r]+)((?:#[^\]|^\n\r]+)?(?:\^[^\]|\n\r]+)?(?:\|[^\]\n\r]+)?)\]\]",
    )
    .unwrap()
});

// §87 What `WIKILINK_RE`/`REPLACE_RE` read as a vault alias at the head of a
// target — a stem that begins this way cannot be spelled in a wikilink.
static ALIAS_PREFIX_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-zA-Z][\w-]*::").unwrap());

// §30a Block ref replace regex: ((target#^ID)) or ((target#^ID|display)) — also the
// `((…))` inside `{{embed ((target#^ID))}}`, so an embed needs no pass of its own.
static REF_REPLACE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\(\(([^)#|]*?)#\^([a-zA-Z0-9][\w-]*)(\|[^)]+)?\)\)").unwrap());

/// §33 Replace wikilink targets in file content.
/// Handles [[old]], [[old|display]], [[old#heading]], [[old#heading|display]], [[old^blockId]], etc.
/// Only replaces the target portion, preserving display, heading, and blockId.
///
/// issue 678: the target test is the index's filing rule — the link's target
/// through `normalize_target` (`.md` stripped, case folded) against the
/// file's key, `file_key` of its stem — so every link the index filed under
/// that key is rewritten, none is left to be reported as stale, and a
/// file whose stem itself ends in `.md` (`diagram.md.txt`) never claims the
/// note `diagram.md`'s links. A link spelled with `.md` keeps that spelling
/// on the new name.
///
/// A stem no wikilink can spell (`wikilink_can_spell`) is never written: the
/// content comes back as it is, and the file rename, which decides that
/// before calling, reports the files whose links it left (`wikilinks_to`).
pub fn replace_wikilink_target(content: &str, old_target: &str, new_target: &str) -> String {
    if !wikilink_can_spell(new_target) {
        return content.to_owned();
    }
    visit_wikilinks_to(
        content,
        old_target,
        |alias_prefix, captured_target, rest| {
            let suffix = if captured_target.trim().ends_with(".md") {
                ".md"
            } else {
                ""
            };
            Some(format!("[[{alias_prefix}{new_target}{suffix}{rest}]]"))
        },
    )
    .0
}

/// Whether a link naming this stem would read back as the file whose stem it
/// is. A link's target is read with `normalize_target`, which trims and
/// strips a trailing `.md`; a file is filed under `file_key`, which does
/// neither. They agree on an ordinary stem and part ways on one ending in
/// `.md` — the file `foo.md.md`, whose `[[foo.md]]` names the note `foo` —
/// or one padded with spaces. That is the `diagram.md.txt` confusion seen
/// from the writing side: there a file claimed a note's links, here a file
/// would hand its links to a note.
fn link_reads_back_as_the_file(stem: &str) -> bool {
    normalize_target(stem) == file_key(stem)
}

/// Whether a wikilink can name a file with this stem. `]`, `|`, `#` and `^`
/// end the target of `REPLACE_RE` (and of the index's `WIKILINK_RE`, the same
/// class) — and `|`, `#` and `^` do worse than end it: what follows reads as
/// a display, a heading or a block, so `[[a^b]]` silently names the note `a`.
/// A leading `word::` reads as a vault alias (§87) the same way. A line break
/// ends the line every scanner reads, and a stem the reader would fold to
/// another key is refused too (`link_reads_back_as_the_file`). A stem a
/// wikilink cannot spell is never
/// written into one: the rename leaves those links and reports their files,
/// as it does for block references (`block_reference_can_spell` — a different
/// set, judged apart: `)` is a wikilink's to spell, `^` a block reference's).
pub fn wikilink_can_spell(stem: &str) -> bool {
    !stem.contains([']', '|', '#', '^', '\n', '\r'])
        && !ALIAS_PREFIX_RE.is_match(stem)
        && link_reads_back_as_the_file(stem)
}

/// How many wikilinks to `old_target` `content` holds in prose — the ones
/// `replace_wikilink_target` would rewrite if the new stem were one a
/// wikilink can spell, which is the only case this is asked in. A file rename to a stem no
/// wikilink can spell asks this to report the files whose links it leaves.
pub fn wikilinks_to(content: &str, old_target: &str) -> usize {
    visit_wikilinks_to(content, old_target, |_, _, _| None).1
}

/// The pass under both: every wikilink to `old_target` outside a literal
/// region is offered to `respell` (alias prefix, target as spelled, rest) —
/// `Some` replaces it, `None` keeps it — and counted. Returns the content and
/// that count.
fn visit_wikilinks_to(
    content: &str,
    old_target: &str,
    respell: impl Fn(&str, &str, &str) -> Option<String>,
) -> (String, usize) {
    // Match all wikilink forms: [[target]], [[target|display]], [[target#heading]], etc.
    // Capture groups: (1) alias, (2) target, (3) rest — #heading, ^blockId, |display in any combo
    // issue 620: a match inside a literal region is left as it is — the index
    // never counted it, the editor never read it. The literal set is read
    // only once a match names the old target: a vault-wide rename visits
    // every note, and most hold no such link.
    let old_key = file_key(old_target);
    let mut literal: Option<Literal> = None;
    let mut visited = 0;
    let out = REPLACE_RE
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
                visited += 1;
                respell(alias_prefix, captured_target, rest)
                    .unwrap_or_else(|| whole.as_str().to_string())
            } else {
                // No match — return original
                whole.as_str().to_string()
            }
        })
        .to_string();
    (out, visited)
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
            entry.link_type.pass() == RewritePass::BlockReferences
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
/// does since issue 668). The target test is the index's — the reference's
/// target through `normalize_target`, against `file_key` of the old stem: a
/// path-qualified `((dir/old#^id))` is filed elsewhere and stays (issue 619),
/// a self-reference names no target and stays, a literal region is never
/// touched (issue 620), and a file whose stem ends in `.md` never claims
/// the note's references.
///
/// A stem no reference can spell (`block_reference_can_spell`) is never
/// written: the reference would parse as nothing, silently. The content comes
/// back as it is. The file rename decides that before calling and asks
/// `block_references_to` what it leaves, so the user hears of the file
/// whether or not a wikilink in it was rewritten; this refusal is the
/// writer's own, for any caller.
pub fn replace_block_reference_target(
    content: &str,
    ref_path: &str,
    old_target: &str,
    new_target: &str,
) -> String {
    if !block_reference_can_spell(new_target) {
        return content.to_owned();
    }
    visit_block_references_to(content, ref_path, old_target, |id, display| {
        Some(format!("(({new_target}#^{id}{display}))"))
    })
    .0
}

/// Whether a block reference can name a file with this stem. `)`, `#` and `|`
/// end the target of `REF_REPLACE_RE` (and of the index's `BLOCK_REF_RE`);
/// a line break ends the line every scanner reads, so a reference holding one
/// straddles two lines and parses as nothing. A file name may hold any of
/// these: APFS and ext4 permit them, refusing only `/` and NUL. A stricter
/// file system only shrinks what reaches here, which this gate, refusing
/// rather than trusting, does not mind. The frontend's
/// percent-escapes (§275.4) have no reader on this side, so escaping here
/// would file the reference under a key nothing resolves; the rename leaves
/// such references and reports their files instead. A stem the reader would
/// fold to another key is refused too (`link_reads_back_as_the_file`).
pub fn block_reference_can_spell(stem: &str) -> bool {
    !stem.contains([')', '#', '|', '\n', '\r']) && link_reads_back_as_the_file(stem)
}

/// How many block references (embeds included) to `old_target` `content`
/// holds in prose — the ones `replace_block_reference_target` would rewrite
/// if the new stem were one a reference can spell, which is the only case
/// this is asked in: not a self-reference, which names no target, not a path-qualified
/// one, not one in a literal region. A file rename to a stem no reference can
/// spell asks this to report the files whose references it leaves.
pub fn block_references_to(content: &str, ref_path: &str, old_target: &str) -> usize {
    visit_block_references_to(content, ref_path, old_target, |_, _| None).1
}

/// The pass under both: on the lines the index's own grammar reads as a
/// reference to `old_target`, every block reference to it in prose is offered
/// to `respell` (block id, display) — `Some` replaces it, `None` keeps it —
/// and counted. Returns the content and that count.
fn visit_block_references_to(
    content: &str,
    ref_path: &str,
    old_target: &str,
    respell: impl Fn(&str, &str) -> Option<String>,
) -> (String, usize) {
    let old_key = file_key(old_target);
    let refers_to_old = |raw_target: &str| {
        let t = raw_target.trim();
        !t.is_empty() && normalize_target(t) == old_key
    };
    let lines: std::collections::HashSet<u32> = extract_links(ref_path, content)
        .into_iter()
        .filter(|entry| {
            entry.link_type.pass() == RewritePass::BlockReferences && refers_to_old(&entry.target)
        })
        .map(|entry| entry.line)
        .collect();
    if lines.is_empty() {
        return (content.to_owned(), 0);
    }
    let mut literal: Option<Literal> = None;
    let mut visited = 0;
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
                    visited += 1;
                    respell(id, display).unwrap_or_else(|| whole.as_str().to_string())
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
    (out, visited)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::LinkKind;

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
        // reference regex stops at them — nor a line break, which the
        // scanners never read across; and the Rust side has no escape
        // convention (the frontend's percent-escapes are its own). Writing
        // such a stem would leave a reference nothing parses, silently; the
        // references stay, and the rename reports the file instead.
        for stem in [
            "note (draft)",
            "c#",
            "a|b",
            "two\nlines",
            "cr\rhere",
            "foo.md",
            " padded ",
        ] {
            let content = "see ((old#^a)) and {{embed ((old#^a))}}";
            assert_eq!(
                replace_block_reference_target(content, "/v/referrer.md", "old", stem),
                content,
                "{stem}"
            );
        }
    }

    #[test]
    fn a_file_rename_counts_the_block_references_it_would_rewrite() {
        // issue 678: what a stem no reference can spell leaves behind is what
        // the rewrite would have touched — the references in prose that name
        // the old stem; not a self-reference (whichever file holds it), not a
        // path-qualified one, not one inside code, and never a wikilink.
        let content =
            "((old#^a)) {{embed ((old#^b|shown))}} ((#^c)) ((dir/old#^d)) `((old#^e))`\n[[old]]\n";
        assert_eq!(block_references_to(content, "/v/referrer.md", "old"), 2);
        assert_eq!(block_references_to(content, "/v/old.md", "old"), 2);
        assert_eq!(
            block_references_to("see [[old]] only\n", "/v/r.md", "old"),
            0
        );
        assert_eq!(
            replace_block_reference_target(content, "/v/referrer.md", "old", "new"),
            "((new#^a)) {{embed ((new#^b|shown))}} ((#^c)) ((dir/old#^d)) `((old#^e))`\n[[old]]\n"
        );
    }

    #[test]
    fn a_file_rename_to_a_stem_no_wikilink_can_spell_leaves_the_links_alone() {
        // `[[a^b]]`, `[[a#b]]`, `[[a|b]]` read as the note `a` (a block, a
        // heading, a display), `[[x::y]]` as the note `y` in the vault `x`,
        // `[[a]b]]` and a line break as nothing. A stem ending in `.md`
        // (the file `foo.md.md`) is the same failure by another road: the
        // reader strips that `.md` and `[[foo.md]]` names the note `foo`.
        // Writing such a stem would silently link another note or none; the
        // links stay and the rename reports the file. `)` is a wikilink's to
        // spell (only a block reference breaks on it), so that stem IS
        // written — the pair.
        let content = "see [[old]] and [[old#h|shown]] and [[old.md]]";
        for stem in [
            "c# notes",
            "a|b",
            "a^b",
            "a]b",
            "std::fs",
            "two\nlines",
            "cr\rhere",
            "foo.md",
            " padded ",
        ] {
            assert_eq!(
                replace_wikilink_target(content, "old", stem),
                content,
                "{stem:?}"
            );
            assert!(!wikilink_can_spell(stem), "{stem:?}");
        }
        assert_eq!(
            replace_wikilink_target(content, "old", "note (draft)"),
            "see [[note (draft)]] and [[note (draft)#h|shown]] and [[note (draft).md]]"
        );
        // `::` reads as an alias only behind a leading word; `1::2` does not.
        assert!(wikilink_can_spell("1::2"));
        assert!(wikilink_can_spell("note (draft)"));
        // What the rename reports it left: the links in prose that name the
        // old file — not a path-qualified one, one in code, or a block reference.
        assert_eq!(
            wikilinks_to(
                "[[old]] [[OLD.md|x]] [[dir/old]] `[[old]]` ((old#^a))\n",
                "old"
            ),
            2
        );
    }

    #[test]
    fn a_file_whose_stem_ends_in_md_does_not_claim_the_notes_links() {
        // The index files a FILE under its lowercased stem (`normalize_file_path`)
        // and a LINK under `normalize_target`, which also strips `.md`. For a
        // note the two agree; for `diagram.md.txt` the file's key is
        // `diagram.md` while `[[diagram]]` and `[[diagram.md]]` are the note
        // `diagram.md`'s links, filed under `diagram`. Renaming the file must
        // not touch them — and renaming the note must (the pair below).
        let content = "see [[diagram]] [[diagram.md]] [[diagram.md.txt]] ((diagram#^a))\n";
        assert_eq!(
            replace_wikilink_target(content, "diagram.md", "chart"),
            content
        );
        assert_eq!(
            replace_block_reference_target(content, "/v/r.md", "diagram.md", "chart"),
            content
        );
        assert_eq!(block_references_to(content, "/v/r.md", "diagram.md"), 0);
        assert_eq!(
            replace_wikilink_target(content, "diagram", "chart"),
            "see [[chart]] [[chart.md]] [[diagram.md.txt]] ((diagram#^a))\n"
        );
        assert_eq!(block_references_to(content, "/v/r.md", "diagram"), 1);
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
        let kinds: Vec<(LinkKind, &str, u32)> = entries
            .iter()
            .map(|e| (e.link_type, e.target.as_str(), e.line))
            .collect();
        assert_eq!(
            kinds,
            vec![
                (LinkKind::Wikilink, "x", 3),
                (LinkKind::BlockRef, "note", 5)
            ]
        );
        let keys = crate::index::backlink_keys("/v/note.md");
        assert_eq!(
            replace_block_id_refs_to(md, "/v/a.md", &keys, "b1", "b2"),
            "---\nrelated: ((#^b1)) ((note#^b1))\nlink: \"[[x]]\"\n---\nbody ((note#^b2))\n"
        );
        // Behind a byte order mark, and an embed in the front matter, the same.
        let bom = "\u{FEFF}---\nx: {{embed ((note#^b1))}}\n---\n{{embed ((note#^b1))}}\n";
        let kinds: Vec<(LinkKind, u32)> = extract_links("/v/a.md", bom)
            .into_iter()
            .map(|e| (e.link_type, e.line))
            .collect();
        assert_eq!(kinds, vec![(LinkKind::BlockEmbed, 4)]);
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
