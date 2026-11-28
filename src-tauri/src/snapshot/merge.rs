// §3.6 3-way line merge (diff3). Each side's edits are extracted as hunks in
// base coordinates; non-overlapping hunks are auto-applied (rendered as +/-),
// and only hunks that overlap the same base region become conflicts. Lines are
// compared without their line endings, the final newline is merged apart from
// them (`lines_of`), and the merged lines are joined with one line ending
// (`line_ending_of`).

use super::{LineEnding, MergeResult, MergeSegment};
use similar::{ChangeTag, DiffTag, TextDiff};
use std::collections::HashMap;

struct Hunk {
    base_start: usize,
    base_end: usize,
    lines: Vec<String>,
}

impl Hunk {
    /// Adds lines between two base lines and replaces none: its base range is empty.
    fn inserts_only(&self) -> bool {
        self.base_start == self.base_end
    }

    /// Whether this hunk overlaps the region [`start`, `end`) built from the hunks taken so far — it
    /// starts at or after `start`, as every hunk not yet taken does. It overlaps when it starts inside
    /// the region. A region of insertions only is an empty range, which no hunk starts inside, yet two
    /// insertions between the same two base lines have nothing in the base to put one before the
    /// other: an insertion also overlaps a region of insertions at its own place.
    fn overlaps(&self, start: usize, end: usize) -> bool {
        self.base_start < end || (start == end && self.base_start == end && self.inserts_only())
    }
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

    // Each segment with whether one side made its edit alone (`place_shared_insertions`).
    let mut segments: Vec<(MergeSegment, bool)> = Vec::new();
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
            segments.push((
                MergeSegment::Unchanged {
                    lines: to_vec(&base_lines[bi..next]),
                },
                false,
            ));
            bi = next;
        }
        if l_start.is_none() && e_start.is_none() {
            break;
        }

        // Build the overlapping union of hunks starting here: take the
        // earliest-starting hunk, then absorb any hunk that overlaps the
        // growing region (`Hunk::overlaps`; adjacent hunks stay separate).
        // Where both sides start at one place and one only inserts, the
        // insertion goes first: it sits before the base line the other
        // changes. Taken second, it would start inside that change and join
        // it — and the result would depend on which side is local.
        let mut used_l: Vec<&Hunk> = Vec::new();
        let mut used_e: Vec<&Hunk> = Vec::new();
        let union_start = bi;
        let mut union_end;
        let take_local_first = match (lh.get(li), eh.get(ei)) {
            (Some(l), Some(e)) => {
                l.base_start < e.base_start
                    || (l.base_start == e.base_start && (l.inserts_only() || !e.inserts_only()))
            }
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
            if li < lh.len() && lh[li].overlaps(union_start, union_end) {
                union_end = union_end.max(lh[li].base_end);
                used_l.push(&lh[li]);
                li += 1;
                grew = true;
            }
            if ei < eh.len() && eh[ei].overlaps(union_start, union_end) {
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
            segments.push((
                MergeSegment::Local {
                    base: base_seg,
                    local: reconstruct(union_start, union_end, &used_l, &local_lines, &local_match),
                },
                true,
            ));
        } else if used_l.is_empty() {
            segments.push((
                MergeSegment::External {
                    base: base_seg,
                    external: reconstruct(
                        union_start,
                        union_end,
                        &used_e,
                        &external_lines,
                        &external_match,
                    ),
                },
                true,
            ));
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
                segments.push((
                    MergeSegment::Local {
                        base: base_seg,
                        local: local_seg,
                    },
                    false,
                ));
            } else {
                segments.push((
                    MergeSegment::Conflict {
                        base: base_seg,
                        local: local_seg,
                        external: external_seg,
                    },
                    false,
                ));
            }
        }
    }

    MergeResult {
        segments: place_shared_insertions(segments),
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
/// text without one sits where the other side appends, and the merge asks about the two as
/// insertions at one place — an empty line nobody wrote against the appended lines.
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

/// A side of the merge, for the text it has in a segment.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Side {
    Local,
    External,
}

impl Side {
    fn other(self) -> Side {
        match self {
            Side::Local => Side::External,
            Side::External => Side::Local,
        }
    }
}

/// An insertion the other side's change beside it holds (`place_shared_insertions`).
struct Held {
    insertion: usize,
    /// The inserting side.
    side: Side,
    change: usize,
    /// The insertion's lines as they read at the change's edge.
    lines: Vec<String>,
    /// At the change's end — the insertion comes after it — rather than its start.
    at_end: bool,
}

/// Takes out an insertion by one side that the other side's change beside it already holds: the other
/// side's new lines there end with the insertion's lines (the insertion follows the change) or begin
/// with them (it precedes the change). The diff usually hands an edit and lines added beside it over as
/// one replace, so this is how both sides adding the same lines at one place shows when one of them
/// also edited the line next to it — kept apart, they went in twice. A different insertion stays
/// beside the change. A change that only replaces lines holds one the same way: a line replaced with
/// the inserted line is that line deleted and the same line inserted at that place.
///
/// The change is looked for beside the insertion, or before it past the unchanged lines between them
/// when the insertion reads the same moved before those lines — lines added after a blank line, ending
/// with one, read the same added before it, starting with one (`change_beside`). There the other
/// side's edit can be an insertion too: two insertions at what reads as one place, apart only where the
/// diff put them. Each line of a change holds one insertion: one at its start and one at its end cannot
/// both count the same line.
///
/// Beside a change the other side made alone, the insertion is dropped. Beside a conflict it joins
/// the inserting side's text there, so choosing either side holds the lines once — left beside the
/// conflict, they came twice with the other side's text. If that makes the two texts the same, both
/// sides made the edit, and it is applied. An edit both sides made is filed as local's and is
/// neither side's alone: held at its edge, the inserting side's text would hold the lines twice —
/// in the edit and inserted — though no such input turned up among all bases of up to three lines
/// and sides of up to five, over three distinct lines.
fn place_shared_insertions(segments: Vec<(MergeSegment, bool)>) -> Vec<MergeSegment> {
    let mut held: Vec<Held> = Vec::new();
    // Lines of a side's text in a change already holding an insertion: from its start, from its end.
    let mut counted: HashMap<(usize, Side), (usize, usize)> = HashMap::new();
    for (insertion, segment) in segments.iter().enumerate() {
        let Some((side, inserted)) = insertion_of(segment) else {
            continue;
        };
        for at_end in [true, false] {
            let Some((change, lines)) = change_beside(&segments, insertion, inserted, at_end)
            else {
                continue;
            };
            // An insertion already taken out holds nothing: its lines are the edit's that held it.
            // Without this, no result in the search the doc above names changes; it keeps the pass
            // from resting on that search.
            if held.iter().any(|h| h.insertion == change) {
                continue;
            }
            let Some(text) = segments.get(change).and_then(|c| text_of(c, side.other())) else {
                continue;
            };
            let (from_start, from_end) = counted.entry((change, side.other())).or_default();
            let fits = *from_start + *from_end + lines.len() <= text.len();
            let holds = if at_end {
                text.ends_with(&lines)
            } else {
                text.starts_with(&lines)
            };
            if fits && holds {
                *(if at_end { from_end } else { from_start }) += lines.len();
                held.push(Held {
                    insertion,
                    side,
                    change,
                    lines,
                    at_end,
                });
                break;
            }
        }
    }

    let mut segments = segments;
    let mut dropped = vec![false; segments.len()];
    for h in held {
        if let Some(d) = dropped.get_mut(h.insertion) {
            *d = true;
        }
        if let Some((
            MergeSegment::Conflict {
                local, external, ..
            },
            _,
        )) = segments.get_mut(h.change)
        {
            let text = match h.side {
                Side::Local => local,
                Side::External => external,
            };
            if h.at_end {
                text.extend(h.lines);
            } else {
                text.splice(0..0, h.lines);
            }
        }
    }
    segments
        .into_iter()
        .zip(dropped)
        .filter_map(|((segment, _), gone)| (!gone).then_some(segment))
        .map(|segment| match segment {
            // The fold can make the two texts the same: both sides made that edit, split differently.
            MergeSegment::Conflict {
                base,
                local,
                external,
            } if local == external => MergeSegment::Local { base, local },
            segment => segment,
        })
        .collect()
}

/// The inserting side and lines of an insertion one side made alone.
fn insertion_of(segment: &(MergeSegment, bool)) -> Option<(Side, &[String])> {
    match segment {
        (MergeSegment::Local { base, local }, true) if base.is_empty() => {
            Some((Side::Local, local))
        }
        (MergeSegment::External { base, external }, true) if base.is_empty() => {
            Some((Side::External, external))
        }
        _ => None,
    }
}

/// `side`'s new lines in an edit that side made alone, or in a conflict.
fn text_of(segment: &(MergeSegment, bool), side: Side) -> Option<&[String]> {
    match (segment, side) {
        ((MergeSegment::Local { local, .. }, true), Side::Local) => Some(local),
        ((MergeSegment::External { external, .. }, true), Side::External) => Some(external),
        ((MergeSegment::Conflict { local, .. }, _), Side::Local) => Some(local),
        ((MergeSegment::Conflict { external, .. }, _), Side::External) => Some(external),
        _ => None,
    }
}

/// The segment that may hold the insertion at `insertion` — before it when `at_end`, after it
/// otherwise — and the insertion's lines as they read at that segment's edge. Before it, also past the
/// unchanged lines between, when the text reads the same with the insertion moved before them. Not
/// after: the diff leaves an insertion as far down as it goes (`shift_diff_ops_down` in similar's
/// compaction), so the line after it never equals its first.
fn change_beside(
    segments: &[(MergeSegment, bool)],
    insertion: usize,
    inserted: &[String],
    at_end: bool,
) -> Option<(usize, Vec<String>)> {
    if !at_end {
        return Some((insertion + 1, inserted.to_vec()));
    }
    let before = insertion.checked_sub(1)?;
    let (MergeSegment::Unchanged { lines: between }, _) = segments.get(before)? else {
        return Some((before, inserted.to_vec()));
    };
    // The unchanged lines then the insertion, read as the moved insertion then the unchanged lines.
    let joined: Vec<String> = between.iter().chain(inserted).cloned().collect();
    let (moved, rest) = joined.split_at(inserted.len());
    if rest != between.as_slice() {
        return None;
    }
    Some((before.checked_sub(1)?, moved.to_vec()))
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
    /// appended line are then two insertions at one place, a conflict of `[""]` against `["c"]`;
    /// taking both sides of a conflict puts the local side's empty last line between them
    /// (`"b\n\nc\n"`).
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

    /// Each segment as one comparable line. With `swapped`, read as the merge of the same two texts
    /// handed over the other way round: the conflict's two sides are put back in the first order.
    /// Auto-applied segments are "auto" either way — an edit both sides made is filed as local's.
    fn described(r: &MergeResult, swapped: bool) -> Vec<String> {
        r.segments
            .iter()
            .map(|s| match s {
                MergeSegment::Unchanged { lines } => format!("unchanged {lines:?}"),
                MergeSegment::Local { base, local: lines }
                | MergeSegment::External {
                    base,
                    external: lines,
                } => format!("auto {base:?} {lines:?}"),
                MergeSegment::Conflict {
                    base,
                    local,
                    external,
                } if swapped => format!("conflict {base:?} {external:?} {local:?}"),
                MergeSegment::Conflict {
                    base,
                    local,
                    external,
                } => format!("conflict {base:?} {local:?} {external:?}"),
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

    // Both sides adding to the end of the file: the merge used to keep both, one after the other,
    // without asking — nothing in the base says which goes first.
    #[test]
    fn both_sides_adding_at_the_end_conflict() {
        let r = merge_texts("a\nb", "a\nb\nL", "a\nb\nE");
        assert_eq!(
            described(&r, false),
            vec![r#"unchanged ["a", "b"]"#, r#"conflict [] ["L"] ["E"]"#]
        );
    }

    #[test]
    fn both_sides_inserting_between_the_same_two_lines_conflict() {
        let r = merge_texts("a\nb", "a\nL\nb", "a\nE\nb");
        assert_eq!(
            described(&r, false),
            vec![
                r#"unchanged ["a"]"#,
                r#"conflict [] ["L"] ["E"]"#,
                r#"unchanged ["b"]"#
            ]
        );
    }

    #[test]
    fn the_same_insertion_on_both_sides_is_added_once() {
        let r = merge_texts("a\nb", "a\nX\nb", "a\nX\nb");
        assert!(!kinds(&r).contains(&"conflict"), "got {:?}", r.segments);
        assert_eq!(apply_auto(&r), vec!["a", "X", "b"]);
    }

    // Against an empty base every line of each side is added at the one place there is.
    #[test]
    fn two_texts_over_an_empty_base_are_one_conflict() {
        let r = merge_texts("", "a\nb", "a\nc");
        assert_eq!(
            described(&r, false),
            vec![r#"conflict [] ["a", "b"] ["a", "c"]"#]
        );
    }

    /// The conflict modal sends a recorded empty disk text here as the base (`AppDialogs.tsx`): the
    /// file was empty. Two texts added to it are one question; the same text twice, or a side still
    /// empty, is none — the added text is applied once, its final newline and line endings with it.
    /// What fails this: two insertions at one place kept one after the other (`"a\nb\na\nb\n"`).
    #[test]
    fn an_empty_base_is_a_file_that_was_empty() {
        let same = merge_texts("", "a\nb\n", "a\nb\n");
        assert_eq!(kinds(&same), vec!["local"]);
        assert_eq!(written(&same), "a\nb\n");
        let added_elsewhere = merge_texts("", "", "a\nb\n");
        assert_eq!(kinds(&added_elsewhere), vec!["external"]);
        assert_eq!(written(&added_elsewhere), "a\nb\n");
        let added_here = merge_texts("", "a\r\nb\r\n", "");
        assert_eq!(kinds(&added_here), vec!["local"]);
        assert_eq!(written(&added_here), "a\r\nb\r\n");
        let both = merge_texts("", "a\n", "b\n");
        assert_eq!(kinds(&both), vec!["conflict"]);
        assert_eq!(written_taking_both(&both), "a\nb\n");
    }

    #[test]
    fn an_insertion_inside_the_other_sides_change_conflicts() {
        let r = merge_texts("a\nb\nc\nd", "a\nB\nd", "a\nb\nX\nc\nd");
        assert_eq!(kinds(&r), vec!["unchanged", "conflict", "unchanged"]);
    }

    // An insertion where the other side's change begins or ends goes beside it, whichever side is
    // local: the change is placed by the base lines it replaces, the insertion by the two around it.
    // The change can also carry lines added at that edge — the diff usually hands an edit and an
    // addition beside it over as one replace — and a different insertion by the other side there
    // goes outside those lines, in base order, without asking (the last case).
    #[test]
    fn an_insertion_next_to_the_other_sides_change_goes_beside_it() {
        let cases: [(&str, &str, &str, &[&str]); 4] = [
            ("a\nb\nc", "a\nX\nb\nc", "a\nB\nc", &["a", "X", "B", "c"]),
            ("a\nb\nc", "a\nb\nX\nc", "a\nB\nc", &["a", "B", "X", "c"]),
            ("a\nb\nc", "a\nX\nb\nc", "a\nc", &["a", "X", "c"]),
            (
                "a\nb\nc",
                "a\nX\nb\nc",
                "a\nY\nB\nc",
                &["a", "X", "Y", "B", "c"],
            ),
        ];
        for (base, insert, change, merged) in cases {
            for r in [
                merge_texts(base, insert, change),
                merge_texts(base, change, insert),
            ] {
                assert!(!kinds(&r).contains(&"conflict"), "got {:?}", r.segments);
                assert_eq!(apply_auto(&r), merged);
            }
        }
    }

    // Which side is local changes nothing but which is which: the same regions conflict and the same
    // text is taken. What fails this: taking local's hunk first when both start at one place — an
    // insertion there then joined the other side's change only when that change was local's.
    #[test]
    fn swapping_the_sides_swaps_only_their_names() {
        let cases = [
            ("a\nb\nc", "a\nX\nb\nc", "a\nB\nc"),
            ("a\nb\nc", "a\nb\nX\nc", "a\nB\nc"),
            ("a\nb\nc", "a\nX\nb\nc", "a\nc"),
            ("a\nb\nc\nd", "a\nb\nX\nc\nd", "a\nB\nd"),
            ("a\nb", "a\nb\nL", "a\nb\nE"),
            ("a\nb", "a\nX\nb", "a\nX\nb"),
            ("", "a", "b"),
            ("A\nB\nC", "A\nB2\nC", "A\nB\nC2"),
            ("a\nb\nc", "a\nL\nc", "a\nE\nc"),
            ("a\nb\nc\nd\ne", "a\nX\nc\nY\ne", "a\nZ\nc\nW\ne"),
            ("a\nb\nc", "a\nX\nb\nc", "a\nX\nB\nc"),
            ("a\nb", "a\nb\nL", "a\nB\nL"),
            ("b\nc\nd", "I\nb\nC2\nd", "I\nB\nC3\nd"),
            ("b\nc\nd", "I\nb\nC2\nd", "J\nB\nC3\nd"),
            ("a\nb\nc", "a\nI\nb\nI\nc", "a\nI\nc"),
            (
                "# T\n\np1\n\np2\n",
                "# T\n\np1\n\nnew\n\np2\n",
                "# T\n\nP1\n\nnew\n\np2\n",
            ),
        ];
        for (base, x, y) in cases {
            assert_eq!(
                described(&merge_texts(base, x, y), false),
                described(&merge_texts(base, y, x), true),
                "{base:?} {x:?} {y:?}"
            );
        }
    }

    // Both sides adding the same lines at one place, one of them with an edit to the line beside it,
    // adds them once: both sides adding the same paragraph after one, one side after editing it. The
    // edit and its addition reach the merge as one replace. In the middle of a document the other
    // side's paragraph comes after the blank line that follows, and moves before it to meet the
    // replace (the last case). What fails this: no `place_shared_insertions` — the lines went in twice;
    // without the move past unchanged lines, the last case does.
    #[test]
    fn an_insertion_the_other_sides_change_already_holds_is_added_once() {
        let cases: [(&str, &str, &str, &[&str]); 4] = [
            ("a\nb\nc", "a\nX\nb\nc", "a\nX\nB\nc", &["a", "X", "B", "c"]),
            ("a\nb", "a\nb\nL", "a\nB\nL", &["a", "B", "L"]),
            (
                "# T\n\nold para\n",
                "# T\n\nold para\n\nnew para\n",
                "# T\n\nOLD para\n\nnew para\n",
                &["# T", "", "OLD para", "", "new para"],
            ),
            (
                "# T\n\np1\n\np2\n",
                "# T\n\np1\n\nnew\n\np2\n",
                "# T\n\nP1\n\nnew\n\np2\n",
                &["# T", "", "P1", "", "new", "", "p2"],
            ),
        ];
        for (base, insert, change, merged) in cases {
            for r in [
                merge_texts(base, insert, change),
                merge_texts(base, change, insert),
            ] {
                assert!(!kinds(&r).contains(&"conflict"), "got {:?}", r.segments);
                assert_eq!(apply_auto(&r), merged);
            }
        }
    }

    // A change that only replaces a line holds the insertion too, when the new line is the inserted
    // one: that is the line deleted and the same line inserted at that place, and the line goes in
    // once. The other side's insertion then has no segment of its own. What fails this: taking only a
    // change that adds lines (its text longer than its base) as holding one — "- item 3" went in twice.
    #[test]
    fn a_line_replaced_with_the_inserted_line_holds_it() {
        let base = "- item 1\n- item 2\n";
        let replaced = "- item 1\n- item 3\n";
        let inserted = "- item 1\n- item 2\n- item 3\n";
        for r in [
            merge_texts(base, replaced, inserted),
            merge_texts(base, inserted, replaced),
        ] {
            assert!(!kinds(&r).contains(&"conflict"), "got {:?}", r.segments);
            assert_eq!(written(&r), "- item 1\n- item 3\n");
        }
    }

    // Two insertions at what reads as one place, apart only where the diff put them: local's "a" after
    // the base "a" reads the same before it, where external's "b, a" already ends with it. What fails
    // this: taking only changes with base lines as holding an insertion — "a" went in twice.
    #[test]
    fn an_insertion_the_other_sides_insertion_already_holds_is_added_once() {
        for r in [
            merge_texts("a", "a\na", "b\na\na"),
            merge_texts("a", "b\na\na", "a\na"),
        ] {
            assert!(!kinds(&r).contains(&"conflict"), "got {:?}", r.segments);
            assert_eq!(apply_auto(&r), vec!["b", "a", "a"]);
        }
    }

    // A line of the other side's change holds one insertion. Here local added I before and after b,
    // and external replaced b with one I: one of local's is that I, the other stays. What fails this:
    // letting both insertions count the same line — the merge kept a single I.
    #[test]
    fn insertions_at_both_edges_of_a_change_count_its_lines_once() {
        for r in [
            merge_texts("a\nb\nc", "a\nI\nb\nI\nc", "a\nI\nc"),
            merge_texts("a\nb\nc", "a\nI\nc", "a\nI\nb\nI\nc"),
        ] {
            assert!(!kinds(&r).contains(&"conflict"), "got {:?}", r.segments);
            assert_eq!(apply_auto(&r), vec!["a", "I", "I", "c"]);
        }
    }

    // A change is never dropped as an insertion: edits to adjacent lines that came out the same both
    // stay. What fails this: taking a segment with base lines of its own for an insertion.
    #[test]
    fn adjacent_edits_to_the_same_text_both_stay() {
        let r = merge_texts("a\nb\nc", "a\nz\nc", "a\nb\nz");
        assert_eq!(apply_auto(&r), vec!["a", "z", "z"]);
    }

    // Beside a conflict whose other text begins with the insertion, the insertion joins the
    // inserting side's text, so choosing either side holds it once. What fails this: leaving it
    // beside the conflict — choosing external gave I twice.
    #[test]
    fn an_insertion_the_other_sides_conflict_text_holds_joins_the_conflict() {
        let r = merge_texts("b\nc\nd", "I\nb\nC2\nd", "I\nB\nC3\nd");
        assert_eq!(
            described(&r, false),
            vec![
                r#"conflict ["b", "c"] ["I", "b", "C2"] ["I", "B", "C3"]"#,
                r#"unchanged ["d"]"#
            ]
        );
    }

    // Both sides made one edit, but one side's diff split it into an edit and an insertion past the
    // blank line after it; folding the insertion into the conflict makes the two texts the same, and
    // the edit is applied. The cases replace a paragraph on both sides, and fold insertions from both
    // sides into one conflict. What fails this: keeping the conflict — a question whose two answers
    // are the same.
    #[test]
    fn a_conflict_the_fold_makes_one_edit_is_applied() {
        let cases: [(&str, &str, &str, &[&str]); 3] = [
            (
                "a\n\nd",
                "b\n\nc\n\nd",
                "b\n\nc\n\nd\ne",
                &["b", "", "c", "", "d", "e"],
            ),
            ("a\n\na\nb", "c\na\nb", "c\na\nb\nb", &["c", "a", "b", "b"]),
            (
                "a\na\na\na",
                "b\na\nb\na",
                "b\na\nb\na\nb",
                &["b", "a", "b", "a", "b"],
            ),
        ];
        for (base, x, y, merged) in cases {
            for r in [merge_texts(base, x, y), merge_texts(base, y, x)] {
                assert!(!kinds(&r).contains(&"conflict"), "got {:?}", r.segments);
                assert_eq!(apply_auto(&r), merged);
            }
        }
    }

    // A different insertion beside a conflict stays beside it, whichever side is chosen there.
    #[test]
    fn a_different_insertion_beside_a_conflict_stays() {
        let r = merge_texts("b\nc\nd", "I\nb\nC2\nd", "J\nB\nC3\nd");
        assert_eq!(
            described(&r, false),
            vec![
                r#"auto [] ["I"]"#,
                r#"conflict ["b", "c"] ["b", "C2"] ["J", "B", "C3"]"#,
                r#"unchanged ["d"]"#
            ]
        );
    }
}
