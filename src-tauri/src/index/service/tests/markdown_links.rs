//! A file rename reports the notes whose markdown-syntax links to the file it
//! leaves dangling (`rename/markdown_referrers.rs`).

use super::attachments::at;
use super::*;

#[tokio::test]
async fn a_rename_reports_the_markdown_links_it_leaves_dangling() {
    // `![](img.png)` and `[pdf](img.png)` are no links the index files, so
    // the rename does not rewrite them; `![[img.png]]` is, and is rewritten.
    // The note holding the first two is reported, rewritten or not, and a
    // note whose markdown link names another file is not.
    // What fails this: not calling `markdown_referrers` in
    // `rename_file_with_links_inner` — `r.md` is rewritten and not
    // reported, and its image breaks silently.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-md-links", true).await;
    std::fs::create_dir_all(dir.path().join("d")).unwrap();
    std::fs::write(dir.path().join("d/img.png"), b"\x89PNG\r\n\x1a\n\xff").unwrap();
    std::fs::write(
        dir.path().join("d/r.md"),
        "![](img.png)\n![[img.png]]\n[pdf](./img.png)\n",
    )
    .unwrap();
    std::fs::write(dir.path().join("d/s.md"), "![](other.png)\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &at(&root, &["d", "img.png"]),
        &at(&root, &["d", "pic.png"]),
    )
    .await
    .unwrap();
    let r = at(&root, &["d", "r.md"]);
    assert_eq!(result.updated_files, vec![r.clone()]);
    assert_eq!(result.skipped_files, vec![r]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("d/r.md")).unwrap(),
        "![](img.png)\n![[pic.png]]\n[pdf](./img.png)\n"
    );
}

#[tokio::test]
async fn a_note_rename_reports_markdown_links_to_the_note_including_its_own() {
    // A note is linked with markdown syntax too — `[n](note.md)` from
    // another note, and from itself. Both notes are reported, the renamed
    // one by its new path; their markdown links are left as written. The
    // positive partner: a note linking `note.md` from another folder, where
    // it names no file, is not reported.
    // What fails this: naming the renamed note by its old path — a path
    // that no longer exists is reported.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-md-note", true).await;
    std::fs::create_dir_all(dir.path().join("d/e")).unwrap();
    std::fs::write(dir.path().join("d/note.md"), "[me](note.md)\n").unwrap();
    std::fs::write(dir.path().join("d/s.md"), "[n](<note.md#Heading>)\n").unwrap();
    std::fs::write(dir.path().join("d/e/t.md"), "[n](note.md)\n").unwrap();
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let renamed = at(&root, &["d", "new.md"]);
    let result =
        rename_file_with_links_inner(&state, &ctx, &at(&root, &["d", "note.md"]), &renamed)
            .await
            .unwrap();
    let mut skipped = result.skipped_files.clone();
    skipped.sort();
    let mut expected = vec![renamed, at(&root, &["d", "s.md"])];
    expected.sort();
    assert_eq!(skipped, expected);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("d/s.md")).unwrap(),
        "[n](<note.md#Heading>)\n"
    );
}

#[tokio::test]
async fn a_rename_reports_the_html_media_tags_it_leaves_dangling() {
    // The editor loads `src` and `poster` of an HTML media tag, and the rename
    // rewrites neither: each note holding one is reported and left as written.
    // `<Image>` is one — the HTML parser reads it as `<img>`. The partners hold
    // `srcset`, a scheme, a link's `href` and a component that is no media tag,
    // which the editor does not load as this file.
    // What fails this: not reading HTML in `markdown_link_dangles` — no
    // positive note is reported.
    let ctx = ContextManager::new();
    let (dir, root) = vault_with_a_link(&ctx, "ctx-html-media", true).await;
    std::fs::create_dir_all(dir.path().join("d")).unwrap();
    std::fs::write(dir.path().join("d/img.png"), b"\x89PNG\r\n\x1a\n\xff").unwrap();
    let notes = [
        ("block.md", "<img src=\"img.png\" width=\"300\">\n", true),
        ("inline.md", "see <img src=\"img.png\"> here\n", true),
        (
            "typora.md",
            "<img src=\"img.png\" style=\"zoom:50%;\" />\n",
            true,
        ),
        (
            "video.md",
            "<video src=\"img.png\" controls></video>\n",
            true,
        ),
        (
            "poster.md",
            "<video src=\"x.mp4\" poster=\"img.png\"></video>\n",
            true,
        ),
        ("image.md", "<Image src=\"img.png\" />\n", true),
        ("srcset.md", "<img srcset=\"img.png 2x\">\n", false),
        (
            "scheme.md",
            "<img src=\"https://example.com/img.png\">\n",
            false,
        ),
        ("anchor.md", "<a href=\"img.png\">x</a>\n", false),
        ("card.md", "<ImageCard src=\"img.png\" />\n", false),
    ];
    for (name, content, _) in notes {
        std::fs::write(dir.path().join("d").join(name), content).unwrap();
    }
    let state = LinkIndexState::new();
    refresh_index_inner(&state, &ctx, &root).await.unwrap();

    let result = rename_file_with_links_inner(
        &state,
        &ctx,
        &at(&root, &["d", "img.png"]),
        &at(&root, &["d", "pic.png"]),
    )
    .await
    .unwrap();
    let mut skipped = result.skipped_files.clone();
    skipped.sort();
    let mut expected: Vec<String> = notes
        .iter()
        .filter(|(_, _, reported)| *reported)
        .map(|(name, _, _)| at(&root, &["d", name]))
        .collect();
    expected.sort();
    assert_eq!(skipped, expected);
    assert!(result.updated_files.is_empty());
    for (name, content, _) in notes {
        assert_eq!(
            std::fs::read_to_string(dir.path().join("d").join(name)).unwrap(),
            content
        );
    }
}
