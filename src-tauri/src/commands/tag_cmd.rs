// §56m Vault-wide tag index — IPC command (thin layer)

#[tauri::command]
pub async fn get_vault_tags(root_path: String) -> Result<Vec<crate::tag::TagEntry>, String> {
    crate::tag::get_vault_tags(&root_path)
        .await
        .map_err(|e| e.to_string())
}

/// Returns relative paths of .md files that contain the given tag (inline or frontmatter).
/// §56m The tag is named as `baram tag` names it: every leading `#` off (`tag::bare_tag`).
#[tauri::command]
pub async fn get_files_by_tag(root_path: String, tag: String) -> Result<Vec<String>, String> {
    crate::tag::get_files_by_tag(&root_path, crate::tag::bare_tag(&tag))
        .await
        .map_err(|e| e.to_string())
}

/// Rename (or merge) a tag across all .md files in the vault.
/// §56m Both names lose every leading `#` (`tag::bare_tag`), the name the index keeps; a
/// name that is only `#`s is then empty, and `tag::rename_tag` refuses it.
#[tauri::command]
pub async fn rename_tag(
    root_path: String,
    old_tag: String,
    new_tag: String,
) -> Result<crate::tag::RenameTagResult, String> {
    use crate::tag::bare_tag;
    crate::tag::rename_tag(&root_path, bare_tag(&old_tag), bare_tag(&new_tag))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    async fn vault_of(files: &[(&str, &str)]) -> (TempDir, String) {
        let d = TempDir::new().unwrap();
        for (name, body) in files {
            tokio::fs::write(d.path().join(name), body).await.unwrap();
        }
        let root = d.path().to_string_lossy().into_owned();
        (d, root)
    }

    /// The app may hand over a name with `#`s: the tag panel's old name is its row's name (a
    /// front-matter row was `#solo` while the reader kept the `#`), and its new name loses one
    /// `#` only (`TagPanel.tsx`, `replace(/^#/, "")`). Both names go through `tag::bare_tag`,
    /// so `#solo` → `#focus` renames the tag `solo` in the body and in the front matter alike
    /// and writes no `##focus`. What fails this: passing the names as given (the body's
    /// `#solo` is looked for as `##solo` and stays, and a `solo` → `#focus` rename writes
    /// `##focus`).
    #[tokio::test]
    async fn a_rename_takes_either_name_with_or_without_its_hash() {
        for (old, new) in [("#solo", "#focus"), ("solo", "#focus"), ("##solo", "focus")] {
            let (d, root) =
                vault_of(&[("a.md", "---\ntags: [\"#solo\", solo]\n---\n본문 #solo\n")]).await;
            let r = rename_tag(root, old.into(), new.into()).await.unwrap();
            assert_eq!(r.occurrences_replaced, 3, "{old} → {new}");
            assert_eq!(
                tokio::fs::read_to_string(d.path().join("a.md"))
                    .await
                    .unwrap(),
                "---\ntags: [\"#focus\", focus]\n---\n본문 #focus\n",
                "{old} → {new}"
            );
        }
    }

    /// A name that is only `#`s is empty once bare, and refused — as `baram tag '#'` is.
    /// What fails this: checking emptiness before stripping (`#` passes and the walk runs).
    /// The pair: the same rename by a real name succeeds.
    #[tokio::test]
    async fn a_rename_to_or_from_only_hashes_is_refused() {
        let (_d, root) = vault_of(&[("a.md", "본문 #solo\n")]).await;
        assert!(rename_tag(root.clone(), "#".into(), "focus".into())
            .await
            .is_err());
        assert!(rename_tag(root.clone(), "solo".into(), "##".into())
            .await
            .is_err());
        assert!(rename_tag(root, "solo".into(), "focus".into())
            .await
            .is_ok());
    }

    /// The app's file filter finds a tag by `#Solo` as `baram tag '#Solo'` does: every leading
    /// `#` off, case not compared. What fails this: passing the name as given — `#solo`
    /// matches no stored tag, now that none keeps its `#`.
    #[tokio::test]
    async fn files_by_tag_take_the_name_with_or_without_its_hash() {
        let (_d, root) = vault_of(&[
            ("fm.md", "---\ntags: [\"#solo\"]\n---\n"),
            ("body.md", "본문 #solo\n"),
            ("other.md", "본문 #other\n"),
        ])
        .await;
        for name in ["#Solo", "solo", "##solo"] {
            let mut found = get_files_by_tag(root.clone(), name.into()).await.unwrap();
            found.sort();
            assert_eq!(found, ["body.md", "fm.md"], "{name}");
        }
    }
}
