use super::*;

/// `info` for a vault of `vault_type` with no explicit alias — a space that
/// answers to its canonical name (`Journal`, `Zettel`) when it is unique.
fn spaced(id: &str, path: &str, vault_type: VaultType) -> ContextInfo {
    ContextInfo {
        vault_type: Some(vault_type),
        ..info(id, path, ContextType::Vault)
    }
}

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
    // `old.md`, and A's rename leaves it. `work` is one of A's own names, so
    // the link may mean the renamed note: `r.md` is reported although its
    // bare `[[old]]` was rewritten (issue 678's ③).
    // What fails this: dropping the uniqueness check from `local_aliases_of`
    // — `work` is then local to A, the link is a backlink, and the rename
    // writes `[[work::new]]`; dropping the `left_behind` marking from the
    // file rename's `rewrite` — `r.md` is updated and not reported.
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
    assert_eq!(result.updated_files, vec![referrer.clone()]);
    assert_eq!(result.skipped_files, vec![referrer]);
    assert_eq!(
        std::fs::read_to_string(dir_a.path().join("r.md")).unwrap(),
        "[[work::old]]\n[[new]]\n"
    );
}

#[tokio::test]
async fn a_referrer_behind_an_alias_two_vaults_carry_is_reported_not_rewritten() {
    // Vaults A and B both carry the alias `notes` — the frontend's default
    // alias is the folder name, and both folders are called `notes`. A's
    // `r.md` reaches A's `old.md` only through `[[notes::old]]`, which may
    // mean either vault's note: renaming A's `old.md` leaves the link and
    // reports `r.md`, which nothing else names (issue 678's ③).
    // What fails this: naming the referrers with the local aliases alone
    // (`referring_lines_to(old_path, &local_aliases)` in
    // `rename_file_with_links_inner`) — `r.md` is never visited, and
    // `skipped_files` is empty; leaving a shared explicit alias out of
    // `ambiguous` in `local_aliases_of` — the same.
    let ctx = ContextManager::new();
    let (dir_a, root_a) = aliased_vault(
        &ctx,
        "ctx-a",
        "notes",
        &[("old.md", "t\n"), ("r.md", "[[notes::old]]\n")],
    )
    .await;
    let (_dir_b, root_b) = aliased_vault(&ctx, "ctx-b", "notes", &[("old.md", "t\n")]).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root_a).await.unwrap();
    refresh_index_inner(&state, &ctx, &root_b).await.unwrap();
    let (old, referrer) = (format!("{root_a}/old.md"), format!("{root_a}/r.md"));
    assert!(backlink_lines(&state, &ctx, &old, &referrer)
        .await
        .is_empty());

    let result = rename_file_with_links_inner(&state, &ctx, &old, &format!("{root_a}/new.md"))
        .await
        .unwrap();
    assert!(
        result.updated_files.is_empty(),
        "{:?}",
        result.updated_files
    );
    assert_eq!(result.skipped_files, vec![referrer]);
    assert_eq!(
        std::fs::read_to_string(dir_a.path().join("r.md")).unwrap(),
        "[[notes::old]]\n"
    );
}

#[tokio::test]
async fn the_renamed_note_behind_an_alias_two_vaults_carry_is_reported() {
    // The renamed note itself links to its own name, once bare and once
    // behind `notes`, which A and B both carry. The bare `[[old]]` is
    // rewritten and `[[notes::old]]` is left — it may mean B's note — so the
    // note, under its new path, is both updated and reported.
    // What fails this: passing `passes.rewrite` instead of the marking
    // `rewrite` to `rewrite_renamed_note` in `rename_file_with_links_inner`
    // — the note is updated and not reported.
    let ctx = ContextManager::new();
    let (dir_a, root_a) = aliased_vault(
        &ctx,
        "ctx-a",
        "notes",
        &[("old.md", "[[notes::old]]\n[[old]]\n")],
    )
    .await;
    let (_dir_b, root_b) = aliased_vault(&ctx, "ctx-b", "notes", &[("old.md", "t\n")]).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root_a).await.unwrap();
    refresh_index_inner(&state, &ctx, &root_b).await.unwrap();
    let (old, new) = (format!("{root_a}/old.md"), format!("{root_a}/new.md"));

    let result = rename_file_with_links_inner(&state, &ctx, &old, &new)
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![new.clone()]);
    assert_eq!(result.skipped_files, vec![new]);
    assert_eq!(
        std::fs::read_to_string(dir_a.path().join("new.md")).unwrap(),
        "[[notes::old]]\n[[new]]\n"
    );
}

#[tokio::test]
async fn a_rename_that_keeps_the_stem_leaves_a_link_behind_a_shared_alias_unreported() {
    // `old.md` → `old.txt` keeps the stem, so `[[notes::old]]` behind the
    // alias A and B both carry reads as the renamed note as much as it did
    // before: nothing is left behind, and `r.md` is not reported.
    // What fails this: dropping `!still_named.contains(k)` from the
    // `behind_ambiguous_name` filter in `rename_file_with_links_inner` —
    // `Foreign { notes, old }` stays in the set and `r.md` is reported.
    let ctx = ContextManager::new();
    let (dir_a, root_a) = aliased_vault(
        &ctx,
        "ctx-a",
        "notes",
        &[("old.md", "t\n"), ("r.md", "[[notes::old]]\n")],
    )
    .await;
    let (_dir_b, root_b) = aliased_vault(&ctx, "ctx-b", "notes", &[("old.md", "t\n")]).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root_a).await.unwrap();
    refresh_index_inner(&state, &ctx, &root_b).await.unwrap();
    let old = format!("{root_a}/old.md");

    let result = rename_file_with_links_inner(&state, &ctx, &old, &format!("{root_a}/old.txt"))
        .await
        .unwrap();
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir_a.path().join("r.md")).unwrap(),
        "[[notes::old]]\n"
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
    assert_eq!(
        result.updated_files,
        vec![referrer.clone()],
        "a_first = {a_first}"
    );
    assert_eq!(result.skipped_files, vec![referrer], "a_first = {a_first}");
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
    // leaves it and reports `r.md`, since `work` is A's own name folded — in
    // either registration order.
    // What fails this: dropping the uniqueness check from `local_aliases_of`
    // — no condition is then left, so A's own `Work` is local to A whatever
    // B carries, the link is a backlink, and the rename writes
    // `[[work::new]]`.
    rename_beside_a_case_colliding_alias(true).await;
    rename_beside_a_case_colliding_alias(false).await;
}

/// A temp directory holding `files` (path under it, content); its path.
fn tree(files: &[(&str, &str)]) -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    for (path, content) in files {
        let path = dir.path().join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }
    let root = dir.path().to_str().unwrap().to_string();
    (dir, root)
}

#[tokio::test]
async fn a_journal_space_answers_to_its_canonical_name() {
    // `[[Journal::…]]` is the documented route into a journal space
    // (`site/src/content/docs/en/docs/journal/daily-notes.md`), whatever its
    // folder is called. A vault holds a journal space under `daily/`, with no
    // explicit alias; the vault's `r.md` links to a day by the space name.
    // The link is a backlink of the day note, and renaming the day respells
    // it behind the alias as it was spelled.
    // What fails this: dropping the space-name pass from `local_aliases_of`
    // — the link is foreign and the day note has no backlink.
    let (dir, root) = tree(&[
        ("r.md", "see [[Journal::2026-09-01]]\n"),
        ("daily/2026-09-01.md", "day\n"),
    ]);
    let space = format!("{root}/daily");
    let ctx = ContextManager::new();
    ctx.add(info("v", &root, ContextType::Vault)).await.unwrap();
    ctx.add(spaced("j", &space, VaultType::Journal))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    refresh_index_inner(&state, &ctx, &space).await.unwrap();
    let (day, referrer) = (format!("{space}/2026-09-01.md"), format!("{root}/r.md"));
    assert_eq!(backlink_lines(&state, &ctx, &day, &referrer).await, vec![1]);

    let result =
        rename_file_with_links_inner(&state, &ctx, &day, &format!("{space}/2026-09-02.md"))
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
        "see [[Journal::2026-09-02]]\n"
    );
}

#[tokio::test]
async fn an_explicit_alias_outranks_a_space_name() {
    // A general vault nested in a journal space carries the explicit alias
    // `journal`. The frontend's `findAliasContext` returns an explicit match
    // before it tries space names, so `[[Journal::x]]` in `r.md` — which both
    // roots cover — names the vault's `x.md`, not the space's: a backlink of
    // the one and not the other, and renaming the space's `x.md` leaves the
    // link and reports nothing.
    // What fails this: dropping the explicit-alias check (`outranked`) from
    // the space-name pass — the space then claims `journal` too, files the
    // link under its own `x` and finds a backlink on line 1; putting an
    // outranked space name in `ambiguous` — the rename reports `r.md`.
    let (dir, space) = tree(&[
        ("x.md", "space\n"),
        ("work/x.md", "vault\n"),
        ("work/r.md", "[[Journal::x]]\n"),
    ]);
    let vault = format!("{space}/work");
    let ctx = ContextManager::new();
    ctx.add(spaced("j", &space, VaultType::Journal))
        .await
        .unwrap();
    ctx.add(aliased("w", &vault, "journal")).await.unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &space).await.unwrap();
    refresh_index_inner(&state, &ctx, &vault).await.unwrap();
    let referrer = format!("{vault}/r.md");
    let (spaces_x, vaults_x) = (format!("{space}/x.md"), format!("{vault}/x.md"));
    assert_eq!(
        backlink_lines(&state, &ctx, &vaults_x, &referrer).await,
        vec![1]
    );
    assert!(backlink_lines(&state, &ctx, &spaces_x, &referrer)
        .await
        .is_empty());

    let result = rename_file_with_links_inner(&state, &ctx, &spaces_x, &format!("{space}/y.md"))
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
        std::fs::read_to_string(dir.path().join("work/r.md")).unwrap(),
        "[[Journal::x]]\n"
    );
}

#[tokio::test]
async fn two_journal_spaces_make_the_canonical_name_foreign_to_both() {
    // With two journal spaces the frontend resolves `[[Journal::x]]` to
    // whichever comes first in its list, so the link may name either: it is
    // a backlink of neither `x.md`, and renaming the referrer's own space's
    // `x.md` leaves it and reports `r.md` — `journal` is that space's name.
    // What fails this: dropping the shared-name check (`shared`) from the
    // space-name pass — each space claims `journal`, and the link is a
    // backlink of the referrer's own space's `x.md`; leaving a shared space
    // name out of `ambiguous` in `local_aliases_of` — `r.md` is not
    // reported.
    let (dir_a, root_a) = tree(&[("x.md", "a\n"), ("r.md", "[[Journal::x]]\n")]);
    let (_dir_b, root_b) = tree(&[("x.md", "b\n")]);
    let ctx = ContextManager::new();
    ctx.add(spaced("a", &root_a, VaultType::Journal))
        .await
        .unwrap();
    ctx.add(spaced("b", &root_b, VaultType::Journal))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root_a).await.unwrap();
    refresh_index_inner(&state, &ctx, &root_b).await.unwrap();
    let referrer = format!("{root_a}/r.md");
    for x in [format!("{root_a}/x.md"), format!("{root_b}/x.md")] {
        assert!(backlink_lines(&state, &ctx, &x, &referrer).await.is_empty());
    }

    let old = format!("{root_a}/x.md");
    let result = rename_file_with_links_inner(&state, &ctx, &old, &format!("{root_a}/y.md"))
        .await
        .unwrap();
    assert!(
        result.updated_files.is_empty(),
        "{:?}",
        result.updated_files
    );
    assert_eq!(result.skipped_files, vec![referrer]);
    assert_eq!(
        std::fs::read_to_string(dir_a.path().join("r.md")).unwrap(),
        "[[Journal::x]]\n"
    );
}
