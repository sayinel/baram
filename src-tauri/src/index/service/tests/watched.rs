use super::*;

use crate::index::service::watched::sync_watched_paths_inner;

/// The graph as a comparable value: sorted nodes and sorted (from, to) edges.
fn shape(graph: &LinkGraph) -> (Vec<String>, Vec<(String, String)>) {
    let mut nodes = graph.nodes.clone();
    nodes.sort();
    let mut edges: Vec<(String, String)> = graph
        .edges
        .iter()
        .map(|e| (e.from.clone(), e.to.clone()))
        .collect();
    edges.sort();
    (nodes, edges)
}

/// What a vault build of the same tree publishes, from scratch.
async fn fresh_shape(root: &str) -> (Vec<String>, Vec<(String, String)>) {
    let ctx = ContextManager::new();
    ctx.add(info("ctx-fresh", root, ContextType::Folder))
        .await
        .unwrap();
    ctx.set_active("ctx-fresh").await.unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, root).await.unwrap();
    shape(&get_link_index_inner(&state, &ctx, None).await.unwrap())
}

async fn sync(state: &LinkIndexState, ctx: &ContextManager, paths: &[String]) {
    let result = sync_watched_paths_inner(state, ctx, paths).await;
    assert!(result.failed.is_empty(), "{:?}", result.failed);
}

#[tokio::test]
async fn a_watched_sequence_leaves_the_index_a_fresh_build_would_publish() {
    // Issue 790: the watcher's paths are the only way a write outside a save
    // reaches the index, so what they leave must equal a rebuild.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-w", true).await;
    let d = dir.path();
    std::fs::write(
        d.join("a.md"),
        "see [[b]] and [[paper.pdf]] and [[img.png]]",
    )
    .unwrap();
    std::fs::write(d.join("img.png"), [0u8, 1, 2]).unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let p = |rel: &str| format!("{root}/{rel}");

    // A non-markdown target appears; another goes.
    // 이것을 실패시키는 것: `Mutation::target` 대신 아무것도 하지 않는다(대상이 고스트로 남는다).
    std::fs::write(d.join("paper.pdf"), [0u8, 1, 2]).unwrap();
    std::fs::remove_file(d.join("img.png")).unwrap();
    // Paths a vault build does not walk.
    // 이것을 실패시키는 것: `walked_under` 필터를 지운다(`.hidden/x.md` 가 노트로 들어간다).
    std::fs::create_dir(d.join(".hidden")).unwrap();
    std::fs::write(d.join(".hidden/x.md"), "see [[a]]").unwrap();
    std::fs::write(d.join(".DS_Store"), "junk").unwrap();
    // A note edited outside the app.
    std::fs::write(d.join("b.md"), "back to [[a]]").unwrap();
    sync(
        &state,
        &ctx,
        &[
            p("paper.pdf"),
            p("img.png"),
            p(".hidden/x.md"),
            p(".DS_Store"),
            p("b.md"),
        ],
    )
    .await;

    let synced = shape(&get_link_index_inner(&state, &ctx, None).await.unwrap());
    assert_eq!(synced, fresh_shape(&root).await);
    // Not vacuous: the tree changed in ways the first build did not see.
    assert!(synced.1.contains(&(p("b.md"), p("a.md"))));
}

#[tokio::test]
async fn a_moved_in_directory_rebuilds_and_a_vanished_one_is_judged_from_the_index() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-w", true).await;
    let d = dir.path();
    std::fs::create_dir(d.join("old")).unwrap();
    std::fs::write(d.join("old/o.md"), "see [[a]]").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let p = |rel: &str| format!("{root}/{rel}");

    // A folder moved in arrives as ONE event for the folder.
    // 이것을 실패시키는 것: 존재하는 디렉터리를 `structural` 로 올리지 않는다(`Vec::new()`).
    std::fs::create_dir(d.join("moved")).unwrap();
    std::fs::write(d.join("moved/m.md"), "see [[b]]").unwrap();
    sync(&state, &ctx, &[p("moved")]).await;
    let synced = shape(&get_link_index_inner(&state, &ctx, None).await.unwrap());
    assert!(synced.0.contains(&p("moved/m.md")));

    // A folder moved out is gone from disk; nothing but the index knows it
    // was one. Its own sync, so the rebuild above cannot clean it up.
    // 이것을 실패시키는 것: 사라진 경로를 `holds_under` 없이 파일로만 다룬다.
    std::fs::remove_dir_all(d.join("old")).unwrap();
    sync(&state, &ctx, &[p("old")]).await;
    let synced = shape(&get_link_index_inner(&state, &ctx, None).await.unwrap());
    assert!(!synced.0.contains(&p("old/o.md")));
    assert_eq!(synced, fresh_shape(&root).await);
}

#[tokio::test]
async fn an_empty_new_directory_rebuilds_nothing() {
    // An in-app "New folder" must not cost a vault build. A file written
    // behind the index's back shows whether one ran.
    // 이것을 실패시키는 것: `holds_files` 를 보지 않고 존재하는 디렉터리면 언제나 다시 build 한다.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-w", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    std::fs::write(dir.path().join("c.md"), "see [[a]]").unwrap();
    std::fs::create_dir(dir.path().join("empty")).unwrap();
    sync(&state, &ctx, &[format!("{root}/empty")]).await;
    let graph = get_link_index_inner(&state, &ctx, None).await.unwrap();
    assert!(!graph.nodes.contains(&format!("{root}/c.md")));
}

#[tokio::test]
async fn a_directory_event_rebuilds_every_context_that_contains_it() {
    // 이것을 실패시키는 것: 가장 깊은 context 하나만(또는 활성 context 만) 다시 build 한다.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    let sub = format!("{root}/sub");
    ctx.add(info("ctx-sub", &sub, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    refresh_index_inner(&state, &ctx, &sub).await.unwrap();

    std::fs::create_dir(dir.path().join("sub/moved")).unwrap();
    std::fs::write(dir.path().join("sub/moved/m.md"), "see [[a]]").unwrap();
    sync(&state, &ctx, &[format!("{sub}/moved")]).await;

    let note = format!("{sub}/moved/m.md");
    for key in [&root, &sub] {
        let graph = get_link_index_inner(&state, &ctx, Some(key.clone()))
            .await
            .unwrap();
        assert!(graph.nodes.contains(&note), "{key}");
    }
}

#[tokio::test]
async fn a_structural_rebuild_never_coalesces_onto_a_build_that_read_the_old_layout() {
    // 이것을 실패시키는 것: `rebuild_and_publish(…, false)` 를 `true` 로 바꾼다.
    use std::sync::Arc;

    let ctx = Arc::new(ContextManager::new());
    let (dir, root) = vault_with_a_link(&ctx, "ctx-w", true).await;
    let state = Arc::new(LinkIndexState::new());
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    // A background refresh has read the OLD layout and holds the build lock.
    let build_lock = state.build_lock(&root).await;
    let guard = build_lock.lock().await;
    let (token, stale, stale_stats) = staged_build(&state, &ctx, &root, &root).await;

    // The folder moves in; the sync reads its version and parks on the lock.
    std::fs::create_dir(dir.path().join("moved")).unwrap();
    std::fs::write(dir.path().join("moved/m.md"), "see [[a]]").unwrap();
    let paths = vec![format!("{root}/moved")];
    let task = {
        let (state, ctx) = (Arc::clone(&state), Arc::clone(&ctx));
        tokio::spawn(async move { sync_watched_paths_inner(&state, &ctx, &paths).await })
    };
    // Let it reach the lock. Under heavy load it may not have yet — then the
    // stale publication below precedes its request and the test proves
    // nothing, but it cannot fail falsely.
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    assert!(
        publish_built_index(&state, &root, token, stale, stale_stats)
            .await
            .is_ok()
    );
    drop(guard);

    assert!(task.await.unwrap().failed.is_empty());
    let graph = get_link_index_inner(&state, &ctx, None).await.unwrap();
    assert!(graph.nodes.contains(&format!("{root}/moved/m.md")));
}
