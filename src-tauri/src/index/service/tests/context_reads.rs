//! §393 `backlinks_in` · `links_in` (spec 0072 §5.1, D7 · D18): one context's index, built
//! when missing, asked in the spelling that index was built from.

use super::*;
use crate::context::manager::Registered;
use crate::index::LinkResolution;
use std::path::{Path, PathBuf};

fn canonical(path: &Path) -> PathBuf {
    path.canonicalize().unwrap()
}

async fn registered(ctx: &ContextManager, id: &str) -> Registered {
    ctx.registered(id).await.unwrap()
}

/// D7: a context nothing has built yet answers after one build, not with an empty list. On
/// macOS the tempdir is registered as `/var/…` and the file arrives canonical
/// (`/private/var/…`), so the read must also spell it the index's way. What fails this:
/// reading without `ensure_indexes` (no index → nothing), or looking the canonical path up.
#[tokio::test]
async fn a_link_read_builds_the_missing_index_then_answers() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-a", true).await;
    let state = LinkIndexState::new();
    assert!(
        state.with_index(&root, |idx| idx.is_none()).await,
        "no index yet"
    );

    let found = backlinks_in(
        &state,
        &ctx,
        &registered(&ctx, "ctx-a").await,
        &canonical(&dir.path().join("b.md")),
    )
    .await
    .unwrap();

    assert_eq!(found.root, root);
    assert_eq!(sources(&found.items), [format!("{root}/a.md").as_str()]);
    assert!(
        state.with_index(&root, |idx| idx.is_some()).await,
        "the read built it"
    );
}

/// `links_in` resolves as `baram links` does, in the index's spelling. What fails this: an
/// exact-key lookup with the canonical path (`outgoing.get` misses, `None`).
#[tokio::test]
async fn links_are_asked_in_the_spelling_the_index_was_built_from() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-a", true).await;
    let state = LinkIndexState::new();

    let found = links_in(
        &state,
        &ctx,
        &registered(&ctx, "ctx-a").await,
        &canonical(&dir.path().join("a.md")),
    )
    .await
    .unwrap();

    assert_eq!(found.root, root);
    let outgoing = found.items.expect("a.md is in the index");
    assert_eq!(outgoing.len(), 1);
    assert_eq!(
        outgoing[0].1,
        LinkResolution::Resolved(format!("{root}/b.md"))
    );
}

/// D18 through `ensure_indexes`: a root registered through a symlink is built in the symlink's
/// spelling, so the canonical path from a tier's gate must be spelled that way — for `links_in`
/// to find the note, and for `[[dir/note]]`, filed under a PATH key only, to come back as a
/// backlink. What fails this: asking with the canonical path. The pair below shows that query
/// finding neither.
#[cfg(unix)]
#[tokio::test]
async fn a_symlinked_root_answers_links_and_path_key_backlinks() {
    let ctx = ContextManager::new();
    let real = tempfile::tempdir().unwrap();
    std::fs::create_dir(real.path().join("dir")).unwrap();
    std::fs::write(real.path().join("dir/note.md"), "target").unwrap();
    std::fs::write(real.path().join("a.md"), "see [[dir/note]]").unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let link = elsewhere.path().join("link");
    std::os::unix::fs::symlink(real.path(), &link).unwrap();
    let root = link.to_str().unwrap().to_string();
    ctx.add(info("ctx-l", &root, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    let scope = registered(&ctx, "ctx-l").await;
    let a = canonical(&real.path().join("a.md"));
    let note = canonical(&real.path().join("dir/note.md"));

    let links = links_in(&state, &ctx, &scope, &a).await.unwrap();
    let backlinks = backlinks_in(&state, &ctx, &scope, &note).await.unwrap();

    assert_eq!(links.root, root);
    assert_eq!(
        links.items.expect("a.md is in the index")[0].1,
        LinkResolution::Resolved(format!("{root}/dir/note.md"))
    );
    assert_eq!(sources(&backlinks.items), [format!("{root}/a.md").as_str()]);
    let (by_canonical_links, by_canonical_backlinks) = state
        .with_index(&root, |idx| {
            let idx = idx.unwrap();
            (
                idx.outgoing_resolved(&a.to_string_lossy()).is_none(),
                idx.get_backlinks(&note.to_string_lossy(), &[]).is_empty(),
            )
        })
        .await;
    assert!(by_canonical_links && by_canonical_backlinks);
}

/// D18 through `refresh_index_inner`: an index the frontend built from another spelling of the
/// registered root is asked in THAT spelling. What fails this: spelling the query with the
/// registered path (`ctx.info.path`) instead of the slot's own root.
#[cfg(unix)]
#[tokio::test]
async fn an_index_built_from_another_spelling_is_asked_in_that_spelling() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-a", true).await;
    let elsewhere = tempfile::tempdir().unwrap();
    let alias = elsewhere.path().join("alias");
    std::os::unix::fs::symlink(dir.path(), &alias).unwrap();
    let alias = alias.to_str().unwrap().to_string();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &alias).await.unwrap();

    let found = links_in(
        &state,
        &ctx,
        &registered(&ctx, "ctx-a").await,
        &canonical(&dir.path().join("a.md")),
    )
    .await
    .unwrap();

    assert_ne!(alias, root);
    assert_eq!(found.root, alias);
    assert_eq!(
        found.items.expect("a.md is in the index")[0].1,
        LinkResolution::Resolved(format!("{alias}/b.md"))
    );
}

/// D7: one context answers. Asked through the nested folder, the note's backlinks are the
/// folder's own; asked through the vault around it, they include the link from outside. What
/// fails this: merging every context that holds the file, as the panel does
/// (`get_backlinks_inner`).
#[tokio::test]
async fn nested_roots_answer_from_the_asked_context_only() {
    let ctx = ContextManager::new();
    let outer = tempfile::tempdir().unwrap();
    std::fs::create_dir(outer.path().join("sub")).unwrap();
    std::fs::write(outer.path().join("sub/n.md"), "target").unwrap();
    std::fs::write(outer.path().join("sub/in.md"), "[[n]]").unwrap();
    std::fs::write(outer.path().join("out.md"), "[[n]]").unwrap();
    let outer_root = outer.path().to_str().unwrap().to_string();
    let inner_root = format!("{outer_root}/sub");
    ctx.add(info("ctx-outer", &outer_root, ContextType::Folder))
        .await
        .unwrap();
    ctx.add(info("ctx-inner", &inner_root, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    let note = canonical(&outer.path().join("sub/n.md"));

    let inner = backlinks_in(&state, &ctx, &registered(&ctx, "ctx-inner").await, &note)
        .await
        .unwrap();
    let whole = backlinks_in(&state, &ctx, &registered(&ctx, "ctx-outer").await, &note)
        .await
        .unwrap();

    assert_eq!(
        sources(&inner.items),
        [format!("{inner_root}/in.md").as_str()]
    );
    assert_eq!(
        sources(&whole.items),
        [
            format!("{outer_root}/out.md").as_str(),
            format!("{outer_root}/sub/in.md").as_str()
        ]
    );
}

/// A read holds the registration it resolved. If the context was removed and added again in
/// between, the gate builds the NEW registration's index, and the old registration gets a
/// refusal — not an empty answer, not the new one's. What fails this: reading the slot without
/// the incarnation (`with_index` instead of `with_index_and_root_for`). The pair: the new
/// registration reads the same note.
#[tokio::test]
async fn a_read_for_a_replaced_registration_is_not_ready() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-a", true).await;
    let stale = registered(&ctx, "ctx-a").await;
    ctx.remove("ctx-a").await.unwrap();
    ctx.add(info("ctx-a", &root, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    let b = canonical(&dir.path().join("b.md"));

    let refused = backlinks_in(&state, &ctx, &stale, &b).await.unwrap_err();
    let fresh = backlinks_in(&state, &ctx, &registered(&ctx, "ctx-a").await, &b)
        .await
        .unwrap();

    assert_eq!(refused, INDEX_NOT_READY);
    assert_eq!(sources(&fresh.items), [format!("{root}/a.md").as_str()]);
}

/// A canonical path under no root this index covers is refused, not answered empty. The
/// tiers' gates keep a path under the context's canonical root before it gets here
/// (`plugin::index_reads::below_root`), so this is the last line, for an index whose root
/// stopped naming that directory. What fails this: treating `IndexRoot::spell`'s `None` as "no
/// links". The pair: a path inside answers.
#[tokio::test]
async fn a_file_outside_the_index_root_is_refused() {
    let ctx = ContextManager::new();
    let (dir, _root) = vault_with_a_link(&ctx, "ctx-a", true).await;
    let elsewhere = tempfile::tempdir().unwrap();
    std::fs::write(elsewhere.path().join("x.md"), "[[b]]").unwrap();
    let state = LinkIndexState::new();
    let scope = registered(&ctx, "ctx-a").await;

    let outside = backlinks_in(
        &state,
        &ctx,
        &scope,
        &canonical(&elsewhere.path().join("x.md")),
    )
    .await
    .unwrap_err();
    let inside = backlinks_in(&state, &ctx, &scope, &canonical(&dir.path().join("b.md"))).await;

    assert_eq!(outside, NOT_UNDER_INDEX_ROOT);
    assert!(inside.is_ok());
}
