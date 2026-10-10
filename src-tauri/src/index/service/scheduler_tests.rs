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
        Some(Arc::new(move |key: String| {
            *sink.lock().unwrap().entry(key).or_insert(0) += 1;
            let published = succeed.load(Ordering::SeqCst);
            Box::pin(async move { published })
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

/// Counts what a parked walk does: started, dropped (aborted or finished), and what it
/// would read after the park.
#[derive(Default)]
struct Parked {
    started: std::sync::atomic::AtomicUsize,
    dropped: std::sync::atomic::AtomicUsize,
    after: std::sync::atomic::AtomicUsize,
}

struct OnDrop(Arc<Parked>);

impl Drop for OnDrop {
    fn drop(&mut self) {
        self.0.dropped.fetch_add(1, Ordering::SeqCst);
    }
}

/// A stand-in whose walk parks for ever under `parked_keys` and publishes for the rest.
fn parking(
    app: &App,
    parked_keys: Vec<String>,
) -> (Arc<Parked>, Arc<Mutex<HashMap<String, usize>>>) {
    let parked = Arc::new(Parked::default());
    let counts = Arc::new(Mutex::new(HashMap::new()));
    let (sink, park) = (Arc::clone(&counts), Arc::clone(&parked));
    *app.state::<LinkIndexState>().fake_rebuild.lock().unwrap() =
        Some(Arc::new(move |key: String| {
            *sink.lock().unwrap().entry(key.clone()).or_insert(0) += 1;
            let parks = parked_keys.contains(&key);
            let park = Arc::clone(&park);
            Box::pin(async move {
                if !parks {
                    return true;
                }
                park.started.fetch_add(1, Ordering::SeqCst);
                let _guard = OnDrop(Arc::clone(&park));
                std::future::pending::<()>().await;
                park.after.fetch_add(1, Ordering::SeqCst);
                true
            })
        }));
    (parked, counts)
}

#[tokio::test(start_paused = true)]
async fn a_parked_walk_holds_up_no_unrelated_recovery_and_ends_when_its_vault_goes() {
    // One vault's walk never returns (a stalled volume); another vault's rebuild still
    // publishes. Removing the stalled vault aborts its walk: no publication, nothing
    // read after the park, the walk's future dropped.
    // 이것을 실패시키는 것: `MAX_RUNNING` 을 1 로 — 멈춘 walk 뒤에서 다른 vault 가 기다린다 — 또는
    // `cancel_rebuilds` 가 돌고 있는 시도를 abort 하지 않는다.
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (stuck, stuck_at, stuck_root) = registered(&app, "s", &dir.path().join("s")).await;
    let (fine, fine_at, fine_root) = registered(&app, "f", &dir.path().join("f")).await;
    let (parked, counts) = parking(&app, vec![stuck.clone()]);
    let seen = announced(&app);
    let state = app.state::<LinkIndexState>();
    state.request_rebuild(&stuck, stuck_at, &stuck_root);
    ensure_started(app.handle());
    tokio::time::sleep(Duration::from_millis(100)).await;
    state.request_rebuild(&fine, fine_at, &fine_root);
    tokio::time::sleep(Duration::from_secs(5)).await;
    assert_eq!(parked.started.load(Ordering::SeqCst), 1);
    assert_eq!(count(&counts, &fine), 1);
    assert_eq!(*seen.lock().unwrap(), 1);
    state.forget(&stuck, stuck_at).await;
    tokio::time::sleep(Duration::from_secs(900)).await;
    assert_eq!(parked.dropped.load(Ordering::SeqCst), 1);
    assert_eq!(parked.after.load(Ordering::SeqCst), 0);
    assert_eq!(count(&counts, &stuck), 1);
    assert_eq!(*seen.lock().unwrap(), 1);
    assert_eq!(state.rebuild_jobs_len(), 0);
}

#[tokio::test(start_paused = true)]
async fn an_intersecting_job_waits_for_a_running_walk_of_its_family() {
    // 이것을 실패시키는 것: `next` 가 돌고 있는 시도와 root 가 겹치는 job 도 시작한다.
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (outer, outer_at, outer_root) = registered(&app, "o", &dir.path().join("v")).await;
    let (inner, inner_at, inner_root) = registered(&app, "i", &dir.path().join("v/sub")).await;
    let (parked, counts) = parking(&app, vec![outer.clone()]);
    let state = app.state::<LinkIndexState>();
    state.request_rebuild(&outer, outer_at, &outer_root);
    ensure_started(app.handle());
    tokio::time::sleep(Duration::from_millis(100)).await;
    state.request_rebuild(&inner, inner_at, &inner_root);
    tokio::time::sleep(Duration::from_secs(60)).await;
    assert_eq!(parked.started.load(Ordering::SeqCst), 1);
    assert_eq!(count(&counts, &inner), 0);
    // Not vacuous: once the outer vault goes, the inner one runs.
    state.forget(&outer, outer_at).await;
    tokio::time::sleep(Duration::from_secs(5)).await;
    assert_eq!(count(&counts, &inner), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn removing_a_vault_mid_rebuild_frees_its_build_and_publishes_nothing() {
    // A real rebuild has walked and holds the build lock and lease, about to publish;
    // the vault is removed. The attempt is aborted: the lock is free, nothing published,
    // and the same folder registered again builds at once.
    // 이것을 실패시키는 것: `cancel_rebuilds` 가 돌고 있는 시도를 abort 하지 않는다 — build lock 이 잡힌 채 남는다.
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let v = dir.path().join("v");
    std::fs::create_dir(&v).unwrap();
    std::fs::write(v.join("a.md"), "see [[b]]").unwrap();
    let (key, at, root) = registered(&app, "v", &v).await;
    let state = app.state::<LinkIndexState>();
    let reached = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    *state.pause_before_publish.lock().unwrap() =
        Some(crate::index::service::state::PauseAfterRead {
            path: key.clone().into(),
            reached: Arc::clone(&reached),
            release: Arc::clone(&release),
        });
    let published = state.published.load(std::sync::atomic::Ordering::SeqCst);
    let seen = announced(&app);
    state.request_rebuild(&key, at, &root);
    ensure_started(app.handle());
    tokio::time::timeout(Duration::from_secs(10), reached.notified())
        .await
        .unwrap();
    let ctx = app.state::<ContextManager>();
    ctx.remove("v").await.unwrap();
    state.forget(&key, at).await;
    let lock = state.build_lock(&key).await;
    let mut free = false;
    for _ in 0..200 {
        if lock.try_lock().is_ok() {
            free = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(free, "the aborted attempt still holds the build lock");
    assert_eq!(
        state.published.load(std::sync::atomic::Ordering::SeqCst),
        published
    );
    assert_eq!(*seen.lock().unwrap(), 0);
    let (_, _, _) = registered(&app, "v2", &v).await;
    crate::index::service::refresh_index_inner(&state, &ctx, &key)
        .await
        .unwrap();
}

#[tokio::test(start_paused = true)]
async fn attempts_start_a_gap_apart_however_many_are_due() {
    // Three unrelated failing vaults, all due at once: one start, then one per second.
    // 이것을 실패시키는 것: 시작 사이의 `GLOBAL_GAP` 을 걷는다 — 둘이 함께 시작한다(`MAX_RUNNING`).
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let mut keys = Vec::new();
    for name in ["a", "b", "c"] {
        keys.push(registered(&app, name, &dir.path().join(name)).await);
    }
    let counts = stand_in(&app, Arc::new(AtomicBool::new(false)));
    let state = app.state::<LinkIndexState>();
    for (key, at, root) in &keys {
        state.request_rebuild(key, *at, root);
    }
    ensure_started(app.handle());
    let total = |counts: &Arc<Mutex<HashMap<String, usize>>>| {
        counts.lock().unwrap().values().sum::<usize>()
    };
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(total(&counts), 1);
    tokio::time::sleep(Duration::from_millis(2_000)).await;
    assert_eq!(total(&counts), 3);
}

#[tokio::test]
async fn a_refresh_of_a_published_index_still_rebuilds_and_a_failed_one_drops_it() {
    // The index is published (never dropped): a refresh job must walk, not take the
    // published index for its own result. When the walk fails, the index is dropped —
    // it no longer matches the disk.
    // 이것을 실패시키는 것: attempt 가 "index 가 있다" 를 끝난 것으로 본다 — 또는 실패한 refresh 뒤에 index 를
    // 내리지 않는다.
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (key, at, root) = registered(&app, "v", &dir.path().join("v")).await;
    let state = app.state::<LinkIndexState>();
    crate::index::service::refresh_index_inner(&state, &app.state::<ContextManager>(), &key)
        .await
        .unwrap();
    let counts = stand_in(&app, Arc::new(AtomicBool::new(false)));
    state.request_rebuild(&key, at, &root);
    ensure_started(app.handle());
    for _ in 0..200 {
        if count(&counts, &key) == 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(count(&counts, &key), 1);
    for _ in 0..200 {
        if !state.with_index_for(&key, at, |i| i.is_some()).await {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(!state.with_index_for(&key, at, |i| i.is_some()).await);
}

#[tokio::test(start_paused = true)]
async fn an_attempt_that_panics_does_not_block_its_job() {
    // 이것을 실패시키는 것: 시도가 끝났다는 표시를 정상 반환 뒤에만 남긴다(drop guard 없이) — panic 한 시도의
    // `running` 이 남아 job 이 다시 돌지 않는다.
    let app = app();
    let dir = tempfile::tempdir().unwrap();
    let (key, at, root) = registered(&app, "v", &dir.path().join("v")).await;
    let counts = stand_in(&app, Arc::new(AtomicBool::new(true)));
    let seen = announced(&app);
    let state = app.state::<LinkIndexState>();
    state
        .panic_attempt
        .store(true, std::sync::atomic::Ordering::SeqCst);
    state.request_rebuild(&key, at, &root);
    ensure_started(app.handle());
    tokio::time::sleep(Duration::from_secs(5)).await;
    assert_eq!(count(&counts, &key), 1);
    assert_eq!(*seen.lock().unwrap(), 1);
    assert_eq!(state.rebuild_jobs_len(), 0);
}
