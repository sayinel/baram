//! §33 File rename with link updates — preparation in rename/scope.rs, destination checks in
//! rename/destination.rs, link passes in rename/passes.rs, the referrer rewrite in
//! rename/referrers.rs, result types and path helpers in rename/mod.rs.

use crate::context::ContextManager;
use crate::index::{
    file_stem_from_path, link_reads_back_as_the_file, own_block_reference_lines, RenameTarget,
};
use std::collections::HashMap;

use super::super::keys::{keys_of, local_aliases_of};
use super::super::state::{LinkIndexState, Mutation};
use super::destination::{another_entry_at, confined_both_ways, judge};
use super::passes::{rewrite_renamed_note, LinkPasses};
use super::referrers::{apply_queued, queue_rewritten, rewrite_referrers, Unchanged};
use super::scope::{Referrers, RenameScope};
use super::{absolute, push_for_keys, RenameResult};

pub(crate) async fn rename_file_with_links_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    old_path: &str,
    new_path: &str,
) -> Result<RenameResult, String> {
    absolute(old_path)?;
    absolute(new_path)?;
    // The contexts and their indexes first (`RenameScope::holding`).
    let scope = RenameScope::holding(state, ctx_mgr, old_path).await?;
    // issue 717: a link behind one of the file's own vault aliases names it
    // (§87); one behind any other alias names another vault's note and stays.
    let local_aliases = local_aliases_of(ctx_mgr, &scope.dirs).await;
    // Both ends inside the file's contexts, and no move (`judge`).
    let source = judge(old_path, new_path, &scope.dirs)?;

    // 1. Get referencing files from every containing index, and what every
    //    root holding the file or a referrer knows of its notes, read before
    //    the move (`RenameScope::referrers`).
    //    issue 678: with the lines each file was named for (dedup across
    //    indexes), for the same-stem exemption below — as the block ID
    //    rename keeps them (issue 668). The files are what the rewrite visits.
    let Referrers {
        named_lines,
        files: referring_files,
        known_paths,
    } = scope
        .referrers(state, ctx_mgr, |_ctx, i| {
            i.referring_lines_to(old_path, &local_aliases)
        })
        .await?;
    // A same-stem note elsewhere (`b/old.md` beside `a/old.md`) is named by
    // the index for its own `((#^id))` references, filed under its stem —
    // the old name's key. The rewrite rightly leaves those alone, and the
    // note is not stale news while its prose self-references, of any block,
    // account for every line the index named it for. A note whose stem ends
    // in `.md` (`foo.md.md`) is never exempt: its `((#^id))` is filed under
    // another note's key (`foo`), so its self-reference lines were not
    // counted under this file's key and cannot be credited against what the
    // index named it for (issue 716).
    let old_key = crate::index::normalizer::normalize_file_path(old_path);
    let named_for_its_own_references = |path: &str, content: &str| {
        link_reads_back_as_the_file(&file_stem_from_path(path))
            && crate::index::normalizer::normalize_file_path(path) == old_key
            && named_lines
                .get(path)
                .is_some_and(|&lines| own_block_reference_lines(content, None) >= lines)
    };
    // A rename that keeps the stem — `old.md` → `old.txt`, or `Note.md` →
    // `note.md`, whose case the passes respell in every referrer — leaves no
    // referrer stale: none the index named is news. A path link it does
    // change (`[[a/old]]` → `[[a/old.txt]]`, issue 619) is rewritten, not
    // left unchanged.
    let stem_unchanged = crate::index::normalizer::normalize_file_path(new_path) == old_key;

    // The note is dropped under what the old path resolved to before the
    // move (`Source::identity`) and filed under what the new path resolves
    // to AFTER it (below).
    let remove_old = Mutation::Remove {
        path: source.identity.clone(),
    };

    // The file's own content, read BEFORE it moves: it is what the index will
    // hold under the new path. Unreadable here means nothing has changed yet,
    // so this is an honest `Err` (not a file that vanishes from the index).
    let renamed_content = tokio::fs::read_to_string(old_path)
        .await
        .map_err(|e| format!("{old_path} could not be read: {e}"))?;

    // `fs::rename` replaces an existing destination on Unix; a rename is not a
    // way to overwrite another note. Checked here, after every index build and
    // referrer read above, right before the move. The one entry the
    // destination may already name is the source's own directory entry
    // (`another_entry_at`), judged without following either last component.
    if another_entry_at(old_path, new_path) {
        return Err(format!("{new_path} already exists"));
    }

    // 2. Rename the actual file — the one step that can still fail. It comes
    //    BEFORE the reference rewrites so that an `Err` from this command
    //    always means nothing was changed; the frontend treats it that way.
    crate::fs::rename_file(old_path, new_path)
        .await
        .map_err(|e| e.to_string())?;

    // 3. Read and update each referring file (async I/O, outside lock). The
    //    file has moved, so a failure here is never a failed rename: the
    //    referrer is skipped and REPORTED (issue 594) — its links still spell
    //    the old name, and only the user can do something about that.
    //    A referrer the index named in which no reference to the old name is
    //    found any more is REPORTED (issue 668), as for a block ID rename; a
    //    same-stem note named for its own references is not.
    let unchanged = if stem_unchanged {
        Unchanged::Ignore
    } else {
        Unchanged::Report {
            unless: &named_for_its_own_references,
        }
    };
    let passes = LinkPasses::new(RenameTarget {
        old_path,
        new_path,
        local_aliases: &local_aliases,
        known_paths,
        windows: cfg!(windows),
    });
    let mut rewritten = rewrite_referrers(
        &referring_files,
        old_path,
        ctx_mgr,
        &scope.dirs,
        &unchanged,
        |content, ref_path, covering| passes.rewrite(content, ref_path, &keys_of(covering)),
    )
    .await;
    //    Then the renamed note itself, which rewrite_referrers skips. Its
    //    destination passes the gate every referrer passes right before it is
    //    written: resolved again NOW — after the move and every referrer
    //    write, not before them — it must still lie inside the file's
    //    contexts. It is stale news on a referrer's terms: the index named it
    //    under the old key for more than its own `((#^id))` references.
    //    Every owning root covers the renamed note, so its references are
    //    judged under all of them.
    let renamed_content = rewrite_renamed_note(
        new_path,
        renamed_content,
        |content, ref_path| passes.rewrite(content, ref_path, &scope.keys),
        || confined_both_ways(new_path, &scope.dirs, source.parent.as_deref()),
        |content| {
            matches!(unchanged, Unchanged::Report { .. })
                && named_lines.contains_key(old_path)
                && !named_for_its_own_references(old_path, content)
        },
        &mut rewritten,
    )
    .await;

    // 4. Update every containing index: drop the old entry, re-index the
    //    referring files from the content we already have — each into the
    //    indexes that cover it — then the renamed file. Each index spells the
    //    paths its own way (Mutation::apply_to).
    //    The renamed note is filed under what its new path resolves to now,
    //    after the move and its own rewrite — the identity a save would file
    //    it under (see `remove_old`). A note that no longer resolves (a link
    //    whose target went since) is not filed. Reading it after the note's
    //    own rewrite, not right after the move, matters only when that write
    //    turns a symlinked note into a regular file (the atomic-write
    //    followup): the note is then its own path.
    let new_identity = std::fs::canonicalize(new_path).ok();
    let mut per_key: HashMap<String, Vec<Mutation>> = HashMap::new();
    push_for_keys(&mut per_key, &scope.keys, &remove_old);
    queue_rewritten(&mut per_key, ctx_mgr, &scope.keys, rewritten.contents).await;
    if let Some(path) = new_identity {
        push_for_keys(
            &mut per_key,
            &scope.keys,
            &Mutation::Update {
                path,
                content: renamed_content,
            },
        );
    }
    apply_queued(state, per_key).await;

    Ok(RenameResult {
        updated_files: rewritten.updated,
        skipped_files: rewritten.skipped,
    })
}
