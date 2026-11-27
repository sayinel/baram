// §71 File Snapshots / Version History — 스냅샷 모듈

pub mod diff;
pub mod merge;
pub mod index;
pub mod io;
pub mod policy;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum SnapshotError {
    #[error("스냅샷을 찾을 수 없습니다: {0}")]
    NotFound(String),
    #[error("파일 I/O 오류: {0}")]
    IoError(#[from] std::io::Error),
    #[error("JSON 직렬화 오류: {0}")]
    JsonError(#[from] serde_json::Error),
    #[error("스냅샷 오류: {0}")]
    General(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotEntry {
    pub id: String,
    pub timestamp: String, // ISO 8601
    #[serde(rename = "type")]
    pub snapshot_type: String, // "auto" | "manual"
    pub label: Option<String>,
    pub files: Vec<SnapshotFileEntry>,
    #[serde(rename = "totalSizeBytes")]
    pub total_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotFileEntry {
    pub path: String,
    pub checksum: String,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotIndex {
    pub version: u32,
    pub snapshots: Vec<SnapshotEntry>,
    #[serde(rename = "totalSizeBytes")]
    pub total_size_bytes: u64,
    #[serde(rename = "oldestSnapshot")]
    pub oldest_snapshot: Option<String>,
    #[serde(rename = "newestSnapshot")]
    pub newest_snapshot: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffResult {
    pub hunks: Vec<DiffHunk>,
    pub stats: DiffStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffHunk {
    #[serde(rename = "oldStart")]
    pub old_start: usize,
    #[serde(rename = "oldCount")]
    pub old_count: usize,
    #[serde(rename = "newStart")]
    pub new_start: usize,
    #[serde(rename = "newCount")]
    pub new_count: usize,
    pub changes: Vec<DiffChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffChange {
    #[serde(rename = "type")]
    pub change_type: String, // "equal" | "delete" | "insert"
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffStats {
    pub additions: usize,
    pub deletions: usize,
    pub unchanged: usize,
}

/// §3.6 3-way merge result — a sequence of stable (auto-merged) and conflict
/// (overlapping edits) segments.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    /// Lines without their line endings. A final newline is not a line (`final_newline`).
    pub segments: Vec<MergeSegment>,
    /// What the merge view joins the chosen lines with (`line_ending_of` in merge.rs).
    pub line_ending: LineEnding,
    /// Whether the merge view ends the text with `line_ending` once more: the external side's
    /// final newline or none when it changed it from the base's, the local side's otherwise.
    pub final_newline: bool,
}

/// A line ending, serialized as its characters.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LineEnding {
    #[serde(rename = "\n")]
    Lf,
    #[serde(rename = "\r\n")]
    Crlf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum MergeSegment {
    /// Unchanged in both sides (context).
    Unchanged { lines: Vec<String> },
    /// Only the local side changed (auto-applied; shown as a diff).
    Local {
        base: Vec<String>,
        local: Vec<String>,
    },
    /// Only the external side changed (auto-applied; shown as a diff).
    External {
        base: Vec<String>,
        external: Vec<String>,
    },
    /// Both sides changed the same region differently (needs resolution).
    Conflict {
        base: Vec<String>,
        local: Vec<String>,
        external: Vec<String>,
    },
}
