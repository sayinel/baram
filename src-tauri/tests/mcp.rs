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
        // Claude Code sets this for the servers it starts, and for these tests when it runs
        // them. The default vault reads it, so a test sets it or leaves it out on purpose.
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
/// instead of `mcp`'s — `notes/x` would be a missing directory.
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
/// What fails this: the two inputs taken in the other order; `CLAUDE_PROJECT_DIR` not read,
/// or read only when it is relative.
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
    for (env, expected) in [(&with_project[..], "Main"), (&[][..], "Other")] {
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
/// endings; `search` given offset 0 whatever the call asked.
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
        match page["nextOffset"].as_u64() {
            Some(next) => offset = next,
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
