// The container prefixes of `md::literal` (issues 664 and 665), read in
// columns as micromark reads them — a tab is the virtual spaces to the next
// tab stop, and a container may take some of them and leave the rest. What a
// blockquote, a list item or a footnote definition asks of a later line, how
// its opening prefix is read on its own marker line, and the cursor both
// walk with. Measured against remark; the sentinels of issue 669 say which
// versions.

use super::*;

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
        HolderKind::Quote => open_quote(blanks).map(|marker| (Continue::Quote, marker)),
        HolderKind::Item => open_item(blanks, base),
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
    }
}

/// The prefix of a list item where the cursor stands, `base` being the
/// column the containers before it left off at: what it asks of later
/// lines, and the byte its marker is at.
fn open_item(blanks: &mut Blanks<'_>, base: usize) -> Option<(Continue, usize)> {
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

/// A blockquote's prefix where the cursor stands — up to three columns of
/// blanks, `>`, one optional blank — and the byte the `>` is at. A tab
/// counts by its columns, and one the blockquote before left half taken is
/// the rest of them; a fourth column, or a tab that runs past the third,
/// leaves no `>` to read. The one blank after `>` is a space, or one column
/// of a tab whose other columns are the content's. Opening a blockquote and
/// continuing one read the same prefix.
fn open_quote(blanks: &mut Blanks<'_>) -> Option<usize> {
    let mut before = 0;
    while before < 3 && blanks.take() {
        before += 1;
    }
    if blanks.taken != 0 || blanks.at() != Some(b'>') {
        return None;
    }
    let marker = blanks.i;
    blanks.skip_marker();
    blanks.take();
    Some(marker)
}

/// Does the line carry `req` where the cursor stands? Takes what it carries.
fn pass(blanks: &mut Blanks<'_>, req: Continue) -> bool {
    match req {
        Continue::Quote => open_quote(blanks).is_some(),
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

/// Containers to walk a line through: the holders, what each asks, and the
/// line each marker stands on.
pub(super) type Chain<'a> = (&'a [Holder], &'a [Continue], &'a [usize]);

/// One walk over a line's container prefixes: how many of `reqs` it carries,
/// outermost first, up to the first one it does not — the cursor stays
/// before that one — then the blanks after them, in columns, and the text
/// past those blanks.
pub(super) fn carry<'a>(line: &'a str, reqs: &[Continue]) -> (usize, usize, &'a str) {
    let mut blanks = Blanks::new(line);
    let carried = pass_all(&mut blanks, reqs);
    let (indent, rest) = blanks_then_rest(&mut blanks);
    (carried, indent, rest)
}

/// The text of `line` past every container in `reqs` and past the blanks
/// after them, with how many columns those blanks span, or None when the
/// line does not carry every container — where the formula ends.
pub(super) fn continues<'a>(line: &'a str, reqs: &[Continue]) -> Option<(&'a str, usize)> {
    let (carried, indent, rest) = carry(line, reqs);
    (carried == reqs.len()).then_some((rest, indent))
}

/// The containers of `chain` a line still has, read left to right — opened
/// again where the marker stands on this very line, continued elsewhere —
/// up to the first one it does not: how many, and the blanks after them.
pub(super) fn settle(line: (usize, &str), chain: Chain<'_>) -> (usize, usize) {
    let mut blanks = Blanks::new(line.1);
    let passed = pass_holders(&mut blanks, line.0, chain);
    let (indent, _) = blanks_then_rest(&mut blanks);
    (passed, indent)
}

/// What `holder` asks of later lines, read on the line at `line` — after
/// the containers before it (`outer`) have been passed there. None when the
/// line does not open it.
pub(super) fn measure(holder: &Holder, line: (usize, &str), outer: Chain<'_>) -> Option<Continue> {
    let (line_start, text) = line;
    let mut blanks = Blanks::new(text);
    if pass_holders(&mut blanks, line_start, outer) < outer.0.len() {
        return None;
    }
    let (req, marker) = open_at(&mut blanks, holder, line_start)?;
    (line_start + marker >= holder.start).then_some(req)
}

/// Pass the holders of `chain` on the line starting at `line_start`, in
/// order: opened again where the marker stands on this line, continued
/// elsewhere. Stops before the first one the line does not carry, the
/// cursor restored to before it; returns how many passed.
fn pass_holders(blanks: &mut Blanks<'_>, line_start: usize, chain: Chain<'_>) -> usize {
    let (holders, reqs, marker_lines) = chain;
    for (k, req) in reqs.iter().enumerate() {
        let before = *blanks;
        let passed = if marker_lines[k] == line_start {
            open_at(blanks, &holders[k], line_start).is_some()
        } else {
            pass(blanks, *req)
        };
        if !passed {
            *blanks = before;
            return k;
        }
    }
    reqs.len()
}

/// Pass every `req` in order, stopping before the first the line does not
/// carry (the cursor restored to before it); how many passed.
fn pass_all(blanks: &mut Blanks<'_>, reqs: &[Continue]) -> usize {
    for (k, req) in reqs.iter().enumerate() {
        let before = *blanks;
        if !pass(blanks, *req) {
            *blanks = before;
            return k;
        }
    }
    reqs.len()
}

/// The blanks where the cursor stands, in columns, and the text past them.
fn blanks_then_rest<'a>(blanks: &mut Blanks<'a>) -> (usize, &'a str) {
    let mut indent = 0;
    while blanks.take() {
        indent += 1;
    }
    (indent, blanks.rest())
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
