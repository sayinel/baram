// §389 What `tools/list` shows for each tool: its name, title, description, argument
// table and output schema (spec 0068 §3.3, §3.6). What a call runs is `tools.rs`.

use super::args::{self, Kind, Spec, OFFSET, VAULT};
use super::page::Page;
use super::tools::{NoteText, ToolName, VaultList};
use crate::cli::ops::PathRow;
use crate::cli::ops_links::{BacklinkRow, LinkRow};
use crate::cli::ops_notes::{TagRow, TaskRow};
use crate::cli::ops_search::SearchRow;
use rmcp::handler::server::common::schema_for_output;
use rmcp::model::{JsonObject, Tool, ToolAnnotations};
use schemars::transform::{RecursiveTransform, Transform};
use schemars::Schema;
use serde_json::Value;
use std::sync::Arc;

/// What `tools/list` says about a tool.
pub(super) struct About {
    pub(super) name: &'static str,
    title: &'static str,
    /// What the tool does — not what the model should do (spec 0068 §3.6).
    description: &'static str,
    pub(super) arguments: &'static [Spec],
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

const READ_NOTE: &[Spec] = &[
    VAULT,
    Spec {
        name: "path",
        kind: Kind::Text,
        required: true,
        doc: "The note, relative to the vault root.",
    },
    Spec {
        name: "offset",
        kind: Kind::Count {
            min: 0,
            max: None,
            default: 0,
        },
        required: false,
        doc: "How many lines to skip: the nextOffset of the page before, or a search \
              match's line minus 1. Default 0.",
    },
    Spec {
        doc: "The most lines a page holds.",
        ..args::limit(2000, 5000)
    },
];

const SEARCH: &[Spec] = &[
    VAULT,
    Spec {
        name: "query",
        kind: Kind::Text,
        required: true,
        doc: "The text to find; with regex, a regular expression (Rust regex syntax).",
    },
    Spec {
        name: "regex",
        kind: Kind::Flag,
        required: false,
        doc: "Read query as a regular expression.",
    },
    Spec {
        name: "caseSensitive",
        kind: Kind::Flag,
        required: false,
        doc: "Match case exactly.",
    },
    Spec {
        name: "word",
        kind: Kind::Flag,
        required: false,
        doc: "Match whole words only.",
    },
    Spec {
        name: "folder",
        kind: Kind::Text,
        required: false,
        doc: "Only this folder, relative to the vault root.",
    },
    OFFSET,
    args::limit(50, 500),
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

const BACKLINKS: &[Spec] = &[
    VAULT,
    Spec {
        name: "path",
        kind: Kind::Text,
        required: true,
        doc: "The note, relative to the vault root. It need not exist yet.",
    },
    OFFSET,
    args::limit(100, 500),
];

const OUTGOING_LINKS: &[Spec] = &[
    VAULT,
    Spec {
        name: "path",
        kind: Kind::Text,
        required: true,
        doc: "The note, relative to the vault root.",
    },
    OFFSET,
    args::limit(100, 500),
];

impl ToolName {
    pub(super) fn about(self) -> About {
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
                              folder of it, by path: the files the app's walk finds for tags, \
                              tasks and links. Hidden files and folders, and node_modules, are \
                              left out.",
                arguments: LIST_FILES,
            },
            ToolName::ReadNote => About {
                name: "read_note",
                title: "Read a note",
                description: "The text of one note (.md or .markdown), a page of lines at a \
                              time, each line with its line ending: content, totalLines, and \
                              nextOffset when more follows. A page also ends early, at the end \
                              of a line, before it grows past a size limit. Only notes: hidden \
                              files, files in hidden folders or in node_modules, and files \
                              other than .md and .markdown are refused.",
                arguments: READ_NOTE,
            },
            ToolName::Search => About {
                name: "search",
                title: "Search notes",
                description: "Full-text search of the vault's .md files, as the app's search \
                              runs it: each match's path, line (from 1) and a snippet of the \
                              line around the match, at most 300 characters. Each page is cut from the matches in the \
                              order the search finds them, then sorted by path and line. \
                              Hidden .md files inside ordinary folders are searched too; \
                              read_note does not open those. read_note with offset = line - 1 \
                              starts at a match's line.",
                arguments: SEARCH,
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
            ToolName::Backlinks => About {
                name: "backlinks",
                title: "Backlinks",
                description: "The links that point at a note, as the app's backlinks panel \
                              counts them in this vault (with registered vaults nested in \
                              one another the panel can list more): each linking note's \
                              path, line, link type, the line's text (trimmed; past 200 \
                              bytes, cut at the last character boundary at or before byte \
                              200 and followed by …) and block id, by path and line. The note \
                              need not exist yet. A path that is a folder is refused.",
                arguments: BACKLINKS,
            },
            ToolName::OutgoingLinks => About {
                name: "outgoing_links",
                title: "Outgoing links",
                description: "The links a note holds and where each leads, by line: link \
                              type, target, block id, and whether it resolves to a file in \
                              this vault (with its path — not always a note: a link can name \
                              a PDF or an image), names another vault (with that vault's \
                              alias), or resolves to nothing.",
                arguments: OUTGOING_LINKS,
            },
        }
    }

    fn output_schema(self) -> Arc<JsonObject> {
        portable(match self {
            ToolName::ListVaults => schema_for_output::<VaultList>(),
            ToolName::ListFiles | ToolName::NotesWithTag => schema_for_output::<Page<PathRow>>(),
            ToolName::ReadNote => schema_for_output::<NoteText>(),
            ToolName::Search => schema_for_output::<Page<SearchRow>>(),
            ToolName::ListTags => schema_for_output::<Page<TagRow>>(),
            ToolName::ListTasks => schema_for_output::<Page<TaskRow>>(),
            ToolName::Backlinks => schema_for_output::<Page<BacklinkRow>>(),
            ToolName::OutgoingLinks => schema_for_output::<Page<LinkRow>>(),
        })
    }
}

/// Keywords of JSON Schema 2020-12 that a value of another type passes: the validation
/// keywords for numbers, strings, arrays and objects (§6.2–§6.5 of the validation spec), the
/// applicators to the items of an array and the properties of an object (§10.3.1–§10.3.2 of
/// the core spec), and `format`, an annotation under the default vocabulary. Beside a `type` array
/// that allows null, a null passes each of these, so they mean the same inside the non-null
/// branch of an `anyOf`. A keyword of that kind left out of the list only leaves a schema
/// beside it as it is.
const ONE_TYPE_KEYWORDS: &[&str] = &[
    "format",
    "multipleOf",
    "maximum",
    "exclusiveMaximum",
    "minimum",
    "exclusiveMinimum",
    "maxLength",
    "minLength",
    "pattern",
    "items",
    "prefixItems",
    "contains",
    "maxItems",
    "minItems",
    "uniqueItems",
    "maxContains",
    "minContains",
    "properties",
    "patternProperties",
    "additionalProperties",
    "propertyNames",
    "maxProperties",
    "minProperties",
    "required",
    "dependentRequired",
];

/// An output schema as schemars writes it, with the two forms `impl-notes/0094` found
/// clients read badly written another way: a field that can be null is `anyOf` its type
/// and null instead of a `type` array (MCP Inspector's `--strict` warns about the array,
/// which a client translating the schema into a dialect with one `type` per schema can
/// refuse), and an integer has no `format` (Claude Code warns about `uint`, `uint32` and
/// `int8`, which it does not know). The `minimum` beside each keeps its lower bound, and
/// `int8`'s `maximum` its upper; the upper bound `uint32` or `uint` stood for goes with the
/// format — a bound no validator checked, since `format` is an annotation.
fn portable(schema: Arc<JsonObject>) -> Arc<JsonObject> {
    let mut rewritten = Schema::from(schema.as_ref().clone());
    RecursiveTransform(one_type_per_schema).transform(&mut rewritten);
    // A schema made from an object stays one: the transform only rewrites its keys.
    rewritten
        .as_object()
        .cloned()
        .map(Arc::new)
        .unwrap_or(schema)
}

/// The keywords that describe a field and constrain no value (2020-12's meta-data
/// vocabulary, and `$comment`): they stay on the field when its `type` array is split.
const ANNOTATIONS: &[&str] = &[
    "title",
    "description",
    "default",
    "deprecated",
    "readOnly",
    "writeOnly",
    "examples",
    "$comment",
];

/// `{"type": [T, "null"], …}` becomes `{"anyOf": [{"type": T, …}, {"type": "null"}]}`:
/// the keywords of `ONE_TYPE_KEYWORDS` move into T's branch and the `ANNOTATIONS` stay on
/// the field. A `type` array of another shape, or one beside any other keyword (a null
/// might not pass it), is left as it is — and
/// `output_schemas_hold_no_type_array_and_no_integer_format` fails on it. An integer
/// schema loses its `format`.
fn one_type_per_schema(schema: &mut Schema) {
    let Some(object) = schema.as_object_mut() else {
        return;
    };
    let other = match object.get("type") {
        Some(Value::Array(types)) => match types.as_slice() {
            [other, null] | [null, other] if *null == "null" && *other != "null" => {
                Some(other.clone())
            }
            _ => None,
        },
        _ => None,
    };
    let splits = object.keys().all(|key| {
        key == "type"
            || ONE_TYPE_KEYWORDS.contains(&key.as_str())
            || ANNOTATIONS.contains(&key.as_str())
    });
    if let (Some(other), true) = (other, splits) {
        object.remove("type");
        let mut branch = JsonObject::new();
        branch.insert("type".to_string(), other);
        for key in ONE_TYPE_KEYWORDS {
            if let Some(value) = object.remove(*key) {
                branch.insert((*key).to_string(), value);
            }
        }
        let mut null = JsonObject::new();
        null.insert("type".to_string(), Value::from("null"));
        object.insert(
            "anyOf".to_string(),
            Value::Array(vec![Value::Object(branch), Value::Object(null)]),
        );
    }
    if object.get("type").and_then(Value::as_str) == Some("integer") {
        object.remove("format");
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::args::TaskStatus;

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

    /// Every schema object in `value` with the path to it, `value` itself first.
    fn schema_objects<'a>(
        value: &'a serde_json::Value,
        at: String,
        found: &mut Vec<(String, &'a serde_json::Map<String, serde_json::Value>)>,
    ) {
        match value {
            serde_json::Value::Object(object) => {
                found.push((at.clone(), object));
                for (key, inner) in object {
                    schema_objects(inner, format!("{at}/{key}"), found);
                }
            }
            serde_json::Value::Array(items) => {
                for (index, inner) in items.iter().enumerate() {
                    schema_objects(inner, format!("{at}/{index}"), found);
                }
            }
            _ => {}
        }
    }

    /// A field that can be null says so with `anyOf`, and no integer carries a `format`
    /// (`impl-notes/0094`): MCP Inspector's `--strict` warns about a `type` array, which a
    /// client translating the schema into a dialect with one `type` per schema can refuse,
    /// and Claude Code warns about `uint`, `uint32` and `int8`, formats it does not know.
    /// The walk visits every object in each schema, so a field added later is held too.
    /// What fails this: the output schemas served as schemars writes them.
    #[test]
    fn output_schemas_hold_no_type_array_and_no_integer_format() {
        for tool in definitions() {
            let shown = serde_json::to_value(&tool).unwrap();
            let mut objects = Vec::new();
            schema_objects(&shown["outputSchema"], tool.name.to_string(), &mut objects);
            for (at, object) in objects {
                assert!(
                    !object.get("type").is_some_and(serde_json::Value::is_array),
                    "{at}: {object:?}"
                );
                if object.get("type").and_then(serde_json::Value::as_str) == Some("integer") {
                    assert!(!object.contains_key("format"), "{at}: {object:?}");
                }
            }
        }
    }

    /// The pair of the test above, on two fields: the null is still there, and so are the
    /// bounds the dropped `format` stood beside. What fails this: a transform that drops
    /// the null, the bounds or the description, or one that keeps the bounds outside the
    /// non-null branch.
    #[test]
    fn a_nullable_integer_is_any_of_the_integer_and_null() {
        let shown: Vec<serde_json::Value> = definitions()
            .iter()
            .map(|tool| serde_json::to_value(tool).unwrap())
            .collect();
        let tool = |name: &str| {
            shown
                .iter()
                .find(|tool| tool["name"] == name)
                .map(|tool| tool["outputSchema"].clone())
                .unwrap()
        };
        assert_eq!(
            tool("list_files")["properties"]["nextOffset"],
            serde_json::json!({
                "description": "The `offset` that asks for the next page; there only when \
                                `truncated` is.",
                "anyOf": [{ "type": "integer", "minimum": 0 }, { "type": "null" }]
            })
        );
        assert_eq!(
            tool("list_tasks")["$defs"]["TaskRow"]["properties"]["priority"],
            serde_json::json!({ "type": "integer", "minimum": -128, "maximum": 127 })
        );
    }

    /// What fails this: a status the CLI renames or drops and this list keeps — `list_tasks`
    /// would take it and end as `-32603` — or one the CLI adds and this list lacks, which
    /// `list_tasks` could not reach.
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
}
