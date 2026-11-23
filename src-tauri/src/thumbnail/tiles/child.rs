//! §397 피라미드 생성을 짧게 사는 자식 프로세스에서 한다. `image_tiles` 명령(부모)이 같은 실행 파일을 이 모드로
//! 띄워 `ensure_tiles` 를 맡기고, 자식이 끝날 때까지 기다린다. 종료 코드 · 자식의 수명 · 부모 쪽 띄우기는 썸네일
//! 자식과 함께 쓰는 `child_process` 에 있다(그 모듈 doc).
//!
//! 왜 자식인가: 200 MP 원본의 생성은 RGB8 레벨 0(약 600 MB)과 레벨 이미지를 할당한다. 그것을 해제한 뒤에도 macOS
//! malloc 의 large cache 가 그 메모리를 쥐고 phys_footprint(활성 상태 보기가 보이는 값)에 남긴다 — release 시험
//! 프로세스에서 16320x12240 JPEG 의 생성 직후 phys_footprint 는 783 MB, malloc 의 사용 중 메모리는 0.1 MB 였고, 그
//! 783 MB 가 1초 간격 표본에서 17 · 26 · 43 초 동안 그대로였다(세 회차, macOS 26.6.2). 자식이 끝나면 그 메모리는 자식의
//! 것이라 부모의 footprint 에 남지 않는다. 전역 `MallocLargeCache=0` 은 앱 전체의 큰 할당에 걸리므로 쓰지 않는다.
//! Linux · Windows 는 재지 않았다. 부모에 남는 것은 헤더만 읽는 판정(`probe_tiles` — `thumbnail::header`)이다. 판정이 image 의
//! 디코더를 열던 때는 JPEG 이면 압축 파일 전체를 읽어(image 0.25.10 의 `JpegDecoder::new`), 위 사진을 판정하고 자식에 맡긴 뒤
//! 부모의 phys_footprint 가 42.0–42.1 MB(`MALLOC_LARGE (empty)` 39.7 MB)로 90 초 창 끝까지 그대로였다. 헤더만 읽게 한 뒤에는
//! 2.3 MB 다(두 코드를 번갈아 잰 두 회차씩).
//!
//! argv 는 `{exe} --internal-build-tile-pyramid {원본} {캐시 디렉터리}`, 답(종료 코드 0 의 stdout)은 `TileSet` 의 JSON.
//! 생성 중 비정상 종료한 자식이 남긴 임시 디렉터리는 부모가 지운다(`build_in_child`). 부모가 끝나 멈춘 자식(종료 코드 3)의
//! 것은 다음 시작의 `purge_stale` 이 지운다(pid 가 다르다).

use std::ffi::OsString;
use std::io::{self, Write};
use std::path::Path;

pub use super::super::child_process::ChildError;
use super::super::child_process::{args_after, run_in_child, serve, watch_parent};
use super::{cache, ensure_tiles, TileSet};

/// 자식 모드의 argv[1]. `main` 이 `cli::mode_for` 보다 **먼저** 이 글자와 견준다 — `mode_for` 의 GUI 쪽 규칙(인자 없음 ·
/// macOS 가 붙이는 인자 · 절대 경로 · URL) 어디에도 걸리지 않으므로, 그 뒤에서 보면 이 플래그는 CLI 로 가 clap 의
/// 사용법 오류로 끝난다.
///
/// ‼️ 프로토콜(인자 · 종료 코드 · 답의 모양)의 뜻을 바꾸면 이 글자도 바꾼다. 앱이 실행 중에 번들이 바뀌면(업데이트를
/// 설치하고 다시 시작하기 전) `own_executable()` 이 새 바이너리를 가리켜 옛 부모가 새 자식을 띄울 수 있다(macOS 의 경우다.
/// Linux 는 실행 중인 파일을 띄운다 — `child_process::own_executable`). 글자가 다르면 새
/// 자식은 그 argv 를 CLI 로 보내 사용법 오류(2)로 끝나고, 옛 부모는 비정상 종료로 읽어 원본으로 돌아간다.
pub const CHILD_FLAG: &str = "--internal-build-tile-pyramid";

/// 부모 쪽: `exe` 를 자식 모드로 띄워 `src` 의 피라미드를 `cache_dir` 에 짓게 하고, 자식이 끝날 때까지 기다려 그 답을
/// 돌려준다. 블로킹 함수다. 판정 · 생성 · 정리는 모두 자식의 `ensure_tiles` 가 하고(순서는 그 doc), 이 함수는 띄우고
/// 읽는다(`run_in_child`). 자식이 비정상 종료하면 그 자식의 pid 가 든 임시 디렉터리를 지운다 — 자식이 정리하지 못하고
/// 끝났고, 같은 사진을 다시 열 때마다 하나씩 쌓이지 않게.
pub fn build_in_child(exe: &Path, src: &Path, cache_dir: &Path) -> Result<TileSet, ChildError> {
    run_in_child(
        exe,
        CHILD_FLAG,
        &[src.as_os_str(), cache_dir.as_os_str()],
        |pid| {
            cache::discard_temps_of(&cache::tiles_root(cache_dir), pid);
        },
    )
}

/// 자식 쪽: argv[1] 이 `CHILD_FLAG` 면 생성하고 종료 코드를 돌려준다. 아니면 `None` — 그 argv 는 다른 모드의 것이다.
/// `main` 이 GUI · CLI 를 가르기 전에 부른다. tauri 도 로거도 시작하지 않는다.
pub fn run_if_requested(args: &[OsString]) -> Option<i32> {
    let rest = args_after(args, CHILD_FLAG)?;
    Some(run(
        rest,
        &mut io::stdout().lock(),
        &mut io::stderr().lock(),
        watch_parent,
    ))
}

/// 자식 모드의 본체 — `rest` 는 플래그 뒤의 argv. 공용 본체(`serve`)에 argv 의 모양과 `ensure_tiles` 를 넘긴다.
fn run(
    rest: &[OsString],
    out: &mut impl Write,
    err: &mut impl Write,
    on_start: impl FnOnce(),
) -> i32 {
    let parsed = match rest {
        [src, cache_dir] => Some((Path::new(src), Path::new(cache_dir))),
        _ => None,
    };
    serve(
        parsed,
        &format!("usage: baram {CHILD_FLAG} <source> <cache dir>"),
        out,
        err,
        on_start,
        |(src, cache_dir)| ensure_tiles(src, cache_dir, |_| {}),
    )
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use image::{DynamicImage, Rgb, RgbImage};
    use tempfile::TempDir;

    use super::super::super::child_process::{exited, read_answer, EXIT_BUILD_FAILED, EXIT_USAGE};
    use super::super::probe_tiles;
    use super::*;

    fn args(parts: &[&str]) -> Vec<OsString> {
        parts.iter().map(OsString::from).collect()
    }

    fn big_jpeg(dir: &Path) -> PathBuf {
        let path = dir.join("big.jpg");
        DynamicImage::ImageRgb8(RgbImage::from_fn(2049, 10, |x, y| {
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

    /// 사용법 오류는 부모 감시(`on_start`)를 시작하기 전에 끝난다.
    #[test]
    fn a_child_without_exactly_a_source_and_a_cache_dir_is_a_usage_error() {
        for rest in [args(&[]), args(&["/a.jpg"]), args(&["/a.jpg", "/c", "x"])] {
            let (mut out, mut err) = (Vec::new(), Vec::new());

            let code = run(&rest, &mut out, &mut err, || {
                panic!("a usage error starts no watch on the parent")
            });

            assert_eq!(code, EXIT_USAGE, "{rest:?}");
            assert!(out.is_empty());
            assert!(String::from_utf8(err).unwrap().contains(CHILD_FLAG));
        }
    }

    /// stdout 의 JSON 이 캐시에 놓인 피라미드 그대로다 — 부모는 이것만 읽는다. 무엇이 이것을 실패시키는가:
    /// `TileSet` 의 `Deserialize` 가 `Serialize` 와 다른 모양을 읽는 것(태그 · `flatten`), 답이 캐시의 피라미드가 아닌
    /// 것(다른 디렉터리 · manifest), 부모 감시(`on_start`)를 생성 뒤에 시작하거나 시작하지 않는 것.
    #[test]
    fn a_built_pyramid_is_answered_on_stdout_as_the_cache_holds_it() {
        let dir = TempDir::new().unwrap();
        let cache_dir = dir.path().join("cache");
        let src = big_jpeg(dir.path());
        let (mut out, mut err) = (Vec::new(), Vec::new());
        // 감시를 시작하는 순간 캐시가 아직 없었는가 — 생성 뒤에 시작하면 피라미드가 이미 놓여 있다.
        let watched_before_the_build = std::cell::Cell::new(None);

        let code = run(
            &[src.clone().into(), cache_dir.clone().into()],
            &mut out,
            &mut err,
            || watched_before_the_build.set(Some(!cache::tiles_root(&cache_dir).exists())),
        );

        assert_eq!(code, 0, "{}", String::from_utf8_lossy(&err));
        assert_eq!(
            watched_before_the_build.get(),
            Some(true),
            "the watch on the parent starts once, before the build"
        );
        let answered: TileSet = serde_json::from_slice(&out).unwrap();
        assert!(matches!(answered, TileSet::Tiles { .. }));
        assert_eq!(
            probe_tiles(&src, &cache_dir, |_| panic!("a hit announces no size")).unwrap(),
            Some(answered)
        );
    }

    /// 실패의 문장은 같은 프로세스에서 `ensure_tiles` 가 낼 문장과 한 글자도 다르지 않다 — 명령의 `Err` 와 로그가
    /// 자식으로 옮기기 전과 같다. 이 원본은 디코드에서 실패하므로 캐시 디렉터리를 만들기 전이다 — 마지막 단정은
    /// 피라미드 정리가 아니라 그 순서를 본다.
    #[test]
    fn a_failed_build_reports_the_thumbnailers_own_message() {
        let dir = TempDir::new().unwrap();
        let cache_dir = dir.path().join("cache");
        let src = broken_bmp(dir.path());
        let expected = ensure_tiles(&src, &dir.path().join("other"), |_| {})
            .unwrap_err()
            .to_string();
        let (mut out, mut err) = (Vec::new(), Vec::new());

        let code = run(
            &[src.into(), cache_dir.clone().into()],
            &mut out,
            &mut err,
            || {},
        );

        assert_eq!(code, EXIT_BUILD_FAILED);
        assert!(out.is_empty());
        assert_eq!(String::from_utf8(err).unwrap(), format!("{expected}\n"));
        let left: Vec<_> = std::fs::read_dir(cache::tiles_root(&cache_dir))
            .map(|entries| entries.flatten().map(|e| e.file_name()).collect())
            .unwrap_or_default();
        assert!(left.is_empty(), "{left:?}");
    }

    /// 0 인데 stdout 이 `TileSet` 이 아니면 답을 읽지 못한 것이다 — 성공으로 넘기지 않는다. 종료 코드의 나머지 읽기는
    /// `child_process` 의 시험이 본다.
    #[test]
    fn exit_zero_without_a_tile_set_on_stdout_is_an_answer_error() {
        for stdout in [&b""[..], b"{\"kind\":\"pyramid\"}", b"not json"] {
            assert!(
                matches!(
                    read_answer::<TileSet>(exited(0, stdout, b"")),
                    Err(ChildError::Answer(_))
                ),
                "{:?}",
                String::from_utf8_lossy(stdout)
            );
        }
        assert_eq!(
            read_answer::<TileSet>(exited(0, br#"{"kind":"original"}"#, b"")).unwrap(),
            TileSet::Original
        );
    }
}
