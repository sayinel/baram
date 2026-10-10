//! §393 What the vault walks take and skip. `collect_md_files` · `collect_all_files` (this
//! module's parent) and `index::service::sync` (spec 0072 §5.4) ask the same questions, so
//! the answers live here once.
//!
//! The walkers ask them one directory entry at a time; `is_skipped_relative` asks them of a
//! whole path the file watcher reported. The watcher's own filter (`start_watching`) is a
//! fixed list of path substrings (`/.git/`, `/.baram/`, `/node_modules/`, …) and passes every
//! other hidden entry, `.obsidian/` included — so the sync asks this before it touches the
//! index.

use super::SKIP_DIRS;
use std::path::{Component, Path};

/// A name the walkers never enter or collect: it starts with `.`.
pub fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.')
}

/// A note: what `collect_md_files` collects and the link index reads links from.
pub fn is_note_name(name: &str) -> bool {
    name.ends_with(".md") || name.ends_with(".markdown")
}

/// Whether `relative` — a path under a walked root, the root itself being `""` — lies where
/// the walkers never go: one of its components is hidden or a `SKIP_DIRS` name.
///
/// The walkers test `SKIP_DIRS` on directories only; this tests every component, the last
/// included, because a reported path may name the directory itself (`node_modules` was
/// created). Of the four `SKIP_DIRS` names three start with `.` and are skipped by the
/// walkers as hidden anyway, so the two rules differ only for a FILE named `node_modules`,
/// which `collect_all_files` collects and this skips.
pub fn is_skipped_relative(relative: &Path) -> bool {
    relative.components().any(|component| match component {
        Component::Normal(name) => {
            let name = name.to_string_lossy();
            is_hidden_name(&name) || SKIP_DIRS.contains(&name.as_ref())
        }
        Component::Prefix(_) | Component::RootDir | Component::CurDir | Component::ParentDir => {
            false
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn notes_are_md_and_markdown_files() {
        assert!(is_note_name("a.md"));
        assert!(is_note_name("a.markdown"));
        assert!(!is_note_name("a.pdf"));
        assert!(!is_note_name("a.md.bak"));
    }

    #[test]
    fn a_hidden_or_tool_directory_anywhere_in_the_path_is_skipped() {
        for skipped in [
            ".DS_Store",
            ".obsidian/workspace.json",
            "notes/node_modules/x.md",
            "a/.drafts/b.md",
            ".git",
        ] {
            assert!(is_skipped_relative(Path::new(skipped)), "{skipped}");
        }
        // The root itself (""), a dot inside a name, a plain subfolder: walked.
        for kept in ["", "a.md", "notes/v1.2/a.md", "notes/sub"] {
            assert!(!is_skipped_relative(Path::new(kept)), "{kept}");
        }
    }

    /// What fails this: a walker that changes its rule without this module, or the other
    /// way round — the sync would then index a path the build never does (or miss one).
    #[tokio::test]
    async fn the_walkers_collect_exactly_the_paths_the_predicates_admit() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let files = [
            "a.md",
            "b.markdown",
            "c.pdf",
            ".DS_Store",
            ".obsidian/w.json",
            "node_modules/x.md",
            "sub/.h.md",
            "sub/d.md",
            "sub/.drafts/e.md",
        ];
        for file in files {
            let path = root.join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, "x").unwrap();
        }
        // A link inside the vault to a file outside it: the walkers do not follow it
        // (`DirEntry::metadata`), so it is neither collected nor a way out.
        // Bound for the whole test so the target outlives the walk below.
        #[cfg(unix)]
        let _outside = {
            let outside = tempfile::tempdir().unwrap();
            std::fs::write(outside.path().join("secret.md"), "x").unwrap();
            std::os::unix::fs::symlink(outside.path().join("secret.md"), root.join("link.md"))
                .unwrap();
            outside
        };
        let relative = |paths: Vec<PathBuf>| -> Vec<String> {
            let mut out: Vec<String> = paths
                .iter()
                .map(|p| {
                    p.strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/")
                })
                .collect();
            out.sort();
            out
        };
        let mut admitted: Vec<String> = files
            .iter()
            .filter(|f| !is_skipped_relative(Path::new(f)))
            .map(|f| f.to_string())
            .collect();
        admitted.sort();
        // A positive half: the fixture does put files on both sides of the rule.
        assert_eq!(admitted, vec!["a.md", "b.markdown", "c.pdf", "sub/d.md"]);

        let mut all = Vec::new();
        crate::fs::collect_all_files(root, &mut all).await.unwrap();
        assert_eq!(relative(all), admitted);

        let mut notes = Vec::new();
        crate::fs::collect_md_files(root, &mut notes).await.unwrap();
        let admitted_notes: Vec<String> = admitted
            .iter()
            .filter(|f| is_note_name(f))
            .cloned()
            .collect();
        assert_eq!(relative(notes), admitted_notes);
    }
}
