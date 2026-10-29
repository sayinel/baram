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
