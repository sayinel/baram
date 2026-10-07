use super::*;
use notify::event::{CreateKind, DataChange, ModifyKind, RemoveKind, RenameMode};
use std::cell::{Cell, RefCell};

/// Counts every metadata read routing asks for. Answers "a file, mtime 7", or `None`
/// for a path staged as vanished.
#[derive(Default)]
struct CountingProbe {
    reads: Cell<usize>,
    gone: RefCell<HashSet<PathBuf>>,
}

impl Probe for CountingProbe {
    fn stat(&self, path: &Path) -> Option<Stat> {
        self.reads.set(self.reads.get() + 1);
        if self.gone.borrow().contains(path) {
            return None;
        }
        Some(Stat {
            is_dir: false,
            mtime: 7,
        })
    }
}

/// A registry that knows these open files.
fn known(paths: &[&Path]) -> OpenFiles {
    let open = OpenFiles::default();
    let paths: Vec<String> = paths
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    replace_open_files(&open, &paths).unwrap();
    open
}

/// What a build writing one file looks like: created, then its data written.
fn written(path: &Path) -> [Event; 2] {
    [
        Event::new(EventKind::Create(CreateKind::File)).add_path(path.to_path_buf()),
        Event::new(EventKind::Modify(ModifyKind::Data(DataChange::Content)))
            .add_path(path.to_path_buf()),
    ]
}

/// A filter whose registry knows no file is open.
fn filter(root: &Path) -> WatchFilter {
    WatchFilter::with_open_files(root, true, known(&[]), Focus::default())
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
    // 이것을 실패시키는 것: `route` 가 열린 파일 집합을 보지 않는다.
    let dir = tempfile::tempdir().unwrap();
    let note = dir.path().join("build/README.md");
    let mut f = WatchFilter::with_open_files(dir.path(), true, known(&[&note]), Focus::default());
    let probe = CountingProbe::default();
    let changed =
        Event::new(EventKind::Modify(ModifyKind::Data(DataChange::Content))).add_path(note.clone());
    let replaced =
        Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Any))).add_path(note.clone());
    let emitted = route_all(&mut f, &[changed], &probe);
    assert!(matches!(emitted[..], [Emit::Changed { .. }]), "{emitted:?}");
    // Another program's atomic save renames onto the open file: the tree hears a
    // creation, and the editor's reload and conflict checks — which listen to
    // `file:changed` only — hear a change.
    // 이것을 실패시키는 것: Modify(Name) 갈래의 `if open { … changed … }` 를 지운다.
    let emitted = route_all(&mut f, &[replaced], &probe);
    assert!(
        matches!(emitted[..], [Emit::Created { .. }, Emit::Changed { .. }]),
        "{emitted:?}"
    );
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

const INTERMEDIATE_ID: &str = "0123456789abcdef0123456789abcdef";

fn holds(open: &OpenFiles, path: &str) -> bool {
    matches!(&*open.read().unwrap(), OpenSet::Known(set) if set.contains(Path::new(path)))
}

fn is_unknown(open: &OpenFiles) -> bool {
    matches!(&*open.read().unwrap(), OpenSet::Unknown)
}

#[test]
fn only_baram_s_own_intermediates_are_dropped_as_tmp_files() {
    // `fs::write_file` writes `<target>.<32 hex>.tmp` and renames it over the target.
    // A file a user named `*.tmp` is an ordinary file.
    // 이것을 실패시키는 것: `is_write_intermediate` 대신 `.tmp` 로 끝나는 모든 경로를 버린다.
    let dir = tempfile::tempdir().unwrap();
    let mut f = filter(dir.path());
    let probe = CountingProbe::default();
    let ours = dir.path().join(format!("a.md.{INTERMEDIATE_ID}.tmp"));
    assert!(route_all(&mut f, &written(&ours), &probe).is_empty());
    assert_eq!(probe.reads.get(), 0);
    let theirs = dir.path().join("notes.tmp");
    assert_eq!(route_all(&mut f, &written(&theirs), &probe).len(), 2);
    for not_ours in [
        "a.md.0123.tmp",
        ".tmp",
        "a.md.0123456789ABCDEF0123456789ABCDEF.tmp",
    ] {
        assert!(
            !is_write_intermediate(&dir.path().join(not_ours)),
            "{not_ours}"
        );
    }
}

#[test]
fn a_removal_reads_nothing_and_reports_the_path_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = filter(dir.path());
    let probe = CountingProbe::default();
    let gone = Event::new(EventKind::Remove(RemoveKind::File)).add_path(dir.path().join("a.md"));
    assert_eq!(
        route_all(&mut f, &[gone], &probe),
        vec![Emit::Deleted {
            path: dir.path().join("a.md").to_string_lossy().into_owned()
        }]
    );
    assert_eq!(probe.reads.get(), 0);
}

#[test]
fn each_routed_path_is_read_once_and_a_rename_reports_one_snapshot() {
    // Separate probes let a destination removed between them yield a creation and a
    // change with mtime 0 (issue 795 review).
    // 이것을 실패시키는 것: Modify(Name) 갈래가 Changed 를 위해 다시 `stat` 한다.
    let dir = tempfile::tempdir().unwrap();
    let note = dir.path().join("build/README.md");
    let mut f = WatchFilter::with_open_files(dir.path(), true, known(&[&note]), Focus::default());
    let probe = CountingProbe::default();
    let replaced =
        Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Any))).add_path(note.clone());
    let emitted = route_all(&mut f, &[replaced], &probe);
    assert_eq!(probe.reads.get(), 1);
    let path = note.to_string_lossy().into_owned();
    assert_eq!(
        emitted,
        vec![
            Emit::Created {
                path: path.clone(),
                is_dir: false,
                origin: "external"
            },
            Emit::Changed {
                path,
                mtime: 7,
                origin: "external"
            },
        ]
    );
}

#[test]
fn a_path_gone_by_the_time_it_is_read_is_reported_deleted_never_changed() {
    // 이것을 실패시키는 것: `stat` 이 `None` 일 때 Deleted 대신 mtime 0 의 Changed/Created 를 낸다.
    let dir = tempfile::tempdir().unwrap();
    let note = dir.path().join("notes/a.md");
    let mut f = WatchFilter::with_open_files(dir.path(), true, known(&[&note]), Focus::default());
    let probe = CountingProbe::default();
    probe.gone.borrow_mut().insert(note.clone());
    let kinds = [
        EventKind::Create(CreateKind::File),
        EventKind::Modify(ModifyKind::Name(RenameMode::Any)),
        EventKind::Modify(ModifyKind::Data(DataChange::Content)),
    ];
    for kind in kinds {
        let emitted = route_all(&mut f, &[Event::new(kind).add_path(note.clone())], &probe);
        assert_eq!(
            emitted,
            vec![Emit::Deleted {
                path: note.to_string_lossy().into_owned()
            }],
            "{kind:?}"
        );
    }
}

#[test]
fn a_tab_without_an_absolute_path_is_skipped_not_registered() {
    // 이것을 실패시키는 것: `replace_open_files` 가 `validate_path` 로 거르지 않는다.
    let open = OpenFiles::default();
    replace_open_files(
        &open,
        &["".into(), "untitled-1".into(), "/v/build/a.md".into()],
    )
    .unwrap();
    assert!(holds(&open, "/v/build/a.md"));
    assert!(!holds(&open, "untitled-1"));
    assert!(!holds(&open, ""));
}

#[test]
fn a_rename_onto_a_file_that_is_not_open_reports_no_change() {
    // The change event is for the editor; a closed file has nothing to reload.
    // 이것을 실패시키는 것: Modify(Name) 갈래가 `open` 과 상관없이 changed 를 낸다.
    let dir = tempfile::tempdir().unwrap();
    let mut f = filter(dir.path());
    let probe = CountingProbe::default();
    let replaced = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Any)))
        .add_path(dir.path().join("notes/a.md"));
    let emitted = route_all(&mut f, &[replaced], &probe);
    assert!(matches!(emitted[..], [Emit::Created { .. }]), "{emitted:?}");
}

#[test]
fn an_open_file_named_like_a_tmp_file_keeps_its_events() {
    // 이것을 실패시키는 것: 열린 파일이라도 `.tmp` 로 끝나면 버린다.
    let dir = tempfile::tempdir().unwrap();
    let scratch = dir.path().join("build/scratch.tmp");
    let mut f =
        WatchFilter::with_open_files(dir.path(), true, known(&[&scratch]), Focus::default());
    let probe = CountingProbe::default();
    assert_eq!(route_all(&mut f, &written(&scratch), &probe).len(), 2);
    // Its unopened neighbour below `build/` is dropped by the folder rule.
    let other = dir.path().join("build/other.tmp");
    assert!(route_all(&mut f, &written(&other), &probe).is_empty());
}

#[test]
fn an_unknown_open_set_drops_nothing_but_baram_s_intermediates() {
    // Until a registration lands — and after one fails — any path may be open, so
    // nothing is filtered out: a registration that did not land must not hide an
    // open file's changes.
    // 이것을 실패시키는 것: `may_be_open` 이 `Unknown` 을 "열려 있지 않음" 으로 읽는다.
    let dir = tempfile::tempdir().unwrap();
    let mut f =
        WatchFilter::with_open_files(dir.path(), true, OpenFiles::default(), Focus::default());
    let probe = CountingProbe::default();
    let out = dir.path().join("build/out.md");
    assert_eq!(route_all(&mut f, &written(&out), &probe).len(), 2);
    let ours = dir
        .path()
        .join(format!("build/out.md.{INTERMEDIATE_ID}.tmp"));
    assert!(route_all(&mut f, &written(&ours), &probe).is_empty());
}

#[test]
fn a_refused_registration_leaves_the_set_unknown_not_stale() {
    // Keeping the previous set would filter a file opened since (issue 795 review).
    // 이것을 실패시키는 것: 상한을 넘은 호출이 이전 집합을 그대로 둔다.
    let open = OpenFiles::default();
    assert!(is_unknown(&open));
    replace_open_files(&open, &["/v/kept.md".into()]).unwrap();
    assert!(holds(&open, "/v/kept.md"));

    let over_count: Vec<String> = (0..=MAX_OPEN_FILES).map(|i| format!("/v/{i}.md")).collect();
    assert!(replace_open_files(&open, &over_count).is_err());
    assert!(is_unknown(&open));

    replace_open_files(&open, &["/v/kept.md".into()]).unwrap();
    let long = format!("/{}", "a".repeat(MAX_OPEN_FILES_BYTES - 1));
    assert!(replace_open_files(&open, &[format!("{long}b")]).is_err());
    assert!(is_unknown(&open));
}

#[test]
fn set_open_files_accepts_its_limits_and_refuses_one_past_them() {
    // 이것을 실패시키는 것: `replace_open_files` 의 개수 또는 바이트 상한 검사를 지운다.
    let open = OpenFiles::default();
    let at_count: Vec<String> = (0..MAX_OPEN_FILES).map(|i| format!("/v/{i}.md")).collect();
    let over_count: Vec<String> = (0..=MAX_OPEN_FILES).map(|i| format!("/v/{i}.md")).collect();
    let long = format!("/{}", "a".repeat(MAX_OPEN_FILES_BYTES - 1));
    assert!(replace_open_files(&open, &over_count).is_err());
    assert!(replace_open_files(&open, &[format!("{long}b")]).is_err());
    assert!(replace_open_files(&open, &[long]).is_ok());
    assert!(replace_open_files(&open, &at_count).is_ok());
    assert!(holds(&open, "/v/0.md"));
}

/// A non-recursive watch's filter, for `focus` files (#797).
fn folder_filter(root: &Path, focus: &[&Path]) -> WatchFilter {
    let set: HashSet<PathBuf> = focus.iter().map(|p| p.to_path_buf()).collect();
    WatchFilter::with_open_files(root, false, known(&[]), Arc::new(RwLock::new(set)))
}

#[test]
fn a_folder_watch_takes_its_focus_files_for_open_ones() {
    // A file window has no editor store, so nothing registers its file as open; the
    // lease's focus does. An atomic replace of it is then reported as a change.
    // 이것을 실패시키는 것: `may_be_open` 이 focus 집합을 보지 않는다.
    let dir = tempfile::tempdir().unwrap();
    let note = dir.path().join("n.md");
    let mut f = folder_filter(dir.path(), &[&note]);
    let probe = CountingProbe::default();
    let replaced =
        Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Any))).add_path(note.clone());
    let emitted = route_all(&mut f, std::slice::from_ref(&replaced), &probe);
    assert!(
        matches!(emitted[..], [Emit::Created { .. }, Emit::Changed { .. }]),
        "{emitted:?}"
    );
    // Another file of that folder is not open: a rename onto it is only a creation.
    let other = dir.path().join("o.md");
    let emitted = route_all(
        &mut f,
        &[Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Any))).add_path(other)],
        &probe,
    );
    assert!(matches!(emitted[..], [Emit::Created { .. }]), "{emitted:?}");
}

#[test]
fn a_folder_watch_reads_no_baramignore_and_ignores_the_editor_open_set() {
    // The folder is not a vault: a `.baramignore` there means nothing to Baram, and the
    // editor's open set is the vault's business.
    // 이것을 실패시키는 것: 비재귀 watch 도 `load_or_defaults` 로 `.baramignore` 를 읽는다.
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(BARAMIGNORE), "*.md\n").unwrap();
    let mut f = folder_filter(dir.path(), &[]);
    let probe = CountingProbe::default();
    let note = dir.path().join("n.md");
    assert_eq!(route_all(&mut f, &written(&note), &probe).len(), 2);
    // An unknown editor open set does not open it up either: the default list still
    // applies to what it routes.
    // 이것을 실패시키는 것: 비재귀 watch 의 `may_be_open` 이 편집기의 열린 파일 집합(Unknown)을 본다.
    let mut f =
        WatchFilter::with_open_files(dir.path(), false, OpenFiles::default(), Focus::default());
    assert!(route_all(&mut f, &written(&dir.path().join("build/out.o")), &probe).is_empty());
}

#[cfg(unix)]
#[test]
fn a_vault_registered_through_a_symlink_judges_paths_in_either_spelling() {
    // The registry keys watches by canonical path, but the filter keeps the vault root
    // as registered; the watcher reports the resolved spelling.
    // 이것을 실패시키는 것: `VaultExclusion::relative` 가 적힌 root 로만 경로를 떼어 낸다.
    let real = tempfile::tempdir().unwrap();
    let real_root = std::fs::canonicalize(real.path()).unwrap();
    let links = tempfile::tempdir().unwrap();
    let alias = links.path().join("vault");
    std::os::unix::fs::symlink(&real_root, &alias).unwrap();
    let mut f = WatchFilter::with_open_files(&alias, true, known(&[]), Focus::default());
    let probe = CountingProbe::default();
    for root in [&alias, &real_root] {
        assert!(
            route_all(&mut f, &written(&root.join("build/out.o")), &probe).is_empty(),
            "{root:?}"
        );
        assert_eq!(
            route_all(&mut f, &written(&root.join("note.md")), &probe).len(),
            2,
            "{root:?}"
        );
    }
}

#[test]
fn an_atomic_replace_in_a_non_recursive_folder_reaches_the_open_file() {
    // Issue 797's last criterion, with the real watcher: write a tmp file beside the
    // open one and rename it over it, in a folder watched non-recursively. A change in
    // a subfolder is outside the watch.
    // 이것을 실패시키는 것: focus 를 열린 파일로 보지 않는다(rename 이 Created 로만 끝난다).
    use notify::{RecursiveMode, Watcher};
    let dir = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(dir.path()).unwrap();
    std::fs::create_dir(root.join("sub")).unwrap();
    let note = root.join("n.md");
    std::fs::write(&note, "v1").unwrap();
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();
    let mut watcher: notify::RecommendedWatcher =
        notify::Watcher::new(tx, notify::Config::default()).unwrap();
    watcher.watch(&root, RecursiveMode::NonRecursive).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(500));
    let tmp = root.join(".n.md.swp");
    std::fs::write(&tmp, "v2").unwrap();
    std::fs::rename(&tmp, &note).unwrap();
    std::fs::write(root.join("sub/deep.md"), "x").unwrap();

    let mut f = folder_filter(&root, &[&note]);
    let (mut changed, mut deep) = (0, 0);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while std::time::Instant::now() < deadline && changed == 0 {
        let Ok(Ok(event)) = rx.recv_timeout(std::time::Duration::from_millis(500)) else {
            continue;
        };
        for emit in f.route(&event, &RealProbe) {
            match emit {
                Emit::Changed { path, .. } if Path::new(&path) == note => changed += 1,
                Emit::Created { path, .. } | Emit::Changed { path, .. }
                    if path.contains("/sub/") =>
                {
                    deep += 1
                }
                _ => {}
            }
        }
    }
    assert!(changed > 0, "no change reported for the replaced open file");
    assert_eq!(deep, 0);
}

#[cfg(unix)]
#[test]
fn an_event_is_reported_in_every_spelling_the_leases_registered() {
    // The OS reports the resolved spelling (`/private/var/…` on macOS); a tab opened
    // under the alias compares paths byte for byte and must get its own.
    // 이것을 실패시키는 것: `route` 가 `respell` 없이 OS 의 표기를 그대로 낸다.
    let real = tempfile::tempdir().unwrap();
    let real_root = std::fs::canonicalize(real.path()).unwrap();
    let links = tempfile::tempdir().unwrap();
    let alias = links.path().join("vault");
    std::os::unix::fs::symlink(&real_root, &alias).unwrap();
    let spellings: Spellings = Arc::new(RwLock::new(vec![(real_root.clone(), alias.clone())]));
    let mut f = WatchFilter::for_watch(&alias, true, Focus::default(), Arc::clone(&spellings));
    let probe = CountingProbe::default();
    let note = real_root.join("note.md");
    let emitted = route_all(&mut f, &written(&note), &probe);
    let paths: Vec<&str> = emitted.iter().map(Emit::path).collect();
    let expected = alias.join("note.md").to_string_lossy().into_owned();
    assert_eq!(paths, vec![expected.as_str(), expected.as_str()]);

    // Two spellings registered: each gets the event.
    spellings
        .write()
        .unwrap()
        .push((real_root.clone(), real_root.clone()));
    let emitted = route_all(&mut f, &[written(&note)[1].clone()], &probe);
    let mut paths: Vec<String> = emitted.iter().map(|e| e.path().to_string()).collect();
    paths.sort();
    let mut want = vec![expected, note.to_string_lossy().into_owned()];
    want.sort();
    assert_eq!(paths, want);
}

#[cfg(unix)]
#[test]
fn a_folder_served_by_an_ancestors_watch_gets_its_events_in_its_own_spelling() {
    // A file window's folder inside the vault, opened through another link: its tab
    // compares paths under that link. Events outside the folder are not respelled
    // into it.
    // 이것을 실패시키는 것: `respell` 이 폴더가 event 를 담는지 보지 않고 spelling 마다 낸다.
    let real = tempfile::tempdir().unwrap();
    let real_root = std::fs::canonicalize(real.path()).unwrap();
    std::fs::create_dir(real_root.join("sub")).unwrap();
    let links = tempfile::tempdir().unwrap();
    let sub_alias = links.path().join("sub");
    std::os::unix::fs::symlink(real_root.join("sub"), &sub_alias).unwrap();
    let spellings: Spellings = Arc::new(RwLock::new(vec![
        (real_root.clone(), real_root.clone()),
        (real_root.join("sub"), sub_alias.clone()),
    ]));
    let mut f = WatchFilter::for_watch(&real_root, true, Focus::default(), spellings);
    let probe = CountingProbe::default();
    let inside = real_root.join("sub/n.md");
    let mut paths: Vec<String> = route_all(&mut f, &[written(&inside)[1].clone()], &probe)
        .iter()
        .map(|e| e.path().to_string())
        .collect();
    paths.sort();
    let mut want = vec![
        inside.to_string_lossy().into_owned(),
        sub_alias.join("n.md").to_string_lossy().into_owned(),
    ];
    want.sort();
    assert_eq!(paths, want);
    let top = real_root.join("top.md");
    let paths: Vec<String> = route_all(&mut f, &[written(&top)[1].clone()], &probe)
        .iter()
        .map(|e| e.path().to_string())
        .collect();
    assert_eq!(paths, vec![top.to_string_lossy().into_owned()]);
}

#[cfg(unix)]
#[test]
fn a_focus_file_reported_in_the_hosts_other_spelling_still_passes_an_excluded_folder() {
    // A watcher reports paths in the spelling it was started with (inotify does); a
    // file window's focus file below the host's `build/` must pass in it too.
    // 이것을 실패시키는 것: `may_be_open` 이 focus 를 보고된 표기로만 찾는다.
    let real = tempfile::tempdir().unwrap();
    let real_root = std::fs::canonicalize(real.path()).unwrap();
    std::fs::create_dir(real_root.join("build")).unwrap();
    let links = tempfile::tempdir().unwrap();
    let alias = links.path().join("vault");
    std::os::unix::fs::symlink(&real_root, &alias).unwrap();
    let focus: Focus = Arc::new(RwLock::new(
        [real_root.join("build/out.md")].into_iter().collect(),
    ));
    let spellings: Spellings = Arc::new(RwLock::new(vec![(real_root.clone(), alias.clone())]));
    // The editor's open set is known and holds neither file: only the focus lets one in.
    let mut f = WatchFilter::with_open_files(&alias, true, known(&[]), focus);
    f.spellings = spellings;
    let probe = CountingProbe::default();
    let reported = alias.join("build/out.md");
    std::fs::write(real_root.join("build/out.md"), "x").unwrap();
    let emitted = route_all(&mut f, &[written(&reported)[1].clone()], &probe);
    assert_eq!(emitted.len(), 1);
    // Not vacuous: another file there is dropped.
    let other = alias.join("build/other.md");
    std::fs::write(real_root.join("build/other.md"), "x").unwrap();
    assert!(route_all(&mut f, &[written(&other)[1].clone()], &probe).is_empty());
}
