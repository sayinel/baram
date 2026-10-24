//! `logging::install` when the log directory cannot be created.
//!
//! This is the branch the whole shape of `install` exists for. Registered as
//! tauri-plugin-log's own plugin, this error propagates out of `Builder::build()` into
//! `run()`'s `.expect(...)` and **the app does not start** — with a panic that reads
//! "building tauri application" and never mentions logging. A log file the OS will not
//! let us create must not cost the user their editor.
//!
//! A separate binary from `logging_install.rs` because the logger `install` attaches is
//! process-global and one-shot, and each of the two needs its own.

use std::path::Path;
use tauri::utils::config::{AppDirectoriesOverride, AppDirectoryOverrides};

/// A mock app context whose log directory is `dir`, on every platform — through tauri's
/// `appDirectoriesOverride`, for the reason `app_logging_into` in `logging_install.rs`
/// gives: on Windows no environment variable moves the default log directory.
fn context_logging_into(dir: &Path) -> tauri::Context<tauri::test::MockRuntime> {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().app.app_directories_override =
        Some(AppDirectoriesOverride::Directories(AppDirectoryOverrides {
            log: Some(dir.to_path_buf()),
            ..Default::default()
        }));
    context
}

#[test]
fn an_unwritable_log_directory_costs_the_log_but_not_the_app() {
    let dir = tempfile::tempdir().expect("tempdir");
    // A regular file where a parent of the log directory should be, so `create_dir_all`
    // of `<file>/logs` fails. This stands in for the real cases: a root-owned log
    // directory, a full volume, an unset HOME, or macOS refusing access (this app
    // already has a live TCC-denial class, #252).
    let not_a_dir = dir.path().join("parent-is-a-file");
    std::fs::write(&not_a_dir, b"x").expect("write");
    let log_dir = not_a_dir.join("logs");

    // Fail on the CAUSE. If the redirect stopped applying, `install` would take the
    // HAPPY path in the real log directory, and every assertion below would pass while
    // the branch this binary exists for went unexercised — a vacuous green.
    let probe = tauri::test::mock_builder()
        .build(context_logging_into(&log_dir))
        .expect("mock app");
    let resolved = tauri::Manager::path(probe.handle())
        .app_log_dir()
        .expect("app_log_dir must resolve");
    assert!(
        resolved.starts_with(&not_a_dir),
        "the log directory ignored the override: it resolved to {} instead of under {}, \
         so the unwritable branch would not be exercised at all",
        resolved.display(),
        not_a_dir.display()
    );

    // ‼️ The assertion that matters most, and the one a direct `install` call cannot
    // make: build a real app through `logging::plugin()`. That runs tauri's actual
    // `initialize_plugins` path, so it is the propagation boundary itself under test —
    // if the plugin's setup ever returns `Err` (a `?` slipped in, someone "surfacing"
    // the failure), this is `Error::PluginInitialization` out of `build()`, which in
    // `run()` is a panic and a Baram that does not start. Nothing else executes that
    // wrapper: the source scan in `logging::tests` only matches its name in a string.
    let built = tauri::test::mock_builder()
        .plugin(baram_lib::logging::plugin())
        .build(context_logging_into(&log_dir));
    assert!(
        built.is_ok(),
        "an unwritable log directory must not stop the app from building"
    );

    let app = tauri::test::mock_builder()
        .build(context_logging_into(&log_dir))
        .expect("mock app");

    // Reaching the next line at all is the primary assertion: no panic.
    baram_lib::logging::install(app.handle());

    assert_ne!(
        log::max_level(),
        log::LevelFilter::Off,
        "the stdout fallback must still be attached — losing the file must not also \
         lose every diagnostic for the session"
    );

    // And logging must remain usable rather than merely non-fatal.
    log::warn!("probe after a failed file target");

    assert!(
        !not_a_dir.is_dir(),
        "sanity: the fixture must still be a regular file, or this test proved nothing"
    );
}
