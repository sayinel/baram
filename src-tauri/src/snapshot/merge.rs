// §3.6 3-way line merge (diff3). Each side's edits are extracted as hunks in
// base coordinates; non-overlapping hunks are auto-applied (rendered as +/-),
// and only hunks that overlap the same base region become conflicts. Lines are
// compared without their line endings, the final newline is merged apart from
// them (`lines_of`), and the merged lines are joined with one line ending
// (`line_ending_of`).

use super::{LineEnding, MergeResult, MergeSegment};
use similar::{ChangeTag, DiffTag, TextDiff};

struct Hunk {
    base_start: usize,
    base_end: usize,
    lines: Vec<String>,
}

/// Compute a structured 3-way merge of `base` → (`local`, `external`).
pub fn merge_texts(base: &str, local: &str, external: &str) -> MergeResult {
    let (base_lines, base_ends) = lines_of(base);
    let (local_lines, local_ends) = lines_of(local);
    let (external_lines, external_ends) = lines_of(external);
    // The empty text has no line to end: its final newline counts as the base's, unchanged.
    let base_ends = base_ends.unwrap_or(false);
    let local_ends = local_ends.unwrap_or(base_ends);
    let external_ends = external_ends.unwrap_or(base_ends);

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

    MergeResult {
        segments,
        line_ending: line_ending_of([external, base, local]),
        // A yes or no merged three ways: the side that changed it wins, and two changes agree.
        final_newline: if external_ends == base_ends {
            local_ends
        } else {
            external_ends
        },
    }
}

/// `text`'s lines as the merge compares them, and whether it ends with a newline — `None` for the
/// empty text, which has no lines (`"\n"` is one empty line): split at each `\n`, a `\r` right
/// before it taken off with it. A lone `\r`, which breaks no line, stays in its line. Without their
/// endings the same lines compare equal in the editor's text of a CRLF file, mostly LF, and on
/// disk. The final newline is not a line: read as an empty last line, the one the editor adds to a
/// text without one sits where the other side appends, and the merge keeps the two as insertions
/// at one place, a blank line between.
fn lines_of(text: &str) -> (Vec<&str>, Option<bool>) {
    if text.is_empty() {
        return (Vec::new(), None);
    }
    let (body, ends) = match text.strip_suffix('\n') {
        Some(body) => (body.strip_suffix('\r').unwrap_or(body), true),
        None => (text, false),
    };
    let mut lines: Vec<&str> = body.split('\n').collect();
    // Each piece but the last was followed by a `\n`; the last one's ending is already off.
    if let Some((_, ended)) = lines.split_last_mut() {
        for line in ended {
            if let Some(content) = line.strip_suffix('\r') {
                *line = content;
            }
        }
    }
    (lines, Some(ends))
}

/// The line ending the merged lines are joined with: the one most line breaks use in the first of
/// `texts` that breaks a line — LF on a tie — or LF when none does. A text mixing the two comes
/// back in that one throughout.
fn line_ending_of(texts: [&str; 3]) -> LineEnding {
    for text in texts {
        let breaks = text.matches('\n').count();
        if breaks > 0 {
            let crlf = text.matches("\r\n").count();
            return if crlf > breaks - crlf {
                LineEnding::Crlf
            } else {
                LineEnding::Lf
            };
        }
    }
    LineEnding::Lf
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

    /// The text `MergeView` writes for these lines: joined with the result's line ending, and that
    /// ending once more after them when the result has a final newline and there are lines to end.
    fn joined(r: &MergeResult, lines: &[String]) -> String {
        let ending = match r.line_ending {
            LineEnding::Lf => "\n",
            LineEnding::Crlf => "\r\n",
        };
        let mut text = lines.join(ending);
        if r.final_newline && !lines.is_empty() {
            text.push_str(ending);
        }
        text
    }

    /// What the merge view writes when each conflict keeps the base.
    fn written(r: &MergeResult) -> String {
        joined(r, &apply_auto(r))
    }

    /// What it writes when each conflict takes both sides, the local side first.
    fn written_taking_both(r: &MergeResult) -> String {
        let mut out = Vec::new();
        for s in &r.segments {
            match s {
                MergeSegment::Unchanged { lines } => out.extend(lines.clone()),
                MergeSegment::Local { local, .. } => out.extend(local.clone()),
                MergeSegment::External { external, .. } => out.extend(external.clone()),
                MergeSegment::Conflict {
                    local, external, ..
                } => {
                    out.extend(local.clone());
                    out.extend(external.clone());
                }
            }
        }
        joined(r, &out)
    }

    /// The defect's probe: one side adds a line at the end of a file that ends with a newline. What
    /// fails this: no final newline in the result, as when the texts were read with `str::lines`
    /// and the lines joined — this wrote `"x\nL"`.
    #[test]
    fn a_merge_keeps_the_final_newline() {
        assert_eq!(written(&merge_texts("x\n", "x\nL\n", "x\n")), "x\nL\n");
        assert_eq!(written(&merge_texts("x\n", "x\n", "x\nE\n")), "x\nE\n");
        assert_eq!(written(&merge_texts("", "x\n", "")), "x\n");
    }

    /// The final newline is the external side's when it changed it from the base's, the local
    /// side's otherwise — a yes or no merged three ways, which both sides changing must agree on.
    #[test]
    fn the_final_newline_is_merged_three_ways() {
        assert!(merge_texts("a", "a\n", "a").final_newline);
        assert!(!merge_texts("a\n", "a", "a\n").final_newline);
        assert!(merge_texts("a", "a", "a\n").final_newline);
        assert!(!merge_texts("a\n", "a\n", "a").final_newline);
    }

    /// The final newline is not part of the last line: a side that adds or takes it away does not
    /// conflict with the other side's edit of that line.
    #[test]
    fn a_final_newline_changes_apart_from_the_last_line() {
        let added = merge_texts("a\nx", "a\nx\n", "a\ny");
        assert!(
            !kinds(&added).contains(&"conflict"),
            "got {:?}",
            added.segments
        );
        assert_eq!(written(&added), "a\ny\n");
        let removed = merge_texts("a\nx\n", "a\nx", "a\ny\n");
        assert!(
            !kinds(&removed).contains(&"conflict"),
            "got {:?}",
            removed.segments
        );
        assert_eq!(written(&removed), "a\ny");
    }

    /// The editor adds a final newline to a text without one (a probe: `"a\nb"` came back
    /// `"a\nb\n"`), so with none on disk the local side adds one where the other side appends. What
    /// fails this: reading the final newline as an empty last line. The added newline and the
    /// appended line are then two insertions at one place, kept one after the other with a blank
    /// line between (`"A\nb\n\nc"`); taking both sides of a conflict puts the local side's empty
    /// last line between them (`"b\n\nc\n"`).
    #[test]
    fn a_final_newline_added_where_the_other_side_appends_adds_no_blank_line() {
        let appended = merge_texts("a\nb", "A\nb\n", "a\nb\nc");
        assert!(
            !kinds(&appended).contains(&"conflict"),
            "got {:?}",
            appended.segments
        );
        assert_eq!(written(&appended), "A\nb\nc\n");
        let both = merge_texts("a", "b\n", "c\n");
        assert_eq!(kinds(&both), vec!["conflict"]);
        assert_eq!(written_taking_both(&both), "b\nc\n");
    }

    /// The empty text has no lines, and no line to end: a side that empties the file deletes its
    /// lines, and the other side's lines and final newline stand. What fails this: reading `""` as
    /// one empty line, as `"\n"` is — it replaces the base's lines, and the other side's insertion
    /// is kept beside it (`"\nE"`), its final newline taken from the empty side. Or counting the
    /// empty side as without a final newline, which drops the other side's (`"E"`).
    #[test]
    fn an_emptied_side_deletes_its_lines_and_adds_no_blank_line() {
        assert_eq!(written(&merge_texts("a\n", "", "a\nE\n")), "E\n");
        assert_eq!(written(&merge_texts("a\n", "a\nL\n", "")), "L\n");
        let emptied_and_edited = merge_texts("a\n", "", "b\n");
        assert_eq!(written_taking_both(&emptied_and_edited), "b\n");
    }

    /// A CRLF file on disk, and the editor's text of it in LF: the line endings are not an edit.
    /// What fails this: comparing lines with their `\r` — at most the last line of the local side
    /// matches the base's (its `\r` goes with the final newline), so the local edit covers the
    /// lines before it and conflicts with the other side's. Or joining with "\n": the file comes
    /// back LF.
    #[test]
    fn a_crlf_file_merges_against_lf_text_and_stays_crlf() {
        let r = merge_texts(
            "a\r\nb\r\nc\r\nd\r\n",
            "A\nb\nc\nd\n",
            "a\r\nb\r\nC\r\nd\r\n",
        );
        assert!(!kinds(&r).contains(&"conflict"), "got {:?}", r.segments);
        assert_eq!(r.line_ending, LineEnding::Crlf);
        assert_eq!(written(&r), "A\r\nb\r\nC\r\nd\r\n");
    }

    /// The line ending is read from the first text that breaks a line: the disk's text now (the
    /// file the merge is written over), the disk's text before, the tab's text.
    #[test]
    fn the_line_ending_is_the_disks() {
        // The other program wrote the file in CRLF over an LF base.
        let crlf_now = merge_texts("a\n", "a\nL\n", "a\r\n");
        assert_eq!(crlf_now.line_ending, LineEnding::Crlf);
        // ... or in LF over a CRLF base.
        let lf_now = merge_texts("a\r\n", "a\r\n", "a\n");
        assert_eq!(lf_now.line_ending, LineEnding::Lf);
        // The disk's text breaks no line: the base's.
        let emptied = merge_texts("a\r\nb\r\n", "a\nb\n", "");
        assert_eq!(emptied.line_ending, LineEnding::Crlf);
        // Neither disk text breaks a line: the tab's.
        assert_eq!(merge_texts("", "a\r\n", "").line_ending, LineEnding::Crlf);
        assert_eq!(merge_texts("x", "y", "z").line_ending, LineEnding::Lf);
    }

    /// A text that mixes the two is read by the ending most of its line breaks use — LF on a tie —
    /// and comes back in it throughout: the merge writes one line ending. What fails this: CRLF
    /// whenever the text holds one, which turns every line of a mostly LF file.
    #[test]
    fn a_text_mixing_line_endings_comes_back_in_the_one_most_breaks_use() {
        for (mixed, back) in [
            ("a\r\nb\r\nc\n", "a\r\nb\r\nc\r\n"),
            ("a\nb\nc\r\n", "a\nb\nc\n"),
            ("a\r\nb\nc", "a\nb\nc"),
        ] {
            assert_eq!(
                written(&merge_texts(mixed, mixed, mixed)),
                back,
                "{mixed:?}"
            );
        }
    }

    /// A text that uses one line ending comes back byte for byte, merged with itself: its final
    /// newline or none, empty lines, a lone `\r` inside a line or at the end, which breaks none.
    #[test]
    fn a_text_merged_with_itself_comes_back_as_it_was() {
        for text in [
            "",
            "x",
            "x\n",
            "\n",
            "\n\n",
            "a\nb",
            "a\nb\n",
            "a\r\nb\r\n",
            "a\r\n\r\n",
            "\r\n",
            "x\r",
            "x\r\r\n",
            "a\rb\n",
            "a\rb\r\n",
        ] {
            assert_eq!(written(&merge_texts(text, text, text)), text, "{text:?}");
        }
    }

    /// The shape the frontend reads (`MergeResult` in src/ipc/types.ts). What fails this: dropping
    /// `rename_all` — `lineEnding` would arrive undefined, and `join(undefined)` joins with commas.
    #[test]
    fn the_result_serializes_as_the_frontend_reads_it() {
        let value = serde_json::to_value(merge_texts("a\r\n", "a\r\n", "a\r\n")).unwrap();
        assert_eq!(value["lineEnding"], "\r\n");
        assert_eq!(value["finalNewline"], true);
        assert_eq!(value["segments"][0]["kind"], "unchanged");
        assert_eq!(value["segments"][0]["lines"][0], "a");
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
