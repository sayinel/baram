// §88 ContextManager — multi-vault/folder/file context registry with path confinement

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::RwLock;

use super::types::{ContextInfo, ContextType};
use super::vault_config::{load_vault_config, VaultConfig};

// ── Internal state ─────────────────────────────────────────────────────────────

/// Internal state kept per registered context entry.
#[derive(Debug, Clone)]
pub struct ContextState {
    pub info: ContextInfo,
    /// Canonicalized path (symlink-resolved). Used by validate_path (M2+).
    pub canonical_path: PathBuf,
    /// VaultConfig loaded from `.baram/config.json` (only for Vault contexts).
    pub config: Option<VaultConfig>,
}

// ── ContextManager ─────────────────────────────────────────────────────────────

/// Thread-safe registry of vault/folder/file contexts.
#[derive(Clone)]
pub struct ContextManager {
    contexts: Arc<RwLock<HashMap<String, ContextState>>>,
    active_id: Arc<RwLock<Option<String>>>,
    /// alias → context id
    aliases: Arc<RwLock<HashMap<String, String>>>,
}

impl ContextManager {
    /// Create an empty manager.
    pub fn new() -> Self {
        Self {
            contexts: Arc::new(RwLock::new(HashMap::new())),
            active_id: Arc::new(RwLock::new(None)),
            aliases: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    // ── Registration ───────────────────────────────────────────────────────────

    /// Register a new context entry.
    ///
    /// Validates that the path exists, canonicalizes it, loads `VaultConfig` for
    /// Vault-type contexts, and registers any alias.
    ///
    /// §88 Dedup by path: if a context with the same canonical path already exists,
    /// returns the existing entry instead of creating a duplicate. This prevents
    /// `setVaultRoot` (legacy-xxx) and `addContext` (ctx-xxx) from creating two
    /// entries for the same directory.
    pub async fn add(&self, info: ContextInfo) -> Result<ContextInfo, String> {
        let canonical = resolve_canonical(&info.path)?;
        if !canonical.exists() {
            return Err(format!("Path does not exist: {}", info.path));
        }

        // §88 Dedup: return existing context if one already covers this path
        {
            let contexts = self.contexts.read().await;
            for state in contexts.values() {
                if state.canonical_path == canonical {
                    return Ok(state.info.clone());
                }
            }
        }

        let vault_config = if info.context_type == ContextType::Vault {
            Some(load_vault_config(&canonical)?)
        } else {
            None
        };

        let state = ContextState {
            info: info.clone(),
            canonical_path: canonical,
            config: vault_config,
        };

        {
            let mut map = self.contexts.write().await;
            map.insert(info.id.clone(), state);
        }

        if let Some(alias) = &info.alias {
            let mut aliases = self.aliases.write().await;
            aliases.insert(alias.clone(), info.id.clone());
        }

        Ok(info)
    }

    /// Remove a context entry by id.
    ///
    /// Removes its alias mapping and clears `active_id` if the removed entry was active.
    pub async fn remove(&self, id: &str) -> Result<(), String> {
        let removed = {
            let mut map = self.contexts.write().await;
            map.remove(id)
        };

        if removed.is_none() {
            return Err(format!("Context not found: {id}"));
        }

        // Remove alias if any.
        if let Some(alias) = removed.as_ref().and_then(|s| s.info.alias.as_ref()) {
            let mut aliases = self.aliases.write().await;
            aliases.remove(alias);
        }

        // Clear active_id if it pointed to this entry.
        let mut active = self.active_id.write().await;
        if active.as_deref() == Some(id) {
            *active = None;
        }

        Ok(())
    }

    // ── Active context ─────────────────────────────────────────────────────────

    /// Set the active context by id.
    pub async fn set_active(&self, id: &str) -> Result<(), String> {
        let map = self.contexts.read().await;
        if !map.contains_key(id) {
            return Err(format!("Context not found: {id}"));
        }
        drop(map);
        let mut active = self.active_id.write().await;
        *active = Some(id.to_string());
        Ok(())
    }

    /// Return the current active context id.
    pub async fn active_id(&self) -> Option<String> {
        self.active_id.read().await.clone()
    }

    // ── Listing ────────────────────────────────────────────────────────────────

    /// Return all registered contexts sorted by `added_at` (ascending).
    pub async fn list(&self) -> Vec<ContextInfo> {
        let map = self.contexts.read().await;
        let mut entries: Vec<ContextInfo> = map.values().map(|s| s.info.clone()).collect();
        entries.sort_by_key(|e| e.added_at);
        entries
    }

    // ── Path validation ────────────────────────────────────────────────────────

    /// Check that `path` is confined within the context identified by `context_id`.
    ///
    /// - `File` context: exact canonical match only.
    /// - `Vault`/`Folder` context: path must start with the context root.
    ///
    /// Uses canonicalization on both sides to prevent symlink traversal.
    #[allow(dead_code)] // Public API for single-context validation (used by tests, future IPC with contextId param)
    pub async fn validate_path(&self, path: &str, context_id: &str) -> Result<(), String> {
        let map = self.contexts.read().await;
        let state = map
            .get(context_id)
            .ok_or_else(|| format!("Context not found: {context_id}"))?;

        let canonical_path = resolve_canonical(path)?;
        let root = &state.canonical_path;

        match state.info.context_type {
            ContextType::File => {
                if canonical_path != *root {
                    return Err("Access denied: path does not match file context".to_string());
                }
            }
            ContextType::Vault | ContextType::Folder => {
                if !canonical_path.starts_with(root) {
                    return Err("Access denied: path is outside the context root".to_string());
                }
            }
        }

        Ok(())
    }

    /// Validate `path` against the active context.
    ///
    /// If no context is active, all paths are allowed (backward-compatibility with
    /// single-vault mode where `VaultRootState` already handles confinement).
    #[allow(dead_code)] // Public API for active-context validation (future use when contextId is added to IPC)
    pub async fn validate_path_active(&self, path: &str) -> Result<(), String> {
        let active = self.active_id.read().await.clone();
        match active {
            None => Ok(()),
            Some(id) => self.validate_path(path, &id).await,
        }
    }

    /// §88 Validate that `path` is within ANY registered context.
    ///
    /// Used by file IPC commands to allow cross-context file access in multi-vault
    /// scenarios (e.g., a tab from Vault A should still read its file even when
    /// Vault B is the active context).
    ///
    /// If no contexts are registered, returns `Ok(())` for backward compatibility.
    pub async fn validate_path_any(&self, path: &str) -> Result<(), String> {
        let canonical_path = resolve_canonical(path)?;
        let contexts = self.contexts.read().await;

        if contexts.is_empty() {
            return Ok(());
        }

        for state in contexts.values() {
            match state.info.context_type {
                ContextType::File => {
                    if canonical_path == state.canonical_path {
                        return Ok(());
                    }
                }
                ContextType::Vault | ContextType::Folder => {
                    if canonical_path.starts_with(&state.canonical_path) {
                        return Ok(());
                    }
                }
            }
        }

        Err("Access denied: path is outside all registered contexts".to_string())
    }

    // ── Config access ──────────────────────────────────────────────────────────

    /// Return the `VaultConfig` for a context (only populated for Vault contexts).
    pub async fn get_config(&self, context_id: &str) -> Result<Option<VaultConfig>, String> {
        let map = self.contexts.read().await;
        let state = map
            .get(context_id)
            .ok_or_else(|| format!("Context not found: {context_id}"))?;
        Ok(state.config.clone())
    }

    // ── Alias resolution ───────────────────────────────────────────────────────

    /// Resolve an alias string to a context id.
    /// §87 Used by resolve_cross_vault_link IPC command.
    pub async fn resolve_alias(&self, alias: &str) -> Option<String> {
        self.aliases.read().await.get(alias).cloned()
    }
}

impl Default for ContextManager {
    fn default() -> Self {
        Self::new()
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/// Canonicalize a path, walking up ancestors for paths that do not exist yet
/// (same logic as `check_vault` in `fs_cmd.rs`).
pub fn resolve_canonical(path: &str) -> Result<PathBuf, String> {
    match std::fs::canonicalize(path) {
        Ok(p) => Ok(p),
        Err(_) => {
            let target = Path::new(path);
            let mut pending: Vec<std::ffi::OsString> = Vec::new();
            let mut current = target;
            loop {
                match std::fs::canonicalize(current) {
                    Ok(canonical) => {
                        let mut result = canonical;
                        for component in pending.into_iter().rev() {
                            result = result.join(component);
                        }
                        return Ok(result);
                    }
                    Err(_) => {
                        let name = current.file_name().ok_or_else(|| {
                            "Cannot resolve path: no existing ancestor found".to_string()
                        })?;
                        pending.push(name.to_os_string());
                        current = current.parent().ok_or_else(|| {
                            "Cannot resolve path: no existing ancestor found".to_string()
                        })?;
                    }
                }
            }
        }
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_info(id: &str, path: &str, kind: ContextType) -> ContextInfo {
        ContextInfo {
            id: id.to_string(),
            context_type: kind,
            path: path.to_string(),
            label: id.to_string(),
            color: "#ffffff".to_string(),
            alias: None,
            vault_type: None,
            added_at: 0,
        }
    }

    fn make_info_with_alias(id: &str, path: &str, alias: &str) -> ContextInfo {
        ContextInfo {
            id: id.to_string(),
            context_type: ContextType::Vault,
            path: path.to_string(),
            label: id.to_string(),
            color: "#ffffff".to_string(),
            alias: Some(alias.to_string()),
            vault_type: None,
            added_at: 0,
        }
    }

    #[tokio::test]
    async fn add_and_list() {
        let dir = TempDir::new().unwrap();
        let mgr = ContextManager::new();
        let info = make_info("v1", dir.path().to_str().unwrap(), ContextType::Vault);
        mgr.add(info).await.unwrap();
        let list = mgr.list().await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "v1");
    }

    #[tokio::test]
    async fn add_nonexistent_fails() {
        let mgr = ContextManager::new();
        let info = make_info("v1", "/nonexistent/path/xyz", ContextType::Vault);
        assert!(mgr.add(info).await.is_err());
    }

    #[tokio::test]
    async fn remove() {
        let dir = TempDir::new().unwrap();
        let mgr = ContextManager::new();
        let info = make_info("v1", dir.path().to_str().unwrap(), ContextType::Vault);
        mgr.add(info).await.unwrap();
        mgr.remove("v1").await.unwrap();
        assert!(mgr.list().await.is_empty());
    }

    #[tokio::test]
    async fn set_active() {
        let dir = TempDir::new().unwrap();
        let mgr = ContextManager::new();
        let info = make_info("v1", dir.path().to_str().unwrap(), ContextType::Vault);
        mgr.add(info).await.unwrap();
        mgr.set_active("v1").await.unwrap();
        assert_eq!(mgr.active_id().await.as_deref(), Some("v1"));
    }

    #[tokio::test]
    async fn set_active_unknown_fails() {
        let mgr = ContextManager::new();
        assert!(mgr.set_active("no-such-id").await.is_err());
    }

    #[tokio::test]
    async fn remove_active_clears() {
        let dir = TempDir::new().unwrap();
        let mgr = ContextManager::new();
        let info = make_info("v1", dir.path().to_str().unwrap(), ContextType::Vault);
        mgr.add(info).await.unwrap();
        mgr.set_active("v1").await.unwrap();
        mgr.remove("v1").await.unwrap();
        assert!(mgr.active_id().await.is_none());
    }

    #[tokio::test]
    async fn validate_path_within() {
        let dir = TempDir::new().unwrap();
        let mgr = ContextManager::new();
        let info = make_info("v1", dir.path().to_str().unwrap(), ContextType::Vault);
        mgr.add(info).await.unwrap();

        // Create a file inside so resolve_canonical works for a concrete path.
        let inner = dir.path().join("notes.md");
        std::fs::write(&inner, "").unwrap();
        mgr.validate_path(inner.to_str().unwrap(), "v1")
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn validate_path_outside_fails() {
        let dir = TempDir::new().unwrap();
        let other_dir = TempDir::new().unwrap();
        let mgr = ContextManager::new();
        let info = make_info("v1", dir.path().to_str().unwrap(), ContextType::Vault);
        mgr.add(info).await.unwrap();

        let outside = other_dir.path().join("secret.txt");
        std::fs::write(&outside, "").unwrap();
        assert!(mgr
            .validate_path(outside.to_str().unwrap(), "v1")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn validate_path_no_active_allows_all() {
        let mgr = ContextManager::new();
        // No active context — all paths are allowed.
        mgr.validate_path_active("/any/path/at/all").await.unwrap();
    }

    #[tokio::test]
    async fn alias_registration() {
        let dir = TempDir::new().unwrap();
        let mgr = ContextManager::new();
        let info = make_info_with_alias("v1", dir.path().to_str().unwrap(), "work");
        mgr.add(info).await.unwrap();
        assert_eq!(mgr.resolve_alias("work").await.as_deref(), Some("v1"));
    }

    #[tokio::test]
    async fn alias_removed_on_remove() {
        let dir = TempDir::new().unwrap();
        let mgr = ContextManager::new();
        let info = make_info_with_alias("v1", dir.path().to_str().unwrap(), "work");
        mgr.add(info).await.unwrap();
        mgr.remove("v1").await.unwrap();
        assert!(mgr.resolve_alias("work").await.is_none());
    }

    // §88 Dedup by path tests

    #[tokio::test]
    async fn add_dedup_returns_existing() {
        let dir = TempDir::new().unwrap();
        let mgr = ContextManager::new();
        let info1 = make_info(
            "legacy-1",
            dir.path().to_str().unwrap(),
            ContextType::Folder,
        );
        let saved1 = mgr.add(info1).await.unwrap();
        assert_eq!(saved1.id, "legacy-1");

        // Adding with a different ID but same path should return the existing entry
        let info2 = make_info("ctx-2", dir.path().to_str().unwrap(), ContextType::Folder);
        let saved2 = mgr.add(info2).await.unwrap();
        assert_eq!(saved2.id, "legacy-1"); // returns existing, not "ctx-2"

        // Only one entry in the list
        assert_eq!(mgr.list().await.len(), 1);
    }

    #[tokio::test]
    async fn add_different_paths_not_deduped() {
        let dir1 = TempDir::new().unwrap();
        let dir2 = TempDir::new().unwrap();
        let mgr = ContextManager::new();
        let info1 = make_info("v1", dir1.path().to_str().unwrap(), ContextType::Vault);
        let info2 = make_info("v2", dir2.path().to_str().unwrap(), ContextType::Vault);
        mgr.add(info1).await.unwrap();
        mgr.add(info2).await.unwrap();
        assert_eq!(mgr.list().await.len(), 2);
    }

    // §88 validate_path_any tests

    #[tokio::test]
    async fn validate_path_any_within_any_context() {
        let dir1 = TempDir::new().unwrap();
        let dir2 = TempDir::new().unwrap();
        let mgr = ContextManager::new();
        let info1 = make_info("v1", dir1.path().to_str().unwrap(), ContextType::Vault);
        let info2 = make_info("v2", dir2.path().to_str().unwrap(), ContextType::Vault);
        mgr.add(info1).await.unwrap();
        mgr.add(info2).await.unwrap();
        mgr.set_active("v1").await.unwrap();

        // File inside v2 (non-active) should pass validate_path_any
        let inner2 = dir2.path().join("notes.md");
        std::fs::write(&inner2, "").unwrap();
        mgr.validate_path_any(inner2.to_str().unwrap())
            .await
            .unwrap();

        // File inside v1 (active) should also pass
        let inner1 = dir1.path().join("doc.md");
        std::fs::write(&inner1, "").unwrap();
        mgr.validate_path_any(inner1.to_str().unwrap())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn validate_path_any_outside_all_fails() {
        let dir1 = TempDir::new().unwrap();
        let other = TempDir::new().unwrap();
        let mgr = ContextManager::new();
        let info1 = make_info("v1", dir1.path().to_str().unwrap(), ContextType::Vault);
        mgr.add(info1).await.unwrap();

        let outside = other.path().join("secret.txt");
        std::fs::write(&outside, "").unwrap();
        assert!(mgr
            .validate_path_any(outside.to_str().unwrap())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn validate_path_any_no_contexts_allows_all() {
        let mgr = ContextManager::new();
        // No contexts registered — all paths allowed for backward compat
        mgr.validate_path_any("/any/path").await.unwrap();
    }

    #[tokio::test]
    async fn validate_path_any_file_context_exact_match() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("single.md");
        std::fs::write(&file_path, "hello").unwrap();

        let mgr = ContextManager::new();
        let info = make_info("f1", file_path.to_str().unwrap(), ContextType::File);
        mgr.add(info).await.unwrap();

        // Exact match passes
        mgr.validate_path_any(file_path.to_str().unwrap())
            .await
            .unwrap();

        // Different file in same dir fails (File context = exact match only)
        let other_file = dir.path().join("other.md");
        std::fs::write(&other_file, "").unwrap();
        assert!(mgr
            .validate_path_any(other_file.to_str().unwrap())
            .await
            .is_err());
    }
}
