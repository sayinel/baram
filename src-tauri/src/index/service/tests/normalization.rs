//! §390 (spec 0069) Names stored decomposed (NFD) and the same names typed
//! composed (NFC), through the index service: backlinks, the two renames
//! and the folder rename. Every Korean NFD and NFC string comes from
//! `both_forms`, and the Latin ones are `\u{…}` escapes — never a literal
//! character.

use super::*;
use crate::index::normalizer::both_forms;

#[tokio::test]
async fn a_vault_alias_stored_decomposed_answers_the_links_typed_composed() {
    // The vault's alias is registered decomposed — the app offers the
    // folder's name as the alias — and the link behind it is typed
    // composed. The link is a backlink, and a file rename respells it behind
    // the alias as it was typed.
    // What fails this: `own_aliases` (`service/keys.rs`) lowercasing the
    // registered alias alone — the vault's own alias is not the link's, and
    // line 1 is no backlink.
    let (alias, alias_on_disk) = both_forms("w회의");
    let link = format!("[[{alias}::old]]\n");
    let ctx = ContextManager::new();
    let (dir, root) = aliased_vault(
        &ctx,
        "ctx-alias-stored",
        &alias_on_disk,
        &[("old.md", "t\n"), ("r.md", link.as_str())],
    )
    .await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let (old, referrer) = (format!("{root}/old.md"), format!("{root}/r.md"));
    assert_eq!(backlink_lines(&state, &ctx, &old, &referrer).await, vec![1]);

    let result = rename_file_with_links_inner(&state, &ctx, &old, &format!("{root}/new.md"))
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![referrer]);
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        format!("[[{alias}::new]]\n")
    );
}

#[tokio::test]
async fn a_link_that_writes_the_alias_decomposed_is_respelled_and_read_back() {
    // The other way round: the alias is registered composed and a body a
    // tool wrote spells it decomposed. The link is a backlink; the rename
    // keeps the alias as written, and the read-back gate must key it as the
    // index files it.
    // What fails this: `filing_key` (`filing.rs`) lowercasing the written
    // alias alone — line 1 is no backlink; `refers_behind_alias`
    // (`judgement.rs`) so — the rename leaves `r.md`; the read-back gate
    // (`read_back.rs`) so — it expects a decomposed alias key, the index
    // files a composed one, and `r.md` is left and reported.
    let (alias, alias_written) = both_forms("w회의");
    let link = format!("[[{alias_written}::old]]\n");
    let ctx = ContextManager::new();
    let (dir, root) = aliased_vault(
        &ctx,
        "ctx-alias-written",
        &alias,
        &[("old.md", "t\n"), ("r.md", link.as_str())],
    )
    .await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let (old, referrer) = (format!("{root}/old.md"), format!("{root}/r.md"));
    assert_eq!(backlink_lines(&state, &ctx, &old, &referrer).await, vec![1]);

    let result = rename_file_with_links_inner(&state, &ctx, &old, &format!("{root}/new.md"))
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![referrer]);
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        format!("[[{alias_written}::new]]\n")
    );
}

#[tokio::test]
async fn a_rename_respells_the_links_typed_composed_and_writes_them_composed() {
    // The folder and the note are stored decomposed (NFD); `r.md` links to
    // the note by its name and by its path, typed composed (NFC), and the
    // folder's `s.md` by `[[./노트]]`. The app renames the note to a name
    // typed composed, in the folder as the disk spells it. Every link is
    // respelled, and what the rename writes is composed — the folder it did
    // not rename included (spec 0069 D7).
    // What fails this: `respell` writing its text without NFC — `r.md` gets
    // the folder decomposed; composing the components before
    // `relative_components` compares them — `s.md` gets
    // `[[../회의록/새 노트]]` instead of `[[./새 노트]]`.
    let (folder, folder_on_disk) = both_forms("회의록");
    let (note, note_on_disk) = both_forms("노트");
    let (renamed, _) = both_forms("새 노트");
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-nfd-rename", true).await;
    let folder_path = dir.path().join(&folder_on_disk);
    std::fs::create_dir(&folder_path).unwrap();
    std::fs::write(folder_path.join(format!("{note_on_disk}.md")), "t\n").unwrap();
    std::fs::write(folder_path.join("s.md"), format!("[[./{note}]]\n")).unwrap();
    std::fs::write(
        dir.path().join("r.md"),
        format!("[[{note}]]\n[[{folder}/{note}]]\n"),
    )
    .unwrap();
    assert!(
        names_in(dir.path()).contains(&folder_on_disk),
        "the directory spells the folder as it was written"
    );
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/{folder_on_disk}/{note_on_disk}.md"),
        &format!("{root}/{folder_on_disk}/{renamed}.md"),
    )
    .await
    .unwrap();
    let mut updated = result.updated_files.clone();
    updated.sort();
    let mut expected = vec![
        format!("{root}/r.md"),
        format!("{root}/{folder_on_disk}/s.md"),
    ];
    expected.sort();
    assert_eq!(updated, expected);
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        format!("[[{renamed}]]\n[[{folder}/{renamed}]]\n")
    );
    assert_eq!(
        std::fs::read_to_string(folder_path.join("s.md")).unwrap(),
        format!("[[./{renamed}]]\n")
    );
}

#[tokio::test]
async fn a_rename_in_a_vault_whose_own_folder_is_stored_decomposed_keeps_its_path_links() {
    // The vault's own folder is stored decomposed. `[[a/노트]]` is
    // respelled `[[a/새 노트]]` under that root and nothing is reported: the
    // components are compared as the disk spells them, root included, and
    // only the finished text is composed.
    // What fails this: composing the new path's components before
    // `under_root` compares them with the root — the root no longer
    // matches, the link is respelled by its stem alone, and the read-back
    // gate leaves `r.md` and reports it.
    let (_, vault_on_disk) = both_forms("볼트");
    let (note, _) = both_forms("노트");
    let (renamed, _) = both_forms("새 노트");
    let parent = tempfile::tempdir().unwrap();
    let vault = parent.path().join(&vault_on_disk);
    std::fs::create_dir_all(vault.join("a")).unwrap();
    std::fs::write(vault.join(format!("a/{note}.md")), "t\n").unwrap();
    std::fs::write(vault.join("r.md"), format!("[[a/{note}]]\n")).unwrap();
    assert!(
        names_in(parent.path()).contains(&vault_on_disk),
        "the directory spells the vault's folder as it was written"
    );
    let root = vault.to_str().unwrap().to_string();
    let ctx = ContextManager::new();
    ctx.add(info("ctx-nfd-root", &root, ContextType::Folder))
        .await
        .unwrap();
    ctx.set_active("ctx-nfd-root").await.unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a/{note}.md"),
        &format!("{root}/a/{renamed}.md"),
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
        std::fs::read_to_string(vault.join("r.md")).unwrap(),
        format!("[[a/{renamed}]]\n")
    );
}

#[tokio::test]
async fn a_rename_to_a_name_given_decomposed_writes_it_composed() {
    // A stem link is respelled with the new stem in NFC, whatever form the
    // new path gives it, and the spellability predicates judge that same
    // string (`RenameTarget::new_stem`).
    // What fails this: `new_stem` answering the stem as `new_path` spells
    // it — `r.md` gets the name decomposed.
    let (renamed, renamed_on_disk) = both_forms("새 노트");
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-nfd-new-name", true).await;
    std::fs::write(dir.path().join("old.md"), "t\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "[[old]]\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/old.md"),
        &format!("{root}/{renamed_on_disk}.md"),
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
        format!("[[{renamed}]]\n")
    );
}

#[tokio::test]
async fn a_block_id_rename_respells_the_references_typed_composed() {
    // The note is stored decomposed; `r.md` refers to its block by name and
    // by path, typed composed. The block-ID rename judges each by the
    // note's folded keys (`BlockTarget`) and rewrites both. Green since the
    // keys were folded; it pins the block-ID path.
    // What fails this: `file_key` lowercasing alone — the name reference
    // keeps `^b1`; `strip_extension_and_fold` so — the path reference does.
    let (folder, folder_on_disk) = both_forms("회의록");
    let (note, note_on_disk) = both_forms("노트");
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-nfd-block", true).await;
    std::fs::create_dir(dir.path().join(&folder_on_disk)).unwrap();
    let target = format!("{root}/{folder_on_disk}/{note_on_disk}.md");
    std::fs::write(&target, "para ^b1\n").unwrap();
    std::fs::write(
        dir.path().join("r.md"),
        format!("(({note}#^b1))\n(({folder}/{note}#^b1))\n"),
    )
    .unwrap();
    assert!(
        names_in(&dir.path().join(&folder_on_disk)).contains(&format!("{note_on_disk}.md")),
        "the directory spells the note as it was written"
    );
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_block_id_inner(&state, &ctx, &target, "b1", "b2")
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
        format!("(({note}#^b2))\n(({folder}/{note}#^b2))\n")
    );
}
