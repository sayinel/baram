// §80 Context type definitions for the vault/folder/file context system

use serde::{Deserialize, Serialize};

/// The kind of context entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ContextType {
    Vault,
    Folder,
    File,
}

/// The purpose/flavour of a vault.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum VaultType {
    General,
    Journal,
}

/// A single context entry (vault, folder, or file) managed by ContextManager.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextInfo {
    pub id: String,
    pub context_type: ContextType,
    pub path: String,
    pub label: String,
    pub color: String,
    pub alias: Option<String>,
    pub vault_type: Option<VaultType>,
    /// Unix timestamp (ms) when this context was added.
    pub added_at: u64,
}
