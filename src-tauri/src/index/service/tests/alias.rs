use super::*;

#[tokio::test]
async fn a_vaults_own_alias_names_its_own_notes() {
    // issue 717: a vault's own alias qualifies a link to one of its own
    // notes — by stem or by path, in any case — so the link is a backlink
    // and a rename respells it behind the alias as it was spelled. `r.md`
    // holds aliased links alone, so only the local alias gets it visited.
    // What fails this: passing `&[]` for the local aliases to
    // `get_backlinks` in `get_backlinks_inner` — no backlink on lines 1–2;
    // to `referring_lines_to` or `RenameTarget` in
    // `rename_file_with_links_inner` — `r.md` is not visited, or its links
    // are not this file's, and they stay `old`; keying the read-back gate's
    // respelled `Foreign` entry without its alias — the gate reverts `r.md`;
    // dropping the fold in `local_aliases_of` — the vault is registered as
    // `Work`, and the index files both links under `work`.
    let ctx = ContextManager::new();
    let (dir, root) = aliased_vault(
        &ctx,
        "ctx-work",
        "Work",
        &[
            ("dir/old.md", "para ^x\n"),
            ("r.md", "[[Work::old]]\n[[work::dir/old]]\n"),
            ("b.md", "((old#^x))\n"),
        ],
    )
    .await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let old = format!("{root}/dir/old.md");
    let (referrer, block_referrer) = (format!("{root}/r.md"), format!("{root}/b.md"));
    assert_eq!(
        backlink_lines(&state, &ctx, &old, &referrer).await,
        vec![1, 2]
    );

    // A block-ID rename through the bare reference still works here.
    let result = rename_block_id_inner(&state, &ctx, &old, "x", "y")
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![block_referrer.clone()]);
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("b.md")).unwrap(),
        "((old#^y))\n"
    );

    let new = format!("{root}/dir/new.md");
    let result = rename_file_with_links_inner(&state, &ctx, &old, &new)
        .await
        .unwrap();
    let mut updated = result.updated_files.clone();
    updated.sort();
    assert_eq!(updated, vec![block_referrer, referrer.clone()]);
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "[[Work::new]]\n[[work::dir/new]]\n"
    );
    assert_eq!(
        backlink_lines(&state, &ctx, &new, &referrer).await,
        vec![1, 2]
    );
}

#[tokio::test]
async fn a_local_rename_leaves_a_link_into_another_vault_alone() {
    // issue 717: `work` is vault B's alias, so `[[work::old]]` in vault A
    // names B's `old.md`: it is no backlink of A's `old.md`, and A's rename
    // leaves it and reports nothing.
    // What fails this: taking the local aliases from every registered
    // context instead of the file's own — `work` is then local to A, the
    // link is a backlink of A's `old.md`, and the rename writes
    // `[[work::new]]`.
    let ctx = ContextManager::new();
    let (dir_a, root_a) = aliased_vault(
        &ctx,
        "ctx-home",
        "home",
        &[
            ("old.md", "t\n"),
            ("r.md", "see [[work::old]] and [[old]]\n"),
            ("foreign.md", "[[work::old]]\n"),
        ],
    )
    .await;
    let (_dir_b, root_b) = aliased_vault(&ctx, "ctx-work", "work", &[("old.md", "t\n")]).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root_a).await.unwrap();
    refresh_index_inner(&state, &ctx, &root_b).await.unwrap();
    let old = format!("{root_a}/old.md");
    let foreign = format!("{root_a}/foreign.md");
    assert!(backlink_lines(&state, &ctx, &old, &foreign)
        .await
        .is_empty());

    let result = rename_file_with_links_inner(&state, &ctx, &old, &format!("{root_a}/new.md"))
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
        "see [[work::old]] and [[new]]\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir_a.path().join("foreign.md")).unwrap(),
        "[[work::old]]\n"
    );
}

#[tokio::test]
async fn an_alias_two_vaults_carry_is_foreign_to_both() {
    // Two vaults carry the alias `work`. The frontend picks the first in its
    // list and the backend alias map the last registration, so the link may
    // name either vault: in A `[[work::old]]` is no backlink of A's
    // `old.md`, and A's rename leaves it.
    // What fails this: dropping the uniqueness check from `local_aliases_of`
    // — `work` is then local to A, the link is a backlink, and the rename
    // writes `[[work::new]]`.
    let ctx = ContextManager::new();
    let (dir_a, root_a) = aliased_vault(
        &ctx,
        "ctx-a",
        "work",
        &[("old.md", "t\n"), ("r.md", "[[work::old]]\n[[old]]\n")],
    )
    .await;
    let (_dir_b, root_b) = aliased_vault(&ctx, "ctx-b", "work", &[("old.md", "t\n")]).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root_a).await.unwrap();
    refresh_index_inner(&state, &ctx, &root_b).await.unwrap();
    let (old, referrer) = (format!("{root_a}/old.md"), format!("{root_a}/r.md"));
    assert_eq!(backlink_lines(&state, &ctx, &old, &referrer).await, vec![2]);

    let result = rename_file_with_links_inner(&state, &ctx, &old, &format!("{root_a}/new.md"))
        .await
        .unwrap();
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir_a.path().join("r.md")).unwrap(),
        "[[work::old]]\n[[new]]\n"
    );
}

#[tokio::test]
async fn an_alias_is_local_again_once_the_other_vault_carrying_it_is_removed() {
    // A carries `work`; B registers with `work` too and takes the alias map
    // entry (last writer wins); B is removed, and its removal drops that
    // entry. The backend cross-vault resolver now answers nothing for
    // `work`, while the frontend resolves it to A, the only vault carrying
    // it — uniqueness, the rule `local_aliases_of` reads — so `[[work::old]]`
    // in A is a backlink of A's `old.md` again and A's rename respells it.
    // What fails this: an ownership check keyed on `resolve_alias` in
    // `local_aliases_of` — the map holds no entry for `work` after B's
    // removal, so A stays foreign and the link keeps `old`.
    let ctx = ContextManager::new();
    let (dir_a, root_a) = aliased_vault(
        &ctx,
        "ctx-a",
        "work",
        &[("old.md", "t\n"), ("r.md", "[[work::old]]\n[[old]]\n")],
    )
    .await;
    let (_dir_b, _root_b) = aliased_vault(&ctx, "ctx-b", "work", &[("old.md", "t\n")]).await;
    ctx.remove("ctx-b").await.unwrap();
    assert_eq!(ctx.resolve_alias("work").await, None);
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root_a).await.unwrap();
    let (old, referrer) = (format!("{root_a}/old.md"), format!("{root_a}/r.md"));
    assert_eq!(
        backlink_lines(&state, &ctx, &old, &referrer).await,
        vec![1, 2]
    );

    let result = rename_file_with_links_inner(&state, &ctx, &old, &format!("{root_a}/new.md"))
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![referrer]);
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir_a.path().join("r.md")).unwrap(),
        "[[work::new]]\n[[new]]\n"
    );
}

// Not on Windows: `:` is illegal in an NTFS file name, and this note's
// name is `work::note.md`.
#[cfg(not(windows))]
#[tokio::test]
async fn a_block_reference_never_carries_a_vault_alias() {
    // The block-reference grammar has no alias group: in `((work::note#^id))`
    // the `::` is part of a local stem, even in a vault whose own alias is
    // `work`. The reference is a backlink of `work::note.md`, and a block-ID
    // rename rewrites it.
    // What fails this: splitting a leading `word::` off a block reference's
    // target as its vault alias in the extractor — the reference is then
    // filed as `Foreign { work, note }`, which is no key of this file.
    let ctx = ContextManager::new();
    let (dir, root) = aliased_vault(
        &ctx,
        "ctx-work",
        "work",
        &[
            ("work::note.md", "para ^id\n"),
            ("r.md", "((work::note#^id))\n"),
        ],
    )
    .await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let (note, referrer) = (format!("{root}/work::note.md"), format!("{root}/r.md"));
    assert_eq!(
        backlink_lines(&state, &ctx, &note, &referrer).await,
        vec![1]
    );

    let result = rename_block_id_inner(&state, &ctx, &note, "id", "id2")
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
        "((work::note#^id2))\n"
    );
}

#[tokio::test]
async fn nested_vaults_an_aliased_path_link_names_the_aliased_vaults_note() {
    // An alias resolves a path against the root of the vault it names, not
    // the root of the index being read: `/v` is `p` and `/v/sub` is `s`, so
    // `[[p::a/old]]` names `/v/a/old.md` and `[[s::a/old]]` names
    // `/v/sub/a/old.md`, wherever either is written.
    // What fails this: pairing a local alias with the root of the index
    // being read (`keys_for`'s `root`) instead of its own vault's root —
    // `[[p::a/old]]` is then a backlink of `/v/sub/a/old.md` and its
    // rename respells it `[[p::a/new]]`, breaking the link to `/v/a/old.md`.
    let ctx = ContextManager::new();
    let (dir, root) = aliased_vault(
        &ctx,
        "ctx-p",
        "p",
        &[
            ("a/old.md", "parent note\n"),
            ("sub/a/old.md", "child note\n"),
            ("sub/r.md", "[[p::a/old]]\n[[s::a/old]]\n"),
        ],
    )
    .await;
    let sub = format!("{root}/sub");
    ctx.add(aliased("ctx-s", &sub, "s")).await.unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    refresh_index_inner(&state, &ctx, &sub).await.unwrap();
    let (parent_old, child_old) = (format!("{root}/a/old.md"), format!("{sub}/a/old.md"));
    let referrer = format!("{sub}/r.md");
    assert_eq!(
        backlink_lines(&state, &ctx, &parent_old, &referrer).await,
        vec![1]
    );
    assert_eq!(
        backlink_lines(&state, &ctx, &child_old, &referrer).await,
        vec![2]
    );

    let result = rename_file_with_links_inner(&state, &ctx, &child_old, &format!("{sub}/a/new.md"))
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
        "[[p::a/old]]\n[[s::a/new]]\n"
    );
}

/// Vault A (alias `Work`) and vault B (alias `work`), registered in the order
/// `a_first` says; A's `r.md` holds `[[work::old]]` and `[[old]]`. A's
/// `old.md` is renamed to `new.md`.
async fn rename_beside_a_case_colliding_alias(a_first: bool) {
    let ctx = ContextManager::new();
    let a_files: &[(&str, &str)] = &[("old.md", "t\n"), ("r.md", "[[work::old]]\n[[old]]\n")];
    let b_files: &[(&str, &str)] = &[("old.md", "t\n")];
    let ((dir_a, root_a), _b) = if a_first {
        let a = aliased_vault(&ctx, "ctx-a", "Work", a_files).await;
        let b = aliased_vault(&ctx, "ctx-b", "work", b_files).await;
        (a, b)
    } else {
        let b = aliased_vault(&ctx, "ctx-b", "work", b_files).await;
        let a = aliased_vault(&ctx, "ctx-a", "Work", a_files).await;
        (a, b)
    };
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root_a).await.unwrap();
    let (old, referrer) = (format!("{root_a}/old.md"), format!("{root_a}/r.md"));
    assert_eq!(
        backlink_lines(&state, &ctx, &old, &referrer).await,
        vec![2],
        "a_first = {a_first}"
    );

    let result = rename_file_with_links_inner(&state, &ctx, &old, &format!("{root_a}/new.md"))
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![referrer], "a_first = {a_first}");
    assert!(
        result.skipped_files.is_empty(),
        "a_first = {a_first}: {:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir_a.path().join("r.md")).unwrap(),
        "[[work::old]]\n[[new]]\n",
        "a_first = {a_first}"
    );
}

#[tokio::test]
async fn aliases_differing_only_in_case_make_the_link_foreign_for_both_vaults() {
    // The backend alias map is keyed by the exact string, so A owns `Work`
    // and B owns `work` at once; the frontend resolves `[[work::old]]`
    // case-insensitively by context order, so the link may mean either
    // vault. It is foreign: no backlink of A's `old.md`, and A's rename
    // leaves it — in either registration order.
    // What fails this: dropping the uniqueness check from `local_aliases_of`
    // — no condition is then left, so A's own `Work` is local to A whatever
    // B carries, the link is a backlink, and the rename writes
    // `[[work::new]]`.
    rename_beside_a_case_colliding_alias(true).await;
    rename_beside_a_case_colliding_alias(false).await;
}
