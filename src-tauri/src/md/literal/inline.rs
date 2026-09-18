// The editor's inline rule of `md::literal` (issue 665): the left-to-right
// sweep that pairs `$` and backticks over a prose block, around the atoms the
// parser found. Measured, not derived from a specification — the sentinels
// of issue 669 say which versions.

use super::*;

/// A maximal run of `$` or backticks in a prose block, as the raw bytes have
/// it: where it starts, how long it is, and whether a backslash escapes its
/// first character. A closer is matched raw — an escape inside a formula is
/// content, as inside a code span — so the raw length is a closer's length;
/// an opener that starts behind an escape is the run minus that character.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Run {
    pub(super) start: usize,
    pub(super) len: usize,
    pub(super) byte: u8,
    pub(super) escaped: bool,
}

/// The delimiter runs of `bytes`, left to right, in one pass. The escape walk
/// is the editor's: a backslash before ASCII punctuation escapes that one
/// character (`\\$` leaves the `$` live, `\$$` leaves an opener of one).
pub(super) fn delimiter_runs(bytes: &[u8]) -> Vec<Run> {
    let run_from = |i: usize, byte: u8| bytes[i..].iter().take_while(|&&b| b == byte).count();
    let mut runs = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => {
                i += 1;
                match bytes.get(i) {
                    Some(&byte @ (b'`' | b'$')) => {
                        let len = run_from(i, byte);
                        runs.push(Run {
                            start: i,
                            len,
                            byte,
                            escaped: true,
                        });
                        i += len;
                    }
                    Some(b) if b.is_ascii_punctuation() => i += 1,
                    _ => {}
                }
            }
            byte @ (b'`' | b'$') => {
                let len = run_from(i, byte);
                runs.push(Run {
                    start: i,
                    len,
                    byte,
                    escaped: false,
                });
                i += len;
            }
            _ => i += 1,
        }
    }
    runs
}

/// What one sweep over a block reports besides its literals.
pub(super) struct Swept {
    /// How many runs the pass visited — the count the tests pin.
    pub(super) visited: usize,
    /// Where the first atom began that a formula or a code span the sweep
    /// read had opened before and run into — the parser formed it on a text
    /// the editor never reads, so the body must be read again.
    pub(super) destroyed: Option<usize>,
}

/// The editor's left-to-right inline rule over one prose block: a run of
/// `$` opens a formula and a run of backticks a code span, each closed by
/// the next run of the same length, whatever lies between — blanks, line
/// breaks, tags and escapes included (remark-math reads a formula like a
/// code span). Runs inside a display formula (`display`, settled first, as
/// flow comes before text) are not the sweep's. An escaped `$` or backtick
/// opens nothing, and neither does one inside an intact atom (`atoms`,
/// sorted): a tag, an autolink, a code span or a link's resource the editor
/// read first. An atom that a formula
/// or a code span opened earlier runs into is destroyed — its bytes are text
/// and it contributes nothing. The literal set is what the sweep emits: code
/// spans, intact tags and intact images into `out`, formulas into
/// `formulas` — apart, so the caller can read the body again with them
/// filled in. One pass over the runs, a closer taken from an index by byte
/// and raw length, so k unmatched runs cost O(k log k) after the O(n) walk
/// that finds them.
pub(super) fn inline_literals(
    content: &str,
    block: Range<usize>,
    atoms: &[Atom],
    display: &Literal,
    out: &mut Vec<Range<usize>>,
    formulas: &mut Vec<Range<usize>>,
) -> Swept {
    let mut runs = delimiter_runs(&content.as_bytes()[block.clone()]);
    // A run inside a display formula belongs to the formula, not to the
    // text around it: a stray `$$` in a paragraph never closes on the
    // `$$` that opens a display formula two lines down.
    runs.retain(|run| {
        !display.overlaps(block.start + run.start..block.start + run.start + run.len)
    });
    let mut by_key: HashMap<(u8, usize), Vec<usize>> = HashMap::new();
    for (r, run) in runs.iter().enumerate() {
        by_key.entry((run.byte, run.len)).or_default().push(r);
    }
    // The first run after `r` that is `len` bytes of `byte`, raw.
    let closer_after = |r: usize, byte: u8, len: usize| -> Option<usize> {
        let same = by_key.get(&(byte, len))?;
        same.get(same.partition_point(|&i| i <= r)).copied()
    };
    // The formulas and code spans read so far, in order, non-overlapping.
    let mut constructs: Vec<Range<usize>> = Vec::new();
    // The first of the atom's two anchors — where its construct began, and
    // where its own range begins (`]` for a link or an image; the same byte
    // for the rest) — that one of them opened before and runs past.
    let destroyed = |constructs: &[Range<usize>], a: &Atom| {
        [a.start, a.range.start].into_iter().find(|&at| {
            let i = constructs.partition_point(|c| c.start < at);
            i > 0 && constructs[i - 1].end > at
        })
    };
    let live = |atom: usize| atom < atoms.len() && atoms[atom].range.start < block.end;
    let mut atom = atoms.partition_point(|a| a.range.start < block.start);
    let mut swept = Swept {
        visited: 0,
        destroyed: None,
    };
    let mut r = 0;
    'runs: while r < runs.len() {
        swept.visited += 1;
        let run = runs[r];
        let start = block.start + run.start;
        // Atoms that begin at or before this run: destroyed, passed intact,
        // or holding this run and every run up to their end.
        while live(atom) && atoms[atom].range.start <= start {
            let a = &atoms[atom];
            atom += 1;
            if let Some(at) = destroyed(&constructs, a) {
                swept.destroyed.get_or_insert(at);
                continue;
            }
            a.contribute(out);
            if a.range.end > start {
                let end = a.range.end;
                while r < runs.len() && block.start + runs[r].start < end {
                    r += 1;
                }
                continue 'runs;
            }
        }
        let opener = run.start + usize::from(run.escaped);
        let len = run.len - usize::from(run.escaped);
        let closer = if len == 0 {
            None
        } else {
            closer_after(r, run.byte, len)
        };
        match closer {
            Some(c) => {
                let close_end = block.start + runs[c].start + runs[c].len;
                let range = block.start + opener..close_end;
                constructs.push(range.clone());
                if run.byte == b'$' {
                    formulas.push(range);
                } else {
                    out.push(range);
                }
                r = c + 1;
            }
            None => r += 1,
        }
    }
    // Atoms after the last run.
    while live(atom) {
        let a = &atoms[atom];
        atom += 1;
        match destroyed(&constructs, a) {
            Some(at) => {
                swept.destroyed.get_or_insert(at);
            }
            None => a.contribute(out),
        }
    }
    swept
}
