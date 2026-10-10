//! §33 File rename with link updates — preparation in rename/scope.rs, destination checks in
//! rename/destination.rs, link passes in rename/passes.rs, the referrer rewrite in
//! rename/referrers.rs, result types and path helpers in rename/mod.rs.

use crate::context::ContextManager;
use crate::index::{keys_for, normalize_file_path, reads_a_link_under, RenameTarget};
use std::collections::HashMap;

use super::super::keys::{keys_of, local_aliases_of, OwnAliases};
use super::super::mutation::Mutation;
use super::super::state::LinkIndexState;
use super::destination::{another_entry_at, check_destination, confined_both_ways};
use super::passes::{rewrite_renamed_note, LinkPasses};
use super::referrers::{
    apply_queued, named_only_for_own_references, queue_rewritten, rewrite_referrers, Unchanged,
};
use super::scope::{Referrers, RenameScope};
use super::{plain_absolute, push_for_keys, RenameResult};

pub(crate) async fn rename_file_with_links_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    old_path: &str,
    new_path: &str,
) -> Result<RenameResult, String> {
    plain_absolute(old_path)?;
    plain_absolute(new_path)?;
    // The contexts and their indexes first (`RenameScope::holding`).
    let scope = RenameScope::holding(state, ctx_mgr, old_path).await?;
    // issue 717: a link behind one of the file's own vault aliases names it
    // (§87); one behind any other alias names another vault's note and stays.
    // A name of the file's vault that another vault carries too (`ambiguous`)
    // may mean either: its links are left, and their files reported (below).
    let OwnAliases {
        local: local_aliases,
        ambiguous,
    } = local_aliases_of(ctx_mgr, &scope.dirs).await;
    let named_by: Vec<_> = local_aliases.iter().chain(&ambiguous).cloned().collect();
    // Both ends inside the file's contexts, and no move (`check_destination`).
    let source = check_destination(old_path, new_path, &scope.dirs)?;

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
        holding_keys,
    } = scope
        .referrers(state, ctx_mgr, old_path, Some(new_path), |i| {
            i.referring_lines_to(old_path, &named_by)
        })
        .await?;
    // The keys a link behind an ambiguous own name is filed under that name
    // the old note and not the new one — `[[notes::old]]` for `old.md` →
    // `new.md`, not for `old.md` → `old.txt`, whose stem the link still
    // reads as. Set differences, so no key is told apart by its variant. A
    // file whose links the passes leave holding one is reported, rewritten
    // or not (`left_behind`), as for an ambiguous path link. `plain` takes
    // out the stem key, under which a same-stem note's own `((#^id))` is
    // filed — what fails this: dropping `!plain.contains(k)`, and the two
    // same-stem exemption tests in `tests/same_stem.rs` report that note.
    let windows = cfg!(windows);
    let behind_ambiguous_name = {
        let plain = keys_for(old_path, None, &local_aliases, windows);
        let still_named = keys_for(new_path, None, &ambiguous, windows);
        let mut keys = keys_for(old_path, None, &ambiguous, windows);
        keys.retain(|k| !plain.contains(k) && !still_named.contains(k));
        keys
    };
    // The same-stem exemption (`named_only_for_own_references`), with the
    // stem compared to the old key: a referrer is exempt only under the name
    // being renamed away.
    let old_key = normalize_file_path(old_path);
    let named_for_its_own_references = |path: &str, content: &str| {
        named_only_for_own_references(path, content, &named_lines, None, |p| {
            normalize_file_path(p) == old_key
        })
    };
    // A rename that keeps the stem — `old.md` → `old.txt`, or `Note.md` →
    // `note.md`, whose case the passes respell in every referrer — leaves no
    // referrer stale: none the index named is news. A path link it does
    // change (`[[a/old]]` → `[[a/old.txt]]`, issue 619) is rewritten, not
    // left unchanged.
    let stem_unchanged = normalize_file_path(new_path) == old_key;

    // The note is dropped under what the old path resolved to before the
    // move (`RenameSource::identity`) and filed under what the new path
    // resolves to AFTER it (below).
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
    match another_entry_at(old_path, new_path) {
        Ok(false) => {}
        Ok(true) => return Err(format!("{new_path} already exists")),
        Err(e) => return Err(format!("{new_path} could not be checked: {e}")),
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
        windows,
    });
    let rewrite = |content: &str, ref_path: &str, roots: &[String]| {
        let mut rewrite = passes.rewrite(content, ref_path, roots);
        rewrite.left_behind |=
            reads_a_link_under(ref_path, &rewrite.content, &behind_ambiguous_name, windows);
        rewrite
    };
    let mut rewritten = rewrite_referrers(
        &referring_files,
        old_path,
        ctx_mgr,
        &scope.dirs,
        &unchanged,
        |content, ref_path, covering| rewrite(content, ref_path, &keys_of(covering)),
    )
    .await;
    //    Judge the renamed note's references under the owning roots. A standalone File
    //    context (§89) has none, so use the note's own folder as spelled:
    //    bare keys do not depend on a root, and relative links resolve from
    //    the referrer's folder. No enclosing vault root is inferred.
    let own_roots: Vec<String> = if scope.keys.is_empty() {
        own_folder(old_path).into_iter().collect()
    } else {
        scope.keys.clone()
    };
    //    Then the renamed note itself, which rewrite_referrers skips. Its
    //    destination passes the gate every referrer passes right before it is
    //    written: resolved again NOW — after the move and every referrer
    //    write, not before them — it must still lie inside the file's
    //    contexts. It is stale news on a referrer's terms: the index named it
    //    under the old key for more than its own `((#^id))` references.
    let renamed_content = rewrite_renamed_note(
        new_path,
        renamed_content,
        |content, ref_path| rewrite(content, ref_path, &own_roots),
        || confined_both_ways(new_path, &scope.dirs, source.parent.as_deref()),
        |content| {
            matches!(unchanged, Unchanged::Report { .. })
                && named_lines.contains_key(old_path)
                && !named_for_its_own_references(old_path, content)
        },
        &mut rewritten,
    )
    .await;

    // 4. Drop the old entry and add the renamed note in its owning indexes.
    //    Re-index rewritten referrers from the content we already have in
    //    the holding indexes that cover each one, including indexes built
    //    for the judgement. Each index spells paths its own way (Mutation::apply_to).
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
    queue_rewritten(&mut per_key, ctx_mgr, &holding_keys, rewritten.contents).await;
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

/// The folder `path` is in, as spelled — not resolved.
fn own_folder(path: &str) -> Option<String> {
    std::path::Path::new(path)
        .parent()?
        .to_str()
        .map(str::to_string)
}
