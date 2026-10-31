//! A PDF rename carries the PDF's highlight files along (`rename/pdf_highlights.rs`).

use super::attachments::at;
use super::*;

/// The vault every test here starts from: `a.md` → `b.md` (`vault_with_a_link`), the PDF
/// `papers/Paper.pdf` (bytes that are not UTF-8), and `files` (path under the vault, text).
async fn vault_with_a_pdf(
    ctx: &ContextManager,
    files: &[(&str, &str)],
) -> (tempfile::TempDir, String, LinkIndexState) {
    let (dir, root) = vault_with_a_link(ctx, "ctx-pdf-highlights", true).await;
    for (path, text) in files {
        let path = dir.path().join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
    std::fs::create_dir_all(dir.path().join("papers")).unwrap();
    std::fs::write(
        dir.path().join("papers/Paper.pdf"),
        b"%PDF-1.4\n\xff\xfe\x00\n",
    )
    .unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, ctx, &root).await.unwrap();
    (dir, root, state)
}

const SIDECAR: &str = r#"{
  "companion": "highlights/papers/Paper.md",
  "extra": "kept",
  "highlights": [
    {
      "color": "yellow",
      "id": "h1",
      "kind": "text",
      "page": 1,
      "rects": [{ "h": 1, "w": 2, "x": 3, "y": 4 }]
    }
  ],
  "pdf": "papers/Paper.pdf",
  "version": 1
}
"#;

#[tokio::test]
async fn a_pdf_rename_moves_its_sidecar_and_renames_its_highlight_note() {
    // The viewer finds a PDF's highlights by the PDF's path: the sidecar
    // `.baram/pdf-highlights/papers/Paper.json` and the note
    // `highlights/papers/Paper.md`. They follow the PDF: the sidecar moves and
    // names the new PDF and note, and the note is renamed as a note, so
    // `[[Paper]]` — the note's link, not the PDF's — and the block reference
    // into it follow too.
    // What fails this: not calling `carry_pdf_highlights` from
    // `rename_file_with_links_inner` — the sidecar and the note stay under the
    // old name and the viewer shows no highlights for `Survey.pdf`.
    let ctx = ContextManager::new();
    let (dir, root, state) = vault_with_a_pdf(
        &ctx,
        &[
            (".baram/pdf-highlights/papers/Paper.json", SIDECAR),
            ("highlights/papers/Paper.md", "quoted ^h1\n"),
            (
                "r.md",
                "[[Paper]]\n((highlights/papers/Paper#^h1))\n[[Paper.pdf]]\n",
            ),
        ],
    )
    .await;

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &at(&root, &["papers", "Paper.pdf"]),
        &at(&root, &["papers", "Survey.pdf"]),
    )
    .await
    .unwrap();
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(result.updated_files, vec![at(&root, &["r.md"])]);
    // Each file moved besides the PDF is named, so an open tab can follow it.
    let moved = |from: &[&str], to: &[&str]| MovedFile {
        from: at(&root, from),
        to: at(&root, to),
    };
    assert_eq!(
        result.moved,
        vec![
            moved(
                &["highlights", "papers", "Paper.md"],
                &["highlights", "papers", "Survey.md"]
            ),
            moved(
                &[".baram", "pdf-highlights", "papers", "Paper.json"],
                &[".baram", "pdf-highlights", "papers", "Survey.json"]
            ),
        ]
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "[[Survey]]\n((highlights/papers/Survey#^h1))\n[[Survey.pdf]]\n"
    );
    assert!(!dir.path().join("highlights/papers/Paper.md").exists());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("highlights/papers/Survey.md")).unwrap(),
        "quoted ^h1\n"
    );
    assert!(!dir
        .path()
        .join(".baram/pdf-highlights/papers/Paper.json")
        .exists());
    let sidecar: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(dir.path().join(".baram/pdf-highlights/papers/Survey.json"))
            .unwrap(),
    )
    .unwrap();
    let before: serde_json::Value = serde_json::from_str(SIDECAR).unwrap();
    assert_eq!(sidecar["pdf"], "papers/Survey.pdf");
    assert_eq!(sidecar["companion"], "highlights/papers/Survey.md");
    assert_eq!(sidecar["highlights"], before["highlights"]);
    assert_eq!(sidecar["extra"], "kept");
    // The note's block is a backlink of its new name.
    let survey_note = at(&root, &["highlights", "papers", "Survey.md"]);
    assert_eq!(
        backlink_lines(&state, &ctx, &survey_note, &at(&root, &["r.md"])).await,
        vec![1, 2]
    );
}

/// The sidecar at `path` under the vault in `dir`, read as JSON.
fn sidecar_at(dir: &tempfile::TempDir, path: &str) -> serde_json::Value {
    serde_json::from_str(&std::fs::read_to_string(dir.path().join(path)).unwrap()).unwrap()
}

#[tokio::test]
async fn a_highlight_file_whose_new_name_is_taken_stays_and_is_reported() {
    // Another file already holds each new name: neither highlight file is
    // moved over it, the PDF itself still moves, and the result names both
    // files that kept the old name — the note's link still names it. When
    // only the note's new name is taken, the sidecar moves and names the new
    // PDF, but still the note under its old name, where the quotes are.
    // What fails this: moving the sidecar without `another_entry_at` — the
    // taken sidecar is replaced; naming the new note in the sidecar whatever
    // became of the note — it names a note that is someone else's. (The
    // note's own rename refuses a taken name too, so the check in
    // `carry_companion` only spares it the attempt.)
    let ctx = ContextManager::new();
    let (dir, root, state) = vault_with_a_pdf(
        &ctx,
        &[
            (".baram/pdf-highlights/papers/Paper.json", SIDECAR),
            (".baram/pdf-highlights/papers/Survey.json", "{}\n"),
            ("highlights/papers/Paper.md", "quoted ^h1\n"),
            ("highlights/papers/Survey.md", "another\n"),
            ("r.md", "[[Paper]]\n"),
        ],
    )
    .await;
    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &at(&root, &["papers", "Paper.pdf"]),
        &at(&root, &["papers", "Survey.pdf"]),
    )
    .await
    .unwrap();
    assert!(dir.path().join("papers/Survey.pdf").exists());
    let mut skipped = result.skipped_files.clone();
    skipped.sort();
    let mut expected = vec![
        at(&root, &["highlights", "papers", "Paper.md"]),
        at(&root, &[".baram", "pdf-highlights", "papers", "Paper.json"]),
    ];
    expected.sort();
    assert_eq!(skipped, expected);
    assert!(result.moved.is_empty(), "{:?}", result.moved);
    assert_eq!(
        std::fs::read_to_string(dir.path().join(".baram/pdf-highlights/papers/Survey.json"))
            .unwrap(),
        "{}\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join(".baram/pdf-highlights/papers/Paper.json"))
            .unwrap(),
        SIDECAR
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("highlights/papers/Survey.md")).unwrap(),
        "another\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "[[Paper]]\n"
    );

    let ctx = ContextManager::new();
    let (dir, root, state) = vault_with_a_pdf(
        &ctx,
        &[
            (".baram/pdf-highlights/papers/Paper.json", SIDECAR),
            ("highlights/papers/Paper.md", "quoted ^h1\n"),
            ("highlights/papers/Survey.md", "another\n"),
        ],
    )
    .await;
    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &at(&root, &["papers", "Paper.pdf"]),
        &at(&root, &["papers", "Survey.pdf"]),
    )
    .await
    .unwrap();
    assert_eq!(
        result.skipped_files,
        vec![at(&root, &["highlights", "papers", "Paper.md"])]
    );
    assert_eq!(
        result.moved,
        vec![MovedFile {
            from: at(&root, &[".baram", "pdf-highlights", "papers", "Paper.json"]),
            to: at(
                &root,
                &[".baram", "pdf-highlights", "papers", "Survey.json"]
            ),
        }]
    );
    let sidecar = sidecar_at(&dir, ".baram/pdf-highlights/papers/Survey.json");
    assert_eq!(sidecar["pdf"], "papers/Survey.pdf");
    assert_eq!(sidecar["companion"], "highlights/papers/Paper.md");
}

#[tokio::test]
async fn a_pdf_renamed_to_a_name_that_is_no_pdf_leaves_its_highlights_and_reports_them() {
    // `Paper.pdf` → `Paper.bin`: the viewer opens no such file, so no
    // highlight file is named after it; both stay, and both are reported.
    // What fails this: dropping the report of a piece whose new name is no
    // PDF's — the result is empty, and the highlights look carried.
    let ctx = ContextManager::new();
    let (dir, root, state) = vault_with_a_pdf(
        &ctx,
        &[
            (".baram/pdf-highlights/papers/Paper.json", SIDECAR),
            ("highlights/papers/Paper.md", "quoted ^h1\n"),
        ],
    )
    .await;
    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &at(&root, &["papers", "Paper.pdf"]),
        &at(&root, &["papers", "Paper.bin"]),
    )
    .await
    .unwrap();
    let mut skipped = result.skipped_files.clone();
    skipped.sort();
    let mut expected = vec![
        at(&root, &["highlights", "papers", "Paper.md"]),
        at(&root, &[".baram", "pdf-highlights", "papers", "Paper.json"]),
    ];
    expected.sort();
    assert_eq!(skipped, expected);
    assert!(dir.path().join("highlights/papers/Paper.md").exists());
}

#[tokio::test]
async fn a_pdf_with_some_highlight_files_or_none_carries_what_it_has() {
    // A sidecar with no note yet (area highlights only) moves and names the
    // note a text highlight will now be written to, the new one. A PDF with
    // neither reports nothing and creates nothing.
    // What fails this: leaving the sidecar's `companion` record when there
    // was no note to move — a text highlight made after the rename is
    // written to the new note, and its references look in the old one.
    let ctx = ContextManager::new();
    let (dir, root, state) = vault_with_a_pdf(
        &ctx,
        &[(".baram/pdf-highlights/papers/Paper.json", SIDECAR)],
    )
    .await;
    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &at(&root, &["papers", "Paper.pdf"]),
        &at(&root, &["papers", "Survey.pdf"]),
    )
    .await
    .unwrap();
    assert!(result.skipped_files.is_empty(), "{result:?}");
    let sidecar = sidecar_at(&dir, ".baram/pdf-highlights/papers/Survey.json");
    assert_eq!(sidecar["companion"], "highlights/papers/Survey.md");
    assert!(!dir.path().join("highlights").exists());

    let ctx = ContextManager::new();
    let (dir, root, state) = vault_with_a_pdf(&ctx, &[]).await;
    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &at(&root, &["papers", "Paper.pdf"]),
        &at(&root, &["papers", "Survey.pdf"]),
    )
    .await
    .unwrap();
    assert!(result.skipped_files.is_empty(), "{result:?}");
    assert!(!dir.path().join(".baram").exists());
    assert!(!dir.path().join("highlights").exists());
}

#[tokio::test]
async fn an_escaped_highlight_reference_is_a_backlink_of_its_note_and_follows_the_rename() {
    // The frontend writes a highlight reference with the target's `)`, `#`,
    // `|` and `%` escaped (§275.4): `((highlights/papers/BERT (2019%29#^h1))`.
    // The index reads it as the note `highlights/papers/BERT (2019).md`, so
    // it is that note's backlink, and when the PDF's rename carries the note
    // along, the reference is respelled — escaped again where the new name
    // needs it.
    // What fails this: the extractor reading a block reference's target as
    // written — the note has no backlink, the reference is left pointing at
    // a note that moved, and nothing is reported.
    let sidecar = r#"{"companion":"highlights/papers/BERT (2019).md","highlights":[],"pdf":"papers/BERT (2019).pdf","version":1}
"#;
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-escaped", true).await;
    for (path, text) in [
        ("highlights/papers/BERT (2019).md", "quote ^h1\n"),
        (".baram/pdf-highlights/papers/BERT (2019).json", sidecar),
        ("r.md", "((highlights/papers/BERT (2019%29#^h1))\n"),
    ] {
        let path = dir.path().join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
    std::fs::create_dir_all(dir.path().join("papers")).unwrap();
    std::fs::write(dir.path().join("papers/BERT (2019).pdf"), b"%PDF\xff\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();
    let r = at(&root, &["r.md"]);
    assert_eq!(
        backlink_lines(
            &state,
            &ctx,
            &at(&root, &["highlights", "papers", "BERT (2019).md"]),
            &r
        )
        .await,
        vec![1]
    );

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &at(&root, &["papers", "BERT (2019).pdf"]),
        &at(&root, &["papers", "Survey (2020).pdf"]),
    )
    .await
    .unwrap();
    assert_eq!(result.updated_files, vec![r.clone()]);
    assert!(result.skipped_files.is_empty(), "{result:?}");
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "((highlights/papers/Survey (2020%29#^h1))\n"
    );
    assert_eq!(
        backlink_lines(
            &state,
            &ctx,
            &at(&root, &["highlights", "papers", "Survey (2020).md"]),
            &r
        )
        .await,
        vec![1]
    );
}

/// The PDF `papers/Paper.pdf` with its highlight note, `r.md` linking to that note
/// four ways, and — when `literature` — the user's own `notes/Paper.md`, which shares the
/// note's stem. Then `rename(dir, root, state, ctx)`; what `r.md` says after, whether the
/// rename reported it, and the lines of `r.md` among the backlinks of `notes/Paper.md`.
async fn with_a_literature_note(
    literature: bool,
    rename: impl AsyncFnOnce(&str, &LinkIndexState, &ContextManager) -> RenameResult,
) -> (String, bool, Vec<u32>) {
    let ctx = ContextManager::new();
    let mut files = vec![
        ("highlights/papers/Paper.md", "quote ^h1\n"),
        (
            "r.md",
            "[[Paper]]\n[[notes/Paper]]\n((highlights/papers/Paper#^h1))\n[[highlights/papers/Paper]]\n",
        ),
    ];
    if literature {
        files.push(("notes/Paper.md", "my notes\n"));
    }
    let (dir, root, state) = vault_with_a_pdf(&ctx, &files).await;
    let result = rename(&root, &state, &ctx).await;
    let r = at(&root, &["r.md"]);
    let lines = backlink_lines(&state, &ctx, &at(&root, &["notes", "Paper.md"]), &r).await;
    (
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        result.skipped_files.contains(&r),
        lines,
    )
}

#[tokio::test]
async fn a_carried_highlight_note_leaves_a_bare_link_another_note_shares() {
    // The PDF's rename carries its highlight note along — a rename the user
    // did not choose. With the user's `notes/Paper.md` beside it, a bare
    // `[[Paper]]` may mean that note, so it is left and the file reported;
    // the path link and the block reference name the highlight note alone
    // and are rewritten. With no other `Paper` note, `[[Paper]]` follows too.
    // What fails this: carrying the note as a rename the user asked for
    // (`Origin::Asked` in `carry_companion`) — `[[Paper]]` becomes
    // `[[Survey]]`, and `notes/Paper.md` loses that backlink.
    let rename_pdf = async |root: &str, state: &LinkIndexState, ctx: &ContextManager| {
        rename_file_with_links_inner(
            state,
            ctx,
            &at(root, &["papers", "Paper.pdf"]),
            &at(root, &["papers", "Survey.pdf"]),
        )
        .await
        .unwrap()
    };
    assert_eq!(
        with_a_literature_note(true, rename_pdf).await,
        (
            "[[Paper]]\n[[notes/Paper]]\n((highlights/papers/Survey#^h1))\n[[highlights/papers/Survey]]\n"
                .to_string(),
            true,
            vec![1, 2]
        )
    );
    assert_eq!(
        with_a_literature_note(false, rename_pdf).await,
        (
            "[[Survey]]\n[[notes/Paper]]\n((highlights/papers/Survey#^h1))\n[[highlights/papers/Survey]]\n"
                .to_string(),
            false,
            vec![2]
        )
    );
}

#[tokio::test]
async fn a_highlight_note_the_user_renames_follows_the_stem_contract() {
    // The partner of the test above: renaming the highlight note itself is
    // the user's choice, and a bare `[[Paper]]` follows it though
    // `notes/Paper.md` shares the stem — a bare link names every note of a
    // stem, as for any note rename.
    // What fails this: treating every rename as carried.
    let rename_note = async |root: &str, state: &LinkIndexState, ctx: &ContextManager| {
        rename_file_with_links_inner(
            state,
            ctx,
            &at(root, &["highlights", "papers", "Paper.md"]),
            &at(root, &["highlights", "papers", "Survey.md"]),
        )
        .await
        .unwrap()
    };
    let (text, reported, _) = with_a_literature_note(true, rename_note).await;
    assert_eq!(
        text,
        "[[Survey]]\n[[notes/Paper]]\n((highlights/papers/Survey#^h1))\n[[highlights/papers/Survey]]\n"
    );
    assert!(!reported);
}

#[tokio::test]
async fn a_highlight_note_the_pdf_rename_rewrites_is_reported_where_it_moved() {
    // The highlight note links its PDF, so the PDF's rename rewrites it as a
    // referrer and then carries it along. The result names it by the path it
    // has now — the frontend re-keys every moved file first, then syncs the
    // open ones `updated_files` names.
    // What fails this: returning the files as the rename collected them
    // (`where_they_are` skipped in `rename_file`) — `updated_files` names
    // `highlights/papers/Paper.md`, which is gone, and an open clean tab on the
    // note keeps the old link.
    let ctx = ContextManager::new();
    let (dir, root, state) = vault_with_a_pdf(
        &ctx,
        &[(
            "highlights/papers/Paper.md",
            "source: [[papers/Paper.pdf]]\n\nquote ^h1\n",
        )],
    )
    .await;

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &at(&root, &["papers", "Paper.pdf"]),
        &at(&root, &["papers", "Survey.pdf"]),
    )
    .await
    .unwrap();
    let note = at(&root, &["highlights", "papers", "Survey.md"]);
    assert_eq!(result.updated_files, vec![note.clone()]);
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    assert_eq!(
        result.moved,
        vec![MovedFile {
            from: at(&root, &["highlights", "papers", "Paper.md"]),
            to: note,
        }]
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("highlights/papers/Survey.md")).unwrap(),
        "source: [[papers/Survey.pdf]]\n\nquote ^h1\n"
    );
}

#[tokio::test]
async fn a_pdf_rename_that_changes_only_the_extensions_case_moves_nothing_else() {
    // `Paper.pdf` → `Paper.PDF`: both names cut at `.pdf` in any case, so the
    // sidecar and the note keep their names. Nothing else moves, so `moved` is
    // empty; the sidecar's `pdf` record names the new spelling.
    // What fails this: reporting a pair whose two paths are one — the guard in
    // `carry_pdf_highlights` for the sidecar, the early return in
    // `carry_companion` for the note.
    let ctx = ContextManager::new();
    let (dir, root, state) = vault_with_a_pdf(
        &ctx,
        &[
            (".baram/pdf-highlights/papers/Paper.json", SIDECAR),
            ("highlights/papers/Paper.md", "quoted ^h1\n"),
            ("r.md", "((highlights/papers/Paper#^h1))\n"),
        ],
    )
    .await;

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &at(&root, &["papers", "Paper.pdf"]),
        &at(&root, &["papers", "Paper.PDF"]),
    )
    .await
    .unwrap();
    assert!(result.moved.is_empty(), "{:?}", result.moved);
    assert!(
        result.skipped_files.is_empty(),
        "{:?}",
        result.skipped_files
    );
    let sidecar = sidecar_at(&dir, ".baram/pdf-highlights/papers/Paper.json");
    assert_eq!(sidecar["pdf"], "papers/Paper.PDF");
    assert_eq!(sidecar["companion"], "highlights/papers/Paper.md");
    assert_eq!(
        std::fs::read_to_string(dir.path().join("highlights/papers/Paper.md")).unwrap(),
        "quoted ^h1\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("r.md")).unwrap(),
        "((highlights/papers/Paper#^h1))\n"
    );
}
