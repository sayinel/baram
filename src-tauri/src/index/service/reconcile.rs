//! §29 #824 One path brought into every link index that covers it, from the disk as it
//! is now — the unit every writer and the watcher sync go through.
//!
//! A unit takes the path's apply guard (`LinkIndexState::apply_guard`), then resolves
//! the covering registrations, stats, reads, classifies and applies, all under it.
//! Units on one path therefore run one at a time, and each reads the disk after its own
//! commit: whichever runs last leaves the index at the disk's latest state, in any
//! order the writes and the watcher's events arrive. A unit that read old bytes cannot
//! apply them after a later write's unit, because that unit waits for the guard.
//!
//! The judgement is per registration. Each covering index applies a mutation through
//! its own exclusion matcher (`Mutation::apply_to`), so a path one root excludes and a
//! nested root includes ends as each root's fresh build would leave it; a path an
//! index holds but now excludes is taken out. What a point mutation cannot express is a
//! rebuild of that registration, run after the guard is released and once per batch
//! however many paths ask for it (`Batch`):
//!
//! - a change to `<registration root>/.baramignore` (it changes what every entry means);
//! - a file where the index holds entries below the path (a directory became a file);
//! - a directory where the index holds the path itself, or one that holds files (moved
//!   in: its files arrive without events of their own);
//! - a vanished path with entries below it.
//!
//! A root whose `.baramignore` cannot be used gets nothing and the path is a failure, as
//! a build of that root fails (#794). Any registration a unit cannot judge the path for
//! is marked for dropping (`Reconciled::degrade`): an index known not to match the disk
//! is not left trusted.
//!
//! A note that exists but cannot be read is `Unreadable`; a read that says NotFound, or
//! a re-stat that finds a directory, is classified again. A walk or `metadata` error
//! other than NotFound is a failure — never "empty", never "gone".
//!
//! Limit: the guard and the index key are the directory-entry path, canonicalised. Two
//! hard links to one file are two entries; a write through one of them is reconciled
//! for that entry only, and the other keeps what the index read last.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};

use crate::context::manager::{resolve_canonical, Registered};
use crate::context::{ContextManager, ContextType};
use crate::fs::{VaultExclusion, BARAMIGNORE};

use super::build::{prepare_index_build, rebuild_and_publish};
use super::keys::buildable;
use super::state::{tick, ApplyOutcome, LinkIndexState, Mutation};

/// A registration, as the units name it: its key and the incarnation they resolved.
pub(crate) type RegistrationAt = (String, u64);

/// What one unit did to one path.
#[derive(Debug, Default)]
pub(crate) struct Reconciled {
    pub(crate) canonical: PathBuf,
    /// The path as given, then each covering index's own spelling of it.
    pub(crate) spellings: Vec<String>,
    /// Some registration covered it: a mutation reached it or it was rebuilt.
    pub(crate) reached: bool,
    pub(crate) failed: bool,
    /// Registrations whose published index took the path (`ApplyOutcome::Applied`).
    pub(crate) applied: Vec<String>,
    /// Registrations rebuilt and published.
    pub(crate) rebuilt: Vec<String>,
    /// Registrations whose index no longer matches the disk and must be dropped: a
    /// rebuild of them failed, or the unit could not judge the path for them (an unusable
    /// `.baramignore`, a walk or `metadata` error).
    pub(crate) degrade: Vec<RegistrationAt>,
    /// Rebuilds this path asked the batch for (`Batch::finish`).
    pub(crate) wants: Vec<RegistrationAt>,
}

/// What the units of one batch — one command's effects, one watcher sync — share
/// (#824): each registration's `.baramignore`, read once, and the rebuilds the units ask
/// for, each run once after the last unit.
#[derive(Default)]
pub(crate) struct Batch {
    /// `None`: the registration's `.baramignore` cannot be used.
    exclusions: HashMap<RegistrationAt, Option<VaultExclusion>>,
    rebuild: BTreeSet<RegistrationAt>,
}

impl Batch {
    fn exclusion(&mut self, state: &LinkIndexState, ctx: &Registered) -> Option<&VaultExclusion> {
        self.exclusions
            .entry((ctx.info.path.clone(), ctx.incarnation))
            .or_insert_with(|| {
                #[cfg(test)]
                state
                    .exclusion_loads
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                #[cfg(not(test))]
                let _ = state;
                VaultExclusion::load(Path::new(&ctx.info.path)).ok()
            })
            .as_ref()
    }

    /// Run every rebuild the batch asked for, once each, and tell each unit how its own
    /// went: published, or to be dropped.
    pub(crate) async fn finish(
        self,
        state: &LinkIndexState,
        ctx_mgr: &ContextManager,
        done: &mut [Reconciled],
    ) {
        for (key, incarnation) in self.rebuild {
            let published = rebuild_registration(state, ctx_mgr, &key).await;
            for d in done.iter_mut() {
                if !d.wants.contains(&(key.clone(), incarnation)) {
                    continue;
                }
                if published {
                    d.rebuilt.push(key.clone());
                } else {
                    d.failed = true;
                    d.degrade.push((key.clone(), incarnation));
                }
            }
        }
        for d in done.iter_mut() {
            d.degrade.sort();
            d.degrade.dedup();
        }
    }
}

enum Point {
    Mutation(Mutation),
    Rebuild,
    Failed,
    /// Nothing this index could hold here.
    Nothing,
}

/// Bring `path` into every index covering it (see the module doc), alone.
#[cfg(test)]
pub(crate) async fn reconcile_path(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    path: &str,
) -> Reconciled {
    let mut batch = Batch::default();
    let mut done = [reconcile_path_in(state, ctx_mgr, path, &mut batch).await];
    batch.finish(state, ctx_mgr, &mut done).await;
    let [done] = done;
    done
}

/// `reconcile_path` as one unit of `batch`: its rebuilds wait for `Batch::finish`.
///
/// A path that cannot be resolved names no index for sure, so every registration it may
/// belong to by spelling is dropped (`ContextManager::lexical_candidates`) — all of them
/// when none matches — rather than any left trusted.
pub(crate) async fn reconcile_path_in(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    path: &str,
    batch: &mut Batch,
) -> Reconciled {
    let Ok(canonical) = resolve(state, path) else {
        return Reconciled {
            spellings: vec![path.to_string()],
            failed: true,
            degrade: buildable(&ctx_mgr.lexical_candidates(path).await)
                .into_iter()
                .map(|c| (c.info.path, c.incarnation))
                .collect(),
            ..Reconciled::default()
        };
    };
    reconcile_at(
        state,
        ctx_mgr,
        path,
        canonical,
        vec![path.to_string()],
        batch,
    )
    .await
}

/// #824 One unit for a path the watcher reported, at the canonical identity the router
/// derived for it (`applier`), never resolved again: an alias retargeted since the event
/// cannot move it to another vault. Stats and reads go to that identity.
pub(crate) async fn reconcile_identity_in(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    canonical: &Path,
    spellings: Vec<String>,
    batch: &mut Batch,
) -> Reconciled {
    let at = canonical.to_string_lossy().into_owned();
    reconcile_at(
        state,
        ctx_mgr,
        &at,
        canonical.to_path_buf(),
        spellings,
        batch,
    )
    .await
}

#[cfg(not(test))]
fn resolve(_state: &LinkIndexState, path: &str) -> Result<PathBuf, String> {
    resolve_canonical(path)
}

/// Tests make a path unresolvable (`LinkIndexState::unresolvable`).
#[cfg(test)]
fn resolve(state: &LinkIndexState, path: &str) -> Result<PathBuf, String> {
    if state.unresolvable.lock().unwrap().contains(path) {
        return Err(format!("{path} cannot be resolved"));
    }
    resolve_canonical(path)
}

/// The unit itself: `path` is where it stats and reads, `canonical` the identity it is
/// guarded and judged under.
async fn reconcile_at(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    path: &str,
    canonical: PathBuf,
    spellings: Vec<String>,
    batch: &mut Batch,
) -> Reconciled {
    let mut out = Reconciled {
        spellings,
        ..Reconciled::default()
    };
    out.canonical = canonical.clone();
    let _guard = state.apply_guard(&canonical).await;
    let contexts = buildable(&ctx_mgr.contexts_holding(&canonical).await);
    if contexts.is_empty() {
        return out;
    }
    let mut points: Vec<(Registered, Point)> = Vec::new();
    let metadata = tokio::fs::metadata(path).await;
    let mut read: Option<Point> = None;
    for ctx in contexts {
        // Before any matcher: the matcher skips dot files, `.baramignore` among them.
        if canonical == ctx.canonical_path.join(BARAMIGNORE) {
            points.push((ctx, Point::Rebuild));
            continue;
        }
        // A root whose `.baramignore` cannot be used gets nothing, as a build of it
        // fails: never judged by an older matcher or by the defaults alone (#794).
        let Some(exclusion) = batch.exclusion(state, &ctx).cloned() else {
            points.push((ctx, Point::Failed));
            continue;
        };
        let point = match &metadata {
            Ok(meta) if meta.is_dir() => {
                directory_point(state, &ctx, path, &canonical, &exclusion).await
            }
            Ok(_)
                if state
                    .holds_under(&ctx.info.path, ctx.incarnation, &canonical)
                    .await =>
            {
                Point::Rebuild
            }
            Ok(_) => match &read {
                Some(point) => clone_point(point),
                None => {
                    let point = file_point(state, path, &canonical).await;
                    let copy = clone_point(&point);
                    read = Some(point);
                    copy
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if state
                    .holds_under(&ctx.info.path, ctx.incarnation, &canonical)
                    .await
                {
                    Point::Rebuild
                } else {
                    Point::Mutation(Mutation::Remove {
                        path: canonical.clone(),
                    })
                }
            }
            Err(_) => Point::Failed,
        };
        points.push((ctx, point));
    }
    // #824 Every read this unit makes is done: what it applies describes the disk as of
    // here (`LinkIndexState::apply_for`). Before the test pause, which stands for a unit
    // that is slow to apply.
    let observed = tick();
    #[cfg(test)]
    pause_if_asked(state, &canonical).await;
    for (ctx, point) in points {
        let at = (ctx.info.path.clone(), ctx.incarnation);
        match point {
            Point::Mutation(m) => {
                out.reached = true;
                // `Stale` needs no second try. The registrations were resolved under
                // the guard, after the commit this unit follows; a registration of the
                // same path that replaced one of them since was registered after that
                // commit, so its first build reads the disk as this unit did.
                if state
                    .apply_for(&ctx.info.path, ctx.incarnation, vec![m], observed)
                    .await
                    == ApplyOutcome::Applied
                {
                    out.applied.push(ctx.info.path.clone());
                }
            }
            Point::Rebuild => {
                out.reached = true;
                out.wants.push(at.clone());
                batch.rebuild.insert(at);
            }
            // The index cannot be brought to the disk for this path: it is dropped
            // rather than left trusted (`commit::degrade`).
            Point::Failed => {
                out.failed = true;
                out.degrade.push(at);
            }
            Point::Nothing => {}
        }
    }
    for ctx in buildable(&ctx_mgr.contexts_holding(&canonical).await) {
        if let Some(spelled) = state.spelling_of(&ctx.info.path, &canonical).await {
            if !out.spellings.contains(&spelled) {
                out.spellings.push(spelled);
            }
        }
    }
    out
}

/// Rebuild every registration a tree touches, alone (`reconcile_tree_in`).
#[cfg(test)]
pub(crate) async fn reconcile_tree(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    dir: &str,
) -> Reconciled {
    let mut batch = Batch::default();
    let mut done = [reconcile_tree_in(ctx_mgr, dir, &mut batch).await];
    batch.finish(state, ctx_mgr, &mut done).await;
    let [done] = done;
    done
}

/// Ask `batch` to rebuild every registration a tree touches: those that contain `dir`
/// and those that lie under it (a repository at `/r` holding the vault `/r/notes`).
pub(crate) async fn reconcile_tree_in(
    ctx_mgr: &ContextManager,
    dir: &str,
    batch: &mut Batch,
) -> Reconciled {
    let Ok(canonical) = resolve_canonical(dir) else {
        // Registrations below a tree cannot be matched by spelling from above it: every
        // directory registration is dropped rather than any left trusted.
        return Reconciled {
            spellings: vec![dir.to_string()],
            failed: true,
            degrade: buildable(&ctx_mgr.directory_registrations().await)
                .into_iter()
                .map(|c| (c.info.path, c.incarnation))
                .collect(),
            ..Reconciled::default()
        };
    };
    reconcile_tree_at(ctx_mgr, dir, &canonical, batch).await
}

/// `reconcile_tree_in` for a tree whose canonical form is known — a watcher host, not
/// resolved again (`applier`).
pub(crate) async fn reconcile_tree_at(
    ctx_mgr: &ContextManager,
    dir: &str,
    canonical: &Path,
    batch: &mut Batch,
) -> Reconciled {
    let mut out = Reconciled {
        spellings: vec![dir.to_string()],
        canonical: canonical.to_path_buf(),
        ..Reconciled::default()
    };
    let mut at: BTreeSet<RegistrationAt> = buildable(&ctx_mgr.contexts_holding(canonical).await)
        .into_iter()
        .map(|c| (c.info.path, c.incarnation))
        .collect();
    for info in ctx_mgr.list().await {
        if !matches!(info.context_type, ContextType::Vault | ContextType::Folder) {
            continue;
        }
        if let Some(registered) = ctx_mgr.registered(&info.id).await {
            if registered.canonical_path.starts_with(canonical) {
                at.insert((registered.info.path, registered.incarnation));
            }
        }
    }
    for registration in at {
        out.reached = true;
        out.wants.push(registration.clone());
        batch.rebuild.insert(registration);
    }
    out
}

/// One uncoalesced rebuild of the registration at `key`: a build that started before
/// the change read the old layout and must not satisfy this one.
pub(crate) async fn rebuild_registration(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    key: &str,
) -> bool {
    match prepare_index_build(state, ctx_mgr, key).await {
        Ok(target) => rebuild_and_publish(state, &target, key, false)
            .await
            .is_ok(),
        Err(_) => false,
    }
}

/// A directory on disk: rebuild if the index holds the path itself (a file became a
/// directory) or the directory holds files a build would register.
async fn directory_point(
    state: &LinkIndexState,
    ctx: &Registered,
    path: &str,
    canonical: &Path,
    exclusion: &VaultExclusion,
) -> Point {
    if state
        .holds_path(&ctx.info.path, ctx.incarnation, canonical)
        .await
    {
        return Point::Rebuild;
    }
    match holds_files(path, exclusion).await {
        Ok(true) => Point::Rebuild,
        Ok(false) => Point::Nothing,
        Err(_) => Point::Failed,
    }
}

/// A file on disk, read once for every covering index.
async fn file_point(state: &LinkIndexState, path: &str, canonical: &Path) -> Point {
    let path_of = || canonical.to_path_buf();
    if !is_note(path) {
        return Point::Mutation(Mutation::Target { path: path_of() });
    }
    #[cfg(test)]
    state
        .note_reads
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    #[cfg(not(test))]
    let _ = state;
    match tokio::fs::read_to_string(path).await {
        Ok(content) => Point::Mutation(Mutation::Update {
            path: path_of(),
            content,
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Point::Mutation(Mutation::Remove { path: path_of() })
        }
        // Permissions, invalid UTF-8 — or the entry changed shape since the stat.
        Err(_) => match tokio::fs::metadata(path).await {
            Ok(meta) if meta.is_dir() => Point::Rebuild,
            Ok(_) => Point::Mutation(Mutation::Unreadable { path: path_of() }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                Point::Mutation(Mutation::Remove { path: path_of() })
            }
            Err(_) => Point::Failed,
        },
    }
}

fn clone_point(point: &Point) -> Point {
    match point {
        Point::Mutation(m) => Point::Mutation(m.clone()),
        Point::Rebuild => Point::Rebuild,
        Point::Failed => Point::Failed,
        Point::Nothing => Point::Nothing,
    }
}

/// The markdown rule a vault build reads notes by (`fs::collect_md_files`).
pub(crate) fn is_note(path: &str) -> bool {
    path.ends_with(".md") || path.ends_with(".markdown")
}

/// Whether a directory holds any file a vault build would register. A walk that fails
/// is an error, not an empty directory.
async fn holds_files(dir: &str, exclusion: &VaultExclusion) -> Result<bool, crate::fs::FsError> {
    let mut files = Vec::new();
    crate::fs::collect_all_files(Path::new(dir), exclusion, &mut files).await?;
    Ok(!files.is_empty())
}

#[cfg(test)]
async fn pause_if_asked(state: &LinkIndexState, canonical: &Path) {
    let pause = {
        let mut slot = state.pause_after_read.lock().unwrap();
        match slot.as_ref() {
            Some(p) if p.path == canonical => slot.take(),
            _ => None,
        }
    };
    if let Some(p) = pause {
        p.reached.notify_one();
        p.release.notified().await;
    }
}
