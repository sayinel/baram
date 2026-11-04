//! §393 Which tasks a read asks for: `baram tasks --status` and a plugin's
//! `IndexTaskOptions.status` (spec 0072 §5.1). One enum and one filter, so the CLI and the
//! plugin API cannot answer the same word differently.

use super::TaskState;
use clap::ValueEnum;
use serde::Deserialize;

/// The words are the same on both inputs: clap's `ValueEnum` writes a variant in kebab-case
/// and serde here in lowercase, which agree because every variant is one word — the test
/// `the_cli_and_the_wire_name_each_status_alike` holds the two together. No doc comments on the
/// variants: `ValueEnum` would print them in `baram tasks --help`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Open,
    Done,
    Cancelled,
    All,
}

impl TaskStatus {
    /// Whether a task in `state` is one this status asks for. `Open` is todo and doing.
    /// ‼️ No `_` arm in either `match`: a fifth status, or a fifth task state, must say here
    /// which tasks it takes before the crate compiles.
    pub fn admits(self, state: TaskState) -> bool {
        let open = match state {
            TaskState::Todo | TaskState::Doing => true,
            TaskState::Done | TaskState::Cancelled => false,
        };
        match self {
            TaskStatus::Open => open,
            TaskStatus::Done => state == TaskState::Done,
            TaskStatus::Cancelled => state == TaskState::Cancelled,
            TaskStatus::All => true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::ValueEnum;

    /// Moved here with the filter from `cli/ops_notes.rs` (`wanted`). What fails this: a status
    /// that takes a state it should not — `open` taking `done` was the case the CLI pinned.
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
                    status.admits(state),
                    states.contains(&state),
                    "{status:?} {state:?}"
                );
            }
        }
    }

    /// `baram tasks --status` (clap) and a plugin's `status` (serde) take the same four words.
    /// What fails this: renaming a variant's word on one input only. The pair: a word neither
    /// takes is refused.
    #[test]
    fn the_cli_and_the_wire_name_each_status_alike() {
        for status in TaskStatus::value_variants() {
            let name = status.to_possible_value().unwrap().get_name().to_string();
            let wire: TaskStatus = serde_json::from_value(serde_json::json!(name)).unwrap();
            assert_eq!(wire, *status, "{name}");
        }
        assert_eq!(TaskStatus::value_variants().len(), 4);
        assert!(serde_json::from_value::<TaskStatus>(serde_json::json!("later")).is_err());
    }
}
