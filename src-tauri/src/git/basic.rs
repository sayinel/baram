// §57b Git Basic — status, stage, unstage, commit, diff_file, discard

use std::cell::RefCell;
use std::path::Path;

use git2::{DiffOptions, ErrorCode, Repository, Signature, Sort, StatusOptions, StatusShow};

use super::types::{GitChange, GitDiffHunk, GitDiffLine, GitFileDiff, GitLogEntry, GitStatusInfo};
use super::GitError;

/// Get git status for the repository containing `path`.
pub fn status(path: &str) -> Result<GitStatusInfo, GitError> {
    let repo = match Repository::discover(path) {
        Ok(r) => r,
        Err(e) if e.code() == ErrorCode::NotFound => {
            return Ok(GitStatusInfo {
                branch: String::new(),
                changes: Vec::new(),
                is_repo: false,
            });
        }
        Err(e) => return Err(GitError::Git(e)),
    };

    // Branch name
    let branch = match repo.head() {
        Ok(head) => head.shorthand().unwrap_or("HEAD").to_string(),
        Err(e) if e.code() == ErrorCode::UnbornBranch => "(no commits)".to_string(),
        Err(e) => return Err(GitError::Git(e)),
    };

    // Collect status entries
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .show(StatusShow::IndexAndWorkdir);

    let statuses = repo.statuses(Some(&mut opts)).map_err(GitError::Git)?;

    let mut changes = Vec::new();
    for entry in statuses.iter() {
        let path_str = entry.path().unwrap_or("").to_string();
        let s = entry.status();

        // Index (staged) changes
        if s.is_index_new() {
            changes.push(GitChange {
                path: path_str.clone(),
                status: "added".into(),
                staged: true,
            });
        }
        if s.is_index_modified() {
            changes.push(GitChange {
                path: path_str.clone(),
                status: "modified".into(),
                staged: true,
            });
        }
        if s.is_index_deleted() {
            changes.push(GitChange {
                path: path_str.clone(),
                status: "deleted".into(),
                staged: true,
            });
        }
        if s.is_index_renamed() {
            changes.push(GitChange {
                path: path_str.clone(),
                status: "renamed".into(),
                staged: true,
            });
        }

        // Workdir (unstaged) changes
        if s.is_wt_modified() {
            changes.push(GitChange {
                path: path_str.clone(),
                status: "modified".into(),
                staged: false,
            });
        }
        if s.is_wt_deleted() {
            changes.push(GitChange {
                path: path_str.clone(),
                status: "deleted".into(),
                staged: false,
            });
        }
        if s.is_wt_renamed() {
            changes.push(GitChange {
                path: path_str.clone(),
                status: "renamed".into(),
                staged: false,
            });
        }
        if s.is_wt_new() {
            changes.push(GitChange {
                path: path_str.clone(),
                status: "untracked".into(),
                staged: false,
            });
        }
    }

    Ok(GitStatusInfo {
        branch,
        changes,
        is_repo: true,
    })
}

/// Stage files for commit.
pub fn stage(path: &str, files: &[String]) -> Result<(), GitError> {
    let repo = super::open_repo(path)?;
    let mut index = repo.index().map_err(GitError::Git)?;

    for file in files {
        let file_path = Path::new(file);
        // Check if file exists — if deleted, remove from index
        let workdir = repo
            .workdir()
            .ok_or_else(|| GitError::Custom("Bare repository".to_string()))?;
        if workdir.join(file_path).exists() {
            index.add_path(file_path).map_err(GitError::Git)?;
        } else {
            index.remove_path(file_path).map_err(GitError::Git)?;
        }
    }

    index.write().map_err(GitError::Git)?;
    Ok(())
}

/// Unstage files (reset to HEAD).
pub fn unstage(path: &str, files: &[String]) -> Result<(), GitError> {
    let repo = super::open_repo(path)?;
    let head = repo.head().map_err(GitError::Git)?;
    let head_commit = head.peel_to_commit().map_err(GitError::Git)?;
    let head_tree = head_commit.tree().map_err(GitError::Git)?;

    let mut index = repo.index().map_err(GitError::Git)?;

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
                    .map_err(GitError::Git)?;
            }
            Err(_) => {
                // File didn't exist in HEAD — remove from index
                let _ = index.remove_path(file_path);
            }
        }
    }

    index.write().map_err(GitError::Git)?;
    Ok(())
}

/// Create a commit with the current index.
pub fn commit(path: &str, message: &str) -> Result<String, GitError> {
    let repo = super::open_repo(path)?;
    let mut index = repo.index().map_err(GitError::Git)?;
    let oid = index.write_tree().map_err(GitError::Git)?;
    let tree = repo.find_tree(oid).map_err(GitError::Git)?;

    let sig = repo
        .signature()
        .or_else(|_| Signature::now("Baram User", "user@baram.app"))
        .map_err(GitError::Git)?;

    let parent = match repo.head() {
        Ok(head) => {
            let commit = head.peel_to_commit().map_err(GitError::Git)?;
            Some(commit)
        }
        Err(e) if e.code() == ErrorCode::UnbornBranch => None,
        Err(e) => return Err(GitError::Git(e)),
    };

    let parents: Vec<&git2::Commit> = parent.as_ref().map(|c| vec![c]).unwrap_or_default();

    let commit_oid = repo
        .commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .map_err(GitError::Git)?;

    Ok(commit_oid.to_string())
}

/// Get diff for a specific file (working tree vs HEAD).
pub fn diff_file(path: &str, file_path: &str) -> Result<GitFileDiff, GitError> {
    let repo = super::open_repo(path)?;

    let mut diff_opts = DiffOptions::new();
    diff_opts.pathspec(file_path);

    // Diff working tree against HEAD (or empty tree for initial commit)
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());

    let diff = repo
        .diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut diff_opts))
        .map_err(GitError::Git)?;

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
    .map_err(GitError::Git)?;

    let hunks = hunks.into_inner();
    let is_binary = is_binary.into_inner();

    Ok(GitFileDiff {
        path: file_path.to_string(),
        hunks,
        is_binary,
    })
}

/// Discard working tree changes for specific files.
pub fn discard(path: &str, files: &[String]) -> Result<(), GitError> {
    let repo = super::open_repo(path)?;

    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());

    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force();
    for file in files {
        checkout.path(file);
    }

    // For untracked files, delete them manually
    let workdir = repo
        .workdir()
        .ok_or_else(|| GitError::Custom("Bare repository".to_string()))?;
    for file in files {
        let full_path = workdir.join(file);
        // Check if file is untracked (not in HEAD tree)
        let in_tree = head_tree
            .as_ref()
            .and_then(|t| t.get_path(Path::new(file)).ok())
            .is_some();

        if !in_tree && full_path.exists() {
            std::fs::remove_file(&full_path).map_err(GitError::Io)?;
            continue;
        }
    }

    // Checkout files that exist in HEAD
    if head_tree.is_some() {
        repo.checkout_head(Some(&mut checkout))
            .map_err(GitError::Git)?;
    }

    Ok(())
}

/// Get commit history (git log).
pub fn log(path: &str, max_count: usize) -> Result<Vec<GitLogEntry>, GitError> {
    let repo = super::open_repo(path)?;
    let mut revwalk = repo.revwalk().map_err(GitError::Git)?;
    revwalk.push_head().map_err(GitError::Git)?;
    revwalk.set_sorting(Sort::TIME).map_err(GitError::Git)?;

    let mut entries = Vec::new();
    for (i, oid_result) in revwalk.enumerate() {
        if i >= max_count {
            break;
        }
        let oid = oid_result.map_err(GitError::Git)?;
        let commit = repo.find_commit(oid).map_err(GitError::Git)?;
        let author = commit.author();
        let oid_str = oid.to_string();
        let short = if oid_str.len() >= 7 {
            oid_str[..7].to_string()
        } else {
            oid_str.clone()
        };
        entries.push(GitLogEntry {
            oid: oid_str,
            short_oid: short,
            message: commit.message().unwrap_or("").to_string(),
            author: author.name().unwrap_or("").to_string(),
            author_email: author.email().unwrap_or("").to_string(),
            timestamp: commit.time().seconds(),
            parent_count: commit.parent_count(),
        });
    }
    Ok(entries)
}
