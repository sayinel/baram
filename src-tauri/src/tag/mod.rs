// §56m Vault-wide tag index — business logic

mod frontmatter;

pub(crate) use frontmatter::extract_frontmatter_tags;

use crate::md::{
    cut_frontmatter, extract_inline_tags, is_fence_delimiter, is_tag_char, split_frontmatter,
    strip_code_blocks,
};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use thiserror::Error;

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

/// §393 A tag name as the index keeps it: without the `#`s in front — every leading one, the
/// rule `baram tag` has always applied to the name typed. §56m The front-matter reader keeps a
/// `tags:` entry the same way (`frontmatter::entry_name`), so `"#solo"` there and a body `#solo`
/// are one tag `solo`. Case is left alone; the walks compare lowercased.
pub fn bare_tag(name: &str) -> &str {
    name.trim_start_matches('#')
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

/// §56m One note's rename, cut where the readers cut it (`md::cut_frontmatter`): the front
/// matter's tag lists (`frontmatter::rename_frontmatter_tags`) and the body's `#tags`
/// (`rename_inline`). Neither writer sees the other's part — as neither reader does — so a
/// `#old` in another front-matter field and a `- old` line in the body stay as uncounted as
/// the readers leave them, and no entry is rewritten twice.
fn rename_in_note(content: &str, old: &str, new: &str) -> (String, usize) {
    let Some(cut) = cut_frontmatter(content) else {
        return rename_inline(content, old, new);
    };
    let (matter, in_matter) = frontmatter::rename_frontmatter_tags(cut.matter, old, new);
    let (body, in_body) = rename_inline(cut.body, old, new);
    (
        [cut.open, matter.as_str(), cut.close, body.as_str()].concat(),
        in_matter + in_body,
    )
}

/// Rename (or merge) a tag across all .md files in the vault.
/// Handles:
///   - Inline #tags in body text
///   - Frontmatter tags: inline array `tags: [tag1, tag2]`
///   - Frontmatter tags: block list `tags:\n  - tag1`
///
/// Prefix rename: renaming `project` also renames `project/baram` → `new/baram`.
/// Both names are bare (`bare_tag`) — `tag_cmd::rename_tag` strips what the app passes.
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

    let mut files_modified = 0usize;
    let mut occurrences_replaced = 0usize;

    for file_path in &md_files {
        let content = match tokio::fs::read_to_string(file_path).await {
            Ok(c) => c,
            Err(_) => continue,
        };

        let (new_content, count) = rename_in_note(&content, old_tag, new_tag);

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

    /// §56m Every front-matter spelling the reader names `solo` is renamed, and only the
    /// name changes: the user's quotes and `#` stay. What fails this: the block-item writer
    /// matching only a bare value that fills the line (the old `fm_block_re` — the three
    /// quoted block rows stay `solo`).
    #[tokio::test]
    async fn every_front_matter_spelling_of_a_tag_is_renamed_keeping_its_quotes_and_hash() {
        for (spelling, want) in [
            ("tags: [\"#solo\"]", "tags: [\"#focus\"]"),
            ("tags: [#solo]", "tags: [#focus]"),
            ("tags: ['solo']", "tags: ['focus']"),
            ("tags: [a, \"#solo\", b]", "tags: [a, \"#focus\", b]"),
            ("tags:\n  - solo", "tags:\n  - focus"),
            ("tags:\n  - \"#solo\"", "tags:\n  - \"#focus\""),
            ("tags:\n  - '#solo'", "tags:\n  - '#focus'"),
            ("tags:\n  - #solo", "tags:\n  - #focus"),
            ("tags:\n  - \"solo\"", "tags:\n  - \"focus\""),
        ] {
            let (d, root) = vault(&format!("---\n{spelling}\n---\n본문\n")).await;
            let r = rename_tag(&root, "solo", "focus").await.unwrap();
            assert_eq!(r.occurrences_replaced, 1, "{spelling:?}");
            assert_eq!(
                read(&d).await,
                format!("---\n{want}\n---\n본문\n"),
                "{spelling:?}"
            );
        }
    }

    /// A child follows its parent in a block list as it does in an inline array and in the
    /// body. What fails this: a block-item writer that matches the whole name only.
    #[tokio::test]
    async fn a_nested_child_in_a_front_matter_list_follows_its_renamed_parent() {
        let (d, root) = vault(
            "---\ntags:\n  - project/baram\n  - \"#project/x\"\n  - project-two\n---\n\
             tags: [project/baram] 아님\n",
        )
        .await;
        let r = rename_tag(&root, "project", "work").await.unwrap();
        assert_eq!(r.occurrences_replaced, 2);
        assert_eq!(
            read(&d).await,
            "---\ntags:\n  - work/baram\n  - \"#work/x\"\n  - project-two\n---\n\
             tags: [project/baram] 아님\n"
        );
    }

    /// The rename rewrites what the readers count and nothing else (the code-fence rule
    /// above, applied to the front matter): an indented `- solo` in the body, a `- solo`
    /// under another key, a `tags: [solo]` line in the body, `#solo` in another front-matter
    /// field, and an entry the reader names something else (`solo.x`, `my solo`) are left
    /// alone, while the `tags:` entries in the same note are renamed. What fails this:
    /// running the front-matter writer over the whole note, or the body's writer over the
    /// front matter (the old `rename_tag` did both — the body's `  - solo` became `  - focus`).
    #[tokio::test]
    async fn only_the_lines_a_reader_counts_are_rewritten() {
        let (d, root) = vault(
            "---\ntitle: about #solo\naliases:\n  - solo\ntags:\n  - solo\nkeywords: [solo.x, my solo]\n\
             ---\n- list\n  - solo\ntags: [solo]\n본문 #solo\n",
        )
        .await;
        let r = rename_tag(&root, "solo", "focus").await.unwrap();
        assert_eq!(r.occurrences_replaced, 2);
        assert_eq!(
            read(&d).await,
            "---\ntitle: about #solo\naliases:\n  - solo\ntags:\n  - focus\nkeywords: [solo.x, my solo]\n\
             ---\n- list\n  - solo\ntags: [solo]\n본문 #focus\n"
        );
    }

    /// An inline-array entry is the tag the reader names, not every run of the name inside
    /// the brackets. What fails this: matching the name by its tag-character boundaries in the
    /// whole list (the old `rename_in_list`), which renamed `solo.x` and `my solo`.
    #[tokio::test]
    async fn an_inline_array_entry_naming_another_tag_is_left_alone() {
        let body = "---\ntags: [solo.x, my solo, \"#solo\"]\n---\n";
        let (d, root) = vault(body).await;
        let r = rename_tag(&root, "solo", "focus").await.unwrap();
        assert_eq!(r.occurrences_replaced, 1);
        assert_eq!(
            read(&d).await,
            "---\ntags: [solo.x, my solo, \"#focus\"]\n---\n"
        );
    }

    /// Renaming a tag to a child of itself rewrites each entry once. What fails this: two
    /// writers over one entry — the old body writer turned `#solo` in `[a, #solo]` into
    /// `#solo/x`, then the list writer found `solo` again and wrote `#solo/x/x`.
    #[tokio::test]
    async fn renaming_into_a_child_of_itself_rewrites_each_entry_once() {
        let (d, root) = vault("---\ntags: [a, #solo]\n---\n본문 #solo\n").await;
        let r = rename_tag(&root, "solo", "solo/x").await.unwrap();
        assert_eq!(r.occurrences_replaced, 2);
        assert_eq!(
            read(&d).await,
            "---\ntags: [a, #solo/x]\n---\n본문 #solo/x\n"
        );
    }

    /// The front matter's last line keeps its `\r` (the cut ends at the `\n` before the
    /// closing `---`); the name is renamed inside it and every CRLF survives. What fails
    /// this: taking the `\r` into the entry's name (`"#solo"\r` would not name `solo`).
    #[tokio::test]
    async fn a_crlf_front_matter_is_renamed_byte_for_byte() {
        let (d, root) = vault("---\r\ntags:\r\n  - \"#solo\"\r\n---\r\n본문 #solo\r\n").await;
        let r = rename_tag(&root, "solo", "focus").await.unwrap();
        assert_eq!(r.occurrences_replaced, 2);
        assert_eq!(
            read(&d).await,
            "---\r\ntags:\r\n  - \"#focus\"\r\n---\r\n본문 #focus\r\n"
        );
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

    async fn vault_of(files: &[(&str, &str)]) -> (TempDir, String) {
        let d = TempDir::new().unwrap();
        for (name, body) in files {
            tokio::fs::write(d.path().join(name), body).await.unwrap();
        }
        let root = d.path().to_string_lossy().into_owned();
        (d, root)
    }

    async fn rows(root: &str) -> Vec<(String, u32)> {
        get_vault_tags(root)
            .await
            .unwrap()
            .into_iter()
            .map(|entry| (entry.tag, entry.count))
            .collect()
    }

    async fn files_with(root: &str, tag: &str) -> Vec<String> {
        let mut found = get_files_by_tag(root, tag).await.unwrap();
        found.sort();
        found
    }

    /// §56m Normalized at storage (maintainer's decision, 2026-10-24): a front-matter
    /// `"#solo"`, a front-matter `"#Solo"` and a body `#solo` are one tag `solo`, counted
    /// together and found by its name. What fails this: the front-matter reader keeping the
    /// `#` (rows `#solo 2` and `solo 1`, and `solo` finds only `body.md`).
    #[tokio::test]
    async fn a_front_matter_hash_tag_and_a_body_tag_are_one_tag() {
        let (_d, root) = vault_of(&[
            ("fm.md", "---\ntags: [\"#solo\"]\n---\nfront only\n"),
            ("upper.md", "---\ntags: [\"#Solo\"]\n---\nfront upper\n"),
            ("body.md", "body #solo here\n"),
        ])
        .await;
        assert_eq!(rows(&root).await, [("solo".to_string(), 3)]);
        assert_eq!(
            files_with(&root, "solo").await,
            ["body.md", "fm.md", "upper.md"]
        );
    }

    /// A nested tag in the front matter, `"#a/b"`, is the body's `#a/b` — one row, counted
    /// twice. What fails this: the same `#` kept (rows `#a/b 1` and `a/b 1`).
    #[tokio::test]
    async fn a_nested_front_matter_hash_tag_is_the_bodys_nested_tag() {
        let (_d, root) = vault_of(&[("n.md", "---\ntags: [\"#a/b\"]\n---\nbody #a/b\n")]).await;
        assert_eq!(rows(&root).await, [("a/b".to_string(), 2)]);
        assert_eq!(files_with(&root, "a/b").await, ["n.md"]);
    }

    /// §393 What fails this: stripping one `#` only (`##work` would stay `#work` and match
    /// nothing), or touching a `#` inside the name. The pair: a name without `#` is untouched.
    #[test]
    fn a_bare_tag_drops_every_leading_hash_and_nothing_else() {
        assert_eq!(bare_tag("#work"), "work");
        assert_eq!(bare_tag("##work"), "work");
        assert_eq!(bare_tag("work"), "work");
        assert_eq!(bare_tag("work#1"), "work#1");
        assert_eq!(bare_tag("#"), "");
    }
}
