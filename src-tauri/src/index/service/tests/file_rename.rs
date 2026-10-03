use super::*;

#[tokio::test]
async fn a_renamed_files_content_is_indexed_under_its_new_path() {
    // Read before the move, so the index never loses the file between the old
    // path's removal and a read-back of the new one.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a.md"),
        &format!("{root}/renamed.md"),
    )
    .await
    .unwrap();
    assert!(dir.path().join("renamed.md").exists());
    assert_eq!(
        sources(
            &get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
                .await
                .unwrap()
        ),
        vec![format!("{root}/renamed.md")]
    );
}

#[cfg(unix)]
#[tokio::test]
async fn a_file_rename_reports_the_referrer_it_could_not_rewrite() {
    // issue 594: the file has moved by the time a referrer fails to write, so
    // the rename is not a failure — but the referrer's links still say the
    // old name, and that reaches the result instead of only the log.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    std::fs::create_dir(dir.path().join("ro")).unwrap();
    std::fs::write(dir.path().join("ro/ref.md"), "also [[b]]").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let locked = lock_directory(&dir.path().join("ro"));
    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/b.md"),
        &format!("{root}/c.md"),
    )
    .await;
    unlock_directory(&dir.path().join("ro"));
    let result = result.unwrap();
    assert!(dir.path().join("c.md").exists());
    assert_eq!(result.updated_files, vec![format!("{root}/a.md")]);
    if !locked {
        return; // root: every write succeeds, nothing to report
    }
    assert_eq!(result.skipped_files, vec![format!("{root}/ro/ref.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("ro/ref.md")).unwrap(),
        "also [[b]]"
    );
    // The index followed the files: a.md now links to c, ref.md still to b.
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/c.md"))
        .await
        .unwrap();
    assert_eq!(sources(&backlinks), vec![format!("{root}/a.md")]);
}

#[tokio::test]
async fn a_rename_in_a_single_vault_spells_path_keys_only_for_notes_that_share_a_name() {
    // One vault, no nested root: the rename's only holding root. It needs
    // the keys its notes collide on and nothing more, so it spells the path
    // key of the two `note.md`s, which share a name, and of no other note.
    // What fails this: collecting every note's key whatever the number of
    // holding roots (`RootNotes::Known` in `known_paths_of`) — one per note
    // in the vault, seven.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-sole", true).await;
    for (path, text) in [
        ("x/note.md", "t\n"),
        ("y/note.md", "t\n"),
        ("old.md", "t\n"),
        ("r.md", "[[old]]\n"),
        ("s.md", "plain\n"),
    ] {
        let file = dir.path().join(path);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, text).unwrap();
    }
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let before = crate::index::path_keys_spelled();
    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/old.md"),
        &format!("{root}/new.md"),
    )
    .await
    .unwrap();
    assert_eq!(crate::index::path_keys_spelled() - before, 2);
    assert_eq!(result.updated_files, vec![format!("{root}/r.md")]);
}

#[tokio::test]
async fn a_file_rename_rewrites_block_references_and_embeds_as_it_rewrites_wikilinks() {
    // issue 678: a referrer that points at the note by a block reference or an
    // embed — with or without a wikilink beside it, on the same line or not —
    // follows the new name too, and the new file's backlinks still name it.
    // `((dir/old#^b1))` is filed under the path `dir/old` (issue 619), which
    // is not this file's path under the root (`old`), so the rename of
    // `old.md` leaves it. No `dir/old.md` exists in this vault, so the
    // reference names nothing and stays as written.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-678a", true).await;
    std::fs::write(dir.path().join("old.md"), "para ^b1\n").unwrap();
    std::fs::write(dir.path().join("w.md"), "see [[old]]\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "see ((old#^b1))\n").unwrap();
    std::fs::write(dir.path().join("e.md"), "{{embed ((old#^b1))}} [[old]]\n").unwrap();
    std::fs::write(
        dir.path().join("both.md"),
        "[[old]] ((old#^b1)) and ((old#^b1|shown)) ((dir/old#^b1))\n",
    )
    .unwrap();
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
    assert_eq!(
        result.updated_files,
        vec![
            format!("{root}/both.md"),
            format!("{root}/e.md"),
            format!("{root}/r.md"),
            format!("{root}/w.md"),
        ]
    );
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "see ((new#^b1))\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("e.md")).unwrap(),
        "{{embed ((new#^b1))}} [[new]]\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("both.md")).unwrap(),
        "[[new]] ((new#^b1)) and ((new#^b1|shown)) ((dir/old#^b1))\n"
    );
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/new.md"))
        .await
        .unwrap();
    let mut from = sources(&backlinks);
    from.sort();
    from.dedup();
    assert_eq!(
        from,
        vec![
            format!("{root}/both.md"),
            format!("{root}/e.md"),
            format!("{root}/r.md"),
            format!("{root}/w.md"),
        ]
    );
}

#[tokio::test]
async fn a_file_rename_reports_a_referrer_whose_reference_is_gone() {
    // issue 678: with block references rewritten too, a file rename reports
    // a stale index the way a block ID rename does (issue 668) — a referrer
    // the index named in which no reference to the old name is found now
    // still says the old name, and the user hears it.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-678b", true).await;
    std::fs::write(dir.path().join("old.md"), "para ^b1\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "see ((old#^b1))\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    // Edited outside the app after the index was built.
    std::fs::write(dir.path().join("r.md"), "the reference is gone\n").unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/old.md"),
        &format!("{root}/new.md"),
    )
    .await
    .unwrap();
    assert_eq!(result.updated_files, Vec::<String>::new());
    assert_eq!(result.skipped_files, vec![format!("{root}/r.md")]);
}

#[tokio::test]
async fn a_rename_that_keeps_the_stem_rewrites_nothing_and_reports_nothing() {
    // issue 678: `old.md` → `old.txt` changes no reference — every referrer
    // is unchanged, and none of them is stale news.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-678d", true).await;
    std::fs::write(dir.path().join("old.md"), "para ^b1\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "see ((old#^b1)) [[old]]\n").unwrap();
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
    assert!(dir.path().join("old.txt").exists());
    assert_eq!(result.updated_files, Vec::<String>::new());
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
}

#[tokio::test]
async fn a_rename_that_keeps_the_stem_still_respells_a_path_link_for_the_new_extension() {
    // issue 619: `a/old.md` → `a/old.txt` keeps the stem key but not the
    // path key — the index files a link to `a/old.txt` by its path as
    // `a/old.txt`, since only a note extension comes off. The bare link
    // stays; the path link is respelled, and both remain backlinks.
    // What fails this: spelling a path link's last component with the new
    // stem (`Path::file_stem`, its last extension off) instead of the name
    // without its note extension — `[[a/old]]` then stays and names nothing.
    // A link spelled with `.md` loses it, because the new name is no note:
    // `[[a/old.md]]` becomes `[[a/old.txt]]` and the bare `[[old.md]]`
    // becomes `[[old]]`.
    // What fails this too: keeping the captured suffix whatever the new name
    // ends in (`respell`) — `[[a/old.txt.md]]` and `[[old.md]]` are written.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-619t", true).await;
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::write(dir.path().join("a/old.md"), "t\n").unwrap();
    std::fs::write(
        dir.path().join("r.md"),
        "[[old]]\n[[a/old]]\n[[a/old.md]]\n[[old.md]]\n",
    )
    .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a/old.md"),
        &format!("{root}/a/old.txt"),
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
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "[[old]]\n[[a/old.txt]]\n[[a/old.txt]]\n[[old]]\n"
    );
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/a/old.txt"))
        .await
        .unwrap();
    assert_eq!(backlinks.len(), 4, "{backlinks:?}");
}

#[tokio::test]
async fn a_rename_to_an_upper_case_extension_respells_as_for_any_non_note_name() {
    // The index reads `.md` and `.markdown` as note extensions only in lower
    // case (`collect_md_files`, `strip_note_extension`), so `a/new.MD` is no
    // note, as `a/old.txt` is not: a captured `.md` is dropped, and both
    // path links spell the new name whole.
    // What fails this: judging the new name's suffix without case
    // (`note_suffix(new_name)` in `respell`) — `[[a/new.MD.md]]` is written.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-619u", true).await;
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::write(dir.path().join("a/old.md"), "t\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "[[a/old]]\n[[a/old.md]]\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a/old.md"),
        &format!("{root}/a/new.MD"),
    )
    .await
    .unwrap();
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "[[a/new.MD]]\n[[a/new.MD]]\n"
    );
}

#[tokio::test]
async fn a_file_rename_rewrites_the_renamed_notes_own_references_to_its_old_name() {
    // issue 678: the renamed note may spell its own name — `((old#^b1))`
    // pasted from another note, `[[old]]` — and under the new name those
    // would dangle. They follow it as a referrer's do; `((#^b1))` names no
    // target and stays. The note is in updated_files, so an open tab follows
    // the disk, and the index holds what the file says now.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-678f", true).await;
    std::fs::write(
        dir.path().join("old.md"),
        "para ^b1\n\nsee ((old#^b1)) and [[old]] and ((#^b1))\n",
    )
    .unwrap();
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
    assert_eq!(result.updated_files, vec![format!("{root}/new.md")]);
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("new.md")).unwrap(),
        "para ^b1\n\nsee ((new#^b1)) and [[new]] and ((#^b1))\n"
    );
    let key = active_index_key(&ctx).await.unwrap();
    let to_old = state
        .with_index(&key, |idx| {
            idx.unwrap()
                .referring_lines_to(&format!("{root}/old.md"), &[])
        })
        .await;
    assert!(to_old.is_empty(), "{to_old:?}");
    let to_new: Vec<String> = state
        .with_index(&key, |idx| {
            idx.unwrap()
                .referring_lines_to(&format!("{root}/new.md"), &[])
        })
        .await
        .into_iter()
        .map(|(source, _)| source)
        .collect();
    assert_eq!(to_new, vec![format!("{root}/new.md")]);
}

#[tokio::test]
async fn a_block_reference_in_a_notes_own_front_matter_is_not_a_backlink() {
    // issue 667: `note.md` names its own block in its front matter. Nothing
    // renames YAML — so the index does not count it, and the backlink panel
    // does not show a reference that a rename would leave behind.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-667", true).await;
    std::fs::write(
        dir.path().join("note.md"),
        "---\nrelated: ((#^b1))\n---\npara ^b1\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("other.md"),
        "---\nsee: ((note#^b1))\n---\nbody ((note#^b1))\n",
    )
    .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/note.md"))
        .await
        .unwrap();
    let lines: Vec<(&str, u32)> = backlinks
        .iter()
        .map(|b| (b.source_path.as_str(), b.line))
        .collect();
    assert_eq!(lines, vec![(format!("{root}/other.md").as_str(), 4)]);

    let result = rename_block_id_inner(&state, &ctx, &format!("{root}/note.md"), "b1", "b2")
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/other.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("other.md")).unwrap(),
        "---\nsee: ((note#^b1))\n---\nbody ((note#^b2))\n"
    );
}

#[tokio::test]
async fn a_reference_inside_a_code_fence_is_neither_a_backlink_nor_renamed() {
    // issue 620: guide.md shows how a block reference is written. The index
    // must not count the example as a backlink of note.md, and renaming the
    // block must leave guide.md byte for byte as it was.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-620", true).await;
    std::fs::write(dir.path().join("note.md"), "para ^b1\n").unwrap();
    let guide = "block refs are written like this:\n\n```\n((note#^b1))\n```\n\nand `((note#^b1))` inline\n";
    std::fs::write(dir.path().join("guide.md"), guide).unwrap();
    std::fs::write(dir.path().join("real.md"), "see ((note#^b1))\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/note.md"))
        .await
        .unwrap();
    assert_eq!(sources(&backlinks), vec![format!("{root}/real.md")]);

    let result = rename_block_id_inner(&state, &ctx, &format!("{root}/note.md"), "b1", "b2")
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/real.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("guide.md")).unwrap(),
        guide
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("real.md")).unwrap(),
        "see ((note#^b2))\n"
    );
    // A save that turns the example into prose, and back, follows the text.
    let guide_path = format!("{root}/guide.md");
    std::fs::write(&guide_path, "((note#^b2)) now real\n").unwrap();
    update_file_index_inner(&state, &ctx, &guide_path)
        .await
        .unwrap();
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/note.md"))
        .await
        .unwrap();
    assert!(sources(&backlinks).contains(&guide_path.as_str()));
    std::fs::write(&guide_path, "```\n((note#^b2))\n```\n").unwrap();
    update_file_index_inner(&state, &ctx, &guide_path)
        .await
        .unwrap();
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/note.md"))
        .await
        .unwrap();
    assert!(!sources(&backlinks).contains(&guide_path.as_str()));
}

#[tokio::test]
async fn a_file_rename_to_a_longer_stem_rewrites_both_grammars_on_one_line_before_a_code_span() {
    // issue 678 (review): `LinkPasses::rewrite` hands the block-reference
    // pass the wikilink pass's OUTPUT, so that pass's offsets and literal
    // regions are its own. A block pass that judged prose against the
    // wikilink pass's INPUT left the other 176 tests green (measured with a
    // probe doing exactly that): the headline test renames `old` → `new`,
    // the same length, and the `old (draft)` renames let only the wikilink
    // pass write. Here the stem grows by four bytes, both grammars stand on
    // one line, and a code span follows them closer than those four bytes.
    // What fails this: the block pass taking its literal regions from the
    // pre-wikilink bytes — the span `x` then lies over `((old#^b1))` at its
    // new offset, the reference is left as literal, and the file reads
    // `[[renamed]] ((old#^b1))`.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-678h3", true).await;
    std::fs::write(dir.path().join("old.md"), "para ^b1\n").unwrap();
    std::fs::write(dir.path().join("both.md"), "[[old]] ((old#^b1)) `x`\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/old.md"),
        &format!("{root}/renamed.md"),
    )
    .await
    .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/both.md")]);
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("both.md")).unwrap(),
        "[[renamed]] ((renamed#^b1)) `x`\n"
    );
}

#[tokio::test]
async fn a_file_rename_updates_the_path_qualified_references_the_index_filed_under_it() {
    // issue 619: the index files a reference spelled with the note's path —
    // from the root, relative to the referrer's folder — under that path,
    // and the rename respells each of them with the new path, as it does a
    // bare name. The renamed note's own path references follow it too: it
    // stays in its folder, so `((./old#^x))` still names it until respelled.
    // What fails this: dropping the `Path` arm from `RenameTarget::refers`
    // — `r.md` and `a/s.md` are then reported as skipped, not updated.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-619r", true).await;
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::create_dir_all(dir.path().join("b")).unwrap();
    std::fs::write(
        dir.path().join("a/old.md"),
        "para ^x\nsee ((./old#^x)) and [[a/old]]\n",
    )
    .unwrap();
    std::fs::write(dir.path().join("r.md"), "[[a/old|x]] ((a/old#^x))\n").unwrap();
    std::fs::write(dir.path().join("a/s.md"), "[[./old]]\n").unwrap();
    std::fs::write(dir.path().join("b/t.md"), "[[old]]\n").unwrap();
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
    let mut updated = result.updated_files.clone();
    updated.sort();
    assert_eq!(
        updated,
        vec![
            format!("{root}/a/new.md"),
            format!("{root}/a/s.md"),
            format!("{root}/b/t.md"),
            format!("{root}/r.md"),
        ]
    );
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    let read = |p: &str| std::fs::read_to_string(dir.path().join(p)).unwrap();
    assert_eq!(
        read("a/new.md"),
        "para ^x\nsee ((./new#^x)) and [[a/new]]\n"
    );
    assert_eq!(read("r.md"), "[[a/new|x]] ((a/new#^x))\n");
    assert_eq!(read("a/s.md"), "[[./new]]\n");
    assert_eq!(read("b/t.md"), "[[new]]\n");
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/a/new.md"))
        .await
        .unwrap();
    assert_eq!(backlinks.len(), 4, "{backlinks:?}");
}

#[tokio::test]
async fn a_rename_to_markdown_extension_keeps_every_link() {
    // `old.md` → `old.markdown` keeps both the stem and the path key: every
    // link already names the new file, nothing is rewritten, and nothing is
    // reported (`Unchanged::Ignore`).
    // What fails this: respelling a path link's last component with the new
    // file name instead of the name without its note extension — `[[a/old]]`
    // becomes `[[a/old.markdown]]` and `r.md` joins `updated_files`.
    // `[[a/old.md]]` keeps its `.md`: the new name ends in a note extension,
    // so `respell` keeps the captured suffix and writes the same text, which
    // the index keys as `a/old` — the new file's path key.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-619x", true).await;
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::write(dir.path().join("a/old.md"), "t\n").unwrap();
    std::fs::write(
        dir.path().join("r.md"),
        "[[old.md]]\n[[a/old]]\n[[a/old.md]]\n",
    )
    .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a/old.md"),
        &format!("{root}/a/old.markdown"),
    )
    .await
    .unwrap();
    assert_eq!(result.updated_files, Vec::<String>::new());
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "[[old.md]]\n[[a/old]]\n[[a/old.md]]\n"
    );
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/a/old.markdown"))
        .await
        .unwrap();
    assert_eq!(backlinks.len(), 3, "{backlinks:?}");
}
