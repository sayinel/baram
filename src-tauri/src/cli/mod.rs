// §387 The CLI mode of the app binary — `baram <command>` reads a vault and exits
// without starting tauri. Spec: dev/design/specs/0066-cli-read-only-design.md.

mod app_config;
mod args;
mod error;
mod ops;
mod output;
mod vault;

use app_config::AppConfig;
use args::{Cli, Command};
use clap::Parser;
use error::{CliError, ErrorCode};
use std::ffi::OsString;
use std::io::Write;
use std::path::Path;

/// Which of its two modes the binary runs in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Gui,
    Cli,
}

/// Arguments macOS itself adds when it launches an app bundle.
const MACOS_LAUNCH_PREFIXES: &[&str] = &["-psn_", "-NS", "-Apple"];

/// GUI or CLI, from argv alone (spec 0066 §3.1).
///
/// The rule lists what the GUI is launched WITH and sends everything else to the CLI: no
/// argument, an argument macOS adds, an absolute path (a file association), or a URL (a
/// deep link). Listing the CLI's arguments instead would open a window for
/// `baram --json search x` and for every typo — an agent's shell then waits on a GUI,
/// and with no single-instance guard a second app starts beside the first.
///
/// An absolute path counts whether or not it exists. An existence check is false for a
/// file that was deleted, sits on an unmounted drive or is not readable, and a restart
/// replays the same argv — that launch would end as a CLI usage error with no window.
///
/// ‼️ A plugin that relaunches the app with a `-flag` of its own (autostart,
/// single-instance) must have that flag added to the GUI side here, or its launch ends
/// as a usage error.
pub fn mode_for(args: &[OsString]) -> Mode {
    let Some(first) = args.get(1) else {
        return Mode::Gui;
    };
    let first = first.to_string_lossy();
    if MACOS_LAUNCH_PREFIXES
        .iter()
        .any(|prefix| first.starts_with(prefix))
    {
        return Mode::Gui;
    }
    if Path::new(&*first).is_absolute() || is_url(&first) {
        return Mode::Gui;
    }
    Mode::Cli
}

/// `scheme://…` — RFC 3986's scheme, then the two slashes a deep link carries.
fn is_url(arg: &str) -> bool {
    let Some((scheme, _)) = arg.split_once("://") else {
        return false;
    };
    let mut chars = scheme.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
}

/// Why a run did not finish: the command failed, or its output could not be written.
enum Failure {
    Command(CliError),
    Output(std::io::Error),
}

impl From<CliError> for Failure {
    fn from(error: CliError) -> Self {
        Failure::Command(error)
    }
}

impl From<std::io::Error> for Failure {
    fn from(error: std::io::Error) -> Self {
        Failure::Output(error)
    }
}

/// Runs one CLI invocation and returns its exit code: 0 on success — an empty result is
/// a success — 1 when the command failed, 2 for a usage error (spec 0066 §3.7).
pub fn run(args: Vec<OsString>) -> i32 {
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        // clap prints help and the version to stdout (exit 0) and usage errors to stderr
        // (exit 2). Its text is plain even under `--json`: the flag is not read yet.
        Err(error) => {
            let _ = error.print();
            return error.exit_code();
        }
    };
    install_stderr_log();
    let json = cli.json;
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            return report(
                &CliError::new(
                    ErrorCode::Io,
                    format!("cannot start the async runtime: {error}"),
                ),
                json,
            )
        }
    };
    let stdout = std::io::stdout();
    let mut out = std::io::BufWriter::new(stdout.lock());
    let outcome = runtime
        .block_on(execute(cli, &mut out))
        .and_then(|()| out.flush().map_err(Failure::Output));
    match outcome {
        Ok(()) => 0,
        // The reader closed the pipe (`baram read big.md | head`): it has what it wanted.
        Err(Failure::Output(error)) if error.kind() == std::io::ErrorKind::BrokenPipe => 0,
        Err(Failure::Output(error)) => report(
            &CliError::new(ErrorCode::Io, format!("cannot write the output: {error}")),
            json,
        ),
        Err(Failure::Command(error)) => report(&error, json),
    }
}

fn report(error: &CliError, json: bool) -> i32 {
    // A failed write to stderr has nowhere left to be reported.
    let _ = output::write_error(&mut std::io::stderr().lock(), error, json);
    error.code.exit_code()
}

async fn execute(cli: Cli, out: &mut dyn Write) -> Result<(), Failure> {
    let cwd = std::env::current_dir().map_err(|e| {
        CliError::new(
            ErrorCode::Io,
            format!("cannot read the current directory: {e}"),
        )
    })?;
    let home = dirs::home_dir();
    let config = match app_config::default_path() {
        Some(path) => app_config::load(&path),
        None => AppConfig::default(),
    };
    {
        let mut stderr = std::io::stderr().lock();
        for warning in &config.warnings {
            // A warning that cannot be written is dropped; the command still runs.
            let _ = output::write_warning(&mut stderr, warning, cli.json);
        }
    }
    log::debug!("cli: {} registered roots", config.registered.len());
    // Kept as a Result: a command that needs the vault starts its arm with
    // `let vault = resolved?;`. `vaults` is what a caller runs to FIND a vault, so it
    // does not fail when none resolves (spec 0066 §3.3-4).
    let resolved = vault::resolve(
        cli.vault.as_deref(),
        &cwd,
        home.as_deref(),
        &config.registered,
    );
    match cli.command {
        Command::Vaults => {
            let envelope = ops::vaults(&config, resolved.as_ref().ok());
            output::write_envelope(out, &envelope, cli.json)?;
        }
    }
    Ok(())
}

/// `BARAM_LOG=1` sends the crate's `log` records to stderr. Never the app's log file:
/// that one has rotation and a size cap, and a second writer beside a running app would
/// break both.
struct StderrLog;

impl log::Log for StderrLog {
    fn enabled(&self, _: &log::Metadata) -> bool {
        true
    }

    fn log(&self, record: &log::Record) {
        let _ = writeln!(std::io::stderr(), "[{}] {}", record.level(), record.args());
    }

    fn flush(&self) {}
}

static STDERR_LOG: StderrLog = StderrLog;

fn install_stderr_log() {
    if std::env::var_os("BARAM_LOG").is_some() && log::set_logger(&STDERR_LOG).is_ok() {
        log::set_max_level(log::LevelFilter::Debug);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mode(args: &[&str]) -> Mode {
        let argv: Vec<OsString> = std::iter::once("baram")
            .chain(args.iter().copied())
            .map(OsString::from)
            .collect();
        mode_for(&argv)
    }

    #[test]
    fn no_argument_is_the_gui() {
        assert_eq!(mode(&[]), Mode::Gui);
    }

    #[test]
    fn what_macos_adds_is_the_gui() {
        for arg in [
            "-psn_0_12345",
            "-NSDocumentRevisionsDebugMode",
            "-AppleLanguages",
        ] {
            assert_eq!(mode(&[arg]), Mode::Gui, "{arg}");
        }
    }

    #[test]
    fn commands_and_flags_are_the_cli() {
        for args in [
            &["search", "x"][..],
            &["help"][..],
            &["--json", "search", "x"][..],
            &["--vault", "notes", "tags"][..],
            &["-h"][..],
            &["-V"][..],
            &["--version"][..],
        ] {
            assert_eq!(mode(args), Mode::Cli, "{args:?}");
        }
    }

    #[test]
    fn an_absolute_path_is_the_gui_whether_or_not_it_exists() {
        let gone = if cfg!(windows) {
            r"C:\notes\gone.md"
        } else {
            "/notes/gone.md"
        };
        assert_eq!(mode(&[gone]), Mode::Gui);
        let here = std::env::temp_dir().to_string_lossy().into_owned();
        assert!(Path::new(&here).is_absolute());
        assert_eq!(mode(&[here.as_str()]), Mode::Gui);
    }

    #[test]
    fn a_url_is_the_gui() {
        for arg in [
            "baram://open?path=a.md",
            "file:///tmp/a.md",
            "x-callback+1.0://y",
        ] {
            assert_eq!(mode(&[arg]), Mode::Gui, "{arg}");
        }
        // Not a scheme: it starts with a digit, holds a character a scheme cannot, or
        // is empty.
        for arg in ["1x://y", "a b://c", "://x"] {
            assert_eq!(mode(&[arg]), Mode::Cli, "{arg}");
        }
    }

    #[test]
    fn a_typo_or_a_relative_path_is_the_cli_so_it_ends_as_a_usage_error() {
        for arg in ["serch", "notes/a.md", "./a.md", "a.md"] {
            assert_eq!(mode(&[arg]), Mode::Cli, "{arg}");
        }
    }
}
