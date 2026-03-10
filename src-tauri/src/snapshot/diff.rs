// §71 스냅샷 텍스트 diff — similar crate 기반 라인 레벨 Myers diff

use super::index::{find_entry, load_index};
use super::{DiffChange, DiffHunk, DiffResult, DiffStats, SnapshotError};
use crate::snapshot::io::snapshot_data_dir;
use similar::{ChangeTag, TextDiff};
use std::path::Path;

/// Context lines around each hunk (standard unified diff default).
const CONTEXT_LINES: usize = 3;

/// Compute line-level diff between old and new text.
pub fn compute_diff(old_text: &str, new_text: &str) -> DiffResult {
    let diff = TextDiff::from_lines(old_text, new_text);

    let mut hunks = Vec::new();
    let mut stats = DiffStats {
        additions: 0,
        deletions: 0,
        unchanged: 0,
    };

    // Collect all changes with line numbers
    let mut changes: Vec<(ChangeTag, usize, usize, String)> = Vec::new();
    let mut old_line: usize = 1;
    let mut new_line: usize = 1;

    for change in diff.iter_all_changes() {
        let tag = change.tag();
        let content = change.value().to_string();
        let ol = old_line;
        let nl = new_line;

        match tag {
            ChangeTag::Equal => {
                stats.unchanged += 1;
                old_line += 1;
                new_line += 1;
            }
            ChangeTag::Delete => {
                stats.deletions += 1;
                old_line += 1;
            }
            ChangeTag::Insert => {
                stats.additions += 1;
                new_line += 1;
            }
        }

        changes.push((tag, ol, nl, content));
    }

    // Group changes into hunks with context
    if changes.is_empty() {
        return DiffResult { hunks, stats };
    }

    // Find ranges of non-equal changes, then expand with context
    let mut change_ranges: Vec<(usize, usize)> = Vec::new();
    let mut i = 0;
    while i < changes.len() {
        if changes[i].0 != ChangeTag::Equal {
            let start = i;
            while i < changes.len() && changes[i].0 != ChangeTag::Equal {
                i += 1;
            }
            change_ranges.push((start, i));
        } else {
            i += 1;
        }
    }

    // Expand ranges with context and merge overlapping
    let mut expanded: Vec<(usize, usize)> = Vec::new();
    for (start, end) in change_ranges {
        let ctx_start = start.saturating_sub(CONTEXT_LINES);
        let ctx_end = (end + CONTEXT_LINES).min(changes.len());

        if let Some(last) = expanded.last_mut() {
            if ctx_start <= last.1 {
                // Merge overlapping ranges
                last.1 = ctx_end;
                continue;
            }
        }
        expanded.push((ctx_start, ctx_end));
    }

    // Build hunks from expanded ranges
    for (range_start, range_end) in expanded {
        let mut hunk_changes = Vec::new();
        let mut old_start = 0;
        let mut new_start = 0;
        let mut old_count = 0;
        let mut new_count = 0;
        let mut first = true;

        for change in changes.iter().take(range_end).skip(range_start) {
            let (tag, ol, nl, ref content) = *change;

            if first {
                old_start = ol;
                new_start = nl;
                first = false;
            }

            let change_type = match tag {
                ChangeTag::Equal => {
                    old_count += 1;
                    new_count += 1;
                    "equal"
                }
                ChangeTag::Delete => {
                    old_count += 1;
                    "delete"
                }
                ChangeTag::Insert => {
                    new_count += 1;
                    "insert"
                }
            };

            hunk_changes.push(DiffChange {
                change_type: change_type.to_string(),
                content: content.clone(),
            });
        }

        hunks.push(DiffHunk {
            old_start,
            old_count,
            new_start,
            new_count,
            changes: hunk_changes,
        });
    }

    DiffResult { hunks, stats }
}

/// Diff a file between its snapshot version and the current version.
pub fn diff_snapshot_file(
    vault_path: &str,
    snapshot_id: &str,
    file_path: &str,
) -> Result<DiffResult, SnapshotError> {
    let index = load_index(vault_path)?;

    let entry = find_entry(&index, snapshot_id)
        .ok_or_else(|| SnapshotError::NotFound(snapshot_id.to_string()))?;

    // Find the file in this snapshot's data dir, or walk backwards
    let target_idx = index
        .snapshots
        .iter()
        .position(|e| e.id == snapshot_id)
        .ok_or_else(|| SnapshotError::NotFound(snapshot_id.to_string()))?;

    let mut old_text = String::new();
    let mut found = false;

    // Walk backwards from the target snapshot to find the actual file data
    for i in (0..=target_idx).rev() {
        let snap = &index.snapshots[i];
        if snap.files.iter().any(|f| f.path == file_path) {
            let data_file = snapshot_data_dir(vault_path, &snap.id).join(file_path);
            if data_file.exists() {
                old_text = std::fs::read_to_string(&data_file)?;
                found = true;
                break;
            }
        }
    }

    if !found {
        // File not found in snapshot — check if it's listed in the entry
        // (might have been unchanged and not copied)
        if entry.files.iter().any(|f| f.path == file_path) {
            // File was tracked but data wasn't stored (unchanged from previous)
            // Return empty diff
            return Ok(DiffResult {
                hunks: Vec::new(),
                stats: DiffStats {
                    additions: 0,
                    deletions: 0,
                    unchanged: 0,
                },
            });
        }
        return Err(SnapshotError::NotFound(format!(
            "파일을 스냅샷에서 찾을 수 없습니다: {}",
            file_path
        )));
    }

    // Read current file
    let current_path = Path::new(vault_path).join(file_path);
    let new_text = if current_path.exists() {
        std::fs::read_to_string(&current_path)?
    } else {
        String::new() // File was deleted
    };

    Ok(compute_diff(&old_text, &new_text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diff_equal_texts() {
        let result = compute_diff("hello\nworld\n", "hello\nworld\n");
        assert!(result.hunks.is_empty());
        assert_eq!(result.stats.additions, 0);
        assert_eq!(result.stats.deletions, 0);
        assert_eq!(result.stats.unchanged, 2);
    }

    #[test]
    fn test_diff_insertion() {
        let result = compute_diff("line1\nline3\n", "line1\nline2\nline3\n");
        assert_eq!(result.stats.additions, 1);
        assert_eq!(result.stats.deletions, 0);
        assert_eq!(result.stats.unchanged, 2);
        assert!(!result.hunks.is_empty());

        // Verify the inserted line
        let has_insert = result.hunks.iter().any(|h| {
            h.changes
                .iter()
                .any(|c| c.change_type == "insert" && c.content.contains("line2"))
        });
        assert!(has_insert);
    }

    #[test]
    fn test_diff_deletion() {
        let result = compute_diff("line1\nline2\nline3\n", "line1\nline3\n");
        assert_eq!(result.stats.additions, 0);
        assert_eq!(result.stats.deletions, 1);
        assert_eq!(result.stats.unchanged, 2);

        let has_delete = result.hunks.iter().any(|h| {
            h.changes
                .iter()
                .any(|c| c.change_type == "delete" && c.content.contains("line2"))
        });
        assert!(has_delete);
    }

    #[test]
    fn test_diff_mixed_changes() {
        let old = "# Title\n\nParagraph 1\n\nParagraph 2\n\nEnd\n";
        let new = "# Title\n\nParagraph 1 modified\n\nNew paragraph\n\nParagraph 2\n\nEnd\n";
        let result = compute_diff(old, new);

        assert!(result.stats.additions > 0);
        assert!(result.stats.deletions > 0);
        assert!(result.stats.unchanged > 0);
    }

    #[test]
    fn test_diff_empty_old() {
        let result = compute_diff("", "line1\nline2\n");
        assert_eq!(result.stats.additions, 2);
        assert_eq!(result.stats.deletions, 0);
        assert_eq!(result.stats.unchanged, 0);
    }

    #[test]
    fn test_diff_empty_new() {
        let result = compute_diff("line1\nline2\n", "");
        assert_eq!(result.stats.additions, 0);
        assert_eq!(result.stats.deletions, 2);
        assert_eq!(result.stats.unchanged, 0);
    }

    #[test]
    fn test_diff_both_empty() {
        let result = compute_diff("", "");
        assert!(result.hunks.is_empty());
        assert_eq!(result.stats.additions, 0);
        assert_eq!(result.stats.deletions, 0);
        assert_eq!(result.stats.unchanged, 0);
    }

    #[test]
    fn test_diff_hunk_context() {
        // Create a diff with changes far apart to test separate hunks
        let mut old_lines = Vec::new();
        let mut new_lines = Vec::new();
        for i in 1..=20 {
            old_lines.push(format!("line{}\n", i));
            if i == 5 {
                new_lines.push("line5-modified\n".to_string());
            } else if i == 15 {
                new_lines.push("line15-modified\n".to_string());
            } else {
                new_lines.push(format!("line{}\n", i));
            }
        }
        let old = old_lines.join("");
        let new = new_lines.join("");

        let result = compute_diff(&old, &new);
        // Changes at line 5 and 15 are far enough apart (10 lines gap > 2*CONTEXT_LINES)
        // to be in separate hunks
        assert!(
            result.hunks.len() >= 2,
            "Expected at least 2 hunks, got {}",
            result.hunks.len()
        );
    }

    #[test]
    fn test_diff_hunk_line_numbers() {
        let result = compute_diff("a\nb\nc\n", "a\nx\nc\n");
        assert_eq!(result.hunks.len(), 1);
        let hunk = &result.hunks[0];
        // Hunk should cover the change area with context
        assert!(hunk.old_count > 0);
        assert!(hunk.new_count > 0);
    }

    #[test]
    fn test_diff_snapshot_file_integration() {
        let tmp = tempfile::TempDir::new().unwrap();
        let vault = tmp.path().to_string_lossy().to_string();

        // Create a file
        std::fs::write(tmp.path().join("test.md"), "# Original\n\nContent\n").unwrap();

        // Create snapshot
        let snap_id = crate::snapshot::io::create_snapshot(&vault, "auto", None).unwrap();

        // Modify the file
        std::fs::write(tmp.path().join("test.md"), "# Modified\n\nNew content\n").unwrap();

        // Get diff
        let result = diff_snapshot_file(&vault, &snap_id, "test.md").unwrap();
        assert!(result.stats.additions > 0 || result.stats.deletions > 0);
    }
}
