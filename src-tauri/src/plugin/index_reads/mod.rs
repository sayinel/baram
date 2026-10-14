//! §393 The six index reads a plugin makes (spec 0072 §5.1): backlinks and links from one
//! context's link index; tags, notes with a tag, tasks and full-text search from a walk of that
//! context's directory. Both tiers come through here — the sandboxed one through the six
//! `PluginOp::Index*` broker ops, the trusted one through the `plugin_index_read` command
//! (`commands/plugin_index_cmd.rs` holds both edges) — so the two tiers' rows cannot drift.
//!
//! The caller names the context (`resolve_scope`) and puts each path argument through its
//! tier's own gate (`check_paths` runs the check it is handed). This module keeps every checked
//! path under the scope's root, hands the walkers the registered spelling and the link index
//! its own (spec D18), and writes every row path in the tier's form (`PathForm::write`,
//! `rows.rs`).
//!
//! Spec D17: the refusals this layer makes — `resolve_scope`, `below_root` and `encode` here,
//! the six reads in `reads.rs` with the checks and failure mappings they call
//! (`note_below_root`, `folder_below_root`, `link_index_failure`, `walk_failure`), and
//! `PathForm::write` in `rows.rs` — are fixed messages, or messages that repeat only what the
//! caller sent (a path as given, a context id, a `limit`, a query with the regex crate's
//! reason). Where the error underneath names the vault root, it goes to the log instead. A
//! gate's refusal is the tier's own: `check_paths` hands it back unchanged.

mod reads;
mod rows;
#[cfg(test)]
mod tests;

use crate::context::manager::Registered;
use crate::context::{ContextManager, ContextType};
use crate::index::service::LinkIndexState;
use crate::task::TaskStatus;
use serde::Deserialize;
use std::future::Future;
use std::path::{Path, PathBuf};

/// D17 — what every link-index failure reads as: a build that failed (its own error names the
/// root) and a registration that changed under the read (`INDEX_NOT_READY`).
const LINK_INDEX_FAILED: &str =
    "the link index for this context could not be read; try again in a moment";

/// D17 — what every walk failure reads as (tags, notes with a tag, tasks, search). The walkers'
/// errors name the directory they failed on: `FsError::ReadDir`, flattened to a string by `tag`
/// and `task`, and `search_files`' "Root path is not a directory: …".
const WALK_FAILED: &str = "could not read the vault";

const NO_CONTEXT: &str = "no context is open";

/// One read as a caller sends it: the trusted command's `read`, tagged on `read`, and what
/// each sandboxed `PluginOp::Index*` becomes. Paths are as the caller wrote them — absolute
/// (trusted) or context-relative (sandboxed) — until `check_paths` runs.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "read", rename_all = "camelCase")]
pub(crate) enum IndexRead {
    Backlinks {
        path: String,
    },
    Links {
        path: String,
    },
    NotesWithTag {
        tag: String,
    },
    Search {
        query: String,
        #[serde(default)]
        options: SearchArgs,
    },
    Tags,
    Tasks {
        status: Option<TaskStatus>,
        file: Option<String>,
    },
}

/// `IndexSearchOptions` without `context` (spec §4). Every field may be left out.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchArgs {
    #[serde(default)]
    pub case_sensitive: bool,
    /// A path: `check_paths` moves it into `Checked::Search::folder`.
    pub folder: Option<String>,
    /// From 1 to 1000; `None` is 200 (spec D10).
    pub limit: Option<u32>,
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub word: bool,
}

/// How a tier writes a path (spec D6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PathForm {
    /// Trusted: absolute, in the spelling of the root the read used.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "first constructor: plan 0124 Task 6 (the trusted command)"
        )
    )]
    Absolute,
    /// Sandboxed: relative to the context root, `/`-separated — the shape of `PluginFileEvent.path`.
    Relative,
}

/// The directory context a read answers from (spec D7: one), and the form its row paths take.
pub(crate) struct Scope {
    pub ctx: Registered,
    pub form: PathForm,
}

/// A path argument after its tier's gate: as the caller wrote it — the only spelling an error
/// may repeat — and the canonical path it named, which may not exist.
#[derive(Debug, Clone)]
pub(crate) struct PathArg {
    pub given: String,
    pub canonical: PathBuf,
}

/// A read whose path arguments went through `check_paths`.
#[derive(Debug)]
pub(crate) enum Checked {
    Backlinks {
        path: PathArg,
    },
    Links {
        path: PathArg,
    },
    NotesWithTag {
        tag: String,
    },
    /// `options.folder` was moved into `folder`; the read does not look at the former.
    Search {
        folder: Option<PathArg>,
        options: SearchArgs,
        query: String,
    },
    Tags,
    Tasks {
        /// The task panel's excluded folders, vault-relative (spec D9).
        exclude: Vec<String>,
        file: Option<PathArg>,
        status: TaskStatus,
    },
}

/// The directory context `context` names, or the active one. Refuses — naming only the id the
/// caller sent — an unknown id, no active context, and a File context (§89: one file, no index).
pub(crate) async fn resolve_scope(
    ctx_mgr: &ContextManager,
    context: Option<String>,
) -> Result<Registered, String> {
    let id = match context {
        Some(id) => id,
        None => ctx_mgr
            .active_id()
            .await
            .ok_or_else(|| NO_CONTEXT.to_string())?,
    };
    let registered = ctx_mgr
        .registered(&id)
        .await
        .ok_or_else(|| format!("unknown context \"{id}\""))?;
    match registered.info.context_type {
        ContextType::Vault | ContextType::Folder => Ok(registered),
        ContextType::File => Err(format!(
            "context \"{id}\" is a single file, which has no index"
        )),
    }
}

/// `read` with each path argument through `check` — the tier's own gate — and the task
/// exclusions read only for `Tasks`. ‼️ No `_` arm: a seventh read does not compile until it
/// says which of its arguments are paths, so neither tier can forget to gate one (P13).
pub(crate) async fn check_paths<F, Fut>(
    read: IndexRead,
    mut check: F,
    exclude: impl FnOnce() -> Vec<String>,
) -> Result<Checked, String>
where
    F: FnMut(String) -> Fut,
    Fut: Future<Output = Result<PathArg, String>>,
{
    Ok(match read {
        IndexRead::Backlinks { path } => Checked::Backlinks {
            path: check(path).await?,
        },
        IndexRead::Links { path } => Checked::Links {
            path: check(path).await?,
        },
        IndexRead::NotesWithTag { tag } => Checked::NotesWithTag { tag },
        IndexRead::Search { query, mut options } => {
            let folder = match options.folder.take() {
                Some(folder) => Some(check(folder).await?),
                None => None,
            };
            Checked::Search {
                folder,
                options,
                query,
            }
        }
        IndexRead::Tags => Checked::Tags,
        IndexRead::Tasks { status, file } => {
            let file = match file {
                Some(file) => Some(check(file).await?),
                None => None,
            };
            Checked::Tasks {
                exclude: exclude(),
                file,
                status: status.unwrap_or(TaskStatus::Open),
            }
        }
    })
}

/// Answer `read` from `scope` as the JSON value the plugin receives. ‼️ No `_` arm.
pub(crate) async fn run(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    scope: &Scope,
    read: Checked,
) -> Result<serde_json::Value, String> {
    match read {
        Checked::Backlinks { path } => {
            encode(&reads::backlinks(state, ctx_mgr, scope, &path).await?)
        }
        Checked::Links { path } => encode(&reads::links(state, ctx_mgr, scope, &path).await?),
        Checked::NotesWithTag { tag } => encode(&reads::notes_with_tag(scope, &tag).await?),
        Checked::Search {
            folder,
            options,
            query,
        } => encode(&reads::search(scope, &query, &options, folder.as_ref()).await?),
        Checked::Tags => encode(&reads::tags(scope).await?),
        Checked::Tasks {
            exclude,
            file,
            status,
        } => encode(&reads::tasks(scope, &exclude, status, file.as_ref()).await?),
    }
}

fn encode<T: serde::Serialize>(rows: &T) -> Result<serde_json::Value, String> {
    serde_json::to_value(rows).map_err(|error| {
        log::warn!("[plugin index] rows could not be encoded: {error}");
        "the answer could not be encoded".to_string()
    })
}

/// `arg` relative to the scope's canonical root, refused when it is not under it (P12): a
/// symlink inside the vault that leads into another registered context passes both tiers'
/// gates (`ensure_path_in_vault` takes any context), and answering for it would walk that
/// other context.
fn below_root<'a>(scope: &Scope, arg: &'a PathArg) -> Result<&'a Path, String> {
    arg.canonical
        .strip_prefix(&scope.ctx.canonical_path)
        .map_err(|_| {
            format!(
                "path \"{}\" is not inside context \"{}\"",
                arg.given, scope.ctx.info.id
            )
        })
}

/// `arg` under the REGISTERED spelling of the root — what the walkers are handed, so the
/// trusted tier's absolute rows use the spelling the app's tabs and events use (spec D18).
fn registered_spelling(scope: &Scope, arg: &PathArg) -> Result<PathBuf, String> {
    let relative = below_root(scope, arg)?;
    let root = Path::new(&scope.ctx.info.path);
    Ok(if relative.as_os_str().is_empty() {
        root.to_path_buf()
    } else {
        root.join(relative)
    })
}
