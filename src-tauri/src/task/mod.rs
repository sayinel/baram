// §304 Vault-wide task index
mod parse;
mod write;

#[allow(dead_code)] // TODO(Task 3): consumed by the vault scanner
#[allow(unused_imports)] // TODO(Task 3): consumed by the vault scanner
pub use parse::{normalize_line, parse_task_line, ParsedTask, TaskState};

use serde::Serialize;
use thiserror::Error;

#[allow(dead_code)] // TODO(Task 5): consumed by write.rs
#[derive(Debug, Error)]
pub enum TaskError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("stale")]
    Stale,
    #[error("{0}")]
    Custom(String),
}

/// 한 줄의 태스크. `raw`는 §305 낙관적 잠금의 비교 기준이다.
#[allow(dead_code)] // TODO(Task 5): consumed by write.rs
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEntry {
    pub path: String,
    pub line: u32,
    pub indent: u8,
    pub state: TaskState,
    pub text: String,
    pub raw: String,
    pub created: Option<String>,
    pub start: Option<String>,
    pub scheduled: Option<String>,
    pub due: Option<String>,
    pub done: Option<String>,
    pub cancelled: Option<String>,
    pub priority: i8,
    pub recurrence: Option<String>,
    pub links: Vec<String>,
    pub tags: Vec<String>,
}
