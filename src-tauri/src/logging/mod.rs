//! Backend logging — what gets kept, and where it goes.
//!
//! Until this module existed, every `log::warn!` in `src-tauri` wrote nowhere. The
//! `log` crate is a facade: its macros forward to whatever implementation
//! `set_logger` was handed, and with none installed they compile down to nothing —
//! no file, no stderr, no devtools. So the nine call sites that report a swallowed
//! failure (a denied asset scope, a dropped registry entry, an unreadable revocation
//! list) were invisible to the user AND to whoever had to debug the user's report.
//!
//! `lib.rs` owns registration; this module owns the policy:
//!
//! * **Our code at Info, everything else at Warn.** Stated as an allowlist — the
//!   default is the strict level and only our own crate is raised — so a dependency
//!   added tomorrow is quiet by default instead of quiet only until someone
//!   remembers to name it.
//! * **Nothing verbose from dependencies, ever.** This is a privacy rule, not a
//!   volume one. `tungstenite` at trace logs whole frames — its `Display for Frame`
//!   writes `payload: 0x…` over every byte (`protocol/frame/frame.rs`), and
//!   `protocol/mod.rs` also traces each decoded message — while PDF export drives
//!   headless Chrome over a websocket. So a global level of Debug would write the
//!   user's document into a file we then ask them to attach to a bug report.
//!   `reqwest` is milder but the same shape: `log::debug!` on the host it dials
//!   (`connect.rs`), which is the LLM provider the user chose. Raising verbosity to
//!   chase a bug means raising `OUR_LEVEL`, which cannot reach either of them.
//! * **UTC, deliberately.** `TimezoneStrategy::UseLocal` resolves to local time on
//!   Windows and falls back to UTC on macOS and Linux, where the `time` crate
//!   refuses to read the local offset in a multi-threaded process. A timestamp
//!   whose meaning depends on the reporter's OS is worse than one that is always
//!   UTC, so this does not "improve" to UseLocal.

use log::LevelFilter;
use tauri::plugin::TauriPlugin;
use tauri::Runtime;
use tauri_plugin_log::{Builder, RotationStrategy, Target, TargetKind, TimezoneStrategy};

/// Base name of the log file. The full path is OS-specific: on macOS
/// `~/Library/Logs/com.inel.baram/baram.log`, on Windows
/// `%LOCALAPPDATA%\com.inel.baram\logs\baram.log`, on Linux
/// `$XDG_DATA_HOME/com.inel.baram/logs/baram.log`.
///
/// Support instructions name this file, so renaming it is a documentation change
/// too — `logging::tests` pins the literal for that reason.
pub const LOG_FILE_NAME: &str = "baram";

/// Level for Baram's own records.
const OUR_LEVEL: LevelFilter = LevelFilter::Info;

/// Level for everything we did not write. See the module docs: this is the privacy
/// boundary, so it must stay at or below Warn.
const DEPENDENCY_LEVEL: LevelFilter = LevelFilter::Warn;

/// Log targets of Baram's own code. `[lib] name = "baram_lib"`, so library records
/// carry the target `baram_lib::…`; `src/main.rs` records carry `baram::…`.
///
/// Both are spelled out because fern resolves `level_for` over `::`-delimited
/// module segments (`find_module`), not string prefixes: an entry for `baram` alone
/// would leave every record from the library — which is all of them — capped at the
/// dependency level.
const OUR_TARGETS: [&str; 2] = ["baram_lib", "baram"];

/// Bytes per log file before it rotates.
const MAX_FILE_SIZE: u128 = 2 * 1024 * 1024;

/// Rotated files kept beside the active one, so a report filed after a restart can
/// still show what the previous session did. Bounds the log directory at
/// `(KEEP_ROTATED + 1) * MAX_FILE_SIZE` ≈ 6 MiB.
const KEEP_ROTATED: usize = 2;

/// Everything about WHICH records are kept and how the file is managed, with no
/// targets attached. Split out from [`plugin`] so tests can run the real policy
/// against a temp directory instead of the OS log directory.
fn policy() -> Builder {
    let mut builder = Builder::new()
        // The default target set (stdout + log dir) is inherited silently; state it
        // in `plugin()` instead, so what this app writes where is visible here.
        .clear_targets()
        .level(DEPENDENCY_LEVEL)
        .max_file_size(MAX_FILE_SIZE)
        .rotation_strategy(RotationStrategy::KeepSome(KEEP_ROTATED))
        .timezone_strategy(TimezoneStrategy::UseUtc);
    for target in OUR_TARGETS {
        builder = builder.level_for(target, OUR_LEVEL);
    }
    builder
}

/// The logger, ready to register. Must be the FIRST plugin in the builder chain:
/// plugin `setup` hooks run in registration order, and anything a plugin logs
/// before this one installs the logger is emitted into a facade that is still a
/// no-op.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    policy()
        .target(Target::new(TargetKind::LogDir {
            file_name: Some(LOG_FILE_NAME.to_string()),
        }))
        // Useful under `npm run tauri dev`; in a bundled app stdout has no reader,
        // which is why the file target above is the one that matters.
        .target(Target::new(TargetKind::Stdout))
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use log::{Level, LevelFilter, Record};
    use tauri_plugin_log::{Target, TargetKind};

    /// Build the production policy against a temp directory and hand back the
    /// `Box<dyn Log>` it would install globally, plus the level it reports to the
    /// `log` facade.
    ///
    /// The only thing swapped out is WHERE the file lives: `TargetKind::Folder`
    /// instead of `TargetKind::LogDir`, because the OS log directory is not ours to
    /// write to from a test. Level, per-module filters and format are the real ones.
    fn spawn_logger(dir: &std::path::Path) -> (LevelFilter, Box<dyn log::Log>) {
        let app = tauri::test::mock_app();
        let (_plugin, max_level, logger) = policy()
            .target(Target::new(TargetKind::Folder {
                path: dir.to_path_buf(),
                file_name: Some(LOG_FILE_NAME.to_string()),
            }))
            .split(app.handle())
            .expect("logger policy must build");
        (max_level, logger)
    }

    fn emit(logger: &dyn log::Log, level: Level, target: &str, msg: &str) {
        logger.log(
            &Record::builder()
                .level(level)
                .target(target)
                .args(format_args!("{msg}"))
                .build(),
        );
    }

    /// Deliberately no `logger.flush()` anywhere in these tests. A log file that
    /// only materializes on a clean shutdown is useless for the case this exists
    /// for — a crash or a hang — so "on disk by the time `log()` returns" is part
    /// of the contract, not an implementation detail.
    fn read_log(dir: &std::path::Path) -> String {
        // The literal, not LOG_FILE_NAME: support docs and any future "reveal log
        // file" affordance name this file, so a rename has to be a decision.
        std::fs::read_to_string(dir.join("baram.log")).unwrap_or_default()
    }

    #[test]
    fn a_warning_from_our_own_code_reaches_the_log_file() {
        let dir = tempfile::tempdir().unwrap();
        let (_, logger) = spawn_logger(dir.path());

        emit(
            &*logger,
            Level::Warn,
            "baram_lib::plugin",
            "asset scope registration failed",
        );

        let written = read_log(dir.path());
        assert!(
            written.contains("asset scope registration failed"),
            "the message must be in the file: {written:?}"
        );
        assert!(
            written.contains("WARN"),
            "the level must be in the file, or a log of only messages cannot be triaged: {written:?}"
        );
        assert!(
            written.contains("baram_lib::plugin"),
            "the module must be in the file, or a message cannot be traced to its site: {written:?}"
        );
    }

    #[test]
    fn info_from_our_own_code_reaches_the_log_file() {
        // Not redundant with the warn case: third-party crates are capped at Warn,
        // and our own code is raised back to Info by module. fern resolves
        // `level_for` over `::`-delimited SEGMENTS (`find_module`, log_impl.rs), so
        // an entry for "baram" would NOT match "baram_lib::plugin" — the lib target
        // has to be spelled out. Without this test that mistake is silent: warnings
        // keep working and every `log::info!` in the app disappears.
        let dir = tempfile::tempdir().unwrap();
        let (_, logger) = spawn_logger(dir.path());

        emit(
            &*logger,
            Level::Info,
            "baram_lib::plugin",
            "third-party registry is not signature-verified",
        );

        assert!(
            read_log(dir.path()).contains("third-party registry is not signature-verified"),
            "our own info records must be kept"
        );
    }

    #[test]
    fn a_warning_from_a_dependency_reaches_the_log_file() {
        // Dependencies keep warn/error: they are rare, and when a save or a fetch
        // fails the explanation is often theirs, not ours.
        let dir = tempfile::tempdir().unwrap();
        let (_, logger) = spawn_logger(dir.path());

        emit(&*logger, Level::Warn, "notify::fsevent", "stream dropped");

        assert!(
            read_log(dir.path()).contains("stream dropped"),
            "a dependency's warning must be kept"
        );
    }

    #[test]
    fn debug_and_trace_from_dependencies_never_reach_the_log_file() {
        // The privacy guard. `tungstenite` at trace logs whole frames, payload
        // bytes included, and PDF export drives chromiumoxide over a websocket — so
        // a verbose third-party level writes the user's DOCUMENT into a file we then
        // ask them to attach to a bug report. `reqwest` at debug logs the host it
        // dials. The messages below stand in for those records; the fixture is the
        // (target, level) pair, not the wording. Capping the default at Warn is what
        // prevents them, and it holds for crates nobody has enumerated yet, which a
        // denylist of known-chatty crates would not.
        let dir = tempfile::tempdir().unwrap();
        let (_, logger) = spawn_logger(dir.path());

        emit(
            &*logger,
            Level::Debug,
            "reqwest::connect",
            "starting new connection: https://generativelanguage.googleapis.com/",
        );
        emit(
            &*logger,
            Level::Trace,
            "tungstenite::protocol",
            "received frame with the private note body",
        );
        emit(&*logger, Level::Trace, "keyring::macos", "getting password");
        // The generalization, not a fourth example: nothing names this crate
        // anywhere, so if it is quiet then the DEFAULT level is what silences it and
        // the rule covers the dependency added next year too. Swap `.level()` for a
        // per-crate denylist and this is the assertion that goes red.
        emit(
            &*logger,
            Level::Debug,
            "some_crate_nobody_has_enumerated",
            "chatty unenumerated record",
        );

        let written = read_log(dir.path());
        assert!(
            !written.contains("generativelanguage"),
            "a dependency's debug record must not be written: {written:?}"
        );
        assert!(
            !written.contains("private note body"),
            "a dependency's trace record must not be written: {written:?}"
        );
        assert!(
            !written.contains("getting password"),
            "a dependency's trace record must not be written: {written:?}"
        );
        assert!(
            !written.contains("chatty unenumerated record"),
            "an unenumerated crate must be quiet by default, not by being listed: {written:?}"
        );
    }

    #[test]
    fn our_own_debug_records_are_dropped() {
        // Deliberate, and stated because it surprises: `log::debug!` in our own code
        // is dead in every build, dev included. Info is the floor so that what ships
        // stays readable and small enough to attach to a report. A developer who
        // wants a temporary debug trace raises OUR_LEVEL, which is one line here and
        // cannot pull dependency verbosity in with it.
        let dir = tempfile::tempdir().unwrap();
        let (_, logger) = spawn_logger(dir.path());

        emit(&*logger, Level::Debug, "baram_lib::plugin", "step by step");

        assert!(
            !read_log(dir.path()).contains("step by step"),
            "our own debug records must not be written"
        );
    }

    #[test]
    fn the_level_reported_to_the_log_facade_is_info() {
        // `log::set_max_level` gates the macros before they ever reach fern, so this
        // number decides whether `log::info!` in our code is compiled-in-but-dead.
        // It must be exactly Info: lower drops our own info records, higher lets
        // `RUST_LOG`-style experiments turn on dependency verbosity that the test
        // above forbids.
        let dir = tempfile::tempdir().unwrap();
        let (max_level, _) = spawn_logger(dir.path());
        assert_eq!(max_level, LevelFilter::Info);
    }

    /// The policy above is only reached if `run()` registers it, and it must be
    /// registered FIRST: a plugin's `setup` hook runs in registration order, so
    /// anything logged by a plugin registered ahead of the logger is emitted while
    /// the facade is still a no-op and is lost.
    ///
    /// A source scan, in the shape `tests/acl_lockdown.rs` established: window the
    /// search to the builder chain, then assert ORDER rather than presence — a bare
    /// `contains("logging::plugin")` would also pass with the call sitting last.
    #[test]
    fn the_logger_is_the_first_plugin_registered() {
        let src = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs"),
        )
        .expect("read src/lib.rs");
        let chain_start = src
            .find("tauri::Builder::default()")
            .expect("builder chain not found in lib.rs");
        let chain_end = src[chain_start..]
            .find(".setup(")
            .expect("builder chain has no .setup(")
            + chain_start;
        let chain = &src[chain_start..chain_end];

        let registrations: Vec<&str> = chain
            .lines()
            .map(str::trim)
            .filter(|l| l.starts_with(".plugin("))
            .collect();
        assert!(
            registrations.len() > 1,
            "expected several .plugin( registrations in the chain, found {registrations:?}"
        );
        assert!(
            registrations[0].contains("logging::plugin"),
            "the logger must be the first plugin registered, or earlier plugins log into a \
             no-op facade. First registration is: {}",
            registrations[0]
        );
    }
}
