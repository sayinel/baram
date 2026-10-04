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

fn vault_arg(sb: &Sandbox) -> String {
    sb.vault.to_string_lossy().into_owned()
}

/// Whether `text` holds a Hangul syllable or jamo. The app's own error enums say their
/// piece in Korean, so this is how a test sees one of them leak into CLI output.
fn has_hangul(text: &str) -> bool {
    text.chars().any(|c| {
        matches!(c, '\u{1100}'..='\u{11FF}' | '\u{3130}'..='\u{318F}' | '\u{AC00}'..='\u{D7A3}')
    })
}

/// Sets a directory's mode back to `0o755` when dropped. Declared after the `Sandbox`, it
/// runs first, so the tempdir can be removed even when an assertion unwinds.
struct Unlock(PathBuf);

impl Drop for Unlock {
    fn drop(&mut self) {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&self.0, std::fs::Permissions::from_mode(0o755));
    }
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

// ── read ──────────────────────────────────────────────────────────────────────────

#[test]
fn read_prints_the_file_as_it_is() {
    let sb = sandbox();
    let body = "line one\n\ttabbed \\ back\nno trailing newline";
    write(&sb.vault, "notes/a.md", body);
    let vault = vault_arg(&sb);
    let ran = baram(&sb, &sb.home, &["--vault", &vault, "read", "notes/a.md"]);
    assert_eq!(ran.code, 0, "stderr: {}", ran.stderr);
    assert_eq!(ran.stdout, body);
    assert!(ran.stderr.is_empty(), "stderr: {}", ran.stderr);
}

#[test]
fn read_json_is_one_envelope() {
    let sb = sandbox();
    write(&sb.vault, "notes/a.md", "hello\n");
    let vault = vault_arg(&sb);
    let ran = baram(
        &sb,
        &sb.home,
        &["--json", "--vault", &vault, "read", "notes/a.md"],
    );
    assert_eq!(ran.code, 0, "stderr: {}", ran.stderr);
    // An unregistered path is named after its folder.
    assert_eq!(
        json(&ran.stdout),
        serde_json::json!({
            "vault": { "name": "vault", "path": vault },
            "truncated": false,
            "items": [{ "path": "notes/a.md", "content": "hello\n" }]
        })
    );
}

#[test]
fn the_vault_comes_from_a_registered_name_or_from_where_we_stand() {
    let sb = sandbox();
    write_config(&sb, &[("baram:context", registered(&sb))]);
    write(&sb.vault, "notes/a.md", "hello\n");
    let by_name = baram(&sb, &sb.home, &["--vault", "fixture", "read", "notes/a.md"]);
    assert_eq!((by_name.code, by_name.stdout.as_str()), (0, "hello\n"));
    // From a subfolder, the path is still relative to the vault ROOT.
    let by_cwd = baram(&sb, &sb.vault.join("notes"), &["read", "notes/a.md"]);
    assert_eq!((by_cwd.code, by_cwd.stdout.as_str()), (0, "hello\n"));
}

#[test]
fn an_absolute_path_inside_the_vault_is_accepted() {
    let sb = sandbox();
    write(&sb.vault, "notes/a.md", "hello\n");
    let absolute = sb.vault.join("notes/a.md").to_string_lossy().into_owned();
    let vault = vault_arg(&sb);
    let ran = baram(&sb, &sb.home, &["--vault", &vault, "read", &absolute]);
    assert_eq!((ran.code, ran.stdout.as_str()), (0, "hello\n"));
}

#[test]
fn a_path_outside_the_vault_is_refused() {
    let sb = sandbox();
    write(&sb.home, "secret.md", "secret\n");
    let absolute = sb.home.join("secret.md").to_string_lossy().into_owned();
    let vault = vault_arg(&sb);
    for outside in ["../home/secret.md", absolute.as_str()] {
        let ran = baram(
            &sb,
            &sb.home,
            &["--json", "--vault", &vault, "read", outside],
        );
        assert_eq!(ran.code, 1, "{outside}");
        assert!(ran.stdout.is_empty(), "{outside}: {}", ran.stdout);
        assert_eq!(
            json(&ran.stderr)["error"]["code"],
            "PATH_OUTSIDE_VAULT",
            "{outside}"
        );
    }
}

#[test]
fn a_missing_file_is_file_not_found_on_stderr() {
    let sb = sandbox();
    let vault = vault_arg(&sb);
    let ran = baram(&sb, &sb.home, &["--vault", &vault, "read", "nope.md"]);
    assert_eq!(ran.code, 1);
    assert!(ran.stdout.is_empty());
    assert!(
        ran.stderr.starts_with("error[FILE_NOT_FOUND]: "),
        "stderr: {}",
        ran.stderr
    );
}

#[test]
fn outside_any_vault_the_command_fails_instead_of_guessing() {
    let sb = sandbox();
    // A vault IS registered and was active in the app — and still is not used, because
    // the current directory is not inside it.
    let mut persisted = registered(&sb);
    persisted["state"]["activeContextId"] = serde_json::json!("ctx-1");
    write_config(&sb, &[("baram:context", persisted)]);
    write(&sb.vault, "a.md", "x");
    let ran = baram(&sb, &sb.home, &["--json", "read", "a.md"]);
    assert_eq!(ran.code, 1);
    assert!(ran.stdout.is_empty());
    let error = json(&ran.stderr);
    assert_eq!(error["error"]["code"], "VAULT_NOT_FOUND");
    assert_eq!(
        error["error"]["candidates"].as_array().map(Vec::len),
        Some(2)
    );
}

#[test]
fn the_hangul_check_sees_what_it_looks_for() {
    // \u{D30C}\u{C77C} is a Hangul syllable pair, \u{1100} a jamo, \u{3131} a compatibility jamo.
    for text in ["\u{D30C}\u{C77C}", "a\u{1100}b", "\u{3131}"] {
        assert!(has_hangul(text), "{text:?}");
    }
    assert!(!has_hangul(
        "cannot read notes/b.bin: stream did not contain valid UTF-8"
    ));
}

#[test]
fn a_directory_is_not_a_file() {
    let sb = sandbox();
    write(&sb.vault, "notes/a.md", "x");
    let vault = vault_arg(&sb);
    let ran = baram(&sb, &sb.home, &["--vault", &vault, "read", "notes"]);
    assert_eq!(ran.code, 1);
    assert!(ran.stdout.is_empty(), "stdout: {}", ran.stdout);
    assert!(
        ran.stderr.starts_with("error[FILE_NOT_FOUND]: "),
        "stderr: {}",
        ran.stderr
    );
}

#[test]
fn a_file_that_is_not_text_is_io_in_english() {
    let sb = sandbox();
    write(&sb.vault, "notes/a.md", "x");
    std::fs::write(sb.vault.join("notes/b.bin"), [0xff, 0xfe]).expect("write");
    let vault = vault_arg(&sb);
    let ran = baram(&sb, &sb.home, &["--vault", &vault, "read", "notes/b.bin"]);
    assert_eq!(ran.code, 1);
    assert!(ran.stdout.is_empty(), "stdout: {}", ran.stdout);
    assert!(
        ran.stderr.starts_with("error[IO]: cannot read notes/b.bin"),
        "stderr: {}",
        ran.stderr
    );
    assert!(!has_hangul(&ran.stderr), "stderr: {}", ran.stderr);
}

#[test]
fn a_path_below_a_file_is_file_not_found() {
    let sb = sandbox();
    write(&sb.vault, "notes/a.md", "x");
    let vault = vault_arg(&sb);
    let ran = baram(
        &sb,
        &sb.home,
        &["--vault", &vault, "read", "notes/a.md/b.md"],
    );
    assert_eq!(ran.code, 1);
    assert!(ran.stdout.is_empty(), "stdout: {}", ran.stdout);
    assert!(
        ran.stderr.starts_with("error[FILE_NOT_FOUND]: "),
        "stderr: {}",
        ran.stderr
    );
}

/// `v/locked/a.md` exists; `v/locked` cannot be entered. That is not "no such file": the
/// reason is the OS's, and the exit code says the run failed.
#[test]
fn a_file_in_a_directory_that_cannot_be_entered_is_io_not_file_not_found() {
    use std::os::unix::fs::PermissionsExt;
    let sb = sandbox();
    write(&sb.vault, "locked/a.md", "x");
    let locked = sb.vault.join("locked");
    let _unlock = Unlock(locked.clone());
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).expect("chmod");
    let vault = vault_arg(&sb);
    let ran = baram(&sb, &sb.home, &["--vault", &vault, "read", "locked/a.md"]);
    assert_eq!(ran.code, 1, "stderr: {}", ran.stderr);
    assert!(ran.stdout.is_empty(), "stdout: {}", ran.stdout);
    assert!(
        ran.stderr
            .starts_with("error[IO]: cannot read locked/a.md: "),
        "stderr: {}",
        ran.stderr
    );
    assert!(!has_hangul(&ran.stderr), "stderr: {}", ran.stderr);
}
