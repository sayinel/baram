# Vault M1: Context Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Baram's single-vault file management on the Context model (§12.2~§12.3) with zero user-visible behavior change.

**Architecture:** Replace the global `VaultRootState(RwLock<Option<PathBuf>>)` in Rust with a `ContextManager` that holds a `HashMap<String, ContextState>`. Frontend gets a new `contextStore` (Zustand) that owns context lifecycle; `fileStore.rootPath` and `isJournalScoped` delegate to it. A minimal context tab bar appears in the UI but with only one context (identical to current UX). `app-workspace.json` persists the workspace across restarts.

**Tech Stack:** Rust (Tauri 2.0 managed state), TypeScript (Zustand, React), Vitest, cargo test

**Design doc:** `docs/design/part12-vault-system.md`

**Key constraint:** All 2249 Vitest tests and 163 cargo tests must still pass after every task. This is a pure infrastructure refactor — no user-visible behavior change.

---

## Chunk 1: Rust Backend — Context Types and Manager

### Task 1: Context types module

**Files:**
- Create: `src-tauri/src/context/mod.rs`
- Create: `src-tauri/src/context/types.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod context`)

- [ ] **Step 1: Create context types**

```rust
// src-tauri/src/context/types.rs

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ContextType {
    Vault,
    Folder,
    File,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum VaultType {
    General,
    Journal,
}

/// Serializable context info for IPC responses.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextInfo {
    pub id: String,
    pub context_type: ContextType,
    pub path: String,
    pub label: String,
    pub color: String,
    pub alias: Option<String>,       // VaultContext only
    pub vault_type: Option<VaultType>, // VaultContext only
    pub added_at: u64,
}
```

```rust
// src-tauri/src/context/mod.rs
pub mod types;

pub use types::*;
```

- [ ] **Step 2: Register module in lib.rs**

Add `mod context;` to `src-tauri/src/lib.rs` (after `mod config;`, line 4).

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/context/
git commit -m "feat(§80): add context types module (ContextType, VaultType, ContextInfo)"
```

---

### Task 2: VaultConfig types

**Files:**
- Create: `src-tauri/src/context/vault_config.rs`
- Modify: `src-tauri/src/context/mod.rs`

- [ ] **Step 1: Define VaultConfig struct**

```rust
// src-tauri/src/context/vault_config.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// .baram/config.json schema — all fields optional (merge with global).
/// §12.6
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vault: Option<VaultSection>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub appearance: Option<AppearanceSection>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub extensions: Option<ExtensionsSection>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub markdown: Option<MarkdownSection>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai: Option<AiSection>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub git: Option<GitSection>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub editor: Option<EditorSection>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_log: Option<WorkLogSection>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<SnapshotSection>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub cross_vault_hints: Option<HashMap<String, CrossVaultHint>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSection {
    #[serde(rename = "type")]
    pub vault_type: String,  // "general" | "journal"
    pub alias: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionsSection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownSection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serialization_rules: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_wikilink: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_mermaid: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub privacy_mode: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_fetch_interval: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_push_on_commit: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daily_notes_folder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skills_folder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_new_file_location: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkLogSection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interval_minutes: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossVaultHint {
    pub last_known_path: String,
}

/// Load VaultConfig from .baram/config.json in the given vault root.
/// Returns Default if file doesn't exist.
pub fn load_vault_config(vault_root: &Path) -> Result<VaultConfig, String> {
    let config_path = vault_root.join(".baram").join("config.json");
    if !config_path.exists() {
        return Ok(VaultConfig::default());
    }
    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read vault config: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse vault config: {}", e))
}

/// Save VaultConfig to .baram/config.json.
/// Creates .baram/ directory if it doesn't exist.
pub fn save_vault_config(vault_root: &Path, config: &VaultConfig) -> Result<(), String> {
    let baram_dir = vault_root.join(".baram");
    if !baram_dir.exists() {
        std::fs::create_dir_all(&baram_dir)
            .map_err(|e| format!("Failed to create .baram directory: {}", e))?;
    }
    let config_path = baram_dir.join("config.json");
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize vault config: {}", e))?;
    std::fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write vault config: {}", e))
}
```

- [ ] **Step 2: Add to mod.rs**

```rust
// src-tauri/src/context/mod.rs
pub mod types;
pub mod vault_config;

pub use types::*;
pub use vault_config::VaultConfig;
```

- [ ] **Step 3: Write tests for VaultConfig load/save**

```rust
// Add at bottom of vault_config.rs
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_load_missing_config_returns_default() {
        let tmp = tempfile::tempdir().unwrap();
        let config = load_vault_config(tmp.path()).unwrap();
        assert!(config.vault.is_none());
        assert!(config.extensions.is_none());
    }

    #[test]
    fn test_save_and_load_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let config = VaultConfig {
            vault: Some(VaultSection {
                vault_type: "general".to_string(),
                alias: "work".to_string(),
            }),
            ..Default::default()
        };
        save_vault_config(tmp.path(), &config).unwrap();
        let loaded = load_vault_config(tmp.path()).unwrap();
        assert_eq!(loaded.vault.as_ref().unwrap().alias, "work");
    }

    #[test]
    fn test_save_creates_baram_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let config = VaultConfig::default();
        save_vault_config(tmp.path(), &config).unwrap();
        assert!(tmp.path().join(".baram").exists());
        assert!(tmp.path().join(".baram/config.json").exists());
    }

    #[test]
    fn test_skip_serializing_none_fields() {
        let config = VaultConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        assert_eq!(json, "{}");
    }
}
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test context`
Expected: 4 tests pass

- [ ] **Step 5: Check tempfile is in dev-dependencies**

If `cargo test` fails with unresolved import for `tempfile`, add to `src-tauri/Cargo.toml`:
```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/context/vault_config.rs src-tauri/src/context/mod.rs
git commit -m "feat(§86): add VaultConfig types with load/save and tests"
```

---

### Task 3: ContextManager struct

**Files:**
- Create: `src-tauri/src/context/manager.rs`
- Modify: `src-tauri/src/context/mod.rs`

- [ ] **Step 1: Implement ContextManager**

```rust
// src-tauri/src/context/manager.rs

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tokio::sync::RwLock;

use super::types::*;
use super::vault_config::{self, VaultConfig};

/// Runtime state for a single context.
#[derive(Debug)]
pub struct ContextState {
    pub info: ContextInfo,
    pub canonical_path: PathBuf,
    pub config: Option<VaultConfig>,
}

/// App-wide context manager — replaces VaultRootState.
/// Registered as Tauri managed state.
pub struct ContextManager {
    contexts: RwLock<HashMap<String, ContextState>>,
    active_id: RwLock<Option<String>>,
    aliases: RwLock<HashMap<String, String>>, // alias → context_id
}

impl ContextManager {
    pub fn new() -> Self {
        Self {
            contexts: RwLock::new(HashMap::new()),
            active_id: RwLock::new(None),
            aliases: RwLock::new(HashMap::new()),
        }
    }

    /// Add a context. For vaults, loads .baram/config.json.
    pub async fn add(&self, info: ContextInfo) -> Result<ContextInfo, String> {
        let path = PathBuf::from(&info.path);

        // Validate path exists
        if info.context_type == ContextType::File {
            if !path.is_file() {
                return Err(format!("File not found: {}", info.path));
            }
        } else if !path.is_dir() {
            return Err(format!("Directory not found: {}", info.path));
        }

        let canonical = std::fs::canonicalize(&path)
            .map_err(|e| format!("Failed to resolve path: {}", e))?;

        // Load vault config if vault type
        let config = if info.context_type == ContextType::Vault {
            Some(vault_config::load_vault_config(&canonical)?)
        } else {
            None
        };

        // Register alias for vaults
        if let Some(alias) = &info.alias {
            let mut aliases = self.aliases.write().await;
            aliases.insert(alias.clone(), info.id.clone());
        }

        let state = ContextState {
            info: info.clone(),
            canonical_path: canonical,
            config,
        };

        let mut contexts = self.contexts.write().await;
        contexts.insert(info.id.clone(), state);

        Ok(info)
    }

    /// Remove a context by ID.
    pub async fn remove(&self, id: &str) -> Result<(), String> {
        let mut contexts = self.contexts.write().await;
        let state = contexts.remove(id)
            .ok_or_else(|| format!("Context not found: {}", id))?;

        // Remove alias
        if let Some(alias) = &state.info.alias {
            let mut aliases = self.aliases.write().await;
            aliases.remove(alias);
        }

        // If removing active context, clear active
        let mut active = self.active_id.write().await;
        if active.as_deref() == Some(id) {
            *active = None;
        }

        Ok(())
    }

    /// Set the active context.
    pub async fn set_active(&self, id: &str) -> Result<(), String> {
        let contexts = self.contexts.read().await;
        if !contexts.contains_key(id) {
            return Err(format!("Context not found: {}", id));
        }
        let mut active = self.active_id.write().await;
        *active = Some(id.to_string());
        Ok(())
    }

    /// Get the active context ID.
    pub async fn active_id(&self) -> Option<String> {
        self.active_id.read().await.clone()
    }

    /// Get all contexts as ContextInfo list (ordered by added_at).
    pub async fn list(&self) -> Vec<ContextInfo> {
        let contexts = self.contexts.read().await;
        let mut list: Vec<_> = contexts.values().map(|s| s.info.clone()).collect();
        list.sort_by_key(|c| c.added_at);
        list
    }

    /// Validate that a path is within a given context's root.
    /// Mirrors the existing check_vault logic with symlink protection.
    pub async fn validate_path(&self, path: &str, context_id: &str) -> Result<(), String> {
        let contexts = self.contexts.read().await;
        let ctx = contexts.get(context_id)
            .ok_or_else(|| format!("Context not found: {}", context_id))?;

        // File contexts: only the exact file is allowed
        if ctx.info.context_type == ContextType::File {
            let canonical = std::fs::canonicalize(path)
                .unwrap_or_else(|_| PathBuf::from(path));
            if canonical != ctx.canonical_path {
                return Err("Access denied: path is outside context".to_string());
            }
            return Ok(());
        }

        // Vault/Folder contexts: path must be under the context root
        let canonical_path = resolve_canonical(path)?;
        if !canonical_path.starts_with(&ctx.canonical_path) {
            return Err("Access denied: path is outside context".to_string());
        }
        Ok(())
    }

    /// Validate path against the active context.
    /// Falls back to allowing all paths if no active context (backward compat).
    pub async fn validate_path_active(&self, path: &str) -> Result<(), String> {
        let active = self.active_id.read().await;
        match active.as_deref() {
            Some(id) => self.validate_path(path, id).await,
            None => Ok(()), // No active context = allow all (cold start compat)
        }
    }

    /// Get the VaultConfig for a context.
    pub async fn get_config(&self, context_id: &str) -> Result<Option<VaultConfig>, String> {
        let contexts = self.contexts.read().await;
        let ctx = contexts.get(context_id)
            .ok_or_else(|| format!("Context not found: {}", context_id))?;
        Ok(ctx.config.clone())
    }

    /// Resolve a vault alias to context ID.
    pub async fn resolve_alias(&self, alias: &str) -> Option<String> {
        self.aliases.read().await.get(alias).cloned()
    }
}

/// Canonicalize a path, walking up ancestors for non-existent paths.
/// Same logic as existing check_vault in fs_cmd.rs.
fn resolve_canonical(path: &str) -> Result<PathBuf, String> {
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
                            "Access denied: path is outside context".to_string()
                        })?;
                        pending.push(name.to_os_string());
                        current = current.parent().ok_or_else(|| {
                            "Access denied: path is outside context".to_string()
                        })?;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_info(id: &str, ctx_type: ContextType, path: &str) -> ContextInfo {
        ContextInfo {
            id: id.to_string(),
            context_type: ctx_type,
            path: path.to_string(),
            label: "test".to_string(),
            color: "#3b82f6".to_string(),
            alias: None,
            vault_type: None,
            added_at: 0,
        }
    }

    #[tokio::test]
    async fn test_add_and_list() {
        let tmp = tempfile::tempdir().unwrap();
        let mgr = ContextManager::new();
        let info = make_info("ctx-1", ContextType::Folder, tmp.path().to_str().unwrap());
        mgr.add(info).await.unwrap();
        let list = mgr.list().await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "ctx-1");
    }

    #[tokio::test]
    async fn test_add_nonexistent_dir_fails() {
        let mgr = ContextManager::new();
        let info = make_info("ctx-1", ContextType::Folder, "/nonexistent/path/xyz");
        let result = mgr.add(info).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_remove_context() {
        let tmp = tempfile::tempdir().unwrap();
        let mgr = ContextManager::new();
        let info = make_info("ctx-1", ContextType::Folder, tmp.path().to_str().unwrap());
        mgr.add(info).await.unwrap();
        mgr.remove("ctx-1").await.unwrap();
        assert_eq!(mgr.list().await.len(), 0);
    }

    #[tokio::test]
    async fn test_set_active_and_get() {
        let tmp = tempfile::tempdir().unwrap();
        let mgr = ContextManager::new();
        let info = make_info("ctx-1", ContextType::Folder, tmp.path().to_str().unwrap());
        mgr.add(info).await.unwrap();
        mgr.set_active("ctx-1").await.unwrap();
        assert_eq!(mgr.active_id().await, Some("ctx-1".to_string()));
    }

    #[tokio::test]
    async fn test_set_active_unknown_fails() {
        let mgr = ContextManager::new();
        let result = mgr.set_active("unknown").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_remove_active_clears_active() {
        let tmp = tempfile::tempdir().unwrap();
        let mgr = ContextManager::new();
        let info = make_info("ctx-1", ContextType::Folder, tmp.path().to_str().unwrap());
        mgr.add(info).await.unwrap();
        mgr.set_active("ctx-1").await.unwrap();
        mgr.remove("ctx-1").await.unwrap();
        assert_eq!(mgr.active_id().await, None);
    }

    #[tokio::test]
    async fn test_validate_path_within_context() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("test.md");
        std::fs::write(&file, "hello").unwrap();

        let mgr = ContextManager::new();
        let info = make_info("ctx-1", ContextType::Folder, tmp.path().to_str().unwrap());
        mgr.add(info).await.unwrap();

        let result = mgr.validate_path(file.to_str().unwrap(), "ctx-1").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_validate_path_outside_context_fails() {
        let tmp = tempfile::tempdir().unwrap();
        let mgr = ContextManager::new();
        let info = make_info("ctx-1", ContextType::Folder, tmp.path().to_str().unwrap());
        mgr.add(info).await.unwrap();

        let result = mgr.validate_path("/etc/passwd", "ctx-1").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_validate_path_no_active_allows_all() {
        let mgr = ContextManager::new();
        let result = mgr.validate_path_active("/any/path").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_alias_registration() {
        let tmp = tempfile::tempdir().unwrap();
        let mgr = ContextManager::new();
        let mut info = make_info("ctx-1", ContextType::Vault, tmp.path().to_str().unwrap());
        info.alias = Some("work".to_string());
        mgr.add(info).await.unwrap();

        assert_eq!(mgr.resolve_alias("work").await, Some("ctx-1".to_string()));
    }

    #[tokio::test]
    async fn test_alias_removed_on_context_remove() {
        let tmp = tempfile::tempdir().unwrap();
        let mgr = ContextManager::new();
        let mut info = make_info("ctx-1", ContextType::Vault, tmp.path().to_str().unwrap());
        info.alias = Some("work".to_string());
        mgr.add(info).await.unwrap();
        mgr.remove("ctx-1").await.unwrap();

        assert_eq!(mgr.resolve_alias("work").await, None);
    }
}
```

- [ ] **Step 2: Add to mod.rs**

```rust
// src-tauri/src/context/mod.rs
pub mod manager;
pub mod types;
pub mod vault_config;

pub use manager::ContextManager;
pub use types::*;
pub use vault_config::VaultConfig;
```

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test context`
Expected: all tests pass (4 vault_config + 11 manager = 15 total)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/context/
git commit -m "feat(§88): add ContextManager with path validation and alias support"
```

---

### Task 4: Context IPC commands

**Files:**
- Create: `src-tauri/src/commands/context_cmd.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create context IPC commands**

```rust
// src-tauri/src/commands/context_cmd.rs

use crate::context::{ContextInfo, ContextManager, VaultConfig};
use crate::context::vault_config;

/// Add a new context (vault, folder, or file).
#[tauri::command]
pub async fn add_context(
    info: ContextInfo,
    state: tauri::State<'_, ContextManager>,
) -> Result<ContextInfo, String> {
    state.add(info).await
}

/// Remove a context by ID.
#[tauri::command]
pub async fn remove_context(
    context_id: String,
    state: tauri::State<'_, ContextManager>,
) -> Result<(), String> {
    state.remove(&context_id).await
}

/// Set the active context.
#[tauri::command]
pub async fn set_active_context(
    context_id: String,
    state: tauri::State<'_, ContextManager>,
) -> Result<(), String> {
    state.set_active(&context_id).await
}

/// Get all open contexts.
#[tauri::command]
pub async fn get_contexts(
    state: tauri::State<'_, ContextManager>,
) -> Result<Vec<ContextInfo>, String> {
    Ok(state.list().await)
}

/// Get vault config for a context.
#[tauri::command]
pub async fn get_vault_config(
    context_id: String,
    state: tauri::State<'_, ContextManager>,
) -> Result<Option<VaultConfig>, String> {
    state.get_config(&context_id).await
}

/// Initialize a folder as a vault (create .baram/config.json).
#[tauri::command]
pub async fn init_vault(
    path: String,
    alias: String,
) -> Result<VaultConfig, String> {
    let vault_path = std::path::Path::new(&path);
    if !vault_path.is_dir() {
        return Err(format!("Directory not found: {}", path));
    }

    let config = VaultConfig {
        vault: Some(crate::context::vault_config::VaultSection {
            vault_type: "general".to_string(),
            alias,
        }),
        ..Default::default()
    };

    vault_config::save_vault_config(vault_path, &config)?;
    Ok(config)
}
```

- [ ] **Step 2: Register in commands/mod.rs**

Add `pub mod context_cmd;` to `src-tauri/src/commands/mod.rs`.

- [ ] **Step 3: Register ContextManager as managed state and add IPC handlers in lib.rs**

In `src-tauri/src/lib.rs`:

Add import:
```rust
use commands::context_cmd;
```

Replace `.manage(VaultRootState(...))` (line 79) — **keep it for now** (backward compat), add ContextManager alongside:
```rust
.manage(VaultRootState(tokio::sync::RwLock::new(None)))
.manage(context::ContextManager::new())
```

Add to `invoke_handler` (after existing entries):
```rust
context_cmd::add_context,
context_cmd::remove_context,
context_cmd::set_active_context,
context_cmd::get_contexts,
context_cmd::get_vault_config,
context_cmd::init_vault,
```

- [ ] **Step 4: Verify compilation and existing tests**

Run: `cd src-tauri && cargo test`
Expected: all 163+ existing tests pass, plus 15 new context tests

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/context_cmd.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(§88): add context IPC commands (add/remove/set_active/get/init_vault)"
```

---

### Task 5: Bridge set_vault_root to ContextManager

**Files:**
- Modify: `src-tauri/src/commands/fs_cmd.rs`

This task makes the existing `set_vault_root` IPC command also register a context in the new ContextManager, so frontend code works unchanged during migration.

- [ ] **Step 1: Update set_vault_root to sync with ContextManager**

In `src-tauri/src/commands/fs_cmd.rs`, update `set_vault_root`:

```rust
#[tauri::command]
pub async fn set_vault_root(
    path: String,
    state: tauri::State<'_, crate::VaultRootState>,
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
) -> Result<(), String> {
    check(&path)?;

    // Keep old VaultRootState in sync (backward compat)
    let mut root = state.0.write().await;
    *root = Some(std::path::PathBuf::from(&path));

    // Also register/update in ContextManager
    let dir_name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "vault".to_string());

    // Remove previous active context if any
    if let Some(prev_id) = ctx_mgr.active_id().await {
        let _ = ctx_mgr.remove(&prev_id).await;
    }

    let info = crate::context::ContextInfo {
        id: format!("legacy-{}", uuid_simple()),
        context_type: crate::context::ContextType::Folder,
        path: path.clone(),
        label: dir_name,
        color: "#3b82f6".to_string(),
        alias: None,
        vault_type: None,
        added_at: now_millis(),
    };

    let added = ctx_mgr.add(info).await?;
    ctx_mgr.set_active(&added.id).await?;

    Ok(())
}

fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    format!("{:x}{:x}", d.as_secs(), d.subsec_nanos())
}

fn now_millis() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}
```

- [ ] **Step 2: Verify all existing tests still pass**

Run: `cd src-tauri && cargo test`
Expected: all tests pass (no behavior change for callers)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/fs_cmd.rs
git commit -m "refactor(§88): bridge set_vault_root to ContextManager for backward compat"
```

---

## Chunk 2: Frontend — Context Store and Migration

### Task 6: Frontend context IPC wrappers

**Files:**
- Create: `src/ipc/context.ts`
- Modify: `src/ipc/types.ts`

- [ ] **Step 1: Add context types to IPC types**

In `src/ipc/types.ts`, add:

```typescript
// §80 Context types
export type ContextType = "vault" | "folder" | "file";
export type VaultType = "general" | "journal";

export interface ContextInfo {
  id: string;
  contextType: ContextType;
  path: string;
  label: string;
  color: string;
  alias?: string;
  vaultType?: VaultType;
  addedAt: number;
}

export interface VaultConfig {
  vault?: { type: string; alias: string };
  appearance?: { theme?: string };
  extensions?: { enabled?: string[]; disabled?: string[] };
  markdown?: { serializationRules?: Record<string, unknown>; enableWikilink?: boolean; enableMermaid?: boolean };
  ai?: { model?: string; privacyMode?: boolean; contextScope?: string };
  git?: { autoFetchInterval?: number; autoPushOnCommit?: boolean };
  editor?: { dailyNotesFolder?: string; skillsFolder?: string; defaultNewFileLocation?: string };
  workLog?: { enabled?: boolean; folder?: string; fileNameFormat?: string; template?: string };
  snapshot?: { intervalMinutes?: number; maxCount?: number };
  crossVaultHints?: Record<string, { lastKnownPath: string }>;
}
```

- [ ] **Step 2: Create context IPC wrapper**

```typescript
// src/ipc/context.ts
import { invoke } from "@tauri-apps/api/core";
import type { ContextInfo, VaultConfig } from "./types";

export async function addContext(info: ContextInfo): Promise<ContextInfo> {
  return invoke("add_context", { info });
}

export async function removeContext(contextId: string): Promise<void> {
  return invoke("remove_context", { contextId });
}

export async function setActiveContext(contextId: string): Promise<void> {
  return invoke("set_active_context", { contextId });
}

export async function getContexts(): Promise<ContextInfo[]> {
  return invoke("get_contexts");
}

export async function getVaultConfig(contextId: string): Promise<VaultConfig | null> {
  return invoke("get_vault_config", { contextId });
}

export async function initVault(path: string, alias: string): Promise<VaultConfig> {
  return invoke("init_vault", { path, alias });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/ipc/context.ts src/ipc/types.ts
git commit -m "feat(§81): add context IPC types and invoke wrappers"
```

---

### Task 7: contextStore (new Zustand store)

**Files:**
- Create: `src/stores/context/context.ts`

- [ ] **Step 1: Create the context store**

```typescript
// src/stores/context/context.ts

// §80-§81 Context Store — owns the list of open contexts and the active context.
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  addContext as ipcAddContext,
  getContexts as ipcGetContexts,
  removeContext as ipcRemoveContext,
  setActiveContext as ipcSetActiveContext,
} from "../../ipc/context";
import type { ContextInfo, ContextType, VaultType } from "../../ipc/types";
import { logger } from "../../utils/logger";
import { tauriStorage } from "../system/tauri-storage";

// Default colors for new contexts (cycle through)
const DEFAULT_COLORS = [
  "#3b82f6", // blue
  "#10b981", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ef4444", // red
  "#06b6d4", // cyan
];

interface ContextState {
  // --- State ---
  contexts: ContextInfo[];
  activeContextId: string | null;

  // --- Derived ---
  activeContext: () => ContextInfo | null;
  vaultContexts: () => ContextInfo[];
  journalContext: () => ContextInfo | null;
  getContextForPath: (filePath: string) => ContextInfo | null;

  // --- Actions ---
  addContext: (
    type: ContextType,
    path: string,
    opts?: { alias?: string; color?: string; vaultType?: VaultType; label?: string },
  ) => Promise<ContextInfo>;
  removeContext: (id: string) => Promise<void>;
  setActiveContext: (id: string) => Promise<void>;
  reorderContexts: (ids: string[]) => void;
  updateContextLabel: (id: string, label: string) => void;
  updateContextColor: (id: string, color: string) => void;

  // --- Workspace persistence ---
  restoreFromBackend: () => Promise<void>;

  // --- Internal ---
  _setContexts: (contexts: ContextInfo[]) => void;
}

let colorIndex = 0;
function nextColor(): string {
  const color = DEFAULT_COLORS[colorIndex % DEFAULT_COLORS.length];
  colorIndex++;
  return color;
}

function generateId(): string {
  return `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function labelFromPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export const useContextStore = create<ContextState>()(
  persist(
    (set, get) => ({
      contexts: [],
      activeContextId: null,

      activeContext: () => {
        const { contexts, activeContextId } = get();
        return contexts.find((c) => c.id === activeContextId) ?? null;
      },

      vaultContexts: () =>
        get().contexts.filter((c) => c.contextType === "vault"),

      journalContext: () =>
        get().contexts.find(
          (c) => c.contextType === "vault" && c.vaultType === "journal",
        ) ?? null,

      getContextForPath: (filePath: string) => {
        const { contexts } = get();
        // Find the context whose path is a prefix of filePath
        // Prefer longest match (most specific)
        let best: ContextInfo | null = null;
        for (const ctx of contexts) {
          if (
            ctx.contextType !== "file" &&
            filePath.startsWith(ctx.path) &&
            (!best || ctx.path.length > best.path.length)
          ) {
            best = ctx;
          }
        }
        // Check file contexts (exact match)
        if (!best) {
          best = contexts.find(
            (c) => c.contextType === "file" && c.path === filePath,
          ) ?? null;
        }
        return best;
      },

      addContext: async (type, path, opts) => {
        const info: ContextInfo = {
          id: generateId(),
          contextType: type,
          path,
          label: opts?.label ?? labelFromPath(path),
          color: opts?.color ?? nextColor(),
          alias: opts?.alias,
          vaultType: opts?.vaultType,
          addedAt: Date.now(),
        };

        try {
          const added = await ipcAddContext(info);
          set((s) => ({ contexts: [...s.contexts, added] }));

          // Auto-activate if first context
          if (get().contexts.length === 1) {
            await get().setActiveContext(added.id);
          }

          return added;
        } catch (err) {
          logger.error("[Context] Failed to add context:", err);
          throw err;
        }
      },

      removeContext: async (id) => {
        try {
          await ipcRemoveContext(id);
          set((s) => {
            const contexts = s.contexts.filter((c) => c.id !== id);
            const activeContextId =
              s.activeContextId === id
                ? (contexts[0]?.id ?? null)
                : s.activeContextId;
            return { contexts, activeContextId };
          });
        } catch (err) {
          logger.error("[Context] Failed to remove context:", err);
          throw err;
        }
      },

      setActiveContext: async (id) => {
        try {
          await ipcSetActiveContext(id);
          set({ activeContextId: id });
        } catch (err) {
          logger.error("[Context] Failed to set active context:", err);
          throw err;
        }
      },

      reorderContexts: (ids) => {
        set((s) => {
          const map = new Map(s.contexts.map((c) => [c.id, c]));
          const reordered = ids
            .map((id) => map.get(id))
            .filter(Boolean) as ContextInfo[];
          return { contexts: reordered };
        });
      },

      updateContextLabel: (id, label) => {
        set((s) => ({
          contexts: s.contexts.map((c) =>
            c.id === id ? { ...c, label } : c,
          ),
        }));
      },

      updateContextColor: (id, color) => {
        set((s) => ({
          contexts: s.contexts.map((c) =>
            c.id === id ? { ...c, color } : c,
          ),
        }));
      },

      restoreFromBackend: async () => {
        try {
          const contexts = await ipcGetContexts();
          set({ contexts });
        } catch (err) {
          logger.error("[Context] Failed to restore from backend:", err);
        }
      },

      _setContexts: (contexts) => set({ contexts }),
    }),
    {
      name: "baram:context",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (s) => ({
        contexts: s.contexts,
        activeContextId: s.activeContextId,
      }),
      version: 1,
    },
  ),
);
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Write unit test for contextStore**

Create `src/stores/context/__tests__/context.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock IPC before importing store
vi.mock("../../../ipc/context", () => ({
  addContext: vi.fn(async (info) => info),
  removeContext: vi.fn(async () => {}),
  setActiveContext: vi.fn(async () => {}),
  getContexts: vi.fn(async () => []),
}));

vi.mock("../../system/tauri-storage", () => ({
  tauriStorage: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

import { useContextStore } from "../context";

describe("contextStore", () => {
  beforeEach(() => {
    useContextStore.setState({ contexts: [], activeContextId: null });
  });

  it("starts with empty contexts", () => {
    const { contexts, activeContextId } = useContextStore.getState();
    expect(contexts).toEqual([]);
    expect(activeContextId).toBeNull();
  });

  it("adds a context and auto-activates first", async () => {
    const ctx = await useContextStore.getState().addContext("folder", "/test/path");
    const state = useContextStore.getState();
    expect(state.contexts).toHaveLength(1);
    expect(state.activeContextId).toBe(ctx.id);
    expect(ctx.label).toBe("path");
  });

  it("removes a context", async () => {
    const ctx = await useContextStore.getState().addContext("folder", "/test/path");
    await useContextStore.getState().removeContext(ctx.id);
    expect(useContextStore.getState().contexts).toHaveLength(0);
  });

  it("switches active to next context on active removal", async () => {
    const ctx1 = await useContextStore.getState().addContext("folder", "/test/a");
    const ctx2 = await useContextStore.getState().addContext("folder", "/test/b");
    await useContextStore.getState().setActiveContext(ctx1.id);
    await useContextStore.getState().removeContext(ctx1.id);
    expect(useContextStore.getState().activeContextId).toBe(ctx2.id);
  });

  it("getContextForPath finds matching context", async () => {
    await useContextStore.getState().addContext("folder", "/test/vault");
    const found = useContextStore.getState().getContextForPath("/test/vault/file.md");
    expect(found).not.toBeNull();
    expect(found!.path).toBe("/test/vault");
  });

  it("getContextForPath returns null for unmatched path", async () => {
    await useContextStore.getState().addContext("folder", "/test/vault");
    const found = useContextStore.getState().getContextForPath("/other/file.md");
    expect(found).toBeNull();
  });

  it("vaultContexts filters by type", async () => {
    await useContextStore.getState().addContext("vault", "/test/vault", { vaultType: "general" });
    await useContextStore.getState().addContext("folder", "/test/folder");
    expect(useContextStore.getState().vaultContexts()).toHaveLength(1);
  });

  it("reorderContexts changes order", async () => {
    const a = await useContextStore.getState().addContext("folder", "/test/a");
    const b = await useContextStore.getState().addContext("folder", "/test/b");
    useContextStore.getState().reorderContexts([b.id, a.id]);
    const ids = useContextStore.getState().contexts.map((c) => c.id);
    expect(ids).toEqual([b.id, a.id]);
  });
});
```

- [ ] **Step 4: Run test**

Run: `npx vitest run src/stores/context/__tests__/context.test.ts`
Expected: all 8 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/stores/context/
git commit -m "feat(§81): add contextStore with IPC integration and tests"
```

---

### Task 8: Add contextId to EditorTab

**Files:**
- Modify: `src/stores/editor/editor.ts`
- Modify: `src/stores/editor/__tests__/editor.test.ts` (if exists)

- [ ] **Step 1: Add contextId field to EditorTab**

In `src/stores/editor/editor.ts`, add `contextId` to the `EditorTab` interface:

```typescript
interface EditorTab {
  contextId: string;     // ← NEW: the context this tab belongs to
  filePath: string;
  id: string;
  isDirty: boolean;
  isPinned: boolean;
  title: string;
  type?: EditorTabType;
}
```

- [ ] **Step 2: Update openTab to accept contextId**

In `openTab`, ensure the tab is created with a `contextId`. Add a default of `""` for backward compatibility:

Find the line where a new tab object is created and add `contextId: tab.contextId ?? ""`.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors (contextId is optional in callers via `??`)

- [ ] **Step 4: Run existing editor tests**

Run: `npx vitest run src/stores/editor/`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/stores/editor/editor.ts
git commit -m "feat(§83): add contextId field to EditorTab"
```

---

### Task 9: Wire openFolder through contextStore

**Files:**
- Modify: `src/stores/file/file.ts`
- Modify: `src/hooks/use-app-startup.ts`

This is the critical migration step. `openFolder()` currently calls `setVaultRoot` + `listDir` directly. We make it go through `contextStore` while keeping the same behavior.

- [ ] **Step 1: Import contextStore in file.ts**

Add import at top of `src/stores/file/file.ts`:
```typescript
import { useContextStore } from "../context/context";
```

- [ ] **Step 2: Update openFolder to register context**

Replace the `openFolder` implementation to also register a context:

```typescript
openFolder: async (folderPath: string) => {
  try {
    // Legacy: setVaultRoot still works (bridges to ContextManager in Rust)
    await setVaultRoot(folderPath);

    // Also register in frontend contextStore
    const contextStore = useContextStore.getState();
    // Remove any existing contexts (M1: single context only)
    for (const ctx of contextStore.contexts) {
      await contextStore.removeContext(ctx.id);
    }
    // Add new context
    const hasBaram = await listDir(folderPath + "/.baram", false)
      .then(() => true)
      .catch(() => false);
    const contextType = hasBaram ? "vault" : "folder";
    await contextStore.addContext(contextType as any, folderPath);

    // Build file tree (existing logic)
    const entries = await listDir(folderPath, true);
    const tree = buildFileTree(entries, folderPath);
    set({ rootPath: folderPath, fileTree: tree });

    // Update settings
    useSettingsStore.getState().addRecentFolder(folderPath);

    // Background: refresh index
    refreshIndex(folderPath).catch((err) =>
      logger.error("[FileStore] refreshIndex failed:", err),
    );
    useLinkStore.getState().refresh();
  } catch (err) {
    logger.error("[FileStore] openFolder failed:", err);
    throw err;
  }
},
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: all 2249 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/stores/file/file.ts
git commit -m "refactor(§81): wire openFolder through contextStore (M1 bridge)"
```

---

### Task 10: Context tab bar component (minimal)

**Files:**
- Create: `src/components/layout/ContextTabBar.tsx`
- Create: `src/styles/context-tab-bar.css`
- Modify: `src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Create ContextTabBar component**

```tsx
// src/components/layout/ContextTabBar.tsx

// §82 컨텍스트 탭 바 — 활성 컨텍스트 전환 UI
import { useShallow } from "zustand/shallow";

import { useContextStore } from "../../stores/context/context";
import "../../styles/context-tab-bar.css";

export function ContextTabBar() {
  const { contexts, activeContextId, setActiveContext } = useContextStore(
    useShallow((s) => ({
      contexts: s.contexts,
      activeContextId: s.activeContextId,
      setActiveContext: s.setActiveContext,
    })),
  );

  // M1: Don't render if 0 or 1 context (no need for tab bar)
  if (contexts.length <= 1) return null;

  return (
    <div className="context-tab-bar">
      {contexts.map((ctx) => (
        <button
          key={ctx.id}
          className={`context-tab ${ctx.id === activeContextId ? "context-tab--active" : ""}`}
          onClick={() => setActiveContext(ctx.id)}
          title={ctx.path}
        >
          <span
            className="context-tab__dot"
            style={{ backgroundColor: ctx.color }}
          />
          <span className="context-tab__label">{ctx.label}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create CSS**

```css
/* src/styles/context-tab-bar.css */

.context-tab-bar {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  padding: 2px var(--spacing-sm, 8px);
  background: var(--color-bg-secondary, #f8f9fa);
  border-bottom: 1px solid var(--color-border-default, #e5e7eb);
  min-height: 28px;
  overflow-x: auto;
}

[data-theme="dark"] .context-tab-bar {
  background: var(--color-bg-secondary, #252526);
}

.context-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-muted, #6b7280);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}

.context-tab:hover {
  background: var(--color-bg-hover, rgba(0, 0, 0, 0.05));
}

.context-tab--active {
  color: var(--color-text-default, #1a1a1a);
  font-weight: 600;
}

[data-theme="dark"] .context-tab--active {
  color: var(--color-text-default, #e0e0e0);
}

.context-tab__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.context-tab__label {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 3: Add import to styles/index.css**

Add `@import "context-tab-bar.css";` to `src/styles/index.css`.

- [ ] **Step 4: Add ContextTabBar to AppLayout**

In `src/components/layout/AppLayout.tsx`, import and render `<ContextTabBar />` between the title bar and the tab bar area. The exact insertion point depends on the current layout structure — place it after the title/menu bar, before `<TabBar>`.

```tsx
import { ContextTabBar } from "./ContextTabBar";

// In the render, add:
<ContextTabBar />
```

- [ ] **Step 5: Verify TypeScript compiles and tests pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no errors, all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/ContextTabBar.tsx src/styles/context-tab-bar.css src/styles/index.css src/components/layout/AppLayout.tsx
git commit -m "feat(§82): add ContextTabBar component (hidden when single context)"
```

---

### Task 11: Editor tab context color dot

**Files:**
- Modify: `src/components/layout/TabBar.tsx` (or wherever editor tabs are rendered)

- [ ] **Step 1: Add color dot to editor tab rendering**

In the tab rendering component, find where each editor tab label is rendered. Add a dot before the filename:

```tsx
import { useContextStore } from "../../stores/context/context";

// Inside the tab render:
const contextStore = useContextStore.getState();
const ctx = contextStore.getContextForPath(tab.filePath);
const dotColor = ctx?.color ?? "#9ca3af"; // gray for unknown

// In JSX, before the tab title:
<span
  className="editor-tab__ctx-dot"
  style={{ backgroundColor: dotColor }}
  title={ctx?.label}
/>
```

- [ ] **Step 2: Add CSS for the dot**

In the relevant CSS file (e.g., `src/styles/layout.css` or wherever tab styles live):

```css
.editor-tab__ctx-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-right: 4px;
}
```

- [ ] **Step 3: Verify visually**

The dot should be invisible in M1 (only one context, so all dots are the same color). This becomes visible when M2 adds multi-context support.

- [ ] **Step 4: Verify TypeScript compiles and tests pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no errors, all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/TabBar.tsx
git commit -m "feat(§83): add context color dot to editor tabs"
```

---

## Chunk 3: Integration and Verification

### Task 12: Full regression test

**Files:** None (verification only)

- [ ] **Step 1: Run all Vitest tests**

Run: `npx vitest run`
Expected: 2249/2249 pass (0 failures)

- [ ] **Step 2: Run all Cargo tests**

Run: `cd src-tauri && cargo test`
Expected: 163/163 pass

- [ ] **Step 3: TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Manual smoke test checklist**

```
[ ] App starts normally
[ ] Open folder works
[ ] File tree loads
[ ] Editor opens files
[ ] Tabs work (open, close, switch)
[ ] File save works
[ ] Journal preset works
[ ] Quick Switcher works
[ ] Search works
[ ] Context tab bar hidden (only 1 context open)
```

---

### Task 13: Update CLAUDE.md and docs

**Files:**
- Modify: `CLAUDE.md` (directory structure)
- Modify: `docs/design/part12-vault-system.md` (mark M1 status)

- [ ] **Step 1: Update directory structure in CLAUDE.md**

Add `context/` entries:
```
│   ├── stores/
│   │   ├── context/         # Context 스토어 (§80-§81)
│   │   ├── editor/          # editor.ts
│   │   ├── file/            # file.ts, workspace.ts
```

And Rust:
```
│   │   ├── context/         # Context 관리자 (§88)
│   │   ├── commands/        # IPC 커맨드 핸들러
```

- [ ] **Step 2: Mark M1 progress in design doc**

In `docs/design/part12-vault-system.md` §12.13, update M1 status to "진행 중" or "완료" as appropriate.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/design/part12-vault-system.md
git commit -m "docs: update directory structure and M1 status for vault system"
```
