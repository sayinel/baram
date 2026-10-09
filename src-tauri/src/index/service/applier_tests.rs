// #824 The watcher applier: coalescing by identity, coverage, the cap, rescans, the
// settle window, and router → applier → `index:changed` for the cases the frontend's
// sync used to carry.
use super::*;
use crate::context::{ContextInfo, ContextType};
use crate::index::service::build::refresh_index_inner;
use crate::index::service::get_link_index_inner;
use std::sync::{Arc, Mutex};
use tauri::Listener;

type App = tauri::App<tauri::test::MockRuntime>;

fn app() -> App {
    let app = tauri::test::mock_app();
    app.manage(LinkIndexState::new());
    app.manage(ContextManager::new());
    app.manage(ExternalChanges::new());
    app
}

/// Register `path` as a folder context and build it; its key and canonical root.
async fn vault_at(app: &App, id: &str, path: &Path) -> (String, PathBuf) {
    std::fs::create_dir_all(path).unwrap();
    let key = path.to_str().unwrap().to_string();
    let ctx = app.state::<ContextManager>();
    ctx.add(ContextInfo {
        id: id.into(),
        context_type: ContextType::Folder,
        path: key.clone(),
        label: id.into(),
        color: "#fff".into(),
        alias: None,
        vault_type: None,
        added_at: 0,
    })
    .await
    .unwrap();
    refresh_index_inner(&app.state::<LinkIndexState>(), &ctx, &key)
        .await
        .unwrap();
    let canonical = ctx
        .context_registered_at(&key)
        .await
        .unwrap()
        .canonical_path;
    (key, canonical)
}

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

async fn edges(app: &App, key: &str) -> Vec<(String, String)> {
    let graph = get_link_index_inner(
        &app.state::<LinkIndexState>(),
        &app.state::<ContextManager>(),
        Some(key.to_string()),
    )
    .await
    .unwrap();
    let mut edges: Vec<(String, String)> = graph
        .edges
        .iter()
        .map(|e| (e.from.clone(), e.to.clone()))
        .collect();
    edges.sort();
    edges
}

fn counts(app: &App) -> Counts {
    *app.state::<ExternalChanges>().counts.lock().unwrap()
}

fn mark(app: &App, host: &Path, identity: &Path, spelling: &str) {
    app.state::<ExternalChanges>()
        .mark(host, &[(identity.to_path_buf(), spelling.to_string())]);
}

#[tokio::test]
async fn many_marks_on_few_paths_are_one_unit_each_and_one_announcement() {
    // 이것을 실패시키는 것: mark 가 identity 로 합치지 않고 mark 마다 entry 를 새로 만든다.
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (_key, root) = vault_at(&app, "v", &dir.path().join("v")).await;
    for i in 0..10 {
        std::fs::write(root.join(format!("n{i}.md")), "see [[x]]").unwrap();
    }
    let seen = changes(&app);
    for round in 0..1_000 {
        for i in 0..10 {
            let p = root.join(format!("n{i}.md"));
            mark(&app, &root, &p, &format!("{}#{round}", p.display()));
        }
    }
    apply_batch(app.handle()).await;
    assert_eq!(counts(&app).units, 10);
    assert_eq!(seen.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_group_of_spellings_is_covered_only_past_its_newest_mark() {
    // Two spellings of one note: the first marked before a rebuild began, the second
    // after it. The rebuild did not read the second change; the group gets its unit.
    // Alone, the first mark is covered by that rebuild and skipped.
    // 이것을 실패시키는 것: 합쳐진 entry 가 처음 stamp 를 지킨다(`max` 대신 처음 값).
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (key, root) = vault_at(&app, "v", &dir.path().join("v")).await;
    let note = root.join("n.md");
    std::fs::write(&note, "see [[x]]").unwrap();
    let state = app.state::<LinkIndexState>();
    let ctx = app.state::<ContextManager>();
    mark(&app, &root, &note, "/alias/n.md");
    assert!(crate::index::service::reconcile::rebuild_registration(&state, &ctx, &key).await);
    apply_batch(app.handle()).await;
    assert_eq!((counts(&app).covered, counts(&app).units), (1, 0));
    mark(&app, &root, &note, "/alias/n.md");
    assert!(crate::index::service::reconcile::rebuild_registration(&state, &ctx, &key).await);
    mark(&app, &root, &note, &note.to_string_lossy());
    apply_batch(app.handle()).await;
    assert_eq!((counts(&app).covered, counts(&app).units), (1, 1));
}

#[cfg(unix)]
#[tokio::test]
async fn an_alias_retargeted_or_removed_before_the_take_does_not_move_the_change() {
    // The router saw `alias/n.md` while `alias → v`, and keyed it as `v/n.md`. The alias
    // then points elsewhere, or nowhere; `v/n.md` is still what changed.
    // 이것을 실패시키는 것: take 때 spelling 을 다시 resolve 한다(`reconcile_path_in(spelling)`) —
    // 다른 vault 로 가거나 아무 데도 닿지 않아 `v` 가 낡는다.
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (key, root) = vault_at(&app, "v", &dir.path().join("v")).await;
    std::fs::create_dir(dir.path().join("other")).unwrap();
    std::fs::write(dir.path().join("other/n.md"), "nothing").unwrap();
    let alias = dir.path().join("alias");
    std::os::unix::fs::symlink(&root, &alias).unwrap();
    let note = root.join("n.md");
    std::fs::write(&note, "see [[x]]").unwrap();
    mark(&app, &root, &note, &alias.join("n.md").to_string_lossy());
    std::fs::remove_file(&alias).unwrap();
    std::os::unix::fs::symlink(dir.path().join("other"), &alias).unwrap();
    apply_batch(app.handle()).await;
    let from = format!("{key}/n.md");
    assert!(edges(&app, &key)
        .await
        .iter()
        .any(|(f, t)| *f == from && t.ends_with("/x.md")));
    // Removed: a dangling spelling.
    std::fs::write(&note, "see [[y]]").unwrap();
    mark(&app, &root, &note, &alias.join("n.md").to_string_lossy());
    std::fs::remove_file(&alias).unwrap();
    apply_batch(app.handle()).await;
    assert!(edges(&app, &key)
        .await
        .iter()
        .any(|(f, t)| *f == from && t.ends_with("/y.md")));
}

#[cfg(unix)]
#[tokio::test]
async fn a_path_under_an_unreadable_folder_drops_its_index() {
    // 이것을 실패시키는 것: stat 오류를 `Failed` 대신 사라짐으로 읽는다(index 가 그 노트를 지운 채 남는다).
    use std::os::unix::fs::PermissionsExt;
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (key, root) = vault_at(&app, "v", &dir.path().join("v")).await;
    let locked = root.join("locked");
    std::fs::create_dir(&locked).unwrap();
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
    if std::fs::metadata(locked.join("n.md")).is_ok_and(|_| true)
        || std::fs::read_dir(&locked).is_ok()
    {
        // Running as root: permissions do not bind.
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
        return;
    }
    let state = app.state::<LinkIndexState>();
    let at = app
        .state::<ContextManager>()
        .context_registered_at(&key)
        .await
        .unwrap()
        .incarnation;
    mark(
        &app,
        &root,
        &locked.join("n.md"),
        &locked.join("n.md").to_string_lossy(),
    );
    apply_batch(app.handle()).await;
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(!state.with_index_for(&key, at, |i| i.is_some()).await);
}

#[tokio::test]
async fn past_the_cap_the_host_is_rescanned_and_its_paths_are_not_applied() {
    // 이것을 실패시키는 것: 상한을 넘은 경로도 넣는다(rescan 없이 단위가 CAP + 1 개).
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (key, root) = vault_at(&app, "v", &dir.path().join("v")).await;
    std::fs::write(root.join("late.md"), "see [[x]]").unwrap();
    let state = app.state::<LinkIndexState>();
    let published = state.published.load(std::sync::atomic::Ordering::SeqCst);
    let routed: Vec<(PathBuf, String)> = (0..=CAP)
        .map(|i| {
            let p = root.join(format!("gone{i}.md"));
            (p.clone(), p.to_string_lossy().into_owned())
        })
        .collect();
    app.state::<ExternalChanges>().mark(&root, &routed);
    apply_batch(app.handle()).await;
    let counts = counts(&app);
    assert_eq!((counts.rescans, counts.units), (1, 0));
    assert_eq!(
        state.published.load(std::sync::atomic::Ordering::SeqCst),
        published + 1
    );
    let from = format!("{key}/late.md");
    assert!(edges(&app, &key).await.iter().any(|(f, _)| *f == from));
}

#[tokio::test]
async fn a_delete_marked_before_a_rescan_ends_as_a_fresh_build() {
    // 이것을 실패시키는 것: rescan 이 기다리는 host 의 entry 를 건너뛰면서 rescan 자체를 돌리지 않는다.
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (key, root) = vault_at(&app, "v", &dir.path().join("v")).await;
    let note = root.join("n.md");
    std::fs::write(&note, "see [[x]]").unwrap();
    assert!(
        crate::index::service::reconcile::rebuild_registration(
            &app.state::<LinkIndexState>(),
            &app.state::<ContextManager>(),
            &key
        )
        .await
    );
    std::fs::remove_file(&note).unwrap();
    mark(&app, &root, &note, &note.to_string_lossy());
    app.state::<ExternalChanges>().mark_rescan(&root);
    apply_batch(app.handle()).await;
    let from = format!("{key}/n.md");
    assert!(!edges(&app, &key).await.iter().any(|(f, _)| *f == from));
    assert_eq!(counts(&app).rescans, 1);
}

#[tokio::test]
async fn repeated_writes_to_one_path_are_one_read_and_one_announcement() {
    // 이것을 실패시키는 것: 같은 identity 의 mark 마다 단위를 돌린다.
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (_key, root) = vault_at(&app, "v", &dir.path().join("v")).await;
    let note = root.join("n.md");
    let state = app.state::<LinkIndexState>();
    let reads = state.note_reads.load(std::sync::atomic::Ordering::SeqCst);
    let seen = changes(&app);
    for i in 0..50 {
        std::fs::write(&note, format!("see [[x{i}]]")).unwrap();
        mark(&app, &root, &note, &note.to_string_lossy());
    }
    apply_batch(app.handle()).await;
    assert_eq!(
        state.note_reads.load(std::sync::atomic::Ordering::SeqCst),
        reads + 1
    );
    assert_eq!(seen.lock().unwrap().len(), 1);
}

/// Spawn the applier on the test's (paused) runtime; marks under `host` cover nothing,
/// so no unit does I/O and the counts are the window's.
fn applier(app: &App) {
    let handle = app.handle().clone();
    tokio::spawn(async move { run(handle).await });
}

#[tokio::test(start_paused = true)]
async fn a_mark_inside_the_quiet_window_extends_it() {
    // 0 and 299 ms: one batch, at 599 ms.
    // 이것을 실패시키는 것: 첫 mark 에서 고정된 시간을 잔다(마지막 mark 로 다시 재지 않는다) — 두 batch.
    let app = app();
    applier(&app);
    let host = PathBuf::from("/nowhere/host");
    mark(&app, &host, &host.join("a.md"), "/nowhere/host/a.md");
    tokio::time::sleep(Duration::from_millis(299)).await;
    mark(&app, &host, &host.join("b.md"), "/nowhere/host/b.md");
    tokio::time::sleep(Duration::from_millis(298)).await;
    assert_eq!(counts(&app).takes, 0);
    tokio::time::sleep(Duration::from_millis(5)).await;
    assert_eq!(counts(&app).takes, 1);
}

#[tokio::test(start_paused = true)]
async fn a_mark_after_the_quiet_window_is_a_second_batch() {
    // 0 and 301 ms: two batches.
    // 이것을 실패시키는 것: 창이 끝난 뒤의 mark 를 앞 batch 에 넣는다(take 를 늦게 한다).
    let app = app();
    applier(&app);
    let host = PathBuf::from("/nowhere/host");
    mark(&app, &host, &host.join("a.md"), "/nowhere/host/a.md");
    tokio::time::sleep(Duration::from_millis(301)).await;
    assert_eq!(counts(&app).takes, 1);
    mark(&app, &host, &host.join("b.md"), "/nowhere/host/b.md");
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(counts(&app).takes, 2);
}

#[tokio::test(start_paused = true)]
async fn a_stream_of_marks_is_taken_at_the_latency_bound() {
    // A mark every 100 ms for 5 s: a batch at 2 s and at 4 s, then one after the quiet.
    // 이것을 실패시키는 것: 최대 지연 없이 조용해질 때만 take 한다 — 5 s 동안 batch 가 없다.
    let app = app();
    applier(&app);
    let host = PathBuf::from("/nowhere/host");
    for i in 0..50 {
        mark(
            &app,
            &host,
            &host.join(format!("{i}.md")),
            "/nowhere/host/x.md",
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert_eq!(counts(&app).takes, 2);
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(counts(&app).takes, 3);
}

#[tokio::test]
async fn a_host_that_ended_is_rescanned_when_it_starts_again() {
    // 이것을 실패시키는 것: `starting` 이 끝났던 host 에 rescan 을 걸지 않는다.
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (_key, root) = vault_at(&app, "v", &dir.path().join("v")).await;
    let changes = app.state::<ExternalChanges>();
    changes.starting(&root);
    apply_batch(app.handle()).await;
    assert_eq!(counts(&app).rescans, 0);
    changes.note_ended(&root);
    changes.starting(&root);
    apply_batch(app.handle()).await;
    assert_eq!(counts(&app).rescans, 1);
}

// Router → applier → `index:changed`: what the frontend's sync carried, through the
// real filter and router.

/// Route one notify event of `kind` on `path` through a host on `root` with `spellings`.
#[allow(clippy::too_many_arguments)] // a router's whole input: host, scope, focus, spellings, event
fn route(
    app: &App,
    root: &Path,
    recursive: bool,
    focus: &[&Path],
    spellings: Vec<(PathBuf, PathBuf)>,
    kind: notify::EventKind,
    path: &Path,
) {
    let spec = crate::fs::watch_registry::WatchSpec {
        key: root.to_path_buf(),
        root: root.to_string_lossy().into_owned(),
        recursive,
        generation: 1,
        focus: Arc::new(std::sync::RwLock::new(
            focus.iter().map(|p| p.to_path_buf()).collect(),
        )),
        spellings: Arc::new(std::sync::RwLock::new(spellings)),
    };
    let sinks = crate::commands::watch_cmd::sinks_for(app.handle(), &spec);
    let mut filter = crate::fs::WatchFilter::for_watch(
        root,
        recursive,
        Arc::clone(&spec.focus),
        Arc::clone(&spec.spellings),
    );
    let event = notify::Event::new(kind).add_path(path.to_path_buf());
    crate::fs::route_event(&mut filter, &event, root, root, &sinks, &mut |_, _| {});
}

fn modified() -> notify::EventKind {
    notify::EventKind::Modify(notify::event::ModifyKind::Data(
        notify::event::DataChange::Content,
    ))
}

#[tokio::test]
async fn an_external_save_is_announced_in_every_spelling_the_router_emitted() {
    // The vault registered as one spelling, the OS reporting another: the event carries
    // the registered one, which the frontend matches to the active tab (#791, #797).
    // 이것을 실패시키는 것: 단위가 spelling 대신 identity 만 싣는다(`reconcile_identity_in(.., vec![])`).
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (key, root) = vault_at(&app, "v", &dir.path().join("v")).await;
    let note = root.join("n.md");
    std::fs::write(&note, "see [[x]]").unwrap();
    let spelled = PathBuf::from("/spelled/v");
    let seen = changes(&app);
    route(
        &app,
        &root,
        true,
        &[],
        vec![(root.clone(), spelled.clone())],
        modified(),
        &note,
    );
    apply_batch(app.handle()).await;
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    let spellings = seen[0]["entries"][0]["spellings"]
        .as_array()
        .unwrap()
        .clone();
    assert!(
        spellings.iter().any(|s| s == "/spelled/v/n.md"),
        "{spellings:?}"
    );
    assert!(
        spellings.iter().any(|s| *s == format!("{key}/n.md")),
        "{spellings:?}"
    );
}

#[tokio::test]
async fn an_external_non_markdown_file_becomes_a_link_target() {
    // 이것을 실패시키는 것: 단위가 마크다운이 아닌 파일을 대상으로 등록하지 않는다(`Point::Nothing`).
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (key, root) = vault_at(&app, "v", &dir.path().join("v")).await;
    let pdf = root.join("paper.pdf");
    std::fs::write(&pdf, b"%PDF").unwrap();
    route(
        &app,
        &root,
        true,
        &[],
        vec![],
        notify::EventKind::Create(notify::event::CreateKind::File),
        &pdf,
    );
    apply_batch(app.handle()).await;
    let state = app.state::<LinkIndexState>();
    let at = app
        .state::<ContextManager>()
        .context_registered_at(&key)
        .await
        .unwrap()
        .incarnation;
    assert!(state.holds_path(&key, at, &pdf).await);
}

#[tokio::test]
async fn nested_roots_each_take_an_external_change_by_their_own_rules() {
    // The outer vault excludes `sub/x.md`, the nested one includes it. Each host routes
    // by its own rules; each index ends as its own fresh build.
    // 이것을 실패시키는 것: index 가 자기 matcher 로 판정하지 않는다(`LinkIndex::update_file_from_content`
    // 의 `walk_skips` 를 걷는다) — 바깥 index 가 제외된 노트를 받는다.
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let v = dir.path().join("v");
    std::fs::create_dir_all(v.join("sub")).unwrap();
    std::fs::write(v.join(crate::fs::BARAMIGNORE), "sub/x.md\n").unwrap();
    let (outer, outer_root) = vault_at(&app, "o", &v).await;
    let (inner, inner_root) = vault_at(&app, "i", &v.join("sub")).await;
    let note = inner_root.join("x.md");
    std::fs::write(&note, "see [[y]]").unwrap();
    for host in [&outer_root, &inner_root] {
        route(&app, host, true, &[], vec![], modified(), &note);
    }
    apply_batch(app.handle()).await;
    assert_eq!(counts(&app).units, 1);
    let from = |key: &str| format!("{key}/x.md");
    assert!(edges(&app, &inner)
        .await
        .iter()
        .any(|(f, _)| *f == from(&inner)));
    assert!(!edges(&app, &outer)
        .await
        .iter()
        .any(|(f, _)| f.ends_with("/sub/x.md")));
}

#[tokio::test]
async fn two_spellings_of_one_file_are_one_unit() {
    // 이것을 실패시키는 것: entry 를 identity 가 아니라 spelling 으로 묶는다 — 단위가 둘.
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (_key, root) = vault_at(&app, "v", &dir.path().join("v")).await;
    let note = root.join("n.md");
    std::fs::write(&note, "see [[x]]").unwrap();
    let seen = changes(&app);
    route(
        &app,
        &root,
        true,
        &[],
        vec![
            (root.clone(), PathBuf::from("/one/v")),
            (root.clone(), PathBuf::from("/two/v")),
        ],
        modified(),
        &note,
    );
    assert_eq!(app.state::<ExternalChanges>().pending(), 1);
    apply_batch(app.handle()).await;
    assert_eq!(counts(&app).units, 1);
    let spellings = seen.lock().unwrap()[0]["entries"][0]["spellings"].clone();
    for spelled in ["/one/v/n.md", "/two/v/n.md"] {
        assert!(spellings.as_array().unwrap().iter().any(|s| s == spelled));
    }
}

#[tokio::test]
async fn a_file_window_s_folder_watch_keeps_its_vault_s_index() {
    // A file window watches the folder of one note, non-recursively, with no window on
    // the vault. Its router's change still reaches the vault's index.
    // 이것을 실패시키는 것: non-recursive host 의 mark 를 버린다(`on_paths` 를 recursive 일 때만).
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (key, root) = vault_at(&app, "v", &dir.path().join("v")).await;
    let folder = root.join("notes");
    std::fs::create_dir(&folder).unwrap();
    let note = folder.join("n.md");
    std::fs::write(&note, "see [[x]]").unwrap();
    route(&app, &folder, false, &[&note], vec![], modified(), &note);
    apply_batch(app.handle()).await;
    let from = format!("{key}/notes/n.md");
    assert!(edges(&app, &key).await.iter().any(|(f, _)| *f == from));
}
