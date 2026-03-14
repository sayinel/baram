// §57b / §67 Git 타입 정의

use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct GitChange {
    pub path: String,
    /// "modified" | "added" | "deleted" | "renamed" | "untracked"
    pub status: String,
    pub staged: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitStatusInfo {
    pub branch: String,
    pub changes: Vec<GitChange>,
    /// true if the path is inside a git repository
    pub is_repo: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitDiffHunk {
    pub header: String,
    pub lines: Vec<GitDiffLine>,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitDiffLine {
    /// "+" | "-" | " " (context)
    pub origin: String,
    pub content: String,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitFileDiff {
    pub path: String,
    pub hunks: Vec<GitDiffHunk>,
    pub is_binary: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitBranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitLogEntry {
    pub oid: String,
    pub short_oid: String,
    pub message: String,
    pub author: String,
    pub author_email: String,
    pub timestamp: i64,
    pub parent_count: usize,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitStashEntry {
    pub index: usize,
    pub message: String,
    pub oid: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitRemoteInfo {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitAheadBehind {
    pub ahead: usize,
    pub behind: usize,
}
