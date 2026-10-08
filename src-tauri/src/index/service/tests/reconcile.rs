// #824 The guarded reconcile unit: ordering against app writes, per-registration
// judgement, shape changes, unreadable notes and failures — each case ends where a
// fresh build of the same disk would.
use super::*;

use super::super::reconcile::{reconcile_path, reconcile_tree};
use super::watched::{fresh_shape, shape};
use std::sync::Arc;

async fn graph(
    state: &LinkIndexState,
    ctx: &ContextManager,
    root: &str,
) -> (Vec<String>, Vec<(String, String)>) {
    shape(
        &get_link_index_inner(state, ctx, Some(root.to_string()))
            .await
            .unwrap(),
    )
}

#[tokio::test]
async fn a_watcher_unit_that_read_old_bytes_cannot_land_after_a_later_write() {
    // The watcher's unit reads A and stalls; an app write commits B and runs its own
    // unit; the watcher then applies. The index must end on B.
    // 이것을 실패시키는 것: `apply_guard` 가 path 마다 같은 잠금을 주지 않는다(매번 새 Mutex) — 앱의 unit 이
    // 멈춘 watcher 를 기다리지 않아 B 를 먼저 반영하고, 풀려난 watcher 가 A 로 덮는다.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-r", true).await;
    let state = Arc::new(LinkIndexState::new());
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let note = dir.path().join("c.md");
    std::fs::write(&note, "see [[a]]").unwrap();
    let path = note.to_string_lossy().into_owned();
    let reached = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    *state.pause_after_read.lock().unwrap() = Some(PauseAfterRead {
        path: crate::context::manager::resolve_canonical(&path).unwrap(),
        reached: Arc::clone(&reached),
        release: Arc::clone(&release),
    });
    let watcher = {
        let (state, ctx, path) = (Arc::clone(&state), ctx.clone(), path.clone());
        tokio::spawn(async move { reconcile_path(&state, &ctx, &path).await })
    };
    reached.notified().await;
    std::fs::write(&note, "see [[b]]").unwrap();
    let app = {
        let (state, ctx, path) = (Arc::clone(&state), ctx.clone(), path.clone());
        tokio::spawn(async move { reconcile_path(&state, &ctx, &path).await })
    };
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
    // The app's unit is waiting on the guard the stalled watcher holds.
    assert!(!app.is_finished());
    release.notify_one();
    watcher.await.unwrap();
    app.await.unwrap();
    let edges = graph(&state, &ctx, &root).await.1;
    assert!(edges.contains(&(path.clone(), format!("{root}/b.md"))));
    assert!(!edges.contains(&(path, format!("{root}/a.md"))));
    assert_eq!(state.apply_guards_alive(), 0);
}

#[tokio::test]
async fn nested_roots_each_judge_a_path_by_their_own_baramignore() {
    // `/v` excludes `sub/x.md`; the nested root `/v/sub` has no `.baramignore` and
    // includes it. One unit, two opposite judgements, each equal to its own fresh build.
    // 이것을 실패시키는 것: 바깥 root 의 판정을 모든 등록에 똑같이 쓴다(첫 matcher 로 걸러 둘 다 건너뛴다).
    let outer = tempfile::tempdir().unwrap();
    let v = outer.path().to_str().unwrap().to_string();
    std::fs::create_dir(outer.path().join("sub")).unwrap();
    std::fs::write(outer.path().join("sub/t.md"), "target").unwrap();
    std::fs::write(outer.path().join(crate::fs::BARAMIGNORE), "sub/x.md\n").unwrap();
    let sub = format!("{v}/sub");
    let ctx = ContextManager::new();
    ctx.add(info("outer", &v, ContextType::Folder))
        .await
        .unwrap();
    ctx.add(info("inner", &sub, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &v).await.unwrap();
    refresh_index_inner(&state, &ctx, &sub).await.unwrap();
    std::fs::write(outer.path().join("sub/x.md"), "see [[t]]").unwrap();
    let x = format!("{sub}/x.md");
    let done = reconcile_path(&state, &ctx, &x).await;
    assert!(!done.failed);
    let outer_graph = graph(&state, &ctx, &v).await;
    let inner_graph = graph(&state, &ctx, &sub).await;
    assert!(!outer_graph.0.contains(&x));
    assert!(inner_graph.0.contains(&x));
    assert_eq!(outer_graph, fresh_shape(&v).await);
    assert_eq!(inner_graph, fresh_shape(&sub).await);
}

#[tokio::test]
async fn every_baramignore_transition_rebuilds_its_registration() {
    // Creating, editing and deleting `<root>/.baramignore` each change what every
    // entry means; the unit for it rebuilds that registration.
    // 이것을 실패시키는 것: `.baramignore` 경로를 matcher 보다 먼저 보지 않는다 — dot 파일이라 matcher 가
    // 건너뛰어 rebuild 가 일어나지 않는다.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-i", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let ignore = dir.path().join(crate::fs::BARAMIGNORE);
    let ignore_path = ignore.to_string_lossy().into_owned();
    let a = format!("{root}/a.md");
    for (text, a_indexed) in [
        (Some("a.md\n"), false),
        (Some("b.md\n"), true),
        (None, true),
    ] {
        match text {
            Some(text) => std::fs::write(&ignore, text).unwrap(),
            None => std::fs::remove_file(&ignore).unwrap(),
        }
        let done = reconcile_path(&state, &ctx, &ignore_path).await;
        assert_eq!(done.rebuilt, vec![root.clone()], "{text:?}");
        let now = graph(&state, &ctx, &root).await;
        assert_eq!(now.0.contains(&a), a_indexed, "{text:?}");
        assert_eq!(now, fresh_shape(&root).await, "{text:?}");
    }
}

#[tokio::test]
async fn a_folder_replaced_by_a_file_of_the_same_name_leaves_nothing_below_it() {
    // `x.md/` held `x.md/inner.md`; it became the note `x.md`. `y/` held `y/in.md`; it
    // became a plain file `y`. Neither point mutation clears what was below.
    // 이것을 실패시키는 것: 파일로 판정하기 전에 그 아래 index 항목(`holds_under`)을 보지 않는다.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-f", true).await;
    let d = dir.path();
    std::fs::create_dir(d.join("x.md")).unwrap();
    std::fs::write(d.join("x.md/inner.md"), "see [[a]]").unwrap();
    std::fs::create_dir(d.join("y")).unwrap();
    std::fs::write(d.join("y/in.md"), "see [[b]]").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    // One at a time: each rebuild reads the whole disk.
    std::fs::remove_dir_all(d.join("x.md")).unwrap();
    std::fs::write(d.join("x.md"), "see [[b]]").unwrap();
    let done = reconcile_path(&state, &ctx, &format!("{root}/x.md")).await;
    assert_eq!(done.rebuilt, vec![root.clone()]);
    std::fs::remove_dir_all(d.join("y")).unwrap();
    std::fs::write(d.join("y"), [0u8, 1]).unwrap();
    let done = reconcile_path(&state, &ctx, &format!("{root}/y")).await;
    assert_eq!(done.rebuilt, vec![root.clone()]);
    let now = graph(&state, &ctx, &root).await;
    assert!(!now.0.contains(&format!("{root}/x.md/inner.md")));
    assert!(!now.0.contains(&format!("{root}/y/in.md")));
    assert_eq!(now, fresh_shape(&root).await);
}

#[tokio::test]
async fn a_note_replaced_by_a_folder_is_rebuilt() {
    // 이것을 실패시키는 것: 디렉터리에서 index 가 그 경로 자체를 가졌는지(`holds_path`) 보지 않는다.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-d", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    std::fs::remove_file(dir.path().join("a.md")).unwrap();
    std::fs::create_dir(dir.path().join("a.md")).unwrap();
    let done = reconcile_path(&state, &ctx, &format!("{root}/a.md")).await;
    assert_eq!(done.rebuilt, vec![root.clone()]);
    assert_eq!(graph(&state, &ctx, &root).await, fresh_shape(&root).await);
}

#[tokio::test]
async fn an_unreadable_note_stays_a_link_target_as_a_fresh_build_keeps_it() {
    // Invalid UTF-8 fails the read on every platform and as any user. A fresh build
    // registers the note and skips its content, so `[[u]]` still resolves to
    // `sub/u.md`; a removal would resolve it to `<root>/u.md` instead.
    // 이것을 실패시키는 것: 읽지 못하는 노트를 `Unreadable` 대신 `Remove` 로 반영한다.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-u", true).await;
    let d = dir.path();
    std::fs::create_dir(d.join("sub")).unwrap();
    std::fs::write(d.join("sub/u.md"), "see [[a]] #tag").unwrap();
    std::fs::write(d.join("c.md"), "see [[u]]").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    std::fs::write(d.join("sub/u.md"), [0xffu8, 0xfe, 0x00]).unwrap();
    let done = reconcile_path(&state, &ctx, &format!("{root}/sub/u.md")).await;
    assert!(done.reached && !done.failed);
    let now = graph(&state, &ctx, &root).await;
    assert!(now
        .1
        .contains(&(format!("{root}/c.md"), format!("{root}/sub/u.md"))));
    assert!(!now
        .1
        .iter()
        .any(|(from, _)| from == &format!("{root}/sub/u.md")));
    assert_eq!(now, fresh_shape(&root).await);
}

#[tokio::test]
async fn a_rebuild_that_fails_is_reported_and_its_index_marked_for_dropping() {
    // An unusable `.baramignore` fails the build its change asks for.
    // 이것을 실패시키는 것: 실패한 rebuild 를 `degrade` 에 올리지 않는다.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-x", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let ignore = dir.path().join(crate::fs::BARAMIGNORE);
    std::fs::write(&ignore, "{unclosed\n").unwrap();
    let done = reconcile_path(&state, &ctx, &ignore.to_string_lossy()).await;
    assert!(done.failed);
    let incarnation = ctx.registration("ctx-x").await.unwrap().1;
    assert_eq!(done.degrade, vec![(root.clone(), incarnation)]);
    assert!(done.rebuilt.is_empty());
}

#[tokio::test]
async fn a_tree_reconciles_registrations_below_it_too() {
    // A repository at `/r` with the vault at `/r/notes`: `contexts_containing(/r)` is
    // empty, the vault lies under the tree.
    // 이것을 실패시키는 것: tree 아래에 있는 등록을 찾지 않는다(`contexts_containing` 만 쓴다).
    let repo = tempfile::tempdir().unwrap();
    std::fs::create_dir(repo.path().join("notes")).unwrap();
    let notes = repo.path().join("notes").to_string_lossy().into_owned();
    std::fs::write(repo.path().join("notes/a.md"), "see [[b]]").unwrap();
    let ctx = ContextManager::new();
    ctx.add(info("notes", &notes, ContextType::Folder))
        .await
        .unwrap();
    ctx.set_active("notes").await.unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &notes).await.unwrap();
    std::fs::write(repo.path().join("notes/c.md"), "see [[a]]").unwrap();
    let done = reconcile_tree(&state, &ctx, &repo.path().to_string_lossy()).await;
    assert_eq!(done.rebuilt, vec![notes.clone()]);
    assert!(graph(&state, &ctx, &notes)
        .await
        .0
        .contains(&format!("{notes}/c.md")));
}

#[tokio::test]
async fn apply_for_tells_a_stale_registration_from_one_with_no_index_yet() {
    // 이것을 실패시키는 것: `apply_for` 가 incarnation 을 보지 않는다 — 옛 등록의 변경이 새 index 에 들어간다.
    let state = LinkIndexState::new();
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_str().unwrap().to_string();
    std::fs::write(dir.path().join("a.md"), "see [[b]]").unwrap();
    let a = format!("{root}/a.md");
    // No slot, no build: the first build reads the disk afterwards.
    let m = Mutation::update(&a, "see [[c]]".into()).unwrap();
    assert_eq!(
        state.apply_for(&root, 3, vec![m.clone()]).await,
        ApplyOutcome::NoIndex
    );
    let requested = state.version(&root).await;
    let token = state
        .begin_build(&root, &requested, &root, 3)
        .await
        .unwrap();
    // A build reading for incarnation 3 journals it.
    assert_eq!(
        state.apply_for(&root, 3, vec![m.clone()]).await,
        ApplyOutcome::Applied
    );
    let mut index = LinkIndex::new();
    index.build(&root).await.unwrap();
    assert_eq!(
        state
            .publish(
                &root,
                token,
                index,
                IndexStats {
                    files_indexed: 1,
                    links_found: 1,
                    duration: 0
                }
            )
            .await,
        Some(1)
    );
    // An older registration of the same path is stale and changes nothing.
    let before = state.epoch(&root).await;
    let old = Mutation::update(&a, "see [[old]]".into()).unwrap();
    assert_eq!(
        state.apply_for(&root, 2, vec![old]).await,
        ApplyOutcome::Stale
    );
    assert_eq!(state.epoch(&root).await, before + 1);
    let edges = state
        .with_index_for(&root, 3, |idx| idx.unwrap().get_link_graph().edges)
        .await;
    assert!(edges.iter().any(|e| e.to.ends_with("c.md")));
    assert!(!edges.iter().any(|e| e.to.ends_with("old.md")));
}

#[cfg(unix)]
#[tokio::test]
async fn a_unit_names_the_path_in_every_covering_index_s_spelling() {
    // A vault registered through a link; the path arrives in the resolved spelling. The
    // window's tab uses the registered one, so `index:changed` must carry both.
    // 이것을 실패시키는 것: 각 index 의 표기(`spelling_of`)를 모으지 않고 받은 경로만 싣는다.
    let real = tempfile::tempdir().unwrap();
    let canonical_root = std::fs::canonicalize(real.path()).unwrap();
    std::fs::write(canonical_root.join("b.md"), "target").unwrap();
    let links = tempfile::tempdir().unwrap();
    let alias = links.path().join("vault");
    std::os::unix::fs::symlink(&canonical_root, &alias).unwrap();
    let root = alias.to_string_lossy().into_owned();
    let ctx = ContextManager::new();
    ctx.add(info("alias", &root, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let resolved = canonical_root.join("n.md");
    std::fs::write(&resolved, "see [[b]]").unwrap();
    let done = reconcile_path(&state, &ctx, &resolved.to_string_lossy()).await;
    assert!(done.reached);
    assert!(done
        .spellings
        .contains(&resolved.to_string_lossy().into_owned()));
    assert!(done.spellings.contains(&format!("{root}/n.md")));
}

#[tokio::test]
async fn a_path_covered_by_two_indexes_is_read_once() {
    // Nested roots both index `sub/n.md`: one read serves both mutations.
    // 이것을 실패시키는 것: covering registration 마다 파일을 다시 읽는다(`read` 를 나누지 않는다).
    let outer = tempfile::tempdir().unwrap();
    let v = outer.path().to_str().unwrap().to_string();
    std::fs::create_dir(outer.path().join("sub")).unwrap();
    let sub = format!("{v}/sub");
    let ctx = ContextManager::new();
    ctx.add(info("outer", &v, ContextType::Folder))
        .await
        .unwrap();
    ctx.add(info("inner", &sub, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &v).await.unwrap();
    refresh_index_inner(&state, &ctx, &sub).await.unwrap();
    let n = format!("{sub}/n.md");
    std::fs::write(&n, "see [[x]]").unwrap();
    let before = state.note_reads.load(std::sync::atomic::Ordering::SeqCst);
    reconcile_path(&state, &ctx, &n).await;
    assert_eq!(
        state.note_reads.load(std::sync::atomic::Ordering::SeqCst),
        before + 1
    );
    // Both indexes got it.
    assert!(graph(&state, &ctx, &v).await.0.contains(&n));
    assert!(graph(&state, &ctx, &sub).await.0.contains(&n));
}
