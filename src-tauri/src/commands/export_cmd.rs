// §5.10 PDF 내보내기 IPC 커맨드

use crate::export::PdfOptions;

#[tauri::command]
pub async fn export_pdf(
    html_content: String,
    output_path: String,
    options: Option<PdfOptions>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        crate::export::generate_pdf(&html_content, &output_path, options)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| e.to_string())
}
