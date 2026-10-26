//! A file rename whose old or new name is no note — an attachment, or a note
//! renamed out of (or into) the note extensions.

use super::*;
use crate::index::LinkResolution;

/// `root` with `parts` pushed on, as the walk joins a path (`Path::join`): an
/// expected path is spelled the way the index spells one, with this host's
/// separator.
pub(super) fn at(root: &str, parts: &[&str]) -> String {
    let mut path = std::path::PathBuf::from(root);
    for part in parts {
        path.push(part);
    }
    path.to_string_lossy().into_owned()
}

/// What each link of `file` resolves to (`LinkIndex::outgoing_resolved`,
/// what `baram links` reports) in the live index under `root`, and in a new
/// build of `root` — `None` for a file the index reads no link in. A rename
/// leaves the index as a build of the vault would read it, so the tests
/// compare the two, and pin the live one to explicit paths. Each link,
/// rather than the graph: a graph draws a target nothing answers to a
/// placeholder path, which can equal a real file's path, and shows no file
/// that no link names.
async fn links_live_and_built(
    state: &LinkIndexState,
    root: &str,
    file: &str,
) -> (Option<Vec<LinkResolution>>, Option<Vec<LinkResolution>>) {
    let read = |index: &LinkIndex| {
        index
            .outgoing_resolved(file)
            .map(|links| links.into_iter().map(|(_, r)| r).collect())
    };
    let live = state
        .with_index(root, |index| read(index.expect("the index is built")))
        .await;
    let mut built = LinkIndex::new();
    built.build(root).await.unwrap();
    (live, read(&built))
}

/// `links_live_and_built` when the two agree, which every caller asserts.
pub(super) async fn links_as_built(
    state: &LinkIndexState,
    root: &str,
    file: &str,
) -> Option<Vec<LinkResolution>> {
    let (live, built) = links_live_and_built(state, root, file).await;
    assert_eq!(live, built, "{file}: the live index and a new build differ");
    live
}

#[tokio::test]
async fn a_file_that_is_no_note_moves_unread_and_its_referrers_follow() {
    // The rename read the renamed file as text before the move, to rewrite
    // the links in it, so a PDF that is not UTF-8 failed with "could not be
    // read" and nothing moved. A file that is no note has no links the
    // index reads: it moves as it is, its referrers are respelled with its
    // whole new name, and the index reads them as a new build would.
    // What fails this: reading the renamed file as text whatever its name
    // in `rename_file_with_links_inner` — the rename is an `Err` and the
    // PDF stays where it was.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-pdf", true).await;
    let bytes: &[u8] = b"%PDF-1.4\n\xff\xfe\x00\x80\n";
    std::fs::create_dir_all(dir.path().join("d/papers")).unwrap();
    std::fs::write(dir.path().join("d/papers/Paper.pdf"), bytes).unwrap();
    assert!(std::fs::read_to_string(dir.path().join("d/papers/Paper.pdf")).is_err());
    std::fs::write(
        dir.path().join("d/r.md"),
        "[[Paper.pdf]]\n[[d/papers/Paper.pdf|shown]]\n[[Paper]]\n",
    )
    .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &at(&root, &["d", "papers", "Paper.pdf"]),
        &at(&root, &["d", "papers", "Survey.pdf"]),
    )
    .await
    .unwrap();
    assert!(!dir.path().join("d/papers/Paper.pdf").exists());
    assert_eq!(
        std::fs::read(dir.path().join("d/papers/Survey.pdf")).unwrap(),
        bytes
    );
    let r = at(&root, &["d", "r.md"]);
    assert_eq!(result.updated_files, vec![r.clone()]);
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    // `[[Paper]]` names a note called `Paper`, not the PDF, and stays.
    assert_eq!(
        std::fs::read_to_string(dir.path().join("d/r.md")).unwrap(),
        "[[Survey.pdf]]\n[[d/papers/Survey.pdf|shown]]\n[[Paper]]\n"
    );
    let survey = at(&root, &["d", "papers", "Survey.pdf"]);
    assert_eq!(backlink_lines(&state, &ctx, &survey, &r).await, vec![1, 2]);
    assert_eq!(
        links_as_built(&state, &root, &r).await,
        Some(vec![
            LinkResolution::Resolved(survey.clone()),
            LinkResolution::Resolved(survey),
            LinkResolution::Unresolved,
        ])
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
    // of `[[b]]`, in the backlinks of `b.md`, and has links of its own.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-txt", true).await;
    std::fs::create_dir_all(dir.path().join("d")).unwrap();
    std::fs::write(dir.path().join("d/old.md"), "[[b]]\n[[old]]\n").unwrap();
    std::fs::write(dir.path().join("d/r.md"), "[[old]]\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let txt = at(&root, &["d", "old.txt"]);
    let r = at(&root, &["d", "r.md"]);
    let result = rename_file_with_links_inner(&state, &ctx, &at(&root, &["d", "old.md"]), &txt)
        .await
        .unwrap();
    let mut updated = result.updated_files.clone();
    updated.sort();
    assert_eq!(updated, vec![txt.clone(), r.clone()]);
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("d/old.txt")).unwrap(),
        "[[b]]\n[[old.txt]]\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("d/r.md")).unwrap(),
        "[[old.txt]]\n"
    );
    assert_eq!(
        sources(
            &get_backlinks_inner(&state, &ctx, &at(&root, &["b.md"]))
                .await
                .unwrap()
        ),
        vec![at(&root, &["a.md"])]
    );
    assert_eq!(links_as_built(&state, &root, &txt).await, None);
    assert_eq!(
        links_as_built(&state, &root, &r).await,
        Some(vec![LinkResolution::Resolved(txt)])
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
    std::fs::create_dir_all(dir.path().join("d")).unwrap();
    std::fs::write(dir.path().join("d/x.txt"), "[[b]]\n[[x.txt]]\n").unwrap();
    std::fs::write(dir.path().join("d/r.md"), "[[x.txt]]\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let md = at(&root, &["d", "x.md"]);
    let r = at(&root, &["d", "r.md"]);
    let result = rename_file_with_links_inner(&state, &ctx, &at(&root, &["d", "x.txt"]), &md)
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![r.clone()]);
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("d/x.md")).unwrap(),
        "[[b]]\n[[x.txt]]\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("d/r.md")).unwrap(),
        "[[x]]\n"
    );
    let mut from = sources(
        &get_backlinks_inner(&state, &ctx, &at(&root, &["b.md"]))
            .await
            .unwrap(),
    )
    .into_iter()
    .map(str::to_string)
    .collect::<Vec<_>>();
    from.sort();
    let mut expected = vec![at(&root, &["a.md"]), md.clone()];
    expected.sort();
    assert_eq!(from, expected);
    assert_eq!(
        links_as_built(&state, &root, &md).await,
        Some(vec![
            LinkResolution::Resolved(at(&root, &["b.md"])),
            LinkResolution::Unresolved
        ])
    );
}

#[tokio::test]
async fn a_file_renamed_to_a_note_name_that_is_not_text_is_a_note_with_no_links() {
    // `x.txt` → `x.md` where the file is not UTF-8: its content cannot be
    // read as a note's, and a build files such a note under its stem and
    // path with no links. So does the rename: the respelled `[[x]]` and
    // `[[d/x]]` resolve to it, and it has no links of its own.
    // What fails this: registering it as a link target alone in
    // `LinkIndex::add_link_target` — neither link resolves, where a build
    // resolves both.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-md-bytes", true).await;
    std::fs::create_dir_all(dir.path().join("d")).unwrap();
    std::fs::write(dir.path().join("d/x.txt"), b"\xff\xfe\x00[[b]]\n").unwrap();
    std::fs::write(dir.path().join("d/r.md"), "[[x.txt]]\n[[d/x.txt]]\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let md = at(&root, &["d", "x.md"]);
    let r = at(&root, &["d", "r.md"]);
    let result = rename_file_with_links_inner(&state, &ctx, &at(&root, &["d", "x.txt"]), &md)
        .await
        .unwrap();
    assert_eq!(result.updated_files, vec![r.clone()]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("d/r.md")).unwrap(),
        "[[x]]\n[[d/x]]\n"
    );
    assert_eq!(links_as_built(&state, &root, &md).await, None);
    assert_eq!(
        links_as_built(&state, &root, &r).await,
        Some(vec![
            LinkResolution::Resolved(md.clone()),
            LinkResolution::Resolved(md)
        ])
    );
}

/// `files` in the folder `d` beside `d/r.md` holding `link`, then `d/old`
/// renamed to `d/new`: what `r.md` says after, and whether the rename
/// reported it.
async fn rename_beside(files: &[&str], old: &str, new: &str, link: &str) -> (String, bool) {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-stem", true).await;
    std::fs::create_dir_all(dir.path().join("d")).unwrap();
    for file in files {
        std::fs::write(dir.path().join("d").join(file), "text\n").unwrap();
    }
    std::fs::write(dir.path().join("d/r.md"), link).unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &at(&root, &["d", old]),
        &at(&root, &["d", new]),
    )
    .await
    .unwrap();
    let r = at(&root, &["d", "r.md"]);
    assert!(result.skipped_files.iter().all(|f| *f == r), "{result:?}");
    (
        std::fs::read_to_string(dir.path().join("d/r.md")).unwrap(),
        result.skipped_files.contains(&r),
    )
}

#[tokio::test]
async fn a_whole_name_that_is_also_a_notes_stem_is_left_and_reported() {
    // `[[x.txt]]` beside the note `x.txt.md` names both: the index files it
    // under `x.txt`, the text file's whole name and the note's stem, and the
    // resolver answers it with the note. Renaming the text file must not
    // move the link off the note, nor may renaming `z.txt` to `y.txt` move a
    // link onto the note `y.txt.md`: each is left and its file reported.
    // The positive partner: with no such note the link is respelled.
    // What fails this: dropping `whole_name_is_a_note_stem` from
    // `RenameTarget::judge` — both links are respelled and nothing is
    // reported.
    assert_eq!(
        rename_beside(&["x.txt", "x.txt.md"], "x.txt", "y.txt", "[[x.txt]]\n").await,
        ("[[x.txt]]\n".to_string(), true)
    );
    assert_eq!(
        rename_beside(&["z.txt", "y.txt.md"], "z.txt", "y.txt", "[[z.txt]]\n").await,
        ("[[z.txt]]\n".to_string(), true)
    );
    assert_eq!(
        rename_beside(&["x.txt"], "x.txt", "y.txt", "[[x.txt]]\n").await,
        ("[[y.txt]]\n".to_string(), false)
    );
}

#[tokio::test]
async fn a_saved_file_that_is_no_note_stays_a_link_target_as_a_build_files_it() {
    // The editor opens `.mdx`, `.MD` and names without an extension as
    // markdown and saves them through `update_file_index_inner`; a build
    // reads no link in them (`crate::fs::is_note_name`). A save files each
    // as the build does: its `[[b]]` is no backlink of `b.md`, it has no
    // links of its own, `[[Notes]]` and `[[Plan]]` name no file and the
    // whole names do — as after a build.
    // What fails this: reading a saved file as a note whatever its name
    // (`Mutation::update` in `update_file_index_inner`) — the live index
    // reads the saved file's links, where a build reads none.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-saved", true).await;
    std::fs::create_dir_all(dir.path().join("d")).unwrap();
    for name in ["Notes.mdx", "Plan.MD", "README"] {
        std::fs::write(dir.path().join("d").join(name), "[[b]]\n").unwrap();
    }
    std::fs::write(
        dir.path().join("d/r.md"),
        "[[Notes]]\n[[Notes.mdx]]\n[[Plan]]\n[[Plan.MD]]\n[[README]]\n",
    )
    .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    for name in ["Notes.mdx", "Plan.MD", "README"] {
        update_file_index_inner(&state, &ctx, &at(&root, &["d", name]))
            .await
            .unwrap();
        assert_eq!(
            links_as_built(&state, &root, &at(&root, &["d", name])).await,
            None,
            "{name}"
        );
    }
    assert_eq!(
        sources(
            &get_backlinks_inner(&state, &ctx, &at(&root, &["b.md"]))
                .await
                .unwrap()
        ),
        vec![at(&root, &["a.md"])]
    );
    let resolved = |name: &str| LinkResolution::Resolved(at(&root, &["d", name]));
    assert_eq!(
        links_as_built(&state, &root, &at(&root, &["d", "r.md"])).await,
        Some(vec![
            LinkResolution::Unresolved,
            resolved("Notes.mdx"),
            LinkResolution::Unresolved,
            resolved("Plan.MD"),
            resolved("README"),
        ])
    );
}

/// A vault with the folder `sub` registered as a context of its own, both
/// indexes built, holding `files` (a path under the vault, as written by
/// `std::fs::write`) and `sub/r.md` holding `[[a/old.pdf]]`; then
/// `sub/a/old.pdf` renamed to `sub/a/new.pdf`. What `sub/r.md` says after,
/// whether the rename reported it, and the lines of it among the backlinks of
/// the parent's `a/old.pdf` — a path key, counted whether that file exists
/// or not.
async fn rename_under_nested_roots(files: &[&str]) -> (String, bool, Vec<u32>) {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-parent", true).await;
    for file in files {
        let path = dir.path().join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"%PDF\xff\n").unwrap();
    }
    std::fs::write(dir.path().join("sub/r.md"), "[[a/old.pdf]]\n").unwrap();
    let sub = at(&root, &["sub"]);
    ctx.add(info("ctx-child", &sub, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    refresh_index_inner(&state, &ctx, &sub).await.unwrap();
    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &at(&root, &["sub", "a", "old.pdf"]),
        &at(&root, &["sub", "a", "new.pdf"]),
    )
    .await
    .unwrap();
    let r = at(&root, &["sub", "r.md"]);
    assert!(result.skipped_files.iter().all(|f| *f == r), "{result:?}");
    let parents = backlink_lines(&state, &ctx, &at(&root, &["a", "old.pdf"]), &r).await;
    (
        std::fs::read_to_string(dir.path().join("sub/r.md")).unwrap(),
        result.skipped_files.contains(&r),
        parents,
    )
}

#[tokio::test]
async fn a_path_link_another_root_reads_as_an_attachment_there_is_left_and_reported() {
    // Roots `/v` and `/v/sub`: `sub/r.md`'s `[[a/old.pdf]]` is
    // `/v/sub/a/old.pdf` under the child and `/v/a/old.pdf` under the parent.
    // With both PDFs there it names neither alone, so renaming the child's
    // leaves it and reports the file, and the parent's PDF keeps it as a
    // backlink. With the parent's `a/new.pdf` there, the respelled
    // `[[a/new.pdf]]` would name that file under the parent: left and
    // reported too. The positive partner: with neither, it is respelled.
    // What fails this: counting the notes alone among a root's known path
    // keys (`file_map` in place of `registered_files`) — both links are
    // respelled and nothing is reported.
    assert_eq!(
        rename_under_nested_roots(&["sub/a/old.pdf", "a/old.pdf"]).await,
        ("[[a/old.pdf]]\n".to_string(), true, vec![1])
    );
    assert_eq!(
        rename_under_nested_roots(&["sub/a/old.pdf", "a/new.pdf"]).await,
        ("[[a/old.pdf]]\n".to_string(), true, vec![1])
    );
    assert_eq!(
        rename_under_nested_roots(&["sub/a/old.pdf"]).await,
        ("[[a/new.pdf]]\n".to_string(), false, vec![])
    );
}
