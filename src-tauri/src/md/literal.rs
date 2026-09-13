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
// — until its container ends. pulldown's own math stays on for structure;
// the two rules are added on top of what it reports.
//
// One difference from the editor is kept deliberately: a `((…))` inside the
// YAML front matter is prose here and literal there (see above).
use std::ops::Range;

use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};

/// The parser options the editor's reader enables (remark-gfm, remark-math),
/// listed explicitly so an upgrade of either side is a visible diff. YAML
/// metadata stays OFF: pulldown would also accept a `---` block in the middle
/// of a note and a `...` closer, and swallow lines remark reads as prose.
const OPTIONS: Options = Options::ENABLE_TABLES
    .union(Options::ENABLE_STRIKETHROUGH)
    .union(Options::ENABLE_TASKLISTS)
    .union(Options::ENABLE_FOOTNOTES)
    .union(Options::ENABLE_MATH);

/// The literal byte ranges of one string: sorted, merged, non-empty.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Literal {
    ranges: Vec<Range<usize>>,
}

impl Literal {
    /// Read `content` once. The ranges index into `content` itself.
    pub fn of(content: &str) -> Literal {
        let body_start = front_matter_end(content);
        let mut walk = collect(&content[body_start..], body_start);
        if body_start > 0 {
            walk.prose.push(0..body_start);
        }
        let mut inline = walk.inline;
        for block in &walk.prose {
            inline_math(content, block.clone(), &mut inline);
        }
        display_math(content, &walk.line_starts, &mut inline);

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
        Literal {
            ranges: merge(ranges),
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
    if !lines.next().is_some_and(|first| is_fence(first.text)) {
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

/// What one walk over the body found, in offsets of the whole note.
struct Walk {
    /// The block ranges that hold prose.
    prose: Vec<Range<usize>>,
    /// Literal spans inside prose: code spans, inline HTML, math, images.
    inline: Vec<Range<usize>>,
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
        line_starts: Vec::new(),
    };
    let mut stack: Vec<Frame> = Vec::new();
    let mut at_line_start = true;
    for (event, range) in Parser::new_ext(body, OPTIONS).into_offset_iter() {
        let range = range.start + base..range.end + base;
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
                    // An image is literal from `![` to `)`, alt text included
                    // — the editor keeps alt text out of the document model.
                    Tag::Image { .. } => walk.inline.push(range.clone()),
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
                    | Tag::Subscript
                    | Tag::Link { .. } => {}
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
            // Inline literals inside prose.
            Event::Code(_)
            | Event::InlineHtml(_)
            | Event::InlineMath(_)
            | Event::DisplayMath(_) => {
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

/// The editor's inline rule (remark-math, like a code span): a run of `$`
/// opens a formula that the next run of the same length closes, whatever
/// lies between — blanks and line breaks included. Left to right, a code
/// span or a formula that opens first is opaque to the other, and an
/// escaped `$` or backtick opens nothing.
fn inline_math(content: &str, block: Range<usize>, out: &mut Vec<Range<usize>>) {
    let bytes = &content.as_bytes()[block.clone()];
    let run = |from: usize, byte: u8| bytes[from..].iter().take_while(|&&b| b == byte).count();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => {
                i += 1;
                if bytes.get(i).is_some_and(u8::is_ascii_punctuation) {
                    i += 1;
                }
            }
            byte @ (b'`' | b'$') => {
                let open = run(i, byte);
                let mut j = i + open;
                let mut close = None;
                while j < bytes.len() {
                    if bytes[j] == byte {
                        let len = run(j, byte);
                        if len == open {
                            close = Some(j);
                            break;
                        }
                        j += len;
                    } else {
                        j += 1;
                    }
                }
                match close {
                    Some(j) => {
                        if byte == b'$' {
                            out.push(block.start + i..block.start + j + open);
                        }
                        i = j + open;
                    }
                    None => i += open,
                }
            }
            _ => i += 1,
        }
    }
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
}
