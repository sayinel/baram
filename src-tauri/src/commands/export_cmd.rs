// §5.10 내보내기 IPC 커맨드 — PDF + HTML 통합
// §55 Pandoc Extended Export — Pandoc 기반 다중 포맷 내보내기

use crate::export::pandoc::{self, PandocExportOptions};
use crate::export::PdfOptions;
use std::collections::HashMap;

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

/// §55 Pandoc 감지 — pandoc --version 실행하여 설치 여부 확인
#[tauri::command]
pub async fn detect_pandoc(pandoc_path: Option<String>) -> Result<pandoc::PandocInfo, String> {
    let path = pandoc_path.unwrap_or_else(|| "pandoc".to_string());
    tokio::task::spawn_blocking(move || pandoc::detect_pandoc(&path))
        .await
        .map_err(|e| format!("Task join error: {}", e))
}

/// §55 Pandoc 내보내기 — markdown → docx/latex/epub/rst
#[tauri::command]
pub async fn export_pandoc(
    markdown_content: String,
    output_path: String,
    format: String,
    pandoc_path: Option<String>,
    reference_doc: Option<String>,
    extra_args: Option<Vec<String>>,
) -> Result<(), String> {
    let path = pandoc_path.unwrap_or_else(|| "pandoc".to_string());
    let options = PandocExportOptions {
        format,
        reference_doc,
        extra_args: extra_args.unwrap_or_default(),
    };

    tokio::task::spawn_blocking(move || {
        pandoc::run_pandoc(&markdown_content, &output_path, &path, &options)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| e.to_string())
}

/// §55 커스텀 내보내기 — 사용자 정의 셸 명령 실행
#[tauri::command]
pub async fn run_custom_export(
    command: String,
    file_path: String,
    output_path: String,
    vault_dir: Option<String>,
) -> Result<(), String> {
    let mut vars = HashMap::new();
    vars.insert("file".to_string(), file_path.clone());

    // Extract basename (filename without extension)
    let basename = std::path::Path::new(&file_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("document")
        .to_string();
    vars.insert("basename".to_string(), basename);

    // Extract output directory
    let output_dir = std::path::Path::new(&output_path)
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or(".")
        .to_string();
    vars.insert("output_dir".to_string(), output_dir);

    if let Some(vault) = vault_dir {
        vars.insert("vault_dir".to_string(), vault);
    }

    tokio::task::spawn_blocking(move || pandoc::run_custom_export(&command, &vars))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
        .map_err(|e| e.to_string())
}
