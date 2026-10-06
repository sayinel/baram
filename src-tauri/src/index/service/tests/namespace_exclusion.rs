//! Issue 794: a folder rename judges what the walk leaves out by `.baramignore` as it is
//! NOW — the rebuild it ends with reads it the same way — and refuses a move across the
//! boundary between what the walk reads and what it leaves out.
use super::*;

fn write(root: &std::path::Path, rel: &str, body: &str) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, body).unwrap();
}

/// A vault with `ns/a.md`, a referrer at the top and one in `drafts/`, indexed.
async fn fixture(
    ctx: &ContextManager,
    baramignore: Option<&str>,
) -> (tempfile::TempDir, String, LinkIndexState) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_str().unwrap().to_string();
    write(dir.path(), "ns/a.md", "target");
    write(dir.path(), "top.md", "see [[./ns/a]]");
    write(dir.path(), "drafts/ref.md", "see [[../ns/a]]");
    if let Some(text) = baramignore {
        write(dir.path(), crate::fs::BARAMIGNORE, text);
    }
    ctx.add(info("ctx-ns", &root, ContextType::Folder))
        .await
        .unwrap();
    ctx.set_active("ctx-ns").await.unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, ctx, &root).await.unwrap();
    (dir, root, state)
}

async fn rename(
    state: &LinkIndexState,
    ctx: &ContextManager,
    root: &str,
    from: &str,
    to: &str,
) -> Result<NamespaceRenameResult, String> {
    rename_namespace_inner(
        state,
        ctx,
        &format!("{root}/{from}"),
        &format!("{root}/{to}"),
        root,
    )
    .await
}

/// `drafts/` is left out AFTER the index was built. The rename leaves `drafts/ref.md`
/// alone, and the index it publishes does not count it either — the rewrite and the
/// count agree. 이것을 실패시키는 것: `rename_namespace_inner` 가 라이브 index 의
/// build-time matcher(`state.with_index(..).exclusion()`)로 판정하는 것.
#[tokio::test]
async fn a_rule_added_since_the_build_is_what_the_rename_and_the_rebuild_apply() {
    let ctx = ContextManager::new();
    let (dir, root, state) = fixture(&ctx, None).await;
    write(dir.path(), crate::fs::BARAMIGNORE, "drafts/\n");

    let result = rename(&state, &ctx, &root, "ns", "ns2").await.unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/top.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("drafts/ref.md")).unwrap(),
        "see [[../ns/a]]"
    );
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/ns2/a.md"))
        .await
        .unwrap();
    assert_eq!(sources(&backlinks), vec![format!("{root}/top.md")]);
}

/// The reverse: `drafts/` was left out at build time and is not any more. The rename
/// rewrites `drafts/ref.md` and the rebuilt index counts it. 이것을 실패시키는 것: 위와
/// 같은 변이 — build-time matcher 는 아직 `drafts/` 를 빼므로 고치지 않는다.
#[tokio::test]
async fn a_rule_removed_since_the_build_is_what_the_rename_and_the_rebuild_apply() {
    let ctx = ContextManager::new();
    let (dir, root, state) = fixture(&ctx, Some("drafts/\n")).await;
    std::fs::remove_file(dir.path().join(crate::fs::BARAMIGNORE)).unwrap();

    let mut result = rename(&state, &ctx, &root, "ns", "ns2").await.unwrap();
    result.updated_files.sort();
    assert_eq!(
        result.updated_files,
        vec![format!("{root}/drafts/ref.md"), format!("{root}/top.md")]
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("drafts/ref.md")).unwrap(),
        "see [[../ns2/a]]"
    );
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/ns2/a.md"))
        .await
        .unwrap();
    assert_eq!(
        sources(&backlinks),
        vec![format!("{root}/drafts/ref.md"), format!("{root}/top.md")]
    );
}

/// A move across the boundary is refused with nothing moved, both ways; a move on one
/// side of it is not. `archive/` is left out by `.baramignore` only, so the tree shows it.
/// 이것을 실패시키는 것: `commit_namespace_rename` 의 경계 검사를 지우는 것 — 앞의 두
/// rename 이 성공한다.
#[tokio::test]
async fn a_folder_rename_across_what_the_walk_leaves_out_is_refused() {
    let ctx = ContextManager::new();
    let (dir, root, state) = fixture(&ctx, Some("archive/\nold/\n")).await;
    write(dir.path(), "archive/b.md", "see [[../archive/c]]");
    write(dir.path(), "archive/c.md", "c");

    // Left out -> read: archive's own links were never walked.
    let err = rename(&state, &ctx, &root, "archive", "notes")
        .await
        .unwrap_err();
    assert!(err.contains("leaves out"), "{err}");
    assert!(dir.path().join("archive/b.md").exists());
    // Read -> left out: by `.baramignore`, and by the default list.
    for to in ["old", "build"] {
        let err = rename(&state, &ctx, &root, "ns", to).await.unwrap_err();
        assert!(err.contains("leaves out"), "{to}: {err}");
        assert!(dir.path().join("ns/a.md").exists(), "{to}");
    }

    // Left out -> left out, and read -> read, go ahead.
    rename(&state, &ctx, &root, "archive", "old").await.unwrap();
    assert!(dir.path().join("old/b.md").exists());
    let result = rename(&state, &ctx, &root, "ns", "ns2").await.unwrap();
    assert_eq!(result.files_moved, 1);
}

/// A note renamed to a name `.baramignore` leaves out (or out of one) is refused by the
/// file rename; a rename on one side is not. 이것을 실패시키는 것:
/// `rename_file_with_links_inner` 의 경계 검사를 지우는 것.
#[tokio::test]
async fn a_note_rename_across_what_the_walk_leaves_out_is_refused() {
    let ctx = ContextManager::new();
    let (dir, root, state) = fixture(&ctx, Some("*.draft.md\n")).await;
    write(dir.path(), "x.draft.md", "x");
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    for (from, to) in [("top.md", "top.draft.md"), ("x.draft.md", "x.md")] {
        let err = rename_file_with_links_inner(
            &state,
            &ctx,
            &format!("{root}/{from}"),
            &format!("{root}/{to}"),
        )
        .await
        .unwrap_err();
        assert!(err.contains("leaves out"), "{from}: {err}");
        assert!(dir.path().join(from).exists(), "{from}");
    }
    rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/top.md"),
        &format!("{root}/top2.md"),
    )
    .await
    .unwrap();
    assert!(dir.path().join("top2.md").exists());
}
