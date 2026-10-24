// §389 The tools: their names, and the CLI function each call runs. What `tools/list`
// shows for each is `catalog.rs`.

use super::args::{self, Args};
use super::page::{self, Page};
use super::scope::Scope;
use super::server::Server;
use crate::cli::args::TaskStatus;
use crate::cli::error::CliError;
use crate::cli::ops::{self, VaultRow};
use crate::cli::ops_links;
use crate::cli::ops_notes;
use crate::cli::ops_search::{self, SearchQuery};
use crate::cli::output::VaultInfo;
use crate::cli::paths;
use crate::cli::vault::Vault;
use rmcp::model::JsonObject;
use schemars::JsonSchema;
use serde::Serialize;
use serde_json::Value;

/// The tools. No `_` arm in the `match`es over them — `about` and `output_schema` in
/// `catalog.rs`, `call` below: a new tool must be given its name, title, description,
/// arguments, output and call before the crate compiles.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ToolName {
    ListVaults,
    ListFiles,
    ReadNote,
    Search,
    ListTags,
    NotesWithTag,
    ListTasks,
    Backlinks,
    OutgoingLinks,
}

/// A `read_note` page ends before the line that would take it past this many characters
/// (spec 0068 §3.4); its first line is kept whole, so a page can pass it by that line. The
/// result is carried twice — as structured content and again as text — so the cap is a
/// starting point under what a client keeps of one result: at about one token per character
/// (an estimate), an all-Hangul page of 10,000 characters is about 20,000 tokens for the two
/// copies.
const READ_NOTE_CHARS: usize = 10_000;

impl ToolName {
    /// Every tool, in the order `tools/list` gives them. Listed by hand: the compiler holds
    /// the `match`es to every variant, not this list — `tests/mcp.rs` pins the names
    /// `tools/list` gives.
    pub(super) const ALL: &'static [ToolName] = &[
        ToolName::ListVaults,
        ToolName::ListFiles,
        ToolName::ReadNote,
        ToolName::Search,
        ToolName::ListTags,
        ToolName::NotesWithTag,
        ToolName::ListTasks,
        ToolName::Backlinks,
        ToolName::OutgoingLinks,
    ];

    pub(super) fn from_name(name: &str) -> Option<ToolName> {
        ToolName::ALL
            .iter()
            .copied()
            .find(|tool| tool.about().name == name)
    }
}

/// Why a call has no result.
pub(super) enum Failure {
    /// What the model can read and act on — a bad argument, a vault or file not found —
    /// returned as a tool error (spec 0068 D11).
    Tool(CliError),
    /// No argument's fault: JSON-RPC `-32603`.
    Internal(String),
}

impl From<CliError> for Failure {
    fn from(error: CliError) -> Self {
        Failure::Tool(error)
    }
}

/// `list_vaults`' result (spec 0068 §3.4).
#[derive(Serialize, JsonSchema)]
pub(super) struct VaultList {
    /// The vault this call resolved to; left out when it resolved to none.
    #[serde(skip_serializing_if = "Option::is_none")]
    vault: Option<VaultInfo>,
    items: Vec<VaultRow>,
}

/// `read_note`'s result (spec 0068 §3.4).
#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct NoteText {
    vault: VaultInfo,
    path: String,
    /// The page's lines, each with its line ending.
    content: String,
    /// How many lines the whole note has.
    total_lines: usize,
    /// More lines come after this page.
    truncated: bool,
    /// The `offset` that asks for the next page; there only when `truncated` is.
    #[serde(skip_serializing_if = "Option::is_none")]
    next_offset: Option<usize>,
}

/// Runs one call: its arguments checked first, then config.json read as it is now (D13),
/// then the vault resolved inside the scope.
pub(super) async fn call(
    server: &Server,
    tool: ToolName,
    arguments: Option<JsonObject>,
) -> Result<Value, Failure> {
    let args = args::read(arguments, tool.about().arguments)?;
    let config = server.config();
    let scope = Scope::new(&server.allowed, &config);
    let resolve = || scope.resolve(args.text("vault"), server.home.as_deref());
    match tool {
        ToolName::ListVaults => {
            // The tool that finds vaults does not fail on one it cannot resolve
            // (spec 0068 §3.2-3).
            let current = resolve().ok();
            encode(&VaultList {
                vault: current.as_ref().map(ops::vault_info),
                items: scope.rows(current.as_ref()),
            })
        }
        ToolName::ListFiles => {
            let vault = resolve()?;
            paged(
                &vault,
                ops::files(&vault, args.text("folder")).await?.items,
                &args,
            )
        }
        ToolName::ReadNote => {
            let vault = resolve()?;
            let note = ops::read_note(&vault, args.text("path").unwrap_or_default()).await?;
            let page = page::lines(
                &note.content,
                args.count("offset"),
                args.count("limit"),
                READ_NOTE_CHARS,
            );
            encode(&NoteText {
                vault: ops::vault_info(&vault),
                path: note.path,
                content: page.content,
                total_lines: page.total,
                truncated: page.truncated,
                next_offset: page.next_offset,
            })
        }
        ToolName::Search => {
            let vault = resolve()?;
            let (offset, limit) = (args.count("offset"), args.count("limit"));
            let found = ops_search::search(
                &vault,
                SearchQuery {
                    query: args.text("query").unwrap_or_default(),
                    regex: args.flag("regex"),
                    case_sensitive: args.flag("caseSensitive"),
                    word: args.flag("word"),
                    folder: args.text("folder"),
                    offset,
                    limit,
                },
            )
            .await?;
            // Not `Page::cut`: the search has cut the page itself, in the order it found the
            // hits (spec 0068 §3.4).
            encode(&Page {
                vault: ops::vault_info(&vault),
                items: found.items,
                truncated: found.truncated,
                next_offset: found.truncated.then(|| offset.saturating_add(limit)),
            })
        }
        ToolName::ListTags => {
            let vault = resolve()?;
            paged(&vault, ops_notes::tags(&vault).await?.items, &args)
        }
        ToolName::NotesWithTag => {
            let vault = resolve()?;
            let tag = args.text("tag").unwrap_or_default();
            paged(&vault, ops_notes::tag(&vault, tag).await?.items, &args)
        }
        ToolName::ListTasks => {
            let vault = resolve()?;
            // `read` has checked the value against TASK_STATUSES, the CLI's own names.
            let status = <TaskStatus as clap::ValueEnum>::from_str(args.choice("status"), false)
                .map_err(Failure::Internal)?;
            // The note rules before the file question (spec 0068 D6). The CLI's function then
            // asks both again, in its own order.
            if let Some(file) = args.text("file") {
                paths::note_names_first(&vault, file)?;
            }
            let found = ops_notes::tasks(
                &vault,
                &config.tasks_exclude_paths,
                status,
                args.text("file"),
            )
            .await?;
            paged(&vault, found.items, &args)
        }
        ToolName::Backlinks => {
            let vault = resolve()?;
            let path = args.text("path").unwrap_or_default();
            let found = server
                .gate
                .run(ops_links::backlinks(&vault, path, &config))
                .await?;
            paged(&vault, found.items, &args)
        }
        ToolName::OutgoingLinks => {
            let vault = resolve()?;
            let path = args.text("path").unwrap_or_default();
            // As for `list_tasks`' `file`.
            paths::note_names_first(&vault, path)?;
            let found = server.gate.run(ops_links::links(&vault, path)).await?;
            paged(&vault, found.items, &args)
        }
    }
}

/// One page of a list the CLI has already put in its order (spec 0068 §3.4).
fn paged<T: Serialize>(vault: &Vault, items: Vec<T>, args: &Args) -> Result<Value, Failure> {
    encode(&Page::cut(
        ops::vault_info(vault),
        items,
        args.count("offset"),
        args.count("limit"),
    ))
}

pub(super) fn encode<T: Serialize>(value: &T) -> Result<Value, Failure> {
    serde_json::to_value(value)
        .map_err(|error| Failure::Internal(format!("cannot encode the result: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What fails this: `from_name` and `ALL` disagreeing with the names `about` gives.
    #[test]
    fn each_tool_is_found_by_its_own_name_and_only_by_it() {
        for tool in ToolName::ALL {
            assert_eq!(ToolName::from_name(tool.about().name), Some(*tool));
        }
        assert_eq!(ToolName::from_name("nope"), None);
        let mut names: Vec<&str> = ToolName::ALL.iter().map(|tool| tool.about().name).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), ToolName::ALL.len());
    }
}
