//! §275.4 · §33 How a block reference's target is written: `)`, `#` and `|` end the target of
//! the grammar (`BLOCK_REF_RE`, `BLOCK_EMBED_RE`: `[^)#|]*?`), so the frontend percent-escapes
//! them — and `%` first, so the escape round-trips — when it builds a target from a file name
//! (`escapeBlockRefTarget` in `src/pipeline/block-id.ts`: a PDF highlight's
//! `((highlights/papers/BERT (2019%29#^h1))`), and undoes it wherever a target is read as a
//! path (`unescapeBlockRefTarget`). The index reads every block reference's target the same
//! way (`extract_links`). A rename escapes a name only where it would not read back
//! otherwise (`spell_block_ref_target`): `C# notes` is written `C%23 notes`, `50% off` as it
//! is. Both languages test the rule against `index/fixtures/block-ref-target-escape.json`.
//!
//! A wikilink's target is written unescaped by both sides, but the two read it apart: the
//! editor's `resolveWikilinkTarget` (`src/utils/editor/wikilink-nav.ts`) undoes these
//! escapes in every target it resolves, a wikilink's too, while the index reads a wikilink's
//! target as written. A hand-written `[[a%29b]]` opens `a)b.md` and is no backlink of it —
//! a known gap, left for the backlog.

use std::borrow::Cow;

/// The characters escaped and their escapes, in the order `escape_block_ref_target` applies
/// them — `%` first, so the escapes the later steps introduce are not escaped again — and
/// `unescape_block_ref_target` reverses, `%` last.
const TARGET_ESCAPE_PAIRS: [(&str, &str); 4] =
    [("%", "%25"), (")", "%29"), ("#", "%23"), ("|", "%7C")];

/// `target` as a block reference's target means it: each escape replaced by its character,
/// `%25` last (`unescapeBlockRefTarget`). The escapes are upper case only.
pub(crate) fn unescape_block_ref_target(target: &str) -> Cow<'_, str> {
    if !target.contains('%') {
        return Cow::Borrowed(target);
    }
    let mut out = target.to_owned();
    for (raw, escaped) in TARGET_ESCAPE_PAIRS.iter().rev() {
        out = out.replace(escaped, raw);
    }
    Cow::Owned(out)
}

/// `target` with `%`, `)`, `#` and `|` escaped (`escapeBlockRefTarget`).
pub(crate) fn escape_block_ref_target(target: &str) -> String {
    let mut out = target.to_owned();
    for (raw, escaped) in TARGET_ESCAPE_PAIRS {
        out = out.replace(raw, escaped);
    }
    out
}

/// How a rename writes `name` as a block reference's target: as it is when it holds none of
/// `)`, `#`, `|` and reads back as itself (`unescape_block_ref_target`), so a note named
/// `50% off` keeps the spelling a person types; escaped otherwise, which every reader of a
/// block reference — the index and the editor — reads back as `name`.
pub(crate) fn spell_block_ref_target(name: &str) -> Cow<'_, str> {
    if !name.contains([')', '#', '|']) && unescape_block_ref_target(name) == name {
        Cow::Borrowed(name)
    } else {
        Cow::Owned(escape_block_ref_target(name))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct Case {
        raw: String,
        escaped: String,
        why: String,
    }

    #[derive(serde::Deserialize)]
    struct Fixture {
        pairs: Vec<(String, String)>,
        cases: Vec<Case>,
        unescape_only: Vec<Case>,
    }

    fn fixture() -> Fixture {
        serde_json::from_str(include_str!("fixtures/block-ref-target-escape.json")).unwrap()
    }

    #[test]
    fn the_escape_agrees_with_the_fixture_the_frontend_reads() {
        // What fails this: unescaping `%25` first — `a%2529b` reads as `a)b`; escaping `%`
        // last — `50% off` round-trips but `BERT (2019)` is written `BERT (2019%2529`.
        let fixture = fixture();
        let pairs: Vec<(String, String)> = TARGET_ESCAPE_PAIRS
            .iter()
            .map(|(raw, escaped)| (raw.to_string(), escaped.to_string()))
            .collect();
        assert_eq!(pairs, fixture.pairs);
        for case in &fixture.cases {
            assert_eq!(
                escape_block_ref_target(&case.raw),
                case.escaped,
                "{}",
                case.why
            );
            assert_eq!(
                unescape_block_ref_target(&case.escaped),
                case.raw,
                "{}",
                case.why
            );
        }
        for case in &fixture.unescape_only {
            assert_eq!(
                unescape_block_ref_target(&case.escaped),
                case.raw,
                "{}",
                case.why
            );
        }
    }

    #[test]
    fn a_rename_spells_a_target_escaped_only_when_it_must() {
        // What fails this: escaping every target — `50% off` is written `50%25 off`; escaping
        // none — `BERT (2019)` ends the reference at its `)`.
        assert_eq!(spell_block_ref_target("50% off"), "50% off");
        assert_eq!(spell_block_ref_target("plain/note"), "plain/note");
        assert_eq!(spell_block_ref_target("BERT (2019)"), "BERT (2019%29");
        assert_eq!(spell_block_ref_target("a%29b"), "a%2529b");
        for name in ["50% off", "BERT (2019)", "a%29b", "C# notes|draft"] {
            assert_eq!(
                unescape_block_ref_target(&spell_block_ref_target(name)),
                name
            );
        }
    }
}
