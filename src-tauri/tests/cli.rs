//! §387 `baram <command>` end to end: the real binary, a throwaway HOME, a vault in a
//! temp dir. Spec: dev/design/specs/0066-cli-read-only-design.md §7.
//!
//! Unix only. The child finds config.json through `dirs::data_dir()`, which reads HOME
//! and XDG_DATA_HOME there; Windows asks the Known Folder API and ignores both, so the
//! child would read the developer's real config. CI runs ubuntu and macOS.
#![cfg(unix)]

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Longer than any command here takes, far shorter than a window opened by mistake
/// would stay up. The timeout is what catches a CLI invocation routed to the GUI.
const TIMEOUT: Duration = Duration::from_secs(30);

struct Sandbox {
    _dir: tempfile::TempDir,
    base: PathBuf,
    home: PathBuf,
    xdg: PathBuf,
    vault: PathBuf,
}

struct Ran {
    code: i32,
    stdout: String,
    stderr: String,
}

fn sandbox() -> Sandbox {
    let dir = tempfile::tempdir().expect("tempdir");
    // Canonical: macOS hands out /var/… and resolves it to /private/var/…, and the CLI
    // prints the canonical root.
    let base = dir.path().canonicalize().expect("canonicalize");
    let home = base.join("home");
    let xdg = base.join("xdg");
    let vault = base.join("vault");
    for created in [&home, &xdg, &vault] {
        std::fs::create_dir_all(created).expect("mkdir");
    }
    Sandbox {
        _dir: dir,
        base,
        home,
        xdg,
        vault,
    }
}

fn write(root: &Path, rel: &str, body: &str) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    std::fs::write(path, body).expect("write");
}

/// Writes config.json where `dirs::data_dir()` points on macOS (under HOME) and on Linux
/// (XDG_DATA_HOME). Each value is what zustand persist would have written, stored as a
/// JSON STRING — the way `set_config` stores it.
fn write_config(sb: &Sandbox, values: &[(&str, serde_json::Value)]) {
    let mut map = serde_json::Map::new();
    for (key, value) in values {
        map.insert(
            (*key).to_string(),
            serde_json::Value::String(value.to_string()),
        );
    }
    let text = serde_json::Value::Object(map).to_string();
    for dir in [
        sb.home.join("Library/Application Support/com.inel.baram"),
        sb.xdg.join("com.inel.baram"),
    ] {
        std::fs::create_dir_all(&dir).expect("mkdir");
        std::fs::write(dir.join("config.json"), &text).expect("write config");
    }
}

/// `baram:context` as the app persists it: the sandbox vault registered as the vault
/// "Fixture" (alias `fx`), a folder context whose directory is gone and is the active
/// one, and a file context.
fn registered(sb: &Sandbox) -> serde_json::Value {
    serde_json::json!({
        "state": {
            "contexts": [
                { "id": "ctx-1", "contextType": "vault", "path": sb.vault, "label": "Fixture",
                  "color": "#4f8cff", "alias": "fx", "vaultType": "general", "addedAt": 1 },
                { "id": "ctx-2", "contextType": "folder", "path": sb.base.join("gone"),
                  "label": "Gone", "color": "#ff8c4f", "addedAt": 2 },
                { "id": "ctx-3", "contextType": "file", "path": sb.base.join("one.md"),
                  "label": "one.md", "color": "#8c4fff", "addedAt": 3 }
            ],
            "activeContextId": "ctx-2"
        },
        "version": 1
    })
}

fn baram(sb: &Sandbox, cwd: &Path, args: &[&str]) -> Ran {
    baram_env(sb, cwd, args, &[])
}

fn baram_env(sb: &Sandbox, cwd: &Path, args: &[&str], env: &[(&str, &str)]) -> Ran {
    let mut command = isolated(sb, env!("CARGO_BIN_EXE_baram"));
    command.args(args).current_dir(cwd);
    for (key, value) in env {
        command.env(key, value);
    }
    finish(command, &args.join(" "))
}

/// Runs `baram` from a directory that is deleted under it, so the child starts with a
/// current directory it cannot read. A child cannot be spawned INTO a missing directory:
/// `sh` makes one under `parent`, enters it, removes it and `exec`s the binary in place.
fn baram_from_a_deleted_directory(sb: &Sandbox, parent: &Path, args: &[&str]) -> Ran {
    let mut command = isolated(sb, "sh");
    command
        .arg("-c")
        .arg(r#"d=$(mktemp -d "$1/cwd.XXXXXX") && cd "$d" && rmdir "$d" && shift && exec "$@""#)
        .arg("sh")
        .arg(parent)
        .arg(env!("CARGO_BIN_EXE_baram"))
        .args(args);
    finish(
        command,
        &format!("{} (from a deleted directory)", args.join(" ")),
    )
}

/// `program` with what every run here gets: the sandbox's HOME and data directory, no
/// `BARAM_LOG`, no stdin, both outputs captured.
fn isolated(sb: &Sandbox, program: &str) -> Command {
    let mut command = Command::new(program);
    command
        // `dirs` reads these. Without them the child reads the developer's real
        // config.json — `logging_install_unwritable.rs` isolates the same way.
        .env("HOME", &sb.home)
        .env("XDG_DATA_HOME", &sb.xdg)
        .env_remove("BARAM_LOG")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}

/// Waits for `command` to exit and collects what it printed. `label` names the run if
/// it has to be killed.
fn finish(mut command: Command, label: &str) -> Ran {
    let mut child = command.spawn().expect("spawn baram");
    let mut stdout = child.stdout.take().expect("stdout");
    let mut stderr = child.stderr.take().expect("stderr");
    let out = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.read_to_string(&mut text);
        text
    });
    let err = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text);
        text
    });
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().expect("try_wait") {
            break status;
        }
        if started.elapsed() > TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            panic!("`baram {label}` did not exit within {TIMEOUT:?} — was it routed to the GUI?");
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    Ran {
        code: status.code().expect("exit code"),
        stdout: out.join().expect("stdout thread"),
        stderr: err.join().expect("stderr thread"),
    }
}

fn json(text: &str) -> serde_json::Value {
    serde_json::from_str(text).unwrap_or_else(|e| panic!("not JSON ({e}): {text:?}"))
}

// ── the two modes ─────────────────────────────────────────────────────────────────

#[test]
fn version_exits_without_a_window() {
    let sb = sandbox();
    let ran = baram(&sb, &sb.home, &["--version"]);
    assert_eq!(ran.code, 0, "stderr: {}", ran.stderr);
    assert_eq!(ran.stdout, format!("baram {}\n", env!("CARGO_PKG_VERSION")));
}

#[test]
fn a_typo_is_a_usage_error_not_a_window() {
    let sb = sandbox();
    let ran = baram(&sb, &sb.home, &["serch", "x"]);
    assert_eq!(ran.code, 2);
    assert!(ran.stdout.is_empty(), "stdout: {}", ran.stdout);
    assert!(ran.stderr.contains("serch"), "stderr: {}", ran.stderr);
}

// ── vaults ────────────────────────────────────────────────────────────────────────

#[test]
fn vaults_lists_what_the_app_registered_and_marks_where_we_are() {
    let sb = sandbox();
    write_config(&sb, &[("baram:context", registered(&sb))]);
    write(&sb.vault, "sub/note.md", "x\n");
    let ran = baram(&sb, &sb.vault.join("sub"), &["--json", "vaults"]);
    assert_eq!(ran.code, 0, "stderr: {}", ran.stderr);
    assert!(ran.stderr.is_empty(), "stderr: {}", ran.stderr);
    // Exactly the sandbox's two roots: the child read THIS config, not the developer's,
    // and the file context is not listed.
    assert_eq!(
        json(&ran.stdout),
        serde_json::json!({
            "vault": { "name": "Fixture", "path": sb.vault },
            "truncated": false,
            "items": [
                { "name": "Fixture", "path": sb.vault, "alias": "fx", "type": "vault",
                  "current": true, "active": false, "exists": true },
                { "name": "Gone", "path": sb.base.join("gone"), "alias": null, "type": "folder",
                  "current": false, "active": true, "exists": false }
            ]
        })
    );
}

#[test]
fn vaults_text_puts_a_star_on_the_current_one() {
    let sb = sandbox();
    write_config(&sb, &[("baram:context", registered(&sb))]);
    let ran = baram(&sb, &sb.home, &["--vault", "FX", "vaults"]);
    assert_eq!(ran.code, 0, "stderr: {}", ran.stderr);
    assert_eq!(
        ran.stdout,
        format!(
            "*\tFixture\tvault\t{}\n\tGone\tfolder\t{}\n",
            sb.vault.display(),
            sb.base.join("gone").display()
        )
    );
}

#[test]
fn vaults_does_not_fail_where_no_vault_resolves() {
    let sb = sandbox();
    // No config.json at all, and a current directory that is in no vault.
    let ran = baram(&sb, &sb.home, &["--json", "vaults"]);
    assert_eq!(ran.code, 0, "stderr: {}", ran.stderr);
    assert!(ran.stderr.is_empty(), "stderr: {}", ran.stderr);
    assert_eq!(
        json(&ran.stdout),
        serde_json::json!({ "vault": null, "truncated": false, "items": [] })
    );
}

/// The deleted directory is made INSIDE the registered vault: a child that could read it
/// would resolve "Fixture", so `"vault": null` shows the directory really was unreadable.
#[test]
fn vaults_runs_from_a_current_directory_that_was_deleted() {
    let sb = sandbox();
    write_config(&sb, &[("baram:context", registered(&sb))]);
    let listed = baram_from_a_deleted_directory(&sb, &sb.vault, &["--json", "vaults"]);
    assert_eq!(listed.code, 0, "stderr: {}", listed.stderr);
    assert!(listed.stderr.is_empty(), "stderr: {}", listed.stderr);
    assert_eq!(
        json(&listed.stdout),
        serde_json::json!({
            "vault": null,
            "truncated": false,
            "items": [
                { "name": "Fixture", "path": sb.vault, "alias": "fx", "type": "vault",
                  "current": false, "active": false, "exists": true },
                { "name": "Gone", "path": sb.base.join("gone"), "alias": null, "type": "folder",
                  "current": false, "active": true, "exists": false }
            ]
        })
    );

    // An absolute --vault does not read the current directory, so it still resolves.
    let vault = sb.vault.to_string_lossy().into_owned();
    let named = baram_from_a_deleted_directory(
        &sb,
        &sb.vault,
        &["--vault", vault.as_str(), "--json", "vaults"],
    );
    assert_eq!(named.code, 0, "stderr: {}", named.stderr);
    assert!(named.stderr.is_empty(), "stderr: {}", named.stderr);
    assert_eq!(
        json(&named.stdout)["vault"],
        serde_json::json!({ "name": "Fixture", "path": sb.vault })
    );
}

#[test]
fn a_config_that_cannot_be_read_is_a_warning_and_the_command_still_runs() {
    let sb = sandbox();
    write_config(
        &sb,
        &[("baram:context", serde_json::json!({ "version": 1 }))],
    );
    let text = baram(&sb, &sb.home, &["vaults"]);
    assert_eq!(text.code, 0);
    assert!(text.stdout.is_empty(), "stdout: {}", text.stdout);
    assert_eq!(text.stderr, "warning: baram:context: no `state` object\n");

    let as_json = baram(&sb, &sb.home, &["--json", "vaults"]);
    assert_eq!(as_json.code, 0);
    assert_eq!(
        json(&as_json.stderr),
        serde_json::json!({ "warning": { "message": "baram:context: no `state` object" } })
    );
}

#[test]
fn baram_log_sends_diagnostics_to_stderr_and_only_when_asked() {
    let sb = sandbox();
    let quiet = baram(&sb, &sb.home, &["vaults"]);
    assert!(quiet.stderr.is_empty(), "stderr: {}", quiet.stderr);
    let loud = baram_env(&sb, &sb.home, &["vaults"], &[("BARAM_LOG", "1")]);
    assert_eq!(loud.code, 0);
    assert!(
        loud.stderr.contains("cli: 0 registered roots"),
        "stderr: {}",
        loud.stderr
    );
}
