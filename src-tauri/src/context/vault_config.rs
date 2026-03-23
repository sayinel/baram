// §86 VaultConfig — per-vault configuration stored in .baram/config.json

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

// ── Section structs ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultSection {
    /// Vault flavour: "general" | "journal"
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub vault_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionsSection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownSection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serialization_rules: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_wikilink: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_mermaid: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiSection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub privacy_mode: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitSection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_fetch_interval: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_push_on_commit: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EditorSection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daily_notes_folder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skills_folder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_new_file_location: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interval_minutes: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CrossVaultHint {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_known_path: Option<String>,
}

// ── VaultConfig ────────────────────────────────────────────────────────────────

/// Per-vault configuration stored at `<vault_root>/.baram/config.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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

// ── I/O helpers ────────────────────────────────────────────────────────────────

fn config_path(vault_root: &Path) -> std::path::PathBuf {
    vault_root.join(".baram").join("config.json")
}

/// Load `VaultConfig` from `<vault_root>/.baram/config.json`.
/// Returns `Default::default()` if the file does not exist.
pub fn load_vault_config(vault_root: &Path) -> Result<VaultConfig, String> {
    let path = config_path(vault_root);
    if !path.exists() {
        return Ok(VaultConfig::default());
    }

    // §86 Size limit: reject configs larger than 1MB to prevent DoS
    let metadata = std::fs::metadata(&path)
        .map_err(|e| format!("Failed to read vault config metadata: {e}"))?;
    if metadata.len() > 1_048_576 {
        return Err("Vault config file exceeds 1MB size limit".to_string());
    }

    let raw =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read vault config: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Failed to parse vault config: {e}"))
}

/// Save `VaultConfig` to `<vault_root>/.baram/config.json` (pretty-printed).
/// Creates the `.baram/` directory if it does not exist.
pub fn save_vault_config(vault_root: &Path, config: &VaultConfig) -> Result<(), String> {
    let baram_dir = vault_root.join(".baram");
    std::fs::create_dir_all(&baram_dir).map_err(|e| format!("Failed to create .baram dir: {e}"))?;
    let path = config_path(vault_root);
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize vault config: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write vault config: {e}"))
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn load_missing_returns_default() {
        let dir = TempDir::new().unwrap();
        let cfg = load_vault_config(dir.path()).unwrap();
        assert!(cfg.vault.is_none());
        assert!(cfg.appearance.is_none());
    }

    #[test]
    fn save_and_load_roundtrip() {
        let dir = TempDir::new().unwrap();
        let cfg = VaultConfig {
            vault: Some(VaultSection {
                vault_type: Some("journal".to_string()),
                alias: Some("my-journal".to_string()),
            }),
            appearance: Some(AppearanceSection {
                theme: Some("dark".to_string()),
            }),
            ..Default::default()
        };
        save_vault_config(dir.path(), &cfg).unwrap();

        let loaded = load_vault_config(dir.path()).unwrap();
        let v = loaded.vault.unwrap();
        assert_eq!(v.vault_type.as_deref(), Some("journal"));
        assert_eq!(v.alias.as_deref(), Some("my-journal"));
        assert_eq!(loaded.appearance.unwrap().theme.as_deref(), Some("dark"));
    }

    #[test]
    fn save_creates_baram_dir() {
        let dir = TempDir::new().unwrap();
        let baram = dir.path().join(".baram");
        assert!(!baram.exists());
        save_vault_config(dir.path(), &VaultConfig::default()).unwrap();
        assert!(baram.exists());
    }

    #[test]
    fn empty_config_serializes_to_empty_object() {
        let cfg = VaultConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        assert_eq!(json, "{}");
    }

    #[test]
    fn load_rejects_oversized_config() {
        let dir = TempDir::new().unwrap();
        let baram = dir.path().join(".baram");
        std::fs::create_dir_all(&baram).unwrap();
        let config_path = baram.join("config.json");
        // Write a file larger than 1MB
        let big = vec![b' '; 1_048_577];
        std::fs::write(&config_path, &big).unwrap();
        let result = load_vault_config(dir.path());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("1MB size limit"));
    }
}
