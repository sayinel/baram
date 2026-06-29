// §3.6 3-way merge — diffy-based, with conflict regions structured for the
// merge-resolution UI. Non-conflicting edits are auto-merged into stable
// segments; overlapping edits become conflict segments carrying both candidates.

use super::{MergeResult, MergeSegment};

/// Compute a 3-way merge of `base` → (`local`, `external`).
pub fn merge_texts(base: &str, local: &str, external: &str) -> MergeResult {
    match diffy::merge(base, local, external) {
        Ok(merged) => MergeResult {
            segments: vec![MergeSegment::Stable {
                lines: to_lines(&merged),
            }],
        },
        Err(conflicted) => parse_conflicts(&conflicted),
    }
}

fn to_lines(text: &str) -> Vec<String> {
    text.lines().map(str::to_string).collect()
}

#[derive(PartialEq)]
enum Section {
    Stable,
    Ours,
    Base,
    Theirs,
}

/// Parse diffy's conflict markers into structured segments.
/// Markers: `<<<<<<<` (ours/local start), `|||||||` (base, skipped),
/// `=======` (theirs/external start), `>>>>>>>` (conflict end).
fn parse_conflicts(text: &str) -> MergeResult {
    let mut segments = Vec::new();
    let mut stable: Vec<String> = Vec::new();
    let mut local: Vec<String> = Vec::new();
    let mut external: Vec<String> = Vec::new();
    let mut section = Section::Stable;

    for line in text.lines() {
        if line.starts_with("<<<<<<<") {
            if !stable.is_empty() {
                segments.push(MergeSegment::Stable {
                    lines: std::mem::take(&mut stable),
                });
            }
            section = Section::Ours;
        } else if line.starts_with("|||||||") {
            section = Section::Base;
        } else if line.starts_with("=======") {
            section = Section::Theirs;
        } else if line.starts_with(">>>>>>>") {
            segments.push(MergeSegment::Conflict {
                local: std::mem::take(&mut local),
                external: std::mem::take(&mut external),
            });
            section = Section::Stable;
        } else {
            match section {
                Section::Stable => stable.push(line.to_string()),
                Section::Ours => local.push(line.to_string()),
                Section::Theirs => external.push(line.to_string()),
                Section::Base => {}
            }
        }
    }
    if !stable.is_empty() {
        segments.push(MergeSegment::Stable { lines: stable });
    }
    MergeResult { segments }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn has_conflict(r: &MergeResult) -> bool {
        r.segments
            .iter()
            .any(|s| matches!(s, MergeSegment::Conflict { .. }))
    }

    #[test]
    fn identical_inputs_have_no_conflict() {
        let r = merge_texts("a\nb\nc\n", "a\nb\nc\n", "a\nb\nc\n");
        assert!(!has_conflict(&r));
    }

    #[test]
    fn non_overlapping_edits_auto_merge() {
        // local edits line 1, external edits line 3 — no overlap
        let r = merge_texts("a\nb\nc\n", "A\nb\nc\n", "a\nb\nC\n");
        assert!(!has_conflict(&r));
    }

    #[test]
    fn overlapping_edits_conflict() {
        // both edit line 2 differently
        let r = merge_texts("a\nb\nc\n", "a\nLOCAL\nc\n", "a\nEXTERNAL\nc\n");
        assert!(has_conflict(&r));
        let conflict = r
            .segments
            .iter()
            .find_map(|s| match s {
                MergeSegment::Conflict { local, external } => Some((local, external)),
                _ => None,
            })
            .expect("expected a conflict segment");
        assert!(conflict.0.iter().any(|l| l.contains("LOCAL")));
        assert!(conflict.1.iter().any(|l| l.contains("EXTERNAL")));
    }
}
