// §3.6 3-way line merge (diff3). Each side's edits are extracted as hunks in
// base coordinates; non-overlapping hunks are auto-applied (rendered as +/-),
// and only hunks that overlap the same base region become conflicts.

use super::{MergeResult, MergeSegment};
use similar::{ChangeTag, DiffTag, TextDiff};

struct Hunk {
    base_start: usize,
    base_end: usize,
    lines: Vec<String>,
}

/// Compute a structured 3-way merge of `base` → (`local`, `external`).
pub fn merge_texts(base: &str, local: &str, external: &str) -> MergeResult {
    let base_lines: Vec<&str> = base.lines().collect();
    let local_lines: Vec<&str> = local.lines().collect();
    let external_lines: Vec<&str> = external.lines().collect();

    let local_match = match_map(&base_lines, &local_lines);
    let external_match = match_map(&base_lines, &external_lines);
    let lh = changed_hunks(&base_lines, &local_lines);
    let eh = changed_hunks(&base_lines, &external_lines);

    let mut segments: Vec<MergeSegment> = Vec::new();
    let n = base_lines.len();
    let mut bi = 0usize;
    let mut li = 0usize;
    let mut ei = 0usize;

    loop {
        let l_start = lh.get(li).map(|h| h.base_start);
        let e_start = eh.get(ei).map(|h| h.base_start);

        // Emit unchanged base lines up to the next change.
        let next = match (l_start, e_start) {
            (Some(a), Some(b)) => a.min(b),
            (Some(a), None) => a,
            (None, Some(b)) => b,
            (None, None) => n,
        };
        if bi < next {
            segments.push(MergeSegment::Unchanged {
                lines: to_vec(&base_lines[bi..next]),
            });
            bi = next;
        }
        if l_start.is_none() && e_start.is_none() {
            break;
        }

        // Build the overlapping union of hunks starting here: take the
        // earliest-starting hunk, then absorb any hunk that strictly overlaps
        // the growing region (adjacent, non-overlapping hunks stay separate).
        let mut used_l: Vec<&Hunk> = Vec::new();
        let mut used_e: Vec<&Hunk> = Vec::new();
        let union_start = bi;
        let mut union_end;
        let take_local_first = match (l_start, e_start) {
            (Some(a), Some(b)) => a <= b,
            (Some(_), None) => true,
            _ => false,
        };
        if take_local_first {
            union_end = lh[li].base_end;
            used_l.push(&lh[li]);
            li += 1;
        } else {
            union_end = eh[ei].base_end;
            used_e.push(&eh[ei]);
            ei += 1;
        }
        loop {
            let mut grew = false;
            if li < lh.len() && lh[li].base_start < union_end {
                union_end = union_end.max(lh[li].base_end);
                used_l.push(&lh[li]);
                li += 1;
                grew = true;
            }
            if ei < eh.len() && eh[ei].base_start < union_end {
                union_end = union_end.max(eh[ei].base_end);
                used_e.push(&eh[ei]);
                ei += 1;
                grew = true;
            }
            if !grew {
                break;
            }
        }
        bi = union_end;

        let base_seg = to_vec(&base_lines[union_start..union_end]);
        if used_e.is_empty() {
            segments.push(MergeSegment::Local {
                base: base_seg,
                local: reconstruct(union_start, union_end, &used_l, &local_lines, &local_match),
            });
        } else if used_l.is_empty() {
            segments.push(MergeSegment::External {
                base: base_seg,
                external: reconstruct(
                    union_start,
                    union_end,
                    &used_e,
                    &external_lines,
                    &external_match,
                ),
            });
        } else {
            let local_seg =
                reconstruct(union_start, union_end, &used_l, &local_lines, &local_match);
            let external_seg = reconstruct(
                union_start,
                union_end,
                &used_e,
                &external_lines,
                &external_match,
            );
            if local_seg == external_seg {
                // Both sides made the same edit — not a conflict.
                segments.push(MergeSegment::Local {
                    base: base_seg,
                    local: local_seg,
                });
            } else {
                segments.push(MergeSegment::Conflict {
                    base: base_seg,
                    local: local_seg,
                    external: external_seg,
                });
            }
        }
    }

    MergeResult { segments }
}

fn to_vec(slice: &[&str]) -> Vec<String> {
    slice.iter().map(|s| s.to_string()).collect()
}

/// Map each base line index to its index in `target` when unchanged, else None.
fn match_map(base: &[&str], target: &[&str]) -> Vec<Option<usize>> {
    let diff = TextDiff::from_slices(base, target);
    let mut map = vec![None; base.len()];
    for change in diff.iter_all_changes() {
        if change.tag() == ChangeTag::Equal {
            if let (Some(bi), Some(ti)) = (change.old_index(), change.new_index()) {
                if bi < map.len() {
                    map[bi] = Some(ti);
                }
            }
        }
    }
    map
}

/// Extract `target`'s edits relative to `base` as hunks in base coordinates.
fn changed_hunks(base: &[&str], target: &[&str]) -> Vec<Hunk> {
    let diff = TextDiff::from_slices(base, target);
    let mut hunks: Vec<Hunk> = Vec::new();
    for op in diff.ops() {
        if op.tag() == DiffTag::Equal {
            continue;
        }
        let old_range = op.old_range();
        let new_range = op.new_range();
        let lines: Vec<String> = target[new_range].iter().map(|s| s.to_string()).collect();
        if let Some(last) = hunks.last_mut() {
            if last.base_end == old_range.start {
                last.base_end = old_range.end;
                last.lines.extend(lines);
                continue;
            }
        }
        hunks.push(Hunk {
            base_start: old_range.start,
            base_end: old_range.end,
            lines,
        });
    }
    hunks
}

/// Rebuild a side's text for the union region [start, end): hunk lines for
/// changed spans, the side's unchanged line for everything else.
fn reconstruct(
    start: usize,
    end: usize,
    hunks: &[&Hunk],
    target_lines: &[&str],
    target_match: &[Option<usize>],
) -> Vec<String> {
    let mut out = Vec::new();
    let mut bj = start;
    for h in hunks {
        for opt in &target_match[bj..h.base_start] {
            if let Some(ti) = *opt {
                out.push(target_lines[ti].to_string());
            }
        }
        out.extend(h.lines.iter().cloned());
        bj = h.base_end;
    }
    for opt in &target_match[bj..end] {
        if let Some(ti) = *opt {
            out.push(target_lines[ti].to_string());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(r: &MergeResult) -> Vec<&'static str> {
        r.segments
            .iter()
            .map(|s| match s {
                MergeSegment::Unchanged { .. } => "unchanged",
                MergeSegment::Local { .. } => "local",
                MergeSegment::External { .. } => "external",
                MergeSegment::Conflict { .. } => "conflict",
            })
            .collect()
    }

    fn apply_auto(r: &MergeResult) -> Vec<String> {
        // Apply non-conflicting result (local/external auto, base for conflict).
        let mut out = Vec::new();
        for s in &r.segments {
            match s {
                MergeSegment::Unchanged { lines } => out.extend(lines.clone()),
                MergeSegment::Local { local, .. } => out.extend(local.clone()),
                MergeSegment::External { external, .. } => out.extend(external.clone()),
                MergeSegment::Conflict { base, .. } => out.extend(base.clone()),
            }
        }
        out
    }

    #[test]
    fn identical_is_all_unchanged() {
        let r = merge_texts("a\nb\nc", "a\nb\nc", "a\nb\nc");
        assert_eq!(kinds(&r), vec!["unchanged"]);
    }

    #[test]
    fn local_only_edit() {
        let r = merge_texts("a\nb\nc", "a\nB\nc", "a\nb\nc");
        let k = kinds(&r);
        assert!(k.contains(&"local"));
        assert!(!k.contains(&"conflict"));
        assert!(!k.contains(&"external"));
    }

    #[test]
    fn external_only_edit() {
        let r = merge_texts("a\nb\nc", "a\nb\nc", "a\nb\nC");
        let k = kinds(&r);
        assert!(k.contains(&"external"));
        assert!(!k.contains(&"conflict"));
        assert!(!k.contains(&"local"));
    }

    #[test]
    fn coincident_edit_auto_applies() {
        let r = merge_texts("a\nb\nc", "a\nX\nc", "a\nX\nc");
        let k = kinds(&r);
        assert!(!k.contains(&"conflict"));
        assert_eq!(apply_auto(&r), vec!["a", "X", "c"]);
    }

    #[test]
    fn overlapping_edits_conflict() {
        let r = merge_texts("a\nb\nc", "a\nL\nc", "a\nE\nc");
        let k = kinds(&r);
        assert!(k.contains(&"conflict"));
        let conflict = r
            .segments
            .iter()
            .find_map(|s| match s {
                MergeSegment::Conflict {
                    local, external, ..
                } => Some((local, external)),
                _ => None,
            })
            .expect("expected conflict");
        assert!(conflict.0.iter().any(|l| l.contains('L')));
        assert!(conflict.1.iter().any(|l| l.contains('E')));
    }

    #[test]
    fn non_overlapping_edits_both_auto() {
        let r = merge_texts("a\nb\nc", "A\nb\nc", "a\nb\nC");
        let k = kinds(&r);
        assert!(k.contains(&"local"));
        assert!(k.contains(&"external"));
        assert!(!k.contains(&"conflict"));
        assert_eq!(apply_auto(&r), vec!["A", "b", "C"]);
    }

    #[test]
    fn adjacent_independent_edits_no_conflict() {
        // local edits B, external edits C — adjacent, no sync line between.
        let r = merge_texts("A\nB\nC", "A\nB2\nC", "A\nB\nC2");
        let k = kinds(&r);
        assert!(!k.contains(&"conflict"), "got {:?}", k);
        assert_eq!(apply_auto(&r), vec!["A", "B2", "C2"]);
    }

    #[test]
    fn local_insertion() {
        let r = merge_texts("a\nb", "a\nNEW\nb", "a\nb");
        let k = kinds(&r);
        assert!(k.contains(&"local"));
        assert!(!k.contains(&"conflict"));
        assert_eq!(apply_auto(&r), vec!["a", "NEW", "b"]);
    }

    #[test]
    fn separate_blocks_both_auto() {
        // local edits the top block, external the bottom block.
        let r = merge_texts("a\nb\nc\nd\ne", "A\nb\nc\nd\ne", "a\nb\nc\nd\nE");
        let k = kinds(&r);
        assert!(!k.contains(&"conflict"));
        assert_eq!(apply_auto(&r), vec!["A", "b", "c", "d", "E"]);
    }

    #[test]
    fn two_separate_conflicts() {
        // both sides change line b and line d differently — two distinct conflicts.
        let r = merge_texts("a\nb\nc\nd\ne", "a\nX\nc\nY\ne", "a\nZ\nc\nW\ne");
        let conflicts = r
            .segments
            .iter()
            .filter(|s| matches!(s, MergeSegment::Conflict { .. }))
            .count();
        assert_eq!(conflicts, 2, "expected 2 conflicts, got {:?}", r.segments);
    }
}
