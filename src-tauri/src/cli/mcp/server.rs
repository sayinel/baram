// §389 The MCP server: what `initialize` answers, the tool list, and how a call's outcome
// becomes a `tools/call` result (spec 0068 §3.5–§3.6). What `tools/list` shows of each tool
// is `catalog.rs` and what a call runs is `tools.rs`; which vault a call reads is `scope.rs`.

use super::catalog;
use super::gate::IndexGate;
use super::scope::Allowed;
use super::tools::{self, Failure, ToolName};
use crate::cli::app_config::AppConfig;
use crate::cli::error::CliError;
use crate::cli::output;
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, Implementation,
    ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerConfig,
};
use rmcp::service::RequestContext;
use rmcp::{ErrorData, RoleServer, ServerHandler};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

/// Sent once per session (spec 0068 §3.6). It states rules and no vault names: the vaults
/// can change between calls, and `list_vaults` shows them. Claude Code keeps 2,048
/// characters of it (`impl-notes/0086` §3.1); `instructions_fit_what_claude_code_keeps`
/// holds it under that.
pub(super) const INSTRUCTIONS: &str = "\
Read-only access to Baram vaults: folders of Markdown notes the Baram app manages. Nothing \
here changes a file or the app's settings.

Every tool takes an optional `vault`: the name or alias of a vault list_vaults shows, or \
its path — absolute, ~ alone, or starting with ~/ (or ~\\ on Windows). Without it, a tool \
reads the default vault. The vaults this server reads are the ones its --vault options \
named when it started, the first being the default; with no --vault, every vault and \
folder registered in the app at the time of the call, the default being the one that \
holds the project directory or the directory the server started in. list_vaults shows \
them and which one a call reads.

Paths are relative to the vault root and separated by /. A list tool returns one page: \
`truncated` says more follows, and `nextOffset` is the `offset` that asks for it. \
read_note pages a note by lines the same way. A vault can change between calls, so a \
later page can shift.";

/// How a call reads config.json — `app_config::load_default`, or a fixture in the tests.
pub(super) type LoadConfig = Box<dyn Fn() -> AppConfig + Send + Sync>;

pub(super) struct Server {
    pub(super) allowed: Allowed,
    /// For a `vault` argument that starts with `~`. Read once, at start.
    pub(super) home: Option<PathBuf>,
    /// One link index build at a time (D13).
    pub(super) gate: IndexGate,
    load: LoadConfig,
    /// The config warnings last written to stderr.
    warned: Mutex<Vec<String>>,
}

impl Server {
    /// `warned` is what start has already written.
    pub(super) fn new(
        allowed: Allowed,
        home: Option<PathBuf>,
        warned: Vec<String>,
        load: LoadConfig,
    ) -> Self {
        Self {
            allowed,
            home,
            gate: IndexGate::default(),
            load,
            warned: Mutex::new(warned),
        }
    }

    /// config.json as it is now (D13). Its warnings go to stderr when they are not the ones
    /// last written: a session reads it on every call, and an unchanged warning written each
    /// time would bury the rest of the client's log.
    pub(super) fn config(&self) -> AppConfig {
        let config = (self.load)();
        self.warn(&mut std::io::stderr().lock(), &config.warnings);
        config
    }

    /// Writes `warnings` to `out` unless they are the ones last written; returns whether it
    /// wrote.
    fn warn(&self, out: &mut dyn Write, warnings: &[String]) -> bool {
        // Poisoned only by a panic, which a release build does not survive.
        let Ok(mut warned) = self.warned.lock() else {
            return false;
        };
        if warned.as_slice() == warnings {
            return false;
        }
        for warning in warnings {
            let _ = output::write_warning(out, warning, false);
        }
        *warned = warnings.to_vec();
        true
    }
}

impl ServerHandler for Server {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("baram", env!("CARGO_PKG_VERSION")))
            .with_instructions(INSTRUCTIONS)
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult {
            tools: catalog::definitions(),
            ..Default::default()
        })
    }

    /// An unknown tool is a protocol error, as rmcp's own router answers it
    /// (`ToolRouter::call`). Every other outcome is a result: an error the model can act on
    /// is a tool error (spec 0068 D11).
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let Some(tool) = ToolName::from_name(&request.name) else {
            return Err(ErrorData::invalid_params("tool not found", None));
        };
        match tools::call(self, tool, request.arguments).await {
            Ok(value) => Ok(CallToolResult::structured(value).into()),
            Err(Failure::Tool(error)) => Ok(error_result(&error).into()),
            Err(Failure::Internal(message)) => Err(ErrorData::internal_error(message, None)),
        }
    }
}

/// A tool error as the model reads it: what the CLI writes to stderr in text mode —
/// `error[CODE]: message`, then a line per candidate (spec 0068 §3.5). No
/// `structuredContent`: the output schema describes a success.
fn error_result(error: &CliError) -> CallToolResult {
    let mut text = Vec::new();
    // A write into a Vec does not fail.
    let _ = output::write_error(&mut text, error, false);
    let text = String::from_utf8_lossy(&text);
    CallToolResult::error(vec![ContentBlock::text(
        text.trim_end_matches('\n').to_string(),
    )])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::error::{Candidate, ErrorCode};

    fn server(warned: &[&str]) -> Server {
        Server::new(
            Allowed::Fixed(Vec::new()),
            None,
            warned.iter().map(|w| w.to_string()).collect(),
            Box::new(AppConfig::default),
        )
    }

    /// What fails this: the comparison with the last warnings dropped (written on every
    /// call), or the last warnings never updated (a changed warning written forever).
    #[test]
    fn warnings_are_written_again_only_when_they_change() {
        let s = server(&["one"]);
        let mut out = Vec::new();
        assert!(!s.warn(&mut out, &["one".to_string()]));
        assert!(out.is_empty());
        assert!(s.warn(&mut out, &["two".to_string()]));
        assert_eq!(String::from_utf8(out.clone()).unwrap(), "warning: two\n");
        assert!(!s.warn(&mut out, &["two".to_string()]));
        assert!(
            s.warn(&mut out, &[]),
            "a config that stopped warning is a change too"
        );
    }

    #[test]
    fn instructions_fit_what_claude_code_keeps() {
        assert!(
            INSTRUCTIONS.chars().count() <= 2048,
            "{}",
            INSTRUCTIONS.chars().count()
        );
    }

    /// What fails this: the JSON form of the error, or a result with `structuredContent`.
    #[test]
    fn a_tool_error_is_the_cli_s_text_and_carries_nothing_structured() {
        let error =
            CliError::new(ErrorCode::VaultNotFound, "no vault\there").with_candidates(vec![
                Candidate {
                    name: "A".into(),
                    path: "/a".into(),
                },
            ]);
        let shown = serde_json::to_value(error_result(&error)).unwrap();
        assert_eq!(shown["isError"], true);
        assert!(shown.get("structuredContent").is_none(), "{shown}");
        assert_eq!(
            shown["content"][0]["text"],
            "error[VAULT_NOT_FOUND]: no vault\\there\n  A\t/a"
        );
    }
}
