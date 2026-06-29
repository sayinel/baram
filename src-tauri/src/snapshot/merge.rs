// §3.6 3-way line merge (diff3). Each region of the base text is classified as
// unchanged, a one-sided edit (auto-applied, rendered as a +/- diff in the UI),
// a coincident identical edit, or a true conflict that needs resolution.

use super::{MergeResult, MergeSegment};
use similar::{ChangeTag, TextDiff};

/// Compute a structured 3-way merge of `base` → (`local`, `external`).
pub fn merge_texts(base: &str, local: &str, external: &str) -> MergeResult {
    let base_lines: Vec<&str> = base.lines().collect();
    let local_lines: Vec<&str> = local.lines().collect();
    let external_lines: Vec<&str> = external.lines().collect();

    // For each base line, the matching index in local/external if it is
    // unchanged there (a "sync" point), else None.
    let local_match = match_map(&base_lines, &local_lines);
    let external_match = match_map(&base_lines, &external_lines);

    let mut segments: Vec<MergeSegment> = Vec::new();
    let mut unchanged: Vec<String> = Vec::new();
    let n = base_lines.len();
    let mut bi = 0;
    let mut li = 0;
    let mut ei = 0;

    while bi < n {
        if let (Some(lt), Some(et)) = (local_match[bi], external_match[bi]) {
            // base[bi] is unchanged in both sides — a sync line. First emit any
            // lines inserted before it on either side as a change region.
            if lt > li || et > ei {
                flush_unchanged(&mut segments, &mut unchanged);
                classify(
                    &[],
                    &to_vec(&local_lines[li..lt]),
                    &to_vec(&external_lines[ei..et]),
                    &mut segments,
                );
            }
            unchanged.push(base_lines[bi].to_string());
            li = lt + 1;
            ei = et + 1;
            bi += 1;
        } else {
            // Change region: consecutive base lines not synced in both sides.
            flush_unchanged(&mut segments, &mut unchanged);
            let start = bi;
            while bi < n && !(local_match[bi].is_some() && external_match[bi].is_some()) {
                bi += 1;
            }
            let next_li = if bi < n {
                local_match[bi].unwrap()
            } else {
                local_lines.len()
            };
            let next_ei = if bi < n {
                external_match[bi].unwrap()
            } else {
                external_lines.len()
            };
            classify(
                &to_vec(&base_lines[start..bi]),
                &to_vec(&local_lines[li..next_li]),
                &to_vec(&external_lines[ei..next_ei]),
                &mut segments,
            );
            li = next_li;
            ei = next_ei;
        }
    }
    flush_unchanged(&mut segments, &mut unchanged);

    // Trailing insertions after the last base line.
    if li < local_lines.len() || ei < external_lines.len() {
        classify(
            &[],
            &to_vec(&local_lines[li..]),
            &to_vec(&external_lines[ei..]),
            &mut segments,
        );
    }

    MergeResult { segments }
}

fn flush_unchanged(segments: &mut Vec<MergeSegment>, unchanged: &mut Vec<String>) {
    if !unchanged.is_empty() {
        segments.push(MergeSegment::Unchanged {
            lines: std::mem::take(unchanged),
        });
    }
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

/// Classify a change region into a one-sided edit, coincident edit, or conflict.
fn classify(base: &[String], local: &[String], external: &[String], out: &mut Vec<MergeSegment>) {
    if local == external {
        // Both sides ended up identical. If it equals base there is no change.
        if local == base {
            if !base.is_empty() {
                out.push(MergeSegment::Unchanged {
                    lines: base.to_vec(),
                });
            }
        } else {
            out.push(MergeSegment::Local {
                base: base.to_vec(),
                local: local.to_vec(),
            });
        }
    } else if local == base {
        out.push(MergeSegment::External {
            base: base.to_vec(),
            external: external.to_vec(),
        });
    } else if external == base {
        out.push(MergeSegment::Local {
            base: base.to_vec(),
            local: local.to_vec(),
        });
    } else {
        out.push(MergeSegment::Conflict {
            base: base.to_vec(),
            local: local.to_vec(),
            external: external.to_vec(),
        });
    }
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
        assert!(k.contains(&"local"));
        assert!(!k.contains(&"conflict"));
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
    }

    #[test]
    fn local_insertion() {
        let r = merge_texts("a\nb", "a\nNEW\nb", "a\nb");
        let k = kinds(&r);
        assert!(k.contains(&"local"));
        assert!(!k.contains(&"conflict"));
    }
}
