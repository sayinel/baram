//! §33 Block ID rename with reference updates — see rename/mod.rs for the shared helpers.

use crate::context::manager::Registered;
use crate::context::ContextManager;
use crate::index::normalizer::{extract_id_from_stem, normalize_file_path};
use crate::index::{
    keys_for, own_block_reference_lines, replace_block_id_refs_to, BlockTarget, FilingKey,
};
use std::collections::HashMap;

use super::super::build::{ensure_indexes, read_indexes};
use super::super::keys::{buildable, keys_of, local_aliases_of, owning_contexts};
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
    // The file's own vault aliases (§87), so the keys read here are the ones
    // `get_backlinks` reads. They match nothing a block-ID rename rewrites
    // today: the extractor gives a block reference or embed no alias, and a
    // wikilink no block id (`extract_links`, its three `LinkEntry` arms).
    let local_aliases = local_aliases_of(ctx_mgr, &dirs).await;

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
        read_indexes(state, &dirs, |_, index| {
            index.block_reference_lines(file_path, old_id, &local_aliases)
        })
        .await?,
    );
    // The keys a reference to this file is filed under in each index read
    // above: its stem and zettel id, the same in every index, and its path
    // under that index's root (issue 619) — what `backlink_keys` reads there.
    let target = block_target(file_path, &dirs, &local_aliases);
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
        let stem = FilingKey::Stem(normalize_file_path(path));
        target
            .keys_by_root
            .iter()
            .any(|(_, keys)| keys.contains(&stem))
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
        ctx_mgr,
        &dirs,
        &Unchanged::Report {
            unless: &named_for_its_own_references,
        },
        |content, ref_path, covering| Rewrite {
            content: replace_block_id_refs_to(
                content,
                ref_path,
                &keys_of(covering),
                &target,
                old_id,
                new_id,
            ),
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

/// The file at `file_path` as a block-ID rename's target: for each directory
/// context in `dirs`, the keys a reference to it is filed under in that
/// context's index (`keys_for` under that root with `local_aliases`, plus the
/// zettel id inside its stem, as `LinkIndex::backlink_keys` reads them).
fn block_target(file_path: &str, dirs: &[Registered], local_aliases: &[String]) -> BlockTarget {
    let id = extract_id_from_stem(&normalize_file_path(file_path));
    let keys_by_root = dirs
        .iter()
        .map(|d| {
            let root = d.info.path.clone();
            let mut keys = keys_for(file_path, Some(&root), local_aliases, cfg!(windows));
            if let Some(id) = &id {
                keys.push(FilingKey::Stem(id.clone()));
            }
            (root, keys)
        })
        .collect();
    BlockTarget {
        keys_by_root,
        windows: cfg!(windows),
    }
}
