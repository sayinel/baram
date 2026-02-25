// §57b Git Basic — git2 기반 Git 연동 모듈

use git2::{
    DiffOptions, ErrorCode, Repository, Signature, StatusOptions, StatusShow,
};
use serde::Serialize;
use std::cell::RefCell;
use std::path::Path;

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

/// Open a git repository at the given path (or its parent).
fn open_repo(path: &str) -> Result<Repository, String> {
    Repository::discover(path).map_err(|e| {
        if e.code() == ErrorCode::NotFound {
            "Not a git repository".to_string()
        } else {
            e.message().to_string()
        }
    })
}

/// Get git status for the repository containing `path`.
pub fn status(path: &str) -> Result<GitStatusInfo, String> {
    let repo = match Repository::discover(path) {
        Ok(r) => r,
        Err(e) if e.code() == ErrorCode::NotFound => {
            return Ok(GitStatusInfo {
                branch: String::new(),
                changes: Vec::new(),
                is_repo: false,
            });
        }
        Err(e) => return Err(e.message().to_string()),
    };

    // Branch name
    let branch = match repo.head() {
        Ok(head) => head
            .shorthand()
            .unwrap_or("HEAD")
            .to_string(),
        Err(e) if e.code() == ErrorCode::UnbornBranch => "(no commits)".to_string(),
        Err(e) => return Err(e.message().to_string()),
    };

    // Collect status entries
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .show(StatusShow::IndexAndWorkdir);

    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.message().to_string())?;

    let mut changes = Vec::new();
    for entry in statuses.iter() {
        let path_str = entry.path().unwrap_or("").to_string();
        let s = entry.status();

        // Index (staged) changes
        if s.is_index_new() {
            changes.push(GitChange { path: path_str.clone(), status: "added".into(), staged: true });
        }
        if s.is_index_modified() {
            changes.push(GitChange { path: path_str.clone(), status: "modified".into(), staged: true });
        }
        if s.is_index_deleted() {
            changes.push(GitChange { path: path_str.clone(), status: "deleted".into(), staged: true });
        }
        if s.is_index_renamed() {
            changes.push(GitChange { path: path_str.clone(), status: "renamed".into(), staged: true });
        }

        // Workdir (unstaged) changes
        if s.is_wt_modified() {
            changes.push(GitChange { path: path_str.clone(), status: "modified".into(), staged: false });
        }
        if s.is_wt_deleted() {
            changes.push(GitChange { path: path_str.clone(), status: "deleted".into(), staged: false });
        }
        if s.is_wt_renamed() {
            changes.push(GitChange { path: path_str.clone(), status: "renamed".into(), staged: false });
        }
        if s.is_wt_new() {
            changes.push(GitChange { path: path_str.clone(), status: "untracked".into(), staged: false });
        }
    }

    Ok(GitStatusInfo { branch, changes, is_repo: true })
}

/// Stage files for commit.
pub fn stage(path: &str, files: &[String]) -> Result<(), String> {
    let repo = open_repo(path)?;
    let mut index = repo.index().map_err(|e| e.message().to_string())?;

    for file in files {
        let file_path = Path::new(file);
        // Check if file exists — if deleted, remove from index
        let workdir = repo.workdir().ok_or("Bare repository")?;
        if workdir.join(file_path).exists() {
            index.add_path(file_path).map_err(|e| e.message().to_string())?;
        } else {
            index.remove_path(file_path).map_err(|e| e.message().to_string())?;
        }
    }

    index.write().map_err(|e| e.message().to_string())?;
    Ok(())
}

/// Unstage files (reset to HEAD).
pub fn unstage(path: &str, files: &[String]) -> Result<(), String> {
    let repo = open_repo(path)?;
    let head = repo.head().map_err(|e| e.message().to_string())?;
    let head_commit = head.peel_to_commit().map_err(|e| e.message().to_string())?;
    let head_tree = head_commit.tree().map_err(|e| e.message().to_string())?;

    let mut index = repo.index().map_err(|e| e.message().to_string())?;

    for file in files {
        let file_path = Path::new(file);
        match head_tree.get_path(file_path) {
            Ok(entry) => {
                // Restore index entry to HEAD state
                index
                    .add(&git2::IndexEntry {
                        ctime: git2::IndexTime::new(0, 0),
                        mtime: git2::IndexTime::new(0, 0),
                        dev: 0,
                        ino: 0,
                        mode: entry.filemode() as u32,
                        uid: 0,
                        gid: 0,
                        file_size: 0,
                        id: entry.id(),
                        flags: 0,
                        flags_extended: 0,
                        path: file.as_bytes().to_vec(),
                    })
                    .map_err(|e| e.message().to_string())?;
            }
            Err(_) => {
                // File didn't exist in HEAD — remove from index
                let _ = index.remove_path(file_path);
            }
        }
    }

    index.write().map_err(|e| e.message().to_string())?;
    Ok(())
}

/// Create a commit with the current index.
pub fn commit(path: &str, message: &str) -> Result<String, String> {
    let repo = open_repo(path)?;
    let mut index = repo.index().map_err(|e| e.message().to_string())?;
    let oid = index.write_tree().map_err(|e| e.message().to_string())?;
    let tree = repo.find_tree(oid).map_err(|e| e.message().to_string())?;

    let sig = repo
        .signature()
        .or_else(|_| Signature::now("Baram User", "user@baram.app"))
        .map_err(|e| e.message().to_string())?;

    let parent = match repo.head() {
        Ok(head) => {
            let commit = head.peel_to_commit().map_err(|e| e.message().to_string())?;
            Some(commit)
        }
        Err(e) if e.code() == ErrorCode::UnbornBranch => None,
        Err(e) => return Err(e.message().to_string()),
    };

    let parents: Vec<&git2::Commit> = parent.as_ref().map(|c| vec![c]).unwrap_or_default();

    let commit_oid = repo
        .commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .map_err(|e| e.message().to_string())?;

    Ok(commit_oid.to_string())
}

/// Get diff for a specific file (working tree vs HEAD).
pub fn diff_file(path: &str, file_path: &str) -> Result<GitFileDiff, String> {
    let repo = open_repo(path)?;

    let mut diff_opts = DiffOptions::new();
    diff_opts.pathspec(file_path);

    // Diff working tree against HEAD (or empty tree for initial commit)
    let head_tree = repo.head().ok()
        .and_then(|h| h.peel_to_tree().ok());

    let diff = repo
        .diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut diff_opts))
        .map_err(|e| e.message().to_string())?;

    let hunks = RefCell::new(Vec::<GitDiffHunk>::new());
    let is_binary = RefCell::new(false);

    diff.foreach(
        &mut |delta, _| {
            if delta.flags().is_binary() {
                *is_binary.borrow_mut() = true;
            }
            true
        },
        Some(&mut |_, _| true),
        Some(&mut |_, hunk| {
            hunks.borrow_mut().push(GitDiffHunk {
                header: String::from_utf8_lossy(hunk.header()).to_string(),
                lines: Vec::new(),
            });
            true
        }),
        Some(&mut |_, _hunk, line| {
            let mut h = hunks.borrow_mut();
            if let Some(last_hunk) = h.last_mut() {
                let origin = match line.origin() {
                    '+' => "+",
                    '-' => "-",
                    _ => " ",
                };
                last_hunk.lines.push(GitDiffLine {
                    origin: origin.to_string(),
                    content: String::from_utf8_lossy(line.content()).to_string(),
                    old_lineno: line.old_lineno(),
                    new_lineno: line.new_lineno(),
                });
            }
            true
        }),
    )
    .map_err(|e| e.message().to_string())?;

    let hunks = hunks.into_inner();
    let is_binary = is_binary.into_inner();

    Ok(GitFileDiff {
        path: file_path.to_string(),
        hunks,
        is_binary,
    })
}

/// List branches (local + remote).
pub fn list_branches(path: &str) -> Result<Vec<GitBranchInfo>, String> {
    let repo = open_repo(path)?;
    let mut branches = Vec::new();

    let current_branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));

    for branch_result in repo.branches(None).map_err(|e| e.message().to_string())? {
        let (branch, branch_type) = branch_result.map_err(|e| e.message().to_string())?;
        let name = branch.name().map_err(|e| e.message().to_string())?
            .unwrap_or("")
            .to_string();

        if name.is_empty() {
            continue;
        }

        let is_remote = branch_type == git2::BranchType::Remote;
        let is_current = !is_remote && current_branch.as_deref() == Some(&name);

        branches.push(GitBranchInfo {
            name,
            is_current,
            is_remote,
        });
    }

    Ok(branches)
}

/// Switch to a branch.
pub fn switch_branch(path: &str, branch_name: &str) -> Result<(), String> {
    let repo = open_repo(path)?;

    let branch = repo
        .find_branch(branch_name, git2::BranchType::Local)
        .map_err(|e| e.message().to_string())?;

    let reference = branch.get().name().ok_or("Invalid branch reference")?;

    repo.set_head(reference).map_err(|e| e.message().to_string())?;
    repo.checkout_head(Some(
        git2::build::CheckoutBuilder::new().force(),
    ))
    .map_err(|e| e.message().to_string())?;

    Ok(())
}

/// Discard working tree changes for specific files.
pub fn discard(path: &str, files: &[String]) -> Result<(), String> {
    let repo = open_repo(path)?;

    let head_tree = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_tree().ok());

    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force();
    for file in files {
        checkout.path(file);
    }

    // For untracked files, delete them manually
    let workdir = repo.workdir().ok_or("Bare repository")?;
    for file in files {
        let full_path = workdir.join(file);
        // Check if file is untracked (not in HEAD tree)
        let in_tree = head_tree
            .as_ref()
            .and_then(|t| t.get_path(Path::new(file)).ok())
            .is_some();

        if !in_tree && full_path.exists() {
            std::fs::remove_file(&full_path).map_err(|e| e.to_string())?;
            continue;
        }
    }

    // Checkout files that exist in HEAD
    if head_tree.is_some() {
        repo.checkout_head(Some(&mut checkout))
            .map_err(|e| e.message().to_string())?;
    }

    Ok(())
}

/// Create a new local branch from HEAD.
pub fn create_branch(path: &str, branch_name: &str) -> Result<(), String> {
    let repo = open_repo(path)?;
    let head = repo.head().map_err(|e| e.message().to_string())?;
    let commit = head.peel_to_commit().map_err(|e| e.message().to_string())?;

    repo.branch(branch_name, &commit, false)
        .map_err(|e| e.message().to_string())?;

    Ok(())
}
