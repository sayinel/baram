//! §33 File rename with link updates — see rename/mod.rs for the shared helpers.

use crate::context::manager::{resolve_canonical, Registered};
use crate::context::ContextManager;
use crate::index::{
    block_reference_can_spell, block_references_to, index_reads_the_rename_back,
    own_block_reference_lines, replace_block_reference_target, replace_wikilink_target,
    wikilink_can_spell, wikilinks_to, RewritePass,
};
use std::collections::HashMap;
use std::path::Path;

use super::super::build::{ensure_indexes, read_indexes};
use super::super::keys::{buildable, keys_of, owning_contexts};
use super::super::state::{LinkIndexState, Mutation};
use super::referrers::{
    apply_queued, named_referrers, queue_rewritten, rewrite_referrers, Rewrite, Rewritten,
    Unchanged,
};
use super::{confined_by, push_for_keys, RenameResult};

pub(crate) async fn rename_file_with_links_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    old_path: &str,
    new_path: &str,
) -> Result<RenameResult, String> {
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
    // The destination stays inside the file's contexts (`destination_confined`).
    // A rename that would carry the file out of every context is refused
    // before anything is written (fs_cmd's rename validates both ends the
    // same way).
    let old_identity = resolve_canonical(old_path)?;
    let renamed_identity = resolve_canonical(new_path)?;
    let old_parent = old_identity.parent().map(Path::to_path_buf);
    if !destination_confined(&renamed_identity, &dirs, old_parent.as_deref()) {
        return Err(format!("{new_path} is outside the contexts of {old_path}"));
    }
    // `fs::rename` replaces an existing destination on Unix; a rename is not a
    // way to overwrite another note.
    if Path::new(new_path).exists() {
        return Err(format!("{new_path} already exists"));
    }
    let old_target = stem_of(old_path).ok_or("Invalid old path")?;
    let new_target = stem_of(new_path).ok_or("Invalid new path")?;

    // 1. Get referencing files from every containing index (inside lock, quick
    //    reads) — a reference from outside a nested root is known only to the
    //    enclosing index. An index gone since the gate is a refusal.
    //    issue 678: with the lines each file was named for (dedup across
    //    indexes), for the same-stem exemption below — as the block ID
    //    rename keeps them (issue 668). The files are what the rewrite visits.
    let (named_lines, referring_files) =
        named_referrers(read_indexes(state, &dirs, |i| i.referring_lines_to(&old_target)).await?);
    // A same-stem note elsewhere (`b/old.md` beside `a/old.md`) is named by
    // the index for its own `((#^id))` references, filed under its stem —
    // the old name's key. The rewrite rightly leaves those alone, and the
    // note is not stale news while its prose self-references, of any block,
    // account for every line the index named it for.
    let old_key = crate::index::normalizer::normalize_file_path(old_path);
    let named_for_its_own_references = |path: &str, content: &str| {
        crate::index::normalizer::normalize_file_path(path) == old_key
            && named_lines
                .get(path)
                .is_some_and(|&lines| own_block_reference_lines(content, None) >= lines)
    };
    // A rename that keeps the stem — `old.md` → `old.txt`, or `Note.md` →
    // `note.md`, whose case the passes respell in every referrer — leaves no
    // referrer stale: none the index named is news.
    let stem_unchanged = crate::index::normalizer::normalize_file_path(new_path) == old_key;

    // The canonical identity of the file being renamed, resolved before it
    // moves (the new path does not exist yet: resolve_canonical builds it on
    // its existing parent).
    let remove_old = Mutation::Remove { path: old_identity };

    // The file's own content, read BEFORE it moves: it is what the index will
    // hold under the new path. Unreadable here means nothing has changed yet,
    // so this is an honest `Err` (not a file that vanishes from the index).
    let renamed_content = tokio::fs::read_to_string(old_path)
        .await
        .map_err(|e| format!("{old_path} could not be read: {e}"))?;

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
    let passes = LinkPasses::new(&old_target, &new_target);
    let rewrite = |content: &str, ref_path: &str| passes.rewrite(content, ref_path);
    let mut rewritten =
        rewrite_referrers(&referring_files, old_path, &dirs, &unchanged, &rewrite).await;
    //    Then the renamed note itself, which rewrite_referrers skips. Its
    //    destination passes the gate every referrer passes right before it is
    //    written: resolved again NOW — after the move and every referrer
    //    write, not before them — it must still lie inside the file's
    //    contexts. It is stale news on a referrer's terms: the index named it
    //    under the old key for more than its own `((#^id))` references.
    let renamed_content = rewrite_renamed_note(
        new_path,
        renamed_content,
        &rewrite,
        || {
            resolve_canonical(new_path)
                .is_ok_and(|identity| destination_confined(&identity, &dirs, old_parent.as_deref()))
        },
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
    let mut per_key: HashMap<String, Vec<Mutation>> = HashMap::new();
    push_for_keys(&mut per_key, &keys, &remove_old);
    queue_rewritten(&mut per_key, ctx_mgr, &keys, rewritten.contents).await;
    push_for_keys(
        &mut per_key,
        &keys,
        &Mutation::Update {
            path: renamed_identity,
            content: renamed_content,
        },
    );
    apply_queued(state, per_key).await;

    Ok(RenameResult {
        updated_files: rewritten.updated,
        skipped_files: rewritten.skipped,
    })
}

fn stem_of(path: &str) -> Option<String> {
    Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
}

/// Whether a renamed file's destination stays inside the file's contexts:
/// under one of its directory contexts, or — for a file opened on its own
/// (§89, no directory context) — in the directory the file was in.
fn destination_confined(identity: &Path, dirs: &[Registered], old_parent: Option<&Path>) -> bool {
    if dirs.is_empty() {
        identity.parent() == old_parent
    } else {
        confined_by(identity, dirs)
    }
}

/// The two link passes of a file rename (issue 678), judged apart. A new stem
/// a link cannot spell is not written into one (`wikilink_can_spell`,
/// `block_reference_can_spell`: `[[a^b]]` names the note `a`, `((a^b#^id))`
/// is fine; `((a)b#^id))` parses as nothing, `[[a)b]]` is fine). The links
/// the stem can be spelled in are rewritten; the others stay, and every file
/// they stay in is reported, rewritten or not (`Rewrite::left_behind`). What
/// the passes wrote is then read back with the index's reader before it is
/// handed over (`index_reads_the_rename_back`): a stem the predicates pass
/// can still turn a link literal where it lands — a backtick pairing with
/// one on the line — and such a file is left as it was, and reported.
struct LinkPasses<'a> {
    old_target: &'a str,
    new_target: &'a str,
    wikilinks_spellable: bool,
    block_references_spellable: bool,
}

impl<'a> LinkPasses<'a> {
    fn new(old_target: &'a str, new_target: &'a str) -> Self {
        Self {
            old_target,
            new_target,
            wikilinks_spellable: wikilink_can_spell(new_target),
            block_references_spellable: block_reference_can_spell(new_target),
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
    fn rewrite(&self, content: &str, ref_path: &str) -> Rewrite {
        let before = content;
        let mut left_behind = false;
        let content = if self.wikilinks_spellable {
            replace_wikilink_target(content, self.old_target, self.new_target)
        } else {
            left_behind |= wikilinks_to(content, self.old_target) > 0;
            content.to_owned()
        };
        let content = if self.block_references_spellable {
            replace_block_reference_target(&content, ref_path, self.old_target, self.new_target)
        } else {
            left_behind |= block_references_to(&content, ref_path, self.old_target) > 0;
            content
        };
        // READ-BACK GATE (issue 678, review): what was written must be read
        // as a link to the new name where it stands, or it is not written.
        if content != before
            && !index_reads_the_rename_back(
                ref_path,
                before,
                &content,
                self.old_target,
                self.new_target,
                |kind| self.spellable(kind.pass()),
            )
        {
            log::warn!(
                "rename: {ref_path} would not read back as linking to the new name where its links stand; they are left as they are"
            );
            return Rewrite {
                content: before.to_owned(),
                left_behind: true,
            };
        }
        Rewrite {
            content,
            left_behind,
        }
    }
}

/// The renamed note itself, which rewrite_referrers skips: it may spell its
/// own name — `((old#^b1))` pasted from another note, `[[old]]` — and under
/// the new name those would dangle. The passes run on it under the new path,
/// so `((#^id))`, which names no target, resolves to the new stem and stays.
/// What they change is written where the file is now — if `still_confined`
/// says the destination still is where it may be — and the note joins
/// `updated`, so an open tab follows the disk. It joins `skipped` on the same
/// terms as a referrer: a reference left behind, a write refused or failed,
/// or nothing to change although the index named it for more
/// (`named_for_more`). Returns the content the file holds now, for the index.
async fn rewrite_renamed_note(
    new_path: &str,
    content: String,
    rewrite: impl Fn(&str, &str) -> Rewrite,
    still_confined: impl Fn() -> bool,
    named_for_more: impl Fn(&str) -> bool,
    rewritten: &mut Rewritten,
) -> String {
    let Rewrite {
        content: own_rewritten,
        left_behind,
    } = rewrite(&content, new_path);
    let (content, stale) = if own_rewritten == content {
        let named_for_more = named_for_more(&content);
        (content, left_behind || named_for_more)
    } else if !still_confined() {
        // The note is still indexed under the identity resolved before the
        // move, and rightly: `fs::rename` moved it to the literal `new_path`,
        // so that is where it is. What this branch refuses is WRITING to a
        // destination that no longer resolves inside the contexts — unlike a
        // referrer, which was never moved and whose stale resolution would
        // make the index describe a file the rename never touched.
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
