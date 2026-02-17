// §5.10 내보내기 IPC 커맨드 — PDF + HTML 통합

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

/// 통합 내보내기 커맨드 — format에 따라 PDF 또는 HTML 파일로 저장
#[tauri::command]
pub async fn export_document(
    html_content: String,
    output_path: String,
    format: String,
    options: Option<serde_json::Value>,
) -> Result<(), String> {
    match format.as_str() {
        "pdf" => {
            let pdf_options: Option<PdfOptions> = options
                .map(|v| serde_json::from_value(v).map_err(|e| e.to_string()))
                .transpose()?;
            tokio::task::spawn_blocking(move || {
                crate::export::generate_pdf(&html_content, &output_path, pdf_options)
            })
            .await
            .map_err(|e| format!("Task join error: {}", e))?
            .map_err(|e| e.to_string())
        }
        "html" => {
            tokio::fs::write(&output_path, html_content.as_bytes())
                .await
                .map_err(|e| format!("HTML 저장 실패: {}", e))
        }
        _ => Err(format!("지원하지 않는 형식: {}", format)),
    }
}
