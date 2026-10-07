//! Issue 796: `LinkIndex::remove_file` takes a file out by the keys it was filed under.
//! Held against the full scan it replaced, and counted.

use super::*;

/// What `remove_file` did before issue 796: every map scanned for the path.
fn remove_by_scanning(index: &mut LinkIndex, file_path: &str) {
    index.outgoing.remove(file_path);
    for by_source in index.incoming.values_mut() {
        for entries in by_source.values_mut() {
            entries.retain(|e| e.source_path != file_path);
        }
        by_source.retain(|_, entries| !entries.is_empty());
    }
    index.incoming.retain(|_, v| !v.is_empty());
    let stem = normalize_file_path(file_path);
    if let Some(paths) = index.file_map.get_mut(&stem) {
        paths.retain(|p| p != file_path);
        if paths.is_empty() {
            index.file_map.remove(&stem);
        }
    }
    index.relative_map.retain(|_, v| v != file_path);
    index.id_map.retain(|_, v| v != file_path);
    index.name_map.retain(|_, paths| {
        paths.retain(|p| p != file_path);
        !paths.is_empty()
    });
    index.file_tags.remove(file_path);
}

/// Every map of `index` as sorted text, for comparing two indexes.
fn contents(index: &LinkIndex) -> Vec<Vec<String>> {
    fn rows<K: std::fmt::Debug, V: std::fmt::Debug>(map: &HashMap<K, V>) -> Vec<String> {
        let mut rows: Vec<String> = map.iter().map(|(k, v)| format!("{k:?} => {v:?}")).collect();
        rows.sort();
        rows
    }
    vec![
        rows(&index.outgoing),
        rows(&index.incoming),
        rows(&index.file_map),
        rows(&index.relative_map),
        rows(&index.id_map),
        rows(&index.name_map),
        rows(&index.file_tags),
    ]
}

fn write(root: &std::path::Path, rel: &str, body: &str) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, body).unwrap();
}

async fn built(root: &std::path::Path) -> LinkIndex {
    let mut index = LinkIndex::new();
    index.build(&root.to_string_lossy()).await.unwrap();
    index
}

/// Removing any one file by its keys leaves exactly what scanning every map left: notes
/// with wikilinks, path links, block references and tags, a zettel id, a link target
/// that is not markdown, and two notes whose names fold to one key.
/// 이것을 실패시키는 것: `remove_file` 이 키 하나를 빠뜨리는 것(예: `target_keys` 의 경로
/// 키, `relative_key`, zettel id) — 그 map 에 경로가 남는다.
#[tokio::test]
async fn removing_by_key_leaves_what_scanning_every_map_left() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "a.md", "see [[b]] and [[notes/c]] and ((c#^x1)) #tag");
    write(root, "b.md", "back to [[a]] and [[Paper.pdf]]");
    write(root, "notes/c.md", "para ^x1\n[[202601011200]]");
    write(root, "notes/C.md", "folds with c");
    write(root, "202601011200 zettel.md", "[[a]]");
    write(root, "202601011200 twin.md", "same id");
    write(root, "Paper.pdf", "pdf");
    let files = [
        "a.md",
        "b.md",
        "notes/c.md",
        "notes/C.md",
        "202601011200 zettel.md",
        "202601011200 twin.md",
        "Paper.pdf",
    ];
    let mut removed_any = false;
    for rel in files {
        let path = root.join(rel).to_string_lossy().into_owned();
        let mut by_key = built(root).await;
        let mut by_scan = built(root).await;
        let before = contents(&by_key);
        by_key.remove_file(&path);
        remove_by_scanning(&mut by_scan, &path);
        assert_eq!(contents(&by_key), contents(&by_scan), "{rel}");
        removed_any |= contents(&by_key) != before;
    }
    assert!(removed_any, "the fixture removed nothing");
}

/// A save's removal looks at the same number of stored entries in a vault of ten notes
/// and of a thousand — with every note linking the same hub, so the hub's key holds a
/// link from each of them. 이것을 실패시키는 것: 키 안에서 source 를 찾지 않고 그 키의
/// 링크를 모두 훑는 것(훑은 것도 세면서), 또는 `incoming` 전체를 훑는 옛 방식 — 수가 노트
/// 수를 따라 는다.
#[tokio::test]
async fn removing_a_note_costs_the_same_however_large_the_vault() {
    let mut visits = Vec::new();
    for notes in [10, 1_000] {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "home.md", "hub");
        for i in 0..notes {
            write(
                dir.path(),
                &format!("n{i}.md"),
                &format!("see [[home]], [[home]] again and [[n{}]]", i + 1),
            );
        }
        let mut index = built(dir.path()).await;
        let home = dir.path().join("home.md").to_string_lossy().into_owned();
        assert_eq!(index.get_backlinks(&home, &[]).len(), notes);
        let path = dir.path().join("n5.md").to_string_lossy().into_owned();
        let before = removal_visits();
        index.remove_file(&path);
        visits.push(removal_visits() - before);
        assert_eq!(index.get_backlinks(&home, &[]).len(), notes - 1);
    }
    assert_eq!(visits[0], visits[1], "{visits:?}");
    // Two filing keys (`home` once though linked twice, `n6`), then the one path under
    // the stem in `file_map` and under its `name_map` key — at the root its name and its
    // path are one key: 2 + 1 + 1.
    // 이것을 실패시키는 것: 키의 `dedup` 을 지우는 것 — `home` 을 두 번 찾아 5 가 된다.
    assert_eq!(visits[0], 4);
}
