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
    // What fails this: dropping both NFCs, `respell`'s on the finished text
    // and `new_stem`'s, gives `r.md` the name decomposed. Either one alone
    // still writes it composed. `new_stem`'s is pinned by
    // `judgement::tests::the_new_stem_is_the_new_name_in_nfc`.
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

// Not on Windows: `:` is illegal in an NTFS file name, and this note's
// name is `e\u{301}x::y.md`.
#[cfg(not(windows))]
#[tokio::test]
async fn a_rename_to_a_name_whose_decomposed_form_reads_as_an_alias_is_judged_composed() {
    // The new name `\u{e9}x::y` given decomposed (`e` + U+0301). Decomposed,
    // its head `e\u{301}x::` reads as a vault alias (`ALIAS_PREFIX_RE`, whose
    // `\w` takes marks) and no wikilink could spell it; composed, `\u{e9}` is
    // no ASCII letter, no alias is read, and `[[\u{e9}x::y]]` names the file.
    // The rename writes the composed form, so it must judge that form.
    // What fails this: `new_stem` answering the stem as `new_path` spells
    // it — the link is judged unspellable, left as `[[old]]`, and `r.md`
    // is reported.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-nfd-alias-shape", true).await;
    std::fs::write(dir.path().join("old.md"), "t\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "[[old]]\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/old.md"),
        &format!("{root}/e\u{301}x::y.md"),
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
        "[[\u{e9}x::y]]\n"
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

#[tokio::test]
async fn a_folder_rename_rewrites_the_links_typed_composed_into_it() {
    // `회의록/` is stored decomposed; `a.md` links into it typed composed.
    // Renaming the folder rewrites the link.
    // What fails this: `rewrite_relative_wikilinks` comparing the old
    // directory byte for byte — `a.md` keeps `[[./회의록/c]]`.
    let (folder, folder_on_disk) = both_forms("회의록");
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-nfd-folder", true).await;
    std::fs::create_dir(dir.path().join(&folder_on_disk)).unwrap();
    std::fs::write(dir.path().join(&folder_on_disk).join("c.md"), "target").unwrap();
    std::fs::write(dir.path().join("a.md"), format!("see [[./{folder}/c]]")).unwrap();
    assert!(
        names_in(dir.path()).contains(&folder_on_disk),
        "the directory spells the folder as it was written"
    );

    let committed = commit_namespace_rename(
        &format!("{root}/{folder_on_disk}"),
        &format!("{root}/archive"),
        &root,
        &crate::fs::VaultExclusion::load(std::path::Path::new(&root)).unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(committed.updated_files, vec![format!("{root}/a.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
        "see [[./archive/c]]"
    );
}

/// Whether the file system under `dir` folds Unicode normalization: a file
/// written under a decomposed name is found again under the composed one.
/// APFS does; ext4 does not. The probe file is removed.
fn folds_normalization(dir: &std::path::Path) -> bool {
    let (typed, stored) = both_forms("프로브");
    let probe = dir.join(format!("{stored}.md"));
    std::fs::write(&probe, "").unwrap();
    let folds = dir.join(format!("{typed}.md")).exists();
    std::fs::remove_file(&probe).unwrap();
    folds
}

#[tokio::test]
async fn a_normalization_only_rename_renames_the_file_itself_where_normalization_folds() {
    // `노트.md` stored decomposed → typed composed (spec 0069 D8). Where the
    // file system folds normalization the two names open one file: the
    // destination is the note itself, so the rename goes ahead, the
    // directory spells the composed name, the link written decomposed is
    // respelled, and the graph holds the composed path. Where it keeps
    // normalization the composed name is a name of its own: an existing one
    // is another note, and the rename is refused as onto any existing file.
    // What fails this: `another_entry_at` comparing the names by ASCII case
    // alone — where normalization folds, the rename answers "already exists".
    let (note, note_on_disk) = both_forms("노트");
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-nfc-only", true).await;
    let folds = folds_normalization(dir.path());
    std::fs::write(dir.path().join(format!("{note_on_disk}.md")), "see [[b]]\n").unwrap();
    assert!(
        names_in(dir.path()).contains(&format!("{note_on_disk}.md")),
        "the directory spells the note as it was written"
    );
    let text = format!("[[{note}]]\n[[{note_on_disk}]]\n");
    std::fs::write(dir.path().join("r.md"), &text).unwrap();
    if !folds {
        std::fs::write(dir.path().join(format!("{note}.md")), "another\n").unwrap();
    }
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/{note_on_disk}.md"),
        &format!("{root}/{note}.md"),
    )
    .await;
    if folds {
        let result = result.unwrap();
        assert_eq!(result.updated_files, vec![format!("{root}/r.md")]);
        assert!(
            result.skipped_files.is_empty(),
            "{:?}",
            result.skipped_files
        );
        let names = names_in(dir.path());
        assert!(names.contains(&format!("{note}.md")), "{names:?}");
        assert!(!names.contains(&format!("{note_on_disk}.md")), "{names:?}");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
            format!("[[{note}]]\n[[{note}]]\n")
        );
        let graph = state
            .with_index(&root, |idx| idx.unwrap().get_link_graph())
            .await;
        assert!(
            graph.nodes.contains(&format!("{root}/{note}.md")),
            "{graph:?}"
        );
        assert!(
            !graph.nodes.contains(&format!("{root}/{note_on_disk}.md")),
            "{graph:?}"
        );
    } else {
        // What fails this: taking any entry at the destination for the file
        // itself — the rename replaces the composed note, whose text is lost.
        let err = result.unwrap_err();
        assert!(err.contains("already exists"), "{err}");
        assert_eq!(
            std::fs::read_to_string(dir.path().join(format!("{note}.md"))).unwrap(),
            "another\n"
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join(format!("{note_on_disk}.md"))).unwrap(),
            "see [[b]]\n"
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
            text
        );
    }
}

#[tokio::test]
async fn two_notes_of_one_name_in_two_normalizations_keep_the_path_links_both_answer() {
    // Where the file system keeps normalization, `a/노트.md` composed and
    // `a/노트.md` decomposed are two notes with one key, as `A/note.md` and
    // `a/note.md` are where case is kept: `[[a/노트]]` names neither alone,
    // so renaming one leaves it and reports the file, and the bare `[[노트]]`
    // is respelled as a stem link always is (`colliding_path_keys` counts
    // both, though `relative_map` keeps one). Where the file system folds
    // normalization the two are one, and this half has nothing to run.
    // What fails this: the keys lowercasing alone — the composed note alone
    // answers `[[a/노트]]`, which becomes `[[a/새 노트]]` with nothing reported.
    let (note, note_on_disk) = both_forms("노트");
    let (renamed, _) = both_forms("새 노트");
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-nfc-twins", true).await;
    if folds_normalization(dir.path()) {
        eprintln!("the file system under {root} folds normalization; the two-note half is not run");
        return;
    }
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::write(dir.path().join(format!("a/{note}.md")), "t\n").unwrap();
    std::fs::write(dir.path().join(format!("a/{note_on_disk}.md")), "t\n").unwrap();
    let names = names_in(&dir.path().join("a"));
    assert!(
        names.contains(&format!("{note}.md")) && names.contains(&format!("{note_on_disk}.md")),
        "{names:?}"
    );
    std::fs::write(
        dir.path().join("r.md"),
        format!("[[a/{note}]]\n[[{note}]]\n"),
    )
    .unwrap();
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
    let referrer = format!("{root}/r.md");
    assert_eq!(result.updated_files, vec![referrer.clone()]);
    assert_eq!(result.skipped_files, vec![referrer]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        format!("[[a/{note}]]\n[[{renamed}]]\n")
    );
}

#[tokio::test]
async fn a_rename_that_changes_the_ascii_case_of_a_decomposed_name_still_goes_ahead() {
    // `Élan.md` written with a combining accent (`E` + U+0301) → `e` +
    // U+0301: the names differ in ASCII case only, as written. Accepted
    // before §390 and still (spec 0069 D8) — where case folds, the
    // destination is the note itself; where it is kept, there is no entry
    // there.
    // What fails this: `same_name` comparing the names in NFC alone — NFC
    // composes them to `Élan` and `élan`, which differ in non-ASCII case,
    // and where case folds the rename answers "already exists".
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-elan-decomposed", true).await;
    std::fs::write(dir.path().join("E\u{301}lan.md"), "t\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/E\u{301}lan.md"),
        &format!("{root}/e\u{301}lan.md"),
    )
    .await
    .unwrap();
    let names = names_in(dir.path());
    assert!(names.contains(&"e\u{301}lan.md".to_string()), "{names:?}");
    assert!(!names.contains(&"E\u{301}lan.md".to_string()), "{names:?}");
}

#[tokio::test]
async fn a_rename_that_changes_only_non_ascii_case_is_still_refused_where_case_folds() {
    // The other side of `same_name` (spec 0069 D8): `Élan.md` → `élan.md`,
    // both precomposed, differs in non-ASCII case only. Where the file
    // system folds case the destination is found, the names are two names,
    // and the rename is refused, as before §390. Where case is kept there is
    // no entry at the destination and the rename is an ordinary one, not
    // judged here.
    // What fails this: `same_name` folding case beyond ASCII (`fold_name`) —
    // the rename goes ahead.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-elan", true).await;
    std::fs::write(dir.path().join("\u{C9}lan.md"), "t\n").unwrap();
    if !dir.path().join("\u{E9}lan.md").exists() {
        eprintln!("the file system under {root} keeps case; nothing to refuse");
        return;
    }
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let err = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/\u{C9}lan.md"),
        &format!("{root}/\u{E9}lan.md"),
    )
    .await
    .unwrap_err();
    assert!(err.contains("already exists"), "{err}");
    assert!(names_in(dir.path()).contains(&"\u{C9}lan.md".to_string()));
}
