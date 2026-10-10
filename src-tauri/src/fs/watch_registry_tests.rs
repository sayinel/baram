use super::*;
use std::cell::RefCell;
use std::rc::Rc;

/// A stand-in watcher: records its start and its drop in a shared log.
struct Fake {
    id: usize,
    log: Rc<RefCell<Vec<String>>>,
}

impl Drop for Fake {
    fn drop(&mut self) {
        self.log.borrow_mut().push(format!("drop {}", self.id));
    }
}

/// A watcher's focus files and (canonical folder, spelled folder) pairs.
type Sets = (HashSet<PathBuf>, Vec<(PathBuf, PathBuf)>);

#[derive(Default)]
struct Spawner {
    log: Rc<RefCell<Vec<String>>>,
    specs: RefCell<Vec<(String, bool)>>,
    /// The focus files and spellings each watcher had when it started.
    sets: RefCell<Vec<Sets>>,
    fail: std::cell::Cell<bool>,
}

impl Spawner {
    fn spawn(&self, spec: &WatchSpec) -> Result<Fake, FsError> {
        if self.fail.get() {
            return Err(FsError::WatchError("refused".into()));
        }
        let id = self.specs.borrow().len();
        self.specs
            .borrow_mut()
            .push((spec.root.clone(), spec.recursive));
        self.sets.borrow_mut().push((
            spec.focus.read().unwrap().clone(),
            spec.spellings.read().unwrap().clone(),
        ));
        self.log.borrow_mut().push(format!("start {id}"));
        Ok(Fake {
            id,
            log: Rc::clone(&self.log),
        })
    }
    fn log(&self) -> Vec<String> {
        self.log.borrow().clone()
    }
}

/// A request from a window that has not begun a page, authorized by its own path.
fn req<'a>(
    window: &'a str,
    path: &'a str,
    recursive: bool,
    focus: Option<&'a str>,
) -> LeaseRequest<'a> {
    LeaseRequest {
        window,
        path,
        recursive,
        focus,
        authority: PathBuf::from(path),
        page: 0,
    }
}

fn starts(s: &Spawner) -> usize {
    s.log().iter().filter(|l| l.starts_with("start")).count()
}

fn tmp() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_string_lossy().into_owned();
    (dir, path)
}

#[test]
fn a_hundred_open_close_cycles_leave_no_watch_behind() {
    // Issue 797: a watch used to live until the app quit.
    // 이것을 실패시키는 것: `settle` 이 마지막 lease 가 떠나도 watcher 를 지우지 않는다.
    let (_d, vault) = tmp();
    let (_e, outside) = tmp();
    let s = Spawner::default();
    let spawn = |spec: &WatchSpec| s.spawn(spec);
    let mut r: WatchRegistry<Fake> = WatchRegistry::default();
    for _ in 0..100 {
        let a = r.acquire(req("main", &vault, true, None), &spawn).unwrap();
        let b = r
            .acquire(req("main", &outside, false, Some("/x/n.md")), &spawn)
            .unwrap();
        let c = r
            .acquire(req("file-1", &outside, false, Some("/x/m.md")), &spawn)
            .unwrap();
        r.release("main", a, &spawn).unwrap();
        r.release("main", b, &spawn).unwrap();
        r.release("file-1", c, &spawn).unwrap();
    }
    assert_eq!(r.live_watches(), 0);
    assert_eq!(r.leases(), 0);
    let starts = s.log().iter().filter(|l| l.starts_with("start")).count();
    let drops = s.log().iter().filter(|l| l.starts_with("drop")).count();
    assert_eq!(starts, drops);
}

#[test]
fn closing_one_of_two_owners_keeps_the_others_watch() {
    // 이것을 실패시키는 것: `release` 가 남은 lease 를 보지 않고 watcher 를 지운다.
    let (_d, dir) = tmp();
    let s = Spawner::default();
    let spawn = |spec: &WatchSpec| s.spawn(spec);
    let mut r: WatchRegistry<Fake> = WatchRegistry::default();
    let a = r
        .acquire(req("main", &dir, false, Some("/d/a.md")), &spawn)
        .unwrap();
    let _b = r
        .acquire(req("file-1", &dir, false, Some("/d/b.md")), &spawn)
        .unwrap();
    r.release("main", a, &spawn).unwrap();
    assert_eq!(r.live_watches(), 1);
    assert_eq!(s.log(), vec!["start 0"]);
    // The remaining owner's focus file is still treated as open; the other's is not.
    let focus = r
        .watches
        .values()
        .next()
        .unwrap()
        .focus
        .read()
        .unwrap()
        .clone();
    assert!(focus.contains(&PathBuf::from("/d/b.md")));
    assert!(!focus.contains(&PathBuf::from("/d/a.md")));
}

#[test]
fn a_folder_watched_for_one_file_is_watched_non_recursively() {
    // 이것을 실패시키는 것: `acquire` 가 lease 의 범위를 무시하고 언제나 재귀로 건다.
    let (_d, dir) = tmp();
    let s = Spawner::default();
    let spawn = |spec: &WatchSpec| s.spawn(spec);
    let mut r: WatchRegistry<Fake> = WatchRegistry::default();
    r.acquire(req("main", &dir, false, Some("/d/a.md")), &spawn)
        .unwrap();
    assert_eq!(s.specs.borrow().clone(), vec![(dir.clone(), false)]);
}

#[test]
fn recursive_survives_either_arrival_order_with_one_watcher() {
    // 이것을 실패시키는 것: 범위를 마지막 요청의 것으로 정한다(나중에 온 비재귀 요청이 재귀 watcher 를
    // 비재귀로 바꾼다).
    let (_d, dir) = tmp();
    for recursive_first in [true, false] {
        let s = Spawner::default();
        let spawn = |spec: &WatchSpec| s.spawn(spec);
        let mut r: WatchRegistry<Fake> = WatchRegistry::default();
        let order = if recursive_first {
            [true, false]
        } else {
            [false, true]
        };
        for recursive in order {
            let focus = (!recursive).then_some("/d/a.md");
            r.acquire(req("main", &dir, recursive, focus), &spawn)
                .unwrap();
        }
        assert_eq!(r.live_watches(), 1);
        assert!(r.watches.values().next().unwrap().recursive, "{order:?}");
        assert!(s.specs.borrow().last().unwrap().1, "{order:?}");
    }
}

#[test]
fn a_scope_change_starts_the_new_watcher_before_dropping_the_old() {
    // 이것을 실패시키는 것: 새 watcher 를 만들기 전에 옛 것을 내린다(`watches.remove` 후 spawn).
    let (_d, dir) = tmp();
    let s = Spawner::default();
    let spawn = |spec: &WatchSpec| s.spawn(spec);
    let mut r: WatchRegistry<Fake> = WatchRegistry::default();
    let narrow = r
        .acquire(req("main", &dir, false, Some("/d/a.md")), &spawn)
        .unwrap();
    let wide = r.acquire(req("main", &dir, true, None), &spawn).unwrap();
    assert_eq!(s.log(), vec!["start 0", "start 1", "drop 0"]);
    // Releasing the recursive lease narrows again, also start-before-drop.
    r.release("main", wide, &spawn).unwrap();
    assert_eq!(s.log()[3..], ["start 2".to_string(), "drop 1".to_string()]);
    assert!(!r.watches.values().next().unwrap().recursive);
    r.release("main", narrow, &spawn).unwrap();
    assert_eq!(r.live_watches(), 0);
}

#[test]
fn a_lease_is_given_back_only_by_its_window() {
    // 이것을 실패시키는 것: `release` 가 lease 의 window 를 확인하지 않는다.
    let (_d, dir) = tmp();
    let s = Spawner::default();
    let spawn = |spec: &WatchSpec| s.spawn(spec);
    let mut r: WatchRegistry<Fake> = WatchRegistry::default();
    let id = r.acquire(req("main", &dir, true, None), &spawn).unwrap();
    assert!(r.release("file-1", id, &spawn).is_err());
    assert_eq!(r.leases(), 1);
    assert!(r.release("main", 9_999, &spawn).is_err());
    assert!(r.release("main", id, &spawn).is_ok());
}

#[test]
fn a_window_may_hold_at_most_its_cap() {
    // 이것을 실패시키는 것: `acquire` 의 창별 상한 검사를 지운다.
    let (_d, dir) = tmp();
    let s = Spawner::default();
    let spawn = |spec: &WatchSpec| s.spawn(spec);
    let mut r: WatchRegistry<Fake> = WatchRegistry::default();
    for _ in 0..MAX_LEASES_PER_WINDOW {
        r.acquire(req("main", &dir, true, None), &spawn).unwrap();
    }
    assert!(r.acquire(req("main", &dir, true, None), &spawn).is_err());
    // Another window is not held back by this one's cap.
    assert!(r.acquire(req("file-1", &dir, true, None), &spawn).is_ok());
}

#[test]
fn a_destroyed_window_gives_back_its_leases_only() {
    // 이것을 실패시키는 것: `release_window` 가 창 label 과 상관없이 모두 내린다 — 또는 아무것도 내리지 않는다.
    let (_d, vault) = tmp();
    let (_e, other) = tmp();
    let s = Spawner::default();
    let spawn = |spec: &WatchSpec| s.spawn(spec);
    let mut r: WatchRegistry<Fake> = WatchRegistry::default();
    r.acquire(req("main", &vault, true, None), &spawn).unwrap();
    r.acquire(req("file-1", &other, false, Some("/o/x.md")), &spawn)
        .unwrap();
    r.acquire(req("file-1", &vault, false, Some("/v/y.md")), &spawn)
        .unwrap();
    r.release_window("file-1", &spawn);
    assert_eq!(r.leases(), 1);
    assert_eq!(r.live_watches(), 1);
    assert!(r.watches.values().next().unwrap().recursive);
}

#[cfg(unix)]
#[test]
fn two_spellings_of_one_folder_share_a_watcher_started_with_the_first_spelling() {
    // 이것을 실패시키는 것: registry 의 key 를 canonical 이 아니라 적힌 경로로 둔다.
    let (d, real) = tmp();
    let alias_dir = tempfile::tempdir().unwrap();
    let alias = alias_dir.path().join("alias");
    std::os::unix::fs::symlink(d.path(), &alias).unwrap();
    let alias = alias.to_string_lossy().into_owned();
    let s = Spawner::default();
    let spawn = |spec: &WatchSpec| s.spawn(spec);
    let mut r: WatchRegistry<Fake> = WatchRegistry::default();
    r.acquire(req("main", &alias, true, None), &spawn).unwrap();
    r.acquire(req("main", &real, true, None), &spawn).unwrap();
    assert_eq!(r.live_watches(), 1);
    // The vault root as registered is what the watch judges paths against.
    assert_eq!(s.specs.borrow().clone(), vec![(alias, true)]);
}

#[test]
fn a_new_watcher_starts_with_its_focus_file_and_spelling_already_in_place() {
    // An event can arrive the moment the watcher starts; with an empty focus set an
    // atomic replace of the file it watches for would route as a creation only.
    // 이것을 실패시키는 것: `install` 이 spawn 뒤에 `refresh_sets` 를 부른다.
    let (_d, dir) = tmp();
    let s = Spawner::default();
    let spawn = |spec: &WatchSpec| s.spawn(spec);
    let mut r: WatchRegistry<Fake> = WatchRegistry::default();
    r.acquire(req("main", &dir, false, Some("/d/a.md")), &spawn)
        .unwrap();
    let (focus, spellings) = s.sets.borrow()[0].clone();
    assert!(focus.contains(&PathBuf::from("/d/a.md")));
    assert_eq!(spellings, vec![(canonical(&dir), PathBuf::from(&dir))]);
}

#[test]
fn a_watcher_that_fails_to_start_leaves_nothing_behind() {
    // 이것을 실패시키는 것: spawn 이 실패해도 lease 나 빈 항목을 남긴다.
    let (_d, dir) = tmp();
    let s = Spawner::default();
    let spawn = |spec: &WatchSpec| s.spawn(spec);
    let mut r: WatchRegistry<Fake> = WatchRegistry::default();
    s.fail.set(true);
    assert!(r
        .acquire(req("main", &dir, false, Some("/d/a.md")), &spawn)
        .is_err());
    assert_eq!(r.leases(), 0);
    assert!(r.watches.is_empty());
    // A failed widening keeps the narrow watcher and its own lease only.
    s.fail.set(false);
    r.acquire(req("main", &dir, false, Some("/d/a.md")), &spawn)
        .unwrap();
    s.fail.set(true);
    assert!(r.acquire(req("main", &dir, true, None), &spawn).is_err());
    assert_eq!(r.leases(), 1);
    assert!(!r.watches.values().next().unwrap().recursive);
    assert_eq!(
        r.watches
            .values()
            .next()
            .unwrap()
            .spellings
            .read()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn the_app_watches_at_most_its_cap_of_folders() {
    // 이것을 실패시키는 것: `acquire` 의 전체 폴더 상한 검사를 지운다.
    let s = Spawner::default();
    let spawn = |spec: &WatchSpec| s.spawn(spec);
    let mut r: WatchRegistry<Fake> = WatchRegistry::default();
    let dirs: Vec<tempfile::TempDir> = (0..=MAX_WATCHED_FOLDERS)
        .map(|_| tempfile::tempdir().unwrap())
        .collect();
    for (i, d) in dirs.iter().take(MAX_WATCHED_FOLDERS).enumerate() {
        let window = if i % 2 == 0 { "main" } else { "file-1" };
        r.acquire(req(window, &d.path().to_string_lossy(), true, None), &spawn)
            .unwrap();
    }
    let extra = dirs[MAX_WATCHED_FOLDERS]
        .path()
        .to_string_lossy()
        .into_owned();
    assert!(r
        .acquire(req("file-2", &extra, true, None), &spawn)
        .is_err());
    // A folder already watched takes another lease.
    let first = dirs[0].path().to_string_lossy().into_owned();
    assert!(r.acquire(req("file-2", &first, true, None), &spawn).is_ok());
}

#[test]
fn a_folder_inside_a_recursively_watched_one_takes_no_watcher_of_its_own() {
    // Issue 797: a file window's folder inside the open vault used to get a watcher of
    // its own — and counted against the cap.
    // 이것을 실패시키는 것: `host_of` 가 비재귀 lease 에도 언제나 자기 폴더를 낸다.
    let (d, vault) = tmp();
    std::fs::create_dir_all(d.path().join("sub/deeper")).unwrap();
    let sub = d.path().join("sub").to_string_lossy().into_owned();
    let deeper = d.path().join("sub/deeper").to_string_lossy().into_owned();
    let focus = format!("{sub}/a.md");
    let inner_focus = format!("{deeper}/b.md");
    let s = Spawner::default();
    let spawn = |spec: &WatchSpec| s.spawn(spec);
    let mut r: WatchRegistry<Fake> = WatchRegistry::default();
    let root = r.acquire(req("main", &vault, true, None), &spawn).unwrap();
    r.acquire(req("file-1", &sub, false, Some(&focus)), &spawn)
        .unwrap();
    assert_eq!(r.live_watches(), 1);
    // The vault's watcher serves the file window: its focus file is open there, and its
    // folder is a spelling events are reported in.
    let watch = &r.watches[&canonical(&vault)];
    assert!(watch.focus.read().unwrap().contains(&PathBuf::from(&focus)));
    assert!(watch
        .spellings
        .read()
        .unwrap()
        .contains(&(canonical(&sub), PathBuf::from(&sub))));

    // A vault nested in it keeps its own watcher — the outer `.baramignore` may exclude
    // it — and serves a file window inside it as the innermost vault.
    // 이것을 실패시키는 것: 재귀 lease 도 바깥 재귀 lease 에 묶는다 — 또는 비재귀 lease 를 가장 바깥 vault 에 묶는다.
    r.acquire(req("main", &deeper, true, None), &spawn).unwrap();
    r.acquire(req("file-2", &deeper, false, Some(&inner_focus)), &spawn)
        .unwrap();
    assert_eq!(r.live_watches(), 2);
    let inner = &r.watches[&canonical(&deeper)];
    assert!(inner
        .focus
        .read()
        .unwrap()
        .contains(&PathBuf::from(&inner_focus)));

    // The vault goes: the file window's folder takes a watcher of its own, started
    // before the vault's watcher drops.
    // 이것을 실패시키는 것: 남은 lease 의 새 host 를 시작하기 전에 옛 host 를 내린다(`drop_unneeded` 를 `start` 앞에).
    r.release("main", root, &spawn).unwrap();
    assert_eq!(r.live_watches(), 2);
    assert_eq!(s.log(), vec!["start 0", "start 1", "start 2", "drop 0"]);
    assert_eq!(s.specs.borrow()[2], (sub.clone(), false));
}

#[test]
fn at_the_cap_a_folder_with_a_host_is_still_served_and_a_release_makes_room() {
    // 이것을 실패시키는 것: 상한을 host 가 아니라 lease 마다 센다 — 또는 watcher 가 내려가도 `freed` 를 세우지 않는다.
    let s = Spawner::default();
    let spawn = |spec: &WatchSpec| s.spawn(spec);
    let mut r: WatchRegistry<Fake> = WatchRegistry::default();
    let dirs: Vec<tempfile::TempDir> = (0..=MAX_WATCHED_FOLDERS)
        .map(|_| tempfile::tempdir().unwrap())
        .collect();
    let mut first = 0;
    for (i, d) in dirs.iter().take(MAX_WATCHED_FOLDERS).enumerate() {
        let id = r
            .acquire(req("main", &d.path().to_string_lossy(), true, None), &spawn)
            .unwrap();
        if i == 0 {
            first = id;
        }
    }
    let extra = dirs[MAX_WATCHED_FOLDERS]
        .path()
        .to_string_lossy()
        .into_owned();
    let refused = r
        .acquire(req("main", &extra, true, None), &spawn)
        .unwrap_err();
    assert!(refused.starts_with(CAPACITY), "{refused}");
    let _ = r.take_news();
    // A folder inside a watched one needs no new host.
    std::fs::create_dir(dirs[1].path().join("in")).unwrap();
    let inside = dirs[1].path().join("in").to_string_lossy().into_owned();
    let file = format!("{inside}/n.md");
    assert!(r
        .acquire(req("file-1", &inside, false, Some(&file)), &spawn)
        .is_ok());
    assert_eq!(r.take_news(), (vec![], false));
    // A release that stops a watcher is news: the refused watch fits now.
    r.release("main", first, &spawn).unwrap();
    assert_eq!(r.take_news(), (vec![], true));
    assert!(r.acquire(req("main", &extra, true, None), &spawn).is_ok());
}

#[test]
fn a_late_end_of_a_replaced_watcher_leaves_its_successor_alone() {
    // The scope change starts the new watcher before dropping the old; the old one's
    // last error can arrive after.
    // 이것을 실패시키는 것: `watch_ended` 가 generation 을 보지 않고 key 만으로 끝낸다.
    let (_d, dir) = tmp();
    let s = Spawner::default();
    let spawn = |spec: &WatchSpec| s.spawn(spec);
    let mut r: WatchRegistry<Fake> = WatchRegistry::default();
    let narrow = r
        .acquire(req("main", &dir, false, Some("/d/a.md")), &spawn)
        .unwrap();
    let old = r.watches.values().next().unwrap().generation;
    let wide = r.acquire(req("file-1", &dir, true, None), &spawn).unwrap();
    let key = canonical(&dir);
    r.watch_ended(&key, old, &spawn);
    assert_eq!(r.live_watches(), 1);
    assert_eq!(r.leases(), 2);
    assert_eq!(r.take_news(), (vec![], false));

    // The current watcher's end ends every lease it served, each reported to its window.
    let current = r.watches.values().next().unwrap().generation;
    r.watch_ended(&key, current, &spawn);
    assert_eq!(r.live_watches(), 0);
    assert_eq!(r.leases(), 0);
    let (mut ended, freed) = r.take_news();
    ended.sort_by_key(|e| e.lease);
    assert_eq!(
        ended,
        vec![
            Ended {
                window: "main".into(),
                lease: narrow
            },
            Ended {
                window: "file-1".into(),
                lease: wide
            },
        ]
    );
    assert!(freed);
}

#[cfg(unix)]
#[test]
fn a_folder_swapped_for_a_link_is_not_watched_through_the_old_leases() {
    // `/approved/vault` removed and recreated as a link to a folder never approved: a
    // lease taken through it must not start a watcher there.
    // 이것을 실패시키는 것: `start` 가 spelling 이 아직 host 로 resolve 되는지 보지 않는다.
    let real = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let links = tempfile::tempdir().unwrap();
    let alias = links.path().join("vault");
    std::os::unix::fs::symlink(real.path(), &alias).unwrap();
    let alias = alias.to_string_lossy().into_owned();
    let focus = format!("{alias}/a.md");
    let s = Spawner::default();
    let spawn = |spec: &WatchSpec| s.spawn(spec);
    let mut r: WatchRegistry<Fake> = WatchRegistry::default();
    let held = r
        .acquire(req("main", &alias, false, Some(&focus)), &spawn)
        .unwrap();
    std::fs::remove_file(&alias).unwrap();
    std::os::unix::fs::symlink(elsewhere.path(), &alias).unwrap();
    // A widening restarts the host: from the spelling that still resolves to it.
    let real_path = real.path().to_string_lossy().into_owned();
    r.acquire(req("file-1", &real_path, true, None), &spawn)
        .unwrap();
    assert_eq!(s.specs.borrow().last().unwrap().0, real_path);
    // With no spelling resolving to the host, it cannot start: its leases end.
    let _ = r.take_news();
    let mut lone: WatchRegistry<Fake> = WatchRegistry::default();
    std::fs::remove_file(&alias).unwrap();
    std::os::unix::fs::symlink(real.path(), &alias).unwrap();
    let narrow = lone
        .acquire(req("main", &alias, false, Some(&focus)), &spawn)
        .unwrap();
    std::fs::remove_file(&alias).unwrap();
    std::os::unix::fs::symlink(elsewhere.path(), &alias).unwrap();
    let before = starts(&s);
    let key = canonical(&real_path);
    let generation = lone.watches[&key].generation;
    // Its watcher ended (the folder went): nothing restarts it; the lease ends.
    lone.watch_ended(&key, generation, &spawn);
    assert_eq!(starts(&s), before);
    assert_eq!(
        lone.take_news().0,
        vec![Ended {
            window: "main".into(),
            lease: narrow
        }]
    );
    let _ = held;
}

#[test]
fn a_new_page_refuses_what_its_predecessor_still_had_in_flight() {
    // 이것을 실패시키는 것: `acquire` 가 page 를 확인하지 않는다 — 또는 `begin_page` 가 창의 lease 를 돌려주지 않는다.
    let (_d, dir) = tmp();
    let s = Spawner::default();
    let spawn = |spec: &WatchSpec| s.spawn(spec);
    let mut r: WatchRegistry<Fake> = WatchRegistry::default();
    let first = r.begin_page("main", &spawn);
    let mut old = req("main", &dir, true, None);
    old.page = first;
    r.acquire(old, &spawn).unwrap();
    let second = r.begin_page("main", &spawn);
    assert_eq!(r.leases(), 0);
    let mut late = req("main", &dir, true, None);
    late.page = first;
    let refused = r.acquire(late, &spawn).unwrap_err();
    assert!(refused.starts_with(STALE_PAGE), "{refused}");
    let mut current = req("main", &dir, true, None);
    current.page = second;
    assert!(r.acquire(current, &spawn).is_ok());
    // Another window's pages are its own.
    assert!(r.acquire(req("file-1", &dir, true, None), &spawn).is_ok());
}

#[test]
fn ended_leases_are_reported_and_their_folders_released() {
    // 이것을 실패시키는 것: `end_leases` 가 lease 를 지우고 `ended` 에 넣지 않는다.
    let (_d, a) = tmp();
    let (_e, b) = tmp();
    let s = Spawner::default();
    let spawn = |spec: &WatchSpec| s.spawn(spec);
    let mut r: WatchRegistry<Fake> = WatchRegistry::default();
    let x = r.acquire(req("main", &a, true, None), &spawn).unwrap();
    let y = r.acquire(req("file-1", &b, true, None), &spawn).unwrap();
    let picked = r.leases_where(|l| l.authority.as_path() == Path::new(&a));
    assert_eq!(picked.iter().map(|l| l.id).collect::<Vec<_>>(), vec![x]);
    r.end_leases(&[x], &spawn);
    assert_eq!(
        r.take_news(),
        (
            vec![Ended {
                window: "main".into(),
                lease: x
            }],
            true
        )
    );
    assert_eq!(r.live_watches(), 1);
    assert!(r.release("file-1", y, &spawn).is_ok());
}

#[test]
fn a_host_left_without_a_watcher_is_reported_stopped() {
    // §29 #824 Its last lease released, the host is stopped; a scope change in between
    // (a folder watched for one file, then the whole vault) is not a stop.
    // 이것을 실패시키는 것: `drop_unneeded` 가 지운 host 를 `stopped` 에 넣지 않는다.
    let (_d, dir) = tmp();
    let host = std::fs::canonicalize(&dir).unwrap();
    let s = Spawner::default();
    let spawn = |spec: &WatchSpec| s.spawn(spec);
    let mut r: WatchRegistry<Fake> = WatchRegistry::default();
    let file = r
        .acquire(req("file-1", &dir, false, Some("/d/a.md")), &spawn)
        .unwrap();
    let vault = r.acquire(req("main", &dir, true, None), &spawn).unwrap();
    // Not vacuous: the scope change did start a second watcher.
    assert_eq!(starts(&s), 2);
    assert!(r.take_stopped().is_empty());
    r.release("file-1", file, &spawn).unwrap();
    assert!(r.take_stopped().is_empty());
    r.release("main", vault, &spawn).unwrap();
    assert_eq!(r.take_stopped(), [host]);
}

#[test]
fn a_host_whose_start_fails_is_reported_stopped() {
    // 이것을 실패시키는 것: 시작하지 못한 host 를 `stopped` 에 넣지 않는다.
    let (_d, dir) = tmp();
    let host = std::fs::canonicalize(&dir).unwrap();
    let s = Spawner::default();
    s.fail.set(true);
    let spawn = |spec: &WatchSpec| s.spawn(spec);
    let mut r: WatchRegistry<Fake> = WatchRegistry::default();
    assert!(r.acquire(req("main", &dir, true, None), &spawn).is_err());
    assert!(r.take_stopped().contains(&host));
}
