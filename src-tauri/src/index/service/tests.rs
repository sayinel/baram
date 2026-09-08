use super::build::*;
use super::keys::*;
use super::query::*;
use super::rename::*;
use super::state::*;
use crate::context::{ContextInfo, ContextManager, ContextType};
use crate::index::{BacklinkResult, IndexStats, LinkGraph, LinkIndex};

fn info(id: &str, path: &str, kind: ContextType) -> ContextInfo {
    ContextInfo {
        id: id.to_string(),
        context_type: kind,
        path: path.to_string(),
        label: id.to_string(),
        color: "#ffffff".to_string(),
        alias: None,
        vault_type: None,
        added_at: 0,
    }
}

/// A vault whose `a.md` links to `b.md`, registered under an id that is
/// nothing like its path — the shape of the bug. Active unless told otherwise.
async fn vault_with_a_link(
    ctx: &ContextManager,
    id: &str,
    active: bool,
) -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_str().unwrap().to_string();
    std::fs::write(dir.path().join("a.md"), "see [[b]]").unwrap();
    std::fs::write(dir.path().join("b.md"), "target").unwrap();
    ctx.add(info(id, &root, ContextType::Folder)).await.unwrap();
    if active {
        ctx.set_active(id).await.unwrap();
    }
    (dir, root)
}

/// The registration incarnation of a context, as `remove_context` would
/// hand it to `forget`.
async fn incarnation_of(ctx: &ContextManager, id: &str) -> u64 {
    ctx.registration(id).await.unwrap().1
}

fn sources(backlinks: &[BacklinkResult]) -> Vec<&str> {
    backlinks.iter().map(|b| b.source_path.as_str()).collect()
}

/// A build that has read the vault but not published yet — the window in
/// which saves and renames race it.
async fn staged_build(
    state: &LinkIndexState,
    ctx: &ContextManager,
    key: &str,
    root: &str,
) -> (BuildToken, LinkIndex, IndexStats) {
    let incarnation = ctx
        .context_registered_at(root)
        .await
        .map_or(0, |r| r.incarnation);
    let requested = state.version(key).await;
    let token = state
        .begin_build(key, &requested, root, incarnation)
        .await
        .unwrap();
    let mut snapshot = LinkIndex::new();
    let stats = snapshot.build(root).await.unwrap();
    (token, snapshot, stats)
}

#[tokio::test]
async fn the_active_contexts_graph_is_found_when_its_id_is_nothing_like_its_path() {
    let ctx = ContextManager::new();
    let (_dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    // Hybrid ranking's view: the edge a → b, with the exact paths the
    // frontend will pass as `current_file`.
    let key = active_index_key(&ctx).await.unwrap();
    let outgoing = outgoing_links(&state, &key).await;
    assert_eq!(
        outgoing.get(&format!("{root}/a.md")),
        Some(&vec![format!("{root}/b.md")])
    );
    // The backlinks panel's view of the same index.
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
        .await
        .unwrap();
    assert_eq!(sources(&backlinks), vec![format!("{root}/a.md")]);
    // Before: the ranking side looked the map up under the id and got nothing.
    assert!(state.with_index("ctx-abc", |idx| idx.is_none()).await);
}

#[tokio::test]
async fn file_commands_use_the_files_own_context_not_the_active_one() {
    let ctx = ContextManager::new();
    let (_a, root_a) = vault_with_a_link(&ctx, "ctx-a", true).await;
    let (dir_b, root_b) = vault_with_a_link(&ctx, "ctx-b", false).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root_a).await.unwrap();
    refresh_index_inner(&state, &ctx, &root_b).await.unwrap();

    // A is active; a B file is saved (a non-active tab) and re-indexed.
    std::fs::write(dir_b.path().join("a.md"), "link removed").unwrap();
    update_file_index_inner(&state, &ctx, &format!("{root_b}/a.md"))
        .await
        .unwrap();
    // B changed…
    assert!(get_backlinks_inner(&state, &ctx, &format!("{root_b}/b.md"))
        .await
        .unwrap()
        .is_empty());
    // …and A did not.
    let backlinks_a = get_backlinks_inner(&state, &ctx, &format!("{root_a}/b.md"))
        .await
        .unwrap();
    assert_eq!(sources(&backlinks_a), vec![format!("{root_a}/a.md")]);
}

#[tokio::test]
async fn a_file_opened_standalone_inside_an_open_folder_belongs_to_the_folders_index() {
    // §89 single-file mode registers a File context for the file itself.
    // Its containing folder is what has links to it.
    let ctx = ContextManager::new();
    let (_dir, root) = vault_with_a_link(&ctx, "ctx-folder", true).await;
    ctx.add(info("ctx-file", &format!("{root}/b.md"), ContextType::File))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    assert_eq!(
        owning_index_key(&ctx, &format!("{root}/b.md"))
            .await
            .unwrap(),
        root
    );
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
        .await
        .unwrap();
    assert_eq!(sources(&backlinks), vec![format!("{root}/a.md")]);
}

#[tokio::test]
async fn file_commands_work_with_no_active_context_and_a_file_outside_every_context_reads_empty() {
    let ctx = ContextManager::new();
    let (_dir, root) = vault_with_a_link(&ctx, "ctx-b", false).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
        .await
        .unwrap();
    assert_eq!(sources(&backlinks), vec![format!("{root}/a.md")]);

    // A path no context knows: nothing to report and nothing to index —
    // empty and a no-op, not errors the backlinks panel would render as a
    // banner (and the callers' `.then(invalidate)` still runs). A rename of
    // it is refused — nothing is known about its references — and it is
    // no build root.
    let outside = tempfile::tempdir().unwrap();
    let stray = format!("{}/x.md", outside.path().to_str().unwrap());
    std::fs::write(&stray, "stray").unwrap();
    assert!(get_backlinks_inner(&state, &ctx, &stray)
        .await
        .unwrap()
        .is_empty());
    update_file_index_inner(&state, &ctx, &stray).await.unwrap();
    let err = rename_file_with_links_inner(
        &state,
        &ctx,
        &stray,
        &format!("{}/y.md", outside.path().to_str().unwrap()),
    )
    .await
    .unwrap_err();
    assert!(err.contains("not inside any registered context"), "{err}");
    assert!(std::path::Path::new(&stray).exists());
    assert!(rename_block_id_inner(&state, &ctx, &stray, "a", "b")
        .await
        .is_err());
    assert!(
        refresh_index_inner(&state, &ctx, outside.path().to_str().unwrap())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn the_active_only_commands_are_errors_without_an_active_context() {
    let ctx = ContextManager::new();
    let state = LinkIndexState::new();
    assert_eq!(
        get_link_index_inner(&state, &ctx, None).await.unwrap_err(),
        "No active context"
    );
    assert_eq!(
        active_index_key(&ctx).await.unwrap_err(),
        "No active context"
    );
}

#[tokio::test]
async fn an_active_context_with_no_index_yet_answers_empty_and_a_save_is_a_no_op() {
    let ctx = ContextManager::new();
    let (_dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    assert!(get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
        .await
        .unwrap()
        .is_empty());
    assert!(get_link_index_inner(&state, &ctx, None)
        .await
        .unwrap()
        .edges
        .is_empty());
    update_file_index_inner(&state, &ctx, &format!("{root}/a.md"))
        .await
        .unwrap();
    let key = active_index_key(&ctx).await.unwrap();
    assert!(outgoing_links(&state, &key).await.is_empty());
    assert!(state.with_index(&key, |idx| idx.is_none()).await);
}

#[tokio::test]
async fn a_rename_before_the_initial_build_builds_the_index_first() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    // No refresh has run: the gate builds the index from the registered
    // path, then the rename rewrites the referring file. Renaming here used
    // to be refused (and, before that, to rewrite nothing at all).
    assert!(state.with_index(&root, |idx| idx.is_none()).await);
    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/b.md"),
        &format!("{root}/c.md"),
    )
    .await
    .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/a.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
        "see [[c]]"
    );
    assert!(dir.path().join("c.md").exists());
    // The index the gate built is the live one — it saw the rename too.
    assert_eq!(state.build_root(&root).await, Some(root.clone()));
    assert!(get_backlinks_inner(&state, &ctx, &format!("{root}/c.md"))
        .await
        .unwrap()
        .iter()
        .any(|b| b.source_path == format!("{root}/a.md")));
    // A block-id rename in a context with no index goes the same way.
    std::fs::write(dir.path().join("a.md"), "see ((c#^old))").unwrap();
    update_file_index_inner(&state, &ctx, &format!("{root}/a.md"))
        .await
        .unwrap();
    state
        .forget(&root, incarnation_of(&ctx, "ctx-abc").await)
        .await;
    ctx.remove("ctx-abc").await.unwrap();
    ctx.add(info("ctx-abc", &root, ContextType::Folder))
        .await
        .unwrap();
    let result = rename_block_id_inner(&state, &ctx, &format!("{root}/c.md"), "old", "new")
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/a.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
        "see ((c#^new))"
    );
}

#[tokio::test]
async fn a_root_in_any_spelling_lands_on_the_registered_key() {
    let ctx = ContextManager::new();
    let (_dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    // The frontend's rootPath with a trailing slash…
    refresh_index_inner(&state, &ctx, &format!("{root}/"))
        .await
        .unwrap();
    // …is the index the active lookup and the explicit-root lookup read.
    let key = active_index_key(&ctx).await.unwrap();
    assert_eq!(key, root);
    assert!(!outgoing_links(&state, &key).await.is_empty());
    assert!(
        !get_link_index_inner(&state, &ctx, Some(format!("{root}/")))
            .await
            .unwrap()
            .edges
            .is_empty()
    );
    assert!(!get_link_index_inner(&state, &ctx, Some(root.clone()))
        .await
        .unwrap()
        .edges
        .is_empty());
    // Exactly one entry: the spelling did not fork the map.
    assert!(
        state
            .with_index(&format!("{root}/"), |idx| idx.is_none())
            .await
    );
}

#[tokio::test]
async fn rename_namespace_rebuilds_under_the_same_key_the_lookups_read() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    std::fs::create_dir(dir.path().join("ns")).unwrap();
    std::fs::write(dir.path().join("ns/c.md"), "see [[b]]").unwrap();
    let result = rename_namespace_inner(
        &state,
        &ctx,
        &format!("{root}/ns"),
        &format!("{root}/ns2"),
        &root,
    )
    .await
    .unwrap();
    assert!(result.index_rebuilt);
    assert!(result.skipped_files.is_empty());
    assert!(result.unchecked_files.is_empty());
    let key = active_index_key(&ctx).await.unwrap();
    let outgoing = outgoing_links(&state, &key).await;
    assert!(outgoing.contains_key(&format!("{root}/ns2/c.md")));
    assert!(!outgoing.contains_key(&format!("{root}/ns/c.md")));
}

#[tokio::test]
async fn update_file_index_edits_the_index_in_place() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    std::fs::write(dir.path().join("a.md"), "no link any more").unwrap();
    update_file_index_inner(&state, &ctx, &format!("{root}/a.md"))
        .await
        .unwrap();
    assert!(get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn a_save_that_lands_while_a_build_reads_is_replayed_onto_the_snapshot() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let key = active_index_key(&ctx).await.unwrap();

    // A background refresh has read a.md while it still links to b…
    let (token, snapshot, stats) = staged_build(&state, &ctx, &key, &root).await;
    // …then the user removes the link and the save re-indexes the file.
    std::fs::write(dir.path().join("a.md"), "no link any more").unwrap();
    update_file_index_inner(&state, &ctx, &format!("{root}/a.md"))
        .await
        .unwrap();
    // The snapshot is published WITH the save replayed: the newer state wins.
    assert_eq!(state.publish(&key, token, snapshot, stats).await, Some(1));
    assert!(get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
        .await
        .unwrap()
        .is_empty());

    // And the other way round: a save that ADDS a link during a build.
    let (token, snapshot, stats) = staged_build(&state, &ctx, &key, &root).await;
    std::fs::write(dir.path().join("a.md"), "see [[b]] again").unwrap();
    update_file_index_inner(&state, &ctx, &format!("{root}/a.md"))
        .await
        .unwrap();
    assert_eq!(state.publish(&key, token, snapshot, stats).await, Some(1));
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
        .await
        .unwrap();
    assert_eq!(sources(&backlinks), vec![format!("{root}/a.md")]);
}

#[tokio::test]
async fn a_save_during_the_very_first_build_is_part_of_what_that_build_publishes() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    let key = active_index_key(&ctx).await.unwrap();

    // The first build has read a.md linking to b…
    let (token, snapshot, stats) = staged_build(&state, &ctx, &key, &root).await;
    // …a save lands while there is no index at all yet: nothing to apply
    // to, but it is journaled for the build.
    std::fs::write(dir.path().join("a.md"), "no link any more").unwrap();
    update_file_index_inner(&state, &ctx, &format!("{root}/a.md"))
        .await
        .unwrap();
    assert!(state.with_index(&key, |idx| idx.is_none()).await);
    assert_eq!(state.publish(&key, token, snapshot, stats).await, Some(1));
    assert!(get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
        .await
        .unwrap()
        .is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn a_first_build_save_is_replayed_in_the_pending_symlink_roots_spelling() {
    // The child is registered through a symlink and is having its FIRST
    // build; the save arrives in the parent's spelling before it publishes.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("sub/target.md"), "target").unwrap();
    std::fs::write(dir.path().join("sub/inner.md"), "stale [[target]]").unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let alias_path = elsewhere.path().join("alias");
    std::os::unix::fs::symlink(dir.path().join("sub"), &alias_path).unwrap();
    let alias = alias_path.to_str().unwrap().to_string();
    ctx.add(info("ctx-child", &alias, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    let key = owning_index_key(&ctx, &alias).await.unwrap();
    let (token, snapshot, stats) = staged_build(&state, &ctx, &key, &alias).await;

    // Snapshot: /alias/inner.md → /alias/target.md. The save removes the link.
    std::fs::write(dir.path().join("sub/inner.md"), "link removed").unwrap();
    update_file_index_inner(&state, &ctx, &format!("{root}/sub/inner.md"))
        .await
        .unwrap();
    assert_eq!(state.publish(&key, token, snapshot, stats).await, Some(1));

    // Replayed in the ALIAS spelling: the stale entry is gone, nothing is
    // spelled under the parent root, no edge survives.
    let graph = state
        .with_index(&key, |idx| idx.unwrap().get_link_graph())
        .await;
    assert!(graph.nodes.contains(&format!("{alias}/inner.md")));
    assert!(!graph
        .nodes
        .iter()
        .any(|n| n.starts_with(&format!("{root}/sub/"))));
    assert!(graph.edges.is_empty());
    let stale = state
        .with_index(&key, |idx| idx.unwrap().get_files_linking_to("target"))
        .await;
    assert!(stale.is_empty());
}

#[tokio::test]
async fn an_in_flight_build_cannot_resurrect_a_forgotten_registration() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-old", true).await;
    let state = LinkIndexState::new();
    let key = root.clone();

    // The old registration's build holds the per-key build lock and has read.
    let build_lock = state.build_lock(&key).await;
    let old_guard = build_lock.lock().await;
    let old_request = state.version(&key).await;
    let old_incarnation = incarnation_of(&ctx, "ctx-old").await;
    let old_token = state
        .begin_build(&key, &old_request, &root, old_incarnation)
        .await
        .unwrap();
    let mut old_snapshot = LinkIndex::new();
    let old_stats = old_snapshot.build(&root).await.unwrap();

    // The context is removed (context_cmd forgets its slot) and re-added.
    ctx.remove("ctx-old").await.unwrap();
    state.forget(&key, old_incarnation).await;
    ctx.add(info("ctx-new", &root, ContextType::Folder))
        .await
        .unwrap();
    ctx.set_active("ctx-new").await.unwrap();

    // The new registration's refresh records its version while the old
    // build still owns the lock.
    let new_request = state.version(&key).await;
    assert_ne!(new_request.generation, old_request.generation);
    assert_eq!(new_request.epoch, 0);

    // A save after forget belongs to the new registration.
    std::fs::write(dir.path().join("a.md"), "link removed").unwrap();
    update_file_index_inner(&state, &ctx, &format!("{root}/a.md"))
        .await
        .unwrap();
    assert_eq!(state.version(&key).await.epoch, 1);

    // The old generation cannot publish, recreate the slot, or satisfy
    // the new refresh's coalescing.
    assert_eq!(
        state
            .publish(&key, old_token, old_snapshot, old_stats)
            .await,
        None
    );
    assert!(state.with_index(&key, |idx| idx.is_none()).await);
    assert!(state
        .published_since(&key, &new_request, incarnation_of(&ctx, "ctx-new").await)
        .await
        .is_none());

    // Nor make the rename gate read it: with no live index under the new
    // registration the gate builds one — behind the build lock the old
    // build still holds — so the rename waits rather than trusting
    // anything stale. (Dropping the parked future cancels it before it
    // could begin a build.)
    {
        use std::future::Future;
        let (old_name, new_name) = (format!("{root}/b.md"), format!("{root}/c.md"));
        let mut rename = Box::pin(rename_file_with_links_inner(
            &state, &ctx, &old_name, &new_name,
        ));
        let mut task = std::task::Context::from_waker(futures::task::noop_waker_ref());
        assert!(rename.as_mut().poll(&mut task).is_pending());
    }
    assert!(dir.path().join("b.md").exists());

    // Once the old build lets go, the new registration builds for itself
    // and reads the saved content.
    drop(old_guard);
    let _new_guard = build_lock.lock().await;
    let new_token = state
        .begin_build(
            &key,
            &new_request,
            &root,
            incarnation_of(&ctx, "ctx-new").await,
        )
        .await
        .unwrap();
    let mut new_snapshot = LinkIndex::new();
    let new_stats = new_snapshot.build(&root).await.unwrap();
    assert_eq!(
        state
            .publish(&key, new_token, new_snapshot, new_stats)
            .await,
        Some(0)
    );
    assert!(get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
        .await
        .unwrap()
        .is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn a_nested_root_registered_through_a_symlink_gets_mutations_in_its_own_spelling() {
    // /vault is registered; /elsewhere/alias → /vault/sub is registered as
    // its own context. Both indexes scan sub/, each in its own spelling.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("sub/target.md"), "t").unwrap();
    std::fs::write(dir.path().join("sub/inner.md"), "inner [[target]]").unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let alias = elsewhere.path().join("alias");
    std::os::unix::fs::symlink(dir.path().join("sub"), &alias).unwrap();
    let alias = alias.to_str().unwrap().to_string();
    ctx.add(info("ctx-child", &alias, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    refresh_index_inner(&state, &ctx, &alias).await.unwrap();

    // The rename arrives in the parent's spelling.
    rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/sub/target.md"),
        &format!("{root}/sub/renamed.md"),
    )
    .await
    .unwrap();
    // The child index was updated in ITS spelling: no ghost of the old
    // name, the new name present, nothing spelled under the parent root.
    let child = outgoing_links(&state, &alias).await;
    assert_eq!(
        child.get(&format!("{alias}/inner.md")),
        Some(&vec![format!("{alias}/renamed.md")])
    );
    assert!(!child.keys().any(|k| k.starts_with(&root)));
    let child_graph = get_link_index_inner(&state, &ctx, Some(alias.clone()))
        .await
        .unwrap();
    assert!(!child_graph.nodes.iter().any(|n| n.ends_with("/target.md")));
    // And the merged backlinks name inner.md once, in the query's spelling.
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/sub/renamed.md"))
        .await
        .unwrap();
    assert_eq!(sources(&backlinks), vec![format!("{root}/sub/inner.md")]);
}

#[tokio::test]
async fn forgetting_a_context_makes_the_next_registration_build_its_own_index() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    // The context is removed (context_cmd forgets its slot) and re-added:
    // the old index is gone, and the first rename under the new
    // registration builds a fresh one instead of trusting the old.
    let old = incarnation_of(&ctx, "ctx-abc").await;
    ctx.remove("ctx-abc").await.unwrap();
    state.forget(&root, old).await;
    assert!(state.with_index(&root, |idx| idx.is_none()).await);
    // Meanwhile the vault changed on disk — the old index would have said
    // `a.md` links to `b.md`; it no longer does.
    std::fs::write(dir.path().join("a.md"), "no link").unwrap();
    ctx.add(info("ctx-abc", &root, ContextType::Folder))
        .await
        .unwrap();
    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/b.md"),
        &format!("{root}/c.md"),
    )
    .await
    .unwrap();
    assert!(result.updated_files.is_empty());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
        "no link"
    );
    assert!(dir.path().join("c.md").exists());
    assert!(state.epoch(&root).await > 0);
}

#[tokio::test]
async fn nested_roots_a_rename_updates_each_index_only_with_the_files_it_covers() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("sub/target.md"), "para ^b1").unwrap();
    std::fs::write(dir.path().join("sub/inner.md"), "inner [[target]]").unwrap();
    std::fs::write(
        dir.path().join("outside.md"),
        // On separate lines: get_backlinks keeps one entry per (source, line).
        "outside [[target]]\nand ((target#^b1))",
    )
    .unwrap();
    let sub = format!("{root}/sub");
    ctx.add(info("ctx-child", &sub, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    refresh_index_inner(&state, &ctx, &sub).await.unwrap();

    async fn child_has_outside(state: &LinkIndexState, ctx: &ContextManager, sub: &str) -> bool {
        get_link_index_inner(state, ctx, Some(sub.to_string()))
            .await
            .unwrap()
            .nodes
            .iter()
            .any(|n| n.ends_with("/outside.md"))
    }
    assert!(!child_has_outside(&state, &ctx, &sub).await);

    // A block-id rename rewrites outside.md, which only the parent covers.
    let result = rename_block_id_inner(&state, &ctx, &format!("{sub}/target.md"), "b1", "b2")
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/outside.md")]);
    assert!(!child_has_outside(&state, &ctx, &sub).await);

    // So does a file rename.
    rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{sub}/target.md"),
        &format!("{sub}/renamed.md"),
    )
    .await
    .unwrap();
    assert!(!child_has_outside(&state, &ctx, &sub).await);
    // The parent still knows outside.md's link, to the new name.
    let outgoing = outgoing_links(&state, &root).await;
    assert_eq!(
        outgoing
            .get(&format!("{root}/outside.md"))
            .map(|t| t.contains(&format!("{sub}/renamed.md"))),
        Some(true)
    );
}

#[tokio::test]
async fn nested_roots_a_rename_builds_the_missing_enclosing_index_first() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("sub/target.md"), "t").unwrap();
    std::fs::write(dir.path().join("outside.md"), "outside [[target]]").unwrap();
    let sub = format!("{root}/sub");
    ctx.add(info("ctx-child", &sub, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    // Only the child's index has landed; the parent's (slower) has not.
    // The reference from `outside.md` is known only to the parent's index,
    // so the gate builds it before the rename — refusing here (as this
    // used to) would have left users of a never-opened nested folder
    // unable to rename anything inside it.
    refresh_index_inner(&state, &ctx, &sub).await.unwrap();
    assert!(state.with_index(&root, |idx| idx.is_none()).await);
    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{sub}/target.md"),
        &format!("{sub}/renamed.md"),
    )
    .await
    .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/outside.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("outside.md")).unwrap(),
        "outside [[renamed]]"
    );
    assert!(dir.path().join("sub/renamed.md").exists());
    assert_eq!(state.build_root(&root).await, Some(root.clone()));
}

#[tokio::test]
async fn concurrent_refreshes_of_one_vault_scan_it_once() {
    let ctx = ContextManager::new();
    let (_dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    let (a, b, c, d) = tokio::join!(
        refresh_index_inner(&state, &ctx, &root),
        refresh_index_inner(&state, &ctx, &root),
        refresh_index_inner(&state, &ctx, &root),
        refresh_index_inner(&state, &ctx, &root),
    );
    for r in [a, b, c, d] {
        r.unwrap();
    }
    let key = active_index_key(&ctx).await.unwrap();
    // One publication: the three that queued behind the first took its
    // stats instead of reading the vault again.
    assert_eq!(state.epoch(&key).await, 1);
    assert!(!outgoing_links(&state, &key).await.is_empty());
}

#[tokio::test]
async fn forget_before_version_cannot_be_adopted_by_an_old_refresh() {
    use std::future::Future;

    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-reused", true).await;
    let state = LinkIndexState::new();
    let old_spelling = format!("{root}/");

    let incarnation = incarnation_of(&ctx, "ctx-reused").await;
    let mut removal = Box::pin(state.forget(&root, incarnation));
    let mut old_refresh = Box::pin(refresh_index_inner(&state, &ctx, &old_spelling));

    // Hold the slots lock so both park on it: forget first (FIFO), then the
    // refresh — which has already resolved its owning key by then.
    let map = state.hold_slots().await;
    {
        let mut task = std::task::Context::from_waker(futures::task::noop_waker_ref());
        assert!(removal.as_mut().poll(&mut task).is_pending());
        assert!(old_refresh.as_mut().poll(&mut task).is_pending());
    }
    drop(map);

    ctx.remove("ctx-reused").await.unwrap();
    removal.await;
    // The same id is reused: an id comparison would not be a lifetime check.
    ctx.add(info("ctx-reused", &root, ContextType::Folder))
        .await
        .unwrap();
    ctx.set_active("ctx-reused").await.unwrap();
    std::fs::write(dir.path().join("a.md"), "link removed").unwrap();

    // The old refresh saw the removal counter move: refused, nothing published.
    assert_eq!(old_refresh.await.unwrap_err(), INDEX_LOOKUP_INVALIDATED);
    assert!(state.with_index(&root, |idx| idx.is_none()).await);

    // The new registration's own refresh builds in its own spelling.
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    assert_eq!(state.build_root(&root).await, Some(root.clone()));
    assert_eq!(state.epoch(&root).await, 1);
    assert!(get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn an_unrelated_removal_after_preparation_does_not_cancel_a_build() {
    let ctx = ContextManager::new();
    let (_a, root_a) = vault_with_a_link(&ctx, "ctx-a", true).await;
    let (_b, root_b) = vault_with_a_link(&ctx, "ctx-b", false).await;
    let state = LinkIndexState::new();
    let target = prepare_index_build(&state, &ctx, &root_a).await.unwrap();
    let incarnation_b = incarnation_of(&ctx, "ctx-b").await;
    ctx.remove("ctx-b").await.unwrap();
    state.forget(&root_b, incarnation_b).await;
    rebuild_and_publish(&state, &target, &root_a, true)
        .await
        .unwrap();
    assert_eq!(state.epoch(&target.key).await, 1);
    assert!(!outgoing_links(&state, &target.key).await.is_empty());
}

/// A vault with a directory `ns/` and a relative wikilink into it.
async fn namespace_fixture(ctx: &ContextManager) -> (tempfile::TempDir, String, String, String) {
    let (dir, root) = vault_with_a_link(ctx, "ctx-namespace", true).await;
    let old_dir = format!("{root}/ns");
    let new_dir = format!("{root}/ns2");
    std::fs::create_dir(&old_dir).unwrap();
    std::fs::write(dir.path().join("ns/c.md"), "target").unwrap();
    std::fs::write(dir.path().join("a.md"), "see [[./ns/c]]").unwrap();
    (dir, root, old_dir, new_dir)
}

#[tokio::test]
async fn a_committed_namespace_rename_survives_a_forget_between_build_and_publish() {
    let ctx = ContextManager::new();
    let (dir, root, old_dir, new_dir) = namespace_fixture(&ctx).await;
    let state = LinkIndexState::new();
    let target = prepare_index_build(&state, &ctx, &root).await.unwrap();
    let (key, generation) = (target.key.clone(), target.generation);
    let committed = commit_namespace_rename(&old_dir, &new_dir, &root)
        .await
        .unwrap();

    let build_lock = state.build_lock(&key).await;
    let old_guard = build_lock.lock().await;
    let (token, snapshot, stats) = staged_build(&state, &ctx, &key, &root).await;
    assert_eq!(token.generation, generation);

    // Files moved and scanned; before publish the context is removed and
    // re-added.
    let old_incarnation = incarnation_of(&ctx, "ctx-namespace").await;
    ctx.remove("ctx-namespace").await.unwrap();
    state.forget(&key, old_incarnation).await;
    ctx.add(info("ctx-namespace", &root, ContextType::Folder))
        .await
        .unwrap();
    ctx.set_active("ctx-namespace").await.unwrap();
    // (The re-added registration is refreshed with the same root spelling
    // the frontend has always used; a relative wikilink such as
    // `[[./ns2/c]]` resolves against that spelling.)
    let new_root = root.clone();
    let new_target = prepare_index_build(&state, &ctx, &new_root).await.unwrap();
    let (new_key, new_generation) = (new_target.key.clone(), new_target.generation);
    let new_request = state.version(&new_key).await;
    assert_ne!(generation, new_generation);

    let rejected = publish_built_index(&state, &key, token, snapshot, stats).await;
    assert!(matches!(&rejected, Err(IndexBuildError::Invalidated)));
    // The rename still reports what it did — and that the index is not there.
    assert!(!settle_namespace_rebuild(&state, &key, rejected).await);
    let result = committed;
    assert_eq!(result.files_moved, 1);
    assert_eq!(result.updated_files, vec![format!("{root}/a.md")]);
    assert!(!dir.path().join("ns").exists());
    assert!(dir.path().join("ns2/c.md").exists());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
        "see [[./ns2/c]]"
    );
    assert!(state.with_index(&key, |idx| idx.is_none()).await);
    assert!(state
        .published_since(
            &new_key,
            &new_request,
            incarnation_of(&ctx, "ctx-namespace").await,
        )
        .await
        .is_none());

    // The new registration builds for itself, in its own spelling.
    drop(old_guard);
    rebuild_and_publish(&state, &new_target, &new_root, false)
        .await
        .unwrap();
    assert_eq!(state.build_root(&new_key).await, Some(new_root));
    assert_eq!(state.epoch(&new_key).await, 1);
    // (Relative wikilinks like `[[./ns2/c]]` are keyed by their relative
    // target in the index, not by the target's stem, so the graph — not
    // get_backlinks — is where the new build shows.)
    let graph = get_link_index_inner(&state, &ctx, Some(root.clone()))
        .await
        .unwrap();
    assert!(graph.nodes.contains(&format!("{root}/a.md")));
    assert!(!graph.nodes.iter().any(|n| n.contains("/ns/")));
}

#[tokio::test]
async fn a_committed_namespace_rename_survives_a_forget_before_its_rebuild_starts() {
    let ctx = ContextManager::new();
    let (dir, root, old_dir, new_dir) = namespace_fixture(&ctx).await;
    let state = LinkIndexState::new();
    let target = prepare_index_build(&state, &ctx, &root).await.unwrap();
    let key = target.key.clone();
    let committed = commit_namespace_rename(&old_dir, &new_dir, &root)
        .await
        .unwrap();
    let old_incarnation = incarnation_of(&ctx, "ctx-namespace").await;
    ctx.remove("ctx-namespace").await.unwrap();
    state.forget(&key, old_incarnation).await;
    let rebuilt = rebuild_and_publish(&state, &target, &root, false).await;
    assert!(matches!(&rebuilt, Err(IndexBuildError::Invalidated)));
    assert!(!settle_namespace_rebuild(&state, &key, rebuilt).await);
    let result = committed;
    assert_eq!(result.files_moved, 1);
    assert!(!dir.path().join("ns").exists());
    assert!(dir.path().join("ns2/c.md").exists());
    assert!(state.with_index(&key, |idx| idx.is_none()).await);
}

#[tokio::test]
async fn a_committed_namespace_rename_reports_the_move_and_drops_an_index_it_could_not_rebuild() {
    let ctx = ContextManager::new();
    let (dir, root, old_dir, new_dir) = namespace_fixture(&ctx).await;
    let state = LinkIndexState::new();
    // A live index describing the OLD layout.
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let target = prepare_index_build(&state, &ctx, &root).await.unwrap();
    let key = target.key.clone();
    let committed = commit_namespace_rename(&old_dir, &new_dir, &root)
        .await
        .unwrap();
    // A build left pending (models a rebuild failure that is not a removal).
    let (token, _snapshot, _stats) = staged_build(&state, &ctx, &key, &root).await;
    let rebuilt = rebuild_and_publish(&state, &target, &root, false).await;
    assert!(matches!(&rebuilt, Err(IndexBuildError::Failed(_))));
    // The move is reported as what it is — done — and the index that still
    // describes the old layout is dropped instead of trusted; the next rename
    // rebuilds it through the gate. The result says the index is gone (issue
    // 594): the frontend warns and asks for a rebuild.
    assert!(!settle_namespace_rebuild(&state, &key, rebuilt).await);
    assert_eq!(committed.files_moved, 1);
    assert!(dir.path().join("ns2/c.md").exists());
    assert!(state.with_index(&key, |idx| idx.is_none()).await);
    state.abort_build(&key, token).await;
}

#[tokio::test]
async fn a_namespace_rebuild_never_coalesces_onto_a_snapshot_scanned_before_the_move() {
    use std::future::Future;

    let ctx = ContextManager::new();
    let (dir, root, old_dir, new_dir) = namespace_fixture(&ctx).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    // A background refresh has scanned the OLD layout and holds the build
    // lock, about to publish.
    let build_lock = state.build_lock(&root).await;
    let guard = build_lock.lock().await;
    let (token, stale, stale_stats) = staged_build(&state, &ctx, &root, &root).await;

    // The rename commits its file moves and starts its rebuild, which
    // reads its version and parks on the build lock.
    let target = prepare_index_build(&state, &ctx, &root).await.unwrap();

    commit_namespace_rename(&old_dir, &new_dir, &root)
        .await
        .unwrap();
    let mut rebuild = Box::pin(rebuild_and_publish(&state, &target, &root, false));
    {
        let mut task = std::task::Context::from_waker(futures::task::noop_waker_ref());
        assert!(rebuild.as_mut().poll(&mut task).is_pending());
    }

    // The stale refresh publishes — newer than the rename's request, but
    // describing the old layout.
    assert!(
        publish_built_index(&state, &root, token, stale, stale_stats)
            .await
            .is_ok()
    );
    drop(guard);

    // The rename does not take that publication for its own: it scans.
    rebuild.await.unwrap();
    let graph = get_link_index_inner(&state, &ctx, Some(root.clone()))
        .await
        .unwrap();
    assert!(graph.nodes.iter().any(|n| n.contains("/ns2/")));
    assert!(!graph.nodes.iter().any(|n| n.contains("/ns/")));
    assert!(!dir.path().join("ns").exists());
}

#[test]
fn outgoing_map_groups_edges_by_source() {
    let graph = LinkGraph {
        nodes: vec![],
        edges: vec![
            crate::index::LinkEdge {
                from: "/v/a.md".into(),
                to: "/v/b.md".into(),
                cross_vault: false,
            },
            crate::index::LinkEdge {
                from: "/v/a.md".into(),
                to: "/v/c.md".into(),
                cross_vault: false,
            },
        ],
    };
    let out = outgoing_map(&graph);
    assert_eq!(out["/v/a.md"], vec!["/v/b.md", "/v/c.md"]);
}

#[test]
fn spelled_under_compares_components_not_string_prefixes() {
    assert!(spelled_under("/x/Vault", "/x/Vault/a.md"));
    assert!(spelled_under("/x/Vault/", "/x/Vault/a.md"));
    // The root itself counts — the one row a string prefix built with a
    // trailing `/` gets wrong on every platform, so it pins that this is a
    // component comparison even where the Windows row cannot run.
    assert!(spelled_under("/x/Vault", "/x/Vault"));
    assert!(spelled_under("/x/Vault", "/x/Vault/sub/deep/a.md"));
    assert!(!spelled_under("/x/Vault", "/x/Vault-secret/a.md"));
    assert!(!spelled_under("/x/Vault", "/x/vault/a.md"));
    #[cfg(windows)]
    assert!(spelled_under(r"C:\vault", r"C:\vault\a.md"));
}

#[tokio::test]
async fn a_standalone_file_context_renames_with_no_cross_file_updates() {
    // §89: a file opened on its own, outside every folder. Its key is the
    // file path, which no build can fill — and there is no other file whose
    // references could need updating. The renames go through, the
    // backlinks are empty; none of it is an error.
    let dir = tempfile::tempdir().unwrap();
    let note = format!("{}/note.md", dir.path().to_str().unwrap());
    std::fs::write(&note, "block ^b1").unwrap();
    let ctx = ContextManager::new();
    ctx.add(info("ctx-file", &note, ContextType::File))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    assert!(get_backlinks_inner(&state, &ctx, &note)
        .await
        .unwrap()
        .is_empty());
    let result = rename_block_id_inner(&state, &ctx, &note, "b1", "b2")
        .await
        .unwrap();
    assert!(result.updated_files.is_empty());
    let renamed = format!("{}/renamed.md", dir.path().to_str().unwrap());
    let result = rename_file_with_links_inner(&state, &ctx, &note, &renamed)
        .await
        .unwrap();
    assert!(result.updated_files.is_empty());
    assert!(!std::path::Path::new(&note).exists());
    assert!(std::path::Path::new(&renamed).exists());
    // No index was built for a file key.
    assert!(state.with_index(&note, |idx| idx.is_none()).await);
}

#[tokio::test]
async fn a_hidden_nested_root_is_indexed_by_the_gate_not_covered_by_the_enclosing_index() {
    // `collect_md_files` skips dot-directories below a root but not the
    // root itself: `/vault` never scans `/vault/.journal`, while a context
    // registered AT `.journal` scans all of it. So the enclosing index is
    // not a superset of the nested one — requiring only the outermost
    // index would let this rename rewrite nothing. The gate builds the
    // nested index instead.
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_str().unwrap().to_string();
    std::fs::write(dir.path().join("note.md"), "plain").unwrap();
    std::fs::create_dir(dir.path().join(".journal")).unwrap();
    std::fs::write(dir.path().join(".journal/2026-09-07.md"), "entry").unwrap();
    std::fs::write(dir.path().join(".journal/index.md"), "see [[2026-09-07]]").unwrap();
    let journal = format!("{root}/.journal");
    let ctx = ContextManager::new();
    ctx.add(info("ctx-vault", &root, ContextType::Folder))
        .await
        .unwrap();
    ctx.set_active("ctx-vault").await.unwrap();
    ctx.add(info("ctx-journal", &journal, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    assert!(!outgoing_links(&state, &root)
        .await
        .keys()
        .any(|k| k.contains("/.journal/")));
    assert!(state.with_index(&journal, |idx| idx.is_none()).await);

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{journal}/2026-09-07.md"),
        &format!("{journal}/2026-09-08.md"),
    )
    .await
    .unwrap();
    assert_eq!(result.updated_files, vec![format!("{journal}/index.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join(".journal/index.md")).unwrap(),
        "see [[2026-09-08]]"
    );
    assert_eq!(state.build_root(&journal).await, Some(journal.clone()));
}

#[tokio::test]
async fn an_unrelated_removal_during_the_lookup_does_not_refuse_the_refresh() {
    use std::future::Future;
    // The pin of the narrowed refusal: a removal of ANOTHER context that
    // lands between resolving this root and reading its generation is none
    // of this refresh's business. (It used to refuse — and no caller asked
    // again, so that vault stayed unindexed for the session.)
    let ctx = ContextManager::new();
    let (_a, root_a) = vault_with_a_link(&ctx, "ctx-a", true).await;
    let (_b, root_b) = vault_with_a_link(&ctx, "ctx-b", false).await;
    let state = LinkIndexState::new();
    let incarnation_b = incarnation_of(&ctx, "ctx-b").await;
    let mut removal = Box::pin(state.forget(&root_b, incarnation_b));
    let mut refresh = Box::pin(refresh_index_inner(&state, &ctx, &root_a));
    // Same harness as `forget_before_version_…`: both park on the slots
    // lock, the removal first (FIFO), the refresh having resolved its key.
    let map = state.hold_slots().await;
    {
        let mut task = std::task::Context::from_waker(futures::task::noop_waker_ref());
        assert!(removal.as_mut().poll(&mut task).is_pending());
        assert!(refresh.as_mut().poll(&mut task).is_pending());
    }
    drop(map);
    ctx.remove("ctx-b").await.unwrap();
    removal.await;
    refresh.await.unwrap();
    assert_eq!(state.epoch(&root_a).await, 1);
    assert!(!outgoing_links(&state, &root_a).await.is_empty());
    assert!(state.with_index(&root_b, |idx| idx.is_none()).await);
}

#[tokio::test]
async fn a_build_root_that_is_not_a_registration_never_rebuilds_its_parent() {
    // With the owning context gone mid-lookup, "the deepest context
    // containing the root" is the parent; building the parent's key from
    // the subtree would replace its index with a partial one. A root must
    // be a registration itself.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("sub/inner.md"), "inner").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let before = outgoing_links(&state, &root).await;
    let err = refresh_index_inner(&state, &ctx, &format!("{root}/sub"))
        .await
        .unwrap_err();
    assert!(err.contains("not a registered context root"), "{err}");
    assert_eq!(outgoing_links(&state, &root).await, before);
    assert_eq!(state.build_root(&root).await, Some(root.clone()));
    assert_eq!(state.epoch(&root).await, 1);
}

#[tokio::test]
async fn a_stale_forget_does_not_wipe_the_index_of_a_newer_registration() {
    // `remove_context` removes from the ContextManager, then forgets the
    // slot after an await. If the same path is re-registered and rebuilt
    // inside that gap, the late `forget` carries the OLD incarnation and
    // must leave the new registration's index alone.
    let ctx = ContextManager::new();
    let (_dir, root) = vault_with_a_link(&ctx, "ctx-old", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let old_incarnation = incarnation_of(&ctx, "ctx-old").await;
    ctx.remove("ctx-old").await.unwrap();
    // …the forget has not run yet; the path is registered and built again.
    ctx.add(info("ctx-new", &root, ContextType::Folder))
        .await
        .unwrap();
    ctx.set_active("ctx-new").await.unwrap();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    assert_eq!(state.epoch(&root).await, 2);
    // The late forget of the old registration: ignored.
    state.forget(&root, old_incarnation).await;
    assert!(state.with_index(&root, |idx| idx.is_some()).await);
    assert_eq!(state.version(&root).await.generation, 0);
    // The new registration's own removal still tombstones.
    state
        .forget(&root, incarnation_of(&ctx, "ctx-new").await)
        .await;
    assert!(state.with_index(&root, |idx| idx.is_none()).await);
    assert_eq!(state.version(&root).await.generation, 1);
}

#[tokio::test]
async fn a_rename_destination_outside_the_files_contexts_is_refused() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let outside = format!("{}/taken.md", elsewhere.path().to_str().unwrap());
    // The source is in a vault; the destination would carry it out of every
    // context. Refused before a reference or the file is touched.
    let err = rename_file_with_links_inner(&state, &ctx, &format!("{root}/b.md"), &outside)
        .await
        .unwrap_err();
    assert!(err.contains("outside the contexts"), "{err}");
    assert!(dir.path().join("b.md").exists());
    assert!(!std::path::Path::new(&outside).exists());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
        "see [[b]]"
    );
    // A file opened on its own may only be renamed within its directory.
    let note = format!("{}/note.md", elsewhere.path().to_str().unwrap());
    std::fs::write(&note, "n").unwrap();
    ctx.add(info("ctx-file", &note, ContextType::File))
        .await
        .unwrap();
    let err = rename_file_with_links_inner(&state, &ctx, &note, &format!("{root}/moved.md"))
        .await
        .unwrap_err();
    assert!(err.contains("outside the contexts"), "{err}");
    assert!(std::path::Path::new(&note).exists());
}

#[tokio::test]
async fn a_namespace_rename_is_confined_to_its_root() {
    let ctx = ContextManager::new();
    let (dir, root, old_dir, new_dir) = namespace_fixture(&ctx).await;
    let state = LinkIndexState::new();
    let elsewhere = tempfile::tempdir().unwrap();
    let outside_dir = format!("{}/ns", elsewhere.path().to_str().unwrap());
    std::fs::create_dir(&outside_dir).unwrap();
    // A directory outside the root cannot be moved on the root's authority…
    let err = rename_namespace_inner(
        &state,
        &ctx,
        &outside_dir,
        &format!("{}/ns2", elsewhere.path().to_str().unwrap()),
        &root,
    )
    .await
    .unwrap_err();
    assert!(err.contains("not a move inside"), "{err}");
    assert!(std::path::Path::new(&outside_dir).exists());
    // …nor can one inside it be moved out…
    let err = rename_namespace_inner(
        &state,
        &ctx,
        &old_dir,
        &format!("{}/escaped", elsewhere.path().to_str().unwrap()),
        &root,
    )
    .await
    .unwrap_err();
    assert!(err.contains("not a move inside"), "{err}");
    assert!(dir.path().join("ns/c.md").exists());
    // …nor the root itself. A move inside the root goes through as before.
    assert!(
        rename_namespace_inner(&state, &ctx, &root, &format!("{root}-renamed"), &root)
            .await
            .is_err()
    );
    let result = rename_namespace_inner(&state, &ctx, &old_dir, &new_dir, &root)
        .await
        .unwrap();
    assert_eq!(result.files_moved, 1);
    assert!(dir.path().join("ns2/c.md").exists());
}

#[cfg(unix)]
#[tokio::test]
async fn a_referring_file_that_resolves_outside_the_vault_is_not_rewritten() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    // The index learned that a.md links to b.md…
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    // …then a.md was replaced by a symlink to a file outside the vault. The
    // index still names a.md; the rename must not write through it.
    let elsewhere = tempfile::tempdir().unwrap();
    let outside = elsewhere.path().join("outside.md");
    std::fs::write(&outside, "see [[b]]").unwrap();
    std::fs::remove_file(dir.path().join("a.md")).unwrap();
    std::os::unix::fs::symlink(&outside, dir.path().join("a.md")).unwrap();
    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/b.md"),
        &format!("{root}/c.md"),
    )
    .await
    .unwrap();
    assert!(result.updated_files.is_empty());
    assert_eq!(std::fs::read_to_string(&outside).unwrap(), "see [[b]]");
    assert!(dir.path().join("c.md").exists());
}

#[tokio::test]
async fn an_index_built_for_an_older_registration_does_not_satisfy_the_gate() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-old", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    // The context is removed and the same path registered again; the old
    // registration's `forget` has not run yet, so its index is still live —
    // and the directory changed meanwhile: a new file links to b.md.
    ctx.remove("ctx-old").await.unwrap();
    std::fs::write(dir.path().join("z.md"), "also [[b]]").unwrap();
    ctx.add(info("ctx-new", &root, ContextType::Folder))
        .await
        .unwrap();
    ctx.set_active("ctx-new").await.unwrap();
    assert!(state.with_index(&root, |idx| idx.is_some()).await);
    // The gate does not trust the old index: it rebuilds for the new
    // registration and the rename sees z.md. (With the old index, z.md would
    // have been left pointing at a file that no longer exists.)
    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/b.md"),
        &format!("{root}/c.md"),
    )
    .await
    .unwrap();
    assert_eq!(
        result.updated_files,
        vec![format!("{root}/a.md"), format!("{root}/z.md")]
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("z.md")).unwrap(),
        "also [[c]]"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn a_root_symlink_retargeted_after_the_lookup_is_not_scanned() {
    let target_a = tempfile::tempdir().unwrap();
    std::fs::write(target_a.path().join("a.md"), "see [[b]]").unwrap();
    std::fs::write(target_a.path().join("b.md"), "b").unwrap();
    let target_b = tempfile::tempdir().unwrap();
    std::fs::write(target_b.path().join("elsewhere.md"), "not this vault").unwrap();
    let holder = tempfile::tempdir().unwrap();
    let alias_path = holder.path().join("vault");
    std::os::unix::fs::symlink(target_a.path(), &alias_path).unwrap();
    let alias = alias_path.to_str().unwrap().to_string();
    let ctx = ContextManager::new();
    ctx.add(info("ctx-alias", &alias, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    let target = prepare_index_build(&state, &ctx, &alias).await.unwrap();
    // Between the lookup and the scan the symlink is pointed elsewhere.
    std::fs::remove_file(&alias_path).unwrap();
    std::os::unix::fs::symlink(target_b.path(), &alias_path).unwrap();
    let err = rebuild_and_publish(&state, &target, &alias, true)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("no longer names"), "{err}");
    assert!(state.with_index(&alias, |idx| idx.is_none()).await);
}

#[tokio::test]
async fn a_rename_onto_an_existing_file_or_directory_is_refused() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    // b.md exists; renaming a.md onto it would overwrite it (Unix `rename`
    // replaces). Refused, and a.md's references are untouched.
    let err = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a.md"),
        &format!("{root}/b.md"),
    )
    .await
    .unwrap_err();
    assert!(err.contains("already exists"), "{err}");
    assert_eq!(
        std::fs::read_to_string(dir.path().join("b.md")).unwrap(),
        "target"
    );
    assert!(dir.path().join("a.md").exists());
    // The same for a directory.
    std::fs::create_dir(dir.path().join("ns")).unwrap();
    std::fs::create_dir(dir.path().join("taken")).unwrap();
    let err = rename_namespace_inner(
        &state,
        &ctx,
        &format!("{root}/ns"),
        &format!("{root}/taken"),
        &root,
    )
    .await
    .unwrap_err();
    assert!(err.contains("already exists"), "{err}");
    assert!(dir.path().join("ns").exists());
}

#[tokio::test]
async fn a_query_does_not_read_an_index_left_by_an_earlier_registration() {
    let ctx = ContextManager::new();
    let (_dir, root) = vault_with_a_link(&ctx, "ctx-old", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    assert!(!get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
        .await
        .unwrap()
        .is_empty());
    // Removed and registered again, the old forget still pending: the old
    // index is live under the key but was published for another registration.
    ctx.remove("ctx-old").await.unwrap();
    ctx.add(info("ctx-new", &root, ContextType::Folder))
        .await
        .unwrap();
    ctx.set_active("ctx-new").await.unwrap();
    assert!(state.with_index(&root, |idx| idx.is_some()).await);
    assert!(get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
        .await
        .unwrap()
        .is_empty());
    assert!(get_link_index_inner(&state, &ctx, None)
        .await
        .unwrap()
        .edges
        .is_empty());
    assert!(graph_term_for_active(&state, &ctx).await.is_empty());
    // Its own refresh makes the index count again.
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    assert!(!get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn a_namespace_rename_drops_the_indexes_of_nested_contexts_it_moved_through() {
    // /v and /v/sub both registered and indexed; /v/sub/ns is renamed with /v as
    // the root. /v is rebuilt by the rename; /v/sub's index described the old
    // layout and must not survive as a live index the gate would trust.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
    std::fs::create_dir_all(dir.path().join("sub/ns")).unwrap();
    std::fs::write(dir.path().join("sub/ns/c.md"), "target").unwrap();
    std::fs::write(dir.path().join("sub/a.md"), "see [[./ns/c]]").unwrap();
    let sub = format!("{root}/sub");
    ctx.add(info("ctx-child", &sub, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    refresh_index_inner(&state, &ctx, &sub).await.unwrap();
    let child = incarnation_of(&ctx, "ctx-child").await;
    assert!(state.with_index_for(&sub, child, |i| i.is_some()).await);

    rename_namespace_inner(
        &state,
        &ctx,
        &format!("{sub}/ns"),
        &format!("{sub}/ns2"),
        &root,
    )
    .await
    .unwrap();
    assert!(dir.path().join("sub/ns2/c.md").exists());
    // The parent's index is fresh, the child's is gone…
    assert!(!outgoing_links(&state, &root)
        .await
        .values()
        .flatten()
        .any(|t| t.contains("/ns/")));
    assert!(state.with_index_for(&sub, child, |i| i.is_none()).await);
    // …and the next rename inside the child rebuilds it through the gate.
    rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{sub}/ns2/c.md"),
        &format!("{sub}/ns2/d.md"),
    )
    .await
    .unwrap();
    assert!(state.with_index_for(&sub, child, |i| i.is_some()).await);
    assert!(!outgoing_links(&state, &sub)
        .await
        .values()
        .flatten()
        .any(|t| t.contains("/ns/")));
}

#[tokio::test]
async fn a_namespace_rename_refuses_to_move_a_registered_folder_or_one_that_holds_one() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
    std::fs::create_dir_all(dir.path().join("outer/sub")).unwrap();
    std::fs::write(dir.path().join("outer/sub/n.md"), "n").unwrap();
    let sub = format!("{root}/outer/sub");
    ctx.add(info("ctx-child", &sub, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    // The registered folder itself…
    let err = rename_namespace_inner(&state, &ctx, &sub, &format!("{root}/outer/sub2"), &root)
        .await
        .unwrap_err();
    assert!(err.contains("registered folder"), "{err}");
    assert!(dir.path().join("outer/sub/n.md").exists());
    // …and a directory that holds one.
    let err = rename_namespace_inner(
        &state,
        &ctx,
        &format!("{root}/outer"),
        &format!("{root}/outer2"),
        &root,
    )
    .await
    .unwrap_err();
    assert!(err.contains("registered folder"), "{err}");
    assert!(dir.path().join("outer/sub/n.md").exists());
    assert_eq!(
        ctx.registration("ctx-child").await.map(|r| r.0),
        Some(sub.clone())
    );
}

#[tokio::test]
async fn the_graph_term_reaches_hybrid_ranking_and_changes_the_order() {
    use crate::embedding::hybrid_ranker::{hybrid_rank, RankedChunk};
    use std::collections::HashMap;
    // The shape of issue 263: an id nothing like the path. The graph term comes
    // from the real index and moves the linked file up.
    let ctx = ContextManager::new();
    let (_dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let outgoing = graph_term_for_active(&state, &ctx).await;
    assert_eq!(
        outgoing.get(&format!("{root}/a.md")),
        Some(&vec![format!("{root}/b.md")])
    );
    let chunks = |names: &[&str]| -> Vec<RankedChunk> {
        names
            .iter()
            .enumerate()
            .map(|(i, name)| RankedChunk {
                id: format!("c{i}"),
                file_path: format!("{root}/{name}.md"),
                score: 0.9 - 0.01 * i as f32,
            })
            .collect()
    };
    // Five candidates, BM25 tied, vector similarity descending; b.md (the file
    // a.md links to) sits third by vector alone.
    let scores = [0.9f32, 0.89, 0.88, 0.87, 0.86];
    let contents: HashMap<String, String> = (0..5)
        .map(|i| (format!("c{i}"), "lorem ipsum".to_string()))
        .collect();
    let current = format!("{root}/a.md");
    let names = ["x", "y", "b", "z", "w"];
    let without = hybrid_rank(
        "release checklist",
        chunks(&names),
        &scores,
        &contents,
        Some(&current),
        &HashMap::new(),
        5,
    );
    let with = hybrid_rank(
        "release checklist",
        chunks(&names),
        &scores,
        &contents,
        Some(&current),
        &outgoing,
        5,
    );
    assert_eq!(without[0].file_path, format!("{root}/x.md"));
    assert_eq!(with[0].file_path, format!("{root}/b.md"));
    // No active context: the term is empty, not an error.
    ctx.remove("ctx-abc").await.unwrap();
    assert!(graph_term_for_active(&state, &ctx).await.is_empty());
}

#[tokio::test]
async fn a_saved_file_that_cannot_be_read_leaves_the_index_instead_of_losing_its_links() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    assert_eq!(
        sources(
            &get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
                .await
                .unwrap()
        ),
        vec![format!("{root}/a.md")]
    );
    // a.md vanishes between the save and the re-index call.
    std::fs::remove_file(dir.path().join("a.md")).unwrap();
    update_file_index_inner(&state, &ctx, &format!("{root}/a.md"))
        .await
        .unwrap();
    // Removed from the index: no node, no backlink — rather than a node with
    // zero links standing in for a file that is not there.
    assert!(get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
        .await
        .unwrap()
        .is_empty());
    assert!(!outgoing_links(&state, &root)
        .await
        .contains_key(&format!("{root}/a.md")));
    assert!(!get_link_index_inner(&state, &ctx, None)
        .await
        .unwrap()
        .nodes
        .contains(&format!("{root}/a.md")));
}

#[test]
fn the_slot_map_is_locked_only_inside_state_rs() {
    // The header's "by construction" claim: the map is private to state.rs and
    // every critical section there is synchronous. This pins the first half —
    // no other file in the service takes the lock (a new file could otherwise
    // hold it across an await unnoticed).
    let needle = ["slots", ".lock("].concat();
    for (name, src) in [
        ("build.rs", include_str!("build.rs")),
        ("keys.rs", include_str!("keys.rs")),
        ("query.rs", include_str!("query.rs")),
        ("rename.rs", include_str!("rename.rs")),
        ("mod.rs", include_str!("mod.rs")),
        ("tests.rs", include_str!("tests.rs")),
    ] {
        assert!(
            !src.contains(&needle),
            "{name} takes the slot lock directly"
        );
    }
    assert!(include_str!("state.rs").contains(&needle));
}

#[tokio::test]
async fn a_namespace_rename_drops_the_index_of_a_context_that_holds_the_destination() {
    // /v and /v/dest registered and indexed; /v/src/ns moves INTO /v/dest. The
    // /v/dest index never covered the moved files and must not stay live
    // (it would say the moved referrers do not exist).
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
    std::fs::create_dir_all(dir.path().join("src/ns")).unwrap();
    std::fs::create_dir_all(dir.path().join("dest")).unwrap();
    std::fs::write(dir.path().join("src/ns/c.md"), "target").unwrap();
    std::fs::write(dir.path().join("dest/d.md"), "plain").unwrap();
    let dest = format!("{root}/dest");
    ctx.add(info("ctx-dest", &dest, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    refresh_index_inner(&state, &ctx, &dest).await.unwrap();
    let dest_incarnation = incarnation_of(&ctx, "ctx-dest").await;
    rename_namespace_inner(
        &state,
        &ctx,
        &format!("{root}/src/ns"),
        &format!("{dest}/ns"),
        &root,
    )
    .await
    .unwrap();
    assert!(dir.path().join("dest/ns/c.md").exists());
    assert!(
        state
            .with_index_for(&dest, dest_incarnation, |i| i.is_none())
            .await
    );
}

#[tokio::test]
async fn a_build_that_read_before_a_namespace_move_cannot_publish_after_the_drop() {
    // The child's build has read the OLD layout and is paused before publish;
    // the parent-rooted move drops the child's index. The paused build must
    // not reinstall its pre-move snapshot.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
    std::fs::create_dir_all(dir.path().join("sub/ns")).unwrap();
    std::fs::write(dir.path().join("sub/ns/c.md"), "target").unwrap();
    let sub = format!("{root}/sub");
    ctx.add(info("ctx-child", &sub, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let (token, snapshot, stats) = staged_build(&state, &ctx, &sub, &sub).await;
    rename_namespace_inner(
        &state,
        &ctx,
        &format!("{sub}/ns"),
        &format!("{sub}/ns2"),
        &root,
    )
    .await
    .unwrap();
    assert_eq!(state.publish(&sub, token, snapshot, stats).await, None);
    assert!(state.with_index(&sub, |i| i.is_none()).await);
}

#[tokio::test]
async fn a_reserved_subtree_refuses_registrations_until_the_move_is_over() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
    std::fs::create_dir_all(dir.path().join("ns/inner")).unwrap();
    let ns_canonical = dir.path().join("ns").canonicalize().unwrap();
    {
        let _reservation = ctx.reserve_subtree(&ns_canonical).await.unwrap();
        let err = ctx
            .add(info(
                "ctx-late",
                &format!("{root}/ns/inner"),
                ContextType::Folder,
            ))
            .await
            .unwrap_err();
        assert!(err.contains("being renamed"), "{err}");
        let err = ctx
            .add(info(
                "ctx-late2",
                &format!("{root}/ns"),
                ContextType::Folder,
            ))
            .await
            .unwrap_err();
        assert!(err.contains("being renamed"), "{err}");
        // A sibling is unaffected.
        std::fs::create_dir_all(dir.path().join("other")).unwrap();
        ctx.add(info(
            "ctx-other",
            &format!("{root}/other"),
            ContextType::Folder,
        ))
        .await
        .unwrap();
    }
    // Released on drop.
    ctx.add(info(
        "ctx-late",
        &format!("{root}/ns/inner"),
        ContextType::Folder,
    ))
    .await
    .unwrap();
    // And a subtree that already holds a registration cannot be reserved.
    assert!(ctx.reserve_subtree(&ns_canonical).await.is_err());
}

#[cfg(unix)]
#[tokio::test]
async fn a_symlinked_directory_is_not_renamed_as_a_namespace() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
    std::fs::create_dir_all(dir.path().join("real")).unwrap();
    std::os::unix::fs::symlink(dir.path().join("real"), dir.path().join("alias")).unwrap();
    let state = LinkIndexState::new();
    let err = rename_namespace_inner(
        &state,
        &ctx,
        &format!("{root}/alias"),
        &format!("{root}/alias2"),
        &root,
    )
    .await
    .unwrap_err();
    assert!(err.contains("symlink"), "{err}");
    assert!(dir.path().join("alias").exists());
    assert!(dir.path().join("real").exists());
}

#[cfg(unix)]
#[tokio::test]
async fn an_unreadable_but_present_file_leaves_the_index_unchanged() {
    use std::os::unix::fs::PermissionsExt;
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let a = dir.path().join("a.md");
    std::fs::set_permissions(&a, std::fs::Permissions::from_mode(0o000)).unwrap();
    let readable = std::fs::read_to_string(&a).is_ok(); // true only as root
    update_file_index_inner(&state, &ctx, &format!("{root}/a.md"))
        .await
        .unwrap();
    std::fs::set_permissions(&a, std::fs::Permissions::from_mode(0o644)).unwrap();
    if !readable {
        // Not gone, not emptied: the index still knows a.md links to b.md.
        assert_eq!(
            sources(
                &get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
                    .await
                    .unwrap()
            ),
            vec![format!("{root}/a.md")]
        );
    }
}

#[tokio::test]
async fn a_renamed_files_content_is_indexed_under_its_new_path() {
    // Read before the move, so the index never loses the file between the old
    // path's removal and a read-back of the new one.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a.md"),
        &format!("{root}/renamed.md"),
    )
    .await
    .unwrap();
    assert!(dir.path().join("renamed.md").exists());
    assert_eq!(
        sources(
            &get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
                .await
                .unwrap()
        ),
        vec![format!("{root}/renamed.md")]
    );
}

/// A directory nobody can create files in. `fs::write_file` writes a tmp file
/// beside its target and renames it over, so a read-only FILE does not stop
/// it — a read-only PARENT does. Returns whether the lock took (it does not
/// as root); the caller restores the mode before the TempDir is dropped.
#[cfg(unix)]
fn lock_directory(dir: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o555)).unwrap();
    std::fs::write(dir.join("probe.tmp"), "").is_err()
}

#[cfg(unix)]
fn unlock_directory(dir: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o755)).unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn a_file_rename_reports_the_referrer_it_could_not_rewrite() {
    // issue 594: the file has moved by the time a referrer fails to write, so
    // the rename is not a failure — but the referrer's links still say the
    // old name, and that reaches the result instead of only the log.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    std::fs::create_dir(dir.path().join("ro")).unwrap();
    std::fs::write(dir.path().join("ro/ref.md"), "also [[b]]").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let locked = lock_directory(&dir.path().join("ro"));
    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/b.md"),
        &format!("{root}/c.md"),
    )
    .await;
    unlock_directory(&dir.path().join("ro"));
    let result = result.unwrap();
    assert!(dir.path().join("c.md").exists());
    assert_eq!(result.updated_files, vec![format!("{root}/a.md")]);
    if !locked {
        return; // root: every write succeeds, nothing to report
    }
    assert_eq!(result.skipped_files, vec![format!("{root}/ro/ref.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("ro/ref.md")).unwrap(),
        "also [[b]]"
    );
    // The index followed the files: a.md now links to c, ref.md still to b.
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/c.md"))
        .await
        .unwrap();
    assert_eq!(sources(&backlinks), vec![format!("{root}/a.md")]);
}

#[cfg(unix)]
#[tokio::test]
async fn a_block_id_rename_past_its_first_write_reports_instead_of_failing() {
    // issue 594: once one referrer has been rewritten there is no "nothing
    // changed" to fall back to. The second referrer's failure used to come
    // back as `Err` — with the first already saying `b2` and the index never
    // told. Now the command finishes what it can and names what it could not.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    std::fs::write(dir.path().join("target.md"), "para ^b1").unwrap();
    std::fs::write(dir.path().join("x.md"), "see ((target#^b1))").unwrap();
    std::fs::create_dir(dir.path().join("ro")).unwrap();
    std::fs::write(dir.path().join("ro/y.md"), "see ((target#^b1))").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let locked = lock_directory(&dir.path().join("ro"));
    let result =
        rename_block_id_inner(&state, &ctx, &format!("{root}/target.md"), "b1", "b2").await;
    unlock_directory(&dir.path().join("ro"));
    let result = result.unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/x.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("x.md")).unwrap(),
        "see ((target#^b2))"
    );
    if !locked {
        return;
    }
    assert_eq!(result.skipped_files, vec![format!("{root}/ro/y.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("ro/y.md")).unwrap(),
        "see ((target#^b1))"
    );
    // The index knows the file that WAS rewritten under its new id.
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/target.md"))
        .await
        .unwrap();
    let ids: Vec<(&str, Option<&str>)> = backlinks
        .iter()
        .map(|b| (b.source_path.as_str(), b.block_id.as_deref()))
        .collect();
    assert!(
        ids.contains(&(format!("{root}/x.md").as_str(), Some("b2"))),
        "{ids:?}"
    );
    assert!(
        ids.contains(&(format!("{root}/ro/y.md").as_str(), Some("b1"))),
        "{ids:?}"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn a_namespace_rename_moves_the_directory_before_it_writes_any_referrer() {
    // issue 594: the referrer rewrites used to come BEFORE the move, so a
    // referrer that could not be written left the earlier ones pointing at a
    // directory that did not exist, under an `Err` that claimed nothing had
    // changed. Now the move is the last step that can fail; a referrer that
    // cannot be written afterwards is reported.
    let ctx = ContextManager::new();
    let (dir, root, old_dir, new_dir) = namespace_fixture(&ctx).await;
    std::fs::create_dir(dir.path().join("ro")).unwrap();
    std::fs::write(dir.path().join("ro/d.md"), "see [[../ns/c]]").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let locked = lock_directory(&dir.path().join("ro"));
    let result = rename_namespace_inner(&state, &ctx, &old_dir, &new_dir, &root).await;
    unlock_directory(&dir.path().join("ro"));
    let result = result.unwrap();
    assert!(!dir.path().join("ns").exists());
    assert!(dir.path().join("ns2/c.md").exists());
    assert_eq!(result.files_moved, 1);
    assert_eq!(result.updated_files, vec![format!("{root}/a.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
        "see [[./ns2/c]]"
    );
    assert!(result.index_rebuilt);
    if !locked {
        return;
    }
    assert_eq!(result.skipped_files, vec![format!("{root}/ro/d.md")]);
    assert!(result.unchecked_files.is_empty());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("ro/d.md")).unwrap(),
        "see [[../ns/c]]"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn a_namespace_rename_reports_a_file_it_could_not_read_apart_from_a_referrer_it_could_not_write(
) {
    // issue 594: the namespace path scans every file outside the directory,
    // so a file that cannot be READ is not known to refer to it at all. It is
    // reported as unchecked, not accused of holding stale links.
    use std::os::unix::fs::PermissionsExt;
    let ctx = ContextManager::new();
    let (dir, root, old_dir, new_dir) = namespace_fixture(&ctx).await;
    std::fs::write(dir.path().join("unrelated.md"), "nothing to do with ns").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let unrelated = dir.path().join("unrelated.md");
    std::fs::set_permissions(&unrelated, std::fs::Permissions::from_mode(0o000)).unwrap();
    let readable = std::fs::read_to_string(&unrelated).is_ok(); // true only as root
    let result = rename_namespace_inner(&state, &ctx, &old_dir, &new_dir, &root).await;
    std::fs::set_permissions(&unrelated, std::fs::Permissions::from_mode(0o644)).unwrap();
    let result = result.unwrap();
    assert!(dir.path().join("ns2/c.md").exists());
    assert_eq!(result.updated_files, vec![format!("{root}/a.md")]);
    assert!(result.skipped_files.is_empty());
    if readable {
        return;
    }
    assert_eq!(result.unchecked_files, vec![format!("{root}/unrelated.md")]);
}

#[tokio::test]
async fn a_block_id_rename_leaves_another_notes_block_with_the_same_id_alone() {
    // issue 594: `x.md` refers to target's ^b1 AND to other's ^b1, on one line
    // and on separate lines. Only the references to target change; the
    // reference to `other` keeps its ID, and so does a self-reference.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    std::fs::write(dir.path().join("target.md"), "para ^b1").unwrap();
    std::fs::write(dir.path().join("other.md"), "para ^b1").unwrap();
    std::fs::write(
        dir.path().join("x.md"),
        // The last line pairs a wikilink and a block reference to the same
        // file: `get_backlinks` keeps one entry per (source, line) and would
        // have hidden the block reference behind the wikilink.
        "((target#^b1)) and ((other#^b1))\n((other#^b1)) alone\n((#^b1)) mine ^b1\n((Target.md#^b1|label))\n[[target]] ((target#^b1))",
    )
    .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let result = rename_block_id_inner(&state, &ctx, &format!("{root}/target.md"), "b1", "b2")
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/x.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("x.md")).unwrap(),
        "((target#^b2)) and ((other#^b1))\n((other#^b1)) alone\n((#^b1)) mine ^b1\n((Target.md#^b2|label))\n[[target]] ((target#^b2))"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("other.md")).unwrap(),
        "para ^b1"
    );
}
