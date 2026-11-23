//! §397 판정이 원본에서 읽는 것 — 헤더의 가로 · 세로와 EXIF 방향(`Header`).
//!
//! 판정(`probe` 둘)은 읽는 방법을 인자로 받는다. 앱 프로세스의 판정(`probe_thumbnail` · `probe_tiles`)은 헤더만 읽고
//! (`read_header`), 만드는 쪽(자식의 `ensure_thumbnail` · `ensure_tiles`)은 그대로 디코드할 디코더를 연다(`open_decoder`) —
//! 픽셀 수 상한을 잰 그 디코더로 디코드한다. 판정의 순서와 경계는 두 쪽이 같은 함수다.
//!
//! 왜 JPEG 만 따로 읽는가: image 0.25.10 의 `JpegDecoder::new` 는 헤더를 보기 전에 압축 파일 전체를 `Vec` 에 담는다
//! (`read_to_end` — 디코드할 때 그 버퍼를 쓴다). 앱의 판정은 그 디코더를 곧 버리고, 해제된 버퍼를 macOS malloc 의
//! large cache 가 쥐어 앱의 phys_footprint 에 남았다(측정은 `child` 의 모듈 doc). 여기서는 image 가 부르는 바로 그 함수,
//! zune-jpeg 의 `decode_headers` 를 같은 옵션으로 파일에서 직접 부른다 — SOS 마커(스캔 데이터의 시작)를 읽고 멈춘다.
//!
//! 나머지 네 형식(PNG · GIF · WebP · BMP)은 image 의 디코더를 그대로 연다. 메타데이터가 없는 합성 원본(4 MiB 이상)에서 두 판정의
//! 가장 큰 할당이 1 MiB 미만인 것을 `tests/probe_allocations.rs` 가 다섯 형식 모두로 잰다(GIF 는 썸네일 판정만 — 타일 판정은
//! GIF 를 디코더 없이 원본으로 답한다).
//!
//! 픽셀 데이터 앞의 메타데이터는 판정도 읽는다. 그것이 크면 판정의 할당도 크다 — 재지 않았고, 소스에서 읽은 경우가 둘이다:
//! JPEG 의 확장 XMP(zune-jpeg 0.5.15 가 그 APP1 들을 총 크기만큼의 `Vec` 하나로 다시 잇는다 — `reassemble_extended_xmp`)와
//! PNG 의 첫 IDAT 앞 텍스트 청크(image 0.25.10 이 `set_ignore_text_chunk(false)` 로 열어 png 가 청크를 통째로 담는다).

use std::io::{BufRead, Seek};
use std::path::Path;

use image::error::{
    DecodingError, ImageError, LimitError, LimitErrorKind, UnsupportedError, UnsupportedErrorKind,
};
use image::metadata::Orientation;
use image::{ImageDecoder, ImageFormat};
use zune_jpeg::errors::DecodeErrors;
use zune_jpeg::zune_core::options::DecoderOptions;

use super::{decoder_with_limits, guessed_reader, ThumbnailError};

/// 판정이 원본에서 읽는 것. 메서드 이름이 `ImageDecoder` 의 것과 다른 이유: `Box<dyn ImageDecoder>` 가 둘을 다 구현하므로
/// 같은 이름이면 두 트레이트가 함께 보이는 자리(`scale`)에서 호출이 모호해진다.
pub(super) trait Header {
    /// 헤더의 가로 · 세로 — 방향을 적용하기 전.
    fn size(&self) -> (u32, u32);
    /// EXIF 방향. 읽지 못하면 변형 없음 — 디코드하는 쪽이 늘 그렇게 읽어 왔다(`scale` · `ensure_tiles`).
    fn exif_orientation(&mut self) -> Orientation;
}

impl Header for Box<dyn ImageDecoder> {
    fn size(&self) -> (u32, u32) {
        self.as_ref().dimensions()
    }

    fn exif_orientation(&mut self) -> Orientation {
        self.as_mut()
            .orientation()
            .unwrap_or(Orientation::NoTransforms)
    }
}

/// 앱 프로세스의 판정이 읽은 헤더. 디코드하지 않는다 — 만드는 것은 자식이 `open_decoder` 로 다시 연다.
pub(super) enum HeaderOnly {
    /// JPEG — SOS 마커까지만 읽은 것(`jpeg_header`).
    Jpeg {
        width: u32,
        height: u32,
        orientation: Orientation,
    },
    /// 나머지 형식 — image 의 디코더. 헤더를 읽으려고 열 뿐 픽셀은 디코드하지 않는다.
    Other(Box<dyn ImageDecoder>),
}

impl Header for HeaderOnly {
    fn size(&self) -> (u32, u32) {
        match self {
            HeaderOnly::Jpeg { width, height, .. } => (*width, *height),
            HeaderOnly::Other(decoder) => decoder.size(),
        }
    }

    fn exif_orientation(&mut self) -> Orientation {
        match self {
            HeaderOnly::Jpeg { orientation, .. } => *orientation,
            HeaderOnly::Other(decoder) => decoder.exif_orientation(),
        }
    }
}

/// 원본의 헤더를 읽는다. 형식은 `open_decoder` 와 같은 규칙으로 가린다(`guessed_reader` — 내용, 못 가리면 확장자).
pub(super) fn read_header(src: &Path) -> Result<HeaderOnly, ThumbnailError> {
    let reader = guessed_reader(src)?;
    if reader.format() == Some(ImageFormat::Jpeg) {
        let (width, height, orientation) = jpeg_header(reader.into_inner())?;
        return Ok(HeaderOnly::Jpeg {
            width,
            height,
            orientation,
        });
    }
    Ok(HeaderOnly::Other(decoder_with_limits(reader)?))
}

/// JPEG 의 가로 · 세로와 EXIF 방향을 SOS 마커까지 읽어 얻는다. 옵션과 방향 읽기, 오류의 모양(`jpeg_error`)은 image
/// 0.25.10 의 `JpegDecoder` 가 하는 그대로다 — 읽기 오류 없이 읽히는 파일에는 `open_decoder` 와 같은 답을 낸다(이 모듈의
/// 시험이 견준다). 읽기 오류에서는 갈린다: 디코더는 파일 전체를 읽으므로 SOS 뒤의 읽기 오류도 판정의 오류(`ImageError::IoError`)가 되지만,
/// 여기서는 그 파일을 만들어야 하는 사진으로 가르고(타일이면 크기도 알린다) 자식의 디코드가 실패한다. SOS 앞의 읽기 오류는
/// `Decoding` 이 된다(zune-jpeg 가 그것을 자기 오류로 싸서 돌려준다).
fn jpeg_header<R: BufRead + Seek>(reader: R) -> Result<(u32, u32, Orientation), ThumbnailError> {
    let options = DecoderOptions::default()
        .set_strict_mode(false)
        .set_max_width(usize::MAX)
        .set_max_height(usize::MAX);
    let mut decoder = zune_jpeg::JpegDecoder::new_with_options(reader, options);
    decoder.decode_headers().map_err(jpeg_error)?;
    // `decode_headers` 가 성공하면 크기는 있다(zune-jpeg 의 doc). JPEG 의 크기는 16비트라 u32 로 늘 들어간다.
    let not_decoded = || jpeg_error(DecodeErrors::FormatStatic("JPEG headers carry no size"));
    let (width, height) = decoder.dimensions().ok_or_else(not_decoded)?;
    let width = u32::try_from(width).map_err(|_| not_decoded())?;
    let height = u32::try_from(height).map_err(|_| not_decoded())?;
    let orientation = decoder
        .exif()
        .and_then(|exif| Orientation::from_exif_chunk(exif))
        .unwrap_or(Orientation::NoTransforms);
    Ok((width, height, orientation))
}

/// image 0.25.10 의 `ImageError::from_jpeg` 를 그대로 옮긴 대응. 앞의 두 갈래는 zune-jpeg 0.5.15 에서 나지 않는다 — 그 소스에서
/// `LargeDimensions` 를 만드는 곳이 없고, `Unsupported` 를 만드는 `Marker::SOF(3..)` 는 `Marker::from_u8` 이 내지 않는다(SOF3 같은
/// 마커는 모르는 마커로 건너뛴다). 옮겨 둔 것은 zune-jpeg 가 그 갈래를 살려도 디코더와 같은 오류가 되게 하려는 것이다.
fn jpeg_error(err: DecodeErrors) -> ThumbnailError {
    ThumbnailError::Decode(match err {
        DecodeErrors::Unsupported(desc) => {
            ImageError::Unsupported(UnsupportedError::from_format_and_kind(
                ImageFormat::Jpeg.into(),
                UnsupportedErrorKind::GenericFeature(format!("{desc:?}")),
            ))
        }
        DecodeErrors::LargeDimensions(_) => {
            ImageError::Limits(LimitError::from_kind(LimitErrorKind::DimensionError))
        }
        err => ImageError::Decoding(DecodingError::new(ImageFormat::Jpeg.into(), err)),
    })
}

/// 시험용 JPEG — 이 모듈과 두 판정의 시험이 함께 쓴다.
#[cfg(test)]
pub(super) mod fixtures {
    use image::codecs::jpeg::JpegEncoder;
    use image::{ExtendedColorType, ImageEncoder};

    /// `w` x `h` 의 RGB JPEG 바이트. `exif` 가 있으면 APP1 에 싣는다. 픽셀은 시드에서 나온 잡음이라 압축이 거의 되지 않는다 —
    /// 파일 크기가 픽셀 수를 따라간다.
    pub fn jpeg(w: u32, h: u32, exif: Option<Vec<u8>>) -> Vec<u8> {
        let mut state = 0x2545_f491_u32;
        let pixels: Vec<u8> = (0..w * h * 3)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                (state >> 24) as u8
            })
            .collect();
        let mut bytes = Vec::new();
        let mut enc = JpegEncoder::new_with_quality(&mut bytes, 90);
        if let Some(exif) = exif {
            enc.set_exif_metadata(exif).unwrap();
        }
        enc.write_image(&pixels, w, h, ExtendedColorType::Rgb8)
            .unwrap();
        bytes
    }

    /// orientation 하나만 든 빅엔디언 TIFF — `MM\0*`, IFD 0 은 오프셋 8, 항목 하나.
    pub fn exif_orientation(value: u16) -> Vec<u8> {
        let mut t = b"MM\0*".to_vec();
        t.extend_from_slice(&8u32.to_be_bytes());
        t.extend_from_slice(&1u16.to_be_bytes()); // 항목 수
        t.extend_from_slice(&0x0112u16.to_be_bytes()); // Orientation
        t.extend_from_slice(&3u16.to_be_bytes()); // SHORT
        t.extend_from_slice(&1u32.to_be_bytes()); // 값 개수
        t.extend_from_slice(&value.to_be_bytes());
        t.extend_from_slice(&[0, 0]); // 4바이트 값 칸의 나머지
        t.extend_from_slice(&0u32.to_be_bytes()); // 다음 IFD 없음
        t
    }

    /// 첫 `FF xx` 마커의 위치. 엔트로피 데이터 안의 `FF` 는 `FF 00` 으로 채워지므로 SOS 앞의 마커는 헤더 안에서만 찾는다.
    pub fn marker_at(bytes: &[u8], marker: u8) -> usize {
        bytes
            .windows(2)
            .position(|pair| pair == [0xFF, marker])
            .unwrap_or_else(|| panic!("no FF{marker:02X} marker"))
    }

    /// SOF0 의 가로 · 세로를 바꿔 쓴다 — 스캔 데이터는 그대로라 디코드하면 깨지지만 헤더는 그 크기를 말한다.
    pub fn with_sof_size(mut bytes: Vec<u8>, w: u16, h: u16) -> Vec<u8> {
        // FF C0 · 길이 2 · 정밀도 1 · 세로 2 · 가로 2
        let at = marker_at(&bytes, 0xC0);
        bytes[at + 5..at + 7].copy_from_slice(&h.to_be_bytes());
        bytes[at + 7..at + 9].copy_from_slice(&w.to_be_bytes());
        bytes
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::io::{BufReader, Cursor, Read};
    use std::path::PathBuf;

    use image::codecs::jpeg::JpegDecoder;
    use image::{DynamicImage, GrayImage};
    use tempfile::TempDir;

    use super::fixtures::{exif_orientation, jpeg, marker_at, with_sof_size};
    use super::*;
    use crate::thumbnail::open_decoder;

    /// 읽힌 가장 먼 위치를 기록한다.
    struct Furthest<'a> {
        inner: Cursor<&'a [u8]>,
        reached: &'a Cell<u64>,
    }

    impl Read for Furthest<'_> {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            let n = self.inner.read(buf)?;
            self.reached
                .set(self.reached.get().max(self.inner.position()));
            Ok(n)
        }
    }

    impl Seek for Furthest<'_> {
        fn seek(&mut self, pos: std::io::SeekFrom) -> std::io::Result<u64> {
            self.inner.seek(pos)
        }
    }

    fn write(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }

    /// JPEG 헤더는 SOS 세그먼트까지만 읽는다 — 가장 멀리 읽은 위치가 그 세그먼트의 끝에 `BufReader` 한 번의 채움을 더한
    /// 것을 넘지 않는다(seek 마다 버퍼를 비우고 다시 채우므로 읽은 총량이 아니라 위치를 잰다). 짝: 같은 기록으로 image 의
    /// `JpegDecoder::new` 는 파일 끝까지 읽는다 — 이 기록이 그 결함을 본다는 것. 무엇이 이것을 실패시키는가: `jpeg_header` 가
    /// 파일을 `Vec` 에 다 읽은 뒤 해석하는 것.
    #[test]
    fn a_jpeg_header_is_read_up_to_the_start_of_scan() {
        const FILL: usize = 8 * 1024;
        let bytes = jpeg(1200, 900, None);
        assert!(bytes.len() > 1 << 20, "{} bytes", bytes.len());
        // FF DA · 길이 2(길이 칸 포함) · 내용
        let sos = marker_at(&bytes, 0xDA);
        let sos_end = sos + 2 + usize::from(u16::from_be_bytes([bytes[sos + 2], bytes[sos + 3]]));

        let reached = Cell::new(0);
        let reader = BufReader::with_capacity(
            FILL,
            Furthest {
                inner: Cursor::new(&bytes),
                reached: &reached,
            },
        );
        assert_eq!(
            jpeg_header(reader).unwrap(),
            (1200, 900, Orientation::NoTransforms)
        );
        assert!(
            reached.get() <= (sos_end + FILL) as u64,
            "reached {} of {}, the scan starts at {sos_end}",
            reached.get(),
            bytes.len()
        );

        let whole = Cell::new(0);
        let reader = BufReader::with_capacity(
            FILL,
            Furthest {
                inner: Cursor::new(&bytes),
                reached: &whole,
            },
        );
        JpegDecoder::new(reader).unwrap();
        assert_eq!(whole.get(), bytes.len() as u64);
    }

    /// 헤더만 읽은 답과 디코드할 디코더의 답이 같다 — 크기와 방향. 방향은 EXIF 가 없는 것 · 있으나 방향이 없는 것 · 90° ·
    /// 180°, 그리고 회색조 JPEG. 무엇이 이것을 실패시키는가: `jpeg_header` 가 EXIF 를 읽지 않거나 다른 APP1 을 읽는 것,
    /// 크기의 가로 · 세로를 바꾸는 것.
    #[test]
    fn the_header_answers_what_the_decoder_answers() {
        let dir = TempDir::new().unwrap();
        let no_orientation = {
            // 항목이 방향이 아닌 TIFF(0x010F = Make).
            let mut t = exif_orientation(1);
            t[10..12].copy_from_slice(&0x010Fu16.to_be_bytes());
            t
        };
        let gray = dir.path().join("gray.jpg");
        DynamicImage::ImageLuma8(GrayImage::from_fn(300, 200, |x, _| image::Luma([x as u8])))
            .save(&gray)
            .unwrap();
        let cases = [
            write(dir.path(), "plain.jpg", &jpeg(300, 200, None)),
            write(
                dir.path(),
                "make.jpg",
                &jpeg(300, 200, Some(no_orientation)),
            ),
            write(
                dir.path(),
                "rot90.jpg",
                &jpeg(300, 200, Some(exif_orientation(6))),
            ),
            write(
                dir.path(),
                "rot180.jpg",
                &jpeg(300, 200, Some(exif_orientation(3))),
            ),
            gray,
        ];

        let mut seen = Vec::new();
        for path in &cases {
            let mut header = read_header(path).unwrap();
            assert!(
                matches!(header, HeaderOnly::Jpeg { .. }),
                "{}",
                path.display()
            );
            let mut decoder = open_decoder(path).unwrap();
            let answer = (header.size(), header.exif_orientation());
            assert_eq!(
                answer,
                (decoder.size(), decoder.exif_orientation()),
                "{}",
                path.display()
            );
            seen.push(answer.1);
        }
        assert_eq!(
            seen,
            [
                Orientation::NoTransforms,
                Orientation::NoTransforms,
                Orientation::Rotate90,
                Orientation::Rotate180,
                Orientation::NoTransforms,
            ]
        );
    }

    /// 읽지 못하는 JPEG 에는 디코더와 같은 오류를 낸다 — JPEG 이 아닌 내용의 `.jpg`, SOI 뒤에서 잘린 파일, 무손실 SOF3(zune-jpeg
    /// 0.5.15 는 모르는 마커로 건너뛰고 SOF 없이 SOS 에 닿는다). 무엇이 이것을 실패시키는가: `jpeg_error` 가 image 와 다른 변형이나
    /// 다른 형식 힌트로 옮기는 것.
    #[test]
    fn an_unreadable_jpeg_fails_as_the_decoder_fails() {
        let dir = TempDir::new().unwrap();
        let good = jpeg(64, 64, None);
        let mut lossless = good.clone();
        let sof = marker_at(&lossless, 0xC0);
        lossless[sof + 1] = 0xC3;
        let cases = [
            write(dir.path(), "notes.jpg", b"this is not a jpeg"),
            write(dir.path(), "cut.jpg", &good[..40]),
            write(dir.path(), "lossless.jpg", &lossless),
        ];

        for path in &cases {
            let header = read_header(path).err().map(|e| e.to_string());
            let decoder = open_decoder(path).err().map(|e| e.to_string());
            assert!(header.is_some(), "{}", path.display());
            assert_eq!(header, decoder, "{}", path.display());
        }
    }

    /// JPEG 이 아닌 형식은 image 의 디코더로 읽는다.
    #[test]
    fn a_png_is_read_through_the_image_decoder() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("p.png");
        DynamicImage::ImageLuma8(GrayImage::new(30, 20))
            .save(&path)
            .unwrap();

        let header = read_header(&path).unwrap();

        assert!(matches!(header, HeaderOnly::Other(_)));
        assert_eq!(header.size(), (30, 20));
    }

    /// 헤더가 말하는 크기를 그대로 읽는다 — 스캔 데이터가 그 크기에 맞지 않아도. 판정의 픽셀 수 상한이 디코드 전에 걸리는
    /// 근거다(두 판정의 `TooLarge` 시험).
    #[test]
    fn the_size_is_the_one_the_frame_header_states() {
        let dir = TempDir::new().unwrap();
        let path = write(
            dir.path(),
            "huge.jpg",
            &with_sof_size(jpeg(16, 16, None), 30_000, 20_000),
        );

        assert_eq!(read_header(&path).unwrap().size(), (30_000, 20_000));
    }

    /// 이 헤더 읽기와 image 의 디코더가 같은 zune-jpeg 다. 무엇이 이것을 실패시키는가: `image` 가 다른 zune-jpeg 로
    /// 올라갔는데 `Cargo.toml` 의 `zune-jpeg` 줄을 그대로 둔 것 — lock 에 두 벌이 생기고, 판정과 디코드가 다른 파서가 된다.
    #[test]
    fn the_lock_holds_one_zune_jpeg() {
        let lock =
            std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.lock"))
                .unwrap();
        let copies = lock
            .lines()
            .filter(|line| *line == "name = \"zune-jpeg\"")
            .count();
        assert_eq!(copies, 1);
    }
}
