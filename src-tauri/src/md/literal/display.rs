// The editor's display rule of `md::literal` (issues 664 and 665): where a
// `$$` formula opens, through which lines it runs — the containers around it
// read off the parser's frames, each measured on its own marker line — and
// what the editor makes of the lines after it. Measured against remark, not
// derived from a specification; the sentinels of issue 669 say which
// versions.

use super::*;

/// The editor's display rule (remark-math, like a fenced code block): a line
/// whose content opens with two or more `$` and carries no other `$` opens a
/// formula that ends with the line break of the next line that is a `$` run
/// at least as long and blanks — or, when no such line comes, where the
/// formula's containers end. Blank lines inside do not end it.
///
/// issue 664: where the containers end is NOT where pulldown says. remark's
/// math flow has no lazy continuation, so the formula runs only through the
/// lines that still carry every container the opener's line was in: a `>`
/// (after up to three blanks) for each blockquote, the content width for
/// each list item — whatever pulldown made of the lines after (it reads a
/// `>`-less line as the lazy continuation of the paragraph it took the `$$`
/// for). A blank line keeps an item and ends a blockquote, as it does for
/// the editor.
///
/// Which containers those are comes from the parser's frames
/// (`LineStart::chain`), not from the opener line's own prefix: an item's
/// marker stands on the item's first line only, so a `$$` on a later line
/// has blanks before it and nothing to read a container from.
pub(super) fn display_math(
    content: &str,
    line_starts: &[LineStart],
    chains: &[Vec<Holder>],
    out: &mut Vec<Range<usize>>,
) {
    let bytes = content.as_bytes();
    let mut skip_until = 0;
    // Items and footnote definitions the editor closed where pulldown kept
    // them open: a line after a formula that does not carry them. To pulldown
    // that line is the lazy continuation of the paragraph it took the `$$`
    // for, and every later line start still stands inside them — indented
    // as they ask or not, they are over. A blockquote is not listed: a line
    // that carries its `>` is in a blockquote either way, the old one or a
    // new one, and one that does not is settled on the opener's own line.
    let mut closed: HashSet<Holder> = HashSet::new();
    for opener in line_starts {
        // A second read has `x` where a formula was, blanks included, so the
        // line start pulldown reports there may stand on the original's
        // blanks: the `$$` is past them.
        let start = opener.start
            + bytes[opener.start..]
                .iter()
                .take_while(|&&b| b == b' ' || b == b'\t')
                .count();
        if start < skip_until {
            continue;
        }
        let open = bytes[start..].iter().take_while(|&&b| b == b'$').count();
        if open < 2 {
            continue;
        }
        let line_end = {
            let (line_start, text, terminator) = line_at(content, start);
            line_start + text.len() + terminator.len()
        };
        if bytes[start + open..line_end].contains(&b'$') {
            continue;
        }
        // Without the items and footnote definitions the editor does not
        // have: the ones it closed, and the ones pulldown made of a formula's
        // own lines (a `- x` between `$$` and `$$` is a list item to it). A
        // container pulldown opened since is the editor's too, only not
        // inside those. A blockquote stays either way: what it asks is the
        // `>` itself, which the opener's line carries or does not.
        let chain: Vec<Holder> = chains[opener.chain]
            .iter()
            .filter(|holder| {
                holder.kind == HolderKind::Quote
                    || !(closed.contains(holder) || {
                        let marker = marker_byte(bytes, holder.start);
                        overlaps(out, marker..marker + 1)
                    })
            })
            .copied()
            .collect();
        let Some((reqs, modelled)) = requirements(content, start, &chain) else {
            continue;
        };
        // The end of the last line that is still the formula's: the closing
        // line when one comes, else the last line that carries every
        // container and is not blank. A container this rule cannot read
        // keeps the parser's own container end as the bound.
        let bound = if modelled {
            content.len()
        } else {
            opener.container_end
        };
        let end = formula_end(content, (line_end, bound), open, &reqs);
        out.push(start..end);
        skip_until = end;
        // An unread chain gives no ground to judge the lines after.
        if modelled {
            // The containers the opener's own line had already lost.
            over(&chain[reqs.len()..], &mut closed);
            let code_end = after_formula(content, end, (&chain, &reqs), &mut closed);
            if code_end > end {
                out.push(end..code_end);
                skip_until = code_end;
            }
        }
    }
}

/// Where the formula opened by a run of `open` dollars ends, its opener
/// line ending at `line_end` and nothing past `bound` being its: the end of
/// the closing line when one comes, else of the last line that carries every
/// container in `reqs` and is not blank.
fn formula_end(
    content: &str,
    (line_end, bound): (usize, usize),
    open: usize,
    reqs: &[Continue],
) -> usize {
    let mut end = line_end;
    for line in source_lines(&content[line_end..]) {
        let at = line_end + line.offset;
        if at >= bound {
            break;
        }
        let Some((text, indent)) = continues(line.text, reqs) else {
            break;
        };
        let after = at + line.text.len() + line.terminator.len();
        // The closing run may be indented at most three columns past the
        // container's content, as a fenced code block's closer may.
        // Indented further, the line is the formula's — measured against
        // remark, tabs split across a container's edge included.
        let close = text.bytes().take_while(|&b| b == b'$').count();
        if indent <= 3 && close >= open && text[close..].trim_matches([' ', '\t']).is_empty() {
            end = after;
            break;
        }
        if !text.trim_matches([' ', '\t']).is_empty() {
            end = after;
        }
    }
    end
}

/// What follows a formula that ended at `end` begins a block of its own to
/// the editor. pulldown took the `$$` for a paragraph and reads the lines
/// after as that paragraph's, lazily where need be — so a line indented four
/// columns past the containers it still carries is prose to it and an
/// indented code block to the editor. That block's end is returned (`end`
/// when there is none: blank lines and further such lines are the block's).
/// And no paragraph being open, a line after the formula is lazy to nobody:
/// the containers of `chain` it does not carry are `over`.
fn after_formula(
    content: &str,
    end: usize,
    (chain, reqs): (&[Holder], &[Continue]),
    closed: &mut HashSet<Holder>,
) -> usize {
    let mut code_end = end;
    let mut live = reqs.len();
    for line in source_lines(&content[end..]) {
        if line.text.trim_matches([' ', '\t']).is_empty() {
            continue;
        }
        let (carried, indent, _) = carry(line.text, &reqs[..live]);
        over(&chain[carried..live], closed);
        live = carried;
        if indent < 4 {
            break;
        }
        code_end = end + line.offset + line.text.len() + line.terminator.len();
    }
    code_end
}

/// List `holders` as over for the editor — a blockquote never: a line that
/// carries its `>` is in a blockquote either way, the old one or a new one.
fn over(holders: &[Holder], closed: &mut HashSet<Holder>) {
    closed.extend(
        holders
            .iter()
            .filter(|holder| holder.kind != HolderKind::Quote),
    );
}

/// The first byte at or after `at` that is neither a blank nor a line break:
/// where an item's marker is. pulldown's start of an item may fall short of
/// it — on the blanks before the marker, or, behind a tab, on the line break
/// before the marker's line, which a formula closed on that line owns.
fn marker_byte(bytes: &[u8], at: usize) -> usize {
    at + bytes[at..]
        .iter()
        .take_while(|&&b| matches!(b, b' ' | b'\t' | b'\n' | b'\r'))
        .count()
}

/// What the containers around the opener at `opener` ask of the lines after
/// it, outermost first, and whether every one of them was read — or None
/// when the line is no opener after all.
///
/// Each container is measured on its own first line — the one its marker
/// stands on — after the containers before it have been passed on that same
/// line: opened there too (`> - a`), or continued (`  - b` under `- a`). The
/// width an item asks for is what its prefix took of that line from where
/// the containers before it left off: the blanks before the marker, the
/// marker, the blanks after (one column when five or more follow, or when
/// nothing does). A footnote definition asks for four, whatever its own
/// indent.
///
/// The opener's own line then settles which of them the editor still has:
/// pulldown keeps a `$$` that lost its `>` or its indent inside the
/// container as a lazy continuation, where remark's math flow interrupts
/// the paragraph and the container is over — the requirements stop at the
/// first one the opener's line does not meet. What is left before the `$$`
/// must be less than four columns, as before any flow construct: four or
/// more make the line the paragraph's text, and no formula opens.
///
/// A marker line this rule cannot read leaves the rest unread (`false`):
/// the caller keeps the parser's container end as the bound.
pub(super) fn requirements(
    content: &str,
    opener: usize,
    chain: &[Holder],
) -> Option<(Vec<Continue>, bool)> {
    let mut reqs: Vec<Continue> = Vec::with_capacity(chain.len());
    // The line each container's marker stands on, as resolved below.
    let mut marker_lines: Vec<usize> = Vec::with_capacity(chain.len());
    let mut read = true;
    'holders: for (k, holder) in chain.iter().enumerate() {
        // pulldown's start of an item is its marker minus the outer indent
        // in COLUMNS, taken off in bytes: behind a tab it falls short of the
        // marker's line, onto the line break before it. The marker is on
        // that line or the next.
        let (mut line_start, mut text, mut terminator) = line_at(content, holder.start);
        for _ in 0..2 {
            let outer = (&chain[..k], &reqs[..], &marker_lines[..]);
            if let Some(req) = measure(holder, (line_start, text), outer) {
                reqs.push(req);
                marker_lines.push(line_start);
                continue 'holders;
            }
            let next = line_start + text.len() + terminator.len();
            if next >= content.len() {
                break;
            }
            (line_start, text, terminator) = line_at(content, next);
        }
        // Unread from here on. The opener's line is still settled below
        // against what was read.
        read = false;
        break;
    }
    let (line_start, text, _) = line_at(content, opener);
    let (met, indent) = settle(
        (line_start, text),
        (&chain[..reqs.len()], &reqs, &marker_lines),
    );
    reqs.truncate(met);
    // Four columns of blanks past the last container the line carries: what
    // follows them opens nothing, a marker no more than a formula.
    if indent >= 4 {
        return None;
    }
    Some((reqs, read))
}
