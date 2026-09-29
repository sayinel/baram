// §33 The read-back gate — whether the index reads a referrer the two file
// rename passes rewrote as it read it before, with every respelled reference
// under its new key. The passes themselves are `rewriter.rs`.

use super::extractor::extract_links;
use super::filing::{filing_key, FilingKey};
use super::judgement::RenameTarget;
use super::LinkKind;

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
                    // An ambiguous reference (`RenameTarget::judge`) is
                    // never rewritten, and `matched` answers `None` for it
                    // whatever roots it is given — ambiguity reads every
                    // known root holding the referrer — so it keeps its
                    // `filing_key` on both sides.
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
                            (key @ (FilingKey::Stem(_) | FilingKey::Path(_)), None) => key,
                            (key @ FilingKey::Foreign { .. }, _) => key,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::rewriter::tests::{rename_target, replace_wikilink_target, stems, v};

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
            known_paths: Default::default(),
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
}
