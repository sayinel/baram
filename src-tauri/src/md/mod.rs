// 공유 마크다운 전처리 — tag(§56m)와 task(§304)가 같은 스캔 규칙을 쓴다.
use regex::Regex;
use std::sync::LazyLock;

/// 인라인 #tag: #tag, #parent/child, #한국어태그
pub static INLINE_TAG_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:^|[\s\(])#([\w\p{Script=Hangul}]+(?:/[\w\p{Script=Hangul}]+)*)").unwrap()
});

/// Strip fenced code blocks from content so tags inside them are not extracted.
pub fn strip_code_blocks(content: &str) -> String {
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
pub fn split_frontmatter(content: &str) -> (String, String) {
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

/// Extract inline #tags from body text (outside code blocks).
/// Supports nested tags: #parent/child/grandchild and Korean characters.
pub fn extract_inline_tags(body: &str) -> Vec<String> {
    // Match #tag, #parent/child, #한국어태그
    // Require that # is preceded by whitespace or start-of-line (not inside a word)
    INLINE_TAG_RE
        .captures_iter(body)
        .filter_map(|cap| cap.get(1).map(|m| m.as_str().to_string()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_fenced_code_but_preserves_line_count() {
        let input = "before\n```\n#notatag\n```\nafter";
        let out = strip_code_blocks(input);
        assert!(!out.contains("#notatag"));
        assert_eq!(input.lines().count(), out.lines().count());
    }

    #[test]
    fn splits_frontmatter_from_body() {
        let (fm, body) = split_frontmatter("---\ntags: [a]\n---\nbody line");
        assert!(fm.contains("tags: [a]"));
        assert!(body.contains("body line"));
    }

    #[test]
    fn returns_empty_frontmatter_when_absent() {
        let (fm, body) = split_frontmatter("just body");
        assert_eq!(fm, "");
        assert_eq!(body, "just body");
    }

    #[test]
    fn extracts_hangul_and_nested_inline_tags() {
        let tags = extract_inline_tags("메모 #한글태그 그리고 #parent/child 끝");
        assert!(tags.contains(&"한글태그".to_string()));
        assert!(tags.contains(&"parent/child".to_string()));
    }
}
