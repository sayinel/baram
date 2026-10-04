// §387 The commands that read what notes SAY — tags, tag, tasks, backlinks and links.
// Split from `ops.rs` by size; the contract is the same: return the envelope, write
// nothing.

use super::args::TaskStatus;
use super::error::{CliError, ErrorCode};
use super::ops::{index_failure, sort_by_path_and_line, vault_info, walk_failure, PathRow};
use super::output::{Envelope, Row};
use super::paths;
use super::vault::Vault;
use crate::index::{BacklinkResult, LinkEntry, LinkIndex, LinkKind, LinkResolution};
use crate::task::{TaskEntry, TaskError, TaskState};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
pub(crate) struct TagRow {
    pub tag: String,
    /// Occurrences across the vault, not the number of files.
    pub count: u32,
}

impl Row for TagRow {
    fn fields(&self) -> Vec<String> {
        vec![self.tag.clone(), self.count.to_string()]
    }
}

/// `baram tags` — in the order `get_vault_tags` already sorts: count descending, then name.
pub(crate) async fn tags(vault: &Vault) -> Result<Envelope<TagRow>, CliError> {
    let entries = match crate::tag::get_vault_tags(&vault.root.to_string_lossy()).await {
        Ok(entries) => entries,
        Err(_) => return Err(walk_failure(vault, &vault.root).await),
    };
    Ok(Envelope {
        vault: Some(vault_info(vault)),
        truncated: false,
        items: entries
            .into_iter()
            .map(|entry| TagRow {
                tag: entry.tag,
                count: entry.count,
            })
            .collect(),
    })
}

/// `baram tag <name>` — the files that carry the tag. A leading `#` is dropped: tags are
/// stored without it, so `#work` as typed would match nothing.
pub(crate) async fn tag(vault: &Vault, name: &str) -> Result<Envelope<PathRow>, CliError> {
    let name = name.trim_start_matches('#');
    if name.is_empty() {
        return Err(CliError::new(
            ErrorCode::InvalidArgument,
            "the tag name is empty",
        ));
    }
    let found = match crate::tag::get_files_by_tag(&vault.root.to_string_lossy(), name).await {
        Ok(found) => found,
        Err(_) => return Err(walk_failure(vault, &vault.root).await),
    };
    Ok(Envelope {
        vault: Some(vault_info(vault)),
        truncated: false,
        items: tag_rows(&found),
    })
}

/// The rows `tag` prints: `get_files_by_tag` hands back root-relative paths with the OS
/// separator, in the order the walk met the files; here they are `/`-separated and in
/// path order.
fn tag_rows(found: &[String]) -> Vec<PathRow> {
    let mut items: Vec<PathRow> = found
        .iter()
        .map(|relative| PathRow {
            path: paths::slashed(Path::new(relative)),
        })
        .collect();
    sort_by_path_and_line(&mut items, |row| (row.path.as_str(), 0));
    items
}

/// One task as the CLI reports it. A deliberate subset of the app's `TaskEntry`
/// (spec 0066 D5): `indent`, `raw` (the optimistic-lock baseline) and `timer` (a raw
/// value the frontend interprets) are internal and stay out.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskRow {
    pub path: String,
    /// 1-based, like every line number the CLI prints. The index underneath is 0-based.
    pub line: u32,
    pub state: &'static str,
    pub text: String,
    pub priority: i8,
    pub created: Option<String>,
    pub start: Option<String>,
    pub scheduled: Option<String>,
    pub due: Option<String>,
    pub done: Option<String>,
    pub cancelled: Option<String>,
    pub recurrence: Option<String>,
    pub tags: Vec<String>,
    pub links: Vec<String>,
}

impl Row for TaskRow {
    fn fields(&self) -> Vec<String> {
        vec![
            self.path.clone(),
            self.line.to_string(),
            self.state.to_string(),
            self.text.clone(),
        ]
    }
}

/// No `_` arm: a fifth task state must be named here before the crate compiles.
fn state_name(state: TaskState) -> &'static str {
    match state {
        TaskState::Todo => "todo",
        TaskState::Doing => "doing",
        TaskState::Done => "done",
        TaskState::Cancelled => "cancelled",
    }
}

fn wanted(status: TaskStatus, state: TaskState) -> bool {
    match status {
        TaskStatus::All => true,
        TaskStatus::Open => matches!(state, TaskState::Todo | TaskState::Doing),
        TaskStatus::Done => state == TaskState::Done,
        TaskStatus::Cancelled => state == TaskState::Cancelled,
    }
}

/// `baram tasks` — the tasks of the resolved vault, minus the folders the app excludes.
/// The app's own panel may show more or less: its scope setting decides which roots it
/// scans (spec 0066 §3.5).
pub(crate) async fn tasks(
    vault: &Vault,
    exclude: &[String],
    status: TaskStatus,
    file: Option<&str>,
) -> Result<Envelope<TaskRow>, CliError> {
    let root = vault.root.to_string_lossy();
    let entries = match file {
        Some(file) => {
            let path = paths::note_arg(vault, file)?;
            crate::task::get_file_tasks(&path.to_string_lossy(), Some(&root), exclude)
                .await
                .map_err(|error| match error {
                    TaskError::Io(source) => unreadable(file, &source),
                    TaskError::Stale | TaskError::Custom(_) => {
                        CliError::new(ErrorCode::Io, format!("cannot read {file}"))
                    }
                })?
        }
        None => match crate::task::get_vault_tasks(&root, exclude).await {
            Ok(entries) => entries,
            Err(_) => return Err(walk_failure(vault, &vault.root).await),
        },
    };
    Ok(Envelope {
        vault: Some(vault_info(vault)),
        truncated: false,
        items: task_rows(vault, entries, status),
    })
}

/// The rows `tasks` prints: the entries `status` wants, each path relative to the vault
/// and each line counted from 1, in (path, line) order whatever order the walk gave them.
fn task_rows(vault: &Vault, entries: Vec<TaskEntry>, status: TaskStatus) -> Vec<TaskRow> {
    let mut items: Vec<TaskRow> = entries
        .into_iter()
        .filter(|entry| wanted(status, entry.state))
        .map(|entry| TaskRow {
            path: paths::relative(vault, Path::new(&entry.path)),
            line: entry.line + 1,
            state: state_name(entry.state),
            text: entry.text,
            priority: entry.priority,
            created: entry.created,
            start: entry.start,
            scheduled: entry.scheduled,
            due: entry.due,
            done: entry.done,
            cancelled: entry.cancelled,
            recurrence: entry.recurrence,
            tags: entry.tags,
            links: entry.links,
        })
        .collect();
    sort_by_path_and_line(&mut items, |row| (row.path.as_str(), u64::from(row.line)));
    items
}

/// The OS's reason, in English; `TaskError`'s own Display is not used.
fn unreadable(file: &str, source: &std::io::Error) -> CliError {
    CliError::new(ErrorCode::Io, format!("cannot read {file}: {source}"))
}

/// No `_` arm: a fourth link grammar must be named here before the crate compiles —
/// the same way `LinkKind::pass` holds the rename passes to the list.
fn kind_name(kind: LinkKind) -> &'static str {
    match kind {
        LinkKind::Wikilink => "wikilink",
        LinkKind::BlockRef => "blockRef",
        LinkKind::BlockEmbed => "blockEmbed",
    }
}

/// The link index, built for this one call. ONE spelling of the root goes in — the
/// canonical one — because `outgoing` is keyed by the paths the build walked.
async fn build_index(vault: &Vault) -> Result<LinkIndex, CliError> {
    let mut index = LinkIndex::new();
    if index.build(&vault.root.to_string_lossy()).await.is_err() {
        return Err(index_failure(vault).await);
    }
    Ok(index)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BacklinkRow {
    /// The note that holds the link.
    pub path: String,
    pub line: u32,
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub context: String,
    pub block_id: Option<String>,
}

impl Row for BacklinkRow {
    fn fields(&self) -> Vec<String> {
        vec![
            self.path.clone(),
            self.line.to_string(),
            self.kind.to_string(),
            self.context.clone(),
        ]
    }
}

/// `baram backlinks <path>` — what the app's backlinks panel shows for the note, from the
/// one index built over this vault. The panel asks every registered directory context
/// whose root contains the file (`get_backlinks_inner` in `index/service/query.rs`) and
/// merges the answers, so with nested registered roots it can list more.
///
/// By STEM, as the index files them: `[[a]]` anywhere counts for every `a.md`, a link
/// into another vault (`[[journal::a]]`) counts too, and a path-qualified `[[notes/a]]`
/// does not. Two links on one line of one note are reported once. The note need not
/// exist — links to a note not written yet are a fair question — but a directory is
/// refused: `get_backlinks` keys on the last path component, so a folder would be asked
/// about as a note named like it.
pub(crate) async fn backlinks(
    vault: &Vault,
    path: &str,
) -> Result<Envelope<BacklinkRow>, CliError> {
    let target = paths::locate(vault, path)?;
    // Only a directory is refused. Any other metadata error passes, as a missing file
    // does: nothing here reads the file.
    if std::fs::metadata(&target).is_ok_and(|meta| meta.is_dir()) {
        return Err(CliError::new(
            ErrorCode::FileNotFound,
            format!("no file at {path}"),
        ));
    }
    let index = build_index(vault).await?;
    Ok(Envelope {
        vault: Some(vault_info(vault)),
        truncated: false,
        items: backlink_rows(vault, index.get_backlinks(&target.to_string_lossy())),
    })
}

/// The rows `backlinks` prints: each source path relative to the vault, in (path, line)
/// order whatever order the index filed them in.
fn backlink_rows(vault: &Vault, found: Vec<BacklinkResult>) -> Vec<BacklinkRow> {
    let mut items: Vec<BacklinkRow> = found
        .into_iter()
        .map(|backlink| BacklinkRow {
            path: paths::relative(vault, Path::new(&backlink.source_path)),
            line: backlink.line,
            kind: kind_name(backlink.link_type),
            context: backlink.context,
            block_id: backlink.block_id,
        })
        .collect();
    sort_by_path_and_line(&mut items, |row| (row.path.as_str(), u64::from(row.line)));
    items
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkRow {
    pub line: u32,
    #[serde(rename = "type")]
    pub kind: &'static str,
    /// The target the index files: the name inside the brackets, trimmed, without alias,
    /// heading or display text. A self-reference `((#^id))` writes none, so it holds the
    /// note's own file stem.
    pub target: String,
    pub block_id: Option<String>,
    /// `resolved` · `unresolved` · `otherVault`.
    pub resolution: &'static str,
    /// The file the link resolves to — set when `resolution` is `resolved`.
    pub path: Option<String>,
    /// The vault alias the link names — set when `resolution` is `otherVault`.
    pub vault: Option<String>,
}

impl Row for LinkRow {
    fn fields(&self) -> Vec<String> {
        vec![
            self.line.to_string(),
            self.kind.to_string(),
            self.target.clone(),
            self.resolution.to_string(),
            self.path
                .clone()
                .or_else(|| self.vault.clone())
                .unwrap_or_default(),
        ]
    }
}

/// `baram links <path>` — the links a note holds, each resolved by the graph's resolver
/// except a cross-vault link, which is reported by its alias. The graph's own edges
/// (`get_link_graph`) run a cross-vault link to the local note of that name, and an
/// unresolved one to a placeholder path.
pub(crate) async fn links(vault: &Vault, path: &str) -> Result<Envelope<LinkRow>, CliError> {
    let file = paths::note_arg(vault, path)?;
    let index = build_index(vault).await?;
    let Some(outgoing) = index.outgoing_resolved(&file.to_string_lossy()) else {
        // `note_arg` has refused what the index never holds — a file that is no note, and
        // a note where the walk does not go — and `build` files every markdown file it
        // can read under `outgoing`. What is left is a note the build could not read.
        return Err(CliError::new(
            ErrorCode::Io,
            format!("{path} could not be read or is not UTF-8, so it is not in the link index"),
        ));
    };
    Ok(Envelope {
        vault: Some(vault_info(vault)),
        truncated: false,
        items: link_rows(vault, outgoing),
    })
}

/// The rows `links` prints: in line order, and links on one line in the order the index
/// holds them (the sort is stable). The index files a line's wikilinks first, then its
/// embeds, then its block references, so that is not always the order they are written
/// in.
fn link_rows(vault: &Vault, outgoing: Vec<(LinkEntry, LinkResolution)>) -> Vec<LinkRow> {
    let mut items: Vec<LinkRow> = outgoing
        .into_iter()
        .map(|(entry, resolution)| {
            let (resolution, resolved, other_vault) = match resolution {
                LinkResolution::Resolved(target) => (
                    "resolved",
                    Some(paths::relative(vault, Path::new(&target))),
                    None,
                ),
                LinkResolution::OtherVault(alias) => ("otherVault", None, Some(alias)),
                LinkResolution::Unresolved => ("unresolved", None, None),
            };
            LinkRow {
                line: entry.line,
                kind: kind_name(entry.link_type),
                target: entry.target,
                block_id: entry.block_id,
                resolution,
                path: resolved,
                vault: other_vault,
            }
        })
        .collect();
    items.sort_by_key(|row| row.line);
    items
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn vault_in(dir: &TempDir) -> Vault {
        Vault {
            name: "v".into(),
            root: dir.path().canonicalize().unwrap(),
        }
    }

    /// The reported line is the line an editor shows — counted from 1, through the
    /// front matter.
    #[tokio::test]
    async fn a_task_s_line_is_the_one_an_editor_shows() {
        let dir = TempDir::new().unwrap();
        let vault = vault_in(&dir);
        let body = "---\ntags: [a]\n---\n# Title\n\n- [ ] the task\n";
        std::fs::write(vault.root.join("n.md"), body).unwrap();
        let expected = body
            .lines()
            .position(|line| line == "- [ ] the task")
            .unwrap() as u32
            + 1;
        assert_eq!(expected, 6);

        let envelope = tasks(&vault, &[], TaskStatus::All, None).await.unwrap();
        assert_eq!(envelope.items.len(), 1);
        assert_eq!(envelope.items[0].line, expected);
        assert_eq!(envelope.items[0].path, "n.md");
    }

    #[test]
    fn open_means_todo_and_doing() {
        for (status, states) in [
            (TaskStatus::Open, &[TaskState::Todo, TaskState::Doing][..]),
            (TaskStatus::Done, &[TaskState::Done][..]),
            (TaskStatus::Cancelled, &[TaskState::Cancelled][..]),
            (
                TaskStatus::All,
                &[
                    TaskState::Todo,
                    TaskState::Doing,
                    TaskState::Done,
                    TaskState::Cancelled,
                ][..],
            ),
        ] {
            for state in [
                TaskState::Todo,
                TaskState::Doing,
                TaskState::Done,
                TaskState::Cancelled,
            ] {
                assert_eq!(
                    wanted(status, state),
                    states.contains(&state),
                    "{status:?} {state:?}"
                );
            }
        }
    }

    fn plain_vault() -> Vault {
        Vault {
            name: "v".into(),
            root: PathBuf::from("/vault"),
        }
    }

    /// Fed in an order other than the sorted one, so deleting the sort changes the result.
    /// The expected order is the byte order of the printed strings: `a/y.md` before
    /// `a0/x.md` (`/` is 0x2F, `0` is 0x30), `b.md` before the two `docs` folders (`b` is
    /// 0x62, `d` is 0x64), and `docs-old/` before `docs/` (`-` is 0x2D, `/` is 0x2F).
    #[test]
    fn tag_files_come_out_by_path_whatever_order_the_walk_gave() {
        let found: Vec<String> = ["b.md", "a0/x.md", "docs/g.md", "docs-old/a.md", "a/y.md"]
            .map(String::from)
            .into();
        let paths: Vec<String> = tag_rows(&found).into_iter().map(|row| row.path).collect();
        assert_eq!(
            paths,
            ["a/y.md", "a0/x.md", "b.md", "docs-old/a.md", "docs/g.md"]
        );
    }

    fn entry(path: &str, line: u32, state: TaskState) -> TaskEntry {
        TaskEntry {
            path: format!("/vault/{path}"),
            line,
            indent: 0,
            state,
            text: format!("{path}:{line}"),
            raw: String::new(),
            created: None,
            start: None,
            scheduled: None,
            due: None,
            done: None,
            cancelled: None,
            priority: 0,
            recurrence: None,
            timer: None,
            links: Vec::new(),
            tags: Vec::new(),
        }
    }

    fn located(rows: &[TaskRow]) -> Vec<(&str, u32)> {
        rows.iter()
            .map(|row| (row.path.as_str(), row.line))
            .collect()
    }

    /// The entries come in an order other than the sorted one: `b.md` before `a0/` before
    /// `a/`, and within `b.md` the 0-based line 9 before line 1. The expected order is the
    /// byte order of the path (`a/y.md` before `a0/x.md`: `/` is 0x2F, `0` is 0x30) and
    /// then the line as a number (the printed `10` after `2`, which text order would
    /// not give); the lines are the 0-based ones plus 1.
    #[test]
    fn tasks_come_out_by_path_then_line_whatever_order_the_walk_gave() {
        let entries = vec![
            entry("b.md", 9, TaskState::Todo),
            entry("b.md", 1, TaskState::Todo),
            entry("a0/x.md", 0, TaskState::Todo),
            entry("a/y.md", 2, TaskState::Todo),
        ];
        let rows = task_rows(&plain_vault(), entries, TaskStatus::All);
        assert_eq!(
            located(&rows),
            [("a/y.md", 3), ("a0/x.md", 1), ("b.md", 2), ("b.md", 10)]
        );
        assert_eq!(rows[0].text, "a/y.md:2", "the row is the entry's, moved");
    }

    #[test]
    fn the_status_keeps_only_the_tasks_it_names() {
        let entries = || {
            vec![
                entry("a.md", 0, TaskState::Todo),
                entry("a.md", 1, TaskState::Done),
                entry("a.md", 2, TaskState::Doing),
                entry("a.md", 3, TaskState::Cancelled),
            ]
        };
        for (status, lines) in [
            (TaskStatus::Open, vec![1, 3]),
            (TaskStatus::Done, vec![2]),
            (TaskStatus::Cancelled, vec![4]),
            (TaskStatus::All, vec![1, 2, 3, 4]),
        ] {
            let rows = task_rows(&plain_vault(), entries(), status);
            let got: Vec<u32> = rows.iter().map(|row| row.line).collect();
            assert_eq!(got, lines, "{status:?}");
        }
    }

    /// Every field of the entry holds a value no other field holds, so a row that took one
    /// from the wrong field does not equal this. `indent`, `raw` and `timer` are set too:
    /// the row has no place for them, and the object below has exactly the row's fields.
    #[test]
    fn a_task_row_carries_each_field_of_the_entry_under_its_own_name() {
        let entries = vec![TaskEntry {
            path: "/vault/notes/n.md".to_string(),
            line: 4,
            indent: 2,
            state: TaskState::Doing,
            text: "the text".to_string(),
            raw: "  - [/] the raw line".to_string(),
            created: Some("2026-01-01".to_string()),
            start: Some("2026-01-02".to_string()),
            scheduled: Some("2026-01-03".to_string()),
            due: Some("2026-01-04".to_string()),
            done: Some("2026-01-05".to_string()),
            cancelled: Some("2026-01-06".to_string()),
            priority: 3,
            recurrence: Some("every week".to_string()),
            timer: Some("25m".to_string()),
            links: vec!["link-one".to_string(), "link-two".to_string()],
            tags: vec!["tag-one".to_string()],
        }];
        let rows = task_rows(&plain_vault(), entries, TaskStatus::All);
        assert_eq!(rows.len(), 1);
        assert_eq!(
            serde_json::to_value(&rows[0]).unwrap(),
            serde_json::json!({
                "path": "notes/n.md",
                "line": 5,
                "state": "doing",
                "text": "the text",
                "priority": 3,
                "created": "2026-01-01",
                "start": "2026-01-02",
                "scheduled": "2026-01-03",
                "due": "2026-01-04",
                "done": "2026-01-05",
                "cancelled": "2026-01-06",
                "recurrence": "every week",
                "tags": ["tag-one"],
                "links": ["link-one", "link-two"]
            })
        );
    }

    fn backlink(source: &str, line: u32) -> BacklinkResult {
        BacklinkResult {
            source_path: format!("/vault/{source}"),
            target_path: "/vault/target.md".to_string(),
            context: format!("{source}:{line}"),
            line,
            link_type: LinkKind::Wikilink,
            block_id: None,
        }
    }

    /// Fed in an order other than the sorted one, so deleting the sort changes the result.
    /// The expected order is the byte order of the path (`a/y.md` before `a0/x.md`: `/` is
    /// 0x2F, `0` is 0x30) and then the line as a number (the printed `10` after `2`, which
    /// text order would not give).
    #[test]
    fn backlinks_come_out_by_path_then_line_whatever_order_the_index_gave() {
        let found = vec![
            backlink("b.md", 10),
            backlink("a0/x.md", 1),
            backlink("b.md", 2),
            backlink("a/y.md", 7),
            backlink("b.md", 1),
        ];
        let rows = backlink_rows(&plain_vault(), found);
        let order: Vec<(&str, u32)> = rows
            .iter()
            .map(|row| (row.path.as_str(), row.line))
            .collect();
        assert_eq!(
            order,
            [
                ("a/y.md", 7),
                ("a0/x.md", 1),
                ("b.md", 1),
                ("b.md", 2),
                ("b.md", 10)
            ]
        );
        assert_eq!(
            rows[0].context, "a/y.md:7",
            "the row is the backlink's, moved"
        );
    }

    fn link(target: &str, line: u32) -> (LinkEntry, LinkResolution) {
        (
            LinkEntry {
                source_path: "/vault/n.md".to_string(),
                target: target.to_string(),
                line,
                context: String::new(),
                link_type: LinkKind::Wikilink,
                block_id: None,
                target_vault_alias: None,
            },
            LinkResolution::Unresolved,
        )
    }

    /// Fed in an order other than the sorted one, with three links on line 3. The targets
    /// are not in line order (`u` is last by line and first by name), and the three on
    /// line 3 are neither in name order nor in its reverse (`w3` `w1` `w2`): a sort by
    /// anything but the line, `(line, target)` included, gives another result, and they
    /// come out in the order they went in.
    #[test]
    fn links_come_out_by_line_and_keep_the_index_order_within_a_line() {
        let outgoing = vec![
            link("w3", 3),
            link("y", 1),
            link("w1", 3),
            link("x", 2),
            link("u", 10),
            link("w2", 3),
        ];
        let order: Vec<(u32, String)> = link_rows(&plain_vault(), outgoing)
            .into_iter()
            .map(|row| (row.line, row.target))
            .collect();
        assert_eq!(
            order,
            [
                (1, "y"),
                (2, "x"),
                (3, "w3"),
                (3, "w1"),
                (3, "w2"),
                (10, "u")
            ]
            .map(|(line, target)| (line, target.to_string()))
        );
    }

    /// Forty links over five lines, in an order that mixes the lines — long enough to tell
    /// a stable sort from `sort_unstable_by_key`, which the six links above cannot (that
    /// mutation passes them). The names run against the input order (`t39` is first in),
    /// so a sort by `(line, target)` gives another result too. The expected order is the
    /// sort of `(line, position in the input)`, a key with no ties.
    #[test]
    fn links_on_one_line_keep_the_index_order_in_a_long_list() {
        let given: Vec<(u32, usize)> = (0..40).map(|i| ((i * 7 % 5 + 1) as u32, i)).collect();
        let outgoing = given
            .iter()
            .map(|(line, position)| link(&format!("t{:02}", 39 - position), *line))
            .collect();
        let got: Vec<String> = link_rows(&plain_vault(), outgoing)
            .into_iter()
            .map(|row| row.target)
            .collect();
        let mut expected = given.clone();
        expected.sort();
        let expected: Vec<String> = expected
            .iter()
            .map(|(_, position)| format!("t{:02}", 39 - position))
            .collect();
        assert_eq!(got, expected);
    }

    /// One row per way a link can resolve, in line order so the sort has nothing to do:
    /// the path is relative to the vault, the alias comes from the resolution, the block
    /// ID and the kind from the entry.
    #[test]
    fn a_link_row_says_how_the_link_resolved() {
        let outgoing = vec![
            (
                link("beta", 3).0,
                LinkResolution::Resolved("/vault/notes/beta.md".to_string()),
            ),
            (
                LinkEntry {
                    block_id: Some("blk1".to_string()),
                    link_type: LinkKind::BlockRef,
                    ..link("alpha", 4).0
                },
                LinkResolution::Resolved("/vault/alpha.md".to_string()),
            ),
            (
                LinkEntry {
                    target_vault_alias: Some("journal".to_string()),
                    ..link("remote", 5).0
                },
                LinkResolution::OtherVault("journal".to_string()),
            ),
            link("gone", 6),
        ];
        assert_eq!(
            serde_json::to_value(link_rows(&plain_vault(), outgoing)).unwrap(),
            serde_json::json!([
                { "line": 3, "type": "wikilink", "target": "beta", "blockId": null,
                  "resolution": "resolved", "path": "notes/beta.md", "vault": null },
                { "line": 4, "type": "blockRef", "target": "alpha", "blockId": "blk1",
                  "resolution": "resolved", "path": "alpha.md", "vault": null },
                { "line": 5, "type": "wikilink", "target": "remote", "blockId": null,
                  "resolution": "otherVault", "path": null, "vault": "journal" },
                { "line": 6, "type": "wikilink", "target": "gone", "blockId": null,
                  "resolution": "unresolved", "path": null, "vault": null }
            ])
        );
    }

    /// The names are the ones the app serializes a link kind with — the strings the
    /// frontend has always read — for every kind the index files, `blockEmbed` included.
    #[test]
    fn a_link_kind_is_named_the_way_the_app_serializes_it() {
        for kind in LinkKind::ALL {
            assert_eq!(
                serde_json::to_value(kind).unwrap(),
                serde_json::json!(kind_name(*kind)),
                "{kind:?}"
            );
        }
    }
}
