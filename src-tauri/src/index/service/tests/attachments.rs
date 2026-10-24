//! A file rename whose old or new name is no note — an attachment, or a note
//! renamed out of (or into) the note extensions.

use super::*;

/// The link graph of the index `state` holds for `root`, as sorted edges and
/// sorted nodes — beside `fresh_graph`, what a build of the vault as it is
/// on disk now would hold.
async fn live_graph(
    state: &LinkIndexState,
    ctx: &ContextManager,
    root: &str,
) -> (Vec<(String, String)>, Vec<String>) {
    sorted(
        get_link_index_inner(state, ctx, Some(root.to_string()))
            .await
            .unwrap(),
    )
}

/// The link graph of a new build of `root`, sorted as `live_graph` sorts.
async fn fresh_graph(root: &str) -> (Vec<(String, String)>, Vec<String>) {
    let mut index = LinkIndex::new();
    index.build(root).await.unwrap();
    sorted(index.get_link_graph())
}

fn sorted(graph: LinkGraph) -> (Vec<(String, String)>, Vec<String>) {
    let mut edges: Vec<(String, String)> =
        graph.edges.into_iter().map(|e| (e.from, e.to)).collect();
    edges.sort();
    let mut nodes = graph.nodes;
    nodes.sort();
    (edges, nodes)
}

#[tokio::test]
async fn a_file_that_is_no_note_moves_unread_and_its_referrers_follow() {
    // The rename read the renamed file as text before the move, to rewrite
    // the links in it, so a PDF that is not UTF-8 failed with "could not be
    // read" and nothing moved. A file that is no note has no links the
    // index reads: it moves as it is, its referrers are respelled with its
    // whole new name, and the index reads as a new build would.
    // What fails this: reading the renamed file as text whatever its name
    // in `rename_file_with_links_inner` — the rename is an `Err` and the
    // PDF stays where it was.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-pdf", true).await;
    let bytes: &[u8] = b"%PDF-1.4\n\xff\xfe\x00\x80\n";
    std::fs::create_dir_all(dir.path().join("papers")).unwrap();
    std::fs::write(dir.path().join("papers/Paper.pdf"), bytes).unwrap();
    assert!(std::fs::read_to_string(dir.path().join("papers/Paper.pdf")).is_err());
    std::fs::write(
        dir.path().join("r.md"),
        "[[Paper.pdf]]\n[[papers/Paper.pdf|shown]]\n[[Paper]]\n",
    )
    .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/papers/Paper.pdf"),
        &format!("{root}/papers/Survey.pdf"),
    )
    .await
    .unwrap();
    assert!(!dir.path().join("papers/Paper.pdf").exists());
    assert_eq!(
        std::fs::read(dir.path().join("papers/Survey.pdf")).unwrap(),
        bytes
    );
    assert_eq!(result.updated_files, vec![format!("{root}/r.md")]);
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    // `[[Paper]]` names a note called `Paper`, not the PDF, and stays.
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "[[Survey.pdf]]\n[[papers/Survey.pdf|shown]]\n[[Paper]]\n"
    );
    assert_eq!(
        backlink_lines(
            &state,
            &ctx,
            &format!("{root}/papers/Survey.pdf"),
            &format!("{root}/r.md")
        )
        .await,
        vec![1, 2]
    );
    assert_eq!(
        live_graph(&state, &ctx, &root).await,
        fresh_graph(&root).await
    );
}

#[tokio::test]
async fn a_note_renamed_to_a_name_that_is_no_note_leaves_the_notes_of_the_index() {
    // `old.md` → `old.txt`: the index read the note's links, so its own
    // reference to its old name is respelled as a referrer's would be — but
    // after the move it is a link target only, as a build files it: its
    // links (`[[b]]`) are no backlinks and no graph edges any more.
    // What fails this: filing the renamed file as a note whatever its new
    // name (`Mutation::Update` → `write_note`) — `old.txt` stays a source
    // of `[[b]]`, in the backlinks of `b.md` and in the graph.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-txt", true).await;
    std::fs::write(dir.path().join("old.md"), "[[b]]\n[[old]]\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "[[old]]\n").unwrap();
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
    let mut updated = result.updated_files.clone();
    updated.sort();
    assert_eq!(
        updated,
        vec![format!("{root}/old.txt"), format!("{root}/r.md")]
    );
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("old.txt")).unwrap(),
        "[[b]]\n[[old.txt]]\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "[[old.txt]]\n"
    );
    assert_eq!(
        sources(
            &get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
                .await
                .unwrap()
        ),
        vec![format!("{root}/a.md")]
    );
    assert_eq!(
        live_graph(&state, &ctx, &root).await,
        fresh_graph(&root).await
    );
}

#[tokio::test]
async fn a_file_renamed_to_a_note_name_joins_the_notes_of_the_index() {
    // `x.txt` → `x.md`: the index read none of the text file's links, so
    // the rename rewrites none of them — `[[x.txt]]` inside it stays — and
    // after the move the file is a note, its links read as a build reads
    // them. Its referrer's `[[x.txt]]` is respelled with the note's stem.
    // What fails this: filing the renamed file as a link target whenever the
    // OLD name is no note — `x.md` is no source of `[[b]]`, and `b.md` loses
    // that backlink; rewriting the renamed file's own references whatever
    // its old name — its `[[x.txt]]` becomes `[[x]]` and `x.md` joins
    // `updated_files`.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-md", true).await;
    std::fs::write(dir.path().join("x.txt"), "[[b]]\n[[x.txt]]\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "[[x.txt]]\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/x.txt"),
        &format!("{root}/x.md"),
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
        std::fs::read_to_string(dir.path().join("x.md")).unwrap(),
        "[[b]]\n[[x.txt]]\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "[[x]]\n"
    );
    let mut from = sources(
        &get_backlinks_inner(&state, &ctx, &format!("{root}/b.md"))
            .await
            .unwrap(),
    )
    .into_iter()
    .map(str::to_string)
    .collect::<Vec<_>>();
    from.sort();
    assert_eq!(from, vec![format!("{root}/a.md"), format!("{root}/x.md")]);
    assert_eq!(
        live_graph(&state, &ctx, &root).await,
        fresh_graph(&root).await
    );
}
