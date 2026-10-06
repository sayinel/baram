use super::*;

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
    let committed = commit_namespace_rename(
        &old_dir,
        &new_dir,
        &root,
        &crate::fs::VaultExclusion::load(std::path::Path::new(&root)).unwrap(),
    )
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
    let committed = commit_namespace_rename(
        &old_dir,
        &new_dir,
        &root,
        &crate::fs::VaultExclusion::load(std::path::Path::new(&root)).unwrap(),
    )
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
    let committed = commit_namespace_rename(
        &old_dir,
        &new_dir,
        &root,
        &crate::fs::VaultExclusion::load(std::path::Path::new(&root)).unwrap(),
    )
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

    commit_namespace_rename(
        &old_dir,
        &new_dir,
        &root,
        &crate::fs::VaultExclusion::load(std::path::Path::new(&root)).unwrap(),
    )
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
