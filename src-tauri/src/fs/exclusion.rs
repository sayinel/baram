// §3.6 What the vault walk leaves out below a vault root — one default list plus the
// vault's own `.baramignore` (issue 794).
//
// The default names live in `default-excluded-dirs.json`, the one source for the
// walkers (`collect_md_files`, `collect_all_files`, `search`), the file tree
// (`list_dir`), the snapshot scan and the frontend's watcher-event filter
// (`src/hooks/use-file-watcher.ts` imports the same file). The Rust watcher judges
// its events by this matcher too, relative to the watched root, with two
// departures of its own — open files pass, hidden files are kept (`watch_filter`,
// issue 795).
//
// The hidden rule comes FIRST: every reader above drops an entry whose name starts with
// `.` before it consults the list or the matcher. So `.next` and `.git` in the list change
// nothing in Rust — they are there for the frontend filter, which keeps hidden FILES —
// and a `!.next/` line in `.baramignore` cannot bring a hidden folder back
// (`a_negation_cannot_bring_back_a_hidden_folder`).
//
// Matching is exact-case, on every file system: `GitignoreBuilder`'s default, chosen
// rather than detected, so `Build/` is walked even where the volume folds case
// (`matching_is_exact_case`).
//
// ‼️ The matcher is `ignore::gitignore::Gitignore` built here, not `ignore::WalkBuilder`.
// A `WalkBuilder` turns on filters that are not ours by default — `.gitignore`, the
// global git excludes, `.git/info/exclude`, `.ignore` files and the same files in every
// folder ABOVE the start — so a note someone gitignored on purpose would vanish from
// search and links. `GitignoreBuilder` reads only what `load` hands it: the default
// names and `<root>/.baramignore`. Whoever moves the walk onto `WalkBuilder` (issue 796)
// has to switch those filters off; `ignore_files_that_are_not_ours_hide_nothing` fails
// when the `.gitignore`, `.git/info/exclude`, `.ignore` or parent filter is on (not the
// global excludes, which no fixture can hold).

use super::FsError;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::LazyLock;

/// The per-vault override file, gitignore syntax, read from the vault root only.
pub const BARAMIGNORE: &str = ".baramignore";

/// The largest `.baramignore` read, in bytes. Larger is refused, not truncated.
pub const MAX_BARAMIGNORE_BYTES: u64 = 64 * 1024;

/// The most patterns (lines that are neither blank nor `#` comments) a `.baramignore`
/// may hold. More is refused.
pub const MAX_BARAMIGNORE_PATTERNS: usize = 1_000;

/// Folder names the walk does not enter at any depth below a vault root, unless the
/// vault's `.baramignore` re-includes them (`!build/`).
pub static DEFAULT_EXCLUDED_DIRS: LazyLock<Vec<&'static str>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("default-excluded-dirs.json"))
        .expect("default-excluded-dirs.json is a JSON array of folder names")
});

/// Which entries below one vault root the walk leaves out. Built once per walk (or per
/// index build, kept by `LinkIndex` so a save is judged by the matcher its build used).
///
/// Paths are judged RELATIVE to the root, component-wise — a vault whose root folder is
/// itself named `build` is walked; a `build` folder below it is not. A path is placed
/// under the root as spelled, else under the root's canonical spelling, else by
/// resolving the path itself (`resolve_canonical`, the spelling policy the contexts
/// already use). A path that is under neither is OUTSIDE the vault and is no member of
/// it: both checks answer "left out".
///
/// `Default` excludes nothing: what an index that was never built holds.
#[derive(Debug, Clone, Default)]
pub struct VaultExclusion {
    root: PathBuf,
    canonical_root: Option<PathBuf>,
    matcher: Option<Gitignore>,
}

impl VaultExclusion {
    /// The default names, then `<root>/.baramignore` when there is one. Its lines come
    /// AFTER the defaults so that, gitignore-style, the last matching line wins and
    /// `!build/` brings `build` folders back.
    ///
    /// A missing file is the common case and means the defaults alone. A file that is
    /// there but cannot be used — unreadable, not UTF-8, over `MAX_BARAMIGNORE_BYTES`
    /// or `MAX_BARAMIGNORE_PATTERNS`, or holding a line that is not a valid pattern — is
    /// an `Err` naming the file, never the defaults alone: every consumer loads through
    /// here, so search, tags, tasks, the index build and the CLI all refuse alike
    /// instead of some showing folders the others leave out.
    pub fn load(root: &Path) -> Result<Self, FsError> {
        let mut builder = defaults(root);
        let file = root.join(BARAMIGNORE);
        if let Some(text) = read_baramignore(&file)? {
            let refuse = |reason: String| FsError::BaramIgnore {
                path: file.clone(),
                reason,
            };
            let mut patterns = 0;
            for (i, line) in text.lines().enumerate() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                patterns += 1;
                if patterns > MAX_BARAMIGNORE_PATTERNS {
                    return Err(refuse(format!(
                        "more than {MAX_BARAMIGNORE_PATTERNS} patterns"
                    )));
                }
                builder
                    .add_line(None, line)
                    .map_err(|e| refuse(format!("line {}: {}", i + 1, glob_reason(&e))))?;
            }
        }
        let matcher = builder.build().map_err(|e| FsError::BaramIgnore {
            path: file.clone(),
            reason: glob_reason(&e),
        })?;
        Ok(Self {
            root: root.to_path_buf(),
            canonical_root: std::fs::canonicalize(root).ok(),
            matcher: Some(matcher),
        })
    }

    /// The default names alone, with no `.baramignore` — what the watcher filters by
    /// when the vault's `.baramignore` cannot be used (`fs::watch_filter`), where
    /// refusing to filter would let the flood through.
    pub fn defaults_only(root: &Path) -> Self {
        Self {
            root: root.to_path_buf(),
            canonical_root: std::fs::canonicalize(root).ok(),
            matcher: defaults(root).build().ok(),
        }
    }

    /// Whether the walk leaves out `path`, an entry of a folder it already entered.
    /// Hidden names are the walkers' own rule and are not judged here.
    pub fn excludes_entry(&self, path: &Path, is_dir: bool) -> bool {
        let Some(matcher) = &self.matcher else {
            return false;
        };
        match self.relative(path) {
            Some(rel) => matcher.matched(&rel, is_dir).is_ignore(),
            None => true,
        }
    }

    /// Whether the vault walk never reaches `path`: it is outside the root, some
    /// component below the root is hidden, or the walk would leave out it or a folder
    /// above it. Judged top-down the way the walk descends, so a `!keep.md` line under
    /// an excluded folder does not let a save put back what the walk never sees
    /// (`matched_path_or_any_parents` would answer bottom-up and let it). What a
    /// single-file update asks — the save-time link index update, the task update, the
    /// two renames' boundary check and the CLI's path arguments.
    pub fn walk_skips(&self, path: &Path, is_dir: bool) -> bool {
        let Some(matcher) = &self.matcher else {
            return false;
        };
        let Some(rel) = self.relative(path) else {
            return true;
        };
        let names: Vec<_> = rel
            .components()
            .filter_map(|c| match c {
                Component::Normal(name) => Some(name),
                _ => None,
            })
            .collect();
        let mut prefix = PathBuf::new();
        for (i, name) in names.iter().enumerate() {
            prefix.push(name);
            let dir = i + 1 < names.len() || is_dir;
            if name.to_string_lossy().starts_with('.') || matcher.matched(&prefix, dir).is_ignore()
            {
                return true;
            }
        }
        false
    }

    /// `path` below the root: as spelled, under the canonical root, or resolved.
    fn relative(&self, path: &Path) -> Option<PathBuf> {
        if let Ok(rel) = path.strip_prefix(&self.root) {
            return Some(rel.to_path_buf());
        }
        let canonical_root = self.canonical_root.as_deref()?;
        if let Ok(rel) = path.strip_prefix(canonical_root) {
            return Some(rel.to_path_buf());
        }
        let resolved = crate::context::manager::resolve_canonical(&path.to_string_lossy()).ok()?;
        resolved
            .strip_prefix(canonical_root)
            .ok()
            .map(Path::to_path_buf)
    }
}

/// `None` when there is no file. The read itself is the size cap: it stops one byte past
/// `MAX_BARAMIGNORE_BYTES`, so a file of any size costs at most that much memory, and
/// one that reaches the extra byte is refused, not truncated.
fn read_baramignore(file: &Path) -> Result<Option<String>, FsError> {
    let refuse = |reason: String| FsError::BaramIgnore {
        path: file.to_path_buf(),
        reason,
    };
    let mut handle = match std::fs::File::open(file) {
        Ok(handle) => handle,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(refuse(io_reason(&e))),
    };
    let mut bytes = Vec::new();
    (&mut handle)
        .take(MAX_BARAMIGNORE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| refuse(io_reason(&e)))?;
    if bytes.len() as u64 > MAX_BARAMIGNORE_BYTES {
        return Err(refuse(format!("larger than {MAX_BARAMIGNORE_BYTES} bytes")));
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| refuse("not UTF-8 text".to_string()))
}

/// The OS's reason without the path, which `FsError::BaramIgnore` carries on its own.
fn io_reason(e: &std::io::Error) -> String {
    e.kind().to_string()
}

/// A glob error's text. `add_line(None, …)` attaches no file path to it.
fn glob_reason(e: &ignore::Error) -> String {
    e.to_string()
}

fn defaults(root: &Path) -> GitignoreBuilder {
    let mut builder = GitignoreBuilder::new(root);
    for name in DEFAULT_EXCLUDED_DIRS.iter() {
        builder
            .add_line(None, &format!("{name}/"))
            .expect("a default name is a plain folder glob");
    }
    builder
}

/// Every folder a walk listed, recorded for the test that started it — what discovery
/// costs, counted rather than timed. The record belongs to the test's thread; a walk
/// that runs on a blocking thread (`walk::walk_vault`) records into its caller's through
/// `folder_reads_handle` / `record_into`, so tests running side by side do not mix.
#[cfg(test)]
type FolderReads = std::sync::Arc<std::sync::Mutex<Vec<PathBuf>>>;

#[cfg(test)]
thread_local! {
    static FOLDERS_READ: std::cell::RefCell<Option<FolderReads>> = const { std::cell::RefCell::new(None) };
}

/// This thread's record, made on first use.
#[cfg(test)]
pub(crate) fn folder_reads_handle() -> FolderReads {
    FOLDERS_READ.with(|r| r.borrow_mut().get_or_insert_with(Default::default).clone())
}

/// Record into `reads` on this thread until the guard drops.
#[cfg(test)]
pub(crate) fn record_into(reads: FolderReads) -> impl Drop {
    struct Restore(Option<FolderReads>);
    impl Drop for Restore {
        fn drop(&mut self) {
            let previous = self.0.take();
            FOLDERS_READ.with(|r| *r.borrow_mut() = previous);
        }
    }
    Restore(FOLDERS_READ.with(|r| r.borrow_mut().replace(reads)))
}

#[cfg(test)]
pub(crate) fn note_folder_read(dir: &Path) {
    folder_reads_handle()
        .lock()
        .unwrap()
        .push(dir.to_path_buf());
}

/// The folders listed so far for this thread, emptying the record.
#[cfg(test)]
pub(crate) fn take_folders_read() -> Vec<PathBuf> {
    std::mem::take(&mut *folder_reads_handle().lock().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs::{collect_all_files, collect_md_files};

    fn write(root: &Path, rel: &str, body: &str) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    /// Both walkers' markdown, as root-relative `/` paths, sorted.
    async fn walked(root: &Path) -> (Vec<String>, Vec<String>) {
        let exclusion = VaultExclusion::load(root).unwrap();
        let rel = |found: Vec<PathBuf>| {
            let mut out: Vec<String> = found
                .iter()
                .map(|p| {
                    p.strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/")
                })
                .collect();
            out.sort();
            out
        };
        let mut md = Vec::new();
        collect_md_files(root, &exclusion, &mut md).await.unwrap();
        let mut all = Vec::new();
        collect_all_files(root, &exclusion, &mut all).await.unwrap();
        (rel(md), rel(all))
    }

    /// Issue 794's criterion: 10,000 files under an excluded folder cost discovery no
    /// folder read at all — counted, not timed. The sibling `notes` folder IS read, so
    /// the count is of a mechanism that runs.
    /// 이것을 실패시키는 것: 두 walker 의 `excludes_entry` 검사를 지우는 것 — `build` 와 그
    /// 아래가 읽힌다.
    #[tokio::test]
    async fn an_excluded_folder_is_never_read_however_much_it_holds() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, "notes/a.md", "a");
        let heavy = root.join("build").join("out");
        std::fs::create_dir_all(&heavy).unwrap();
        for i in 0..10_000 {
            std::fs::write(heavy.join(format!("{i}.o")), "").unwrap();
        }
        write(root, "build/readme.md", "x");

        take_folders_read();
        let (md, all) = walked(root).await;
        let read = take_folders_read();

        assert_eq!(md, vec!["notes/a.md"]);
        assert_eq!(all, vec!["notes/a.md"]);
        assert!(
            !read.iter().any(|d| d.starts_with(root.join("build"))),
            "a folder under build was listed: {read:?}"
        );
        assert_eq!(
            read.iter().filter(|d| **d == root.join("notes")).count(),
            2,
            "each walker lists notes once"
        );
    }

    /// The root is never judged: a vault whose folder is named `build` is walked, and
    /// only the `build` below it is left out. 이것을 실패시키는 것: `excludes_entry` 를
    /// watcher 식의 절대 경로 판정(`path` 의 어느 성분이든 기본 목록이면 제외)으로 바꾸는 것.
    #[tokio::test]
    async fn a_vault_root_named_like_an_excluded_folder_is_walked() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("build");
        write(&root, "a.md", "a");
        write(&root, "sub/b.md", "b");
        write(&root, "build/c.md", "c");

        let (md, _) = walked(&root).await;
        assert_eq!(md, vec!["a.md", "sub/b.md"]);

        let exclusion = VaultExclusion::load(&root).unwrap();
        assert!(!exclusion.walk_skips(&root.join("a.md"), false));
        assert!(exclusion.walk_skips(&root.join("build/c.md"), false));
    }

    /// `.baramignore` lines come after the defaults, so `!build/` brings a default back,
    /// and its own lines leave folders and files out. 이것을 실패시키는 것: `load` 에서
    /// `.baramignore` 를 기본 목록보다 먼저 넣는 것 — `!build/` 가 뒤의 `build/` 에 진다.
    #[tokio::test]
    async fn baramignore_re_includes_a_default_and_leaves_out_its_own() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, BARAMIGNORE, "# comment\n!build/\ndrafts/\n*.log\n");
        write(root, "a.md", "a");
        write(root, "build/b.md", "b");
        write(root, "dist/c.md", "c");
        write(root, "drafts/d.md", "d");
        write(root, "x.log", "");

        let (md, all) = walked(root).await;
        assert_eq!(md, vec!["a.md", "build/b.md"]);
        assert_eq!(all, vec!["a.md", "build/b.md"]);
    }

    /// Only the defaults and `<root>/.baramignore` count. The fixture is a git repository
    /// with a `.gitignore`, a `.git/info/exclude`, a `.ignore`, and a `.ignore` and a
    /// `.baramignore` in the folder ABOVE the root — each hides one note from a default
    /// `ignore::WalkBuilder`, which the control walk below shows; here they hide nothing,
    /// and a note someone gitignored stays a note. Git's global excludes are not pinned:
    /// they live outside any fixture.
    /// 이것을 실패시키는 것: `load` 가 `root.join(".gitignore")` 나
    /// `root.parent().join(BARAMIGNORE)` 를 `builder.add` 하는 것 (각각 돌려 확인).
    #[tokio::test]
    async fn ignore_files_that_are_not_ours_hide_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("vault");
        write(dir.path(), BARAMIGNORE, "above-baram.md\n");
        write(dir.path(), ".ignore", "above-ignore.md\n");
        write(&root, ".git/info/exclude", "excluded.md\n");
        write(&root, ".gitignore", "secret.md\n");
        write(&root, ".ignore", "private.md\n");
        let notes = [
            "above-baram.md",
            "above-ignore.md",
            "excluded.md",
            "private.md",
            "secret.md",
        ];
        for note in notes {
            write(&root, note, "x");
        }

        // Control: a default `WalkBuilder` that also reads `.baramignore` misses every
        // note, so each ignore file in the fixture is one it would honour.
        let seen: Vec<String> = ignore::WalkBuilder::new(&root)
            .add_custom_ignore_filename(BARAMIGNORE)
            .build()
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        for note in notes {
            assert!(
                !seen.contains(&note.to_string()),
                "the control walk listed {note}"
            );
        }

        let (md, _) = walked(&root).await;
        assert_eq!(md, notes);
    }

    /// `walk_skips` answers what the walk does, top-down: a `!` line for a file under an
    /// excluded folder does not bring it back, since the walk never lists that folder.
    /// 이것을 실패시키는 것: `walk_skips` 를 `matched_path_or_any_parents` 로 바꾸는 것 —
    /// 파일 자신의 `!` 줄에 먼저 걸려 "포함" 으로 답한다. 숨김 성분 판정을 빼는 것, 상위
    /// 성분을 폴더가 아니라 `is_dir` 로 판정하는 것도 각각 돌려 확인했다.
    #[tokio::test]
    async fn walk_skips_agrees_with_the_walk_below_an_excluded_folder() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, BARAMIGNORE, "drafts/\n!drafts/keep.md\n");
        write(root, "drafts/keep.md", "k");
        write(root, "notes/.hidden/h.md", "h");
        write(root, "notes/a.md", "a");

        let (md, _) = walked(root).await;
        assert_eq!(md, vec!["notes/a.md"]);

        let exclusion = VaultExclusion::load(root).unwrap();
        assert!(exclusion.walk_skips(&root.join("drafts/keep.md"), false));
        assert!(exclusion.walk_skips(&root.join("notes/.hidden/h.md"), false));
        assert!(!exclusion.walk_skips(&root.join("notes/a.md"), false));
    }

    /// A `.baramignore` that is there but cannot be read is an error naming it, not the
    /// defaults alone — every consumer loads through `load`, so all of them refuse alike.
    /// 이것을 실패시키는 것: `read_baramignore` 가 읽기 오류에서 `Ok(None)` 을 돌려주는 것.
    #[test]
    fn an_unreadable_baramignore_is_an_error_not_the_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir(root.join(BARAMIGNORE)).unwrap();
        match VaultExclusion::load(root) {
            Err(FsError::BaramIgnore { path, .. }) => assert_eq!(path, root.join(BARAMIGNORE)),
            other => panic!("expected BaramIgnore, got {other:?}"),
        }
        // Missing is not unreadable: the defaults alone.
        let plain = tempfile::tempdir().unwrap();
        assert!(VaultExclusion::load(plain.path())
            .unwrap()
            .walk_skips(&plain.path().join("build/x.md"), false));
    }

    /// A line that is not a valid pattern refuses the file — with its line number — rather
    /// than dropping the line. 이것을 실패시키는 것: `add_line` 의 오류를 무시하는 것.
    #[test]
    fn an_invalid_line_is_an_error_naming_it() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), BARAMIGNORE, "drafts/\n{unclosed\n");
        match VaultExclusion::load(dir.path()) {
            Err(FsError::BaramIgnore { reason, .. }) => {
                assert!(reason.starts_with("line 2:"), "{reason}")
            }
            other => panic!("expected BaramIgnore, got {other:?}"),
        }
    }

    /// The size cap: exactly `MAX_BARAMIGNORE_BYTES` loads, one byte more is refused.
    /// 이것을 실패시키는 것: 크기 검사를 `>=` 로 바꾸는 것(경계가 거부된다), 또는 지우는 것.
    #[test]
    fn a_baramignore_over_the_size_cap_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let at_cap = format!(
            "drafts/\n{}",
            "#".repeat(MAX_BARAMIGNORE_BYTES as usize - 8)
        );
        assert_eq!(at_cap.len() as u64, MAX_BARAMIGNORE_BYTES);
        write(dir.path(), BARAMIGNORE, &at_cap);
        let exclusion = VaultExclusion::load(dir.path()).unwrap();
        assert!(exclusion.walk_skips(&dir.path().join("drafts/a.md"), false));

        write(dir.path(), BARAMIGNORE, &format!("{at_cap}#"));
        match VaultExclusion::load(dir.path()) {
            Err(FsError::BaramIgnore { reason, .. }) => {
                assert!(reason.contains("larger"), "{reason}")
            }
            other => panic!("expected BaramIgnore, got {other:?}"),
        }
    }

    /// The pattern cap: `MAX_BARAMIGNORE_PATTERNS` patterns load, one more is refused;
    /// blank and comment lines do not count. 이것을 실패시키는 것: 개수 검사를 `>=` 로
    /// 바꾸는 것, 또는 주석 줄도 세는 것.
    #[test]
    fn a_baramignore_over_the_pattern_cap_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let mut at_cap = String::from("# heading\n\n");
        for i in 0..MAX_BARAMIGNORE_PATTERNS {
            at_cap.push_str(&format!("d{i}/\n"));
        }
        write(dir.path(), BARAMIGNORE, &at_cap);
        let exclusion = VaultExclusion::load(dir.path()).unwrap();
        assert!(exclusion.walk_skips(&dir.path().join("d999/a.md"), false));

        write(dir.path(), BARAMIGNORE, &format!("{at_cap}one-more/\n"));
        match VaultExclusion::load(dir.path()) {
            Err(FsError::BaramIgnore { reason, .. }) => {
                assert!(reason.contains("patterns"), "{reason}")
            }
            other => panic!("expected BaramIgnore, got {other:?}"),
        }
    }

    /// Exact case, chosen: the default `build/` does not leave out `Build`, on any volume.
    /// 이것을 실패시키는 것: `defaults` 에서 `case_insensitive(true)` 를 켜는 것.
    #[tokio::test]
    async fn matching_is_exact_case() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, "Build/a.md", "a");
        write(root, "build/b.md", "b");
        let (md, _) = walked(root).await;
        // A volume that folds case holds one folder; either way `Build` is walked.
        assert!(md.contains(&"Build/a.md".to_string()), "{md:?}");
        assert!(!md.contains(&"build/b.md".to_string()), "{md:?}");
    }

    /// The hidden rule comes before the matcher, so `!.next/` brings nothing back even
    /// though `.next` is a default name the negation does match.
    /// 이것을 실패시키는 것: `collect_md_files` 의 숨김 검사를 지우는 것 — `!.next/` 가
    /// `.next/a.md` 를 되살린다.
    #[tokio::test]
    async fn a_negation_cannot_bring_back_a_hidden_folder() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, BARAMIGNORE, "!.next/\n");
        write(root, ".next/a.md", "a");
        write(root, "b.md", "b");
        let (md, _) = walked(root).await;
        assert_eq!(md, vec!["b.md"]);
    }

    /// A path is placed under the root by its canonical spelling too: on macOS the temp
    /// dir is `/var/…`, which resolves to `/private/var/…`. A matcher loaded from one
    /// spelling judges a path given in the other the same way. 이것을 실패시키는 것:
    /// `relative` 의 canonical root 단계와 resolve 단계를 지우는 것 — 다른 표기의 `build`
    /// 노트가 "포함" 으로 답한다(fail open).
    #[test]
    fn a_path_in_another_spelling_of_the_root_is_judged_the_same() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "build/x.md", "x");
        write(dir.path(), "notes/a.md", "a");
        let canonical = std::fs::canonicalize(dir.path()).unwrap();
        if canonical == dir.path() {
            eprintln!("skipped: the temp dir has one spelling here");
            return;
        }
        for (loaded, asked) in [
            (dir.path(), canonical.as_path()),
            (canonical.as_path(), dir.path()),
        ] {
            let exclusion = VaultExclusion::load(loaded).unwrap();
            assert!(
                exclusion.walk_skips(&asked.join("build/x.md"), false),
                "{asked:?}"
            );
            assert!(
                !exclusion.walk_skips(&asked.join("notes/a.md"), false),
                "{asked:?}"
            );
            assert!(
                exclusion.excludes_entry(&asked.join("build"), true),
                "{asked:?}"
            );
        }
    }

    /// The root's canonical spelling is placed LEXICALLY, like the spelled root: a path
    /// through a link inside the vault that points elsewhere gets the same answer in both
    /// spellings, not one judged by where the link leads. 이것을 실패시키는 것:
    /// `relative` 의 canonical root 어휘 단계를 지우는 것 — resolve 단계가 링크를 따라가
    /// 밖으로 판정한다.
    #[cfg(unix)]
    #[test]
    fn both_spellings_of_the_root_are_placed_lexically() {
        let dir = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        write(elsewhere.path(), "a.md", "a");
        std::os::unix::fs::symlink(elsewhere.path(), dir.path().join("link")).unwrap();
        let canonical = std::fs::canonicalize(dir.path()).unwrap();
        if canonical == dir.path() {
            eprintln!("skipped: the temp dir has one spelling here");
            return;
        }
        let exclusion = VaultExclusion::load(dir.path()).unwrap();
        assert!(!exclusion.walk_skips(&dir.path().join("link/a.md"), false));
        assert!(!exclusion.walk_skips(&canonical.join("link/a.md"), false));
    }

    /// Outside the root in every spelling is no member of the vault: both checks say "left
    /// out". 이것을 실패시키는 것: `relative` 가 `None` 일 때 `false` 를 돌려주는 것.
    #[test]
    fn a_path_outside_the_root_is_left_out() {
        let dir = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        write(other.path(), "a.md", "a");
        let exclusion = VaultExclusion::load(dir.path()).unwrap();
        assert!(exclusion.walk_skips(&other.path().join("a.md"), false));
        assert!(exclusion.excludes_entry(&other.path().join("a.md"), false));
        assert!(!exclusion.walk_skips(&dir.path().join("a.md"), false));
    }
}
