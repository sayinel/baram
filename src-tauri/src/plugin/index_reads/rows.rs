//! §393 The rows a plugin reads (spec 0072 §4, D5): the plugin API's own structs, built from
//! the same inner results as the CLI's rows and named like them, except the backlink's line
//! text — `snippet`, because in this API `context` is a context id. Every path field is written
//! by `PathForm::write`, and an `Option` is serialized as `null`, never left out.
//! `TagRow`, `TaskRow`, `SearchRows` and `SearchMatch` have single-word fields and need no
//! `rename_all`; a multi-word field added to one of them later needs
//! `#[serde(rename_all = "camelCase")]` on its struct, as `BacklinkRow` and `LinkRow` have.

use super::PathForm;
use crate::index::{BacklinkResult, LinkEntry, LinkResolution};
use crate::search::SearchResult;
use crate::tag::TagEntry;
use crate::task::{TaskEntry, TaskStatus};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// A row path the walk or the index gave that is not under the root the read used. Not
/// expected — both write under that root — and refused rather than written, because the
/// sandboxed tier must never be handed an absolute path.
const OUTSIDE_THE_ROOT: &str = "the vault answered with a path outside it";

/// Where a row path comes from.
pub(super) enum RowPath<'a> {
    /// An absolute path under the root spelling the read used.
    Absolute(&'a str),
    /// A path relative to that root, with the OS separator (`tag::get_files_by_tag`).
    UnderRoot(&'a str),
}

impl PathForm {
    /// `path` as this tier writes it (spec D6): `/`-relative to `root`, or absolute in `root`'s
    /// spelling. The one place a row path is written. ‼️ No `_` arm in either `match`.
    pub(super) fn write(self, root: &str, path: RowPath<'_>) -> Result<String, String> {
        let relative: PathBuf = match path {
            RowPath::Absolute(path) => Path::new(path)
                .strip_prefix(root)
                .map_err(|_| {
                    log::warn!("[plugin index] {path} is not under {root}");
                    OUTSIDE_THE_ROOT.to_string()
                })?
                .to_path_buf(),
            RowPath::UnderRoot(relative) => PathBuf::from(relative),
        };
        Ok(match self {
            PathForm::Absolute => Path::new(root)
                .join(&relative)
                .to_string_lossy()
                .into_owned(),
            PathForm::Relative => relative
                .components()
                .map(|component| component.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/"),
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BacklinkRow {
    block_id: Option<String>,
    line: u32,
    /// The note that holds the link.
    path: String,
    /// The line the link is on, trimmed and cut at 200 bytes with `…` (`index::extractor::build_context`).
    snippet: String,
    #[serde(rename = "type")]
    kind: &'static str,
}

/// The backlink rows, in (path, line) order whatever order the index filed them in.
pub(super) fn backlinks(
    form: PathForm,
    root: &str,
    found: Vec<BacklinkResult>,
) -> Result<Vec<BacklinkRow>, String> {
    let mut rows = Vec::with_capacity(found.len());
    for backlink in found {
        rows.push(BacklinkRow {
            block_id: backlink.block_id,
            line: backlink.line,
            path: form.write(root, RowPath::Absolute(&backlink.source_path))?,
            snippet: backlink.context,
            kind: backlink.link_type.wire_name(),
        });
    }
    rows.sort_by(|a, b| (a.path.as_str(), a.line).cmp(&(b.path.as_str(), b.line)));
    Ok(rows)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LinkRow {
    block_id: Option<String>,
    line: u32,
    /// Set when `resolution` is `resolved`: the file the link leads to — a non-note too (§278).
    path: Option<String>,
    /// `resolved` · `unresolved` · `otherVault`.
    resolution: &'static str,
    /// The name inside the brackets, without alias, heading or display text.
    target: String,
    #[serde(rename = "type")]
    kind: &'static str,
    /// Set when `resolution` is `otherVault`: the vault alias the link names.
    vault: Option<String>,
}

/// The link rows, in line order; links on one line in the order the index holds them (the
/// sort is stable).
pub(super) fn links(
    form: PathForm,
    root: &str,
    outgoing: Vec<(LinkEntry, LinkResolution)>,
) -> Result<Vec<LinkRow>, String> {
    let mut rows = Vec::with_capacity(outgoing.len());
    for (entry, resolution) in outgoing {
        // ‼️ No `_` arm (P14): a fourth resolution must say what a plugin is told.
        let (resolution, path, vault) = match resolution {
            LinkResolution::Resolved(target) => (
                "resolved",
                Some(form.write(root, RowPath::Absolute(&target))?),
                None,
            ),
            LinkResolution::OtherVault(alias) => ("otherVault", None, Some(alias)),
            LinkResolution::Unresolved => ("unresolved", None, None),
        };
        rows.push(LinkRow {
            block_id: entry.block_id,
            line: entry.line,
            path,
            resolution,
            target: entry.target,
            kind: entry.link_type.wire_name(),
            vault,
        });
    }
    rows.sort_by_key(|row| row.line);
    Ok(rows)
}

#[derive(Debug, Serialize)]
pub(super) struct TagRow {
    /// Occurrences across the context, not the number of notes.
    count: u32,
    tag: String,
}

pub(super) fn tags(entries: Vec<TagEntry>) -> Vec<TagRow> {
    entries
        .into_iter()
        .map(|entry| TagRow {
            count: entry.count,
            tag: entry.tag,
        })
        .collect()
}

/// The notes carrying a tag: `get_files_by_tag` gives root-relative paths with the OS
/// separator in walk order; here they are in the tier's form, in path order.
pub(super) fn tag_notes(
    form: PathForm,
    root: &str,
    found: &[String],
) -> Result<Vec<String>, String> {
    let mut paths = found
        .iter()
        .map(|relative| form.write(root, RowPath::UnderRoot(relative)))
        .collect::<Result<Vec<_>, _>>()?;
    paths.sort();
    Ok(paths)
}

/// One task — the fields of the CLI's `TaskRow`; `indent`, `raw` and `timer` are internal.
#[derive(Debug, Serialize)]
pub(super) struct TaskRow {
    cancelled: Option<String>,
    created: Option<String>,
    done: Option<String>,
    due: Option<String>,
    /// From 1, through front matter; the task index counts from 0.
    line: u32,
    links: Vec<String>,
    path: String,
    priority: i8,
    recurrence: Option<String>,
    scheduled: Option<String>,
    start: Option<String>,
    state: &'static str,
    tags: Vec<String>,
    text: String,
}

/// The tasks `status` admits, in (path, line) order whatever order the walk gave them.
pub(super) fn tasks(
    form: PathForm,
    root: &str,
    entries: Vec<TaskEntry>,
    status: TaskStatus,
) -> Result<Vec<TaskRow>, String> {
    let mut rows = Vec::new();
    for entry in entries {
        if !status.admits(entry.state) {
            continue;
        }
        rows.push(TaskRow {
            cancelled: entry.cancelled,
            created: entry.created,
            done: entry.done,
            due: entry.due,
            line: entry.line.saturating_add(1),
            links: entry.links,
            path: form.write(root, RowPath::Absolute(&entry.path))?,
            priority: entry.priority,
            recurrence: entry.recurrence,
            scheduled: entry.scheduled,
            start: entry.start,
            state: entry.state.wire_name(),
            tags: entry.tags,
            text: entry.text,
        });
    }
    rows.sort_by(|a, b| (a.path.as_str(), a.line).cmp(&(b.path.as_str(), b.line)));
    Ok(rows)
}

#[derive(Debug, Serialize)]
pub(super) struct SearchRows {
    items: Vec<SearchMatch>,
    /// More matches were found than `limit`.
    truncated: bool,
}

#[derive(Debug, Serialize)]
pub(super) struct SearchMatch {
    line: usize,
    path: String,
    /// The line around the match (`search::build_snippet`).
    snippet: String,
}

/// The first `limit` of `hits`, in (path, line) order — stably, so two matches on one line
/// keep the order the search found them in — and whether `hits` held more.
pub(super) fn search(
    form: PathForm,
    root: &str,
    hits: Vec<SearchResult>,
    limit: usize,
) -> Result<SearchRows, String> {
    let truncated = hits.len() > limit;
    let mut items = Vec::with_capacity(limit.min(hits.len()));
    for hit in hits.into_iter().take(limit) {
        items.push(SearchMatch {
            line: hit.line,
            path: form.write(root, RowPath::Absolute(&hit.file_path))?,
            snippet: hit.snippet,
        });
    }
    items.sort_by(|a, b| (a.path.as_str(), a.line).cmp(&(b.path.as_str(), b.line)));
    Ok(SearchRows { items, truncated })
}
