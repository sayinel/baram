use super::*;

#[tokio::test]
async fn a_block_id_rename_does_not_report_another_note_with_the_same_stem_for_its_own_reference() {
    // issue 668: `b/note.md` refers to its OWN block with `((#^b1))`, which the
    // index files under the stem `note` — the same key `a/note.md` is looked
    // up by. Renaming a/note's block names b/note as a referrer; nothing in
    // it changes, rightly, and that is not a stale index to report.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-668d", true).await;
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::create_dir_all(dir.path().join("b")).unwrap();
    std::fs::write(dir.path().join("a/note.md"), "para ^b1\n").unwrap();
    std::fs::write(dir.path().join("b/note.md"), "mine ^b1 ((#^b1))\n").unwrap();
    std::fs::write(dir.path().join("x.md"), "see ((note#^b1))\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_block_id_inner(&state, &ctx, &format!("{root}/a/note.md"), "b1", "b2")
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/x.md")]);
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("b/note.md")).unwrap(),
        "mine ^b1 ((#^b1))\n"
    );
}

#[tokio::test]
async fn a_block_id_rename_reports_a_same_stem_note_whose_reference_to_the_target_has_gone() {
    // issue 668: `b/note.md` referred to a/note's block as `((note#^b1))` —
    // filed under the stem `note`, as a self-reference would be — and was
    // edited outside the app since, the reference gone. Sharing the stem is
    // not why the index named it: nothing in it changes, and it is stale.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-668e", true).await;
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::create_dir_all(dir.path().join("b")).unwrap();
    std::fs::write(dir.path().join("a/note.md"), "para ^b1\n").unwrap();
    std::fs::write(dir.path().join("b/note.md"), "see ((note#^b1))\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    std::fs::write(dir.path().join("b/note.md"), "the reference is gone\n").unwrap();

    let result = rename_block_id_inner(&state, &ctx, &format!("{root}/a/note.md"), "b1", "b2")
        .await
        .unwrap();
    assert!(
        result.updated_files.is_empty(),
        "{:?}",
        result.updated_files
    );
    assert_eq!(result.skipped_files, vec![format!("{root}/b/note.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("b/note.md")).unwrap(),
        "the reference is gone\n"
    );
}

#[tokio::test]
async fn a_block_id_rename_reports_a_same_stem_note_whose_cross_reference_went_beside_its_own() {
    // issue 668: `b/note.md` held both its own `((#^b1))` and `((note#^b1))`
    // to a/note's block — two lines the index named it for. The second was
    // made code outside the app. The self-reference alone does not account
    // for what the index named: the file is stale, and reported.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-668f", true).await;
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::create_dir_all(dir.path().join("b")).unwrap();
    std::fs::write(dir.path().join("a/note.md"), "para ^b1\n").unwrap();
    std::fs::write(
        dir.path().join("b/note.md"),
        "mine ^b1 ((#^b1))\nsee ((note#^b1))\n",
    )
    .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let edited = "mine ^b1 ((#^b1))\nsee `((note#^b1))`\n";
    std::fs::write(dir.path().join("b/note.md"), edited).unwrap();

    let result = rename_block_id_inner(&state, &ctx, &format!("{root}/a/note.md"), "b1", "b2")
        .await
        .unwrap();
    assert!(
        result.updated_files.is_empty(),
        "{:?}",
        result.updated_files
    );
    assert_eq!(result.skipped_files, vec![format!("{root}/b/note.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("b/note.md")).unwrap(),
        edited
    );
}

#[tokio::test]
async fn a_file_rename_does_not_report_a_same_stem_note_named_for_its_own_references() {
    // issue 678: `b/old.md` refers to its OWN blocks with `((#^x))`, which the
    // index files under the stem `old` — the key `a/old.md`'s rename looks up.
    // Nothing in it changes, rightly, and that is not a stale index.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-678c", true).await;
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::create_dir_all(dir.path().join("b")).unwrap();
    std::fs::write(dir.path().join("a/old.md"), "para ^b1\n").unwrap();
    std::fs::write(
        dir.path().join("b/old.md"),
        "mine ^b1 ((#^b1))\nalso ((#^b2))\n",
    )
    .unwrap();
    std::fs::write(dir.path().join("r.md"), "see ((old#^b1))\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a/old.md"),
        &format!("{root}/a/new.md"),
    )
    .await
    .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/r.md")]);
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("b/old.md")).unwrap(),
        "mine ^b1 ((#^b1))\nalso ((#^b2))\n"
    );
}

#[tokio::test]
async fn nested_roots_a_same_stem_note_is_named_once_for_a_line_two_indexes_hold() {
    // issue 716: `sub/b/old.md` sits under both roots, so BOTH indexes name it
    // for its one `((#^x))` line — two `(source, line)` pairs for one line.
    // `named_referrers` folds them to one; the note holds one self-reference
    // line, which accounts for it, so the rename does not report it. Left
    // unfolded it would be named for two lines against one held and reported.
    // Also pins issue 619 here: `[[a/old]]` is matched under the child root,
    // where the file's path is `a/old`, and follows the rename.
    // What fails this: removing the `dedup()` in `named_referrers` — the note
    // is then named twice, `1 >= 2` fails, and it lands in `skipped_files`.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-716a", true).await;
    std::fs::create_dir_all(dir.path().join("sub/a")).unwrap();
    std::fs::create_dir_all(dir.path().join("sub/b")).unwrap();
    std::fs::write(dir.path().join("sub/a/old.md"), "para\n").unwrap();
    std::fs::write(dir.path().join("sub/b/old.md"), "((#^x))\n").unwrap();
    std::fs::write(dir.path().join("sub/r.md"), "[[old]] [[a/old]]\n").unwrap();
    let sub = format!("{root}/sub");
    ctx.add(info("ctx-child", &sub, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    refresh_index_inner(&state, &ctx, &sub).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{sub}/a/old.md"),
        &format!("{sub}/a/new.md"),
    )
    .await
    .unwrap();
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("sub/r.md")).unwrap(),
        "[[new]] [[a/new]]\n"
    );
    // Both links sit on one line of `r.md`, which is one backlink line.
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{sub}/a/new.md"))
        .await
        .unwrap();
    assert_eq!(sources(&backlinks), vec![format!("{sub}/r.md")]);
}

#[tokio::test]
async fn a_same_stem_note_whose_stem_ends_in_md_is_reported_for_a_stale_cross_reference() {
    // issue 716: `b/foo.md.md` has the stem `foo.md`. Its `((#^x))` is filed
    // under the stem the extractor substitutes, read back as the note `foo`
    // — not under this file's own key `foo.md` — so the index never counted
    // that line for it, and crediting it as a self-reference hides a real
    // stale referrer. Here the cross-reference `((foo.md.md#^b1))` went into
    // a code span after the index was built; the note is named for that line
    // and must be reported.
    // What fails this: dropping the `link_reads_back_as_the_file` condition
    // from the exemption in `rename/file.rs` — the one self-reference line
    // then covers the one line named, and the file is not reported. (The
    // same condition in `rename/block_id.rs` does not touch this test.)
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-716b", true).await;
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::create_dir_all(dir.path().join("b")).unwrap();
    std::fs::write(dir.path().join("a/foo.md.md"), "para ^b1\n").unwrap();
    std::fs::write(
        dir.path().join("b/foo.md.md"),
        "((#^x))\n((foo.md.md#^b1))\n",
    )
    .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let stale = "((#^x))\n`((foo.md.md#^b1))`\n";
    std::fs::write(dir.path().join("b/foo.md.md"), stale).unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a/foo.md.md"),
        &format!("{root}/a/bar.md.md"),
    )
    .await
    .unwrap();
    assert_eq!(result.skipped_files, vec![format!("{root}/b/foo.md.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("b/foo.md.md")).unwrap(),
        stale
    );
}

#[tokio::test]
async fn a_same_stem_note_whose_stem_ends_in_md_is_reported_for_a_stale_cross_reference_on_a_block_id_rename(
) {
    // issue 716, the block ID rename's side of the same exemption: the
    // self-reference must use the id being renamed (`((#^b1))`) for the
    // exemption to count it. The cross-reference went into a code span after
    // the index was built, so the note is named for a line it no longer holds.
    // What fails this: dropping the `link_reads_back_as_the_file` condition
    // from the exemption in `rename/block_id.rs` — this test only. The file
    // rename's copy of the condition is a different AND, killed by the
    // sibling test above, and leaves this one red-free.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-716c", true).await;
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::create_dir_all(dir.path().join("b")).unwrap();
    std::fs::write(dir.path().join("a/foo.md.md"), "para ^b1\n").unwrap();
    std::fs::write(
        dir.path().join("b/foo.md.md"),
        "((#^b1))\n((foo.md.md#^b1))\n",
    )
    .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let stale = "((#^b1))\n`((foo.md.md#^b1))`\n";
    std::fs::write(dir.path().join("b/foo.md.md"), stale).unwrap();

    let result = rename_block_id_inner(&state, &ctx, &format!("{root}/a/foo.md.md"), "b1", "b2")
        .await
        .unwrap();
    assert_eq!(result.skipped_files, vec![format!("{root}/b/foo.md.md")]);
    // Its own `^b1` self-reference is its own block, not the renamed one.
    assert_eq!(
        std::fs::read_to_string(dir.path().join("b/foo.md.md")).unwrap(),
        stale
    );
}

#[tokio::test]
async fn a_reference_left_on_purpose_is_reported_before_the_same_stem_exemption_is_asked() {
    // issue 678: `b/old.md` holds `((#^x))` and `((old#^b1))` on ONE line, so
    // the index names it for one line and its own self-reference accounts for
    // it — the exemption would spare it. But a block reference to the old
    // name was left on purpose (no reference can spell `old (draft)`), and
    // that is reported first: a reference in it still says the old name.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-678j", true).await;
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::create_dir_all(dir.path().join("b")).unwrap();
    std::fs::write(dir.path().join("a/old.md"), "para ^b1\n").unwrap();
    std::fs::write(dir.path().join("b/old.md"), "mine ^x ((#^x)) ((old#^b1))\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a/old.md"),
        &format!("{root}/a/old (draft).md"),
    )
    .await
    .unwrap();
    assert!(
        result.updated_files.is_empty(),
        "{:?}",
        result.updated_files
    );
    assert_eq!(result.skipped_files, vec![format!("{root}/b/old.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("b/old.md")).unwrap(),
        "mine ^x ((#^x)) ((old#^b1))\n"
    );
}

#[tokio::test]
async fn renaming_a_file_whose_stem_ends_in_md_leaves_the_notes_referrers_alone() {
    // `diagram.md.txt` has the stem `diagram.md`; the note `diagram.md` has
    // the stem `diagram`, and `[[diagram]]`·`((diagram#^b1))` are ITS links.
    // Renaming the text file finds no referrer under its own key, rewrites
    // nothing and reports nothing — and the note keeps its backlink.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-678k", true).await;
    std::fs::write(dir.path().join("diagram.md"), "para ^b1\n").unwrap();
    std::fs::write(dir.path().join("diagram.md.txt"), "plain text\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "[[diagram]] ((diagram#^b1))\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/diagram.md.txt"),
        &format!("{root}/chart.txt"),
    )
    .await
    .unwrap();
    assert!(
        result.updated_files.is_empty(),
        "{:?}",
        result.updated_files
    );
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "[[diagram]] ((diagram#^b1))\n"
    );
    assert!(dir.path().join("chart.txt").exists());
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/diagram.md"))
        .await
        .unwrap();
    let mut from = sources(&backlinks);
    from.sort();
    from.dedup();
    assert_eq!(from, vec![format!("{root}/r.md")]);
}

#[tokio::test]
async fn a_rename_that_keeps_the_stem_does_not_report_the_renamed_note_for_its_own_references() {
    // issue 678: the note itself spells its own name — `((old#^b1))`, which
    // the index files under `old`, its own key — and `old.md` → `old.txt`
    // leaves it rightly untouched. Under `Unchanged::Ignore` nothing is news,
    // so the note is not reported either; without that test the note would
    // be, because its self-references name a target and so account for none
    // of the lines the index named it for.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-678m", true).await;
    std::fs::write(dir.path().join("old.md"), "para ^b1\n\nsee ((old#^b1))\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/old.md"),
        &format!("{root}/old.txt"),
    )
    .await
    .unwrap();
    assert!(
        result.updated_files.is_empty(),
        "{:?}",
        result.updated_files
    );
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("old.txt")).unwrap(),
        "para ^b1\n\nsee ((old#^b1))\n"
    );
}

#[tokio::test]
async fn a_reference_left_in_the_renamed_note_is_reported_though_its_own_references_excuse_it() {
    // issue 678: the renamed note holds a self-reference and a reference to
    // its own old name ON ONE LINE, so the index names it for one line and
    // its self-references account for that line — the exemption would spare
    // it. But `old (draft)` is a stem no block reference can spell, so the
    // reference to the old name is left on purpose, and that is reported
    // ahead of the exemption. Without the left-behind disjunct the note
    // would go unmentioned while still naming a note that no longer exists.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-678n", true).await;
    std::fs::write(
        dir.path().join("old.md"),
        "mine ^x\n\nsee ((#^x)) and ((old#^b1))\n",
    )
    .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/old.md"),
        &format!("{root}/old (draft).md"),
    )
    .await
    .unwrap();
    assert!(
        result.updated_files.is_empty(),
        "{:?}",
        result.updated_files
    );
    assert_eq!(result.skipped_files, vec![format!("{root}/old (draft).md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("old (draft).md")).unwrap(),
        "mine ^x\n\nsee ((#^x)) and ((old#^b1))\n"
    );
}

#[tokio::test]
async fn a_file_rename_does_not_report_the_renamed_note_for_its_own_self_references() {
    // issue 678: the index names the note under its own stem for `((#^b1))`.
    // A rename rewrites nothing in it — the reference names no target — and
    // that is not stale news, as for a same-stem note elsewhere.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-678g", true).await;
    std::fs::write(dir.path().join("old.md"), "para ^b1\n\nsee ((#^b1))\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/old.md"),
        &format!("{root}/new.md"),
    )
    .await
    .unwrap();
    assert!(
        result.updated_files.is_empty(),
        "{:?}",
        result.updated_files
    );
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("new.md")).unwrap(),
        "para ^b1\n\nsee ((#^b1))\n"
    );
}

#[tokio::test]
async fn a_file_rename_reports_a_same_stem_note_named_for_more_than_its_own_references() {
    // issue 678 (review): the same-stem exemption in `rename/file.rs` weighs
    // the note's own `((#^id))` lines against the lines the index named it
    // for — `own_block_reference_lines(content, None) >= lines`. Its sibling
    // tests pin that the exemption EXISTS (a note named for its own
    // references alone is not reported) and stayed green with the comparison
    // replaced by `true`; this one pins the arithmetic. `b/old.md` was
    // named for two lines — its own `((#^b1))` and `((old#^b1))` to a/old's
    // block — and the second was made code outside the app since. One own
    // line does not account for two: the note is stale, and reported.
    // What fails this: the exemption ignoring the count (`>= lines` → true).
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-678h2", true).await;
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::create_dir_all(dir.path().join("b")).unwrap();
    std::fs::write(dir.path().join("a/old.md"), "para ^b1\n").unwrap();
    std::fs::write(
        dir.path().join("b/old.md"),
        "mine ^b1 ((#^b1))\nsee ((old#^b1))\n",
    )
    .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let edited = "mine ^b1 ((#^b1))\nsee `((old#^b1))`\n";
    std::fs::write(dir.path().join("b/old.md"), edited).unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a/old.md"),
        &format!("{root}/a/new.md"),
    )
    .await
    .unwrap();
    assert!(
        result.updated_files.is_empty(),
        "{:?}",
        result.updated_files
    );
    assert_eq!(result.skipped_files, vec![format!("{root}/b/old.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("b/old.md")).unwrap(),
        edited
    );
}

#[tokio::test]
async fn a_same_stem_note_with_a_self_reference_has_its_link_to_the_renamed_file_rewritten() {
    // `b/old.md` shares the renamed `a/old.md`'s stem and holds its own
    // `((#^x))`, which names no file. The index reads that blank target as
    // the referrer's stem `old` — the renamed file's old stem — but the
    // passes judge the target as written, blank, and leave it blank, so
    // the read-back gate must not match it either, or it expects `new` where
    // the reference still says nothing, calls the correct rewrite of
    // `[[a/old]]` a change, and leaves the link dangling in a reported file.
    // What fails this: dropping `e.self_reference` from the gate's key
    // mapping, which then matches the stem `extract_links` filled in.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-619s", true).await;
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::create_dir_all(dir.path().join("b")).unwrap();
    std::fs::write(dir.path().join("a/old.md"), "target\n").unwrap();
    std::fs::write(
        dir.path().join("b/old.md"),
        "mine ^x ((#^x))\nsee [[a/old]]\n",
    )
    .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a/old.md"),
        &format!("{root}/a/new.md"),
    )
    .await
    .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/b/old.md")]);
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("b/old.md")).unwrap(),
        "mine ^x ((#^x))\nsee [[a/new]]\n"
    );
}
