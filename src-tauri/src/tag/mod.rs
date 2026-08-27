// §56m Vault-wide tag index — business logic

use crate::md::{
    extract_inline_tags, is_fence_delimiter, is_tag_char, split_frontmatter, strip_code_blocks,
};
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::LazyLock;
use thiserror::Error;

// Frontmatter inline array: tags: [tag1, tag2, ...]
// ‼️ `(?m)` — `extract_frontmatter_tags`는 한 줄씩 넣으므로 있으나 없으나 같지만,
// `rename_frontmatter_list`는 파일 전체를 넣는다. 줄 앵커가 없으면 파일 첫 글자에서만
// 맞아 프론트매터를 영영 못 찾는다.
static FM_TAGS_INLINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?im)^tags\s*:\s*\[([^\]]*)\]").unwrap());

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

/// 태그 이름이 여기서 **끝났는가**. `/`는 하위 태그의 구분자이므로 끝으로 친다 —
/// 부모를 바꾸면 자식이 따라오게 하려는 것이다(`project` → `work`가
/// `#project/baram`을 `#work/baram`으로 만든다).
fn ends_tag(next: Option<char>) -> bool {
    match next {
        None | Some('/') => true,
        Some(c) => !is_tag_char(c),
    }
}

/// 본문의 `#old`를 `#new`로. 바꾼 횟수를 함께 돌려준다.
///
/// ‼️ 코드 펜스 안은 건드리지 않는다. 읽는 쪽(`get_vault_tags`)이 `strip_code_blocks`로
/// 펜스를 걷어내므로, 여기서 걷어내지 않으면 **인덱스에 세지도 않은 문자열을 우리가
/// 고치게 된다** — 태그 이름을 바꿨을 뿐인데 문서에 실린 셸 주석이나 CSS id가 망가진다.
/// 펜스 판정은 `md::is_fence_delimiter` 하나를 양쪽이 쓴다.
///
/// 줄 종결자를 잘라내지 않고 조각에 포함시킨 채 다룬다(`lines()`가 아니다). rename은
/// 파일 전체를 되쓰므로 CRLF와 마지막 개행 유무가 **바이트 그대로** 살아남아야 한다.
fn rename_inline(body: &str, old: &str, new: &str) -> (String, usize) {
    let mut out = String::with_capacity(body.len());
    let mut count = 0usize;
    let mut in_fence = false;
    let mut rest = body;
    while !rest.is_empty() {
        let (line, tail) = match rest.find('\n') {
            Some(i) => rest.split_at(i + 1),
            None => (rest, ""),
        };
        if is_fence_delimiter(line) {
            in_fence = !in_fence;
            out.push_str(line);
        } else if in_fence {
            out.push_str(line);
        } else {
            let (replaced, n) = rename_inline_in_line(line, old, new);
            out.push_str(&replaced);
            count += n;
        }
        rest = tail;
    }
    (out, count)
}

/// 한 줄 안의 `#old`를 전부 `#new`로.
///
/// ‼️ 정규식이 아니라 손으로 훑는다. 원래 코드는 경계를 lookahead로 쟀는데 `regex`
/// 크레이트는 lookaround를 **지원하지 않는다** — `Regex::new`가 컴파일 단계에서 실패해
/// `rename_tag`이 어떤 입력에도 오류만 돌려주고 있었다(테스트가 하나도 없어 드러나지
/// 않았다). 경계를 소비하는 방식으로 우회하면 `#a #a`처럼 붙어 나오는 두 번째를 놓치므로,
/// 아예 `md::is_tag_char`를 직접 보는 훑기로 간다 — 태스크 줄의 태그 토글
/// (`task::tag::find_tag`)과 **같은 자**다.
fn rename_inline_in_line(line: &str, old: &str, new: &str) -> (String, usize) {
    let needle = format!("#{}", old);
    let mut out = String::with_capacity(line.len());
    let mut count = 0usize;
    let mut from = 0usize;
    while let Some(rel) = line[from..].find(&needle) {
        let start = from + rel;
        let end = start + needle.len();
        // 앞: 줄 시작이거나 공백·여는 괄호. `INLINE_TAG_RE`와 같은 규칙 — 단어 안이나
        // URL 조각(`.../#anchor`)을 태그로 읽으면 남의 글자를 바꿔 놓는다.
        let before_ok =
            start == 0 || line[..start].ends_with(|c: char| c.is_whitespace() || c == '(');
        out.push_str(&line[from..start]);
        if before_ok && ends_tag(line[end..].chars().next()) {
            out.push('#');
            out.push_str(new);
            count += 1;
        } else {
            out.push_str(&needle);
        }
        from = end;
    }
    out.push_str(&line[from..]);
    (out, count)
}

/// 프론트매터 인라인 배열 `tags: [a, old, b]` 안의 이름 하나를 바꾼다.
///
/// 대괄호 **안에서만** 바꾼다 — 본문에 우연히 같은 낱말이 있어도 건드리지 않는다.
/// 여기서도 경계는 `md::is_tag_char`다: 원래의 `(?<!\w)`/`(?!\w)`는 lookaround라
/// 컴파일되지 않았고, `\w`는 하이픈도 `/`도 태그 글자로 보지 않아 `deep-work`를
/// `deep`으로 바꿔 놓았을 것이다.
fn rename_frontmatter_list(content: &str, old: &str, new: &str) -> (String, usize) {
    let mut out = String::with_capacity(content.len());
    let mut count = 0usize;
    let mut last = 0usize;
    // 바꿀 것은 캡처 그룹(대괄호 **안**)뿐이므로 나머지는 그대로 흘려보낸다.
    for caps in FM_TAGS_INLINE_RE.captures_iter(content) {
        let inner = caps.get(1).unwrap();
        out.push_str(&content[last..inner.start()]);
        let (replaced, n) = rename_in_list(inner.as_str(), old, new);
        out.push_str(&replaced);
        count += n;
        last = inner.end();
    }
    out.push_str(&content[last..]);
    (out, count)
}

/// 쉼표로 나열된 이름들 안에서 `old`를 통째로 만나는 자리마다 바꾼다.
fn rename_in_list(list: &str, old: &str, new: &str) -> (String, usize) {
    let mut out = String::with_capacity(list.len());
    let mut count = 0usize;
    let mut from = 0usize;
    while let Some(rel) = list[from..].find(old) {
        let start = from + rel;
        let end = start + old.len();
        let before_ok = start == 0 || !list[..start].ends_with(is_tag_char);
        out.push_str(&list[from..start]);
        if before_ok && ends_tag(list[end..].chars().next()) {
            out.push_str(new);
            count += 1;
        } else {
            out.push_str(old);
        }
        from = end;
    }
    out.push_str(&list[from..]);
    (out, count)
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

    // 프론트매터 블록 리스트 항목: `  - old_tag` (줄 전체). 이것만 정규식으로 남는다 —
    // lookaround가 없고 줄 앵커만 쓰기 때문이다.
    let fm_block_re = Regex::new(&format!(
        r"(?m)^([ \t]+-[ \t]+)({})$",
        regex::escape(old_tag)
    ))
    .map_err(|e| TagError::Custom(e.to_string()))?;

    let mut files_modified = 0usize;
    let mut occurrences_replaced = 0usize;

    for file_path in &md_files {
        let content = match tokio::fs::read_to_string(file_path).await {
            Ok(c) => c,
            Err(_) => continue,
        };

        let mut count = 0usize;

        // 본문의 `#old_tag`와 `#old_tag/child`
        let (after_inline, n) = rename_inline(&content, old_tag, new_tag);
        count += n;

        // 프론트매터 인라인 배열 `tags: [..., old_tag, ...]`
        let (after_fm_inline, n) = rename_frontmatter_list(&after_inline, old_tag, new_tag);
        count += n;

        // 프론트매터 블록 리스트 항목
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    async fn vault(body: &str) -> (TempDir, String) {
        let d = TempDir::new().unwrap();
        tokio::fs::write(d.path().join("a.md"), body).await.unwrap();
        let root = d.path().to_string_lossy().into_owned();
        (d, root)
    }

    async fn read(d: &TempDir) -> String {
        tokio::fs::read_to_string(d.path().join("a.md"))
            .await
            .unwrap()
    }

    /// ‼️ `rename_tag`은 태그 어휘를 **또 한 벌** 갖고 있다: 경계를 문자 클래스가 아니라
    /// lookahead `(?=/|[\s,.\]\)!?;:\n]|$)`로 잰다. 하이픈이 그 집합에 없다는 것이 이
    /// 두 테스트가 지키는 계약이다 — `INLINE_TAG_RE`가 하이픈을 태그 글자로 읽는 것과
    /// 정확히 짝이 맞는다. 한쪽만 바뀌면 패널이 보여준 이름으로 rename이 무동작하거나
    /// (예전 상태), 남의 태그를 잘라 놓는다.
    #[tokio::test]
    async fn renames_a_hyphenated_tag_the_panel_now_shows() {
        let (d, root) = vault("메모 #deep-work 끝\n").await;
        let r = rename_tag(&root, "deep-work", "focus").await.unwrap();
        assert_eq!(r.occurrences_replaced, 1);
        assert_eq!(read(&d).await, "메모 #focus 끝\n");
    }

    #[tokio::test]
    async fn renaming_a_prefix_does_not_cut_into_a_longer_hyphenated_tag() {
        // 인덱서가 이 줄에서 읽는 이름은 이제 "deep-work"뿐이므로 "deep"은 패널에
        // 뜨지도 않는다. 그래도 프런트가 어떤 경로로 부르든 남의 태그를 자르지 않는다.
        let (d, root) = vault("메모 #deep-work 끝\n").await;
        let r = rename_tag(&root, "deep", "focus").await.unwrap();
        assert_eq!(r.occurrences_replaced, 0);
        assert_eq!(read(&d).await, "메모 #deep-work 끝\n");
    }

    /// 이 파일에는 테스트가 하나도 없었고, 그래서 `rename_tag`이 **모든 입력에서 오류를
    /// 돌려주고 있다는 사실**이 드러나지 않았다(lookaround는 `regex` 크레이트가 지원하지
    /// 않아 `Regex::new`가 실패했다). 아래는 그 기능이 실제로 무엇을 하기로 되어 있는지의
    /// 표다 — UI(`TagPanel`)가 부르는 경로 그대로.
    #[tokio::test]
    async fn renames_every_inline_occurrence_including_adjacent_ones() {
        // 경계를 **소비하는** 방식(정규식 우회)으로 고쳤다면 두 번째를 놓쳤을 자리다.
        let (d, root) = vault("#work #work 둘\n").await;
        let r = rename_tag(&root, "work", "focus").await.unwrap();
        assert_eq!(r.occurrences_replaced, 2);
        assert_eq!(read(&d).await, "#focus #focus 둘\n");
    }

    #[tokio::test]
    async fn leaves_a_url_fragment_and_a_mid_word_hash_alone() {
        let body = "주소 http://x/#work 그리고 a#work 끝\n";
        let (d, root) = vault(body).await;
        let r = rename_tag(&root, "work", "focus").await.unwrap();
        assert_eq!(r.occurrences_replaced, 0);
        assert_eq!(read(&d).await, body);
    }

    /// 읽는 쪽은 펜스를 걷어내고(`get_vault_tags` → `strip_code_blocks`) 쓰는 쪽은
    /// 걷어내지 않던 시절, 태그 이름을 바꾸면 문서에 실린 코드 예제가 함께 바뀌었다.
    /// 인덱스가 세지도 않은 문자열을 고치는 것이므로 사용자에게는 원인 없는 손상이다.
    #[tokio::test]
    async fn a_tag_inside_a_code_fence_is_not_renamed() {
        let body = "메모 #work 끝\n\n```sh\n# 주석 안의 #work 는 코드다\ngrep '#work' .\n```\n\n뒤 #work\n";
        let (d, root) = vault(body).await;
        let r = rename_tag(&root, "work", "focus").await.unwrap();

        // 펜스 밖 두 곳만.
        assert_eq!(r.occurrences_replaced, 2);
        assert_eq!(
            read(&d).await,
            "메모 #focus 끝\n\n```sh\n# 주석 안의 #work 는 코드다\ngrep '#work' .\n```\n\n뒤 #focus\n"
        );
    }

    #[tokio::test]
    async fn a_tilde_fence_closes_a_backtick_fence_just_like_the_indexer_thinks() {
        // 느슨한 규칙이지만 **양쪽이 똑같이 느슨한 것**이 계약이다. 여기서만 엄격해지면
        // 인덱스가 코드로 본 구간을 rename이 본문으로 보게 된다.
        let body = "```\n#work\n~~~\n#work 밖\n";
        let (d, root) = vault(body).await;
        let r = rename_tag(&root, "work", "focus").await.unwrap();
        assert_eq!(r.occurrences_replaced, 1);
        assert_eq!(read(&d).await, "```\n#work\n~~~\n#focus 밖\n");
    }

    /// rename은 파일 전체를 되쓴다 — 줄 단위로 다루기 시작했으므로 줄 종결자와 마지막
    /// 개행 유무가 바이트 그대로 살아남는지 못박는다. `lines()`를 쓰면 여기서 깨진다.
    #[tokio::test]
    async fn line_endings_and_a_missing_final_newline_survive() {
        for (input, want) in [
            ("a\r\n#work\r\nb\r\n", "a\r\n#focus\r\nb\r\n"),
            ("#work", "#focus"),
            ("a\n#work", "a\n#focus"),
            ("#work\n\n", "#focus\n\n"),
        ] {
            let (d, root) = vault(input).await;
            rename_tag(&root, "work", "focus").await.unwrap();
            assert_eq!(read(&d).await, want, "input {:?}", input);
        }
    }

    /// 펜스가 닫히지 않은 파일에서 그 뒤가 통째로 코드로 남는가 — 인덱서도 그렇게 읽는다.
    #[tokio::test]
    async fn an_unclosed_fence_swallows_the_rest_of_the_file() {
        let body = "앞 #work\n```\n#work\n#work\n";
        let (d, root) = vault(body).await;
        let r = rename_tag(&root, "work", "focus").await.unwrap();
        assert_eq!(r.occurrences_replaced, 1);
        assert_eq!(read(&d).await, "앞 #focus\n```\n#work\n#work\n");
    }

    #[tokio::test]
    async fn renames_a_frontmatter_inline_array_entry() {
        let (d, root) = vault("---\ntags: [deep-work, other]\n---\n본문\n").await;
        let r = rename_tag(&root, "deep-work", "focus").await.unwrap();
        assert_eq!(r.occurrences_replaced, 1);
        assert_eq!(read(&d).await, "---\ntags: [focus, other]\n---\n본문\n");
    }

    #[tokio::test]
    async fn a_frontmatter_entry_that_merely_contains_the_name_is_left_alone() {
        // `work`를 바꿔도 `homework`·`work-log`는 남의 이름이다.
        let body = "---\ntags: [homework, work-log]\n---\n본문\n";
        let (d, root) = vault(body).await;
        let r = rename_tag(&root, "work", "focus").await.unwrap();
        assert_eq!(r.occurrences_replaced, 0);
        assert_eq!(read(&d).await, body);
    }

    #[tokio::test]
    async fn renames_a_frontmatter_block_list_item() {
        let (d, root) = vault("---\ntags:\n  - deep-work\n---\n본문\n").await;
        let r = rename_tag(&root, "deep-work", "focus").await.unwrap();
        assert_eq!(r.occurrences_replaced, 1);
        assert_eq!(read(&d).await, "---\ntags:\n  - focus\n---\n본문\n");
    }

    #[tokio::test]
    async fn reports_nothing_changed_when_the_tag_is_absent() {
        let body = "아무 태그도 없다\n";
        let (d, root) = vault(body).await;
        let r = rename_tag(&root, "work", "focus").await.unwrap();
        assert_eq!((r.files_modified, r.occurrences_replaced), (0, 0));
        assert_eq!(read(&d).await, body);
    }

    #[tokio::test]
    async fn a_nested_child_still_follows_its_renamed_parent() {
        let (d, root) = vault("메모 #project/baram 끝\n").await;
        rename_tag(&root, "project", "work").await.unwrap();
        assert_eq!(read(&d).await, "메모 #work/baram 끝\n");
    }
}
