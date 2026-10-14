use super::*;
use serde_json::json;

const LINKS: &[(&str, &str)] = &[
    ("a.md", "see [[b]]\n"),
    ("z.md", "[[b]]\n((b#^blk))\n"),
    ("b.md", "target ^blk\n"),
];

/// D6 · spec §4: sandboxed rows are `/`-relative to the context root, trusted ones absolute in
/// the root spelling the read used — otherwise the same rows. Also (path, line) order, lines
/// from 1, the trimmed line (cut at 200 bytes) as `snippet`, and `blockId` present as `null` for a wikilink. What
/// fails this: a row path written past `PathForm::write`, a `skip_serializing_if` on an
/// `Option`, or the backlink's line text named `context` (D5).
#[tokio::test]
async fn backlink_rows_are_written_in_the_tiers_form() {
    let ctx = ContextManager::new();
    let (dir, root) = context_with(&ctx, "c", LINKS).await;
    let state = LinkIndexState::new();
    let b = || Checked::Backlinks {
        path: arg(&dir, "b.md"),
    };

    let relative = run(
        &state,
        &ctx,
        &scope(&ctx, "c", PathForm::Relative).await,
        b(),
    )
    .await
    .unwrap();
    let absolute = run(
        &state,
        &ctx,
        &scope(&ctx, "c", PathForm::Absolute).await,
        b(),
    )
    .await
    .unwrap();

    assert_eq!(
        relative,
        json!([
            { "blockId": null, "line": 1, "path": "a.md", "snippet": "see [[b]]", "type": "wikilink" },
            { "blockId": null, "line": 1, "path": "z.md", "snippet": "[[b]]", "type": "wikilink" },
            { "blockId": "blk", "line": 2, "path": "z.md", "snippet": "((b#^blk))", "type": "blockRef" },
        ])
    );
    assert_eq!(absolute[0]["path"], json!(format!("{root}/a.md")));
    assert_eq!(absolute[2]["path"], json!(format!("{root}/z.md")));
}

/// Each resolution's fields: `path` only when resolved — a non-note target too (§278) — and
/// `vault` only for another vault's alias, the rest `null`, in line order. What fails this: a
/// row that leaves out a `null` field, or a resolved path not written by `PathForm::write`.
#[tokio::test]
async fn link_rows_carry_each_resolution() {
    let ctx = ContextManager::new();
    let (dir, _root) = context_with(
        &ctx,
        "c",
        &[
            (
                "a.md",
                "see [[b]]\n[[missing]]\n[[journal::x]]\n[[paper.pdf]]\n",
            ),
            ("b.md", "target\n"),
            ("paper.pdf", "%PDF"),
        ],
    )
    .await;
    let state = LinkIndexState::new();

    let rows = run(
        &state,
        &ctx,
        &scope(&ctx, "c", PathForm::Relative).await,
        Checked::Links {
            path: arg(&dir, "a.md"),
        },
    )
    .await
    .unwrap();

    assert_eq!(
        rows,
        json!([
            { "blockId": null, "line": 1, "path": "b.md", "resolution": "resolved", "target": "b", "type": "wikilink", "vault": null },
            { "blockId": null, "line": 2, "path": null, "resolution": "unresolved", "target": "missing", "type": "wikilink", "vault": null },
            { "blockId": null, "line": 3, "path": null, "resolution": "otherVault", "target": "x", "type": "wikilink", "vault": "journal" },
            { "blockId": null, "line": 4, "path": "paper.pdf", "resolution": "resolved", "target": "paper.pdf", "type": "wikilink", "vault": null },
        ])
    );
}

/// D18 at this layer: under a context registered through a symlink, link rows are written
/// against the index's own root (`Spelled::root`). What fails this: writing them against the
/// canonical root or `ctx.info.path` resolved — `strip_prefix` misses and the read is refused.
#[cfg(unix)]
#[tokio::test]
async fn link_rows_under_a_symlinked_root_use_the_index_spelling() {
    let ctx = ContextManager::new();
    let real = tempfile::tempdir().unwrap();
    std::fs::write(real.path().join("a.md"), "see [[b]]\n").unwrap();
    std::fs::write(real.path().join("b.md"), "b\n").unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let link = elsewhere.path().join("link");
    std::os::unix::fs::symlink(real.path(), &link).unwrap();
    let root = link.to_str().unwrap().to_string();
    ctx.add(folder("l", &root)).await.unwrap();
    let state = LinkIndexState::new();
    let b = || Checked::Backlinks {
        path: PathArg {
            given: "b.md".into(),
            canonical: real.path().join("b.md").canonicalize().unwrap(),
        },
    };

    let relative = run(
        &state,
        &ctx,
        &scope(&ctx, "l", PathForm::Relative).await,
        b(),
    )
    .await
    .unwrap();
    let absolute = run(
        &state,
        &ctx,
        &scope(&ctx, "l", PathForm::Absolute).await,
        b(),
    )
    .await
    .unwrap();

    assert_eq!(relative[0]["path"], json!("a.md"));
    assert_eq!(absolute[0]["path"], json!(format!("{root}/a.md")));
}

const TAGGED: &[(&str, &str)] = &[
    ("t.md", "---\ntags: [work]\n---\nbody\n"),
    ("notes/c.md", "#Work #home\n"),
];

/// Tags by count descending, then name; a front-matter tag and an inline one count alike,
/// lowercased (`tag::get_vault_tags`). What fails this: re-sorting the walk's order.
#[tokio::test]
async fn tag_rows_come_by_count_then_name() {
    let ctx = ContextManager::new();
    let (_dir, _root) = context_with(&ctx, "c", TAGGED).await;
    let state = LinkIndexState::new();

    let rows = run(
        &state,
        &ctx,
        &scope(&ctx, "c", PathForm::Relative).await,
        Checked::Tags,
    )
    .await
    .unwrap();

    assert_eq!(
        rows,
        json!([{ "count": 2, "tag": "work" }, { "count": 1, "tag": "home" }])
    );
}

/// A leading `#` is dropped and case is not compared; a nested note's path takes `/`; path
/// order; trusted rows absolute. What fails this: passing `#WORK` to `get_files_by_tag` as
/// typed (it matches nothing), or the root-relative OS paths not passing `PathForm::write`.
#[tokio::test]
async fn notes_with_a_tag_come_in_path_order() {
    let ctx = ContextManager::new();
    let (_dir, root) = context_with(&ctx, "c", TAGGED).await;
    let state = LinkIndexState::new();
    let read = || Checked::NotesWithTag {
        tag: "#WORK".into(),
    };

    let relative = run(
        &state,
        &ctx,
        &scope(&ctx, "c", PathForm::Relative).await,
        read(),
    )
    .await
    .unwrap();
    let absolute = run(
        &state,
        &ctx,
        &scope(&ctx, "c", PathForm::Absolute).await,
        read(),
    )
    .await
    .unwrap();

    assert_eq!(relative, json!(["notes/c.md", "t.md"]));
    assert_eq!(
        absolute,
        json!([format!("{root}/notes/c.md"), format!("{root}/t.md")])
    );
}

const TASKS: &[(&str, &str)] = &[
    (
        "t.md",
        "---\ntags: [x]\n---\n- [ ] first\n- [x] second\n- [/] third\n- [-] fourth\n",
    ),
    ("archive/old.md", "- [ ] archived\n"),
];

/// Lines count from 1 through front matter (the task index counts from 0); `open` is todo and
/// doing; `exclude` leaves its folders out — for one `file` too; (path, line) order; every
/// field present. What fails this: the `+ 1` dropped, `exclude` not handed to the walk, or the
/// status filter skipped.
#[tokio::test]
async fn task_rows_count_lines_from_one_and_leave_out_excluded_folders() {
    let ctx = ContextManager::new();
    let (dir, _root) = context_with(&ctx, "c", TASKS).await;
    let state = LinkIndexState::new();
    let s = scope(&ctx, "c", PathForm::Relative).await;
    let tasks = |exclude: &[&str], file: Option<PathArg>, status| Checked::Tasks {
        exclude: exclude.iter().map(|e| e.to_string()).collect(),
        file,
        status,
    };

    let open = run(
        &state,
        &ctx,
        &s,
        tasks(&["archive"], None, TaskStatus::Open),
    )
    .await
    .unwrap();
    let all = run(&state, &ctx, &s, tasks(&[], None, TaskStatus::All))
        .await
        .unwrap();
    let one_file = run(
        &state,
        &ctx,
        &s,
        tasks(&[], Some(arg(&dir, "t.md")), TaskStatus::All),
    )
    .await
    .unwrap();
    let excluded_file = run(
        &state,
        &ctx,
        &s,
        tasks(
            &["archive"],
            Some(arg(&dir, "archive/old.md")),
            TaskStatus::All,
        ),
    )
    .await
    .unwrap();

    assert_eq!(
        open[0],
        json!({
            "cancelled": null, "created": null, "done": null, "due": null, "line": 4, "links": [],
            "path": "t.md", "priority": 0, "recurrence": null, "scheduled": null, "start": null,
            "state": "todo", "tags": [], "text": "first"
        })
    );
    let lines = |rows: &serde_json::Value| -> Vec<(String, u64)> {
        rows.as_array()
            .unwrap()
            .iter()
            .map(|r| {
                (
                    r["path"].as_str().unwrap().to_string(),
                    r["line"].as_u64().unwrap(),
                )
            })
            .collect()
    };
    assert_eq!(
        lines(&open),
        [("t.md".to_string(), 4), ("t.md".to_string(), 6)]
    );
    assert_eq!(
        lines(&all),
        [
            ("archive/old.md".to_string(), 1),
            ("t.md".to_string(), 4),
            ("t.md".to_string(), 5),
            ("t.md".to_string(), 6),
            ("t.md".to_string(), 7),
        ]
    );
    assert_eq!(lines(&one_file).len(), 4);
    assert_eq!(excluded_file, json!([]));
}

const SEARCHED: &[(&str, &str)] = &[
    ("docs/n.md", "needle and needle\n"),
    ("docs-old/n.md", "needle\n"),
    ("top.md", "needle\n"),
];

/// Spec D10: `limit` counts matches and `truncated` says more were found; two matches on one
/// line are two rows; `folder` moves the root, so `docs` does not take `docs-old/`. What fails
/// this: `folder` passed as `include_glob` (a string prefix — `docs-old/n.md` would come back),
/// `max_results` without the `+ 1` (`truncated` never true), or rows merged by line.
#[tokio::test]
async fn search_counts_matches_and_moves_the_root_for_a_folder() {
    let ctx = ContextManager::new();
    let (dir, _root) = context_with(&ctx, "c", SEARCHED).await;
    let state = LinkIndexState::new();
    let s = scope(&ctx, "c", PathForm::Relative).await;
    let search = |limit: u32, folder: Option<PathArg>| Checked::Search {
        folder,
        options: SearchArgs {
            limit: Some(limit),
            ..SearchArgs::default()
        },
        query: "needle".into(),
    };

    let in_docs = run(&state, &ctx, &s, search(200, Some(arg(&dir, "docs"))))
        .await
        .unwrap();
    let cut = run(&state, &ctx, &s, search(2, None)).await.unwrap();
    let whole = run(&state, &ctx, &s, search(4, None)).await.unwrap();

    assert_eq!(
        in_docs,
        json!({ "items": [
            { "line": 1, "path": "docs/n.md", "snippet": "needle and needle" },
            { "line": 1, "path": "docs/n.md", "snippet": "needle and needle" },
        ], "truncated": false })
    );
    assert_eq!(
        cut,
        json!({ "items": [
            { "line": 1, "path": "docs-old/n.md", "snippet": "needle" },
            { "line": 1, "path": "docs/n.md", "snippet": "needle and needle" },
        ], "truncated": true })
    );
    assert_eq!(whole["items"].as_array().unwrap().len(), 4);
    assert_eq!(whole["truncated"], json!(false));
}
