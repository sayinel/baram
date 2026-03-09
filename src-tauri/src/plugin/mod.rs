// §69 Plugin Marketplace — Rust 백엔드 모듈
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum PluginError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("ZIP extraction error: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Checksum mismatch: expected {expected}, got {actual}")]
    ChecksumMismatch { expected: String, actual: String },
    #[error("Invalid manifest: {0}")]
    InvalidManifest(String),
    #[error("Plugin not found: {0}")]
    NotFound(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub license: String,
    pub main: String,
    pub engines: EngineRequirement,
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default, rename = "tiptapExtensions")]
    pub tiptap_extensions: Vec<TiptapExtensionDef>,
    #[serde(default)]
    pub repository: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineRequirement {
    pub baram: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TiptapExtensionDef {
    #[serde(rename = "type")]
    pub ext_type: String, // "node" | "mark" | "plugin"
    pub name: String,
    #[serde(rename = "exportName")]
    pub export_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPluginInfo {
    pub manifest: PluginManifest,
    pub install_path: String,
    pub checksum: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub license: String,
    pub download_url: String,
    pub checksum: String,
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub downloads: u64,
    #[serde(default)]
    pub repository: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    pub engines: EngineRequirement,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryIndex {
    pub plugins: Vec<RegistryEntry>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

/// Returns the plugin installation base directory: ~/.baram/plugins/
pub fn get_plugin_dir() -> Result<PathBuf, PluginError> {
    let home = dirs_next().ok_or_else(|| PluginError::Io(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        "Could not determine home directory",
    )))?;
    let plugin_dir = home.join(".baram").join("plugins");
    if !plugin_dir.exists() {
        std::fs::create_dir_all(&plugin_dir)?;
    }
    Ok(plugin_dir)
}

fn dirs_next() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

/// Download a plugin ZIP from URL, verify checksum, extract to plugin dir.
pub async fn install_plugin(url: &str, expected_checksum: Option<&str>) -> Result<InstalledPluginInfo, PluginError> {
    // 1. Download ZIP to temp file
    let response = reqwest::get(url).await?;
    let bytes = response.bytes().await?;

    // 2. Verify checksum if provided
    let actual_checksum = hex_sha256(&bytes);
    if let Some(expected) = expected_checksum {
        if actual_checksum != expected {
            return Err(PluginError::ChecksumMismatch {
                expected: expected.to_string(),
                actual: actual_checksum,
            });
        }
    }

    // 3. Extract to temp dir first to read manifest
    let temp_dir = tempfile::tempdir()?;
    extract_zip_bytes(&bytes, temp_dir.path())?;

    // 4. Read manifest
    let manifest_path = temp_dir.path().join("baram-plugin.json");
    if !manifest_path.exists() {
        return Err(PluginError::InvalidManifest(
            "baram-plugin.json not found in archive".to_string(),
        ));
    }
    let manifest_str = std::fs::read_to_string(&manifest_path)?;
    let manifest: PluginManifest = serde_json::from_str(&manifest_str)?;

    // 5. Validate manifest
    validate_manifest(&manifest)?;

    // 6. Move to final location
    let plugin_dir = get_plugin_dir()?;
    let target_dir = plugin_dir.join(&manifest.id);
    if target_dir.exists() {
        std::fs::remove_dir_all(&target_dir)?;
    }

    // Copy temp dir contents to target
    copy_dir_recursive(temp_dir.path(), &target_dir)?;

    Ok(InstalledPluginInfo {
        install_path: target_dir.to_string_lossy().to_string(),
        checksum: actual_checksum,
        manifest,
    })
}

/// Uninstall a plugin by removing its directory.
pub async fn uninstall_plugin(plugin_id: &str) -> Result<(), PluginError> {
    let plugin_dir = get_plugin_dir()?;
    let target_dir = plugin_dir.join(plugin_id);
    if !target_dir.exists() {
        return Err(PluginError::NotFound(plugin_id.to_string()));
    }
    std::fs::remove_dir_all(&target_dir)?;
    Ok(())
}

/// List all installed plugins by reading their manifests.
pub async fn list_installed() -> Result<Vec<InstalledPluginInfo>, PluginError> {
    let plugin_dir = get_plugin_dir()?;
    if !plugin_dir.exists() {
        return Ok(Vec::new());
    }

    let mut plugins = Vec::new();
    let entries = std::fs::read_dir(&plugin_dir)?;
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("baram-plugin.json");
        if !manifest_path.exists() {
            continue;
        }
        match std::fs::read_to_string(&manifest_path) {
            Ok(content) => match serde_json::from_str::<PluginManifest>(&content) {
                Ok(manifest) => {
                    // Compute checksum of the manifest file for integrity
                    let checksum = hex_sha256(content.as_bytes());
                    plugins.push(InstalledPluginInfo {
                        manifest,
                        install_path: path.to_string_lossy().to_string(),
                        checksum,
                    });
                }
                Err(_) => continue,
            },
            Err(_) => continue,
        }
    }
    Ok(plugins)
}

/// Read manifest for a specific installed plugin.
pub async fn read_manifest(plugin_id: &str) -> Result<PluginManifest, PluginError> {
    let plugin_dir = get_plugin_dir()?;
    let manifest_path = plugin_dir.join(plugin_id).join("baram-plugin.json");
    if !manifest_path.exists() {
        return Err(PluginError::NotFound(plugin_id.to_string()));
    }
    let content = std::fs::read_to_string(&manifest_path)?;
    let manifest: PluginManifest = serde_json::from_str(&content)?;
    Ok(manifest)
}

/// Fetch registry index.json from a URL. Caching is handled at the frontend level.
pub async fn fetch_registry(url: &str) -> Result<RegistryIndex, PluginError> {
    let response = reqwest::get(url).await?;
    let status = response.status();
    if !status.is_success() {
        return Err(PluginError::InvalidManifest(format!(
            "Registry returned HTTP {status}"
        )));
    }
    let text = response.text().await?;
    let index: RegistryIndex = serde_json::from_str(&text)?;
    Ok(index)
}

// --- Helper functions ---

fn hex_sha256(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

fn extract_zip_bytes(data: &[u8], output_dir: &Path) -> Result<(), PluginError> {
    let cursor = std::io::Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor)?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let Some(enclosed_name) = file.enclosed_name() else {
            continue; // skip invalid paths (path traversal protection)
        };
        let out_path = output_dir.join(enclosed_name);

        if file.is_dir() {
            std::fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut buf = Vec::new();
            file.read_to_end(&mut buf)?;
            std::fs::write(&out_path, &buf)?;
        }
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), PluginError> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

fn validate_manifest(manifest: &PluginManifest) -> Result<(), PluginError> {
    if manifest.id.is_empty() {
        return Err(PluginError::InvalidManifest("id is required".to_string()));
    }
    if manifest.name.is_empty() {
        return Err(PluginError::InvalidManifest("name is required".to_string()));
    }
    if manifest.version.is_empty() {
        return Err(PluginError::InvalidManifest("version is required".to_string()));
    }
    if manifest.main.is_empty() {
        return Err(PluginError::InvalidManifest("main is required".to_string()));
    }
    // Validate ID format: lowercase alphanumeric + hyphens
    if !manifest.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        return Err(PluginError::InvalidManifest(
            "id must contain only lowercase letters, digits, and hyphens".to_string(),
        ));
    }
    // Validate capabilities
    let valid_caps = [
        "editor", "editor:readonly", "files", "files:readonly",
        "commands", "sidebar", "statusbar", "settings",
        "events", "ai", "network",
    ];
    for cap in &manifest.capabilities {
        if !valid_caps.contains(&cap.as_str()) {
            return Err(PluginError::InvalidManifest(
                format!("unknown capability: {cap}"),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_manifest_valid() {
        let manifest = PluginManifest {
            id: "baram-word-count".to_string(),
            name: "Word Count".to_string(),
            description: "Counts words".to_string(),
            version: "1.0.0".to_string(),
            author: "Test".to_string(),
            license: "MIT".to_string(),
            main: "index.mjs".to_string(),
            engines: EngineRequirement { baram: ">=0.2.0".to_string() },
            capabilities: vec!["editor:readonly".to_string(), "statusbar".to_string()],
            dependencies: vec![],
            tiptap_extensions: vec![],
            repository: None,
            homepage: None,
            icon: None,
            keywords: vec![],
        };
        assert!(validate_manifest(&manifest).is_ok());
    }

    #[test]
    fn test_validate_manifest_empty_id() {
        let manifest = PluginManifest {
            id: "".to_string(),
            name: "Test".to_string(),
            description: "".to_string(),
            version: "1.0.0".to_string(),
            author: "".to_string(),
            license: "MIT".to_string(),
            main: "index.mjs".to_string(),
            engines: EngineRequirement { baram: ">=0.2.0".to_string() },
            capabilities: vec![],
            dependencies: vec![],
            tiptap_extensions: vec![],
            repository: None,
            homepage: None,
            icon: None,
            keywords: vec![],
        };
        assert!(validate_manifest(&manifest).is_err());
    }

    #[test]
    fn test_validate_manifest_invalid_capability() {
        let manifest = PluginManifest {
            id: "test-plugin".to_string(),
            name: "Test".to_string(),
            description: "".to_string(),
            version: "1.0.0".to_string(),
            author: "".to_string(),
            license: "MIT".to_string(),
            main: "index.mjs".to_string(),
            engines: EngineRequirement { baram: ">=0.2.0".to_string() },
            capabilities: vec!["dangerous-capability".to_string()],
            dependencies: vec![],
            tiptap_extensions: vec![],
            repository: None,
            homepage: None,
            icon: None,
            keywords: vec![],
        };
        assert!(validate_manifest(&manifest).is_err());
    }

    #[test]
    fn test_validate_manifest_invalid_id_format() {
        let manifest = PluginManifest {
            id: "Test_Plugin".to_string(),
            name: "Test".to_string(),
            description: "".to_string(),
            version: "1.0.0".to_string(),
            author: "".to_string(),
            license: "MIT".to_string(),
            main: "index.mjs".to_string(),
            engines: EngineRequirement { baram: ">=0.2.0".to_string() },
            capabilities: vec![],
            dependencies: vec![],
            tiptap_extensions: vec![],
            repository: None,
            homepage: None,
            icon: None,
            keywords: vec![],
        };
        assert!(validate_manifest(&manifest).is_err());
    }

    #[test]
    fn test_hex_sha256() {
        let hash = hex_sha256(b"hello");
        assert_eq!(hash, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    }
}
