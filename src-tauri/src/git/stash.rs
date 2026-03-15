// §67 Git Stash 관련 함수

use git2::Signature;

use super::types::GitStashEntry;
use super::GitError;

/// Save current working tree to stash.
pub fn stash_save(path: &str, message: &str, include_untracked: bool) -> Result<String, GitError> {
    let mut repo = super::open_repo(path)?;
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
    let mut repo = super::open_repo(path)?;
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
    let mut repo = super::open_repo(path)?;
    repo.stash_pop(index, None).map_err(GitError::Git)
}

/// Drop a stash entry without applying.
pub fn stash_drop(path: &str, index: usize) -> Result<(), GitError> {
    let mut repo = super::open_repo(path)?;
    repo.stash_drop(index).map_err(GitError::Git)
}
