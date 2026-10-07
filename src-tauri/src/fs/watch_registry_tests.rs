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

#[derive(Default)]
struct Spawner {
    log: Rc<RefCell<Vec<String>>>,
    specs: RefCell<Vec<(String, bool)>>,
}

impl Spawner {
    fn spawn(&self, spec: &WatchSpec) -> Result<Fake, FsError> {
        let id = self.specs.borrow().len();
        self.specs
            .borrow_mut()
            .push((spec.root.clone(), spec.recursive));
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
        let a = r.acquire("main", &vault, true, None, &spawn).unwrap();
        let b = r
            .acquire("main", &outside, false, Some("/x/n.md"), &spawn)
            .unwrap();
        let c = r
            .acquire("file-1", &outside, false, Some("/x/m.md"), &spawn)
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
        .acquire("main", &dir, false, Some("/d/a.md"), &spawn)
        .unwrap();
    let _b = r
        .acquire("file-1", &dir, false, Some("/d/b.md"), &spawn)
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
    r.acquire("main", &dir, false, Some("/d/a.md"), &spawn)
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
            r.acquire("main", &dir, recursive, focus, &spawn).unwrap();
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
        .acquire("main", &dir, false, Some("/d/a.md"), &spawn)
        .unwrap();
    let wide = r.acquire("main", &dir, true, None, &spawn).unwrap();
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
    let id = r.acquire("main", &dir, true, None, &spawn).unwrap();
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
        r.acquire("main", &dir, true, None, &spawn).unwrap();
    }
    assert!(r.acquire("main", &dir, true, None, &spawn).is_err());
    // Another window is not held back by this one's cap.
    assert!(r.acquire("file-1", &dir, true, None, &spawn).is_ok());
}

#[test]
fn a_destroyed_window_gives_back_its_leases_only() {
    // 이것을 실패시키는 것: `release_window` 가 창 label 과 상관없이 모두 내린다 — 또는 아무것도 내리지 않는다.
    let (_d, vault) = tmp();
    let (_e, other) = tmp();
    let s = Spawner::default();
    let spawn = |spec: &WatchSpec| s.spawn(spec);
    let mut r: WatchRegistry<Fake> = WatchRegistry::default();
    r.acquire("main", &vault, true, None, &spawn).unwrap();
    r.acquire("file-1", &other, false, Some("/o/x.md"), &spawn)
        .unwrap();
    r.acquire("file-1", &vault, false, Some("/v/y.md"), &spawn)
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
    r.acquire("main", &alias, true, None, &spawn).unwrap();
    r.acquire("main", &real, true, None, &spawn).unwrap();
    assert_eq!(r.live_watches(), 1);
    // The vault root as registered is what the watch judges paths against.
    assert_eq!(s.specs.borrow().clone(), vec![(alias, true)]);
}
