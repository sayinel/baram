//! `logging::install` on the happy path, in a process of its own.
//!
//! The unit tests in `src/logging` stop at `build()`: they assemble the real policy
//! and drive the returned `Box<dyn Log>` directly, deliberately never installing it,
//! because `log::set_boxed_logger` is process-global and one-shot — a unit test that
//! installed would decide the behaviour of every other test in that binary and write
//! into the developer's real log directory.
//!
//! That left the wiring uncovered, and the wiring is where the value is. Three
//! one-line changes to `install` kept all of `logging::tests` green: handing it a
//! stdout-only target list (a bundled app then writes no file at all), dropping the
//! `attach` call (`log::*` is a no-op facade again — the original defect, restored),
//! and panicking on the error instead of absorbing it (the whole point of the
//! function). This file is its own binary, so it can own the global logger, and it
//! kills all three.
//!
//! The companion `logging_install_unwritable.rs` covers the failure branch. It is a
//! separate binary for the same reason: the logger it installs is process-global too.

use std::path::{Path, PathBuf};
use tauri::utils::config::{AppDirectoriesOverride, AppDirectoryOverrides};

/// Every `log::*` in the app compiles to nothing until a logger is installed, so this
/// is the observable that says installation happened at all.
fn logging_is_live() -> bool {
    log::max_level() != log::LevelFilter::Off
}

/// A mock app whose log directory is `dir`, on every platform.
///
/// Through tauri's `appDirectoriesOverride`, not by pointing `HOME` at `dir`. Without
/// an override `app_log_dir()` asks `dirs`, which reads `HOME` on macOS and
/// `XDG_DATA_HOME` on Linux but, on Windows, the Known Folder API — no environment
/// variable at all, `LOCALAPPDATA` included — so there an environment redirect would
/// leave the log in the developer's real `%LOCALAPPDATA%`. `app_log_dir()` reads the
/// override before asking `dirs`, and the production target (`TargetKind::LogDir`)
/// resolves its directory through `app_log_dir()`.
fn app_logging_into(dir: &Path) -> tauri::App<tauri::test::MockRuntime> {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().app.app_directories_override =
        Some(AppDirectoriesOverride::Directories(AppDirectoryOverrides {
            log: Some(dir.to_path_buf()),
            ..Default::default()
        }));
    tauri::test::mock_builder()
        .build(context)
        .expect("mock app")
}

fn find_log_file(root: &Path) -> Option<PathBuf> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.file_name().is_some_and(|n| n == "baram.log") {
                return Some(path);
            }
        }
    }
    None
}

#[test]
fn install_attaches_a_logger_that_writes_our_records_to_a_file() {
    let logs = tempfile::tempdir().expect("tempdir");

    assert!(
        !logging_is_live(),
        "no logger may be installed before install() runs, or this test proves nothing"
    );

    let app = app_logging_into(logs.path());

    // Fail on the CAUSE, not on the symptom. If the redirect stopped applying, the log
    // would land in the real log directory and the assertion below would read "no
    // baram.log", pointing at the logger instead of at the harness.
    let resolved = tauri::Manager::path(app.handle())
        .app_log_dir()
        .expect("app_log_dir must resolve");
    assert!(
        resolved.starts_with(logs.path()),
        "the log directory ignored the override: it resolved to {} instead of under {}. \
         The test needs a different redirect, not a change to the logger.",
        resolved.display(),
        logs.path().display()
    );

    baram_lib::logging::install(app.handle());

    assert!(
        logging_is_live(),
        "install() must attach a logger — without `attach`, every log::* in the app is \
         a no-op again"
    );

    // Through the macro, not through a `Box<dyn Log>`: this is the path the app's nine
    // call sites actually take, including the global `max_level` gate.
    log::warn!("integration probe: asset scope registration failed");

    let log_file = find_log_file(logs.path()).unwrap_or_else(|| {
        panic!(
            "no baram.log under {} — install() must use the FILE target; in a bundled \
             app stdout has no reader",
            logs.path().display()
        )
    });
    let written = std::fs::read_to_string(&log_file).expect("read baram.log");
    assert!(
        written.contains("integration probe: asset scope registration failed"),
        "the record must be in {}: {written:?}",
        log_file.display()
    );
    // The name users are told to attach, and the level, so this also covers the
    // production target's `file_name` and the format reaching a real file.
    assert!(
        written.contains("WARN"),
        "the level must be present: {written:?}"
    );
}
