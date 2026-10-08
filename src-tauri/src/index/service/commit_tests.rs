// #824 What a command changed is in every covering link index before it answers.
use super::*;
use crate::context::{ContextInfo, ContextType};
use crate::index::service::build::refresh_index_inner;
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
