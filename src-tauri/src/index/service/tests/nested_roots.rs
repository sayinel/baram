use super::*;

#[cfg(unix)]
#[tokio::test]
async fn a_nested_root_registered_through_a_symlink_gets_mutations_in_its_own_spelling() {
    // /vault is registered; /elsewhere/alias → /vault/sub is registered as
    // its own context. Both indexes scan sub/, each in its own spelling.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("sub/target.md"), "t").unwrap();
    std::fs::write(dir.path().join("sub/inner.md"), "inner [[target]]").unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let alias = elsewhere.path().join("alias");
    std::os::unix::fs::symlink(dir.path().join("sub"), &alias).unwrap();
    let alias = alias.to_str().unwrap().to_string();
    ctx.add(info("ctx-child", &alias, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    refresh_index_inner(&state, &ctx, &alias).await.unwrap();

    // The rename arrives in the parent's spelling.
    rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/sub/target.md"),
        &format!("{root}/sub/renamed.md"),
    )
    .await
    .unwrap();
    // The child index was updated in ITS spelling: no ghost of the old
    // name, the new name present, nothing spelled under the parent root.
    let child = outgoing_links(&state, &alias).await;
    assert_eq!(
        child.get(&format!("{alias}/inner.md")),
        Some(&vec![format!("{alias}/renamed.md")])
    );
    assert!(!child.keys().any(|k| k.starts_with(&root)));
    let child_graph = get_link_index_inner(&state, &ctx, Some(alias.clone()))
        .await
        .unwrap();
    assert!(!child_graph.nodes.iter().any(|n| n.ends_with("/target.md")));
    // And the merged backlinks name inner.md once, in the query's spelling.
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/sub/renamed.md"))
        .await
        .unwrap();
    assert_eq!(sources(&backlinks), vec![format!("{root}/sub/inner.md")]);
}

#[tokio::test]
async fn nested_roots_a_rename_updates_each_index_only_with_the_files_it_covers() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("sub/target.md"), "para ^b1").unwrap();
    std::fs::write(dir.path().join("sub/inner.md"), "inner [[target]]").unwrap();
    std::fs::write(
        dir.path().join("outside.md"),
        // On separate lines: get_backlinks keeps one entry per (source, line).
        "outside [[target]]\nand ((target#^b1))",
    )
    .unwrap();
    let sub = format!("{root}/sub");
    ctx.add(info("ctx-child", &sub, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    refresh_index_inner(&state, &ctx, &sub).await.unwrap();

    async fn child_has_outside(state: &LinkIndexState, ctx: &ContextManager, sub: &str) -> bool {
        get_link_index_inner(state, ctx, Some(sub.to_string()))
            .await
            .unwrap()
            .nodes
            .iter()
            .any(|n| n.ends_with("/outside.md"))
    }
    assert!(!child_has_outside(&state, &ctx, &sub).await);

    // A block-id rename rewrites outside.md, which only the parent covers.
    let result = rename_block_id_inner(&state, &ctx, &format!("{sub}/target.md"), "b1", "b2")
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/outside.md")]);
    assert!(!child_has_outside(&state, &ctx, &sub).await);

    // So does a file rename.
    rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{sub}/target.md"),
        &format!("{sub}/renamed.md"),
    )
    .await
    .unwrap();
    assert!(!child_has_outside(&state, &ctx, &sub).await);
    // The parent still knows outside.md's link, to the new name.
    let outgoing = outgoing_links(&state, &root).await;
    assert_eq!(
        outgoing
            .get(&format!("{root}/outside.md"))
            .map(|t| t.contains(&format!("{sub}/renamed.md"))),
        Some(true)
    );
}

#[tokio::test]
async fn nested_roots_a_rename_builds_the_missing_enclosing_index_first() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("sub/target.md"), "t").unwrap();
    std::fs::write(dir.path().join("outside.md"), "outside [[target]]").unwrap();
    let sub = format!("{root}/sub");
    ctx.add(info("ctx-child", &sub, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    // Only the child's index has landed; the parent's (slower) has not.
    // The reference from `outside.md` is known only to the parent's index,
    // so the gate builds it before the rename — refusing here (as this
    // used to) would have left users of a never-opened nested folder
    // unable to rename anything inside it.
    refresh_index_inner(&state, &ctx, &sub).await.unwrap();
    assert!(state.with_index(&root, |idx| idx.is_none()).await);
    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{sub}/target.md"),
        &format!("{sub}/renamed.md"),
    )
    .await
    .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/outside.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("outside.md")).unwrap(),
        "outside [[renamed]]"
    );
    assert!(dir.path().join("sub/renamed.md").exists());
    assert_eq!(state.build_root(&root).await, Some(root.clone()));
}

#[tokio::test]
async fn nested_roots_a_block_id_rename_leaves_a_colliding_child_relative_path_alone() {
    // issue 619: `r.md` sits under the parent root only. Its `((a/note#^x))`
    // names `a/note.md` under the parent, which is another file than the
    // target `sub/a/note.md` — even though the target's path under the CHILD
    // root is `a/note`. A reference is judged under the roots that cover the
    // referrer, never under a root it is not in.
    // What fails this: `BlockTarget::refers` reading the keys of every root
    // instead of only the covering ones — `((a/note#^x))` then takes `^y`.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
    std::fs::create_dir_all(dir.path().join("sub/a")).unwrap();
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::write(dir.path().join("sub/a/note.md"), "para ^x\n").unwrap();
    std::fs::write(dir.path().join("a/note.md"), "para ^x\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "((note#^x))\n((a/note#^x))\n").unwrap();
    let sub = format!("{root}/sub");
    ctx.add(info("ctx-child", &sub, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    refresh_index_inner(&state, &ctx, &sub).await.unwrap();

    let result = rename_block_id_inner(&state, &ctx, &format!("{sub}/a/note.md"), "x", "y")
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/r.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "((note#^y))\n((a/note#^x))\n"
    );
}

#[tokio::test]
async fn nested_roots_a_rename_leaves_the_parents_colliding_link_alone() {
    // issue 619: `r.md` is under the parent root alone, where `a/old` is
    // `a/old.md` — another file than the renamed `sub/a/old.md`, whose path
    // under the CHILD root is also `a/old`. `sub/r.md` is under both: its
    // `a/old` names the target under the child root, its `sub/a/old` under
    // the parent. Each referrer is judged under the roots that cover it.
    // `sub/r.md`'s `[[a/old]]` is also `a/old.md` under the parent, a note
    // that exists: two covering roots read it as two notes, so it is left
    // and the file reported, while its `[[sub/a/old]]` is respelled.
    // What fails this: passing every owning root to `LinkPasses::rewrite`
    // for a referrer instead of `keys_of(covering)` — `r.md` is then judged
    // under the child root too, where its `[[a/old]]` is the target; the
    // parent's `a/old.md` keeps it from being rewritten, but `r.md` is
    // reported (run once). And treating every other-root `Path` reading as a
    // note that does not exist (`read_as_another_note`) — `sub/r.md`'s
    // `[[a/old]]` becomes `[[a/new]]` and the parent's reading of it breaks
    // without a report.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
    std::fs::create_dir_all(dir.path().join("sub/a")).unwrap();
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::write(dir.path().join("sub/a/old.md"), "t\n").unwrap();
    std::fs::write(dir.path().join("a/old.md"), "t\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "[[old]]\n[[a/old]]\n").unwrap();
    std::fs::write(dir.path().join("sub/r.md"), "[[a/old]]\n[[sub/a/old]]\n").unwrap();
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
    assert_eq!(
        result.updated_files,
        vec![format!("{root}/r.md"), format!("{sub}/r.md")]
    );
    assert_eq!(result.skipped_files, vec![format!("{sub}/r.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "[[new]]\n[[a/old]]\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("sub/r.md")).unwrap(),
        "[[a/old]]\n[[sub/a/new]]\n"
    );
    // Each index reads the rewritten files by its own root: the parent sees
    // `r.md`'s `[[new]]` and `sub/r.md`'s `[[sub/a/new]]`; the child sees
    // neither, since `sub/r.md`'s `[[a/old]]` was left and its
    // `[[sub/a/new]]` is another path under the child. `a/old.md` keeps
    // both links it had: `r.md`'s and `sub/r.md`'s `[[a/old]]`.
    let new_path = format!("{sub}/a/new.md");
    let backlinks_in = |key: &str, path: &str| {
        let (key, path) = (key.to_string(), path.to_string());
        let state = &state;
        async move {
            state
                .with_index(&key, |idx| idx.map(|i| i.get_backlinks(&path, &[]).len()))
                .await
        }
    };
    assert_eq!(backlinks_in(&root, &new_path).await, Some(2));
    assert_eq!(backlinks_in(&sub, &new_path).await, Some(0));
    let colliding = get_backlinks_inner(&state, &ctx, &format!("{root}/a/old.md"))
        .await
        .unwrap();
    assert_eq!(
        sources(&colliding),
        vec![format!("{root}/r.md"), format!("{sub}/r.md")]
    );
}

/// Nested roots `/v` and `/v/sub` (`ctx-child`), both indexed, holding
/// `a/old.md` AND `sub/a/old.md` — whose path is `a/old` under the parent
/// and the child respectively — plus `files` (path under `/v`, content).
async fn nested_roots_with_two_a_old_notes(
    ctx: &ContextManager,
    note: &str,
    files: &[(&str, &str)],
) -> (tempfile::TempDir, String, String, LinkIndexState) {
    let (dir, root) = vault_with_a_link(ctx, "ctx-parent", true).await;
    std::fs::create_dir_all(dir.path().join("sub/a")).unwrap();
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::write(dir.path().join("a/old.md"), note).unwrap();
    std::fs::write(dir.path().join("sub/a/old.md"), note).unwrap();
    for (path, content) in files {
        std::fs::write(dir.path().join(path), content).unwrap();
    }
    let sub = format!("{root}/sub");
    ctx.add(info("ctx-child", &sub, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, ctx, &root).await.unwrap();
    refresh_index_inner(&state, ctx, &sub).await.unwrap();
    (dir, root, sub, state)
}

#[tokio::test]
async fn nested_roots_a_doubly_covered_referrer_keeps_a_path_link_another_root_reads_as_another_file(
) {
    // `sub/r.md` is under both roots. Its `[[a/old]]` is the renamed
    // `sub/a/old.md` under the child and the existing `a/old.md` under the
    // parent, so it is left as written and the file is reported; the bare
    // `[[old]]` follows the rename as any stem link does. `sub/b.md` holds
    // the block-reference spelling `((a/old#^x))` beside a bare link: kept,
    // and the file updated and reported.
    // What fails this: treating every other-root `Path` reading as a note
    // that does not exist (`read_as_another_note`) — `[[a/old]]` becomes
    // `[[a/new]]`, nothing is reported, and `a/old.md` loses the backlink.
    // For `sub/b.md` alone: dropping the block pass's `ambiguous` count from
    // `LinkPasses::rewrite`'s `left_behind` — updated, not reported.
    let ctx = ContextManager::new();
    let (dir, root, sub, state) = nested_roots_with_two_a_old_notes(
        &ctx,
        "t\n",
        &[
            ("sub/r.md", "[[a/old]]\n[[old]]\n"),
            ("sub/b.md", "((a/old#^x))\n[[old]]\n"),
        ],
    )
    .await;
    let (referrer, blocks) = (format!("{sub}/r.md"), format!("{sub}/b.md"));

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{sub}/a/old.md"),
        &format!("{sub}/a/new.md"),
    )
    .await
    .unwrap();
    let both = vec![blocks, referrer.clone()];
    let (mut updated, mut skipped) = (result.updated_files, result.skipped_files);
    updated.sort();
    skipped.sort();
    assert_eq!(updated, both);
    assert_eq!(skipped, both);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("sub/b.md")).unwrap(),
        "((a/old#^x))\n[[new]]\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("sub/r.md")).unwrap(),
        "[[a/old]]\n[[new]]\n"
    );
    assert_eq!(
        backlink_lines(&state, &ctx, &format!("{root}/a/old.md"), &referrer).await,
        vec![1]
    );
}

#[tokio::test]
async fn nested_roots_the_parents_rename_keeps_a_path_link_the_child_reads_as_another_file() {
    // The reverse: renaming the parent's `a/old.md`. `sub/r.md`'s
    // `[[a/old]]` is that note under the parent and the existing
    // `sub/a/old.md` under the child — left, and the file reported; the
    // bare `[[old]]` follows.
    // What fails this: treating every other-root `Path` reading as a note
    // that does not exist — `[[a/old]]` becomes `[[a/new]]` and
    // `sub/a/old.md` loses the backlink.
    let ctx = ContextManager::new();
    let (dir, root, sub, state) =
        nested_roots_with_two_a_old_notes(&ctx, "t\n", &[("sub/r.md", "[[a/old]]\n[[old]]\n")])
            .await;
    let referrer = format!("{sub}/r.md");

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a/old.md"),
        &format!("{root}/a/new.md"),
    )
    .await
    .unwrap();
    assert_eq!(result.updated_files, vec![referrer.clone()]);
    assert_eq!(result.skipped_files, vec![referrer.clone()]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("sub/r.md")).unwrap(),
        "[[a/old]]\n[[new]]\n"
    );
    // The kept line 1 is still `sub/a/old.md`'s backlink. (Line 2 is too,
    // for now: the rename updates only the renamed file's indexes, so the
    // child index still holds `sub/r.md` as it was scanned, `[[old]]` and
    // all, until it reads the file again. Older than this check: with the
    // existence check disabled, the file reads `[[a/new]]\n[[new]]\n` and
    // the child index still names lines 1 and 2 (probed once). Not pinned
    // here.)
    assert!(
        backlink_lines(&state, &ctx, &format!("{sub}/a/old.md"), &referrer)
            .await
            .contains(&1)
    );
}

#[tokio::test]
async fn nested_roots_a_block_id_rename_keeps_a_path_reference_another_root_reads_as_another_file()
{
    // Both notes hold `^x`. `sub/r.md`'s `((a/old#^x))` is the child's note
    // under the child root and the parent's under the parent: renaming the
    // child's block leaves it, and the file — named by the index, rewritten
    // nowhere — is reported. `sub/m.md` also holds a bare `((old#^x))`,
    // which is rewritten; the file is updated AND reported for the
    // reference it keeps.
    // What fails this: treating every other-root `Path` reading as a note
    // that does not exist — `((a/old#^x))` becomes `((a/old#^y))` in both
    // files and neither is reported; and, for `sub/m.md` alone, dropping
    // the pass's `ambiguous` count from the block-ID rename's `left_behind`
    // — it is updated but not reported.
    let ctx = ContextManager::new();
    let (dir, _root, sub, state) = nested_roots_with_two_a_old_notes(
        &ctx,
        "para ^x\n",
        &[
            ("sub/r.md", "((a/old#^x))\n"),
            ("sub/m.md", "((a/old#^x))\n((old#^x))\n"),
        ],
    )
    .await;
    let (referrer, mixed) = (format!("{sub}/r.md"), format!("{sub}/m.md"));

    let result = rename_block_id_inner(&state, &ctx, &format!("{sub}/a/old.md"), "x", "y")
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![mixed.clone()]);
    let mut skipped = result.skipped_files.clone();
    skipped.sort();
    assert_eq!(skipped, vec![mixed, referrer]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("sub/r.md")).unwrap(),
        "((a/old#^x))\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("sub/m.md")).unwrap(),
        "((a/old#^x))\n((old#^y))\n"
    );
}

#[tokio::test]
async fn a_path_link_is_not_ambiguous_because_of_a_root_that_does_not_hold_the_referrer() {
    // Two unrelated vaults each hold `a/old.md`. In A, `[[a/old]]` names
    // A's note, and B's root, which does not hold A's referrer, never reads
    // it: A's rename respells it and reports nothing.
    // No single change to the judgement fails this: B holds neither the
    // renamed file nor a referrer, so `holding_contexts` never puts it in
    // `known_paths`, and dropping the root-holds-the-referrer check from
    // `read_as_another_note` leaves this green (measured). That check is
    // pinned by `nested_roots_a_referrer_only_the_parent_holds_follows_the_rename`.
    let ctx = ContextManager::new();
    let (dir_a, root_a) = aliased_vault(
        &ctx,
        "ctx-a",
        "home",
        &[("a/old.md", "t\n"), ("r.md", "[[a/old]]\n")],
    )
    .await;
    let (_dir_b, root_b) = aliased_vault(&ctx, "ctx-b", "work", &[("a/old.md", "t\n")]).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root_a).await.unwrap();
    refresh_index_inner(&state, &ctx, &root_b).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root_a}/a/old.md"),
        &format!("{root_a}/a/new.md"),
    )
    .await
    .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root_a}/r.md")]);
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir_a.path().join("r.md")).unwrap(),
        "[[a/new]]\n"
    );
}

#[tokio::test]
async fn nested_roots_the_parents_block_id_rename_keeps_a_path_reference_the_child_reads_as_another_file(
) {
    // The reverse of the block-ID case above: renaming the block of the
    // parent's `a/old.md`. `sub/r.md`'s `((a/old#^x))` is that note under
    // the parent and the existing `sub/a/old.md`, which holds `^x` too,
    // under the child: the reference stays and `sub/r.md` is reported.
    // What fails this: treating every other-root `Path` reading as a note
    // that does not exist (`read_as_another_note`) — the reference becomes
    // `((a/old#^y))` and nothing is reported.
    let ctx = ContextManager::new();
    let (dir, root, sub, state) =
        nested_roots_with_two_a_old_notes(&ctx, "para ^x\n", &[("sub/r.md", "((a/old#^x))\n")])
            .await;

    let result = rename_block_id_inner(&state, &ctx, &format!("{root}/a/old.md"), "x", "y")
        .await
        .unwrap();
    assert!(
        result.updated_files.is_empty(),
        "{:?}",
        result.updated_files
    );
    assert_eq!(result.skipped_files, vec![format!("{sub}/r.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("sub/r.md")).unwrap(),
        "((a/old#^x))\n"
    );
}

/// `nested_roots_with_two_a_old_notes` with the child registered through a
/// symlink, `/elsewhere/alias` → `/v/sub`: the parent's index spells the
/// referrer `/v/sub/r.md`, which the child holds only as its target.
#[cfg(unix)]
async fn nested_roots_with_two_a_old_notes_child_through_a_symlink(
    ctx: &ContextManager,
    note: &str,
    files: &[(&str, &str)],
) -> (tempfile::TempDir, tempfile::TempDir, String, LinkIndexState) {
    let (dir, root) = vault_with_a_link(ctx, "ctx-parent", true).await;
    std::fs::create_dir_all(dir.path().join("sub/a")).unwrap();
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::write(dir.path().join("a/old.md"), note).unwrap();
    std::fs::write(dir.path().join("sub/a/old.md"), note).unwrap();
    for (path, content) in files {
        std::fs::write(dir.path().join(path), content).unwrap();
    }
    let elsewhere = tempfile::tempdir().unwrap();
    let alias = elsewhere.path().join("alias");
    std::os::unix::fs::symlink(dir.path().join("sub"), &alias).unwrap();
    let alias = alias.to_str().unwrap().to_string();
    ctx.add(info("ctx-child", &alias, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, ctx, &root).await.unwrap();
    refresh_index_inner(&state, ctx, &alias).await.unwrap();
    (dir, elsewhere, root, state)
}

#[cfg(unix)]
#[tokio::test]
async fn nested_roots_a_child_registered_through_a_symlink_still_keeps_a_path_link() {
    // `nested_roots_the_parents_rename_keeps_a_path_link_the_child_reads_as_another_file`
    // with the child registered as `/elsewhere/alias`. The child still reads
    // `sub/r.md`'s `[[a/old]]` as `sub/a/old.md`, but cannot be placed over
    // the referrer as the parent's index spells it, so the link is left and
    // the file reported — missed, not miswritten. The bare `[[old]]` follows.
    // What fails this: dropping the `unplaced` check from
    // `read_as_another_note` — the child is skipped as not holding
    // `/v/sub/r.md`, and `[[a/old]]` becomes `[[a/new]]` with nothing reported.
    let ctx = ContextManager::new();
    let (dir, _elsewhere, root, state) = nested_roots_with_two_a_old_notes_child_through_a_symlink(
        &ctx,
        "t\n",
        &[("sub/r.md", "[[a/old]]\n[[old]]\n")],
    )
    .await;
    let referrer = format!("{root}/sub/r.md");

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a/old.md"),
        &format!("{root}/a/new.md"),
    )
    .await
    .unwrap();
    assert_eq!(result.skipped_files, vec![referrer.clone()]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("sub/r.md")).unwrap(),
        "[[a/old]]\n[[new]]\n"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn nested_roots_a_child_registered_through_a_symlink_still_keeps_a_path_reference() {
    // The block-ID rename of the test above: `((a/old#^x))` in `sub/r.md`
    // stays and the file is reported.
    // What fails this: dropping the `unplaced` check from
    // `read_as_another_note` — the reference becomes `((a/old#^y))`.
    let ctx = ContextManager::new();
    let (dir, _elsewhere, root, state) = nested_roots_with_two_a_old_notes_child_through_a_symlink(
        &ctx,
        "para ^x\n",
        &[("sub/r.md", "((a/old#^x))\n")],
    )
    .await;

    let result = rename_block_id_inner(&state, &ctx, &format!("{root}/a/old.md"), "x", "y")
        .await
        .unwrap();
    assert_eq!(result.skipped_files, vec![format!("{root}/sub/r.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("sub/r.md")).unwrap(),
        "((a/old#^x))\n"
    );
}

#[tokio::test]
async fn nested_roots_a_referrer_only_the_parent_holds_follows_the_rename() {
    // Beside `sub/r.md`, whose `[[a/old]]` the child reads as `sub/a/old.md`,
    // the parent's own `r.md` holds the same text. The child does not hold
    // that referrer, so only the parent reads it: respelled, not reported.
    // What fails this: dropping the root-holds-the-referrer check
    // (`under_root`) from `read_as_another_note` — the child's `sub/a/old.md`
    // makes `/v/r.md`'s link ambiguous too, and it is left and reported.
    let ctx = ContextManager::new();
    let (dir, root, sub, state) = nested_roots_with_two_a_old_notes(
        &ctx,
        "t\n",
        &[("r.md", "[[a/old]]\n"), ("sub/r.md", "[[a/old]]\n")],
    )
    .await;

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a/old.md"),
        &format!("{root}/a/new.md"),
    )
    .await
    .unwrap();
    assert_eq!(result.skipped_files, vec![format!("{sub}/r.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "[[a/new]]\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("sub/r.md")).unwrap(),
        "[[a/old]]\n"
    );
}

/// `/v` indexed and `/v/sub` registered (`ctx-child`) but never opened —
/// no index built for it — holding `/v/a/old.md`, `sub/r.md` with
/// `[[a/old]]`, and `sub/a/old.md` when `child_note` says so.
async fn parent_indexed_child_unopened(
    ctx: &ContextManager,
    child_note: bool,
) -> (tempfile::TempDir, String, String, LinkIndexState) {
    let (dir, root) = vault_with_a_link(ctx, "ctx-parent", true).await;
    std::fs::create_dir_all(dir.path().join("sub/a")).unwrap();
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::write(dir.path().join("a/old.md"), "t\n").unwrap();
    if child_note {
        std::fs::write(dir.path().join("sub/a/old.md"), "t\n").unwrap();
    }
    std::fs::write(dir.path().join("sub/r.md"), "[[a/old]]\n").unwrap();
    let sub = format!("{root}/sub");
    ctx.add(info("ctx-child", &sub, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, ctx, &root).await.unwrap();
    assert!(state.with_index(&sub, |idx| idx.is_none()).await);
    (dir, root, sub, state)
}

#[tokio::test]
async fn nested_roots_an_unopened_child_vault_still_guards_a_doubly_read_path_link() {
    // `/v/sub` holds `sub/r.md` but was never opened, so it has no index.
    // Renaming the parent's `a/old.md` builds it before judging, finds
    // `sub/a/old.md`, and leaves `[[a/old]]` — which the child reads as
    // that note — and reports the file.
    // What fails this: judging with the renamed file's contexts alone
    // (`holding_contexts` returning `dirs`) — the child is never consulted,
    // `[[a/old]]` becomes `[[a/new]]`, and nothing is reported. Skipping
    // only the build fails the last assertion: the link is still left,
    // since an unbuilt root reads `Unknown`, but the child has no index.
    let ctx = ContextManager::new();
    let (dir, root, sub, state) = parent_indexed_child_unopened(&ctx, true).await;
    let referrer = format!("{sub}/r.md");

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
    assert_eq!(result.skipped_files, vec![referrer]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("sub/r.md")).unwrap(),
        "[[a/old]]\n"
    );
    assert!(state.with_index(&sub, |idx| idx.is_some()).await);
}

#[tokio::test]
async fn nested_roots_an_unopened_child_vault_without_the_colliding_note_lets_the_link_follow() {
    // The twin: the unopened child holds no `sub/a/old.md`. Its index is
    // built, reads `a/old` as nothing, and the link follows the rename with
    // nothing reported — an unopened child is not noise by itself.
    // What fails this: skipping the build in `holding_contexts` — the
    // child then has no index, reads `Unknown`, and the link is left and
    // reported.
    let ctx = ContextManager::new();
    let (dir, root, sub, state) = parent_indexed_child_unopened(&ctx, false).await;
    let referrer = format!("{sub}/r.md");

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a/old.md"),
        &format!("{root}/a/new.md"),
    )
    .await
    .unwrap();
    assert_eq!(result.updated_files, vec![referrer]);
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("sub/r.md")).unwrap(),
        "[[a/new]]\n"
    );
}

#[tokio::test]
async fn nested_roots_backlinks_come_in_source_path_order_across_both_indexes() {
    // `/v` and `/v/sub` are both roots. `a.md` lies outside the child, so
    // only the parent's index names it; `sub/z.md` is named by both. The
    // child answers first (contexts come deepest first), so concatenating
    // the two answers puts `sub/z.md` ahead of `a.md`.
    // What fails this: dropping the final sort of `merged` in
    // `get_backlinks_inner` — `/v/sub/z.md` comes back first.
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("sub/note.md"), "t").unwrap();
    std::fs::write(dir.path().join("a.md"), "[[note]]").unwrap();
    std::fs::write(dir.path().join("sub/z.md"), "[[note]]").unwrap();
    let root = dir.path().to_str().unwrap().to_string();
    let sub = format!("{root}/sub");
    let ctx = ContextManager::new();
    ctx.add(info("ctx-parent", &root, ContextType::Folder))
        .await
        .unwrap();
    ctx.add(info("ctx-child", &sub, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    refresh_index_inner(&state, &ctx, &sub).await.unwrap();

    let sources: Vec<String> = get_backlinks_inner(&state, &ctx, &format!("{sub}/note.md"))
        .await
        .unwrap()
        .into_iter()
        .map(|b| b.source_path)
        .collect();
    assert_eq!(sources, vec![format!("{root}/a.md"), format!("{sub}/z.md")]);
}
