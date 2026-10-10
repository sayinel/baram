use super::*;

fn paths(list: &[(&str, bool)]) -> Vec<SyncPath> {
    list.iter()
        .map(|(path, changed_only)| SyncPath {
            path: path.to_string(),
            changed_only: *changed_only,
        })
        .collect()
}

/// The contexts the batch announced.
async fn sync(state: &LinkIndexState, ctx: &ContextManager, list: &[(&str, bool)]) -> Vec<String> {
    answer(state, ctx, list).await.contexts
}

async fn answer(state: &LinkIndexState, ctx: &ContextManager, list: &[(&str, bool)]) -> SyncAnswer {
    sync_index_paths_inner(state, ctx, &paths(list))
        .await
        .unwrap()
}

/// The backlinks of `note`, sorted.
async fn sources_of(state: &LinkIndexState, ctx: &ContextManager, note: &str) -> Vec<String> {
    let found = get_backlinks_inner(state, ctx, note).await.unwrap();
    let mut out: Vec<String> = sources(&found).into_iter().map(String::from).collect();
    out.sort();
    out
}

/// How the first link of `note` resolves in the live index under `key`.
async fn resolution_of(
    state: &LinkIndexState,
    key: &str,
    note: &str,
) -> crate::index::LinkResolution {
    state
        .with_index(key, |idx| {
            idx.unwrap().outgoing_resolved(note).unwrap()[0].1.clone()
        })
        .await
}

/// `vault_with_a_link` (a.md → b.md), with `extra` files written first, built and published.
async fn built(
    ctx: &ContextManager,
    extra: &[(&str, &str)],
) -> (tempfile::TempDir, String, LinkIndexState) {
    let (dir, root) = vault_with_a_link(ctx, "ctx-a", true).await;
    for (file, content) in extra {
        let path = dir.path().join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }
    let state = LinkIndexState::new();
    refresh_index_inner(&state, ctx, &root).await.unwrap();
    (dir, root, state)
}

#[tokio::test]
async fn a_new_note_and_a_markdown_extension_note_are_indexed_and_announced() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[]).await;
    std::fs::write(dir.path().join("c.md"), "see [[b]]").unwrap();
    std::fs::write(dir.path().join("d.markdown"), "see [[b]]").unwrap();

    let ids = sync(
        &state,
        &ctx,
        &[
            (&format!("{root}/c.md"), false),
            (&format!("{root}/d.markdown"), false),
        ],
    )
    .await;

    assert_eq!(ids, vec!["ctx-a"]);
    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![
            format!("{root}/a.md"),
            format!("{root}/c.md"),
            format!("{root}/d.markdown")
        ]
    );
}

#[tokio::test]
async fn an_attachment_that_appears_resolves_and_is_announced() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[("n.md", "see [[paper.pdf]]")]).await;
    let key = active_index_key(&ctx).await.unwrap();
    let note = format!("{root}/n.md");
    assert_eq!(
        resolution_of(&state, &key, &note).await,
        crate::index::LinkResolution::Unresolved
    );

    std::fs::write(dir.path().join("paper.pdf"), "%PDF").unwrap();
    let ids = sync(&state, &ctx, &[(&format!("{root}/paper.pdf"), false)]).await;

    assert_eq!(ids, vec!["ctx-a"]);
    assert!(matches!(
        resolution_of(&state, &key, &note).await,
        crate::index::LinkResolution::Resolved(_)
    ));
}

/// What fails this: walking a directory on its own metadata change — the second half shows the
/// same directory IS walked when the event was not `changed` only.
#[tokio::test]
async fn a_directorys_own_metadata_change_touches_nothing_and_a_moved_in_folder_is_walked() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[]).await;
    let key = active_index_key(&ctx).await.unwrap();
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("sub/e.md"), "see [[b]]").unwrap();
    std::fs::write(dir.path().join("sub/img.png"), "png").unwrap();
    let sub = format!("{root}/sub");

    let epoch = state.epoch(&key).await;
    assert!(sync(&state, &ctx, &[(&sub, true)]).await.is_empty());
    assert_eq!(
        state.epoch(&key).await,
        epoch,
        "no apply for a changed-only directory"
    );

    let before = walks();
    assert_eq!(sync(&state, &ctx, &[(&sub, false)]).await, vec!["ctx-a"]);
    assert_eq!(walks(), before + 1, "the positive half of the walk counter");
    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![format!("{root}/a.md"), format!("{root}/sub/e.md")]
    );
}

#[tokio::test]
async fn a_deleted_folder_takes_its_notes_with_it() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[("sub/e.md", "see [[b]]")]).await;
    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md"))
            .await
            .len(),
        2
    );
    std::fs::remove_dir_all(dir.path().join("sub")).unwrap();

    assert_eq!(
        sync(&state, &ctx, &[(&format!("{root}/sub"), false)]).await,
        vec!["ctx-a"]
    );
    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![format!("{root}/a.md")]
    );
}

/// What fails this: a directory row that only walks — `sub/old.md` would stay a backlink.
#[tokio::test]
async fn a_folder_replaced_under_the_same_name_in_one_batch_loses_its_old_children() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[("sub/old.md", "see [[b]]")]).await;
    std::fs::remove_dir_all(dir.path().join("sub")).unwrap();
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("sub/new.md"), "see [[b]]").unwrap();

    sync(&state, &ctx, &[(&format!("{root}/sub"), false)]).await;

    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![format!("{root}/a.md"), format!("{root}/sub/new.md")]
    );
}

fn walks() -> usize {
    WALKS.with(|walks| walks.get())
}

/// What fails this: judging the path (`plan`) before finding who holds it (`holding`) — a
/// folder the webview names would be walked although no context holds it (spec 0072 §5.4).
#[tokio::test]
async fn a_directory_no_context_holds_is_not_walked() {
    let ctx = ContextManager::new();
    let (_dir, _root, state) = built(&ctx, &[]).await;
    let other = tempfile::tempdir().unwrap();
    std::fs::create_dir(other.path().join("d")).unwrap();
    std::fs::write(other.path().join("d/n.md"), "x").unwrap();
    let before = walks();

    let ids = sync(
        &state,
        &ctx,
        &[(other.path().join("d").to_str().unwrap(), false)],
    )
    .await;

    assert!(ids.is_empty());
    assert_eq!(walks(), before);
}

#[tokio::test]
async fn a_path_no_directory_context_holds_is_dropped() {
    let ctx = ContextManager::new();
    let (_dir, _root, state) = built(&ctx, &[]).await;
    let other = tempfile::tempdir().unwrap();
    let loose = other.path().join("x.md");
    std::fs::write(&loose, "see [[b]]").unwrap();
    let loose = loose.to_str().unwrap().to_string();
    // A File context (§89) holds it — still no directory index to update.
    ctx.add(info("file-ctx", &loose, ContextType::File))
        .await
        .unwrap();

    assert!(sync(&state, &ctx, &[(&loose, false)]).await.is_empty());
    assert_eq!(
        state.epoch(&loose).await,
        0,
        "no slot was touched for the File context"
    );
}

/// What fails this: removing the skip filter in `holding` — `node_modules/x.md` and the two
/// hidden paths would be applied and announced (the `ids.is_empty()` assertion fails first;
/// the epoch and backlinks assertions pin the index side).
#[tokio::test]
async fn hidden_and_tool_paths_are_left_alone() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[]).await;
    let key = active_index_key(&ctx).await.unwrap();
    for (file, content) in [
        (".DS_Store", "x"),
        (".obsidian/workspace.json", "{}"),
        ("node_modules/x.md", "see [[b]]"),
    ] {
        let path = dir.path().join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }
    let epoch = state.epoch(&key).await;
    let before = walks();

    let ids = sync(
        &state,
        &ctx,
        &[
            (&format!("{root}/.DS_Store"), false),
            (&format!("{root}/.obsidian/workspace.json"), false),
            (&format!("{root}/node_modules/x.md"), false),
            (&format!("{root}/node_modules"), false),
        ],
    )
    .await;

    assert!(ids.is_empty());
    assert_eq!(state.epoch(&key).await, epoch);
    assert_eq!(walks(), before, "node_modules/ is not walked");
    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![format!("{root}/a.md")]
    );
}

/// What fails this: judging the link with `metadata` instead of `symlink_metadata` — it would
/// read as a note, re-index its TARGET `a.md` and announce the context (the `ids` assertion).
/// Treating the link as a missing path does not fail it: the removal names the link's own
/// spelling, which the index never held (`canonical_entry`, pinned on its own by
/// `mutation`'s `a_removed_link_is_named_by_its_own_spelling_not_by_its_target`). Only with
/// both guards gone does the removal reach `a.md`; then the `ids` assertion fails first.
#[cfg(unix)]
#[tokio::test]
async fn a_symlink_is_left_alone_and_its_target_keeps_its_links() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[]).await;
    std::os::unix::fs::symlink(dir.path().join("a.md"), dir.path().join("link.md")).unwrap();

    assert!(sync(&state, &ctx, &[(&format!("{root}/link.md"), false)])
        .await
        .is_empty());
    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![format!("{root}/a.md")]
    );
}

/// What fails this: updating only the spelling the volume resolves — the written `Note.md`
/// names no entry once a file manager renamed it to `note.md`, yet its build-time key stays
/// and `b`'s backlinks list the note twice (`[Note.md, a.md, note.md]`, measured before the
/// fix). The watcher reports both spellings as created, since both exist on a volume that
/// folds case. The first assertion shows the old key was there. On a case-sensitive volume
/// the two spellings are two entries and nothing is stale: `note.md` does not resolve before
/// the rename, and the test returns there.
#[tokio::test]
async fn an_external_case_only_rename_leaves_only_the_new_spelling() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[("Note.md", "see [[b]]")]).await;
    if !dir.path().join("note.md").exists() {
        return;
    }
    let b = format!("{root}/b.md");
    assert_eq!(
        sources_of(&state, &ctx, &b).await,
        vec![format!("{root}/Note.md"), format!("{root}/a.md")]
    );
    std::fs::rename(dir.path().join("Note.md"), dir.path().join("note.md")).unwrap();

    let ids = sync(
        &state,
        &ctx,
        &[
            (&format!("{root}/Note.md"), false),
            (&format!("{root}/note.md"), false),
        ],
    )
    .await;

    assert_eq!(ids, vec!["ctx-a"]);
    assert_eq!(
        sources_of(&state, &ctx, &b).await,
        vec![format!("{root}/a.md"), format!("{root}/note.md")]
    );
}

/// The `OtherFile` half of the one above. What fails this: registering only the resolved
/// spelling — `[[paper.pdf]]` would keep resolving to the first registered `Paper.pdf`, which
/// names no entry any more. The first assertion shows it resolved there before.
#[tokio::test]
async fn an_external_case_only_rename_of_an_attachment_resolves_to_the_new_spelling() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(
        &ctx,
        &[("n.md", "see [[paper.pdf]]"), ("Paper.pdf", "%PDF")],
    )
    .await;
    if !dir.path().join("paper.pdf").exists() {
        return;
    }
    let key = active_index_key(&ctx).await.unwrap();
    let note = format!("{root}/n.md");
    assert_eq!(
        resolution_of(&state, &key, &note).await,
        crate::index::LinkResolution::Resolved(format!("{root}/Paper.pdf"))
    );
    std::fs::rename(dir.path().join("Paper.pdf"), dir.path().join("paper.pdf")).unwrap();

    sync(
        &state,
        &ctx,
        &[
            (&format!("{root}/Paper.pdf"), false),
            (&format!("{root}/paper.pdf"), false),
        ],
    )
    .await;

    assert_eq!(
        resolution_of(&state, &key, &note).await,
        crate::index::LinkResolution::Resolved(format!("{root}/paper.pdf"))
    );
}

/// With no live index there is nothing to compare: each batch is announced and counts as a
/// change to the link index, since a missing refresh is worse than an extra one. What fails
/// the `links_changed` half: counting only `Some(true)` from `apply`.
#[tokio::test]
async fn a_context_without_an_index_is_announced_for_notes_and_removals() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-a", true).await;
    let state = LinkIndexState::new(); // never built
    std::fs::write(dir.path().join("c.md"), "x").unwrap();

    for path in ["c.md", "gone.md"] {
        let answer = answer(&state, &ctx, &[(&format!("{root}/{path}"), false)]).await;
        assert_eq!(answer.contexts, vec!["ctx-a"], "{path}");
        assert!(answer.links_changed, "{path}");
    }
}

/// The positive pair of `a_deleted_folder_takes_its_notes_with_it`: a removal the live index
/// knows nothing about is not news.
#[tokio::test]
async fn a_removed_path_the_live_index_never_knew_is_not_announced() {
    let ctx = ContextManager::new();
    let (_dir, root, state) = built(&ctx, &[]).await;
    assert!(sync(&state, &ctx, &[(&format!("{root}/never.png"), false)])
        .await
        .is_empty());
}

#[tokio::test]
async fn nested_contexts_are_each_updated_and_announced() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[("sub/keep.md", "x")]).await;
    let inner = format!("{root}/sub");
    ctx.add(info("ctx-inner", &inner, ContextType::Folder))
        .await
        .unwrap();
    refresh_index_inner(&state, &ctx, &inner).await.unwrap();
    std::fs::write(dir.path().join("sub/n.md"), "see [[keep]]").unwrap();

    let ids = sync(&state, &ctx, &[(&format!("{inner}/n.md"), false)]).await;

    assert_eq!(ids, vec!["ctx-a", "ctx-inner"]);
    // What fails the second half: applying to one holding context only — the announcement
    // would still name both, so each slot is read.
    let n = format!("{inner}/n.md");
    for key in [root.as_str(), inner.as_str()] {
        let known = state
            .with_index(key, |idx| idx.unwrap().outgoing_resolved(&n).is_some())
            .await;
        assert!(known, "{key} holds {n}");
    }
}

/// A folder that appears with nothing in it: with a live index that knows nothing was there it
/// is not news. What fails this: announcing every directory row.
#[tokio::test]
async fn an_empty_folder_that_appears_is_not_announced_with_a_live_index() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[]).await;
    std::fs::create_dir(dir.path().join("empty")).unwrap();

    assert!(sync(&state, &ctx, &[(&format!("{root}/empty"), false)])
        .await
        .is_empty());
}

/// The positive pair of the one above. What fails this: treating an empty walk as "nothing
/// changed" — `sub/old.md` went away with the replaced folder and that is news.
#[tokio::test]
async fn a_folder_replaced_by_an_empty_one_is_announced_and_loses_its_notes() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[("sub/old.md", "see [[b]]")]).await;
    std::fs::remove_dir_all(dir.path().join("sub")).unwrap();
    std::fs::create_dir(dir.path().join("sub")).unwrap();

    assert_eq!(
        sync(&state, &ctx, &[(&format!("{root}/sub"), false)]).await,
        vec!["ctx-a"]
    );
    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![format!("{root}/a.md")]
    );
}

/// What fails this: announcing only when the live index reports a change — with no live
/// index there is nothing to compare, and tags, tasks and search read the disk (spec 0072 §5.4).
#[tokio::test]
async fn an_empty_folder_is_announced_when_there_is_no_live_index() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-a", true).await;
    let state = LinkIndexState::new(); // never built
    std::fs::create_dir(dir.path().join("empty")).unwrap();

    assert_eq!(
        sync(&state, &ctx, &[(&format!("{root}/empty"), false)]).await,
        vec!["ctx-a"]
    );
}

/// What fails this: treating an unreadable note as an empty one or as gone — `c.md` would lose
/// its link to b (the second assertion) and the context would be announced (the first). The
/// second half shows the same path IS re-indexed once it reads.
#[tokio::test]
async fn an_unreadable_note_keeps_what_the_index_knew_until_it_reads_again() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[("c.md", "see [[b]]")]).await;
    let both = vec![format!("{root}/a.md"), format!("{root}/c.md")];
    std::fs::write(dir.path().join("c.md"), [0xff, 0xfe, 0xfd]).unwrap();

    assert!(sync(&state, &ctx, &[(&format!("{root}/c.md"), false)])
        .await
        .is_empty());
    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        both
    );

    std::fs::write(dir.path().join("c.md"), "plain").unwrap();
    assert_eq!(
        sync(&state, &ctx, &[(&format!("{root}/c.md"), false)]).await,
        vec!["ctx-a"]
    );
    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![format!("{root}/a.md")]
    );
}

/// What fails this: skipping an unreadable note while refilling — `[[bad]]` would stay
/// unresolved (the build registers every note before reading it).
#[tokio::test]
async fn a_refilled_folder_keeps_an_unreadable_note_as_a_link_target() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[("n.md", "see [[bad]]"), ("dir/ok.md", "x")]).await;
    let key = active_index_key(&ctx).await.unwrap();
    let note = format!("{root}/n.md");
    assert_eq!(
        resolution_of(&state, &key, &note).await,
        crate::index::LinkResolution::Unresolved
    );
    std::fs::write(dir.path().join("dir/bad.md"), [0xff, 0xfe, 0xfd]).unwrap();

    sync(&state, &ctx, &[(&format!("{root}/dir"), false)]).await;

    assert!(matches!(
        resolution_of(&state, &key, &note).await,
        crate::index::LinkResolution::Resolved(_)
    ));
}

/// What fails this: a refill that registers notes only — `img.png` would stay unresolved.
#[tokio::test]
async fn a_moved_in_folders_attachment_becomes_a_link_target() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[("n.md", "see [[img.png]]")]).await;
    let key = active_index_key(&ctx).await.unwrap();
    let note = format!("{root}/n.md");
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("sub/img.png"), "png").unwrap();

    sync(&state, &ctx, &[(&format!("{root}/sub"), false)]).await;

    assert!(matches!(
        resolution_of(&state, &key, &note).await,
        crate::index::LinkResolution::Resolved(_)
    ));
}

/// What fails this: a tree removal that drops notes but not link targets — the PDF would keep
/// resolving. The first assertion shows it resolved before.
#[tokio::test]
async fn a_deleted_folders_attachment_stops_resolving() {
    let ctx = ContextManager::new();
    let (dir, root, state) =
        built(&ctx, &[("m.md", "see [[p.pdf]]"), ("docs/p.pdf", "%PDF")]).await;
    let key = active_index_key(&ctx).await.unwrap();
    let note = format!("{root}/m.md");
    assert!(matches!(
        resolution_of(&state, &key, &note).await,
        crate::index::LinkResolution::Resolved(_)
    ));
    std::fs::remove_dir_all(dir.path().join("docs")).unwrap();

    sync(&state, &ctx, &[(&format!("{root}/docs"), false)]).await;

    assert_eq!(
        resolution_of(&state, &key, &note).await,
        crate::index::LinkResolution::Unresolved
    );
}

/// What fails this: comparing the watcher's spelling with the root's — a path spelled through
/// a symlink to the vault would be held by no context and dropped (the `ids` assertion).
#[cfg(unix)]
#[tokio::test]
async fn a_path_spelled_through_a_link_to_the_vault_is_still_held() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[]).await;
    let elsewhere = tempfile::tempdir().unwrap();
    let alias = elsewhere.path().join("alias");
    std::os::unix::fs::symlink(dir.path(), &alias).unwrap();
    std::fs::write(dir.path().join("c.md"), "see [[b]]").unwrap();

    let ids = sync(
        &state,
        &ctx,
        &[(alias.join("c.md").to_str().unwrap(), false)],
    )
    .await;

    assert_eq!(ids, vec!["ctx-a"]);
    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![format!("{root}/a.md"), format!("{root}/c.md")]
    );
}

/// The count pin: three missing notes in one batch are ONE `apply` on the context (one scan
/// of the index), not three. What fails this: applying each missing path as it is found — the
/// epoch would grow by 3.
#[tokio::test]
async fn a_batch_of_missing_paths_is_one_apply_per_context() {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(
        &ctx,
        &[
            ("x/1.md", "see [[b]]"),
            ("x/2.md", "see [[b]]"),
            ("x/3.md", "see [[b]]"),
        ],
    )
    .await;
    let key = active_index_key(&ctx).await.unwrap();
    for n in 1..=3 {
        std::fs::remove_file(dir.path().join(format!("x/{n}.md"))).unwrap();
    }
    let epoch = state.epoch(&key).await;

    let ids = sync(
        &state,
        &ctx,
        &[
            (&format!("{root}/x/1.md"), false),
            (&format!("{root}/x/2.md"), false),
            (&format!("{root}/x/3.md"), false),
        ],
    )
    .await;

    assert_eq!(ids, vec!["ctx-a"]);
    assert_eq!(
        state.epoch(&key).await,
        epoch + 1,
        "one apply for the whole batch"
    );
    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![format!("{root}/a.md")]
    );
}

/// The watcher's echo of an auto-save: the note reads as the index holds it. What fails this:
/// an `Update` that rewrites such a note — `links_changed` turns true (the second assertion),
/// and the rewrite files the note again behind its same-stem sibling, so `[[n]]` resolves to
/// the other `n.md` (the last assertion). The eight tags pin how tags are compared:
/// `extract_file_tags` collects through a `HashSet`, so as lists two reads of one note agree
/// only by chance. The context is still announced — tags, tasks and search read the disk.
#[tokio::test]
async fn an_unchanged_note_is_announced_but_leaves_the_link_index_alone() {
    let ctx = ContextManager::new();
    let note = "see [[b]]\n#t1 #t2 #t3 #t4 #t5 #t6 #t7 #t8";
    let (_dir, root, state) = built(
        &ctx,
        &[("x/n.md", note), ("y/n.md", note), ("r.md", "see [[n]]")],
    )
    .await;
    let key = active_index_key(&ctx).await.unwrap();
    let r = format!("{root}/r.md");
    let before = resolution_of(&state, &key, &r).await;
    let crate::index::LinkResolution::Resolved(first) = before.clone() else {
        panic!("[[n]] resolves: {before:?}");
    };

    let answer = answer(&state, &ctx, &[(&first, true)]).await;

    assert_eq!(answer.contexts, vec!["ctx-a"]);
    assert!(!answer.links_changed);
    assert_eq!(resolution_of(&state, &key, &r).await, before);
}

/// `a.md` (built as `see [[b]]`) rewritten with `content` and synced: whether the batch said
/// the link index changed. The context is announced either way.
async fn links_changed_by(content: &str) -> bool {
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[]).await;
    std::fs::write(dir.path().join("a.md"), content).unwrap();
    let answer = answer(&state, &ctx, &[(&format!("{root}/a.md"), true)]).await;
    assert_eq!(answer.contexts, vec!["ctx-a"]);
    answer.links_changed
}

/// A positive pair of the echo above. What fails this: reading a note the index already holds
/// as an echo whatever its links.
#[tokio::test]
async fn a_link_added_to_a_note_changes_the_link_index() {
    assert!(links_changed_by("see [[b]]\n[[c]]").await);
}

/// A positive pair of the echo above: the links are as they were, a tag is new. What fails
/// this: comparing the links only — the graph draws tags too.
#[tokio::test]
async fn a_tag_added_to_a_note_changes_the_link_index() {
    assert!(links_changed_by("see [[b]]\n#tag").await);
}

/// A positive pair of the echo above: the same link, with the same text around it, one line
/// down. What fails this: comparing the entries without their `line` — a backlink would keep
/// pointing at the old line.
#[tokio::test]
async fn a_link_moved_to_another_line_changes_the_link_index() {
    assert!(links_changed_by("\nsee [[b]]").await);
}
