//! §393 The six reads (spec 0072 §5.1). Each keeps its path arguments under the scope's root
//! and answers with rows or a refusal that names only what the caller sent (spec D17).

use super::rows::{self, BacklinkRow, LinkRow, SearchRows, TagRow, TaskRow};
use super::{
    below_root, registered_spelling, PathArg, Scope, SearchArgs, LINK_INDEX_FAILED, WALK_FAILED,
};
use crate::context::ContextManager;
use crate::index::service::{backlinks_in, links_in, LinkIndexState};
use crate::search::{QueryRefusal, SearchOptions};
use crate::task::TaskStatus;
use std::path::PathBuf;

/// Spec D10: how many matches a search returns when `limit` is not given.
const DEFAULT_LIMIT: u32 = 200;

/// Spec D10: the largest `limit` a search takes.
const MAX_LIMIT: u32 = 1000;

/// Links to `path` in the scope's link index. The note need not exist — links to a note not
/// written yet are a fair question, as `baram backlinks` takes it — but a folder is refused: it
/// would be asked about as a note named like it.
pub(super) async fn backlinks(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    scope: &Scope,
    path: &PathArg,
) -> Result<Vec<BacklinkRow>, String> {
    below_root(scope, path)?;
    if std::fs::metadata(&path.canonical).is_ok_and(|meta| meta.is_dir()) {
        return Err(format!("\"{}\" is a folder, not a note", path.given));
    }
    let found = backlinks_in(state, ctx_mgr, &scope.ctx, &path.canonical)
        .await
        .map_err(|error| link_index_failure(&error))?;
    rows::backlinks(scope.form, &found.root, found.items)
}

/// The links `path` holds. The note must exist where the walk goes (`note_below_root`); one
/// the index does not hold yet (a note made after the build, in a context nothing watches) is
/// refused, not answered empty.
pub(super) async fn links(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    scope: &Scope,
    path: &PathArg,
) -> Result<Vec<LinkRow>, String> {
    note_below_root(scope, path)?;
    let found = links_in(state, ctx_mgr, &scope.ctx, &path.canonical)
        .await
        .map_err(|error| link_index_failure(&error))?;
    let Some(outgoing) = found.items else {
        return Err(format!("\"{}\" is not in the link index yet", path.given));
    };
    rows::links(scope.form, &found.root, outgoing)
}

/// The scope's tags, in the order `tag::get_vault_tags` gives: count descending, then name.
pub(super) async fn tags(scope: &Scope) -> Result<Vec<TagRow>, String> {
    let entries = crate::tag::get_vault_tags(&scope.ctx.info.path)
        .await
        .map_err(|error| walk_failure(&error))?;
    Ok(rows::tags(entries))
}

/// The notes carrying `tag`, compared without its leading `#`s (`tag::bare_tag`) and, as
/// `get_files_by_tag` compares, lowercased.
pub(super) async fn notes_with_tag(scope: &Scope, tag: &str) -> Result<Vec<String>, String> {
    let name = crate::tag::bare_tag(tag);
    if name.is_empty() {
        return Err("\"tag\" is empty".to_string());
    }
    let found = crate::tag::get_files_by_tag(&scope.ctx.info.path, name)
        .await
        .map_err(|error| walk_failure(&error))?;
    rows::tag_notes(scope.form, &scope.ctx.info.path, &found)
}

/// The tasks `status` admits, without the folders in `exclude` (spec D9) — of one note when
/// `file` is given (`get_file_tasks` applies `exclude` to it too).
pub(super) async fn tasks(
    scope: &Scope,
    exclude: &[String],
    status: TaskStatus,
    file: Option<&PathArg>,
) -> Result<Vec<TaskRow>, String> {
    let root = scope.ctx.info.path.as_str();
    let entries = match file {
        Some(file) => {
            note_below_root(scope, file)?;
            let spelled = registered_spelling(scope, file)?;
            crate::task::get_file_tasks(&spelled.to_string_lossy(), Some(root), exclude)
                .await
                .map_err(|error| {
                    log::warn!("[plugin index] a task file read failed: {error}");
                    format!("\"{}\" could not be read", file.given)
                })?
        }
        None => crate::task::get_vault_tasks(root, exclude)
            .await
            .map_err(|error| walk_failure(&error))?,
    };
    rows::tasks(scope.form, root, entries, status)
}

/// Full-text search the way `baram search` searches (`search` in `cli/ops.rs`, or
/// `cli/ops_search.rs` once the MCP PR moved it): the query checked first by the same
/// `search::check_query`, `folder` MOVES the root (an `include_glob` folder is a string prefix
/// that also takes `docs-old/`), `max_results` is `limit + 1` so the cut shows, and the first
/// `limit` hits are sorted by (path, line) — stably, so two matches on one line stay in the
/// order they were found (spec D10).
pub(super) async fn search(
    scope: &Scope,
    query: &str,
    args: &SearchArgs,
    folder: Option<&PathArg>,
) -> Result<SearchRows, String> {
    let limit = args.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(format!(
            "\"limit\" must be between 1 and {MAX_LIMIT}, not {limit}"
        ));
    }
    let limit = limit as usize;
    let options = SearchOptions {
        case_sensitive: args.case_sensitive,
        whole_word: args.word,
        regex: args.regex,
        max_results: limit + 1,
        include_glob: None,
        exclude_glob: None,
    };
    // ‼️ No `_` arm: a fourth refusal must be worded here before the crate compiles.
    crate::search::check_query(query, &options).map_err(|refusal| match refusal {
        QueryRefusal::Empty => "\"query\" is empty".to_string(),
        QueryRefusal::InvalidRegex(error) => {
            format!("\"query\" is not a valid regular expression: {error}")
        }
        QueryRefusal::Unsearchable(error) => format!("\"query\" cannot be searched: {error}"),
    })?;
    let start = match folder {
        Some(folder) => folder_below_root(scope, folder)?,
        None => PathBuf::from(&scope.ctx.info.path),
    };
    let hits = crate::search::search_files(&start.to_string_lossy(), query, &options)
        .await
        .map_err(|error| walk_failure(&error))?;
    rows::search(scope.form, &scope.ctx.info.path, hits, limit)
}

/// A note argument, asked the three questions the CLI's `paths::note_arg` asks — does it
/// exist, is it a note (`fs::is_note_name`), does the vault walk go there
/// (`fs::is_skipped_relative`) — about a path already under the root, answered with this
/// API's messages (P12).
fn note_below_root(scope: &Scope, file: &PathArg) -> Result<(), String> {
    let relative = below_root(scope, file)?;
    match std::fs::metadata(&file.canonical) {
        Ok(meta) if meta.is_dir() => {
            return Err(format!("\"{}\" is a folder, not a note", file.given))
        }
        Ok(meta) if meta.is_file() => {}
        Ok(_) => return Err(format!("\"{}\" is not a note", file.given)),
        Err(_) => return Err(format!("no note at \"{}\"", file.given)),
    }
    let name = relative
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_default();
    if !crate::fs::is_note_name(&name) {
        return Err(format!("\"{}\" is not a note", file.given));
    }
    if crate::fs::is_skipped_relative(relative) {
        return Err(format!(
            "\"{}\" is where the vault walk does not go",
            file.given
        ));
    }
    Ok(())
}

/// A search folder, asked the three questions the CLI's `paths::folder_arg` asks — does it
/// exist, is it a folder, does the vault walk go there (`fs::is_skipped_relative`) — about a
/// path already under the root, answered with this API's messages and handed back in the
/// registered spelling.
fn folder_below_root(scope: &Scope, folder: &PathArg) -> Result<PathBuf, String> {
    let relative = below_root(scope, folder)?;
    match std::fs::metadata(&folder.canonical) {
        Ok(meta) if meta.is_dir() => {}
        Ok(_) => return Err(format!("\"{}\" is a file, not a folder", folder.given)),
        Err(_) => return Err(format!("no folder at \"{}\"", folder.given)),
    }
    if crate::fs::is_skipped_relative(relative) {
        return Err(format!(
            "\"{}\" is a folder the vault walk skips",
            folder.given
        ));
    }
    registered_spelling(scope, folder)
}

fn link_index_failure(error: &str) -> String {
    log::warn!("[plugin index] the link index could not be read: {error}");
    LINK_INDEX_FAILED.to_string()
}

fn walk_failure(error: &dyn std::fmt::Display) -> String {
    log::warn!("[plugin index] a vault walk failed: {error}");
    WALK_FAILED.to_string()
}
