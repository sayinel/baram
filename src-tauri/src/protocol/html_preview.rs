// §5.1 HTML preview URI scheme — serves the previewed .html file and everything it
// references, with a host bridge injected into the document.
//
// Why a scheme of our own, when the PDF and image viewers are happy with asset:?
// `convertFileSrc` percent-encodes the whole path into ONE opaque URL segment
// (`asset://localhost/%2FUsers%2F...%2Fdoc.html`), so a relative `img/a.png` in the
// document resolves against that single segment and arrives as
// `asset://localhost/img/a.png`. The asset handler decodes that to the RELATIVE path
// `img/a.png`, which `Scope::is_allowed` canonicalizes against the process CWD and
// rejects — every relative reference in a previewed document 403s. Keeping real path
// segments here is what makes relative references resolve where their author meant.
//
// Access control is deliberately NOT re-implemented: this consults the very same
// `asset_protocol_scope()` the asset protocol consults, so the per-context grants
// issued in context_cmd/fs_cmd/plugin_cmd govern both schemes under one policy. A
// second policy here would be a second thing to keep in sync, and the drift would be
// silent.
//
// The frame is sandboxed WITHOUT allow-same-origin, so the host cannot reach into the
// document and the document's input events never reach the host. The injected bridge
// (html-preview-shim.js) is the only channel between them; the host re-validates
// everything that arrives over it.

use std::borrow::Cow;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use http_range::{HttpRange, HttpRangeParseError};
use tauri::http::header::{ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE};
use tauri::http::{Request, Response, StatusCode};
use tauri::path::SafePathBuf;
use tauri::utils::mime_type::MimeType;
use tauri::{Manager, Runtime, UriSchemeContext};

/// URI scheme the preview loads through. `baramhtml://localhost/<path>` on macOS and
/// Linux, `http://baramhtml.localhost/<path>` on Windows — `frame-src` in
/// tauri.conf.json lists both, and the frontend derives the origin rather than
/// hardcoding either (see `html-preview-url.ts`).
pub const SCHEME: &str = "baramhtml";

const SHIM: &str = include_str!("html-preview-shim.js");

/// Largest byte range served in one 206 response, matching tauri's asset protocol.
const MAX_RANGE_LEN: u64 = 1000 * 1024;

pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    match respond(&ctx, &request) {
        Ok(response) => response,
        Err(err) => {
            log::error!("html preview protocol: {err}");
            empty(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

fn respond<R: Runtime>(
    ctx: &UriSchemeContext<'_, R>,
    request: &Request<Vec<u8>>,
) -> Result<Response<Cow<'static, [u8]>>, Box<dyn std::error::Error>> {
    let Some(path) = request_path(request.uri().path()) else {
        return Ok(empty(StatusCode::BAD_REQUEST));
    };

    if SafePathBuf::new(path.clone().into()).is_err() {
        log::error!("html preview protocol: path traverses parent directories: {path}");
        return Ok(empty(StatusCode::FORBIDDEN));
    }

    if !ctx.app_handle().asset_protocol_scope().is_allowed(&path) {
        log::error!("html preview protocol: path outside the granted asset scope: {path}");
        return Ok(empty(StatusCode::FORBIDDEN));
    }

    let range = request
        .headers()
        .get("range")
        .and_then(|value| value.to_str().ok());

    serve(&path, range)
}

/// Reads an access-checked path into a response. Split from `respond` so the parts
/// with arithmetic in them — which slice of the file, how it is labelled — are
/// reachable from a test; a `UriSchemeContext` cannot be constructed outside tauri.
fn serve(
    path: &str,
    range_header: Option<&str>,
) -> Result<Response<Cow<'static, [u8]>>, Box<dyn std::error::Error>> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(empty(StatusCode::NOT_FOUND));
        }
        Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => {
            return Ok(empty(StatusCode::FORBIDDEN));
        }
        Err(err) => return Err(err.into()),
    };

    // Documents are rewritten, so they are read whole and never range-served; the
    // injected bridge would not survive being handed out one slice at a time.
    if is_html_path(path) {
        let mut body = Vec::new();
        file.read_to_end(&mut body)?;
        return Ok(html_response(inject_shim(body)));
    }

    let len = file.metadata()?.len();
    let mime_type = {
        let nbytes = len.min(8192);
        let mut magic = Vec::with_capacity(nbytes as usize);
        (&mut file).take(nbytes).read_to_end(&mut magic)?;
        file.rewind()?;
        // Extension-driven, with OctetStream (not tauri's Html) as the fallback: an
        // unknown extension served as text/html would be parsed as markup.
        MimeType::parse_with_fallback(&magic, path, MimeType::OctetStream)
    };

    let range = match range_header.map(|value| HttpRange::parse(value, len)) {
        // A malformed Range header is ignored and the whole representation sent
        // (RFC 9110 §14.2) — the two failures are not the same answer, and tauri's
        // asset protocol collapsing both into 416 is the behaviour not copied here.
        None | Some(Err(HttpRangeParseError::InvalidRange)) => None,
        // Unsatisfiable is a real answer: 416 carries `bytes */len`, which is how a
        // client that guessed past the end learns where the file actually ends.
        Some(Err(HttpRangeParseError::NoOverlap)) => {
            return Ok(Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(CONTENT_RANGE, format!("bytes */{len}"))
                .body(Vec::new().into())?);
        }
        Some(Ok(ranges)) => Some(ranges),
    };

    // Only single ranges get a 206. A multi-range request is answered in full, which
    // the spec allows and no media element we serve actually issues.
    //
    // `parse` has already established that the range lies inside the file, so the
    // arithmetic below only ever narrows it.
    if let Some([range]) = range.as_deref() {
        let start = range.start;
        let end = start + range.length.clamp(1, MAX_RANGE_LEN) - 1;
        let nbytes = end + 1 - start;
        let mut body = Vec::with_capacity(nbytes as usize);
        file.seek(SeekFrom::Start(start))?;
        file.take(nbytes).read_to_end(&mut body)?;

        return Ok(Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(CONTENT_TYPE, &mime_type)
            .header(ACCEPT_RANGES, "bytes")
            .header(CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
            .header(CONTENT_LENGTH, nbytes)
            .body(body.into())?);
    }

    let mut body = Vec::with_capacity(len as usize);
    file.read_to_end(&mut body)?;
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, &mime_type)
        .header(ACCEPT_RANGES, "bytes")
        .body(body.into())?)
}

/// No `Access-Control-Allow-Origin`, deliberately. The frame's origin is opaque, so
/// omitting the header leaves every `fetch()` from page script CORS-blocked while
/// `<img>`/`<link>`/`<script>` (no-cors) keep loading — the same split the asset
/// protocol gets by scoping the header to the app origin. Page script can therefore
/// display sibling files but not read their bytes back and post them somewhere.
fn html_response(body: Vec<u8>) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(StatusCode::OK)
        // No charset: the document's own <meta charset> decides, as it would if the
        // file were opened directly. The injected bridge is ASCII, so it survives
        // whatever that turns out to be.
        .header(CONTENT_TYPE, "text/html")
        .body(body.into())
        .expect("static header values are valid")
}

fn empty(status: StatusCode) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .body(Vec::new().into())
        .expect("empty body with a valid status")
}

/// Decodes a request path back into a filesystem path.
///
/// The URL carries real path segments (`baramhtml://localhost/Users/me/doc.html`), so
/// the leading `/` IS the filesystem root on unix — and on Windows it is a separator to
/// drop, because the path resumes at a drive letter (`/C:/Users/me/doc.html`).
fn request_path(uri_path: &str) -> Option<String> {
    let decoded = percent_encoding::percent_decode(uri_path.as_bytes())
        .decode_utf8()
        .ok()?
        .into_owned();
    if decoded.is_empty() {
        return None;
    }
    #[cfg(windows)]
    let decoded = decoded.strip_prefix('/').unwrap_or(&decoded).to_string();
    Some(decoded)
}

/// Mirrors `HTML_EXTENSIONS` in `src/utils/file-type.ts` — the frontend decides which
/// tabs get a preview, and a file it routes here must be served as a document.
///
/// Not `MimeType::parse`: its extension check is `uri.split('.').next_back()`, which
/// reads `/Users/me/my.dir/README` as the extension `dir/README`, and its table has no
/// `.htm` arm at all.
fn is_html_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("html") || ext.eq_ignore_ascii_case("htm"))
}

fn inject_shim(mut html: Vec<u8>) -> Vec<u8> {
    let at = injection_offset(&html);
    let tag = format!("<script>\n{SHIM}</script>\n");
    html.splice(at..at, tag.into_bytes());
    html
}

/// Where the bridge script goes, as a byte offset into the document.
///
/// Ahead of every script the page brought with it, and never ahead of the doctype: a
/// tag before `<!DOCTYPE html>` drops the document into quirks mode, silently changing
/// the layout of the page the user wrote. So: just inside the first of `<html>`,
/// `<head>` or `<body>` — the parser relocates a script found between `<html>` and
/// `<head>` into the head for us — else after a lone doctype, else at the very top.
///
/// Comments are skipped rather than matched inside, because a commented-out `<head>`
/// above the real one is a normal thing to find in a document, and splicing a script
/// into the middle of a comment would silently swallow it.
fn injection_offset(html: &[u8]) -> usize {
    let mut after_doctype = 0usize;
    let mut i = 0usize;

    while i < html.len() {
        if html[i] != b'<' {
            i += 1;
            continue;
        }
        let rest = &html[i..];

        if rest.starts_with(b"<!--") {
            i = find(&html[i + 4..], b"-->").map_or(html.len(), |at| i + 4 + at + 3);
            continue;
        }

        if starts_with_ci(rest, b"<!doctype") {
            i = tag_end(html, i);
            after_doctype = i;
            continue;
        }

        for tag in [b"<html".as_slice(), b"<head".as_slice()] {
            if starts_with_ci(rest, tag) && is_tag_boundary(html, i + tag.len()) {
                return tag_end(html, i);
            }
        }
        // Before <body>, not inside it: the head is still open at this point, and a
        // script placed there runs before the body's content is parsed.
        if starts_with_ci(rest, b"<body") && is_tag_boundary(html, i + 5) {
            return i;
        }

        i += 1;
    }

    after_doctype
}

/// Offset just past the `>` that closes the tag opening at `from`.
///
/// Quoted attribute values are skipped, because the `>` in `<html data-x="a>b">` closes
/// nothing — splicing there would cut the tag in half.
fn tag_end(html: &[u8], from: usize) -> usize {
    let mut quote = None;
    for (offset, &byte) in html[from..].iter().enumerate() {
        match (quote, byte) {
            (Some(open), b) if b == open => quote = None,
            (Some(_), _) => {}
            (None, b'"' | b'\'') => quote = Some(byte),
            (None, b'>') => return from + offset + 1,
            (None, _) => {}
        }
    }
    html.len()
}

/// True when the byte at `at` ends a tag name — whitespace, `>` or `/`. Without this,
/// `<header>` would be taken for `<head>`.
fn is_tag_boundary(html: &[u8], at: usize) -> bool {
    matches!(
        html.get(at),
        Some(b' ' | b'\t' | b'\n' | b'\r' | b'\x0c' | b'>' | b'/')
    )
}

fn starts_with_ci(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.len() >= needle.len() && haystack[..needle.len()].eq_ignore_ascii_case(needle)
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn injected(html: &str) -> String {
        String::from_utf8(inject_shim(html.as_bytes().to_vec())).unwrap()
    }

    /// The offset the bridge lands at, as the document text around it.
    fn split_at_script(html: &str) -> (String, String) {
        let out = injected(html);
        let at = out.find("<script>").unwrap();
        let end = out.find("</script>\n").unwrap() + "</script>\n".len();
        (out[..at].to_string(), out[end..].to_string())
    }

    #[test]
    fn injects_inside_the_html_tag() {
        let (before, after) =
            split_at_script("<!DOCTYPE html>\n<html lang=\"en\">\n<head><title>t</title></head>");
        assert_eq!(before, "<!DOCTYPE html>\n<html lang=\"en\">");
        assert_eq!(after, "\n<head><title>t</title></head>");
    }

    #[test]
    fn injects_inside_head_when_there_is_no_html_tag() {
        let (before, after) = split_at_script("<head><script src=\"page.js\"></script></head>");
        assert_eq!(before, "<head>");
        assert_eq!(after, "<script src=\"page.js\"></script></head>");
    }

    #[test]
    fn injects_before_body_when_that_is_the_first_tag() {
        let (before, after) = split_at_script("<!doctype html>\n<body>hi</body>");
        assert_eq!(before, "<!doctype html>\n");
        assert_eq!(after, "<body>hi</body>");
    }

    /// A script ahead of the doctype puts the document in quirks mode, so a fragment
    /// with nothing else to anchor to still has to land after it.
    #[test]
    fn never_injects_ahead_of_the_doctype() {
        let (before, after) = split_at_script("<!DOCTYPE html>\n<p>bare fragment</p>");
        assert_eq!(before, "<!DOCTYPE html>");
        assert_eq!(after, "\n<p>bare fragment</p>");
    }

    #[test]
    fn injects_at_the_top_of_a_document_with_no_doctype_or_tags() {
        let (before, after) = split_at_script("just text");
        assert_eq!(before, "");
        assert_eq!(after, "just text");
    }

    /// A commented-out head above the real one is ordinary; splicing into the comment
    /// would drop the bridge on the floor with no error anywhere.
    #[test]
    fn skips_commented_out_tags() {
        let (before, after) = split_at_script("<!-- <head>old</head> -->\n<head>real</head>");
        assert_eq!(before, "<!-- <head>old</head> -->\n<head>");
        assert_eq!(after, "real</head>");
    }

    /// The `>` inside an attribute value closes nothing; splicing on it would cut the
    /// opening tag in half and take its remaining attributes with it.
    #[test]
    fn ignores_angle_brackets_inside_attribute_values() {
        let (before, after) = split_at_script("<html data-x=\"a>b\" lang=\"en\"><head></head>");
        assert_eq!(before, "<html data-x=\"a>b\" lang=\"en\">");
        assert_eq!(after, "<head></head>");
    }

    #[test]
    fn does_not_mistake_header_for_head() {
        let (before, _) = split_at_script("<header>nav</header><head>real</head>");
        assert_eq!(before, "<header>nav</header><head>");
    }

    #[test]
    fn injects_the_bridge_source_itself() {
        assert!(injected("<html><head></head></html>").contains("baram:html-preview"));
    }

    /// Non-ASCII bytes survive because the document is spliced as bytes and never
    /// decoded — a EUC-KR page keeps its own encoding, as its <meta charset> claims.
    #[test]
    fn preserves_non_utf8_bytes() {
        let mut html = b"<html><head></head><body>".to_vec();
        html.extend_from_slice(&[0xB0, 0xA1, 0xB0, 0xA2]); // EUC-KR, invalid UTF-8
        html.extend_from_slice(b"</body></html>");
        let out = inject_shim(html.clone());
        assert!(String::from_utf8(out.clone()).is_err());
        assert!(find(&out, &[0xB0, 0xA1, 0xB0, 0xA2]).is_some());
        assert!(out.len() > html.len());
    }

    #[test]
    fn html_paths_are_recognised_case_insensitively() {
        assert!(is_html_path("/a/b/index.html"));
        assert!(is_html_path("/a/b/index.HTM"));
        assert!(is_html_path("/a/b.dir/page.Html"));
        assert!(!is_html_path("/a/b/style.css"));
        assert!(!is_html_path("/a/b.html/style.css"));
        assert!(!is_html_path("/a/b/README"));
    }

    /// Writes `bytes` to a temp file with the given name and serves it.
    fn serve_bytes(name: &str, bytes: &[u8], range: Option<&str>) -> Response<Cow<'static, [u8]>> {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(name);
        std::fs::write(&path, bytes).unwrap();
        serve(path.to_str().unwrap(), range).unwrap()
    }

    fn header<'a>(response: &'a Response<Cow<'static, [u8]>>, name: &str) -> &'a str {
        response
            .headers()
            .get(name)
            .map_or("", |value| value.to_str().unwrap_or(""))
    }

    #[test]
    fn serves_a_document_with_the_bridge_and_no_charset() {
        let response = serve_bytes("a.html", b"<html><head></head></html>", None);
        assert_eq!(response.status(), StatusCode::OK);
        // No charset: the document's own <meta charset> has to keep deciding.
        assert_eq!(header(&response, "content-type"), "text/html");
        let body = String::from_utf8(response.body().to_vec()).unwrap();
        assert!(body.contains("baram:html-preview"));
    }

    /// The bridge is a whole-document rewrite; handing a document out one slice at a
    /// time would serve the first slice with a half-written script in it.
    #[test]
    fn ignores_range_requests_for_documents() {
        let response = serve_bytes("a.html", b"<html></html>", Some("bytes=0-3"));
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.body().len() > 4);
    }

    #[test]
    fn labels_subresources_by_extension_and_falls_back_to_octet_stream() {
        assert_eq!(
            header(&serve_bytes("s.css", b"a{}", None), "content-type"),
            "text/css"
        );
        assert_eq!(
            header(&serve_bytes("m.js", b"1", None), "content-type"),
            "text/javascript"
        );
        // An unknown extension served as text/html would be parsed as markup.
        assert_eq!(
            header(&serve_bytes("LICENSE", b"text", None), "content-type"),
            "application/octet-stream"
        );
    }

    #[test]
    fn serves_a_single_range_as_206() {
        let response = serve_bytes("v.mp4", b"0123456789", Some("bytes=2-5"));
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.body().as_ref(), b"2345");
        assert_eq!(header(&response, "content-range"), "bytes 2-5/10");
        assert_eq!(header(&response, "content-length"), "4");
        assert_eq!(header(&response, "accept-ranges"), "bytes");
    }

    /// `bytes=N-` is what a media element sends to resume, and the last byte of the
    /// file has to be included — an off-by-one here truncates every such response.
    #[test]
    fn an_open_ended_range_runs_to_the_last_byte() {
        let response = serve_bytes("v.mp4", b"0123456789", Some("bytes=7-"));
        assert_eq!(response.body().as_ref(), b"789");
        assert_eq!(header(&response, "content-range"), "bytes 7-9/10");
    }

    #[test]
    fn a_suffix_range_counts_back_from_the_end() {
        let response = serve_bytes("v.mp4", b"0123456789", Some("bytes=-3"));
        assert_eq!(response.body().as_ref(), b"789");
        assert_eq!(header(&response, "content-range"), "bytes 7-9/10");
    }

    #[test]
    fn a_range_past_the_end_is_not_satisfiable() {
        let response = serve_bytes("v.mp4", b"0123456789", Some("bytes=20-30"));
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(header(&response, "content-range"), "bytes */10");
    }

    /// A malformed header is ignored (the client gets everything) while a range past
    /// the end is answered 416 — two different failures, two different answers. And a
    /// multi-range request falls back to the whole file: the multipart/byteranges path
    /// is deliberately not ported.
    #[test]
    fn unparseable_and_multi_ranges_get_the_whole_file() {
        for range in ["not-a-range", "bytes=0-1,4-5"] {
            let response = serve_bytes("v.mp4", b"0123456789", Some(range));
            assert_eq!(response.status(), StatusCode::OK, "range: {range}");
            assert_eq!(response.body().as_ref(), b"0123456789", "range: {range}");
        }
    }

    #[test]
    fn a_missing_file_is_a_404() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("gone.png");
        let response = serve(missing.to_str().unwrap(), None).unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[cfg(not(windows))]
    #[test]
    fn request_paths_keep_the_leading_slash_on_unix() {
        assert_eq!(
            request_path("/Users/me/my%20docs/a.html").as_deref(),
            Some("/Users/me/my docs/a.html")
        );
        assert_eq!(request_path("").as_deref(), None);
    }

    #[cfg(windows)]
    #[test]
    fn request_paths_drop_the_leading_slash_on_windows() {
        assert_eq!(
            request_path("/C%3A/Users/me/a.html").as_deref(),
            Some("C:/Users/me/a.html")
        );
    }

    /// The scheme name reaches the frontend as an origin (`baramhtml://localhost`,
    /// `http://baramhtml.localhost`) and is spelled out in the CSP `frame-src`.
    /// Renaming it here alone would leave the frame blocked with no build error.
    #[test]
    fn scheme_matches_the_csp_and_the_frontend() {
        assert_eq!(SCHEME, "baramhtml");
        let csp = include_str!("../../tauri.conf.json");
        assert!(csp.contains("baramhtml:"));
        assert!(csp.contains("http://baramhtml.localhost"));
    }
}
