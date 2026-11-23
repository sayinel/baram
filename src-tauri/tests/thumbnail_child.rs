//! §397 The thumbnail build in a child process, end to end: `ensure_thumbnail_via_child` and
//! `build_thumbnail_in_child` spawn the real binary (`CARGO_BIN_EXE_baram`) in its thumbnail
//! mode and read the answer back.
//!
//! Runs on every platform, Windows included, for the reason `tests/tile_child.rs` gives.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use baram_lib::thumbnail_child::{
    build_thumbnail_in_child, ensure_thumbnail_via_child, ChildError, THUMBNAIL_FLAG,
};
use image::{DynamicImage, Rgb, RgbImage};
use tempfile::TempDir;

fn exe() -> &'static Path {
    Path::new(env!("CARGO_BIN_EXE_baram"))
}

fn jpeg(dir: &Path, name: &str, w: u32, h: u32) -> PathBuf {
    let path = dir.join(name);
    DynamicImage::ImageRgb8(RgbImage::from_fn(w, h, |x, y| {
        Rgb([(x % 251) as u8, (y % 241) as u8, ((x + y) % 239) as u8])
    }))
    .save(&path)
    .expect("write the source");
    path
}

/// A BMP whose header says 3000x2 with too few pixel bytes: every header check passes and
/// decoding fails.
fn broken_bmp(dir: &Path) -> PathBuf {
    let path = dir.join("cut.bmp");
    let mut b = Vec::new();
    b.extend_from_slice(b"BM");
    b.extend_from_slice(&(54u32 + 18_000).to_le_bytes());
    b.extend_from_slice(&0u32.to_le_bytes());
    b.extend_from_slice(&54u32.to_le_bytes());
    b.extend_from_slice(&40u32.to_le_bytes());
    b.extend_from_slice(&3000i32.to_le_bytes());
    b.extend_from_slice(&2i32.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&24u16.to_le_bytes());
    b.extend_from_slice(&0u32.to_le_bytes());
    b.extend_from_slice(&18_000u32.to_le_bytes());
    b.extend_from_slice(&2835i32.to_le_bytes());
    b.extend_from_slice(&2835i32.to_le_bytes());
    b.extend_from_slice(&0u32.to_le_bytes());
    b.extend_from_slice(&0u32.to_le_bytes());
    b.extend_from_slice(&[0x55; 100]);
    std::fs::write(&path, b).expect("write the source");
    path
}

/// Every file under `dir`, relative and sorted — what a run left in the cache.
fn files_under(dir: &Path) -> Vec<String> {
    fn walk(root: &Path, dir: &Path, found: &mut Vec<String>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(root, &path, found);
            } else {
                let rel = path.strip_prefix(root).expect("under root");
                found.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    let mut found = Vec::new();
    walk(dir, dir, &mut found);
    found.sort();
    found
}

/// The command's path: the source needs a build, so the child makes the thumbnail in the
/// parent's cache and the parent gets its path. Asked again, the parent answers the hit
/// itself and spawns nothing. What fails this: the child writing anything to stdout besides
/// the answer, the parent reading the size from argv differently from how it wrote it (a
/// different tier directory), or the second call spawning a child.
#[test]
fn a_thumbnail_built_in_the_child_comes_back_to_the_parent() {
    let dir = TempDir::new().expect("tempdir");
    let cache = dir.path().join("cache");
    let src = jpeg(dir.path(), "wide.jpg", 800, 400);

    let built = ensure_thumbnail_via_child(&src, &cache, 256, || Ok(exe().to_path_buf()))
        .expect("the child builds");

    assert!(built.starts_with(cache.join("v2").join("256")), "{built:?}");
    let thumb = image::open(&built).expect("a readable thumbnail");
    assert_eq!((thumb.width(), thumb.height()), (256, 128));

    let again = ensure_thumbnail_via_child(&src, &cache, 256, || panic!("a hit spawns no child"))
        .expect("a hit");
    assert_eq!(again, built);
}

/// The child does not trust the parent: it checks the cache again. The source is overwritten
/// with zeros of the same length and its mtime put back, so the cache key is unchanged and
/// only a hit can answer — a child that decoded would fail.
#[test]
fn a_second_child_answers_the_hit_without_decoding() {
    let dir = TempDir::new().expect("tempdir");
    let cache = dir.path().join("cache");
    let src = jpeg(dir.path(), "wide.jpg", 800, 400);
    let built = build_thumbnail_in_child(exe(), &src, &cache, 320).expect("the child builds");

    let meta = std::fs::metadata(&src).expect("stat");
    let mtime = meta.modified().expect("mtime");
    std::fs::write(&src, vec![0u8; meta.len() as usize]).expect("overwrite");
    std::fs::File::options()
        .write(true)
        .open(&src)
        .and_then(|file| file.set_modified(mtime))
        .expect("restore mtime");
    let before = files_under(&cache);

    assert_eq!(
        build_thumbnail_in_child(exe(), &src, &cache, 320).expect("a hit"),
        built
    );
    assert_eq!(files_under(&cache), before, "a hit writes nothing");
}

/// A failed build comes back as the thumbnailer's sentence, and nothing is left in the cache.
#[test]
fn a_failed_build_in_the_child_comes_back_as_its_message() {
    let dir = TempDir::new().expect("tempdir");
    let cache = dir.path().join("cache");
    let src = broken_bmp(dir.path());

    let result = build_thumbnail_in_child(exe(), &src, &cache, 320);

    match result {
        Err(ChildError::Build(message)) => {
            assert!(!message.is_empty());
            assert!(!message.ends_with('\n'), "{message:?}");
        }
        other => panic!("expected a build failure, got {other:?}"),
    }
    assert_eq!(files_under(&cache), Vec::<String>::new());
}

/// A child whose stdin is at EOF from the start stops instead of building on — the state a
/// child is in once its parent has exited. 4000x3000 takes far longer to decode than the
/// watch on stdin takes to see EOF. What fails this: the child not watching its stdin, or
/// watching it only after the build. That the parent's exit does close the pipe is the OS's
/// part and is not tested here.
#[test]
fn a_child_whose_stdin_is_at_eof_stops_without_a_thumbnail() {
    let dir = TempDir::new().expect("tempdir");
    let cache = dir.path().join("cache");
    let src = jpeg(dir.path(), "large.jpg", 4000, 3000);

    let out = Command::new(exe())
        .arg(THUMBNAIL_FLAG)
        .arg(&src)
        .arg(&cache)
        .arg("320")
        .stdin(Stdio::null())
        .output()
        .expect("run baram");

    assert_eq!(out.status.code(), Some(3), "{out:?}");
    assert!(out.stdout.is_empty());
    let thumbnails: Vec<String> = files_under(&cache)
        .into_iter()
        .filter(|path| path.ends_with(".jpg"))
        .collect();
    assert_eq!(thumbnails, Vec::<String>::new());
}

/// The other half of the pair above: through `build_thumbnail_in_child` the same source builds
/// to the end, because the parent holds the child's stdin open until the child exits.
#[test]
fn a_child_whose_parent_holds_its_stdin_builds_the_same_large_source() {
    let dir = TempDir::new().expect("tempdir");
    let cache = dir.path().join("cache");
    let src = jpeg(dir.path(), "large.jpg", 4000, 3000);

    let built = build_thumbnail_in_child(exe(), &src, &cache, 320);

    let built = built.expect("the child builds");
    assert_eq!(image::open(&built).expect("readable").width(), 320);
}

/// `main` routes the thumbnail flag to the thumbnail mode after the tile mode declines it and
/// before the CLI sees it: the usage error is the thumbnail mode's own (exit 2, its usage line —
/// `<max px>` is in no other mode's).
#[test]
fn the_thumbnail_flag_reaches_the_thumbnail_mode_and_not_the_cli() {
    let out = Command::new(exe())
        .arg(THUMBNAIL_FLAG)
        .output()
        .expect("run baram");

    assert_eq!(out.status.code(), Some(2));
    assert!(out.stdout.is_empty());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("<source> <cache dir> <max px>"), "{stderr}");
    assert!(!stderr.contains("unexpected argument"), "{stderr}");
}
