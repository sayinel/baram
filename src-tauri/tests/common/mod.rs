//! What the end-to-end tests share: a sandbox with its own HOME and data directory, the
//! app's config written into it, and a child process killed when it outlives `TIMEOUT`.
//! Each file under `tests/` is a crate of its own and uses part of this.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

/// Longer than any command here takes, far shorter than a window opened by mistake
/// would stay up. The timeout is what catches a CLI invocation routed to the GUI.
pub const TIMEOUT: Duration = Duration::from_secs(30);

pub struct Sandbox {
    pub _dir: tempfile::TempDir,
    pub base: PathBuf,
    pub home: PathBuf,
    pub xdg: PathBuf,
    pub vault: PathBuf,
}

pub fn sandbox() -> Sandbox {
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

pub fn write(root: &Path, rel: &str, body: &str) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    std::fs::write(path, body).expect("write");
}

/// Writes config.json where `dirs::data_dir()` points on macOS (under HOME) and on Linux
/// (XDG_DATA_HOME). Each value is what zustand persist would have written, stored as a
/// JSON STRING — the way `set_config` stores it.
pub fn write_config(sb: &Sandbox, values: &[(&str, serde_json::Value)]) {
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
pub fn registered(sb: &Sandbox) -> serde_json::Value {
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

/// Writes `approved-roots.json` beside each config.json `write_config` writes, approving
/// each of `dirs` as a folder — what the app records when you allow it in.
pub fn write_approvals(sb: &Sandbox, dirs: &[&Path]) {
    let entries: Vec<_> = dirs
        .iter()
        .map(|dir| serde_json::json!({ "path": dir, "kind": "dir", "approvedAt": 1 }))
        .collect();
    let text = serde_json::json!({ "version": 1, "entries": entries }).to_string();
    for dir in [
        sb.home.join("Library/Application Support/com.inel.baram"),
        sb.xdg.join("com.inel.baram"),
    ] {
        std::fs::create_dir_all(&dir).expect("mkdir");
        std::fs::write(dir.join("approved-roots.json"), &text).expect("write approvals");
    }
}

/// `program` with what every run here gets: the sandbox's HOME and data directory, no
/// `BARAM_LOG`, no stdin, both outputs captured.
pub fn isolated(sb: &Sandbox, program: &str) -> Command {
    let mut command = Command::new(program);
    command
        // `dirs` reads these. Without them the child reads the developer's real
        // config.json.
        .env("HOME", &sb.home)
        .env("XDG_DATA_HOME", &sb.xdg)
        .env_remove("BARAM_LOG")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}

/// Polls `child` until it exits and kills it when it outlives `TIMEOUT`. `label` names
/// the run in that failure.
pub fn wait_for_exit(child: &mut Child, label: &str) -> ExitStatus {
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().expect("try_wait") {
            return status;
        }
        if started.elapsed() > TIMEOUT {
            kill_and_panic(
                child,
                &format!("`baram {label}` did not exit within {TIMEOUT:?}"),
            );
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

pub fn kill_and_panic(child: &mut Child, message: &str) -> ! {
    let _ = child.kill();
    let _ = child.wait();
    panic!("{message}");
}

pub fn vault_arg(sb: &Sandbox) -> String {
    sb.vault.to_string_lossy().into_owned()
}

/// Every path under `root` — hidden ones included — with its size and modification
/// time. What "the CLI wrote nothing" is measured against. A directory's entry carries
/// its own modification time, which a child created or removed moves, so a file written
/// and deleted again leaves a trace there. `root`'s own entry is not recorded: the root
/// belongs one level above whatever must stay untouched.
pub fn snapshot(root: &Path) -> Vec<(PathBuf, u64, std::time::SystemTime)> {
    let mut seen = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).expect("read_dir") {
            let entry = entry.expect("entry");
            let meta = entry.metadata().expect("metadata");
            seen.push((entry.path(), meta.len(), meta.modified().expect("mtime")));
            if meta.is_dir() {
                stack.push(entry.path());
            }
        }
    }
    seen.sort();
    seen
}
