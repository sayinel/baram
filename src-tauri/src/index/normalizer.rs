// §29 Path normalizer helpers — wikilink target and file path normalization

use std::path::Path;

/// Normalize a wikilink target to a comparable key (lowercase, no extension)
pub(crate) fn normalize_target(target: &str) -> String {
    let t = target.trim();
    let t = t.strip_suffix(".md").unwrap_or(t);
    t.to_lowercase()
}

/// The key a FILE at this path is filed under — its stem through `file_key`,
/// e.g. "/vault/notes/architecture.md" → "architecture". Read `file_key`
/// before reaching for this or for `normalize_target`: they agree on a note
/// and part ways on a file whose stem itself ends in `.md`, and picking the
/// link rule for a file is how a rename once claimed another note's links.
pub(crate) fn normalize_file_path(path: &str) -> String {
    let file_name = Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    file_key(&file_name)
}

/// The key a FILE is filed under, from its stem: the case folded, nothing
/// stripped. For a note it is what its links normalize to (`[[Note]]`,
/// `[[note.md]]` → `note`); for a file whose stem itself ends in `.md`
/// (`diagram.md.txt` → `diagram.md`) it is not — `normalize_target` would
/// strip that `.md` and hand back the NOTE `diagram.md`'s key. A rename that
/// asks which links name a file must ask by this key, or it claims the
/// note's links.
pub(crate) fn file_key(stem: &str) -> String {
    stem.to_lowercase()
}

/// Resolve a wikilink target to a possible file path
pub(crate) fn resolve_target(root: &str, normalized_target: &str) -> String {
    format!("{}/{}.md", root, normalized_target)
}

/// Extract the leading timestamp-id run (12–14 digits) from a filename stem.
/// The id is the run of leading ASCII digits before the first space (or end),
/// accepted only when its length is 12–14.
pub(crate) fn extract_id_from_stem(stem: &str) -> Option<String> {
    let head = stem.split(' ').next().unwrap_or(stem);
    if head.len() >= 12 && head.len() <= 14 && head.bytes().all(|b| b.is_ascii_digit()) {
        Some(head.to_string())
    } else {
        None
    }
}

/// True iff the whole normalized target is a bare 12–14 digit id (e.g. `[[202607051530]]`).
pub(crate) fn is_id_target(target_normalized: &str) -> bool {
    target_normalized.len() >= 12
        && target_normalized.len() <= 14
        && target_normalized.bytes().all(|b| b.is_ascii_digit())
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
    fn test_extract_id_from_stem() {
        assert_eq!(
            extract_id_from_stem("202607051530 원자적 노트"),
            Some("202607051530".to_string())
        );
        assert_eq!(
            extract_id_from_stem("202607051530"),
            Some("202607051530".to_string())
        );
        assert_eq!(
            extract_id_from_stem("20260705153012 note"),
            Some("20260705153012".to_string())
        );
        assert_eq!(extract_id_from_stem("architecture"), None);
        assert_eq!(extract_id_from_stem("2026 draft"), None); // too short
        assert_eq!(extract_id_from_stem(""), None);
    }

    #[test]
    fn test_is_id_target() {
        assert!(is_id_target("202607051530"));
        assert!(is_id_target("20260705153012"));
        assert!(!is_id_target("202607051530 원자적 노트")); // has trailing text
        assert!(!is_id_target("architecture"));
        assert!(!is_id_target("2026")); // too short
    }
}
