//! §33 What both renames prepare before anything is touched: the contexts that
//! hold the file with their indexes built, and — once the referrers are named —
//! what every root holding the file or a referrer knows of its notes.

use crate::context::manager::resolve_canonical;
use crate::context::manager::Registered;
use crate::context::ContextManager;
use crate::index::{root_places, root_relative_key, KnownPaths, LinkIndex, RootNotes};
use std::collections::HashMap;

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
    /// and `keys` are empty. A file rename judges the note's own links under
    /// its folder as spelled; a block ID rename finds no referrer to rewrite.
    /// `plain_absolute` is the caller's check, made before this — the file
    /// rename checks both of its paths.
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
    ///
    /// `target` is the renamed file as the rename was given it. `new_path` is
    /// a file rename's destination: a `Sole` root also counts the notes under
    /// the new name's key, which the judgement reads the respelled text by. A
    /// block ID rename keeps the path and passes None.
    pub(super) async fn referrers(
        &self,
        state: &LinkIndexState,
        ctx_mgr: &ContextManager,
        target: &str,
        new_path: Option<&str>,
        read: impl Fn(&LinkIndex) -> Vec<(String, u32)>,
    ) -> Result<Referrers, String> {
        let (named_lines, files) = named_referrers(read_indexes(state, &self.dirs, read).await?);
        let holding = holding_contexts(state, ctx_mgr, &self.dirs, &files).await;
        let mut known_paths = known_paths_of(state, &holding, new_path).await;
        spell_under_each_root(&mut known_paths, ctx_mgr, &holding, &files, target).await;
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
async fn holding_contexts(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    dirs: &[Registered],
    referrers: &[String],
) -> Vec<Registered> {
    let mut holding: Vec<Registered> = dirs.to_vec();
    for referrer in referrers {
        for c in buildable(&owning_contexts(ctx_mgr, referrer).await) {
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
    holding
}

/// The spellings the judgement reads a root's notes by where that root
/// holds a path only as resolved (`ContextManager::contexts_containing`
/// compares canonical paths) and not as spelled (`root_places`): each
/// referrer under each such holding root (`KnownPaths::spelled`, or
/// `unplaced` when no spelling is found), and the renamed file's key under
/// each holding root that contains it so (`KnownPaths::renamed`).
async fn spell_under_each_root(
    known: &mut KnownPaths,
    ctx_mgr: &ContextManager,
    holding: &[Registered],
    referrers: &[String],
    target: &str,
) {
    for referrer in referrers {
        for c in buildable(&owning_contexts(ctx_mgr, referrer).await) {
            if root_places(&c.info.path, referrer, cfg!(windows)) {
                continue;
            }
            match spelled_under(&c, referrer) {
                Some(here) => {
                    known
                        .spelled
                        .entry(referrer.clone())
                        .or_default()
                        .insert(c.info.path.clone(), here);
                }
                None => {
                    known.unplaced.insert(referrer.clone());
                }
            }
        }
    }
    for c in holding {
        if root_places(&c.info.path, target, cfg!(windows)) {
            continue;
        }
        let key = spelled_under(c, target)
            .and_then(|here| root_relative_key(&c.info.path, &here, cfg!(windows)));
        if let Some(key) = key {
            known.renamed.insert(c.info.path.clone(), key);
        }
    }
}

/// `path` spelled under the registered root of `c`: its folder resolved,
/// that folder's place under `c`'s canonical root joined onto `c`'s
/// registered path, then its own name. The name is not resolved, so a
/// referrer that is itself a symlink keeps its entry's name, as the index
/// spells it. None when the folder does not resolve under `c` — a referrer
/// that resolves under `c` only through a symlink of its own, or one whose
/// folder is gone. No test reaches that case: the build does not index a
/// symlink entry (`fs::collect_md_files` reads `DirEntry::metadata`, which
/// does not follow one), so a referrer the build names is not one.
fn spelled_under(c: &Registered, path: &str) -> Option<String> {
    let path = std::path::Path::new(path);
    let folder = resolve_canonical(path.parent()?.to_str()?).ok()?;
    spelled_from(&c.info.path, &c.canonical_path, &folder, path.file_name()?)
}

/// `spelled_under` once the folder is resolved: `name` in `folder`, both as
/// resolved, spelled under the root registered as `registered` and resolving
/// to `canonical_root`. None when `folder` is not under `canonical_root`.
fn spelled_from(
    registered: &str,
    canonical_root: &std::path::Path,
    folder: &std::path::Path,
    name: &std::ffi::OsStr,
) -> Option<String> {
    let rest = folder.strip_prefix(canonical_root).ok()?;
    let here = std::path::Path::new(registered).join(rest).join(name);
    here.to_str().map(str::to_string)
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
/// of a key per note. With `new_path`, the `Sole` map also holds the new
/// name's key with how many notes fold to it now (`path_key_notes`), even
/// one or none: the respelled text is read under that key.
async fn known_paths_of(
    state: &LinkIndexState,
    holding: &[Registered],
    new_path: Option<&str>,
) -> KnownPaths {
    let sole = holding.len() == 1;
    let mut known = KnownPaths::default();
    for c in holding {
        let notes = state
            .with_index_for(&c.info.path, c.incarnation, |idx| {
                idx.map(|idx| {
                    if sole {
                        let mut keys = idx.colliding_path_keys();
                        let new_key = new_path
                            .and_then(|new| root_relative_key(&c.info.path, new, cfg!(windows)));
                        if let Some(key) = new_key {
                            let notes = idx.path_key_notes(&key);
                            keys.insert(key, notes);
                        }
                        RootNotes::Sole(keys)
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

#[cfg(test)]
mod tests {
    use super::spelled_from;
    use std::ffi::OsStr;
    use std::path::Path;

    #[test]
    fn a_resolved_path_is_spelled_under_the_root_as_registered() {
        // The child root registered as `/var/v/sub` resolves to
        // `/private/var/v/sub` (macOS): a referrer whose folder resolves to
        // `/private/var/v/sub/a` is `/var/v/sub/a/r.md` under it, and the
        // root's own folder gives the root's spelling. A folder outside the
        // root has no spelling. On every host, unlike the service tests, whose
        // spellings depend on the temp directory and the file system.
        // What fails this: joining the resolved folder instead of its place
        // under the root — `/private/var/...` comes back.
        let spelled = |folder: &str| {
            spelled_from(
                "/var/v/sub",
                Path::new("/private/var/v/sub"),
                Path::new(folder),
                OsStr::new("r.md"),
            )
        };
        let expected = |p: &str| Some(p.to_string());
        assert_eq!(
            spelled("/private/var/v/sub/a").map(|s| s.replace('\\', "/")),
            expected("/var/v/sub/a/r.md")
        );
        assert_eq!(
            spelled("/private/var/v/sub").map(|s| s.replace('\\', "/")),
            expected("/var/v/sub/r.md")
        );
        assert_eq!(spelled("/private/var/other"), None);
    }
}
