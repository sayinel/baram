//! §33 What both renames prepare before anything is touched: the contexts that
//! hold the file with their indexes built, and — once the referrers are named —
//! what every root holding the file or a referrer knows of its notes.

use crate::context::manager::Registered;
use crate::context::ContextManager;
use crate::index::{root_places, KnownPaths, LinkIndex, RootNotes};
use std::collections::{HashMap, HashSet};

use super::super::build::{ensure_indexes, read_indexes};
use super::super::keys::{buildable, keys_of, owning_contexts};
use super::super::state::LinkIndexState;
use super::referrers::named_referrers;

/// The file's directory contexts, each index built (the rename's gate), and the
/// keys their indexes are read and written under.
pub(super) struct RenameScope {
    pub(super) dirs: Vec<Registered>,
    pub(super) keys: Vec<String>,
}

/// The referrers the indexes name, with how many lines each was named for
/// (`named_referrers`), and what every root holding the file or a referrer
/// knows of its notes (`known_paths_of` over `holding_contexts`).
pub(super) struct Referrers {
    pub(super) named_lines: HashMap<String, usize>,
    pub(super) files: Vec<String>,
    pub(super) known_paths: KnownPaths,
}

impl RenameScope {
    /// The contexts and their indexes first: nothing is renamed without them.
    /// `Err` when no registered context holds `path` (nothing is known about
    /// references) or an index cannot be built. A standalone File context
    /// (§89) has no directory index and no other file to update, so `dirs`
    /// and `keys` are empty; a file rename then simply renames the file, and
    /// a block ID rename finds no referrer to rewrite. `absolute` is the
    /// caller's check, made before this — the file rename checks both of its
    /// paths.
    pub(super) async fn holding(
        state: &LinkIndexState,
        ctx_mgr: &ContextManager,
        path: &str,
    ) -> Result<Self, String> {
        let contexts = owning_contexts(ctx_mgr, path).await;
        if contexts.is_empty() {
            return Err(format!("{path} is not inside any registered context"));
        }
        ensure_indexes(state, ctx_mgr, &contexts).await?;
        let dirs = buildable(&contexts);
        let keys = keys_of(&dirs);
        Ok(Self { dirs, keys })
    }

    /// `read` names, per index, the (referrer, line) pairs for the rename —
    /// `referring_lines_to` or `block_reference_lines`. Every containing index
    /// is read (inside the lock, quick reads): a reference from outside a
    /// nested root is known only to the enclosing index. An index gone since
    /// the gate is a refusal. The lines are deduplicated across indexes and
    /// counted per referrer, for the callers' same-stem exemptions; the files
    /// are what the rewrite visits.
    ///
    /// Then the notes of every vault that holds the file or a referrer, each
    /// index built first, read before anything moves: a path link that another
    /// root holding the referrer reads as a different existing note — or
    /// might, when its index could not be built — is left and its file
    /// reported (`RenameTarget::judge`, `BlockTarget::judge`).
    pub(super) async fn referrers(
        &self,
        state: &LinkIndexState,
        ctx_mgr: &ContextManager,
        read: impl Fn(&LinkIndex) -> Vec<(String, u32)>,
    ) -> Result<Referrers, String> {
        let (named_lines, files) = named_referrers(read_indexes(state, &self.dirs, read).await?);
        let (holding, unplaced) = holding_contexts(state, ctx_mgr, &self.dirs, &files).await;
        let mut known_paths = known_paths_of(state, &holding).await;
        known_paths.unplaced = unplaced;
        Ok(Referrers {
            named_lines,
            files,
            known_paths,
        })
    }
}

/// The directory contexts that hold the renamed file (`dirs`) or any of
/// `referrers` — the roots whose reading of a referrer's path link the rename
/// judgement consults — with each one's index built. `dirs` are built
/// already (the rename's gate); every other holding context is built here
/// the same way (`ensure_indexes`), since a vault registered but never opened
/// has no index and the judgement must not read that as "no note there". A
/// build that fails is logged and its root is left unbuilt, which
/// `known_paths_of` reports as `Unknown`.
///
/// Also the referrers one of their holding contexts cannot place as spelled
/// (`root_places`): it holds them as resolved, through a symlink, and the
/// judgement, which reads every root lexically, would skip it
/// (`KnownPaths::unplaced`).
async fn holding_contexts(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    dirs: &[Registered],
    referrers: &[String],
) -> (Vec<Registered>, HashSet<String>) {
    let mut holding: Vec<Registered> = dirs.to_vec();
    let mut unplaced = HashSet::new();
    for referrer in referrers {
        for c in buildable(&owning_contexts(ctx_mgr, referrer).await) {
            if !root_places(&c.info.path, referrer, cfg!(windows)) {
                unplaced.insert(referrer.clone());
            }
            if !holding.iter().any(|h| h.info.path == c.info.path) {
                holding.push(c);
            }
        }
    }
    for c in &holding[dirs.len()..] {
        if let Err(e) = ensure_indexes(state, ctx_mgr, std::slice::from_ref(c)).await {
            log::warn!(
                "rename: the index of {} could not be built ({e}); its path links are left as they are",
                c.info.path
            );
        }
    }
    (holding, unplaced)
}

/// What each of `holding` knows of its notes, by its root: `Known` with
/// `LinkIndex::registered_path_keys` when its index is built for that
/// registration, `Unknown` when it is not — a build that failed, or a
/// context removed since. An `Unknown` root never lets a path link through
/// (`judgement::read_as_another_note`) that another root's note would stop.
/// With one holding root there is no other root to read a link, so only the
/// keys its notes collide on are collected (`RootNotes::Sole`,
/// `LinkIndex::colliding_path_keys`) — under the index lock, which every
/// index read and save waits on, that is a key per same-named note instead
/// of a key per note.
async fn known_paths_of(state: &LinkIndexState, holding: &[Registered]) -> KnownPaths {
    let sole = holding.len() == 1;
    let mut known = KnownPaths::default();
    for c in holding {
        let notes = state
            .with_index_for(&c.info.path, c.incarnation, |idx| {
                idx.map(|idx| {
                    if sole {
                        RootNotes::Sole(idx.colliding_path_keys())
                    } else {
                        RootNotes::Known(idx.registered_path_keys())
                    }
                })
            })
            .await;
        known
            .roots
            .insert(c.info.path.clone(), notes.unwrap_or(RootNotes::Unknown));
    }
    known
}
