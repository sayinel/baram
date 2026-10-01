use crate::context::manager::{resolve_canonical, Registered};
use crate::context::ContextManager;
use crate::index::{IndexStats, LinkIndex};
use std::path::PathBuf;
use std::sync::atomic::Ordering;

use super::keys::buildable;
use super::state::{BuildToken, LinkIndexState};

/// What a rename says when an index it needs went away between the gate and
/// the read (its context was removed under the rename), or when the build the
/// gate started was invalidated the same way. The next attempt sees the new
/// registrations. Renaming without the index used to rename the file and
/// rewrite none of its references, silently.
const INDEX_NOT_READY: &str = "The link index for this vault is not ready. Try again in a moment.";

/// A refresh reports this as its error; a namespace rename that already moved
/// its files treats it as "the index will be somebody else's" (see
/// `committed_namespace_result`).
const INDEX_BUILD_INVALIDATED: &str =
    "The link index build was invalidated because its context was removed.";

/// The registration a root named was removed between resolving it and
/// reading its generation — the request would have adopted the tombstone's
/// fresh generation. Refused before any work. Asking again does not help
/// until the path is registered again, whose own refresh then follows.
pub(super) const INDEX_LOOKUP_INVALIDATED: &str =
    "The context of this link index root was removed while resolving it.";

/// The root's spelling stopped naming the directory it was registered for
/// between the lookup and the scan (a symlink retargeted): the scan would
/// index an unrelated directory under this vault's key.
const INDEX_ROOT_MOVED: &str = "The link index root no longer names its registered directory.";

/// Outside the build lock only (tests): a build is already reading this key.
pub(super) const INDEX_BUILD_PENDING: &str =
    "A link index build is already pending for this vault.";

/// Why a rebuild did not publish. `Invalidated` is the one outcome a caller
/// may treat as "not my index any more" rather than as a failure.
#[derive(Debug, thiserror::Error)]
pub(super) enum IndexBuildError {
    #[error("{}", INDEX_BUILD_INVALIDATED)]
    Invalidated,
    #[error("{0}")]
    Failed(String),
}

/// The rename gate. Every directory context containing the file must have a
/// live index before anything is touched — a reference from outside a nested
/// root is known only to the enclosing index — and one that has none yet is
/// built here, from that context's REGISTERED path, with the same
/// serialisation and coalescing as a refresh. That root is the spelling the
/// frontend gave at registration, not a guess (the prohibition in the header
/// is about roots derived from file paths), and it covers the contexts nothing
/// else builds: a journal or zettel space registered without being opened, a
/// nested folder restored from the last session. The first rename in such a
/// context waits for one scan. A build invalidated under the gate (the context
/// went away) is reported as INDEX_NOT_READY; the next attempt sees the new
/// registrations.
pub(super) async fn ensure_indexes(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    contexts: &[Registered],
) -> Result<(), String> {
    for ctx in buildable(contexts) {
        // An index counts only if it was published for THIS registration: one
        // left from an earlier registration of the same path (its `forget`
        // still pending) says nothing about the directory as registered now.
        if state
            .with_index_for(&ctx.info.path, ctx.incarnation, |idx| idx.is_some())
            .await
        {
            continue;
        }
        let target = prepare_index_build(state, ctx_mgr, &ctx.info.path)
            .await
            .map_err(|e| e.to_string())?;
        match rebuild_and_publish(state, &target, &ctx.info.path, true).await {
            Ok(_) => {}
            Err(IndexBuildError::Invalidated) => return Err(INDEX_NOT_READY.to_string()),
            Err(IndexBuildError::Failed(e)) => return Err(e),
        }
    }
    Ok(())
}

/// Read `f` from the index of every directory context in `contexts`,
/// concatenated. An index that is gone — or not the one published for that
/// registration — is a refusal, never a silent "no references".
pub(super) async fn read_indexes<T>(
    state: &LinkIndexState,
    contexts: &[Registered],
    f: impl Fn(&LinkIndex) -> Vec<T>,
) -> Result<Vec<T>, String> {
    let mut out = Vec::new();
    for ctx in contexts {
        let found = state
            .with_index_for(&ctx.info.path, ctx.incarnation, |idx| idx.map(&f))
            .await;
        out.extend(found.ok_or(INDEX_NOT_READY)?);
    }
    Ok(out)
}

/// A build's destination: the registration's key, the generation it may
/// publish into, the incarnation it belongs to, and the canonical directory
/// the root named when it was approved — checked again before the scan and
/// before publishing.
pub(super) struct BuildTarget {
    pub(super) key: String,
    pub(super) generation: u64,
    incarnation: u64,
    pub(super) canonical: PathBuf,
}

/// Resolve the registration a root names and the generation a build may
/// publish into. The root must be a registered directory context ITSELF
/// (`context_registered_at`), not merely lie inside one: had its context just
/// been removed, "the deepest context containing it" would be the parent, and
/// building the parent's key from this subtree would replace the parent's
/// index with a partial one. Then only a removal of THIS key that crossed the
/// lookup — its tombstone stamped after `before` — refuses the request;
/// removals of unrelated contexts are none of its business.
pub(super) async fn prepare_index_build(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    root_path: &str,
) -> Result<BuildTarget, IndexBuildError> {
    let before = state.removals.load(Ordering::SeqCst);
    let registered = ctx_mgr
        .context_registered_at(root_path)
        .await
        .ok_or_else(|| {
            IndexBuildError::Failed(format!("{root_path} is not a registered context root"))
        })?;
    let version = state.version(&registered.info.path).await;
    if version.removed_at > before {
        return Err(IndexBuildError::Failed(
            INDEX_LOOKUP_INVALIDATED.to_string(),
        ));
    }
    Ok(BuildTarget {
        key: registered.info.path,
        generation: version.generation,
        incarnation: registered.incarnation,
        canonical: registered.canonical_path,
    })
}

/// Build the index under `target.key` from `root_path` (as the caller spells
/// it — a refresh passes the frontend's string, from which the file paths it
/// will query are derived; the rename gate passes the registered path) and
/// publish it into `target.generation`, with the mutations that landed while it read
/// replayed on top. One build per key at a time; a refresh that queued behind
/// a build that published in the meantime returns that build's stats instead
/// of scanning the vault again (startup asks for the same refresh from several
/// places) — when `coalesce` is set. A namespace rename passes `false`: a
/// refresh that scanned BEFORE its directory move can publish after it (the
/// move is not a journaled mutation), and that publication, though newer than
/// the rename's request, describes the old layout; the rename must scan.
pub(super) async fn rebuild_and_publish(
    state: &LinkIndexState,
    target: &BuildTarget,
    root_path: &str,
    coalesce: bool,
) -> Result<IndexStats, IndexBuildError> {
    let key = target.key.as_str();
    let requested = state.version(key).await;
    if requested.generation != target.generation {
        return Err(IndexBuildError::Invalidated);
    }
    let lock = state.build_lock(key).await;
    let _building = lock.lock().await;
    if coalesce {
        if let Some(stats) = state
            .published_since(key, &requested, target.incarnation)
            .await
        {
            return Ok(stats);
        }
    }
    // The root was approved by what it canonicalised to at the lookup; the
    // scan reads the spelling. If the spelling names another directory now
    // (a symlink retargeted while this waited), scanning it would publish an
    // unrelated tree under this vault's key.
    still_the_registered_directory(root_path, target)?;
    let token = state
        .begin_build(key, &requested, root_path, target.incarnation)
        .await?;
    let mut new_index = LinkIndex::new();
    let stats = match new_index.build(root_path).await {
        Ok(stats) => stats,
        Err(e) => {
            state.abort_build(key, token).await;
            return Err(IndexBuildError::Failed(e.to_string()));
        }
    };
    if let Err(e) = still_the_registered_directory(root_path, target) {
        state.abort_build(key, token).await;
        return Err(e);
    }
    publish_built_index(state, key, token, new_index, stats).await
}

fn still_the_registered_directory(
    root_path: &str,
    target: &BuildTarget,
) -> Result<(), IndexBuildError> {
    match resolve_canonical(root_path) {
        Ok(canonical) if canonical == target.canonical => Ok(()),
        _ => Err(IndexBuildError::Failed(INDEX_ROOT_MOVED.to_string())),
    }
}

/// The publication step of a build (the caller holds the key's build lock).
pub(super) async fn publish_built_index(
    state: &LinkIndexState,
    key: &str,
    token: BuildToken,
    index: LinkIndex,
    stats: IndexStats,
) -> Result<IndexStats, IndexBuildError> {
    state
        .publish(key, token, index, stats.clone())
        .await
        .ok_or(IndexBuildError::Invalidated)?;
    Ok(stats)
}

pub(crate) async fn refresh_index_inner(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    root_path: &str,
) -> Result<IndexStats, String> {
    let target = prepare_index_build(state, ctx_mgr, root_path)
        .await
        .map_err(|e| e.to_string())?;
    rebuild_and_publish(state, &target, root_path, true)
        .await
        .map_err(|e| e.to_string())
}
