// The editor's rules of `md::literal` (issue 665), re-implemented from what
// remark reads: the left-to-right sweep that pairs `$`, backticks and the
// atoms the parser found; the display formula's extent; GFM's bare URLs.
// Measured, not derived from a specification — the sentinels of issue 669
// say which versions.

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

/// The editor's display rule (remark-math, like a fenced code block): a line
/// whose content opens with two or more `$` and carries no other `$` opens a
/// formula that ends with the line break of the next line that is a `$` run
/// at least as long and blanks — or, when no such line comes, where the
/// formula's containers end. Blank lines inside do not end it.
///
/// issue 664: where the containers end is NOT where pulldown says. remark's
/// math flow has no lazy continuation, so the formula runs only through the
/// lines that still carry every container prefix the opener's line carried:
/// a `>` (after up to three blanks) for each blockquote, the content column
/// for each list item — read off the opener line's own prefix, in order,
/// whatever pulldown made of the lines after (it reads a `>`-less line as
/// the lazy continuation of the paragraph it took the `$$` for). A blank
/// line keeps an item and ends a blockquote, as it does for the editor.
pub(super) fn display_math(
    content: &str,
    line_starts: &[(usize, usize)],
    out: &mut Vec<Range<usize>>,
) {
    let bytes = content.as_bytes();
    let mut skip_until = 0;
    for &(start, _) in line_starts {
        if start < skip_until {
            continue;
        }
        let open = bytes[start..].iter().take_while(|&&b| b == b'$').count();
        if open < 2 {
            continue;
        }
        let line_end = source_lines(&content[start..])
            .next()
            .map_or(content.len(), |line| {
                start + line.text.len() + line.terminator.len()
            });
        if bytes[start + open..line_end].contains(&b'$') {
            continue;
        }
        let line_start = bytes[..start]
            .iter()
            .rposition(|&b| b == b'\n' || b == b'\r')
            .map_or(0, |i| i + 1);
        let prefix = container_prefix(&content[line_start..start]);
        // The end of the last line that is still the formula's: the closing
        // line when one comes, else the last line that carries every
        // container prefix and is not blank.
        let mut end = line_end;
        for line in source_lines(&content[line_end..]) {
            let Some(rest) = continues(line.text, &prefix) else {
                break;
            };
            let after = line_end + line.offset + line.text.len() + line.terminator.len();
            let text = rest.trim_start_matches([' ', '\t']);
            let close = text.bytes().take_while(|&b| b == b'$').count();
            if close >= open && text[close..].trim_matches([' ', '\t']).is_empty() {
                end = after;
                break;
            }
            if !text.trim_matches([' ', '\t']).is_empty() {
                end = after;
            }
        }
        out.push(start..end);
        skip_until = end;
    }
}

/// What a line must carry to continue a container the formula opened in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Continue {
    /// A blockquote: up to three blanks, then `>`, then one optional blank.
    Quote,
    /// A list item: blank, or indented to its content column.
    Item { column: usize },
}

/// The containers a line's prefix opens, in order — the blockquote markers
/// and list markers before the content, with the column the item's content
/// starts at (a tab stop is four columns).
pub(super) fn container_prefix(prefix: &str) -> Vec<Continue> {
    let bytes = prefix.as_bytes();
    let mut reqs = Vec::new();
    let mut column = 0;
    let mut i = 0;
    let blanks = |mut i: usize, mut column: usize| {
        while let Some(&b) = bytes.get(i) {
            match b {
                b' ' => column += 1,
                b'\t' => column += 4 - column % 4,
                _ => break,
            }
            i += 1;
        }
        (i, column)
    };
    while i < bytes.len() {
        match bytes[i] {
            b' ' | b'\t' => (i, column) = blanks(i, column),
            b'>' => {
                reqs.push(Continue::Quote);
                i += 1;
                column += 1;
                if bytes.get(i) == Some(&b' ') {
                    i += 1;
                    column += 1;
                }
            }
            b'-' | b'+' | b'*' => {
                (i, column) = blanks(i + 1, column + 1);
                reqs.push(Continue::Item { column });
            }
            b'0'..=b'9' => {
                let digits = bytes[i..].iter().take_while(|b| b.is_ascii_digit()).count();
                i += digits;
                column += digits;
                if matches!(bytes.get(i), Some(b'.') | Some(b')')) {
                    i += 1;
                    column += 1;
                }
                (i, column) = blanks(i, column);
                reqs.push(Continue::Item { column });
            }
            _ => break,
        }
    }
    reqs
}

/// The text of `line` past every container prefix in `reqs`, or None when
/// the line does not carry them all — where the formula ends.
pub(super) fn continues<'a>(line: &'a str, reqs: &[Continue]) -> Option<&'a str> {
    let bytes = line.as_bytes();
    let mut i = 0;
    let mut column = 0;
    for req in reqs {
        match *req {
            Continue::Quote => {
                let mut j = i;
                while j < bytes.len() && j - i < 3 && bytes[j] == b' ' {
                    j += 1;
                }
                if bytes.get(j) != Some(&b'>') {
                    return None;
                }
                column += j - i + 1;
                j += 1;
                if bytes.get(j) == Some(&b' ') {
                    j += 1;
                    column += 1;
                }
                i = j;
            }
            Continue::Item { column: needed } => {
                if line[i..].trim_matches([' ', '\t']).is_empty() {
                    i = line.len();
                    continue;
                }
                let mut j = i;
                while j < bytes.len() && column < needed {
                    match bytes[j] {
                        b' ' => column += 1,
                        b'\t' => column += 4 - column % 4,
                        _ => break,
                    }
                    j += 1;
                }
                if column < needed {
                    return None;
                }
                i = j;
            }
        }
    }
    Some(&line[i..])
}

/// The bare URLs and e-mail addresses the editor reads as links
/// (remark-gfm's autolink literals), as byte ranges of `text` offset by
/// `base`. The rule as micromark applies it, measured, not as the GFM text
/// reads: a `www.`, `http://` or `https://` (any case) at the start of the
/// text or after a blank, `*`, `_`, `~` or `(`; then a domain — any run of
/// bytes that are not blanks, `<` or ASCII punctuation other than `-`, `.`
/// and `_` (a non-ASCII character counts, no period is required,
/// `localhost` and `1.2.3.4` pass) whose first character is a letter or a
/// digit (so not `-`, `.`, `_` or a punctuation mark such as `。`) and that
/// has no `_` in its last two `.`-segments; then anything up to a blank or
/// `<`. Trailing `?!.,:*_~` come off, so does an unbalanced `)`, and a
/// `&name;` entity. An address is `[A-Za-z0-9._+-]+@` and such a domain
/// with a period, its last byte neither `-` nor `_`. Left to right,
/// non-overlapping.
pub(super) fn autolink_literals(text: &str, base: usize) -> Vec<Range<usize>> {
    let bytes = text.as_bytes();
    let boundary = |i: usize| {
        i == 0
            || matches!(
                bytes[i - 1],
                b' ' | b'\t' | b'\n' | b'\r' | b'*' | b'_' | b'~' | b'('
            )
    };
    let domain_byte = |b: &u8| {
        !b.is_ascii_whitespace()
            && *b != b'<'
            && (!b.is_ascii_punctuation() || matches!(b, b'-' | b'.' | b'_'))
    };
    // No `_` in the last two `.`-segments (an empty segment counts as one).
    let underscores_ok = |dom: &[u8]| -> bool {
        let parts: Vec<&[u8]> = dom.split(|&b| b == b'.').collect();
        parts[parts.len().saturating_sub(2)..]
            .iter()
            .all(|p| !p.contains(&b'_'))
    };
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        // Byte-wise, any case: `i` may sit inside a multibyte character.
        let has = |p: &[u8]| {
            bytes
                .get(i..i + p.len())
                .is_some_and(|s| s.eq_ignore_ascii_case(p))
        };
        let prefix = if has(b"www.") {
            Some(0)
        } else if has(b"http://") {
            Some(7)
        } else if has(b"https://") {
            Some(8)
        } else {
            None
        };
        if let Some(skip) = prefix.filter(|_| boundary(i)) {
            let dom_start = i + skip;
            let dom_end = dom_start
                + bytes[dom_start..]
                    .iter()
                    .take_while(|b| domain_byte(b))
                    .count();
            let dom = &bytes[dom_start..dom_end];
            // The first character must be a letter or a digit — `-`, `.`,
            // `_` and any punctuation mark are refused there, and only
            // there (`a。b.test` passes). `dom_start` follows an ASCII
            // prefix, so it is a character boundary.
            let starts_well = text[dom_start..]
                .chars()
                .next()
                .is_some_and(|c| c.is_alphanumeric());
            if !dom.is_empty() && starts_well && underscores_ok(dom) {
                // Path: up to a blank or `<`.
                let mut end = dom_end
                    + bytes[dom_end..]
                        .iter()
                        .take_while(|b| !matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'<'))
                        .count();
                end = trim_autolink_end(bytes, i, end);
                out.push(base + i..base + end);
                i = end.max(i + 1);
                continue;
            }
        }
        if bytes[i] == b'@' {
            // An address: back over the local part, forward over the domain.
            let local = bytes[..i]
                .iter()
                .rev()
                .take_while(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'+' | b'-'))
                .count();
            let start = i - local;
            let dom_end = i
                + 1
                + bytes[i + 1..]
                    .iter()
                    .take_while(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
                    .count();
            let dom = &bytes[i + 1..dom_end];
            if local > 0
                && boundary(start)
                && dom.contains(&b'.')
                && underscores_ok(dom)
                && !matches!(dom.last(), Some(b'-' | b'_'))
            {
                out.push(base + start..base + dom_end);
                i = dom_end;
                continue;
            }
        }
        i += 1;
    }
    out
}

/// GFM's trailing rules for an autolink literal `bytes[start..end]`: drop
/// trailing `?!.,:*_~`; drop a `)` while the link has more `)` than `(`;
/// drop a `&name;` entity at the end. Returns the new end.
pub(super) fn trim_autolink_end(bytes: &[u8], start: usize, mut end: usize) -> usize {
    loop {
        let before = end;
        while end > start
            && matches!(
                bytes[end - 1],
                b'?' | b'!' | b'.' | b',' | b':' | b'*' | b'_' | b'~'
            )
        {
            end -= 1;
        }
        if end > start && bytes[end - 1] == b')' {
            let link = &bytes[start..end];
            let opens = link.iter().filter(|&&b| b == b'(').count();
            let closes = link.iter().filter(|&&b| b == b')').count();
            if closes > opens {
                end -= 1;
            }
        }
        if end > start && bytes[end - 1] == b';' {
            let name = bytes[start..end - 1]
                .iter()
                .rev()
                .take_while(|b| b.is_ascii_alphanumeric())
                .count();
            if name > 0 && end - 1 - name > start && bytes[end - 2 - name] == b'&' {
                end -= name + 2;
            }
        }
        if end == before {
            return end;
        }
    }
}
