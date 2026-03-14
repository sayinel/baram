// §55 Pandoc Extended Export — Pandoc 감지, 실행, 커스텀 Export

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;
use tempfile::tempdir;

use super::ExportError;

/// Pandoc installation information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PandocInfo {
    pub path: String,
    pub version: String,
    pub available: bool,
}

/// Options for Pandoc export
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PandocExportOptions {
    /// Target format: "docx", "latex", "epub", "rst"
    pub format: String,
    /// Word reference document (template) path
    pub reference_doc: Option<String>,
    /// Additional Pandoc CLI arguments
    pub extra_args: Vec<String>,
}

/// Custom export command definition
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomExportItem {
    pub name: String,
    /// Shell command with variable placeholders: ${file}, ${basename}, ${output_dir}, ${vault_dir}
    pub command: String,
    pub extension: String,
    pub show_in_menu: bool,
}

/// Allowlist of permitted Pandoc CLI flags for extra_args validation.
const ALLOWED_PANDOC_FLAGS: &[&str] = &[
    "--standalone",
    "--toc",
    "--toc-depth",
    "--columns",
    "--wrap",
    "--number-sections",
    "--table-of-contents",
    "--highlight-style",
    "--pdf-engine",
    "--variable",
    "--metadata",
    "--from",
    "--to",
    "--slide-level",
    "--shift-heading-level-by",
];

/// Common Pandoc installation paths to probe when bare "pandoc" fails.
/// Covers Homebrew (Apple Silicon + Intel), system paths, and common installers.
const PANDOC_SEARCH_PATHS: &[&str] = &[
    "/opt/homebrew/bin/pandoc",
    "/usr/local/bin/pandoc",
    "/usr/bin/pandoc",
    "/opt/local/bin/pandoc",
];

/// Try running `pandoc --version` at the given path.
fn try_pandoc(path: &str) -> Option<PandocInfo> {
    let output = Command::new(path).arg("--version").output().ok()?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        Some(PandocInfo {
            path: path.to_string(),
            version: parse_pandoc_version(&stdout),
            available: true,
        })
    } else {
        None
    }
}

/// Detect Pandoc installation by running `pandoc --version`.
/// When a bare name like "pandoc" fails (common in sandboxed .app bundles
/// where PATH is limited to /usr/bin:/bin), probes well-known install paths.
pub fn detect_pandoc(pandoc_path: &str) -> PandocInfo {
    // 1. Try the user-supplied (or default) path first
    if let Some(info) = try_pandoc(pandoc_path) {
        return info;
    }

    // 2. If the caller passed an absolute path that failed, don't probe further
    if pandoc_path.starts_with('/') {
        return PandocInfo {
            path: pandoc_path.to_string(),
            version: String::new(),
            available: false,
        };
    }

    // 3. Probe well-known paths (handles .app bundle limited PATH)
    for candidate in PANDOC_SEARCH_PATHS {
        if let Some(info) = try_pandoc(candidate) {
            return info;
        }
    }

    PandocInfo {
        path: pandoc_path.to_string(),
        version: String::new(),
        available: false,
    }
}

/// Parse version string from `pandoc --version` output.
/// First line is typically: `pandoc X.Y.Z` or `pandoc X.Y.Z.W`
fn parse_pandoc_version(output: &str) -> String {
    output
        .lines()
        .next()
        .and_then(|line| {
            // "pandoc 3.1.9" -> "3.1.9"
            line.strip_prefix("pandoc ")
                .or_else(|| line.strip_prefix("pandoc.exe "))
        })
        .unwrap_or("unknown")
        .trim()
        .to_string()
}

/// Run Pandoc to convert a markdown file to the specified format.
///
/// 1. Writes markdown content to a temp file
/// 2. Runs pandoc with the specified options
/// 3. Output is written to `output_path`
pub fn run_pandoc(
    markdown_content: &str,
    output_path: &str,
    pandoc_path: &str,
    options: &PandocExportOptions,
) -> Result<(), ExportError> {
    // 1. Write markdown to temp file
    let tmp_dir = tempdir().map_err(|e| ExportError::TempFileError(e.to_string()))?;
    let input_path = tmp_dir.path().join("baram-pandoc-input.md");
    std::fs::write(&input_path, markdown_content)
        .map_err(|e| ExportError::TempFileError(e.to_string()))?;

    // 2. Build pandoc command
    let mut cmd = Command::new(pandoc_path);
    cmd.arg(input_path.to_str().unwrap_or("input.md"))
        .arg("-o")
        .arg(output_path)
        .arg("--from")
        .arg("markdown");

    // Add reference doc for docx
    if let Some(ref ref_doc) = options.reference_doc {
        if !ref_doc.is_empty() {
            cmd.arg("--reference-doc").arg(ref_doc);
        }
    }

    // Add extra args — validated against allowlist
    for arg in &options.extra_args {
        let flag = arg.split('=').next().unwrap_or(arg);
        let flag_base = flag.split(' ').next().unwrap_or(flag);
        if !ALLOWED_PANDOC_FLAGS.contains(&flag_base) {
            return Err(ExportError::PandocFailed(format!(
                "Disallowed pandoc argument: {}",
                flag_base
            )));
        }
        cmd.arg(arg);
    }

    // 3. Execute
    let output = cmd
        .output()
        .map_err(|e| ExportError::PandocNotFound(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ExportError::PandocFailed(stderr.to_string()));
    }

    Ok(())
}

/// Characters disallowed in variable values to prevent shell injection.
const DANGEROUS_CHARS: &[char] = &[';', '&', '|', '`', '$', '(', ')', '\n', '\r'];

/// Expand `${key}` placeholders in `template` with values from `vars`.
/// Returns an error if any variable value contains shell metacharacters.
fn expand_variables(template: &str, vars: &HashMap<String, String>) -> Result<String, ExportError> {
    let mut result = template.to_string();
    for (key, value) in vars {
        if value.chars().any(|c| DANGEROUS_CHARS.contains(&c)) {
            return Err(ExportError::CustomExportFailed(format!(
                "Variable '{}' contains disallowed characters",
                key
            )));
        }
        result = result.replace(&format!("${{{}}}", key), value);
    }
    Ok(result)
}

/// Run a custom export command with variable substitution.
///
/// Security: uses `shlex` to parse the expanded command into argv tokens and
/// executes directly via `Command::new` — no shell (`sh -c` / `cmd /C`) is
/// involved, preventing command injection.
///
/// Supported variables:
/// - `${file}` — full path of the source file
/// - `${basename}` — file name without extension
/// - `${output_dir}` — directory of the output path
/// - `${vault_dir}` — workspace root directory
pub fn run_custom_export(command: &str, vars: &HashMap<String, String>) -> Result<(), ExportError> {
    let expanded = expand_variables(command, vars)?;

    let parts = shlex::split(&expanded).ok_or_else(|| {
        ExportError::CustomExportFailed("Invalid command syntax (mismatched quotes)".into())
    })?;
    if parts.is_empty() {
        return Err(ExportError::CustomExportFailed(
            "Empty command after expansion".into(),
        ));
    }

    let output = Command::new(&parts[0])
        .args(&parts[1..])
        .output()
        .map_err(|e| {
            ExportError::CustomExportFailed(format!("Failed to execute command: {}", e))
        })?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(ExportError::CustomExportFailed(format!(
            "Command failed (exit {}): {}",
            output.status.code().unwrap_or(-1),
            stderr
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_pandoc_version() {
        assert_eq!(
            parse_pandoc_version("pandoc 3.1.9\nCompiled with pandoc-types"),
            "3.1.9"
        );
        assert_eq!(parse_pandoc_version("pandoc 2.19.2"), "2.19.2");
        assert_eq!(parse_pandoc_version(""), "unknown");
    }

    #[test]
    fn test_detect_pandoc_nonexistent() {
        let info = detect_pandoc("/nonexistent/pandoc");
        assert!(!info.available);
        assert_eq!(info.path, "/nonexistent/pandoc");
    }

    #[test]
    fn test_pandoc_export_options_deserialize() {
        let json = r#"{
            "format": "docx",
            "referenceDoc": "/path/to/template.docx",
            "extraArgs": ["--standalone", "--toc"]
        }"#;
        let opts: PandocExportOptions = serde_json::from_str(json).unwrap();
        assert_eq!(opts.format, "docx");
        assert_eq!(
            opts.reference_doc.as_deref(),
            Some("/path/to/template.docx")
        );
        assert_eq!(opts.extra_args, vec!["--standalone", "--toc"]);
    }

    #[test]
    fn test_pandoc_export_options_minimal() {
        let json = r#"{
            "format": "latex",
            "extraArgs": []
        }"#;
        let opts: PandocExportOptions = serde_json::from_str(json).unwrap();
        assert_eq!(opts.format, "latex");
        assert!(opts.reference_doc.is_none());
        assert!(opts.extra_args.is_empty());
    }

    #[test]
    fn test_custom_export_item_roundtrip() {
        let item = CustomExportItem {
            name: "AsciiDoc".to_string(),
            command: "pandoc ${file} -o ${basename}.adoc".to_string(),
            extension: "adoc".to_string(),
            show_in_menu: true,
        };
        let json = serde_json::to_string(&item).unwrap();
        let parsed: CustomExportItem = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "AsciiDoc");
        assert_eq!(parsed.extension, "adoc");
        assert!(parsed.show_in_menu);
    }

    #[test]
    fn test_variable_substitution() {
        let mut vars = HashMap::new();
        vars.insert("file".to_string(), "/home/user/doc.md".to_string());
        vars.insert("basename".to_string(), "doc".to_string());
        vars.insert("output_dir".to_string(), "/home/user/output".to_string());

        let cmd = "pandoc ${file} -o ${output_dir}/${basename}.docx";
        let mut expanded = cmd.to_string();
        for (key, value) in &vars {
            expanded = expanded.replace(&format!("${{{}}}", key), value);
        }
        assert_eq!(
            expanded,
            "pandoc /home/user/doc.md -o /home/user/output/doc.docx"
        );
    }

    #[test]
    fn test_expand_variables_rejects_shell_metacharacters() {
        let mut vars = HashMap::new();
        vars.insert("file".to_string(), "test`rm -rf /`.md".to_string());
        let result = expand_variables("echo ${file}", &vars);
        assert!(
            result.is_err(),
            "backtick in variable value must be rejected"
        );

        let mut vars2 = HashMap::new();
        vars2.insert("file".to_string(), "foo;rm -rf /".to_string());
        let result2 = expand_variables("echo ${file}", &vars2);
        assert!(
            result2.is_err(),
            "semicolon in variable value must be rejected"
        );

        let mut vars3 = HashMap::new();
        vars3.insert("file".to_string(), "foo|cat /etc/passwd".to_string());
        let result3 = expand_variables("echo ${file}", &vars3);
        assert!(result3.is_err(), "pipe in variable value must be rejected");

        let mut vars4 = HashMap::new();
        vars4.insert("file".to_string(), "$(whoami).md".to_string());
        let result4 = expand_variables("echo ${file}", &vars4);
        assert!(
            result4.is_err(),
            "dollar sign in variable value must be rejected"
        );
    }

    #[test]
    fn test_expand_variables_allows_safe_paths() {
        let mut vars = HashMap::new();
        vars.insert("file".to_string(), "/home/user/my doc.md".to_string());
        vars.insert("basename".to_string(), "my doc".to_string());
        let result = expand_variables("pandoc ${file} -o ${basename}.docx", &vars);
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap(),
            "pandoc /home/user/my doc.md -o my doc.docx"
        );
    }

    #[test]
    fn test_run_custom_export_rejects_mismatched_quotes() {
        let vars = HashMap::new();
        let result = run_custom_export("echo \"unclosed", &vars);
        assert!(result.is_err());
        let err_msg = format!("{:?}", result.unwrap_err());
        assert!(err_msg.contains("mismatched quotes"));
    }

    #[test]
    fn test_pandoc_info_serialize() {
        let info = PandocInfo {
            path: "/usr/bin/pandoc".to_string(),
            version: "3.1.9".to_string(),
            available: true,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"available\":true"));
        assert!(json.contains("\"version\":\"3.1.9\""));
    }
}
