// #824 What a guarded unit observed is applied only where no newer read of the disk
// already stands: not over a published index whose build began after it, not into the
// journal of a build that began after it. A rename's own mutations are applied and
// journaled as before. A path no resolver can place drops every index it may be in.
use super::*;

use super::super::reconcile::reconcile_path;
use std::sync::Arc;

/// Pause the unit for `path` once it has read, and run it in the background.
async fn paused_unit(
    state: &Arc<LinkIndexState>,
    ctx: &ContextManager,
    path: &str,
) -> (Arc<tokio::sync::Notify>, tokio::task::JoinHandle<()>) {
    let reached = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    *state.pause_after_read.lock().unwrap() = Some(PauseAfterRead {
        path: crate::context::manager::resolve_canonical(path).unwrap(),
        reached: Arc::clone(&reached),
        release: Arc::clone(&release),
    });
    let unit = {
        let (state, ctx, path) = (Arc::clone(state), ctx.clone(), path.to_string());
        tokio::spawn(async move {
            reconcile_path(&state, &ctx, &path).await;
        })
    };
    reached.notified().await;
    (release, unit)
}

async fn links_from(
    state: &LinkIndexState,
    ctx: &ContextManager,
    root: &str,
    from: &str,
) -> Vec<String> {
    let graph = get_link_index_inner(state, ctx, Some(root.to_string()))
        .await
        .unwrap();
    graph
        .edges
        .iter()
        .filter(|e| e.from == from)
        .map(|e| e.to.clone())
        .collect()
}

#[tokio::test]
async fn a_unit_that_read_before_a_rebuild_began_does_not_put_its_read_back() {
    // The unit reads `see [[a]]` and stalls; the file becomes `see [[b]]`; a rebuild
    // reads that and publishes; the unit is released. The index stays on the rebuild.
    // 이것을 실패시키는 것: `apply_for` 가 live index 에 대해 `observed` 를 보지 않는다(newer_snapshot = false).
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-o", true).await;
    let state = Arc::new(LinkIndexState::new());
    let note = dir.path().join("c.md");
    std::fs::write(&note, "see [[a]]").unwrap();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let path = note.to_string_lossy().into_owned();
    let (release, unit) = paused_unit(&state, &ctx, &path).await;
    std::fs::write(&note, "see [[b]]").unwrap();
    rebuild(&state, &ctx, &root).await;
    release.notify_one();
    unit.await.unwrap();
    assert_eq!(
        links_from(&state, &ctx, &root, &path).await,
        [format!("{root}/b.md")]
    );
}

/// A full rebuild of `root` that publishes, whatever was published before.
async fn rebuild(state: &LinkIndexState, ctx: &ContextManager, root: &str) {
    assert!(super::super::reconcile::rebuild_registration(state, ctx, root).await);
}

#[tokio::test]
async fn a_unit_that_read_before_a_build_began_stays_out_of_its_journal() {
    // 이것을 실패시키는 것: `apply_for` 가 `began_at` 을 보지 않고 journal 에 넣는다 — 재생이 옛 읽기를 되살린다.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-o", true).await;
    let state = Arc::new(LinkIndexState::new());
    let note = dir.path().join("c.md");
    std::fs::write(&note, "see [[a]]").unwrap();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let key = active_index_key(&ctx).await.unwrap();
    let path = note.to_string_lossy().into_owned();
    let (release, unit) = paused_unit(&state, &ctx, &path).await;
    std::fs::write(&note, "see [[b]]").unwrap();
    let (token, snapshot, stats) = staged_build(&state, &ctx, &key, &root).await;
    release.notify_one();
    unit.await.unwrap();
    assert_eq!(state.publish(&key, token, snapshot, stats).await, Some(0));
    assert_eq!(
        links_from(&state, &ctx, &root, &path).await,
        [format!("{root}/b.md")]
    );
}

#[tokio::test]
async fn a_unit_that_read_after_a_build_began_is_replayed_onto_it() {
    // The positive side of the rule: a newer read joins the journal and wins.
    // 이것을 실패시키는 것: 진행 중인 build 의 journal 에 아무것도 넣지 않는다.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-o", true).await;
    let state = LinkIndexState::new();
    let note = dir.path().join("c.md");
    std::fs::write(&note, "see [[a]]").unwrap();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let key = active_index_key(&ctx).await.unwrap();
    let (token, snapshot, stats) = staged_build(&state, &ctx, &key, &root).await;
    std::fs::write(&note, "see [[b]]").unwrap();
    let path = note.to_string_lossy().into_owned();
    reconcile_path(&state, &ctx, &path).await;
    assert_eq!(state.publish(&key, token, snapshot, stats).await, Some(1));
    assert_eq!(
        links_from(&state, &ctx, &root, &path).await,
        [format!("{root}/b.md")]
    );
}

#[tokio::test]
async fn a_rename_s_own_rewrite_during_a_build_is_still_replayed() {
    // A rename rewrites a referrer while a build that read the old file is pending, and
    // is cancelled before its reconciliation (#840). Its direct mutation
    // (`rename/referrers.rs` → `LinkIndexState::apply`) carries no stamp and is
    // journaled as before, so the build publishes the rewrite.
    // 이것을 실패시키는 것: `apply` 에도 stamp 규칙을 걸어 stamp 0 으로 거른다 — rewrite 가 journal 에서 빠진다.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-o", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let key = active_index_key(&ctx).await.unwrap();
    let (token, snapshot, stats) = staged_build(&state, &ctx, &key, &root).await;
    let a = format!("{root}/a.md");
    std::fs::write(dir.path().join("a.md"), "see [[c]]").unwrap();
    state
        .apply(
            &key,
            vec![Mutation::update(&a, "see [[c]]".into()).unwrap()],
        )
        .await;
    assert_eq!(state.publish(&key, token, snapshot, stats).await, Some(1));
    assert_eq!(
        links_from(&state, &ctx, &root, &a).await,
        [format!("{root}/c.md")]
    );
}

#[tokio::test]
async fn a_path_no_resolver_can_place_drops_the_indexes_it_may_be_in() {
    // 이것을 실패시키는 것: 해석하지 못한 경로를 `failed` 로만 두고 아무 등록도 내리지 않는다 — 또는 후보가
    // 없을 때 모든 directory 등록으로 넓히지 않는다.
    let ctx = ContextManager::new();
    let (_dir, root) = vault_with_a_link(&ctx, "ctx-o", true).await;
    let (_other_dir, other) = vault_with_a_link(&ctx, "ctx-p", false).await;
    let state = LinkIndexState::new();
    let at = |id: &'static str| {
        let ctx = ctx.clone();
        async move { ctx.registration(id).await.unwrap().1 }
    };
    let inside = format!("{root}/sub/../x.md");
    state.unresolvable.lock().unwrap().insert(inside.clone());
    let done = reconcile_path(&state, &ctx, &inside).await;
    assert!(done.failed);
    assert_eq!(done.degrade, [(root.clone(), at("ctx-o").await)]);
    // Under no registration's spelling: every directory registration.
    let nowhere = "/nowhere/at/all.md".to_string();
    state.unresolvable.lock().unwrap().insert(nowhere.clone());
    let mut all = reconcile_path(&state, &ctx, &nowhere).await.degrade;
    all.sort();
    let mut expected = vec![(root, at("ctx-o").await), (other, at("ctx-p").await)];
    expected.sort();
    assert_eq!(all, expected);
}
