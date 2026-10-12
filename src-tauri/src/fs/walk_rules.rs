//! §393 The two names the vault walk and the link index read the same way: a hidden name and a
//! note. What else a walk leaves out — build output, `.baramignore` — is `VaultExclusion`'s
//! (#794), and a path the watcher reports is judged by that matcher too
//! (`VaultExclusion::walk_skips`), so a reported path and a walked one cannot disagree.

/// A name the walk never enters or collects: it starts with `.`.
pub fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.')
}

/// A note: what the walk collects as markdown and the link index reads links from —
/// `.md` or `.markdown`, case as written.
pub fn is_note_name(name: &str) -> bool {
    name.ends_with(".md") || name.ends_with(".markdown")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs::{walk_vault, Collect, VaultExclusion};
    use std::path::{Path, PathBuf};

    #[test]
    fn notes_are_md_and_markdown_files() {
        assert!(is_note_name("a.md"));
        assert!(is_note_name("a.markdown"));
        assert!(!is_note_name("a.pdf"));
        assert!(!is_note_name("a.md.bak"));
    }

    /// The single-path judgement a reconcile unit makes (`walk_skips`) admits exactly what the
    /// walk collects. What fails this: a walk that changes its rule without the matcher, or the
    /// other way round — a reported path would then be indexed where a build never does (or
    /// missed). The fixture also catches a note rule that takes `.md` alone (`b.markdown`), a
    /// hidden file at any depth (`sub/.h.md`), a default-list folder (`node_modules`, `target`),
    /// and, on Unix, a walk that follows links (`link.md`, whose target is outside the vault).
    #[tokio::test]
    async fn the_walk_collects_exactly_the_paths_the_single_path_judgement_admits() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let files = [
            "a.md",
            "b.markdown",
            "c.pdf",
            ".DS_Store",
            ".obsidian/w.json",
            "node_modules/x.md",
            "target/y.md",
            "sub/.h.md",
            "sub/d.md",
            "sub/.drafts/e.md",
        ];
        for file in files {
            let path = root.join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, "x").unwrap();
        }
        // Bound for the whole test so the target outlives the walk below.
        #[cfg(unix)]
        let _outside = {
            let outside = tempfile::tempdir().unwrap();
            std::fs::write(outside.path().join("secret.md"), "x").unwrap();
            std::os::unix::fs::symlink(outside.path().join("secret.md"), root.join("link.md"))
                .unwrap();
            outside
        };
        let exclusion = VaultExclusion::load(root).unwrap();
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
            .filter(|f| !exclusion.walk_skips(&root.join(Path::new(f)), false))
            .map(|f| f.to_string())
            .collect();
        admitted.sort();
        // A positive half: the fixture does put files on both sides of the rule.
        assert_eq!(admitted, vec!["a.md", "b.markdown", "c.pdf", "sub/d.md"]);

        let walked = walk_vault(root, &exclusion, Collect::Both).await.unwrap();
        assert_eq!(relative(walked.all), admitted);
        let admitted_notes: Vec<String> = admitted
            .iter()
            .filter(|f| is_note_name(f))
            .cloned()
            .collect();
        assert_eq!(admitted_notes, vec!["a.md", "b.markdown", "sub/d.md"]);
        assert_eq!(relative(walked.markdown), admitted_notes);
    }
}
