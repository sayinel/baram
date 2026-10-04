// §387 The commands. Each returns the envelope its `--json` form prints and writes
// nothing itself, so the same functions can back another front end (MCP — spec 0066 D9).

use super::app_config::AppConfig;
use super::output::{Envelope, Row, VaultInfo};
use super::vault::{RootKind, Vault};
use crate::context::manager::resolve_canonical;
use serde::Serialize;
use std::path::Path;

pub(crate) fn vault_info(vault: &Vault) -> VaultInfo {
    VaultInfo {
        name: vault.name.clone(),
        path: vault.root.to_string_lossy().into_owned(),
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct VaultRow {
    pub name: String,
    pub path: String,
    pub alias: Option<String>,
    #[serde(rename = "type")]
    pub kind: &'static str,
    /// The vault this run resolved to.
    pub current: bool,
    /// The context that was active in the app when it last wrote config.json.
    pub active: bool,
    pub exists: bool,
}

impl Row for VaultRow {
    fn fields(&self) -> Vec<String> {
        vec![
            if self.current {
                "*".to_string()
            } else {
                String::new()
            },
            self.name.clone(),
            self.kind.to_string(),
            self.path.clone(),
        ]
    }
}

/// `baram vaults` — the roots registered in the app, sorted by (name, path). `path` is
/// the registered spelling; the envelope's `vault.path` is the canonical one.
pub(crate) fn vaults(config: &AppConfig, current: Option<&Vault>) -> Envelope<VaultRow> {
    let mut items: Vec<VaultRow> = config
        .registered
        .iter()
        .map(|entry| {
            let exists = Path::new(&entry.path).is_dir();
            let canonical = if exists {
                resolve_canonical(&entry.path).ok()
            } else {
                None
            };
            VaultRow {
                name: entry.label.clone(),
                path: entry.path.clone(),
                alias: entry.alias.clone(),
                kind: match entry.kind {
                    RootKind::Vault => "vault",
                    RootKind::Folder => "folder",
                },
                current: current
                    .is_some_and(|vault| canonical.as_deref() == Some(vault.root.as_path())),
                active: config.active_id.as_deref() == Some(entry.id.as_str()),
                exists,
            }
        })
        .collect();
    items.sort_by(|a, b| {
        (a.name.as_str(), a.path.as_str()).cmp(&(b.name.as_str(), b.path.as_str()))
    });
    Envelope {
        vault: current.map(vault_info),
        truncated: false,
        items,
    }
}

#[cfg(test)]
mod tests {
    use super::super::vault::Registered;
    use super::*;

    fn entry(name: &str, path: &str) -> Registered {
        Registered {
            id: format!("ctx-{name}{path}"),
            label: name.to_string(),
            alias: None,
            path: path.to_string(),
            kind: RootKind::Vault,
        }
    }

    /// The input is the expected order turned around twice: `b` before `a`, and the two
    /// `a`s with their paths reversed, so the name order and the path tie-break each have
    /// something to undo.
    #[test]
    fn vaults_come_out_by_name_then_path_whatever_order_config_json_gave() {
        let config = AppConfig {
            registered: vec![entry("b", "/2"), entry("a", "/9"), entry("a", "/1")],
            ..AppConfig::default()
        };
        let order: Vec<(String, String)> = vaults(&config, None)
            .items
            .into_iter()
            .map(|row| (row.name, row.path))
            .collect();
        assert_eq!(
            order,
            [("a", "/1"), ("a", "/9"), ("b", "/2")]
                .map(|(name, path)| (name.to_string(), path.to_string()))
        );
    }
}
