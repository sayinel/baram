// §11.4.2 Markdown chunker — heading-based splitting with token estimation

use regex::Regex;
use uuid::Uuid;

/// A chunk of markdown content with metadata for embedding.
#[derive(Debug, Clone)]
pub struct Chunk {
    pub id: String,
    pub file_path: String,
    pub heading_path: Vec<String>,
    pub content: String,
    pub token_count: usize,
}

/// Estimate token count (~4 chars per token).
fn estimate_tokens(text: &str) -> usize {
    (text.len() + 3) / 4
}

/// Extract wikilinks from markdown content.
pub fn extract_wikilinks(content: &str) -> Vec<String> {
    let re = Regex::new(r"\[\[([^\]]+)\]\]").unwrap();
    re.captures_iter(content)
        .map(|cap| cap[1].to_string())
        .collect()
}

/// Split markdown into chunks based on headings.
///
/// Strategy:
/// 1. Split by headings (# to ######)
/// 2. Merge short chunks (< 50 tokens) with parent
/// 3. Split long chunks (> 500 tokens) at paragraph boundaries
pub fn chunk_markdown(content: &str, file_path: &str) -> Vec<Chunk> {
    let heading_re = Regex::new(r"^(#{1,6})\s+(.+)$").unwrap();

    // Phase 1: Split into raw sections by heading
    let mut raw_sections: Vec<(Vec<String>, String)> = Vec::new();
    let mut current_heading_path: Vec<(usize, String)> = Vec::new(); // (level, title)
    let mut current_lines: Vec<String> = Vec::new();

    // Strip frontmatter
    let content_without_frontmatter = strip_frontmatter(content);

    for line in content_without_frontmatter.lines() {
        if let Some(caps) = heading_re.captures(line) {
            // Flush current section
            if !current_lines.is_empty() || !current_heading_path.is_empty() {
                let path: Vec<String> = current_heading_path
                    .iter()
                    .map(|(_, t)| t.clone())
                    .collect();
                let text = current_lines.join("\n").trim().to_string();
                if !text.is_empty() || !path.is_empty() {
                    raw_sections.push((path, text));
                }
                current_lines.clear();
            }

            let level = caps[1].len();
            let title = caps[2].trim().to_string();

            // Update heading path: remove any headings at same or deeper level
            while let Some((last_level, _)) = current_heading_path.last() {
                if *last_level >= level {
                    current_heading_path.pop();
                } else {
                    break;
                }
            }
            current_heading_path.push((level, title));
        } else {
            current_lines.push(line.to_string());
        }
    }

    // Flush remaining
    if !current_lines.is_empty() {
        let path: Vec<String> = current_heading_path
            .iter()
            .map(|(_, t)| t.clone())
            .collect();
        let text = current_lines.join("\n").trim().to_string();
        if !text.is_empty() {
            raw_sections.push((path, text));
        }
    }

    // Handle edge case: content with no headings at all
    if raw_sections.is_empty() && !content_without_frontmatter.trim().is_empty() {
        raw_sections.push((vec![], content_without_frontmatter.trim().to_string()));
    }

    // Phase 2: Merge short orphan chunks
    // Heading-based sections always keep their own chunk.
    // Only merge when the previous chunk has empty content (heading-only placeholder)
    // and the current chunk is a direct child — fold content into the heading chunk.
    let mut merged: Vec<(Vec<String>, String)> = Vec::new();
    for (path, text) in raw_sections {
        if !merged.is_empty() {
            let prev = merged.last().unwrap();
            // Fold content into a heading-only parent when it has no content yet
            if prev.1.is_empty() && path.len() > prev.0.len() && path.starts_with(prev.0.as_slice())
            {
                let last = merged.last_mut().unwrap();
                last.1 = text;
                continue;
            }
        }
        merged.push((path, text));
    }

    // Phase 3: Split long chunks at paragraph boundaries
    let max_tokens = 500;
    let max_chars = max_tokens * 4; // ~4 chars/token
    let mut final_chunks: Vec<Chunk> = Vec::new();
    for (path, text) in merged {
        let tokens = estimate_tokens(&text);
        if tokens > max_tokens {
            // Split at paragraph boundaries (double newline)
            let paragraphs: Vec<&str> = text.split("\n\n").collect();

            if paragraphs.len() <= 1 {
                // No paragraph boundaries — hard split by character count
                let chars: Vec<char> = text.chars().collect();
                for sub_chars in chars.chunks(max_chars) {
                    let sub: String = sub_chars.iter().collect();
                    let sub_tokens = estimate_tokens(&sub);
                    if sub_tokens > 0 {
                        final_chunks.push(Chunk {
                            id: Uuid::new_v4().to_string(),
                            file_path: file_path.to_string(),
                            heading_path: path.clone(),
                            token_count: sub_tokens,
                            content: sub,
                        });
                    }
                }
            } else {
                let mut current_text = String::new();

                for para in paragraphs {
                    let combined_tokens = estimate_tokens(&format!(
                        "{}{}{}",
                        current_text,
                        if current_text.is_empty() { "" } else { "\n\n" },
                        para
                    ));
                    if combined_tokens > max_tokens && !current_text.is_empty() {
                        final_chunks.push(Chunk {
                            id: Uuid::new_v4().to_string(),
                            file_path: file_path.to_string(),
                            heading_path: path.clone(),
                            token_count: estimate_tokens(&current_text),
                            content: current_text.clone(),
                        });
                        current_text = para.to_string();
                    } else {
                        if !current_text.is_empty() {
                            current_text.push_str("\n\n");
                        }
                        current_text.push_str(para);
                    }
                }

                if !current_text.is_empty() {
                    final_chunks.push(Chunk {
                        id: Uuid::new_v4().to_string(),
                        file_path: file_path.to_string(),
                        heading_path: path.clone(),
                        token_count: estimate_tokens(&current_text),
                        content: current_text,
                    });
                }
            }
        } else if !text.is_empty() {
            final_chunks.push(Chunk {
                id: Uuid::new_v4().to_string(),
                file_path: file_path.to_string(),
                heading_path: path,
                token_count: tokens,
                content: text,
            });
        }
    }

    final_chunks
}

/// Strip YAML frontmatter (--- ... ---) from markdown.
fn strip_frontmatter(content: &str) -> &str {
    if content.starts_with("---") {
        if let Some(end) = content[3..].find("\n---") {
            let after = end + 3 + 4; // skip past closing ---
            if after < content.len() {
                return content[after..].trim_start_matches('\n');
            }
            return "";
        }
    }
    content
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_splits_by_headings() {
        let md =
            "# Title\n\nParagraph 1\n\n## Section A\n\nParagraph 2\n\n## Section B\n\nParagraph 3";
        let chunks = chunk_markdown(md, "test.md");
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].heading_path, vec!["Title"]);
        assert_eq!(chunks[1].heading_path, vec!["Title", "Section A"]);
    }

    #[test]
    fn test_merges_short_chunks() {
        // When a parent heading has no content, child content folds into it
        let md = "# Title\n\n## Sub\n\nSome content here.";
        let chunks = chunk_markdown(md, "test.md");
        // # Title has no content of its own → absorbs ## Sub's content
        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].content.contains("Some content here."));
        assert_eq!(chunks[0].heading_path, vec!["Title"]);
    }

    #[test]
    fn test_splits_long_chunks() {
        let long_paragraph = "Word ".repeat(600);
        let md = format!("# Title\n\n{}", long_paragraph);
        let chunks = chunk_markdown(&md, "test.md");
        assert!(chunks.iter().all(|c| c.token_count <= 550));
    }

    #[test]
    fn test_chunk_metadata() {
        let md = "---\ntags: [rust, test]\n---\n\n# Title\n\nContent with [[link]].";
        let chunks = chunk_markdown(md, "docs/test.md");
        assert_eq!(chunks[0].file_path, "docs/test.md");
        assert!(!chunks[0].id.is_empty());
    }

    #[test]
    fn test_extract_wikilinks() {
        let links = extract_wikilinks("Check [[page-a]] and [[page-b#heading]].");
        assert_eq!(links, vec!["page-a", "page-b#heading"]);
    }

    #[test]
    fn test_estimate_tokens() {
        assert_eq!(estimate_tokens("abcd"), 1); // 4 chars = 1 token
        assert_eq!(estimate_tokens("abcdefgh"), 2); // 8 chars = 2 tokens
        assert_eq!(estimate_tokens(""), 0);
    }

    #[test]
    fn test_strip_frontmatter() {
        let with_fm = "---\ntitle: Test\n---\n\n# Heading\n\nContent";
        let stripped = strip_frontmatter(with_fm);
        assert!(stripped.starts_with("# Heading"));
    }

    #[test]
    fn test_no_headings() {
        let md = "Just a plain paragraph with no headings at all.";
        let chunks = chunk_markdown(md, "test.md");
        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].heading_path.is_empty());
    }
}
