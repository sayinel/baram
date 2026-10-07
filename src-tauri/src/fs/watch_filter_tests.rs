use super::*;
use notify::event::{CreateKind, DataChange, ModifyKind, RemoveKind, RenameMode};
use std::cell::Cell;

/// Counts every filesystem read routing asks for, and answers "a file".
#[derive(Default)]
struct CountingProbe {
    reads: Cell<usize>,
}

impl Probe for CountingProbe {
    fn is_dir(&self, _: &Path) -> bool {
        self.reads.set(self.reads.get() + 1);
        false
    }
    fn exists(&self, _: &Path) -> bool {
        self.reads.set(self.reads.get() + 1);
        true
    }
    fn mtime(&self, _: &Path) -> u64 {
        self.reads.set(self.reads.get() + 1);
        0
    }
}

/// What a build writing one file looks like: created, then its data written.
fn written(path: &Path) -> [Event; 2] {
    [
        Event::new(EventKind::Create(CreateKind::File)).add_path(path.to_path_buf()),
        Event::new(EventKind::Modify(ModifyKind::Data(DataChange::Content)))
            .add_path(path.to_path_buf()),
    ]
}

fn filter(root: &Path) -> WatchFilter {
    WatchFilter::with_open_files(root, OpenFiles::default())
}

fn route_all(filter: &mut WatchFilter, events: &[Event], probe: &CountingProbe) -> Vec<Emit> {
    events.iter().flat_map(|e| filter.route(e, probe)).collect()
}

#[test]
fn a_build_folders_events_reach_the_webview_zero_times_and_read_nothing() {
    // Issue 795: a cold build writes thousands of files below `target/` or `build/`.
    // 이것을 실패시키는 것: `drops` 가 `walk_skips(parent, true)` 를 묻지 않는다.
    let dir = tempfile::tempdir().unwrap();
    let mut f = filter(dir.path());
    let probe = CountingProbe::default();
    let mut events = Vec::new();
    for folder in ["build", "target", "node_modules", "build/deep/er"] {
        for i in 0..25 {
            events.extend(written(&dir.path().join(format!("{folder}/out-{i}.o"))));
        }
    }
    assert_eq!(events.len(), 200);
    assert!(route_all(&mut f, &events, &probe).is_empty());
    assert_eq!(probe.reads.get(), 0);

    // The same writes to notes reach it, two events each.
    let notes: Vec<Event> = (0..25)
        .flat_map(|i| written(&dir.path().join(format!("notes/n-{i}.md"))))
        .collect();
    assert_eq!(route_all(&mut f, &notes, &probe).len(), 50);
}

#[test]
fn a_vault_whose_root_is_named_build_keeps_its_events() {
    // The old filter matched absolute-path substrings; `/build/` there would have
    // dropped every event of this vault. Judged relative to the root, it does not.
    // 이것을 실패시키는 것: 상대 경로가 아니라 절대 경로의 구간으로 판정한다.
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("build");
    std::fs::create_dir(&root).unwrap();
    let mut f = filter(&root);
    let probe = CountingProbe::default();
    let emitted = route_all(&mut f, &written(&root.join("note.md")), &probe);
    assert_eq!(emitted.len(), 2);
    // …and a build folder below it is still dropped.
    assert!(route_all(&mut f, &written(&root.join("build/out.o")), &probe).is_empty());
}

#[test]
fn an_open_file_below_an_excluded_folder_keeps_every_event() {
    // The reload, the conflict modal and the auto-save guard read `file:changed`; an
    // atomic replace arrives as a rename.
    // 이것을 실패시키는 것: `drops` 가 열린 파일 집합을 보지 않는다.
    let dir = tempfile::tempdir().unwrap();
    let open = OpenFiles::default();
    let note = dir.path().join("build/README.md");
    replace_open_files(&open, &[note.to_string_lossy().into_owned()]);
    let mut f = WatchFilter::with_open_files(dir.path(), open);
    let probe = CountingProbe::default();
    let changed =
        Event::new(EventKind::Modify(ModifyKind::Data(DataChange::Content))).add_path(note.clone());
    let replaced =
        Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Any))).add_path(note.clone());
    let emitted = route_all(&mut f, &[changed, replaced], &probe);
    assert!(matches!(emitted[0], Emit::Changed { .. }), "{emitted:?}");
    assert!(matches!(emitted[1], Emit::Created { .. }), "{emitted:?}");
    // Its neighbour, not open, is still dropped.
    let other = dir.path().join("build/other.md");
    assert!(route_all(&mut f, &written(&other), &probe).is_empty());
}

#[test]
fn a_negation_in_baramignore_lets_a_build_folder_back_in_and_is_reread_when_it_changes() {
    // 이것을 실패시키는 것: `notice` 가 `.baramignore` 이벤트에 matcher 를 다시 읽지 않는다.
    let dir = tempfile::tempdir().unwrap();
    let mut f = filter(dir.path());
    let probe = CountingProbe::default();
    let out = dir.path().join("build/out.md");
    assert!(route_all(&mut f, &written(&out), &probe).is_empty());

    let ignore = dir.path().join(BARAMIGNORE);
    std::fs::write(&ignore, "!build/\n").unwrap();
    let edited = Event::new(EventKind::Modify(ModifyKind::Data(DataChange::Content)))
        .add_path(ignore.clone());
    // The edit itself still reaches the webview, as a root file's always did.
    assert_eq!(route_all(&mut f, &[edited], &probe).len(), 1);
    assert_eq!(route_all(&mut f, &written(&out), &probe).len(), 2);
}

#[test]
fn a_watcher_started_with_a_negation_lets_the_folder_through() {
    // 이것을 실패시키는 것: `WatchFilter::new` 가 `.baramignore` 없이 기본 목록만 읽는다.
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(BARAMIGNORE), "!build/\n").unwrap();
    let mut f = filter(dir.path());
    let probe = CountingProbe::default();
    let out = dir.path().join("build/out.md");
    assert_eq!(route_all(&mut f, &written(&out), &probe).len(), 2);
}

#[test]
fn an_unusable_baramignore_leaves_the_default_list_in_force() {
    // The walkers refuse such a vault; the watcher must keep the flood out anyway.
    // 이것을 실패시키는 것: `load_or_defaults` 가 실패에 `VaultExclusion::default()`(아무것도 빼지 않음)를 쓴다.
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(BARAMIGNORE), [0xff, 0xfe, 0xfd]).unwrap();
    let mut f = filter(dir.path());
    let probe = CountingProbe::default();
    assert!(route_all(&mut f, &written(&dir.path().join("target/x")), &probe).is_empty());
}

#[test]
fn hidden_folders_are_dropped_and_hidden_files_are_not() {
    // The frontend keeps hidden files (`.notes.md`) and nothing else consumed the
    // old filter's `.git/` / `.baram/` events.
    // 이것을 실패시키는 것: 마지막 구간도 `walk_skips` 로 판정한다(숨은 파일의 이벤트가 사라진다).
    let dir = tempfile::tempdir().unwrap();
    let mut f = filter(dir.path());
    let probe = CountingProbe::default();
    for hidden in [".git/index", ".baram/state.json", "notes/.cache/x"] {
        assert!(
            route_all(&mut f, &written(&dir.path().join(hidden)), &probe).is_empty(),
            "{hidden}"
        );
    }
    assert_eq!(
        route_all(&mut f, &written(&dir.path().join(".notes.md")), &probe).len(),
        2
    );
}

#[test]
fn atomic_write_intermediates_and_removals_keep_their_old_handling() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = filter(dir.path());
    let probe = CountingProbe::default();
    let tmp = dir.path().join("a.md.0123.tmp");
    assert!(route_all(&mut f, &written(&tmp), &probe).is_empty());
    let gone = Event::new(EventKind::Remove(RemoveKind::File)).add_path(dir.path().join("a.md"));
    assert_eq!(
        route_all(&mut f, &[gone], &probe),
        vec![Emit::Deleted {
            path: dir.path().join("a.md").to_string_lossy().into_owned()
        }]
    );
}

#[test]
fn a_tab_without_an_absolute_path_is_skipped_not_registered() {
    // 이것을 실패시키는 것: `replace_open_files` 가 `validate_path` 로 거르지 않는다.
    let open = OpenFiles::default();
    replace_open_files(
        &open,
        &["".into(), "untitled-1".into(), "/v/build/a.md".into()],
    );
    let held = open.read().unwrap();
    assert!(held.contains(Path::new("/v/build/a.md")));
    assert!(!held.contains(Path::new("untitled-1")));
    assert!(!held.contains(Path::new("")));
}
