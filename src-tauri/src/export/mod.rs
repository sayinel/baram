// §5.10 PDF/HTML 내보내기 모듈 — headless Chrome 기반 PDF 생성

use headless_chrome::{Browser, LaunchOptions};
use serde::Deserialize;
use std::fs;
use std::io::Write;
use tempfile::tempdir;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ExportError {
    #[error("Chrome not found. Please install Google Chrome or Chromium to export PDF.")]
    ChromeNotFound,

    #[error("Failed to launch browser: {0}")]
    BrowserLaunchFailed(String),

    #[error("Failed to navigate to page: {0}")]
    NavigationFailed(String),

    #[error("PDF generation failed: {0}")]
    PdfGenerationFailed(String),

    #[error("Failed to create temporary file: {0}")]
    TempFileError(String),

    #[error("Failed to save PDF: {0}")]
    SaveError(String),
}

/// PDF export options matching frontend PdfOptions interface.
/// Uses camelCase for JSON deserialization from TypeScript.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOptions {
    /// Paper size: "a4" or "letter"
    pub paper_size: Option<String>,
    /// Landscape orientation
    pub landscape: Option<bool>,
    /// Print background graphics
    pub print_background: Option<bool>,
    /// Scale factor (0.1 to 2.0)
    pub scale: Option<f64>,
    /// Top margin in inches
    pub margin_top: Option<f64>,
    /// Bottom margin in inches
    pub margin_bottom: Option<f64>,
    /// Left margin in inches
    pub margin_left: Option<f64>,
    /// Right margin in inches
    pub margin_right: Option<f64>,
}

impl PdfOptions {
    /// Paper width in inches
    fn paper_width(&self) -> f64 {
        match self.paper_size.as_deref() {
            Some("letter") => 8.5,
            _ => 8.27, // A4
        }
    }

    /// Paper height in inches
    fn paper_height(&self) -> f64 {
        match self.paper_size.as_deref() {
            Some("letter") => 11.0,
            _ => 11.69, // A4
        }
    }
}

impl Default for PdfOptions {
    fn default() -> Self {
        Self {
            paper_size: Some("a4".to_string()),
            landscape: Some(false),
            print_background: Some(true),
            scale: Some(1.0),
            margin_top: Some(0.4),
            margin_bottom: Some(0.4),
            margin_left: Some(0.4),
            margin_right: Some(0.4),
        }
    }
}

/// Generate a PDF from standalone HTML content using headless Chrome.
///
/// 1. Writes HTML to a temp file (avoids data URI length limits)
/// 2. Launches headless Chrome and navigates to the temp file
/// 3. Calls print_to_pdf with configured options
/// 4. Writes PDF atomically to output_path
pub fn generate_pdf(
    html: &str,
    output_path: &str,
    options: Option<PdfOptions>,
) -> Result<(), ExportError> {
    let opts = options.unwrap_or_default();

    // 1. Write HTML to temp file
    let tmp_dir = tempdir().map_err(|e| ExportError::TempFileError(e.to_string()))?;
    let html_path = tmp_dir.path().join("baram-export.html");
    {
        let mut file =
            fs::File::create(&html_path).map_err(|e| ExportError::TempFileError(e.to_string()))?;
        file.write_all(html.as_bytes())
            .map_err(|e| ExportError::TempFileError(e.to_string()))?;
    }

    // 2. Launch headless Chrome
    let launch_options = LaunchOptions {
        headless: true,
        sandbox: false,
        ..Default::default()
    };

    let browser = Browser::new(launch_options).map_err(|e| {
        let msg = e.to_string();
        if msg.contains("not found") || msg.contains("No such file") {
            ExportError::ChromeNotFound
        } else {
            ExportError::BrowserLaunchFailed(msg)
        }
    })?;

    let tab = browser
        .new_tab()
        .map_err(|e| ExportError::BrowserLaunchFailed(e.to_string()))?;

    // 3. Navigate to temp HTML file
    let file_url = format!("file://{}", html_path.display());
    tab.navigate_to(&file_url)
        .map_err(|e| ExportError::NavigationFailed(e.to_string()))?;

    tab.wait_until_navigated()
        .map_err(|e| ExportError::NavigationFailed(e.to_string()))?;

    // 4. Print to PDF
    let pdf_bytes = tab
        .print_to_pdf(Some(headless_chrome::types::PrintToPdfOptions {
            landscape: opts.landscape,
            display_header_footer: Some(false),
            print_background: opts.print_background,
            scale: opts.scale,
            paper_width: Some(opts.paper_width()),
            paper_height: Some(opts.paper_height()),
            margin_top: opts.margin_top,
            margin_bottom: opts.margin_bottom,
            margin_left: opts.margin_left,
            margin_right: opts.margin_right,
            page_ranges: None,
            ignore_invalid_page_ranges: None,
            header_template: None,
            footer_template: None,
            prefer_css_page_size: None,
            transfer_mode: None,
            generate_tagged_pdf: None,
            generate_document_outline: None,
        }))
        .map_err(|e| ExportError::PdfGenerationFailed(e.to_string()))?;

    // 5. Atomic write: .pdf.tmp → rename → done
    let tmp_pdf_path = format!("{}.tmp", output_path);
    fs::write(&tmp_pdf_path, &pdf_bytes).map_err(|e| ExportError::SaveError(e.to_string()))?;
    fs::rename(&tmp_pdf_path, output_path).map_err(|e| ExportError::SaveError(e.to_string()))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pdf_options_default() {
        let opts = PdfOptions::default();
        assert_eq!(opts.paper_size.as_deref(), Some("a4"));
        assert_eq!(opts.landscape, Some(false));
        assert_eq!(opts.print_background, Some(true));
        assert_eq!(opts.scale, Some(1.0));
        assert_eq!(opts.margin_top, Some(0.4));
    }

    #[test]
    fn test_pdf_options_a4_dimensions() {
        let opts = PdfOptions {
            paper_size: Some("a4".to_string()),
            ..Default::default()
        };
        assert!((opts.paper_width() - 8.27).abs() < 0.01);
        assert!((opts.paper_height() - 11.69).abs() < 0.01);
    }

    #[test]
    fn test_pdf_options_letter_dimensions() {
        let opts = PdfOptions {
            paper_size: Some("letter".to_string()),
            ..Default::default()
        };
        assert!((opts.paper_width() - 8.5).abs() < 0.01);
        assert!((opts.paper_height() - 11.0).abs() < 0.01);
    }

    #[test]
    fn test_pdf_options_camel_case_deserialize() {
        let json = r#"{
            "paperSize": "letter",
            "landscape": true,
            "printBackground": false,
            "scale": 0.8,
            "marginTop": 0.5,
            "marginBottom": 0.5,
            "marginLeft": 0.75,
            "marginRight": 0.75
        }"#;
        let opts: PdfOptions = serde_json::from_str(json).unwrap();
        assert_eq!(opts.paper_size.as_deref(), Some("letter"));
        assert_eq!(opts.landscape, Some(true));
        assert_eq!(opts.print_background, Some(false));
        assert_eq!(opts.scale, Some(0.8));
        assert_eq!(opts.margin_left, Some(0.75));
    }

    #[test]
    #[ignore] // Requires Chrome installed — run with: cargo test -- --ignored
    fn test_generate_pdf_integration() {
        let html = r#"<!DOCTYPE html>
<html><head><title>Test</title></head>
<body><h1>Hello PDF</h1><p>Test content</p></body></html>"#;

        let tmp_dir = tempdir().unwrap();
        let output_path = tmp_dir.path().join("test-output.pdf");
        let output_str = output_path.to_str().unwrap();

        let result = generate_pdf(html, output_str, None);
        assert!(result.is_ok(), "generate_pdf failed: {:?}", result.err());

        // Verify PDF was created and has reasonable size
        let metadata = std::fs::metadata(&output_path).unwrap();
        assert!(metadata.len() > 100, "PDF file too small");

        // Verify PDF magic bytes
        let bytes = std::fs::read(&output_path).unwrap();
        assert_eq!(&bytes[..5], b"%PDF-", "Not a valid PDF file");
    }
}
