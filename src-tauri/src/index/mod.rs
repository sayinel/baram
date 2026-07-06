// §29 인메모리 링크 인덱스 — Vault 내 [[wikilink]] 추출 및 백링크 조회
//
// 전략: Vault 열기 시 전체 .md 파일 스캔 → 인메모리 HashMap 저장
//       파일 저장 시 해당 파일만 증분 업데이트

mod extractor;
mod normalizer;

use serde::Serialize;
use std::collections::HashMap;
use thiserror::Error;

// Re-export public API consumed by commands/index_cmd.rs
pub use extractor::{
    collect_md_files, find_unlinked_mentions, replace_block_id_refs, replace_wikilink_target,
    rewrite_relative_wikilinks, UnlinkedMentionResult,
};

use extractor::{extract_file_tags, extract_links};
use normalizer::{
    extract_id_from_stem, is_id_target, normalize_file_path, normalize_target, resolve_target,
};

#[derive(Error, Debug)]
pub enum IndexError {
    #[error("파일 읽기 실패: {0}")]
    IoError(#[from] std::io::Error),
}

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
    /// Link type: "wikilink", "blockRef", "blockEmbed"
    pub link_type: String,
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
    pub link_type: String,
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

/// The in-memory link index
#[derive(Debug, Default)]
pub struct LinkIndex {
    /// source_path → list of links found in that file
    outgoing: HashMap<String, Vec<LinkEntry>>,
    /// target (normalized filename without .md) → list of backlinks
    incoming: HashMap<String, Vec<LinkEntry>>,
    /// Root path of the vault
    root_path: Option<String>,
    /// Normalized file stem (lowercase, no extension) → list of absolute file paths
    /// Used to resolve [[name]] style wikilinks to actual file locations in subdirectories
    file_map: HashMap<String, Vec<String>>,
    /// Normalized relative path (lowercase, no extension) → absolute file path
    /// Used to resolve [[path/name]] style wikilinks (e.g., [[notes/architecture]])
    relative_map: HashMap<String, String>,
    /// Note id (12–14 digit filename prefix) → absolute file path (Zettelkasten `[[ID]]` links)
    id_map: HashMap<String, String>,
    /// file_path → list of tags found in that file (for graph tag nodes)
    file_tags: HashMap<String, Vec<String>>,
}

impl LinkIndex {
    pub fn new() -> Self {
        Self::default()
    }

    /// Build the full index by scanning all .md files under root_path
    pub async fn build(&mut self, root_path: &str) -> Result<IndexStats, IndexError> {
        let start = std::time::Instant::now();
        self.root_path = Some(root_path.to_string());
        self.outgoing.clear();
        self.incoming.clear();
        self.file_map.clear();
        self.relative_map.clear();
        self.id_map.clear();
        self.file_tags.clear();

        let mut files_indexed: u32 = 0;
        let mut links_found: u32 = 0;

        // Collect all .md files
        let md_files = collect_md_files(root_path).await?;

        // Build file maps for wikilink target resolution
        for file_path in &md_files {
            self.register_file_path(file_path, root_path);
        }

        for file_path in &md_files {
            let content = match tokio::fs::read_to_string(file_path).await {
                Ok(c) => c,
                Err(_) => continue, // skip unreadable files
            };

            let entries = extract_links(file_path, &content);
            links_found += entries.len() as u32;

            // Build incoming index
            for entry in &entries {
                let normalized = normalize_target(&entry.target);
                self.incoming
                    .entry(normalized)
                    .or_default()
                    .push(entry.clone());
            }

            self.outgoing.insert(file_path.clone(), entries);

            // Extract tags for graph tag nodes
            let tags = extract_file_tags(&content);
            if !tags.is_empty() {
                self.file_tags.insert(file_path.clone(), tags);
            }

            files_indexed += 1;
        }

        let duration = start.elapsed().as_millis() as u64;
        Ok(IndexStats {
            files_indexed,
            links_found,
            duration,
        })
    }

    /// Remove a file from the index
    pub fn remove_file(&mut self, file_path: &str) {
        self.outgoing.remove(file_path);
        // Remove from incoming: filter out entries with this source_path
        for entries in self.incoming.values_mut() {
            entries.retain(|e| e.source_path != file_path);
        }
        // Clean up empty keys
        self.incoming.retain(|_, v| !v.is_empty());

        // Remove from file maps
        let stem = normalize_file_path(file_path);
        if let Some(paths) = self.file_map.get_mut(&stem) {
            paths.retain(|p| p != file_path);
            if paths.is_empty() {
                self.file_map.remove(&stem);
            }
        }
        self.relative_map.retain(|_, v| v != file_path);
        self.id_map.retain(|_, v| v != file_path);
        self.file_tags.remove(file_path);
    }

    /// Get backlinks for a given file path
    pub fn get_backlinks(&self, file_path: &str) -> Vec<BacklinkResult> {
        let stem = normalize_file_path(file_path);
        let mut keys = vec![stem.clone()];
        if let Some(id) = extract_id_from_stem(&stem) {
            keys.push(id);
        }

        let mut seen = std::collections::HashSet::new();
        let mut results = Vec::new();
        for key in keys {
            if let Some(entries) = self.incoming.get(&key) {
                for e in entries {
                    if seen.insert((e.source_path.clone(), e.line)) {
                        results.push(BacklinkResult {
                            source_path: e.source_path.clone(),
                            target_path: file_path.to_string(),
                            context: e.context.clone(),
                            line: e.line,
                            link_type: e.link_type.clone(),
                            block_id: e.block_id.clone(),
                        });
                    }
                }
            }
        }
        results
    }

    /// Register a file path in file_map and relative_map for target resolution
    fn register_file_path(&mut self, file_path: &str, root_path: &str) {
        let stem = normalize_file_path(file_path);
        let paths = self.file_map.entry(stem.clone()).or_default();
        if !paths.contains(&file_path.to_string()) {
            paths.push(file_path.to_string());
        }

        // Build relative path mapping (e.g., "notes/architecture" → "/vault/notes/architecture.md")
        if let Some(rel) = file_path.strip_prefix(root_path) {
            let rel = rel
                .strip_prefix('/')
                .or_else(|| rel.strip_prefix('\\'))
                .unwrap_or(rel);
            let rel_normalized = rel
                .strip_suffix(".md")
                .or_else(|| rel.strip_suffix(".markdown"))
                .unwrap_or(rel)
                .to_lowercase();
            self.relative_map
                .insert(rel_normalized, file_path.to_string());
        }

        // Register id → path for [[ID]] resolution (Zettelkasten)
        if let Some(id) = extract_id_from_stem(&stem) {
            self.id_map.insert(id, file_path.to_string());
        }
    }

    #[cfg(test)]
    pub(crate) fn id_map_len(&self) -> usize {
        self.id_map.len()
    }

    /// Resolve a wikilink target to an actual file path using file maps.
    /// Falls back to None if no matching file is found.
    fn resolve_target_from_map(&self, target_normalized: &str) -> Option<String> {
        // 0) Zettelkasten [[ID]] — bare timestamp id resolves via id_map (subfolder-agnostic)
        if is_id_target(target_normalized) {
            if let Some(path) = self.id_map.get(target_normalized) {
                return Some(path.clone());
            }
        }

        // 1) Try relative path match (for [[path/name]] style targets)
        if let Some(path) = self.relative_map.get(target_normalized) {
            return Some(path.clone());
        }

        // 2) Extract stem (last path component) for stem-only lookup
        let stem = target_normalized
            .rsplit('/')
            .next()
            .unwrap_or(target_normalized);

        // 3) Look up in file_map
        if let Some(paths) = self.file_map.get(stem) {
            if !paths.is_empty() {
                return Some(paths[0].clone());
            }
        }

        None
    }

    /// Get the full link graph
    pub fn get_link_graph(&self) -> LinkGraph {
        let mut nodes_set = std::collections::HashSet::new();
        let mut edges = Vec::new();

        for (source, entries) in &self.outgoing {
            nodes_set.insert(source.clone());
            for entry in entries {
                let target_normalized = normalize_target(&entry.target);
                if let Some(root) = &self.root_path {
                    // Use file maps for accurate resolution, fall back to simple path construction
                    let target_path = self
                        .resolve_target_from_map(&target_normalized)
                        .unwrap_or_else(|| resolve_target(root, &target_normalized));
                    nodes_set.insert(target_path.clone());
                    edges.push(LinkEdge {
                        from: source.clone(),
                        to: target_path,
                        cross_vault: entry.target_vault_alias.is_some(),
                    });
                }
            }
        }

        // Add tag virtual nodes and file→tag edges
        for (file_path, tags) in &self.file_tags {
            if !nodes_set.contains(file_path) {
                continue; // skip files not in graph
            }
            for tag in tags {
                let tag_node_id = format!("tag:{}", tag);
                nodes_set.insert(tag_node_id.clone());
                edges.push(LinkEdge {
                    from: file_path.clone(),
                    to: tag_node_id,
                    cross_vault: false,
                });
            }
        }

        LinkGraph {
            nodes: nodes_set.into_iter().collect(),
            edges,
        }
    }

    /// §33 Get list of source files that link to a given target (normalized)
    pub fn get_files_linking_to(&self, target: &str) -> Vec<String> {
        let normalized = normalize_target(target);
        self.incoming
            .get(&normalized)
            .map(|entries| {
                let mut paths: Vec<String> =
                    entries.iter().map(|e| e.source_path.clone()).collect();
                paths.sort();
                paths.dedup();
                paths
            })
            .unwrap_or_default()
    }

    /// Update index for a single file using already-read content (sync, no I/O)
    pub fn update_file_from_content(&mut self, file_path: &str, content: &str) {
        self.remove_file(file_path);

        // Re-register in file maps for target resolution
        if let Some(root) = self.root_path.clone() {
            self.register_file_path(file_path, &root);
        }

        let entries = extract_links(file_path, content);
        for entry in &entries {
            let normalized = normalize_target(&entry.target);
            self.incoming
                .entry(normalized)
                .or_default()
                .push(entry.clone());
        }
        self.outgoing.insert(file_path.to_string(), entries);

        // Extract tags for graph tag nodes
        let tags = extract_file_tags(content);
        if !tags.is_empty() {
            self.file_tags.insert(file_path.to_string(), tags);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backlinks_lookup() {
        let mut index = LinkIndex::new();

        // Manually insert entries
        let entry = LinkEntry {
            source_path: "/vault/overview.md".to_string(),
            target: "architecture".to_string(),
            line: 5,
            context: "See [[architecture]] for details".to_string(),
            link_type: "wikilink".to_string(),
            block_id: None,
            target_vault_alias: None,
        };
        index
            .outgoing
            .entry("/vault/overview.md".to_string())
            .or_default()
            .push(entry.clone());
        index
            .incoming
            .entry("architecture".to_string())
            .or_default()
            .push(entry);

        let backlinks = index.get_backlinks("/vault/architecture.md");
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].source_path, "/vault/overview.md");
    }

    // §33 get_files_linking_to tests
    #[test]
    fn test_get_files_linking_to() {
        let mut index = LinkIndex::new();

        // a.md links to "target", b.md links to "target", c.md links to "other"
        index.update_file_from_content("/vault/a.md", "See [[target]] here.");
        index.update_file_from_content("/vault/b.md", "Also [[target|alias]].");
        index.update_file_from_content("/vault/c.md", "Unrelated [[other]].");

        let mut files = index.get_files_linking_to("target");
        files.sort();
        assert_eq!(files, vec!["/vault/a.md", "/vault/b.md"]);

        // Case-insensitive
        let files2 = index.get_files_linking_to("Target");
        assert_eq!(files2.len(), 2);

        // No match
        let files3 = index.get_files_linking_to("nonexistent");
        assert!(files3.is_empty());
    }

    #[test]
    fn test_remove_file() {
        let mut index = LinkIndex::new();

        let entry = LinkEntry {
            source_path: "/vault/a.md".to_string(),
            target: "b".to_string(),
            line: 1,
            context: "[[b]]".to_string(),
            link_type: "wikilink".to_string(),
            block_id: None,
            target_vault_alias: None,
        };
        index
            .outgoing
            .entry("/vault/a.md".to_string())
            .or_default()
            .push(entry.clone());
        index
            .incoming
            .entry("b".to_string())
            .or_default()
            .push(entry);

        index.remove_file("/vault/a.md");
        assert!(!index.outgoing.contains_key("/vault/a.md"));
        assert!(index.get_backlinks("/vault/b.md").is_empty());
    }

    // --- File map target resolution tests ---

    #[test]
    fn test_resolve_target_stem_only() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        index.register_file_path("/vault/notes/architecture.md", "/vault");

        let resolved = index.resolve_target_from_map("architecture");
        assert_eq!(resolved, Some("/vault/notes/architecture.md".to_string()));
    }

    #[test]
    fn test_resolve_target_with_relative_path() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        index.register_file_path("/vault/notes/architecture.md", "/vault");

        let resolved = index.resolve_target_from_map("notes/architecture");
        assert_eq!(resolved, Some("/vault/notes/architecture.md".to_string()));
    }

    #[test]
    fn test_resolve_target_not_found() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        index.register_file_path("/vault/notes/architecture.md", "/vault");

        let resolved = index.resolve_target_from_map("nonexistent");
        assert_eq!(resolved, None);
    }

    #[test]
    fn test_resolve_target_multiple_same_stem() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        index.register_file_path("/vault/a/readme.md", "/vault");
        index.register_file_path("/vault/b/readme.md", "/vault");

        // Stem-only: returns first registered
        let resolved = index.resolve_target_from_map("readme");
        assert!(resolved.is_some());

        // With relative path: resolves to specific one
        let resolved_a = index.resolve_target_from_map("a/readme");
        assert_eq!(resolved_a, Some("/vault/a/readme.md".to_string()));

        let resolved_b = index.resolve_target_from_map("b/readme");
        assert_eq!(resolved_b, Some("/vault/b/readme.md".to_string()));
    }

    #[test]
    fn test_resolve_target_case_insensitive() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        index.register_file_path("/vault/Notes/My Note.md", "/vault");

        // normalize_target lowercases, so lookup should match
        let resolved = index.resolve_target_from_map("my note");
        assert_eq!(resolved, Some("/vault/Notes/My Note.md".to_string()));
    }

    #[test]
    fn test_link_graph_resolves_across_subdirs() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());

        // Register files in subdirectories
        index.register_file_path("/vault/notes/architecture.md", "/vault");
        index.register_file_path("/vault/daily/2024-01-15.md", "/vault");

        // Daily file links to architecture note via wikilink
        index.update_file_from_content(
            "/vault/daily/2024-01-15.md",
            "Today I worked on [[architecture]].",
        );

        let graph = index.get_link_graph();

        // The edge should point to the actual file in notes/, not ghost at /vault/architecture.md
        assert!(
            graph
                .edges
                .iter()
                .any(|e| e.from == "/vault/daily/2024-01-15.md"
                    && e.to == "/vault/notes/architecture.md"),
            "Edge should resolve to actual file path: {:?}",
            graph.edges
        );

        // No ghost node at /vault/architecture.md
        assert!(
            !graph.nodes.contains(&"/vault/architecture.md".to_string()),
            "Should not create ghost node at root level"
        );
    }

    #[test]
    fn test_link_graph_chain_daily_note_subnote() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());

        // Register all files
        index.register_file_path("/vault/daily/2024-01-15.md", "/vault");
        index.register_file_path("/vault/notes/project-x.md", "/vault");
        index.register_file_path("/vault/notes/sub/design.md", "/vault");

        // daily → project-x → design chain
        index
            .update_file_from_content("/vault/daily/2024-01-15.md", "Started [[project-x]] today.");
        index.update_file_from_content("/vault/notes/project-x.md", "See [[design]] for details.");

        let graph = index.get_link_graph();

        // Both edges should resolve to actual files
        assert!(
            graph
                .edges
                .iter()
                .any(|e| e.from == "/vault/daily/2024-01-15.md"
                    && e.to == "/vault/notes/project-x.md")
        );
        assert!(
            graph
                .edges
                .iter()
                .any(|e| e.from == "/vault/notes/project-x.md"
                    && e.to == "/vault/notes/sub/design.md")
        );
    }

    #[test]
    fn test_file_map_updated_on_remove() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        index.register_file_path("/vault/notes/architecture.md", "/vault");

        assert!(index.resolve_target_from_map("architecture").is_some());

        index.remove_file("/vault/notes/architecture.md");

        assert_eq!(index.resolve_target_from_map("architecture"), None);
    }

    // §87 Cross-vault alias in index
    #[test]
    fn test_cross_vault_link_indexed() {
        let mut index = LinkIndex::new();
        index.update_file_from_content("/vault/a.md", "See [[journal::2026-03-22]] here.");

        let outgoing = index.outgoing.get("/vault/a.md").unwrap();
        assert_eq!(outgoing.len(), 1);
        assert_eq!(outgoing[0].target, "2026-03-22");
        assert_eq!(outgoing[0].target_vault_alias, Some("journal".to_string()));
    }

    #[test]
    fn test_id_map_populated_and_cleared() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/z".to_string());
        index.register_file_path("/z/notes/202607051530 원자적 노트.md", "/z");
        index.register_file_path("/z/inbox/202607051531.md", "/z");
        index.register_file_path("/z/notes/architecture.md", "/z"); // no id
        assert_eq!(index.id_map_len(), 2);
        index.remove_file("/z/notes/202607051530 원자적 노트.md");
        assert_eq!(index.id_map_len(), 1);
    }

    #[test]
    fn test_resolve_id_target_across_subfolders() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/z".to_string());
        index.register_file_path("/z/notes/202607051530 원자적 노트.md", "/z");
        // [[202607051530]] resolves to the id-prefixed file in the subfolder
        assert_eq!(
            index.resolve_target_from_map("202607051530"),
            Some("/z/notes/202607051530 원자적 노트.md".to_string())
        );
        // a non-id target is unaffected (existing stem/relative behavior)
        index.register_file_path("/z/architecture.md", "/z");
        assert_eq!(
            index.resolve_target_from_map("architecture"),
            Some("/z/architecture.md".to_string())
        );
    }

    #[test]
    fn test_backlinks_by_id() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/z".to_string());
        index.register_file_path("/z/notes/202607051530 원자적 노트.md", "/z");
        index.register_file_path("/z/notes/202607051600 다른 노트.md", "/z");
        // "다른 노트" links to the first note via [[202607051530]]
        index.update_file_from_content(
            "/z/notes/202607051600 다른 노트.md",
            "본문 [[202607051530]] 참조",
        );
        let backlinks = index.get_backlinks("/z/notes/202607051530 원자적 노트.md");
        assert_eq!(backlinks.len(), 1);
        assert_eq!(
            backlinks[0].source_path,
            "/z/notes/202607051600 다른 노트.md"
        );
    }

    #[test]
    fn test_file_map_updated_on_incremental_update() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());

        // Simulate adding a new file via incremental update
        index.update_file_from_content("/vault/notes/new-note.md", "Some content with [[other]].");

        // The new file should be in the file map
        let resolved = index.resolve_target_from_map("new-note");
        assert_eq!(resolved, Some("/vault/notes/new-note.md".to_string()));
    }
}
