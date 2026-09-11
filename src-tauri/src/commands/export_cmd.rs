// §5.10 내보내기 IPC 커맨드 — PDF + HTML 통합
// §55 Pandoc Extended Export — Pandoc 기반 다중 포맷 내보내기

use crate::export::pandoc::{self, PandocAsset, PandocExportOptions};
use crate::export::pandoc_images::{ImageStaging, PandocImageRequest};
use crate::export::PdfOptions;
use std::collections::HashMap;

#[tauri::command]
pub async fn export_pdf(
    html_content: String,
    output_path: String,
    options: Option<PdfOptions>,
) -> Result<(), String> {
    crate::export::generate_pdf(&html_content, &output_path, options)
        .await
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
            crate::export::generate_pdf(&html_content, &output_path, pdf_options)
                .await
                .map_err(|e| e.to_string())
        }
        "html" => {
            crate::fs::validate_path(&output_path).map_err(|e| e.to_string())?;
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
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn export_pandoc(
    markdown_content: String,
    output_path: String,
    format: String,
    pandoc_path: Option<String>,
    reference_doc: Option<String>,
    extra_args: Option<Vec<String>>,
    assets: Option<Vec<PandocAsset>>,
    images: Option<Vec<PandocImageRequest>>,
    document_path: Option<String>,
    document_context_id: Option<String>,
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
) -> Result<(), String> {
    let path = pandoc_path.unwrap_or_else(|| "pandoc".to_string());
    let options = PandocExportOptions {
        format,
        reference_doc,
        extra_args: extra_args.unwrap_or_default(),
    };
    let assets = assets.unwrap_or_default();
    let images = images.unwrap_or_default();
    // issue 545: the images the document refers to by relative path are copied
    // into the export's temporary directory HERE, behind the vault boundary,
    // and pandoc reads only those copies (`export/pandoc_images.rs`). The
    // boundary is the vault or folder context the frontend named as the
    // document's owner, verified on canonical paths — and nothing wider: a
    // request whose named context does not hold the document fails. The
    // directory the relative paths start from is taken from the document
    // path here, with the platform's rules, not by a `/`-only split in the
    // webview that would hand Windows an empty directory.
    let staging_paths = if images.is_empty() {
        None
    } else {
        let doc = document_path.as_deref().ok_or_else(|| {
            format!(
                "{}: the document has not been saved, so its relative image paths cannot be resolved",
                images[0].source
            )
        })?;
        let dir = std::path::Path::new(doc)
            .parent()
            .map(std::path::Path::to_path_buf)
            .ok_or_else(|| format!("{doc}: has no directory"))?;
        let root = ctx_mgr
            .owning_directory_root(doc, document_context_id.as_deref())
            .await
            .ok_or_else(|| {
                format!(
                    "{}: the document is not inside the vault or folder the export named",
                    images[0].source
                )
            })?;
        Some((dir, root))
    };

    tokio::task::spawn_blocking(move || {
        let staging = staging_paths.as_ref().map(|(dir, root)| ImageStaging {
            document_dir: dir,
            root,
            requests: &images,
        });
        pandoc::run_pandoc(
            &markdown_content,
            &output_path,
            &path,
            &options,
            &assets,
            staging.as_ref(),
        )
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
