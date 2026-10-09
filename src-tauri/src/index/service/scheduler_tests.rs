// #824 The rebuild scheduler: one attempt at a time, a backoff that settles on a slow
// terminal cadence, intersecting roots postponed together, prompt wakes and cancels.
// Attempts are counted under paused time with the walk stood in for
// (`LinkIndexState::fake_rebuild`), so the counts are the schedule's and no I/O's.
use super::*;
use crate::context::{ContextInfo, ContextType};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Listener;

type App = tauri::App<tauri::test::MockRuntime>;

fn app() -> App {
    let app = tauri::test::mock_app();
    app.manage(LinkIndexState::new());
    app.manage(ContextManager::new());
    app
}

/// Register `path` (created) as a folder context; its key, incarnation and canonical root.
async fn registered(app: &App, id: &str, path: &Path) -> (String, u64, PathBuf) {
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
    let r = ctx.context_registered_at(&key).await.unwrap();
    (key, r.incarnation, r.canonical_path)
}

/// Attempts per key, and whether they succeed.
fn stand_in(app: &App, succeed: Arc<AtomicBool>) -> Arc<Mutex<HashMap<String, usize>>> {
    let counts = Arc::new(Mutex::new(HashMap::new()));
    let sink = Arc::clone(&counts);
    *app.state::<LinkIndexState>().fake_rebuild.lock().unwrap() =
        Some(Arc::new(move |key: &str| {
            *sink.lock().unwrap().entry(key.to_string()).or_insert(0) += 1;
            succeed.load(Ordering::SeqCst)
        }));
    counts
}

fn announced(app: &App) -> Arc<Mutex<usize>> {
    let seen = Arc::new(Mutex::new(0));
    let sink = Arc::clone(&seen);
    app.listen_any("index:changed", move |_| *sink.lock().unwrap() += 1);
    seen
}

fn count(counts: &Arc<Mutex<HashMap<String, usize>>>, key: &str) -> usize {
    counts.lock().unwrap().get(key).copied().unwrap_or(0)
}

#[tokio::test(start_paused = true)]
async fn a_job_that_keeps_failing_settles_on_the_terminal_cadence() {
    // Attempts at 0, 1, 3, 7, 15, 31, 61 and 661 s: eight in fifteen minutes.
    // 이것을 실패시키는 것: `TERMINAL` 대신 마지막 backoff(30 s)를 계속 쓴다 — 15 분에 34 번.
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (key, at, root) = registered(&app, "v", &dir.path().join("v")).await;
    let counts = stand_in(&app, Arc::new(AtomicBool::new(false)));
    app.state::<LinkIndexState>()
        .request_rebuild(&key, at, &root);
    ensure_started(app.handle());
    tokio::time::sleep(Duration::from_secs(900)).await;
    assert_eq!(count(&counts, &key), 8);
}

#[tokio::test(start_paused = true)]
async fn intersecting_failing_roots_share_one_schedule_and_a_separate_one_keeps_its_own() {
    // A vault and one nested in it fail together: each failure postpones the other and
    // carries its escalation, so they take turns on about one schedule (at most 9
    // attempts), neither starving. A vault elsewhere keeps its own eight.
    // 이것을 실패시키는 것: `record_failure` 가 교차하는 root 의 job 에 escalation 을 나누지 않는다 —
    // 미루기만 하면 7 번씩 14 번.
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (outer, outer_at, outer_root) = registered(&app, "o", &dir.path().join("v")).await;
    let (inner, inner_at, inner_root) = registered(&app, "i", &dir.path().join("v/sub")).await;
    let (other, other_at, other_root) = registered(&app, "w", &dir.path().join("w")).await;
    let counts = stand_in(&app, Arc::new(AtomicBool::new(false)));
    let state = app.state::<LinkIndexState>();
    state.request_rebuild(&outer, outer_at, &outer_root);
    state.request_rebuild(&inner, inner_at, &inner_root);
    state.request_rebuild(&other, other_at, &other_root);
    ensure_started(app.handle());
    tokio::time::sleep(Duration::from_secs(900)).await;
    let (o, i) = (count(&counts, &outer), count(&counts, &inner));
    assert!(o + i <= 9, "outer {o} + inner {i}");
    assert!(o >= 3 && i >= 3, "outer {o}, inner {i}");
    assert_eq!(count(&counts, &other), 8);
}

#[tokio::test(start_paused = true)]
async fn a_removed_registration_s_job_goes_at_once() {
    // 이것을 실패시키는 것: `forget` 이 job 을 지우지 않는다 — job 이 남고 다음 wake 마다 다시 시도한다.
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (key, at, root) = registered(&app, "v", &dir.path().join("v")).await;
    let counts = stand_in(&app, Arc::new(AtomicBool::new(false)));
    let state = app.state::<LinkIndexState>();
    state.request_rebuild(&key, at, &root);
    ensure_started(app.handle());
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(count(&counts, &key), 1);
    assert_eq!(state.rebuild_jobs_len(), 1);
    // Sleeping toward its next attempt when the registration is removed.
    state.forget(&key, at).await;
    assert_eq!(state.rebuild_jobs_len(), 0);
    tokio::time::sleep(Duration::from_secs(900)).await;
    assert_eq!(count(&counts, &key), 1);
}

#[tokio::test(start_paused = true)]
async fn a_relevant_mark_wakes_a_job_in_its_terminal_cadence() {
    // Seven failures put the next attempt ten minutes out; the `.baramignore` is fixed
    // and its mark pokes the job, which publishes within the per-job gap.
    // 이것을 실패시키는 것: `poke_under` 가 job 을 당기지 않는다 — 다음 시도가 661 s 까지 미뤄진다.
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (key, at, root) = registered(&app, "v", &dir.path().join("v")).await;
    let succeed = Arc::new(AtomicBool::new(false));
    let counts = stand_in(&app, Arc::clone(&succeed));
    let seen = announced(&app);
    let state = app.state::<LinkIndexState>();
    state.request_rebuild(&key, at, &root);
    ensure_started(app.handle());
    tokio::time::sleep(Duration::from_secs(62)).await;
    assert_eq!(count(&counts, &key), 7);
    succeed.store(true, Ordering::SeqCst);
    state.poke_under(&root.join(crate::fs::BARAMIGNORE));
    tokio::time::sleep(Duration::from_secs(3)).await;
    assert_eq!(count(&counts, &key), 8);
    assert_eq!(*seen.lock().unwrap(), 1);
    assert_eq!(state.rebuild_jobs_len(), 0);
}

#[tokio::test]
async fn a_publication_by_another_builder_makes_the_job_due_at_once() {
    // A failure pushed the job's next attempt out; a refresh then publishes the same
    // incarnation. The job is due now, to see that and end.
    // 이것을 실패시키는 것: `publish` 가 `poke_key` 를 부르지 않는다 — job 이 다음 backoff 까지 남는다.
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (key, at, root) = registered(&app, "v", &dir.path().join("v")).await;
    let state = app.state::<LinkIndexState>();
    state.request_rebuild(&key, at, &root);
    let start = Instant::now();
    state.record_failure(&key, at, start);
    state.record_failure(&key, at, start);
    assert!(state.job_due(&key, at).unwrap() >= start + Duration::from_secs(2));
    crate::index::service::refresh_index_inner(&state, &app.state::<ContextManager>(), &key)
        .await
        .unwrap();
    assert!(state.job_due(&key, at).unwrap() <= Instant::now());
}
