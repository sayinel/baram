// §56d Photo Gallery 썸네일 — 원본을 축소해 디스크에 캐시한다.
//
// 왜 Rust인가: 갤러리는 사진을 3열 그리드의 ~100px 칸에 그린다. 그런데 브라우저는 100px로
// 그리려고 해도 **원본을 통째로 디코드**해야 한다. 실측한 사용자 저널은 사진 177장 / 평균
// 17.7 MPix(최대 199 MPix)로, Year 뷰 한 번이 RGBA 12.2GB 디코드를 요구했다 — 유휴 메모리
// 목표는 100MB다(Part 8 §8.4). WKWebView는 그 압박에서 디코드된 비트맵을 버리고, 그러면
// 리페인트마다 그리드 전체가 플레이스홀더로 번쩍인다(에디터 사진에 마우스를 올리면
// `.media-resize-handle`의 opacity 전환이 그 리페인트를 일으킨다).
//
// 축소를 웹뷰에서 하면 그 12GB를 웹뷰가 한 번은 만져야 한다. 여기서 하면 웹뷰는 ~0.06 MPix
// 썸네일만 본다.
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};
use sha2::{Digest, Sha256};
use thiserror::Error;

/// 디코더에 허용하는 최대 할당. `Limits`의 기본값 512MiB는 **실제 사진을 거른다** —
/// 199 MPix 파노라마 하나가 RGB8로 ~600MB다. 그 사진이야말로 썸네일이 가장 필요한 사진이므로
/// 기본값을 그대로 쓰면 정확히 최악의 경우에만 실패한다.
const MAX_DECODE_ALLOC: u64 = 2 * 1024 * 1024 * 1024;

/// 손상·조작된 헤더가 만들 수 있는 할당의 상한. `MAX_DECODE_ALLOC`이 비트맵 크기를 막지만
/// 그건 비-strict 한도라 무시하는 디코더가 있다(`Limits` 문서). 픽셀 수는 헤더만 읽고 알 수
/// 있으니 디코드 **전에** 우리가 직접 자른다.
const MAX_SOURCE_PIXELS: u64 = 500_000_000;

/// 상한을 조이다가 실사용 파노라마(실측 저널의 최대 사진이 199.8 MPix)를 원본으로 떨어뜨리면
/// 정확히 썸네일이 가장 필요한 한 장에서 이 기능이 없는 셈이 된다. 컴파일 시각에 못 박는다.
const _: () = assert!(MAX_SOURCE_PIXELS > 200_000_000);

/// 썸네일이 넘을 수 없는 한 변의 길이. 이 명령은 웹뷰가 부르므로 max_px도 웹뷰가 준다 —
/// "썸네일"이라는 이름으로 원본만 한 재인코딩을 시키지 못하게 묶는다.
const MAX_THUMB_PX: u32 = 2048;
const MIN_THUMB_PX: u32 = 16;

#[derive(Error, Debug)]
pub enum ThumbnailError {
    #[error("썸네일 원본을 읽을 수 없습니다: {0}")]
    Io(#[from] std::io::Error),
    #[error("썸네일을 만들 수 없는 이미지입니다: {0}")]
    Decode(#[from] image::ImageError),
    #[error("이미지가 너무 큽니다: {width}x{height}")]
    TooLarge { height: u32, width: u32 },
}

/// 캐시 레이아웃의 세대. **크기 상수나 인코딩 방식을 바꾸면 이 값을 올린다.**
///
/// 왜 경로에 세대가 있어야 하는가: 파일 이름은 해시 하나뿐이라 그것만 보고는 어느 크기인지도,
/// 어느 사진 것인지도 알 수 없다. 세대가 없으면 320을 400으로 바꾸는 순간 낡은 항목이
/// **구분할 수 없는 채로 영구히** 남는다. 세대가 있으면 그 상황이 디렉터리 하나를 지우는
/// 일이 된다(purge_stale_generations).
const CACHE_GENERATION: &str = "v1";

/// 한 크기의 항목들이 사는 디렉터리 — `{cache}/v1/{max_px}/`.
///
/// 크기를 경로로 가르는 이유는 정리 정책 때문이다. 실측한 두 계층은 경제가 전혀 다르다:
/// 320px는 사진 177장이 전부 3.3MB이고 그리드가 그것 없이는 못 돌지만, 2048px는 한 장이
/// 403KB로 용량의 95%를 차지하면서 miss 비용은 142ms다. 상한을 걸 곳과 걸지 말 곳이 다르므로,
/// `read_dir` 한 번으로 그 둘을 가릴 수 있어야 한다.
fn tier_dir(cache_dir: &Path, max_px: u32) -> PathBuf {
    cache_dir.join(CACHE_GENERATION).join(max_px.to_string())
}

/// 캐시 파일 경로 두 개(불투명→jpg, 알파→png)를 만든다.
///
/// 키에 mtime과 파일 크기가 들어가는 이유: 사용자가 사진을 교체하면(같은 이름, 다른 내용)
/// 낡은 썸네일이 영원히 남는다. 두 값이 같이 바뀌지 않는 교체는 사실상 없다.
///
/// ‼️ `max_px`는 경로가 이미 가르지만 해시에도 남긴다. 중복이지만 inert한 중복이고, 나중에
/// 누가 계층 디렉터리를 없애 평평하게 되돌리면 크기만 다른 두 항목이 같은 파일명을 갖는다 —
/// 320px 썸네일이 2048px 프리뷰 자리에 조용히 서는 쪽이, 해시 입력 하나보다 훨씬 나쁘다.
fn cache_paths(
    cache_dir: &Path,
    src: &Path,
    mtime_nanos: u128,
    size: u64,
    max_px: u32,
) -> [PathBuf; 2] {
    let mut hasher = Sha256::new();
    hasher.update(src.to_string_lossy().as_bytes());
    hasher.update(b"\0");
    hasher.update(mtime_nanos.to_le_bytes());
    hasher.update(size.to_le_bytes());
    hasher.update(max_px.to_le_bytes());
    let key = hex32(&hasher.finalize());
    let tier = tier_dir(cache_dir, max_px);
    [
        tier.join(format!("{key}.jpg")),
        tier.join(format!("{key}.png")),
    ]
}

/// 현재 세대가 아닌 것을 지운다 — 낡은 세대 디렉터리와, 세대 도입 전의 평평한 파일들.
///
/// 세대 접두사가 사는 이유가 이 함수다. 값을 올리는 것만으로 낡은 항목이 사라지므로,
/// 레이아웃을 바꿀 때 "구분할 수 없는 파일이 남는다"를 고민하지 않아도 된다.
///
/// ‼️ 소스 사진이 아직 있는지는 **묻지 않는다.** 그것을 물으려면 vault를 훑어야 하고, 다중
/// vault(§88)에서 그 순간 닫혀 있는 vault의 캐시를 전부 지우게 된다. 고아 항목 회수는 이
/// 함수의 일이 아니다 — 여기서 확실히 지울 수 있는 것만 지운다.
///
/// 지운 항목 수를 돌려준다. 실패는 무시한다: 캐시는 지워도 다시 만들어지므로
/// (`ensure_thumbnail`이 파일 없음을 곧 재생성으로 처리한다) 정리 실패가 앱을 막을 이유가 없다.
pub fn purge_stale_generations(cache_dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let is_current_generation =
            path.is_dir() && path.file_name().and_then(|n| n.to_str()) == Some(CACHE_GENERATION);
        if is_current_generation {
            continue;
        }
        let outcome = if path.is_dir() {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        if outcome.is_ok() {
            removed += 1;
        }
    }
    removed
}

fn hex32(digest: &[u8]) -> String {
    digest.iter().take(16).fold(String::new(), |mut s, b| {
        use std::fmt::Write;
        let _ = write!(s, "{b:02x}");
        s
    })
}

/// 원본 한 장의 썸네일을 보장하고 그 캐시 경로를 돌려준다. 이미 있으면 디코드하지 않는다.
///
/// 블로킹 함수다 — 호출자가 `spawn_blocking`으로 감싼다(thumbnail_cmd.rs).
pub fn ensure_thumbnail(
    src: &Path,
    cache_dir: &Path,
    max_px: u32,
) -> Result<PathBuf, ThumbnailError> {
    let max_px = max_px.clamp(MIN_THUMB_PX, MAX_THUMB_PX);

    let metadata = std::fs::metadata(src)?;
    let mtime_nanos = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let [jpg, png] = cache_paths(cache_dir, src, mtime_nanos, metadata.len(), max_px);

    // 캐시 히트. 두 경로를 다 보는 이유: 출력 포맷은 알파 유무로 갈리고, 그건 디코드해야
    // 알 수 있다 — 히트 판정에 디코드를 끼우면 캐시의 의미가 없다.
    for hit in [&jpg, &png] {
        if hit.is_file() {
            return Ok(hit.clone());
        }
    }

    let thumb = decode_and_scale(src, max_px)?;

    // 계층 디렉터리까지 만든다 — 캐시 루트가 아니다(경로가 `{cache}/v1/{max_px}/`).
    std::fs::create_dir_all(tier_dir(cache_dir, max_px))?;
    let has_alpha = thumb.color().has_alpha();
    let (out, format, encodable) = if has_alpha {
        (png, ImageFormat::Png, thumb)
    } else {
        // JPEG는 알파 채널을 인코딩하지 못한다. 불투명이어도 RGBA8로 디코드된 원본(불투명
        // PNG 등)이 있으므로 색 타입을 맞춰 준다 — 안 맞추면 인코더가 UnsupportedColor로 죈다.
        (
            jpg,
            ImageFormat::Jpeg,
            DynamicImage::ImageRgb8(thumb.to_rgb8()),
        )
    };

    let mut buf = Vec::new();
    encodable.write_to(&mut std::io::Cursor::new(&mut buf), format)?;
    write_atomic(&out, &buf)?;
    Ok(out)
}

fn decode_and_scale(src: &Path, max_px: u32) -> Result<DynamicImage, ThumbnailError> {
    let mut limits = Limits::default();
    limits.max_alloc = Some(MAX_DECODE_ALLOC);

    let mut reader = ImageReader::open(src)?.with_guessed_format()?;
    reader.limits(limits.clone());
    let mut decoder = reader.into_decoder()?;
    decoder.set_limits(limits)?;

    let (width, height) = decoder.dimensions();
    if u64::from(width) * u64::from(height) > MAX_SOURCE_PIXELS {
        return Err(ThumbnailError::TooLarge { width, height });
    }

    // ‼️ 방향은 디코더에서 **먼저** 읽는다. `from_decoder`가 디코더를 소비하므로 그 뒤엔
    // 물어볼 대상이 없다. 이걸 빼먹으면 세로로 찍은 사진의 썸네일만 눕는다 — 에디터의
    // `<img>`는 WKWebView가 EXIF를 적용해 바로 세워 주므로 같은 사진이 두 방향으로 보인다.
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut img = DynamicImage::from_decoder(decoder)?;
    img.apply_orientation(orientation);

    // `thumbnail`은 소스 픽셀 하나가 타깃 픽셀 하나에 기여하는 정수 알고리즘이다 — 20배
    // 축소에서는 필터 품질 차이가 보이지 않고, `resize`의 Lanczos보다 훨씬 싸다.
    Ok(img.thumbnail(max_px, max_px))
}

/// 임시 파일에 쓰고 rename한다. 같은 사진을 두 곳(그리드와 라이트박스)에서 동시에 요청할 수
/// 있고, 반쯤 쓰인 파일을 asset 프로토콜이 읽으면 깨진 이미지가 캐시된 것처럼 보인다.
fn write_atomic(out: &Path, bytes: &[u8]) -> Result<(), std::io::Error> {
    let tmp = out.with_extension(format!(
        "{}.tmp{}",
        out.extension().and_then(|e| e.to_str()).unwrap_or("bin"),
        std::process::id()
    ));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage, Rgba, RgbaImage};

    fn write_jpeg(dir: &Path, name: &str, w: u32, h: u32) -> PathBuf {
        let path = dir.join(name);
        let mut img = RgbImage::new(w, h);
        for (x, y, px) in img.enumerate_pixels_mut() {
            *px = Rgb([(x % 256) as u8, (y % 256) as u8, 128]);
        }
        DynamicImage::ImageRgb8(img).save(&path).unwrap();
        path
    }

    #[test]
    fn scales_the_long_edge_down_to_max_px_and_keeps_aspect() {
        let dir = tempfile::tempdir().unwrap();
        let src = write_jpeg(dir.path(), "wide.jpg", 800, 400);

        let out = ensure_thumbnail(&src, &dir.path().join("cache"), 256).unwrap();

        let thumb = image::open(&out).unwrap();
        assert_eq!(thumb.width(), 256);
        assert_eq!(thumb.height(), 128);
    }

    #[test]
    fn encodes_an_opaque_source_as_jpeg_and_an_alpha_source_as_png() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("cache");

        let opaque = write_jpeg(dir.path(), "opaque.jpg", 64, 64);
        assert_eq!(
            ensure_thumbnail(&opaque, &cache, 32)
                .unwrap()
                .extension()
                .unwrap(),
            "jpg"
        );

        let alpha_path = dir.path().join("alpha.png");
        let mut alpha = RgbaImage::new(64, 64);
        alpha.put_pixel(0, 0, Rgba([255, 0, 0, 0]));
        DynamicImage::ImageRgba8(alpha).save(&alpha_path).unwrap();
        assert_eq!(
            ensure_thumbnail(&alpha_path, &cache, 32)
                .unwrap()
                .extension()
                .unwrap(),
            "png"
        );
    }

    #[test]
    fn reuses_the_cached_file_instead_of_re_encoding() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("cache");
        let src = write_jpeg(dir.path(), "photo.jpg", 200, 200);

        let first = ensure_thumbnail(&src, &cache, 64).unwrap();
        // 캐시 파일을 알아볼 수 있게 바꿔 놓는다. 두 번째 호출이 재인코딩하면 이 내용이 사라진다.
        std::fs::write(&first, b"sentinel").unwrap();
        let second = ensure_thumbnail(&src, &cache, 64).unwrap();

        assert_eq!(first, second);
        assert_eq!(std::fs::read(&second).unwrap(), b"sentinel");
    }

    #[test]
    fn a_different_size_or_a_rewritten_source_gets_a_different_cache_file() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("cache");
        let src = write_jpeg(dir.path(), "photo.jpg", 200, 200);

        let small = ensure_thumbnail(&src, &cache, 64).unwrap();
        let large = ensure_thumbnail(&src, &cache, 128).unwrap();
        assert_ne!(small, large);

        // 같은 이름 다른 내용으로 교체 — 크기가 달라지므로 키도 달라진다.
        write_jpeg(dir.path(), "photo.jpg", 300, 100);
        let after = ensure_thumbnail(&src, &cache, 64).unwrap();
        assert_ne!(small, after);
    }

    #[test]
    fn clamps_a_caller_supplied_size_into_the_thumbnail_range() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("cache");
        let src = write_jpeg(dir.path(), "photo.jpg", 4000, 4000);

        let out = ensure_thumbnail(&src, &cache, u32::MAX).unwrap();

        assert_eq!(image::open(&out).unwrap().width(), MAX_THUMB_PX);
    }

    /// 실제 사진 폴더를 상대로 파이프라인을 돌려 본다 — 앱을 띄우지 않고 "이 사진들에서
    /// 되는가, 얼마나 걸리는가"만 가른다. CI에서는 돌 수 없으니 기본은 ignore이고, 경로는
    /// 환경변수로 받는다:
    ///
    /// ```text
    /// BARAM_THUMB_BENCH_DIR=~/Documents/Baram/Journal/daily \
    ///   cargo test --lib thumbnail -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "실제 사진 폴더가 필요하다 — BARAM_THUMB_BENCH_DIR 참조"]
    fn benchmark_against_a_real_photo_directory() {
        let Ok(root) = std::env::var("BARAM_THUMB_BENCH_DIR") else {
            panic!("BARAM_THUMB_BENCH_DIR를 사진이 있는 디렉터리로 지정할 것");
        };
        let cache = tempfile::tempdir().unwrap();

        let mut photos = Vec::new();
        collect_images(Path::new(&root), &mut photos);
        photos.sort();
        assert!(!photos.is_empty(), "{root} 아래에서 이미지를 찾지 못했다");

        let mut failed = Vec::new();
        let mut total_ms = 0u128;
        let mut slowest = (0u128, String::new());
        for photo in &photos {
            let started = std::time::Instant::now();
            match ensure_thumbnail(photo, cache.path(), 320) {
                Ok(_) => {
                    let ms = started.elapsed().as_millis();
                    total_ms += ms;
                    if ms > slowest.0 {
                        slowest = (ms, photo.display().to_string());
                    }
                }
                Err(e) => failed.push(format!("{}: {e}", photo.display())),
            }
        }

        println!(
            "사진 {}장 / 실패 {} / 총 {}ms / 평균 {}ms / 최장 {}ms ({})",
            photos.len(),
            failed.len(),
            total_ms,
            total_ms / photos.len() as u128,
            slowest.0,
            slowest.1,
        );
        for f in &failed {
            println!("  실패: {f}");
        }
        assert!(
            failed.is_empty(),
            "{} 장이 썸네일을 못 만들었다",
            failed.len()
        );
    }

    fn collect_images(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_images(&path, out);
            } else if matches!(
                path.extension()
                    .and_then(|e| e.to_str())
                    .map(str::to_lowercase)
                    .as_deref(),
                Some("jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp")
            ) {
                out.push(path);
            }
        }
    }

    #[test]
    fn writes_under_a_generation_and_a_per_size_directory() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("cache");
        let src = write_jpeg(dir.path(), "photo.jpg", 200, 200);

        let out = ensure_thumbnail(&src, &cache, 320).unwrap();

        assert_eq!(out.parent().unwrap(), cache.join("v1").join("320"));
    }

    #[test]
    fn the_two_size_tiers_are_separable_by_directory() {
        // 정리 정책이 계층별로 다르므로(320px는 남기고 2048px에 상한) read_dir 한 번으로
        // 가려낼 수 있어야 한다.
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("cache");
        let src = write_jpeg(dir.path(), "photo.jpg", 4000, 4000);

        let thumb = ensure_thumbnail(&src, &cache, 320).unwrap();
        let preview = ensure_thumbnail(&src, &cache, 2048).unwrap();

        assert_eq!(thumb.parent().unwrap(), cache.join("v1").join("320"));
        assert_eq!(preview.parent().unwrap(), cache.join("v1").join("2048"));
    }

    #[test]
    fn purging_removes_old_generations_and_pre_generation_files_but_keeps_the_current_one() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("cache");
        let src = write_jpeg(dir.path(), "photo.jpg", 200, 200);
        let live = ensure_thumbnail(&src, &cache, 320).unwrap();

        // 세대 도입 전의 평평한 파일과, 이전 세대 디렉터리.
        let legacy_flat = cache.join("deadbeefdeadbeef.jpg");
        std::fs::write(&legacy_flat, b"old").unwrap();
        let old_generation = cache.join("v0").join("320");
        std::fs::create_dir_all(&old_generation).unwrap();
        std::fs::write(old_generation.join("stale.jpg"), b"old").unwrap();

        let removed = purge_stale_generations(&cache);

        assert_eq!(removed, 2);
        assert!(!legacy_flat.exists());
        assert!(!cache.join("v0").exists());
        assert!(live.is_file(), "현재 세대는 남아야 한다");
    }

    #[test]
    fn purging_a_cache_that_does_not_exist_yet_is_not_an_error() {
        let dir = tempfile::tempdir().unwrap();

        assert_eq!(purge_stale_generations(&dir.path().join("nope")), 0);
    }

    #[test]
    fn a_non_image_file_fails_instead_of_producing_a_cache_entry() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("cache");
        let src = dir.path().join("notes.jpg");
        std::fs::write(&src, b"this is not a jpeg").unwrap();

        assert!(ensure_thumbnail(&src, &cache, 64).is_err());
    }
}
