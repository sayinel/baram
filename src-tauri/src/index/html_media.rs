//! §33 · §294 The files an HTML tag in a note loads: the `src` of an `<img>`, `<video>`,
//! `<audio>`, `<source>`, `<track>` or `<input>`, and a `<video>`'s `poster`. A file rename
//! reads them to report a note whose HTML names the file (`markdown_links`), as it reports a
//! markdown image; it rewrites neither.
//!
//! Which elements: the HTML standard gives `src` to `audio`, `embed`, `iframe`, `img`,
//! `input`, `script`, `source`, `track` and `video`, and `poster` to `video` alone. The
//! editor's sanitizer (`sanitizeHtmlBlock` in `src/utils/markdown/html-sanitize.ts`) removes
//! `embed`, `iframe` and `script`; it keeps the other six with their `src` and `poster`,
//! which `resolveMediaSrcsIn` (`src/extensions/nodes/views/resolve-html-media-srcs.ts`)
//! then resolves. An `<image>` start tag is an `<img>`: the HTML parser renames it, so
//! `<Image src="x.png" />` loads `x.png` (both measured with jsdom and dompurify under the
//! app's sanitizer options). A `src` on any other element (`<div src>`) loads nothing, and
//! `srcset` is not resolved by the editor; neither is read.
//!
//! How a tag is read: the HTML tokenizer's rules for a start tag — names in any ASCII case,
//! a value double-quoted, single-quoted or unquoted, the first of two attributes of one name
//! kept, a tag the text ends inside dropped — and nothing inside a comment, `<!-- … -->`.
//!
//! What it reads that the editor does not load — reported though nothing breaks: a tag inside
//! a formula, inside a raw-text element (`<textarea>`) or inside one the sanitizer removes
//! with its content (`<template>`), an `<image>` inside `<svg>`, an `<input>` of a type that
//! fetches nothing (`<input type="text" src="x.png">`), and an inline tag in a paragraph the
//! editor does not keep as HTML. md-to-pm keeps a paragraph as HTML only for an `<img>` or
//! `<video>` with a `src` in it (`inlineMediaParagraphSource`), so an `<audio>`, `<source>`,
//! `<track>` or `<input>` written inline in a paragraph is dropped, and so is any tag in a
//! paragraph that also holds other inline content (`convertInlineChildren` in
//! `src/pipeline/convert-inline.ts` reads `<u>`, `<mark>`, `<sub>` and `<sup>` as marks and
//! drops every other inline tag).
//!
//! What it does not read that the editor may load: a character reference the HTML parser
//! decodes without its `;` (`&amp` before a space), and markup the editor reads as HTML where
//! the markdown parser read text — a paragraph `inlineMediaParagraphSource` keeps as an HTML
//! block is HTML from end to end, so a tag CommonMark took for text there loads too.

use pulldown_cmark::{Event, Parser, Tag};

/// The elements whose `src` the editor keeps and loads; `video` alone has a `poster` too.
const SOURCE_ELEMENTS: [&str; 6] = ["audio", "img", "input", "source", "track", "video"];

/// Whether `content` may hold a tag `media_sources` reads: a `<`, and `src` or `poster` in
/// some ASCII case. Cheap; a note without either holds none.
pub(crate) fn may_hold_media(content: &str) -> bool {
    let holds = |word: &[u8]| {
        content
            .as_bytes()
            .windows(word.len())
            .any(|window| named(window, word))
    };
    content.contains('<') && (holds(b"src") || holds(b"poster"))
}

/// Every source the media tags in `html` load, each in every reading the editor may give
/// it: with the four references `escapeHtmlAttr` writes undone (`getAttr` in
/// `src/pipeline/transformers/media-html-tag.ts`, which reads an `<img>` or `<video>` it
/// turns into a node), and with every character reference decoded (the HTML parser, for
/// what stays an HTML block).
pub(crate) fn media_sources(html: &str) -> Vec<String> {
    let mut sources = Vec::new();
    let mut at = 0;
    while let Some(open) = html[at..].find('<') {
        let from = at + open + 1;
        let rest = &html[from..];
        at = if let Some(comment) = rest.strip_prefix("!--") {
            match comment_length(comment) {
                Some(length) => from + 3 + length,
                None => return sources,
            }
        } else {
            let end_tag = rest.starts_with('/');
            let name_at = from + usize::from(end_tag);
            if !html[name_at..]
                .bytes()
                .next()
                .is_some_and(|b| b.is_ascii_alphabetic())
            {
                // `<!…>`, `<?…>` and `</…>` without a name are comments to the parser, up
                // to the first `>`; a `<` before anything else is text.
                if rest.starts_with(['!', '?', '/']) {
                    match rest.find('>') {
                        Some(close) => from + close + 1,
                        None => return sources,
                    }
                } else {
                    from
                }
            } else {
                let Some(tag) = start_tag(html, name_at) else {
                    return sources;
                };
                if !end_tag {
                    tag.sources(&mut sources);
                }
                tag.end
            }
        };
    }
    sources
}

/// One tag as the HTML tokenizer reads it: its name, its attributes in order, and the byte
/// just past its `>`.
struct StartTag<'a> {
    name: &'a str,
    attributes: Vec<(&'a str, &'a str)>,
    end: usize,
}

impl StartTag<'_> {
    /// Push the readings of what this tag loads, if it is one of `SOURCE_ELEMENTS`.
    fn sources(&self, out: &mut Vec<String>) {
        let name = self.name.as_bytes();
        let element = if named(name, b"image") {
            "img"
        } else {
            match SOURCE_ELEMENTS
                .iter()
                .find(|element| named(name, element.as_bytes()))
            {
                Some(element) => element,
                None => return,
            }
        };
        let mut seen: Vec<&str> = Vec::new();
        for &(attribute, value) in &self.attributes {
            // The first of two attributes of one name is the element's; the parser drops
            // the second.
            if seen
                .iter()
                .any(|s| named(s.as_bytes(), attribute.as_bytes()))
            {
                continue;
            }
            seen.push(attribute);
            let loads = named(attribute.as_bytes(), b"src")
                || (element == "video" && named(attribute.as_bytes(), b"poster"));
            if loads {
                for reading in readings(value) {
                    if !out.contains(&reading) {
                        out.push(reading);
                    }
                }
            }
        }
    }
}

/// The tag whose name starts at `from` (just past `<` or `</`), or `None` when `html` ends
/// inside it — the parser drops such a tag.
fn start_tag(html: &str, from: usize) -> Option<StartTag<'_>> {
    let bytes = html.as_bytes();
    let space = |b: u8| matches!(b, b'\t' | b'\n' | b'\x0C' | b'\r' | b' ');
    let ends_name = |b: u8| space(b) || b == b'/' || b == b'>';
    let skip = |mut i: usize, over: &dyn Fn(u8) -> bool| {
        while i < bytes.len() && over(bytes[i]) {
            i += 1;
        }
        i
    };
    let mut i = skip(from, &|b| !ends_name(b));
    let name = &html[from..i];
    let mut attributes = Vec::new();
    loop {
        i = skip(i, &|b| space(b) || b == b'/');
        if *bytes.get(i)? == b'>' {
            return Some(StartTag {
                name,
                attributes,
                end: i + 1,
            });
        }
        // An attribute's name runs to a space, `/`, `>` or `=`; its first character may be
        // `=`. Every byte these stop at is ASCII, so each slice is on a char boundary.
        let name_at = i;
        i = skip(i + 1, &|b| !ends_name(b) && b != b'=');
        let attribute = &html[name_at..i];
        i = skip(i, &space);
        let mut value = "";
        if bytes.get(i) == Some(&b'=') {
            i = skip(i + 1, &space);
            match *bytes.get(i)? {
                quote @ (b'"' | b'\'') => {
                    let close = i + 1 + html[i + 1..].find(char::from(quote))?;
                    value = &html[i + 1..close];
                    i = close + 1;
                }
                b'>' => {}
                _ => {
                    let at = i;
                    i = skip(i, &|b| !space(b) && b != b'>');
                    value = &html[at..i];
                }
            }
        }
        attributes.push((attribute, value));
    }
}

/// How many bytes of `rest` — what follows a `<!--` — the comment takes, its close
/// included: `>` and `->` close it at once, else the first `-->` or `--!>` does. `None`
/// when it is never closed; the rest of the text is comment.
fn comment_length(rest: &str) -> Option<usize> {
    for at_once in [">", "->"] {
        if rest.starts_with(at_once) {
            return Some(at_once.len());
        }
    }
    let close = |closer: &str| rest.find(closer).map(|at| at + closer.len());
    match (close("-->"), close("--!>")) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    }
}

/// `value` as the tag parser that turns an `<img>` or `<video>` into a node reads it, and
/// as the HTML parser does; one reading when the two agree.
fn readings(value: &str) -> Vec<String> {
    let mut readings = vec![unescape_tag_attribute(value)];
    if let Some(decoded) = decode_references(value) {
        if !readings.contains(&decoded) {
            readings.push(decoded);
        }
    }
    readings
}

/// `unescapeHtmlAttr` in `media-html-tag.ts`: `&gt;`, `&lt;`, `&quot;` and `&amp;`, the
/// four `escapeHtmlAttr` writes, undone in one pass — the same as that function's four
/// replacements in turn, since none of the first three writes a character an entity is
/// spelled with.
fn unescape_tag_attribute(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let entity = [
            ("&gt;", '>'),
            ("&lt;", '<'),
            ("&quot;", '"'),
            ("&amp;", '&'),
        ]
        .into_iter()
        .find(|(spelled, _)| rest.starts_with(spelled));
        match entity {
            Some((spelled, character)) => {
                out.push(character);
                rest = &rest[spelled.len()..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// `value` with its character references decoded — named ones by the HTML table, numeric
/// ones in decimal or hex — each closed by `;`. The decoding is CommonMark's, which uses
/// the HTML table (pulldown-cmark reads `value` as a link destination with every other
/// ASCII punctuation character escaped, so nothing else in it means anything). `None` when
/// `value` holds no `&`, or a line break, which no destination can.
fn decode_references(value: &str) -> Option<String> {
    if !value.contains('&') || value.contains(['\n', '\r']) {
        return None;
    }
    let mut document = String::from("[](<");
    for c in value.chars() {
        if c.is_ascii_punctuation() && !matches!(c, '&' | '#' | ';') {
            document.push('\\');
        }
        document.push(c);
    }
    document.push_str(">)");
    Parser::new(&document).find_map(|event| match event {
        Event::Start(Tag::Link { dest_url, .. }) => Some(dest_url.into_string()),
        _ => None,
    })
}

/// An HTML tag or attribute name compared with `name`: the HTML parser reads markup names
/// in any ASCII case.
fn named(markup: &[u8], name: &[u8]) -> bool {
    markup.eq_ignore_ascii_case(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sources(html: &str) -> Vec<String> {
        media_sources(html)
    }

    #[test]
    fn every_media_tag_the_editor_loads_names_its_source() {
        // The five forms of the review (an HTML block, inline, Typora's zoom, a video,
        // a poster), then the spellings the HTML tokenizer reads alike. What fails this:
        // matching names in one case — `<IMG SRC>`; reading double quotes alone — `'…'`
        // and unquoted; stopping a value at `>` — `alt="a > b"`; dropping the `image`
        // rename — `<Image>`; reading `poster` off no element — the poster form.
        for (html, source) in [
            ("<img src=\"img.png\" width=\"300\">\n", "img.png"),
            ("see <img src=\"img.png\"> here", "img.png"),
            ("<img src=\"img.png\" style=\"zoom:50%;\" />", "img.png"),
            ("<video src=\"img.png\" controls></video>", "img.png"),
            (
                "<video src=\"x.mp4\" poster=\"img.png\"></video>",
                "img.png",
            ),
            ("<IMG SRC=\"img.png\">", "img.png"),
            ("<img src='img.png'>", "img.png"),
            ("<img src=img.png alt=x>", "img.png"),
            ("<img src = \"img.png\">", "img.png"),
            ("<img alt=\"a > b\" src=\"img.png\">", "img.png"),
            ("<img\nsrc=\"img.png\"\n/>", "img.png"),
            ("<Image src=\"img.png\" />", "img.png"),
            ("<audio src=\"img.png\"></audio>", "img.png"),
            ("<audio><source src=\"img.png\"></audio>", "img.png"),
            ("<video><track src=\"img.png\"></video>", "img.png"),
            ("<input type=\"image\" src=\"img.png\">", "img.png"),
            ("<img src=\"a.png\" src=\"b.png\">", "a.png"),
            ("<!-- x --><img src=\"img.png\">", "img.png"),
        ] {
            assert!(
                sources(html).iter().any(|s| s == source),
                "{html:?}: {:?}",
                sources(html)
            );
        }
    }

    #[test]
    fn markup_that_loads_nothing_names_no_source() {
        // The partner of the test above. What fails this: matching `src` as a substring
        // — `srcset`, `data-src`; reading any element's `src` — `<div>`, `<embed>`,
        // `<iframe>`; reading inside a comment, or ending one at its first `>` — the
        // comment holding `<p>`; keeping a tag the text ends inside; reading an end
        // tag's attributes; reading `poster` off an `<audio>`; keeping the second of
        // two `src`.
        for html in [
            "<img srcset=\"img.png 2x\">",
            "<img data-src=\"img.png\">",
            "<a href=\"img.png\">x</a>",
            "<div src=\"img.png\">x</div>",
            "<embed src=\"img.png\">",
            "<iframe src=\"img.png\"></iframe>",
            "<audio poster=\"img.png\"></audio>",
            "<!-- <img src=\"img.png\"> -->",
            "<!-- unclosed <img src=\"img.png\">",
            "<!-- <p>a</p> <img src=\"img.png\"> -->",
            "<img src=\"img.png\"",
            "</img src=\"img.png\">",
            "<!doctype x <img src=\"img.png\">",
            "<img src=\"b.png\" src=\"img.png\">",
        ] {
            assert!(
                !sources(html).iter().any(|s| s == "img.png"),
                "{html:?}: {:?}",
                sources(html)
            );
        }
    }

    #[test]
    fn a_source_is_read_with_its_character_references_decoded() {
        // `escapeHtmlAttr` writes `&amp;` for a `&` in a file name; both readers undo it.
        // A numeric reference is decoded by the HTML parser and not by the node tag parser,
        // so both readings are kept. What fails this: reading the value as written.
        assert_eq!(sources("<img src=\"R&amp;D.png\" />"), vec!["R&D.png"]);
        assert_eq!(
            sources("<img src=\"a&#32;b&nbsp;c.png\">"),
            vec!["a&#32;b&nbsp;c.png", "a b\u{a0}c.png"]
        );
        assert_eq!(
            sources("<img src=\"a&b\\_[c].png\">"),
            vec!["a&b\\_[c].png"]
        );
    }

    #[test]
    fn a_note_without_a_tag_and_a_source_attribute_is_skipped() {
        assert!(may_hold_media("<VIDEO POSTER=x>"));
        assert!(may_hold_media("<img Src=x>"));
        assert!(!may_hold_media("src without a tag"));
        assert!(!may_hold_media("<b>bold</b>"));
    }
}
