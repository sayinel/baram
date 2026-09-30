use super::*;

#[tokio::test]
async fn the_active_contexts_graph_is_found_when_its_id_is_nothing_like_its_path() {
    let ctx = ContextManager::new();
    let (_dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    // Hybrid ranking's view: the edge a → b, with the exact paths the
    // frontend will pass as `current_file`.
    let key = active_index_key(&ctx).await.unwrap();
    let outgoing = outgoing_links(&state, &key).await;
    assert_eq!(
        outgoing.get(&format!("{root}/a.md")),
        Some(&vec![format!("{root}/b.md")])
    );
    // The backlinks panel's view of the same index.
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
        .await
        .unwrap();
    assert_eq!(sources(&backlinks), vec![format!("{root}/a.md")]);
    // Before: the ranking side looked the map up under the id and got nothing.
    assert!(state.with_index("ctx-abc", |idx| idx.is_none()).await);
}

#[tokio::test]
async fn file_commands_use_the_files_own_context_not_the_active_one() {
    let ctx = ContextManager::new();
    let (_a, root_a) = vault_with_a_link(&ctx, "ctx-a", true).await;
    let (dir_b, root_b) = vault_with_a_link(&ctx, "ctx-b", false).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root_a).await.unwrap();
    refresh_index_inner(&state, &ctx, &root_b).await.unwrap();

    // A is active; a B file is saved (a non-active tab) and re-indexed.
    std::fs::write(dir_b.path().join("a.md"), "link removed").unwrap();
    update_file_index_inner(&state, &ctx, &format!("{root_b}/a.md"))
        .await
        .unwrap();
    // B changed…
    assert!(get_backlinks_inner(&state, &ctx, &format!("{root_b}/b.md"))
        .await
        .unwrap()
        .is_empty());
    // …and A did not.
    let backlinks_a = get_backlinks_inner(&state, &ctx, &format!("{root_a}/b.md"))
        .await
        .unwrap();
    assert_eq!(sources(&backlinks_a), vec![format!("{root_a}/a.md")]);
}

#[tokio::test]
async fn a_file_opened_standalone_inside_an_open_folder_belongs_to_the_folders_index() {
    // §89 single-file mode registers a File context for the file itself.
    // Its containing folder is what has links to it.
    let ctx = ContextManager::new();
    let (_dir, root) = vault_with_a_link(&ctx, "ctx-folder", true).await;
    ctx.add(info("ctx-file", &format!("{root}/b.md"), ContextType::File))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    assert_eq!(
        owning_index_key(&ctx, &format!("{root}/b.md"))
            .await
            .unwrap(),
        root
    );
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
        .await
        .unwrap();
    assert_eq!(sources(&backlinks), vec![format!("{root}/a.md")]);
}

#[tokio::test]
async fn file_commands_work_with_no_active_context_and_a_file_outside_every_context_reads_empty() {
    let ctx = ContextManager::new();
    let (_dir, root) = vault_with_a_link(&ctx, "ctx-b", false).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let backlinks = get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
        .await
        .unwrap();
    assert_eq!(sources(&backlinks), vec![format!("{root}/a.md")]);

    // A path no context knows: nothing to report and nothing to index —
    // empty and a no-op, not errors the backlinks panel would render as a
    // banner (and the callers' `.then(invalidate)` still runs). A rename of
    // it is refused — nothing is known about its references — and it is
    // no build root.
    let outside = tempfile::tempdir().unwrap();
    let stray = format!("{}/x.md", outside.path().to_str().unwrap());
    std::fs::write(&stray, "stray").unwrap();
    assert!(get_backlinks_inner(&state, &ctx, &stray)
        .await
        .unwrap()
        .is_empty());
    update_file_index_inner(&state, &ctx, &stray).await.unwrap();
    let err = rename_file_with_links_inner(
        &state,
        &ctx,
        &stray,
        &format!("{}/y.md", outside.path().to_str().unwrap()),
    )
    .await
    .unwrap_err();
    assert!(err.contains("not inside any registered context"), "{err}");
    assert!(std::path::Path::new(&stray).exists());
    assert!(rename_block_id_inner(&state, &ctx, &stray, "a", "b")
        .await
        .is_err());
    assert!(
        refresh_index_inner(&state, &ctx, outside.path().to_str().unwrap())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn the_active_only_commands_are_errors_without_an_active_context() {
    let ctx = ContextManager::new();
    let state = LinkIndexState::new();
    assert_eq!(
        get_link_index_inner(&state, &ctx, None).await.unwrap_err(),
        "No active context"
    );
    assert_eq!(
        active_index_key(&ctx).await.unwrap_err(),
        "No active context"
    );
}

#[tokio::test]
async fn an_active_context_with_no_index_yet_answers_empty_and_a_save_is_a_no_op() {
    let ctx = ContextManager::new();
    let (_dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    assert!(get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
        .await
        .unwrap()
        .is_empty());
    assert!(get_link_index_inner(&state, &ctx, None)
        .await
        .unwrap()
        .edges
        .is_empty());
    update_file_index_inner(&state, &ctx, &format!("{root}/a.md"))
        .await
        .unwrap();
    let key = active_index_key(&ctx).await.unwrap();
    assert!(outgoing_links(&state, &key).await.is_empty());
    assert!(state.with_index(&key, |idx| idx.is_none()).await);
}

#[tokio::test]
async fn a_rename_before_the_initial_build_builds_the_index_first() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    // No refresh has run: the gate builds the index from the registered
    // path, then the rename rewrites the referring file. Renaming here used
    // to be refused (and, before that, to rewrite nothing at all).
    assert!(state.with_index(&root, |idx| idx.is_none()).await);
    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/b.md"),
        &format!("{root}/c.md"),
    )
    .await
    .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/a.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
        "see [[c]]"
    );
    assert!(dir.path().join("c.md").exists());
    // The index the gate built is the live one — it saw the rename too.
    assert_eq!(state.build_root(&root).await, Some(root.clone()));
    assert!(get_backlinks_inner(&state, &ctx, &format!("{root}/c.md"))
        .await
        .unwrap()
        .iter()
        .any(|b| b.source_path == format!("{root}/a.md")));
    // A block-id rename in a context with no index goes the same way.
    std::fs::write(dir.path().join("a.md"), "see ((c#^old))").unwrap();
    update_file_index_inner(&state, &ctx, &format!("{root}/a.md"))
        .await
        .unwrap();
    state
        .forget(&root, incarnation_of(&ctx, "ctx-abc").await)
        .await;
    ctx.remove("ctx-abc").await.unwrap();
    ctx.add(info("ctx-abc", &root, ContextType::Folder))
        .await
        .unwrap();
    let result = rename_block_id_inner(&state, &ctx, &format!("{root}/c.md"), "old", "new")
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![format!("{root}/a.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
        "see ((c#^new))"
    );
}

#[tokio::test]
async fn a_root_in_any_spelling_lands_on_the_registered_key() {
    let ctx = ContextManager::new();
    let (_dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    // The frontend's rootPath with a trailing slash…
    refresh_index_inner(&state, &ctx, &format!("{root}/"))
        .await
        .unwrap();
    // …is the index the active lookup and the explicit-root lookup read.
    let key = active_index_key(&ctx).await.unwrap();
    assert_eq!(key, root);
    assert!(!outgoing_links(&state, &key).await.is_empty());
    assert!(
        !get_link_index_inner(&state, &ctx, Some(format!("{root}/")))
            .await
            .unwrap()
            .edges
            .is_empty()
    );
    assert!(!get_link_index_inner(&state, &ctx, Some(root.clone()))
        .await
        .unwrap()
        .edges
        .is_empty());
    // Exactly one entry: the spelling did not fork the map.
    assert!(
        state
            .with_index(&format!("{root}/"), |idx| idx.is_none())
            .await
    );
}

#[tokio::test]
async fn update_file_index_edits_the_index_in_place() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    std::fs::write(dir.path().join("a.md"), "no link any more").unwrap();
    update_file_index_inner(&state, &ctx, &format!("{root}/a.md"))
        .await
        .unwrap();
    assert!(get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
        .await
        .unwrap()
        .is_empty());
}

#[test]
fn outgoing_map_groups_edges_by_source() {
    let graph = LinkGraph {
        nodes: vec![],
        edges: vec![
            crate::index::LinkEdge {
                from: "/v/a.md".into(),
                to: "/v/b.md".into(),
                cross_vault: false,
            },
            crate::index::LinkEdge {
                from: "/v/a.md".into(),
                to: "/v/c.md".into(),
                cross_vault: false,
            },
        ],
    };
    let out = outgoing_map(&graph);
    assert_eq!(out["/v/a.md"], vec!["/v/b.md", "/v/c.md"]);
}

#[test]
fn spelled_under_compares_components_not_string_prefixes() {
    assert!(spelled_under("/x/Vault", "/x/Vault/a.md"));
    assert!(spelled_under("/x/Vault/", "/x/Vault/a.md"));
    // The root itself counts — the one row a string prefix built with a
    // trailing `/` gets wrong on every platform, so it pins that this is a
    // component comparison even where the Windows row cannot run.
    assert!(spelled_under("/x/Vault", "/x/Vault"));
    assert!(spelled_under("/x/Vault", "/x/Vault/sub/deep/a.md"));
    assert!(!spelled_under("/x/Vault", "/x/Vault-secret/a.md"));
    assert!(!spelled_under("/x/Vault", "/x/vault/a.md"));
    #[cfg(windows)]
    assert!(spelled_under(r"C:\vault", r"C:\vault\a.md"));
}

#[tokio::test]
async fn a_standalone_file_context_renames_with_no_cross_file_updates() {
    // §89: a file opened on its own, outside every folder. Its key is the
    // file path, which no build can fill — and there is no other file whose
    // references could need updating. The renames go through, the
    // backlinks are empty; none of it is an error.
    let dir = tempfile::tempdir().unwrap();
    let note = format!("{}/note.md", dir.path().to_str().unwrap());
    std::fs::write(&note, "block ^b1").unwrap();
    let ctx = ContextManager::new();
    ctx.add(info("ctx-file", &note, ContextType::File))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    assert!(get_backlinks_inner(&state, &ctx, &note)
        .await
        .unwrap()
        .is_empty());
    let result = rename_block_id_inner(&state, &ctx, &note, "b1", "b2")
        .await
        .unwrap();
    assert!(result.updated_files.is_empty());
    let renamed = format!("{}/renamed.md", dir.path().to_str().unwrap());
    let result = rename_file_with_links_inner(&state, &ctx, &note, &renamed)
        .await
        .unwrap();
    assert!(result.updated_files.is_empty());
    assert!(!std::path::Path::new(&note).exists());
    assert!(std::path::Path::new(&renamed).exists());
    // No index was built for a file key.
    assert!(state.with_index(&note, |idx| idx.is_none()).await);
}

#[tokio::test]
async fn a_hidden_nested_root_is_indexed_by_the_gate_not_covered_by_the_enclosing_index() {
    // `collect_md_files` skips dot-directories below a root but not the
    // root itself: `/vault` never scans `/vault/.journal`, while a context
    // registered AT `.journal` scans all of it. So the enclosing index is
    // not a superset of the nested one — requiring only the outermost
    // index would let this rename rewrite nothing. The gate builds the
    // nested index instead.
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_str().unwrap().to_string();
    std::fs::write(dir.path().join("note.md"), "plain").unwrap();
    std::fs::create_dir(dir.path().join(".journal")).unwrap();
    std::fs::write(dir.path().join(".journal/2026-09-07.md"), "entry").unwrap();
    std::fs::write(dir.path().join(".journal/index.md"), "see [[2026-09-07]]").unwrap();
    let journal = format!("{root}/.journal");
    let ctx = ContextManager::new();
    ctx.add(info("ctx-vault", &root, ContextType::Folder))
        .await
        .unwrap();
    ctx.set_active("ctx-vault").await.unwrap();
    ctx.add(info("ctx-journal", &journal, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    assert!(!outgoing_links(&state, &root)
        .await
        .keys()
        .any(|k| k.contains("/.journal/")));
    assert!(state.with_index(&journal, |idx| idx.is_none()).await);

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{journal}/2026-09-07.md"),
        &format!("{journal}/2026-09-08.md"),
    )
    .await
    .unwrap();
    assert_eq!(result.updated_files, vec![format!("{journal}/index.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join(".journal/index.md")).unwrap(),
        "see [[2026-09-08]]"
    );
    assert_eq!(state.build_root(&journal).await, Some(journal.clone()));
}

#[tokio::test]
async fn the_graph_term_reaches_hybrid_ranking_and_changes_the_order() {
    use crate::embedding::hybrid_ranker::{hybrid_rank, RankedChunk};
    use std::collections::HashMap;
    // The shape of issue 263: an id nothing like the path. The graph term comes
    // from the real index and moves the linked file up.
    let ctx = ContextManager::new();
    let (_dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let outgoing = graph_term_for_active(&state, &ctx).await;
    assert_eq!(
        outgoing.get(&format!("{root}/a.md")),
        Some(&vec![format!("{root}/b.md")])
    );
    let chunks = |names: &[&str]| -> Vec<RankedChunk> {
        names
            .iter()
            .enumerate()
            .map(|(i, name)| RankedChunk {
                id: format!("c{i}"),
                file_path: format!("{root}/{name}.md"),
                score: 0.9 - 0.01 * i as f32,
            })
            .collect()
    };
    // Five candidates, BM25 tied, vector similarity descending; b.md (the file
    // a.md links to) sits third by vector alone.
    let scores = [0.9f32, 0.89, 0.88, 0.87, 0.86];
    let contents: HashMap<String, String> = (0..5)
        .map(|i| (format!("c{i}"), "lorem ipsum".to_string()))
        .collect();
    let current = format!("{root}/a.md");
    let names = ["x", "y", "b", "z", "w"];
    let without = hybrid_rank(
        "release checklist",
        chunks(&names),
        &scores,
        &contents,
        Some(&current),
        &HashMap::new(),
        5,
    );
    let with = hybrid_rank(
        "release checklist",
        chunks(&names),
        &scores,
        &contents,
        Some(&current),
        &outgoing,
        5,
    );
    assert_eq!(without[0].file_path, format!("{root}/x.md"));
    assert_eq!(with[0].file_path, format!("{root}/b.md"));
    // No active context: the term is empty, not an error.
    ctx.remove("ctx-abc").await.unwrap();
    assert!(graph_term_for_active(&state, &ctx).await.is_empty());
}
