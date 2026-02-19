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

/// A single wikilink found in a source file
#[derive(Debug, Clone, Serialize)]
pub struct LinkEntry {
    /// The file containing the wikilink
    pub source_path: String,
    /// The target referenced by [[target]]
    pub target: String,
    /// Line number (1-based)
    pub line: u32,
    /// Context text around the link
    pub context: String,
}

/// Backlink entry returned to the frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkResult {
    pub source_path: String,
    pub target_path: String,
    pub context: String,
    pub line: u32,
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
}

// Wikilink regex: [[target]], [[target|display]], [[target#heading]], etc.
static WIKILINK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[\[([^\]|#^]+)(?:#[^\]|^]+)?(?:\^[^\]|]+)?(?:\|[^\]]+)?\]\]").unwrap()
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

        let mut files_indexed: u32 = 0;
        let mut links_found: u32 = 0;

        // Collect all .md files
        let md_files = collect_md_files(root_path).await?;

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
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get the full link graph
    pub fn get_link_graph(&self) -> LinkGraph {
        let mut nodes_set = std::collections::HashSet::new();
        let mut edges = Vec::new();

        for (source, entries) in &self.outgoing {
            nodes_set.insert(source.clone());
            for entry in entries {
                let target_normalized = normalize_target(&entry.target);
                // Try to find actual file path for target
                if let Some(root) = &self.root_path {
                    let target_path = resolve_target(root, &target_normalized);
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

/// Extract all [[wikilink]] entries from file content
fn extract_links(file_path: &str, content: &str) -> Vec<LinkEntry> {
    let mut entries = Vec::new();
    let lines: Vec<&str> = content.lines().collect();

    for (line_idx, line) in lines.iter().enumerate() {
        for cap in WIKILINK_RE.captures_iter(line) {
            let target = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
            if target.is_empty() {
                continue;
            }

            // Build context: the line containing the link, trimmed
            let context = line.trim().to_string();
            let context = if context.len() > 200 {
                // Find a valid UTF-8 char boundary at or before byte 200
                let mut end = 200;
                while !context.is_char_boundary(end) {
                    end -= 1;
                }
                format!("{}…", &context[..end])
            } else {
                context
            };

            entries.push(LinkEntry {
                source_path: file_path.to_string(),
                target: target.to_string(),
                line: (line_idx + 1) as u32,
                context,
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
}
