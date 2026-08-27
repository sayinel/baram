// 공유 마크다운 전처리 — tag(§56m)와 task(§304)가 같은 스캔 규칙을 쓴다.
use regex::Regex;
use std::sync::LazyLock;

/// 인라인 #tag: #tag, #parent/child, #한국어태그, #deep-work
///
/// ‼️ 하이픈은 태그 글자다. 한때 아니었고, 그것이 읽는 쪽과 쓰는 쪽을 갈랐다:
/// 여기서는 `#someday-maybe`가 `someday`로 읽히는데 쓰는 쪽(`task/tag.rs`의
/// `is_tag_char`)은 하이픈까지 태그로 보아 그 줄에서 `#someday`를 찾지 못했다.
/// 아젠다의 "미룸 해제"가 지울 대상을 못 찾고 조용히 아무 일도 하지 않았고,
/// (`tag::rename_tag`도 무동작이었지만 원인은 달랐다 — 아래 `is_tag_char` 참조.)
/// 넓히는 쪽이 Obsidian과도 같다 — 그쪽 태그 어휘가 영숫자·`_`·`-`·`/`다.
pub static INLINE_TAG_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:^|[\s\(])#([\w\p{Script=Hangul}-]+(?:/[\w\p{Script=Hangul}-]+)*)").unwrap()
});

/// 태그 이름에 쓸 수 있는 글자 — **경계 판정의 어휘**다. 태그를 *찾아 고치는* 쪽은
/// 전부 이것을 쓴다: `task::tag::find_tag`(태스크 줄의 태그 토글)와 `tag::rename_tag`
/// (vault 전역 이름 바꾸기).
///
/// `INLINE_TAG_RE`(읽는 쪽)와 같은 집합을 뜻하되 표현이 다르다 — 하나는 정규식,
/// 하나는 술어다. 둘이 갈리면 패널이 보여준 이름으로 아무것도 고칠 수 없게 되므로
/// `a_hyphen_is_part_of_the_tag_name`과 `the_predicate_agrees_with_the_reader`가
/// 같은 표를 양쪽에 대고 검사한다.
pub fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-' || c == '/'
}

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

    /// 읽는 이름이 쓰는 이름과 같아야 조작이 산다. 하이픈에서 끊던 시절에는 이 표의
    /// 오른쪽이 전부 잘린 이름이었고, `task/tag.rs`는 자르지 않았으므로 아젠다가 보여준
    /// 이름으로는 그 줄에서 아무것도 찾을 수 없었다.
    #[test]
    fn a_hyphen_is_part_of_the_tag_name() {
        for (body, want) in [
            ("- [ ] 초안 #someday-maybe", "someday-maybe"),
            ("메모 #deep-work 끝", "deep-work"),
            ("#a-b-c 여러 마디", "a-b-c"),
            ("중첩 #parent/child-two 끝", "parent/child-two"),
            ("한글 #할-일 끝", "할-일"),
        ] {
            assert_eq!(
                extract_inline_tags(body),
                vec![want.to_string()],
                "{}",
                body
            );
        }
    }

    /// `is_tag_char`(고치는 쪽의 자)와 `INLINE_TAG_RE`(읽는 쪽의 자)가 같은 이름을
    /// 가리키는지. 이 둘이 갈리면 패널이 보여준 이름으로 rename도 태그 토글도
    /// 아무것도 찾지 못한다 — 이 슬라이스가 고친 결함이 정확히 그것이었다.
    ///
    /// ‼️ 완전히 같은 집합은 아니다: `/`는 술어에서 그냥 글자지만 정규식에서는 마디
    /// **구분자**라, `#a//b`처럼 빈 마디가 생기는 형태에서만 갈린다. 정상적으로 쓰인
    /// 이름에서는 두 자가 같은 답을 낸다는 것이 여기서 지키는 계약이다.
    #[test]
    fn the_predicate_agrees_with_the_reader() {
        for c in "aZ0_-/가".chars() {
            assert!(is_tag_char(c), "태그 글자여야 한다: {}", c);
        }
        for c in " .,!?()[]#".chars() {
            assert!(!is_tag_char(c), "태그 글자가 아니어야 한다: {}", c);
        }
        for name in ["deep-work", "parent/child", "할-일", "a_b", "x1"] {
            assert!(name.chars().all(is_tag_char), "{}", name);
            assert_eq!(
                extract_inline_tags(&format!("메모 #{} 끝", name)),
                vec![name.to_string()],
                "{}",
                name
            );
        }
    }

    /// 넓힌 어휘가 **경계까지 넓히지는 않는다** — `#`이 단어 안에 있거나 태그 앞뒤가
    /// 태그 글자면 여전히 태그가 아니다.
    #[test]
    fn widening_to_hyphens_does_not_widen_the_boundaries() {
        assert!(extract_inline_tags("주소 http://x/#anchor-name").is_empty());
        // 여는 괄호는 경계로 인정한다(`task/tag.rs`의 `find_tag`와 같은 규칙).
        assert_eq!(
            extract_inline_tags("(#deep-work)"),
            vec!["deep-work".to_string()]
        );
    }
}
