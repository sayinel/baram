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
