//! §397 The tile pyramid build in a child process, end to end: `build_in_child` spawns the
//! real binary (`CARGO_BIN_EXE_baram`) in its child mode and reads the answer back.
//!
//! Runs on every platform, Windows included — the child needs no HOME or config, so the
//! reason `tests/cli.rs` is Unix only does not apply. On the Windows job this is the test
//! that spawns the app's exe with `CREATE_NO_WINDOW` and reads its stdout through a pipe.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use baram_lib::tile_child::{build_in_child, ChildError, TileSet, CHILD_FLAG};
use image::{DynamicImage, Rgb, RgbImage};
use tempfile::TempDir;

fn exe() -> &'static Path {
    Path::new(env!("CARGO_BIN_EXE_baram"))
}

/// 2049 px wide, so it is over the tile threshold on one side.
fn big_jpeg(dir: &Path) -> PathBuf {
    let path = dir.join("big.jpg");
    DynamicImage::ImageRgb8(RgbImage::from_fn(2049, 10, |x, y| {
        Rgb([(x % 251) as u8, (y % 241) as u8, 90])
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

/// The child builds the pyramid into the parent's cache and the parent gets its location
/// and manifest. A second build of the same source is a cache hit and answers the same.
/// What fails this: the child writing anything to stdout besides the answer, the parent
/// reading the answer in a shape the child does not write, or the second child decoding
/// again — the source is overwritten with zeros of the same length and its mtime put back,
/// so the cache key is unchanged and only a hit can answer.
#[test]
fn a_pyramid_built_in_the_child_comes_back_to_the_parent() {
    let dir = TempDir::new().expect("tempdir");
    let cache = dir.path().join("cache");
    let src = big_jpeg(dir.path());

    let built = build_in_child(exe(), &src, &cache).expect("the child builds");

    let TileSet::Tiles {
        dir: pyramid,
        manifest,
    } = built.clone()
    else {
        panic!("expected tiles, got {built:?}");
    };
    let pyramid = PathBuf::from(pyramid);
    assert!(pyramid.starts_with(&cache), "{pyramid:?}");
    assert_eq!((manifest.width, manifest.height), (2049, 10));
    assert_eq!(manifest.levels.len(), 4);
    assert!(pyramid.join("manifest.json").is_file());
    assert!(pyramid.join("0").join("4_0.jpg").is_file());

    let meta = std::fs::metadata(&src).expect("stat");
    let mtime = meta.modified().expect("mtime");
    std::fs::write(&src, vec![0u8; meta.len() as usize]).expect("overwrite");
    std::fs::File::options()
        .write(true)
        .open(&src)
        .and_then(|file| file.set_modified(mtime))
        .expect("restore mtime");
    let before = files_under(&cache);

    assert_eq!(build_in_child(exe(), &src, &cache).expect("a hit"), built);
    assert_eq!(files_under(&cache), before, "a hit writes no tile");
}

/// A failed build comes back as the thumbnailer's sentence. This source fails in decoding,
/// before the cache directory is made, so the empty cache shows that order — not the
/// cleanup of a half-written pyramid.
#[test]
fn a_failed_build_in_the_child_comes_back_as_its_message() {
    let dir = TempDir::new().expect("tempdir");
    let cache = dir.path().join("cache");
    let src = broken_bmp(dir.path());

    let result = build_in_child(exe(), &src, &cache);

    match result {
        Err(ChildError::Build(message)) => {
            assert!(!message.is_empty());
            assert!(!message.ends_with('\n'), "{message:?}");
        }
        other => panic!("expected a build failure, got {other:?}"),
    }
    assert_eq!(files_under(&cache), Vec::<String>::new());
}

/// 4000x3000: decoding and cutting it takes far longer than the child's watch on stdin takes
/// to see EOF, so the two tests below that use it do not race on timing.
fn large_jpeg(dir: &Path) -> PathBuf {
    let path = dir.join("large.jpg");
    DynamicImage::ImageRgb8(RgbImage::from_fn(4000, 3000, |x, y| {
        Rgb([(x % 251) as u8, (y % 241) as u8, ((x + y) % 239) as u8])
    }))
    .save(&path)
    .expect("write the source");
    path
}

/// A child whose stdin is at EOF from the start stops instead of building on — the state a
/// child is in once its parent has exited and the parent's end of the pipe is closed. What
/// fails this: the child not watching its stdin, or watching it only after the build. That
/// the parent's exit does close the pipe is the OS's part and is not tested here.
#[test]
fn a_child_whose_stdin_is_at_eof_stops_without_a_pyramid() {
    let dir = TempDir::new().expect("tempdir");
    let cache = dir.path().join("cache");
    let src = large_jpeg(dir.path());

    let out = Command::new(exe())
        .arg(CHILD_FLAG)
        .arg(&src)
        .arg(&cache)
        .stdin(Stdio::null())
        .output()
        .expect("run baram");

    assert_eq!(out.status.code(), Some(3), "{out:?}");
    assert!(out.stdout.is_empty());
    let manifests: Vec<String> = files_under(&cache)
        .into_iter()
        .filter(|path| path.ends_with("manifest.json"))
        .collect();
    assert_eq!(manifests, Vec::<String>::new());
}

/// The other half of the pair above: through `build_in_child` the same source builds to the
/// end, because the parent holds the child's stdin open until the child exits. What fails
/// this: `build_in_child` closing stdin early or not piping it — the child would then stop
/// as in the test above and come back as a crash.
#[test]
fn a_child_whose_parent_holds_its_stdin_builds_the_same_large_source() {
    let dir = TempDir::new().expect("tempdir");
    let cache = dir.path().join("cache");
    let src = large_jpeg(dir.path());

    let built = build_in_child(exe(), &src, &cache);

    assert!(matches!(built, Ok(TileSet::Tiles { .. })), "{built:?}");
}

#[test]
fn a_missing_executable_is_a_spawn_error() {
    let dir = TempDir::new().expect("tempdir");
    let src = big_jpeg(dir.path());

    let result = build_in_child(
        &dir.path().join("no-such-baram"),
        &src,
        &dir.path().join("c"),
    );

    assert!(matches!(result, Err(ChildError::Spawn(_))), "{result:?}");
}

/// `main` routes the child's flag to the child mode before the CLI sees it: the usage
/// error is the child's own (exit 2, its usage line), not clap's "unexpected argument" and
/// not the thumbnail mode's, whose usage line also has `<source> <cache dir>` but not this flag.
#[test]
fn the_child_flag_reaches_the_child_mode_and_not_the_cli() {
    let out = Command::new(exe())
        .arg(CHILD_FLAG)
        .output()
        .expect("run baram");

    assert_eq!(out.status.code(), Some(2));
    assert!(out.stdout.is_empty());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("<source> <cache dir>"), "{stderr}");
    assert!(stderr.contains(CHILD_FLAG), "{stderr}");
    assert!(!stderr.contains("unexpected argument"), "{stderr}");
}
