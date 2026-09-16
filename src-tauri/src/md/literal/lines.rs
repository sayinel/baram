// The line machinery of `md::literal` (issue 665): how a note splits into
// lines with byte offsets, and where its front matter ends. Read by the
// scanners that work a line at a time (`index::extractor`) and by the
// analysis itself; the rule for what a line break is (issue 663) lives here
// and nowhere else.

/// One line of a note, for the scanners that work a line at a time: its
/// 1-based number, the byte offset of `text` in the note, the text without
/// its line break, and that break (`"\n"`, `"\r\n"`, a bare `"\r"`, or `""`
/// at the end) so a rewriter can put the note back together byte for byte.
/// A bare `\r` IS a line break, as it is to CommonMark and so to both
/// parsers whose block structure these offsets must match (issue 663);
/// `str::lines` disagrees, and a scanner that used it slid every block of a
/// CR-only note by a line. The offset is what makes a per-line regex match
/// comparable with a `Literal`, which knows only the whole note.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourceLine<'a> {
    pub number: u32,
    pub offset: usize,
    pub text: &'a str,
    pub terminator: &'a str,
}

/// The lines of `content`, in order, with their offsets. A line ends at
/// `\n`, at `\r\n`, or at a bare `\r`; the last line may end without one,
/// and an empty note has no lines.
pub fn source_lines(content: &str) -> impl Iterator<Item = SourceLine<'_>> {
    let bytes = content.as_bytes();
    let mut offset = 0;
    let mut number = 0;
    std::iter::from_fn(move || {
        if offset >= content.len() {
            return None;
        }
        let rest = &bytes[offset..];
        let (text_len, break_len) = match rest.iter().position(|&b| b == b'\n' || b == b'\r') {
            None => (rest.len(), 0),
            Some(i) if rest[i] == b'\n' => (i, 1),
            Some(i) if rest.get(i + 1) == Some(&b'\n') => (i, 2),
            Some(i) => (i, 1),
        };
        number += 1;
        let line = SourceLine {
            number,
            offset,
            text: &content[offset..offset + text_len],
            terminator: &content[offset + text_len..offset + text_len + break_len],
        };
        offset += text_len + break_len;
        Some(line)
    })
}

/// Where the body starts: past the YAML front matter when `content` opens
/// with one by the editor's rule, else 0. The front matter runs from a first
/// line `---` (trailing blanks allowed) through the next line `---` (trailing
/// blanks allowed) and that line's break; nothing closes it, nothing is
/// front matter.
pub(crate) fn front_matter_end(content: &str) -> usize {
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
        .map(|closer| closer.offset + closer.text.len() + closer.terminator.len())
        .unwrap_or(0)
}
