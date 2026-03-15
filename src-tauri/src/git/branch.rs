// §57b / §67 Git Branch 관련 함수

use super::types::GitBranchInfo;
use super::GitError;

/// List branches (local + remote).
pub fn list_branches(path: &str) -> Result<Vec<GitBranchInfo>, GitError> {
    let repo = super::open_repo(path)?;
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
    let repo = super::open_repo(path)?;

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

/// Create a new local branch from HEAD.
pub fn create_branch(path: &str, branch_name: &str) -> Result<(), GitError> {
    let repo = super::open_repo(path)?;
    let head = repo.head().map_err(GitError::Git)?;
    let commit = head.peel_to_commit().map_err(GitError::Git)?;

    repo.branch(branch_name, &commit, false)
        .map_err(GitError::Git)?;

    Ok(())
}

/// Delete a local branch.
pub fn delete_branch(path: &str, branch_name: &str) -> Result<(), GitError> {
    let repo = super::open_repo(path)?;
    let mut branch = repo
        .find_branch(branch_name, git2::BranchType::Local)
        .map_err(GitError::Git)?;
    branch.delete().map_err(GitError::Git)
}
