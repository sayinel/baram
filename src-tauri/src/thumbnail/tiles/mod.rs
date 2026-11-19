//! §397 원본 보기용 타일 피라미드 — 가로나 세로가 2048 을 넘는 사진을 512px 타일로 잘라 썸네일
//! 캐시의 현재 세대 아래(`{cache}/v2/tiles/t1/{key}/`)에 두고, 뷰어는 보이는 타일만 그린다.
//!
//! `pyramid` 가 레벨을 계산하고 타일을 쓰며, `cache` 가 임시 디렉터리 · rename · 세대 정리 · 상한을
//! 맡는다. 이 모듈은 어떤 사진이 타일을 받는지(spec D1)와 그 순서를 정한다.

pub(super) mod cache;
mod pyramid;

use std::path::Path;

use image::codecs::png::PngDecoder;
use image::codecs::webp::WebPDecoder;
use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};

use super::{checked_dimensions, decode_limits, open_decoder, source_identity, ThumbnailError};
use pyramid::{write_pyramid, TILE_PX};

/// 타일 레이아웃의 세대. 타일 크기 · 품질 · 레이아웃(manifest 의 모양 포함)을 바꾸면 올린다 — 이유는
/// `CACHE_GENERATION` 과 같고, 낡은 세대는 `cache::purge_stale` 이 지운다.
pub(crate) const TILE_GENERATION: &str = "t1";

/// 피라미드 합계의 상한(spec D4). 새 피라미드를 쓴 뒤 넘으면 마지막 사용이 오래된 것부터 지운다.
pub(crate) const TILE_CACHE_CAP_BYTES: u64 = 1 << 30;

/// 한 변이라도 이 값을 넘어야 타일을 만든다. 프런트 프리뷰 계층의 `PREVIEW_MAX_PX`
/// (`src/utils/journal/photo-thumbnail.ts`)와 같은 경계다 — 두 변 모두 이 안이면 `ensure_thumbnail` 이
/// 그 계층에서 원본 경로를 그대로 돌려주므로, 프리뷰가 곧 원본이고 타일이 더할 것이 없다.
const TILE_THRESHOLD_PX: u32 = 2048;

/// 타일 인코딩 스레드 수의 상한(spec D2 · D3).
const MAX_ENCODE_THREADS: usize = 8;

/// 한 레벨의 픽셀 크기.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LevelSize {
    pub w: u32,
    pub h: u32,
}

/// 피라미드의 `{key}/manifest.json`. `width` · `height` 는 방향을 적용한 뒤의 레벨 0 크기이고,
/// `bytes` 는 타일 파일의 합(manifest 제외 — `cache::evict_over_cap` 이 상한에 센다).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TileManifest {
    pub width: u32,
    pub height: u32,
    pub tile: u32,
    pub ext: String,
    pub levels: Vec<LevelSize>,
    pub bytes: u64,
}

/// 원본 보기가 받는 답 — 타일 피라미드, 또는 오늘의 원본 `<img>`(spec D1 밖).
/// JSON 은 `{"kind":"tiles","dir":…,"width":…,…}` · `{"kind":"original"}` 이다.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TileSet {
    Tiles {
        /// 피라미드 디렉터리의 절대 경로 — 타일은 `{dir}/{level}/{col}_{row}.{ext}`.
        dir: String,
        #[serde(flatten)]
        manifest: TileManifest,
    },
    Original,
}

/// 피라미드를 쓰기 전에 알리는 원본 크기 — 방향을 적용한 뒤의 가로 · 세로(spec D2 · D6).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct TileSize {
    pub width: u32,
    pub height: u32,
}

/// 디코드 없이 이 원본의 답을 가려 본다 — 만들어야 하면 `None`. 아무것도 쓰지 않는다(히트의 마지막 사용
/// 갱신은 제외). 블로킹 함수이고 헤더만 읽는다.
///
/// 순서 — 시험이 이 순서에 기댄다(`ensure_tiles` 가 같은 판정을 그대로 쓴다):
/// 1. 키를 짓고 캐시 히트면 그것. 형식 판정보다 먼저다 — 히트는 원본을 열지 않는다. 히트면 manifest 의
///    mtime 을 지금으로 갱신한다(마지막 사용 — `cache::evict_over_cap` 이 읽는다).
/// 2. 애니메이션(GIF 전부 · APNG · 애니메이션 WebP)이면 `Original` — 첫 프레임만 타일이 되면 움직임이
///    사라진다(spec D1).
/// 3. 헤더 크기가 `MAX_SOURCE_PIXELS` 를 넘으면 `TooLarge`, 두 변 모두 `TILE_THRESHOLD_PX` 이하면 `Original`.
/// 4. 그 밖에는 방향을 적용한 크기를 `on_size` 로 알리고 `None` 을 돌려준다 — 뷰어는 피라미드를 기다리는
///    동안 그 크기로 프리뷰를 그린다(spec D6).
///
/// 명령(`image_tiles`)이 이것을 생성 허가 **앞에서** 부른다: 타일을 받지 않을 사진의 답과 큰 사진의 크기
/// 알림이 다른 사진의 생성을 기다리지 않게 한다(spec D2).
pub fn probe_tiles(
    src: &Path,
    cache_dir: &Path,
    on_size: impl FnOnce(TileSize),
) -> Result<Option<TileSet>, ThumbnailError> {
    probe(src, &cache::tiles_root(cache_dir), on_size).map(|probed| match probed {
        Probed::Answer(set) => Some(set),
        Probed::Build { .. } => None,
    })
}

/// `probe_tiles` 가 가른 결과. `Build` 는 디코더를 쥔 채 돌려줘 `ensure_tiles` 가 같은 파일을 다시 열지 않는다.
enum Probed {
    Answer(TileSet),
    Build {
        key: String,
        decoder: Box<dyn ImageDecoder>,
        orientation: Orientation,
    },
}

fn probe(
    src: &Path,
    root: &Path,
    on_size: impl FnOnce(TileSize),
) -> Result<Probed, ThumbnailError> {
    let key = source_identity(src)?.digest(&[]);
    if let Some(cached) = hit(root, &key) {
        return Ok(Probed::Answer(cached));
    }
    if is_animated(src)? {
        return Ok(Probed::Answer(TileSet::Original));
    }

    let mut decoder = open_decoder(src)?;
    let (width, height) = checked_dimensions(decoder.as_ref())?;
    if width <= TILE_THRESHOLD_PX && height <= TILE_THRESHOLD_PX {
        return Ok(Probed::Answer(TileSet::Original));
    }

    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    on_size(if swaps_axes(orientation) {
        TileSize {
            width: height,
            height: width,
        }
    } else {
        TileSize { width, height }
    });
    Ok(Probed::Build {
        key,
        decoder,
        orientation,
    })
}

/// 원본 한 장의 타일 피라미드를 보장한다. 이미 있으면 디코드하지 않는다. 블로킹 함수다.
///
/// 판정은 `probe_tiles` 와 같은 `probe` 다(순서는 그 doc). 만들어야 하면 이어서:
/// 5. ICC 프로필을 읽고 디코드 · 방향 적용. 방향과 ICC 는 `from_decoder` 가 디코더를 소비하기 전에 읽는다.
/// 6. 임시 디렉터리에 피라미드와 manifest 를 쓰고 `{key}` 로 rename(`cache::commit_pyramid`), 상한 정리.
pub fn ensure_tiles(
    src: &Path,
    cache_dir: &Path,
    on_size: impl FnOnce(TileSize),
) -> Result<TileSet, ThumbnailError> {
    let root = cache::tiles_root(cache_dir);
    let (key, mut decoder, orientation) = match probe(src, &root, on_size)? {
        Probed::Answer(set) => return Ok(set),
        Probed::Build {
            key,
            decoder,
            orientation,
        } => (key, decoder, orientation),
    };
    let icc = decoder.icc_profile()?;
    let mut img = DynamicImage::from_decoder(decoder)?;
    img.apply_orientation(orientation);

    let threads = std::thread::available_parallelism()
        .map_or(1, |n| n.get())
        .min(MAX_ENCODE_THREADS);
    let (dir, manifest) = cache::commit_pyramid(&root, &key, |tmp| {
        let info = write_pyramid(&img, icc.as_deref(), tmp, threads)?;
        Ok(TileManifest {
            width: img.width(),
            height: img.height(),
            tile: TILE_PX,
            ext: info.ext.to_string(),
            levels: info.levels,
            bytes: info.bytes,
        })
    })?;
    // 돌려줄 피라미드(방금 썼거나, 같은 키를 먼저 끝낸 쪽)는 남긴다 — 뷰어가 곧 그 타일을 읽는다.
    cache::evict_over_cap(&root, TILE_CACHE_CAP_BYTES, &dir);
    Ok(tiles_at(&dir, manifest))
}

/// `root/{key}` 의 피라미드. 히트면 마지막 사용을 갱신한다.
///
/// manifest 를 읽지 못하면 — 없든 깨졌든 — 캐시에 없는 것이다. 그런 `{key}` 는 잔해이고(`commit_pyramid` 는
/// manifest 를 쓴 뒤에만 `{key}` 를 놓는다), 다시 지으면 `commit_pyramid` 가 그것을 비키고 새 피라미드를 놓는다.
/// 오류로 올리면 그 사진은 잔해가 다른 사진의 축출로 지워질 때까지 원본 폴백에 머문다.
fn hit(root: &Path, key: &str) -> Option<TileSet> {
    let dir = root.join(key);
    let manifest = cache::read_manifest(&dir).ok()?;
    cache::mark_used(&dir);
    Some(tiles_at(&dir, manifest))
}

fn tiles_at(dir: &Path, manifest: TileManifest) -> TileSet {
    TileSet::Tiles {
        dir: dir.to_string_lossy().into_owned(),
        manifest,
    }
}

/// 첫 프레임만 타일이 되면 움직임이 사라지는 원본인가(spec D1). 형식은 `open_decoder` 와 같은 규칙으로
/// 가린다. GIF 는 프레임 수를 보지 않고 전부, PNG 는 `acTL` 청크(APNG — `PngDecoder::is_apng`), WebP 는
/// `VP8X` 의 애니메이션 플래그(`WebPDecoder::has_animation`, image-webp 0.2.4)로 가른다. Cargo.toml 이
/// `image` 에 켠 다섯 형식 가운데 나머지 둘(JPEG · BMP)에는 애니메이션이 없다.
fn is_animated(src: &Path) -> Result<bool, ThumbnailError> {
    let reader = ImageReader::open(src)?.with_guessed_format()?;
    Ok(match reader.format() {
        Some(ImageFormat::Gif) => true,
        Some(ImageFormat::Png) => {
            PngDecoder::with_limits(reader.into_inner(), decode_limits())?.is_apng()?
        }
        Some(ImageFormat::WebP) => WebPDecoder::new(reader.into_inner())?.has_animation(),
        _ => false,
    })
}

/// 이 방향을 적용하면 가로 · 세로가 바뀌는가(90° 계열 넷). `_` 없이 모두 적는다 — `image` 가 변형을
/// 더하면 여기서 컴파일이 멈춘다.
fn swaps_axes(orientation: Orientation) -> bool {
    match orientation {
        Orientation::Rotate90
        | Orientation::Rotate270
        | Orientation::Rotate90FlipH
        | Orientation::Rotate270FlipH => true,
        Orientation::NoTransforms
        | Orientation::Rotate180
        | Orientation::FlipHorizontal
        | Orientation::FlipVertical => false,
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::collections::BTreeMap;
    use std::fs::File;
    use std::io::{BufWriter, Cursor};
    use std::path::PathBuf;
    use std::time::{Duration, Instant, UNIX_EPOCH};

    use image::codecs::gif::GifEncoder;
    use image::codecs::jpeg::{JpegDecoder, JpegEncoder};
    use image::codecs::webp::WebPEncoder;
    use image::{
        DynamicImage, ExtendedColorType, ImageDecoder, ImageEncoder, Rgb, RgbImage, Rgba, RgbaImage,
    };
    use tempfile::TempDir;

    use super::*;

    fn gradient(w: u32, h: u32) -> RgbImage {
        RgbImage::from_fn(w, h, |x, y| {
            Rgb([(x % 251) as u8, (y % 241) as u8, ((x + y) % 239) as u8])
        })
    }

    fn write_jpeg(dir: &Path, name: &str, w: u32, h: u32) -> PathBuf {
        let path = dir.join(name);
        DynamicImage::ImageRgb8(gradient(w, h)).save(&path).unwrap();
        path
    }

    /// 크기를 알리면 안 되는 호출에 넘긴다 — 불리면 시험이 그 자리에서 실패한다.
    fn no_size(size: TileSize) {
        panic!("on_size must not be called here, got {size:?}");
    }

    /// 캐시에 있는 피라미드만 본다 — 히트면 `Some(Tiles)`, 만들어야 하는 큰 원본이면 `None`.
    /// 크기 알림은 이 시험들이 묻는 것이 아니다.
    fn cached(src: &Path, cache: &Path) -> Option<TileSet> {
        probe_tiles(src, cache, |_| {}).unwrap()
    }

    fn names_in(dir: &Path) -> Vec<String> {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return Vec::new();
        };
        let mut names: Vec<String> = entries
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    fn tiles(set: TileSet) -> (String, TileManifest) {
        match set {
            TileSet::Tiles { dir, manifest } => (dir, manifest),
            TileSet::Original => panic!("expected tiles, got original"),
        }
    }

    /// 피라미드 디렉터리 안 타일 파일(`{level}/{col}_{row}.{ext}`)의 바이트 합. manifest 는 세지 않는다.
    fn tile_bytes(dir: &Path) -> u64 {
        let mut sum = 0;
        for level in std::fs::read_dir(dir).unwrap().flatten() {
            if level.file_type().unwrap().is_dir() {
                for tile in std::fs::read_dir(level.path()).unwrap().flatten() {
                    sum += tile.metadata().unwrap().len();
                }
            }
        }
        sum
    }

    /// manifest 의 레벨마다 격자의 모든 타일 `{level}/{col}_{row}.{ext}` → 바이트. 하나라도 없으면 그 자리에서 실패한다.
    fn tile_files(dir: &Path, manifest: &TileManifest) -> BTreeMap<String, Vec<u8>> {
        let mut files = BTreeMap::new();
        for (level, size) in manifest.levels.iter().enumerate() {
            let (cols, rows) = pyramid::tile_grid(size.w, size.h, manifest.tile);
            for row in 0..rows {
                for col in 0..cols {
                    let name = format!("{level}/{col}_{row}.{}", manifest.ext);
                    let bytes =
                        std::fs::read(dir.join(&name)).unwrap_or_else(|e| panic!("{name}: {e}"));
                    files.insert(name, bytes);
                }
            }
        }
        files
    }

    /// ICC 자리에 싣는 바이트 — 내용은 보지 않으니 유효한 프로필일 필요가 없고, 되읽은 바이트가 같은지만 본다.
    fn profile_bytes() -> Vec<u8> {
        (0..560u32).map(|i| (i * 7 % 256) as u8).collect()
    }

    fn set_mtime(path: &Path, when: std::time::SystemTime) {
        File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(when)
            .unwrap();
    }

    /// png 크레이트로 RGB8 PNG 를 쓴다. `frames` 가 2 이상이면 같은 그림을 그 수만큼 프레임으로
    /// 싣는 APNG(`acTL` 이 붙는다), 1 이면 정지 PNG — 둘의 차이는 애니메이션 청크뿐이다.
    fn write_png(path: &Path, w: u32, h: u32, frames: u32) {
        let mut enc = png::Encoder::new(BufWriter::new(File::create(path).unwrap()), w, h);
        enc.set_color(png::ColorType::Rgb);
        enc.set_depth(png::BitDepth::Eight);
        if frames > 1 {
            enc.set_animated(frames, 0).unwrap();
        }
        let mut writer = enc.write_header().unwrap();
        let data = gradient(w, h).into_raw();
        for _ in 0..frames {
            writer.write_image_data(&data).unwrap();
        }
        writer.finish().unwrap();
    }

    fn still_webp(w: u32, h: u32) -> Vec<u8> {
        let mut buf = Vec::new();
        WebPEncoder::new_lossless(&mut buf)
            .encode(gradient(w, h).as_raw(), w, h, ExtendedColorType::Rgb8)
            .unwrap();
        buf
    }

    fn riff_chunk(fourcc: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut chunk = fourcc.to_vec();
        chunk.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        chunk.extend_from_slice(payload);
        if payload.len() % 2 == 1 {
            chunk.push(0);
        }
        chunk
    }

    fn u24(v: u32) -> [u8; 3] {
        let b = v.to_le_bytes();
        [b[0], b[1], b[2]]
    }

    /// 정지 무손실 WebP 의 `VP8L` 청크를 애니메이션 컨테이너로 감싼다 — `VP8X`(애니메이션 플래그
    /// `0x02`, 캔버스 w x h) + `ANIM` + 그 청크를 프레임으로 싣는 `ANMF` 둘.
    fn animated_webp(w: u32, h: u32) -> Vec<u8> {
        let still = still_webp(w, h);
        assert_eq!(
            &still[12..16],
            b"VP8L",
            "the lossless encoder writes a plain VP8L file"
        );
        let frame = &still[12..];

        let mut vp8x = vec![0x02, 0, 0, 0];
        vp8x.extend_from_slice(&u24(w - 1));
        vp8x.extend_from_slice(&u24(h - 1));
        // 배경색 4바이트 + 반복 횟수(0 = 무한).
        let anim = [0u8; 6];
        let mut anmf = Vec::new();
        anmf.extend_from_slice(&u24(0)); // x / 2
        anmf.extend_from_slice(&u24(0)); // y / 2
        anmf.extend_from_slice(&u24(w - 1));
        anmf.extend_from_slice(&u24(h - 1));
        anmf.extend_from_slice(&u24(100)); // 표시 시간(ms)
        anmf.push(0); // 블렌딩 · 처분 플래그
        anmf.extend_from_slice(frame);

        let mut body = b"WEBP".to_vec();
        body.extend(riff_chunk(b"VP8X", &vp8x));
        body.extend(riff_chunk(b"ANIM", &anim));
        body.extend(riff_chunk(b"ANMF", &anmf));
        body.extend(riff_chunk(b"ANMF", &anmf));
        let mut file = b"RIFF".to_vec();
        file.extend_from_slice(&(body.len() as u32).to_le_bytes());
        file.extend(body);
        file
    }

    /// 24비트 BMP 의 파일 헤더 + BITMAPINFOHEADER, 54 바이트. 픽셀 데이터는 붙이지 않는다.
    fn bmp_header(w: i32, h: i32) -> Vec<u8> {
        let pixel_bytes = (w as u32) * 3 * (h as u32);
        let mut b = Vec::with_capacity(54);
        b.extend_from_slice(b"BM");
        b.extend_from_slice(&(54 + pixel_bytes).to_le_bytes()); // 파일 크기
        b.extend_from_slice(&0u32.to_le_bytes()); // 예약
        b.extend_from_slice(&54u32.to_le_bytes()); // 픽셀 데이터 위치
        b.extend_from_slice(&40u32.to_le_bytes()); // BITMAPINFOHEADER 크기
        b.extend_from_slice(&w.to_le_bytes());
        b.extend_from_slice(&h.to_le_bytes());
        b.extend_from_slice(&1u16.to_le_bytes()); // 평면 수
        b.extend_from_slice(&24u16.to_le_bytes()); // 픽셀당 비트
        b.extend_from_slice(&0u32.to_le_bytes()); // 압축 없음
        b.extend_from_slice(&pixel_bytes.to_le_bytes());
        b.extend_from_slice(&2835i32.to_le_bytes()); // 가로 해상도
        b.extend_from_slice(&2835i32.to_le_bytes()); // 세로 해상도
        b.extend_from_slice(&0u32.to_le_bytes()); // 팔레트 색 수
        b.extend_from_slice(&0u32.to_le_bytes()); // 중요한 색 수
        assert_eq!(b.len(), 54);
        b
    }

    /// orientation 6(90° 시계 방향) 하나만 든 빅엔디언 TIFF — `MM\0*`, IFD 0 은 오프셋 8, 항목 하나.
    fn exif_orientation_6() -> Vec<u8> {
        let mut t = b"MM\0*".to_vec();
        t.extend_from_slice(&8u32.to_be_bytes());
        t.extend_from_slice(&1u16.to_be_bytes()); // 항목 수
        t.extend_from_slice(&0x0112u16.to_be_bytes()); // Orientation
        t.extend_from_slice(&3u16.to_be_bytes()); // SHORT
        t.extend_from_slice(&1u32.to_be_bytes()); // 값 개수
        t.extend_from_slice(&6u16.to_be_bytes()); // 값
        t.extend_from_slice(&[0, 0]); // 4바이트 값 칸의 나머지
        t.extend_from_slice(&0u32.to_be_bytes()); // 다음 IFD 없음
        t
    }

    #[test]
    fn a_source_within_2048_on_both_sides_is_left_to_the_original_view() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let src = write_jpeg(dir.path(), "wide.jpg", 2048, 100);

        assert_eq!(
            ensure_tiles(&src, &cache, no_size).unwrap(),
            TileSet::Original
        );
        assert!(names_in(&cache::tiles_root(&cache)).is_empty());
    }

    /// 넘는 변이 가로인 사진과 세로인 사진(세로로 긴 휴대폰 스크린숏 — 1170x2532 같은 것 — 은 세로 쪽 조건에
    /// 걸린다). 무엇이 이것을 실패시키는가: `probe` 의 2048 판정에서 한 변의 조건을 빼는 것.
    #[test]
    fn a_source_over_2048_on_one_side_gets_tiles() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let wide = write_jpeg(dir.path(), "wide.jpg", 2049, 10);
        let tall = write_jpeg(dir.path(), "tall.jpg", 10, 2049);

        let (pyramid, manifest) = tiles(ensure_tiles(&wide, &cache, |_| {}).unwrap());

        let pyramid = Path::new(&pyramid);
        assert_eq!(
            manifest,
            TileManifest {
                width: 2049,
                height: 10,
                tile: 512,
                ext: "jpg".to_string(),
                levels: vec![
                    LevelSize { w: 2049, h: 10 },
                    LevelSize { w: 1025, h: 5 },
                    LevelSize { w: 513, h: 3 },
                    LevelSize { w: 257, h: 2 },
                ],
                bytes: tile_bytes(pyramid),
            }
        );
        assert_eq!(pyramid.parent().unwrap(), cache::tiles_root(&cache));
        assert!(pyramid.join("manifest.json").is_file());
        assert!(pyramid.join("0").join("4_0.jpg").is_file());
        assert!(pyramid.join("3").join("0_0.jpg").is_file());

        let (pyramid, manifest) = tiles(ensure_tiles(&tall, &cache, |_| {}).unwrap());

        let pyramid = Path::new(&pyramid);
        assert_eq!(
            manifest,
            TileManifest {
                width: 10,
                height: 2049,
                tile: 512,
                ext: "jpg".to_string(),
                levels: vec![
                    LevelSize { w: 10, h: 2049 },
                    LevelSize { w: 5, h: 1025 },
                    LevelSize { w: 3, h: 513 },
                    LevelSize { w: 2, h: 257 },
                ],
                bytes: tile_bytes(pyramid),
            }
        );
        assert!(pyramid.join("0").join("0_4.jpg").is_file());
        assert!(pyramid.join("3").join("0_0.jpg").is_file());
    }

    /// 원본에 실린 ICC 가 피라미드의 모든 레벨 · 모든 타일에 같은 바이트로 실린다(spec D3 · §7.1). 원본은 알파가
    /// 없는 JPEG 라 타일도 JPEG 다. 무엇이 이것을 실패시키는가: `ensure_tiles` 가 원본 디코더의 `icc_profile()` 을
    /// 버리고 `write_pyramid` 에 `None` 을 넘기는 것.
    #[test]
    fn a_jpeg_source_profile_rides_on_every_tile_of_every_level() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let src = dir.path().join("profiled.jpg");
        let icc = profile_bytes();
        let mut bytes = Vec::new();
        let mut enc = JpegEncoder::new_with_quality(&mut bytes, 90);
        enc.set_icc_profile(icc.clone()).unwrap();
        enc.write_image(gradient(3000, 2).as_raw(), 3000, 2, ExtendedColorType::Rgb8)
            .unwrap();
        std::fs::write(&src, bytes).unwrap();

        let (pyramid, manifest) = tiles(ensure_tiles(&src, &cache, |_| {}).unwrap());

        assert_eq!(manifest.ext, "jpg");
        let found = tile_files(Path::new(&pyramid), &manifest);
        assert_eq!(found.len(), 12, "6 + 3 + 2 + 1 tiles over four levels");
        for (name, tile) in &found {
            let mut decoder = JpegDecoder::new(Cursor::new(tile)).unwrap();
            assert_eq!(
                decoder.icc_profile().unwrap().as_deref(),
                Some(icc.as_slice()),
                "{name}"
            );
        }
    }

    /// 알파가 있는 원본은 PNG 타일이 되고, 원본의 `iCCP` 가 그 모든 타일에 실린다(spec D3 · §7.1). 무엇이 이것을
    /// 실패시키는가: 위 시험과 같은 것, 그리고 `write_pyramid` 의 PNG 쪽이 프로필을 인코더에 넘기지 않는 것.
    #[test]
    fn a_png_source_profile_rides_on_every_png_tile() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let src = dir.path().join("profiled.png");
        let icc = profile_bytes();
        let mut info = png::Info::with_size(3000, 2);
        info.icc_profile = Some(icc.as_slice().into());
        let mut bytes = Vec::new();
        let mut enc = png::Encoder::with_info(&mut bytes, info).unwrap();
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().unwrap();
        let pixels = RgbaImage::from_fn(3000, 2, |x, y| {
            Rgba([(x % 251) as u8, (y % 241) as u8, 30, 200])
        });
        writer.write_image_data(pixels.as_raw()).unwrap();
        writer.finish().unwrap();
        std::fs::write(&src, bytes).unwrap();

        let (pyramid, manifest) = tiles(ensure_tiles(&src, &cache, |_| {}).unwrap());

        assert_eq!(manifest.ext, "png");
        let found = tile_files(Path::new(&pyramid), &manifest);
        assert_eq!(found.len(), 12, "6 + 3 + 2 + 1 tiles over four levels");
        for (name, tile) in &found {
            let mut decoder = PngDecoder::new(Cursor::new(tile)).unwrap();
            assert_eq!(
                decoder.icc_profile().unwrap().as_deref(),
                Some(icc.as_slice()),
                "{name}"
            );
        }
    }

    #[test]
    fn a_gif_is_left_to_the_original_view() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let src = dir.path().join("strip.gif");
        let img = RgbaImage::from_pixel(3000, 2, Rgba([10, 20, 30, 255]));
        GifEncoder::new(BufWriter::new(File::create(&src).unwrap()))
            .encode(img.as_raw(), 3000, 2, ExtendedColorType::Rgba8)
            .unwrap();

        assert_eq!(
            ensure_tiles(&src, &cache, no_size).unwrap(),
            TileSet::Original
        );
        assert!(names_in(&cache::tiles_root(&cache)).is_empty());
    }

    #[test]
    fn an_apng_is_left_to_the_original_view_and_a_still_png_is_not() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let apng = dir.path().join("moving.png");
        let still = dir.path().join("still.png");
        write_png(&apng, 3000, 2, 2);
        write_png(&still, 3000, 2, 1);

        assert_eq!(
            ensure_tiles(&apng, &cache, no_size).unwrap(),
            TileSet::Original
        );
        assert!(matches!(
            ensure_tiles(&still, &cache, |_| {}).unwrap(),
            TileSet::Tiles { .. }
        ));
    }

    #[test]
    fn an_animated_webp_is_left_to_the_original_view_and_a_still_webp_is_not() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let animated = dir.path().join("moving.webp");
        let still = dir.path().join("still.webp");
        std::fs::write(&animated, animated_webp(3000, 2)).unwrap();
        std::fs::write(&still, still_webp(3000, 2)).unwrap();

        assert_eq!(
            ensure_tiles(&animated, &cache, no_size).unwrap(),
            TileSet::Original
        );
        assert!(matches!(
            ensure_tiles(&still, &cache, |_| {}).unwrap(),
            TileSet::Tiles { .. }
        ));
    }

    /// 헤더뿐인 파일이다 — 디코드까지 갔다면 픽셀이 없어 `TooLarge` 가 아닌 오류가 난다.
    #[test]
    fn a_source_over_the_pixel_cap_is_refused_before_decoding() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let src = dir.path().join("huge.bmp");
        std::fs::write(&src, bmp_header(30_000, 20_000)).unwrap();

        let result = ensure_tiles(&src, &cache, no_size);

        assert!(
            matches!(
                result,
                Err(ThumbnailError::TooLarge {
                    width: 30_000,
                    height: 20_000
                })
            ),
            "{result:?}"
        );
        assert!(names_in(&cache::tiles_root(&cache)).is_empty());
    }

    #[test]
    fn the_size_arrives_oriented_and_before_the_pyramid_is_written() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let root = cache::tiles_root(&cache);
        let src = dir.path().join("portrait.jpg");
        let img = RgbImage::from_fn(3000, 2000, |x, y| {
            if x < 8 && y < 8 {
                Rgb([255, 0, 0])
            } else {
                Rgb([0, 0, 255])
            }
        });
        let mut enc =
            JpegEncoder::new_with_quality(BufWriter::new(File::create(&src).unwrap()), 90);
        enc.set_exif_metadata(exif_orientation_6()).unwrap();
        enc.write_image(img.as_raw(), 3000, 2000, ExtendedColorType::Rgb8)
            .unwrap();

        let seen = Cell::new(None);
        let set = ensure_tiles(&src, &cache, |size| {
            let finished = names_in(&root)
                .iter()
                .any(|name| root.join(name).join("manifest.json").exists());
            seen.set(Some((size, finished)));
        })
        .unwrap();

        assert_eq!(
            seen.get(),
            Some((
                TileSize {
                    width: 2000,
                    height: 3000
                },
                false
            )),
            "the oriented size, while no finished pyramid exists"
        );
        let (pyramid, manifest) = tiles(set);
        assert_eq!((manifest.width, manifest.height), (2000, 3000));
        // 90° 시계 방향: 원본 (0, 0) 은 L0 의 (1999, 0) — 열 3(1536 부터, 폭 464)의 (463, 0) 이다.
        let tile = image::open(Path::new(&pyramid).join("0").join("3_0.jpg"))
            .unwrap()
            .to_rgb8();
        assert_eq!(tile.width(), 464);
        let px = tile.get_pixel(463, 0);
        assert!(px[0] > 200 && px[1] < 60 && px[2] < 60, "{px:?}");
    }

    #[test]
    fn a_broken_source_leaves_no_pyramid() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let src = dir.path().join("cut.bmp");
        let mut bytes = bmp_header(3000, 2);
        bytes.extend_from_slice(&[0x55; 100]); // 18000 바이트 가운데 100
        std::fs::write(&src, bytes).unwrap();

        let reached_decode = Cell::new(false);
        let result = ensure_tiles(&src, &cache, |_| reached_decode.set(true));

        assert!(result.is_err(), "{result:?}");
        assert!(
            reached_decode.get(),
            "the failure comes from decoding, after every header check passed"
        );
        assert!(names_in(&cache::tiles_root(&cache)).is_empty());
    }

    #[test]
    fn the_probe_answers_original_for_a_small_source_and_writes_nothing() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let src = dir.path().join("small.png");
        write_png(&src, 2048, 100, 1);

        assert_eq!(
            probe_tiles(&src, &cache, no_size).unwrap(),
            Some(TileSet::Original)
        );
        assert!(!cache.exists());
    }

    #[test]
    fn the_probe_announces_the_size_of_a_big_source_and_asks_for_a_build() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let src = dir.path().join("big.png");
        write_png(&src, 2049, 10, 1);

        let seen = Cell::new(None);
        let answer = probe_tiles(&src, &cache, |size| seen.set(Some(size))).unwrap();

        assert_eq!(answer, None);
        assert_eq!(
            seen.get(),
            Some(TileSize {
                width: 2049,
                height: 10
            })
        );
        assert!(names_in(&cache::tiles_root(&cache)).is_empty());
    }

    #[test]
    fn the_probe_hands_back_what_ensure_tiles_built() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let src = dir.path().join("big.png");
        write_png(&src, 2049, 10, 1);
        let built = ensure_tiles(&src, &cache, |_| {}).unwrap();
        assert!(matches!(built, TileSet::Tiles { .. }));

        assert_eq!(probe_tiles(&src, &cache, no_size).unwrap(), Some(built));
    }

    #[test]
    fn the_probe_leaves_an_animated_source_to_the_original_view() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let src = dir.path().join("anim.png");
        write_png(&src, 3000, 10, 2);

        assert_eq!(
            probe_tiles(&src, &cache, no_size).unwrap(),
            Some(TileSet::Original)
        );
    }

    /// 원본은 PNG 다 — 0 으로 덮은 `.png` 는 형식 판정(`is_animated` 의 `PngDecoder`)에서부터 실패하므로,
    /// 히트가 디코드뿐 아니라 형식 판정보다도 먼저인지 가른다. JPEG 이면 내용으로 형식을 못 가린 판정이
    /// 확장자로 넘어가 `false` 로 통과해, 그 순서를 가르지 못한다.
    #[test]
    fn a_second_call_reads_the_manifest_without_decoding() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let src = dir.path().join("photo.png");
        write_png(&src, 2049, 10, 1);
        let first = ensure_tiles(&src, &cache, |_| {}).unwrap();
        assert!(matches!(first, TileSet::Tiles { .. }));

        // 같은 길이의 0 으로 덮고 mtime 을 되돌린다 — 키는 그대로이고, 디코드하면 실패하는 파일이다.
        let meta = std::fs::metadata(&src).unwrap();
        let mtime = meta.modified().unwrap();
        std::fs::write(&src, vec![0u8; meta.len() as usize]).unwrap();
        set_mtime(&src, mtime);

        assert_eq!(cached(&src, &cache), Some(first.clone()));
        assert_eq!(ensure_tiles(&src, &cache, no_size).unwrap(), first);
    }

    #[test]
    fn a_rewritten_source_gets_a_new_pyramid() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let src = write_jpeg(dir.path(), "photo.jpg", 2049, 10);
        let (old_dir, _) = tiles(ensure_tiles(&src, &cache, |_| {}).unwrap());
        let before = std::fs::metadata(&src).unwrap().modified().unwrap();

        write_jpeg(dir.path(), "photo.jpg", 2100, 12);
        set_mtime(&src, before + Duration::from_secs(60));
        let (new_dir, manifest) = tiles(ensure_tiles(&src, &cache, |_| {}).unwrap());

        assert_ne!(old_dir, new_dir);
        assert_eq!((manifest.width, manifest.height), (2100, 12));
        assert_eq!(cached(&src, &cache).map(|set| tiles(set).0), Some(new_dir));
    }

    #[test]
    fn a_hit_refreshes_the_last_use_time() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let src = write_jpeg(dir.path(), "photo.jpg", 2049, 10);
        let (pyramid, _) = tiles(ensure_tiles(&src, &cache, |_| {}).unwrap());
        let manifest = Path::new(&pyramid).join("manifest.json");
        let long_ago = UNIX_EPOCH + Duration::from_secs(86_400);
        set_mtime(&manifest, long_ago);

        assert!(cached(&src, &cache).is_some());

        assert!(std::fs::metadata(&manifest).unwrap().modified().unwrap() > long_ago);
    }

    /// 지우다 멈춘 디렉터리처럼 manifest 없이 레벨만 남은 `{key}` — 히트가 아니고, 다시 지은 피라미드가
    /// 그 자리를 대신한다.
    #[test]
    fn a_leftover_pyramid_without_a_manifest_is_rebuilt() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let src = write_jpeg(dir.path(), "photo.jpg", 2049, 10);
        let first = ensure_tiles(&src, &cache, |_| {}).unwrap();
        let (pyramid, _) = tiles(first.clone());
        let pyramid = Path::new(&pyramid);
        std::fs::remove_file(pyramid.join("manifest.json")).unwrap();
        std::fs::remove_dir_all(pyramid.join("3")).unwrap();

        assert_eq!(cached(&src, &cache), None);
        assert_eq!(ensure_tiles(&src, &cache, |_| {}).unwrap(), first);

        assert!(pyramid.join("manifest.json").is_file());
        assert!(pyramid.join("3").join("0_0.jpg").is_file());
    }

    /// 빈 manifest(fsync 하지 않은 쓰기가 전원 차단 뒤 남길 수 있는 모양)는 오류가 아니라 캐시 없음이고,
    /// 다시 지어 고친다.
    #[test]
    fn a_zero_length_manifest_is_a_miss_and_is_rebuilt() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let src = write_jpeg(dir.path(), "photo.jpg", 2049, 10);
        let first = ensure_tiles(&src, &cache, |_| {}).unwrap();
        let (pyramid, _) = tiles(first.clone());
        let manifest = Path::new(&pyramid).join("manifest.json");
        std::fs::write(&manifest, b"").unwrap();

        assert_eq!(cached(&src, &cache), None);
        assert_eq!(ensure_tiles(&src, &cache, |_| {}).unwrap(), first);

        assert_eq!(cached(&src, &cache), Some(first));
    }

    #[test]
    fn two_spellings_of_one_file_share_one_pyramid() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let plain = write_jpeg(dir.path(), "photo.jpg", 2049, 10);
        let dotted = dir.path().join(".").join("photo.jpg");

        let (a, _) = tiles(ensure_tiles(&plain, &cache, |_| {}).unwrap());
        let (b, _) = tiles(ensure_tiles(&dotted, &cache, no_size).unwrap());

        assert_eq!(a, b);
        assert_eq!(names_in(&cache::tiles_root(&cache)).len(), 1);
    }

    /// 뷰어(다음 태스크의 TS 타입)가 읽는 모양. 무엇이 이것을 실패시키는가: `flatten` 을 빼는 것,
    /// 태그 이름이나 변형 이름의 대소문자를 바꾸는 것.
    #[test]
    fn a_tile_set_serialises_to_the_shape_the_viewer_reads() {
        let set = TileSet::Tiles {
            dir: "/cache/k".to_string(),
            manifest: TileManifest {
                width: 2049,
                height: 10,
                tile: 512,
                ext: "jpg".to_string(),
                levels: vec![LevelSize { w: 2049, h: 10 }],
                bytes: 7,
            },
        };
        assert_eq!(
            serde_json::to_value(&set).unwrap(),
            serde_json::json!({
                "kind": "tiles", "dir": "/cache/k", "width": 2049, "height": 10,
                "tile": 512, "ext": "jpg", "levels": [{ "w": 2049, "h": 10 }], "bytes": 7
            })
        );
        assert_eq!(
            serde_json::to_value(TileSet::Original).unwrap(),
            serde_json::json!({ "kind": "original" })
        );
        assert_eq!(
            serde_json::to_value(TileSize {
                width: 2000,
                height: 3000
            })
            .unwrap(),
            serde_json::json!({ "width": 2000, "height": 3000 })
        );
    }

    /// 실제 사진 한 장으로 `ensure_tiles` 의 생성 시간 · 크기를 알리기까지의 시간 · 히트 시간을 잰다 —
    /// 썸네일러의 `benchmark_against_a_real_photo_directory` 와 같은 모양. CI 에서는 돌 수 없으니
    /// 기본은 ignore 이고, 사진은 환경변수로 받는다:
    ///
    /// ```text
    /// BARAM_TILE_BENCH_SRC=~/Pictures/big.jpg \
    ///   cargo test --release --lib thumbnail::tiles -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "실제 사진이 필요하다 — BARAM_TILE_BENCH_SRC 참조"]
    fn benchmark_against_a_real_photo() {
        let Ok(src) = std::env::var("BARAM_TILE_BENCH_SRC") else {
            panic!("BARAM_TILE_BENCH_SRC 를 2048 을 넘는 사진 파일로 지정할 것");
        };
        let src = Path::new(&src);
        let cache = TempDir::new().unwrap();

        let started = Instant::now();
        let mut sized = None;
        let built = ensure_tiles(src, cache.path(), |size| {
            sized = Some((size, started.elapsed()))
        })
        .unwrap();
        let build_time = started.elapsed();

        let hit_started = Instant::now();
        let hit = ensure_tiles(src, cache.path(), no_size).unwrap();
        let hit_time = hit_started.elapsed();
        assert_eq!(hit, built);

        let (_, manifest) = tiles(built);
        let count: u32 = manifest
            .levels
            .iter()
            .map(|l| {
                let (cols, rows) = pyramid::tile_grid(l.w, l.h, manifest.tile);
                cols * rows
            })
            .sum();
        let (size, size_at) = sized.expect("a tiled photo reports its size");
        println!(
            "{}x{} · 레벨 {} · 타일 {count} · {} 바이트 · 크기 알림 {}ms · 생성 {}ms · 히트 {}ms",
            size.width,
            size.height,
            manifest.levels.len(),
            manifest.bytes,
            size_at.as_millis(),
            build_time.as_millis(),
            hit_time.as_micros() as f64 / 1000.0,
        );
    }
}
