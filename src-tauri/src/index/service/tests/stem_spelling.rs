use super::*;

#[tokio::test]
async fn a_rename_to_a_stem_no_wikilink_can_spell_leaves_the_links_and_reports_the_files() {
    // `[[a^b]]` reads as the note `a` with the block `b`: a wikilink cannot
    // spell that stem, and writing it would silently link another note. The
    // wikilinks stay and their files are reported; a block reference CAN
    // spell `a^b` (its target ends at `)`, `#` or `|`), so it is rewritten —
    // the two grammars are judged apart. `both.md` is updated AND reported.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-678l", true).await;
    std::fs::write(dir.path().join("old.md"), "para ^b1\n").unwrap();
    std::fs::write(dir.path().join("w.md"), "see [[old]] and [[old#h|shown]]\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "see ((old#^b1))\n").unwrap();
    std::fs::write(dir.path().join("both.md"), "[[old]] ((old#^b1))\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/old.md"),
        &format!("{root}/a^b.md"),
    )
    .await
    .unwrap();
    assert_eq!(
        result.updated_files,
        vec![format!("{root}/both.md"), format!("{root}/r.md")]
    );
    assert_eq!(
        result.skipped_files,
        vec![format!("{root}/both.md"), format!("{root}/w.md")]
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("w.md")).unwrap(),
        "see [[old]] and [[old#h|shown]]\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "see ((a^b#^b1))\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("both.md")).unwrap(),
        "[[old]] ((a^b#^b1))\n"
    );
}

#[tokio::test]
async fn a_rename_to_a_stem_no_block_reference_can_spell_reports_the_referrers_it_leaves() {
    // issue 678: `((target#^id))` cannot hold `)` in its target, so the
    // block references are left as they are — pointing at the old name —
    // and every file they are left in is reported, whether or not a wikilink
    // beside them, which can spell the name, was rewritten: `both.md` is
    // updated AND reported.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-678e", true).await;
    std::fs::write(dir.path().join("old.md"), "para ^b1\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "see ((old#^b1))\n").unwrap();
    std::fs::write(dir.path().join("w.md"), "see [[old]]\n").unwrap();
    std::fs::write(dir.path().join("both.md"), "[[old]] ((old#^b1))\n").unwrap();
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
    assert_eq!(
        result.updated_files,
        vec![format!("{root}/both.md"), format!("{root}/w.md")]
    );
    assert_eq!(
        result.skipped_files,
        vec![format!("{root}/both.md"), format!("{root}/r.md")]
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "see ((old#^b1))\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("w.md")).unwrap(),
        "see [[old (draft)]]\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("both.md")).unwrap(),
        "[[old (draft)]] ((old#^b1))\n"
    );
}

#[tokio::test]
async fn a_rename_to_a_stem_no_block_reference_can_spell_reports_the_renamed_note_too() {
    // issue 678: the renamed note's own `((old#^b1))` is left pointing at
    // the old name for the same reason a referrer's is, and it is reported
    // the same way — under its new path, the one the user can open.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-678h", true).await;
    std::fs::write(dir.path().join("old.md"), "para ^b1\n\nsee ((old#^b1))\n").unwrap();
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
        "para ^b1\n\nsee ((old#^b1))\n"
    );
}

#[tokio::test]
async fn a_rename_to_a_stem_no_block_reference_can_spell_reports_the_renamed_note_it_partly_rewrote(
) {
    // issue 678: the renamed note's own wikilink is rewritten and its block
    // reference is left, so the note is updated (an open tab follows the
    // disk) AND reported (a reference still says the old name).
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-678i", true).await;
    std::fs::write(
        dir.path().join("old.md"),
        "para ^b1\n\nsee ((old#^b1)) and [[old]]\n",
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
    assert_eq!(result.updated_files, vec![format!("{root}/old (draft).md")]);
    assert_eq!(result.skipped_files, vec![format!("{root}/old (draft).md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("old (draft).md")).unwrap(),
        "para ^b1\n\nsee ((old#^b1)) and [[old (draft)]]\n"
    );
}

#[tokio::test]
async fn a_file_rename_to_a_stem_a_referrers_line_makes_literal_leaves_that_file_and_reports_it() {
    // issue 678 (review): `wikilink_can_spell` looks at the stem alone, and
    // one backtick is fine there. But the referrer's line may already hold
    // one: `pair.md` does, so the link the rename would write — `[[a`b]]` —
    // closes a code span with it and the index reads it as nothing. A
    // backlink gone, in a file reported as UPDATED. The passes' output is
    // read back with `extract_links` before it is written, file by file:
    // `w.md`, with nothing to pair, is rewritten; `pair.md` is left and
    // reported. What fails this: writing without reading back — `pair.md`
    // then holds `[[a`b]]` and `updated_files` names it.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-678h1a", true).await;
    std::fs::write(dir.path().join("old.md"), "para ^b1\n").unwrap();
    std::fs::write(dir.path().join("w.md"), "see [[old]]\n").unwrap();
    std::fs::write(dir.path().join("pair.md"), "`x [[old]]\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/old.md"),
        &format!("{root}/a`b.md"),
    )
    .await
    .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/w.md")]);
    assert_eq!(result.skipped_files, vec![format!("{root}/pair.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("w.md")).unwrap(),
        "see [[a`b]]\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("pair.md")).unwrap(),
        "`x [[old]]\n"
    );
}

#[tokio::test]
async fn a_file_rename_to_a_stem_that_closes_a_code_span_around_itself_leaves_every_link_and_reports(
) {
    // issue 678 (review): `a`b`c` needs no partner — the pair inside the
    // stem makes `[[a`b`c]]` and `((a`b`c#^b1))` literal wherever they
    // land, so both grammars are left, in every referrer, and the renamed
    // note's own `[[old]]` too. What fails this: writing without reading
    // back — `both.md` then reads `[[a`b`c]] ((a`b`c#^b1))`, which the index
    // files nowhere.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-678h1b", true).await;
    std::fs::write(dir.path().join("old.md"), "para ^b1 [[old]]\n").unwrap();
    std::fs::write(dir.path().join("both.md"), "[[old]] ((old#^b1))\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/old.md"),
        &format!("{root}/a`b`c.md"),
    )
    .await
    .unwrap();
    assert!(
        result.updated_files.is_empty(),
        "{:?}",
        result.updated_files
    );
    assert_eq!(
        result.skipped_files,
        vec![format!("{root}/both.md"), format!("{root}/a`b`c.md")]
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("both.md")).unwrap(),
        "[[old]] ((old#^b1))\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("a`b`c.md")).unwrap(),
        "para ^b1 [[old]]\n"
    );
}

#[tokio::test]
async fn an_upper_case_suffix_that_belongs_to_the_stem_is_not_kept() {
    // `a/old.md.md` has the stem `old.md`. The index strips a lower-case
    // note extension only, so `[[old.MD]]` and `[[a/old.MD]]` name that note
    // by its whole stem: `.MD` is no extension to keep.
    // What fails this: restoring case-insensitive `note_suffix` — the content
    // stays `see [[old.MD]] and [[a/old.MD]]` instead of naming `new`.
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_str().unwrap().to_string();
    std::fs::create_dir(dir.path().join("a")).unwrap();
    std::fs::write(dir.path().join("a/old.md.md"), "t\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "see [[old.MD]] and [[a/old.MD]]\n").unwrap();
    let ctx = ContextManager::new();
    ctx.add(info("ctx-v", &root, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a/old.md.md"),
        &format!("{root}/a/new.md"),
    )
    .await
    .unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "see [[new]] and [[a/new]]\n"
    );
    assert_eq!(result.updated_files, vec![format!("{root}/r.md")]);
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
}
