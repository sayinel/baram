use super::*;

fn paths(list: &[(&str, bool)]) -> Vec<SyncPath> {
    list.iter()
        .map(|(path, changed_only)| SyncPath {
            path: path.to_string(),
            changed_only: *changed_only,
        })
        .collect()
}

async fn sync(state: &LinkIndexState, ctx: &ContextManager, list: &[(&str, bool)]) -> Vec<String> {
    sync_index_paths_inner(state, ctx, &paths(list))
        .await
        .unwrap()
}

/// The backlinks of `note`, sorted.
async fn sources_of(state: &LinkIndexState, ctx: &ContextManager, note: &str) -> Vec<String> {
    let found = get_backlinks_inner(state, ctx, note).await.unwrap();
    let mut out: Vec<String> = sources(&found).into_iter().map(String::from).collect();
    out.sort();
    out
}

/// How the first link of `note` resolves in the live index under `key`.
async fn resolution_of(
    state: &LinkIndexState,
    key: &str,
    note: &str,
) -> crate::index::LinkResolution {
    state
        .with_index(key, |idx| {
            idx.unwrap().outgoing_resolved(note).unwrap()[0].1.clone()
        })
        .await
}

/// `vault_with_a_link` (a.md → b.md), with `extra` files written first, built and published.
async fn built(
    ctx: &ContextManager,
    extra: &[(&str, &str)],
) -> (tempfile::TempDir, String, LinkIndexState) {
    let (dir, root) = vault_with_a_link(ctx, "ctx-a", true).await;
    for (file, content) in extra {
        let path = dir.path().join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }
    let state = LinkIndexState::new();
    refresh_index_inner(&state, ctx, &root).await.unwrap();
    (dir, root, state)
}

#[tokio::test]
async fn a_new_note_and_a_markdown_extension_note_are_indexed_and_announced() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[]).await;
    std::fs::write(dir.path().join("c.md"), "see [[b]]").unwrap();
    std::fs::write(dir.path().join("d.markdown"), "see [[b]]").unwrap();

    let ids = sync(
        &state,
        &ctx,
        &[
            (&format!("{root}/c.md"), false),
            (&format!("{root}/d.markdown"), false),
        ],
    )
    .await;

    assert_eq!(ids, vec!["ctx-a"]);
    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![
            format!("{root}/a.md"),
            format!("{root}/c.md"),
            format!("{root}/d.markdown")
        ]
    );
}

#[tokio::test]
async fn an_attachment_that_appears_resolves_and_is_announced() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[("n.md", "see [[paper.pdf]]")]).await;
    let key = active_index_key(&ctx).await.unwrap();
    let note = format!("{root}/n.md");
    assert_eq!(
        resolution_of(&state, &key, &note).await,
        crate::index::LinkResolution::Unresolved
    );

    std::fs::write(dir.path().join("paper.pdf"), "%PDF").unwrap();
    let ids = sync(&state, &ctx, &[(&format!("{root}/paper.pdf"), false)]).await;

    assert_eq!(ids, vec!["ctx-a"]);
    assert!(matches!(
        resolution_of(&state, &key, &note).await,
        crate::index::LinkResolution::Resolved(_)
    ));
}

/// What fails this: walking a directory on its own metadata change — the second half shows the
/// same directory IS walked when the event was not `changed` only.
#[tokio::test]
async fn a_directorys_own_metadata_change_touches_nothing_and_a_moved_in_folder_is_walked() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[]).await;
    let key = active_index_key(&ctx).await.unwrap();
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("sub/e.md"), "see [[b]]").unwrap();
    std::fs::write(dir.path().join("sub/img.png"), "png").unwrap();
    let sub = format!("{root}/sub");

    let epoch = state.epoch(&key).await;
    assert!(sync(&state, &ctx, &[(&sub, true)]).await.is_empty());
    assert_eq!(
        state.epoch(&key).await,
        epoch,
        "no apply for a changed-only directory"
    );

    let before = walks();
    assert_eq!(sync(&state, &ctx, &[(&sub, false)]).await, vec!["ctx-a"]);
    assert_eq!(walks(), before + 1, "the positive half of the walk counter");
    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![format!("{root}/a.md"), format!("{root}/sub/e.md")]
    );
}

#[tokio::test]
async fn a_deleted_folder_takes_its_notes_with_it() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[("sub/e.md", "see [[b]]")]).await;
    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md"))
            .await
            .len(),
        2
    );
    std::fs::remove_dir_all(dir.path().join("sub")).unwrap();

    assert_eq!(
        sync(&state, &ctx, &[(&format!("{root}/sub"), false)]).await,
        vec!["ctx-a"]
    );
    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![format!("{root}/a.md")]
    );
}

/// What fails this: a directory row that only walks — `sub/old.md` would stay a backlink.
#[tokio::test]
async fn a_folder_replaced_under_the_same_name_in_one_batch_loses_its_old_children() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[("sub/old.md", "see [[b]]")]).await;
    std::fs::remove_dir_all(dir.path().join("sub")).unwrap();
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("sub/new.md"), "see [[b]]").unwrap();

    sync(&state, &ctx, &[(&format!("{root}/sub"), false)]).await;

    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![format!("{root}/a.md"), format!("{root}/sub/new.md")]
    );
}

fn walks() -> usize {
    WALKS.with(|walks| walks.get())
}

/// What fails this: judging the path (`plan`) before finding who holds it (`holding`) — a
/// folder the webview names would be walked although no context holds it (spec 0072 §5.4).
#[tokio::test]
async fn a_directory_no_context_holds_is_not_walked() {
    let ctx = ContextManager::new();
    let (_dir, _root, state) = built(&ctx, &[]).await;
    let other = tempfile::tempdir().unwrap();
    std::fs::create_dir(other.path().join("d")).unwrap();
    std::fs::write(other.path().join("d/n.md"), "x").unwrap();
    let before = walks();

    let ids = sync(
        &state,
        &ctx,
        &[(other.path().join("d").to_str().unwrap(), false)],
    )
    .await;

    assert!(ids.is_empty());
    assert_eq!(walks(), before);
}

#[tokio::test]
async fn a_path_no_directory_context_holds_is_dropped() {
    let ctx = ContextManager::new();
    let (_dir, _root, state) = built(&ctx, &[]).await;
    let other = tempfile::tempdir().unwrap();
    let loose = other.path().join("x.md");
    std::fs::write(&loose, "see [[b]]").unwrap();
    let loose = loose.to_str().unwrap().to_string();
    // A File context (§89) holds it — still no directory index to update.
    ctx.add(info("file-ctx", &loose, ContextType::File))
        .await
        .unwrap();

    assert!(sync(&state, &ctx, &[(&loose, false)]).await.is_empty());
    assert_eq!(
        state.epoch(&loose).await,
        0,
        "no slot was touched for the File context"
    );
}

/// What fails this: skipping on the watcher's spelling instead of the walkers' rules — the
/// three would be indexed (`node_modules/x.md` links to b) and announced.
#[tokio::test]
async fn hidden_and_tool_paths_are_left_alone() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[]).await;
    let key = active_index_key(&ctx).await.unwrap();
    for (file, content) in [
        (".DS_Store", "x"),
        (".obsidian/workspace.json", "{}"),
        ("node_modules/x.md", "see [[b]]"),
    ] {
        let path = dir.path().join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }
    let epoch = state.epoch(&key).await;
    let before = walks();

    let ids = sync(
        &state,
        &ctx,
        &[
            (&format!("{root}/.DS_Store"), false),
            (&format!("{root}/.obsidian/workspace.json"), false),
            (&format!("{root}/node_modules/x.md"), false),
            (&format!("{root}/node_modules"), false),
        ],
    )
    .await;

    assert!(ids.is_empty());
    assert_eq!(state.epoch(&key).await, epoch);
    assert_eq!(walks(), before, "node_modules/ is not walked");
    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![format!("{root}/a.md")]
    );
}

/// What fails this: judging the link with `metadata` instead of `symlink_metadata` — it would
/// read as a note, re-index its TARGET `a.md` and announce the context (the `ids` assertion).
/// A link that is treated as a missing path would canonicalise through it and remove `a.md`
/// (the backlinks assertion) — no code path does that today, which is why the rule is pinned.
#[cfg(unix)]
#[tokio::test]
async fn a_symlink_is_left_alone_and_its_target_keeps_its_links() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[]).await;
    std::os::unix::fs::symlink(dir.path().join("a.md"), dir.path().join("link.md")).unwrap();

    assert!(sync(&state, &ctx, &[(&format!("{root}/link.md"), false)])
        .await
        .is_empty());
    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![format!("{root}/a.md")]
    );
}

#[tokio::test]
async fn a_context_without_an_index_is_announced_for_notes_and_removals() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-a", true).await;
    let state = LinkIndexState::new(); // never built
    std::fs::write(dir.path().join("c.md"), "x").unwrap();

    assert_eq!(
        sync(&state, &ctx, &[(&format!("{root}/c.md"), false)]).await,
        vec!["ctx-a"]
    );
    assert_eq!(
        sync(&state, &ctx, &[(&format!("{root}/gone.md"), false)]).await,
        vec!["ctx-a"]
    );
}

/// The positive pair of `a_deleted_folder_takes_its_notes_with_it`: a removal the live index
/// knows nothing about is not news.
#[tokio::test]
async fn a_removed_path_the_live_index_never_knew_is_not_announced() {
    let ctx = ContextManager::new();
    let (_dir, root, state) = built(&ctx, &[]).await;
    assert!(sync(&state, &ctx, &[(&format!("{root}/never.png"), false)])
        .await
        .is_empty());
}

#[tokio::test]
async fn nested_contexts_are_each_updated_and_announced() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[("sub/keep.md", "x")]).await;
    let inner = format!("{root}/sub");
    ctx.add(info("ctx-inner", &inner, ContextType::Folder))
        .await
        .unwrap();
    refresh_index_inner(&state, &ctx, &inner).await.unwrap();
    std::fs::write(dir.path().join("sub/n.md"), "see [[keep]]").unwrap();

    let ids = sync(&state, &ctx, &[(&format!("{inner}/n.md"), false)]).await;

    assert_eq!(ids, vec!["ctx-a", "ctx-inner"]);
}
