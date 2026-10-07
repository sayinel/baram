// §3.6 One pass over a vault (issue 796): every file below a folder, hidden entries and
// what `VaultExclusion` leaves out skipped, markdown told apart from the rest — run as a
// single blocking task instead of one async round trip per entry.
//
// The walk is `ignore::WalkBuilder` with all of its own filters off
// (`standard_filters(false)`: no hidden, `.ignore`, `.gitignore`, global or parent
// files) and links not followed; what to skip is decided by `filter_entry` alone, with
// the rule the old per-entry `tokio::fs` walkers applied:
//
// - an entry whose name starts with `.` is skipped, the start folder itself never;
// - an entry `VaultExclusion::excludes_entry` leaves out is skipped, a folder without
//   being entered;
// - a symlink is neither file nor folder: skipped, not followed;
// - a folder that cannot be listed ends the walk with `FsError::ReadDir` naming it —
//   the `ignore` walker reports such an error and carries on, so the first one is
//   returned here rather than a partial list that reads as success; an error about an
//   entry that is not a folder skips that entry, as before (`folder_error`).
//
// `old_walk_tests::the_walk_finds_what_the_per_entry_walkers_found` keeps the old
// walkers as an oracle and compares lists, order included.

use super::{FsError, VaultExclusion};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// What one walk found, each list in walk order (depth first, entries in the order the
/// file system lists them). Only the lists the walk was asked for (`Collect`) are filled;
/// with `Collect::Both`, `all` holds the markdown too.
#[derive(Debug, Default)]
pub struct VaultFiles {
    pub markdown: Vec<PathBuf>,
    pub all: Vec<PathBuf>,
}

/// Which lists a walk keeps. A caller that wants markdown does not hold a path for every
/// asset of a media-heavy vault, and one that wants every file does not hold the
/// markdown twice; only the index build, which registers both, asks for both.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Collect {
    Markdown,
    Files,
    Both,
}

/// The markdown rule a note is read by: `.md` or `.markdown`, case as written.
fn is_markdown(name: &str) -> bool {
    name.ends_with(".md") || name.ends_with(".markdown")
}

/// Sets its flag when dropped. `walk_vault` holds one while it waits for the blocking
/// walk, so a caller that stops waiting — a build dropped mid-walk — stops the walk at
/// its next step instead of leaving it to run the tree out behind a newer build.
struct CancelOnDrop(Arc<AtomicBool>);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

/// Every file below `root` in one blocking pass, keeping the lists `collect` names.
/// `root` may be a folder below the vault root; `exclusion` judges against the vault root.
pub async fn walk_vault(
    root: &Path,
    exclusion: &VaultExclusion,
    collect: Collect,
) -> Result<VaultFiles, FsError> {
    let (root, exclusion) = (root.to_path_buf(), exclusion.clone());
    let cancelled = Arc::new(AtomicBool::new(false));
    let _cancel = CancelOnDrop(cancelled.clone());
    #[cfg(test)]
    let reads = super::exclusion::folder_reads_handle();
    tokio::task::spawn_blocking(move || {
        #[cfg(test)]
        let _scope = super::exclusion::record_into(reads);
        walk_blocking(&root, &exclusion, collect, &cancelled)
    })
    .await
    .map_err(|e| FsError::ReadError(std::io::Error::other(e.to_string())))?
}

fn walk_blocking(
    root: &Path,
    exclusion: &VaultExclusion,
    collect: Collect,
    cancelled: &AtomicBool,
) -> Result<VaultFiles, FsError> {
    // The start is opened through a link, as the old walk's `read_dir` opened it (a vault
    // registered as a symlink is walked); a start that is not a folder fails the same way.
    let unreadable = |source: std::io::Error| FsError::ReadDir {
        path: root.to_path_buf(),
        source,
    };
    if !std::fs::metadata(root).map_err(unreadable)?.is_dir() {
        return Err(unreadable(std::io::Error::other("not a directory")));
    }
    let filter = exclusion.clone();
    let walker = ignore::WalkBuilder::new(root)
        .standard_filters(false)
        .follow_links(false)
        .filter_entry(move |entry| {
            if entry.file_name().to_string_lossy().starts_with('.') {
                return false;
            }
            let is_dir = entry.file_type().is_some_and(|t| t.is_dir());
            !filter.excludes_entry(entry.path(), is_dir)
        })
        .build();
    let mut found = VaultFiles::default();
    for entry in walker {
        if cancelled.load(Ordering::Relaxed) {
            return Err(FsError::ReadError(std::io::Error::other("walk cancelled")));
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(e) => match folder_error(e, root) {
                Some(failed) => return Err(failed),
                None => continue,
            },
        };
        let Some(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            #[cfg(test)]
            super::exclusion::note_folder_read(entry.path());
            continue;
        }
        if !kind.is_file() {
            continue;
        }
        let path = entry.into_path();
        let markdown = path
            .file_name()
            .is_some_and(|n| is_markdown(&n.to_string_lossy()));
        match collect {
            Collect::Markdown if markdown => found.markdown.push(path),
            Collect::Markdown => {}
            Collect::Files => found.all.push(path),
            Collect::Both => {
                if markdown {
                    found.markdown.push(path.clone());
                }
                found.all.push(path);
            }
        }
    }
    Ok(found)
}

/// What a walk error means. A folder that cannot be listed ends the walk with
/// `FsError::ReadDir` naming it, as the old walk's failed `read_dir` did. An error about
/// anything that is not a folder now — an entry that vanished between the listing and
/// its file type (an atomic save's temp file), or one whose type could not be read — is
/// `None`: the entry is skipped, as the old walk skipped an entry whose metadata failed.
fn folder_error(err: ignore::Error, root: &Path) -> Option<FsError> {
    let mut path = root.to_path_buf();
    let mut err = err;
    let source = loop {
        match err {
            ignore::Error::WithDepth { err: inner, .. } => err = *inner,
            ignore::Error::WithPath {
                path: at,
                err: inner,
            } => {
                path = at;
                err = *inner;
            }
            ignore::Error::Io(source) => break source,
            other => break std::io::Error::other(other.to_string()),
        }
    };
    std::fs::symlink_metadata(&path)
        .is_ok_and(|m| m.is_dir())
        .then_some(FsError::ReadDir { path, source })
}

/// §278 Every file under `root`, skipping hidden entries and what `exclusion` leaves out
/// (issue 794: the default list and the vault's `.baramignore`). `root` may be a folder
/// below the vault root; `exclusion` judges against the vault root.
///
/// The link index scans only markdown for outgoing links, but a wikilink may *point* at
/// any file — `[[Paper.pdf]]`. Those targets have to be registered somewhere or the link
/// shows up as a dangling node in the graph and produces no backlink.
///
/// ‼️ No extension filter, deliberately. Enumerating the viewable types here would put a
/// second copy of a list that already lives in the frontend (`utils/file-type.ts`), and a
/// rule kept in two places is one that eventually only gets updated in one — the 1%
/// quantisation defect in the zoom path was exactly that. A target map entry for a file
/// nobody links to costs a string; it can only ever be reached by someone writing that
/// exact name.
pub async fn collect_all_files(
    root: &Path,
    exclusion: &VaultExclusion,
    files: &mut Vec<PathBuf>,
) -> Result<(), FsError> {
    files.extend(walk_vault(root, exclusion, Collect::Files).await?.all);
    Ok(())
}

/// Every `.md` / `.markdown` file under `root` — the same walk as `collect_all_files`,
/// keeping the markdown only.
pub async fn collect_md_files(
    root: &Path,
    exclusion: &VaultExclusion,
    files: &mut Vec<PathBuf>,
) -> Result<(), FsError> {
    files.extend(
        walk_vault(root, exclusion, Collect::Markdown)
            .await?
            .markdown,
    );
    Ok(())
}

#[cfg(test)]
mod old_walk_tests {
    use super::*;

    // The per-entry `tokio::fs` walkers this module replaced, kept as the oracle.
    async fn old_collect_all_files(
        root: &Path,
        exclusion: &VaultExclusion,
        files: &mut Vec<PathBuf>,
    ) -> Result<(), FsError> {
        let unreadable = |source: std::io::Error| FsError::ReadDir {
            path: root.to_path_buf(),
            source,
        };
        let mut read_dir = tokio::fs::read_dir(root).await.map_err(unreadable)?;
        while let Some(entry) = read_dir.next_entry().await.map_err(unreadable)? {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let metadata = match entry.metadata().await {
                Ok(m) => m,
                Err(_) => continue,
            };
            let path = entry.path();
            if exclusion.excludes_entry(&path, metadata.is_dir()) {
                continue;
            }
            if metadata.is_dir() {
                Box::pin(old_collect_all_files(&path, exclusion, files)).await?;
            } else if metadata.is_file() {
                files.push(path);
            }
        }
        Ok(())
    }

    async fn old_collect_md_files(
        root: &Path,
        exclusion: &VaultExclusion,
        files: &mut Vec<PathBuf>,
    ) -> Result<(), FsError> {
        let unreadable = |source: std::io::Error| FsError::ReadDir {
            path: root.to_path_buf(),
            source,
        };
        let mut read_dir = tokio::fs::read_dir(root).await.map_err(unreadable)?;
        while let Some(entry) = read_dir.next_entry().await.map_err(unreadable)? {
            let name = entry.file_name().to_string_lossy().to_string();

            // Skip hidden files/dirs
            if name.starts_with('.') {
                continue;
            }

            let metadata = match entry.metadata().await {
                Ok(m) => m,
                Err(_) => continue,
            };

            let path = entry.path();
            if exclusion.excludes_entry(&path, metadata.is_dir()) {
                continue;
            }
            if metadata.is_dir() {
                Box::pin(old_collect_md_files(&path, exclusion, files)).await?;
            } else if metadata.is_file() && (name.ends_with(".md") || name.ends_with(".markdown")) {
                files.push(path);
            }
        }
        Ok(())
    }

    fn write(root: &Path, rel: &str, body: &str) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    /// A vault with every kind of entry the rule tells apart.
    fn fixture(root: &Path) {
        for rel in [
            "a.md",
            "b.markdown",
            "C.MD",
            "paper.pdf",
            "notes/d.md",
            "notes/deep/e.md",
            "notes/deep/deeper/f.txt",
            "notes/.draft.md",
            ".hidden/g.md",
            "build/h.md",
            "notes/build/i.md",
            "drafts/j.md",
            "logs/k.log",
            "logs/l.md",
        ] {
            write(root, rel, rel);
        }
        std::fs::create_dir_all(root.join("empty/inner")).unwrap();
        write(root, crate::fs::BARAMIGNORE, "drafts/\n*.log\n");
        #[cfg(unix)]
        {
            let outside = root.join("notes/deep");
            std::os::unix::fs::symlink(&outside, root.join("linked-dir")).unwrap();
            std::os::unix::fs::symlink(root.join("a.md"), root.join("linked.md")).unwrap();
        }
    }

    async fn both(start: &Path, exclusion: &VaultExclusion) -> [(Vec<PathBuf>, Vec<PathBuf>); 2] {
        let new = walk_vault(start, exclusion, Collect::Both).await.unwrap();
        let (mut md, mut all) = (Vec::new(), Vec::new());
        old_collect_md_files(start, exclusion, &mut md)
            .await
            .unwrap();
        old_collect_all_files(start, exclusion, &mut all)
            .await
            .unwrap();
        [(new.markdown, new.all), (md, all)]
    }

    /// The one-pass walk finds what the two per-entry walkers found, in the same order:
    /// from the root, from a folder below it, and through a root that is a symlink.
    /// 이것을 실패시키는 것: `filter_entry` 의 숨김 검사를 지우는 것, `excludes_entry` 를
    /// 지우는 것, `follow_links(true)`, 마크다운 규칙을 대소문자 무시로 바꾸는 것 (각각 확인).
    #[tokio::test]
    async fn the_walk_finds_what_the_per_entry_walkers_found() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("vault");
        fixture(&root);
        let exclusion = VaultExclusion::load(&root).unwrap();
        let [new, old] = both(&root, &exclusion).await;
        assert_eq!(new, old);
        assert!(new.0.len() >= 4 && new.1.len() > new.0.len(), "{new:?}");

        let [new, old] = both(&root.join("notes"), &exclusion).await;
        assert_eq!(new, old);

        #[cfg(unix)]
        {
            let alias = dir.path().join("alias");
            std::os::unix::fs::symlink(&root, &alias).unwrap();
            let exclusion = VaultExclusion::load(&alias).unwrap();
            let [new, old] = both(&alias, &exclusion).await;
            assert_eq!(new, old);
            assert!(new.0.iter().all(|p| p.starts_with(&alias)), "{new:?}");
        }
    }

    /// A start that is not a folder fails, as the old walk's `read_dir` failed.
    /// 이것을 실패시키는 것: 시작점이 폴더인지 보는 검사를 지우는 것 — 파일 하나가 결과로 나온다.
    #[tokio::test]
    async fn a_start_that_is_not_a_folder_fails() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.md", "a");
        let exclusion = VaultExclusion::load(dir.path()).unwrap();
        let file = dir.path().join("a.md");
        assert!(matches!(
            walk_vault(&file, &exclusion, Collect::Both).await,
            Err(FsError::ReadDir { ref path, .. }) if *path == file
        ));
        let mut old = Vec::new();
        assert!(old_collect_md_files(&file, &exclusion, &mut old)
            .await
            .is_err());
    }

    /// One index build lists each folder once — the markdown and every file come out of
    /// a single walk. 이것을 실패시키는 것: build 가 `collect_md_files` 와 `collect_all_files`
    /// 로 두 번 걷던 것을 되살리는 것 — 폴더마다 2회가 된다.
    #[tokio::test]
    async fn an_index_build_lists_each_folder_once() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("vault");
        fixture(&root);
        crate::fs::take_folders_read();
        let mut index = crate::index::LinkIndex::new();
        index.build(&root.to_string_lossy()).await.unwrap();
        let mut read = crate::fs::take_folders_read();
        let listed = read.len();
        read.sort();
        read.dedup();
        assert_eq!(listed, read.len(), "a folder was listed twice: {read:?}");
        assert!(
            read.contains(&root) && read.contains(&root.join("notes/deep")),
            "{read:?}"
        );
    }

    /// A walk keeps only the lists it was asked for: a markdown walk over a folder of
    /// many assets holds no asset path, and a files walk holds each markdown path once.
    /// 이것을 실패시키는 것: `walk_blocking` 이 `collect` 와 무관하게 두 목록을 다 채우는 것.
    #[tokio::test]
    async fn a_walk_keeps_only_the_lists_it_was_asked_for() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "note.md", "n");
        for i in 0..500 {
            write(dir.path(), &format!("assets/{i}.png"), "");
        }
        let exclusion = VaultExclusion::load(dir.path()).unwrap();
        let markdown = walk_vault(dir.path(), &exclusion, Collect::Markdown)
            .await
            .unwrap();
        assert_eq!((markdown.markdown.len(), markdown.all.len()), (1, 0));
        let files = walk_vault(dir.path(), &exclusion, Collect::Files)
            .await
            .unwrap();
        assert_eq!((files.markdown.len(), files.all.len()), (0, 501));
        let both = walk_vault(dir.path(), &exclusion, Collect::Both)
            .await
            .unwrap();
        assert_eq!((both.markdown.len(), both.all.len()), (1, 501));
    }

    /// An error about an entry that is not a folder — gone between the listing and its
    /// file type — skips it; one about a folder that cannot be listed names that folder.
    /// 이것을 실패시키는 것: `folder_error` 가 모든 오류를 `ReadDir` 로 돌려주는 것(첫 단언),
    /// 또는 아무것도 돌려주지 않는 것(둘째 단언 — 읽을 수 없는 폴더 시험도 함께 빨개진다).
    #[test]
    fn an_entry_error_skips_the_entry_and_a_folder_error_names_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let wrapped = |path: PathBuf, kind: std::io::ErrorKind| ignore::Error::WithDepth {
            depth: 1,
            err: Box::new(ignore::Error::WithPath {
                path,
                err: Box::new(ignore::Error::Io(std::io::Error::from(kind))),
            }),
        };
        let vanished = dir.path().join("note.md.tmp");
        assert!(
            folder_error(wrapped(vanished, std::io::ErrorKind::NotFound), dir.path()).is_none()
        );
        let folder = dir.path().join("locked");
        std::fs::create_dir(&folder).unwrap();
        match folder_error(
            wrapped(folder.clone(), std::io::ErrorKind::PermissionDenied),
            dir.path(),
        ) {
            Some(FsError::ReadDir { path, .. }) => assert_eq!(path, folder),
            other => panic!("expected ReadDir for {folder:?}, got {other:?}"),
        }
    }

    /// A walk whose caller stopped waiting stops at its next step: nothing listed, an
    /// error rather than a partial list. And the guard `walk_vault` holds sets the flag
    /// when it drops. 이것을 실패시키는 것: 반복마다 하는 `cancelled` 검사를 지우는 것(폴더가
    /// 읽히고 `Ok` 가 나온다), `CancelOnDrop::drop` 을 비우는 것(둘째 단언).
    #[test]
    fn a_cancelled_walk_stops_at_its_next_step() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a/b/c.md", "c");
        let exclusion = VaultExclusion::load(dir.path()).unwrap();
        crate::fs::take_folders_read();
        let cancelled = AtomicBool::new(true);
        let walked = walk_blocking(dir.path(), &exclusion, Collect::Both, &cancelled);
        assert!(walked.is_err());
        assert!(crate::fs::take_folders_read().is_empty());

        let flag = Arc::new(AtomicBool::new(false));
        drop(CancelOnDrop(flag.clone()));
        assert!(flag.load(Ordering::Relaxed));
    }
}
