//! The entries the link index holds and the results it hands the frontend (§29).

use serde::Serialize;

use super::LinkKind;

/// A single link found in a source file (wikilink, block ref, or block embed)
#[derive(Debug, Clone, Serialize)]
pub struct LinkEntry {
    /// The file containing the link
    pub source_path: String,
    /// The target referenced by the link
    pub target: String,
    /// Line number (1-based)
    pub line: u32,
    /// Context text around the link
    pub context: String,
    /// The grammar the link was read with — on the wire, the strings the
    /// frontend has always seen (`LinkKind` serializes as camelCase)
    pub link_type: LinkKind,
    /// Block ID for block refs/embeds (e.g., "abc123" from ^abc123)
    pub block_id: Option<String>,
    /// §87 Vault alias for cross-vault links (e.g., "journal" from [[journal::note]])
    pub target_vault_alias: Option<String>,
}

/// Backlink entry returned to the frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkResult {
    pub source_path: String,
    pub target_path: String,
    pub context: String,
    pub line: u32,
    pub link_type: LinkKind,
    pub block_id: Option<String>,
}

/// Link graph for the frontend
#[derive(Debug, Clone, Serialize, Default)]
pub struct LinkGraph {
    pub nodes: Vec<String>,
    pub edges: Vec<LinkEdge>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkEdge {
    pub from: String,
    pub to: String,
    /// §87 True when this edge is a cross-vault link
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub cross_vault: bool,
}

/// Index build statistics
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    pub files_indexed: u32,
    pub links_found: u32,
    pub duration: u64, // milliseconds
}
