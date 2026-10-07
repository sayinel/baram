// §3.6 One pass over a vault (issue 796): every file below a folder, hidden entries and
// what `VaultExclusion` leaves out skipped, markdown told apart from the rest — run as a
// single blocking task instead of one async round trip per entry.
//
// The walk is the old per-entry `tokio::fs` walk's own loop on `std::fs`, iterative, in
// the same order (depth first, a folder entered where it is listed). Each failure is
// judged where it happens, never by looking at the path again afterwards:
//
// - an entry whose name starts with `.` is skipped, the start folder itself never;
// - an entry whose metadata cannot be read (it vanished after the listing) is skipped;
// - an entry `VaultExclusion::excludes_entry` leaves out is skipped, a folder without
//   being entered;
// - a symlink is neither file nor folder (`DirEntry::metadata` does not follow it):
//   skipped, not followed;
// - a folder that cannot be opened or listed — the start included, also when the start
//   is a link — ends the walk with `FsError::ReadDir` naming it, never a partial list
//   that reads as success.
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
    let mut found = VaultFiles::default();
    // The folders being listed, innermost last: a folder is opened where it is listed and
    // its entries come before its later siblings', the old recursion's order. The start
    // is opened on the first step, so one cancellation check covers every step.
    let mut start = Some(root);
    let mut open: Vec<(PathBuf, std::fs::ReadDir)> = Vec::new();
    loop {
        if cancelled.load(Ordering::Relaxed) {
            return Err(FsError::ReadError(std::io::Error::other("walk cancelled")));
        }
        if let Some(root) = start.take() {
            open.push(open_folder(root)?);
            continue;
        }
        let Some((folder, entries)) = open.last_mut() else {
            break;
        };
        let Some(entry) = entries.next() else {
            open.pop();
            continue;
        };
        let entry = entry.map_err(|source| FsError::ReadDir {
            path: folder.clone(),
            source,
        })?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let Some(kind) = entry_kind(entry.metadata()) else {
            continue;
        };
        let path = entry.path();
        if exclusion.excludes_entry(&path, kind == Kind::Folder) {
            continue;
        }
        match kind {
            Kind::Folder => open.push(open_folder(&path)?),
            Kind::File => {
                let markdown = is_markdown(&name);
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
            Kind::Other => {}
        }
    }
    Ok(found)
}

/// `folder` opened for listing — through a link, as `read_dir` opens one — or
/// `FsError::ReadDir` naming it.
fn open_folder(folder: &Path) -> Result<(PathBuf, std::fs::ReadDir), FsError> {
    #[cfg(test)]
    super::exclusion::note_folder_read(folder);
    std::fs::read_dir(folder)
        .map(|entries| (folder.to_path_buf(), entries))
        .map_err(|source| FsError::ReadDir {
            path: folder.to_path_buf(),
            source,
        })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Folder,
    File,
    /// A symlink, or anything else that is neither.
    Other,
}

/// What a listed entry is, from its own (unfollowed) metadata; `None` when that cannot
/// be read — the entry is skipped, as the old walk skipped it.
fn entry_kind(metadata: std::io::Result<std::fs::Metadata>) -> Option<Kind> {
    let metadata = metadata.ok()?;
    Some(if metadata.is_dir() {
        Kind::Folder
    } else if metadata.is_file() {
        Kind::File
    } else {
        Kind::Other
    })
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

    /// An entry whose metadata cannot be read is skipped, not an error.
    /// 이것을 실패시키는 것: `entry_kind` 가 읽지 못한 metadata 에 `None` 이 아닌 종류로
    /// 답하는 것.
    #[test]
    fn an_entry_whose_metadata_cannot_be_read_is_skipped() {
        let vanished = std::fs::symlink_metadata("/nonexistent/vanished.md.tmp");
        assert!(vanished.is_err());
        assert_eq!(entry_kind(vanished), None);
        let here = std::fs::symlink_metadata(".").unwrap();
        assert_eq!(entry_kind(Ok(here)), Some(Kind::Folder));
    }

    /// A start that is a link to a folder that cannot be listed is an error naming the
    /// start — not an empty list that would publish an empty index.
    /// 이것을 실패시키는 것: 시작 폴더를 열지 못한 오류를 빈 결과로 바꾸는 것.
    #[cfg(unix)]
    #[test]
    fn a_linked_start_whose_folder_cannot_be_listed_is_an_error() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target");
        write(&target, "a.md", "a");
        let alias = dir.path().join("alias");
        std::os::unix::fs::symlink(&target, &alias).unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o000)).unwrap();
        if std::fs::read_dir(&target).is_ok() {
            std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755)).unwrap();
            eprintln!("skipped: this user can read a 000 directory");
            return;
        }
        let exclusion = VaultExclusion::default();
        let walked = walk_blocking(&alias, &exclusion, Collect::Both, &AtomicBool::new(false));
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755)).unwrap();
        match walked {
            Err(FsError::ReadDir { path, .. }) => assert_eq!(path, alias),
            other => panic!("expected ReadDir for {alias:?}, got {other:?}"),
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
