// §304 Vault-wide task index — IPC command (thin layer)

#[tauri::command]
pub async fn get_vault_tasks(
    root_path: String,
    exclude: Vec<String>,
) -> Result<Vec<crate::task::TaskEntry>, String> {
    crate::task::get_vault_tasks(&root_path, &exclude)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_file_tasks(path: String) -> Result<Vec<crate::task::TaskEntry>, String> {
    crate::task::get_file_tasks(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_tasks_linking_to(
    root_path: String,
    target: String,
    exclude: Vec<String>,
) -> Result<Vec<crate::task::TaskEntry>, String> {
    crate::task::get_tasks_linking_to(&root_path, &target, &exclude)
        .await
        .map_err(|e| e.to_string())
}
