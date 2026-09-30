//! §33 File rename with link updates — see rename/mod.rs for the shared helpers.

use crate::context::manager::resolve_canonical;
use crate::context::ContextManager;
use crate::index::{link_reads_back_as_the_file, own_block_reference_lines, RenameTarget};
use std::collections::HashMap;
use std::path::Path;

use super::super::build::{ensure_indexes, read_indexes};
use super::super::keys::{buildable, keys_of, local_aliases_of, owning_contexts};
use super::super::state::{LinkIndexState, Mutation};
use super::destination::{
    another_entry_at, confined_both_ways, entry_confined, stays_in_its_directory, stem_of,
};
use super::passes::{rewrite_renamed_note, LinkPasses};
use super::referrers::{
    apply_queued, named_referrers, queue_rewritten, rewrite_referrers, Unchanged,
};
use super::{absolute, holding_contexts, known_paths_of, push_for_keys, RenameResult};

pub(crate) async fn rename_file_with_links_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    old_path: &str,
    new_path: &str,
) -> Result<RenameResult, String> {
    absolute(old_path)?;
    absolute(new_path)?;
    // The contexts and their indexes first: nothing is renamed without them.
    // No context at all is a refusal (nothing is known about references); a
    // standalone File context (§89) has no directory index and no other file
    // to update, so the file is simply renamed.
    let contexts = owning_contexts(ctx_mgr, old_path).await;
    if contexts.is_empty() {
        return Err(format!("{old_path} is not inside any registered context"));
    }
    ensure_indexes(state, ctx_mgr, &contexts).await?;
    let dirs = buildable(&contexts);
    let keys = keys_of(&dirs);
    // issue 717: a link behind one of the file's own vault aliases names it
    // (§87); one behind any other alias names another vault's note and stays.
    let local_aliases = local_aliases_of(ctx_mgr, &dirs).await;
    // Both ends stay inside the file's contexts. The old path is judged by
    // its directory entry (`entry_confined`): what it resolves to is inside
    // already, since `owning_contexts` found the contexts by that very path.
    // The new path is judged in both views (`confined_both_ways`), what it
    // resolves to and the entry itself. A rename that would carry the file
    // out of every context, or that acts on an entry outside them — a
    // symlink outside the vault pointing into it — is refused before
    // anything is written (fs_cmd's rename validates both ends the same way).
    let old_identity = resolve_canonical(old_path)?;
    let old_parent = old_identity.parent().map(Path::to_path_buf);
    if !entry_confined(old_path, &dirs, old_parent.as_deref()) {
        return Err(format!("{old_path} is outside the contexts that hold it"));
    }
    if !confined_both_ways(new_path, &dirs, old_parent.as_deref()) {
        return Err(format!("{new_path} is outside the contexts of {old_path}"));
    }
    // issue 619: a rename keeps the note in its directory. A path-qualified
    // or relative reference names the note by where it is, and a move would
    // need every one of them respelled for a new folder — and the note's own
    // relative links for the new place it reads them from — which is not
    // what this command rewrites. Refused before anything is written. The
    // parents are compared as spelled, not as resolved: the respelling
    // writes `new_path`'s components into links, so `a/../a/new.md`, whose
    // parent resolves to `a`, would write `[[a/../a/new]]`, a link to no
    // note. Both paths are absolute (`absolute` above), so a relative
    // spelling cannot pass as the same parent either.
    if !stays_in_its_directory(old_path, new_path, cfg!(windows)) {
        return Err(format!(
            "{new_path} would move the note out of its directory; a rename keeps the note where it is"
        ));
    }
    stem_of(old_path).ok_or("Invalid old path")?;
    stem_of(new_path).ok_or("Invalid new path")?;

    // 1. Get referencing files from every containing index (inside lock, quick
    //    reads) — a reference from outside a nested root is known only to the
    //    enclosing index. An index gone since the gate is a refusal.
    //    issue 678: with the lines each file was named for (dedup across
    //    indexes), for the same-stem exemption below — as the block ID
    //    rename keeps them (issue 668). The files are what the rewrite visits.
    let (named_lines, referring_files) = named_referrers(
        read_indexes(state, &dirs, |_ctx, i| {
            i.referring_lines_to(old_path, &local_aliases)
        })
        .await?,
    );
    // The notes of every vault that holds the file or a referrer, each
    // index built first, read before the move: a path link that another root
    // holding the referrer reads as a different existing note — or might,
    // when its index could not be built — is left and its file reported
    // (`RenameTarget::judge`).
    let holding = holding_contexts(state, ctx_mgr, &dirs, &referring_files).await;
    let known_paths = known_paths_of(state, &holding).await;
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
        let file_stem = Path::new(path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        link_reads_back_as_the_file(&file_stem)
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

    // The index knows a note by what its path resolves to: the build never
    // indexes a symlink entry (`collect_md_files` does not follow one) and a
    // save files under the resolved path (`Mutation::update`). The rename
    // does the same — it drops what the old path resolved to before the move
    // and files the note under what the new path resolves to AFTER it
    // (below). For a plain note that is the new path; after a case-only
    // rename on a file system that folds case, the new spelling on disk; for
    // a symlinked note, its target, which the index already held.
    let remove_old = Mutation::Remove {
        path: old_identity.clone(),
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
        &dirs,
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
        |content, ref_path| passes.rewrite(content, ref_path, &keys),
        || confined_both_ways(new_path, &dirs, old_parent.as_deref()),
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
    push_for_keys(&mut per_key, &keys, &remove_old);
    queue_rewritten(&mut per_key, ctx_mgr, &keys, rewritten.contents).await;
    if let Some(path) = new_identity {
        push_for_keys(
            &mut per_key,
            &keys,
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
