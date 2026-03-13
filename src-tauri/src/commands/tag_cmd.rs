// §56m Vault-wide tag index — IPC command (thin layer)

#[tauri::command]
pub async fn get_vault_tags(root_path: String) -> Result<Vec<crate::tag::TagEntry>, String> {
    crate::tag::get_vault_tags(&root_path)
        .await
        .map_err(|e| e.to_string())
}

/// Returns relative paths of .md files that contain the given tag (inline or frontmatter).
#[tauri::command]
pub async fn get_files_by_tag(root_path: String, tag: String) -> Result<Vec<String>, String> {
    crate::tag::get_files_by_tag(&root_path, &tag)
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
