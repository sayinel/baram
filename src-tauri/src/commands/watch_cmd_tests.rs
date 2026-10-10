use super::*;

/// A store approving each of `dirs` (canonical), as `ensure_approved` records them.
fn approving(dirs: &[&Path]) -> crate::approval::ApprovalStore {
    crate::approval::ApprovalStore {
        version: 1,
        entries: dirs
            .iter()
            .map(|d| crate::approval::ApprovalEntry {
                path: std::fs::canonicalize(d)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                kind: crate::approval::ApprovalKind::Dir,
                approved_at: 0,
            })
            .collect(),
    }
}

fn context(id: &str, path: &str, kind: crate::context::ContextType) -> crate::context::ContextInfo {
    crate::context::ContextInfo {
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

// §3.2 #797 — a page may watch only what the app opened: the events tell it the
// names and times of what changes in the folder.
#[tokio::test]
async fn watch_dir_watches_only_what_the_app_opened() {
    use crate::context::{ContextManager, ContextType};
    let vault = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let v = vault.path().to_str().unwrap().to_string();
    let o = outside.path().to_str().unwrap().to_string();
    std::fs::create_dir(vault.path().join("sub")).unwrap();
    let ext = outside.path().join("e.md");
    std::fs::write(&ext, "x").unwrap();
    let ext = ext.to_str().unwrap().to_string();
    let ctx = ContextManager::new();
    ctx.add(context("v", &v, ContextType::Vault)).await.unwrap();
    ctx.add(context("f", &ext, ContextType::File))
        .await
        .unwrap();
    let approvals = approving(&[vault.path(), outside.path()]);

    // Registered is not enough: what authorizes the watch must be approved now — a
    // registration outlives the revocation of its approval until the frontend closes it.
    // 이것을 실패시키는 것: `approved` 가 승인 기록을 보지 않는다.
    let none = approving(&[]);
    assert!(authorize_watch(&ctx, None, &none, &v, true, None)
        .await
        .is_err());
    assert!(authorize_watch(&ctx, None, &none, &o, false, Some(&ext))
        .await
        .is_err());

    // Recursive: a registered root only.
    // 이것을 실패시키는 것: 재귀 요청에 `context_registered_at` 검사를 지운다.
    assert!(authorize_watch(&ctx, None, &approvals, &v, true, None)
        .await
        .is_ok());
    assert!(
        authorize_watch(&ctx, None, &approvals, &format!("{v}/sub"), true, None)
            .await
            .is_err()
    );
    assert!(authorize_watch(&ctx, None, &approvals, &o, true, None)
        .await
        .is_err());

    // Non-recursive: the folder of a file the app opened, naming that file.
    assert!(
        authorize_watch(&ctx, None, &approvals, &o, false, Some(&ext))
            .await
            .is_ok()
    );
    // 이것을 실패시키는 것: focus 없는 비재귀 요청을 받는다.
    assert!(authorize_watch(&ctx, None, &approvals, &o, false, None)
        .await
        .is_err());
    // 이것을 실패시키는 것: focus 가 `path` 의 파일인지 확인하지 않는다.
    assert!(
        authorize_watch(&ctx, None, &approvals, &v, false, Some(&ext))
            .await
            .is_err()
    );
    // 이것을 실패시키는 것: focus 를 `validate_path_any` 로 확인하지 않는다.
    let stray = outside.path().join("other.md");
    std::fs::write(&stray, "x").unwrap();
    assert!(authorize_watch(
        &ctx,
        None,
        &approvals,
        &o,
        false,
        Some(stray.to_str().unwrap())
    )
    .await
    .is_err());
}

// §3.2 #797 — `/approved/vault` removed and made a link to a folder never approved:
// the watch is not taken again through it.
#[cfg(unix)]
#[tokio::test]
async fn a_registered_folder_swapped_for_a_link_is_not_watched_again() {
    use crate::context::{ContextManager, ContextType};
    let links = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let vault = links.path().join("vault");
    std::fs::create_dir(&vault).unwrap();
    let v = vault.to_str().unwrap().to_string();
    let ctx = ContextManager::new();
    ctx.add(context("v", &v, ContextType::Vault)).await.unwrap();
    // The link's new target approved too: what refuses it is the registration.
    let approvals = approving(&[vault.as_path(), elsewhere.path()]);
    assert!(authorize_watch(&ctx, None, &approvals, &v, true, None)
        .await
        .is_ok());
    std::fs::remove_dir(&vault).unwrap();
    std::os::unix::fs::symlink(elsewhere.path(), &vault).unwrap();
    // 이것을 실패시키는 것: 재귀 요청을 적힌 경로로 판정한다(`context_registered_at` 대신 등록된 문자열 비교).
    assert!(authorize_watch(&ctx, None, &approvals, &v, true, None)
        .await
        .is_err());
}

fn view(id: u64, path: &str, recursive: bool, focus: Option<&str>, authority: &Path) -> LeaseView {
    LeaseView {
        id,
        path: path.to_string(),
        recursive,
        focus: focus.map(str::to_string),
        authority: authority.to_path_buf(),
    }
}

// §3.2 #797 — a removed context takes the watches only it authorized.
#[tokio::test]
async fn a_removed_context_ends_what_only_it_authorized() {
    use crate::context::{ContextManager, ContextType};
    let vault = tempfile::tempdir().unwrap();
    let v = std::fs::canonicalize(vault.path()).unwrap();
    std::fs::write(v.join("a.md"), "x").unwrap();
    std::fs::write(v.join("b.md"), "x").unwrap();
    let vs = v.to_str().unwrap().to_string();
    let a = format!("{vs}/a.md");
    let b = format!("{vs}/b.md");
    let ctx = ContextManager::new();
    ctx.add(context("v", &vs, ContextType::Vault))
        .await
        .unwrap();
    let approvals = approving(&[vault.path()]);
    // `b.md` is also open on its own (a file window's File context).
    ctx.add(context("b", &b, ContextType::File)).await.unwrap();
    let views = vec![
        view(1, &vs, true, None, &v),
        view(2, &vs, false, Some(&a), &v.join("a.md")),
        view(3, &vs, false, Some(&b), &v.join("b.md")),
    ];
    ctx.remove("v").await.unwrap();
    // 이것을 실패시키는 것: `reauthorize` 가 다시 판정하지 않고 모두 끝낸다 — 또는 모두 남긴다.
    let (kept, lapsed) = reauthorize(&ctx, None, &approvals, views).await;
    assert_eq!(lapsed, vec![1, 2]);
    assert_eq!(kept, vec![(3, v.join("b.md"))]);
}

// §3.2 #797 §335 — revoking an approval ends the watches it allowed, not others.
#[test]
fn a_revoked_approval_ends_the_watches_under_it_only() {
    use crate::approval::{ApprovalEntry, ApprovalKind, ApprovalStore};
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let a = std::fs::canonicalize(a.path()).unwrap();
    let b = std::fs::canonicalize(b.path()).unwrap();
    // What is left after `a` was revoked: `b`, and a file inside `a` approved on its own.
    std::fs::write(a.join("kept.md"), "x").unwrap();
    std::fs::write(a.join("gone.md"), "x").unwrap();
    let entry = |p: &Path, kind| ApprovalEntry {
        path: p.to_string_lossy().into_owned(),
        kind,
        approved_at: 0,
    };
    let store = ApprovalStore {
        version: 1,
        entries: vec![
            entry(&b, ApprovalKind::Dir),
            entry(&a.join("kept.md"), ApprovalKind::File),
        ],
    };
    let views = vec![
        view(1, a.to_str().unwrap(), true, None, &a),
        view(2, a.to_str().unwrap(), false, None, &a.join("gone.md")),
        view(3, a.to_str().unwrap(), false, None, &a.join("kept.md")),
        view(4, b.to_str().unwrap(), true, None, &b),
        // Never approved, and not under the revoked root: not this revocation's to end.
        view(5, "/", true, None, Path::new("/")),
    ];
    // 이것을 실패시키는 것: 회수된 root 아래 lease 를 승인 여부와 무관하게 모두 끝낸다 — 또는 root 아래인지 보지 않는다.
    assert_eq!(lapsed_by_revocation(&store, &a, &views), vec![1, 2]);
}

fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    use tauri::Manager;
    let app = tauri::test::mock_builder()
        .invoke_handler(tauri::generate_handler![
            crate::commands::context_cmd::remove_context
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app must build");
    app.manage(crate::context::ContextManager::new());
    app.manage(crate::VaultRootState(Default::default()));
    app.manage(crate::index::service::LinkIndexState::new());
    app.manage(crate::WatcherState(Default::default()));
    app
}

/// A real lease on `path` for window `main`, authorized by `authority`.
fn lease<R: tauri::Runtime>(app: &tauri::AppHandle<R>, path: &str, authority: &Path) -> u64 {
    with_registry(app, |registry, spawn| {
        registry.acquire(
            LeaseRequest {
                window: "main",
                path,
                recursive: true,
                focus: None,
                authority: authority.to_path_buf(),
                page: 0,
            },
            spawn,
        )
    })
    .unwrap()
    .unwrap()
}

fn held<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Vec<u64> {
    with_registry(app, |registry, _| {
        let mut ids: Vec<u64> = registry
            .leases_where(|_| true)
            .iter()
            .map(|l| l.id)
            .collect();
        ids.sort_unstable();
        ids
    })
    .unwrap()
}

// §3.2 #797 — `remove_context` itself ends the watches the context authorized, through
// the command a page calls.
#[test]
fn remove_context_ends_the_watches_of_the_context_it_removes() {
    use crate::context::ContextType;
    use tauri::Manager;
    let app = mock_app();
    let gone = tempfile::tempdir().unwrap();
    let stays = tempfile::tempdir().unwrap();
    let gone = std::fs::canonicalize(gone.path()).unwrap();
    let stays = std::fs::canonicalize(stays.path()).unwrap();
    let (g, s) = (gone.to_str().unwrap(), stays.to_str().unwrap());
    let ctx = app.state::<crate::context::ContextManager>();
    tauri::async_runtime::block_on(async {
        ctx.add(context("g", g, ContextType::Vault)).await.unwrap();
        ctx.add(context("s", s, ContextType::Vault)).await.unwrap();
    });
    lease(app.handle(), g, &gone);
    let kept = lease(app.handle(), s, &stays);
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("mock webview must build");
    let res = tauri::test::get_ipc_response(
        &webview,
        tauri::webview::InvokeRequest {
            cmd: "remove_context".into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: if cfg!(any(windows, target_os = "android")) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .unwrap(),
            body: tauri::ipc::InvokeBody::Json(serde_json::json!({ "contextId": "g" })),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    );
    assert!(res.is_ok(), "{res:?}");
    // 이것을 실패시키는 것: `remove_context` 가 `after_context_removed` 를 부르지 않는다.
    assert_eq!(held(app.handle()), vec![kept]);
}

// §3.2 #797 §335 — a revocation ends the watches under the revoked root at once.
#[test]
fn a_revocation_ends_the_watches_under_it_in_the_running_app() {
    let app = mock_app();
    let revoked = tempfile::tempdir().unwrap();
    let revoked = std::fs::canonicalize(revoked.path()).unwrap();
    let other = tempfile::tempdir().unwrap();
    let other = std::fs::canonicalize(other.path()).unwrap();
    lease(app.handle(), revoked.to_str().unwrap(), &revoked);
    let kept = lease(app.handle(), other.to_str().unwrap(), &other);
    // 이것을 실패시키는 것: `after_approval_revoked` 가 판정한 lease 를 `end_leases` 로 넘기지 않는다.
    after_approval_revoked(app.handle(), revoked.to_str().unwrap());
    assert_eq!(held(app.handle()), vec![kept]);
}

// §3.2 #797 — a context removed while a lease was being taken: its sweep ran before the
// lease existed, so `take_lease` checks again after taking it.
#[test]
fn a_lease_whose_authority_went_while_it_was_taken_is_given_back() {
    let app = mock_app();
    let dir = tempfile::tempdir().unwrap();
    let d = std::fs::canonicalize(dir.path()).unwrap();
    let request = Request {
        window: "main",
        path: d.to_str().unwrap(),
        recursive: true,
        focus: None,
        page: 0,
    };
    let checks = std::cell::Cell::new(0);
    let gone_after_first = || {
        checks.set(checks.get() + 1);
        let first = checks.get() == 1;
        let d = d.clone();
        async move {
            if first {
                Ok(d)
            } else {
                Err("watch-unauthorized: removed".to_string())
            }
        }
    };
    // 이것을 실패시키는 것: `take_lease` 가 lease 를 잡은 뒤 다시 인가하지 않는다.
    let refused =
        tauri::async_runtime::block_on(take_lease(app.handle(), &request, gone_after_first));
    assert!(refused.is_err());
    assert_eq!(checks.get(), 2);
    assert_eq!(held(app.handle()), Vec::<u64>::new());
    // Still authorized after: the lease stays.
    let d2 = d.clone();
    let held_id = tauri::async_runtime::block_on(take_lease(app.handle(), &request, || {
        let d = d2.clone();
        async move { Ok(d) }
    }))
    .unwrap();
    assert_eq!(held(app.handle()), vec![held_id]);
}

/// A recursive host on `root` (canonical), as the registry would start it.
fn host_spec(root: &Path) -> WatchSpec {
    WatchSpec {
        key: root.to_path_buf(),
        root: root.to_string_lossy().into_owned(),
        recursive: true,
        generation: 1,
        focus: Default::default(),
        spellings: Default::default(),
    }
}

// §29 #824 — the router marks a routed batch for the link index before it emits the
// batch's `file:*` events, and the mark never waits on the watch registry (which
// `spawn_watcher` is called under) or on any index lock.
#[test]
fn the_router_marks_a_batch_before_emitting_it_without_the_registry() {
    // 이것을 실패시키는 것: `route_event` 가 file:* 를 낸 뒤에 `on_paths` 를 부른다 — 또는 mark sink 가
    // registry 를 잡는다(`with_registry`) — 그러면 이 router 가 멈춘다.
    use notify::event::{DataChange, ModifyKind};
    use tauri::Manager;
    let app = mock_app();
    app.manage(ExternalChanges::new());
    let dir = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(dir.path()).unwrap();
    std::fs::write(root.join("n.md"), "see [[x]]").unwrap();
    let spec = host_spec(&root);
    let sinks = sinks_for(app.handle(), &spec);
    let mut filter =
        crate::fs::WatchFilter::for_watch(&root, true, Default::default(), Default::default());
    let event = notify::Event::new(notify::EventKind::Modify(ModifyKind::Data(
        DataChange::Content,
    )))
    .add_path(root.join("n.md"));
    let held = app.state::<crate::WatcherState>();
    let registry = held.0.lock().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = app.handle().clone();
    std::thread::spawn(move || {
        let mut emitted = Vec::new();
        crate::fs::route_event(&mut filter, &event, &sinks, &mut |name, _| {
            emitted.push((name, handle.state::<ExternalChanges>().pending()));
        });
        let _ = tx.send(emitted);
    });
    let emitted = rx
        .recv_timeout(std::time::Duration::from_secs(10))
        .expect("the router waited");
    drop(registry);
    // One `file:changed`, and the path was already marked when it went out.
    assert_eq!(emitted, [("file:changed", 1)]);
}

#[test]
fn an_event_the_os_flags_for_a_rescan_marks_its_host() {
    // 이것을 실패시키는 것: `route_event` 가 `need_rescan` 을 보지 않는다.
    use tauri::Manager;
    let app = mock_app();
    app.manage(ExternalChanges::new());
    let dir = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(dir.path()).unwrap();
    let sinks = sinks_for(app.handle(), &host_spec(&root));
    let mut filter =
        crate::fs::WatchFilter::for_watch(&root, true, Default::default(), Default::default());
    let event = notify::Event::new(notify::EventKind::Other).set_flag(notify::event::Flag::Rescan);
    crate::fs::route_event(&mut filter, &event, &sinks, &mut |_, _| {});
    assert_eq!(app.state::<ExternalChanges>().pending_rescans(), 1);
}

#[test]
fn a_host_whose_watcher_ended_is_rescanned_when_it_is_started_again() {
    // 이것을 실패시키는 것: `spawn_watcher` 가 `ExternalChanges::starting` 을 부르지 않는다.
    use tauri::Manager;
    let app = mock_app();
    app.manage(ExternalChanges::new());
    let dir = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(dir.path()).unwrap();
    let changes = app.state::<ExternalChanges>();
    let first = spawn_watcher(app.handle(), &host_spec(&root)).unwrap();
    assert_eq!(changes.pending_rescans(), 0);
    drop(first);
    changes.note_ended(&root);
    let _second = spawn_watcher(app.handle(), &host_spec(&root)).unwrap();
    assert_eq!(changes.pending_rescans(), 1);
}

#[tokio::test]
async fn a_failed_restart_keeps_the_host_marked_until_a_watcher_starts() {
    // The host's watcher ended; the next start fails (its folder is away), a note is
    // written while nothing watches, then a start succeeds. That start rescans, and the
    // write is in the index.
    // 이것을 실패시키는 것: `spawn_watcher` 가 시작하기 전에 `ended` 를 소비한다 — 실패한 시작이 표식을
    // 가져가 성공한 시작은 rescan 하지 않는다.
    use tauri::Manager;
    let app = mock_app();
    app.manage(ExternalChanges::new());
    let dir = tempfile::tempdir().unwrap();
    let v = dir.path().join("v");
    std::fs::create_dir(&v).unwrap();
    std::fs::write(v.join("a.md"), "see [[b]]").unwrap();
    let key = v.to_string_lossy().into_owned();
    let ctx = app.state::<crate::context::ContextManager>();
    ctx.add(context("v", &key, crate::context::ContextType::Folder))
        .await
        .unwrap();
    let state = app.state::<crate::index::service::LinkIndexState>();
    crate::index::service::refresh_index_inner(&state, &ctx, &key)
        .await
        .unwrap();
    let root = std::fs::canonicalize(&v).unwrap();
    let changes = app.state::<ExternalChanges>();
    changes.note_ended(&root);
    let away = dir.path().join("away");
    std::fs::rename(&v, &away).unwrap();
    assert!(spawn_watcher(app.handle(), &host_spec(&root)).is_err());
    assert_eq!(changes.pending_rescans(), 0);
    std::fs::rename(&away, &v).unwrap();
    std::fs::write(v.join("a.md"), "see [[late]]").unwrap();
    let _watcher = spawn_watcher(app.handle(), &host_spec(&root)).unwrap();
    assert_eq!(changes.pending_rescans(), 1);
    crate::index::service::apply_watched_batch(app.handle()).await;
    let graph = crate::index::service::get_link_index_inner(&state, &ctx, Some(key.clone()))
        .await
        .unwrap();
    assert!(graph
        .edges
        .iter()
        .any(|e| e.from == format!("{key}/a.md") && e.to.ends_with("late.md")));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_restart_s_rescan_waits_for_its_watcher() {
    // A start held past the settle window: the applier, running, takes nothing — the
    // rescan is marked only once the watcher is in place.
    // 이것을 실패시키는 것: rescan 을 시작 전에 건다 — applier 가 아직 감시하지 않는 동안 rescan 을 돌린다.
    use tauri::Manager;
    let app = mock_app();
    app.manage(ExternalChanges::new());
    tokio::spawn(crate::index::service::run_applier(app.handle().clone()));
    let dir = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(dir.path()).unwrap();
    let changes = app.state::<ExternalChanges>();
    changes.note_ended(&root);
    let (release, gate) = std::sync::mpsc::channel();
    *START_GATE.lock().unwrap() = Some((root.clone(), gate));
    let (handle, spec) = (app.handle().clone(), host_spec(&root));
    let starting = std::thread::spawn(move || spawn_watcher(&handle, &spec).map(drop));
    tokio::time::sleep(crate::index::service::APPLIER_SETTLE * 2).await;
    assert_eq!(changes.pending_rescans(), 0);
    assert_eq!(changes.counts.lock().unwrap().rescans, 0);
    release.send(()).unwrap();
    starting.join().unwrap().unwrap();
    for _ in 0..200 {
        if changes.counts.lock().unwrap().rescans == 1 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert_eq!(changes.counts.lock().unwrap().rescans, 1);
}
