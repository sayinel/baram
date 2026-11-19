//! 이미지를 512px 타일 피라미드로 자르고 쓴다 — 레벨 크기 · 격자 계산과 인코딩.
//!
//! EXIF 방향은 호출자가 L0 에 적용해서 넘긴다. 여기서는 받은 픽셀을 그대로 자른다.

use std::path::Path;

use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::{DynamicImage, ExtendedColorType, ImageEncoder};

use super::LevelSize;
use crate::thumbnail::ThumbnailError;

/// 타일 한 변의 픽셀 수. 끝 타일은 남은 크기 그대로다.
pub(crate) const TILE_PX: u32 = 512;
/// 알파가 없는 타일의 JPEG 품질.
pub(crate) const JPEG_QUALITY: u8 = 85;

/// `write_pyramid` 가 쓴 것의 요약. manifest 는 호출자가 쓴다.
pub(crate) struct PyramidInfo {
    pub levels: Vec<LevelSize>,
    pub ext: &'static str,
    pub bytes: u64,
}

/// 레벨 0(원본)부터 두 변이 모두 `tile` 이하가 될 때까지, 매 레벨 `(n + 1) / 2` 로 줄인 크기들.
pub(crate) fn level_sizes(width: u32, height: u32, tile: u32) -> Vec<(u32, u32)> {
    let mut sizes = vec![(width, height)];
    let (mut w, mut h) = (width, height);
    while w > tile || h > tile {
        w = w.div_ceil(2);
        h = h.div_ceil(2);
        sizes.push((w, h));
    }
    sizes
}

/// 한 레벨을 덮는 타일의 (열, 행) 수.
pub(crate) fn tile_grid(width: u32, height: u32, tile: u32) -> (u32, u32) {
    (width.div_ceil(tile), height.div_ceil(tile))
}

/// 인코더가 받는 색 타입으로 L0 를 한 번 정규화한다. JPEG 인코더는 L8 · Rgb8 만 받고(image 0.25.10
/// `JpegEncoder::write_image` 의 `match color_type`), PNG 인코더는 8 · 16비트 전부 받지만
/// 타일은 8비트로 통일한다. 이미 그 타입이면 복사하지 않는다.
fn normalise(img: &DynamicImage) -> std::borrow::Cow<'_, DynamicImage> {
    use std::borrow::Cow;
    let color = img.color();
    match (color.has_alpha(), color.has_color()) {
        (false, false) => match img {
            DynamicImage::ImageLuma8(_) => Cow::Borrowed(img),
            _ => Cow::Owned(DynamicImage::ImageLuma8(img.to_luma8())),
        },
        (false, true) => match img {
            DynamicImage::ImageRgb8(_) => Cow::Borrowed(img),
            _ => Cow::Owned(DynamicImage::ImageRgb8(img.to_rgb8())),
        },
        (true, false) => match img {
            DynamicImage::ImageLumaA8(_) => Cow::Borrowed(img),
            _ => Cow::Owned(DynamicImage::ImageLumaA8(img.to_luma_alpha8())),
        },
        (true, true) => match img {
            DynamicImage::ImageRgba8(_) => Cow::Borrowed(img),
            _ => Cow::Owned(DynamicImage::ImageRgba8(img.to_rgba8())),
        },
    }
}

/// 타일 한 장을 메모리에서 인코딩한 뒤 `fs::write` 한 번으로 쓰고 그 바이트 수를 돌려준다.
///
/// 파일에 바로 인코딩하지 않는 이유: 마지막 쓰기의 오류가 사라진다. image 0.25.10 의 `JpegEncoder` 는 쓰기
/// 대상을 flush 하지 않아 `BufWriter` 의 마지막 flush 가 drop 에서 일어나고, `PngEncoder::write_image` 는 png
/// 0.18.1 의 `Writer` 를 `finish` 없이 버려 IEND 청크를 그 `Drop` 이 쓴다 — 둘 다 오류를 버린다. 그러면 잘린
/// 타일이 manifest 를 얻고 캐시에 남는다. `Vec` 에 쓰기는 실패하지 않고, 파일 쓰기의 오류는 `fs::write` 가 돌려준다.
fn write_tile(
    level_img: &DynamicImage,
    icc: Option<&[u8]>,
    has_alpha: bool,
    col: u32,
    row: u32,
    path: &Path,
) -> Result<u64, ThumbnailError> {
    let x = col * TILE_PX;
    let y = row * TILE_PX;
    let w = TILE_PX.min(level_img.width() - x);
    let h = TILE_PX.min(level_img.height() - y);
    let tile = level_img.crop_imm(x, y, w, h);
    let color = ExtendedColorType::from(tile.color());

    let mut encoded = Vec::new();
    if has_alpha {
        let mut enc = PngEncoder::new(&mut encoded);
        if let Some(icc) = icc {
            // 이 인코더는 프로필을 항상 받는다(Err 를 내지 않는다) — 무시해도 되는 결과가 아니라
            // 인코더가 거절하면 타일에 프로필이 빠지는 것이므로 오류로 올린다.
            enc.set_icc_profile(icc.to_vec())
                .map_err(image::ImageError::Unsupported)?;
        }
        enc.write_image(tile.as_bytes(), w, h, color)?;
    } else {
        let mut enc = JpegEncoder::new_with_quality(&mut encoded, JPEG_QUALITY);
        if let Some(icc) = icc {
            enc.set_icc_profile(icc.to_vec())
                .map_err(image::ImageError::Unsupported)?;
        }
        enc.write_image(tile.as_bytes(), w, h, color)?;
    }
    std::fs::write(path, &encoded)?;
    Ok(encoded.len() as u64)
}

/// `img` 를 `out/{level}/{col}_{row}.{ext}` 로 쓴다. 알파가 있으면 PNG, 없으면 JPEG q85.
/// `icc` 가 있으면 모든 타일에 싣는다. 레벨 안의 타일은 `threads` 개 스레드가 나눠 쓴다.
pub(crate) fn write_pyramid(
    img: &DynamicImage,
    icc: Option<&[u8]>,
    out: &Path,
    threads: usize,
) -> Result<PyramidInfo, ThumbnailError> {
    let base = normalise(img);
    let has_alpha = base.color().has_alpha();
    let ext = if has_alpha { "png" } else { "jpg" };
    let threads = threads.max(1);

    let sizes = level_sizes(base.width(), base.height(), TILE_PX);
    let mut levels = Vec::with_capacity(sizes.len());
    let mut bytes = 0u64;
    // 다음 레벨은 앞 레벨에서 줄인다(L0 에서 매번 줄이면 큰 사진에서 훨씬 느리다).
    let mut owned: Option<DynamicImage> = None;

    for (level, &(w, h)) in sizes.iter().enumerate() {
        if level > 0 {
            let prev: &DynamicImage = owned.as_ref().unwrap_or(&base);
            owned = Some(prev.thumbnail_exact(w, h));
        }
        let current: &DynamicImage = owned.as_ref().unwrap_or(&base);
        let dir = out.join(level.to_string());
        std::fs::create_dir_all(&dir)?;

        let (cols, rows) = tile_grid(w, h, TILE_PX);
        let coords: Vec<(u32, u32)> = (0..rows)
            .flat_map(|r| (0..cols).map(move |c| (c, r)))
            .collect();
        let per = coords.len().div_ceil(threads).max(1);

        let results: Vec<Result<u64, ThumbnailError>> = std::thread::scope(|s| {
            let handles: Vec<_> = coords
                .chunks(per)
                .map(|chunk| {
                    let dir = &dir;
                    s.spawn(move || {
                        let mut sum = 0u64;
                        for &(c, r) in chunk {
                            let path = dir.join(format!("{c}_{r}.{ext}"));
                            sum += write_tile(current, icc, has_alpha, c, r, &path)?;
                        }
                        Ok(sum)
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|h| h.join().expect("타일 쓰기 스레드가 패닉했다"))
                .collect()
        });
        for r in results {
            bytes += r?;
        }
        levels.push(LevelSize { w, h });
    }

    Ok(PyramidInfo { levels, ext, bytes })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageDecoder, Rgb, RgbImage, Rgba, RgbaImage};
    use std::collections::BTreeMap;
    use std::io::Cursor;
    use tempfile::TempDir;

    fn rgb(w: u32, h: u32) -> DynamicImage {
        DynamicImage::ImageRgb8(RgbImage::from_fn(w, h, |x, y| {
            Rgb([(x % 251) as u8, (y % 241) as u8, ((x + y) % 239) as u8])
        }))
    }

    /// 쓴 파일의 상대 경로 → 바이트.
    fn snapshot(root: &Path) -> BTreeMap<String, Vec<u8>> {
        let mut map = BTreeMap::new();
        for level in std::fs::read_dir(root).unwrap() {
            let level = level.unwrap().path();
            for f in std::fs::read_dir(&level).unwrap() {
                let f = f.unwrap().path();
                let key = format!(
                    "{}/{}",
                    level.file_name().unwrap().to_string_lossy(),
                    f.file_name().unwrap().to_string_lossy()
                );
                map.insert(key, std::fs::read(&f).unwrap());
            }
        }
        map
    }

    fn dims(bytes: &[u8]) -> (u32, u32) {
        image::load_from_memory(bytes)
            .unwrap()
            .to_rgba8()
            .dimensions()
    }

    fn jpeg_icc(bytes: &[u8]) -> Option<Vec<u8>> {
        let mut d = image::codecs::jpeg::JpegDecoder::new(Cursor::new(bytes)).unwrap();
        d.icc_profile().unwrap()
    }

    #[test]
    fn level_sizes_halve_with_ceiling_until_both_sides_fit_a_tile() {
        assert_eq!(
            level_sizes(16320, 12240, 512),
            vec![
                (16320, 12240),
                (8160, 6120),
                (4080, 3060),
                (2040, 1530),
                (1020, 765),
                (510, 383)
            ]
        );
        assert_eq!(
            level_sizes(1025, 3, 512),
            vec![(1025, 3), (513, 2), (257, 1)]
        );
        assert_eq!(level_sizes(513, 1, 512), vec![(513, 1), (257, 1)]);
        assert_eq!(level_sizes(512, 512, 512), vec![(512, 512)]);
    }

    #[test]
    fn the_test_photo_cuts_into_1025_tiles() {
        let n: u32 = level_sizes(16320, 12240, 512)
            .iter()
            .map(|&(w, h)| {
                let (c, r) = tile_grid(w, h, 512);
                c * r
            })
            .sum();
        assert_eq!(n, 1025);
    }

    #[test]
    fn writes_every_tile_with_its_edge_size() {
        let dir = TempDir::new().unwrap();
        let info = write_pyramid(&rgb(1100, 700), None, dir.path(), 2).unwrap();
        assert_eq!(info.ext, "jpg");
        assert_eq!(
            info.levels,
            vec![
                LevelSize { w: 1100, h: 700 },
                LevelSize { w: 550, h: 350 },
                LevelSize { w: 275, h: 175 }
            ]
        );
        let snap = snapshot(dir.path());
        let names: Vec<&str> = snap.keys().map(String::as_str).collect();
        assert_eq!(
            names,
            vec![
                "0/0_0.jpg",
                "0/0_1.jpg",
                "0/1_0.jpg",
                "0/1_1.jpg",
                "0/2_0.jpg",
                "0/2_1.jpg",
                "1/0_0.jpg",
                "1/1_0.jpg",
                "2/0_0.jpg"
            ]
        );
        assert_eq!(dims(&snap["0/2_1.jpg"]), (76, 188));
        assert_eq!(dims(&snap["1/1_0.jpg"]), (38, 350));
        assert_eq!(dims(&snap["2/0_0.jpg"]), (275, 175));
        assert_eq!(
            info.bytes,
            snap.values().map(|v| v.len() as u64).sum::<u64>()
        );
    }

    #[test]
    fn an_icc_profile_rides_on_every_tile() {
        let icc: Vec<u8> = (0..560u32).map(|i| (i * 7 % 256) as u8).collect();
        let dir = TempDir::new().unwrap();
        write_pyramid(&rgb(1100, 700), Some(&icc), dir.path(), 2).unwrap();
        let snap = snapshot(dir.path());
        assert_eq!(snap.len(), 9);
        for (name, bytes) in &snap {
            assert_eq!(jpeg_icc(bytes).as_deref(), Some(icc.as_slice()), "{name}");
        }
    }

    #[test]
    fn without_a_profile_no_tile_carries_one() {
        let dir = TempDir::new().unwrap();
        write_pyramid(&rgb(1100, 700), None, dir.path(), 2).unwrap();
        for (name, bytes) in &snapshot(dir.path()) {
            assert_eq!(jpeg_icc(bytes), None, "{name}");
        }
    }

    #[test]
    fn an_alpha_source_is_cut_into_png_tiles_that_keep_alpha() {
        let img = DynamicImage::ImageRgba8(RgbaImage::from_fn(600, 10, |x, y| {
            if (x, y) == (599, 0) {
                Rgba([10, 20, 30, 0])
            } else {
                Rgba([10, 20, 30, 255])
            }
        }));
        let dir = TempDir::new().unwrap();
        let info = write_pyramid(&img, None, dir.path(), 2).unwrap();
        assert_eq!(info.ext, "png");
        let tile = image::open(dir.path().join("0/1_0.png"))
            .unwrap()
            .to_rgba8();
        assert_eq!(tile.dimensions(), (88, 10));
        assert_eq!(tile.get_pixel(87, 0)[3], 0);
        assert_eq!(tile.get_pixel(0, 0)[3], 255);
    }

    #[test]
    fn sixteen_bit_and_gray_sources_are_encodable() {
        let sixteen = DynamicImage::ImageRgb16(image::ImageBuffer::from_fn(600, 20, |x, _| {
            image::Rgb([(x * 100) as u16, 0, 0])
        }));
        let gray = DynamicImage::ImageLuma8(image::GrayImage::from_fn(600, 20, |x, _| {
            image::Luma([(x % 256) as u8])
        }));
        let gray_alpha =
            DynamicImage::ImageLumaA16(image::ImageBuffer::from_fn(600, 20, |x, _| {
                image::LumaA([(x * 100) as u16, 65535])
            }));
        for (img, ext) in [(sixteen, "jpg"), (gray, "jpg"), (gray_alpha, "png")] {
            let dir = TempDir::new().unwrap();
            let info = write_pyramid(&img, None, dir.path(), 1).unwrap();
            assert_eq!(info.ext, ext);
            assert!(dir.path().join(format!("0/1_0.{ext}")).is_file());
        }
    }

    #[test]
    fn thread_count_does_not_change_the_output() {
        let img = rgb(1100, 700);
        let a = TempDir::new().unwrap();
        let b = TempDir::new().unwrap();
        let ia = write_pyramid(&img, None, a.path(), 1).unwrap();
        let ib = write_pyramid(&img, None, b.path(), 4).unwrap();
        assert_eq!(snapshot(a.path()), snapshot(b.path()));
        assert_eq!(ia.bytes, ib.bytes);
    }
}
