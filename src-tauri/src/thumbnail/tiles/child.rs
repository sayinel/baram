//! §397 피라미드 생성을 짧게 사는 자식 프로세스에서 한다. `image_tiles` 명령(부모)이 같은 실행 파일을 이 모드로
//! 띄워 `ensure_tiles` 를 맡기고, 자식이 끝날 때까지 기다린다.
//!
//! 왜 자식인가: 200 MP 원본의 생성은 RGB8 레벨 0(약 600 MB)과 레벨 이미지를 할당한다. 그것을 해제한 뒤에도 macOS
//! malloc 의 large cache 가 그 메모리를 쥐고 phys_footprint(활성 상태 보기가 보이는 값)에 남긴다 — release 시험
//! 프로세스에서 16320x12240 JPEG 의 생성 직후 phys_footprint 는 783 MB, malloc 의 사용 중 메모리는 0.1 MB 였고, 그
//! 783 MB 가 1초 간격 표본에서 17 · 26 · 43 초 동안 그대로였다(세 회차, macOS 26.6.2). 자식이 끝나면 그 메모리는 자식의
//! 것이라 부모의 footprint 에 남지 않는다. 전역 `MallocLargeCache=0` 은 앱 전체의 큰 할당에 걸리므로 쓰지 않는다.
//! Linux · Windows 는 재지 않았다. 부모에 남는 것은 이 모듈 밖이다 — 디코드 없는 판정(`probe_tiles`)도 JPEG 이면
//! 압축 파일 전체를 읽고(image 0.25 의 `JpegDecoder::new`), 썸네일 생성(`ensure_thumbnail`)은 원본을 통째로 디코드한다.
//!
//! 프로토콜 — argv 는 `{exe} --internal-build-tile-pyramid {원본} {캐시 디렉터리}`, 종료 코드는:
//! - 0: stdout 에 `TileSet` 의 JSON.
//! - 1(`EXIT_BUILD_FAILED`): 생성 실패. stderr 에 `ThumbnailError` 의 문장 — 부모가 그 문장을 그대로 명령의 `Err` 로 낸다.
//!   문장 없는 1 은 이 프로토콜이 아니다(밖에서 종료 코드 1 로 끝낸 경우 등) — 부모가 비정상 종료로 읽는다.
//! - 2(`EXIT_USAGE`): argv 가 이 모드의 모양이 아니다.
//! - 3(`EXIT_ORPHANED`): stdin 이 EOF 이거나 읽을 수 없다 — 부모가 끝났다고 보고 멈췄다(`watch_parent`). 부모가
//!   살아 있는 동안에는 stdin 이 열려 있으므로 부모 쪽 코드는 이 값을 비정상 종료로 읽는다.
//! - 그 밖(시그널로 끝남 포함): 부모가 비정상 종료로 읽는다. release 프로필은 `panic = "abort"` 라 생성 중 패닉이
//!   여기로 온다. 그때 자식이 남긴 임시 디렉터리는 부모가 지운다(`build_in_child`).
//!
//! 자식의 수명은 부모에 묶인다: 부모는 자식의 stdin 을 열어 둔 채 기다리고, 부모 프로세스가 끝나면 운영체제가 그 끝을
//! 닫는다. 자식은 그 EOF 를 읽으면 생성을 멈추고 끝난다 — 생성이 앱 안의 스레드였을 때처럼 앱을 끝내면 생성도 끝난다.
//! EOF 는 파이프의 부모 쪽 끝을 가진 프로세스가 모두 끝나야 온다. 파이프를 만드는 순간 앱의 다른 스레드가 띄운 프로세스가
//! 그 끝을 물려받았다면, 그 프로세스가 끝날 때까지 자식은 생성을 계속하고 피라미드를 놓고 끝난다.

use std::ffi::{OsStr, OsString};
use std::io::{self, Read, Write};
use std::path::Path;
use std::process::{Command, ExitStatus, Output, Stdio};

use super::{cache, ensure_tiles, TileSet};

/// 자식 모드의 argv[1]. `main` 이 `cli::mode_for` 보다 **먼저** 이 글자와 견준다 — `mode_for` 의 GUI 쪽 규칙(인자 없음 ·
/// macOS 가 붙이는 인자 · 절대 경로 · URL) 어디에도 걸리지 않으므로, 그 뒤에서 보면 이 플래그는 CLI 로 가 clap 의
/// 사용법 오류로 끝난다.
///
/// ‼️ 프로토콜(인자 · 종료 코드 · 답의 모양)의 뜻을 바꾸면 이 글자도 바꾼다. 앱이 실행 중에 번들이 바뀌면(업데이트를
/// 설치하고 다시 시작하기 전) `current_exe()` 가 새 바이너리를 가리켜 옛 부모가 새 자식을 띄울 수 있다 — 글자가 다르면 새
/// 자식은 그 argv 를 CLI 로 보내 사용법 오류(2)로 끝나고, 옛 부모는 비정상 종료로 읽어 원본으로 돌아간다.
pub const CHILD_FLAG: &str = "--internal-build-tile-pyramid";

/// 생성이 실패했다 — stderr 의 문장이 그 이유다.
const EXIT_BUILD_FAILED: i32 = 1;
/// argv 가 이 모드의 모양이 아니다.
const EXIT_USAGE: i32 = 2;
/// stdin 이 EOF 이거나 읽을 수 없어 생성을 멈췄다.
const EXIT_ORPHANED: i32 = 3;

/// 부모가 자식에게서 받은 실패. `Display` 가 명령의 `Err` 문자열이 된다.
#[derive(Debug, thiserror::Error)]
pub enum ChildError {
    #[error("타일 생성 프로세스를 띄울 수 없습니다: {0}")]
    Spawn(#[source] io::Error),
    #[error("타일 생성 프로세스를 기다릴 수 없습니다: {0}")]
    Wait(#[source] io::Error),
    /// 자식이 `EXIT_BUILD_FAILED` 와 문장으로 끝났다 — 그 stderr(`ThumbnailError` 의 문장) 그대로.
    #[error("{0}")]
    Build(String),
    #[error("타일 생성 프로세스가 비정상 종료했습니다({status}): {stderr}")]
    Crashed { status: ExitStatus, stderr: String },
    #[error("타일 생성 프로세스의 답을 읽을 수 없습니다: {0}")]
    Answer(#[source] serde_json::Error),
}

/// 부모 쪽: `exe` 를 자식 모드로 띄워 `src` 의 피라미드를 `cache_dir` 에 짓게 하고, 자식이 끝날 때까지 기다려 그 답을
/// 돌려준다. 블로킹 함수다. 판정 · 생성 · 정리는 모두 자식의 `ensure_tiles` 가 하고(순서는 그 doc), 이 함수는 띄우고
/// 읽는다. 자식이 비정상 종료하면 그 자식의 pid 가 든 임시 디렉터리를 지운다 — 자식이 정리하지 못하고 끝났고, 같은
/// 사진을 다시 열 때마다 하나씩 쌓이지 않게.
///
/// stdin 은 기다리는 동안 열어 둔다(모듈 doc 의 수명). stdout · stderr 는 받는다. Windows 에서는 `CREATE_NO_WINDOW` 로
/// 띄운다 — 콘솔 서브시스템인 디버그 빌드(`main.rs` 의 `windows_subsystem`)의 자식이 부모의 콘솔을 물려받지도, 부모에게
/// 콘솔이 없을 때 새 콘솔 창을 만들지도 않게 한다(Win32 `CreateProcess` 문서의 동작, Windows 에서 확인하지 않았다).
/// release 의 앱 exe 는 GUI 서브시스템이라 이 플래그는 아무것도 바꾸지 않는다.
pub fn build_in_child(exe: &Path, src: &Path, cache_dir: &Path) -> Result<TileSet, ChildError> {
    let mut command = Command::new(exe);
    command
        .arg(CHILD_FLAG)
        .arg(src)
        .arg(cache_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // `CREATE_NO_WINDOW` — 콘솔 프로그램을 콘솔 창 없이 띄운다(Win32 프로세스 생성 플래그).
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command.spawn().map_err(ChildError::Spawn)?;
    let pid = child.id();
    // `wait_with_output` 은 쥔 stdin 을 먼저 닫으므로 꺼내 두었다가 자식이 끝난 뒤 닫는다.
    let lifeline = child.stdin.take();
    let output = child.wait_with_output();
    drop(lifeline);
    let answer = read_answer(output.map_err(ChildError::Wait)?);
    if matches!(answer, Err(ChildError::Crashed { .. })) {
        cache::discard_temps_of(&cache::tiles_root(cache_dir), pid);
    }
    answer
}

/// 끝난 자식의 종료 코드와 두 스트림을 답으로 읽는다 — 프로토콜은 모듈 doc.
fn read_answer(output: Output) -> Result<TileSet, ChildError> {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    match output.status.code() {
        Some(0) => serde_json::from_slice(&output.stdout).map_err(ChildError::Answer),
        Some(EXIT_BUILD_FAILED) if !stderr.is_empty() => Err(ChildError::Build(stderr)),
        _ => Err(ChildError::Crashed {
            status: output.status,
            stderr,
        }),
    }
}

/// 자식 쪽: argv[1] 이 `CHILD_FLAG` 면 생성하고 종료 코드를 돌려준다. 아니면 `None` — 그 argv 는 다른 모드의 것이다.
/// `main` 이 다른 모드보다 먼저 부른다. tauri 도 로거도 시작하지 않는다.
pub fn run_if_requested(args: &[OsString]) -> Option<i32> {
    if args.get(1).map(OsString::as_os_str) != Some(OsStr::new(CHILD_FLAG)) {
        return None;
    }
    // `get(1)` 이 있었으니 길이는 2 이상이다.
    let rest = args.get(2..).unwrap_or_default();
    Some(run(
        rest,
        &mut io::stdout().lock(),
        &mut io::stderr().lock(),
        watch_parent,
    ))
}

/// 자식 모드의 본체 — `rest` 는 플래그 뒤의 argv. 답과 실패의 문장을 `out` · `err` 에 쓰고 종료 코드를 돌려준다.
/// `on_start` 는 argv 가 맞을 때 생성 전에 한 번 부른다 — 진짜 자식에서는 `watch_parent` 이고, 시험은 아무것도 하지 않는
/// 것을 넘긴다(시험 프로세스의 stdin 이 닫혀 있으면 시험 하네스가 끝나 버린다).
fn run(
    rest: &[OsString],
    out: &mut impl Write,
    err: &mut impl Write,
    on_start: impl FnOnce(),
) -> i32 {
    let [src, cache_dir] = rest else {
        let _ = writeln!(err, "usage: baram {CHILD_FLAG} <source> <cache dir>");
        return EXIT_USAGE;
    };
    on_start();
    let set = match ensure_tiles(Path::new(src), Path::new(cache_dir), |_| {}) {
        Ok(set) => set,
        Err(e) => {
            let _ = writeln!(err, "{e}");
            return EXIT_BUILD_FAILED;
        }
    };
    // 답을 끝까지 썼는지 여기서 본다 — `main` 의 `process::exit` 도 남은 stdout 버퍼를 비우지만(rustc 1.98.1 에서
    // 확인), 종료 코드는 그보다 먼저 정해져 그 실패가 코드에 남지 않는다.
    let written = serde_json::to_writer(&mut *out, &set)
        .map_err(io::Error::from)
        .and_then(|()| out.flush());
    match written {
        Ok(()) => 0,
        Err(e) => {
            let _ = writeln!(err, "타일 생성의 답을 쓸 수 없습니다: {e}");
            EXIT_BUILD_FAILED
        }
    }
}

/// 부모가 끝나면 자식도 끝낸다 — stdin 에서 EOF(또는 읽기 실패)를 읽는 스레드가 `EXIT_ORPHANED` 로 프로세스를 끝낸다.
/// 부모는 아무것도 쓰지 않으므로 읽기는 부모가 끝날 때까지 막혀 있다. 짓던 임시 디렉터리는 남고, 다음 시작의
/// `purge_stale` 이 지운다(pid 가 다르다).
fn watch_parent() {
    std::thread::spawn(|| {
        let mut sink = [0u8; 64];
        let mut stdin = io::stdin();
        loop {
            match stdin.read(&mut sink) {
                Ok(0) => std::process::exit(EXIT_ORPHANED),
                Ok(_) => {}
                Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                Err(_) => std::process::exit(EXIT_ORPHANED),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use image::{DynamicImage, Rgb, RgbImage};
    use tempfile::TempDir;

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

    /// GUI 가 받는 argv(인자 없음 · macOS 가 붙이는 것 · 파일 연결의 절대 경로 · 딥 링크)와 CLI 의 argv 는 이 모드가
    /// 아니다. 플래그가 둘째 이후에 있어도 아니다. 무엇이 이것을 실패시키는가: argv[1] 이 아니라 argv 전체에서
    /// 플래그를 찾는 것.
    #[test]
    fn only_the_flag_in_first_position_selects_the_child_mode() {
        for argv in [
            args(&["baram"]),
            args(&["baram", "-psn_0_12345"]),
            args(&["baram", "/Users/me/notes/a.md"]),
            args(&["baram", "baram://open?path=x"]),
            args(&["baram", "search", "x"]),
            args(&["baram", "--json", CHILD_FLAG, "/a.jpg", "/cache"]),
        ] {
            assert_eq!(run_if_requested(&argv), None, "{argv:?}");
        }
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

    /// 종료 코드 `code` 로 끝난 자식의 결과.
    fn exited(code: i32, stdout: &[u8], stderr: &[u8]) -> Output {
        #[cfg(unix)]
        let status = {
            use std::os::unix::process::ExitStatusExt;
            ExitStatus::from_raw(code << 8)
        };
        #[cfg(windows)]
        let status = {
            use std::os::windows::process::ExitStatusExt;
            ExitStatus::from_raw(code as u32)
        };
        Output {
            status,
            stdout: stdout.to_vec(),
            stderr: stderr.to_vec(),
        }
    }

    /// 문장이 있는 1 은 생성 실패이고 그 이유는 stderr 의 문장(끝 줄바꿈을 뗀)이다. 무엇이 이것을 실패시키는가: 1 을
    /// 다른 비정상 종료와 한데 읽는 것 — 그러면 명령의 `Err` 가 썸네일러의 문장이 아니게 된다.
    #[test]
    fn exit_one_is_the_build_failure_with_its_sentence() {
        let answer = read_answer(exited(
            1,
            b"",
            "이미지가 너무 큽니다: 30000x20000\n".as_bytes(),
        ));

        match answer {
            Err(ChildError::Build(sentence)) => {
                assert_eq!(sentence, "이미지가 너무 큽니다: 30000x20000");
            }
            other => panic!("{other:?}"),
        }
    }

    /// 문장 없는 1 은 자식이 낸 것이 아니다(밖에서 1 로 끝낸 경우) — 이유가 빈 생성 실패로 읽지 않는다.
    #[test]
    fn exit_one_without_a_sentence_is_a_crash() {
        assert!(matches!(
            read_answer(exited(1, b"", b"")),
            Err(ChildError::Crashed { status, .. }) if status.code() == Some(1)
        ));
    }

    /// 0 · 1 이 아닌 종료(사용법 오류 2, debug 빌드의 패닉 101)는 비정상 종료이고 stderr 를 싣는다.
    #[test]
    fn any_other_exit_is_a_crash_that_carries_stderr() {
        for code in [EXIT_USAGE, 101] {
            match read_answer(exited(code, b"", b"thread 'main' panicked\n")) {
                Err(ChildError::Crashed { status, stderr }) => {
                    assert_eq!(status.code(), Some(code));
                    assert_eq!(stderr, "thread 'main' panicked");
                }
                other => panic!("{code}: {other:?}"),
            }
        }
    }

    /// 시그널로 끝난 자식(release 의 `panic = "abort"` 는 SIGABRT)은 종료 코드가 없고, 비정상 종료다.
    #[cfg(unix)]
    #[test]
    fn a_child_ended_by_a_signal_is_a_crash() {
        use std::os::unix::process::ExitStatusExt;
        let output = Output {
            status: ExitStatus::from_raw(6), // SIGABRT, core 없음
            stdout: Vec::new(),
            stderr: Vec::new(),
        };

        assert!(matches!(
            read_answer(output),
            Err(ChildError::Crashed { status, .. }) if status.code().is_none()
        ));
    }

    /// 0 인데 stdout 이 `TileSet` 이 아니면 답을 읽지 못한 것이다 — 성공으로 넘기지 않는다.
    #[test]
    fn exit_zero_without_a_tile_set_on_stdout_is_an_answer_error() {
        for stdout in [&b""[..], b"{\"kind\":\"pyramid\"}", b"not json"] {
            assert!(
                matches!(
                    read_answer(exited(0, stdout, b"")),
                    Err(ChildError::Answer(_))
                ),
                "{:?}",
                String::from_utf8_lossy(stdout)
            );
        }
        assert_eq!(
            read_answer(exited(0, br#"{"kind":"original"}"#, b"")).unwrap(),
            TileSet::Original
        );
    }
}
