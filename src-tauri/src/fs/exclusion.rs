// §3.6 What the vault walk leaves out below a vault root — one default list plus the
// vault's own `.baramignore` (issue 794).
//
// The default names live in `default-excluded-dirs.json`, the one source for the
// walkers (`collect_md_files`, `collect_all_files`, `search`), the file tree
// (`list_dir`), the snapshot scan and the frontend's watcher-event filter
// (`src/hooks/use-file-watcher.ts` imports the same file). The Rust watcher's own
// path filter in `watch_dir` does not read it yet: it matches absolute-path
// substrings, and `/build/` there would drop every event of a vault whose root is
// named `build` — issue 795.
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

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use std::path::{Component, Path, PathBuf};
use std::sync::LazyLock;

/// The per-vault override file, gitignore syntax, read from the vault root only.
pub const BARAMIGNORE: &str = ".baramignore";

/// Folder names the walk does not enter at any depth below a vault root, unless the
/// vault's `.baramignore` re-includes them (`!build/`).
pub static DEFAULT_EXCLUDED_DIRS: LazyLock<Vec<&'static str>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("default-excluded-dirs.json"))
        .expect("default-excluded-dirs.json is a JSON array of folder names")
});

/// Which entries below one vault root the walk leaves out. Built once per walk (or per
/// index build, kept by `LinkIndex` so a save is judged by the matcher its build used).
///
/// Paths are judged RELATIVE to `root`, component-wise — a vault whose root folder is
/// itself named `build` is walked; a `build` folder below it is not. A path that is not
/// under `root` as spelled is never excluded: there is nothing to judge it against.
///
/// `Default` excludes nothing: what an index that was never built holds.
#[derive(Debug, Clone, Default)]
pub struct VaultExclusion {
    root: PathBuf,
    matcher: Option<Gitignore>,
}

impl VaultExclusion {
    /// The default names, then `<root>/.baramignore` when there is one. Its lines come
    /// AFTER the defaults so that, gitignore-style, the last matching line wins and
    /// `!build/` brings `build` folders back. A missing file is the common case; an
    /// unreadable file or a bad line is logged and the rest still applies — the walk
    /// never fails over it.
    pub fn load(root: &Path) -> Self {
        let mut builder = defaults(root);
        let file = root.join(BARAMIGNORE);
        if let Some(err) = builder.add(&file) {
            let missing = err
                .io_error()
                .is_some_and(|e| e.kind() == std::io::ErrorKind::NotFound);
            if !missing {
                log::warn!("{BARAMIGNORE} in {}: {err}", root.display());
            }
        }
        let matcher = builder.build().unwrap_or_else(|err| {
            log::warn!("{BARAMIGNORE} in {} ignored: {err}", root.display());
            defaults(root).build().expect("the default names build")
        });
        Self {
            root: root.to_path_buf(),
            matcher: Some(matcher),
        }
    }

    /// Whether the walk leaves out `path`, an entry of a folder it already entered.
    /// Hidden names are the walkers' own rule and are not judged here.
    pub fn excludes_entry(&self, path: &Path, is_dir: bool) -> bool {
        let (Some(matcher), Ok(rel)) = (&self.matcher, path.strip_prefix(&self.root)) else {
            return false;
        };
        matcher.matched(rel, is_dir).is_ignore()
    }

    /// Whether the vault walk never reaches `path`: some component below the root is
    /// hidden, or the walk would leave out it or a folder above it. Judged top-down the
    /// way the walk descends, so a `!keep.md` line under an excluded folder does not let
    /// a save put back what the walk never sees (`matched_path_or_any_parents` would
    /// answer bottom-up and let it). What a single-file update asks — the save-time link
    /// index update, the task update and the CLI's path arguments.
    pub fn walk_skips(&self, path: &Path, is_dir: bool) -> bool {
        let (Some(matcher), Ok(rel)) = (&self.matcher, path.strip_prefix(&self.root)) else {
            return false;
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

#[cfg(test)]
thread_local! {
    /// Every folder the two `fs` walkers listed on this thread — what discovery costs,
    /// counted rather than timed. Per thread, so tests running side by side do not mix.
    static FOLDERS_READ: std::cell::RefCell<Vec<PathBuf>> = const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(test)]
pub(crate) fn note_folder_read(dir: &Path) {
    FOLDERS_READ.with(|r| r.borrow_mut().push(dir.to_path_buf()));
}

/// The folders listed so far on this thread, emptying the record.
#[cfg(test)]
pub(crate) fn take_folders_read() -> Vec<PathBuf> {
    FOLDERS_READ.with(|r| std::mem::take(&mut *r.borrow_mut()))
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
        let exclusion = VaultExclusion::load(root);
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

        let exclusion = VaultExclusion::load(&root);
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

        let exclusion = VaultExclusion::load(root);
        assert!(exclusion.walk_skips(&root.join("drafts/keep.md"), false));
        assert!(exclusion.walk_skips(&root.join("notes/.hidden/h.md"), false));
        assert!(!exclusion.walk_skips(&root.join("notes/a.md"), false));
        // Outside the root as spelled: nothing to judge it against.
        assert!(!exclusion.walk_skips(Path::new("/elsewhere/build/x.md"), false));
    }

    /// A `.baramignore` that cannot be read as lines leaves the defaults in force and the
    /// walk succeeds. 이것을 실패시키는 것: `builder.add` 의 오류에서 기본 목록을 버리는 것.
    #[tokio::test]
    async fn an_unreadable_baramignore_keeps_the_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir(root.join(BARAMIGNORE)).unwrap();
        write(root, "a.md", "a");
        write(root, "build/b.md", "b");

        let (md, _) = walked(root).await;
        assert_eq!(md, vec!["a.md"]);
    }
}
