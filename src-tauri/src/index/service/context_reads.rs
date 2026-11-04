//! §393 The link reads a plugin makes (spec 0072 §5.1, D7 · D18): ONE context's index —
//! built here when it has none, so an answer does not depend on whether something built it
//! first — asked in the spelling that index was built from.
//!
//! The backlinks panel's read (`query::get_backlinks_inner`) differs on purpose. It merges
//! every context that holds the file (nested roots) and answers empty while an index is
//! missing. A plugin's rows are written relative to one context's root, where a source outside
//! that root has no relative path, and an empty answer before a build is a different answer
//! from the one after it.

use crate::context::manager::Registered;
use crate::context::ContextManager;
use crate::index::{BacklinkResult, LinkEntry, LinkIndex, LinkResolution};
use std::path::Path;

use super::build::{ensure_indexes, INDEX_NOT_READY};
use super::keys::local_aliases_of;
use super::state::LinkIndexState;

/// The canonical path is not under the root this index was built from. The tiers keep a path
/// under the context's canonical root before it gets here, so this means the index's root no
/// longer names that directory.
pub(super) const NOT_UNDER_INDEX_ROOT: &str =
    "The file is not under the root of this context's link index.";

/// An answer from one index, with the root spelling its paths are written in.
#[derive(Debug)]
pub(crate) struct Spelled<T> {
    /// The spelling the index was built from (`IndexRoot`). Every path an item carries starts
    /// with it.
    pub root: String,
    pub items: T,
}

/// Links to `file` (canonical) in `ctx`'s index: under every key the index files them
/// (`LinkIndex::get_backlinks`), and behind the aliases `ctx` answers to (§87,
/// `local_aliases_of` over this one context — an outer vault's alias is the outer vault's
/// question).
pub(crate) async fn backlinks_in(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    ctx: &Registered,
    file: &Path,
) -> Result<Spelled<Vec<BacklinkResult>>, String> {
    // Before the build: the aliases come from the registrations, not from the index.
    let local = local_aliases_of(ctx_mgr, std::slice::from_ref(ctx))
        .await
        .local;
    read_in(state, ctx_mgr, ctx, file, |index, spelled| {
        index.get_backlinks(spelled, &local)
    })
    .await
}

/// The links `file` (canonical) holds, each resolved as `baram links` resolves it
/// (`LinkIndex::outgoing_resolved`). `items` is `None` when the index holds no note at that
/// path — the caller decides what that means.
pub(crate) async fn links_in(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    ctx: &Registered,
    file: &Path,
) -> Result<Spelled<Option<Vec<(LinkEntry, LinkResolution)>>>, String> {
    read_in(state, ctx_mgr, ctx, file, |index, spelled| {
        index.outgoing_resolved(spelled)
    })
    .await
}

/// The part both reads share: build `ctx`'s index when none is published for this
/// registration, then, inside the slot's critical section, spell `file` with the slot's own
/// root and hand that spelling to `read`. A slot that is gone (or published by another
/// registration) is `INDEX_NOT_READY`; a path outside the slot's root is
/// `NOT_UNDER_INDEX_ROOT` — neither is an empty answer.
async fn read_in<T>(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    ctx: &Registered,
    file: &Path,
    read: impl FnOnce(&LinkIndex, &str) -> T,
) -> Result<Spelled<T>, String> {
    ensure_indexes(state, ctx_mgr, std::slice::from_ref(ctx)).await?;
    state
        .with_index_and_root_for(
            &ctx.info.path,
            ctx.incarnation,
            |found| -> Result<Spelled<T>, &'static str> {
                let (index, root) = found.ok_or(INDEX_NOT_READY)?;
                let spelled = root.spell(file).ok_or(NOT_UNDER_INDEX_ROOT)?;
                Ok(Spelled {
                    root: root.spelling().to_string(),
                    items: read(index, &spelled),
                })
            },
        )
        .await
        .map_err(str::to_string)
}
