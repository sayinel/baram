// §29 (issue 620) — which bytes of a note are prose, and which are literal.
//
// The link index and every rewriter recognise `[[…]]`, `((…#^id))` and
// `{{embed …}}` with regexes over the source text. A regex cannot tell a
// reference in a paragraph from the same characters inside a code fence, a
// code span, an HTML block, a formula or an image's alt text — so the index
// counted code examples as backlinks and a rename rewrote them. The editor
// never did: its pipeline parses the note and a reference inside a literal
// node is not a reference. This module gives the Rust side the same answer.
//
// The parser (pulldown-cmark) reads STRUCTURE only. It never sees the link
// syntax; it answers one question per byte range: is this prose? Everything
// it does not read as prose is literal — code blocks, HTML blocks, link
// reference definitions (which produce no events at all, duplicates
// included), blank lines and container prefixes (which hold no reference, so
// classifying them as literal is harmless). Inside prose, code spans, inline
// HTML tags, math and images are literal too. Prose is measured by BLOCK
// ranges (a paragraph, a heading, a table cell, a list item's own text), not
// by the gaps between inline events: a backslash escape inside
// `((n#^id|a\*b))` produces no event, and treating that gap as literal would
// silently exempt the reference from a rename — the wrong direction.
//
// Front matter is the one thing NOT handed to the parser. Property links
// (`related: "[[note]]"`) are indexed and rewritten today, like Obsidian; the
// parser would read the YAML as a thematic break, a setext heading or — when
// a list is indented four spaces — an indented code block. So the front
// matter is cut off first, by the editor's own rule (a `---` first line, a
// `---` line to close, trailing blanks allowed, unclosed is not front
// matter), kept as prose, and only the body is parsed.
//
// Every offset is a byte offset into the very string the caller's regexes
// run on. Check a candidate with `overlaps(range)`, never with a point: a
// reference that starts in prose and runs into a code span
// (`((n#^id|`x`))`) is left alone by the editor, so it is here.
//
// Math follows the editor's parser (remark-math), not pulldown's stricter
// rule, because the editor is what decides what a note's formulas are: a
// `$` run is a formula up to the next run of the same length, blanks and
// line breaks included (`$5 and $6` is one), left to right with code spans
// and escapes; a line that opens with `$$` (and meta without a `$`) is a
// display formula until a line that is `$$` and blanks, or — when none comes
// — until its container ends. pulldown's own math is OFF: it pairs runs
// differently (`$a$$ b` is a formula to it and text to the editor), and a
// formula it reads hides the tags and code spans inside from the rules
// here. It reports plain CommonMark inline structure; the two rules above
// are the only ones that read a `$`.
//
// Inside prose the parser's inline events are not taken as literal either.
// It reports where tags, autolinks, links, images and code spans are; one
// left-to-right sweep per block (`inline_literals`) then reads formulas and
// code spans by the rule above, treats a tag, an autolink or a link's
// resource as one piece a delimiter inside cannot open, and emits as
// literal only what survives: a tag or an image that no earlier formula or
// code span ran into. `<i title="$">` opens nothing; `$x<i title="$` is a
// formula and the rest of the tag is text — as the editor has it.
//
// The parser does not know a formula, so what it reports around one can be
// wrong: it pairs the backtick a formula swallows with a later one and hides
// the tag, image or link between them inside that code span. The sweep sees
// this happen — a construct the parser reported begins inside a formula the
// sweep read — and up to that point its formulas are right. So the body is
// read again with those formulas filled in with `x` (line breaks kept, same
// length): the parser no longer forms the construct, what it hid surfaces,
// and the sweep continues past the point with the right atoms. It repeats
// while a read still destroys something, a few times at most; a body where
// no formula runs into a construct — nearly every note — is read once.
//
// One difference from the editor is kept deliberately: a `((…))` inside the
// YAML front matter is prose here and literal there (see above).
use std::collections::HashMap;
use std::ops::Range;

use pulldown_cmark::{Event, LinkType, Options, Parser, Tag, TagEnd};

/// The parser options the editor's reader enables (remark-gfm), listed
/// explicitly so an upgrade of either side is a visible diff. YAML metadata
/// stays OFF: pulldown would also accept a `---` block in the middle of a
/// note and a `...` closer, and swallow lines remark reads as prose. Math
/// stays OFF too: `inline_math` and `display_math` below are the editor's
/// rules (remark-math), and pulldown's pairing differs from them.
const OPTIONS: Options = Options::ENABLE_TABLES
    .union(Options::ENABLE_STRIKETHROUGH)
    .union(Options::ENABLE_TASKLISTS)
    .union(Options::ENABLE_FOOTNOTES);

/// The literal byte ranges of one string: sorted, merged, non-empty.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Literal {
    ranges: Vec<Range<usize>>,
}

/// `Literal::analyse`: the literal set and the two counts the tests pin —
/// how many times the parser read the body, and how many formula ranges
/// the reads appended to the confirmed list in all, counted before the
/// list is deduplicated, so that appending a whole prefix per block (the
/// quadratic fault this guards against) shows as the sum it is.
struct Analysis {
    literal: Literal,
    // The two counts are read by the tests only.
    #[cfg_attr(not(test), allow(dead_code))]
    reads: usize,
    #[cfg_attr(not(test), allow(dead_code))]
    confirmed: usize,
}

impl Literal {
    /// Read `content`. The ranges index into `content` itself.
    pub fn of(content: &str) -> Literal {
        Literal::analyse(content).literal
    }

    /// `of`, with what the tests pin: how many times the body was handed
    /// to the parser — once for nearly every note, once more for every read
    /// in which a formula ran into a construct the parser had formed — and
    /// how many formulas were confirmed and filled in along the way. Each
    /// read confirms at least one more formula (the one that ran into the
    /// construct was not filled in, or it could not have), so the reads end;
    /// they are capped all the same, and a read that confirmed nothing new
    /// or hit the cap while a block still had a destroyed construct leaves
    /// that block literal from the anchor on — the parser's view of it past
    /// that point is known to be wrong, and touching nothing there is safe.
    fn analyse(content: &str) -> Analysis {
        const READS: usize = 8;
        let body_start = front_matter_end(content);
        let mut source = String::new();
        let mut confirmed: Vec<Range<usize>> = Vec::new();
        let mut appended = 0;
        let mut reads = 0;
        let (mut walk, mut inline) = loop {
            reads += 1;
            let body = if reads == 1 {
                &content[body_start..]
            } else {
                &source[body_start..]
            };
            let walk = collect(body, body_start);
            let mut atoms = walk.atoms.clone();
            atoms.sort_by_key(|atom| atom.range.start);
            let mut inline = walk.inline.clone();
            let mut formulas = Vec::new();
            // The blocks a construct was destroyed in, with the anchor: the
            // block's formulas that start before it are confirmed.
            let mut unsettled: Vec<(Range<usize>, usize)> = Vec::new();
            let known = confirmed.len();
            for block in &walk.prose {
                let first = formulas.len();
                let swept =
                    inline_literals(content, block.clone(), &atoms, &mut inline, &mut formulas);
                if let Some(at) = swept.destroyed {
                    let fresh = formulas[first..].iter().filter(|f| f.start < at).cloned();
                    let before = confirmed.len();
                    confirmed.extend(fresh);
                    appended += confirmed.len() - before;
                    unsettled.push((block.clone(), at));
                }
            }
            confirmed.sort_by_key(|f| f.start);
            confirmed.dedup();
            inline.extend(formulas);
            if unsettled.is_empty() {
                break (walk, inline);
            }
            if reads == READS || confirmed.len() == known {
                inline.extend(unsettled.into_iter().map(|(block, at)| at..block.end));
                break (walk, inline);
            }
            source = fill(content, &confirmed);
        };
        display_math(content, &walk.line_starts, &mut inline);
        // The front matter is prose (a property link is a link) but not
        // markdown: the editor reads no formula in it.
        if body_start > 0 {
            walk.prose.push(0..body_start);
        }

        // literal = complement(prose) ∪ inline literals
        let prose = merge(walk.prose);
        let mut ranges = Vec::with_capacity(prose.len() + inline.len() + 1);
        let mut cursor = 0;
        for range in &prose {
            if range.start > cursor {
                ranges.push(cursor..range.start);
            }
            cursor = range.end;
        }
        if cursor < content.len() {
            ranges.push(cursor..content.len());
        }
        ranges.extend(inline);
        Analysis {
            literal: Literal {
                ranges: merge(ranges),
            },
            reads,
            confirmed: appended,
        }
    }

    /// Does `range` share at least one byte with a literal range?
    pub fn overlaps(&self, range: Range<usize>) -> bool {
        if range.start >= range.end {
            return false;
        }
        // The first literal range that ends after `range` starts.
        let i = self.ranges.partition_point(|r| r.end <= range.start);
        self.ranges.get(i).is_some_and(|r| r.start < range.end)
    }

    /// `content` with every literal byte turned into a space — line breaks
    /// kept — so a text search over it cannot land inside a literal while
    /// every offset still means what it meant in `content`.
    pub fn blank(&self, content: &str) -> String {
        let mut out = String::with_capacity(content.len());
        let mut cursor = 0;
        for range in &self.ranges {
            out.push_str(&content[cursor..range.start]);
            out.extend(content[range.clone()].bytes().map(|byte| match byte {
                b'\n' | b'\r' => byte as char,
                _ => ' ',
            }));
            cursor = range.end;
        }
        out.push_str(&content[cursor..]);
        out
    }

    #[cfg(test)]
    fn ranges(&self) -> &[Range<usize>] {
        &self.ranges
    }
}

/// One line of a note, for the scanners that work a line at a time: its
/// 1-based number, the byte offset of `text` in the note, the text without
/// its line break, and that break (`"\n"`, `"\r\n"` or `""` at the end) so
/// a rewriter can put the note back together byte for byte. A bare `\r` is
/// not a line break, as for `str::lines`. The offset is what makes a
/// per-line regex match comparable with a `Literal`, which knows only the
/// whole note.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourceLine<'a> {
    pub number: u32,
    pub offset: usize,
    pub text: &'a str,
    pub terminator: &'a str,
}

/// The lines of `content`, in order — the same lines `content.lines()`
/// yields, with their offsets.
pub fn source_lines(content: &str) -> impl Iterator<Item = SourceLine<'_>> {
    let mut offset = 0;
    content
        .split_inclusive('\n')
        .enumerate()
        .map(move |(i, raw)| {
            let text = raw.strip_suffix('\n').unwrap_or(raw);
            let text = text.strip_suffix('\r').unwrap_or(text);
            let line = SourceLine {
                number: i as u32 + 1,
                offset,
                text,
                terminator: &raw[text.len()..],
            };
            offset += raw.len();
            line
        })
}

/// Where the body starts: past the YAML front matter when `content` opens
/// with one by the editor's rule, else 0. The front matter runs from a first
/// line `---` (trailing blanks allowed) through the next line `---` (trailing
/// blanks allowed) and that line's break; nothing closes it, nothing is
/// front matter.
fn front_matter_end(content: &str) -> usize {
    let is_fence = |text: &str| text.trim_end_matches([' ', '\t']) == "---";
    let mut lines = source_lines(content);
    // A byte order mark before the first `---` is not part of the fence. The
    // offsets below still count its bytes, so the front matter range keeps
    // them.
    let first = lines
        .next()
        .map(|line| line.text.strip_prefix('\u{FEFF}').unwrap_or(line.text));
    if !first.is_some_and(is_fence) {
        return 0;
    }
    lines
        .find(|line| is_fence(line.text))
        .map(|closer| {
            let end = closer.offset + closer.text.len();
            let rest = &content[end..];
            end + if rest.starts_with("\r\n") {
                2
            } else {
                usize::from(rest.starts_with('\n'))
            }
        })
        .unwrap_or(0)
}

/// An open block while walking the events. A list item's own text (a tight
/// item has no paragraph) is prose except where its child blocks are, so an
/// item remembers how far its text has been accounted for; a container
/// remembers where it ends, which is where an unclosed display formula ends.
enum Frame {
    Item { cursor: usize, end: usize },
    Container { end: usize },
    Paragraph,
    Other,
}

/// A span the parser read as one piece: an inline HTML tag, an autolink, a
/// code span, or the resource part of a link or an image (`](dest "title")`,
/// `][ref]`, `]`). The editor reads it before it looks for a formula or a
/// code span inside, so a delimiter there opens nothing — while the atom is
/// intact. A formula or a code span the sweep read that runs over the
/// construct's beginning (`start`: the `[` of a link, else the range's
/// start) or, for a link or an image, over its `]` (`range.start`) has
/// destroyed it: its bytes are plain text again, it contributes nothing,
/// and the parser must read the body again.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Atom {
    range: Range<usize>,
    start: usize,
    kind: AtomKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum AtomKind {
    /// The tag itself is literal.
    Html,
    /// A code span as the parser paired it: literal while intact. The sweep
    /// pairs backticks by the same rule; the parser's span is kept as the
    /// witness that a formula destroyed one.
    Code,
    /// An autolink's URL is prose, as link text is.
    Autolink,
    /// A link's destination, title or label: not literal, not prose to
    /// rename — the editor's text path treats it as the link does.
    LinkResource,
    /// An image's resource; an intact image is literal from `![` to its
    /// end, alt text included — the editor keeps alt text out of the model.
    ImageResource { image: Range<usize> },
}

impl Atom {
    /// What an intact atom adds to the literal set.
    fn contribute(&self, out: &mut Vec<Range<usize>>) {
        match &self.kind {
            AtomKind::Html | AtomKind::Code => out.push(self.range.clone()),
            AtomKind::ImageResource { image } => out.push(image.clone()),
            AtomKind::Autolink | AtomKind::LinkResource => {}
        }
    }
}

/// A link or an image still open while walking its text.
enum Open {
    Link,
    Autolink,
    Image,
}

/// The atom a link or an image leaves once it closes: the whole autolink,
/// or the resource after the text.
fn resource_atom(range: Range<usize>, text_end: usize, open: Open) -> Option<Atom> {
    let (start, end) = (range.start, range.end);
    match open {
        Open::Autolink => Some(Atom {
            range,
            start,
            kind: AtomKind::Autolink,
        }),
        Open::Link => (text_end < end).then_some(Atom {
            range: text_end..end,
            start,
            kind: AtomKind::LinkResource,
        }),
        Open::Image => Some(Atom {
            range: text_end.min(end)..end,
            start,
            kind: AtomKind::ImageResource { image: range },
        }),
    }
}

/// What one walk over the body found, in offsets of the whole note.
struct Walk {
    /// The block ranges that hold prose.
    prose: Vec<Range<usize>>,
    /// Math spans the parser would report — none while `OPTIONS` leaves
    /// math off; the field stays with the exhaustive match.
    inline: Vec<Range<usize>>,
    /// The atoms of the body (see `Atom`), in event order.
    atoms: Vec<Atom>,
    /// Where a line's content starts inside a paragraph or a list item's
    /// own text — the positions a display formula may open at — with the
    /// end of the innermost container around it.
    line_starts: Vec<(usize, usize)>,
}

/// Walk the body once (`base` is the body's offset in the note).
fn collect(body: &str, base: usize) -> Walk {
    let limit = base + body.len();
    let mut walk = Walk {
        prose: Vec::new(),
        inline: Vec::new(),
        atoms: Vec::new(),
        line_starts: Vec::new(),
    };
    let mut stack: Vec<Frame> = Vec::new();
    // Open links and images: the range, how far the text (alt) has run, and
    // which kind — the resource after the text becomes an atom on close.
    let mut links: Vec<(Range<usize>, usize, Open)> = Vec::new();
    let mut at_line_start = true;
    for (event, range) in Parser::new_ext(body, OPTIONS).into_offset_iter() {
        let range = range.start + base..range.end + base;
        // Inside an open link or image every event up to its End is text.
        if let Some((_, text_end, _)) = links.last_mut() {
            if !matches!(event, Event::End(TagEnd::Link | TagEnd::Image)) {
                *text_end = (*text_end).max(range.end);
            }
        }
        match event {
            Event::Start(tag) => {
                let frame = match &tag {
                    Tag::Paragraph => Some(Frame::Paragraph),
                    Tag::Item => Some(Frame::Item {
                        cursor: range.start,
                        end: range.end,
                    }),
                    Tag::BlockQuote(_)
                    | Tag::FootnoteDefinition(_)
                    | Tag::DefinitionListDefinition => Some(Frame::Container { end: range.end }),
                    Tag::Heading { .. }
                    | Tag::CodeBlock(_)
                    | Tag::HtmlBlock
                    | Tag::List(_)
                    | Tag::DefinitionList
                    | Tag::DefinitionListTitle
                    | Tag::Table(_)
                    | Tag::TableHead
                    | Tag::TableRow
                    | Tag::TableCell
                    | Tag::MetadataBlock(_) => Some(Frame::Other),
                    Tag::Emphasis
                    | Tag::Strong
                    | Tag::Strikethrough
                    | Tag::Superscript
                    | Tag::Subscript
                    | Tag::Link { .. }
                    | Tag::Image { .. } => None,
                };
                match &tag {
                    // Prose blocks: the whole source range, container
                    // prefixes, markers and escapes included.
                    Tag::Paragraph | Tag::Heading { .. } | Tag::TableCell => {
                        walk.prose.push(range.clone());
                    }
                    // An image's text is read like link text; what it leaves
                    // as literal is decided when it closes (see `Atom`).
                    Tag::Image { .. } => links.push((range.clone(), range.start + 2, Open::Image)),
                    Tag::BlockQuote(_)
                    | Tag::CodeBlock(_)
                    | Tag::HtmlBlock
                    | Tag::List(_)
                    | Tag::Item
                    | Tag::FootnoteDefinition(_)
                    | Tag::DefinitionList
                    | Tag::DefinitionListTitle
                    | Tag::DefinitionListDefinition
                    | Tag::Table(_)
                    | Tag::TableHead
                    | Tag::TableRow
                    | Tag::MetadataBlock(_)
                    | Tag::Emphasis
                    | Tag::Strong
                    | Tag::Strikethrough
                    | Tag::Superscript
                    | Tag::Subscript => {}
                    Tag::Link { link_type, .. } => {
                        let open = if matches!(link_type, LinkType::Autolink | LinkType::Email) {
                            Open::Autolink
                        } else {
                            Open::Link
                        };
                        links.push((range.clone(), range.start + 1, open));
                    }
                }
                match frame {
                    Some(frame) => {
                        leave_item_text_before(&mut stack, &range, &mut walk.prose);
                        stack.push(frame);
                        at_line_start = true;
                    }
                    None => {
                        note_line_start(&stack, &mut at_line_start, range.start, limit, &mut walk);
                    }
                }
            }
            Event::End(tag) => {
                if matches!(tag, TagEnd::Link | TagEnd::Image) {
                    if let Some((link, text_end, open)) = links.pop() {
                        walk.atoms.extend(resource_atom(link, text_end, open));
                    }
                }
                let is_block = match tag {
                    TagEnd::Paragraph
                    | TagEnd::Heading(_)
                    | TagEnd::BlockQuote(_)
                    | TagEnd::CodeBlock
                    | TagEnd::HtmlBlock
                    | TagEnd::List(_)
                    | TagEnd::Item
                    | TagEnd::FootnoteDefinition
                    | TagEnd::DefinitionList
                    | TagEnd::DefinitionListTitle
                    | TagEnd::DefinitionListDefinition
                    | TagEnd::Table
                    | TagEnd::TableHead
                    | TagEnd::TableRow
                    | TagEnd::TableCell
                    | TagEnd::MetadataBlock(_) => true,
                    TagEnd::Emphasis
                    | TagEnd::Strong
                    | TagEnd::Strikethrough
                    | TagEnd::Superscript
                    | TagEnd::Subscript
                    | TagEnd::Link
                    | TagEnd::Image => false,
                };
                if is_block {
                    if let Some(Frame::Item { cursor, end }) = stack.pop() {
                        if cursor < end {
                            walk.prose.push(cursor..end);
                        }
                    }
                    at_line_start = true;
                }
            }
            // An inline HTML tag and a code span are atoms: literal if the
            // sweep reaches them intact (see `Atom`).
            Event::InlineHtml(_) => {
                note_line_start(&stack, &mut at_line_start, range.start, limit, &mut walk);
                walk.atoms.push(Atom {
                    start: range.start,
                    range,
                    kind: AtomKind::Html,
                });
            }
            Event::Code(_) => {
                note_line_start(&stack, &mut at_line_start, range.start, limit, &mut walk);
                walk.atoms.push(Atom {
                    start: range.start,
                    range,
                    kind: AtomKind::Code,
                });
            }
            // Math events cannot occur while `OPTIONS` leaves math off; the
            // arm stays so the match is exhaustive when the crate is upgraded.
            Event::InlineMath(_) | Event::DisplayMath(_) => {
                note_line_start(&stack, &mut at_line_start, range.start, limit, &mut walk);
                walk.inline.push(range);
            }
            // A thematic break is a block with no Start/End: it ends an
            // item's own text like any other child block.
            Event::Rule => {
                leave_item_text_before(&mut stack, &range, &mut walk.prose);
                at_line_start = true;
            }
            Event::SoftBreak | Event::HardBreak => at_line_start = true,
            Event::Text(_) | Event::FootnoteReference(_) | Event::TaskListMarker(_) => {
                note_line_start(&stack, &mut at_line_start, range.start, limit, &mut walk);
            }
            // Lines of an HTML block: not prose, and never where a display
            // formula opens.
            Event::Html(_) => at_line_start = false,
        }
    }
    walk
}

/// The first inline event of a line, inside a paragraph or a list item's
/// own text, marks where that line's content starts.
fn note_line_start(
    stack: &[Frame],
    at_line_start: &mut bool,
    start: usize,
    limit: usize,
    walk: &mut Walk,
) {
    if !*at_line_start {
        return;
    }
    *at_line_start = false;
    if !matches!(stack.last(), Some(Frame::Paragraph | Frame::Item { .. })) {
        return;
    }
    let container_end = stack
        .iter()
        .rev()
        .find_map(|frame| match frame {
            Frame::Item { end, .. } | Frame::Container { end } => Some(*end),
            Frame::Paragraph | Frame::Other => None,
        })
        .unwrap_or(limit);
    walk.line_starts.push((start, container_end));
}

/// A child block that starts directly under a list item ends the item's
/// own text before it: that text is prose, the child accounts for itself.
fn leave_item_text_before(
    stack: &mut [Frame],
    child: &Range<usize>,
    prose: &mut Vec<Range<usize>>,
) {
    if let Some(Frame::Item { cursor, .. }) = stack.last_mut() {
        if child.start > *cursor {
            prose.push(*cursor..child.start);
        }
        *cursor = (*cursor).max(child.end);
    }
}

/// A maximal run of `$` or backticks in a prose block, as the raw bytes have
/// it: where it starts, how long it is, and whether a backslash escapes its
/// first character. A closer is matched raw — an escape inside a formula is
/// content, as inside a code span — so the raw length is a closer's length;
/// an opener that starts behind an escape is the run minus that character.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Run {
    start: usize,
    len: usize,
    byte: u8,
    escaped: bool,
}

/// The delimiter runs of `bytes`, left to right, in one pass. The escape walk
/// is the editor's: a backslash before ASCII punctuation escapes that one
/// character (`\\$` leaves the `$` live, `\$$` leaves an opener of one).
fn delimiter_runs(bytes: &[u8]) -> Vec<Run> {
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
struct Swept {
    /// How many runs the pass visited — the count the tests pin.
    visited: usize,
    /// Where the first atom began that a formula or a code span the sweep
    /// read had opened before and run into — the parser formed it on a text
    /// the editor never reads, so the body must be read again.
    destroyed: Option<usize>,
}

/// The editor's left-to-right inline rule over one prose block: a run of
/// `$` opens a formula and a run of backticks a code span, each closed by
/// the next run of the same length, whatever lies between — blanks, line
/// breaks, tags and escapes included (remark-math reads a formula like a
/// code span). An escaped `$` or backtick opens nothing, and neither does
/// one inside an intact atom (`atoms`, sorted): a tag, an autolink, a code
/// span or a link's resource the editor read first. An atom that a formula
/// or a code span opened earlier runs into is destroyed — its bytes are text
/// and it contributes nothing. The literal set is what the sweep emits: code
/// spans, intact tags and intact images into `out`, formulas into
/// `formulas` — apart, so the caller can read the body again with them
/// filled in. One pass over the runs, a closer taken from an index by byte
/// and raw length, so k unmatched runs cost O(k log k) after the O(n) walk
/// that finds them.
fn inline_literals(
    content: &str,
    block: Range<usize>,
    atoms: &[Atom],
    out: &mut Vec<Range<usize>>,
    formulas: &mut Vec<Range<usize>>,
) -> Swept {
    let runs = delimiter_runs(&content.as_bytes()[block.clone()]);
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
/// at least as long and blanks — or, when no such line comes before the
/// container ends, at the container's end. Blank lines inside do not end it.
fn display_math(content: &str, line_starts: &[(usize, usize)], out: &mut Vec<Range<usize>>) {
    let bytes = content.as_bytes();
    let mut skip_until = 0;
    for &(start, container_end) in line_starts {
        if start < skip_until {
            continue;
        }
        let open = bytes[start..].iter().take_while(|&&b| b == b'$').count();
        if open < 2 {
            continue;
        }
        let line_end = content[start..]
            .find('\n')
            .map_or(content.len(), |i| start + i + 1);
        if bytes[start + open..line_end].contains(&b'$') {
            continue;
        }
        let end = source_lines(&content[line_end..])
            .take_while(|line| line_end + line.offset < container_end)
            .find(|line| {
                let text = line.text.trim_start_matches([' ', '\t', '>']);
                let close = text.bytes().take_while(|&b| b == b'$').count();
                close >= open && text[close..].trim_matches([' ', '\t']).is_empty()
            })
            .map_or(container_end, |line| {
                line_end + line.offset + line.text.len() + line.terminator.len()
            });
        out.push(start..end);
        skip_until = end;
    }
}

/// `content` with every byte of `ranges` turned into `x` — line breaks kept
/// — so the parser reads plain text of the same length where the formulas
/// are, and every offset it reports still means what it meant. A formula
/// starts and ends at a `$`, so the bytes stay valid UTF-8.
fn fill(content: &str, ranges: &[Range<usize>]) -> String {
    let mut bytes = content.as_bytes().to_vec();
    for range in ranges {
        for byte in &mut bytes[range.clone()] {
            if !matches!(*byte, b'\n' | b'\r') {
                *byte = b'x';
            }
        }
    }
    String::from_utf8(bytes).unwrap_or_else(|_| content.to_owned())
}

/// Sort and merge touching or overlapping ranges, dropping empty ones.
fn merge(mut ranges: Vec<Range<usize>>) -> Vec<Range<usize>> {
    ranges.retain(|r| r.start < r.end);
    ranges.sort_by_key(|r| (r.start, r.end));
    let mut out: Vec<Range<usize>> = Vec::with_capacity(ranges.len());
    for range in ranges {
        match out.last_mut() {
            Some(last) if range.start <= last.end => last.end = last.end.max(range.end),
            _ => out.push(range),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use regex::Regex;
    use std::sync::LazyLock;

    /// Every `((n#^o…))` reference in `md`, in order: is it editable (prose)?
    fn refs(md: &str) -> Vec<bool> {
        static REF: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"\(\(n#\^o(?:\|[^)]*)?\)\)").unwrap());
        let literal = Literal::of(md);
        REF.find_iter(md)
            .map(|m| !literal.overlaps(m.range()))
            .collect()
    }

    /// The literal slices of `md`, for reading a classification directly.
    fn literal_texts(md: &str) -> Vec<&str> {
        Literal::of(md)
            .ranges()
            .iter()
            .map(|r| &md[r.clone()])
            .collect()
    }

    #[test]
    fn code_is_literal_where_the_parser_finds_it_containers_included() {
        // A fence inside a blockquote, and one the blockquote's end closes.
        assert_eq!(refs("> ```\n> ((n#^o))\n> ```\n((n#^o))\n"), [false, true]);
        assert_eq!(refs("> ```\n> ((n#^o))\n\n((n#^o))\n"), [false, true]);
        // Indented code, by space or tab.
        assert_eq!(refs("    ((n#^o))\n"), [false]);
        assert_eq!(refs("\t((n#^o))\n"), [false]);
        // A tilde fence does not close a backtick fence.
        assert_eq!(refs("```\n((n#^o))\n~~~\n((n#^o))\n```\n"), [false, false]);
        // A code span may cross a line break.
        assert_eq!(refs("`a\n((n#^o)) b`\n((n#^o))\n"), [false, true]);
    }

    #[test]
    fn four_spaces_after_a_list_item_are_a_paragraph_not_code() {
        assert_eq!(refs("- item\n\n    ((n#^o))\n"), [true]);
    }

    #[test]
    fn a_reference_that_runs_into_a_code_span_is_left_alone() {
        assert_eq!(refs("((n#^o|`x`))\n"), [false]);
        assert_eq!(refs("see `((n#^o))` and ((n#^o))\n"), [false, true]);
    }

    #[test]
    fn html_blocks_end_at_a_blank_line_and_inline_tags_cover_only_themselves() {
        assert_eq!(
            refs("<div>\n((n#^o))\n</div>\n((n#^o))\n\n((n#^o))\n"),
            [false, false, true]
        );
        assert_eq!(refs("<span>((n#^o))</span>\n"), [true]);
        assert_eq!(refs("<!-- ((n#^o)) -->\n((n#^o))\n"), [false, true]);
        assert_eq!(refs("<?php ((n#^o)) ?>\n"), [false]);
        // Markdown inside <details> after a blank line is prose.
        assert_eq!(
            refs("<details>\n<summary>x</summary>\n\n((n#^o))\n\n</details>\n"),
            [true]
        );
    }

    #[test]
    fn images_are_literal_alt_text_included_but_links_are_prose() {
        assert_eq!(refs("![a ((n#^o))](x.png) ((n#^o))\n"), [false, true]);
        assert_eq!(refs("[t ((n#^o))](https://x) ((n#^o))\n"), [true, true]);
    }

    #[test]
    fn link_reference_definitions_are_literal_duplicates_included() {
        // The parser emits no event for a definition — and none for a
        // duplicate label, which its definition map does not even keep.
        assert_eq!(
            refs("[r]: ((n#^o))\n[r]: ((n#^o))\n\n((n#^o)) [r]\n"),
            [false, false, true]
        );
    }

    #[test]
    fn math_is_literal() {
        assert_eq!(refs("$((n#^o))$ and ((n#^o))\n"), [false, true]);
        assert_eq!(refs("$$\n((n#^o))\n$$\n((n#^o))\n"), [false, true]);
    }

    /// The editor's parser (remark-math) reads a `$` run like a backtick
    /// run: any content up to the next run of the same length, blanks and
    /// line breaks included, left to right with code spans and escapes.
    /// pulldown's own rule is stricter; the editor's is the contract.
    #[test]
    fn inline_math_follows_the_editors_rule() {
        assert_eq!(refs("$ ((n#^o)) $ x ((n#^o))\n"), [false, true]);
        assert_eq!(refs("$5 ((n#^o)) $6 ((n#^o))\n"), [false, true]);
        assert_eq!(refs("$a\n((n#^o)) b$ ((n#^o))\n"), [false, true]);
        // An escaped dollar opens nothing; the next one does.
        assert_eq!(refs("\\$((n#^o))$ ((n#^o))$\n"), [true, false]);
        // Whichever opens first wins: a code span swallows a dollar, a
        // formula swallows a backtick.
        assert_eq!(refs("`$` ((n#^o)) $\n"), [true]);
        assert_eq!(refs("$ x `y` ((n#^o)) $\n"), [false]);
        assert_eq!(refs("$$ ((n#^o)) $$ ((n#^o))\n"), [false, true]);
        // A run of another length is content, not a closer.
        assert_eq!(refs("$$ ((n#^o)) $ ((n#^o)) $$\n"), [false, false]);
    }

    /// A line that opens with `$$` (plus optional meta without a `$`) is a
    /// display formula to the editor until a line that is `$$` and blanks —
    /// or, when none comes, until its container ends: the blockquote, the
    /// list item, the note. Blank lines inside do not end it.
    #[test]
    fn display_math_runs_to_its_closing_line_or_to_the_end_of_its_container() {
        assert_eq!(refs("$$\n((n#^o))\n\n((n#^o))\n"), [false, false]);
        assert_eq!(
            refs("$$\n((n#^o))\n\n((n#^o))\n$$\n((n#^o))\n"),
            [false, false, true]
        );
        assert_eq!(refs("$$\n((n#^o))\n$$ y\n((n#^o))\n"), [false, false]);
        assert_eq!(refs("$$latex\n((n#^o))\n$$\n((n#^o))\n"), [false, true]);
        assert_eq!(refs("text\n$$\n((n#^o))\n$$\n((n#^o))\n"), [false, true]);
        assert_eq!(refs("> $$\n> ((n#^o))\n\n((n#^o))\n"), [false, true]);
        assert_eq!(refs("- $$\n  ((n#^o))\n\n((n#^o))\n"), [false, true]);
        assert_eq!(
            refs("> a\n> $$\n> ((n#^o))\n>\n> ((n#^o))\n\n((n#^o))\n"),
            [false, false, true]
        );
        // A closer shorter than the opener is content.
        assert_eq!(
            refs("$$$\n((n#^o))\n$$\n((n#^o))\n$$$\n((n#^o))\n"),
            [false, false, true]
        );
    }

    #[test]
    fn reference_style_images_are_literal_like_inline_ones() {
        assert_eq!(
            refs("![a ((n#^o))][pic] ![((n#^o))] ((n#^o))\n\n[pic]: x.png\n[((n#^o))]: z.png\n"),
            [false, false, true, false]
        );
        // Without a definition the brackets are text.
        assert_eq!(refs("![a ((n#^o))][nodef]\n"), [true]);
    }

    #[test]
    fn prose_is_measured_by_blocks_so_escapes_and_emphasis_inside_a_reference_stay_prose() {
        assert_eq!(refs("((n#^o|a\\*b)) ((n#^o|*x* **y**))\n"), [true, true]);
        assert_eq!(refs("\\((n#^o))\n"), [true]);
    }

    #[test]
    fn list_items_tables_headings_and_footnotes_are_prose() {
        assert_eq!(
            refs("- ((n#^o))\n- [ ] ((n#^o))\n  - ((n#^o))\n"),
            [true, true, true]
        );
        assert_eq!(refs("1. ((n#^o))\n\n   ((n#^o))\n"), [true, true]);
        // An item's own text is prose; a code block nested in it is not.
        assert_eq!(
            refs("- ((n#^o))\n\n  ```\n  ((n#^o))\n  ```\n\n  ((n#^o))\n"),
            [true, false, true]
        );
        assert_eq!(
            refs("| ((n#^o)) | `((n#^o))` |\n|---|---|\n| ((n#^o)) | x |\n"),
            [true, false, true]
        );
        assert_eq!(refs("# ((n#^o)) #\n\n((n#^o))\n===\n"), [true, true]);
        assert_eq!(refs("x[^1]\n\n[^1]: ((n#^o))\n"), [true]);
        assert_eq!(refs("> ((n#^o))\n> - ((n#^o))\n"), [true, true]);
    }

    #[test]
    fn a_thematic_break_inside_a_list_item_does_not_swallow_the_text_around_it() {
        assert_eq!(refs("- ((n#^o))\n\n  ---\n\n  ((n#^o))\n"), [true, true]);
    }

    #[test]
    fn front_matter_is_prose_and_is_not_handed_to_the_parser() {
        // The four-space YAML list would be an indented code block to the
        // parser; property links are links.
        assert_eq!(
            refs("---\nref: ((n#^o))\n    - ((n#^o))\n---\n((n#^o))\n"),
            [true, true, true]
        );
        assert_eq!(refs("--- \nref: x\n\n    ((n#^o))\n---  \n"), [true]);
        assert_eq!(
            refs("---\r\nref: x\r\n\r\n    ((n#^o))\r\n---\r\n((n#^o))\r\n"),
            [true, true]
        );
        assert_eq!(refs("---\n---\n((n#^o))\n"), [true]);
    }

    #[test]
    fn what_is_not_front_matter_by_the_editors_rule_is_parsed_as_markdown() {
        // Not on the first line; unclosed; closed by `...`; a leading blank.
        for md in [
            "\n---\nref: x\n\n    ((n#^o))\n---\n",
            "---\nref: x\n\n    ((n#^o))\n",
            "---\nref: x\n\n    ((n#^o))\n...\n",
            " ---\nref: x\n\n    ((n#^o))\n---\n",
        ] {
            assert_eq!(refs(md), [false], "{md:?}");
        }
    }

    #[test]
    fn offsets_are_bytes_of_the_original_crlf_bom_and_multibyte_text_included() {
        assert_eq!(
            refs("a `x` b\r\n((n#^o))\r\n```\r\n((n#^o))\r\n```\r\n"),
            [true, false]
        );
        let bom = "\u{FEFF}((n#^o))`x`\n";
        assert_eq!(refs(bom), [true]);
        assert!(literal_texts(bom).contains(&"`x`"));
        assert_eq!(
            refs("한글 ((n#^o)) 🙂 `((n#^o))` e\u{301}((n#^o))\n"),
            [true, false, true]
        );
    }

    #[test]
    fn the_ranges_are_sorted_merged_and_non_empty() {
        let literal = Literal::of("`a``b` x\n\n```\nc\n```\n[d]: e\n");
        let ranges = literal.ranges();
        assert!(ranges.iter().all(|r| r.start < r.end));
        assert!(ranges.windows(2).all(|w| w[0].end < w[1].start));
        assert_eq!(Literal::of("").ranges(), &[] as &[Range<usize>]);
        assert!(!Literal::of("").overlaps(0..0));
        assert!(!Literal::of("plain\n").overlaps(0..5));
    }

    #[test]
    fn overlaps_is_an_interval_test() {
        let literal = Literal::of("ab `cd` ef\n");
        assert!(literal.overlaps(2..4)); // ends inside the span
        assert!(literal.overlaps(5..9)); // starts inside it
        assert!(literal.overlaps(0..11)); // covers it
        assert!(!literal.overlaps(0..3)); // ends where it starts
        assert!(!literal.overlaps(7..11)); // starts where it ends
        assert!(!literal.overlaps(4..4)); // empty
    }

    #[test]
    fn blank_keeps_every_offset_and_every_line_break() {
        let md = "a `((n#^o))` b\r\n```\n((n#^o))\n```\n((n#^o))\n";
        let blanked = Literal::of(md).blank(md);
        assert_eq!(blanked.len(), md.len());
        assert_eq!(blanked, "a            b\r\n   \n        \n   \n((n#^o))\n");
    }

    #[test]
    fn source_lines_carry_the_offsets_content_lines_loses() {
        let md = "ab\r\ncd\n\nef";
        let lines: Vec<(u32, usize, &str)> = source_lines(md)
            .map(|l| (l.number, l.offset, l.text))
            .collect();
        assert_eq!(
            lines,
            [(1, 0, "ab"), (2, 4, "cd"), (3, 7, ""), (4, 8, "ef")]
        );
        assert_eq!(
            source_lines(md).map(|l| l.terminator).collect::<Vec<_>>(),
            ["\r\n", "\n", "\n", ""]
        );
        assert_eq!(
            source_lines(md)
                .map(|l| format!("{}{}", l.text, l.terminator))
                .collect::<String>(),
            md
        );
        assert_eq!(
            source_lines(md).map(|l| l.text).collect::<Vec<_>>(),
            md.lines().collect::<Vec<_>>()
        );
        assert_eq!(source_lines("").count(), 0);
        assert_eq!(source_lines("x\n").count(), 1);
        // A bare CR is not a line break, as for `str::lines`.
        assert_eq!(source_lines("a\rb\n").next().unwrap().text, "a\rb");
    }

    /// remark reads an inline HTML tag before it looks for a formula, left
    /// to right, so a `$` or a backtick inside a tag's attribute opens
    /// nothing — but a formula that opened before the tag swallows it, raw.
    #[test]
    fn a_delimiter_inside_an_inline_html_tag_opens_nothing() {
        assert_eq!(refs("<i title=\"$\"> ((n#^o)) $\n"), [true]);
        assert_eq!(refs("<i title=\"`\"> $ ((n#^o)) $ `\n"), [false]);
        assert_eq!(refs("$ <i> ((n#^o)) $\n"), [false]);
        assert_eq!(refs("$ <i title=\"$\"> ((n#^o))\n"), [true]);
    }

    /// A byte order mark before the opening `---` does not stop the front
    /// matter from being front matter — and prose (D2).
    #[test]
    fn front_matter_behind_a_byte_order_mark_is_still_prose() {
        assert_eq!(
            refs("\u{FEFF}---\nrefs:\n\n    - ((n#^o))\n---\n((n#^o))\n"),
            [true, true]
        );
    }

    /// A `$` inside an autolink opens nothing either — the editor reads the
    /// autolink first — while the URL itself stays prose.
    #[test]
    fn a_delimiter_inside_an_autolink_opens_nothing() {
        assert_eq!(refs("<https://x.com/$> ((n#^o)) $\n"), [true]);
        assert_eq!(
            refs("<https://x.com/((n#^o))> $ ((n#^o)) $\n"),
            [true, false]
        );
        assert_eq!(refs("<a$b@example.test> ((n#^o)) $\n"), [true]);
        // A formula that closes inside a would-be tag has destroyed it: the
        // runs after the closer are live again.
        assert_eq!(refs("$ x <i a=\"$ y $ ((n#^o)) $\">\n"), [false]);
    }

    /// Brackets bind later than a formula: a `$` in link text opens one and
    /// eats the `]`, as a code span would. A formula that opens and closes
    /// inside an image's alt text leaves the image standing.
    #[test]
    fn a_dollar_in_link_text_opens_a_formula_and_one_closed_inside_an_alt_leaves_the_image() {
        assert_eq!(refs("[x $](p) ((n#^o)) $\n"), [false]);
        assert_eq!(refs("![x $y$](p.png) ((n#^o))\n"), [true]);
    }

    /// Escapes are read the editor's way: before an opener only. A closer is
    /// a raw run, escaped or not, as inside a code span.
    #[test]
    fn escapes_apply_to_openers_not_to_closers() {
        assert_eq!(refs("$a\\$$b$ x ((n#^o))\n"), [true]);
        assert_eq!(refs("\\\\$ ((n#^o)) $\n"), [false]);
        assert_eq!(refs("$$ ((n#^o)) \\$$ y $$ ((n#^o))\n"), [false, true]);
        assert_eq!(
            refs("\\$$ ((n#^o)) $ and \\\\$ ((n#^o)) $\n"),
            [false, false]
        );
    }

    /// The front matter is prose for links, but the editor reads no formula
    /// in it.
    #[test]
    fn no_formula_is_read_inside_the_front_matter() {
        assert_eq!(refs("---\nprice: $5 ((n#^o)) $6\n---\n"), [true]);
    }

    /// Unmatched runs of growing length: no opener has a closer, and a
    /// search that rescanned the text for each one would read Θ(k³) bytes
    /// for k runs. The run index makes it one pass over k runs.
    #[test]
    fn unmatched_delimiter_runs_are_paired_in_one_pass_over_the_runs() {
        let k = 1_500;
        let mut md = String::new();
        for len in 1..=k {
            md.push_str(" x ");
            md.push_str(&"$".repeat(len));
        }
        md.push_str(" ((n#^o))\n");
        assert_eq!(delimiter_runs(md.as_bytes()).len(), k);
        let (mut out, mut formulas) = (Vec::new(), Vec::new());
        assert_eq!(
            inline_literals(&md, 0..md.len(), &[], &mut out, &mut formulas).visited,
            k
        );
        assert!(out.is_empty() && formulas.is_empty());
        assert_eq!(refs(&md), [true]);
        // Nothing but blank bytes (the line break) is literal.
        assert!(literal_texts(&md).iter().all(|t| t.trim().is_empty()));
    }

    /// The runs a formula holds are content: the pass visits the opener,
    /// takes the closer from the index and resumes after it. A tag the scan
    /// reaches holds its runs the same way; a tag a formula closed inside
    /// does not.
    #[test]
    fn the_pass_skips_the_runs_a_formula_or_a_live_tag_holds() {
        let (mut out, mut formulas) = (Vec::new(), Vec::new());
        let inner = (2..=9).map(|n| "$".repeat(n)).collect::<Vec<_>>().join(" ");
        let md = format!("$ {inner} $ tail");
        let swept = inline_literals(&md, 0..md.len(), &[], &mut out, &mut formulas);
        assert_eq!((swept.visited, swept.destroyed), (1, None));
        assert!(out.is_empty());
        assert_eq!(formulas, vec![0..md.len() - 5]);

        let md = "<i a=\"$ $$ $\"> $ x $";
        let tag = Atom {
            range: 0..md.find('>').unwrap() + 1,
            start: 0,
            kind: AtomKind::Html,
        };
        formulas.clear();
        let swept = inline_literals(
            md,
            0..md.len(),
            std::slice::from_ref(&tag),
            &mut out,
            &mut formulas,
        );
        assert_eq!((swept.visited, swept.destroyed), (2, None));
        assert_eq!(out, vec![tag.range.clone()]);
        assert_eq!(formulas, vec![md.len() - 5..md.len()]);

        // The formula closes inside the tag: the tag is destroyed, its runs
        // live, it adds nothing — and the sweep reports where it began.
        let md = "$ x <i a=\"$ y $ ((n#^o)) $\">";
        let tag = Atom {
            range: 4..md.len(),
            start: 4,
            kind: AtomKind::Html,
        };
        out.clear();
        formulas.clear();
        let swept = inline_literals(
            md,
            0..md.len(),
            std::slice::from_ref(&tag),
            &mut out,
            &mut formulas,
        );
        assert_eq!((swept.visited, swept.destroyed), (2, Some(4)));
        assert!(out.is_empty());
        assert_eq!(formulas.len(), 2);
    }

    /// pulldown pairs runs by its own rule (`$a$$ b` is a formula to it, and
    /// `$$ x $$$` too); the editor's rule above is the only one consulted.
    #[test]
    fn a_run_the_editor_leaves_unmatched_is_text_whatever_the_parser_would_pair() {
        assert_eq!(refs("$((n#^o))$$ b\n"), [true]);
        assert_eq!(refs("$$ ((n#^o)) $$$\n"), [true]);
    }

    /// The parser's tags, images and code spans are not literal by
    /// themselves: the sweep emits them only when nothing that opened
    /// earlier ran past their start. A formula that closes inside a tag
    /// leaves the rest of the tag text; one that opens in an image's alt and
    /// eats the `]` leaves `![alt` text; a formula that swallows a backtick
    /// leaves the later backtick alone; a code span may swallow a closing tag.
    #[test]
    fn a_construct_that_opened_earlier_destroys_the_tag_image_or_code_span_it_runs_into() {
        assert_eq!(refs("$x<i title=\"$ ((n#^o))\">\n"), [true]);
        assert_eq!(refs("![((n#^o)) $](p.png) tail $\n"), [true]);
        assert_eq!(refs("$ x ` $ ((n#^o)) `\n"), [true]);
        assert_eq!(refs("<b>`</b> ((n#^o)) `\n"), [false]);
    }

    /// A link's or an image's destination, title and label are read with
    /// the link: a delimiter there opens nothing, while the text stays live.
    #[test]
    fn a_delimiter_in_a_link_or_image_resource_opens_nothing() {
        assert_eq!(refs("[x](https://x.test/`) $((n#^o))$ `\n"), [false]);
        assert_eq!(refs("[x](u$) ((n#^o)) $\n"), [true]);
        assert_eq!(refs("[x](u \"$\") ((n#^o)) $\n"), [true]);
        assert_eq!(refs("![a](u$) ((n#^o)) $\n"), [true]);
        assert_eq!(refs("[x][r$] ((n#^o)) $\n\n[r$]: u\n"), [true]);
        assert_eq!(refs("[`x`](u) `((n#^o))`\n"), [false]);
    }

    /// The parser does not know a formula: it may pair the backtick a
    /// formula swallows with a later one and hide the tag, image or link
    /// between them in that code span. The second read, with the formula
    /// filled in, surfaces them — as the editor reads the text after one.
    #[test]
    fn what_a_destroyed_code_span_hid_surfaces_on_the_second_read() {
        assert_eq!(refs("$ x ` y $ <i title=\"((n#^o))\"> `\n"), [false]);
        assert_eq!(refs("$ x ` y $ ![((n#^o))](u) `\n"), [false]);
        assert_eq!(refs("$ x ` y $ [z](u$) ((n#^o)) $ `\n"), [true]);
    }

    /// A body is read once unless a formula runs into a construct the parser
    /// formed; then once more per such read. `fill` keeps length and breaks.
    #[test]
    fn the_body_is_read_once_unless_a_formula_destroys_what_the_parser_formed() {
        assert_eq!(
            Literal::analyse("plain `code` <b>x</b> ((n#^o))\n").reads,
            1
        );
        assert_eq!(Literal::analyse("$a$ `b` <i>$c$</i> ((n#^o))\n").reads, 1);
        assert_eq!(
            Literal::analyse("$ x ` y $ <i title=\"((n#^o))\"> `\n").reads,
            2
        );
        assert_eq!(
            Literal::analyse("$ x ` y $ [z](u$) ((n#^o)) $ `\n").reads,
            2
        );
        // Two destructions in a row take a third read.
        assert_eq!(
            Literal::analyse("$ x ` y $ [z](u$ `) $ w $ <i title=\"((n#^o))\"> `\n").reads,
            3
        );
        let md = "a $b\r\nc$ d 한\n";
        let filled = fill(md, std::slice::from_ref(&(2..8)));
        assert_eq!(filled, "a xx\r\nxx d 한\n");
        assert_eq!(filled.len(), md.len());
    }

    /// A link whose `[` a formula ran over is no link: the dollar in what was
    /// its destination opens a formula. One whose text merely holds a formula
    /// stands.
    #[test]
    fn a_formula_that_runs_over_a_links_opening_bracket_destroys_the_link() {
        assert_eq!(refs("$ [a $ b](u$) ((n#^o)) $\n"), [false]);
        assert_eq!(refs("[a $b$ c](u$) ((n#^o)) $\n"), [true]);
    }

    /// Confirming costs one range per formula, whatever the number of blocks
    /// a read has seen before — a note of many paragraphs that each destroy
    /// a code span is two linear reads, not a quadratic list. The count is
    /// what the reads appended before deduplication: a whole prefix per
    /// block would show as 2,001,000 here.
    #[test]
    fn confirming_costs_one_range_per_formula_not_per_block_seen_before() {
        let md = "$ x ` y $ z `\n\n".repeat(2_000);
        let a = Literal::analyse(&md);
        assert_eq!((a.reads, a.confirmed), (2, 2_000));
    }

    /// Code spans nested by backtick length, each hiding the next: a read
    /// surfaces one level. A short chain resolves; one past the cap ends
    /// with the block literal from the anchor on, so the tag's attribute is
    /// left alone either way.
    #[test]
    fn a_chain_of_hidden_code_spans_resolves_read_by_read_or_ends_safe() {
        fn chain(levels: usize) -> String {
            let mut md = String::new();
            for k in 1..=levels {
                md.push_str(&format!("$ a {} b $ ", "`".repeat(k)));
            }
            md.push_str("<i title=\"((n#^o))\"> ");
            for k in (1..=levels).rev() {
                md.push_str(&"`".repeat(k));
                md.push(' ');
            }
            md.push('\n');
            md
        }
        let short = chain(6);
        assert_eq!(Literal::analyse(&short).reads, 7);
        assert_eq!(refs(&short), [false]);
        let long = chain(12);
        assert_eq!(Literal::analyse(&long).reads, 8);
        assert_eq!(refs(&long), [false]);
    }
}
