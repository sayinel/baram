//! §33 Block ID rename with reference updates — preparation in rename/scope.rs, the referrer
//! rewrite in rename/referrers.rs, result types and path helpers in rename/mod.rs.

use crate::context::manager::Registered;
use crate::context::ContextManager;
use crate::index::filing::backlink_keys_for;
use crate::index::normalizer::normalize_file_path;
use crate::index::{replace_block_id_refs_to, BlockTarget, FilingKey, KnownPaths};
use std::collections::HashMap;

use super::super::keys::keys_of;
use super::super::state::{LinkIndexState, Mutation};
use super::referrers::{
    apply_queued, named_only_for_own_references, queue_rewritten, rewrite_referrers,
    ReferrerRewrite, Unchanged,
};
use super::scope::{Referrers, RenameScope};
use super::{plain_absolute, RenameResult};

pub(crate) async fn rename_block_id_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    file_path: &str,
    old_id: &str,
    new_id: &str,
) -> Result<RenameResult, String> {
    plain_absolute(file_path)?;
    let scope = RenameScope::holding(state, ctx_mgr, file_path).await?;

    // 1. Get referring files from every containing index (block_id == old_id,
    //    target == this file), with the LINES the index saw the reference on.
    //    An index gone since the gate is a refusal. A referrer may also hold
    //    `((other#^old_id))` — another note's block with the same ID — which
    //    must not change: the rewrite is confined to those lines and, on them,
    //    to references whose target is this file (issue 594).
    //    issue 668: the index says WHICH FILES refer; the lines it remembers
    //    are not trusted — the rewriter reads each file as it is now. How
    //    many lines it named each file for is kept, for the exemption below.
    //    Read with what the roots know of their notes (`RenameScope::referrers`).
    let Referrers {
        named_lines,
        files: referring_files,
        known_paths,
    } = scope
        .referrers(state, ctx_mgr, None, |index| {
            index.block_reference_lines(file_path, old_id)
        })
        .await?;
    // The keys a reference to this file is filed under in each index read
    // above: its stem and zettel id, the same in every index, and its path
    // under that index's root (issue 619) — what `backlink_keys` reads there.
    // With the notes of every vault that holds the file or a referrer, each
    // index built first: a path reference another root holding the referrer
    // reads as a different existing note — or might, when its index could
    // not be built — is left and its file reported (`BlockTarget::judge`).
    let target = block_target(file_path, &scope.dirs, known_paths);
    // The same-stem exemption (`named_only_for_own_references`), counting
    // only this block's self-references, with the stem checked against the
    // target's keys in every index read — a zettel id included.
    let named_for_its_own_references = |path: &str, content: &str| {
        named_only_for_own_references(path, content, &named_lines, Some(old_id), |p| {
            let stem = FilingKey::Stem(normalize_file_path(p));
            target
                .keys_by_root
                .iter()
                .any(|(_, keys)| keys.contains(&stem))
        })
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
        &scope.dirs,
        &Unchanged::Report {
            unless: &named_for_its_own_references,
        },
        |content, ref_path, covering| {
            let pass = replace_block_id_refs_to(
                content,
                ref_path,
                &keys_of(covering),
                &target,
                old_id,
                new_id,
            );
            ReferrerRewrite {
                content: pass.content,
                left_behind: pass.ambiguous > 0,
            }
        },
    )
    .await;

    // 3. Update the containing indexes — each rewritten file goes into the
    //    indexes that cover it, spelled each index's way.
    let mut per_key: HashMap<String, Vec<Mutation>> = HashMap::new();
    queue_rewritten(&mut per_key, ctx_mgr, &scope.keys, rewritten.contents).await;
    apply_queued(state, per_key).await;

    Ok(RenameResult {
        updated_files: rewritten.updated,
        skipped_files: rewritten.skipped,
    })
}

/// The file at `file_path` as a block-ID rename's target: for each directory
/// context in `dirs`, the keys a reference to it is filed under in that
/// context's index (`backlink_keys_for` under that root, the function
/// `LinkIndex::backlink_keys` reads them with). No vault alias: a block
/// reference or embed never carries one (`BLOCK_REF_RE`, `BLOCK_EMBED_RE`
/// in extractor.rs have no alias group).
fn block_target(file_path: &str, dirs: &[Registered], known_paths: KnownPaths) -> BlockTarget {
    let keys_by_root = dirs
        .iter()
        .map(|d| {
            let root = d.info.path.clone();
            let keys = backlink_keys_for(file_path, Some(&root), &[], cfg!(windows));
            (root, keys)
        })
        .collect();
    BlockTarget {
        keys_by_root,
        known_paths,
        windows: cfg!(windows),
    }
}
