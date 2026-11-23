//! §397 The app process decides on a photo — `probe_thumbnail` (reached through
//! `ensure_thumbnail_via_child`, the `photo_thumbnail` command's body) and `probe_tiles`
//! (the `image_tiles` command's first step) — without allocating a buffer the size of the
//! compressed file, for the sources here: synthetic noise, no metadata ahead of the pixel
//! data (`src/thumbnail/header.rs` names the metadata that still costs an allocation). On
//! macOS a freed allocation that large stayed in the app's footprint for over a minute
//! (malloc's large cache — `src/thumbnail/child.rs` has the measurement), and `image`'s
//! `JpegDecoder::new` reads the whole file into one `Vec` before it looks at the header.
//!
//! This binary's global allocator records the largest single allocation a thread makes while
//! that thread is watching. It is a binary of its own so that no other test runs under a
//! replaced global allocator.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};

use baram_lib::thumbnail_child::{ensure_thumbnail_via_child, ChildError, ViaChildError};
use baram_lib::tile_child::probe_tiles;
use image::codecs::gif::GifEncoder;
use image::codecs::jpeg::JpegEncoder;
use image::codecs::webp::WebPEncoder;
use image::{DynamicImage, ExtendedColorType, ImageEncoder, ImageReader, RgbImage};
use tempfile::TempDir;

struct Watching;

thread_local! {
    static WATCHING: Cell<bool> = const { Cell::new(false) };
    static LARGEST: Cell<usize> = const { Cell::new(0) };
}

/// Notes one allocation's size if this thread is watching. `try_with` because the allocator
/// can run while a thread's locals are being torn down; const-initialised `Cell`s need no
/// allocation to reach.
fn note(size: usize) {
    let _ = WATCHING.try_with(|watching| {
        if watching.get() {
            let _ = LARGEST.try_with(|largest| largest.set(largest.get().max(size)));
        }
    });
}

unsafe impl GlobalAlloc for Watching {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        note(layout.size());
        unsafe { System.alloc(layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        note(layout.size());
        unsafe { System.alloc_zeroed(layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        note(new_size);
        unsafe { System.realloc(ptr, layout, new_size) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
}

#[global_allocator]
static ALLOCATOR: Watching = Watching;

/// Runs `f` and returns its result with the largest single allocation it made on this thread.
fn largest_allocation<T>(f: impl FnOnce() -> T) -> (T, usize) {
    LARGEST.with(|largest| largest.set(0));
    WATCHING.with(|watching| watching.set(true));
    let out = f();
    WATCHING.with(|watching| watching.set(false));
    (out, LARGEST.with(Cell::get))
}

/// A decision's largest allocation stays under this. The sources are at least four times it.
const CEILING: usize = 1 << 20;

/// Bytes that do not compress, so a file's size follows its pixel count.
fn noise(len: usize) -> Vec<u8> {
    let mut state = 0x2545_f491_u32;
    (0..len)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            (state >> 24) as u8
        })
        .collect()
}

/// 2100 px wide — over the tile threshold (2048) and the thumbnail bound (320), so both
/// decisions answer "build" after reading the header.
const W: u32 = 2100;
const H: u32 = 1100;

fn rgb_noise() -> RgbImage {
    RgbImage::from_raw(W, H, noise((W * H * 3) as usize)).expect("buffer matches the size")
}

/// The JPEG, PNG, WebP and BMP sources, each at least four times `CEILING`.
fn sources(dir: &Path) -> Vec<PathBuf> {
    // Quality 95: at the encoder's default (75) this noise is under 3 MB.
    let jpeg = dir.join("noise.jpg");
    JpegEncoder::new_with_quality(BufWriter::new(File::create(&jpeg).expect("create")), 95)
        .write_image(rgb_noise().as_raw(), W, H, ExtendedColorType::Rgb8)
        .expect("write the source");
    let mut paths = vec![jpeg];
    for name in ["noise.png", "noise.bmp"] {
        let path = dir.join(name);
        DynamicImage::ImageRgb8(rgb_noise())
            .save(&path)
            .expect("write the source");
        paths.push(path);
    }
    let webp = dir.join("noise.webp");
    WebPEncoder::new_lossless(BufWriter::new(File::create(&webp).expect("create")))
        .encode(rgb_noise().as_raw(), W, H, ExtendedColorType::Rgb8)
        .expect("write the source");
    paths.push(webp);
    for path in &paths {
        let len = std::fs::metadata(path).expect("stat").len();
        assert!(len >= 4 * CEILING as u64, "{}: {len} bytes", path.display());
    }
    paths
}

/// A still GIF of grey noise — 256 greys, so the encoder keeps every pixel's colour.
fn gif(dir: &Path) -> PathBuf {
    let (w, h) = (3000, 2000);
    let path = dir.join("noise.gif");
    let rgba: Vec<u8> = noise((w * h) as usize)
        .into_iter()
        .flat_map(|g| [g, g, g, 255])
        .collect();
    GifEncoder::new(BufWriter::new(File::create(&path).expect("create")))
        .encode(&rgba, w, h, ExtendedColorType::Rgba8)
        .expect("write the source");
    let len = std::fs::metadata(&path).expect("stat").len();
    assert!(len >= 4 * CEILING as u64, "{}: {len} bytes", path.display());
    path
}

/// The thumbnail command's body decides in this process and, for a photo it must build, asks
/// for the child — which this test refuses, so the decision is all that runs here. For each of
/// the five formats the decision reaches "build" and allocates nothing near the file's size.
/// What fails this: the decision opening `image`'s decoder for a JPEG (`open_decoder` in
/// `probe_thumbnail` instead of `read_header`).
#[test]
fn the_thumbnail_decision_allocates_nothing_the_size_of_the_file() {
    let dir = TempDir::new().expect("temp dir");
    let cache = dir.path().join("cache");
    let mut all = sources(dir.path());
    all.push(gif(dir.path()));

    for src in &all {
        let (result, largest) = largest_allocation(|| {
            ensure_thumbnail_via_child(src, &cache, 320, || {
                Err(std::io::Error::other("no child in this test"))
            })
        });

        assert!(
            matches!(result, Err(ViaChildError::Child(ChildError::Spawn(_)))),
            "{}: the decision asks for a build, got {result:?}",
            src.display()
        );
        assert!(
            largest < CEILING,
            "{}: largest allocation {largest} bytes",
            src.display()
        );
    }
}

/// The tiles command's decision reads the header of a photo over the threshold, announces its
/// size and asks for a build, allocating nothing near the file's size. GIF is not here: the
/// decision answers "original" for every GIF from its format (the content, else the
/// extension), before any decoder.
/// What fails this: the decision opening `image`'s decoder for a JPEG (`open_decoder` in
/// `probe_tiles` instead of `read_header`).
#[test]
fn the_tile_decision_allocates_nothing_the_size_of_the_file() {
    let dir = TempDir::new().expect("temp dir");
    let cache = dir.path().join("cache");

    for src in sources(dir.path()) {
        let announced = Cell::new(None);
        let (result, largest) = largest_allocation(|| {
            probe_tiles(&src, &cache, |size| {
                announced.set(Some((size.width, size.height)))
            })
        });

        assert!(
            matches!(result, Ok(None)),
            "{}: the decision asks for a build, got {result:?}",
            src.display()
        );
        assert_eq!(announced.get(), Some((W, H)), "{}", src.display());
        assert!(
            largest < CEILING,
            "{}: largest allocation {largest} bytes",
            src.display()
        );
    }
}

/// The watch sees the defect the decisions avoid: opening `image`'s decoder for the same JPEG
/// allocates the whole file at once.
#[test]
fn the_watch_sees_the_jpeg_decoder_hold_the_whole_file() {
    let dir = TempDir::new().expect("temp dir");
    let jpeg = sources(dir.path())
        .into_iter()
        .find(|path| path.extension().is_some_and(|ext| ext == "jpg"))
        .expect("a JPEG source");
    let len = std::fs::metadata(&jpeg).expect("stat").len() as usize;

    let (decoder, largest) = largest_allocation(|| {
        ImageReader::open(&jpeg)
            .and_then(|reader| reader.with_guessed_format())
            .map(|reader| reader.into_decoder())
    });

    assert!(matches!(decoder, Ok(Ok(_))));
    assert!(largest >= len, "largest {largest} bytes, file {len} bytes");
}
