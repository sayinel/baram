//! §33 · §278.1 Markdown-syntax links to a renamed file — `[t](x)`, `![a](x)`, a reference
//! link's definition `[id]: x` — and the HTML media tags that load it (`<img src="x">`,
//! `html_media`), which the link index does not read (`LinkKind` names the three
//! `[[…]]`/`((…))` grammars alone) and a rename does not rewrite. A file rename only asks
//! whether a note holds one that would dangle, so the note can be reported
//! (`RenameResult::skipped_files`) rather than broken silently.
//!
//! The note is read with the parser `md::literal` reads structure with (pulldown-cmark, the
//! same options), so a destination inside code, an HTML block or the front matter is none,
//! and with `md::literal` itself for an inline link inside a formula, which the editor reads
//! as no link. An HTML tag is read where that parser reports HTML — an HTML block, or an
//! inline tag — so not inside code or the front matter; one inside a formula is read too.

use crate::md::literal::{front_matter_end, Literal};
use pulldown_cmark::{Event, LinkType, Options, Parser, Tag, TagEnd};

use super::html_media::{may_hold_media, media_sources};
use super::normalizer::fold_name;
use super::relative_links::{path_components, resolve_components, root_components};

/// The options `md::literal` parses with (its `OPTIONS`), which follow the editor's reader.
const OPTIONS: Options = Options::ENABLE_TABLES
    .union(Options::ENABLE_STRIKETHROUGH)
    .union(Options::ENABLE_TASKLISTS)
    .union(Options::ENABLE_FOOTNOTES);

/// Whether `content`, the note at `source_path`, holds a markdown link, image or link
/// definition, or an HTML media tag, whose destination the editor resolves to the file at
/// `old_path` and not to the one at `new_path` — a destination the rename leaves dangling.
/// Resolved as the editor resolves each, against the note's folder:
///
/// - a link `[t](x)`, and a definition `[id]: x`, which is a reference link's destination
///   (`planLocalLinkNavigation` in `src/utils/editor/local-link-nav.ts`, reached from the
///   link mark's click only when the destination has no URI scheme, `hasUriScheme` in
///   `src/extensions/marks/link.ts`): what precedes the first `#`, as written and
///   percent-decoded (`decodeURIComponent`, kept as written when that fails), each read from
///   the filesystem root when it starts with `/` — an OS-absolute path, not one under the
///   vault — and from the note's folder otherwise; it names a file whose path equals one of
///   those, or equals it once folded (`foldName`);
/// - an image or a video `![a](x)` (`resolveMediaSrc` in `src/utils/media-src.ts`): `x` as
///   written, unless it is an `http(s)://` or `data:` address, read the same two ways;
/// - an HTML media tag's `src` or `poster` (`html_media::media_sources`, which says which
///   tags and how they are read): by the image rule — `resolveMediaSrcsIn` resolves them
///   with `resolveMediaSrc`.
///
/// `[[…]]` and `((…))` are not read here: the index files them, and the rename rewrites
/// them. Cheap when the note holds neither `](` nor `]:`, which every inline link, image
/// and definition has, nor a `<` with `src` or `poster` (`may_hold_media`).
pub(crate) fn markdown_link_dangles(
    content: &str,
    source_path: &str,
    old_path: &str,
    new_path: &str,
    windows: bool,
) -> bool {
    if !content.contains("](") && !content.contains("]:") && !may_hold_media(content) {
        return false;
    }
    let Places {
        folder,
        root,
        old,
        new,
    } = Places::of(source_path, old_path, new_path, windows);
    let dangles = |forms: &[String]| {
        let names = |target: &str| {
            forms
                .iter()
                .any(|form| resolved(form, &folder, root, windows) == target)
        };
        names(&old) && !names(&new)
    };
    let loads = |html: &str| {
        media_sources(html)
            .iter()
            .any(|source| dangles(&media_forms(source)))
    };

    // The front matter is YAML, not markdown (`md::literal` cuts it the same way), and one
    // leading byte order mark is dropped, as the editor's reader drops it.
    let mut body_start = front_matter_end(content);
    if body_start == 0 && content.starts_with('\u{FEFF}') {
        body_start = '\u{FEFF}'.len_utf8();
    }
    let body = &content[body_start..];
    let parser = Parser::new_ext(body, OPTIONS);
    if parser
        .reference_definitions()
        .iter()
        .any(|(_, def)| dangles(&link_forms(&def.dest)))
    {
        return true;
    }
    let mut literal: Option<Literal> = None;
    // An HTML block comes one line per event; a tag may span its lines.
    let mut html_block = String::new();
    for (event, range) in parser.into_offset_iter() {
        match event {
            Event::Start(Tag::Link {
                link_type,
                dest_url,
                ..
            }) if link_type != LinkType::Email && dangles(&link_forms(&dest_url)) => {
                // A link inside a formula is no link to the editor; its `[` is literal there.
                let at = body_start + range.start;
                if !literal
                    .get_or_insert_with(|| Literal::of(content))
                    .overlaps(at..at + 1)
                {
                    return true;
                }
            }
            Event::Start(Tag::Image { dest_url, .. }) if dangles(&media_forms(&dest_url)) => {
                return true;
            }
            Event::Html(line) => html_block.push_str(&line),
            Event::End(TagEnd::HtmlBlock) => {
                if loads(&html_block) {
                    return true;
                }
                html_block.clear();
            }
            Event::InlineHtml(tag) if loads(&tag) => return true,
            _ => {}
        }
    }
    false
}

/// What a destination is resolved against and compared with: the referrer's folder (its
/// components and how many of them are the path's root), and the two files' paths folded.
struct Places<'a> {
    folder: Vec<&'a str>,
    root: usize,
    old: String,
    new: String,
}

impl<'a> Places<'a> {
    fn of(source_path: &'a str, old_path: &str, new_path: &str, windows: bool) -> Self {
        let mut folder = path_components(source_path, windows);
        folder.pop();
        Places {
            folder,
            root: root_components(source_path, windows),
            old: folded(&path_components(old_path, windows)),
            new: folded(&path_components(new_path, windows)),
        }
    }
}

/// A link's or a definition's destination as the editor tries it: what precedes the first
/// `#`, as written and percent-decoded when that differs. Empty for a destination with a
/// URI scheme, or one that is only a fragment — the editor never opens either as a file.
fn link_forms(dest: &str) -> Vec<String> {
    let has_scheme = dest
        .split_once(':')
        .is_some_and(|(scheme, _)| is_scheme(scheme));
    if has_scheme || dest.starts_with('#') {
        return Vec::new();
    }
    let file = dest.split('#').next().unwrap_or(dest);
    let mut forms = vec![file.to_owned()];
    if let Some(decoded) = decode_percent(file) {
        if decoded != file {
            forms.push(decoded);
        }
    }
    forms
}

/// An image's or a video's source as the editor loads it: as written, unless it is an
/// `http://`, `https://` or `data:` address (`isRemoteOrData`, ASCII case ignored).
fn media_forms(src: &str) -> Vec<String> {
    let lower = |prefix: &str| {
        src.get(..prefix.len())
            .is_some_and(|head| head.eq_ignore_ascii_case(prefix))
    };
    if src.is_empty() || lower("http://") || lower("https://") || lower("data:") {
        return Vec::new();
    }
    vec![src.to_owned()]
}

/// `/^[a-z][a-z0-9+.-]*$/i` — a URI scheme, the part before a destination's first `:`.
fn is_scheme(scheme: &str) -> bool {
    let mut chars = scheme.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
}

/// `decodeURIComponent`: every `%XX` decoded as UTF-8, `None` when a `%` is not followed by
/// two hex digits or the bytes are not UTF-8 — where JavaScript throws, and the editor keeps
/// the destination as written.
fn decode_percent(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let well_formed = bytes.iter().enumerate().all(|(i, &b)| {
        b != b'%'
            || bytes
                .get(i + 1..i + 3)
                .is_some_and(|hex| hex.iter().all(u8::is_ascii_hexdigit))
    });
    if !well_formed {
        return None;
    }
    percent_encoding::percent_decode_str(s)
        .decode_utf8()
        .ok()
        .map(|decoded| decoded.into_owned())
}

/// `form` read from the filesystem root when it starts with `/`, else from `folder` (whose
/// first `root` components never step up), its `.` and `..` applied — `normalizePath` —
/// and folded for the comparison.
fn resolved(form: &str, folder: &[&str], root: usize, windows: bool) -> String {
    let base: &[&str] = if form.starts_with('/') { &[] } else { folder };
    folded(&resolve_components(base, root, form, windows))
}

/// Components joined with `/` and folded (`fold_name`, as the editor's `foldName`).
fn folded(components: &[&str]) -> String {
    fold_name(&components.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Whether `content`, the note `/v/d/r.md`, names `/v/d/Paper Old.pdf` so that renaming
    /// it to `/v/d/Survey.pdf` leaves the link dangling.
    fn dangles(content: &str) -> bool {
        markdown_link_dangles(
            content,
            "/v/d/r.md",
            "/v/d/Paper Old.pdf",
            "/v/d/Survey.pdf",
            false,
        )
    }

    #[test]
    fn every_markdown_form_the_editor_resolves_to_the_file_dangles() {
        // What fails this, one form at a time: dropping the percent-decoded form —
        // `Paper%20Old.pdf`; reading from the folder only — `/v/d/…`; dropping the
        // definitions — `[id]: …`; reading images by the link rule — none, since a link
        // splits at `#` and `![](Paper Old.pdf#x)` is not this file.
        for content in [
            "[t](<Paper Old.pdf>)\n",
            "[t](./Paper%20Old.pdf)\n",
            "[t](<../d/paper old.PDF#page=2>)\n",
            "[t](</v/d/Paper Old.pdf>)\n",
            "![a](<Paper Old.pdf>)\n",
            "see [t][id]\n\n[id]: <Paper Old.pdf>\n",
            "[id]: Paper%20Old.pdf\n",
        ] {
            assert!(dangles(content), "{content:?}");
        }
    }

    #[test]
    fn a_destination_the_editor_does_not_open_as_this_file_does_not_dangle() {
        // The partner of the test above: each names another file, or no file, or is no
        // link to the editor. What fails this: matching the file name anywhere in the
        // destination — `x/Paper Old.pdf`; reading a link inside a formula —
        // `$[t](<Paper Old.pdf>)$`; reading a scheme's address — `file:`; reading code.
        for content in [
            "[t](<x/Paper Old.pdf>)\n",
            "[t](https://example.com/Paper%20Old.pdf)\n",
            "[t](file:///v/d/Paper%20Old.pdf)\n",
            "[t](#Paper Old.pdf)\n",
            "![a](https://example.com/Paper Old.pdf)\n",
            "![a](<Paper Old.pdf#x>)\n",
            "`[t](<Paper Old.pdf>)`\n",
            "```\n[t](<Paper Old.pdf>)\n```\n",
            "$[t](<Paper Old.pdf>)$\n",
            "---\nlink: \"[t](<Paper Old.pdf>)\"\n---\nbody\n",
            "[[Paper Old.pdf]]\n",
            "[t](Paper%ZZOld.pdf)\n",
        ] {
            assert!(!dangles(content), "{content:?}");
        }
    }

    #[test]
    fn an_html_media_tag_the_editor_loads_dangles() {
        // The review's five forms as a note holds them — an HTML block, an inline tag,
        // Typora's resized image, a video, a poster — then a tag split over an HTML
        // block's lines, one in a blockquote, one read up a folder in another case, and
        // `<Image>`, which the HTML parser reads as `<img>`. What fails this: not reading
        // `Event::Html` — the block forms; not reading `Event::InlineHtml` — the inline
        // one; reading an HTML block one line at a time — the split tag.
        for content in [
            "<img src=\"Paper Old.pdf\" width=\"300\">\n",
            "see <img src=\"Paper Old.pdf\"> here\n",
            "<img src=\"Paper Old.pdf\" style=\"zoom:50%;\" />\n",
            "<video src=\"Paper Old.pdf\" controls></video>\n",
            "<video src=\"x.mp4\" poster=\"Paper Old.pdf\"></video>\n",
            "<div>\n<img\nsrc=\"Paper Old.pdf\">\n</div>\n",
            "> <img src=\"Paper Old.pdf\">\n",
            "<img src=\"../d/paper old.PDF\">\n",
            "<Image src=\"Paper Old.pdf\" />\n",
        ] {
            assert!(dangles(content), "{content:?}");
        }
    }

    #[test]
    fn an_html_tag_that_loads_no_such_file_does_not_dangle() {
        // The partner of the test above. A media source is read as written, so
        // `Paper%20Old.pdf` is another file, as for `![](…)`. What fails this: reading
        // HTML the parser reports as code or front matter; reading `srcset` or `href`;
        // reading a source's scheme as a folder.
        for content in [
            "<img srcset=\"Paper Old.pdf 2x\">\n",
            "<img src=\"https://example.com/Paper Old.pdf\">\n",
            "<img src=\"Paper%20Old.pdf\">\n",
            "<a href=\"Paper Old.pdf\">x</a>\n",
            "<ImageCard src=\"Paper Old.pdf\" />\n",
            "`<img src=\"Paper Old.pdf\">`\n",
            "```\n<img src=\"Paper Old.pdf\">\n```\n",
            "    <img src=\"Paper Old.pdf\">\n",
            "---\nimg: <img src=\"Paper Old.pdf\">\n---\nbody\n",
            "<!-- <img src=\"Paper Old.pdf\"> -->\n",
        ] {
            assert!(!dangles(content), "{content:?}");
        }
    }

    #[test]
    fn a_destination_that_still_names_the_file_after_the_rename_does_not_dangle() {
        // A case-only rename: the editor finds the file by its folded name, so
        // `Paper Old.pdf` still opens `paper old.pdf`. What fails this: dropping the
        // comparison with the new path — the link is reported though it still works.
        assert!(!markdown_link_dangles(
            "[t](<Paper Old.pdf>)\n",
            "/v/d/r.md",
            "/v/d/Paper Old.pdf",
            "/v/d/paper old.pdf",
            false,
        ));
    }
}
