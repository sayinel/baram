//! The referrer rewrite the renames share — see rename/mod.rs.

use crate::context::manager::{resolve_canonical, Registered};
use crate::context::ContextManager;
use std::collections::HashMap;
use std::path::PathBuf;

use super::super::state::{LinkIndexState, Mutation};
use super::{confined_by, keys_covering, push_for_keys};

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

/// Queue each rewritten referrer, with the content it holds now, into the
/// indexes that cover it — each spelled that index's way (Mutation::apply_to).
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
pub(super) struct Rewritten {
    pub(super) updated: Vec<String>,
    pub(super) skipped: Vec<String>,
    /// ‼️ Not parallel to `updated`: a caller may add a file to `updated`
    /// and queue that file's `Mutation` itself instead of putting it here.
    /// The file rename does, for the renamed note — its `Mutation` carries
    /// the identity resolved before the move, which only the caller holds.
    /// Adding it here "for symmetry" queues a second `Update` for that path;
    /// the two are identical, so nothing fails and no test catches it.
    pub(super) contents: Vec<(PathBuf, String)>,
}

/// What `rewrite` made of one referrer: the content to write, and whether it
/// left a reference to the old name in it on purpose — a file rename does,
/// for the links (wikilinks, block references) that cannot spell the new
/// stem. Such a file is reported whether or not anything else in it changed.
pub(super) struct Rewrite {
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
    /// Not news: the rewrite could not have changed anything (a file rename
    /// that keeps the stem, issue 678).
    Ignore,
}

/// Rewrite every referring file with `rewrite`, skipping `own_path` (the file
/// whose links are being renamed — a file rename has moved it by now and
/// rewrites its content itself; a block ID rename leaves it to the editor's
/// buffer). A referrer that cannot be read, resolves outside `dirs`, or cannot
/// be written is reported in `skipped`; nothing here fails the rename, because
/// the caller is past its point of no return.
pub(super) async fn rewrite_referrers(
    referring_files: &[String],
    own_path: &str,
    dirs: &[Registered],
    unchanged: &Unchanged<'_>,
    rewrite: impl Fn(&str, &str) -> Rewrite,
) -> Rewritten {
    let mut result = Rewritten {
        updated: Vec::new(),
        skipped: Vec::new(),
        contents: Vec::new(),
    };
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
        let Rewrite {
            content: new_content,
            left_behind,
        } = rewrite(&content, ref_path);
        if new_content == content {
            if left_behind {
                log::warn!(
                    "rename: {ref_path} holds links that cannot spell the new name; they are left as they are"
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
                "rename: {ref_path} was rewritten, but some of its links cannot spell the new name and are left as they are"
            );
            result.skipped.push(ref_path.clone());
        }
        result.contents.push((identity, new_content));
    }
    result
}
