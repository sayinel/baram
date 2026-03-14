// §57b Git Basic — git2 기반 Git 연동 모듈

mod basic;
mod branch;
mod remote;
mod stash;
mod types;

pub use basic::{commit, diff_file, discard, log, stage, status, unstage};
pub use branch::{create_branch, delete_branch, list_branches, switch_branch};
pub use remote::{ahead_behind, fetch, list_remotes, pull, push};
pub use stash::{stash_drop, stash_list, stash_pop, stash_save};
pub use types::*;

use git2::{ErrorCode, Repository};
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

/// Open a git repository at the given path (or its parent).
pub fn open_repo(path: &str) -> Result<Repository, GitError> {
    Repository::discover(path).map_err(|e| {
        if e.code() == ErrorCode::NotFound {
            GitError::Custom("Not a git repository".to_string())
        } else {
            GitError::Git(e)
        }
    })
}
