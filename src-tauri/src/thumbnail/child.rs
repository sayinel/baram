//! §397 썸네일 생성(`ensure_thumbnail`)을 짧게 사는 자식 프로세스에서 한다. `photo_thumbnail` 명령(부모)은 앱
//! 프로세스에서 픽셀 디코드 없는 판정(`probe_thumbnail`)으로 캐시 히트와 이미 작은 원본을 답하고, 만들어야 하는 사진만 같은
//! 실행 파일을 이 모드로 띄워 맡긴다(`ensure_thumbnail_via_child`). 종료 코드 · 자식의 수명 · 띄우기는 타일 자식과 함께
//! 쓰는 `child_process` 에 있다(그 모듈 doc).
//!
//! 왜 자식인가: 썸네일은 원본을 통째로 디코드하고, 해제한 디코드 버퍼를 macOS malloc 의 large cache 가 쥐어
//! phys_footprint(활성 상태 보기가 보이는 값)에 남긴다. release 시험 프로세스(macOS 26.6.2)에서 16320x12240 JPEG 의
//! 2048 px 썸네일 직후 phys_footprint 는 634 MB, malloc 의 사용 중 메모리는 0.1 MB 였다. 그 634 MB 가 1초 간격 표본에서
//! 26 · 34 · 58 초 동안 그대로였고(세 회차), 내려간 뒤에도 62 MB 가 180 초 창 끝까지 남은 회차가 둘이다. 4032x3024
//! JPEG 50장을 둘씩 320 px 로 만든 뒤에는 78 MB 가 64 초, 다른 회차에서는 90 초 창 끝까지 그대로였다. 전역
//! `MallocLargeCache=0` 은 앱 전체의 큰 할당에 걸리므로 쓰지 않는다. Linux · Windows 는 재지 않았다.
//!
//! 부모에 남는 것은 판정이다 — 원본의 헤더를 디코드하고, JPEG 이면 압축 파일 전체를 읽는다(image 0.25 의
//! `JpegDecoder::new`). 같은 측정을 시험 프로세스가 부모로서 `ensure_thumbnail_via_child` 로 돌면 위 2048 px 직후 phys_footprint 는
//! 42.0 MB 였고, 그 몫은 판정이 읽고 해제한 압축 파일(39.7 MiB)이다(`MALLOC_LARGE (empty)` 39.7 MB). 위 갤러리 뒤에는
//! 7.2–7.3 MB 였다(세 회차). 그 갤러리의 시간은 1.20–1.25 초로, 같은 프로세스에서 만들 때(1.03–1.05 초)보다 길다.
//!
//! 만들어야 하는 사진은 판정을 두 번 한다: 부모가 한 번, 자식의 `ensure_thumbnail` 이 다시 한 번 — 자식은 부모를 믿지
//! 않고 캐시 히트와 픽셀 수 상한부터 다시 본다.
//!
//! argv 는 `{exe} --internal-build-thumbnail {원본} {캐시 디렉터리} {max_px}`, 답(종료 코드 0 의 stdout)은 썸네일 경로의
//! JSON 문자열. 끝나는 자식이 남길 수 있는 것은 둘이다 — `write_atomic` 의 임시 파일(쓰는 도중이나 rename 전에 끝난
//! 경우)과 `create_dir_all` 이 만든 빈 크기 디렉터리. 부모는 둘 다 지우지 않는다. 앱 안에서 만들던 때도 그 사이에 앱이
//! 끝나면 같은 것이 남았다.

use std::ffi::{OsStr, OsString};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use super::child_process::{args_after, run_in_child, serve, watch_parent, ChildError};
use super::{ensure_thumbnail, probe_thumbnail, ThumbnailError};

/// 자식 모드의 argv[1]. `main` 이 `cli::mode_for` 보다 **먼저** 이 글자와 견준다 — 이유는 타일 자식의 `CHILD_FLAG` 와
/// 같다(`tiles::child`).
///
/// ‼️ 프로토콜(인자 · 종료 코드 · 답의 모양)의 뜻을 바꾸면 이 글자도 바꾼다. 앱이 실행 중에 번들이 바뀌면(업데이트를
/// 설치하고 다시 시작하기 전) `own_executable()` 이 새 바이너리를 가리켜 옛 부모가 새 자식을 띄울 수 있다(macOS 의 경우다.
/// Linux 는 실행 중인 파일을 띄운다 — `child_process::own_executable`). 글자가 다르면 새
/// 자식은 그 argv 를 CLI 로 보내 사용법 오류(2)로 끝나고, 옛 부모는 비정상 종료로 읽어 프런트엔드가 원본으로 돌아간다.
pub const THUMBNAIL_FLAG: &str = "--internal-build-thumbnail";

/// `ensure_thumbnail_via_child` 의 실패 — 이 프로세스의 판정에서 났거나 자식에서 났다. `Display` 는 각 오류의 것
/// 그대로라, 명령의 `Err` 문자열은 앱 안에서 만들던 때와 같다(판정 실패와 자식의 `Build`).
#[derive(Debug, thiserror::Error)]
pub enum ViaChildError {
    #[error(transparent)]
    Probe(#[from] ThumbnailError),
    #[error(transparent)]
    Child(#[from] ChildError),
}

/// 부모 쪽 전부 — `photo_thumbnail` 명령의 블로킹 본체다. 판정은 이 프로세스에서(`probe_thumbnail`), 만들기는
/// 자식에서(`build_thumbnail_in_child`). `exe` 는 만들어야 할 때만 부른다 — 캐시 히트와 이미 작은 원본은 프로세스를
/// 띄우지 않는다.
pub fn ensure_thumbnail_via_child(
    src: &Path,
    cache_dir: &Path,
    max_px: u32,
    exe: impl FnOnce() -> io::Result<PathBuf>,
) -> Result<PathBuf, ViaChildError> {
    if let Some(path) = probe_thumbnail(src, cache_dir, max_px)? {
        return Ok(path);
    }
    let exe = exe().map_err(ChildError::Spawn)?;
    Ok(build_thumbnail_in_child(&exe, src, cache_dir, max_px)?)
}

/// `exe` 를 자식 모드로 띄워 `src` 의 썸네일을 `cache_dir` 에 만들게 하고, 자식이 끝날 때까지 기다려 그 경로를 돌려준다.
/// 블로킹 함수다. 판정 · 생성은 자식의 `ensure_thumbnail` 이 한다.
pub fn build_thumbnail_in_child(
    exe: &Path,
    src: &Path,
    cache_dir: &Path,
    max_px: u32,
) -> Result<PathBuf, ChildError> {
    let max_px = max_px.to_string();
    run_in_child(
        exe,
        THUMBNAIL_FLAG,
        &[src.as_os_str(), cache_dir.as_os_str(), OsStr::new(&max_px)],
        |_| {},
    )
}

/// 자식 쪽: argv[1] 이 `THUMBNAIL_FLAG` 면 썸네일을 만들고 종료 코드를 돌려준다. 아니면 `None` — 그 argv 는 다른 모드의
/// 것이다. `main` 이 GUI · CLI 를 가르기 전에 부른다. tauri 도 로거도 시작하지 않는다.
pub fn run_if_requested(args: &[OsString]) -> Option<i32> {
    let rest = args_after(args, THUMBNAIL_FLAG)?;
    Some(run(
        rest,
        &mut io::stdout().lock(),
        &mut io::stderr().lock(),
        watch_parent,
    ))
}

/// 자식 모드의 본체 — `rest` 는 플래그 뒤의 argv. 공용 본체(`serve`)에 argv 의 모양과 `ensure_thumbnail` 을 넘긴다.
/// `max_px` 가 `u32` 로 읽히지 않으면 사용법 오류다. 범위 밖의 값은 `ensure_thumbnail` 이 묶는다.
fn run(
    rest: &[OsString],
    out: &mut impl Write,
    err: &mut impl Write,
    on_start: impl FnOnce(),
) -> i32 {
    let parsed = match rest {
        [src, cache_dir, max_px] => max_px
            .to_str()
            .and_then(|px| px.parse::<u32>().ok())
            .map(|px| (Path::new(src), Path::new(cache_dir), px)),
        _ => None,
    };
    serve(
        parsed,
        &format!("usage: baram {THUMBNAIL_FLAG} <source> <cache dir> <max px>"),
        out,
        err,
        on_start,
        |(src, cache_dir, max_px)| ensure_thumbnail(src, cache_dir, max_px),
    )
}

#[cfg(test)]
mod tests {
    use image::{DynamicImage, Rgb, RgbImage};
    use tempfile::TempDir;

    use super::super::child_process::{EXIT_BUILD_FAILED, EXIT_USAGE};
    use super::*;

    fn args(parts: &[&str]) -> Vec<OsString> {
        parts.iter().map(OsString::from).collect()
    }

    fn jpeg(dir: &Path, name: &str, w: u32, h: u32) -> PathBuf {
        let path = dir.join(name);
        DynamicImage::ImageRgb8(RgbImage::from_fn(w, h, |x, y| {
            Rgb([(x % 251) as u8, (y % 241) as u8, 90])
        }))
        .save(&path)
        .unwrap();
        path
    }

    /// 헤더는 3000x2 인데 픽셀이 모자란 BMP — 헤더 판정을 모두 지나 디코드에서 실패한다.
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
        std::fs::write(&path, b).unwrap();
        path
    }

    fn no_child() -> io::Result<PathBuf> {
        panic!("this answer spawns no child")
    }

    /// 인자 수가 셋이 아니거나 `max_px` 가 `u32` 로 읽히지 않으면 사용법 오류이고, 부모 감시를 시작하지 않는다.
    #[test]
    fn a_child_without_a_source_a_cache_dir_and_a_size_is_a_usage_error() {
        for rest in [
            args(&[]),
            args(&["/a.jpg", "/c"]),
            args(&["/a.jpg", "/c", "320", "x"]),
            args(&["/a.jpg", "/c", "big"]),
            args(&["/a.jpg", "/c", "-1"]),
            args(&["/a.jpg", "/c", "4294967296"]),
        ] {
            let (mut out, mut err) = (Vec::new(), Vec::new());

            let code = run(&rest, &mut out, &mut err, || {
                panic!("a usage error starts no watch on the parent")
            });

            assert_eq!(code, EXIT_USAGE, "{rest:?}");
            assert!(out.is_empty());
            assert!(String::from_utf8(err).unwrap().contains(THUMBNAIL_FLAG));
        }
    }

    /// stdout 의 JSON 이 캐시에 놓인 썸네일의 경로다 — 부모는 이것만 읽는다. 무엇이 이것을 실패시키는가: 답이 캐시가
    /// 아닌 경로인 것, `max_px` 를 argv 에서 다른 값으로 읽는 것(다른 계층 디렉터리), 부모 감시를 만들기 뒤에 시작하는 것.
    #[test]
    fn a_built_thumbnail_is_answered_on_stdout_as_the_cache_holds_it() {
        let dir = TempDir::new().unwrap();
        let cache_dir = dir.path().join("cache");
        let src = jpeg(dir.path(), "big.jpg", 800, 400);
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let watched_before_the_build = std::cell::Cell::new(None);

        let code = run(
            &[src.clone().into(), cache_dir.clone().into(), "256".into()],
            &mut out,
            &mut err,
            || watched_before_the_build.set(Some(!cache_dir.exists())),
        );

        assert_eq!(code, 0, "{}", String::from_utf8_lossy(&err));
        assert_eq!(
            watched_before_the_build.get(),
            Some(true),
            "the watch on the parent starts once, before the build"
        );
        let answered: PathBuf = serde_json::from_slice(&out).unwrap();
        assert_eq!(
            probe_thumbnail(&src, &cache_dir, 256).unwrap(),
            Some(answered.clone())
        );
        assert_eq!(image::open(&answered).unwrap().width(), 256);
    }

    /// 실패의 문장은 같은 프로세스에서 `ensure_thumbnail` 이 낼 문장과 한 글자도 다르지 않다 — 명령의 `Err` 와 로그가
    /// 자식으로 옮기기 전과 같다.
    #[test]
    fn a_failed_build_reports_the_thumbnailers_own_message() {
        let dir = TempDir::new().unwrap();
        let src = broken_bmp(dir.path());
        let expected = ensure_thumbnail(&src, &dir.path().join("other"), 320)
            .unwrap_err()
            .to_string();
        let (mut out, mut err) = (Vec::new(), Vec::new());

        let code = run(
            &[src.into(), dir.path().join("cache").into(), "320".into()],
            &mut out,
            &mut err,
            || {},
        );

        assert_eq!(code, EXIT_BUILD_FAILED);
        assert!(out.is_empty());
        assert_eq!(String::from_utf8(err).unwrap(), format!("{expected}\n"));
    }

    /// 캐시 히트와 이미 작은 원본은 이 프로세스가 답하고 `exe` 를 묻지 않는다 — 갤러리를 다시 열 때 사진마다 프로세스를
    /// 띄우지 않는다. 무엇이 이것을 실패시키는가: 판정 없이 자식부터 띄우는 것.
    #[test]
    fn a_hit_and_a_small_source_are_answered_without_a_child() {
        let dir = TempDir::new().unwrap();
        let cache_dir = dir.path().join("cache");
        let small = jpeg(dir.path(), "small.jpg", 300, 200);
        let big = jpeg(dir.path(), "big.jpg", 800, 400);
        let built = ensure_thumbnail(&big, &cache_dir, 320).unwrap();

        assert_eq!(
            ensure_thumbnail_via_child(&small, &cache_dir, 320, no_child).unwrap(),
            small
        );
        assert_eq!(
            ensure_thumbnail_via_child(&big, &cache_dir, 320, no_child).unwrap(),
            built
        );
    }

    /// 만들어야 하는 사진은 자식으로 간다 — 띄울 실행 파일이 없으면 `Spawn` 이고, 이 프로세스는 아무것도 쓰지 않았다.
    /// 무엇이 이것을 실패시키는가: 만들기를 이 프로세스에서 하는 것(썸네일이 생기고 `Ok`).
    #[test]
    fn a_source_that_needs_a_build_goes_to_the_child() {
        let dir = TempDir::new().unwrap();
        let cache_dir = dir.path().join("cache");
        let big = jpeg(dir.path(), "big.jpg", 800, 400);
        let missing = dir.path().join("no-such-baram");

        let result = ensure_thumbnail_via_child(&big, &cache_dir, 320, || Ok(missing));

        assert!(
            matches!(result, Err(ViaChildError::Child(ChildError::Spawn(_)))),
            "{result:?}"
        );
        assert!(!cache_dir.exists());
    }

    /// 판정의 실패는 이 프로세스의 `ThumbnailError` 그대로이고 자식을 띄우지 않는다.
    #[test]
    fn a_probe_failure_is_the_thumbnailers_error_without_a_child() {
        let dir = TempDir::new().unwrap();
        let src = dir.path().join("notes.jpg");
        std::fs::write(&src, b"this is not a jpeg").unwrap();
        let expected = probe_thumbnail(&src, dir.path(), 320)
            .unwrap_err()
            .to_string();

        let result = ensure_thumbnail_via_child(&src, dir.path(), 320, no_child);

        match result {
            Err(e @ ViaChildError::Probe(_)) => assert_eq!(e.to_string(), expected),
            other => panic!("{other:?}"),
        }
    }
}
