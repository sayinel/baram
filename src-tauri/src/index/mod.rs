// §29 인메모리 링크 인덱스 — Vault 내 [[wikilink]] 추출 및 백링크 조회
//
// 전략: Vault 열기 시 전체 .md 파일 스캔 → 인메모리 HashMap 저장
//       파일 저장 시 해당 파일만 증분 업데이트

use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::LazyLock;
use thiserror::Error;

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
#[derive(Debug, Clone, Serialize)]
pub struct LinkGraph {
    pub nodes: Vec<String>,
    pub edges: Vec<LinkEdge>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinkEdge {
    pub from: String,
    pub to: String,
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
}

// Wikilink regex: [[target]], [[target|display]], [[target#heading]], etc.
static WIKILINK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[\[([^\]|#^]+)(?:#[^\]|^]+)?(?:\^[^\]|]+)?(?:\|[^\]]+)?\]\]").unwrap()
});

// §30c Block reference regex: ((target#^blockId)) or ((target#^blockId|display)) or ((#^blockId))
static BLOCK_REF_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\(\(([^)#|]*?)#\^([a-zA-Z0-9][\w-]*)(?:\|[^)]+)?\)\)").unwrap()
});

// §30c Block embed regex: {{embed ((target#^blockId))}}
static BLOCK_EMBED_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\{\{embed \(\(([^)#|]*?)#\^([a-zA-Z0-9][\w-]*)\)\)\}\}").unwrap()
});

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
    }

    /// Get backlinks for a given file path
    pub fn get_backlinks(&self, file_path: &str) -> Vec<BacklinkResult> {
        let normalized = normalize_file_path(file_path);

        self.incoming
            .get(&normalized)
            .map(|entries| {
                entries
                    .iter()
                    .map(|e| BacklinkResult {
                        source_path: e.source_path.clone(),
                        target_path: file_path.to_string(),
                        context: e.context.clone(),
                        line: e.line,
                        link_type: e.link_type.clone(),
                        block_id: e.block_id.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Register a file path in file_map and relative_map for target resolution
    fn register_file_path(&mut self, file_path: &str, root_path: &str) {
        let stem = normalize_file_path(file_path);
        let paths = self.file_map.entry(stem).or_default();
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
    }

    /// Resolve a wikilink target to an actual file path using file maps.
    /// Falls back to None if no matching file is found.
    fn resolve_target_from_map(&self, target_normalized: &str) -> Option<String> {
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
                    });
                }
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
                let mut paths: Vec<String> = entries
                    .iter()
                    .map(|e| e.source_path.clone())
                    .collect();
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
    }
}

/// Build a truncated context string from a line
fn build_context(line: &str) -> String {
    let context = line.trim().to_string();
    if context.len() > 200 {
        let mut end = 200;
        while !context.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}…", &context[..end])
    } else {
        context
    }
}

/// Get the file stem (name without .md extension) from a path
fn file_stem_from_path(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Extract all links (wikilinks, block refs, block embeds) from file content
fn extract_links(file_path: &str, content: &str) -> Vec<LinkEntry> {
    let mut entries = Vec::new();
    let lines: Vec<&str> = content.lines().collect();

    for (line_idx, line) in lines.iter().enumerate() {
        // §29 Wikilinks: [[target]], [[target|display]], etc.
        for cap in WIKILINK_RE.captures_iter(line) {
            let target = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
            if target.is_empty() {
                continue;
            }

            entries.push(LinkEntry {
                source_path: file_path.to_string(),
                target: target.to_string(),
                line: (line_idx + 1) as u32,
                context: build_context(line),
                link_type: "wikilink".to_string(),
                block_id: None,
            });
        }

        // §30c Block embeds first (so we can skip them in block ref matching)
        for cap in BLOCK_EMBED_RE.captures_iter(line) {
            let raw_target = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
            let block_id = cap.get(2).map(|m| m.as_str()).unwrap_or("");
            if block_id.is_empty() {
                continue;
            }

            // Self-ref ((#^id)) → use current file stem as target
            let target = if raw_target.is_empty() {
                file_stem_from_path(file_path)
            } else {
                raw_target.to_string()
            };

            entries.push(LinkEntry {
                source_path: file_path.to_string(),
                target,
                line: (line_idx + 1) as u32,
                context: build_context(line),
                link_type: "blockEmbed".to_string(),
                block_id: Some(block_id.to_string()),
            });
        }

        // §30c Block references: ((target#^blockId))
        for cap in BLOCK_REF_RE.captures_iter(line) {
            let raw_target = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
            let block_id = cap.get(2).map(|m| m.as_str()).unwrap_or("");
            if block_id.is_empty() {
                continue;
            }

            // Skip if this match is part of a block embed (already captured above)
            let match_start = cap.get(0).unwrap().start();
            if match_start >= 8 {
                let prefix = &line[..match_start];
                if prefix.ends_with("{{embed ") {
                    continue;
                }
            }

            // Self-ref ((#^id)) → use current file stem as target
            let target = if raw_target.is_empty() {
                file_stem_from_path(file_path)
            } else {
                raw_target.to_string()
            };

            entries.push(LinkEntry {
                source_path: file_path.to_string(),
                target,
                line: (line_idx + 1) as u32,
                context: build_context(line),
                link_type: "blockRef".to_string(),
                block_id: Some(block_id.to_string()),
            });
        }
    }

    entries
}

/// §33 Replace wikilink targets in file content.
/// Handles [[old]], [[old|display]], [[old#heading]], [[old#heading|display]], [[old^blockId]], etc.
/// Only replaces the target portion, preserving display, heading, and blockId.
pub fn replace_wikilink_target(content: &str, old_target: &str, new_target: &str) -> String {
    // Match all wikilink forms: [[target]], [[target|display]], [[target#heading]], etc.
    // We need a regex that captures the full wikilink and allows us to replace just the target part.
    static REPLACE_RE: LazyLock<Regex> = LazyLock::new(|| {
        // Capture groups: (1) target, (2) rest — #heading, ^blockId, |display in any combo
        Regex::new(r"\[\[([^\]|#^]+)((?:#[^\]|^]+)?(?:\^[^\]|]+)?(?:\|[^\]]+)?)\]\]").unwrap()
    });

    REPLACE_RE
        .replace_all(content, |caps: &regex::Captures| {
            let captured_target = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let rest = caps.get(2).map(|m| m.as_str()).unwrap_or("");

            // Case-insensitive comparison for target matching
            if captured_target.trim().eq_ignore_ascii_case(old_target.trim()) {
                format!("[[{}{rest}]]", new_target)
            } else {
                // No match — return original
                caps[0].to_string()
            }
        })
        .to_string()
}

/// §30a Replace block ID references in file content.
/// Updates ((target#^oldId)), ((target#^oldId|display)), ((#^oldId)),
/// and {{embed ((target#^oldId))}} patterns.
pub fn replace_block_id_refs(content: &str, old_id: &str, new_id: &str) -> String {
    // Regex: block embed — {{embed ((target#^ID))}}
    static EMBED_REPLACE_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\{\{embed \(\(([^)#|]*?)#\^([a-zA-Z0-9][\w-]*)\)\)\}\}").unwrap()
    });
    // Regex: block ref — ((target#^ID)) or ((target#^ID|display))
    static REF_REPLACE_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\(\(([^)#|]*?)#\^([a-zA-Z0-9][\w-]*)(\|[^)]+)?\)\)").unwrap()
    });

    let step1 = EMBED_REPLACE_RE.replace_all(content, |caps: &regex::Captures| {
        let target = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let id = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        if id == old_id {
            format!("{{{{embed (({target}#^{new_id}))}}}}")
        } else {
            caps[0].to_string()
        }
    });

    REF_REPLACE_RE
        .replace_all(&step1, |caps: &regex::Captures| {
            let target = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let id = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            let display = caps.get(3).map(|m| m.as_str()).unwrap_or("");
            if id == old_id {
                format!("(({target}#^{new_id}{display}))")
            } else {
                caps[0].to_string()
            }
        })
        .to_string()
}

/// Normalize a wikilink target to a comparable key (lowercase, no extension)
fn normalize_target(target: &str) -> String {
    let t = target.trim();
    let t = t.strip_suffix(".md").unwrap_or(t);
    t.to_lowercase()
}

/// Normalize a file path to match against wikilink targets
/// e.g., "/vault/notes/architecture.md" → "architecture"
fn normalize_file_path(path: &str) -> String {
    let file_name = Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    file_name.to_lowercase()
}

/// Resolve a wikilink target to a possible file path
fn resolve_target(root: &str, normalized_target: &str) -> String {
    format!("{}/{}.md", root, normalized_target)
}

/// §34 Unlinked mention result returned to the frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlinkedMentionResult {
    pub source_path: String,
    pub line: u32,
    pub context: String,
    pub match_text: String,
}

/// §34 Find unlinked mentions — text occurrences of a file stem in other files,
/// NOT inside [[wikilink]] brackets. Case-insensitive, word-boundary aware.
pub async fn find_unlinked_mentions(
    file_path: &str,
    root_path: &str,
) -> Result<Vec<UnlinkedMentionResult>, IndexError> {
    let stem = Path::new(file_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    if stem.is_empty() {
        return Ok(Vec::new());
    }

    let md_files = collect_md_files(root_path).await?;
    let mut results = Vec::new();

    // Build a word-boundary regex for the stem (case-insensitive)
    let escaped = regex::escape(&stem);
    let pattern = format!(r"(?i)\b{}\b", escaped);
    let stem_re = Regex::new(&pattern).map_err(|e| IndexError::IoError(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;

    for md_path in &md_files {
        // Skip the current file itself
        if md_path == file_path {
            continue;
        }

        let content = match tokio::fs::read_to_string(md_path).await {
            Ok(c) => c,
            Err(_) => continue,
        };

        for (line_idx, line) in content.lines().enumerate() {
            // Strip all [[...]] wikilinks from the line, replacing with spaces of same length
            let stripped = strip_wikilinks(line);

            // Search for the stem in the stripped text
            for mat in stem_re.find_iter(&stripped) {
                let context = line.trim().to_string();
                let context = if context.len() > 200 {
                    let mut end = 200;
                    while !context.is_char_boundary(end) {
                        end -= 1;
                    }
                    format!("{}…", &context[..end])
                } else {
                    context
                };

                results.push(UnlinkedMentionResult {
                    source_path: md_path.clone(),
                    line: (line_idx + 1) as u32,
                    context,
                    match_text: mat.as_str().to_string(),
                });

                // Only one mention per line to avoid duplicates
                break;
            }
        }
    }

    Ok(results)
}

/// Replace [[...]] wikilink blocks with spaces of the same byte length.
/// This allows searching for unlinked mentions without matching linked ones.
fn strip_wikilinks(line: &str) -> String {
    WIKILINK_RE.replace_all(line, |caps: &regex::Captures| {
        " ".repeat(caps[0].len())
    }).to_string()
}

/// Recursively collect all .md files under a root path
async fn collect_md_files(root: &str) -> Result<Vec<String>, IndexError> {
    let mut files = Vec::new();
    collect_md_files_inner(Path::new(root), &mut files).await?;
    Ok(files)
}

async fn collect_md_files_inner(
    dir: &Path,
    files: &mut Vec<String>,
) -> Result<(), IndexError> {
    let mut read_dir = tokio::fs::read_dir(dir).await?;
    while let Some(entry) = read_dir.next_entry().await? {
        let metadata = entry.metadata().await?;
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/dirs
        if name.starts_with('.') {
            continue;
        }

        // Skip heavy directories
        const SKIP_DIRS: &[&str] = &[
            "node_modules",
            "target",
            "build",
            "dist",
            "__pycache__",
            ".next",
        ];
        if metadata.is_dir() && SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }

        if metadata.is_dir() {
            Box::pin(collect_md_files_inner(&entry.path(), files)).await?;
        } else if name.ends_with(".md") || name.ends_with(".markdown") {
            files.push(entry.path().to_string_lossy().to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_links_basic() {
        let entries = extract_links("/test.md", "See [[architecture]] for details.");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].target, "architecture");
        assert_eq!(entries[0].line, 1);
        assert_eq!(entries[0].link_type, "wikilink");
        assert!(entries[0].block_id.is_none());
    }

    #[test]
    fn test_extract_links_with_display() {
        let entries = extract_links("/test.md", "Read [[arch|the doc]] here.");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].target, "arch");
    }

    #[test]
    fn test_extract_links_with_heading() {
        let entries = extract_links("/test.md", "See [[arch#intro]] and [[arch#summary|要約]].");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].target, "arch");
        assert_eq!(entries[1].target, "arch");
    }

    #[test]
    fn test_extract_links_multiple_per_line() {
        let entries = extract_links("/test.md", "Both [[foo]] and [[bar]] are important.");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].target, "foo");
        assert_eq!(entries[1].target, "bar");
    }

    #[test]
    fn test_extract_links_multiline() {
        let content = "Line 1\nSee [[target]] here\nLine 3\n[[another]]";
        let entries = extract_links("/test.md", content);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].line, 2);
        assert_eq!(entries[1].line, 4);
    }

    // §30c Block reference tests
    #[test]
    fn test_extract_block_refs() {
        let entries = extract_links("/test.md", "See ((notes#^abc123)) for context.");
        let block_refs: Vec<_> = entries.iter().filter(|e| e.link_type == "blockRef").collect();
        assert_eq!(block_refs.len(), 1);
        assert_eq!(block_refs[0].target, "notes");
        assert_eq!(block_refs[0].block_id, Some("abc123".to_string()));
    }

    #[test]
    fn test_extract_block_embeds() {
        let entries = extract_links("/test.md", "{{embed ((notes#^def456))}}");
        let embeds: Vec<_> = entries.iter().filter(|e| e.link_type == "blockEmbed").collect();
        assert_eq!(embeds.len(), 1);
        assert_eq!(embeds[0].target, "notes");
        assert_eq!(embeds[0].block_id, Some("def456".to_string()));
        // Embed should NOT also produce a blockRef
        let refs: Vec<_> = entries.iter().filter(|e| e.link_type == "blockRef").collect();
        assert_eq!(refs.len(), 0);
    }

    #[test]
    fn test_self_block_ref() {
        // ((#^id)) with empty target → self-reference to current file stem
        let entries = extract_links("/vault/notes.md", "See ((#^myid)) here.");
        let block_refs: Vec<_> = entries.iter().filter(|e| e.link_type == "blockRef").collect();
        assert_eq!(block_refs.len(), 1);
        assert_eq!(block_refs[0].target, "notes");
        assert_eq!(block_refs[0].block_id, Some("myid".to_string()));
    }

    #[test]
    fn test_mixed_links() {
        let content = "Link: [[foo]], ref: ((bar#^id1)), embed: {{embed ((baz#^id2))}}";
        let entries = extract_links("/test.md", content);
        let wikilinks: Vec<_> = entries.iter().filter(|e| e.link_type == "wikilink").collect();
        let refs: Vec<_> = entries.iter().filter(|e| e.link_type == "blockRef").collect();
        let embeds: Vec<_> = entries.iter().filter(|e| e.link_type == "blockEmbed").collect();
        assert_eq!(wikilinks.len(), 1);
        assert_eq!(wikilinks[0].target, "foo");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].target, "bar");
        assert_eq!(embeds.len(), 1);
        assert_eq!(embeds[0].target, "baz");
    }

    #[test]
    fn test_block_ref_with_display() {
        let entries = extract_links("/test.md", "See ((notes#^abc|my label)) here.");
        let block_refs: Vec<_> = entries.iter().filter(|e| e.link_type == "blockRef").collect();
        assert_eq!(block_refs.len(), 1);
        assert_eq!(block_refs[0].target, "notes");
        assert_eq!(block_refs[0].block_id, Some("abc".to_string()));
    }

    #[test]
    fn test_normalize_target() {
        assert_eq!(normalize_target("Architecture"), "architecture");
        assert_eq!(normalize_target("notes.md"), "notes");
        assert_eq!(normalize_target("  spaces  "), "spaces");
    }

    #[test]
    fn test_normalize_file_path() {
        assert_eq!(
            normalize_file_path("/vault/notes/architecture.md"),
            "architecture"
        );
        assert_eq!(normalize_file_path("/single.md"), "single");
        assert_eq!(normalize_file_path("relative.md"), "relative");
    }

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

    // §33 replace_wikilink_target tests
    #[test]
    fn test_replace_wikilink_target_basic() {
        let content = "See [[old-note]] for details.";
        let result = replace_wikilink_target(content, "old-note", "new-note");
        assert_eq!(result, "See [[new-note]] for details.");
    }

    #[test]
    fn test_replace_wikilink_target_with_display() {
        let content = "Read [[old-note|my alias]] here.";
        let result = replace_wikilink_target(content, "old-note", "new-note");
        assert_eq!(result, "Read [[new-note|my alias]] here.");
    }

    #[test]
    fn test_replace_wikilink_target_with_heading() {
        let content = "See [[old-note#intro]] and [[old-note#summary|要約]].";
        let result = replace_wikilink_target(content, "old-note", "new-note");
        assert_eq!(
            result,
            "See [[new-note#intro]] and [[new-note#summary|要約]]."
        );
    }

    #[test]
    fn test_replace_wikilink_target_case_insensitive() {
        let content = "Links: [[Old-Note]] and [[old-note]].";
        let result = replace_wikilink_target(content, "old-note", "new-note");
        assert_eq!(result, "Links: [[new-note]] and [[new-note]].");
    }

    #[test]
    fn test_replace_wikilink_target_multiple_per_line() {
        let content = "Both [[old]] and [[other]] and [[old|display]].";
        let result = replace_wikilink_target(content, "old", "new");
        assert_eq!(result, "Both [[new]] and [[other]] and [[new|display]].");
    }

    #[test]
    fn test_replace_wikilink_target_no_match() {
        let content = "See [[unrelated]] for details.";
        let result = replace_wikilink_target(content, "old", "new");
        assert_eq!(result, "See [[unrelated]] for details.");
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
        assert!(index.outgoing.get("/vault/a.md").is_none());
        assert!(index.get_backlinks("/vault/b.md").is_empty());
    }

    // §34 strip_wikilinks tests
    #[test]
    fn test_strip_wikilinks_basic() {
        let line = "See [[architecture]] for details about architecture.";
        let stripped = strip_wikilinks(line);
        // [[architecture]] (18 chars) should be replaced with spaces
        assert!(!stripped.contains("[["));
        assert!(stripped.contains("architecture")); // the plain text one remains
    }

    #[test]
    fn test_strip_wikilinks_preserves_plain_text() {
        let line = "No wikilinks here, just architecture text.";
        let stripped = strip_wikilinks(line);
        assert_eq!(stripped, line);
    }

    #[test]
    fn test_strip_wikilinks_with_display() {
        let line = "See [[arch|the doc]] and architecture here.";
        let stripped = strip_wikilinks(line);
        assert!(!stripped.contains("[["));
        assert!(stripped.contains("architecture"));
    }

    #[test]
    fn test_strip_wikilinks_multiple() {
        let line = "Both [[foo]] and [[bar]] plus foo and bar text.";
        let stripped = strip_wikilinks(line);
        assert!(!stripped.contains("[["));
        assert!(stripped.contains("foo"));
        assert!(stripped.contains("bar"));
    }

    // §30a replace_block_id_refs tests
    #[test]
    fn test_replace_block_id_refs_basic() {
        let content = "See ((notes#^abc123)) for details.";
        let result = replace_block_id_refs(content, "abc123", "xyz789");
        assert_eq!(result, "See ((notes#^xyz789)) for details.");
    }

    #[test]
    fn test_replace_block_id_refs_with_display() {
        let content = "See ((notes#^abc123|my label)) here.";
        let result = replace_block_id_refs(content, "abc123", "xyz789");
        assert_eq!(result, "See ((notes#^xyz789|my label)) here.");
    }

    #[test]
    fn test_replace_block_id_refs_self_ref() {
        let content = "See ((#^abc123)) here.";
        let result = replace_block_id_refs(content, "abc123", "xyz789");
        assert_eq!(result, "See ((#^xyz789)) here.");
    }

    #[test]
    fn test_replace_block_id_refs_embed() {
        let content = "{{embed ((notes#^abc123))}}";
        let result = replace_block_id_refs(content, "abc123", "xyz789");
        assert_eq!(result, "{{embed ((notes#^xyz789))}}");
    }

    #[test]
    fn test_replace_block_id_refs_no_match() {
        let content = "See ((notes#^other)) and {{embed ((notes#^other))}}";
        let result = replace_block_id_refs(content, "abc123", "xyz789");
        assert_eq!(result, content);
    }

    #[test]
    fn test_replace_block_id_refs_multiple() {
        let content = "((a#^id1)) and ((b#^id1)) and ((c#^id2))";
        let result = replace_block_id_refs(content, "id1", "newId");
        assert_eq!(result, "((a#^newId)) and ((b#^newId)) and ((c#^id2))");
    }

    #[test]
    fn test_replace_block_id_refs_mixed() {
        let content = "ref: ((notes#^abc)) embed: {{embed ((notes#^abc))}} other: ((notes#^def))";
        let result = replace_block_id_refs(content, "abc", "xyz");
        assert_eq!(
            result,
            "ref: ((notes#^xyz)) embed: {{embed ((notes#^xyz))}} other: ((notes#^def))"
        );
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
            graph.edges.iter().any(|e| e.from == "/vault/daily/2024-01-15.md"
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
        index.update_file_from_content(
            "/vault/daily/2024-01-15.md",
            "Started [[project-x]] today.",
        );
        index.update_file_from_content(
            "/vault/notes/project-x.md",
            "See [[design]] for details.",
        );

        let graph = index.get_link_graph();

        // Both edges should resolve to actual files
        assert!(graph.edges.iter().any(|e| e.from == "/vault/daily/2024-01-15.md"
            && e.to == "/vault/notes/project-x.md"));
        assert!(graph.edges.iter().any(|e| e.from == "/vault/notes/project-x.md"
            && e.to == "/vault/notes/sub/design.md"));
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
