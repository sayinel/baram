// §393 Paths the watcher reports, run the way the applier runs them: one unit per
// identity (`reconcile_identity_in`), the identity spelled lexically under the host's
// canonical root as `WatchFilter::identity_of` does. Cases ported from the
// `sync_index_paths` tests of §393, which judged each path by what it is on disk now.
use super::*;

use super::super::reconcile::{reconcile_identity_in, Batch};

/// The canonical root of `root` — the host key `identity_of` joins a reported path onto.
fn host(root: &str) -> std::path::PathBuf {
    std::fs::canonicalize(root).unwrap()
}

/// One applier batch over `relatives` (under `root`), each as its lexical identity; the
/// rebuilds the units asked for run in the batch (the applier hands them to the scheduler).
/// Whether any unit asked for one.
async fn applier_batch(
    state: &LinkIndexState,
    ctx: &ContextManager,
    root: &str,
    relatives: &[&str],
) -> bool {
    let mut batch = Batch::default();
    let mut done = Vec::new();
    for relative in relatives {
        let identity = host(root).join(relative);
        let spelled = format!("{root}/{relative}");
        done.push(reconcile_identity_in(state, ctx, &identity, vec![spelled], &mut batch).await);
    }
    batch.finish(state, ctx, &mut done).await;
    done.iter().any(|d| !d.wants.is_empty())
}

async fn sources_of(state: &LinkIndexState, ctx: &ContextManager, note: &str) -> Vec<String> {
    let mut found: Vec<String> = get_backlinks_inner(state, ctx, note)
        .await
        .unwrap()
        .into_iter()
        .map(|b| b.source_path)
        .collect();
    found.sort();
    found
}

/// A vault whose `a.md` links to `b.md`, plus `files`, indexed.
async fn built(
    ctx: &ContextManager,
    files: &[(&str, &str)],
) -> (tempfile::TempDir, String, LinkIndexState) {
    let (dir, root) = vault_with_a_link(ctx, "ctx-a", true).await;
    for (relative, content) in files {
        let path = dir.path().join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }
    let state = LinkIndexState::new();
    refresh_index_inner(&state, ctx, &root).await.unwrap();
    (dir, root, state)
}

#[tokio::test]
async fn a_folder_replaced_by_an_empty_one_loses_its_notes() {
    // `mv sub elsewhere; mkdir sub` — the watcher reports the folder, not its old children.
    // RED on the umbrella before this (`directory_point` answered `Nothing`: `sub/e.md` stayed
    // a backlink).
    // 이것을 실패시키는 것: `directory_point` 가 빈 디렉터리 아래에 index 가 가진 항목을 보지 않는다.
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[("sub/e.md", "see [[b]]")]).await;
    let b = format!("{root}/b.md");
    assert_eq!(
        sources_of(&state, &ctx, &b).await,
        vec![format!("{root}/a.md"), format!("{root}/sub/e.md")]
    );
    std::fs::remove_dir_all(dir.path().join("sub")).unwrap();
    std::fs::create_dir(dir.path().join("sub")).unwrap();

    applier_batch(&state, &ctx, &root, &["sub"]).await;

    assert_eq!(
        sources_of(&state, &ctx, &b).await,
        vec![format!("{root}/a.md")]
    );
}

/// How the first link of `note` resolves in the index for `key`.
async fn first_link(state: &LinkIndexState, key: &str, note: &str) -> crate::index::LinkResolution {
    state
        .with_index(key, |idx| {
            idx.unwrap().outgoing_resolved(note).unwrap()[0].1.clone()
        })
        .await
}

#[tokio::test]
async fn a_deleted_folder_takes_its_notes_with_it_without_a_rebuild() {
    // `rm -rf sub`, reported as the folder: its notes go in place.
    // 이것을 실패시키는 것: 사라진 경로 아래에 항목이 있을 때 `RemoveTree` 대신 rebuild 를 건다(`rebuilt`), 또는
    // `Remove` 를 건다(경로 자신만 빼 `sub/e.md` 가 남는다).
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[("sub/e.md", "see [[b]]")]).await;
    std::fs::remove_dir_all(dir.path().join("sub")).unwrap();

    let rebuilt = applier_batch(&state, &ctx, &root, &["sub"]).await;

    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![format!("{root}/a.md")]
    );
    assert!(!rebuilt, "a removal, not a rebuild");
}

#[tokio::test]
async fn a_deleted_folders_attachment_stops_resolving() {
    // 이것을 실패시키는 것: 나무 제거가 노트만 빼고 링크 대상(`name_map`)을 남긴다 — PDF 가 계속 resolve 된다.
    let ctx = ContextManager::new();
    let (dir, root, state) =
        built(&ctx, &[("m.md", "see [[p.pdf]]"), ("docs/p.pdf", "%PDF")]).await;
    let key = active_index_key(&ctx).await.unwrap();
    let note = format!("{root}/m.md");
    assert!(matches!(
        first_link(&state, &key, &note).await,
        crate::index::LinkResolution::Resolved(_)
    ));
    std::fs::remove_dir_all(dir.path().join("docs")).unwrap();

    applier_batch(&state, &ctx, &root, &["docs"]).await;

    assert_eq!(
        first_link(&state, &key, &note).await,
        crate::index::LinkResolution::Unresolved
    );
}

#[tokio::test]
async fn a_folder_replaced_under_the_same_name_loses_its_old_children() {
    // `mv sub …; mv other sub` in one batch: the rebuild reads the new children only.
    // 이것을 실패시키는 것: 파일을 가진 디렉터리에 `directory_point` 가 rebuild 대신 `Nothing` 을 낸다.
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[("sub/old.md", "see [[b]]")]).await;
    std::fs::remove_dir_all(dir.path().join("sub")).unwrap();
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("sub/new.md"), "see [[b]]").unwrap();

    applier_batch(&state, &ctx, &root, &["sub"]).await;

    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![format!("{root}/a.md"), format!("{root}/sub/new.md")]
    );
}

#[tokio::test]
async fn a_moved_in_folders_note_and_attachment_are_indexed() {
    // A folder that appears with files is a rebuild of the registration (its files come
    // without events of their own); the note's link and the attachment both arrive.
    // 이것을 실패시키는 것: 파일을 가진 디렉터리에 `directory_point` 가 rebuild 대신 `Nothing` 을 낸다.
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[("n.md", "see [[img.png]]")]).await;
    let key = active_index_key(&ctx).await.unwrap();
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("sub/e.md"), "see [[b]]").unwrap();
    std::fs::write(dir.path().join("sub/img.png"), "png").unwrap();

    applier_batch(&state, &ctx, &root, &["sub"]).await;

    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![format!("{root}/a.md"), format!("{root}/sub/e.md")]
    );
    assert!(matches!(
        first_link(&state, &key, &format!("{root}/n.md")).await,
        crate::index::LinkResolution::Resolved(_)
    ));
}

#[tokio::test]
async fn a_moved_in_folder_keeps_an_unreadable_note_as_a_link_target() {
    // The build registers every note before reading it, so `[[bad]]` resolves.
    // 이것을 실패시키는 것: 파일을 가진 디렉터리에 `directory_point` 가 rebuild 대신 `Nothing` 을 낸다.
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[("n.md", "see [[bad]]")]).await;
    let key = active_index_key(&ctx).await.unwrap();
    let note = format!("{root}/n.md");
    assert_eq!(
        first_link(&state, &key, &note).await,
        crate::index::LinkResolution::Unresolved
    );
    std::fs::create_dir(dir.path().join("dir")).unwrap();
    std::fs::write(dir.path().join("dir/bad.md"), [0xff, 0xfe, 0xfd]).unwrap();

    applier_batch(&state, &ctx, &root, &["dir"]).await;

    assert!(matches!(
        first_link(&state, &key, &note).await,
        crate::index::LinkResolution::Resolved(_)
    ));
}

#[tokio::test]
async fn deleted_notes_in_one_batch_are_one_exclusion_load_and_no_rebuild() {
    // The cost of a burst of deletes (`rm` of many notes, a checkout): one unit each, the
    // registration's `.baramignore` read once for the batch, nothing rebuilt. Each removal
    // goes by the note's keys, not a scan of the index (`index::removal_tests`).
    // 이것을 실패시키는 것: `Batch::exclusion` 이 unit 마다 `.baramignore` 를 다시 읽는다.
    let ctx = ContextManager::new();
    let files: Vec<(String, String)> = (0..50)
        .map(|i| (format!("n{i}.md"), "see [[b]]".to_string()))
        .collect();
    let files: Vec<(&str, &str)> = files
        .iter()
        .map(|(p, c)| (p.as_str(), c.as_str()))
        .collect();
    let (dir, root, state) = built(&ctx, &files).await;
    for (name, _) in &files {
        std::fs::remove_file(dir.path().join(name)).unwrap();
    }
    let loads = state
        .exclusion_loads
        .load(std::sync::atomic::Ordering::SeqCst);
    let names: Vec<&str> = files.iter().map(|(p, _)| *p).collect();

    let rebuilt = applier_batch(&state, &ctx, &root, &names).await;

    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![format!("{root}/a.md")]
    );
    assert_eq!(
        state
            .exclusion_loads
            .load(std::sync::atomic::Ordering::SeqCst),
        loads + 1
    );
    assert!(!rebuilt);
}

#[tokio::test]
async fn an_external_case_only_rename_leaves_only_the_new_spelling() {
    // A file manager renames `Note.md` to `note.md`; on a volume that folds case both
    // spellings still reach the one file, and the watcher reports both. On a volume that
    // keeps case `note.md` does not exist before the rename and the test returns there.
    // RED on the umbrella before this (`[Note.md, a.md, note.md]`: the unit at the written
    // `Note.md` stats the one file through it and re-reads it under that key).
    // 이것을 실패시키는 것: 감시 unit 이 적힌 이름과 디스크가 저장한 이름을 비교하지 않는다(`not_its_own_entry`).
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[("Note.md", "see [[b]]")]).await;
    if !dir.path().join("note.md").exists() {
        eprintln!("the file system under {root} keeps case; the case-only test is not run");
        return;
    }
    let b = format!("{root}/b.md");
    assert_eq!(
        sources_of(&state, &ctx, &b).await,
        vec![format!("{root}/Note.md"), format!("{root}/a.md")]
    );
    std::fs::rename(dir.path().join("Note.md"), dir.path().join("note.md")).unwrap();

    applier_batch(&state, &ctx, &root, &["Note.md", "note.md"]).await;

    assert_eq!(
        sources_of(&state, &ctx, &b).await,
        vec![format!("{root}/a.md"), format!("{root}/note.md")]
    );
}

#[tokio::test]
async fn an_external_case_only_rename_of_an_attachment_resolves_to_the_new_spelling() {
    // The `Target` half of the one above.
    // 이것을 실패시키는 것: 적힌 이름이 낡은 표기일 때 대상 등록을 지우지 않는다 — `[[paper.pdf]]` 가 먼저
    // 등록된 `Paper.pdf` 로 계속 resolve 된다.
    let ctx = ContextManager::new();
    let (dir, root, state) = built(
        &ctx,
        &[("n.md", "see [[paper.pdf]]"), ("Paper.pdf", "%PDF")],
    )
    .await;
    if !dir.path().join("paper.pdf").exists() {
        eprintln!("the file system under {root} keeps case; the case-only test is not run");
        return;
    }
    let key = active_index_key(&ctx).await.unwrap();
    let note = format!("{root}/n.md");
    let resolved = |p: &str| crate::index::LinkResolution::Resolved(format!("{root}/{p}"));
    assert_eq!(first_link(&state, &key, &note).await, resolved("Paper.pdf"));
    std::fs::rename(dir.path().join("Paper.pdf"), dir.path().join("paper.pdf")).unwrap();

    applier_batch(&state, &ctx, &root, &["Paper.pdf", "paper.pdf"]).await;

    assert_eq!(first_link(&state, &key, &note).await, resolved("paper.pdf"));
}

/// A symlink is not a note or a link target to the build (the walk does not follow one),
/// and a change reported at one is not a change to its target.
#[cfg(unix)]
#[tokio::test]
async fn a_symlink_the_watcher_reports_is_not_indexed_and_its_target_keeps_its_links() {
    // RED on the umbrella before this (`[a.md, link.md]`: the unit stats through the link and
    // indexes `link.md` with `a.md`'s content).
    // 이것을 실패시키는 것: 감시 unit 이 적힌 항목과 그것이 resolve 된 항목을 비교하지 않는다(`not_its_own_entry`).
    let ctx = ContextManager::new();
    let (dir, root, state) = built(&ctx, &[]).await;
    std::os::unix::fs::symlink(dir.path().join("a.md"), dir.path().join("link.md")).unwrap();

    applier_batch(&state, &ctx, &root, &["link.md"]).await;

    assert_eq!(
        sources_of(&state, &ctx, &format!("{root}/b.md")).await,
        vec![format!("{root}/a.md")]
    );
}
