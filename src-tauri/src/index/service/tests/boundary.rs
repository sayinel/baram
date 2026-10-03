use super::*;

#[tokio::test]
async fn a_rename_destination_outside_the_files_contexts_is_refused() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let outside = format!("{}/taken.md", elsewhere.path().to_str().unwrap());
    // The source is in a vault; the destination would carry it out of every
    // context. Refused before a reference or the file is touched.
    let err = rename_file_with_links_inner(&state, &ctx, &format!("{root}/b.md"), &outside)
        .await
        .unwrap_err();
    assert!(err.contains("outside the contexts"), "{err}");
    assert!(dir.path().join("b.md").exists());
    assert!(!std::path::Path::new(&outside).exists());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
        "see [[b]]"
    );
    // A file opened on its own may only be renamed within its directory.
    let note = format!("{}/note.md", elsewhere.path().to_str().unwrap());
    std::fs::write(&note, "n").unwrap();
    ctx.add(info("ctx-file", &note, ContextType::File))
        .await
        .unwrap();
    let err = rename_file_with_links_inner(&state, &ctx, &note, &format!("{root}/moved.md"))
        .await
        .unwrap_err();
    assert!(err.contains("outside the contexts"), "{err}");
    assert!(std::path::Path::new(&note).exists());
}

#[cfg(unix)]
#[tokio::test]
async fn a_referring_file_that_resolves_outside_the_vault_is_not_rewritten() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    // The index learned that a.md links to b.md…
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    // …then a.md was replaced by a symlink to a file outside the vault. The
    // index still names a.md; the rename must not write through it.
    let elsewhere = tempfile::tempdir().unwrap();
    let outside = elsewhere.path().join("outside.md");
    std::fs::write(&outside, "see [[b]]").unwrap();
    std::fs::remove_file(dir.path().join("a.md")).unwrap();
    std::os::unix::fs::symlink(&outside, dir.path().join("a.md")).unwrap();
    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/b.md"),
        &format!("{root}/c.md"),
    )
    .await
    .unwrap();
    assert!(result.updated_files.is_empty());
    assert_eq!(std::fs::read_to_string(&outside).unwrap(), "see [[b]]");
    assert!(dir.path().join("c.md").exists());
}

#[tokio::test]
async fn a_rename_onto_an_existing_file_or_directory_is_refused() {
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-abc", true).await;
    let state = LinkIndexState::new();
    // b.md exists; renaming a.md onto it would overwrite it (Unix `rename`
    // replaces). Refused, and a.md's references are untouched.
    let err = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a.md"),
        &format!("{root}/b.md"),
    )
    .await
    .unwrap_err();
    assert!(err.contains("already exists"), "{err}");
    assert_eq!(
        std::fs::read_to_string(dir.path().join("b.md")).unwrap(),
        "target"
    );
    assert!(dir.path().join("a.md").exists());
    // The same for a directory.
    std::fs::create_dir(dir.path().join("ns")).unwrap();
    std::fs::create_dir(dir.path().join("taken")).unwrap();
    let err = rename_namespace_inner(
        &state,
        &ctx,
        &format!("{root}/ns"),
        &format!("{root}/taken"),
        &root,
    )
    .await
    .unwrap_err();
    assert!(err.contains("already exists"), "{err}");
    assert!(dir.path().join("ns").exists());
}

#[tokio::test]
async fn a_rename_that_would_move_the_note_is_refused_before_anything_changes() {
    // issue 619: a rename respells a note's path references for the folder
    // it is in; a move to another folder is not a rename, and is refused
    // before the note or any referrer is touched. The destination changes
    // the stem too, so a rename that went ahead would respell `[[note]]`.
    // What fails this: removing the parent comparison from
    // `rename_file_with_links_inner` — the note moves to `sub/other.md` and
    // `a.md`'s `[[note]]` is rewritten to `[[other]]`, which the first
    // assertion catches (before the result is looked at).
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-619m", true).await;
    std::fs::create_dir_all(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("note.md"), "text\n").unwrap();
    std::fs::write(dir.path().join("a.md"), "see [[note]]\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/note.md"),
        &format!("{root}/sub/other.md"),
    )
    .await;
    assert_eq!(
        std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
        "see [[note]]\n"
    );
    assert!(dir.path().join("note.md").exists());
    assert!(!dir.path().join("sub/other.md").exists());
    let err = result.unwrap_err();
    // The reason first: the frontend shows it briefly, ahead of the path.
    assert!(
        err.starts_with("a rename keeps the note in its directory as spelled;"),
        "{err}"
    );
}

#[tokio::test]
async fn a_rename_whose_new_path_climbs_back_into_the_folder_is_refused_as_spelled() {
    // `a/../a/new.md` resolves to a file in `a`, the note's own folder, but
    // the respelling writes the new path's components into links: `r.md`'s
    // `[[a/old]]` would become `[[a/../a/new]]`, which names no note. A path
    // with a `..` is refused before anything is read (`plain_absolute`); the
    // same-directory check, which compares the parents as spelled, is pinned
    // by the symlinked-folder test below, which no `..` reaches.
    // What fails this: dropping the `..` refusal and comparing the canonical
    // parents in `stays_in_its_directory` — the rename goes ahead and writes
    // `[[a/../a/new]]`.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-climb", true).await;
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::write(dir.path().join("a/old.md"), "t\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "[[a/old]]\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a/old.md"),
        &format!("{root}/a/../a/new.md"),
    )
    .await;
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "[[a/old]]\n"
    );
    assert!(dir.path().join("a/old.md").exists());
    let err = result.unwrap_err();
    // The reason first: the frontend shows it briefly, ahead of the path.
    assert!(
        err.starts_with("a rename path may not climb with `..`;"),
        "{err}"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn a_rename_through_a_symlinked_folder_is_refused_as_spelled() {
    // `link` is a symlink to `a`, so `link/new.md` resolves into the note's
    // own folder, but the respelling would write `[[link/new]]` — a path key
    // the index never files a note under, since the build does not follow a
    // symlinked folder's entry as a second spelling. The parents are
    // compared as spelled, so this is refused like a move.
    // What fails this: comparing the canonical parents in
    // `stays_in_its_directory` — the rename goes ahead.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-linkdir", true).await;
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::write(dir.path().join("a/old.md"), "t\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "[[a/old]]\n").unwrap();
    std::os::unix::fs::symlink(dir.path().join("a"), dir.path().join("link")).unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a/old.md"),
        &format!("{root}/link/new.md"),
    )
    .await;
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "[[a/old]]\n"
    );
    assert!(dir.path().join("a/old.md").exists());
    let err = result.unwrap_err();
    assert!(
        err.starts_with("a rename keeps the note in its directory as spelled;"),
        "{err}"
    );
}

// Unix only: the referrer is replaced by a symlink.
#[cfg(unix)]
#[tokio::test]
async fn a_referrer_no_registered_context_covers_is_reported() {
    // The index named `r.md`, which then became a symlink to a file outside
    // every registered root: no covering root, so the judgement would see
    // no link in it. `a/old.md` → `a/old.txt` keeps the stem, so an
    // unchanged referrer is otherwise no news (`Unchanged::Ignore`); this
    // one is reported, and the file it points to is untouched.
    // What fails this: removing the empty-covering branch in
    // `rewrite_referrers` — the rewrite sees no covering root, changes
    // nothing, and `Ignore` drops the file silently.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-uncovered", true).await;
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::write(dir.path().join("a/old.md"), "t\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "[[a/old]]\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let other = tempfile::tempdir().unwrap();
    let outside = other.path().join("r.md");
    std::fs::write(&outside, "[[a/old]]\n").unwrap();
    std::fs::remove_file(dir.path().join("r.md")).unwrap();
    std::os::unix::fs::symlink(&outside, dir.path().join("r.md")).unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a/old.md"),
        &format!("{root}/a/old.txt"),
    )
    .await
    .unwrap();
    assert!(dir.path().join("a/old.txt").exists());
    assert_eq!(result.updated_files, Vec::<String>::new());
    assert_eq!(result.skipped_files, vec![format!("{root}/r.md")]);
    assert_eq!(std::fs::read_to_string(&outside).unwrap(), "[[a/old]]\n");
}

/// Whether the file system under `dir` folds case: a `CaseProbe.md` written
/// there is found again as `caseprobe.md`. The probe file is removed.
fn folds_case(dir: &std::path::Path) -> bool {
    let probe = dir.join("CaseProbe.md");
    std::fs::write(&probe, "").unwrap();
    let folds = dir.join("caseprobe.md").exists();
    std::fs::remove_file(&probe).unwrap();
    folds
}

/// The entry names in `dir`, sorted — as the directory spells them, which
/// `Path::exists` cannot tell apart on a file system that folds case.
fn names_in(dir: &std::path::Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    names
}

#[tokio::test]
async fn a_case_only_rename_is_a_rename_of_the_file_itself_where_the_file_system_folds_case() {
    // `Note.md` → `note.md`. Where the file system folds case the two names
    // open one file: the destination is the note itself, so the rename goes
    // ahead, the directory spells the new case, the referrer's `[[Note]]`
    // is respelled, and the index holds the note under the new spelling.
    // Where it keeps case, `note.md` is a name of its own: an existing
    // `note.md` is another note, and the rename is refused as onto any
    // existing file.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-case", true).await;
    let folds = folds_case(dir.path());
    std::fs::write(dir.path().join("Note.md"), "see [[b]]\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "[[Note]]\n").unwrap();
    if !folds {
        std::fs::write(dir.path().join("note.md"), "another\n").unwrap();
    }
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/Note.md"),
        &format!("{root}/note.md"),
    )
    .await;
    if folds {
        // What fails this: refusing any destination that exists
        // (`Path::exists`, as before) — the rename answers "already exists".
        // And registering the note under what the new path resolved to
        // before the move (`resolve_canonical(new_path)` taken ahead of
        // `fs::rename`) — the graph then names `Note.md`.
        let result = result.unwrap();
        assert_eq!(result.updated_files, vec![format!("{root}/r.md")]);
        assert!(
            result.skipped_files.is_empty(),
            "{:?}",
            result.skipped_files
        );
        let names = names_in(dir.path());
        assert!(names.contains(&"note.md".to_string()), "{names:?}");
        assert!(!names.contains(&"Note.md".to_string()), "{names:?}");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
            "[[note]]\n"
        );
        let graph = state
            .with_index(&root, |idx| idx.unwrap().get_link_graph())
            .await;
        assert!(
            graph.nodes.contains(&format!("{root}/note.md")),
            "{graph:?}"
        );
        assert!(
            !graph.nodes.contains(&format!("{root}/Note.md")),
            "{graph:?}"
        );
    } else {
        // What fails this: taking any entry at the destination for the file
        // itself — the rename replaces `note.md`, whose text is lost.
        let err = result.unwrap_err();
        assert!(err.contains("already exists"), "{err}");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("note.md")).unwrap(),
            "another\n"
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("Note.md")).unwrap(),
            "see [[b]]\n"
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
            "[[Note]]\n"
        );
    }
}

#[cfg(unix)]
#[tokio::test]
async fn renaming_a_symlinked_note_keeps_the_index_on_the_notes_target() {
    // `note.md` is a symlink to `real/x.md`. The index knows a note by what
    // its path resolves to — the build never indexes the link, a save files
    // under the target — so the rename files the note under what `new.md`
    // resolves to after the move: `real/x.md`, which stays indexed. Neither
    // the link entry `new.md` nor a `real/new.md` that exists nowhere is.
    // What fails this: filing the `Update` under the new entry
    // (`entry_path(new_path)`) — the graph names `new.md`; and under the old
    // resolved path with the new name (`old_identity.with_file_name`) — the
    // graph names the phantom `real/new.md`.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-symnote", true).await;
    std::fs::create_dir_all(dir.path().join("real")).unwrap();
    std::fs::write(dir.path().join("real/x.md"), "see [[b]]\n").unwrap();
    std::os::unix::fs::symlink("real/x.md", dir.path().join("note.md")).unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/note.md"),
        &format!("{root}/new.md"),
    )
    .await
    .unwrap();
    assert!(std::fs::symlink_metadata(dir.path().join("new.md"))
        .unwrap()
        .file_type()
        .is_symlink());
    assert!(!dir.path().join("real/new.md").exists());
    let graph = state
        .with_index(&root, |idx| idx.unwrap().get_link_graph())
        .await;
    assert!(
        graph.nodes.contains(&format!("{root}/real/x.md")),
        "{graph:?}"
    );
    for phantom in ["new.md", "real/new.md"] {
        assert!(
            !graph.nodes.contains(&format!("{root}/{phantom}")),
            "{phantom}: {graph:?}"
        );
    }
}

#[cfg(unix)]
#[tokio::test]
async fn a_rename_of_a_symlink_outside_every_context_is_refused_though_it_points_inside() {
    // `/outside/Link.md` lies outside every context and points at the
    // vault's `x.md`, so what it resolves to is inside. The rename would act
    // on the outside entry: move it, and — `x.md` links to `[[Link]]` — the
    // note's own rewrite would replace the link with a regular file outside
    // the vault. Both views must be inside, and the entry is not: refused,
    // the link and `x.md` untouched. On a file system that keeps case the
    // destination `link.md` resolves outside too, so the refusal holds on
    // both; the case-only rename on one that folds case is the hole.
    // The old path's entry is judged first, so the refusal names it.
    // What fails this: dropping the old path's entry check
    // (`entry_confined(old_path, ..)`) — the new path's entry, in the same
    // folder, refuses instead and the error names `link.md`; and dropping the
    // entry view from both ends — where the file system folds case the
    // rename answers `Ok` and `/outside/link.md` becomes a regular file
    // holding the note's text.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-outside", true).await;
    std::fs::write(dir.path().join("x.md"), "[[Link]] see [[b]]\n").unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(dir.path().join("x.md"), outside.path().join("Link.md")).unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let out = outside.path().to_str().unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{out}/Link.md"),
        &format!("{out}/link.md"),
    )
    .await;
    assert_eq!(names_in(outside.path()), vec!["Link.md".to_string()]);
    assert!(std::fs::symlink_metadata(outside.path().join("Link.md"))
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("x.md")).unwrap(),
        "[[Link]] see [[b]]\n"
    );
    let err = result.unwrap_err();
    assert_eq!(
        err,
        format!("{out}/Link.md is outside the contexts that hold it")
    );
}

#[cfg(unix)]
#[tokio::test]
async fn a_case_only_rename_of_a_symlinked_note_keeps_the_index_on_the_notes_target() {
    // Where the file system folds case, `Note.md`, a symlink to `real/x.md`,
    // renamed to `note.md` is its own entry in another case: the rename goes
    // ahead and the move respells the link. The index keeps the note under
    // its target `real/x.md` and names none of `note.md`, `Note.md` and a
    // `real/note.md` that exists nowhere. Where the file system keeps case
    // this half has nothing to run: `note.md` is an ordinary new name there,
    // which the other symlink test covers.
    // What fails this: filing the `Update` under the new entry
    // (`entry_path(new_path)`) — the graph names `note.md`.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-symcase", true).await;
    if !folds_case(dir.path()) {
        eprintln!("the file system under {root} keeps case; the case-only half is not run");
        return;
    }
    std::fs::create_dir_all(dir.path().join("real")).unwrap();
    std::fs::write(dir.path().join("real/x.md"), "see [[b]]\n").unwrap();
    std::os::unix::fs::symlink("real/x.md", dir.path().join("Note.md")).unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/Note.md"),
        &format!("{root}/note.md"),
    )
    .await
    .unwrap();
    let names = names_in(dir.path());
    assert!(names.contains(&"note.md".to_string()), "{names:?}");
    let graph = state
        .with_index(&root, |idx| idx.unwrap().get_link_graph())
        .await;
    assert!(
        graph.nodes.contains(&format!("{root}/real/x.md")),
        "{graph:?}"
    );
    for phantom in ["note.md", "Note.md", "real/note.md"] {
        assert!(
            !graph.nodes.contains(&format!("{root}/{phantom}")),
            "{phantom}: {graph:?}"
        );
    }
}

#[cfg(unix)]
#[tokio::test]
async fn renaming_a_symlinked_note_onto_its_targets_name_is_refused_and_the_target_keeps_its_text()
{
    // `note.md` is a symlink to `x.md`. Both resolve to `x.md`, but the
    // destination is `x.md`'s own entry, not the link's: renaming onto it
    // would replace the real note with the link, which would then point at
    // itself. Refused, and `x.md` stays a regular file with its text.
    // What fails this: judging the destination by what it resolves to
    // (`resolve_canonical(new_path) != resolve_canonical(old_path)` in
    // `another_entry_at`) — the rename answers `Ok` and `x.md` becomes a
    // link to itself.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-onto-target", true).await;
    std::fs::write(dir.path().join("x.md"), "the real note\n").unwrap();
    std::os::unix::fs::symlink("x.md", dir.path().join("note.md")).unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/note.md"),
        &format!("{root}/x.md"),
    )
    .await;
    let x = std::fs::symlink_metadata(dir.path().join("x.md")).unwrap();
    assert!(x.file_type().is_file(), "{x:?}");
    assert_eq!(
        std::fs::read_to_string(dir.path().join("x.md")).unwrap(),
        "the real note\n"
    );
    assert!(std::fs::symlink_metadata(dir.path().join("note.md"))
        .unwrap()
        .file_type()
        .is_symlink());
    let err = result.unwrap_err();
    assert!(err.contains("already exists"), "{err}");
}

#[cfg(unix)]
#[tokio::test]
async fn a_rename_onto_a_hard_link_of_the_note_is_refused() {
    // `y.md` is a hard link of `x.md`: the same inode under another name.
    // `rename(2)` between two links of one file does nothing and succeeds,
    // so going ahead would report a rename that never happened. Refused, and
    // both names still hold the note.
    // What fails this: dropping the name comparison from `another_entry_at`
    // (the same inode alone counting as the source's entry) — the rename
    // answers `Ok`.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-hardlink", true).await;
    std::fs::write(dir.path().join("x.md"), "t\n").unwrap();
    std::fs::hard_link(dir.path().join("x.md"), dir.path().join("y.md")).unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/x.md"),
        &format!("{root}/y.md"),
    )
    .await;
    for name in ["x.md", "y.md"] {
        assert_eq!(
            std::fs::read_to_string(dir.path().join(name)).unwrap(),
            "t\n",
            "{name}"
        );
    }
    let err = result.unwrap_err();
    assert!(err.contains("already exists"), "{err}");
}

#[tokio::test]
async fn a_rename_that_spells_the_old_path_in_another_case_removes_the_note_as_indexed() {
    // Where the file system folds case, `NOTE.md` opens the note on disk as
    // `Note.md`. The rename is asked with that spelling, to `note.md`: the
    // index held the note as `Note.md`, so that is what the removal must
    // drop — what the old path resolves to — and the graph then names
    // `note.md` alone. Where the file system keeps case, `NOTE.md` names no
    // note and this half has nothing to run.
    // What fails this: filing the `Remove` under `entry_path(old_path)` —
    // `NOTE.md` as spelled matches nothing in the index, and the graph keeps
    // `Note.md` beside `note.md`.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-oldcase", true).await;
    if !folds_case(dir.path()) {
        eprintln!("the file system under {root} keeps case; the case-folded half is not run");
        return;
    }
    std::fs::write(dir.path().join("Note.md"), "see [[b]]\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "[[Note]]\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/NOTE.md"),
        &format!("{root}/note.md"),
    )
    .await
    .unwrap();
    let graph = state
        .with_index(&root, |idx| idx.unwrap().get_link_graph())
        .await;
    assert!(
        graph.nodes.contains(&format!("{root}/note.md")),
        "{graph:?}"
    );
    assert!(
        !graph.nodes.contains(&format!("{root}/Note.md")),
        "{graph:?}"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn a_rename_onto_a_symlink_to_the_note_itself_is_refused() {
    // `link.md` is a symlink to `old.md`: it resolves to the note, but it is
    // another entry, and renaming onto it would replace the link.
    // What fails this: judging the destination by what it resolves to in
    // `another_entry_at` (its canonical path against the source's) —
    // `link.md` is then the note itself, the rename replaces the link, and
    // `[[old]]` is respelled `[[link]]`.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-link", true).await;
    std::fs::write(dir.path().join("old.md"), "t\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "[[old]]\n").unwrap();
    std::os::unix::fs::symlink("old.md", dir.path().join("link.md")).unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/old.md"),
        &format!("{root}/link.md"),
    )
    .await;
    assert!(std::fs::symlink_metadata(dir.path().join("link.md"))
        .unwrap()
        .file_type()
        .is_symlink());
    assert!(dir.path().join("old.md").exists());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "[[old]]\n"
    );
    let err = result.unwrap_err();
    assert!(err.contains("already exists"), "{err}");
}

#[tokio::test]
async fn both_renames_refuse_a_relative_path_before_anything_changes() {
    // A relative path resolves against the process's working directory. The
    // vault lies under it here, so the relative spelling names the vault's
    // own files and every check after the refusal would read them.
    // What fails this: dropping any one of the three `plain_absolute` refusals —
    // for the file rename's new path, the first call answers the move
    // refusal instead; for its old path, the second does; for the block-ID
    // rename, the third goes ahead with its path reference missed and
    // answers `Ok`.
    let cwd = std::env::current_dir().unwrap();
    // Under the crate's own `target`, created if a custom `CARGO_TARGET_DIR`
    // left it absent: a directory under the working directory, outside the
    // sources, whatever the build layout.
    let base = cwd.join("target");
    std::fs::create_dir_all(&base).unwrap();
    let dir = tempfile::tempdir_in(&base).unwrap();
    let root = dir.path().to_str().unwrap().to_string();
    let rel = dir
        .path()
        .strip_prefix(&cwd)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::write(dir.path().join("a/old.md"), "para ^x\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "[[a/old]]\n((a/old#^x))\n").unwrap();
    let ctx = ContextManager::new();
    ctx.add(info("ctx-rel", &root, ContextType::Folder))
        .await
        .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let calls = [
        rename_file_with_links_inner(
            &state,
            &ctx,
            &format!("{root}/a/old.md"),
            &format!("{rel}/a/new.md"),
        )
        .await,
        rename_file_with_links_inner(
            &state,
            &ctx,
            &format!("{rel}/a/old.md"),
            &format!("{root}/a/new.md"),
        )
        .await,
        rename_block_id_inner(&state, &ctx, &format!("{rel}/a/old.md"), "x", "y").await,
    ];
    for result in calls {
        let err = result.unwrap_err();
        assert!(err.contains("is not an absolute path"), "{err}");
    }
    assert_eq!(
        std::fs::read_to_string(dir.path().join("a/old.md")).unwrap(),
        "para ^x\n"
    );
    assert!(!dir.path().join("a/new.md").exists());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "[[a/old]]\n((a/old#^x))\n"
    );
}

#[tokio::test]
async fn two_notes_of_one_root_folding_to_one_path_keep_the_path_links_both_answer() {
    // On a file system that keeps case, `A/note.md` and `a/note.md` are two
    // notes whose path key is the same `a/note`: `[[A/note]]`, `[[a/note]]`
    // and `((a/note#^x))` name neither alone. Renaming `a/note.md`, or its
    // block, leaves them and reports the file; the bare `[[note]]` is
    // respelled as a stem link always is. Where the file system folds case
    // the two directories are one, and this half has nothing to run: the
    // judgement itself is pinned without a file system by
    // `judgement::tests::a_path_key_two_notes_of_one_root_fold_to_is_ambiguous`.
    // What fails this: the vault is the rename's only holding root, so it is
    // judged through `RootNotes::Sole` — ignoring that branch's collision map
    // in `read_as_another_note` makes `[[A/note]]` and `[[a/note]]` become
    // `[[a/new]]` and `((a/note#^x))` become `((a/note#^y))`, and nothing is
    // reported. (The `n > 1` reading of `Known` does not reach this fixture.)
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-fold", true).await;
    if folds_case(dir.path()) {
        eprintln!("the file system under {root} folds case; the two-directory half is not run");
        return;
    }
    std::fs::create_dir_all(dir.path().join("A")).unwrap();
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::write(dir.path().join("A/note.md"), "para ^x\n").unwrap();
    std::fs::write(dir.path().join("a/note.md"), "para ^x\n").unwrap();
    let text = "[[A/note]]\n[[a/note]]\n((a/note#^x))\n[[note]]\n";
    std::fs::write(dir.path().join("r.md"), text).unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let referrer = format!("{root}/r.md");

    let result = rename_block_id_inner(&state, &ctx, &format!("{root}/a/note.md"), "x", "y")
        .await
        .unwrap();
    assert!(
        result.updated_files.is_empty(),
        "{:?}",
        result.updated_files
    );
    assert_eq!(result.skipped_files, vec![referrer.clone()]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        text
    );

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a/note.md"),
        &format!("{root}/a/new.md"),
    )
    .await
    .unwrap();
    assert_eq!(result.updated_files, vec![referrer.clone()]);
    assert_eq!(result.skipped_files, vec![referrer]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "[[A/note]]\n[[a/note]]\n((a/note#^x))\n[[new]]\n"
    );
}

#[tokio::test]
async fn a_rename_does_not_respell_a_path_link_onto_a_case_variant_of_the_new_name() {
    // Where the file system keeps case, `a/New.md` beside `a/old.md` is
    // another entry, so renaming `a/old.md` to `a/new.md` goes ahead. Both
    // would then fold to `a/new`, and `[[a/old]]` respelled `[[a/new]]`
    // would name neither alone: left, and `r.md` reported. The vault is the
    // rename's only holding root (`RootNotes::Sole`). Where the file system
    // folds case `a/new.md` is `a/New.md` and the rename is refused before
    // any link is judged; that half is not run.
    // What fails this: counting no note under the new name's key
    // (`LinkIndex::path_key_notes` answering 0), or judging only the old
    // text in `RenameTarget::judge` — either way `r.md` becomes `[[a/new]]`
    // and nothing is reported.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-newcase", true).await;
    if folds_case(dir.path()) {
        eprintln!("the file system under {root} folds case; the case-keeping half is not run");
        return;
    }
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::write(dir.path().join("a/old.md"), "t\n").unwrap();
    std::fs::write(dir.path().join("a/New.md"), "other\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "[[a/old]]\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a/old.md"),
        &format!("{root}/a/new.md"),
    )
    .await
    .unwrap();
    assert_eq!(result.skipped_files, vec![format!("{root}/r.md")]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "[[a/old]]\n"
    );
}

#[tokio::test]
async fn a_case_only_rename_respells_a_path_link_to_the_note() {
    // Where the file system folds case, `a/Note.md` renamed to `a/note.md`
    // keeps its path key `a/note`, which the one note — the renamed file —
    // folds to. The respelled `[[a/note]]` reads as the renamed file, not as
    // another note: respelled, nothing reported. Where case is kept the
    // rename is an ordinary new name and this half is not run.
    // What fails this: reading a `Sole` key's count without discounting the
    // renamed file (`n > 0` in `read_as_another_note`) — the link is left
    // and `r.md` reported.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-casepath", true).await;
    if !folds_case(dir.path()) {
        eprintln!("the file system under {root} keeps case; the case-only half is not run");
        return;
    }
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::write(dir.path().join("a/Note.md"), "t\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "[[a/Note]]\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/a/Note.md"),
        &format!("{root}/a/note.md"),
    )
    .await
    .unwrap();
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "[[a/note]]\n"
    );
}

#[tokio::test]
async fn both_renames_refuse_a_path_with_a_parent_component() {
    // `/v/sub/../a/old.md` → `/v/sub/../a/new.md` passes the same-directory
    // check, which compares the parents as spelled, but every path key is
    // lexical too: the file would key as `sub/../a/old` and `r.md`'s
    // `[[a/old]]` would be missed. Both renames refuse such a path before
    // anything changes.
    // What fails this: dropping the `..` refusal from `plain_absolute` — the
    // file rename moves the note and answers `Ok` with `r.md` untouched, and
    // the block-ID rename answers `Ok` with the reference missed.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-dotdot", true).await;
    std::fs::create_dir_all(dir.path().join("a")).unwrap();
    std::fs::create_dir_all(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("a/old.md"), "para ^x\n").unwrap();
    std::fs::write(dir.path().join("r.md"), "[[a/old]]\n((a/old#^x))\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let block =
        rename_block_id_inner(&state, &ctx, &format!("{root}/sub/../a/old.md"), "x", "y").await;
    assert!(block.as_ref().is_err_and(|e| e.contains("..")), "{block:?}");
    let file = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/sub/../a/old.md"),
        &format!("{root}/sub/../a/new.md"),
    )
    .await;
    assert!(file.as_ref().is_err_and(|e| e.contains("..")), "{file:?}");
    assert!(dir.path().join("a/old.md").exists());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "[[a/old]]\n((a/old#^x))\n"
    );
}

/// Where case is kept: a vault aliased `p` holding `files`, indexed, and the
/// text `r.md` holds after `old` is renamed to `new` under it, with the
/// files the rename reported (relative to the vault). None where the file
/// system folds case.
async fn rename_beside_a_case_variant_behind_an_alias(
    files: &[(&str, &str)],
    old: &str,
    new: &str,
) -> Option<(String, Vec<String>)> {
    let dir = tempfile::tempdir().unwrap();
    if folds_case(dir.path()) {
        return None;
    }
    let ctx = ContextManager::new();
    let (dir, root) = aliased_vault(&ctx, "ctx-aliascase", "p", files).await;
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &format!("{root}/{old}"),
        &format!("{root}/{new}"),
    )
    .await
    .unwrap();
    let skipped = result
        .skipped_files
        .iter()
        .map(|f| f.strip_prefix(&format!("{root}/")).unwrap_or(f).to_string())
        .collect();
    Some((
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        skipped,
    ))
}

#[tokio::test]
async fn a_path_link_behind_an_alias_is_judged_for_case_variants_as_one_without() {
    // Where case is kept, `[[p::A/old]]` behind the vault's own alias folds
    // to `a/old` as `[[A/old]]` does. With `A/old.md` and `a/old.md` both
    // there it names neither alone, and with `a/New.md` beside the new
    // `a/new.md` the respelled `[[p::a/new]]` would name neither: in both
    // cases the alias link is left and `r.md` reported, as the bare path
    // link beside it is. Where case folds this is not run.
    // What fails this: judging a link behind a local alias without the
    // alias root's note counts (`RenameTarget::judge`'s alias branch) — the
    // alias link is respelled while the one beside it stays; or reading the
    // old key alone (`alias_root_reads_another_note`) — the second case.
    let Some(old_key) = rename_beside_a_case_variant_behind_an_alias(
        &[
            ("A/old.md", "t\n"),
            ("a/old.md", "u\n"),
            ("r.md", "[[p::A/old]]\n[[A/old]]\n"),
        ],
        "A/old.md",
        "A/new.md",
    )
    .await
    else {
        eprintln!("the file system folds case; the case-keeping half is not run");
        return;
    };
    assert_eq!(
        old_key,
        (
            "[[p::A/old]]\n[[A/old]]\n".to_string(),
            vec!["r.md".to_string()]
        )
    );
    let new_key = rename_beside_a_case_variant_behind_an_alias(
        &[
            ("a/old.md", "t\n"),
            ("a/New.md", "u\n"),
            ("r.md", "[[p::a/old]]\n[[a/old]]\n"),
        ],
        "a/old.md",
        "a/new.md",
    )
    .await
    .unwrap();
    assert_eq!(
        new_key,
        (
            "[[p::a/old]]\n[[a/old]]\n".to_string(),
            vec!["r.md".to_string()]
        )
    );
}
