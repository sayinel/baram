// issue 545 — the images a Pandoc export may read, staged by the backend.
//
// docx and epub embed images, so pandoc opens the files a document names. The
// frontend pass (src/utils/export/export-markdown-images.ts) decides the
// user-facing half: it keeps the diagrams the export rasterized, turns a
// relative image that stays inside the document's context — on the string —
// into a request `{ name, source }` with the destination rewritten to
// `baram-asset:<name>`, and reduces everything else to alt text. This module
// is the boundary, and it trusts none of that: every request is resolved
// against the document's directory, canonicalized, and required to lie under
// the canonical root of the vault or folder context that owns the document
// (`ContextManager::owning_directory_root`); the file is copied into the
// export's temporary directory through one checked handle. For the images a
// document names, pandoc then sees only paths this module bound — a copy, or
// for a broken link a path under the temporary directory that does not
// exist, so it puts the alt text in place — never a path the document wrote.
//
// What this module does NOT guard: the markdown string itself. It is the
// webview's, and a webview that has been compromised could write an absolute
// path straight into it; nothing here parses that string, on purpose — a
// second markdown parser would only disagree with pandoc's. Closing that
// channel means running pandoc with `--sandbox`, which also stops it reading
// the copies staged here, so assets would have to travel another way. That
// is tracked as a follow-up; this module's boundary is the document's.
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::pandoc::is_safe_asset_name;
use super::ExportError;

/// issue 545 — an image the document refers to by a RELATIVE path. The
/// frontend has already rewritten the destination to `baram-asset:NAME` and
/// asks the backend to resolve `source` against the document's directory and
/// stage the file under `name` — but only if the canonical result lies inside
/// a registered context (the vault boundary every file read passes). pandoc
/// therefore never sees a path the document wrote, only the staged copy.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PandocImageRequest {
    pub name: String,
    pub source: String,
}

/// Largest image the export will embed — a guard against a request that
/// names a device or a multi-gigabyte file, not a format limit.
const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;

/// Where `source`, written relative to a document in `document_dir`, points
/// BEFORE the boundary check: percent-decoded (pandoc decodes a local image
/// destination the same way), refused when it is not relative after all — a
/// rooted path, a Windows prefix (`C:`, `\\server`) — and joined under the
/// document's directory. What the join yields is still only a candidate; the
/// caller canonicalizes it and asks the vault boundary.
pub fn resolve_image_candidate(document_dir: &Path, source: &str) -> Result<PathBuf, ExportError> {
    let decoded = percent_encoding::percent_decode_str(source).decode_utf8_lossy();
    let relative = Path::new(decoded.as_ref());
    if decoded.is_empty()
        || relative.is_absolute()
        || relative.has_root()
        || relative
            .components()
            .any(|c| matches!(c, std::path::Component::Prefix(_)))
    {
        return Err(ExportError::ImageRefused(format!(
            "{source} is not a path relative to the document"
        )));
    }
    Ok(document_dir.join(relative))
}

/// Most images one export will stage, and the most bytes they may add up to —
/// a note that repeats one large image a few hundred times must not turn an
/// export into a multi-gigabyte allocation.
const MAX_IMAGE_COUNT: usize = 256;
const MAX_TOTAL_IMAGE_BYTES: u64 = 256 * 1024 * 1024;

/// Everything `run_pandoc` needs to stage a document's images.
pub struct ImageStaging<'a> {
    /// The directory the document's relative paths start from.
    pub document_dir: &'a Path,
    /// The canonical root of the context that owns the document.
    pub root: &'a Path,
    pub requests: &'a [PandocImageRequest],
}

/// Stage every requested image into `tmp_dir` and return, for EVERY request,
/// the absolute path its `baram-asset:<name>` placeholder is bound to: a copy
/// of the file when it is a readable regular file under `root`, and otherwise
/// — a broken link: missing, a directory, a FIFO, unreadable — a path under
/// `tmp_dir/missing/` that is never created, so pandoc resolves an absolute
/// path that does not exist and puts the alt text in its place, rather than a
/// bare name it would look up in its working directory. A typo in one image
/// must not fail the export.
///
/// What DOES fail the export, naming the source: a path that resolves outside
/// `root` (a symlink inside the vault pointing out, a spelling the frontend's
/// string check never imagined), a file whose identity changed between check
/// and read, one over the size cap, more than `MAX_IMAGE_COUNT` requests or
/// more than `MAX_TOTAL_IMAGE_BYTES` in all. Those are boundary questions,
/// and an output with such an image silently missing — or, worse, present —
/// is not an answer.
pub fn stage_images(
    tmp_dir: &Path,
    staging: &ImageStaging<'_>,
) -> Result<HashMap<String, String>, ExportError> {
    let ImageStaging {
        document_dir,
        root,
        requests,
    } = staging;
    let mut bound = HashMap::with_capacity(requests.len());
    if requests.is_empty() {
        return Ok(bound);
    }
    if requests.len() > MAX_IMAGE_COUNT {
        return Err(ExportError::ImageRefused(format!(
            "the document refers to more than {MAX_IMAGE_COUNT} images"
        )));
    }
    if !document_dir.is_absolute() || !root.is_absolute() {
        return Err(ExportError::ImageRefused(
            "the document's location is not known, so its relative image paths cannot be resolved"
                .to_string(),
        ));
    }
    let refused = |source: &str, why: String| ExportError::ImageRefused(format!("{source}: {why}"));
    let missing_dir = tmp_dir.join("missing");
    let mut total: u64 = 0;
    for req in requests.iter() {
        if !is_safe_asset_name(&req.name) {
            return Err(ExportError::TempFileError(format!(
                "Unsafe asset name: {}",
                req.name
            )));
        }
        let candidate = resolve_image_candidate(document_dir, &req.source)?;
        let Ok(canonical) = std::fs::canonicalize(&candidate) else {
            // Not there (or a component that is not a directory): a broken link.
            bound.insert(req.name.clone(), unbound_path(&missing_dir, &req.name));
            continue;
        };
        if !canonical.starts_with(root) {
            return Err(refused(
                &req.source,
                "outside the document's context".to_string(),
            ));
        }
        let dest = tmp_dir.join(&req.name);
        // What one more file may add: its own cap, or what is left of the
        // total — so the directory never holds more than the total.
        let budget = MAX_IMAGE_BYTES.min(MAX_TOTAL_IMAGE_BYTES - total);
        match copy_regular_file(&canonical, &dest, budget)
            .map_err(|why| refused(&req.source, why))?
        {
            Some(len) => {
                total += len;
                bound.insert(req.name.clone(), dest.to_string_lossy().to_string());
            }
            None => {
                bound.insert(req.name.clone(), unbound_path(&missing_dir, &req.name));
            }
        }
    }
    Ok(bound)
}

/// An absolute path that does not exist, for a placeholder pandoc must not
/// resolve as a bare name.
fn unbound_path(missing_dir: &Path, name: &str) -> String {
    missing_dir.join(name).to_string_lossy().to_string()
}

/// `O_NONBLOCK` for the platforms Baram ships on: opening a FIFO for reading
/// otherwise blocks until a writer appears, and a FIFO is one `mkfifo` away
/// inside any vault. Reading a regular file with it is unaffected.
#[cfg(any(target_os = "macos", target_os = "ios"))]
const O_NONBLOCK: i32 = 0x0004;
#[cfg(all(unix, not(any(target_os = "macos", target_os = "ios"))))]
const O_NONBLOCK: i32 = 0x0800;

/// Copy `canonical` — a path that has already been resolved — to `dest`,
/// copying at most `budget` bytes. What the path IS is judged before the
/// open: a directory, a FIFO, a socket or a device is a broken link
/// (`Ok(None)`, nothing to copy — and a FIFO must not be opened at all, or
/// the export hangs until something writes to it); a symlink is a refusal,
/// since `canonicalize` resolved every link and one standing here now means
/// the path was swapped under the check. The file is then opened once and
/// read through that handle: `fstat` on the handle must again say regular
/// file, and match the path's own entry (same device and inode where the
/// platform has them), or the swap happened between the two — refused
/// either way. `Err` is a refusal: a swap, or more bytes than `budget`
/// allows (judged on what is read, not on a size reported earlier).
fn copy_regular_file(canonical: &Path, dest: &Path, budget: u64) -> Result<Option<u64>, String> {
    use std::io::Read;
    let swapped = || "the path changed while it was being read".to_string();
    let Ok(entry) = std::fs::symlink_metadata(canonical) else {
        return Ok(None);
    };
    if entry.file_type().is_symlink() {
        return Err(swapped());
    }
    if !entry.is_file() {
        return Ok(None);
    }
    let mut open = std::fs::OpenOptions::new();
    open.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        open.custom_flags(O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        // FILE_FLAG_OPEN_REPARSE_POINT: open a symlink or junction ITSELF rather
        // than what it points to, so a path swapped for one after the check
        // yields a handle whose metadata says "symlink" below and is refused.
        use std::os::windows::fs::OpenOptionsExt;
        open.custom_flags(0x0020_0000);
    }
    let Ok(file) = open.open(canonical) else {
        return Ok(None);
    };
    let Ok(opened) = file.metadata() else {
        return Ok(None);
    };
    if !opened.is_file() || opened.file_type().is_symlink() {
        return Err(swapped());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if opened.dev() != entry.dev() || opened.ino() != entry.ino() {
            return Err(swapped());
        }
    }
    let too_large = || {
        if budget < MAX_IMAGE_BYTES {
            format!(
                "the document's images add up to more than {} MiB",
                MAX_TOTAL_IMAGE_BYTES / (1024 * 1024)
            )
        } else {
            format!("larger than {} MiB", MAX_IMAGE_BYTES / (1024 * 1024))
        }
    };
    if opened.len() > budget {
        return Err(too_large());
    }
    let mut out = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let copied = std::io::copy(&mut file.take(budget + 1), &mut out).map_err(|e| e.to_string())?;
    if copied > budget {
        let _ = std::fs::remove_file(dest);
        return Err(too_large());
    }
    Ok(Some(copied))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, bytes: &[u8]) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    fn req(name: &str, source: &str) -> Vec<PandocImageRequest> {
        vec![PandocImageRequest {
            name: name.into(),
            source: source.into(),
        }]
    }

    fn stage(
        document_dir: &Path,
        root: &Path,
        requests: &[PandocImageRequest],
    ) -> Result<(tempfile::TempDir, HashMap<String, String>), ExportError> {
        let tmp = tempfile::tempdir().unwrap();
        let staging = ImageStaging {
            document_dir,
            root,
            requests,
        };
        let bound = stage_images(tmp.path(), &staging)?;
        Ok((tmp, bound))
    }

    #[test]
    fn image_candidate_joins_a_relative_source_under_the_document_dir() {
        let dir = Path::new("/vault/notes");
        assert_eq!(
            resolve_image_candidate(dir, "img/a.png").unwrap(),
            PathBuf::from("/vault/notes/img/a.png")
        );
        assert_eq!(
            resolve_image_candidate(dir, "../shared/a%20b.png").unwrap(),
            PathBuf::from("/vault/notes/../shared/a b.png")
        );
    }

    #[test]
    fn image_candidate_refuses_what_is_not_relative() {
        let dir = Path::new("/vault/notes");
        for source in ["", "/etc/hosts", "%2Fetc%2Fhosts"] {
            assert!(
                resolve_image_candidate(dir, source).is_err(),
                "{source} must be refused"
            );
        }
        #[cfg(windows)]
        for source in ["C:\\x.png", "\\\\server\\share\\x.png", "\\x.png"] {
            assert!(resolve_image_candidate(dir, source).is_err());
        }
    }

    #[test]
    fn stage_images_copies_a_file_inside_the_root_under_the_requested_name() {
        let vault = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(vault.path()).unwrap();
        write(&root.join("notes/img/a b.png"), b"PNG");
        let (tmp, bound) = stage(
            &root.join("notes"),
            &root,
            &req("image-0.png", "img/a%20b.png"),
        )
        .unwrap();
        let path = &bound["image-0.png"];
        assert_eq!(Path::new(path), tmp.path().join("image-0.png"));
        assert_eq!(std::fs::read(path).unwrap(), b"PNG");
    }

    #[test]
    fn stage_images_binds_a_broken_link_to_a_path_that_does_not_exist() {
        let vault = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(vault.path()).unwrap();
        std::fs::create_dir_all(root.join("notes/dir.png")).unwrap();
        for source in ["img/missing.png", "dir.png", "..", "a.png/b.png"] {
            let (tmp, bound) =
                stage(&root.join("notes"), &root, &req("image-0.png", source)).unwrap();
            let path = Path::new(&bound["image-0.png"]);
            assert!(
                path.is_absolute() && path.starts_with(tmp.path()),
                "{source}: {path:?}"
            );
            assert!(!path.exists(), "{source}: must not exist");
        }
    }

    #[cfg(unix)]
    #[test]
    fn stage_images_treats_a_fifo_as_a_broken_link_without_blocking() {
        let vault = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(vault.path()).unwrap();
        std::fs::create_dir_all(root.join("notes/img")).unwrap();
        let status = std::process::Command::new("mkfifo")
            .arg(root.join("notes/img/a.png"))
            .status()
            .unwrap();
        assert!(status.success());
        // Opening a FIFO for reading blocks until a writer appears; the export
        // must not. Judged before the open, with O_NONBLOCK on the open itself.
        let started = std::time::Instant::now();
        let (tmp, bound) =
            stage(&root.join("notes"), &root, &req("image-0.png", "img/a.png")).unwrap();
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
        let path = Path::new(&bound["image-0.png"]);
        assert!(path.starts_with(tmp.path()) && !path.exists());
    }

    #[test]
    fn stage_images_refuses_a_path_that_climbs_out_of_the_root() {
        let vault = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(vault.path()).unwrap();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        write(&outside.path().join("secret.png"), b"SECRET");
        // `<root>/notes/../../<outside>/secret.png` — a lexical check that only
        // counted `..` would still have to know where the root ends.
        let climb = format!(
            "../../{}/secret.png",
            outside.path().file_name().unwrap().to_str().unwrap()
        );
        let err = stage(&root.join("notes"), &root, &req("image-0.png", &climb))
            .expect_err("must be refused");
        assert!(matches!(err, ExportError::ImageRefused(_)), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn stage_images_refuses_a_symlink_inside_the_root_that_points_outside() {
        let vault = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(vault.path()).unwrap();
        write(&outside.path().join("secret.png"), b"SECRET");
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secret.png"),
            root.join("notes/link.png"),
        )
        .unwrap();
        // The string `link.png` is as relative and as inside as they come; only
        // the canonical result tells the truth.
        let err = stage(&root.join("notes"), &root, &req("image-0.png", "link.png"))
            .expect_err("must be refused");
        assert!(matches!(err, ExportError::ImageRefused(_)), "{err}");
    }

    #[test]
    fn stage_images_refuses_another_root_and_an_unsafe_name() {
        let vault = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(vault.path()).unwrap();
        let other_root = std::fs::canonicalize(other.path()).unwrap();
        write(&root.join("notes/img/a.png"), b"PNG");
        // The document's own context is the boundary, not "any open vault".
        assert!(matches!(
            stage(
                &root.join("notes"),
                &other_root,
                &req("image-0.png", "img/a.png")
            ),
            Err(ExportError::ImageRefused(_))
        ));
        assert!(matches!(
            stage(
                &root.join("notes"),
                &root,
                &req("../image-0.png", "img/a.png")
            ),
            Err(ExportError::TempFileError(_))
        ));
        // Nothing requested, nothing staged.
        assert!(stage(&root.join("notes"), &root, &[]).unwrap().1.is_empty());
    }

    #[test]
    fn stage_images_caps_the_number_of_requests() {
        let vault = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(vault.path()).unwrap();
        write(&root.join("a.png"), b"PNG");
        let many: Vec<PandocImageRequest> = (0..=MAX_IMAGE_COUNT)
            .map(|i| PandocImageRequest {
                name: format!("image-{i}.png"),
                source: "a.png".into(),
            })
            .collect();
        assert!(matches!(
            stage(&root, &root, &many),
            Err(ExportError::ImageRefused(_))
        ));
    }
}
