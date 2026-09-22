//! §33 Block ID rename with reference updates — see rename/mod.rs for the shared helpers.

use crate::context::ContextManager;
use crate::index::{backlink_keys, own_block_reference_lines, replace_block_id_refs_to};
use std::collections::HashMap;

use super::super::build::{ensure_indexes, read_indexes};
use super::super::keys::{buildable, keys_of, owning_contexts};
use super::super::state::{LinkIndexState, Mutation};
use super::referrers::{
    apply_queued, named_referrers, queue_rewritten, rewrite_referrers, Rewrite, Unchanged,
};
use super::RenameResult;

pub(crate) async fn rename_block_id_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    file_path: &str,
    old_id: &str,
    new_id: &str,
) -> Result<RenameResult, String> {
    let contexts = owning_contexts(ctx_mgr, file_path).await;
    if contexts.is_empty() {
        return Err(format!("{file_path} is not inside any registered context"));
    }
    ensure_indexes(state, ctx_mgr, &contexts).await?;
    let dirs = buildable(&contexts);
    let keys = keys_of(&dirs);

    // 1. Get referring files from every containing index (block_id == old_id,
    //    target == this file), with the LINES the index saw the reference on.
    //    An index gone since the gate is a refusal. A referrer may also hold
    //    `((other#^old_id))` — another note's block with the same ID — which
    //    must not change: the rewrite is confined to those lines and, on them,
    //    to references whose target is this file (issue 594).
    //    issue 668: the index says WHICH FILES refer; the lines it remembers
    //    are not trusted — the rewriter reads each file as it is now. How
    //    many lines it named each file for is kept, for the exemption below.
    let (named_lines, referring_files) = named_referrers(
        read_indexes(state, &dirs, |index| {
            index.block_reference_lines(file_path, old_id)
        })
        .await?,
    );
    let target_keys = backlink_keys(file_path);
    // A referrer that shares the target's stem — another `note.md` in some
    // other folder — is named by the index for its own self-references
    // (`((#^id))` is filed under the referrer's own stem, which is the
    // target's). The rewrite leaves those alone, rightly, and the file must
    // not then be reported as a stale referrer — while it holds at least as
    // many self-reference lines as the index named it for. The stem alone is
    // not why the index named it: a same-stem note whose `((note#^id))` to
    // the target has gone since, self-reference beside it or not, holds
    // fewer, and is stale like any other.
    let named_for_its_own_references = |path: &str, content: &str| {
        target_keys.contains(&crate::index::normalizer::normalize_file_path(path))
            && named_lines
                .get(path)
                .is_some_and(|&lines| own_block_reference_lines(content, Some(old_id)) >= lines)
    };

    // 2. Read + replace + write (outside lock). The first referrer written is
    //    this command's point of no return: a later one that cannot be
    //    rewritten is skipped and reported, not turned into an `Err` that
    //    would claim nothing changed while some files already say `new_id`
    //    (issue 594).
    //    A referrer the index named in which no reference to this block is
    //    found any more is REPORTED (issue 668): the index was stale, the
    //    definition takes the new ID, and the user must hear that this file
    //    still says the old one.
    let rewritten = rewrite_referrers(
        &referring_files,
        file_path,
        &dirs,
        &Unchanged::Report {
            unless: &named_for_its_own_references,
        },
        |content, ref_path| Rewrite {
            content: replace_block_id_refs_to(content, ref_path, &target_keys, old_id, new_id),
            left_behind: false,
        },
    )
    .await;

    // 3. Update the containing indexes — each rewritten file goes into the
    //    indexes that cover it, spelled each index's way.
    let mut per_key: HashMap<String, Vec<Mutation>> = HashMap::new();
    queue_rewritten(&mut per_key, ctx_mgr, &keys, rewritten.contents).await;
    apply_queued(state, per_key).await;

    Ok(RenameResult {
        updated_files: rewritten.updated,
        skipped_files: rewritten.skipped,
    })
}
