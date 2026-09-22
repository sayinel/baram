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
// Front matter is the one thing NOT handed to the parser — that, and one
// leading byte order mark, which the editor's parser drops. Property links
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
// — until its container ends; what follows a formula begins a block of its
// own, an indented code block when four columns in. pulldown's own math is
// OFF: it pairs runs
// differently (`$a$$ b` is a formula to it and text to the editor), and a
// formula it reads hides the tags and code spans inside from the rules
// here. It reports plain CommonMark inline structure; the two rules above
// are the only ones that read a `$`.
//
// Words: a *container* is a blockquote, a list item or a footnote
// definition; the display rule calls the containers around a `$$` its
// *holders* (`Holder`), read off the parser's frames, where `Frame::Container`
// is the narrower frame of the two that are not items.
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
mod autolink;
mod display;
mod inline;
mod lines;
mod parser;
mod prefix;

use autolink::*;
use display::*;
use inline::*;
pub(crate) use lines::front_matter_end;
use lines::line_at;
pub use lines::source_lines;
use parser::*;
use prefix::*;

use std::collections::{HashMap, HashSet};
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

/// `Literal::analyse`: the literal set with what happened on the way — how
/// many times the parser read the body, how many formula ranges the reads
/// appended to the confirmed list in all (counted before the list is
/// deduplicated, so that appending a whole prefix per block, the quadratic
/// fault this guards against, shows as the sum it is), and whether a read
/// gave up on a block: hit the cap or confirmed nothing new while the block
/// still held a destroyed construct, and left the block literal from the
/// anchor on. The indexer logs that, with the note's path.
pub struct Analysis {
    pub literal: Literal,
    pub reads: usize,
    // Read by the tests only; the indexer logs `reads` and `gave_up`.
    #[cfg_attr(not(test), allow(dead_code))]
    pub confirmed: usize,
    pub gave_up: bool,
}

impl Literal {
    /// Read `content`. The ranges index into `content` itself.
    pub fn of(content: &str) -> Literal {
        Literal::analyse(content).literal
    }

    /// `of`, with what the tests pin: how many times the body was handed
    /// to the parser — once for nearly every note, once more for every read
    /// in which a formula or a code span ran into a construct the parser
    /// had formed — and how many formulas were confirmed and filled in along
    /// the way. The reads end when a read destroys nothing, when the
    /// confirmed list stops growing (the sweep runs on the original text, so
    /// a read may only re-find what is already filled in), or at the cap;
    /// in the last two cases a block that still holds a destroyed construct
    /// is left literal from the anchor on — the parser's view of it past
    /// that point is known to be wrong, and touching nothing there is safe.
    pub fn analyse(content: &str) -> Analysis {
        const READS: usize = 8;
        // issue 663: the parser is handed a copy in which a bare `\r` is a
        // `\n` — same length, every offset kept. pulldown reads a bare `\r`
        // as a line break inside a paragraph but not where a fence opens
        // (0.13.4 reads "```\r…" as text and opens the block one line late),
        // while the editor's parser reads it as any line break; a CR-only
        // note would otherwise have a fence's inside and outside change
        // places. Nothing below cares which byte the break is.
        let normalized = bare_cr_as_newline(content);
        let content: &str = normalized.as_deref().unwrap_or(content);
        // The editor's parser drops one leading byte order mark before it
        // reads; pulldown does not, and would read the first line's fence
        // or tag as text. Cut it with the front matter — it is prose, as
        // the front matter is. A second mark is text to both.
        let mut body_start = front_matter_end(content);
        if body_start == 0 && content.starts_with('\u{FEFF}') {
            body_start = '\u{FEFF}'.len_utf8();
        }
        let mut source = String::new();
        let mut confirmed: Vec<Range<usize>> = Vec::new();
        let mut appended = 0;
        let mut reads = 0;
        let mut gave_up = false;
        let (mut walk, inline) = loop {
            reads += 1;
            let body = if reads == 1 {
                &content[body_start..]
            } else {
                &source[body_start..]
            };
            let mut walk = collect(body, body_start);
            // The parser knows no bare URL; the editor (remark-gfm) reads
            // one as a link, `$` and backticks inside it included — except
            // inside a link's text, where it reads none.
            let full: &str = if reads == 1 { content } else { &source };
            let labels: Vec<Range<usize>> = walk
                .atoms
                .iter()
                .filter(|a| {
                    matches!(
                        a.kind,
                        AtomKind::LinkResource | AtomKind::ImageResource { .. }
                    )
                })
                .map(|a| a.start..a.range.start)
                .collect();
            for block in &walk.prose {
                for range in autolink_literals(&full[block.clone()], block.start) {
                    if !labels
                        .iter()
                        .any(|l| l.start <= range.start && range.start < l.end)
                    {
                        walk.atoms.push(Atom {
                            start: range.start,
                            range,
                            kind: AtomKind::Autolink,
                        });
                    }
                }
            }
            walk.atoms.sort_by_key(|atom| atom.range.start);
            debug_assert!(
                walk.inline.is_empty(),
                "math is off in OPTIONS; the parser reports no formula"
            );
            let mut inline: Vec<Range<usize>> = Vec::new();
            // Flow before text, as the editor reads: a display formula is
            // settled from the line starts before the sweep looks at any
            // run, and its bytes are not the sweep's to pair.
            let mut display = Vec::new();
            display_math(content, &walk.line_starts, &walk.chains, &mut display);
            let display = Literal {
                ranges: merge(display),
            };
            let mut formulas = Vec::new();
            // The blocks a construct was destroyed in, with the anchor: the
            // block's formulas that start before it are confirmed.
            let mut unsettled: Vec<(Range<usize>, usize)> = Vec::new();
            let known = confirmed.len();
            for block in &walk.prose {
                let first = formulas.len();
                let swept = inline_literals(
                    content,
                    block.clone(),
                    &walk.atoms,
                    &display,
                    &mut inline,
                    &mut formulas,
                );
                if let Some(at) = swept.destroyed {
                    let fresh = formulas[first..].iter().filter(|f| f.start < at).cloned();
                    let before = confirmed.len();
                    confirmed.extend(fresh);
                    appended += confirmed.len() - before;
                    unsettled.push((block.clone(), at));
                }
            }
            // One opener may have been paired with different closers on
            // different reads: keep the union, not the duplicates.
            confirmed = merge(confirmed);
            inline.extend(formulas);
            inline.extend(display.ranges);
            if unsettled.is_empty() {
                break (walk, inline);
            }
            if reads == READS || confirmed.len() == known {
                gave_up = true;
                inline.extend(unsettled.into_iter().map(|(block, at)| at..block.end));
                break (walk, inline);
            }
            source = fill(content, &confirmed);
        };
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
            gave_up,
        }
    }

    /// Does `range` share at least one byte with a literal range?
    pub fn overlaps(&self, range: Range<usize>) -> bool {
        overlaps(&self.ranges, range)
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

/// A copy of `content` with every bare `\r` (one not followed by `\n`) turned
/// into `\n`, or None when there is none — see `analyse`. Same length: only
/// ASCII bytes change, so the copy is valid UTF-8 and offsets carry over.
fn bare_cr_as_newline(content: &str) -> Option<String> {
    let bytes = content.as_bytes();
    let bare = |i: usize| bytes[i] == b'\r' && bytes.get(i + 1) != Some(&b'\n');
    if !(0..bytes.len()).any(bare) {
        return None;
    }
    let out: Vec<u8> = (0..bytes.len())
        .map(|i| if bare(i) { b'\n' } else { bytes[i] })
        .collect();
    String::from_utf8(out).ok()
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

/// Does `range` share at least one byte with one of `ranges` — sorted, none
/// overlapping the next, as `merge` leaves them and the display rule emits
/// them?
fn overlaps(ranges: &[Range<usize>], range: Range<usize>) -> bool {
    if range.start >= range.end {
        return false;
    }
    // The first range that ends after `range` starts.
    let i = ranges.partition_point(|r| r.end <= range.start);
    ranges.get(i).is_some_and(|r| r.start < range.end)
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

    /// issue 669 — the parity corpus recorder. Every document in the `refs`
    /// assertion corpus reaches `Literal` through that helper, so this one
    /// place sees all of it — including the documents two call sites build at
    /// run time, which no scan of this source could find. Tests that call
    /// `Literal::of` or `Literal::analyse` directly are outside it; they
    /// measure the analysis, not the classification this corpus compares.
    ///
    /// Off unless the `parity-dump` feature is on, so an ordinary
    /// `cargo test` compiles none of it. Turning the feature on is still not
    /// enough: the run also has to name a file in `BARAM_PARITY_DUMP`.
    /// `scripts/literal-parity.sh` is the one command that does both, and it
    /// passes `--test-threads=1` — the records are appended as they happen,
    /// so one writer is what keeps them ordered and whole.
    ///
    /// ‼️ Fails closed. The test name comes from the thread libtest names
    /// after the test, which is not a promised interface; if it is missing or
    /// is `main`, the run stops rather than filing records under a name that
    /// would merge unrelated cases.
    #[cfg(feature = "parity-dump")]
    mod parity_dump {
        use super::{LazyLock, Regex};
        use sha2::{Digest, Sha256};
        use std::collections::HashMap;
        use std::io::Write;
        use std::sync::Mutex;

        /// How many documents each test has recorded so far. The ordinal is
        /// the case's identity within its test, so several `refs` calls in
        /// one test stay apart and stay stable across runs.
        static ORDINALS: LazyLock<Mutex<HashMap<String, usize>>> =
            LazyLock::new(|| Mutex::new(HashMap::new()));

        /// The marker as production's `BLOCK_REF_RE` spells it: a display
        /// needs at least one character and cannot hold a line break. The
        /// `refs` helper above is wider on both counts, so this is where the
        /// two can part — and the assertion below makes that loud instead of
        /// letting the parity corpus quietly describe a different grammar.
        static PRODUCTION_MARKER: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"\(\(n#\^o(?:\|[^)\n\r]+)?\)\)").unwrap());

        pub(super) fn record(md: &str, literal_alone: &[bool]) {
            let Some(path) = std::env::var_os("BARAM_PARITY_DUMP") else {
                return;
            };
            let markers = PRODUCTION_MARKER.find_iter(md).count();
            assert_eq!(
                markers,
                literal_alone.len(),
                "parity-dump: `refs` saw {} marker(s) and production's grammar sees {} in {md:?} \
                 — the corpus has grown a shape the parity fixture cannot describe",
                literal_alone.len(),
                markers
            );
            let test = std::thread::current()
                .name()
                .expect(
                    "parity-dump: libtest did not name this thread; the recorder \
                     cannot identify the case (run it through scripts/literal-parity.sh)",
                )
                .to_owned();
            assert_ne!(
                test, "main",
                "parity-dump: the case ran on the main thread, so every record \
                 would be filed under one name"
            );
            let ordinal = {
                let mut seen = ORDINALS.lock().unwrap();
                let next = seen.entry(test.clone()).or_insert(0);
                let ordinal = *next;
                *next += 1;
                ordinal
            };
            let line = serde_json::json!({
                "test": test,
                "ordinal": ordinal,
                "sha256": format!("{:x}", Sha256::digest(md.as_bytes())),
                "bytes": md.len(),
                "markdown": md,
                "markers": markers,
                // What `Literal` alone said, which is what the assertion in
                // this file compares against. The generator derives the index
                // expectation from it and compares that with the oracle, so
                // the historical measurement keeps its own meaning.
                "literalAlone": literal_alone,
            });
            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .expect("parity-dump: could not open BARAM_PARITY_DUMP for appending");
            writeln!(file, "{line}").expect("parity-dump: could not append a record");
        }
    }

    /// Every `((n#^o…))` reference in `md`, in order: is it editable (prose)?
    fn refs(md: &str) -> Vec<bool> {
        static REF: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"\(\(n#\^o(?:\|[^)]*)?\)\)").unwrap());
        let literal = Literal::of(md);
        let editable: Vec<bool> = REF
            .find_iter(md)
            .map(|m| !literal.overlaps(m.range()))
            .collect();
        #[cfg(feature = "parity-dump")]
        parity_dump::record(md, &editable);
        editable
    }

    /// issue 669 — the parity corpus. The emulation in this module is not an
    /// implementation of a spec: it re-implements what the editor's remark
    /// stack reads, measured rule by rule (issue 620). What kept the two
    /// sides together was 58 curated rename fixtures; the corpus this module
    /// exercises was never re-derived, so a grammar change or a wrong rule
    /// outside those 58 documents failed nothing.
    ///
    /// The expectations here were measured by parsing each document with the
    /// editor's own reader (`scripts/build-literal-parity.ts`), never by
    /// copying what this side already believed. Generating them also compared
    /// them with what `Literal` answers today, and the dump that produced
    /// them only completes if the `refs` assertions above accept that answer
    /// — so the two agreed at the moment the fixture was written. The vitest reader asserts the
    /// same numbers against the frontend's classifier, so a remark change
    /// turns that side red on the exact document; this test turns red when
    /// the emulation drifts from what was measured.
    ///
    /// What fails this (measured, each mutation applied alone): dropping the
    /// `overlaps` half of the predicate reddens the first fenced case;
    /// dropping the `m.start() >= body_start` half reddens a front matter
    /// case — front matter is the one category where the two sides classify
    /// the same bytes differently on purpose. ‼️ Removing `walk.prose.push(0..
    /// body_start)` from `Literal` does NOT redden this — the front-matter
    /// half of the predicate covers those markers either way. That line is
    /// pinned by the `refs()` assertions above, which ask `Literal` alone.
    #[test]
    fn the_literal_parity_corpus_holds() {
        #[derive(serde::Deserialize)]
        struct Fixture {
            cases: Vec<Case>,
        }
        #[derive(serde::Deserialize)]
        struct Case {
            test: String,
            ordinal: usize,
            markdown: String,
            editable: Vec<bool>,
            why: Vec<String>,
        }
        static MARKER: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"\(\(n#\^o(?:\|[^)\n\r]+)?\)\)").unwrap());

        let fixture: Fixture =
            serde_json::from_str(include_str!("../fixtures/literal-parity.json")).unwrap();
        // A fixture that lost its cases would be a green run of zero
        // assertions — the same trap the corpus recorder guards against.
        assert!(fixture.cases.len() > 200, "{}", fixture.cases.len());
        for case in &fixture.cases {
            let literal = Literal::of(&case.markdown);
            let body_start = front_matter_end(&case.markdown);
            let editable: Vec<bool> = MARKER
                .find_iter(&case.markdown)
                .map(|m| !literal.overlaps(m.range()) && m.start() >= body_start)
                .collect();
            assert_eq!(
                editable, case.editable,
                "{}#{} {:?}\n  the editor's parser read these as {:?}",
                case.test, case.ordinal, case.markdown, case.why
            );
        }
    }

    /// issue 663 — a note broken with bare carriage returns (classic Mac OS)
    /// has the same blocks to pulldown and to remark; the line offsets must
    /// agree with them, or a fence's inside and outside change places.
    #[test]
    fn a_bare_carriage_return_ends_a_line_for_the_offsets_too() {
        assert_eq!(refs("```\r((n#^o))\r```\r((n#^o))\r"), [false, true]);
        assert_eq!(refs("text\r```\r((n#^o))\r```\r"), [false]);
        assert_eq!(refs("a `((n#^o))` b\r((n#^o))\r"), [false, true]);
        // Mixed endings, and a formula whose closing line ends with a bare CR.
        assert_eq!(refs("$$\r((n#^o))\r$$\r\n((n#^o))\n"), [false, true]);
    }

    /// issue 664 — an unclosed display formula ends where its containers end
    /// to the editor: remark's math flow has no lazy continuation, so the
    /// formula runs only through the lines that still carry every container
    /// the opener's line was in. pulldown reads the `>`-less line after
    /// `> $$` as a lazy paragraph continuation inside the blockquote; the
    /// editor reads it as a new paragraph — prose. Every shape below was
    /// measured against the editor's remark stack.
    #[test]
    fn an_unclosed_display_formula_ends_where_the_editors_container_ends() {
        // A blockquote ends at the first line without `>`.
        assert_eq!(refs("> $$\n((n#^o))\n\n((n#^o))\n"), [true, true]);
        assert_eq!(refs("> $$\n> ((n#^o))\n((n#^o))\n"), [false, true]);
        assert_eq!(refs("> > $$\n> > ((n#^o))\n> ((n#^o))\n"), [false, true]);
        assert_eq!(refs("   > $$\n   > ((n#^o))\n((n#^o))\n"), [false, true]);
        assert_eq!(refs(">\t$$\n> ((n#^o))\n((n#^o))\n"), [false, true]);
        // A blank line ends a blockquote, and keeps a list item.
        assert_eq!(refs("> $$\n\n> ((n#^o))\n"), [true]);
        assert_eq!(refs("- $$\n\n  ((n#^o))\n"), [false]);
        // A list item runs through the lines indented to its content column.
        assert_eq!(refs("- $$\n  ((n#^o))\n((n#^o))\n"), [false, true]);
        assert_eq!(refs("- $$\n ((n#^o))\n"), [true]);
        assert_eq!(refs("-   $$\n    ((n#^o))\n  ((n#^o))\n"), [false, true]);
        assert_eq!(refs("1. $$\n   ((n#^o))\n((n#^o))\n"), [false, true]);
        // Nested containers compose, in order.
        assert_eq!(refs("> - $$\n>   ((n#^o))\n> ((n#^o))\n"), [false, true]);
        assert_eq!(refs("- > $$\n  > ((n#^o))\n  ((n#^o))\n"), [false, true]);
        // A `$$` on the lazy line opens a new formula at the top level.
        assert_eq!(refs("> $$\n$$\n((n#^o))\n"), [false]);
        // A closing line still closes, and a bare CR is a line break here too.
        assert_eq!(refs("> $$\n> ((n#^o))\n> $$\n((n#^o))\n"), [false, true]);
        assert_eq!(refs("> $$\r> ((n#^o))\r((n#^o))\r"), [false, true]);
        // A footnote definition continues through lines indented four columns
        // past where it began, or blank — whatever the label's width, and
        // inside a blockquote past the quote's prefix.
        assert_eq!(refs("[^1]: $$\n    ((n#^o))\n((n#^o))\n"), [false, true]);
        assert_eq!(
            refs("[^1]: $$\n    ((n#^o))\n\n    ((n#^o))\n((n#^o))\n"),
            [false, false, true]
        );
        assert_eq!(refs("[^1]: $$\n   ((n#^o))\n"), [true]);
        assert_eq!(
            refs("[^note]: $$\n    ((n#^o))\n  ((n#^o))\n"),
            [false, true]
        );
        assert_eq!(
            refs("> [^1]: $$\n>     ((n#^o))\n> ((n#^o))\n((n#^o))\n"),
            [false, true, true]
        );
    }

    /// PR 674 review — the containers of a display formula come from the
    /// parser's frames and are measured on their own marker lines, in widths
    /// relative to the containers before them. Every row measured against
    /// the editor (remark through `renameBlockIdInMarkdown`), 2026-09-17:
    /// reading the opener line's own prefix lost the item when the `$$`
    /// stood below the marker line (the formula ran to the end of the note),
    /// and absolute columns disagreed with micromark as soon as two lines
    /// carried different blanks before a `>`.
    #[test]
    fn a_display_formulas_containers_come_from_the_frames_in_relative_widths() {
        // the `$$` stands on the item's second line: the item ends the formula
        assert_eq!(refs("- a\n  $$\n  ((n#^o))\n\n((n#^o))\n"), [false, true]);
        // the same after a blank line inside the item
        assert_eq!(refs("- a\n\n  $$\n  ((n#^o))\n\n((n#^o))\n"), [false, true]);
        // the closer's three columns count from the item's content, not from column 0
        assert_eq!(refs("- a\n  $$\n    $$\n  ((n#^o))\n"), [true]);
        // an item's width is relative to where the blockquote's prefix ended on each line
        assert_eq!(refs("   > - $$\n>   ((n#^o))\n"), [false]);
        // a footnote definition asks for four columns whatever its own indent
        assert_eq!(
            refs("  [^1]: $$\n    ((n#^o))\n\n((n#^o))\n"),
            [false, true]
        );
        // a footnote definition: more than four columns is still inside
        assert_eq!(
            refs("  [^1]: $$\n      ((n#^o))\n\n((n#^o))\n"),
            [false, true]
        );
        // a nested item is measured past its parent's content
        assert_eq!(
            refs("- a\n  - b\n    $$\n    ((n#^o))\n  ((n#^o))\n"),
            [false, true]
        );
        // an item inside a blockquote, opener below the marker line
        assert_eq!(
            refs("> - a\n>   $$\n>   ((n#^o))\n> ((n#^o))\n"),
            [false, true]
        );
        // an ordered marker's width
        assert_eq!(
            refs("10. a\n    $$\n    ((n#^o))\n   ((n#^o))\n"),
            [false, true]
        );
        // the blanks before a marker are part of the item's width
        assert_eq!(
            refs("  - a\n    $$\n    ((n#^o))\n   ((n#^o))\n"),
            [false, true]
        );
        // a footnote definition, opener below the marker line
        assert_eq!(
            refs("[^1]: a\n    $$\n    ((n#^o))\n\n((n#^o))\n"),
            [false, true]
        );
        // a tab after the marker is the columns to the next tab stop
        assert_eq!(refs("-\ta\n\t$$\n\t((n#^o))\n((n#^o))\n"), [false, true]);
        // the continuation line may carry more blanks before `>` than the opener's
        assert_eq!(refs("> - $$\n   >   ((n#^o))\n"), [false]);
        // a closer three columns past the nested content closes
        assert_eq!(refs("> - a\n>   $$\n>      $$\n> ((n#^o))\n"), [true]);
        // a closer four columns past it is the formula's own line
        assert_eq!(refs("> - a\n>   $$\n>       $$\n>   ((n#^o))\n"), [false]);
        // a marker with nothing after it takes one column
        assert_eq!(refs("-\n  $$\n  ((n#^o))\n\n((n#^o))\n"), [false, true]);
        // five or more blanks after a marker are one column and indented code
        assert_eq!(
            refs("-      a\n  $$\n  ((n#^o))\n\n((n#^o))\n"),
            [false, true]
        );
        // a blockquote whose opener is below its first line
        assert_eq!(refs("> a\n> $$\n> ((n#^o))\n((n#^o))\n"), [false, true]);
        // a blockquote inside an item, opener below both first lines
        assert_eq!(
            refs("- > a\n  > $$\n  > ((n#^o))\n  ((n#^o))\n"),
            [false, true]
        );
        // an ordered item opened on the blockquote's line
        assert_eq!(
            refs("> 1. $$\n>    ((n#^o))\n>   ((n#^o))\n"),
            [false, true]
        );
        // a footnote definition inside a blockquote asks for four columns past the `>`
        assert_eq!(
            refs("> [^1]: $$\n>     ((n#^o))\n> ((n#^o))\n"),
            [false, true]
        );
        // an ordered item's three columns
        assert_eq!(
            refs("1. a\n   $$\n   ((n#^o))\n  ((n#^o))\n"),
            [false, true]
        );
        // CRLF line ends
        assert_eq!(
            refs("- a\r\n  $$\r\n  ((n#^o))\r\n\r\n((n#^o))\r\n"),
            [false, true]
        );
        // tabs after the marker and after the `>`
        assert_eq!(
            refs("> -\ta\n>\t$$\n>\t((n#^o))\n> ((n#^o))\n"),
            [false, true]
        );
        // a second paragraph of the item
        assert_eq!(
            refs("- a\n\n  b\n  $$\n  ((n#^o))\n\n((n#^o))\n"),
            [false, true]
        );
        // a closed formula below the marker line, and prose after it in the same item
        assert_eq!(
            refs("* a\n  $$\n  ((n#^o))\n  $$\n  ((n#^o))\n"),
            [false, true]
        );
        // a blank line ends the blockquote inside the item, not the item
        assert_eq!(
            refs("- a\n  > $$\n  > ((n#^o))\n\n  ((n#^o))\n"),
            [false, true]
        );
        // front matter before the list: the frames' offsets are the note's
        assert_eq!(
            refs("---\ntitle: x\n---\n- a\n  $$\n  ((n#^o))\n\n((n#^o))\n"),
            [false, true]
        );
        // a bullet item nested in an ordered one
        assert_eq!(
            refs("1) a\n   - b\n     $$\n     ((n#^o))\n   ((n#^o))\n"),
            [false, true]
        );
        // pulldown starts a nested item behind a tab on the line break BEFORE its marker's line
        assert_eq!(
            refs("- a\n\t- b\n\t  $$\n\t  ((n#^o))\n  ((n#^o))\n"),
            [false, true]
        );
        // a footnote definition under another one: pulldown and the editor agree there is one container
        assert_eq!(
            refs("[^a]: a\n    [^b]: $$\n        ((n#^o))\n    ((n#^o))\n((n#^o))\n"),
            [false, false, true]
        );
        // an empty item ends with the blank line after it, for pulldown as for the editor
        assert_eq!(refs("-\n\n  $$\n  ((n#^o))\n((n#^o))\n"), [false, false]);
        // a tab before a nested `>` is the columns it spans
        assert_eq!(refs("> > $$\n> \t> ((n#^o))\n> ((n#^o))\n"), [false, true]);
        // a footnote definition inside an item
        assert_eq!(
            refs("- [^1]: $$\n      ((n#^o))\n  ((n#^o))\n"),
            [false, true]
        );
        // an item inside a footnote definition
        assert_eq!(
            refs("[^1]: - $$\n      ((n#^o))\n    ((n#^o))\n"),
            [false, true]
        );
        // bare CR line ends
        assert_eq!(refs("- a\r  $$\r  ((n#^o))\r((n#^o))\r"), [false, true]);
        // CRLF, after a front matter
        assert_eq!(
            refs("---\r\nx: y\r\n---\r\n- a\r\n  $$\r\n  ((n#^o))\r\n((n#^o))\r\n"),
            [false, true]
        );
        // an empty first line, then the item's text
        assert_eq!(
            refs("-\n  a\n\n  $$\n  ((n#^o))\n((n#^o))\n"),
            [false, true]
        );
        // a footnote definition in an ordered item, opener below both markers
        assert_eq!(
            refs("1. a\n\n   [^x]: b\n       $$\n       ((n#^o))\n   ((n#^o))\n"),
            [false, true]
        );
        // two nested items behind tabs
        assert_eq!(
            refs("- a\n\t- b\n\t\t- c\n\t\t  $$\n\t\t  ((n#^o))\n\t  ((n#^o))\n"),
            [false, true]
        );
        // a tab right after the outer `>`: one column is its optional blank, the rest lead to the inner `>`
        assert_eq!(refs("> > $$\n>\t> ((n#^o))\n> ((n#^o))\n"), [false, true]);
        // a tab right after the outer `>`, on the opener's own line
        assert_eq!(refs("> \t> $$\n> > ((n#^o))\n> ((n#^o))\n"), [false, true]);
        // a tab meets an ordered item's three columns
        assert_eq!(refs("1. a\n\t$$\n\t((n#^o))\n  ((n#^o))\n"), [false, true]);
        // two blank lines inside an item
        assert_eq!(refs("- a\n\n\n  $$\n  ((n#^o))\n((n#^o))\n"), [false, true]);
        // a tab after `>` on the opener's line and the next
        assert_eq!(refs("> \t$$\n> \t((n#^o))\n((n#^o))\n"), [false, true]);
        // three blanks after the marker are the item's
        assert_eq!(
            refs("-   a\n    $$\n    ((n#^o))\n   ((n#^o))\n"),
            [false, true]
        );
        // two footnote markers on one line: pulldown closes the first definition, the marker is read where it says
        assert_eq!(refs("[^1]: [^1]: $$\n((n#^o))\n"), [true]);
    }

    /// PR 674 review — pulldown keeps a `$$` that lost its `>` or its item's
    /// indent inside the container as a lazy paragraph continuation; remark's
    /// math flow interrupts the paragraph and the container is over, so the
    /// formula has only the containers the opener's own line carries. And
    /// four columns of blanks past them make the line paragraph text, not a
    /// formula at all. Measured against the editor, 2026-09-17.
    #[test]
    fn an_opener_the_editor_reads_as_lazy_or_as_text_opens_less_or_nothing() {
        // a line that lost the item's indent ends the formula (pulldown reads it as lazy)
        assert_eq!(refs("- a\n  $$\n  ((n#^o))\n((n#^o))\n"), [false, true]);
        // a `$$` that lost its `>` is lazy to pulldown; remark's math flow ends the quote
        assert_eq!(refs("> a\n$$\n((n#^o))\n\n((n#^o))\n"), [false, false]);
        // a `$$` that lost the item's indent is lazy to pulldown too; the item is over
        assert_eq!(refs("- a\n$$\n((n#^o))\n\n((n#^o))\n"), [false, false]);
        // a lazy paragraph line before the opener changes nothing
        assert_eq!(
            refs("- a\nb\n  $$\n  ((n#^o))\n\n((n#^o))\n"),
            [false, true]
        );
        // four columns past the item's content is indented code, not a formula
        assert_eq!(refs("- a\n\n      $$\n  ((n#^o))\n"), [true]);
        // an opener that kept its `>` but lost the item's indent: the item is over, the quote is not
        assert_eq!(refs("> - a\n> $$\n> ((n#^o))\n((n#^o))\n"), [false, true]);
        // an opener indented three columns past the item's content is still an opener
        assert_eq!(
            refs("- a\n     $$\n  ((n#^o))\n\n((n#^o))\n"),
            [false, true]
        );
        // the opener left the nested item: only the outer item holds the formula
        assert_eq!(
            refs("- a\n  - b\n  $$\n  ((n#^o))\n((n#^o))\n"),
            [false, true]
        );
        // a lazy `$$` four columns in, once its item is gone, is the paragraph's text: no formula
        assert_eq!(
            refs("123456789. a\n    $$\n    ((n#^o))\n((n#^o))\n"),
            [true, true]
        );
        // four spaces before the `$$` are two past the item's content: an opener
        assert_eq!(refs("- a\n    $$\n  ((n#^o))\n"), [false]);
        // a lazy `$$` four columns in, once its blockquote is gone: text
        assert_eq!(refs("> a\n    $$\n((n#^o))\n"), [true]);
        // four columns past the item's content, inside a paragraph: text, not an opener
        assert_eq!(refs("- a\n      $$\n  ((n#^o))\n"), [true]);
        // four columns at the top level, inside a paragraph: text
        assert_eq!(refs("a\n    $$\n((n#^o))\n"), [true]);
        // three columns past the item's content: an opener
        assert_eq!(
            refs("- a\n     $$\n  ((n#^o))\n\n((n#^o))\n"),
            [false, true]
        );
        // four columns past the `>`: text
        assert_eq!(refs("> a\n>     $$\n> ((n#^o))\n"), [true]);
        // one column short of the item inside the blockquote: the item is over, the quote holds
        assert_eq!(refs("> - a\n>  $$\n> ((n#^o))\n((n#^o))\n"), [false, true]);
    }

    /// PR 674 review — after a formula the editor has no paragraph open,
    /// where pulldown still reads the paragraph it took the `$$` for: a line
    /// four columns past the containers it carries is an indented code block,
    /// and an item the first line after the formula does not carry is over
    /// for every later `$$`, indented as it asked or not — while one pulldown
    /// opened since is the editor's too. Measured against the editor,
    /// 2026-09-18.
    #[test]
    fn what_follows_a_formula_is_a_block_of_its_own_to_the_editor() {
        // after a formula its blockquote ended, four columns are an indented code block — prose to pulldown, which reads the line as lazy
        assert_eq!(refs("> $$\n    ((n#^o))\n"), [false]);
        // the same after a closed formula
        assert_eq!(refs("$$\n$$\n    ((n#^o))\n"), [false]);
        // the code block ends with the first line that is not indented
        assert_eq!(refs("a\n> $$\n    ((n#^o))\n\n((n#^o))\n"), [false, true]);
        // four columns past the item's content, after a formula closed inside the item
        assert_eq!(
            refs("- a\n  $$\n  $$\n      ((n#^o))\n  ((n#^o))\n"),
            [false, true]
        );
        // a blank line between the formula and the code block
        assert_eq!(refs("> $$\n\n    ((n#^o))\n   ((n#^o))\n"), [false, true]);
        // a tab is four columns: an indented code block after the formula
        assert_eq!(refs("> $$\n\t((n#^o))\n((n#^o))\n"), [false, true]);
        // an item the editor closed after a formula is over for a later `$$`, indented as the item asked or not
        assert_eq!(refs("- $$\n((n#^o))\n  $$\n((n#^o))\n"), [true, false]);
        // a blockquote is not over: a line that carries `>` is in one either way
        assert_eq!(refs("> $$\na\n> $$\n> ((n#^o))\n((n#^o))\n"), [false, true]);
        // the nested item is over as well
        assert_eq!(
            refs("- - $$\n((n#^o))\n  $$\n  ((n#^o))\n((n#^o))\n"),
            [true, false, false]
        );
        // an item pulldown opened after one the editor closed is the editor's too, only not inside it
        assert_eq!(
            refs("- $$\nx\n  - $$\n    ((n#^o))\n((n#^o))\n"),
            [false, true]
        );
        // a blockquote inside an item that is over still asks for its `>`
        assert_eq!(
            refs("* > > ((n#^o))\n    $$\n$$\n ((n#^o))\n"),
            [true, false]
        );
        // a nested item pulldown starts on the closer's line break, behind a tab, is not made of the formula
        assert_eq!(
            refs("- $$\n  $$\n\t- $$\n\t  ((n#^o))\n  ((n#^o))\n"),
            [false, true]
        );
        // a child pulldown opens four columns in, once its parent is over, is text to the editor: no marker, no formula
        assert_eq!(
            refs("-   $$\nx\n    - $$\n        ((n#^o))\n((n#^o))\n"),
            [true, true]
        );
        // closed formulas in a row: each is read once, the item's start behind them all
        assert_eq!(
            refs("- $$\n  $$\n  $$\n  $$\n  $$\n  $$\n  ((n#^o))\n"),
            [true]
        );
        // three columns in, the child is a real item
        assert_eq!(
            refs("- $$\nx\n   - $$\n     ((n#^o))\n((n#^o))\n"),
            [false, true]
        );
        // six columns past an item's text are its paragraph, marker and all
        assert_eq!(
            refs("- a\n      - $$\n        ((n#^o))\n((n#^o))\n"),
            [true, true]
        );
        // the same inside a blockquote
        assert_eq!(
            refs("> - $$\n> x\n>   - $$\n>     ((n#^o))\n> ((n#^o))\n"),
            [false, true]
        );
    }

    /// PR 674 review — a second read (a formula destroyed what the parser
    /// formed) shows `x` where a formula was, blanks included, and the line
    /// start pulldown reports there stands on the original's blanks; a
    /// footnote label ends at its first unescaped `]` and spans UTF-16
    /// columns, as micromark counts them before a tab. Measured against the
    /// editor, 2026-09-18.
    #[test]
    fn a_second_read_and_a_footnote_label_keep_the_containers() {
        // the second read (a formula destroys what the parser formed) keeps the frames
        assert_eq!(
            refs("- $ x ` y $ <i title=\"((n#^o))\"> `\n  $$\n  ((n#^o))\n((n#^o))\n"),
            [false, false, true]
        );
        // a second read reports the line start on the blanks a filled formula left; the `$$` is past them, and the item still holds it
        assert_eq!(
            refs("- a $$ x `\n  $$\n  ((n#^o))\n`\n((n#^o))\n"),
            [false, true]
        );
        // a tab after an astral label stops where UTF-16 columns put it
        assert_eq!(refs("[^😀]: -\t$$\n      ((n#^o))\n"), [true]);
        // an escaped `]` does not end a footnote label; four columns past the item inside it is text
        assert_eq!(
            refs("[^a\\]:b]: - a\n          $$\n      ((n#^o))\n"),
            [true]
        );
        // an escaped `]` inside a label, and four columns after it
        assert_eq!(refs("[^a\\]]: $$\n    ((n#^o))\n((n#^o))\n"), [false, true]);
    }

    /// The closing `$$` run may be indented at most three columns past the
    /// container's content column — remark-math closes as a fenced code
    /// block does — and a tab reaches the next tab stop of the line's own
    /// column. Indented further, the line is the formula's.
    #[test]
    fn a_closing_dollar_run_is_indented_at_most_three_columns() {
        assert_eq!(refs("$$\n   $$\n((n#^o))\n"), [true]);
        assert_eq!(refs("$$\n   $$   \n((n#^o))\n"), [true]);
        assert_eq!(refs("$$\n    $$\n((n#^o))\n"), [false]);
        assert_eq!(refs("$$\n\t$$\n((n#^o))\n"), [false]);
        assert_eq!(refs("- $$\n     $$\n  ((n#^o))\n"), [true]);
        assert_eq!(refs("- $$\n      $$\n  ((n#^o))\n"), [false]);
        assert_eq!(refs("- $$\n  \t$$\n  ((n#^o))\n"), [true]);
        assert_eq!(refs("- $$\n      \t$$\n  ((n#^o))\n"), [false]);
        assert_eq!(refs("> $$\n>    $$\n> ((n#^o))\n"), [true]);
        assert_eq!(refs("> $$\n>     $$\n> ((n#^o))\n"), [false]);
        assert_eq!(refs("[^1]: $$\n       $$\n    ((n#^o))\n"), [true]);
        assert_eq!(refs("[^1]: $$\n        $$\n    ((n#^o))\n"), [false]);
        // A tab straddling a container's edge: the container takes the
        // columns it needs, the rest count toward the closer's indentation.
        assert_eq!(refs("- $$\n\t$$\n  ((n#^o))\n"), [true]);
        assert_eq!(refs("- $$\n\t $$\n  ((n#^o))\n"), [true]);
        assert_eq!(refs("- $$\n\t   $$\n  ((n#^o))\n"), [false]);
        assert_eq!(refs("> $$\n>\t$$\n> ((n#^o))\n"), [true]);
        assert_eq!(refs("> $$\n>\t $$\n> ((n#^o))\n"), [true]);
        assert_eq!(refs("> $$\n>\t  $$\n> ((n#^o))\n"), [false]);
        assert_eq!(refs("> - $$\n>\t   $$\n>   ((n#^o))\n"), [true]);
        assert_eq!(refs("[^1]: $$\n\t   $$\n    ((n#^o))\n"), [true]);
        assert_eq!(refs("[^1]: $$\n\t\t$$\n    ((n#^o))\n"), [false]);
        assert_eq!(refs(">\t$$\n>\t((n#^o))\n((n#^o))\n"), [false, true]);
    }

    /// No display formula, for sweeping a block directly.
    static NONE: Literal = Literal { ranges: Vec::new() };

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
        // issue 663: a bare CR is a line break, as it is to both parsers.
        let cr: Vec<(&str, &str)> = source_lines("a\rb\r\nc\rd")
            .map(|l| (l.text, l.terminator))
            .collect();
        assert_eq!(cr, [("a", "\r"), ("b", "\r\n"), ("c", "\r"), ("d", "")]);
        assert_eq!(
            source_lines("a\rb\r\nc")
                .map(|l| l.offset)
                .collect::<Vec<_>>(),
            [0, 2, 5]
        );
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
            inline_literals(&md, 0..md.len(), &[], &NONE, &mut out, &mut formulas).visited,
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
        let swept = inline_literals(&md, 0..md.len(), &[], &NONE, &mut out, &mut formulas);
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
            &NONE,
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
            &NONE,
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
        let analysis = Literal::analyse(&long);
        assert_eq!((analysis.reads, analysis.gave_up), (8, true));
        assert!(!Literal::analyse(&short).gave_up);
        assert_eq!(refs(&long), [false]);
    }

    /// The editor reads flow before text: a line that opens a display
    /// formula is a display formula, never the closer of a stray `$$` in
    /// the paragraph above it — in a paragraph, a blockquote, a list item,
    /// and with CRLF line ends.
    #[test]
    fn a_stray_double_dollar_does_not_close_on_the_line_that_opens_a_display_formula() {
        assert_eq!(
            refs("Write $$ to open display math.\n((n#^o))\n$$\nE = mc^2\n$$\n"),
            [true]
        );
        assert_eq!(refs("> a $$ b\n> ((n#^o))\n> $$ c\n"), [true]);
        assert_eq!(refs("- a $$ b\n  ((n#^o))\n  $$ c\n"), [true]);
        assert_eq!(refs("1. a $$ b\n   ((n#^o))\n   $$ c\n"), [true]);
        assert_eq!(refs("a $$ b\r\n((n#^o))\r\n$$ c\r\n"), [true]);
        // The formula itself is still literal, and closes where it should.
        assert_eq!(
            refs("Write $$ here.\n$$\n((n#^o))\n$$\n((n#^o))\n"),
            [false, true]
        );
    }

    /// The editor's parser drops one leading byte order mark; the parser
    /// here would read `\u{FEFF}```` as text and the fence would vanish.
    /// The mark is cut with the front matter. A second mark is text — the
    /// fence after it is no fence, to the editor either.
    #[test]
    fn a_leading_byte_order_mark_does_not_hide_the_first_block_from_the_parser() {
        assert_eq!(
            refs("\u{FEFF}```\n((n#^o))\n```\n((n#^o))\n"),
            [false, true]
        );
        assert_eq!(refs("\u{FEFF}<div>\n((n#^o))\n</div>\n"), [false]);
        assert_eq!(refs("\u{FEFF}    ((n#^o))\n"), [false]);
        assert_eq!(refs("\u{FEFF}> ```\n> ((n#^o))\n> ```\n"), [false]);
        assert_eq!(refs("\u{FEFF}\u{FEFF}```\n((n#^o))\n```\n"), [true]);
    }

    /// The parser reads `$$` over `===`, `---` or `|---|` as a setext
    /// heading or a table; the editor reads a display formula. Its opening
    /// line is a line start here too. An ATX heading and a cell after a `|`
    /// are not.
    #[test]
    fn a_display_formula_opens_on_a_line_the_parser_read_as_a_heading_or_a_table() {
        assert_eq!(refs("$$\n===\n((n#^o))\n$$\n"), [false]);
        assert_eq!(refs("$$\n---\n((n#^o))\n$$\n"), [false]);
        assert_eq!(refs("$$\n|---|\n((n#^o))\n$$\n"), [false]);
        assert_eq!(refs("# $$\n((n#^o))\n$$\n"), [true]);
        assert_eq!(refs("| a |\n|---|\n| $$ |\n((n#^o))\n"), [true]);
    }

    /// A bare URL or address is a link to the editor, delimiters inside it
    /// included, when it starts after a boundary and has a domain micromark
    /// accepts — and never inside a link's text. Its trailing punctuation,
    /// an unbalanced `)` and an entity are not part of it.
    #[test]
    fn a_delimiter_inside_a_bare_url_or_address_opens_nothing() {
        for md in [
            "https://api.test/?$filter=x ((n#^o)) $\n",
            "https://x.test/`a` ((n#^o)) `\n",
            "www.x.test/$ ((n#^o)) $\n",
            "WWW.X.TEST/$ ((n#^o)) $\n",
            "*https://x.test/$* ((n#^o)) $\n",
            "(https://x.test/$) ((n#^o)) $\n",
            "https://x.test/(a$) ((n#^o)) $\n",
            "see https://x.test/a$. ((n#^o)) $\n",
            "https://x.test/a$&amp; ((n#^o)) $\n",
            // What the editor accepts as a domain: hyphens anywhere but
            // first, empty and trailing segments, digits, a port, no period
            // at all, a non-ASCII letter, an underscore before the last two
            // segments, a `-` first after `www.`.
            "https://a-.test/$ ((n#^o)) $\n",
            "https://a.-b.test/$ ((n#^o)) $\n",
            "https://a.test-/$ ((n#^o)) $\n",
            "https://a..test/$ ((n#^o)) $\n",
            "https://a.test./$ ((n#^o)) $\n",
            "https://1.2.3.4/$ ((n#^o)) $\n",
            "https://a.test:8080/$ ((n#^o)) $\n",
            "http://localhost/$ ((n#^o)) $\n",
            "https://a/$ ((n#^o)) $\n",
            "https://a_b.c.test/$ ((n#^o)) $\n",
            "https://ä.test/$ ((n#^o)) $\n",
            "https://１.test/$ ((n#^o)) $\n",
            "https://a。b.test/$ ((n#^o)) $\n",
            "www.-a.test/$ ((n#^o)) $\n",
            "https://a.test$ ((n#^o)) $\n",
        ] {
            assert_eq!(refs(md), [true], "{md:?}");
        }
        // Not a link — no boundary, an underscore in the last two segments,
        // a domain that begins with `-`, `.`, `_` or a punctuation mark — so
        // the `$` opens a formula.
        // An address ends before the `$`, whatever `-` its parts begin or
        // end with; a `<` ends a URL. Inside a link's text the editor reads
        // no bare URL.
        for md in [
            "xhttps://x.test/$ ((n#^o)) $\n",
            "https://x_y.test/$ ((n#^o)) $\n",
            "https://a.b_c.test/$ ((n#^o)) $\n",
            "https://-a.test/$ ((n#^o)) $\n",
            "https://.a.test/$ ((n#^o)) $\n",
            "https://_..a/$ ((n#^o)) $\n",
            "https://_a.test/$ ((n#^o)) $\n",
            "https://。/$ ((n#^o)) $\n",
            "https://→.test/$ ((n#^o)) $\n",
            "a@b.test$ ((n#^o)) $\n",
            "a.b+c@d-e.test$ ((n#^o)) $\n",
            "a-@b.test$ ((n#^o)) $\n",
            "-a@b.test$ ((n#^o)) $\n",
            "a@-b.test$ ((n#^o)) $\n",
            "https://a.test/x<y$ ((n#^o)) $\n",
            "[https://x.test/$](u) ((n#^o)) $\n",
        ] {
            assert_eq!(refs(md), [false], "{md:?}");
        }
        // A formula that opened first swallows the URL, raw.
        assert_eq!(refs("$ x https://a.test/$b ((n#^o))\n"), [true]);
    }
}
