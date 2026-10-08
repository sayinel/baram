// #824 What a command changed is in every covering link index before it answers.
use super::*;
use crate::context::{ContextInfo, ContextType};
use crate::index::service::build::refresh_index_inner;
use crate::index::service::reconcile::Reconciled;
use std::sync::atomic::Ordering;
use tauri::Listener;

type App = tauri::App<tauri::test::MockRuntime>;

fn app() -> App {
    let app = tauri::test::mock_app();
    app.manage(LinkIndexState::new());
    app.manage(ContextManager::new());
    app
}

/// A vault registered in `app` and built: `a.md` links to `b.md`.
async fn vault(app: &App) -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_str().unwrap().to_string();
    std::fs::write(dir.path().join("a.md"), "see [[b]]").unwrap();
    std::fs::write(dir.path().join("b.md"), "target").unwrap();
    let ctx = app.state::<ContextManager>();
    ctx.add(ContextInfo {
        id: "v".into(),
        context_type: ContextType::Folder,
        path: root.clone(),
        label: "v".into(),
        color: "#fff".into(),
        alias: None,
        vault_type: None,
        added_at: 0,
    })
    .await
    .unwrap();
    ctx.set_active("v").await.unwrap();
    refresh_index_inner(&app.state::<LinkIndexState>(), &ctx, &root)
        .await
        .unwrap();
    (dir, root)
}

/// Whether the index under `root` has the edge `from → to`.
async fn edge(app: &App, root: &str, from: &str, to: &str) -> bool {
    let graph = crate::index::service::get_link_index_inner(
        &app.state::<LinkIndexState>(),
        &app.state::<ContextManager>(),
        Some(root.to_string()),
    )
    .await
    .unwrap();
    graph.edges.iter().any(|e| e.from == from && e.to == to)
}

/// Every `index:changed` payload `app` emits from now on.
fn changes(app: &App) -> Arc<Mutex<Vec<serde_json::Value>>> {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    app.listen_any("index:changed", move |event| {
        sink.lock()
            .unwrap()
            .push(serde_json::from_str(event.payload()).unwrap());
    });
    seen
}

#[tokio::test]
async fn a_task_command_has_updated_the_index_when_it_returns() {
    // P1 through a real command seam, no frontend: the appended line's link is there.
    // 이것을 실패시키는 것: `committed` 가 commit 뒤 `reconcile_effects` 를 부르지 않는다.
    let app = app();
    let (_dir, root) = vault(&app).await;
    let inbox = format!("{root}/inbox.md");
    crate::commands::task_cmd::append_task_line(
        app.handle().clone(),
        inbox.clone(),
        "- [ ] read [[b]]".into(),
    )
    .await
    .unwrap();
    assert!(edge(&app, &root, &inbox, &format!("{root}/b.md")).await);
}

#[tokio::test]
async fn one_command_emits_one_index_changed_for_every_note_it_wrote() {
    // `rename_tag` over three notes: one event with three entries, after all of them.
    // 이것을 실패시키는 것: 경로마다 `emit_changed` 를 부른다(세 번 낸다).
    let app = app();
    let (dir, root) = vault(&app).await;
    for name in ["x.md", "y.md", "z.md"] {
        std::fs::write(dir.path().join(name), "#old [[b]]").unwrap();
    }
    let seen = changes(&app);
    crate::commands::tag_cmd::rename_tag(
        app.handle().clone(),
        root.clone(),
        "old".into(),
        "new".into(),
    )
    .await
    .unwrap();
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0]["entries"].as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn a_commit_that_fails_part_way_still_leaves_what_it_changed_in_the_index() {
    // The first file changed, the second failed: the error goes back, after the first
    // file's change reached the index.
    // 이것을 실패시키는 것: commit 이 `Err` 일 때 선언된 효과를 reconcile 하지 않는다.
    let app = app();
    let (dir, root) = vault(&app).await;
    let a = dir.path().join("a.md");
    let a_path = a.to_string_lossy().into_owned();
    let done = committed(app.handle(), move |log| async move {
        log.path(&a_path);
        std::fs::write(&a, "see [[c]]").unwrap();
        log.path("/nonexistent/second.md");
        Err::<(), String>("the second file could not be written".into())
    })
    .await;
    assert!(done.result.is_err());
    assert!(
        edge(
            &app,
            &root,
            &format!("{root}/a.md"),
            &format!("{root}/c.md")
        )
        .await
    );
}

#[tokio::test]
async fn a_restore_that_fails_on_its_second_file_reconciles_the_first() {
    // 이것을 실패시키는 것: `restore_files_declaring` 가 덮어쓰기 전에 파일을 알리지 않는다.
    let app = app();
    let (dir, root) = vault(&app).await;
    let id = crate::snapshot::io::create_snapshot(&root, "manual", None).unwrap();
    std::fs::write(dir.path().join("a.md"), "see [[c]]").unwrap();
    // Re-index the edit so the restore has something to undo in the index too.
    reconcile_effects(app.handle(), &[Effect::Path(format!("{root}/a.md"))]).await;
    assert!(
        edge(
            &app,
            &root,
            &format!("{root}/a.md"),
            &format!("{root}/c.md")
        )
        .await
    );
    let result = crate::commands::snapshot_cmd::restore_snapshot(
        app.handle().clone(),
        root.clone(),
        id,
        Some(vec!["a.md".into(), "missing.md".into()]),
    )
    .await;
    assert!(result.is_err());
    assert!(
        edge(
            &app,
            &root,
            &format!("{root}/a.md"),
            &format!("{root}/b.md")
        )
        .await
    );
}

#[tokio::test]
async fn a_cancelled_command_still_reconciles_its_commit() {
    // The caller's future is dropped while the commit is mid-way; the commit and its
    // reconciliation finish anyway.
    // 이것을 실패시키는 것: commit 과 reconcile 을 spawn 하지 않고 호출자의 future 안에서 돌린다.
    let app = app();
    let (dir, root) = vault(&app).await;
    let a = dir.path().join("a.md");
    let a_path = a.to_string_lossy().into_owned();
    let release = Arc::new(tokio::sync::Notify::new());
    let entered = Arc::new(tokio::sync::Notify::new());
    let caller = {
        let (handle, release, entered) = (
            app.handle().clone(),
            Arc::clone(&release),
            Arc::clone(&entered),
        );
        tokio::spawn(async move {
            committed(&handle, move |log| async move {
                log.path(&a_path);
                std::fs::write(&a, "see [[c]]").unwrap();
                entered.notify_one();
                release.notified().await;
                Ok::<(), String>(())
            })
            .await
        })
    };
    entered.notified().await;
    caller.abort();
    let _ = caller.await;
    release.notify_one();
    let mut fresh = false;
    for _ in 0..500 {
        if edge(
            &app,
            &root,
            &format!("{root}/a.md"),
            &format!("{root}/c.md"),
        )
        .await
        {
            fresh = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert!(fresh);
}

#[tokio::test]
async fn a_write_that_landed_is_reported_written_even_if_what_followed_panicked() {
    // Builds that unwind only (the release profile aborts the process).
    // 이것을 실패시키는 것: `write_outcome` 이 `Err` 를 `landed` 와 상관없이 그대로 돌려준다.
    let app = app();
    let (dir, root) = vault(&app).await;
    let a = dir.path().join("a.md");
    let a_path = a.to_string_lossy().into_owned();
    let done = committed(app.handle(), move |log| async move {
        log.path(&a_path);
        std::fs::write(&a, "see [[c]]").unwrap();
        log.landed(7);
        if a_path.ends_with("a.md") {
            panic!("after the write");
        }
        Ok::<u64, String>(7)
    })
    .await;
    assert_eq!(
        write_outcome(done),
        Ok(WriteOutcome {
            mtime: 7,
            index_fresh: false
        })
    );
    assert!(
        edge(
            &app,
            &root,
            &format!("{root}/a.md"),
            &format!("{root}/c.md")
        )
        .await
    );
}

#[tokio::test]
async fn a_dropped_index_is_announced_only_once_its_rebuild_has_published() {
    // A `.baramignore` that cannot be used fails the rebuild its change asks for; the
    // index is dropped and nothing is announced. Once the file is fixed, the scheduled
    // rebuild publishes and exactly one event names it.
    // 이것을 실패시키는 것: degrade 된 경로를 `emit_changed` 가 바로 알린다 — 빈 index 를 다시 읽게 한다.
    let app = app();
    let (dir, root) = vault(&app).await;
    let ignore = dir.path().join(crate::fs::BARAMIGNORE);
    std::fs::write(&ignore, "{unclosed\n").unwrap();
    let seen = changes(&app);
    let fresh = reconcile_effects(
        app.handle(),
        &[Effect::Path(ignore.to_string_lossy().into_owned())],
    )
    .await;
    assert!(!fresh);
    assert!(seen.lock().unwrap().is_empty());
    let state = app.state::<LinkIndexState>();
    assert!(!state.with_index_for(&root, 1, |idx| idx.is_some()).await);
    std::fs::write(&ignore, "drafts/\n").unwrap();
    for _ in 0..500 {
        if !seen.lock().unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0]["rebuilt"], serde_json::json!([root]));
}

/// A git repository at `dir` holding `a.md` (`see [[b]]`) and `b.md`, committed.
fn repository(dir: &std::path::Path) {
    let repo = git2::Repository::init(dir).unwrap();
    let mut index = repo.index().unwrap();
    index
        .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let sig = git2::Signature::now("t", "t@example.com").unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
        .unwrap();
}

#[tokio::test]
async fn discarding_named_files_reconciles_them_one_by_one_up_to_a_threshold() {
    // Two names: two units, no rebuild. Past the threshold: one worktree rebuild instead
    // of reading every named file.
    // 이것을 실패시키는 것: `git_discard` 가 이름 붙은 파일을 하나씩 선언하지 않고 언제나 worktree 를
    // rebuild 한다 — 또는 임계값을 넘어도 worktree 를 선언하지 않는다.
    let app = app();
    let (dir, root) = vault(&app).await;
    repository(dir.path());
    let state = app.state::<LinkIndexState>();
    std::fs::write(dir.path().join("a.md"), "see [[c]]").unwrap();
    reconcile_effects(app.handle(), &[Effect::Path(format!("{root}/a.md"))]).await;
    let before = state.published.load(Ordering::SeqCst);
    crate::commands::git_cmd::git_discard(
        app.handle().clone(),
        root.clone(),
        vec!["a.md".into(), "b.md".into()],
    )
    .await
    .unwrap();
    assert_eq!(state.published.load(Ordering::SeqCst), before);
    assert!(
        edge(
            &app,
            &root,
            &format!("{root}/a.md"),
            &format!("{root}/b.md")
        )
        .await
    );

    std::fs::write(dir.path().join("a.md"), "see [[c]]").unwrap();
    reconcile_effects(app.handle(), &[Effect::Path(format!("{root}/a.md"))]).await;
    let mut many: Vec<String> = (0..256).map(|i| format!("absent-{i}.md")).collect();
    many.push("a.md".into());
    let before = state.published.load(Ordering::SeqCst);
    crate::commands::git_cmd::git_discard(app.handle().clone(), root.clone(), many)
        .await
        .unwrap();
    assert_eq!(state.published.load(Ordering::SeqCst), before + 1);
    assert!(
        edge(
            &app,
            &root,
            &format!("{root}/a.md"),
            &format!("{root}/b.md")
        )
        .await
    );
}

#[cfg(unix)]
#[tokio::test]
async fn a_custom_export_that_fails_still_reconciles_what_it_wrote_in_the_vault() {
    // 이것을 실패시키는 것: export 의 결과가 `Err` 일 때 reconcile 하지 않는다.
    let app = app();
    let (_dir, root) = vault(&app).await;
    let file = format!("{root}/a.md");
    let result = crate::commands::export_cmd::run_custom_export(
        app.handle().clone(),
        "sh -c \"cp ${file} ${vault_dir}/copy.md; exit 3\"".into(),
        file,
        format!("{root}/out.pdf"),
        Some(root.clone()),
    )
    .await;
    assert!(result.is_err());
    assert!(
        edge(
            &app,
            &root,
            &format!("{root}/copy.md"),
            &format!("{root}/b.md")
        )
        .await
    );
}

#[tokio::test]
async fn a_dropped_registration_does_not_hide_what_its_sibling_rebuilt() {
    // Nested roots: the path's rebuild failed under one and published under the other.
    // 이것을 실패시키는 것: degrade 가 있는 결과를 통째로 건너뛰어 형제의 `rebuilt` 까지 알리지 않는다.
    let app = app();
    let seen = changes(&app);
    emit_changed(
        app.handle(),
        &[Reconciled {
            canonical: "/v/sub/x".into(),
            spellings: vec!["/v/sub/x".into()],
            reached: true,
            rebuilt: vec!["/v/sub".into()],
            degrade: vec![("/v".into(), 1)],
            ..Reconciled::default()
        }],
    );
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0]["rebuilt"], serde_json::json!(["/v/sub"]));
    assert_eq!(seen[0]["entries"], serde_json::json!([]));
}

/// A vault `outer` holding the nested vault `outer/sub`, both registered and built.
async fn nested(app: &App) -> (tempfile::TempDir, String, String) {
    let dir = tempfile::tempdir().unwrap();
    let v = dir.path().to_str().unwrap().to_string();
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("sub/t.md"), "target").unwrap();
    std::fs::write(dir.path().join("sub/n.md"), "see [[t]]").unwrap();
    let sub = format!("{v}/sub");
    let ctx = app.state::<ContextManager>();
    for (id, path) in [("outer", &v), ("inner", &sub)] {
        ctx.add(ContextInfo {
            id: id.into(),
            context_type: ContextType::Folder,
            path: path.clone(),
            label: id.into(),
            color: "#fff".into(),
            alias: None,
            vault_type: None,
            added_at: 0,
        })
        .await
        .unwrap();
        refresh_index_inner(&app.state::<LinkIndexState>(), &ctx, path)
            .await
            .unwrap();
    }
    (dir, v, sub)
}

#[tokio::test]
async fn a_write_its_index_cannot_judge_drops_that_index_and_only_that_one() {
    // The outer root's `.baramignore` became unusable; a save of `sub/n.md` cannot be
    // judged for it. Its index is dropped rather than left trusted with the old links,
    // while the nested root, whose own rules are fine, takes the change.
    // 이것을 실패시키는 것: 판정하지 못한 등록(`Point::Failed`)을 `degrade` 에 올리지 않는다.
    let app = app();
    let (dir, v, sub) = nested(&app).await;
    std::fs::write(dir.path().join(crate::fs::BARAMIGNORE), "{unclosed\n").unwrap();
    std::fs::write(dir.path().join("sub/n.md"), "see [[other]]").unwrap();
    let fresh = reconcile_effects(app.handle(), &[Effect::Path(format!("{sub}/n.md"))]).await;
    assert!(!fresh);
    let state = app.state::<LinkIndexState>();
    let ctx = app.state::<ContextManager>();
    let outer = ctx.registration("outer").await.unwrap().1;
    let inner = ctx.registration("inner").await.unwrap().1;
    assert!(!state.with_index_for(&v, outer, |i| i.is_some()).await);
    assert!(state.with_index_for(&sub, inner, |i| i.is_some()).await);
    assert!(
        edge(
            &app,
            &sub,
            &format!("{sub}/n.md"),
            &format!("{sub}/other.md")
        )
        .await
    );
}

#[tokio::test]
async fn a_failure_of_an_old_registration_leaves_the_newer_ones_index_alone() {
    // 이것을 실패시키는 것: `drop_index_for` 가 incarnation 을 보지 않고 지운다.
    let app = app();
    let (_dir, root) = vault(&app).await;
    let ctx = app.state::<ContextManager>();
    let old = ctx.registration("v").await.unwrap().1;
    // Removed and registered again (#797 lease removal, a re-open), then built.
    ctx.remove("v").await.unwrap();
    ctx.add(ContextInfo {
        id: "v2".into(),
        context_type: ContextType::Folder,
        path: root.clone(),
        label: "v2".into(),
        color: "#fff".into(),
        alias: None,
        vault_type: None,
        added_at: 0,
    })
    .await
    .unwrap();
    let state = app.state::<LinkIndexState>();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let new = ctx.registration("v2").await.unwrap().1;
    assert!(new > old);
    degrade(app.handle(), &root, old).await;
    assert!(state.with_index_for(&root, new, |i| i.is_some()).await);
}

#[tokio::test]
async fn failures_of_one_registration_share_one_rebuild_job() {
    // 이것을 실패시키는 것: `request_rebuild` 를 보지 않고 실패마다 rebuild 를 띄운다.
    let app = app();
    let (_dir, root) = vault(&app).await;
    let state = app.state::<LinkIndexState>();
    let at = app
        .state::<ContextManager>()
        .registration("v")
        .await
        .unwrap()
        .1;
    let before = state.published.load(Ordering::SeqCst);
    degrade(app.handle(), &root, at).await;
    degrade(app.handle(), &root, at).await;
    for _ in 0..500 {
        if state.with_index_for(&root, at, |i| i.is_some()).await {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    // Give a second job, if any, the time to publish too.
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert_eq!(state.published.load(Ordering::SeqCst), before + 1);
}

#[tokio::test]
async fn a_batch_reads_each_registration_s_rules_once_and_rebuilds_it_once() {
    // `rename_tag` over three notes: one `.baramignore` load for the vault, not three.
    // Two folder replacements in one command: one rebuild, not two.
    // 이것을 실패시키는 것: 등록의 `.baramignore` 를 경로마다 다시 읽는다 — 또는 batch 의 rebuild 를 경로마다 돌린다.
    let app = app();
    let (dir, root) = vault(&app).await;
    for name in ["x.md", "y.md", "z.md"] {
        std::fs::write(dir.path().join(name), "#old [[b]]").unwrap();
    }
    let state = app.state::<LinkIndexState>();
    let loads = state.exclusion_loads.load(Ordering::SeqCst);
    crate::commands::tag_cmd::rename_tag(
        app.handle().clone(),
        root.clone(),
        "old".into(),
        "new".into(),
    )
    .await
    .unwrap();
    assert_eq!(state.exclusion_loads.load(Ordering::SeqCst), loads + 1);

    for name in ["p", "q"] {
        std::fs::create_dir(dir.path().join(name)).unwrap();
        std::fs::write(dir.path().join(format!("{name}/in.md")), "see [[a]]").unwrap();
    }
    let before = state.published.load(Ordering::SeqCst);
    reconcile_effects(
        app.handle(),
        &[
            Effect::Path(format!("{root}/p")),
            Effect::Path(format!("{root}/q")),
        ],
    )
    .await;
    assert_eq!(state.published.load(Ordering::SeqCst), before + 1);
    assert!(
        edge(
            &app,
            &root,
            &format!("{root}/q/in.md"),
            &format!("{root}/a.md")
        )
        .await
    );
}

#[tokio::test]
async fn a_rebuild_job_stops_once_its_registration_is_gone() {
    // 이것을 실패시키는 것: degrade 의 rebuild job 이 등록이 아직 그 incarnation 인지 보지 않는다.
    let app = app();
    let (_dir, root) = vault(&app).await;
    let state = app.state::<LinkIndexState>();
    let ctx = app.state::<ContextManager>();
    let at = ctx.registration("v").await.unwrap().1;
    ctx.remove("v").await.unwrap();
    degrade(app.handle(), &root, at).await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert_eq!(state.rebuild_attempts.load(Ordering::SeqCst), 0);
    // Not vacuous: a job for a live registration attempts.
    let (_dir2, root2) = vault(&app).await;
    let at2 = ctx.registration("v").await.unwrap().1;
    degrade(app.handle(), &root2, at2).await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert_eq!(state.rebuild_attempts.load(Ordering::SeqCst), 1);
}

/// Pause the rebuild worker of `root` just before it decides whether it is done.
fn pause_worker(app: &App, root: &str) -> (Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>) {
    let reached = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    *app.state::<LinkIndexState>()
        .pause_before_finish
        .lock()
        .unwrap() = Some(crate::index::service::state::PauseAfterRead {
        path: root.into(),
        reached: Arc::clone(&reached),
        release: Arc::clone(&release),
    });
    (reached, release)
}

/// Wait up to `secs` for an announcement and a published index under `root`.
async fn settle(
    app: &App,
    root: &str,
    at: u64,
    seen: &Arc<Mutex<Vec<serde_json::Value>>>,
    secs: u64,
) {
    let state = app.state::<LinkIndexState>();
    for _ in 0..secs * 100 {
        if !seen.lock().unwrap().is_empty() && state.with_index_for(root, at, |i| i.is_some()).await
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
}

#[tokio::test]
async fn a_failure_between_a_rebuild_s_publish_and_its_end_is_rebuilt_too() {
    // The worker has published; a second failure drops that index before the worker
    // ends. It must not end — and announce — over the dropped index.
    // 이것을 실패시키는 것: `finish_rebuild` 가 `seen` 을 보지 않고 끝낸다(불리언 claim 으로 되돌린다) —
    // 두 번째 실패는 일하는 worker 를 보고 돌아서고, worker 는 내려간 index 위에서 알린다.
    let app = app();
    let (_dir, root) = vault(&app).await;
    let state = app.state::<LinkIndexState>();
    let at = app
        .state::<ContextManager>()
        .registration("v")
        .await
        .unwrap()
        .1;
    let seen = changes(&app);
    let (reached, release) = pause_worker(&app, &root);
    degrade(app.handle(), &root, at).await;
    tokio::time::timeout(std::time::Duration::from_secs(5), reached.notified())
        .await
        .unwrap();
    assert!(state.with_index_for(&root, at, |i| i.is_some()).await);
    degrade(app.handle(), &root, at).await;
    assert!(!state.with_index_for(&root, at, |i| i.is_some()).await);
    let published = state.published.load(Ordering::SeqCst);
    release.notify_one();
    settle(&app, &root, at, &seen, 5).await;
    assert!(state.with_index_for(&root, at, |i| i.is_some()).await);
    assert_eq!(state.published.load(Ordering::SeqCst), published + 1);
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0]["rebuilt"], serde_json::json!([root]));
}

#[tokio::test]
async fn a_failure_while_a_worker_gives_up_keeps_a_worker() {
    // Every attempt fails (an unusable `.baramignore`); a new failure lands just as the
    // worker would give up, and the file is fixed. The worker goes round again.
    // 이것을 실패시키는 것: 시도를 다 쓴 worker 가 generation 을 보지 않고 끝낸다(`finish_rebuild(.., None)`).
    let app = app();
    let (dir, root) = vault(&app).await;
    let state = app.state::<LinkIndexState>();
    let at = app
        .state::<ContextManager>()
        .registration("v")
        .await
        .unwrap()
        .1;
    let ignore = dir.path().join(crate::fs::BARAMIGNORE);
    std::fs::write(&ignore, "{unclosed\n").unwrap();
    let seen = changes(&app);
    let (reached, release) = pause_worker(&app, &root);
    degrade(app.handle(), &root, at).await;
    tokio::time::timeout(std::time::Duration::from_secs(10), reached.notified())
        .await
        .unwrap();
    // Not vacuous: the worker paused after spending its attempts, not after a publish.
    assert_eq!(state.rebuild_attempts.load(Ordering::SeqCst), 3);
    assert!(!state.with_index_for(&root, at, |i| i.is_some()).await);
    degrade(app.handle(), &root, at).await;
    std::fs::write(&ignore, "drafts/\n").unwrap();
    release.notify_one();
    settle(&app, &root, at, &seen, 5).await;
    assert!(state.with_index_for(&root, at, |i| i.is_some()).await);
    assert_eq!(seen.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_healthy_nested_index_that_took_a_save_is_announced_beside_a_dropped_outer_one() {
    // The outer root's `.baramignore` is unusable, the nested root's rules are fine: the
    // save reached the nested index, so the windows hear about it now.
    // 이것을 실패시키는 것: degrade 가 있는 결과의 경로를 `applied` 와 무관하게 알리지 않는다.
    let app = app();
    let (dir, _v, sub) = nested(&app).await;
    std::fs::write(dir.path().join(crate::fs::BARAMIGNORE), "{unclosed\n").unwrap();
    std::fs::write(dir.path().join("sub/n.md"), "see [[other]]").unwrap();
    let seen = changes(&app);
    let note = format!("{sub}/n.md");
    let fresh = reconcile_effects(app.handle(), &[Effect::Path(note.clone())]).await;
    assert!(!fresh);
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    let entries = seen[0]["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 1);
    assert!(entries[0]["spellings"]
        .as_array()
        .unwrap()
        .iter()
        .any(|s| s == note.as_str()));
}
