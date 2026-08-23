// §56m Vault-wide tag index — business logic

use crate::md::{extract_inline_tags, split_frontmatter, strip_code_blocks};
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::LazyLock;
use thiserror::Error;

// Frontmatter inline array: tags: [tag1, tag2, ...]
static FM_TAGS_INLINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^tags\s*:\s*\[([^\]]*)\]").unwrap());

// Frontmatter block list header: tags:
static FM_TAGS_BLOCK_HEADER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^tags\s*:\s*$").unwrap());

// Frontmatter block list item:   - tag
static FM_TAGS_BLOCK_ITEM_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s+-\s+(.+)$").unwrap());

#[derive(Debug, Error)]
pub enum TagError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Custom(String),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagEntry {
    pub tag: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameTagResult {
    pub files_modified: usize,
    pub occurrences_replaced: usize,
}

/// Extract tags from frontmatter string.
/// Handles both:
///   tags: [tag1, tag2]
///   tags:
///     - tag1
///     - tag2
fn extract_frontmatter_tags(frontmatter: &str) -> Vec<String> {
    let mut tags = Vec::new();

    let lines: Vec<&str> = frontmatter.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if let Some(cap) = FM_TAGS_INLINE_RE.captures(line) {
            let inner = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            for part in inner.split(',') {
                let t = part.trim().trim_matches('"').trim_matches('\'').to_string();
                if !t.is_empty() {
                    tags.push(t);
                }
            }
        } else if FM_TAGS_BLOCK_HEADER_RE.is_match(line) {
            // Consume following list items
            i += 1;
            while i < lines.len() {
                if let Some(cap) = FM_TAGS_BLOCK_ITEM_RE.captures(lines[i]) {
                    let t = cap
                        .get(1)
                        .map(|m| m.as_str())
                        .unwrap_or("")
                        .trim()
                        .trim_matches('"')
                        .trim_matches('\'')
                        .to_string();
                    if !t.is_empty() {
                        tags.push(t);
                    }
                    i += 1;
                } else {
                    break;
                }
            }
            continue;
        }
        i += 1;
    }

    tags
}

pub async fn get_vault_tags(root_path: &str) -> Result<Vec<TagEntry>, TagError> {
    let root = PathBuf::from(root_path);
    if !root.exists() {
        return Err(TagError::Custom(format!(
            "Path does not exist: {}",
            root_path
        )));
    }

    let mut md_files: Vec<PathBuf> = Vec::new();
    crate::fs::collect_md_files(&root, &mut md_files)
        .await
        .map_err(|e| TagError::Custom(e.to_string()))?;

    let mut counts: HashMap<String, u32> = HashMap::new();

    for file_path in &md_files {
        let content = match tokio::fs::read_to_string(file_path).await {
            Ok(c) => c,
            Err(_) => continue,
        };

        let (frontmatter, body) = split_frontmatter(&content);

        // Frontmatter tags
        for tag in extract_frontmatter_tags(&frontmatter) {
            let normalized = tag.to_lowercase();
            if !normalized.is_empty() {
                *counts.entry(normalized).or_insert(0) += 1;
            }
        }

        // Inline #tags (strip code blocks first)
        let clean_body = strip_code_blocks(&body);
        for tag in extract_inline_tags(&clean_body) {
            let normalized = tag.to_lowercase();
            if !normalized.is_empty() {
                *counts.entry(normalized).or_insert(0) += 1;
            }
        }
    }

    let mut entries: Vec<TagEntry> = counts
        .into_iter()
        .map(|(tag, count)| TagEntry { tag, count })
        .collect();

    // Sort by count descending, then alphabetically for stable order
    entries.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.tag.cmp(&b.tag)));

    Ok(entries)
}

/// Returns relative paths of .md files that contain the given tag (inline or frontmatter).
pub async fn get_files_by_tag(root_path: &str, tag: &str) -> Result<Vec<String>, TagError> {
    let root = PathBuf::from(root_path);
    if !root.exists() {
        return Err(TagError::Custom("Root path does not exist".into()));
    }
    if tag.is_empty() {
        return Err(TagError::Custom("Tag must not be empty".into()));
    }

    let mut md_files: Vec<PathBuf> = Vec::new();
    crate::fs::collect_md_files(&root, &mut md_files)
        .await
        .map_err(|e| TagError::Custom(e.to_string()))?;

    let normalized_tag = tag.to_lowercase();

    let mut matching: Vec<String> = Vec::new();

    for file_path in &md_files {
        let content = match tokio::fs::read_to_string(file_path).await {
            Ok(c) => c,
            Err(_) => continue,
        };

        let (frontmatter, body) = split_frontmatter(&content);

        // Check frontmatter tags
        let fm_tags: Vec<String> = extract_frontmatter_tags(&frontmatter)
            .into_iter()
            .map(|t| t.to_lowercase())
            .collect();
        let has_fm_tag = fm_tags.iter().any(|t| t == &normalized_tag);

        // Check inline #tags in body (strip code blocks first)
        let clean_body = strip_code_blocks(&body);
        let inline_tags: Vec<String> = extract_inline_tags(&clean_body)
            .into_iter()
            .map(|t| t.to_lowercase())
            .collect();
        let has_inline_tag = inline_tags.iter().any(|t| t == &normalized_tag);

        if has_fm_tag || has_inline_tag {
            if let Ok(rel) = file_path.strip_prefix(&root) {
                matching.push(rel.to_string_lossy().into_owned());
            }
        }
    }

    Ok(matching)
}

/// Rename (or merge) a tag across all .md files in the vault.
/// Handles:
///   - Inline #tags in body text
///   - Frontmatter tags: inline array `tags: [tag1, tag2]`
///   - Frontmatter tags: block list `tags:\n  - tag1`
///
/// Prefix rename: renaming `project` also renames `project/baram` → `new/baram`.
pub async fn rename_tag(
    root_path: &str,
    old_tag: &str,
    new_tag: &str,
) -> Result<RenameTagResult, TagError> {
    let root = PathBuf::from(root_path);
    if !root.exists() {
        return Err(TagError::Custom("Root path does not exist".into()));
    }
    if old_tag.is_empty() || new_tag.is_empty() {
        return Err(TagError::Custom("Tag names must not be empty".into()));
    }
    if old_tag == new_tag {
        return Ok(RenameTagResult {
            files_modified: 0,
            occurrences_replaced: 0,
        });
    }

    let mut md_files: Vec<PathBuf> = Vec::new();
    crate::fs::collect_md_files(&root, &mut md_files)
        .await
        .map_err(|e| TagError::Custom(e.to_string()))?;

    // Escape regex special characters in old_tag
    let escaped_old = regex::escape(old_tag);

    // Inline body tag: #old_tag followed by / (child) or non-word char / end
    // Match the leading whitespace/paren prefix as a capture group to preserve it
    let inline_re = Regex::new(&format!(
        r"((?:^|(?:[\s\(])))#({})(?=(?:/|[\s,.\]\)!?;:\n]|$))",
        escaped_old
    ))
    .map_err(|e| TagError::Custom(e.to_string()))?;

    // Frontmatter inline array: tags: [..., old_tag, ...]
    // Match old_tag as a whole word within the bracket
    let fm_inline_re = Regex::new(&format!(
        r"(tags\s*:\s*\[[^\]]*)(?<!\w)({})(?!\w)([^\]]*\])",
        escaped_old
    ))
    .map_err(|e| TagError::Custom(e.to_string()))?;

    // Frontmatter block list item: `  - old_tag` (whole line)
    let fm_block_re = Regex::new(&format!(r"(?m)^([ \t]+-[ \t]+)({})$", escaped_old))
        .map_err(|e| TagError::Custom(e.to_string()))?;

    let mut files_modified = 0usize;
    let mut occurrences_replaced = 0usize;

    for file_path in &md_files {
        let content = match tokio::fs::read_to_string(file_path).await {
            Ok(c) => c,
            Err(_) => continue,
        };

        let mut count = 0usize;

        // Replace inline #tags (body text)
        // Replace #old_tag and #old_tag/suffix → #new_tag and #new_tag/suffix
        let after_inline = inline_re.replace_all(&content, |caps: &regex::Captures| {
            count += 1;
            format!("{}#{}", &caps[1], new_tag)
        });

        // Replace frontmatter inline array items
        let after_fm_inline = fm_inline_re.replace_all(&after_inline, |caps: &regex::Captures| {
            count += 1;
            format!("{}{}{}", &caps[1], new_tag, &caps[3])
        });

        // Replace frontmatter block list items
        let after_fm_block = fm_block_re.replace_all(&after_fm_inline, |caps: &regex::Captures| {
            count += 1;
            format!("{}{}", &caps[1], new_tag)
        });

        let new_content = after_fm_block.into_owned();

        if new_content != content {
            if let Err(e) = crate::fs::write_file(&file_path.to_string_lossy(), &new_content).await
            {
                log::warn!(
                    "[rename_tag] Failed to write {}: {}",
                    file_path.display(),
                    e
                );
                continue;
            }
            files_modified += 1;
            occurrences_replaced += count;
        }
    }

    Ok(RenameTagResult {
        files_modified,
        occurrences_replaced,
    })
}
