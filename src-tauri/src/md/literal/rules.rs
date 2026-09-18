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
/// lines that still carry every container the opener's line was in: a `>`
/// (after up to three blanks) for each blockquote, the content width for
/// each list item — whatever pulldown made of the lines after (it reads a
/// `>`-less line as the lazy continuation of the paragraph it took the `$$`
/// for). A blank line keeps an item and ends a blockquote, as it does for
/// the editor.
///
/// Which containers those are comes from the parser's frames
/// (`LineStart::chain`), not from the opener line's own prefix: an item's
/// marker stands on the item's first line only, so a `$$` on a later line
/// has blanks before it and nothing to read a container from.
pub(super) fn display_math(
    content: &str,
    line_starts: &[LineStart],
    chains: &[Vec<Holder>],
    out: &mut Vec<Range<usize>>,
) {
    let bytes = content.as_bytes();
    let mut skip_until = 0;
    // Items and footnote definitions the editor closed where pulldown kept
    // them open: a line after a formula that does not carry them. To pulldown
    // that line is the lazy continuation of the paragraph it took the `$$`
    // for, and every later line start still stands inside them — indented
    // as they ask or not, they are over. A blockquote is not listed: a line
    // that carries its `>` is in a blockquote either way, the old one or a
    // new one, and one that does not is settled on the opener's own line.
    let mut closed: HashSet<Holder> = HashSet::new();
    let over = |holders: &[Holder], closed: &mut HashSet<Holder>| {
        closed.extend(
            holders
                .iter()
                .filter(|holder| holder.kind != HolderKind::Quote),
        );
    };
    for opener in line_starts {
        let container_end = opener.container_end;
        // A second read has `x` where a formula was, blanks included, so the
        // line start pulldown reports there may stand on the original's
        // blanks: the `$$` is past them.
        let start = opener.start
            + bytes[opener.start..]
                .iter()
                .take_while(|&&b| b == b' ' || b == b'\t')
                .count();
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
        // Without the items and footnote definitions the editor does not
        // have: the ones it closed, and the ones pulldown made of a formula's
        // own lines (a `- x` between `$$` and `$$` is a list item to it). A
        // container pulldown opened since is the editor's too, only not
        // inside those. A blockquote stays either way: what it asks is the
        // `>` itself, which the opener's line carries or does not.
        let chain: Vec<Holder> = chains[opener.chain]
            .iter()
            .filter(|holder| {
                holder.kind == HolderKind::Quote
                    || !(closed.contains(holder) || within(out, marker_byte(bytes, holder.start)))
            })
            .copied()
            .collect();
        let chain = &chain[..];
        let Some((reqs, modelled)) = requirements(content, start, chain) else {
            continue;
        };
        // The end of the last line that is still the formula's: the closing
        // line when one comes, else the last line that carries every
        // container and is not blank. A container this rule cannot read
        // keeps the parser's own container end as the bound.
        let bound = if modelled {
            content.len()
        } else {
            container_end
        };
        let mut end = line_end;
        for line in source_lines(&content[line_end..]) {
            let at = line_end + line.offset;
            if at >= bound {
                break;
            }
            let Some((text, indent)) = continues(line.text, &reqs) else {
                break;
            };
            let after = at + line.text.len() + line.terminator.len();
            // The closing run may be indented at most three columns past the
            // container's content, as a fenced code block's closer may.
            // Indented further, the line is the formula's — measured against
            // remark, tabs split across a container's edge included.
            let close = text.bytes().take_while(|&b| b == b'$').count();
            if indent <= 3 && close >= open && text[close..].trim_matches([' ', '\t']).is_empty() {
                end = after;
                break;
            }
            if !text.trim_matches([' ', '\t']).is_empty() {
                end = after;
            }
        }
        out.push(start..end);
        skip_until = end;
        // What follows a formula begins a block of its own to the editor.
        // pulldown took the `$$` for a paragraph and reads the lines after
        // as that paragraph's, lazily where need be — so a line indented
        // four columns past the containers it still carries is prose to it
        // and an indented code block to the editor. Only that case is read
        // here: blank lines and further such lines are the block's.
        if modelled {
            // The containers the opener's own line had already lost.
            over(&chain[reqs.len()..], &mut closed);
            let mut code_end = end;
            let mut live = reqs.len();
            for line in source_lines(&content[end..]) {
                if line.text.trim_matches([' ', '\t']).is_empty() {
                    continue;
                }
                // No paragraph is open after a formula, so this line is lazy
                // to nobody: what it does not carry is over.
                let (carried, indent) = carried_past(line.text, &reqs[..live]);
                over(&chain[carried..live], &mut closed);
                live = carried;
                if indent < 4 {
                    break;
                }
                code_end = end + line.offset + line.text.len() + line.terminator.len();
            }
            if code_end > end {
                out.push(end..code_end);
                skip_until = code_end;
            }
        }
    }
}

/// How many of `reqs` the line still carries, outermost first, up to the
/// first one it does not — and the columns of blanks it has left after them.
fn carried_past(line: &str, reqs: &[Continue]) -> (usize, usize) {
    let mut blanks = Blanks::new(line);
    let mut carried = 0;
    for req in reqs {
        let before = blanks;
        if !pass(&mut blanks, *req) {
            blanks = before;
            break;
        }
        carried += 1;
    }
    let mut indent = 0;
    while blanks.take() {
        indent += 1;
    }
    (carried, indent)
}

/// The first byte at or after `at` that is neither a blank nor a line break:
/// where an item's marker is. pulldown's start of an item may fall short of
/// it — on the blanks before the marker, or, behind a tab, on the line break
/// before the marker's line, which a formula closed on that line owns.
fn marker_byte(bytes: &[u8], at: usize) -> usize {
    at + bytes[at..]
        .iter()
        .take_while(|&&b| matches!(b, b' ' | b'\t' | b'\n' | b'\r'))
        .count()
}

/// Is `at` inside one of `ranges`? They are the display rule's own output:
/// in the note's order, none overlapping the next.
fn within(ranges: &[Range<usize>], at: usize) -> bool {
    let next = ranges.partition_point(|range| range.end <= at);
    ranges.get(next).is_some_and(|range| range.start <= at)
}

/// What a line must carry to continue a container the formula opened in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Continue {
    /// A blockquote: up to three blanks, then `>`, then one optional blank.
    Quote,
    /// A list item or a footnote definition: blank, or indented `width`
    /// columns past where the containers before it left off — micromark's
    /// `containerState.size`, a width, not a column of the line.
    Item { width: usize },
}

/// The line `at` stands on: where it starts, and its text without the line
/// break (`\n`, `\r\n` or a bare `\r`).
fn line_of(content: &str, at: usize) -> (usize, &str) {
    let bytes = content.as_bytes();
    let start = bytes[..at]
        .iter()
        .rposition(|&b| b == b'\n' || b == b'\r')
        .map_or(0, |i| i + 1);
    let end = bytes[at..]
        .iter()
        .position(|&b| b == b'\n' || b == b'\r')
        .map_or(content.len(), |i| at + i);
    (start, &content[start..end])
}

/// What the containers around the opener at `opener` ask of the lines after
/// it, outermost first, and whether every one of them was read — or None
/// when the line is no opener after all.
///
/// Each container is measured on its own first line — the one its marker
/// stands on — after the containers before it have been passed on that same
/// line: opened there too (`> - a`), or continued (`  - b` under `- a`). The
/// width an item asks for is what its prefix took of that line from where
/// the containers before it left off: the blanks before the marker, the
/// marker, the blanks after (one column when five or more follow, or when
/// nothing does). A footnote definition asks for four, whatever its own
/// indent.
///
/// The opener's own line then settles which of them the editor still has:
/// pulldown keeps a `$$` that lost its `>` or its indent inside the
/// container as a lazy continuation, where remark's math flow interrupts
/// the paragraph and the container is over — the requirements stop at the
/// first one the opener's line does not meet. What is left before the `$$`
/// must be less than four columns, as before any flow construct: four or
/// more make the line the paragraph's text, and no formula opens.
///
/// A container the editor does not have (a definition list), or a marker
/// line this rule cannot read, leaves the rest unread (`false`): the caller
/// keeps the parser's container end as the bound.
pub(super) fn requirements(
    content: &str,
    opener: usize,
    chain: &[Holder],
) -> Option<(Vec<Continue>, bool)> {
    let mut reqs: Vec<Continue> = Vec::with_capacity(chain.len());
    // The line each container's marker stands on, as resolved below.
    let mut marker_lines: Vec<usize> = Vec::with_capacity(chain.len());
    let mut read = true;
    'holders: for (k, holder) in chain.iter().enumerate() {
        // pulldown's start of an item is its marker minus the outer indent
        // in COLUMNS, taken off in bytes: behind a tab it falls short of the
        // marker's line, onto the line break before it. The marker is on
        // that line or the next.
        let (mut line_start, mut text) = line_of(content, holder.start);
        for _ in 0..2 {
            let outer = (&chain[..k], &reqs[..], &marker_lines[..]);
            if let Some(req) = measure(holder, (line_start, text), outer) {
                reqs.push(req);
                marker_lines.push(line_start);
                continue 'holders;
            }
            let next = line_start + text.len();
            let next = next
                + source_lines(&content[next..])
                    .next()
                    .map_or(0, |line| line.terminator.len());
            if next >= content.len() || next == line_start {
                break;
            }
            (line_start, text) = line_of(content, next);
        }
        // Unread from here on. The opener's line is still settled below
        // against what was read.
        read = false;
        break;
    }
    let (line_start, text) = line_of(content, opener);
    let mut blanks = Blanks::new(text);
    for k in 0..reqs.len() {
        let before = blanks;
        let met = if marker_lines[k] == line_start {
            open_at(&mut blanks, &chain[k], line_start).is_some()
        } else {
            pass(&mut blanks, reqs[k])
        };
        if !met {
            blanks = before;
            reqs.truncate(k);
            break;
        }
    }
    let mut indent = 0;
    while blanks.take() {
        indent += 1;
    }
    // Four columns of blanks past the last container the line carries: what
    // follows them opens nothing, a marker no more than a formula.
    if indent >= 4 {
        return None;
    }
    Some((reqs, read))
}

/// What `holder` asks of later lines, read on the line at `line` — after the
/// containers before it (`outer`: the holders, what they ask, and the lines
/// their markers stand on) have been passed there. None when the line does
/// not open it.
fn measure(
    holder: &Holder,
    line: (usize, &str),
    outer: (&[Holder], &[Continue], &[usize]),
) -> Option<Continue> {
    let (line_start, text) = line;
    let (holders, reqs, marker_lines) = outer;
    let mut blanks = Blanks::new(text);
    for (k, req) in reqs.iter().enumerate() {
        let passed = if marker_lines[k] == line_start {
            // Opened on this very line: read its prefix again.
            open_at(&mut blanks, &holders[k], line_start).is_some()
        } else {
            pass(&mut blanks, *req)
        };
        if !passed {
            return None;
        }
    }
    let (req, marker) = open_at(&mut blanks, holder, line_start)?;
    (line_start + marker >= holder.start).then_some(req)
}

/// `open`, after stepping to where the parser says the container starts when
/// that is the marker itself — a blockquote, a footnote definition. Text the
/// walk cannot pass may stand before it: a definition pulldown closed for
/// the one it opens on the same line, the prefix of an item that is not the
/// editor's. What these two ask does not depend on where they stand.
fn open_at(
    blanks: &mut Blanks<'_>,
    holder: &Holder,
    line_start: usize,
) -> Option<(Continue, usize)> {
    if matches!(holder.kind, HolderKind::Quote | HolderKind::Footnote) {
        if let Some(at) = holder.start.checked_sub(line_start) {
            blanks.advance_to(at);
        }
    }
    open(blanks, holder.kind)
}

/// Read the prefix that opens a container of `kind` where the cursor stands:
/// what it asks of later lines, and the byte the marker is at. None when the
/// line does not open such a container there.
fn open(blanks: &mut Blanks<'_>, kind: HolderKind) -> Option<(Continue, usize)> {
    let base = blanks.column;
    match kind {
        HolderKind::Quote => {
            if !before_quote_marker(blanks) {
                return None;
            }
            let marker = blanks.i;
            blanks.skip_marker();
            blanks.take();
            Some((Continue::Quote, marker))
        }
        HolderKind::Item => {
            // Up to three columns before the marker; a fourth makes the line
            // text or code, never an item — which matters once an item the
            // editor closed no longer stands before this one.
            while blanks.take() {}
            if blanks.column - base > 3 {
                return None;
            }
            let marker = blanks.i;
            match blanks.at()? {
                b'-' | b'+' | b'*' => blanks.skip_marker(),
                b'0'..=b'9' => {
                    let digits = blanks.rest().bytes().take_while(u8::is_ascii_digit).count();
                    if digits > 9 {
                        return None;
                    }
                    for _ in 0..digits {
                        blanks.skip_marker();
                    }
                    if !matches!(blanks.at(), Some(b'.' | b')')) {
                        return None;
                    }
                    blanks.skip_marker();
                }
                _ => return None,
            }
            let after = blanks.column;
            // The blanks after the marker are the item's up to four columns;
            // five or more are one column and an indented code block, and a
            // marker with nothing after it takes one as well.
            let mut probe = Blanks { ..*blanks };
            let mut following = 0;
            while probe.take() {
                following += 1;
            }
            let nothing_after = probe.rest().is_empty();
            if following == 0 && !nothing_after {
                return None;
            }
            let taken = if nothing_after || following >= 5 {
                1
            } else {
                following
            };
            for _ in 0..taken {
                blanks.take();
            }
            Some((
                Continue::Item {
                    width: after + taken - base,
                },
                marker,
            ))
        }
        HolderKind::Footnote => {
            while blanks.take() {}
            let marker = blanks.i;
            let rest = blanks.rest();
            if !rest.starts_with("[^") {
                return None;
            }
            // The label ends at the first `]` no backslash escapes.
            let bytes = rest.as_bytes();
            let mut close = 2;
            while close < bytes.len() && bytes[close] != b']' {
                close += if bytes[close] == b'\\' { 2 } else { 1 };
            }
            if bytes.get(close) != Some(&b']') || bytes.get(close + 1) != Some(&b':') {
                return None;
            }
            blanks.skip_text(&rest[..close + 2]);
            while blanks.take() {}
            Some((Continue::Item { width: 4 }, marker))
        }
        HolderKind::Unknown => None,
    }
}

/// Up to three columns of blanks, then `>`: a tab counts by its columns, and
/// one the blockquote before left half taken is the rest of them. A fourth
/// column, or a tab that runs past the third, leaves no `>` to read.
fn before_quote_marker(blanks: &mut Blanks<'_>) -> bool {
    let mut before = 0;
    while before < 3 && blanks.take() {
        before += 1;
    }
    blanks.taken == 0 && blanks.at() == Some(b'>')
}

/// Does the line carry `req` where the cursor stands? Takes what it carries.
fn pass(blanks: &mut Blanks<'_>, req: Continue) -> bool {
    match req {
        Continue::Quote => {
            if !before_quote_marker(blanks) {
                return false;
            }
            blanks.skip_marker();
            // The one optional blank after `>`: a space, or one column of
            // a tab, whose other columns are the content's.
            blanks.take();
            true
        }
        Continue::Item { width } => {
            if blanks.rest().trim_matches([' ', '\t']).is_empty() {
                blanks.skip_to_end();
                return true;
            }
            let base = blanks.column;
            while blanks.column - base < width && blanks.take() {}
            blanks.column - base >= width
        }
    }
}

/// The text of `line` past every container in `reqs` and past the blanks
/// after them, with how many columns those blanks span, or None when the
/// line does not carry every container — where the formula ends.
pub(super) fn continues<'a>(line: &'a str, reqs: &[Continue]) -> Option<(&'a str, usize)> {
    let mut blanks = Blanks::new(line);
    for req in reqs {
        if !pass(&mut blanks, *req) {
            return None;
        }
    }
    let mut indent = 0;
    while blanks.take() {
        indent += 1;
    }
    Some((blanks.rest(), indent))
}

/// A cursor over a line's blanks, in columns — a tab is the columns to the
/// next tab stop, and a container may take some of them and leave the rest
/// to whatever follows, as micromark reads a tab as virtual spaces.
#[derive(Clone, Copy)]
struct Blanks<'a> {
    line: &'a str,
    i: usize,
    column: usize,
    /// Columns of the tab at `i` already taken.
    taken: usize,
}

impl<'a> Blanks<'a> {
    fn new(line: &'a str) -> Self {
        Self {
            line,
            i: 0,
            column: 0,
            taken: 0,
        }
    }

    fn at(&self) -> Option<u8> {
        self.line.as_bytes().get(self.i).copied()
    }

    fn rest(&self) -> &'a str {
        &self.line[self.i..]
    }

    /// Take one column of blank; false when what follows is not a blank.
    fn take(&mut self) -> bool {
        match self.at() {
            Some(b' ') => {
                self.i += 1;
                self.column += 1;
                true
            }
            Some(b'\t') => {
                let width = 4 - (self.column - self.taken) % 4;
                self.taken += 1;
                self.column += 1;
                if self.taken == width {
                    self.i += 1;
                    self.taken = 0;
                }
                true
            }
            _ => false,
        }
    }

    /// Step over a one-byte marker such as `>`.
    fn skip_marker(&mut self) {
        self.i += 1;
        self.column += 1;
    }

    fn skip_to_end(&mut self) {
        self.i = self.line.len();
        self.taken = 0;
    }

    /// Step over `text`, which starts where the cursor stands. A column is
    /// a UTF-16 code unit, as micromark counts them — what a tab after an
    /// astral character stops at depends on it.
    fn skip_text(&mut self, text: &str) {
        self.i += text.len();
        self.column += text.encode_utf16().count();
        self.taken = 0;
    }

    /// Move forward to byte `i` of the line, over whatever stands between.
    fn advance_to(&mut self, i: usize) {
        while self.i < i && self.i < self.line.len() {
            if !self.take() {
                let next = self.line[self.i..].chars().next().map_or(1, char::len_utf8);
                let end = (self.i + next).min(self.line.len());
                self.skip_text(&self.line[self.i..end]);
            }
        }
    }
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
