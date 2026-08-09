//! Backend logging — what gets kept, and where it goes.
//!
//! Until this module existed, every `log::warn!` in `src-tauri` wrote nowhere. The
//! `log` crate is a facade: its macros forward to whatever implementation
//! `set_logger` was handed, and with none installed they compile down to nothing —
//! no file, no stderr, no devtools. So the nine call sites that report a swallowed
//! failure (a denied asset scope, a dropped registry entry, an unreadable revocation
//! list) were invisible to the user AND to whoever had to debug the user's report.
//!
//! [`install`] is called from `lib.rs`'s `setup` hook — deliberately not registered
//! as a Tauri plugin; see that function for why. The policy it installs:
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

use std::borrow::Cow;

use log::LevelFilter;
use tauri::{AppHandle, Runtime};
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
/// still show what the previous session did. Normally bounds the log directory at
/// `(KEEP_ROTATED + 1) * MAX_FILE_SIZE` ≈ 6 MiB.
///
/// Not a hard guarantee, and the gap is upstream's: rotated names are
/// second-precision, so two rotations inside one second make the second one rename
/// the first to `baram_<date>.log.bak`, and the reaper only ever considers names
/// ending `.log`. Such a file is never reclaimed. Reaching it needs ~4 MiB of log in
/// one second, which ordinary use does not produce — the one path that could was
/// `plugin/mod.rs`'s per-entry registry warning, now bounded by `MAX_NAMED_DROPS`.
const KEEP_ROTATED: usize = 2;

/// Everything about WHICH records are kept and how the file is managed, with no
/// targets attached. Split out from [`install`] so tests can run the real policy
/// against a temp directory instead of the OS log directory.
fn policy() -> Builder {
    let mut builder = Builder::new()
        // The default target set (stdout + log dir) would be inherited silently;
        // `production_target_kinds` states ours instead, where a test can read it.
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

/// Ceiling on one written line, before escaping.
///
/// The count bound in `plugin/mod.rs` (`MAX_NAMED_DROPS`) stops many lines from
/// evicting the log; this stops ONE from doing it. That site interpolates an
/// attacker-supplied registry `id` with no length of its own, and the index may be
/// 4 MiB — so a single entry could produce a single line twice the size of the whole
/// log file, rotating it away and leaving an archive containing nothing but that
/// line. Bounding it here rather than at the call site makes it a property of the
/// logger, so the next site that interpolates something remote inherits it.
///
/// This does not bound the ALLOCATION: `Arguments` has already been rendered by the
/// time a formatter sees it. It bounds what reaches the file.
const MAX_LINE_BYTES: usize = 8 * 1024;

/// One record must never be able to become two lines, or to fill the file.
///
/// Log lines are `[date][time][LEVEL][target] message`, so a newline inside the
/// message yields a second, complete, attacker-chosen line — in the one file whose
/// entire audience is a human reading a bug report. This is reachable without a
/// plugin or a prompt: tauri's asset protocol logs the requested path verbatim at
/// **error** (`protocol/asset.rs`), and remark resolves character references in an
/// image destination, so `![a](x&#10;y.png)` in any note the user opens puts a real
/// newline through `convertFileSrc` and into that path. A hostile registry index
/// gets there more directly still — `plugin/mod.rs` names the offending entry id.
///
/// Applied to the whole formatted line, not just the message: `log::warn!(target:
/// …)` takes an arbitrary target string, so the prefix is not inherently safe
/// either, and the prefix contains nothing this would alter.
///
/// Escaping every control character (not just `\n`) covers `\r`, NUL and the C1
/// range in one predicate rather than a list to keep up to date. `U+2028`/`U+2029`
/// are not control characters and so are not covered by that predicate, but some
/// viewers do break lines on them — they are named explicitly for that reason.
///
/// Backslashes are deliberately NOT escaped. `\n` in the output is therefore
/// ambiguous between an escaped newline and a literal backslash-n in the source
/// string; neither can break a line, and escaping backslashes would turn every
/// Windows path — the log's main payload — into noise.
fn escape_control_chars(line: &str) -> Cow<'_, str> {
    let (line, overflow) = truncate_on_char_boundary(line, MAX_LINE_BYTES);
    if overflow == 0 && !line.chars().any(needs_escape) {
        return Cow::Borrowed(line);
    }
    let mut out = String::with_capacity(line.len() + 8);
    for ch in line.chars() {
        match ch {
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            ch if needs_escape(ch) => out.push_str(&format!("\\u{{{:04x}}}", ch as u32)),
            ch => out.push(ch),
        }
    }
    if overflow > 0 {
        // Say so in the line itself. A silently shortened record reads as a complete
        // one, which is the same deception the escaping above exists to prevent.
        out.push_str(&format!(" …[{overflow} more bytes not logged]"));
    }
    Cow::Owned(out)
}

fn needs_escape(ch: char) -> bool {
    ch.is_control() || ch == '\u{2028}' || ch == '\u{2029}'
}

/// Split at or below `max` bytes without cutting a `char` in half, returning the
/// kept prefix and how many bytes were dropped.
fn truncate_on_char_boundary(line: &str, max: usize) -> (&str, usize) {
    if line.len() <= max {
        return (line, 0);
    }
    let end = (0..=max)
        .rev()
        .find(|&i| line.is_char_boundary(i))
        .unwrap_or(0);
    (&line[..end], line.len() - end)
}

/// A target with the escaping above attached.
///
/// Per-target rather than a global `Builder::format`, for two reasons. A target
/// formatter receives the line the parent dispatch already built — fern's
/// `FormatCallback::finish` rebuilds the record with the formatted args — so the
/// timestamp, level and target prefix do not have to be reproduced here, and cannot
/// drift from the plugin's. And `Builder::timezone_strategy` *is* a format setter
/// ("Calling this method overrides the format set in `Self::format`"), so a global
/// escaper would be silently erased the day someone reorders those two calls,
/// taking the UTC decision with it.
fn escaping_target(kind: TargetKind) -> Target {
    Target::new(kind).format(|out, message, _record| {
        out.finish(format_args!(
            "{}",
            escape_control_chars(&message.to_string())
        ))
    })
}

/// Where records go in a real run.
///
/// Data rather than a chained call, because a policy test cannot see this: it
/// injects its own directory target, so deleting the file target here would leave
/// all of them green while a bundled app wrote to a stdout that has no reader —
/// which is the whole defect this module exists to fix.
fn production_target_kinds() -> Vec<TargetKind> {
    vec![
        TargetKind::LogDir {
            file_name: Some(LOG_FILE_NAME.to_string()),
        },
        // Useful under `npm run tauri dev` only.
        TargetKind::Stdout,
    ]
}

/// Assemble the logger for a target set without installing it.
fn build<R: Runtime>(
    kinds: Vec<TargetKind>,
    app: &AppHandle<R>,
) -> Result<(LevelFilter, Box<dyn log::Log>), tauri_plugin_log::Error> {
    let mut builder = policy();
    for kind in kinds {
        builder = builder.target(escaping_target(kind));
    }
    // The `TauriPlugin` this hands back is discarded on purpose: it exists only to
    // expose the plugin's `log` command to JS, which no capability grants and no
    // frontend code calls. Not registering it keeps that command from existing.
    let (_unused_plugin, max_level, logger) = builder.split(app)?;
    Ok((max_level, logger))
}

/// Install the logger. Called as the first statement of the app's `setup` hook.
///
/// Deliberately not registered as a Tauri plugin. `TargetKind::LogDir` resolves
/// `app_log_dir()` and `create_dir_all`s it inside the plugin's own setup hook, and
/// a plugin setup error propagates out of `Builder::build()` — which `run()`
/// `.expect()`s. So as a plugin, a log directory that is unwritable (taken by a
/// regular file, root-owned, no `HOME`, full volume) would stop Baram from
/// starting, with a panic message that says "building tauri application" and never
/// mentions logging. A diagnostics facility must not be able to do that; attaching
/// by hand is what makes the failure ours to absorb.
///
/// The cost of moving out of the plugin chain is that the logger installs after the
/// other plugins' setup hooks instead of before. Nothing is lost today: the five
/// plugins Baram registers contain no `log::` call sites at all, and tauri core's
/// own are on post-init paths (exit, asset resolution, window events).
pub fn install<R: Runtime>(app: &AppHandle<R>) {
    match build(production_target_kinds(), app) {
        Ok(logger) => attach(logger),
        Err(file_err) => {
            // Losing the file must not also lose stdout: `tauri dev` keeps working,
            // and the reason lands somewhere instead of nowhere.
            eprintln!("[baram] log file unavailable ({file_err}); logging to stdout only");
            match build(vec![TargetKind::Stdout], app) {
                Ok(logger) => attach(logger),
                Err(err) => eprintln!("[baram] logging is disabled: {err}"),
            }
        }
    }
}

fn attach((max_level, logger): (LevelFilter, Box<dyn log::Log>)) {
    // `set_boxed_logger` fails only if a logger is already installed, which in a
    // real run means `install` ran twice.
    if let Err(err) = tauri_plugin_log::attach_logger(max_level, logger) {
        eprintln!("[baram] a logger is already installed: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use log::{Level, LevelFilter, Record};
    use tauri_plugin_log::TargetKind;

    /// Build the production logger against a temp directory and hand back the
    /// `Box<dyn Log>` it would install globally, plus the level it reports to the
    /// `log` facade.
    ///
    /// Goes through the real `build`, so the escaping and the level policy under
    /// test are the ones a release build gets. The only thing swapped is WHERE the
    /// file lives: `TargetKind::Folder` instead of `TargetKind::LogDir`, because the
    /// OS log directory is not ours to write to from a test.
    ///
    /// Nothing here calls `attach`: `set_boxed_logger` is process-global and
    /// one-shot, so a test that installed the logger would decide the behaviour of
    /// every other test in this binary — and would write into the developer's real
    /// log directory. `plugin::tests` owns the one global installation, for the one
    /// assertion that needs the facade.
    fn spawn_logger(dir: &std::path::Path) -> (LevelFilter, Box<dyn log::Log>) {
        let app = tauri::test::mock_app();
        build(
            vec![TargetKind::Folder {
                path: dir.to_path_buf(),
                file_name: Some(LOG_FILE_NAME.to_string()),
            }],
            app.handle(),
        )
        .expect("logger must build")
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
    ///
    /// `expect`, never `unwrap_or_default`: the tests that assert a record is
    /// ABSENT are looking for an empty string, and a missing file reads as empty
    /// too. With a default they would all pass against a logger that writes
    /// nowhere at all — and `LOG_FILE_NAME` is the seam, since this function
    /// hardcodes the name on purpose (below) while `spawn_logger` uses the const.
    fn read_log(dir: &std::path::Path) -> String {
        // The literal, not LOG_FILE_NAME: support docs and any future "reveal log
        // file" affordance name this file, so a rename has to be a decision.
        std::fs::read_to_string(dir.join("baram.log")).expect("baram.log must exist")
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
    fn records_from_the_binary_crate_are_kept_at_info() {
        // `OUR_TARGETS` has two entries and every other test exercises only the
        // library one, so `["baram_lib"]` alone would keep them all green. `src/main.rs`
        // has no log calls today; the entry is what makes the first one work.
        let dir = tempfile::tempdir().unwrap();
        let (_, logger) = spawn_logger(dir.path());

        emit(&*logger, Level::Info, "baram", "from the bin crate");

        assert!(
            read_log(dir.path()).contains("from the bin crate"),
            "the bin crate's target must be raised to Info too"
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
        // `keyring` in fact has no trace site and never logs a secret at any level —
        // this stands for the shape, not for a behaviour that crate has.
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
        // The positive control. Every record above is meant to vanish, so the
        // absence assertions are all satisfied by an empty file — including one
        // produced by a logger that writes nowhere. This record must survive, so
        // "nothing was written at all" can no longer pass as "correctly filtered".
        emit(&*logger, Level::Warn, "baram_lib::plugin", "control record");

        let written = read_log(dir.path());
        assert!(
            written.contains("control record"),
            "positive control missing — this logger is not writing at all: {written:?}"
        );
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
    fn a_control_character_cannot_split_one_record_into_two_lines() {
        // The log-injection guard. A line is `[date][time][LEVEL][target] message`,
        // so a newline in the message produces a second line indistinguishable from
        // a genuine one — in the file whose only audience is a person reading a bug
        // report. Reachable from note text: remark resolves `&#10;` inside an image
        // destination, and tauri's asset protocol logs the path verbatim at error.
        let dir = tempfile::tempdir().unwrap();
        let (_, logger) = spawn_logger(dir.path());

        emit(
            &*logger,
            Level::Warn,
            "baram_lib::plugin",
            "before\n[2026-01-01][00:00:00][ERROR][baram_lib] forged\rand\0here",
        );

        let written = read_log(dir.path());
        assert_eq!(
            written.lines().count(),
            1,
            "one record must be one line: {written:?}"
        );
        assert!(
            written.contains("before\\n[2026-01-01]"),
            "the newline must survive as an escape, so the text is still readable: {written:?}"
        );
        assert!(
            written.contains("forged\\rand\\u{0000}here"),
            "carriage return and NUL must be escaped too: {written:?}"
        );
    }

    #[test]
    fn a_line_separator_cannot_split_a_record_either() {
        // U+2028/U+2029 are category Zl/Zp, so `char::is_control` is false for them
        // and the escaping predicate has to name them. Some viewers break lines on
        // them, and a forged line only has to fool the person reading the file.
        let dir = tempfile::tempdir().unwrap();
        let (_, logger) = spawn_logger(dir.path());

        emit(
            &*logger,
            Level::Warn,
            "baram_lib::plugin",
            "before\u{2028}after\u{2029}end",
        );

        let written = read_log(dir.path());
        assert!(
            !written.contains('\u{2028}') && !written.contains('\u{2029}'),
            "line separators must not survive raw: {written:?}"
        );
        assert!(
            written.contains("before\\u{2028}after\\u{2029}end"),
            "…and must survive as escapes: {written:?}"
        );
    }

    #[test]
    fn one_record_cannot_fill_the_log_file() {
        // The companion to `MAX_NAMED_DROPS`, which bounds how MANY lines a hostile
        // registry index produces but not how BIG one is. `plugin/mod.rs` names the
        // offending entry id, an id has no length limit of its own, and the index may
        // be 4 MiB — one line twice the size of the whole log file, rotating every
        // real diagnostic away and leaving an archive of nothing but that line.
        let dir = tempfile::tempdir().unwrap();
        let (_, logger) = spawn_logger(dir.path());

        let huge = "A".repeat(MAX_LINE_BYTES * 3);
        emit(&*logger, Level::Warn, "baram_lib::plugin", &huge);

        let written = read_log(dir.path());
        assert!(
            written.len() < MAX_LINE_BYTES + 200,
            "the written line must be bounded, got {} bytes",
            written.len()
        );
        assert!(
            written.contains("more bytes not logged"),
            "a shortened record must say so, or it reads as a complete one: {}",
            &written[written.len().saturating_sub(120)..]
        );
    }

    #[test]
    fn a_multibyte_character_is_not_cut_in_half() {
        // Truncation happens on byte length, so a naive cut can land inside a UTF-8
        // sequence — which panics on slicing, in the code path that runs when
        // something has ALREADY gone wrong. Korean paths make this the normal case
        // here, not an edge one.
        let dir = tempfile::tempdir().unwrap();
        let (_, logger) = spawn_logger(dir.path());

        // 3 bytes per char, so no multiple of the char width lands on the cap.
        let korean = "가".repeat(MAX_LINE_BYTES);
        emit(&*logger, Level::Warn, "baram_lib::tag", &korean);

        let written = read_log(dir.path());
        assert!(
            written.contains("가가가"),
            "the kept prefix must still be readable Korean"
        );
        assert!(
            written.contains("more bytes not logged"),
            "and it must be marked as shortened"
        );
    }

    #[test]
    fn an_ordinary_message_is_written_unchanged() {
        // The other half of the escaping contract: a message with nothing to escape
        // must not be rewritten. Guards against an escaper that mangles ordinary
        // paths — the log's main payload — e.g. by escaping backslashes, which would
        // turn every Windows path into noise.
        let dir = tempfile::tempdir().unwrap();
        let (_, logger) = spawn_logger(dir.path());

        emit(
            &*logger,
            Level::Warn,
            "baram_lib::tag",
            r"failed to write C:\Users\me\vault\note.md: denied",
        );

        assert!(
            read_log(dir.path()).contains(r"failed to write C:\Users\me\vault\note.md: denied"),
            "a message with no control characters must be byte-identical"
        );
    }

    #[test]
    fn production_writes_to_the_os_log_directory_and_stdout() {
        // The policy tests inject their own directory target, so they cannot see this
        // list at all: deleting the file target would leave every one of them green
        // while a bundled app logged only to a stdout nobody reads — the exact defect
        // this module was written to fix. Asserted as data for that reason.
        let kinds = production_target_kinds();
        assert_eq!(
            kinds.len(),
            2,
            "expected exactly the file and stdout targets"
        );
        match &kinds[0] {
            TargetKind::LogDir { file_name } => assert_eq!(
                file_name.as_deref(),
                Some("baram"),
                "the file users are told to attach is baram.log"
            ),
            // `TargetKind` implements neither Debug nor PartialEq, hence `matches!`
            // and a message that cannot name what it found.
            _ => panic!("the first target must be the OS log dir"),
        }
        assert!(
            matches!(kinds[1], TargetKind::Stdout),
            "stdout must stay for `tauri dev`"
        );
        // No Webview target: it broadcasts a `log://log` event to every webview, and
        // app internals do not belong on a bus that plugin windows share.
        assert!(
            !kinds.iter().any(|k| matches!(k, TargetKind::Webview)),
            "the webview target must stay out"
        );
    }

    #[test]
    fn a_log_directory_that_cannot_be_created_is_not_fatal() {
        // Why `install` attaches by hand instead of registering a plugin: as a plugin,
        // this error propagates out of `Builder::build()` into `run()`'s `.expect()`
        // and the app does not start — a log file the OS will not let us create must
        // not cost the user their editor.
        let app = tauri::test::mock_app();
        let dir = tempfile::tempdir().unwrap();
        let occupied = dir.path().join("not-a-directory");
        std::fs::write(&occupied, b"x").unwrap();

        let failed = build(
            vec![TargetKind::Folder {
                // `create_dir_all` cannot make this: its parent is a regular file.
                path: occupied.join("logs"),
                file_name: Some(LOG_FILE_NAME.to_string()),
            }],
            app.handle(),
        );
        assert!(
            failed.is_err(),
            "an uncreatable log directory must surface as an error, not a panic"
        );

        // …and the fallback `install` reaches for must still be buildable, or
        // absorbing the error would leave no logging at all.
        assert!(
            build(vec![TargetKind::Stdout], app.handle()).is_ok(),
            "the stdout-only fallback must build"
        );
    }

    /// The policy above only runs if `setup` installs it, and it must be the FIRST
    /// statement there: until it returns, `log::*` is a no-op facade, so anything
    /// the rest of `setup` logs is lost.
    ///
    /// A source scan, in the shape `tests/acl_lockdown.rs` established: window the
    /// search, then assert POSITION rather than presence — a bare
    /// `contains("logging::install")` passes just as well with the call at the end.
    #[test]
    fn the_logger_is_installed_first_in_setup() {
        let src = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs"),
        )
        .expect("read src/lib.rs");
        let setup = src
            .find(".setup(")
            .map(|i| &src[i..])
            .expect("no .setup( in lib.rs");

        let first_statement = setup
            .lines()
            .skip(1) // the `.setup(|app| {` line itself
            .map(str::trim)
            .find(|l| !l.is_empty() && !l.starts_with("//"))
            .expect("setup closure has no statements");
        assert!(
            first_statement.contains("logging::install("),
            "the logger must be installed by the first statement of setup, or whatever runs \
             before it logs into a no-op facade. First statement is: {first_statement}"
        );
    }
}
