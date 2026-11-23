//! §397 원본을 디코드하는 일을 짧게 사는 자식 프로세스에서 하는 공용 부분. 일은 둘이다 — 타일 피라미드
//! (`tiles::child`, `image_tiles` 명령)와 썸네일(`super::child`, `photo_thumbnail` 명령). 부모(명령)가 같은 실행 파일을
//! 그 일의 플래그로 띄우고 자식이 끝날 때까지 기다린다. 왜 자식인가와 그 측정은 각 일의 모듈 doc 에 있다.
//!
//! 프로토콜 — argv 는 `{exe} {일의 플래그} {일의 인자…}`, 종료 코드는:
//! - 0: stdout 에 답의 JSON.
//! - 1(`EXIT_BUILD_FAILED`): 생성 실패. stderr 에 실패의 문장 — 일의 `ThumbnailError` 이거나, 답을 stdout 에 쓰지 못한
//!   문장이다(`serve`). 부모가 stderr 를 그대로 명령의 `Err` 로 낸다 — 자식 안의 다른 무엇이 stderr 에 쓴 것도 섞인다.
//!   문장 없는 1 은 이 프로토콜이 아니다(밖에서 종료 코드 1 로 끝낸 경우 등) — 부모가 비정상 종료로 읽는다.
//! - 2(`EXIT_USAGE`): argv 가 그 일의 모양이 아니다.
//! - 3(`EXIT_ORPHANED`): stdin 이 EOF 이거나 읽을 수 없다 — 부모가 끝났다고 보고 멈췄다(`watch_parent`). 부모가
//!   살아 있는 동안에는 stdin 이 열려 있으므로 부모 쪽 코드는 이 값을 비정상 종료로 읽는다.
//! - 그 밖(시그널로 끝남 포함): 부모가 비정상 종료로 읽는다. release 프로필은 `panic = "abort"` 라 생성 중 패닉이
//!   여기로 온다.
//!
//! 자식의 수명은 부모에 묶인다: 부모는 자식의 stdin 을 열어 둔 채 기다리고, 부모 프로세스가 끝나면 운영체제가 그 끝을
//! 닫는다. 자식은 그 EOF 를 읽으면 생성을 멈추고 끝난다 — 생성이 앱 안의 스레드였을 때처럼 앱을 끝내면 생성도 끝난다.
//! EOF 는 파이프의 부모 쪽 끝을 가진 프로세스가 모두 끝나야 온다. 파이프를 만드는 순간 앱의 다른 스레드가 띄운 프로세스가
//! 그 끝을 물려받았다면, 그 프로세스가 끝날 때까지 자식은 생성을 계속하고 결과를 캐시에 놓고 끝난다. 같은 순간에 그
//! 프로세스가 자식의 stdout · stderr 쓰는 끝을 물려받았다면, 부모는 자식이 끝난 뒤에도 그 프로세스가 끝날 때까지 답을
//! 기다린다(`wait_with_output` 은 두 스트림의 EOF 까지 읽는다) — 그동안 명령이 쥔 허가도 놓이지 않는다.

use std::ffi::{OsStr, OsString};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Output, Stdio};

use serde::de::DeserializeOwned;
use serde::Serialize;

use super::ThumbnailError;

/// 생성이 실패했다 — stderr 의 문장이 그 이유다.
pub(crate) const EXIT_BUILD_FAILED: i32 = 1;
/// argv 가 그 일의 모양이 아니다.
pub(crate) const EXIT_USAGE: i32 = 2;
/// stdin 이 EOF 이거나 읽을 수 없어 생성을 멈췄다.
pub(crate) const EXIT_ORPHANED: i32 = 3;

/// 부모가 자식에게서 받은 실패. `Display` 가 명령의 `Err` 문자열이 된다 — 어느 일인지는 명령의 로그 줄 머리
/// (`§397 tiles FAILED` · `§56d thumbnail FAILED`)가 적는다.
#[derive(Debug, thiserror::Error)]
pub enum ChildError {
    #[error("이미지 처리 프로세스를 띄울 수 없습니다: {0}")]
    Spawn(#[source] io::Error),
    #[error("이미지 처리 프로세스를 기다릴 수 없습니다: {0}")]
    Wait(#[source] io::Error),
    /// 자식이 `EXIT_BUILD_FAILED` 와 문장으로 끝났다 — 그 stderr(실패의 문장, 모듈 doc 의 종료 코드 1) 그대로.
    #[error("{0}")]
    Build(String),
    #[error("이미지 처리 프로세스가 비정상 종료했습니다({status}): {stderr}")]
    Crashed { status: ExitStatus, stderr: String },
    #[error("이미지 처리 프로세스의 답을 읽을 수 없습니다: {0}")]
    Answer(#[source] serde_json::Error),
}

/// 자식으로 띄울 이 실행 파일 — 명령(`photo_thumbnail` · `image_tiles`)이 `run_in_child` 에 넘긴다.
///
/// Linux 에서는 `/proc/self/exe` 그 자체다. std 의 `current_exe()` 는 Linux 에서 그 링크의 글자를 읽는다(rustc 1.98.1 의
/// `library/std/src/sys/paths/unix.rs`, `read_link("/proc/self/exe")`). 실행 중인 파일이 바뀌면(패키지 갱신이 새 파일을
/// 그 자리로 rename 한다) 그 글자는 옛 경로 뒤에 ` (deleted)` 가 붙은 것이 되어, 그 경로로는 띄울 수 없다 — 썸네일은
/// 앱을 다시 시작할 때까지 만들 때마다 실패한다. 링크 자체를 실행하면 운영체제가 지금 실행 중인 파일로 풀어, 바뀐 뒤에도
/// 띄우고 부모와 같은 버전이 자식이 된다. 두 동작은 Linux CI 에서 시험이 확인한다
/// (`on_linux_the_child_still_spawns_after_the_running_file_is_deleted`).
///
/// 그 밖의 플랫폼은 `current_exe()` 다. macOS 는 경로를 풀어 주므로, 실행 중에 번들이 바뀌면 새 바이너리가 자식이 될 수
/// 있다 — 각 일의 플래그 doc 이 그때를 다룬다.
pub(crate) fn own_executable() -> io::Result<PathBuf> {
    #[cfg(target_os = "linux")]
    {
        Ok(PathBuf::from("/proc/self/exe"))
    }
    #[cfg(not(target_os = "linux"))]
    {
        std::env::current_exe()
    }
}

/// 부모 쪽: `exe` 를 `flag` 와 `args` 로 띄우고, 자식이 끝날 때까지 기다려 그 답을 돌려준다. 블로킹 함수다.
/// 비정상 종료(`ChildError::Crashed`)면 답을 돌려주기 전에 그 자식의 pid 로 `on_crash` 를 부른다 — 자식이 정리하지
/// 못하고 남긴 것을 부모가 지울 자리다.
///
/// stdin 은 기다리는 동안 열어 둔다(모듈 doc 의 수명). stdout · stderr 는 받는다. Windows 에서는 `CREATE_NO_WINDOW` 로
/// 띄운다 — 콘솔 서브시스템인 디버그 빌드(`main.rs` 의 `windows_subsystem`)의 자식이 부모의 콘솔을 물려받지도, 부모에게
/// 콘솔이 없을 때 새 콘솔 창을 만들지도 않게 한다(Win32 `CreateProcess` 문서의 동작, Windows 에서 확인하지 않았다).
/// release 의 앱 exe 는 GUI 서브시스템이라 이 플래그는 아무것도 바꾸지 않는다.
pub(crate) fn run_in_child<T: DeserializeOwned>(
    exe: &Path,
    flag: &str,
    args: &[&OsStr],
    on_crash: impl FnOnce(u32),
) -> Result<T, ChildError> {
    let mut command = Command::new(exe);
    command
        .arg(flag)
        .args(args)
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
        on_crash(pid);
    }
    answer
}

/// 끝난 자식의 종료 코드와 두 스트림을 답으로 읽는다 — 프로토콜은 모듈 doc.
pub(crate) fn read_answer<T: DeserializeOwned>(output: Output) -> Result<T, ChildError> {
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

/// argv[1] 이 `flag` 면 그 뒤의 argv. 아니면 `None` — 그 argv 는 다른 모드의 것이다. 각 일의 `run_if_requested` 가
/// 자기 플래그로 부른다.
pub(crate) fn args_after<'a>(args: &'a [OsString], flag: &str) -> Option<&'a [OsString]> {
    if args.get(1).map(OsString::as_os_str) != Some(OsStr::new(flag)) {
        return None;
    }
    // `get(1)` 이 있었으니 길이는 2 이상이다.
    Some(args.get(2..).unwrap_or_default())
}

/// 자식 쪽 본체. `parsed` 가 `None` 이면(argv 가 그 일의 모양이 아니면) `usage` 를 `err` 에 쓰고 `EXIT_USAGE`.
/// 아니면 `on_start` 를 한 번 부르고 `work` 를 돌려 답의 JSON 을 `out` 에, 실패의 문장을 `err` 에 쓰고 종료 코드를
/// 돌려준다. `on_start` 는 진짜 자식에서는 `watch_parent` 이고, 시험은 아무것도 하지 않는 것을 넘긴다(시험 프로세스의
/// stdin 이 닫혀 있으면 시험 하네스가 끝나 버린다).
pub(crate) fn serve<A, T: Serialize>(
    parsed: Option<A>,
    usage: &str,
    out: &mut impl Write,
    err: &mut impl Write,
    on_start: impl FnOnce(),
    work: impl FnOnce(A) -> Result<T, ThumbnailError>,
) -> i32 {
    let Some(parsed) = parsed else {
        let _ = writeln!(err, "{usage}");
        return EXIT_USAGE;
    };
    on_start();
    let answer = match work(parsed) {
        Ok(answer) => answer,
        Err(e) => {
            let _ = writeln!(err, "{e}");
            return EXIT_BUILD_FAILED;
        }
    };
    // 답을 끝까지 썼는지 여기서 본다 — `main` 의 `process::exit` 도 남은 stdout 버퍼를 비우지만(rustc 1.98.1 에서
    // 확인), 종료 코드는 그보다 먼저 정해져 그 실패가 코드에 남지 않는다.
    let written = serde_json::to_writer(&mut *out, &answer)
        .map_err(io::Error::from)
        .and_then(|()| out.flush());
    match written {
        Ok(()) => 0,
        Err(e) => {
            let _ = writeln!(err, "이미지 처리의 답을 쓸 수 없습니다: {e}");
            EXIT_BUILD_FAILED
        }
    }
}

/// 부모가 끝나면 자식도 끝낸다 — stdin 에서 EOF(또는 읽기 실패)를 읽는 스레드가 `EXIT_ORPHANED` 로 프로세스를 끝낸다.
/// 부모는 아무것도 쓰지 않으므로 읽기는 부모가 끝날 때까지 막혀 있다. 쓰던 임시 파일 · 디렉터리는 남는다 — 무엇이
/// 그것을 지우는지는 각 일의 모듈 doc.
pub(crate) fn watch_parent() {
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

/// 시험용: 종료 코드 `code` 로 끝난 자식의 결과.
#[cfg(test)]
pub(crate) fn exited(code: i32, stdout: &[u8], stderr: &[u8]) -> Output {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn args(parts: &[&str]) -> Vec<OsString> {
        parts.iter().map(OsString::from).collect()
    }

    /// GUI 가 받는 argv(인자 없음 · macOS 가 붙이는 것 · 파일 연결의 절대 경로 · 딥 링크)와 CLI 의 argv 는 자식 모드가
    /// 아니다. 플래그가 둘째 이후에 있어도 아니다. 무엇이 이것을 실패시키는가: argv[1] 이 아니라 argv 전체에서
    /// 플래그를 찾는 것.
    #[test]
    fn only_the_flag_in_first_position_selects_a_child_mode() {
        const FLAG: &str = "--internal-x";
        for argv in [
            args(&["baram"]),
            args(&["baram", "-psn_0_12345"]),
            args(&["baram", "/Users/me/notes/a.md"]),
            args(&["baram", "baram://open?path=x"]),
            args(&["baram", "search", "x"]),
            args(&["baram", "--json", FLAG, "/a.jpg", "/cache"]),
        ] {
            assert_eq!(args_after(&argv, FLAG), None, "{argv:?}");
        }
        let argv = args(&["baram", FLAG, "/a.jpg", "/cache"]);
        assert_eq!(args_after(&argv, FLAG), Some(&argv[2..]));
        assert_eq!(args_after(&args(&["baram", FLAG]), FLAG), Some(&[][..]));
    }

    /// 사용법 오류는 부모 감시(`on_start`)도 일(`work`)도 시작하기 전에 끝난다.
    #[test]
    fn a_usage_error_starts_neither_the_watch_nor_the_work() {
        let (mut out, mut err) = (Vec::new(), Vec::new());

        let code = serve(
            None::<()>,
            "usage: baram --internal-x <a>",
            &mut out,
            &mut err,
            || panic!("a usage error starts no watch on the parent"),
            |()| -> Result<u32, ThumbnailError> { panic!("a usage error runs no work") },
        );

        assert_eq!(code, EXIT_USAGE);
        assert!(out.is_empty());
        assert_eq!(
            String::from_utf8(err).unwrap(),
            "usage: baram --internal-x <a>\n"
        );
    }

    /// 일이 성공하면 답의 JSON 이 stdout 이고 부모 감시는 일보다 먼저 한 번 시작한다. 무엇이 이것을 실패시키는가:
    /// 감시를 일 뒤에 시작하거나 시작하지 않는 것, 답 말고 다른 것을 stdout 에 쓰는 것.
    #[test]
    fn a_done_work_is_answered_on_stdout_after_the_watch_started() {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let watched = std::cell::Cell::new(false);

        let code = serve(
            Some(7u32),
            "usage",
            &mut out,
            &mut err,
            || watched.set(true),
            |n| {
                assert!(watched.get(), "the watch starts before the work");
                Ok(vec![n, n])
            },
        );

        assert_eq!(code, 0, "{}", String::from_utf8_lossy(&err));
        assert_eq!(out, b"[7,7]");
        assert!(err.is_empty());
    }

    /// 일이 실패하면 stderr 는 그 `ThumbnailError` 의 문장 한 줄이고 stdout 은 비어 있다.
    #[test]
    fn a_failed_work_writes_its_sentence_to_stderr() {
        let (mut out, mut err) = (Vec::new(), Vec::new());

        let code = serve(
            Some(()),
            "usage",
            &mut out,
            &mut err,
            || {},
            |()| -> Result<u32, ThumbnailError> {
                Err(ThumbnailError::TooLarge {
                    width: 30_000,
                    height: 20_000,
                })
            },
        );

        assert_eq!(code, EXIT_BUILD_FAILED);
        assert!(out.is_empty());
        assert_eq!(
            String::from_utf8(err).unwrap(),
            "이미지가 너무 큽니다: 30000x20000\n"
        );
    }

    /// 문장이 있는 1 은 생성 실패이고 그 이유는 stderr 의 문장(끝 줄바꿈을 뗀)이다. 무엇이 이것을 실패시키는가: 1 을
    /// 다른 비정상 종료와 한데 읽는 것 — 그러면 명령의 `Err` 가 썸네일러의 문장이 아니게 된다.
    #[test]
    fn exit_one_is_the_build_failure_with_its_sentence() {
        let answer = read_answer::<u32>(exited(
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
            read_answer::<u32>(exited(1, b"", b"")),
            Err(ChildError::Crashed { status, .. }) if status.code() == Some(1)
        ));
    }

    /// 0 · 1 이 아닌 종료(사용법 오류 2, 고아 3, debug 빌드의 패닉 101)는 비정상 종료이고 stderr 를 싣는다.
    #[test]
    fn any_other_exit_is_a_crash_that_carries_stderr() {
        for code in [EXIT_USAGE, EXIT_ORPHANED, 101] {
            match read_answer::<u32>(exited(code, b"", b"thread 'main' panicked\n")) {
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
            read_answer::<u32>(output),
            Err(ChildError::Crashed { status, .. }) if status.code().is_none()
        ));
    }

    /// 이 시험이 띄운 사본 안에서만 도는 쪽 — 사본이 자기 파일을 지운 뒤 두 길로 자기 자신을 띄운다. 지우기 전에
    /// 자기가 그 사본인지 본다(환경 변수의 경로와 같을 때만 지운다).
    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "on_linux_the_child_still_spawns_after_the_running_file_is_deleted 가 사본에서 돌린다"]
    fn deleted_self_inner() {
        let Some(copy) = std::env::var_os("BARAM_DELETED_SELF_COPY") else {
            return;
        };
        assert_eq!(std::env::current_exe().unwrap(), Path::new(&copy));
        std::fs::remove_file(&copy).unwrap();

        // std 의 `current_exe()` 는 지워진 경로를 준다 — 그 경로로는 띄울 수 없다(고치기 전의 길).
        let stale = std::env::current_exe().unwrap();
        assert!(stale.to_string_lossy().ends_with(" (deleted)"), "{stale:?}");
        assert!(Command::new(&stale).arg("--list").output().is_err());

        // `own_executable` 로는 띄운다 — libtest 의 `--list` 는 시험 목록을 쓰고 0 으로 끝난다.
        let out = Command::new(own_executable().unwrap())
            .arg("--list")
            .output()
            .unwrap();
        assert!(out.status.success(), "{out:?}");
        assert!(String::from_utf8_lossy(&out.stdout).contains("deleted_self_inner"));
    }

    /// 실행 중인 파일이 바뀐 뒤에도 자식을 띄운다 — 패키지 갱신이 새 파일을 그 자리로 rename 한 상태를, 시험 하네스의
    /// 사본이 자기 파일을 지우는 것으로 만든다. 무엇이 이것을 실패시키는가: `own_executable` 이 `current_exe()` 를
    /// 돌려주는 것(사본 안의 단정이 실패한다). 사본 안에서 시험 하나가 실제로 돌았는지도 본다 — 걸러져 0 개가 돌면 공허하다.
    #[cfg(target_os = "linux")]
    #[test]
    fn on_linux_the_child_still_spawns_after_the_running_file_is_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let copy = dir.path().join("harness");
        std::fs::copy(std::env::current_exe().unwrap(), &copy).unwrap();

        let out = Command::new(&copy)
            .args([
                "--ignored",
                "--exact",
                "thumbnail::child_process::tests::deleted_self_inner",
            ])
            .env("BARAM_DELETED_SELF_COPY", &copy)
            .output()
            .unwrap();

        let stdout = String::from_utf8_lossy(&out.stdout);
        assert!(out.status.success(), "{out:?}");
        assert!(stdout.contains("1 passed"), "{stdout}");
        assert!(!copy.exists(), "the copy deleted its own file");
    }

    /// 0 인데 stdout 이 답의 모양이 아니면 답을 읽지 못한 것이다 — 성공으로 넘기지 않는다.
    #[test]
    fn exit_zero_without_an_answer_on_stdout_is_an_answer_error() {
        for stdout in [&b""[..], b"\"seven\"", b"not json"] {
            assert!(
                matches!(
                    read_answer::<u32>(exited(0, stdout, b"")),
                    Err(ChildError::Answer(_))
                ),
                "{:?}",
                String::from_utf8_lossy(stdout)
            );
        }
        assert_eq!(read_answer::<u32>(exited(0, b"7", b"")).unwrap(), 7);
    }
}
