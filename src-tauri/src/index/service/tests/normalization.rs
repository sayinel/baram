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
