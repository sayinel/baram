use super::*;

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
        .with_index(&key, |idx| {
            idx.unwrap()
                .referring_lines_to(&format!("{alias}/target.md"), &[])
        })
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
async fn a_query_does_not_read_an_index_left_by_an_earlier_registration() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-old", true).await;
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
    assert!(graph_term_for_active(&state, &ctx).await.is_empty());
    // The graph builds an index for the new registration (issue 790) instead
    // of reading the old one: with the link gone from disk, the old index
    // would still answer `a -> b`.
    std::fs::write(dir.path().join("a.md"), "no link").unwrap();
    assert!(get_link_index_inner(&state, &ctx, None)
        .await
        .unwrap()
        .edges
        .is_empty());
    std::fs::write(dir.path().join("a.md"), "see [[b]]").unwrap();
    // Its own refresh makes the index count again.
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    assert!(!get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
        .await
        .unwrap()
        .is_empty());
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
    // hold it across an await unnoticed). The walk reads every `.rs` file under
    // the service directory, so a new file is scanned the moment it exists. The
    // walk must reach one file at the root and one in each subdirectory there is
    // today, so a walk that stops recursing or starts elsewhere cannot pass.
    // Directories whose name starts with `.` are skipped: tooling leaves ignored
    // folders such as `.omc/` here, and a stray file in one is no module of the
    // crate. A file that cannot be read fails with its path.
    // What fails this: skipping every directory named `tests` in the walk —
    // `the walk never reached ["tests/mod.rs"]`; walking `service/rename` instead
    // of `service` — the same message naming all three files; dropping the
    // dot-directory skip with a `.omc/stray.rs` holding the needle present —
    // `.omc/stray.rs takes the slot lock directly`.
    let needle = ["slots", ".lock("].concat();
    let root = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/src/index/service"));
    let mut pending = vec![root.to_path_buf()];
    let mut visited = std::collections::BTreeSet::new();
    let mut state_takes_it = false;
    while let Some(dir) = pending.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                let hidden = path
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with('.'));
                if !hidden {
                    pending.push(path);
                }
                continue;
            }
            if path.extension() != Some(std::ffi::OsStr::new("rs")) {
                continue;
            }
            let src = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            let name = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            visited.insert(name.clone());
            if name == "state.rs" {
                state_takes_it = src.contains(&needle);
            } else {
                assert!(
                    !src.contains(&needle),
                    "{name} takes the slot lock directly"
                );
            }
        }
    }
    let missing: Vec<&str> = ["state.rs", "rename/file.rs", "tests/mod.rs"]
        .into_iter()
        .filter(|name| !visited.contains(*name))
        .collect();
    assert!(
        missing.is_empty(),
        "the walk never reached {missing:?} under {}",
        root.display()
    );
    assert!(state_takes_it, "state.rs no longer takes the slot lock");
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
async fn a_suffixed_link_keeps_its_graph_target_across_saves() {
    // What fails this: one name-or-relative-path `find` in
    // `spelled_note_name` — `to("s.md")` returns the nested `a/x.md` after the save.
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_str().unwrap().to_string();
    std::fs::create_dir(dir.path().join("a")).unwrap();
    for (p, c) in [
        ("x.md", "t\n"),
        ("a/x.md", "t\n"),
        ("r.md", "[[x]]\n"),
        ("s.md", "[[x.md]]\n"),
    ] {
        std::fs::write(dir.path().join(p), c).unwrap();
    }
    let ctx = ContextManager::new();
    ctx.add(info("ctx-v", &root, ContextType::Folder))
        .await
        .unwrap();
    ctx.set_active("ctx-v").await.unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    // A save moves the saved note to the end of its stem's list.
    update_file_index_inner(&state, &ctx, &format!("{root}/x.md"))
        .await
        .unwrap();
    let graph = get_link_index_inner(&state, &ctx, None).await.unwrap();
    let to = |from: &str| {
        graph
            .edges
            .iter()
            .find(|e| e.from == format!("{root}/{from}"))
            .map(|e| e.to.clone())
    };
    assert_eq!(to("r.md"), Some(format!("{root}/x.md")));
    assert_eq!(to("s.md"), Some(format!("{root}/x.md")));
}
