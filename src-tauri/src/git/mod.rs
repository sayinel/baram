// §57b Git Basic — git2 기반 Git 연동 모듈

use git2::{DiffOptions, ErrorCode, Repository, Signature, Sort, StatusOptions, StatusShow};
use serde::Serialize;
use std::cell::RefCell;
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum GitError {
    #[error("Git error: {0}")]
    Git(#[from] git2::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Custom(String),
}

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
fn open_repo(path: &str) -> Result<Repository, GitError> {
    Repository::discover(path).map_err(|e| {
        if e.code() == ErrorCode::NotFound {
            GitError::Custom("Not a git repository".to_string())
        } else {
            GitError::Git(e)
        }
    })
}

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
    let repo = open_repo(path)?;
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
    let repo = open_repo(path)?;
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
    let repo = open_repo(path)?;
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
    let repo = open_repo(path)?;

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

/// List branches (local + remote).
pub fn list_branches(path: &str) -> Result<Vec<GitBranchInfo>, GitError> {
    let repo = open_repo(path)?;
    let mut branches = Vec::new();

    let current_branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));

    for branch_result in repo.branches(None).map_err(GitError::Git)? {
        let (branch, branch_type) = branch_result.map_err(GitError::Git)?;
        let name = branch
            .name()
            .map_err(GitError::Git)?
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
pub fn switch_branch(path: &str, branch_name: &str) -> Result<(), GitError> {
    let repo = open_repo(path)?;

    let branch = repo
        .find_branch(branch_name, git2::BranchType::Local)
        .map_err(GitError::Git)?;

    let reference = branch
        .get()
        .name()
        .ok_or_else(|| GitError::Custom("Invalid branch reference".to_string()))?;

    repo.set_head(reference).map_err(GitError::Git)?;
    repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .map_err(GitError::Git)?;

    Ok(())
}

/// Discard working tree changes for specific files.
pub fn discard(path: &str, files: &[String]) -> Result<(), GitError> {
    let repo = open_repo(path)?;

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

/// Create a new local branch from HEAD.
pub fn create_branch(path: &str, branch_name: &str) -> Result<(), GitError> {
    let repo = open_repo(path)?;
    let head = repo.head().map_err(GitError::Git)?;
    let commit = head.peel_to_commit().map_err(GitError::Git)?;

    repo.branch(branch_name, &commit, false)
        .map_err(GitError::Git)?;

    Ok(())
}

// §67 Git Advanced — log, stash, remote, delete branch

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

/// Get commit history (git log).
pub fn log(path: &str, max_count: usize) -> Result<Vec<GitLogEntry>, GitError> {
    let repo = open_repo(path)?;
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

#[derive(Debug, Serialize, Clone)]
pub struct GitStashEntry {
    pub index: usize,
    pub message: String,
    pub oid: String,
}

/// Save current working tree to stash.
pub fn stash_save(path: &str, message: &str, include_untracked: bool) -> Result<String, GitError> {
    let mut repo = open_repo(path)?;
    let sig = repo
        .signature()
        .or_else(|_| Signature::now("Baram User", "user@baram.app"))
        .map_err(GitError::Git)?;

    let mut flags = git2::StashFlags::DEFAULT;
    if include_untracked {
        flags |= git2::StashFlags::INCLUDE_UNTRACKED;
    }

    let msg = if message.is_empty() {
        "WIP on stash"
    } else {
        message
    };
    let oid = repo
        .stash_save(&sig, msg, Some(flags))
        .map_err(GitError::Git)?;
    Ok(oid.to_string())
}

/// List stash entries.
pub fn stash_list(path: &str) -> Result<Vec<GitStashEntry>, GitError> {
    let mut repo = open_repo(path)?;
    let mut entries = Vec::new();

    repo.stash_foreach(|index, message, oid| {
        entries.push(GitStashEntry {
            index,
            message: message.to_string(),
            oid: oid.to_string(),
        });
        true // continue iteration
    })
    .map_err(GitError::Git)?;

    Ok(entries)
}

/// Pop (apply + drop) a stash entry.
pub fn stash_pop(path: &str, index: usize) -> Result<(), GitError> {
    let mut repo = open_repo(path)?;
    repo.stash_pop(index, None).map_err(GitError::Git)
}

/// Drop a stash entry without applying.
pub fn stash_drop(path: &str, index: usize) -> Result<(), GitError> {
    let mut repo = open_repo(path)?;
    repo.stash_drop(index).map_err(GitError::Git)
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

/// List configured remotes.
pub fn list_remotes(path: &str) -> Result<Vec<GitRemoteInfo>, GitError> {
    let repo = open_repo(path)?;
    let remotes = repo.remotes().map_err(GitError::Git)?;
    let mut result = Vec::new();
    for name in remotes.iter().flatten() {
        if let Ok(remote) = repo.find_remote(name) {
            result.push(GitRemoteInfo {
                name: name.to_string(),
                url: remote.url().unwrap_or("").to_string(),
            });
        }
    }
    Ok(result)
}

/// Fetch from a remote.
pub fn fetch(path: &str, remote_name: &str) -> Result<(), GitError> {
    let repo = open_repo(path)?;
    let mut remote = repo.find_remote(remote_name).map_err(GitError::Git)?;
    let mut callbacks = git2::RemoteCallbacks::new();
    callbacks.credentials(|_url, username_from_url, allowed_types| {
        // Try SSH agent first
        if allowed_types.contains(git2::CredentialType::SSH_KEY) {
            if let Some(username) = username_from_url {
                return git2::Cred::ssh_key_from_agent(username);
            }
        }
        // Try default credentials
        if allowed_types.contains(git2::CredentialType::DEFAULT) {
            return git2::Cred::default();
        }
        Err(git2::Error::from_str("no suitable credentials found"))
    });

    let mut fetch_options = git2::FetchOptions::new();
    fetch_options.remote_callbacks(callbacks);

    remote
        .fetch(&[] as &[&str], Some(&mut fetch_options), None)
        .map_err(GitError::Git)?;
    Ok(())
}

/// Pull from a remote (fetch + fast-forward merge).
pub fn pull(path: &str, remote_name: &str, branch: &str) -> Result<String, GitError> {
    // Fetch first
    fetch(path, remote_name)?;

    let repo = open_repo(path)?;

    // Get the fetch head
    let fetch_head = repo
        .find_reference(&format!("refs/remotes/{}/{}", remote_name, branch))
        .map_err(GitError::Git)?;
    let fetch_commit = repo
        .reference_to_annotated_commit(&fetch_head)
        .map_err(GitError::Git)?;

    // Do merge analysis
    let (analysis, _) = repo
        .merge_analysis(&[&fetch_commit])
        .map_err(GitError::Git)?;

    if analysis.is_up_to_date() {
        return Ok("Already up to date".to_string());
    }

    if analysis.is_fast_forward() {
        // Fast-forward
        let refname = format!("refs/heads/{}", branch);
        let mut reference = repo.find_reference(&refname).map_err(GitError::Git)?;
        reference
            .set_target(fetch_commit.id(), "pull: fast-forward")
            .map_err(GitError::Git)?;
        repo.set_head(&refname).map_err(GitError::Git)?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .map_err(GitError::Git)?;
        return Ok("Fast-forward".to_string());
    }

    // Normal merge needed
    Err(GitError::Custom(
        "Merge required — please commit or stash your changes first".to_string(),
    ))
}

/// Push to a remote.
pub fn push(path: &str, remote_name: &str, branch: &str) -> Result<(), GitError> {
    let repo = open_repo(path)?;
    let mut remote = repo.find_remote(remote_name).map_err(GitError::Git)?;

    let mut callbacks = git2::RemoteCallbacks::new();
    callbacks.credentials(|_url, username_from_url, allowed_types| {
        if allowed_types.contains(git2::CredentialType::SSH_KEY) {
            if let Some(username) = username_from_url {
                return git2::Cred::ssh_key_from_agent(username);
            }
        }
        if allowed_types.contains(git2::CredentialType::DEFAULT) {
            return git2::Cred::default();
        }
        Err(git2::Error::from_str("no suitable credentials found"))
    });

    let mut push_options = git2::PushOptions::new();
    push_options.remote_callbacks(callbacks);

    let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);
    remote
        .push(&[&refspec], Some(&mut push_options))
        .map_err(GitError::Git)?;
    Ok(())
}

/// Get ahead/behind counts relative to a remote tracking branch.
pub fn ahead_behind(
    path: &str,
    branch: &str,
    remote_name: &str,
) -> Result<GitAheadBehind, GitError> {
    let repo = open_repo(path)?;

    let local_ref = repo
        .find_reference(&format!("refs/heads/{}", branch))
        .map_err(GitError::Git)?;
    let local_oid = local_ref
        .target()
        .ok_or_else(|| GitError::Custom("Could not resolve local ref".to_string()))?;

    let remote_ref = repo
        .find_reference(&format!("refs/remotes/{}/{}", remote_name, branch))
        .map_err(|e| GitError::Custom(format!("No tracking branch: {}", e.message())))?;
    let remote_oid = remote_ref
        .target()
        .ok_or_else(|| GitError::Custom("Could not resolve remote ref".to_string()))?;

    let (ahead, behind) = repo
        .graph_ahead_behind(local_oid, remote_oid)
        .map_err(GitError::Git)?;

    Ok(GitAheadBehind { ahead, behind })
}

/// Delete a local branch.
pub fn delete_branch(path: &str, branch_name: &str) -> Result<(), GitError> {
    let repo = open_repo(path)?;
    let mut branch = repo
        .find_branch(branch_name, git2::BranchType::Local)
        .map_err(GitError::Git)?;
    branch.delete().map_err(GitError::Git)
}
