// §67 Git Remote 관련 함수 (fetch, pull, push, ahead_behind, list_remotes)

use super::types::{GitAheadBehind, GitRemoteInfo};
use super::GitError;

/// Build a RemoteCallbacks with SSH-agent and default credential fallback.
/// Extracted to avoid duplication between fetch() and push().
fn make_credentials_callback() -> git2::RemoteCallbacks<'static> {
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
    callbacks
}

/// List configured remotes.
pub fn list_remotes(path: &str) -> Result<Vec<GitRemoteInfo>, GitError> {
    let repo = super::open_repo(path)?;
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
    let repo = super::open_repo(path)?;
    let mut remote = repo.find_remote(remote_name).map_err(GitError::Git)?;

    let mut fetch_options = git2::FetchOptions::new();
    fetch_options.remote_callbacks(make_credentials_callback());

    remote
        .fetch(&[] as &[&str], Some(&mut fetch_options), None)
        .map_err(GitError::Git)?;
    Ok(())
}

/// Pull from a remote (fetch + fast-forward merge).
pub fn pull(path: &str, remote_name: &str, branch: &str) -> Result<String, GitError> {
    // Fetch first
    fetch(path, remote_name)?;

    let repo = super::open_repo(path)?;

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
    let repo = super::open_repo(path)?;
    let mut remote = repo.find_remote(remote_name).map_err(GitError::Git)?;

    let mut push_options = git2::PushOptions::new();
    push_options.remote_callbacks(make_credentials_callback());

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
    let repo = super::open_repo(path)?;

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
