// §387 The commands that read what notes SAY — tags, tasks, and (Task 7) links. Split
// from `ops.rs` by size; the contract is the same: return the envelope, write nothing.

use super::args::TaskStatus;
use super::error::{CliError, ErrorCode};
use super::ops::{sort_by_path_and_line, vault_info, walk_failure, PathRow};
use super::output::{Envelope, Row};
use super::vault::{self, Vault};
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
            path: vault::slashed(Path::new(relative)),
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
            let path = vault::note_arg(vault, file)?;
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
            path: vault::relative(vault, Path::new(&entry.path)),
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
}
