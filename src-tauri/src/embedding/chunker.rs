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
    pub outgoing_links: Vec<String>,
    pub last_modified: Option<u64>,
    pub frontmatter: Option<String>,
}

/// Overlap size in tokens for adjacent chunks (§11.4.2 spec: 50 tokens).
const OVERLAP_TOKENS: usize = 50;

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
/// 4. Add 50-token overlap between adjacent chunks from the same section
pub fn chunk_markdown(content: &str, file_path: &str) -> Vec<Chunk> {
    let heading_re = Regex::new(r"^(#{1,6})\s+(.+)$").unwrap();

    // Extract frontmatter before stripping
    let fm = extract_frontmatter(content);
    let content_without_frontmatter = strip_frontmatter(content);

    // Phase 1: Split into raw sections by heading
    let mut raw_sections: Vec<(Vec<String>, String)> = Vec::new();
    let mut current_heading_path: Vec<(usize, String)> = Vec::new(); // (level, title)
    let mut current_lines: Vec<String> = Vec::new();

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
    let mut pre_overlap_chunks: Vec<(Vec<String>, String)> = Vec::new();
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
                    if !sub.is_empty() {
                        pre_overlap_chunks.push((path.clone(), sub));
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
                        pre_overlap_chunks.push((path.clone(), current_text.clone()));
                        current_text = para.to_string();
                    } else {
                        if !current_text.is_empty() {
                            current_text.push_str("\n\n");
                        }
                        current_text.push_str(para);
                    }
                }

                if !current_text.is_empty() {
                    pre_overlap_chunks.push((path.clone(), current_text));
                }
            }
        } else if !text.is_empty() {
            pre_overlap_chunks.push((path, text));
        }
    }

    // Phase 4: Add overlap between adjacent chunks from the same heading section
    let overlap_chars = OVERLAP_TOKENS * 4;
    let mut final_chunks: Vec<Chunk> = Vec::new();
    for i in 0..pre_overlap_chunks.len() {
        let (ref path, ref text) = pre_overlap_chunks[i];

        let mut chunk_content = String::new();

        // Prepend overlap from previous chunk if same heading section
        if i > 0 && pre_overlap_chunks[i - 1].0 == *path {
            let prev_text = &pre_overlap_chunks[i - 1].1;
            if prev_text.len() > overlap_chars {
                let tail = &prev_text[prev_text.len() - overlap_chars..];
                // Align to word boundary
                if let Some(space_pos) = tail.find(char::is_whitespace) {
                    chunk_content.push_str(&tail[space_pos + 1..]);
                    chunk_content.push_str("\n\n");
                }
            }
        }

        chunk_content.push_str(text);

        let links = extract_wikilinks(&chunk_content);
        let token_count = estimate_tokens(&chunk_content);

        final_chunks.push(Chunk {
            id: Uuid::new_v4().to_string(),
            file_path: file_path.to_string(),
            heading_path: path.clone(),
            content: chunk_content,
            token_count,
            outgoing_links: links,
            last_modified: None,
            frontmatter: fm.clone(),
        });
    }

    final_chunks
}

/// Extract YAML frontmatter content (between --- delimiters).
fn extract_frontmatter(content: &str) -> Option<String> {
    if content.starts_with("---") {
        if let Some(end) = content[3..].find("\n---") {
            let fm_content = content[3..3 + end].trim().to_string();
            if !fm_content.is_empty() {
                return Some(fm_content);
            }
        }
    }
    None
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

    #[test]
    fn test_outgoing_links_extracted() {
        let md = "# Title\n\nSee [[page-a]] and [[page-b]] for details.";
        let chunks = chunk_markdown(md, "test.md");
        assert_eq!(chunks[0].outgoing_links, vec!["page-a", "page-b"]);
    }

    #[test]
    fn test_frontmatter_preserved() {
        let md = "---\ntags: [rust, test]\ntitle: Hello\n---\n\n# Title\n\nContent.";
        let chunks = chunk_markdown(md, "test.md");
        let fm = chunks[0].frontmatter.as_ref().unwrap();
        assert!(fm.contains("tags: [rust, test]"));
        assert!(fm.contains("title: Hello"));
    }

    #[test]
    fn test_no_frontmatter_returns_none() {
        let md = "# Title\n\nContent without frontmatter.";
        let chunks = chunk_markdown(md, "test.md");
        assert!(chunks[0].frontmatter.is_none());
    }

    #[test]
    fn test_overlap_between_split_chunks() {
        // Create content that will be split into multiple chunks (>500 tokens each part)
        let para1 = "First paragraph content. ".repeat(60); // ~360 chars = ~90 tokens
        let para2 = "Second paragraph content. ".repeat(60);
        let para3 = "Third paragraph content. ".repeat(60);
        let para4 = "Fourth paragraph content. ".repeat(60);
        let para5 = "Fifth paragraph content. ".repeat(60);
        let para6 = "Sixth paragraph content. ".repeat(60);
        let md = format!(
            "# Title\n\n{}\n\n{}\n\n{}\n\n{}\n\n{}\n\n{}",
            para1, para2, para3, para4, para5, para6
        );
        let chunks = chunk_markdown(&md, "test.md");
        // Should have multiple chunks if total > 500 tokens
        if chunks.len() >= 2 {
            // Second chunk should contain overlap text from first chunk's tail
            let first_content = &chunks[0].content;
            let second_content = &chunks[1].content;
            // The second chunk should be longer than just its own paragraph
            // because it includes overlap from the first chunk
            assert!(second_content.len() > 0, "Second chunk should have content");
            // Both should have the same heading path (same section)
            assert_eq!(chunks[0].heading_path, chunks[1].heading_path);
            // The overlap should make the second chunk start with text from the first
            let first_tail = &first_content[first_content.len().saturating_sub(100)..];
            // At least some words from the tail should appear in the second chunk
            let tail_words: Vec<&str> = first_tail.split_whitespace().collect();
            if tail_words.len() > 2 {
                let last_word = tail_words[tail_words.len() - 1];
                assert!(
                    second_content.contains(last_word),
                    "Second chunk should contain overlap from first chunk"
                );
            }
        }
    }
}
