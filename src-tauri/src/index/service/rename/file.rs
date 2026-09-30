//! §33 File rename with link updates — see rename/mod.rs for the shared helpers.

use crate::context::manager::{resolve_canonical, Registered};
use crate::context::ContextManager;
use crate::index::relative_links::{path_components, same_component};
use crate::index::{
    block_reference_can_spell, index_reads_the_rename_back, link_reads_back_as_the_file,
    own_block_reference_lines, replace_block_reference_target, replace_wikilink_target,
    wikilink_can_spell, RenameTarget, RewritePass,
};
use std::collections::HashMap;
use std::path::Path;

use super::super::build::{ensure_indexes, read_indexes};
use super::super::keys::{buildable, keys_of, local_aliases_of, owning_contexts};
use super::super::state::{LinkIndexState, Mutation};
use super::referrers::{
    apply_queued, named_referrers, queue_rewritten, rewrite_referrers, Rewrite, Rewritten,
    Unchanged,
};
use super::{absolute, confined_by, holding_contexts, known_paths_of, push_for_keys, RenameResult};

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
    // Both ends stay inside the file's contexts, in both views
    // (`confined_both_ways`): what the path resolves to, and the directory
    // entry itself. A rename that would carry the file out of every context,
    // or that acts on an entry outside them — a symlink outside the vault
    // pointing into it — is refused before anything is written (fs_cmd's
    // rename validates both ends the same way).
    let old_identity = resolve_canonical(old_path)?;
    let old_parent = old_identity.parent().map(Path::to_path_buf);
    for path in [old_path, new_path] {
        if !confined_both_ways(path, &dirs, old_parent.as_deref()) {
            return Err(format!("{path} is outside the contexts of {old_path}"));
        }
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
    //    whose target went since) is not filed.
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

/// The directory entry `path` names: its parent resolved canonically, joined
/// with its own file name as spelled, the last component not followed. Used
/// for the boundary only (`confined_both_ways`) — the rename moves this
/// entry, so the entry must lie inside the contexts too. The index files a
/// note by what its path resolves to, not by this.
fn entry_path(path: &str) -> Result<std::path::PathBuf, String> {
    let path = Path::new(path);
    let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
        return Err(format!("{} names no file", path.display()));
    };
    Ok(resolve_canonical(&parent.to_string_lossy())?.join(name))
}

/// Whether `new_path` names a directory entry other than the one at
/// `old_path`. Judged by the entries, never by what they resolve to: neither
/// last component is followed. Following it would call a symlinked
/// `note.md -> x.md`, renamed to `x.md`, the "same" file, and `rename(2)`
/// would replace the real `x.md` with the link. Nothing at `new_path`, or
/// nothing `symlink_metadata` can read (as `Path::exists` reads it), is no
/// entry.
///
/// On Unix the destination is the source's own entry only when both are the
/// same inode on the same device (`symlink_metadata`, which reads a link
/// itself) AND the two names differ at most by ASCII case. That is a
/// case-only rename (`Note.md` → `note.md`) on a file system that folds
/// case, where both spellings reach the one entry. Only ASCII case counts:
/// `Élan.md` → `élan.md` on such a file system finds the destination, fails
/// the name comparison, and is refused. The same inode under a name that
/// differs by more than ASCII case is a hard link of the source, and a
/// rename between hard links is a silent no-op, so it is refused as another
/// entry. A hard link whose name differs from the source's only by ASCII
/// case, which a file system that keeps case allows, looks the same as a
/// case alias from these two reads, so it passes: the move is then a no-op,
/// the rename answers `Ok`, and links are respelled, with no content lost.
/// Telling the two apart would mean asking the file system whether it folds
/// case. Any other inode is another entry.
///
/// Elsewhere (Windows) there is no inode here to compare. The destination
/// counts as the source's entry when its canonical parent is the source's
/// and the names differ at most by ASCII case, since Windows folds case by
/// default. This is an approximation, and a hard link there is not told
/// apart from a case alias.
///
/// So a symlinked source renamed onto its target's name is refused, and a
/// symlinked source renamed to another spelling of its own name goes ahead.
/// A dangling symlink at the destination is an entry too and is refused,
/// where `Path::exists`, which follows the link, used to let the rename
/// replace it.
fn another_entry_at(old_path: &str, new_path: &str) -> bool {
    let Ok(new_meta) = std::fs::symlink_metadata(new_path) else {
        return false;
    };
    let names_differ_only_by_case = match (
        Path::new(old_path).file_name(),
        Path::new(new_path).file_name(),
    ) {
        (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
        _ => false,
    };
    !(names_differ_only_by_case && same_entry(old_path, new_path, &new_meta))
}

/// Whether the existing entry at `new_path` (`new_meta`, not followed) is the
/// entry at `old_path` — see `another_entry_at`.
#[cfg(unix)]
fn same_entry(old_path: &str, _new_path: &str, new_meta: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    std::fs::symlink_metadata(old_path)
        .is_ok_and(|old| old.dev() == new_meta.dev() && old.ino() == new_meta.ino())
}

/// Whether the existing entry at `new_path` is the entry at `old_path`,
/// approximated by canonical parents — see `another_entry_at`.
#[cfg(not(unix))]
fn same_entry(old_path: &str, new_path: &str, _new_meta: &std::fs::Metadata) -> bool {
    let parent = |p: &str| {
        Path::new(p)
            .parent()
            .and_then(|parent| std::fs::canonicalize(parent).ok())
    };
    parent(old_path).is_some_and(|old| parent(new_path) == Some(old))
}

/// Whether `new_path` names an entry in the directory `old_path` is in:
/// the same parent components, compared as `same_component` compares them
/// (ASCII case folded on Windows). Pure, so the Windows spelling is tested
/// with `windows = true` on any host.
fn stays_in_its_directory(old_path: &str, new_path: &str, windows: bool) -> bool {
    let parent = |path| {
        let mut components = path_components(path, windows);
        components.pop();
        components
    };
    let (old, new) = (parent(old_path), parent(new_path));
    old.len() == new.len()
        && old
            .iter()
            .zip(&new)
            .all(|(a, b)| same_component(a, b, windows))
}

fn stem_of(path: &str) -> Option<String> {
    Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
}

/// Whether `path` lies inside the file's contexts in both views: what it
/// resolves to (`resolve_canonical`, following a link) AND the directory
/// entry itself (`entry_path`). The rename acts on the entry — it moves it,
/// and `rewrite_renamed_note` writes through it — and reads what it
/// resolves to. Judging only the resolved file let `/outside/Link.md`, a
/// symlink outside every context pointing at `/v/x.md`, pass: a case-only
/// rename then moved the outside entry and the note's rewrite replaced the
/// link with a regular file outside the vault. Each view is judged by
/// `destination_confined`, so for a standalone File context (§89) both must
/// sit in the directory the file was in. No test fails without the resolved
/// view today: `owning_contexts` already requires the old path's resolved
/// file to be inside a context, and before the move the new path either does
/// not exist (both views are then the same path) or is the source's own
/// entry. It stays so that each end is judged by one rule, and so that the
/// check after the move refuses an entry whose target was changed since.
fn confined_both_ways(path: &str, dirs: &[Registered], old_parent: Option<&Path>) -> bool {
    let inside = |identity: &Path| destination_confined(identity, dirs, old_parent);
    resolve_canonical(path).is_ok_and(|identity| inside(&identity))
        && entry_path(path).is_ok_and(|entry| inside(&entry))
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

/// The two link passes of a file rename (issue 678), judged apart, over the
/// references `RenameTarget::refers` matches in a referrer under the roots
/// that cover it — by stem, by path under such a root, or relative to the
/// referrer's folder (issue 619). A new stem
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
    target: RenameTarget<'a>,
    wikilinks_spellable: bool,
    block_references_spellable: bool,
}

impl<'a> LinkPasses<'a> {
    fn new(target: RenameTarget<'a>) -> Self {
        Self {
            wikilinks_spellable: wikilink_can_spell(target.new_stem()),
            block_references_spellable: block_reference_can_spell(target.new_stem()),
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
    /// `covering_roots` are the roots whose index covers `ref_path`. Each
    /// pass reads the referrer once and counts, in that same visit, the
    /// references it matched and the ones it found ambiguous.
    fn rewrite(&self, content: &str, ref_path: &str, covering_roots: &[String]) -> Rewrite {
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
        // READ-BACK GATE (issue 678, review): what was written must be read
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
        // The note is still filed in the index, under what `new_path`
        // resolves to after the move, and rightly: `fs::rename` moved it to
        // the literal `new_path`, so that is where it is. What this branch
        // refuses is WRITING through an entry, or to a file, that no longer
        // lies inside the contexts (`confined_both_ways`) — unlike a
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

#[cfg(test)]
mod tests {
    use super::{stays_in_its_directory, LinkPasses};
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

    #[test]
    fn a_rename_that_would_move_the_note_is_refused_in_windows_spelling_too() {
        // What fails this: splitting on `/` alone — `C:\v\sub\note.md` is
        // then one component, the parents are both empty, and the move reads
        // as staying.
        assert!(!stays_in_its_directory(
            r"C:\v\note.md",
            r"C:\v\sub\other.md",
            true
        ));
        assert!(!stays_in_its_directory(
            r"C:\v\a\note.md",
            r"C:\v\b\note.md",
            true
        ));
        assert!(stays_in_its_directory(
            r"C:\V\a\note.md",
            r"c:\v\A\new.md",
            true
        ));
        assert!(stays_in_its_directory("/v/a/note.md", "/v/a/new.md", false));
        assert!(!stays_in_its_directory(
            "/v/a/note.md",
            "/v/A/new.md",
            false
        ));
    }
}
