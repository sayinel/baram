//! §389 `baram mcp` end to end: the built binary, with JSON-RPC lines written straight to
//! its stdin (spec 0068 D17 — an rmcp client would test rmcp against itself).
//!
//! Unix only, for the reason `tests/cli.rs` gives: on Windows the child would read the
//! developer's real config.json.
#![cfg(unix)]

mod common;

use common::*;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Stdio};
use std::sync::mpsc::Receiver;
use std::thread::JoinHandle;

/// A running `baram mcp`: its stdin to write requests to, and its stdout read line by line
/// on a thread, so that a server that does not answer is caught by `TIMEOUT`.
struct Session {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: Receiver<String>,
    /// Every stdout line read so far, as written.
    seen: Vec<String>,
    stderr: Option<JoinHandle<String>>,
}

/// What a session left when it ended.
struct Ended {
    code: i32,
    /// The stdout lines no `reply` had read.
    unread: Vec<String>,
    /// Every stdout line, in order.
    seen: Vec<String>,
    stderr: String,
}

fn session(sb: &Sandbox, args: &[&str]) -> Session {
    session_with(sb, &sb.home, args, &[])
}

fn session_with(sb: &Sandbox, cwd: &Path, args: &[&str], env: &[(&str, &str)]) -> Session {
    let argv: Vec<&str> = std::iter::once("mcp").chain(args.iter().copied()).collect();
    spawn(sb, cwd, &argv, env)
}

/// `baram <argv>`, as `session_with` starts it but with the whole command line given, for a
/// test that writes an option before the command name.
fn spawn(sb: &Sandbox, cwd: &Path, argv: &[&str], env: &[(&str, &str)]) -> Session {
    let mut command = isolated(sb, env!("CARGO_BIN_EXE_baram"));
    command
        .args(argv)
        .current_dir(cwd)
        // The default vault reads it (Claude Code sets it for the servers it starts), so a
        // test sets it or leaves it out on purpose.
        .env_remove("CLAUDE_PROJECT_DIR")
        .stdin(Stdio::piped());
    for (key, value) in env {
        command.env(key, value);
    }
    let mut child = command.spawn().expect("spawn baram mcp");
    let stdout = child.stdout.take().expect("stdout");
    let (sent, lines) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if sent.send(line).is_err() {
                break;
            }
        }
    });
    let mut stderr = child.stderr.take().expect("stderr");
    let stderr = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text);
        text
    });
    Session {
        stdin: child.stdin.take(),
        child,
        lines,
        seen: Vec::new(),
        stderr: Some(stderr),
    }
}

impl Session {
    fn send_line(&mut self, line: &str) {
        let stdin = self.stdin.as_mut().expect("stdin is open");
        writeln!(stdin, "{line}").expect("write a line");
        stdin.flush().expect("flush");
    }

    fn send(&mut self, message: &Value) {
        self.send_line(&message.to_string());
    }

    fn notify(&mut self, method: &str) {
        self.send(&json!({ "jsonrpc": "2.0", "method": method }));
    }

    /// The next stdout line, as JSON.
    fn reply(&mut self) -> Value {
        match self.lines.recv_timeout(TIMEOUT) {
            Ok(line) => {
                self.seen.push(line.clone());
                serde_json::from_str(&line)
                    .unwrap_or_else(|error| panic!("not JSON ({error}): {line}"))
            }
            Err(_) => kill_and_panic(&mut self.child, "`baram mcp` did not answer within TIMEOUT"),
        }
    }

    fn request(&mut self, id: u64, method: &str, params: Value) -> Value {
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
        let reply = self.reply();
        assert_eq!(reply["id"], json!(id), "{reply}");
        reply
    }

    /// The handshake a client of the `2025-11-25` revision makes.
    fn handshake(&mut self) -> Value {
        let reply = self.request(
            0,
            "initialize",
            json!({
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": { "name": "tests", "version": "0" }
            }),
        );
        self.notify("notifications/initialized");
        reply
    }

    /// `tools/call`'s result object.
    fn call(&mut self, id: u64, tool: &str, arguments: Value) -> Value {
        let reply = self.request(
            id,
            "tools/call",
            json!({ "name": tool, "arguments": arguments }),
        );
        assert!(reply.get("error").is_none(), "{reply}");
        reply["result"].clone()
    }

    /// Closes stdin and waits for the server to exit.
    fn end(mut self) -> Ended {
        drop(self.stdin.take());
        let status = wait_for_exit(&mut self.child, "mcp");
        let unread: Vec<String> = self.lines.iter().collect();
        let mut seen = self.seen;
        seen.extend(unread.iter().cloned());
        Ended {
            code: status.code().expect("exit code"),
            unread,
            seen,
            stderr: self
                .stderr
                .take()
                .expect("stderr thread")
                .join()
                .expect("stderr"),
        }
    }
}

/// A successful call's result, `structuredContent`, after checking that the text block
/// carries the same JSON (spec 0068 D9).
fn structured(result: &Value) -> &Value {
    assert_eq!(result["isError"], json!(false), "{result}");
    let text = result["content"][0]["text"].as_str().expect("a text block");
    assert_eq!(
        serde_json::from_str::<Value>(text).expect("JSON text"),
        result["structuredContent"],
        "{result}"
    );
    &result["structuredContent"]
}

/// A tool error's text: `isError`, and no `structuredContent` (spec 0068 §3.5).
fn tool_error(result: &Value) -> &str {
    assert_eq!(result["isError"], json!(true), "{result}");
    assert!(result.get("structuredContent").is_none(), "{result}");
    result["content"][0]["text"].as_str().expect("a text block")
}

/// What fails this: `mcp` routed after `run` takes stdout; `get_info` left as rmcp's
/// default, whose `serverInfo` names rmcp's own crate.
#[test]
fn the_handshake_names_the_server_and_closing_stdin_ends_it() {
    let sb = sandbox();
    let mut s = session(&sb, &["--vault", &vault_arg(&sb)]);
    let reply = s.handshake();
    let result = &reply["result"];
    assert_eq!(result["serverInfo"]["name"], json!("baram"), "{reply}");
    assert_eq!(
        result["serverInfo"]["version"],
        json!(env!("CARGO_PKG_VERSION"))
    );
    assert!(result["capabilities"]["tools"].is_object(), "{reply}");
    assert!(
        result["instructions"]
            .as_str()
            .is_some_and(|text| text.contains("list_vaults")),
        "{reply}"
    );
    let tools = s.request(1, "tools/list", json!({}));
    let names: Vec<&str> = tools["result"]["tools"]
        .as_array()
        .expect("tools")
        .iter()
        .filter_map(|tool| tool["name"].as_str())
        .collect();
    assert!(names.contains(&"list_vaults"), "{tools}");
    let ended = s.end();
    assert_eq!(ended.code, 0, "{}", ended.stderr);
    assert!(ended.unread.is_empty(), "{:?}", ended.unread);
}

/// A client that opens the server and closes it again — a check that it starts — sends
/// nothing; rmcp's `serve` then fails with `ConnectionClosed`, which is no error.
///
/// What fails this: every `serve` failure reported as exit 1.
#[test]
fn closing_stdin_before_any_message_exits_0_and_writes_nothing() {
    let sb = sandbox();
    let ended = session(&sb, &["--vault", &vault_arg(&sb)]).end();
    assert_eq!(ended.code, 0, "{}", ended.stderr);
    assert!(ended.seen.is_empty(), "{:?}", ended.seen);
}

/// Before the handshake, rmcp answers a request that carries no `_meta` with `-32602` and
/// goes on waiting for `initialize` (its pre-handshake loop in `service/server.rs`); the
/// session then starts as usual. Pinned here because an rmcp update can move it — 3.5.0 ended
/// the session at that refusal.
///
/// What fails this: an rmcp that ends the session at that refusal — the `initialize` after it
/// gets no answer — or that answers the request instead of refusing it.
#[test]
fn a_request_before_the_handshake_is_refused_and_the_handshake_still_works() {
    let sb = sandbox();
    let mut s = session(&sb, &["--vault", &vault_arg(&sb)]);
    let reply = s.request(1, "tools/list", json!({}));
    assert_eq!(reply["error"]["code"], json!(-32602), "{reply}");
    let reply = s.handshake();
    assert_eq!(
        reply["result"]["serverInfo"]["name"],
        json!("baram"),
        "{reply}"
    );
    let ended = s.end();
    assert_eq!(ended.code, 0, "{}", ended.stderr);
}

/// A first message that is no request — here a notification — ends the session before it
/// starts: rmcp's `serve` fails with `ExpectedInitializeRequest`, and the server writes one
/// line on stderr and exits 1 (spec 0068 §3.1).
///
/// What fails this: every `serve` failure reported as exit 0, or without a line on stderr.
#[test]
fn a_first_message_that_is_no_request_ends_the_server_with_exit_1() {
    let sb = sandbox();
    let mut s = session(&sb, &["--vault", &vault_arg(&sb)]);
    s.notify("notifications/initialized");
    let ended = s.end();
    assert_eq!(ended.code, 1, "{}", ended.stderr);
    assert!(ended.seen.is_empty(), "{:?}", ended.seen);
    assert!(
        ended
            .stderr
            .starts_with("error[IO]: the MCP session did not start"),
        "{}",
        ended.stderr
    );
}

/// A `--vault` that does not resolve stops the server before it writes anything to stdout,
/// with the CLI's error on stderr and the CLI's exit code (spec 0068 §3.1). A name lists
/// the registered vaults; an absolute path that is no directory lists none; a relative path
/// is not a path to `mcp` — it is read as a name.
///
/// What fails this: the server serving without the vault; the CLI's `is_path_form`
/// instead of `mcp`'s — `notes/x` would be a relative path, refused with
/// ``error[IO]: `mcp --vault` takes no relative path``.
#[test]
fn a_vault_flag_that_does_not_resolve_stops_the_server_before_stdout() {
    let sb = sandbox();
    write_config(&sb, &[("baram:context", registered(&sb))]);
    let missing = sb.base.join("missing").to_string_lossy().into_owned();
    for (value, first, lists) in [
        (
            "nope".to_string(),
            "error[VAULT_NOT_FOUND]: no registered vault is named `nope`".to_string(),
            true,
        ),
        (
            missing.clone(),
            format!("error[VAULT_NOT_FOUND]: no directory at {missing}"),
            false,
        ),
        (
            "notes/x".to_string(),
            "error[VAULT_NOT_FOUND]: no registered vault is named `notes/x`".to_string(),
            true,
        ),
    ] {
        let ended = session(&sb, &["--vault", &value]).end();
        assert_eq!(ended.code, 1, "{value}: {}", ended.stderr);
        assert!(ended.seen.is_empty(), "{value}: {:?}", ended.seen);
        let mut lines = ended.stderr.lines();
        assert_eq!(
            lines.next(),
            Some(first.as_str()),
            "{value}: {}",
            ended.stderr
        );
        let rest: Vec<&str> = lines.collect();
        if lists {
            assert!(
                rest.iter().any(|line| line.starts_with("  Fixture\t")),
                "{value}: {}",
                ended.stderr
            );
        } else {
            assert!(rest.is_empty(), "{value}: {}", ended.stderr);
        }
    }
}

/// A `--vault` behind a folder that cannot be entered stops the server the way the CLI
/// stops (spec 0068 §3.1): IO with the OS's reason, exit 1, and nothing on stdout.
///
/// What fails this: `vault::from_path` deciding by `Path::is_dir` (VAULT_NOT_FOUND).
#[test]
fn a_vault_flag_behind_a_folder_that_cannot_be_entered_stops_the_server_with_io() {
    use std::os::unix::fs::PermissionsExt;
    let sb = sandbox();
    let locked = sb.base.join("locked");
    write(&locked, "v/a.md", "x\n");
    let unreachable = locked.join("v").to_string_lossy().into_owned();
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).expect("chmod");
    let ended = session(&sb, &["--vault", &unreachable]).end();
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    assert_eq!(ended.code, 1, "{}", ended.stderr);
    assert!(ended.seen.is_empty(), "{:?}", ended.seen);
    assert!(
        ended
            .stderr
            .starts_with(&format!("error[IO]: cannot read {unreachable}: ")),
        "{}",
        ended.stderr
    );
}

/// `list_vaults` lists the vaults the server may read — a registered one by the CLI's row,
/// a `--vault` the app does not register as `unregistered` — and names the one the call
/// resolved to: the first `--vault` by default, the `vault` argument when it is given, and
/// none, without an error, when the argument names no vault in the scope (spec 0068 §3.2).
///
/// What fails this: `list_vaults` failing on a `vault` it cannot resolve; the unregistered
/// root left out; `Gone` — registered, but not passed — listed.
#[test]
fn list_vaults_shows_the_scope_and_the_vault_a_call_reads() {
    let sb = sandbox();
    write_config(&sb, &[("baram:context", registered(&sb))]);
    let other = sb.base.join("other");
    std::fs::create_dir_all(&other).expect("mkdir");
    let other = other.to_string_lossy().into_owned();
    let mut s = session(&sb, &["--vault", "fx", "--vault", &other]);
    s.handshake();
    let result = s.call(1, "list_vaults", json!({}));
    let page = structured(&result);
    assert_eq!(page["vault"]["name"], json!("Fixture"), "{page}");
    let rows: Vec<(&str, &str)> = page["items"]
        .as_array()
        .expect("items")
        .iter()
        .map(|row| (row["name"].as_str().unwrap(), row["type"].as_str().unwrap()))
        .collect();
    assert_eq!(rows, [("Fixture", "vault"), ("other", "unregistered")]);
    let result = s.call(2, "list_vaults", json!({ "vault": other }));
    assert_eq!(structured(&result)["vault"]["name"], json!("other"));
    let result = s.call(3, "list_vaults", json!({ "vault": "Gone" }));
    let page = structured(&result);
    assert!(page.get("vault").is_none(), "{page}");
    assert_eq!(page["items"].as_array().map(Vec::len), Some(2), "{page}");
    assert_eq!(s.end().code, 0);
}

/// A data tool's `vault` gets one answer for a directory outside the scope, for a path
/// that is not there, and for one behind a folder that cannot be entered (spec 0068 §3.2):
/// `read_note` through each gives the same error text, candidates included, but for the
/// path it repeats. The scope's own vault is read, so the error is the scope's.
///
/// What fails this: an existence check before the scope (the CLI's `no directory at …` for
/// the missing path, `cannot read …` for the locked one); candidates listed for one of them
/// and not the others.
#[test]
fn a_data_tool_answers_a_vault_outside_the_scope_as_it_answers_a_missing_one() {
    use std::os::unix::fs::PermissionsExt;
    let sb = sandbox();
    write(&sb.vault, "a.md", "inside\n");
    let outside = sb.base.join("outside");
    write(&outside, "a.md", "outside\n");
    let missing = sb.base.join("missing");
    let locked = sb.base.join("locked");
    write(&locked, "v/a.md", "locked\n");
    let unreachable = locked.join("v");
    let mut s = session(&sb, &["--vault", &vault_arg(&sb)]);
    s.handshake();
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).expect("chmod");
    let mut answers = Vec::new();
    for (id, vault) in [(1, &outside), (2, &missing), (4, &unreachable)] {
        let vault = vault.to_string_lossy().into_owned();
        let result = s.call(id, "read_note", json!({ "vault": vault, "path": "a.md" }));
        answers.push(tool_error(&result).replace(&vault, "<vault>"));
    }
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    assert_eq!(answers[0], answers[1]);
    assert_eq!(answers[0], answers[2]);
    let mut lines = answers[0].lines();
    assert_eq!(
        lines.next(),
        Some("error[VAULT_NOT_FOUND]: `<vault>` is not a vault this server reads")
    );
    assert_eq!(
        lines.collect::<Vec<_>>(),
        [format!("  vault\t{}", vault_arg(&sb))]
    );
    let result = s.call(
        3,
        "read_note",
        json!({ "vault": vault_arg(&sb), "path": "a.md" }),
    );
    assert_eq!(structured(&result)["content"], json!("inside\n"));
    assert_eq!(s.end().code, 0);
}

/// A tool's `vault` and an absolute path argument are matched against the spellings of the
/// vaults the server reads by their letters (spec 0068 §3.2). A link to the vault, which the
/// disk would resolve onto it, is refused — as `vault` with the answer a missing path gets,
/// as a path as outside — while the server was started with the folder's own path, or with
/// no `--vault` and the folder registered; started with the link as `--vault`, the server
/// reads it both ways, and the folder's own path too.
///
/// What fails this: either argument resolved on disk before it is compared (the link is read
/// in the first session); the default vault handed to the tool without its spellings (the
/// link is read in the second); the `--vault` value left out of the spellings (the link is
/// refused in the third).
#[test]
fn a_spelling_of_the_vault_the_server_was_not_given_is_refused() {
    let sb = sandbox();
    write(&sb.vault, "a.md", "inside\n");
    let link = sb.base.join("link");
    std::os::unix::fs::symlink(&sb.vault, &link).expect("link to the vault");
    let link = link.to_string_lossy().into_owned();
    let missing = sb.base.join("missing").to_string_lossy().into_owned();
    let canonical = vault_arg(&sb);
    let mut s = session(&sb, &["--vault", &canonical]);
    s.handshake();
    let linked = s.call(1, "read_note", json!({ "vault": link, "path": "a.md" }));
    let absent = s.call(2, "read_note", json!({ "vault": missing, "path": "a.md" }));
    assert_eq!(
        tool_error(&linked).replace(&link, "<path>"),
        tool_error(&absent).replace(&missing, "<path>")
    );
    let through = format!("{link}/a.md");
    let result = s.call(3, "read_note", json!({ "path": through }));
    assert_eq!(
        tool_error(&result),
        format!("error[PATH_OUTSIDE_VAULT]: {through} is outside the vault at {canonical}")
    );
    let result = s.call(
        4,
        "read_note",
        json!({ "path": format!("{canonical}/a.md") }),
    );
    assert_eq!(structured(&result)["content"], json!("inside\n"));
    assert_eq!(s.end().code, 0);

    // Without `--vault`, the default vault — the registered one that holds the project
    // directory — is matched by the same letters.
    write_config(&sb, &[("baram:context", registered(&sb))]);
    let project = [("CLAUDE_PROJECT_DIR", canonical.as_str())];
    let mut s = session_with(&sb, &sb.home, &[], &project);
    s.handshake();
    let result = s.call(1, "read_note", json!({ "path": through }));
    assert_eq!(
        tool_error(&result),
        format!("error[PATH_OUTSIDE_VAULT]: {through} is outside the vault at {canonical}")
    );
    let result = s.call(
        2,
        "read_note",
        json!({ "path": format!("{canonical}/a.md") }),
    );
    assert_eq!(structured(&result)["content"], json!("inside\n"));
    assert_eq!(s.end().code, 0);

    let mut s = session(&sb, &["--vault", &link]);
    s.handshake();
    let result = s.call(1, "read_note", json!({ "vault": link, "path": through }));
    let page = structured(&result);
    assert_eq!(page["content"], json!("inside\n"));
    assert_eq!(page["path"], json!("a.md"));
    assert_eq!(page["vault"]["path"], json!(canonical));
    let result = s.call(
        2,
        "read_note",
        json!({ "vault": canonical, "path": format!("{canonical}/a.md") }),
    );
    assert_eq!(structured(&result)["content"], json!("inside\n"));
    assert_eq!(s.end().code, 0);
}

/// Every `--vault` written before `mcp` reaches the server, the first of them as its default:
/// the refusal of a `--vault` on both sides of the command name does not touch the form
/// where they are all on one side.
///
/// What fails this: `misuse` refusing the form where every `--vault` precedes `mcp`, which
/// the split-form cases in `tests/cli.rs` cannot see (the server would not start).
#[test]
fn vault_flags_before_the_command_name_all_reach_the_server() {
    let sb = sandbox();
    write_config(&sb, &[("baram:context", registered(&sb))]);
    let other = sb.base.join("other");
    std::fs::create_dir_all(&other).expect("mkdir");
    let other = other.to_string_lossy().into_owned();
    let mut s = spawn(
        &sb,
        &sb.home,
        &["--vault", "fx", "--vault", &other, "mcp"],
        &[],
    );
    s.handshake();
    let result = s.call(1, "list_vaults", json!({}));
    let page = structured(&result);
    assert_eq!(page["vault"]["name"], json!("Fixture"), "{page}");
    let rows: Vec<(&str, &str)> = page["items"]
        .as_array()
        .expect("items")
        .iter()
        .map(|row| (row["name"].as_str().unwrap(), row["type"].as_str().unwrap()))
        .collect();
    assert_eq!(rows, [("Fixture", "vault"), ("other", "unregistered")]);
    assert_eq!(s.end().code, 0);
}

/// Without `--vault`, the default is the registered vault that holds `CLAUDE_PROJECT_DIR`,
/// and without that variable, the one that holds the directory the server started in
/// (spec 0068 D4). Both are read from the server's real environment here.
///
/// A relative `CLAUDE_PROJECT_DIR` is not used: `../../vault`, which from the server's
/// directory `other/sub` would reach Main, leaves the default to that directory.
///
/// What fails this: the two inputs taken in the other order; `CLAUDE_PROJECT_DIR` not read,
/// or read when it is relative (the relative row would answer Main).
#[test]
fn without_vault_flags_the_project_directory_comes_before_the_current_one() {
    let sb = sandbox();
    let other = sb.base.join("other");
    std::fs::create_dir_all(other.join("sub")).expect("mkdir");
    let context = |id: &str, path: &Path| {
        json!({ "id": id, "contextType": "vault", "path": path, "label": id,
                "color": "#4f8cff", "addedAt": 1 })
    };
    let contexts = json!({
        "state": {
            "contexts": [context("Main", &sb.vault), context("Other", &other)],
            "activeContextId": null
        },
        "version": 1
    });
    write_config(&sb, &[("baram:context", contexts)]);
    let project = sb.vault.to_string_lossy().into_owned();
    let with_project = [("CLAUDE_PROJECT_DIR", project.as_str())];
    let relative = [("CLAUDE_PROJECT_DIR", "../../vault")];
    for (env, expected) in [
        (&with_project[..], "Main"),
        (&[][..], "Other"),
        (&relative[..], "Other"),
    ] {
        let mut s = session_with(&sb, &other.join("sub"), &[], env);
        s.handshake();
        let result = s.call(1, "list_vaults", json!({}));
        assert_eq!(
            structured(&result)["vault"]["name"],
            json!(expected),
            "{env:?}"
        );
        assert_eq!(s.end().code, 0);
    }
}

/// What fails this: an unknown tool answered as a tool error; the arguments of a tool
/// that takes only `vault` left unchecked.
#[test]
fn an_unknown_tool_is_a_protocol_error_and_a_bad_argument_a_tool_error() {
    let sb = sandbox();
    let mut s = session(&sb, &["--vault", &vault_arg(&sb)]);
    s.handshake();
    let reply = s.request(1, "tools/call", json!({ "name": "nope", "arguments": {} }));
    assert_eq!(reply["error"]["code"], json!(-32602), "{reply}");
    let result = s.call(2, "list_vaults", json!({ "x": 1 }));
    assert_eq!(
        tool_error(&result),
        "error[INVALID_ARGUMENT]: `x` is not an argument of this tool"
    );
    let result = s.call(3, "list_vaults", json!({ "vault": 7 }));
    assert_eq!(
        tool_error(&result),
        "error[INVALID_ARGUMENT]: `vault` must be a string"
    );
    assert_eq!(s.end().code, 0);
}

/// A line that is not JSON gets no answer and does not end the session (spec 0068 §3.5 —
/// rmcp decides this; pinned here).
///
/// What fails this: an rmcp that ends the session at that line — the call after it gets no
/// answer — or that answers it, so the call reads that answer in place of its own.
#[test]
fn a_line_that_is_not_json_leaves_the_session_open() {
    let sb = sandbox();
    let mut s = session(&sb, &["--vault", &vault_arg(&sb)]);
    s.handshake();
    s.send_line("this is not json");
    let result = s.call(1, "list_vaults", json!({}));
    structured(&result);
    let ended = s.end();
    assert_eq!(ended.code, 0, "{}", ended.stderr);
    assert!(ended.unread.is_empty(), "{:?}", ended.unread);
}

/// stdout carries the protocol and nothing else, also when the config warns: warnings go to
/// stderr, at start, and on a later call only when they changed (P5).
///
/// What fails this: a warning written to stdout, where the client would read a line that is
/// no JSON-RPC message; a warning written again on every call.
#[test]
fn stdout_carries_only_protocol_messages_when_the_config_warns() {
    let sb = sandbox();
    let broken = json!({
        "state": { "contexts": [ { "id": "x", "label": "No path" } ], "activeContextId": null },
        "version": 1
    });
    write_config(&sb, &[("baram:context", broken)]);
    let mut s = session(&sb, &["--vault", &vault_arg(&sb)]);
    s.handshake();
    s.call(1, "list_vaults", json!({}));
    s.call(2, "list_vaults", json!({}));
    let ended = s.end();
    assert_eq!(ended.code, 0, "{}", ended.stderr);
    assert!(ended.seen.len() >= 3, "{:?}", ended.seen);
    for line in &ended.seen {
        serde_json::from_str::<Value>(line).unwrap_or_else(|error| panic!("{error}: {line}"));
    }
    let warnings = ended
        .stderr
        .lines()
        .filter(|line| line.starts_with("warning: "))
        .count();
    assert_eq!(warnings, 1, "{}", ended.stderr);
}

fn paths(page: &Value) -> Vec<&str> {
    page["items"]
        .as_array()
        .expect("items")
        .iter()
        .map(|item| item["path"].as_str().expect("path"))
        .collect()
}

/// A task page's rows as (path, line, state).
fn task_keys(page: &Value) -> Vec<(&str, u64, &str)> {
    page["items"]
        .as_array()
        .expect("items")
        .iter()
        .map(|item| {
            (
                item["path"].as_str().expect("path"),
                item["line"].as_u64().expect("line"),
                item["state"].as_str().expect("state"),
            )
        })
        .collect()
}

/// The list tools page what the CLI lists, in the CLI's order (spec 0068 §3.4): `nextOffset`
/// asks for the rest, an offset past the end is an empty last page, `status`, `tag`, `folder`
/// and `file` choose what is listed, and a bad `limit`, `status` or `folder`, or a missing
/// `tag`, is a tool error naming the argument.
///
/// The fixture gives each argument something to choose between: three notes under `#work`
/// with one open task each, and one note in a subfolder under `#other` with a done and a
/// cancelled task.
///
/// What fails this: `status` not read (a call that always asks for `all` lists the done and
/// the cancelled task in the default page; one that always asks for `open` has no done
/// page); `tag` not read (a call that always asks for `work`); `folder` or `file` not passed
/// on; a left-out `limit` read as 0; a tool wired to another tool's function.
#[test]
fn list_tools_page_what_the_cli_lists() {
    let sb = sandbox();
    for name in ["a.md", "b.md", "c.md"] {
        write(&sb.vault, name, "#work\n- [ ] the task\n");
    }
    write(
        &sb.vault,
        "sub/d.md",
        "#other\n- [x] the finished task\n- [-] the dropped task\n",
    );
    let mut s = session(&sb, &["--vault", &vault_arg(&sb)]);
    s.handshake();
    let first = s.call(1, "list_files", json!({ "limit": 2 }));
    let page = structured(&first);
    assert_eq!(paths(page), ["a.md", "b.md"]);
    assert_eq!(page["truncated"], json!(true));
    assert_eq!(page["nextOffset"], json!(2));
    assert_eq!(page["vault"]["path"], json!(vault_arg(&sb)));
    let rest = s.call(2, "list_files", json!({ "offset": 2, "limit": 2 }));
    let page = structured(&rest);
    assert_eq!(paths(page), ["c.md", "sub/d.md"]);
    assert_eq!(page["truncated"], json!(false));
    assert!(page.get("nextOffset").is_none(), "{page}");
    let past = s.call(3, "list_files", json!({ "offset": 99 }));
    assert!(paths(structured(&past)).is_empty());
    let folder = s.call(4, "list_files", json!({ "folder": "sub" }));
    assert_eq!(paths(structured(&folder)), ["sub/d.md"]);
    let tagged = s.call(5, "notes_with_tag", json!({ "tag": "#work", "limit": 1 }));
    assert_eq!(paths(structured(&tagged)), ["a.md"]);
    let bare = s.call(6, "notes_with_tag", json!({ "tag": "work" }));
    assert_eq!(paths(structured(&bare)), ["a.md", "b.md", "c.md"]);
    let other = s.call(7, "notes_with_tag", json!({ "tag": "other" }));
    assert_eq!(paths(structured(&other)), ["sub/d.md"]);
    let tags = s.call(8, "list_tags", json!({}));
    assert_eq!(
        structured(&tags)["items"],
        json!([{ "tag": "work", "count": 3 }, { "tag": "other", "count": 1 }])
    );
    let open = s.call(9, "list_tasks", json!({}));
    assert_eq!(
        task_keys(structured(&open)),
        [
            ("a.md", 2, "todo"),
            ("b.md", 2, "todo"),
            ("c.md", 2, "todo")
        ]
    );
    let done = s.call(10, "list_tasks", json!({ "status": "done" }));
    assert_eq!(task_keys(structured(&done)), [("sub/d.md", 2, "done")]);
    let cancelled = s.call(11, "list_tasks", json!({ "status": "cancelled" }));
    assert_eq!(
        task_keys(structured(&cancelled)),
        [("sub/d.md", 3, "cancelled")]
    );
    let all = s.call(12, "list_tasks", json!({ "status": "all" }));
    assert_eq!(
        task_keys(structured(&all)),
        [
            ("a.md", 2, "todo"),
            ("b.md", 2, "todo"),
            ("c.md", 2, "todo"),
            ("sub/d.md", 2, "done"),
            ("sub/d.md", 3, "cancelled")
        ]
    );
    let tasks = s.call(13, "list_tasks", json!({ "file": "b.md" }));
    let page = structured(&tasks);
    assert_eq!(paths(page), ["b.md"]);
    assert_eq!(page["items"][0]["state"], json!("todo"));
    assert_eq!(page["items"][0]["line"], json!(2));
    for (id, tool, arguments, start) in [
        (
            14,
            "list_files",
            json!({ "limit": 0 }),
            "error[INVALID_ARGUMENT]: `limit` must be an integer from 1 to 1000",
        ),
        (
            15,
            "list_files",
            json!({ "offset": -1 }),
            "error[INVALID_ARGUMENT]: `offset` must be an integer, 0 or more",
        ),
        (
            16,
            "list_tasks",
            json!({ "status": "late" }),
            "error[INVALID_ARGUMENT]: `status` must be one of: open, done, cancelled, all",
        ),
        (
            17,
            "notes_with_tag",
            json!({}),
            "error[INVALID_ARGUMENT]: `tag` is required",
        ),
        (
            18,
            "list_files",
            json!({ "folder": "../x" }),
            "error[PATH_OUTSIDE_VAULT]: ../x is outside the vault",
        ),
    ] {
        let result = s.call(id, tool, arguments);
        let text = tool_error(&result);
        assert!(text.starts_with(start), "{tool}: {text}");
    }
    assert_eq!(s.end().code, 0);
}

/// `search` pages its hits in the order it finds them, and a hit's `line` minus 1 is the
/// `offset` `read_note` starts at; `read_note`'s pages put together are the note's bytes,
/// CRLF included (spec 0068 §3.4). `read_note` reads notes only — not a hidden file `search`
/// does find (D6).
///
/// What fails this: `read_note` written with `paths::file_arg`; lines split without their
/// endings; `search` given offset 0 whatever the call asked; `nextOffset` or `truncated` on
/// the last search page.
#[test]
fn search_and_read_note_page_through_notes() {
    let sb = sandbox();
    let body = "one\r\ntwo needle\r\nthree\r\nfour needle\r\n";
    write(&sb.vault, "n.md", body);
    write(&sb.vault, ".hidden.md", "needle\n");
    write(&sb.vault, "x.txt", "needle\n");
    let mut s = session(&sb, &["--vault", &vault_arg(&sb)]);
    s.handshake();
    // The search finds `.hidden.md` first: its walk sorts the absolute paths, and `.` (0x2E)
    // comes before `n`.
    let mut hits: Vec<(String, u64)> = Vec::new();
    let mut offset = 0;
    for id in 1..=3 {
        let result = s.call(
            id,
            "search",
            json!({ "query": "needle", "offset": offset, "limit": 1 }),
        );
        let page = structured(&result);
        let item = &page["items"][0];
        hits.push((
            item["path"].as_str().unwrap().to_string(),
            item["line"].as_u64().unwrap(),
        ));
        assert_eq!(page["truncated"], json!(id < 3), "{page}");
        match page["nextOffset"].as_u64() {
            Some(next) => {
                assert!(id < 3, "the last hit's page has no nextOffset: {page}");
                offset = next;
            }
            None => assert_eq!(id, 3, "{page}"),
        }
    }
    assert_eq!(
        hits,
        [
            (".hidden.md".to_string(), 1),
            ("n.md".to_string(), 2),
            ("n.md".to_string(), 4)
        ]
    );
    let from_hit = s.call(
        4,
        "read_note",
        json!({ "path": "n.md", "offset": 2 - 1, "limit": 2 }),
    );
    let page = structured(&from_hit);
    assert_eq!(page["content"], json!("two needle\r\nthree\r\n"));
    assert_eq!(page["totalLines"], json!(4));
    assert_eq!(page["truncated"], json!(true));
    assert_eq!(page["nextOffset"], json!(3));
    let first = s.call(5, "read_note", json!({ "path": "n.md", "limit": 2 }));
    let rest = s.call(6, "read_note", json!({ "path": "n.md", "offset": 2 }));
    let joined = format!(
        "{}{}",
        structured(&first)["content"].as_str().unwrap(),
        structured(&rest)["content"].as_str().unwrap()
    );
    assert_eq!(joined, body);
    for (id, path, start) in [
        (
            7,
            ".hidden.md",
            "error[INVALID_ARGUMENT]: .hidden.md is where the vault walk does not go",
        ),
        (
            8,
            "x.txt",
            "error[INVALID_ARGUMENT]: x.txt is not a markdown note",
        ),
        (
            9,
            "missing.md",
            "error[FILE_NOT_FOUND]: no file at missing.md",
        ),
    ] {
        let result = s.call(id, "read_note", json!({ "path": path }));
        let text = tool_error(&result);
        assert!(text.starts_with(start), "{path}: {text}");
    }
    let result = s.call(10, "search", json!({ "query": "(", "regex": true }));
    assert!(tool_error(&result).starts_with("error[INVALID_ARGUMENT]: invalid regular expression"));
    let result = s.call(11, "search", json!({ "query": "x", "regex": "yes" }));
    assert_eq!(
        tool_error(&result),
        "error[INVALID_ARGUMENT]: `regex` must be true or false"
    );
    assert_eq!(s.end().code, 0);
}

/// `list_files` and `search` refuse a `folder` the vault walk skips with the CLI's message,
/// which names the rule (spec 0066 §3.4).
///
/// What fails this: the folder check dropped from either tool (`.obsidian` is there and
/// holds a note with the query in it, so the call would answer); the message's list built
/// from anything but the walkers' `SKIP_DIRS`.
#[test]
fn a_folder_the_vault_walk_skips_is_refused_by_both_tools_that_take_one() {
    let sb = sandbox();
    write(&sb.vault, ".obsidian/app.md", "needle\n");
    let mut s = session(&sb, &["--vault", &vault_arg(&sb)]);
    s.handshake();
    for (id, tool, arguments) in [
        (1, "list_files", json!({ "folder": ".obsidian" })),
        (
            2,
            "search",
            json!({ "query": "needle", "folder": ".obsidian" }),
        ),
    ] {
        let result = s.call(id, tool, arguments);
        assert_eq!(
            tool_error(&result),
            "error[INVALID_ARGUMENT]: .obsidian is a folder the vault walk skips \
             (hidden, or one of: node_modules, .git, .obsidian, .baram)",
            "{tool}"
        );
    }
    assert_eq!(s.end().code, 0);
}

/// A search page's rows as (path, line).
fn hit_keys(page: &Value) -> Vec<(&str, u64)> {
    page["items"]
        .as_array()
        .expect("items")
        .iter()
        .map(|item| {
            (
                item["path"].as_str().expect("path"),
                item["line"].as_u64().expect("line"),
            )
        })
        .collect()
}

/// `search`'s `regex`, `caseSensitive`, `word` and `folder` each choose what is found, and a
/// call that sets one of them sets no other (spec 0068 §3.3).
///
/// The fixture gives every option something to choose between: `docs/a.md` holds `Needle`,
/// `needles` and `needle` on its lines 1 to 3, and `other/b.md` holds `needle`. With no option,
/// `needle` finds all four lines; each call below turns on one option and none else, so a call
/// whose option is lost, or lands on another option, finds another set.
///
/// What fails this: any of the four hard-coded to `false` or `None`; `regex`, `caseSensitive`
/// and `word` passed to one another's place.
#[test]
fn search_options_each_choose_what_is_found() {
    let sb = sandbox();
    write(&sb.vault, "docs/a.md", "Needle\nneedles\nneedle\n");
    write(&sb.vault, "other/b.md", "needle\n");
    let mut s = session(&sb, &["--vault", &vault_arg(&sb)]);
    s.handshake();
    let all = [
        ("docs/a.md", 1),
        ("docs/a.md", 2),
        ("docs/a.md", 3),
        ("other/b.md", 1),
    ];
    let whole_words = [("docs/a.md", 1), ("docs/a.md", 3), ("other/b.md", 1)];
    for (id, arguments, expected) in [
        (1, json!({ "query": "needle" }), &all[..]),
        (2, json!({ "query": "Needle" }), &all[..]),
        (
            3,
            json!({ "query": "Needle", "caseSensitive": true }),
            &[("docs/a.md", 1)][..],
        ),
        (
            4,
            json!({ "query": "needle", "word": true }),
            &whole_words[..],
        ),
        (
            5,
            json!({ "query": "needle$", "regex": true }),
            &whole_words[..],
        ),
        (6, json!({ "query": "needle$" }), &[][..]),
        (7, json!({ "query": "needle", "folder": "docs" }), &all[..3]),
    ] {
        let result = s.call(id, "search", arguments.clone());
        assert_eq!(hit_keys(structured(&result)), expected, "{arguments}");
    }
    assert_eq!(s.end().code, 0);
}

/// `read_note` ends a page before the line that would take it past 10,000 characters, with
/// the default `limit` of 2000 lines far above that (spec 0068 §3.4).
///
/// The note is 150 lines: 100 of 100 characters each (99 and the `\n`), an empty line, and 49
/// more of 100. The first 100 lines are exactly 10,000 characters and the empty line would
/// make it 10,001, so the page is the first 100 lines for a cap of 10,000 and for no other
/// whole number.
///
/// What fails this: the cap passed to `page::lines` as `usize::MAX`, 40,000 (one page of all
/// 150 lines), 9,999 (99 lines) or 10,001 (101 lines).
#[test]
fn read_note_ends_a_page_at_the_character_cap() {
    let sb = sandbox();
    let body: String = (0..150)
        .map(|n| match n {
            100 => "\n".to_string(),
            _ => format!("{n:03}{}\n", "x".repeat(96)),
        })
        .collect();
    write(&sb.vault, "long.md", &body);
    let mut s = session(&sb, &["--vault", &vault_arg(&sb)]);
    s.handshake();
    let first = s.call(1, "read_note", json!({ "path": "long.md" }));
    let page = structured(&first);
    let head = page["content"].as_str().expect("content");
    assert_eq!(head.chars().count(), 10_000, "{page}");
    assert_eq!(page["truncated"], json!(true));
    assert_eq!(page["nextOffset"], json!(100));
    assert_eq!(page["totalLines"], json!(150));
    let rest = s.call(2, "read_note", json!({ "path": "long.md", "offset": 100 }));
    let page = structured(&rest);
    assert_eq!(page["truncated"], json!(false));
    assert!(page.get("nextOffset").is_none(), "{page}");
    assert_eq!(page["totalLines"], json!(150));
    let tail = page["content"].as_str().expect("content");
    assert_eq!(format!("{head}{tail}"), body);
    assert_eq!(s.end().code, 0);
}

/// Each tool answers for the note it is asked about: `backlinks` for `a.md` and for `nowhere.md`
/// (no such file, and one note links to it), `outgoing_links` for `c.md` and for `b.md`.
///
/// What fails this: the two tools wired to each other's function; `path` read as another
/// string, or fixed to the note the first calls ask about (`a.md` for `backlinks`, `c.md`
/// for `outgoing_links`) — each of the later calls answers differently for those.
#[test]
fn backlinks_and_outgoing_links_answer_for_a_note() {
    let sb = sandbox();
    write(&sb.vault, "a.md", "# A\n");
    write(&sb.vault, "b.md", "see [[a]]\n");
    write(&sb.vault, "c.md", "and [[a]] and [[nowhere]]\n");
    let mut s = session(&sb, &["--vault", &vault_arg(&sb)]);
    s.handshake();
    let result = s.call(1, "backlinks", json!({ "path": "a.md" }));
    assert_eq!(paths(structured(&result)), ["b.md", "c.md"]);
    let result = s.call(2, "outgoing_links", json!({ "path": "c.md" }));
    let page = structured(&result);
    let links: Vec<(&str, &str)> = page["items"]
        .as_array()
        .expect("items")
        .iter()
        .map(|link| {
            (
                link["target"].as_str().unwrap(),
                link["resolution"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(links, [("a", "resolved"), ("nowhere", "unresolved")]);
    assert_eq!(page["items"][0]["path"], json!("a.md"));
    let result = s.call(3, "outgoing_links", json!({ "path": "c.md", "limit": 1 }));
    assert_eq!(structured(&result)["nextOffset"], json!(1));
    let result = s.call(4, "backlinks", json!({ "path": "nowhere.md" }));
    assert_eq!(paths(structured(&result)), ["c.md"]);
    let result = s.call(5, "outgoing_links", json!({ "path": "b.md" }));
    let page = structured(&result);
    assert_eq!(page["items"].as_array().expect("items").len(), 1, "{page}");
    assert_eq!(page["items"][0]["target"], json!("a"));
    assert_eq!(page["items"][0]["resolution"], json!("resolved"));
    assert_eq!(s.end().code, 0);
}

/// `backlinks` counts a link written behind the note's own vault alias, by the config.json
/// of the call: it is read again for each call (spec 0068 D13) and handed to the CLI's
/// function (D14). `alias.md` holds `[[fx::plan]]`. While nothing registers a vault `fx`,
/// the link names no vault the note is in and the answer is empty — the control. Once the
/// app registers the sandbox vault as `fx` and approves it, in the middle of the session,
/// the same question lists `alias.md`.
///
/// What fails this: `backlinks` given `AppConfig::default()` instead of the call's config,
/// or config.json read once, when the server starts — either leaves the second answer empty.
#[test]
fn backlinks_count_links_behind_the_alias_config_json_gives_at_the_time_of_the_call() {
    let sb = sandbox();
    write(&sb.vault, "notes/plan.md", "# Plan\n");
    write(&sb.vault, "alias.md", "[[fx::plan]]\n");
    let mut s = session(&sb, &["--vault", &vault_arg(&sb)]);
    s.handshake();
    let result = s.call(1, "backlinks", json!({ "path": "notes/plan.md" }));
    assert!(paths(structured(&result)).is_empty(), "{result}");
    write_config(&sb, &[("baram:context", registered(&sb))]);
    write_approvals(&sb, &[&sb.vault]);
    let result = s.call(2, "backlinks", json!({ "path": "notes/plan.md" }));
    assert_eq!(paths(structured(&result)), ["alias.md"]);
    assert_eq!(s.end().code, 0);
}

/// A path no file system can take ends as INVALID_ARGUMENT — the model's argument to fix —
/// whether the tool reads the note (`read_note`) or only asks about it (`backlinks`, which
/// takes a note not written yet).
///
/// What fails this: `backlinks` checking only for a directory — it builds the index and
/// answers with no links.
#[test]
fn a_path_no_file_system_takes_is_an_invalid_argument() {
    let sb = sandbox();
    let mut s = session(&sb, &["--vault", &vault_arg(&sb)]);
    s.handshake();
    let long = format!("{}.md", "x".repeat(300));
    let mut id = 0;
    for path in ["a\u{0}b.md".to_string(), long] {
        for tool in ["read_note", "backlinks"] {
            id += 1;
            let result = s.call(id, tool, json!({ "path": path }));
            assert!(
                tool_error(&result).starts_with("error[INVALID_ARGUMENT]: "),
                "{tool} {path:?}"
            );
        }
    }
    // The message repeats the path, and the NUL in it is written as `\u0000` — the text a
    // client logs or shows holds no NUL to cut it at (`output::escape`).
    for tool in ["read_note", "backlinks"] {
        id += 1;
        let result = s.call(id, tool, json!({ "path": "a\u{0}b.md" }));
        assert_eq!(
            tool_error(&result),
            "error[INVALID_ARGUMENT]: a\\u0000b.md is not a valid file path: file name \
             contained an unexpected NUL byte",
            "{tool}"
        );
    }
    assert_eq!(s.end().code, 0);
}

/// The three tools that read a note refuse a name the note rules refuse with one answer,
/// whether a file is there or not (spec 0068 D6): asked of the sandbox vault, which holds
/// each file below, and of an empty vault, `read_note`, `list_tasks` with `file` and
/// `outgoing_links` give the same text. The note both vaults lack is FILE_NOT_FOUND in
/// both, and `a.md`, which only the sandbox vault holds, is read there — the vaults are
/// the ones asked.
///
/// What fails this: any of the three asking for the file before the note rules — the
/// empty vault then answers FILE_NOT_FOUND where the full one says why it refuses.
#[test]
fn the_note_tools_answer_a_name_they_refuse_alike_whether_a_file_is_there() {
    let sb = sandbox();
    for file in [
        ".env",
        ".git/config",
        "x.txt",
        "notes/.draft.md",
        "node_modules/m.md",
    ] {
        write(&sb.vault, file, "- [ ] a task\n");
    }
    write(&sb.vault, "a.md", "- [ ] a task\n");
    let empty = sb.base.join("empty");
    std::fs::create_dir_all(&empty).expect("mkdir");
    let empty = empty.to_string_lossy().into_owned();
    let full = vault_arg(&sb);
    let mut s = session(&sb, &["--vault", &full, "--vault", &empty]);
    s.handshake();
    let mut id = 0;
    for (input, first) in [
        (
            ".env",
            "error[INVALID_ARGUMENT]: .env is not a markdown note",
        ),
        (
            ".git/config",
            "error[INVALID_ARGUMENT]: .git/config is not a markdown note",
        ),
        (
            "x.txt",
            "error[INVALID_ARGUMENT]: x.txt is not a markdown note",
        ),
        (
            "notes/.draft.md",
            "error[INVALID_ARGUMENT]: notes/.draft.md is where the vault walk does not go",
        ),
        (
            "node_modules/m.md",
            "error[INVALID_ARGUMENT]: node_modules/m.md is where the vault walk does not go",
        ),
        ("nope.md", "error[FILE_NOT_FOUND]: no file at nope.md"),
    ] {
        for (tool, key) in [
            ("read_note", "path"),
            ("list_tasks", "file"),
            ("outgoing_links", "path"),
        ] {
            for vault in [&full, &empty] {
                id += 1;
                let result = s.call(id, tool, json!({ "vault": vault, key: input }));
                assert_eq!(tool_error(&result), first, "{tool} {input} in {vault}");
            }
        }
    }
    for (tool, key) in [
        ("read_note", "path"),
        ("list_tasks", "file"),
        ("outgoing_links", "path"),
    ] {
        id += 1;
        let result = s.call(id, tool, json!({ "vault": &full, key: "a.md" }));
        structured(&result);
        id += 1;
        let result = s.call(id, tool, json!({ "vault": &empty, key: "a.md" }));
        assert_eq!(
            tool_error(&result),
            "error[FILE_NOT_FOUND]: no file at a.md",
            "{tool}"
        );
    }
    assert_eq!(s.end().code, 0);
}

/// The nine tools of spec 0068 §3.3 as `tools/list` gives them: each says it only reads,
/// each output schema is an object, and each page tool bounds `limit` and `offset` in its
/// input schema, so a model knows the range from the list alone. Each page tool's default
/// and largest `limit` are pinned here: a change to one is a change to this test.
///
/// What fails this: a tool missing, renamed or added; a read-only hint dropped; a bound
/// left out of a schema; a page tool's default or largest `limit` changed.
#[test]
fn tools_list_gives_the_nine_tools_of_the_spec() {
    let sb = sandbox();
    let mut s = session(&sb, &["--vault", &vault_arg(&sb)]);
    s.handshake();
    let reply = s.request(1, "tools/list", json!({}));
    let tools = reply["result"]["tools"].as_array().expect("tools").clone();
    let names: Vec<&str> = tools
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        [
            "list_vaults",
            "list_files",
            "read_note",
            "search",
            "list_tags",
            "notes_with_tag",
            "list_tasks",
            "backlinks",
            "outgoing_links",
        ]
    );
    for tool in &tools {
        let name = tool["name"].as_str().unwrap();
        assert_eq!(tool["annotations"]["readOnlyHint"], json!(true), "{name}");
        assert_eq!(tool["annotations"]["openWorldHint"], json!(false), "{name}");
        assert!(tool["title"].is_string(), "{name}");
        assert!(
            tool["description"]
                .as_str()
                .is_some_and(|d| d.chars().count() <= 2048),
            "{name}"
        );
        assert_eq!(tool["outputSchema"]["type"], json!("object"), "{name}");
        let input = &tool["inputSchema"];
        assert_eq!(input["type"], json!("object"), "{name}");
        assert_eq!(input["additionalProperties"], json!(false), "{name}");
        assert_eq!(
            input["properties"]["vault"]["type"],
            json!("string"),
            "{name}"
        );
        let limit = match name {
            "list_files" | "notes_with_tag" => Some((200, 1000)),
            "read_note" => Some((2000, 5000)),
            "search" => Some((50, 500)),
            "list_tags" => Some((500, 2000)),
            "list_tasks" | "backlinks" | "outgoing_links" => Some((100, 500)),
            _ => None,
        };
        match limit {
            Some((default, maximum)) => {
                let limit = &input["properties"]["limit"];
                assert_eq!(limit["minimum"], json!(1), "{name}");
                assert_eq!(limit["default"], json!(default), "{name}");
                assert_eq!(limit["maximum"], json!(maximum), "{name}");
                assert_eq!(input["properties"]["offset"]["minimum"], json!(0), "{name}");
            }
            None => assert!(input["properties"].get("limit").is_none(), "{name}"),
        }
        let required = match name {
            "read_note" | "backlinks" | "outgoing_links" => json!(["path"]),
            "search" => json!(["query"]),
            "notes_with_tag" => json!(["tag"]),
            _ => Value::Null,
        };
        assert_eq!(input["required"], required, "{name}");
    }
    assert_eq!(s.end().code, 0);
}

/// The new protocol (`2026-07-28`) needs no handshake: `server/discover`, then a call that
/// carries the `_meta` that revision requires (spec 0068 D1 — rmcp serves it; pinned here).
///
/// What fails this: `get_info` naming another server; an rmcp that answers `server/discover`
/// without `2026-07-28` among `supportedVersions`, or refuses a call that is not preceded by
/// `initialize`.
#[test]
fn the_new_protocol_is_served_without_a_handshake() {
    let sb = sandbox();
    write(&sb.vault, "a.md", "a\n");
    let meta = json!({
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {}
    });
    let mut s = session(&sb, &["--vault", &vault_arg(&sb)]);
    let discover = s.request(1, "server/discover", json!({ "_meta": meta }));
    let result = &discover["result"];
    assert!(
        result["supportedVersions"]
            .as_array()
            .is_some_and(|versions| versions.contains(&json!("2026-07-28"))),
        "{discover}"
    );
    assert_eq!(
        result["_meta"]["io.modelcontextprotocol/serverInfo"]["name"],
        json!("baram")
    );
    let call = s.request(
        2,
        "tools/call",
        json!({ "name": "list_files", "arguments": {}, "_meta": meta }),
    );
    assert_eq!(paths(structured(&call["result"])), ["a.md"]);
    assert_eq!(s.end().code, 0);
}

/// A session that calls every tool writes nothing into the vault, the app's config or its
/// logs (spec 0068 §7), measured the way `tests/cli.rs` measures the CLI: a snapshot of the
/// whole sandbox before and after.
///
/// What fails this: a tool that writes — a cache, a lock file, a rewritten config.
#[test]
fn a_session_writes_nothing_into_the_vault_the_config_or_the_logs() {
    let sb = sandbox();
    write_config(&sb, &[("baram:context", registered(&sb))]);
    write(&sb.vault, "a.md", "#work\n- [ ] task\nsee [[b]]\n");
    write(&sb.vault, "b.md", "needle\n");
    let before = snapshot(&sb.base);
    // Whole-second modification times cannot show a rewrite made in the fixture's second.
    std::thread::sleep(std::time::Duration::from_millis(1100));
    let mut s = session(&sb, &["--vault", "Fixture"]);
    s.handshake();
    for (id, tool, arguments) in [
        (1, "list_vaults", json!({})),
        (2, "list_files", json!({})),
        (3, "read_note", json!({ "path": "a.md" })),
        (4, "search", json!({ "query": "needle" })),
        (5, "list_tags", json!({})),
        (6, "notes_with_tag", json!({ "tag": "work" })),
        (7, "list_tasks", json!({})),
        (8, "backlinks", json!({ "path": "b.md" })),
        (9, "outgoing_links", json!({ "path": "a.md" })),
    ] {
        let result = s.call(id, tool, arguments);
        structured(&result);
    }
    let ended = s.end();
    assert_eq!(ended.code, 0, "{}", ended.stderr);
    assert_eq!(
        snapshot(&sb.base),
        before,
        "a tool wrote into the vault, the app's config or its logs"
    );
}
