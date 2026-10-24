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
#[tauri::command]
pub async fn rename_tag(
    root_path: String,
    old_tag: String,
    new_tag: String,
) -> Result<crate::tag::RenameTagResult, String> {
    crate::tag::rename_tag(&root_path, &old_tag, &new_tag)
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
