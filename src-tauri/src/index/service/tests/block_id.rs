use super::*;

#[cfg(unix)]
#[tokio::test]
async fn a_block_id_rename_past_its_first_write_reports_instead_of_failing() {
    // issue 594: once one referrer has been rewritten there is no "nothing
    // changed" to fall back to. The second referrer's failure used to come
    // back as `Err` — with the first already saying `b2` and the index never
    // told. Now the command finishes what it can and names what it could not.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    std::fs::write(dir.path().join("target.md"), "para ^b1").unwrap();
    std::fs::write(dir.path().join("x.md"), "see ((target#^b1))").unwrap();
    std::fs::create_dir(dir.path().join("ro")).unwrap();
    std::fs::write(dir.path().join("ro/y.md"), "see ((target#^b1))").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let locked = lock_directory(&dir.path().join("ro"));
    let result =
        rename_block_id_inner(&state, &ctx, &format!("{root}/target.md"), "b1", "b2").await;
    unlock_directory(&dir.path().join("ro"));
    let result = result.unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/x.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("x.md")).unwrap(),
        "see ((target#^b2))"
    );
    if !locked {
        return;
    }
    assert_eq!(result.skipped_files, vec![format!("{root}/ro/y.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("ro/y.md")).unwrap(),
        "see ((target#^b1))"
    );
    // The index knows the file that WAS rewritten under its new id.
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/target.md"))
        .await
        .unwrap();
    let ids: Vec<(&str, Option<&str>)> = backlinks
        .iter()
        .map(|b| (b.source_path.as_str(), b.block_id.as_deref()))
        .collect();
    assert!(
        ids.contains(&(format!("{root}/x.md").as_str(), Some("b2"))),
        "{ids:?}"
    );
    assert!(
        ids.contains(&(format!("{root}/ro/y.md").as_str(), Some("b1"))),
        "{ids:?}"
    );
}

#[tokio::test]
async fn a_block_id_rename_leaves_another_notes_block_with_the_same_id_alone() {
    // issue 594: `x.md` refers to target's ^b1 AND to other's ^b1, on one line
    // and on separate lines. Only the references to target change; the
    // reference to `other` keeps its ID, and so does a self-reference.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    std::fs::write(dir.path().join("target.md"), "para ^b1").unwrap();
    std::fs::write(dir.path().join("other.md"), "para ^b1").unwrap();
    std::fs::write(
        dir.path().join("x.md"),
        // The last line pairs a wikilink and a block reference to the same
        // file: `get_backlinks` keeps one entry per (source, line) and would
        // have hidden the block reference behind the wikilink.
        "((target#^b1)) and ((other#^b1))\n((other#^b1)) alone\n((#^b1)) mine ^b1\n((Target.md#^b1|label))\n[[target]] ((target#^b1))",
    )
    .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let result = rename_block_id_inner(&state, &ctx, &format!("{root}/target.md"), "b1", "b2")
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/x.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("x.md")).unwrap(),
        "((target#^b2)) and ((other#^b1))\n((other#^b1)) alone\n((#^b1)) mine ^b1\n((Target.md#^b2|label))\n[[target]] ((target#^b2))"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("other.md")).unwrap(),
        "para ^b1"
    );
}

#[tokio::test]
async fn a_block_id_rename_counts_ambiguity_in_the_visit_that_rewrites() {
    // One referrer under one root. The rewrite reads it with the index's
    // grammar once and counts ambiguous references in that same read, so
    // the rename costs three literal analyses: the rewrite's `extract_links`,
    // the regions it rewrites in, and the index's re-reading of the file it
    // wrote.
    // What fails this: counting ambiguous references in a pass of their own
    // — a second `replace_block_id_refs_to` over the referrer for its
    // `ambiguous` makes it five.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-count", true).await;
    std::fs::write(dir.path().join("note.md"), "para ^b1\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "see ((note#^b1))\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let before = crate::md::literal::analyses();
    let result = rename_block_id_inner(&state, &ctx, &format!("{root}/note.md"), "b1", "b2")
        .await
        .unwrap();
    assert_eq!(crate::md::literal::analyses() - before, 3);
    assert_eq!(result.updated_files, vec![format!("{root}/r.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "see ((note#^b2))\n"
    );
}

#[tokio::test]
async fn a_block_id_rename_finds_a_reference_the_index_remembers_on_another_line() {
    // issue 668: `a.md` was indexed with its reference on line 1, then edited
    // outside the app — a line inserted above — with the tab closed, so the
    // index still says line 1. The rewrite reads the file as it is now.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-668", true).await;
    std::fs::write(dir.path().join("note.md"), "para ^b1\n").unwrap();
    std::fs::write(dir.path().join("a.md"), "see ((note#^b1))\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    std::fs::write(
        dir.path().join("a.md"),
        "inserted above\n\nsee ((note#^b1))\n",
    )
    .unwrap();

    let result = rename_block_id_inner(&state, &ctx, &format!("{root}/note.md"), "b1", "b2")
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/a.md")]);
    assert!(result.skipped_files.is_empty());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
        "inserted above\n\nsee ((note#^b2))\n"
    );
}

#[tokio::test]
async fn a_block_id_rename_reports_a_referrer_whose_reference_is_gone() {
    // issue 668: the index names `a.md`, but on disk the reference has since
    // been turned into code. Nothing changes in the file — and that is not
    // success: the definition takes the new ID while `a.md` keeps the old one,
    // so the file is reported like any referrer whose links were not updated.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-668b", true).await;
    std::fs::write(dir.path().join("note.md"), "para ^b1\n").unwrap();
    std::fs::write(dir.path().join("a.md"), "see ((note#^b1))\n").unwrap();
    std::fs::write(dir.path().join("b.md"), "see ((note#^b1)) too\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    std::fs::write(dir.path().join("a.md"), "see `((note#^b1))`\n").unwrap();

    let result = rename_block_id_inner(&state, &ctx, &format!("{root}/note.md"), "b1", "b2")
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/b.md")]);
    assert_eq!(result.skipped_files, vec![format!("{root}/a.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
        "see `((note#^b1))`\n"
    );
}

#[tokio::test]
async fn a_block_id_rename_reaches_a_path_qualified_reference() {
    // issue 619: a reference that names the note by its path under the root
    // — spelled from the root, or relative to the referrer's folder — is
    // filed under that path, so the block-ID rename reaches it. A reference
    // to another folder's `note` keeps its ID.
    // What fails this: dropping the `Path` key from `keys_for`, so the index
    // names neither referrer and `updated_files` is empty.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-619a", true).await;
    std::fs::create_dir_all(dir.path().join("dir")).unwrap();
    std::fs::create_dir_all(dir.path().join("other")).unwrap();
    std::fs::write(dir.path().join("dir/note.md"), "para ^b1\n").unwrap();
    std::fs::write(dir.path().join("other/note.md"), "para ^b1\n").unwrap();
    std::fs::write(
        dir.path().join("r.md"),
        "((dir/note#^b1))\n{{embed ((dir/note#^b1))}}\n((other/note#^b1))\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("dir/s.md"),
        "((./note#^b1))\n((../dir/note#^b1|shown))\n",
    )
    .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_block_id_inner(&state, &ctx, &format!("{root}/dir/note.md"), "b1", "b2")
        .await
        .unwrap();
    assert_eq!(
        result.updated_files,
        vec![format!("{root}/dir/s.md"), format!("{root}/r.md")]
    );
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "((dir/note#^b2))\n{{embed ((dir/note#^b2))}}\n((other/note#^b1))\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("dir/s.md")).unwrap(),
        "((./note#^b2))\n((../dir/note#^b2|shown))\n"
    );
    // The index took the rewritten files: every backlink names the new ID.
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/dir/note.md"))
        .await
        .unwrap();
    let ids: Vec<Option<&str>> = backlinks.iter().map(|b| b.block_id.as_deref()).collect();
    assert_eq!(ids, vec![Some("b2"); 4], "{backlinks:?}");
}
