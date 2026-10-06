//! Issue 794: what the vault walk leaves out (`crate::fs::VaultExclusion`) stays out of
//! the link index on save too — the build keeps its matcher and the save is judged by it.
use super::*;

fn write(root: &std::path::Path, rel: &str, body: &str) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, body).unwrap();
}

async fn indexed_vault(
    ctx: &ContextManager,
    dir: &std::path::Path,
    files: &[(&str, &str)],
) -> (LinkIndexState, String) {
    for (rel, body) in files {
        write(dir, rel, body);
    }
    let root = dir.to_str().unwrap().to_string();
    ctx.add(info("ctx-x", &root, ContextType::Folder))
        .await
        .unwrap();
    ctx.set_active("ctx-x").await.unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, ctx, &root).await.unwrap();
    (state, root)
}

/// A note under `build/` is not a backlink after the build, and saving it does not put
/// it back; a note outside it does enter on save — the gate is not shutting every save.
/// 이것을 실패시키는 것: `update_file_from_content` 의 `walk_skips` 관문을 지우는 것.
#[tokio::test]
async fn a_saved_note_in_an_excluded_folder_does_not_enter_the_index() {
    let ctx = ContextManager::new();
    let dir = tempfile::tempdir().unwrap();
    let (state, root) = indexed_vault(
        &ctx,
        dir.path(),
        &[("b.md", "target"), ("build/n.md", "see [[b]]")],
    )
    .await;
    let target = format!("{root}/b.md");
    assert!(get_backlinks_inner(&state, &ctx, &target)
        .await
        .unwrap()
        .is_empty());

    write(dir.path(), "build/n.md", "see [[b]] again");
    update_file_index_inner(&state, &ctx, &format!("{root}/build/n.md"))
        .await
        .unwrap();
    assert!(get_backlinks_inner(&state, &ctx, &target)
        .await
        .unwrap()
        .is_empty());

    write(dir.path(), "notes/a.md", "see [[b]]");
    update_file_index_inner(&state, &ctx, &format!("{root}/notes/a.md"))
        .await
        .unwrap();
    let backlinks = get_backlinks_inner(&state, &ctx, &target).await.unwrap();
    assert_eq!(sources(&backlinks), vec![format!("{root}/notes/a.md")]);
}

/// `!build/` in the vault's `.baramignore` brings the folder's notes back as backlinks,
/// on build and on save. 이것을 실패시키는 것: `VaultExclusion::load` 가 `.baramignore`
/// 를 읽지 않는 것.
#[tokio::test]
async fn an_override_brings_an_excluded_folder_back() {
    let ctx = ContextManager::new();
    let dir = tempfile::tempdir().unwrap();
    let (state, root) = indexed_vault(
        &ctx,
        dir.path(),
        &[
            (crate::fs::BARAMIGNORE, "!build/\n"),
            ("b.md", "target"),
            ("build/n.md", "see [[b]]"),
        ],
    )
    .await;
    let target = format!("{root}/b.md");
    let backlinks = get_backlinks_inner(&state, &ctx, &target).await.unwrap();
    assert_eq!(sources(&backlinks), vec![format!("{root}/build/n.md")]);

    write(dir.path(), "build/m.md", "and [[b]]");
    update_file_index_inner(&state, &ctx, &format!("{root}/build/m.md"))
        .await
        .unwrap();
    let backlinks = get_backlinks_inner(&state, &ctx, &target).await.unwrap();
    assert_eq!(
        sources(&backlinks),
        vec![format!("{root}/build/m.md"), format!("{root}/build/n.md")]
    );
}

/// A vault whose root folder is named `build` indexes and takes saves like any other.
/// 이것을 실패시키는 것: `VaultExclusion` 이 root 의 부모를 기준으로 판정하는 것.
#[tokio::test]
async fn a_vault_root_named_build_is_indexed() {
    let ctx = ContextManager::new();
    let parent = tempfile::tempdir().unwrap();
    let dir = parent.path().join("build");
    let (state, root) =
        indexed_vault(&ctx, &dir, &[("a.md", "see [[b]]"), ("b.md", "target")]).await;
    let target = format!("{root}/b.md");
    let backlinks = get_backlinks_inner(&state, &ctx, &target).await.unwrap();
    assert_eq!(sources(&backlinks), vec![format!("{root}/a.md")]);

    write(&dir, "c.md", "also [[b]]");
    update_file_index_inner(&state, &ctx, &format!("{root}/c.md"))
        .await
        .unwrap();
    let backlinks = get_backlinks_inner(&state, &ctx, &target).await.unwrap();
    assert_eq!(
        sources(&backlinks),
        vec![format!("{root}/a.md"), format!("{root}/c.md")]
    );
}
