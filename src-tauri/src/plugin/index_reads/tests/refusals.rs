use super::*;

async fn refusal(
    state: &LinkIndexState,
    ctx: &ContextManager,
    scope: &Scope,
    read: Checked,
) -> String {
    run(state, ctx, scope, read).await.unwrap_err()
}

/// D17 · spec §7: a scope is refused naming only the id the caller sent. What fails this:
/// echoing the registration (its path), or anchoring a File context. The pair: the folder
/// answers by id, and as the active one.
#[tokio::test]
async fn a_scope_is_refused_by_the_callers_id_alone() {
    let ctx = ContextManager::new();
    let (dir, root) = context_with(&ctx, "c", &[("a.md", "x\n")]).await;
    let file = dir.path().join("a.md");
    ctx.add(ContextInfo {
        context_type: ContextType::File,
        ..folder("f", file.to_str().unwrap())
    })
    .await
    .unwrap();

    assert_eq!(
        resolve_scope(&ctx, None).await.unwrap_err(),
        "no context is open"
    );
    assert_eq!(
        resolve_scope(&ctx, Some("nope".into())).await.unwrap_err(),
        "unknown context \"nope\""
    );
    let single = resolve_scope(&ctx, Some("f".into())).await.unwrap_err();
    assert_eq!(single, "context \"f\" is a single file, which has no index");
    assert!(!single.contains(&root));
    ctx.set_active("c").await.unwrap();
    assert_eq!(resolve_scope(&ctx, None).await.unwrap().info.id, "c");
}

/// D17 · spec §8 (B): a walk that fails on a folder it cannot read — `FsError::ReadDir`,
/// flattened to a string by `tag`, `task` and the link index — reaches the plugin as a fixed
/// message with no spelling of the root in it. What fails this: `walk_failure` or
/// `link_index_failure` handing on the error underneath. The pair: the same failure called
/// directly does name the root, so the message is being replaced, not merely absent. It asserts
/// that the locked folder cannot be read — run as root, the permission does not bite and the
/// test fails rather than passing without a failure to observe.
#[cfg(unix)]
#[tokio::test]
async fn an_unreadable_folder_fails_every_walk_without_naming_the_root() {
    use std::os::unix::fs::PermissionsExt;
    let ctx = ContextManager::new();
    let (dir, root) = context_with(
        &ctx,
        "c",
        &[
            ("a.md", "see [[b]] #t\n- [ ] x\n"),
            ("b.md", "b\n"),
            ("locked/x.md", "x\n"),
        ],
    )
    .await;
    let canonical_root = dir
        .path()
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let locked = dir.path().join("locked");
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
    let readable = std::fs::read_dir(&locked).is_ok();
    let state = LinkIndexState::new();
    let s = scope(&ctx, "c", PathForm::Relative).await;
    let reads = [
        (Checked::Tags, WALK_FAILED),
        (Checked::NotesWithTag { tag: "t".into() }, WALK_FAILED),
        (
            Checked::Tasks {
                exclude: Vec::new(),
                file: None,
                status: TaskStatus::All,
            },
            WALK_FAILED,
        ),
        (
            Checked::Backlinks {
                path: arg(&dir, "b.md"),
            },
            LINK_INDEX_FAILED,
        ),
        (
            Checked::Links {
                path: arg(&dir, "a.md"),
            },
            LINK_INDEX_FAILED,
        ),
    ];
    let mut answers = Vec::new();
    for (read, expected) in reads {
        answers.push((run(&state, &ctx, &s, read).await, expected));
    }
    let direct = crate::tag::get_vault_tags(&root)
        .await
        .map(drop)
        .map_err(|e| e.to_string());
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();

    assert!(
        !readable,
        "mode 0o000 must make the folder unreadable (run as root, it does not)"
    );
    for (answer, expected) in answers {
        let answer = answer.unwrap_err();
        assert_eq!(answer, expected);
        assert!(
            !answer.contains(&root) && !answer.contains(&canonical_root),
            "{answer}"
        );
    }
    let direct = direct.unwrap_err();
    assert!(
        direct.contains(&root),
        "the walk's own error names the root: {direct}"
    );
}

/// The search walk's own failure — "Root path is not a directory: …" from `search_files` —
/// names the root; here it is the fixed message. A vault deleted under its registration is
/// that failure. What fails this: `walk_failure` handing on the error underneath. The pair:
/// `search_files` called directly says the root.
#[tokio::test]
async fn a_vault_that_went_away_fails_the_search_without_naming_the_root() {
    let ctx = ContextManager::new();
    let (dir, root) = context_with(&ctx, "c", &[("a.md", "needle\n")]).await;
    let s = scope(&ctx, "c", PathForm::Relative).await;
    let state = LinkIndexState::new();
    drop(dir);

    let direct =
        crate::search::search_files(&root, "needle", &crate::search::SearchOptions::default())
            .await
            .unwrap_err();
    let answer = refusal(
        &state,
        &ctx,
        &s,
        Checked::Search {
            folder: None,
            options: SearchArgs::default(),
            query: "needle".into(),
        },
    )
    .await;

    assert_eq!(answer, WALK_FAILED);
    assert!(!answer.contains(&root));
    assert!(direct.contains(&root), "{direct}");
}

/// Spec §7: a folder is not a note; `links` and a task `file` need a note that exists where
/// the walk goes; a search `folder` must be a folder the walk enters; every path must be under
/// the scope's root (P12). Each refusal repeats the caller's path only. What fails this: a path
/// outside the root let through by `below_root`, or one of the questions `note_below_root` and
/// `folder_below_root` ask left out. The pair: `backlinks` takes a note that does not exist yet
/// and answers with the links to it.
#[tokio::test]
async fn path_arguments_are_refused_by_what_they_name() {
    let ctx = ContextManager::new();
    let (dir, _root) = context_with(
        &ctx,
        "c",
        &[
            ("a.md", "see [[new]]\n"),
            ("docs/n.md", "x\n"),
            ("paper.pdf", "%PDF"),
            (".hidden/h.md", "- [ ] h\n"),
            ("node_modules/m.md", "x\n"),
        ],
    )
    .await;
    let (other, _) = context_with(&ctx, "other", &[("o.md", "x\n")]).await;
    let state = LinkIndexState::new();
    let s = scope(&ctx, "c", PathForm::Relative).await;
    let folder_search = |folder: PathArg| Checked::Search {
        folder: Some(folder),
        options: SearchArgs::default(),
        query: "x".into(),
    };
    let task_file = |file: PathArg| Checked::Tasks {
        exclude: Vec::new(),
        file: Some(file),
        status: TaskStatus::All,
    };

    for (read, expected) in [
        (
            Checked::Backlinks {
                path: arg(&dir, "docs"),
            },
            "\"docs\" is a folder, not a note",
        ),
        (
            Checked::Links {
                path: arg(&dir, "docs"),
            },
            "\"docs\" is a folder, not a note",
        ),
        (
            Checked::Links {
                path: arg(&dir, "gone.md"),
            },
            "no note at \"gone.md\"",
        ),
        (
            Checked::Links {
                path: arg(&dir, "paper.pdf"),
            },
            "\"paper.pdf\" is not a note",
        ),
        (
            task_file(arg(&dir, ".hidden/h.md")),
            "\".hidden/h.md\" is where the vault walk does not go",
        ),
        (
            folder_search(arg(&dir, "node_modules")),
            "\"node_modules\" is a folder the vault walk skips",
        ),
        (
            folder_search(arg(&dir, "a.md")),
            "\"a.md\" is a file, not a folder",
        ),
        (folder_search(arg(&dir, "gone")), "no folder at \"gone\""),
        (
            Checked::Backlinks {
                path: arg(&other, "o.md"),
            },
            "path \"o.md\" is not inside context \"c\"",
        ),
    ] {
        assert_eq!(refusal(&state, &ctx, &s, read).await, expected);
    }
    let fresh = run(
        &state,
        &ctx,
        &s,
        Checked::Backlinks {
            path: arg(&dir, "new.md"),
        },
    )
    .await
    .unwrap();
    assert_eq!(fresh[0]["path"], serde_json::json!("a.md"));
}

/// Spec §7: value arguments are checked as values and named in the refusal; a regex refusal
/// carries the compiler's reason. What fails this: a missing range check (`limit: 0` would
/// search for one match plus one). The pair: the limits' own edges, 1 and 1000, are
/// accepted.
#[tokio::test]
async fn value_arguments_are_refused_by_name() {
    let ctx = ContextManager::new();
    let (_dir, _root) = context_with(&ctx, "c", &[("a.md", "needle\n")]).await;
    let state = LinkIndexState::new();
    let s = scope(&ctx, "c", PathForm::Relative).await;
    let search = |query: &str, regex: bool, limit: Option<u32>| Checked::Search {
        folder: None,
        options: SearchArgs {
            limit,
            regex,
            ..SearchArgs::default()
        },
        query: query.into(),
    };

    assert_eq!(
        refusal(&state, &ctx, &s, search("", false, None)).await,
        "\"query\" is empty"
    );
    assert!(refusal(&state, &ctx, &s, search("(", true, None))
        .await
        .starts_with("\"query\" is not a valid regular expression: "));
    assert_eq!(
        refusal(&state, &ctx, &s, search("x", false, Some(0))).await,
        "\"limit\" must be between 1 and 1000, not 0"
    );
    assert_eq!(
        refusal(&state, &ctx, &s, search("x", false, Some(1001))).await,
        "\"limit\" must be between 1 and 1000, not 1001"
    );
    assert_eq!(
        refusal(&state, &ctx, &s, Checked::NotesWithTag { tag: "#".into() }).await,
        "\"tag\" is empty"
    );
    assert!(run(&state, &ctx, &s, search("needle", false, Some(1)))
        .await
        .is_ok());
    assert!(run(&state, &ctx, &s, search("needle", false, Some(1000)))
        .await
        .is_ok());
}
