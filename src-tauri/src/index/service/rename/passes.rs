//! §33 The two link passes of a file rename with the read-back gate, and the
//! renamed note's own rewrite that `rewrite_referrers` skips.

use crate::index::{
    block_reference_can_spell, index_reads_the_rename_back, replace_block_reference_target,
    replace_wikilink_target, wikilink_can_spell, RenameTarget, RewritePass,
};

use super::referrers::{ReferrerRewrite, RewriteBatch};

/// The two link passes of a file rename (issue 678), judged apart, over the
/// references `RenameTarget::refers` matches in a referrer under the roots
/// that cover it — by stem, by path under such a root, or relative to the
/// referrer's folder (issue 619). A new stem a link cannot spell is not
/// written into one (`wikilink_can_spell`, `block_reference_can_spell`:
/// `[[a^b]]` names the note `a`, `((a^b#^id))` is fine; `((a)b#^id))` parses
/// as nothing, `[[a)b]]` is fine). The links the stem can be spelled in are
/// rewritten; the others stay, and every file they stay in is reported,
/// rewritten or not (`ReferrerRewrite::left_behind`). What the passes wrote
/// is then read back with the index's reader before it is handed over
/// (`index_reads_the_rename_back`): a stem the predicates pass can still turn
/// a link literal where it lands — a backtick pairing with one on the line —
/// and such a file is left as it was, and reported.
pub(super) struct LinkPasses<'a> {
    target: RenameTarget<'a>,
    wikilinks_spellable: bool,
    block_references_spellable: bool,
}

impl<'a> LinkPasses<'a> {
    pub(super) fn new(target: RenameTarget<'a>) -> Self {
        let new_stem = target.new_stem();
        Self {
            wikilinks_spellable: wikilink_can_spell(&new_stem),
            block_references_spellable: block_reference_can_spell(&new_stem),
            target,
        }
    }

    fn spellable(&self, pass: RewritePass) -> bool {
        match pass {
            RewritePass::Wikilinks => self.wikilinks_spellable,
            RewritePass::BlockReferences => self.block_references_spellable,
        }
    }

    /// Wikilinks, then block references and embeds — each pass reads the
    /// content the other produced, so offsets and literal regions are its own.
    /// `covering_roots` are the roots used to judge `ref_path`: its covering
    /// index roots, or its own folder for a standalone File context (§89).
    /// Each pass reads the referrer once and counts, in that same visit, the
    /// references it matched and the ones it found ambiguous.
    pub(super) fn rewrite(
        &self,
        content: &str,
        ref_path: &str,
        covering_roots: &[String],
    ) -> ReferrerRewrite {
        let before = content;
        let target = &self.target;
        let wikilinks = replace_wikilink_target(content, ref_path, covering_roots, target);
        let blocks =
            replace_block_reference_target(&wikilinks.content, ref_path, covering_roots, target);
        // A pass whose new stem the grammar cannot spell rewrites nothing and
        // counts what it left. A reference a root holding the referrer reads
        // as a different existing note is kept as written
        // (`RenameTarget::judge`) and the file is reported; kept, it reads
        // the same before and after, so the gate below does not see it.
        let left_behind = (!self.wikilinks_spellable && wikilinks.matched > 0)
            || (!self.block_references_spellable && blocks.matched > 0)
            || wikilinks.ambiguous > 0
            || blocks.ambiguous > 0;
        let content = blocks.content;
        // READ-BACK GATE (issue 678): what was written must be read
        // as a link to the new name where it stands, or it is not written.
        if content != before
            && !index_reads_the_rename_back(
                ref_path,
                before,
                &content,
                covering_roots,
                target,
                |kind| self.spellable(kind.pass()),
            )
        {
            log::warn!(
                "rename: {ref_path} would not read back as linking to the new name where its links stand; they are left as they are"
            );
            return ReferrerRewrite {
                content: before.to_owned(),
                left_behind: true,
            };
        }
        ReferrerRewrite {
            content,
            left_behind,
        }
    }
}

/// The renamed note itself, which rewrite_referrers skips: it may spell its
/// own name — `((old#^b1))` pasted from another note, `[[old]]`, `[[a/old]]`
/// — and under the new name those would dangle. The passes run on it under
/// the new path, so `((#^id))`, which names no target, resolves to the new
/// stem and stays, and a relative `((./old#^x))` still resolves to the old
/// path because the note stays in its directory.
/// What they change is written where the file is now — if `still_confined`
/// says the destination still is where it may be — and the note joins
/// `updated`, so an open tab follows the disk. It joins `skipped` on the same
/// terms as a referrer: a reference left behind, a write refused or failed,
/// or nothing to change although the index named it for more
/// (`named_for_more`). Returns the content the file holds now, for the index.
pub(super) async fn rewrite_renamed_note(
    new_path: &str,
    content: String,
    rewrite: impl Fn(&str, &str) -> ReferrerRewrite,
    still_confined: impl Fn() -> bool,
    named_for_more: impl Fn(&str) -> bool,
    rewritten: &mut RewriteBatch,
) -> String {
    let ReferrerRewrite {
        content: own_rewritten,
        left_behind,
    } = rewrite(&content, new_path);
    let (content, stale) = if own_rewritten == content {
        let named_for_more = named_for_more(&content);
        (content, left_behind || named_for_more)
    } else if !still_confined() {
        // The note is still filed in the index, and rightly: under what
        // `new_path` resolves to after the move, where a save would file it.
        // What this branch refuses is WRITING through an entry, or to a file,
        // that no longer lies inside the contexts (`confined_both_ways`) —
        // unlike a referrer, which was never moved and whose stale resolution
        // would make the index describe a file the rename never touched.
        log::warn!("rename: {new_path} no longer resolves inside the file's contexts, its references are left as they are");
        (content, true)
    } else {
        match crate::fs::write_file(new_path, &own_rewritten).await {
            Ok(()) => {
                rewritten.updated.push(new_path.to_owned());
                (own_rewritten, left_behind)
            }
            Err(e) => {
                log::warn!("rename: {new_path} could not be rewritten: {e}");
                (content, true)
            }
        }
    };
    if stale {
        // "may": one cause counted the links it left, the other found none
        // to rewrite and cannot say where the index's are — which is what
        // `RenameResult::skipped_files` promises, so the log says no more.
        log::warn!(
            "rename: {new_path} may still hold links to its old name; they are left as they are"
        );
        rewritten.skipped.push(new_path.to_owned());
    }
    content
}

#[cfg(test)]
mod tests {
    use super::LinkPasses;
    use crate::index::RenameTarget;
    use crate::md::literal::analyses;

    #[test]
    fn a_changed_referrer_under_one_root_is_analysed_once_per_reading() {
        // Each pass counts what it matched and what it found ambiguous in
        // the visit that rewrites, so one referrer under one root costs five
        // literal analyses: the wikilink pass's, the block pass's two (its
        // `extract_links` and the regions it rewrites in), and the read-back
        // gate's two (before and after).
        // What fails this: counting ambiguity in a pass of its own again —
        // a second wikilink visit adds one, a second block visit adds two.
        let passes = LinkPasses::new(RenameTarget {
            old_path: "/v/old.md",
            new_path: "/v/new.md",
            local_aliases: &[],
            known_paths: Default::default(),
            windows: false,
        });
        let before = analyses();
        let rewrite = passes.rewrite("[[old]] ((old#^b1))\n", "/v/r.md", &["/v".to_string()]);
        assert_eq!(analyses() - before, 5);
        assert_eq!(rewrite.content, "[[new]] ((new#^b1))\n");
        assert!(!rewrite.left_behind);
    }
}
