// §389 The tools: what `tools/list` shows for each (spec 0068 §3.3, §3.6), and the CLI
// function each call runs.

use super::args::{self, Args, Kind, Spec, OFFSET, VAULT};
use super::page::Page;
use super::scope::Scope;
use super::server::Server;
use crate::cli::args::TaskStatus;
use crate::cli::error::CliError;
use crate::cli::ops::{self, PathRow, VaultRow};
use crate::cli::ops_notes::{self, TagRow, TaskRow};
use crate::cli::output::VaultInfo;
use crate::cli::vault::Vault;
use rmcp::handler::server::common::schema_for_output;
use rmcp::model::{JsonObject, Tool, ToolAnnotations};
use schemars::JsonSchema;
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;

/// The tools. No `_` arm in the `match`es below: a new tool must be given its name, title,
/// description, arguments, output and call before the crate compiles.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ToolName {
    ListVaults,
    ListFiles,
    ListTags,
    NotesWithTag,
    ListTasks,
}

/// What `tools/list` says about a tool.
struct About {
    name: &'static str,
    title: &'static str,
    /// What the tool does — not what the model should do (spec 0068 §3.6).
    description: &'static str,
    arguments: &'static [Spec],
}

const LIST_VAULTS: &[Spec] = &[VAULT];

/// The statuses `list_tasks` takes — the CLI's `--status` values
/// (`list_tasks_takes_the_statuses_the_cli_takes` holds the two together).
const TASK_STATUSES: &[&str] = &["open", "done", "cancelled", "all"];

const LIST_FILES: &[Spec] = &[
    VAULT,
    Spec {
        name: "folder",
        kind: Kind::Text,
        required: false,
        doc: "Only this folder, relative to the vault root.",
    },
    OFFSET,
    args::limit(200, 1000),
];

const LIST_TAGS: &[Spec] = &[VAULT, OFFSET, args::limit(500, 2000)];

const NOTES_WITH_TAG: &[Spec] = &[
    VAULT,
    Spec {
        name: "tag",
        kind: Kind::Text,
        required: true,
        doc: "The tag, with or without its leading #.",
    },
    OFFSET,
    args::limit(200, 1000),
];

const LIST_TASKS: &[Spec] = &[
    VAULT,
    Spec {
        name: "status",
        kind: Kind::Choice {
            values: TASK_STATUSES,
            default: "open",
        },
        required: false,
        doc: "Which tasks: open (to do and doing), done, cancelled, or all. Default open.",
    },
    Spec {
        name: "file",
        kind: Kind::Text,
        required: false,
        doc: "Only this note, relative to the vault root.",
    },
    OFFSET,
    args::limit(100, 500),
];

impl ToolName {
    /// Every tool, in the order `tools/list` gives them. Listed by hand: the compiler holds
    /// the `match`es to every variant, not this list — `tests/mcp.rs` pins the names
    /// `tools/list` gives.
    pub(super) const ALL: &'static [ToolName] = &[
        ToolName::ListVaults,
        ToolName::ListFiles,
        ToolName::ListTags,
        ToolName::NotesWithTag,
        ToolName::ListTasks,
    ];

    pub(super) fn from_name(name: &str) -> Option<ToolName> {
        ToolName::ALL
            .iter()
            .copied()
            .find(|tool| tool.about().name == name)
    }

    fn about(self) -> About {
        match self {
            ToolName::ListVaults => About {
                name: "list_vaults",
                title: "List vaults",
                description: "The vaults this server can read: each one's name, alias, type, \
                              path and whether its folder exists, and the vault a call with \
                              this `vault` reads (`vault`, left out when it names none).",
                arguments: LIST_VAULTS,
            },
            ToolName::ListFiles => About {
                name: "list_files",
                title: "List notes",
                description: "The Markdown notes (.md and .markdown) in the vault, or in one \
                              folder of it, by path: the files the app reads for tags, tasks \
                              and links. Hidden files and folders, and node_modules, are \
                              left out.",
                arguments: LIST_FILES,
            },
            ToolName::ListTags => About {
                name: "list_tags",
                title: "List tags",
                description: "The vault's tags, each with how often it occurs across the notes, \
                              most used first.",
                arguments: LIST_TAGS,
            },
            ToolName::NotesWithTag => About {
                name: "notes_with_tag",
                title: "Notes with a tag",
                description: "The notes that carry a tag, by path.",
                arguments: NOTES_WITH_TAG,
            },
            ToolName::ListTasks => About {
                name: "list_tasks",
                title: "List tasks",
                description: "The tasks in the vault's notes, or in one note: each one's path, \
                              line, state, text, priority, dates, tags and links, by path and \
                              line. The folders excluded from tasks in the app's settings are \
                              left out.",
                arguments: LIST_TASKS,
            },
        }
    }

    fn output_schema(self) -> Arc<JsonObject> {
        match self {
            ToolName::ListVaults => schema_for_output::<VaultList>(),
            ToolName::ListFiles | ToolName::NotesWithTag => schema_for_output::<Page<PathRow>>(),
            ToolName::ListTags => schema_for_output::<Page<TagRow>>(),
            ToolName::ListTasks => schema_for_output::<Page<TaskRow>>(),
        }
    }
}

/// What `tools/list` shows. Every tool reads only — no writes, no network, no cache on disk
/// — so each says so (spec 0068 §3.6). Clients may skip asking before calling a tool that
/// says it, so a tool that does anything else must not be added here with these hints.
pub(super) fn definitions() -> Vec<Tool> {
    ToolName::ALL
        .iter()
        .map(|tool| {
            let about = tool.about();
            Tool::new(about.name, about.description, args::schema(about.arguments))
                .with_title(about.title)
                .with_raw_output_schema(tool.output_schema())
                .with_annotations(ToolAnnotations::new().read_only(true).open_world(false))
        })
        .collect()
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
struct VaultList {
    /// The vault this call resolved to; left out when it resolved to none.
    #[serde(skip_serializing_if = "Option::is_none")]
    vault: Option<VaultInfo>,
    items: Vec<VaultRow>,
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
            let found = ops_notes::tasks(
                &vault,
                &config.tasks_exclude_paths,
                status,
                args.text("file"),
            )
            .await?;
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

    /// What fails this: a tool listed without the read-only hints, or with an output schema
    /// whose root is not an object (spec 0068 §3.4 — `2025-11-25` requires an object).
    #[test]
    fn every_tool_says_it_only_reads_and_returns_an_object() {
        for tool in definitions() {
            let shown = serde_json::to_value(&tool).unwrap();
            assert_eq!(shown["annotations"]["readOnlyHint"], true, "{shown}");
            assert_eq!(shown["annotations"]["openWorldHint"], false, "{shown}");
            assert!(shown["title"].is_string(), "{shown}");
            assert_eq!(shown["inputSchema"]["type"], "object", "{shown}");
            assert_eq!(shown["outputSchema"]["type"], "object", "{shown}");
        }
    }

    /// What fails this: a status added to or renamed in the CLI and not here, which would
    /// end as `-32603` in `list_tasks`.
    #[test]
    fn list_tasks_takes_the_statuses_the_cli_takes() {
        use clap::ValueEnum;
        let cli: Vec<String> = TaskStatus::value_variants()
            .iter()
            .filter_map(|status| status.to_possible_value())
            .map(|value| value.get_name().to_string())
            .collect();
        assert_eq!(cli, TASK_STATUSES);
    }

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
