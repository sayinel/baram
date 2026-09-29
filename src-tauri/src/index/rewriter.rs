// §33 · §30a Reference rewriting — what a file or block rename reads and
// writes in a referrer. Extraction stays in `extractor.rs`.

use regex::Regex;
use std::sync::LazyLock;

use super::extractor::{extract_links, BLOCK_REF_RE};
use super::filing::{filing_key, FilingKey, Match, RenameTarget};
use super::normalizer::{file_key, normalize_target};
use super::{BlockTarget, LinkKind, RewritePass};
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
/// issue 678 · issue 619: the target test is the index's filing rule
/// (`RenameTarget::refers`) — the link's target keyed by `filing_key` under
/// each root in `covering_roots`, the roots whose index covers `ref_path` —
/// so every link the index filed under the renamed file's keys is rewritten
/// and none is left to be reported as stale: a bare `[[Old.md]]` by its
/// stem, a path-qualified `[[a/old]]` or a relative `[[./old]]` by the
/// file's path under a covering root. A file whose stem itself ends in `.md`
/// (`diagram.md.txt`) never claims the note `diagram.md`'s links, and a link
/// behind another vault's alias (`[[work::old]]`) is that vault's and stays.
/// The new text is `RenameTarget::respell`: the new stem, or the new path,
/// with the `.md` or `.markdown` the link was spelled with.
///
/// A stem no wikilink can spell (`wikilink_can_spell`) is never written —
/// a path link's last component is that stem too: the content comes back as
/// it is, and the file rename, which decides that before calling, reports
/// the files whose links it left (`wikilinks_to`).
pub fn replace_wikilink_target(
    content: &str,
    ref_path: &str,
    covering_roots: &[String],
    target: &RenameTarget,
) -> String {
    if !wikilink_can_spell(target.new_stem()) {
        return content.to_owned();
    }
    visit_wikilinks_to(
        content,
        ref_path,
        covering_roots,
        target,
        |alias_prefix, captured_target, rest, m| {
            let new = target.respell(ref_path, m, captured_target);
            Some(format!("[[{alias_prefix}{new}{rest}]]"))
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

/// How many wikilinks to the renamed file `content` holds in prose — the
/// ones `replace_wikilink_target` would rewrite if the new stem were one a
/// wikilink can spell, which is the only case this is asked in. A file
/// rename to a stem no wikilink can spell asks this to report the files
/// whose links it leaves.
pub fn wikilinks_to(
    content: &str,
    ref_path: &str,
    covering_roots: &[String],
    target: &RenameTarget,
) -> usize {
    visit_wikilinks_to(content, ref_path, covering_roots, target, |_, _, _, _| None).1
}

/// The pass under both: every wikilink outside a literal region that
/// `target.refers` matches under `covering_roots` is offered to `respell`
/// (alias prefix, target as spelled, rest, how it matched) — `Some`
/// replaces it, `None` keeps it — and counted. Returns the content and that
/// count.
fn visit_wikilinks_to(
    content: &str,
    ref_path: &str,
    covering_roots: &[String],
    target: &RenameTarget,
    respell: impl Fn(&str, &str, &str, &Match) -> Option<String>,
) -> (String, usize) {
    // Match all wikilink forms: [[target]], [[target|display]], [[target#heading]], etc.
    // Capture groups: (1) alias, (2) target, (3) rest — #heading, ^blockId, |display in any combo
    // issue 620: a match inside a literal region is left as it is — the index
    // never counted it, the editor never read it. The literal set is read
    // only once a match names the renamed file: a vault-wide rename visits
    // every note, and most hold no such link.
    let mut literal: Option<Literal> = None;
    let mut visited = 0;
    let out = REPLACE_RE
        .replace_all(content, |caps: &regex::Captures| {
            let whole = caps.get(0).unwrap();
            let alias_prefix = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let captured_target = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            let rest = caps.get(3).map(|m| m.as_str()).unwrap_or("");

            match target.refers(ref_path, covering_roots, alias_prefix, captured_target) {
                Some(m)
                    if !literal
                        .get_or_insert_with(|| Literal::of(content))
                        .overlaps(whole.range()) =>
                {
                    visited += 1;
                    respell(alias_prefix, captured_target, rest, &m)
                        .unwrap_or_else(|| whole.as_str().to_string())
                }
                _ => whole.as_str().to_string(),
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
/// filing rule (`BlockTarget::refers`): a reference is keyed the way the index
/// files it under each root in `covering_roots` — the roots whose index covers
/// the referrer — so a path-qualified `((dir/note#^id))` or a relative
/// `((./note#^id))` is rewritten when it names the target's path under such a
/// root, and left alone when it names another file (issue 619). `ref_path` is
/// the referrer, for its self-references and its relative references.
pub fn replace_block_id_refs_to(
    content: &str,
    ref_path: &str,
    covering_roots: &[String],
    target: &BlockTarget,
    old_id: &str,
    new_id: &str,
) -> String {
    let refers_to_target = |raw: &str| target.refers(ref_path, covering_roots, raw);
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
/// display, and the `((…))` inside `{{embed ((old#^id))}}` — respelled for
/// the renamed file, in every referrer line the index's own grammar reads as
/// a reference to it (`extract_links`, as `replace_block_id_refs_to` does
/// since issue 668). The target test is the index's filing rule
/// (`RenameTarget::refers`) under each root in `covering_roots`: a
/// path-qualified `((a/old#^id))` or a relative `((./old#^id))` that names
/// the file's path under such a root is respelled with the new path (issue
/// 619), one that names another file's path stays, a self-reference names
/// no target and stays, a literal region is never touched (issue 620), and a
/// file whose stem ends in `.md` never claims the note's references.
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
    covering_roots: &[String],
    target: &RenameTarget,
) -> String {
    if !block_reference_can_spell(target.new_stem()) {
        return content.to_owned();
    }
    visit_block_references_to(
        content,
        ref_path,
        covering_roots,
        target,
        |captured, id, display, m| {
            let new = target.respell(ref_path, m, captured);
            Some(format!("(({new}#^{id}{display}))"))
        },
    )
    .0
}

/// Whether the index reads `after` — a referrer as the two rename passes
/// left it — as it read `before` with every reference the passes respelled
/// filed under its new key, and nothing else changed: the same lines, kinds
/// and block ids, under EACH root in `covering_roots`, because each covering
/// index files the referrer by its own root (issue 678, review; issue 619).
/// A stem the predicates pass can still make prose literal where it lands:
/// `[[a`b`c]]` closes a code span around itself, and `[[a`b]]` pairs with a
/// backtick already on the line, so the link the rename wrote is read by
/// nobody — a backlink gone, in a file reported as updated. The predicates
/// look at the stem alone and cannot see the line; this reads the output
/// back with the index's own reader, and the file rename leaves a file whose
/// reading changed.
///
/// The key a respelled reference is expected under, per root — two
/// mappings. Where it matched under THAT root, `RenameTarget::expected_key`:
/// the new file's own key, so a respelling that named another file fails
/// here. Where it was respelled because it matched under ANOTHER covering
/// root, `filing_key` of the text `respell` wrote, under this root. The
/// second exists because one root's match is another root's other path:
/// with roots `/v` and `/v/sub` covering the referrer `/v/sub/r.md` and the
/// target `/v/sub/a/old.md`, `[[sub/a/old]]` matches under `/v` and is
/// respelled `[[sub/a/new]]`, while under `/v/sub` it reads `sub/a/old`
/// before and `sub/a/new` after — neither is the target's key there, and a
/// single per-root mapping would call the rewrite a change and leave the
/// file. Every other reference keeps its `filing_key` on both sides, so a
/// link to the new name that was already there (`[[old]] [[new]]`) reads
/// the same.
///
/// `respelled` says which kinds the rename rewrote — the passes that could
/// spell the new stem; a kind it left keeps the old key on both sides.
pub fn index_reads_the_rename_back(
    ref_path: &str,
    before: &str,
    after: &str,
    covering_roots: &[String],
    target: &RenameTarget,
    respelled: impl Fn(LinkKind) -> bool,
) -> bool {
    if covering_roots.is_empty() {
        return before == after;
    }
    let windows = target.windows;
    let reading = |content: &str, root: &String, renamed: bool| {
        let under_this_root = std::slice::from_ref(root);
        let mut seen: Vec<(u32, LinkKind, FilingKey, Option<String>)> =
            extract_links(ref_path, content)
                .into_iter()
                .map(|e| {
                    let alias = e.target_vault_alias.as_deref();
                    let plain = |raw: &str| filing_key(ref_path, raw, alias, Some(root), windows);
                    let matched = |roots: &[String]| {
                        target.refers(ref_path, roots, alias.unwrap_or(""), &e.target)
                    };
                    let key = if !renamed || !respelled(e.link_type) {
                        plain(&e.target)
                    } else if let Some(m) = matched(under_this_root) {
                        match (target.expected_key(&m), alias) {
                            (FilingKey::Stem(k) | FilingKey::Path(k), Some(a)) => {
                                FilingKey::Foreign {
                                    alias: a.to_lowercase(),
                                    target: k,
                                }
                            }
                            (key, _) => key,
                        }
                    } else if let Some(m) = matched(covering_roots) {
                        plain(&target.respell(ref_path, &m, &e.target))
                    } else {
                        plain(&e.target)
                    };
                    (e.line, e.link_type, key, e.block_id)
                })
                .collect();
        seen.sort();
        seen
    };
    covering_roots
        .iter()
        .all(|root| reading(before, root, true) == reading(after, root, false))
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

/// How many block references (embeds included) to the renamed file
/// `content` holds in prose — the ones `replace_block_reference_target`
/// would rewrite if the new stem were one a reference can spell, which is
/// the only case this is asked in: not a self-reference, which names no
/// target, not one that names another file's path, not one in a literal
/// region. A file rename to a stem no reference can spell asks this to
/// report the files whose references it leaves.
pub fn block_references_to(
    content: &str,
    ref_path: &str,
    covering_roots: &[String],
    target: &RenameTarget,
) -> usize {
    visit_block_references_to(content, ref_path, covering_roots, target, |_, _, _, _| None).1
}

/// The pass under both: on the lines the index's own grammar reads as a
/// reference to the renamed file, every block reference `target.refers`
/// matches under `covering_roots` in prose is offered to `respell` (target
/// as spelled, block id, display, how it matched) — `Some` replaces it,
/// `None` keeps it — and counted. Returns the content and that count.
fn visit_block_references_to(
    content: &str,
    ref_path: &str,
    covering_roots: &[String],
    target: &RenameTarget,
    respell: impl Fn(&str, &str, &str, &Match) -> Option<String>,
) -> (String, usize) {
    let refers = |raw_target: &str| target.refers(ref_path, covering_roots, "", raw_target);
    let lines: std::collections::HashSet<u32> = extract_links(ref_path, content)
        .into_iter()
        .filter(|entry| {
            entry.link_type.pass() == RewritePass::BlockReferences
                && refers(&entry.target).is_some()
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
                let captured = caps.get(1).map(|m| m.as_str()).unwrap_or("");
                let id = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                let display = caps.get(3).map(|m| m.as_str()).unwrap_or("");
                let mut in_prose = || {
                    !literal
                        .get_or_insert_with(|| Literal::of(content))
                        .overlaps(line.offset + whole.start()..line.offset + whole.end())
                };
                match refers(captured) {
                    Some(m) if in_prose() => {
                        visited += 1;
                        respell(captured, id, display, &m)
                            .unwrap_or_else(|| whole.as_str().to_string())
                    }
                    _ => whole.as_str().to_string(),
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

    /// issue 678 (review) — what the read-back gate compares, on the case
    /// that made it necessary. What fails this: dropping the `respelled`
    /// condition from the key mapping (the second case then reads as a
    /// change), or reading the written line as a link (the third).
    #[test]
    fn the_index_reads_a_rename_back_unless_the_new_stem_made_a_link_literal() {
        let gate =
            |old: &str, new: &str, before: &str, after: &str, respelled: fn(LinkKind) -> bool| {
                index_reads_the_rename_back(
                    "/v/r.md",
                    before,
                    after,
                    &v(),
                    &rename_target(old, new),
                    respelled,
                )
            };
        let (old, new) = stems("old", "new");
        let before = "`x [[old]] and ((old#^b1))\n";
        // A correct rewrite: the same reading, under the new key.
        assert!(gate(
            &old,
            &new,
            before,
            "`x [[new]] and ((new#^b1))\n",
            |_| true
        ));
        // A pass the rename could not spell keeps the old key on both sides.
        assert!(gate(
            &old,
            &new,
            before,
            "`x [[new]] and ((old#^b1))\n",
            |kind| kind == LinkKind::Wikilink
        ));
        // The stem `a`b` pairs with the backtick already on the line: the
        // index reads the written line as nothing, so the rename must not
        // write it.
        let written = "`x [[a`b]]\n";
        assert!(extract_links("/v/r.md", written).is_empty());
        let (_, backticked) = stems("old", "a`b");
        assert!(!gate(&old, &backticked, "`x [[old]]\n", written, |_| true));
        // issue 619: a path-qualified reference respelled with the new path
        // reads back as the new file's path key.
        // What fails this: keying the entries with `normalize_target`, as
        // before issue 619 — `a/old` is never the stem key, so the before
        // side keeps `a/old` and the after side reads `a/new`.
        assert!(gate(
            "/v/a/old.md",
            "/v/a/new.md",
            "see ((a/old#^b1))\n",
            "see ((a/new#^b1))\n",
            |_| true
        ));
        // A link to the new name that was already there, dangling, reads the
        // same on both sides.
        // What fails this: a marker key for what the rename respelled, with
        // the after side mapping the new key to the same marker — the
        // pre-existing `[[new]]` then turns into the marker on one side only.
        assert!(gate(
            &old,
            &new,
            "[[old]] [[new]]\n",
            "[[new]] [[new]]\n",
            |_| true
        ));
    }

    /// The rename of `/v/a/old.md` to `/v/a/new.md`, both passes, for the
    /// referrer `ref_path` under the root `/v`.
    fn both_passes(content: &str, ref_path: &str) -> String {
        let target = rename_target("/v/a/old.md", "/v/a/new.md");
        let content = replace_wikilink_target(content, ref_path, &v(), &target);
        replace_block_reference_target(&content, ref_path, &v(), &target)
    }

    #[test]
    fn a_file_rename_respells_the_tail_of_a_path_qualified_link() {
        // issue 619: the index files `[[a/old]]` and `[[./old]]` under
        // `a/old.md`'s path, so its rename rewrites them — the new text is
        // the new file's path, spelled as the new path spells it, with the
        // note extension the link was written with.
        // What fails this: dropping the `Path` arm from `RenameTarget::refers`
        // — every path-qualified link then stays.
        assert_eq!(
            both_passes(
                "[[a/old|x]] [[A/Old.md]] [[a/old.markdown#h]] ((a/old#^b1|d)) [[Old]]\n",
                "/v/r.md"
            ),
            "[[a/new|x]] [[a/new.md]] [[a/new.markdown#h]] ((a/new#^b1|d)) [[new]]\n"
        );
        assert_eq!(
            both_passes("[[./old.md]] {{embed ((./old#^b1))}}\n", "/v/a/r.md"),
            "[[./new.md]] {{embed ((./new#^b1))}}\n"
        );
        assert_eq!(
            both_passes("[[../a/old#h|d]]\n", "/v/b/r.md"),
            "[[../a/new#h|d]]\n"
        );
        // Another folder's `old`, a doubled separator, a relative path that
        // leaves the root, and the literal regions: all stay.
        let untouched = "[[b/old]] [[a//old]] ((../../old#^x)) `[[a/old]]` `((./old#^b1))`\n";
        assert_eq!(both_passes(untouched, "/v/a/r.md"), untouched);
    }

    #[test]
    fn a_file_rename_respells_a_windows_spelled_path_with_slashes() {
        // On Windows a backslash separates as `/` does, and the link the
        // rename writes is markdown, joined with `/`.
        // What fails this: passing `false` for `windows` to `filing_key` in
        // `keyed_under` — `a\old` is then one bare name and stays.
        let target = RenameTarget {
            old_path: r"C:\v\a\old.md",
            new_path: r"C:\v\a\new.md",
            local_aliases: &[],
            windows: true,
        };
        let roots = vec![r"C:\v".to_string()];
        assert_eq!(
            replace_wikilink_target(r"[[a\old]]", r"C:\v\r.md", &roots, &target),
            "[[a/new]]"
        );
        assert_eq!(
            replace_wikilink_target(r"[[.\old]]", r"C:\v\a\r.md", &roots, &target),
            "[[./new]]"
        );
    }

    #[test]
    fn a_file_rename_leaves_a_link_into_another_vault_alone() {
        // A link behind a vault alias names a file in THAT vault (§87): the
        // index files it as `Foreign`, never under this file's keys, and
        // the rename leaves it. Behind one of this vault's own aliases it is
        // this file's link, and the alias stays in front of the new name.
        // What fails this: dropping the alias check from `RenameTarget::refers`
        // — `[[work::old]]` is then read as `[[old]]` and rewritten; dropping
        // the `Foreign` path arm — `[[work::a/old]]` then stays under the
        // local alias; keying an aliased link without its alias — the
        // relative `[[work::./old]]`, which the index never counts under the
        // file, is then rewritten.
        let content = "see [[work::old]] and [[old]] and [[work::old#intro]]";
        let (old, new) = stems("old", "new");
        assert_eq!(
            replace_wikilink_target(content, "/v/r.md", &v(), &rename_target(&old, &new)),
            "see [[work::old]] and [[new]] and [[work::old#intro]]"
        );
        let local = [crate::index::LocalAlias {
            alias: "work".to_string(),
            root: "/v".to_string(),
        }];
        let target = RenameTarget {
            old_path: &old,
            new_path: &new,
            local_aliases: &local,
            windows: false,
        };
        assert_eq!(
            replace_wikilink_target(content, "/v/r.md", &v(), &target),
            "see [[work::new]] and [[new]] and [[work::new#intro]]"
        );
        // The path-qualified spelling behind the alias, from the note's own
        // folder: another vault's with no local alias, this file's with one;
        // the relative spelling behind an alias is never this file's.
        let paths = "[[work::a/old]] [[work::./old]]";
        let remote = rename_target("/v/a/old.md", "/v/a/new.md");
        assert_eq!(
            replace_wikilink_target(paths, "/v/a/r.md", &v(), &remote),
            paths
        );
        let local_path = RenameTarget {
            old_path: "/v/a/old.md",
            new_path: "/v/a/new.md",
            local_aliases: &local,
            windows: false,
        };
        assert_eq!(
            replace_wikilink_target(paths, "/v/a/r.md", &v(), &local_path),
            "[[work::a/new]] [[work::./old]]"
        );
    }

    #[test]
    fn the_read_back_gate_reads_a_link_behind_a_local_alias_under_its_alias() {
        // issue 717: behind the vault's own alias `work`, `[[work::old]]`
        // is this file's link beside `[[old]]`; both are respelled, and the
        // gate expects the aliased one filed as `Foreign { work, new }`.
        // What fails this: keying the gate's respelled entry by
        // `expected_key` alone, without wrapping it in its alias — the
        // before reading is then `Stem(new)`, the after reading
        // `Foreign { work, new }`, and the gate answers false.
        let local = [crate::index::LocalAlias {
            alias: "work".to_string(),
            root: "/v".to_string(),
        }];
        let target = RenameTarget {
            old_path: "/v/old.md",
            new_path: "/v/new.md",
            local_aliases: &local,
            windows: false,
        };
        let before = "see [[work::old]] and [[old]]\n";
        let after = replace_wikilink_target(before, "/v/r.md", &v(), &target);
        assert_eq!(after, "see [[work::new]] and [[new]]\n");
        assert!(index_reads_the_rename_back(
            "/v/r.md",
            before,
            &after,
            &v(),
            &target,
            |_| true
        ));
    }

    #[test]
    fn the_read_back_gate_never_trusts_a_changed_referrer_no_root_covers() {
        // A referrer no root covers was judged under no index, so nothing
        // vouches for a change to it: changed, the gate answers false;
        // unchanged, there is nothing to vouch for.
        // What fails this: returning `true` when `covering_roots` is empty.
        let target = rename_target("/v/old.md", "/v/new.md");
        let read_back = |after: &str| {
            index_reads_the_rename_back("/v/r.md", "[[old]]\n", after, &[], &target, |_| true)
        };
        assert!(!read_back("[[new]]\n"));
        assert!(read_back("[[old]]\n"));
    }

    #[test]
    fn nested_roots_a_referrer_is_judged_by_the_index_that_covers_it() {
        // issue 619: `/v/r.md` is under the parent root alone, where
        // `a/old` names `/v/a/old.md`, another file than the target
        // `/v/sub/a/old.md`. `/v/sub/r.md` is under both: its `a/old` is the
        // target's path under the child root, its `sub/a/old` the target's
        // path under the parent. The read-back gate holds under each root.
        // What fails this: the gate keying a respelled entry with the old
        // text under the non-matching root — `[[sub/a/old]]` under `/v/sub`,
        // `[[a/old]]` under `/v` — so the `/v/sub/r.md` gate answers false.
        // (Also: `refers` judging under the first covering root alone, which
        // leaves `[[sub/a/old]]`. Judging `/v/r.md` under a root that does
        // not cover it is the service's mistake; its sibling in
        // `service/tests.rs` pins that.)
        let target = rename_target("/v/sub/a/old.md", "/v/sub/a/new.md");
        let parent = v();
        let both = vec!["/v/sub".to_string(), "/v".to_string()];
        let before = "[[old]] [[a/old]]\n";
        let after = replace_wikilink_target(before, "/v/r.md", &parent, &target);
        assert_eq!(after, "[[new]] [[a/old]]\n");
        assert!(index_reads_the_rename_back(
            "/v/r.md",
            before,
            &after,
            &parent,
            &target,
            |_| true
        ));
        let before = "[[a/old]] [[sub/a/old]]\n";
        let after = replace_wikilink_target(before, "/v/sub/r.md", &both, &target);
        assert_eq!(after, "[[a/new]] [[sub/a/new]]\n");
        assert!(index_reads_the_rename_back(
            "/v/sub/r.md",
            before,
            &after,
            &both,
            &target,
            |_| true
        ));
    }

    // §30a replace_block_id_refs_to tests
    /// The target at `file_path` under the one root `/v`, as the block-ID
    /// rename builds it.
    fn target_at(file_path: &str) -> BlockTarget {
        BlockTarget {
            keys_by_root: vec![(
                "/v".to_string(),
                crate::index::keys_for(file_path, Some("/v"), &[], false),
            )],
            windows: false,
        }
    }

    /// The roots that cover every referrer in these tests.
    fn v() -> Vec<String> {
        vec!["/v".to_string()]
    }

    /// The rename of `/v/<old>.md` to `/v/<new>.md` — stems, as the tests
    /// below name them.
    fn stems(old: &str, new: &str) -> (String, String) {
        (format!("/v/{old}.md"), format!("/v/{new}.md"))
    }

    /// A file rename from `old_path` to `new_path` with no local alias, on
    /// a Unix host.
    fn rename_target<'a>(old_path: &'a str, new_path: &'a str) -> RenameTarget<'a> {
        RenameTarget {
            old_path,
            new_path,
            local_aliases: &[],
            windows: false,
        }
    }

    /// `replace_wikilink_target` for the referrer `/v/referrer.md` and the
    /// rename of `/v/<old>.md` to `/v/<new>.md`, under the root `/v`.
    fn wikilinks(content: &str, old: &str, new: &str) -> String {
        let (o, n) = stems(old, new);
        replace_wikilink_target(content, "/v/referrer.md", &v(), &rename_target(&o, &n))
    }

    /// `wikilinks_to` for the same shape.
    fn wikilinks_to_stem(content: &str, old: &str) -> usize {
        let (o, n) = stems(old, "renamed");
        wikilinks_to(content, "/v/referrer.md", &v(), &rename_target(&o, &n))
    }

    /// `replace_block_reference_target` for the referrer `ref_path`.
    fn block_refs(content: &str, ref_path: &str, old: &str, new: &str) -> String {
        let (o, n) = stems(old, new);
        replace_block_reference_target(content, ref_path, &v(), &rename_target(&o, &n))
    }

    /// `block_references_to` for the referrer `ref_path`.
    fn block_refs_to(content: &str, ref_path: &str, old: &str) -> usize {
        let (o, n) = stems(old, "renamed");
        block_references_to(content, ref_path, &v(), &rename_target(&o, &n))
    }

    /// `replace_block_id_refs_to` for a referrer under `/v` and the target
    /// `/v/<stem>.md`.
    fn rename_in(content: &str, stem: &str, old_id: &str, new_id: &str) -> String {
        replace_block_id_refs_to(
            content,
            "/v/referrer.md",
            &v(),
            &target_at(&format!("/v/{stem}.md")),
            old_id,
            new_id,
        )
    }

    #[test]
    fn test_replace_block_id_refs_to_basic_display_embed() {
        let content =
            "See ((notes#^abc123)) and ((notes#^abc123|my label)).\n{{embed ((notes#^abc123))}}";
        let result = rename_in(content, "notes", "abc123", "xyz789");
        assert_eq!(
            result,
            "See ((notes#^xyz789)) and ((notes#^xyz789|my label)).\n{{embed ((notes#^xyz789))}}"
        );
    }

    #[test]
    fn test_replace_block_id_refs_to_leaves_other_targets_with_the_same_id() {
        // issue 594: two notes carry ^id1; only the reference to `a` changes.
        let content = "((a#^id1)) and ((b#^id1)) and ((a#^id2))";
        let result = rename_in(content, "a", "id1", "newId");
        assert_eq!(result, "((a#^newId)) and ((b#^id1)) and ((a#^id2))");
    }

    #[test]
    fn test_replace_block_id_refs_to_never_touches_a_self_reference() {
        // `((#^id))` in a referrer names the referrer's own block.
        let content = "See ((#^abc123)) and ((notes#^abc123)).";
        let result = rename_in(content, "notes", "abc123", "xyz789");
        assert_eq!(result, "See ((#^abc123)) and ((notes#^xyz789)).");
    }

    #[test]
    fn test_replace_block_id_refs_to_rewrites_every_line_that_refers() {
        // issue 668: the rewriter reads the content as it is, not the line
        // numbers an index remembered — every reference to the target changes.
        let content = "((notes#^abc)) first\n((notes#^abc)) second\n((notes#^abc)) third";
        let result = rename_in(content, "notes", "abc", "xyz");
        assert_eq!(
            result,
            "((notes#^xyz)) first\n((notes#^xyz)) second\n((notes#^xyz)) third"
        );
    }

    #[test]
    fn test_replace_block_id_refs_to_matches_the_target_the_way_the_index_does() {
        // Case and the `.md` extension normalize away, as the index's keys do.
        // A path-qualified target is filed under its path under the root
        // (issue 619): `dir/notes.md` is `/v/dir/notes.md`'s, and not the
        // root-level `/v/notes.md`'s — what the index counts is what a rename
        // may touch.
        // What fails this: `BlockTarget::refers` keying the raw target as a
        // `Stem` of its whole text, the rule before issue 619 —
        // `((dir/notes.md#^abc))` then keeps its ID for `/v/dir/notes.md`.
        let content = "((Notes#^abc)) ((notes.md#^abc)) ((dir/notes.md#^abc)) ((other#^abc))";
        assert_eq!(
            rename_in(content, "dir/notes", "abc", "xyz"),
            "((Notes#^xyz)) ((notes.md#^xyz)) ((dir/notes.md#^xyz)) ((other#^abc))"
        );
        assert_eq!(
            rename_in(content, "notes", "abc", "xyz"),
            "((Notes#^xyz)) ((notes.md#^xyz)) ((dir/notes.md#^abc)) ((other#^abc))"
        );
        // A referrer that no root covers is judged under none: nothing changes.
        // What fails this: refers ignoring covering_roots.
        assert_eq!(
            replace_block_id_refs_to(
                content,
                "/v/referrer.md",
                &[],
                &target_at("/v/dir/notes.md"),
                "abc",
                "xyz"
            ),
            content
        );
    }

    #[test]
    fn a_block_id_rename_reads_a_relative_reference_from_the_referrers_folder() {
        // issue 619: `./` and `../` resolve against the folder of the note
        // they are written in, as the index files them.
        // What fails this: resolving a relative target against the root
        // instead of the referrer's folder — `((./note#^old))` then names
        // `/v/note.md` and keeps its ID.
        let content = "((./note#^old))\n((../dir/note#^old))\n((other/note#^old))\n";
        assert_eq!(
            replace_block_id_refs_to(
                content,
                "/v/dir/referrer.md",
                &v(),
                &target_at("/v/dir/note.md"),
                "old",
                "new"
            ),
            "((./note#^new))\n((../dir/note#^new))\n((other/note#^old))\n"
        );
    }

    #[test]
    fn test_replace_block_id_refs_to_no_match_is_byte_identical() {
        let content = "See ((notes#^other)) and {{embed ((notes#^other))}}\r\nend";
        let result = rename_in(content, "notes", "abc", "xyz");
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
            block_refs(content, "/v/referrer.md", "old", "new"),
            "See ((new#^abc)) and ((new#^abc|label)).\n{{embed ((new#^abc))}} and [[old]]"
        );
    }

    #[test]
    fn a_file_rename_matches_the_target_the_way_the_index_does_and_keeps_the_rest() {
        // Case and `.md` normalize away as the index's key does, and the
        // `.md` the reference was spelled with stays on the new name. The
        // path `dir/old` names `/v/dir/old.md`, not this file's path under
        // the root (`old`), and a self-reference names no target — both
        // stay (issue 619). Another note's block with the same ID is
        // another note's.
        // What fails this: dropping the suffix preservation in
        // `RenameTarget::respell` (`note_suffix` answering "") —
        // `((old.md#^a))` then becomes `((new#^a))`.
        let content = "((Old#^a)) ((old.md#^a)) ((dir/old#^a)) ((#^a)) ((other#^a))";
        assert_eq!(
            block_refs(content, "/v/referrer.md", "old", "new"),
            "((new#^a)) ((new.md#^a)) ((dir/old#^a)) ((#^a)) ((other#^a))"
        );
    }

    #[test]
    fn a_file_rename_leaves_a_block_reference_inside_code_and_keeps_offsets_and_crlf() {
        // issue 620: the reference in the code span is literal; the prose one
        // beside it is rewritten with a stem of another length, and the line
        // after keeps its CRLF.
        let content = "`((old#^a))` then ((old#^a)) end\r\nnext ((old#^b))\r\n";
        assert_eq!(
            block_refs(content, "/v/referrer.md", "old", "longer-name"),
            "`((old#^a))` then ((longer-name#^a)) end\r\nnext ((longer-name#^b))\r\n"
        );
        let untouched = "no reference here\n((other#^a))";
        assert_eq!(
            block_refs(untouched, "/v/referrer.md", "old", "new"),
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
                block_refs(content, "/v/referrer.md", "old", stem),
                content,
                "{stem}"
            );
        }
    }

    #[test]
    fn a_file_rename_counts_the_block_references_it_would_rewrite() {
        // issue 678: what a stem no reference can spell leaves behind is what
        // the rewrite would have touched — the references in prose that name
        // the old stem; not a self-reference (whichever file holds it), not
        // one naming another file's path (`dir/old` is `/v/dir/old.md`'s),
        // not one inside code, and never a wikilink.
        let content =
            "((old#^a)) {{embed ((old#^b|shown))}} ((#^c)) ((dir/old#^d)) `((old#^e))`\n[[old]]\n";
        assert_eq!(block_refs_to(content, "/v/referrer.md", "old"), 2);
        assert_eq!(block_refs_to(content, "/v/old.md", "old"), 2);
        assert_eq!(block_refs_to("see [[old]] only\n", "/v/r.md", "old"), 0);
        assert_eq!(
            block_refs(content, "/v/referrer.md", "old", "new"),
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
            assert_eq!(wikilinks(content, "old", stem), content, "{stem:?}");
            assert!(!wikilink_can_spell(stem), "{stem:?}");
        }
        assert_eq!(
            wikilinks(content, "old", "note (draft)"),
            "see [[note (draft)]] and [[note (draft)#h|shown]] and [[note (draft).md]]"
        );
        // `::` reads as an alias only behind a leading word; `1::2` does not.
        assert!(wikilink_can_spell("1::2"));
        assert!(wikilink_can_spell("note (draft)"));
        // What the rename reports it left: the links in prose that name the
        // old file — not one naming another file's path (`dir/old`), one in
        // code, or a block reference.
        assert_eq!(
            wikilinks_to_stem(
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
        let txt = rename_target("/v/diagram.md.txt", "/v/chart.txt");
        assert_eq!(
            replace_wikilink_target(content, "/v/r.md", &v(), &txt),
            content
        );
        assert_eq!(
            replace_block_reference_target(content, "/v/r.md", &v(), &txt),
            content
        );
        assert_eq!(block_references_to(content, "/v/r.md", &v(), &txt), 0);
        assert_eq!(
            wikilinks(content, "diagram", "chart"),
            "see [[chart]] [[chart.md]] [[diagram.md.txt]] ((diagram#^a))\n"
        );
        assert_eq!(block_refs_to(content, "/v/r.md", "diagram"), 1);
    }

    #[test]
    fn a_wikilink_rename_matches_the_target_the_way_the_index_does() {
        // issue 678: the index files `[[old.md]]` and `[[OLD]]` under the key
        // `old` (normalize_target); a rename that left them would report the
        // file as stale. The `.md` spelling is kept on the new name; the
        // rest of the link — heading, block, display — is untouched.
        assert_eq!(
            wikilinks(
                "[[old.md]] [[OLD|shown]] [[old#h]] [[Old.md^b1]]",
                "old",
                "new"
            ),
            "[[new.md]] [[new|shown]] [[new#h]] [[new.md^b1]]"
        );
        // Unicode case folds as the index folds it.
        assert_eq!(wikilinks("[[ÉCOLE]]", "école", "school"), "[[school]]");
    }

    // §33 replace_wikilink_target tests
    #[test]
    fn test_replace_wikilink_target_basic() {
        let content = "See [[old-note]] for details.";
        let result = wikilinks(content, "old-note", "new-note");
        assert_eq!(result, "See [[new-note]] for details.");
    }

    #[test]
    fn test_replace_wikilink_target_with_display() {
        let content = "Read [[old-note|my alias]] here.";
        let result = wikilinks(content, "old-note", "new-note");
        assert_eq!(result, "Read [[new-note|my alias]] here.");
    }

    #[test]
    fn test_replace_wikilink_target_with_heading() {
        let content = "See [[old-note#intro]] and [[old-note#summary|要約]].";
        let result = wikilinks(content, "old-note", "new-note");
        assert_eq!(
            result,
            "See [[new-note#intro]] and [[new-note#summary|要約]]."
        );
    }

    #[test]
    fn test_replace_wikilink_target_case_insensitive() {
        let content = "Links: [[Old-Note]] and [[old-note]].";
        let result = wikilinks(content, "old-note", "new-note");
        assert_eq!(result, "Links: [[new-note]] and [[new-note]].");
    }

    #[test]
    fn test_replace_wikilink_target_multiple_per_line() {
        let content = "Both [[old]] and [[other]] and [[old|display]].";
        let result = wikilinks(content, "old", "new");
        assert_eq!(result, "Both [[new]] and [[other]] and [[new|display]].");
    }

    #[test]
    fn test_replace_wikilink_target_no_match() {
        let content = "See [[unrelated]] for details.";
        let result = wikilinks(content, "old", "new");
        assert_eq!(result, "See [[unrelated]] for details.");
    }

    #[test]
    fn test_replace_wikilink_target_leaves_another_vaults_alias_link_alone() {
        // What fails this: dropping the alias check from `RenameTarget::refers`.
        let content = "See [[work::old-note]] for details.";
        let result = wikilinks(content, "old-note", "new-note");
        assert_eq!(result, content);
    }

    #[test]
    fn test_replace_wikilink_target_leaves_a_cross_vault_link_with_heading_alone() {
        // What fails this: dropping the alias check from `RenameTarget::refers`.
        let content = "See [[work::old-note#intro]] here.";
        let result = wikilinks(content, "old-note", "new-note");
        assert_eq!(result, content);
    }

    #[test]
    fn a_block_id_rename_leaves_a_fenced_line_alone_even_when_the_index_named_it() {
        // Defence in depth: an index built before this change may still
        // point at a line inside a fence.
        let content = "```\n((notes#^abc))\n```\n((notes#^abc)) `((notes#^abc))`\n";
        assert_eq!(
            rename_in(content, "notes", "abc", "xyz"),
            "```\n((notes#^abc))\n```\n((notes#^xyz)) `((notes#^abc))`\n"
        );
    }

    #[test]
    fn a_block_id_rename_on_one_line_keeps_the_code_span_whatever_the_new_length() {
        let content = "{{embed ((notes#^abc))}} `((notes#^abc))` ((notes#^abc|show))\n";
        assert_eq!(
            rename_in(content, "notes", "abc", "a-much-longer-id"),
            "{{embed ((notes#^a-much-longer-id))}} `((notes#^abc))` ((notes#^a-much-longer-id|show))\n"
        );
        assert_eq!(
            rename_in(content, "notes", "abc", "z"),
            "{{embed ((notes#^z))}} `((notes#^abc))` ((notes#^z|show))\n"
        );
    }

    #[test]
    fn a_block_id_rename_keeps_crlf_and_finds_its_lines_in_a_crlf_file() {
        let content = "((notes#^abc))\r\n```\r\n((notes#^abc))\r\n```\r\n((notes#^abc))\r\n";
        assert_eq!(
            rename_in(content, "notes", "abc", "xyz"),
            "((notes#^xyz))\r\n```\r\n((notes#^abc))\r\n```\r\n((notes#^xyz))\r\n"
        );
    }

    #[test]
    fn a_wikilink_target_rename_skips_code_and_a_link_broken_across_lines() {
        let content = "[[old]] `[[old]]`\n```\n[[old]]\n```\n    [[old]]\n[[old|shown]]\n";
        assert_eq!(
            wikilinks(content, "old", "new"),
            "[[new]] `[[old]]`\n```\n[[old]]\n```\n    [[old]]\n[[new|shown]]\n"
        );
        // The index reads a line at a time and never sees `[[a\nb]]`; the
        // rewriter must not either.
        assert_eq!(wikilinks("[[a\nb]]", "a\nb", "c"), "[[a\nb]]");
    }

    /// issue 668 — the rewriter judges the CURRENT content, not the line
    /// numbers an index remembered, and by the index's own target rule.
    #[test]
    fn the_block_id_rewriter_finds_the_reference_where_it_stands_now() {
        let target = target_at("/v/note.md");
        let roots = v();
        let rename = |content: &str, target: &BlockTarget| {
            replace_block_id_refs_to(content, "/v/a.md", &roots, target, "b1", "b2")
        };
        // A line inserted above the reference after the index was built: the
        // reference is found on its new line and rewritten.
        assert_eq!(
            rename("new line\nsee ((note#^b1))\n", &target),
            "new line\nsee ((note#^b2))\n"
        );
        // A path-qualified target on its own line is filed under `b/note`:
        // `/v/b/note.md`'s block, whose rename rewrites it, and not
        // `/v/note.md`'s, whose rename leaves it alone (issue 619).
        // What fails this: dropping the `Path` key from `keys_for` — the
        // first answer keeps `((b/note#^b1))`.
        assert_eq!(
            rename("((note#^b1))\n((b/note#^b1))\n", &target_at("/v/b/note.md")),
            "((note#^b2))\n((b/note#^b2))\n"
        );
        assert_eq!(
            rename("((note#^b1))\n((b/note#^b1))\n", &target),
            "((note#^b2))\n((b/note#^b1))\n"
        );
        // A referrer that no root covers is judged under none: nothing changes.
        // What fails this: refers ignoring covering_roots.
        let uncovered = "((note#^b1))\n((b/note#^b1))\n";
        assert_eq!(
            replace_block_id_refs_to(
                uncovered,
                "/v/a.md",
                &[],
                &target_at("/v/b/note.md"),
                "b1",
                "b2"
            ),
            uncovered
        );
        // An embed with a display part is a plain reference to the grammar —
        // indexed as one, rewritten as one.
        assert_eq!(
            rename("{{embed ((note#^b1|caption))}}\n", &target),
            "{{embed ((note#^b2|caption))}}\n"
        );
        // Nothing to the target: byte for byte.
        let untouched = "((other#^b1)) `((note#^b1))`\n";
        assert_eq!(rename(untouched, &target), untouched);
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
        assert_eq!(
            replace_block_id_refs_to(md, "/v/a.md", &v(), &target_at("/v/note.md"), "b1", "b2"),
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
            let target = BlockTarget {
                keys_by_root: vec![(
                    "/vault".to_string(),
                    crate::index::keys_for(target, Some("/vault"), &[], false),
                )],
                windows: false,
            };
            assert_eq!(
                replace_block_id_refs_to(
                    markdown,
                    referrer,
                    &["/vault".to_string()],
                    &target,
                    old,
                    new
                ),
                case["expected"].as_str().unwrap(),
                "{name}"
            );
        }
    }
}
