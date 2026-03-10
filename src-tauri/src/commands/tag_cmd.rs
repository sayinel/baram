// §56m Vault-wide tag index — IPC command

use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagEntry {
    pub tag: String,
    pub count: u32,
}

/// Recursively collect all .md file paths under root, skipping hidden dirs and node_modules.
/// Stops collecting after 500 files.
async fn collect_md_files(root: &PathBuf, files: &mut Vec<PathBuf>) -> std::io::Result<()> {
    let mut read_dir = tokio::fs::read_dir(root).await?;
    while files.len() < 500 {
        let entry = match read_dir.next_entry().await? {
            Some(e) => e,
            None => break,
        };
        let path = entry.path();
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");

        // Skip hidden dirs and node_modules
        if file_name.starts_with('.') || file_name == "node_modules" {
            continue;
        }

        let metadata = match tokio::fs::metadata(&path).await {
            Ok(m) => m,
            Err(_) => continue,
        };

        if metadata.is_dir() {
            // Recurse but respect the 500-file limit
            if files.len() < 500 {
                let _ = Box::pin(collect_md_files(&path, files)).await;
            }
        } else if metadata.is_file()
            && path.extension().and_then(|e| e.to_str()) == Some("md")
        {
            files.push(path);
        }
    }
    Ok(())
}

/// Strip fenced code blocks from content so tags inside them are not extracted.
fn strip_code_blocks(content: &str) -> String {
    let mut result = String::with_capacity(content.len());
    let mut in_fence = false;
    for line in content.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            result.push('\n'); // preserve line count
            continue;
        }
        if in_fence {
            result.push('\n');
        } else {
            result.push_str(line);
            result.push('\n');
        }
    }
    result
}

/// Extract frontmatter block (between first `---` lines) from content.
/// Returns (frontmatter, rest_of_content).
fn split_frontmatter(content: &str) -> (String, String) {
    let mut lines = content.splitn(2, '\n');
    let first = lines.next().unwrap_or("").trim();
    if first != "---" {
        return (String::new(), content.to_string());
    }
    let rest = lines.next().unwrap_or("");
    if let Some(end) = rest.find("\n---") {
        let fm = rest[..end].to_string();
        let body = rest[end + 4..].to_string(); // skip "\n---"
        (fm, body)
    } else {
        (String::new(), content.to_string())
    }
}

/// Extract tags from frontmatter string.
/// Handles both:
///   tags: [tag1, tag2]
///   tags:
///     - tag1
///     - tag2
fn extract_frontmatter_tags(frontmatter: &str) -> Vec<String> {
    let mut tags = Vec::new();

    // Inline array: tags: [tag1, tag2, ...]
    let re_inline = Regex::new(r"(?i)^tags\s*:\s*\[([^\]]*)\]").unwrap();
    // Block list: tags:\n  - item
    let re_block_header = Regex::new(r"(?i)^tags\s*:\s*$").unwrap();
    let re_block_item = Regex::new(r"^\s+-\s+(.+)$").unwrap();

    let lines: Vec<&str> = frontmatter.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if let Some(cap) = re_inline.captures(line) {
            let inner = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            for part in inner.split(',') {
                let t = part.trim().trim_matches('"').trim_matches('\'').to_string();
                if !t.is_empty() {
                    tags.push(t);
                }
            }
        } else if re_block_header.is_match(line) {
            // Consume following list items
            i += 1;
            while i < lines.len() {
                if let Some(cap) = re_block_item.captures(lines[i]) {
                    let t = cap.get(1).map(|m| m.as_str()).unwrap_or("").trim()
                        .trim_matches('"').trim_matches('\'').to_string();
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

/// Extract inline #tags from body text (outside code blocks).
/// Supports nested tags: #parent/child/grandchild and Korean characters.
fn extract_inline_tags(body: &str) -> Vec<String> {
    // Match #tag, #parent/child, #한국어태그
    // Require that # is preceded by whitespace or start-of-line (not inside a word)
    let re = Regex::new(
        r"(?:^|[\s\(])#([\w\p{Script=Hangul}]+(?:/[\w\p{Script=Hangul}]+)*)"
    )
    .unwrap();
    re.captures_iter(body)
        .filter_map(|cap| cap.get(1).map(|m| m.as_str().to_string()))
        .collect()
}

#[tauri::command]
pub async fn get_vault_tags(root_path: String) -> Result<Vec<TagEntry>, String> {
    let root = PathBuf::from(&root_path);
    if !root.exists() {
        return Err(format!("Path does not exist: {}", root_path));
    }

    let mut md_files: Vec<PathBuf> = Vec::new();
    collect_md_files(&root, &mut md_files)
        .await
        .map_err(|e| e.to_string())?;

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
#[tauri::command]
pub async fn get_files_by_tag(root_path: String, tag: String) -> Result<Vec<String>, String> {
    let root = std::path::PathBuf::from(&root_path);
    if !root.exists() {
        return Err("Root path does not exist".into());
    }
    if tag.is_empty() {
        return Err("Tag must not be empty".into());
    }

    let mut md_files: Vec<std::path::PathBuf> = Vec::new();
    collect_md_files(&root, &mut md_files)
        .await
        .map_err(|e| e.to_string())?;

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

// §56m Vault-wide tag rename/merge

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameTagResult {
    pub files_modified: usize,
    pub occurrences_replaced: usize,
}

/// Rename (or merge) a tag across all .md files in the vault.
/// Handles:
///   - Inline #tags in body text
///   - Frontmatter tags: inline array `tags: [tag1, tag2]`
///   - Frontmatter tags: block list `tags:\n  - tag1`
/// Prefix rename: renaming `project` also renames `project/baram` → `new/baram`.
#[tauri::command]
pub async fn rename_tag(
    root_path: String,
    old_tag: String,
    new_tag: String,
) -> Result<RenameTagResult, String> {
    let root = std::path::PathBuf::from(&root_path);
    if !root.exists() {
        return Err("Root path does not exist".into());
    }
    if old_tag.is_empty() || new_tag.is_empty() {
        return Err("Tag names must not be empty".into());
    }
    if old_tag == new_tag {
        return Ok(RenameTagResult {
            files_modified: 0,
            occurrences_replaced: 0,
        });
    }

    let mut md_files: Vec<std::path::PathBuf> = Vec::new();
    collect_md_files(&root, &mut md_files)
        .await
        .map_err(|e| e.to_string())?;

    // Escape regex special characters in old_tag
    let escaped_old = regex::escape(&old_tag);

    // Inline body tag: #old_tag followed by / (child) or non-word char / end
    // Match the leading whitespace/paren prefix as a capture group to preserve it
    let inline_re = Regex::new(&format!(
        r"((?:^|(?:[\s\(])))#({})(?=(?:/|[\s,.\]\)!?;:\n]|$))",
        escaped_old
    ))
    .map_err(|e| e.to_string())?;

    // Frontmatter inline array: tags: [..., old_tag, ...]
    // Match old_tag as a whole word within the bracket
    let fm_inline_re = Regex::new(&format!(
        r"(tags\s*:\s*\[[^\]]*)(?<!\w)({})(?!\w)([^\]]*\])",
        escaped_old
    ))
    .map_err(|e| e.to_string())?;

    // Frontmatter block list item: `  - old_tag` (whole line)
    let fm_block_re = Regex::new(&format!(
        r"(?m)^([ \t]+-[ \t]+)({})$",
        escaped_old
    ))
    .map_err(|e| e.to_string())?;

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
            if let Err(e) = tokio::fs::write(file_path, &new_content).await {
                eprintln!("[rename_tag] Failed to write {}: {}", file_path.display(), e);
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
