// The editor's bare-URL rule of `md::literal` (issue 665): what remark-gfm's
// autolink literals read as a link. Measured, not derived from the GFM text —
// the sentinels of issue 669 say which versions.

use super::*;

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
fn trim_autolink_end(bytes: &[u8], start: usize, mut end: usize) -> usize {
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
