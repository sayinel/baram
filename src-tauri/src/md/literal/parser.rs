// The parser adapter of `md::literal` (issue 665): what pulldown-cmark's
// events become — the prose blocks, the atoms the editor reads as one piece
// (tags, autolinks, code spans, link and image resources), and the line
// starts the display rule needs. Nothing here knows the editor's inline
// rules; that is `rules`.

use super::*;

/// An open block while walking the events. A list item's own text (a tight
/// item has no paragraph) is prose except where its child blocks are, so an
/// item remembers how far its text has been accounted for; a container
/// remembers where it ends, which is where an unclosed display formula ends.
pub(super) enum Frame {
    Item {
        cursor: usize,
        end: usize,
    },
    Container {
        end: usize,
    },
    Paragraph,
    /// A table cell: prose, and a place a display formula may open only
    /// when the cell's text begins the line — `$$` under a `|---|` row is
    /// a formula to the editor, `| $$ |` is a cell.
    Cell,
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
pub(super) struct Atom {
    pub(super) range: Range<usize>,
    pub(super) start: usize,
    pub(super) kind: AtomKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum AtomKind {
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
    pub(super) fn contribute(&self, out: &mut Vec<Range<usize>>) {
        match &self.kind {
            AtomKind::Html | AtomKind::Code => out.push(self.range.clone()),
            AtomKind::ImageResource { image } => out.push(image.clone()),
            AtomKind::Autolink | AtomKind::LinkResource => {}
        }
    }
}

/// A link or an image still open while walking its text.
pub(super) enum Open {
    Link,
    Autolink,
    Image,
}

/// The atom a link or an image leaves once it closes: the whole autolink,
/// or the resource after the text.
pub(super) fn resource_atom(range: Range<usize>, text_end: usize, open: Open) -> Option<Atom> {
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
        Open::Image => (text_end < end).then_some(Atom {
            range: text_end..end,
            start,
            kind: AtomKind::ImageResource { image: range },
        }),
    }
}

/// What one walk over the body found, in offsets of the whole note.
pub(super) struct Walk {
    /// The block ranges that hold prose.
    pub(super) prose: Vec<Range<usize>>,
    /// Math spans the parser would report — none while `OPTIONS` leaves
    /// math off; the field stays with the exhaustive match.
    pub(super) inline: Vec<Range<usize>>,
    /// The atoms of the body (see `Atom`), in event order.
    pub(super) atoms: Vec<Atom>,
    /// Where a line's content starts inside a paragraph or a list item's
    /// own text — the positions a display formula may open at — with the
    /// end of the innermost container around it.
    pub(super) line_starts: Vec<(usize, usize)>,
}

/// Walk the body once (`base` is the body's offset in the note).
pub(super) fn collect(body: &str, base: usize) -> Walk {
    let limit = base + body.len();
    let bytes = body.as_bytes();
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
                    // A setext heading's text lines are lines a display
                    // formula may open on (`$$` over `===` is a formula to
                    // the editor); an ATX heading's `#` comes first.
                    Tag::Heading { .. } => Some(if bytes[range.start - base] == b'#' {
                        Frame::Other
                    } else {
                        Frame::Paragraph
                    }),
                    Tag::TableCell => Some(Frame::Cell),
                    Tag::CodeBlock(_)
                    | Tag::HtmlBlock
                    | Tag::List(_)
                    | Tag::DefinitionList
                    | Tag::DefinitionListTitle
                    | Tag::Table(_)
                    | Tag::TableHead
                    | Tag::TableRow
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
                        note_line_start(
                            &stack,
                            &mut at_line_start,
                            range.start,
                            (bytes, base),
                            limit,
                            &mut walk,
                        );
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
                note_line_start(
                    &stack,
                    &mut at_line_start,
                    range.start,
                    (bytes, base),
                    limit,
                    &mut walk,
                );
                walk.atoms.push(Atom {
                    start: range.start,
                    range,
                    kind: AtomKind::Html,
                });
            }
            Event::Code(_) => {
                note_line_start(
                    &stack,
                    &mut at_line_start,
                    range.start,
                    (bytes, base),
                    limit,
                    &mut walk,
                );
                walk.atoms.push(Atom {
                    start: range.start,
                    range,
                    kind: AtomKind::Code,
                });
            }
            // Math events cannot occur while `OPTIONS` leaves math off; the
            // arm stays so the match is exhaustive when the crate is upgraded.
            Event::InlineMath(_) | Event::DisplayMath(_) => {
                note_line_start(
                    &stack,
                    &mut at_line_start,
                    range.start,
                    (bytes, base),
                    limit,
                    &mut walk,
                );
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
                note_line_start(
                    &stack,
                    &mut at_line_start,
                    range.start,
                    (bytes, base),
                    limit,
                    &mut walk,
                );
            }
            // Lines of an HTML block: not prose, and never where a display
            // formula opens.
            Event::Html(_) => at_line_start = false,
        }
    }
    walk
}

/// The first inline event of a line, inside a paragraph, a setext heading,
/// a list item's own text or a table cell that begins its line, marks where
/// that line's content starts. `source` is the body the parser read and its
/// offset in the note, for looking at the bytes before a cell.
pub(super) fn note_line_start(
    stack: &[Frame],
    at_line_start: &mut bool,
    start: usize,
    source: (&[u8], usize),
    limit: usize,
    walk: &mut Walk,
) {
    if !*at_line_start {
        return;
    }
    *at_line_start = false;
    let prose_line = match stack.last() {
        Some(Frame::Paragraph | Frame::Item { .. }) => true,
        Some(Frame::Cell) => begins_line(source.0, start - source.1),
        Some(Frame::Container { .. } | Frame::Other) | None => false,
    };
    if !prose_line {
        return;
    }
    let container_end = stack
        .iter()
        .rev()
        .find_map(|frame| match frame {
            Frame::Item { end, .. } | Frame::Container { end } => Some(*end),
            Frame::Paragraph | Frame::Cell | Frame::Other => None,
        })
        .unwrap_or(limit);
    walk.line_starts.push((start, container_end));
}

/// Does the text at `at` begin its line, allowing only blanks and
/// blockquote markers before it? A cell after a `|` does not.
pub(super) fn begins_line(bytes: &[u8], at: usize) -> bool {
    let before = bytes[..at]
        .iter()
        .rev()
        .find(|&&b| !matches!(b, b' ' | b'\t' | b'>'));
    matches!(before, None | Some(b'\n' | b'\r'))
}

/// A child block that starts directly under a list item ends the item's
/// own text before it: that text is prose, the child accounts for itself.
pub(super) fn leave_item_text_before(
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
