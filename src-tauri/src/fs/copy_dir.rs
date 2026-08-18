//! §4.3 Recursive directory copy for external folder drops.
//!
//! `import_file` is a single-file copy, so dropping a folder from Finder always
//! rejected with `Is a directory`. This walks the source instead, mirroring the
//! containment discipline `extract_zip` established: every destination path is
//! checked against the canonicalized destination root BEFORE anything is
//! created, so no entry can write outside it.
//!
//! Symlinks are skipped rather than followed. Following them would let a source
//! tree escape itself (a link to `/`) and would make cycles possible, neither of
//! which a drag-and-drop gesture implies consent for.

use std::path::{Path, PathBuf};

use super::FsError;

/// Entries excluded from a folder copy — noise the user did not mean to bring
/// along. Mirrors the `extract_zip` filter.
const SKIP_ENTRIES: &[&str] = &[".DS_Store"];

/// Outcome of a recursive copy. `copied` counts files actually written;
/// `skipped_symlinks` counts entries passed over, so the caller can say so
/// instead of reporting a clean copy that quietly lost data.
#[derive(Debug, Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyDirReport {
    pub copied: usize,
    pub skipped_symlinks: usize,
}

/// Recursively copy `from` into `to`, creating `to` itself.
///
/// `to` must not exist yet — the caller resolves name conflicts by picking an
/// unused name, the same way file drops do. Refusing to write into an existing
/// directory keeps a folder drop from silently merging into unrelated content.
///
/// Returns `Ok(None)` when `from` is not a directory. That is not an error: it
/// is how the caller learns which of `import_file` / `import_dir` a dropped
/// path needed, and it has to come from here because the source lives OUTSIDE
/// the vault by design — every command that could inspect it from the frontend
/// (`list_dir`, `read_file`) is vault-confined and rejects it out of hand.
pub async fn copy_dir_all(from: &str, to: &str) -> Result<Option<CopyDirReport>, FsError> {
    let from = from.to_string();
    let to = to.to_string();

    tokio::task::spawn_blocking(move || {
        let source = Path::new(&from);
        if !source.exists() {
            return Err(FsError::NotFound(from.clone()));
        }
        if !source.is_dir() {
            return Ok(None);
        }

        let dest_root = Path::new(&to);
        if dest_root.exists() {
            return Err(FsError::ReadError(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                format!("Destination already exists: {to}"),
            )));
        }
        std::fs::create_dir_all(dest_root).map_err(FsError::ReadError)?;

        // Canonicalize AFTER creating the root: canonicalize requires existence,
        // and every later containment check is made against this resolved path.
        let canonical_dest = std::fs::canonicalize(dest_root).map_err(FsError::ReadError)?;

        let mut report = CopyDirReport::default();
        walk(source, &canonical_dest, &canonical_dest, &mut report)?;
        Ok(Some(report))
    })
    .await
    .map_err(|e| FsError::ReadError(std::io::Error::other(e.to_string())))?
}

/// Copy one directory level, recursing into real subdirectories.
///
/// `dest_root` never changes across the recursion — it is the boundary every
/// entry is checked against, so a nested entry cannot climb out.
fn walk(
    src_dir: &Path,
    dest_dir: &Path,
    dest_root: &Path,
    report: &mut CopyDirReport,
) -> Result<(), FsError> {
    let entries = std::fs::read_dir(src_dir).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            FsError::PermissionDenied(src_dir.to_string_lossy().into_owned())
        } else {
            FsError::ReadError(e)
        }
    })?;

    for entry in entries {
        let entry = entry.map_err(FsError::ReadError)?;
        let name = entry.file_name();

        if SKIP_ENTRIES.contains(&name.to_string_lossy().as_ref()) {
            continue;
        }

        // symlink_metadata does NOT follow the link, which is the whole point:
        // `is_dir()` on followed metadata would recurse through it.
        let meta = entry.metadata().map_err(FsError::ReadError)?;
        if meta.file_type().is_symlink() {
            report.skipped_symlinks += 1;
            continue;
        }

        let target = match contained_join(dest_dir, &name, dest_root) {
            Some(p) => p,
            None => {
                return Err(FsError::ReadError(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!(
                        "Entry escapes destination directory: {}",
                        name.to_string_lossy()
                    ),
                )))
            }
        };

        if meta.is_dir() {
            std::fs::create_dir_all(&target).map_err(FsError::ReadError)?;
            walk(&entry.path(), &target, dest_root, report)?;
        } else {
            std::fs::copy(entry.path(), &target).map_err(FsError::ReadError)?;
            report.copied += 1;
        }
    }

    Ok(())
}

/// Join `name` onto `dir` and return it only if the result stays under `root`.
///
/// Resolves `..` by component without touching the filesystem, the way
/// `extract_zip` does, so the check happens before anything is created.
fn contained_join(dir: &Path, name: &std::ffi::OsStr, root: &Path) -> Option<PathBuf> {
    let mut normalized = dir.to_path_buf();
    for component in Path::new(name).components() {
        match component {
            std::path::Component::Normal(c) => normalized.push(c),
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            std::path::Component::CurDir => {}
            _ => return None,
        }
    }
    normalized.starts_with(root).then_some(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "baram-copy-dir-{tag}-{}",
            uuid::Uuid::new_v4().as_simple()
        ));
        std::fs::create_dir_all(&base).unwrap();
        base
    }

    fn write(path: &Path, body: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    #[tokio::test]
    async fn copies_nested_files_and_directories() {
        let base = tmpdir("nested");
        let src = base.join("notes");
        write(&src.join("a.md"), "a");
        write(&src.join("img/p.png"), "png");
        write(&src.join("sub/deep/b.md"), "b");
        let dest = base.join("vault/notes");

        let report = copy_dir_all(src.to_str().unwrap(), dest.to_str().unwrap())
            .await
            .unwrap()
            .expect("a directory source yields a report");

        assert_eq!(report.copied, 3);
        assert_eq!(std::fs::read_to_string(dest.join("a.md")).unwrap(), "a");
        assert_eq!(
            std::fs::read_to_string(dest.join("img/p.png")).unwrap(),
            "png"
        );
        assert_eq!(
            std::fs::read_to_string(dest.join("sub/deep/b.md")).unwrap(),
            "b"
        );
    }

    #[tokio::test]
    async fn skips_symlinks_instead_of_following_them() {
        let base = tmpdir("symlink");
        let outside = base.join("outside");
        write(&outside.join("secret.md"), "secret");
        let src = base.join("notes");
        write(&src.join("real.md"), "real");

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, src.join("link-to-outside")).unwrap();
            std::os::unix::fs::symlink(outside.join("secret.md"), src.join("link.md")).unwrap();
        }

        let dest = base.join("vault/notes");
        let report = copy_dir_all(src.to_str().unwrap(), dest.to_str().unwrap())
            .await
            .unwrap()
            .expect("a directory source yields a report");

        assert_eq!(report.copied, 1, "only the real file is copied");
        assert!(dest.join("real.md").exists());
        #[cfg(unix)]
        {
            assert_eq!(report.skipped_symlinks, 2);
            assert!(!dest.join("link-to-outside").exists());
            assert!(!dest.join("link.md").exists());
        }
    }

    #[tokio::test]
    async fn a_symlink_cycle_terminates() {
        // Following links would make this recurse forever; skipping them is what
        // makes the copy total. Without the symlink guard this test hangs.
        let base = tmpdir("cycle");
        let src = base.join("notes");
        write(&src.join("a.md"), "a");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&src, src.join("self")).unwrap();

        let dest = base.join("vault/notes");
        let report = copy_dir_all(src.to_str().unwrap(), dest.to_str().unwrap())
            .await
            .unwrap()
            .expect("a directory source yields a report");

        assert_eq!(report.copied, 1);
    }

    #[tokio::test]
    async fn refuses_an_existing_destination_rather_than_merging() {
        let base = tmpdir("exists");
        let src = base.join("notes");
        write(&src.join("a.md"), "a");
        let dest = base.join("vault/notes");
        write(&dest.join("keep.md"), "keep");

        let err = copy_dir_all(src.to_str().unwrap(), dest.to_str().unwrap())
            .await
            .unwrap_err();

        assert!(
            err.to_string().contains("Destination already exists"),
            "got: {err}"
        );
        assert_eq!(
            std::fs::read_to_string(dest.join("keep.md")).unwrap(),
            "keep",
            "existing content is untouched"
        );
    }

    #[tokio::test]
    async fn reports_a_file_source_as_none_rather_than_an_error() {
        // This is the discriminator the frontend relies on: the dropped path
        // lives outside the vault, so no vault-confined command can tell it
        // apart from a directory. `None` says "that was a file" without
        // making the caller match on an error string.
        let base = tmpdir("notdir");
        let file = base.join("a.md");
        write(&file, "a");
        let dest = base.join("vault/a.md");

        let outcome = copy_dir_all(file.to_str().unwrap(), dest.to_str().unwrap())
            .await
            .unwrap();

        assert!(outcome.is_none());
        assert!(!dest.exists(), "nothing is created for a file source");
    }

    #[tokio::test]
    async fn reports_a_missing_source() {
        let base = tmpdir("missing");
        let err = copy_dir_all(
            base.join("nope").to_str().unwrap(),
            base.join("dest").to_str().unwrap(),
        )
        .await
        .unwrap_err();

        assert!(matches!(err, FsError::NotFound(_)), "got: {err}");
    }

    #[tokio::test]
    async fn skips_ds_store_noise() {
        let base = tmpdir("dsstore");
        let src = base.join("notes");
        write(&src.join("a.md"), "a");
        write(&src.join(".DS_Store"), "junk");
        write(&src.join("sub/.DS_Store"), "junk");
        let dest = base.join("vault/notes");

        let report = copy_dir_all(src.to_str().unwrap(), dest.to_str().unwrap())
            .await
            .unwrap()
            .expect("a directory source yields a report");

        assert_eq!(report.copied, 1);
        assert!(!dest.join(".DS_Store").exists());
        assert!(!dest.join("sub/.DS_Store").exists());
    }

    #[test]
    fn contained_join_rejects_an_escaping_name() {
        let root = Path::new("/vault/notes");
        assert!(contained_join(root, std::ffi::OsStr::new("a.md"), root).is_some());
        // A `..` entry name would climb out of the destination root.
        assert!(contained_join(root, std::ffi::OsStr::new(".."), root).is_none());
    }

    #[test]
    fn contained_join_rejects_climbing_out_of_a_subdirectory() {
        let root = Path::new("/vault/notes");
        let sub = Path::new("/vault/notes/sub");
        // Stays inside: sub/.. == the root itself.
        assert_eq!(
            contained_join(sub, std::ffi::OsStr::new(".."), root),
            Some(PathBuf::from("/vault/notes"))
        );
        // Escapes: two levels up from sub leaves the root.
        assert!(contained_join(sub, std::ffi::OsStr::new("../.."), root).is_none());
    }
}
