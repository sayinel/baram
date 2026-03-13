// §29 Path normalizer helpers — wikilink target and file path normalization

use std::path::Path;

/// Normalize a wikilink target to a comparable key (lowercase, no extension)
pub(crate) fn normalize_target(target: &str) -> String {
    let t = target.trim();
    let t = t.strip_suffix(".md").unwrap_or(t);
    t.to_lowercase()
}

/// Normalize a file path to match against wikilink targets
/// e.g., "/vault/notes/architecture.md" → "architecture"
pub(crate) fn normalize_file_path(path: &str) -> String {
    let file_name = Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    file_name.to_lowercase()
}

/// Resolve a wikilink target to a possible file path
pub(crate) fn resolve_target(root: &str, normalized_target: &str) -> String {
    format!("{}/{}.md", root, normalized_target)
}

/// §61 Resolve a relative path against a base directory to an absolute path (no .md extension)
pub(crate) fn resolve_relative_path(base_dir: &str, relative: &str) -> String {
    let combined = format!("{}/{}", base_dir, relative);
    let parts: Vec<&str> = combined.split('/').collect();
    let mut resolved: Vec<&str> = Vec::new();

    for part in &parts {
        match *part {
            "." | "" => continue,
            ".." => {
                resolved.pop();
            }
            _ => resolved.push(part),
        }
    }

    let result = resolved.join("/");
    if base_dir.starts_with('/') {
        format!("/{}", result)
    } else {
        result
    }
}

/// §61 Compute a relative path from source_dir to target_path (without .md extension)
pub(crate) fn make_relative_path(source_dir: &str, target_path: &str) -> String {
    let src_parts: Vec<&str> = source_dir.split('/').filter(|s| !s.is_empty()).collect();
    let tgt_parts: Vec<&str> = target_path.split('/').filter(|s| !s.is_empty()).collect();

    // Find common prefix length
    let common = src_parts
        .iter()
        .zip(tgt_parts.iter())
        .take_while(|(a, b)| a == b)
        .count();

    let ups = src_parts.len() - common;
    let mut result = String::new();

    if ups == 0 {
        result.push_str("./");
    } else {
        for _ in 0..ups {
            result.push_str("../");
        }
    }

    let remaining: Vec<&str> = tgt_parts[common..].to_vec();
    result.push_str(&remaining.join("/"));

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_target() {
        assert_eq!(normalize_target("Architecture"), "architecture");
        assert_eq!(normalize_target("notes.md"), "notes");
        assert_eq!(normalize_target("  spaces  "), "spaces");
    }

    #[test]
    fn test_normalize_file_path() {
        assert_eq!(
            normalize_file_path("/vault/notes/architecture.md"),
            "architecture"
        );
        assert_eq!(normalize_file_path("/single.md"), "single");
        assert_eq!(normalize_file_path("relative.md"), "relative");
    }

    #[test]
    fn test_resolve_relative_path() {
        assert_eq!(
            resolve_relative_path("/vault/notes", "./ai/prompt"),
            "/vault/notes/ai/prompt"
        );
        assert_eq!(
            resolve_relative_path("/vault/notes/ai", "../meeting"),
            "/vault/notes/meeting"
        );
        assert_eq!(
            resolve_relative_path("/vault/notes/ai", "../../readme"),
            "/vault/readme"
        );
    }

    #[test]
    fn test_make_relative_path() {
        assert_eq!(
            make_relative_path("/vault/notes", "/vault/notes/ml/prompt"),
            "./ml/prompt"
        );
        assert_eq!(
            make_relative_path("/vault/notes/sub", "/vault/notes/ml/prompt"),
            "../ml/prompt"
        );
        assert_eq!(
            make_relative_path("/vault", "/vault/notes/ml/prompt"),
            "./notes/ml/prompt"
        );
    }
}
