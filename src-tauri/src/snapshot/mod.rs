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
pub struct MergeResult {
    pub segments: Vec<MergeSegment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum MergeSegment {
    Stable {
        lines: Vec<String>,
    },
    Conflict {
        local: Vec<String>,
        external: Vec<String>,
    },
}
