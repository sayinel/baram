//! The referrer rewrite the renames share — see rename/mod.rs.
//!
//! What a rename can promise (#824): it fixes every referrer the index knows when it
//! judges, and every app write that returned before the rename started is in the index
//! by then (`commit::committed`). A file another program writes at the same time, or one
//! whose watcher event the applier has not taken yet (`applier`), can be missed. When the
//! rewrite finds a named referrer whose lines no longer say what the index read (the
//! "index was stale" branch below), that file goes to `skipped_files`; one the index
//! never named is not seen at all.

use crate::context::manager::{resolve_canonical, Registered};
use crate::context::ContextManager;
use crate::index::{file_stem_from_path, link_reads_back_as_the_file, own_block_reference_lines};
use std::collections::HashMap;
use std::path::PathBuf;

use super::super::keys::keys_of;
use super::super::state::{LinkIndexState, Mutation};
use super::{confined_by, contexts_covering, keys_covering, push_for_keys};

/// What an index query named — `(file, line)`, possibly from several
/// containing indexes, so deduplicated — as how many lines each file was
/// named for, and the files in order. The files are what the rewrite visits;
/// the counts are what the same-stem exemption weighs (issue 668).
pub(super) fn named_referrers(
    mut named: Vec<(String, u32)>,
) -> (HashMap<String, usize>, Vec<String>) {
    named.sort();
    named.dedup();
    let mut named_lines: HashMap<String, usize> = HashMap::new();
    for (source, _) in &named {
        *named_lines.entry(source.clone()).or_default() += 1;
    }
    let mut referring_files: Vec<String> = named_lines.keys().cloned().collect();
    referring_files.sort();
    (named_lines, referring_files)
}

/// Whether `path`, a referrer the index named for `named_lines[path]` lines,
/// is named only for its own `((#^id))` references — the same-stem
/// exemption both renames weigh a referrer the rewrite left unchanged by. A
/// same-stem note elsewhere (`b/old.md` beside `a/old.md`) is named by the
/// index for its own `((#^id))` references, filed under its stem — the
/// target's key. The rewrite rightly leaves those alone, and the note
/// is not stale news while it holds at least as many own-reference lines as
/// the index named it for (`own_id` narrows them to one block for the block
/// ID rename; `None` counts every block). The stem alone is not why the
/// index named it: a same-stem note whose reference to the target has gone
/// since, self-reference beside it or not, holds fewer, and is stale like
/// any other. `stem_is_target` says whether the referrer's stem is one the
/// rename queried; it differs between the two renames on purpose — the file
/// rename compares with the old key, the block ID rename with the target's
/// keys, zettel id included. A note whose stem ends in `.md` (`foo.md.md`)
/// is never exempt: its `((#^id))` is filed under another note's key
/// (`foo`), so its self-reference lines were not counted under this file's
/// key and cannot be credited against what the index named it for (issue
/// 716).
pub(super) fn named_only_for_own_references(
    path: &str,
    content: &str,
    named_lines: &HashMap<String, usize>,
    own_id: Option<&str>,
    stem_is_target: impl Fn(&str) -> bool,
) -> bool {
    link_reads_back_as_the_file(&file_stem_from_path(path))
        && stem_is_target(path)
        && named_lines
            .get(path)
            .is_some_and(|&lines| own_block_reference_lines(content, own_id) >= lines)
}

/// Queue each rewritten referrer, with the content it holds now, into the
/// indexes among `keys` that cover it (`keys_covering`), each spelled that
/// index's way (Mutation::apply_to). Both renames pass `Referrers::holding_keys`,
/// including contexts whose indexes were built for the judgement.
pub(super) async fn queue_rewritten(
    per_key: &mut HashMap<String, Vec<Mutation>>,
    ctx_mgr: &ContextManager,
    keys: &[String],
    contents: Vec<(PathBuf, String)>,
) {
    for (identity, content) in contents {
        let covering = keys_covering(ctx_mgr, keys, &identity.to_string_lossy()).await;
        push_for_keys(
            per_key,
            &covering,
            &Mutation::Update {
                path: identity,
                content,
            },
        );
    }
}

pub(super) async fn apply_queued(state: &LinkIndexState, per_key: HashMap<String, Vec<Mutation>>) {
    for (key, list) in per_key {
        state.apply(&key, list).await;
    }
}

/// What rewriting a set of referring files produced: the files rewritten (and
/// their new content, for the index), and the files that could not be.
pub(super) struct RewriteBatch {
    pub(super) updated: Vec<String>,
    pub(super) skipped: Vec<String>,
    /// ‼️ Not parallel to `updated`: a caller may add a file to `updated`
    /// and queue that file's `Mutation` itself instead of putting it here.
    /// The file rename does, for the renamed note — its `Mutation` carries
    /// what the new path resolves to after the move, which only the caller
    /// resolves.
    /// Adding it here "for symmetry" queues a second `Update` for that path.
    /// Both carry the same content, so applying them leaves the index as one
    /// would — which is why the mistake would not announce itself.
    pub(super) contents: Vec<(PathBuf, String)>,
}

/// What `rewrite` made of one referrer: the content to write, and whether it
/// left a reference to the old name in it on purpose — a file rename does,
/// for the links (wikilinks, block references) that cannot spell the new
/// stem, for a file whose rewritten links the index would not read back
/// where they stand (`index_reads_the_rename_back`), and for a path link
/// another root reads as a different existing note (`Judgement::Ambiguous`);
/// a block-ID rename does for that last case. Such a file is reported
/// whether or not anything else in it changed.
pub(super) struct ReferrerRewrite {
    pub(super) content: String,
    pub(super) left_behind: bool,
}

/// What to make of a referrer the index named whose content `rewrite` did not
/// change (issue 668).
pub(super) enum Unchanged<'a> {
    /// The index was stale — the reference moved or went — and the file still
    /// says the old name: report it in `skipped`, as any referrer whose links
    /// were not updated. `unless`, given the referrer's path and its content
    /// as read, names the referrers the index names for a reason the rewrite
    /// rightly ignores, which are no news.
    Report {
        unless: &'a (dyn Fn(&str, &str) -> bool + Sync),
    },
    /// Not news: a file rename that keeps the stem (issue 678). A referrer's
    /// bare links still name the file, so one the rewrite left unchanged is
    /// not stale; a path link the new extension changes (`a/old.md` →
    /// `a/old.txt`) is respelled and reaches `updated`, not this branch.
    Ignore,
}

/// Rewrite every referring file with `rewrite`, skipping `own_path` (the file
/// whose links are being renamed — a file rename has moved it by now and
/// rewrites its content itself; a block ID rename leaves it to the editor's
/// buffer). `rewrite` is given the referrer's content, its path, and the
/// contexts among `dirs` that cover it (`contexts_covering`) — the roots its
/// references are judged under. A referrer that cannot be read, that no
/// context among `dirs` covers (whatever `unchanged` says), that resolves
/// outside `dirs`, or that cannot be written is reported in `skipped`;
/// nothing here fails the rename, because the caller is past its point of
/// no return.
pub(super) async fn rewrite_referrers(
    referring_files: &[String],
    own_path: &str,
    ctx_mgr: &ContextManager,
    dirs: &[Registered],
    unchanged: &Unchanged<'_>,
    rewrite: impl Fn(&str, &str, &[Registered]) -> ReferrerRewrite,
) -> RewriteBatch {
    let mut result = RewriteBatch {
        updated: Vec::new(),
        skipped: Vec::new(),
        contents: Vec::new(),
    };
    let keys = keys_of(dirs);
    for ref_path in referring_files {
        if ref_path == own_path {
            continue;
        }
        let content = match tokio::fs::read_to_string(ref_path).await {
            Ok(c) => c,
            Err(e) => {
                log::warn!(
                    "rename: {ref_path} could not be read, its links are left as they are: {e}"
                );
                result.skipped.push(ref_path.clone());
                continue;
            }
        };
        let covering = contexts_covering(ctx_mgr, &keys, ref_path).await;
        // The index named this file, so it may hold a link to the old name,
        // but no registration among `dirs` covers it now — a context removed
        // mid-rename, or a path that resolves outside every registered root
        // (a symlink planted after the scan). The judgement reads links under
        // the covering roots and would see none here, so the file is reported
        // whatever `unchanged` says, never passed to `rewrite`.
        if covering.is_empty() {
            log::warn!(
                "rename: {ref_path} was named by the index but no registered context covers it now, its links are left as they are"
            );
            result.skipped.push(ref_path.clone());
            continue;
        }
        let ReferrerRewrite {
            content: new_content,
            left_behind,
        } = rewrite(&content, ref_path, &covering);
        if new_content == content {
            if left_behind {
                log::warn!(
                    "rename: {ref_path} holds links that cannot spell the new name, or that a vault holding the file may read as another note; they are left as they are"
                );
                result.skipped.push(ref_path.clone());
            } else if let Unchanged::Report { unless } = unchanged {
                if !unless(ref_path, &content) {
                    log::warn!(
                        "rename: {ref_path} was named by the index but holds no reference to rename now — the index was stale; its links are left as they are"
                    );
                    result.skipped.push(ref_path.clone());
                }
            }
            continue;
        }
        // A referrer the index names that cannot be resolved, or that now
        // resolves elsewhere (a symlink planted after the scan), is never
        // written — and the user hears that its links were not updated,
        // without being told why.
        let confined = resolve_canonical(ref_path)
            .map(|identity| confined_by(&identity, dirs).then_some(identity))
            .ok()
            .flatten();
        let Some(identity) = confined else {
            log::warn!("rename: {ref_path} does not resolve inside the file's contexts, its links are left as they are");
            result.skipped.push(ref_path.clone());
            continue;
        };
        // Atomic write (§3.6: tmp → rename)
        if let Err(e) = crate::fs::write_file(ref_path, &new_content).await {
            log::warn!(
                "rename: {ref_path} could not be rewritten, its links are left as they are: {e}"
            );
            result.skipped.push(ref_path.clone());
            continue;
        }
        result.updated.push(ref_path.clone());
        if left_behind {
            log::warn!(
                "rename: {ref_path} was rewritten, but some of its links cannot spell the new name, or a vault holding the file may read them as another note; they are left as they are"
            );
            result.skipped.push(ref_path.clone());
        }
        result.contents.push((identity, new_content));
    }
    result
}
