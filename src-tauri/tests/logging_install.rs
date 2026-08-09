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
//! function). This file is its own binary, so it can own the global logger and point
//! `HOME` at a temp directory, and it kills all three.
//!
//! The companion `logging_install_unwritable.rs` covers the failure branch; it needs a
//! different `HOME`, and `HOME` is per-process.

use std::path::PathBuf;

/// Every `log::*` in the app compiles to nothing until a logger is installed, so this
/// is the observable that says installation happened at all.
fn logging_is_live() -> bool {
    log::max_level() != log::LevelFilter::Off
}

fn find_log_file(root: &std::path::Path) -> Option<PathBuf> {
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
    let home = tempfile::tempdir().expect("tempdir");
    // Before any other thread could read them. `app_log_dir()` resolves under
    // `dirs::home_dir()` on macOS and `dirs::data_local_dir()` elsewhere, and both
    // read these.
    std::env::set_var("HOME", home.path());
    std::env::set_var("XDG_DATA_HOME", home.path());

    assert!(
        !logging_is_live(),
        "no logger may be installed before install() runs, or this test proves nothing"
    );

    let app = tauri::test::mock_app();
    baram_lib::logging::install(app.handle());

    assert!(
        logging_is_live(),
        "install() must attach a logger — without `attach`, every log::* in the app is \
         a no-op again"
    );

    // Through the macro, not through a `Box<dyn Log>`: this is the path the app's nine
    // call sites actually take, including the global `max_level` gate.
    log::warn!("integration probe: asset scope registration failed");

    let log_file = find_log_file(home.path()).unwrap_or_else(|| {
        panic!(
            "no baram.log under {} — install() must use the FILE target; in a bundled \
             app stdout has no reader",
            home.path().display()
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
