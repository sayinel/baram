// §29 Path normalizer helpers — wikilink target and file path normalization.
// §390 Every name and link-target key goes through `fold_name` — NFC,
// lowercase, NFC — so a name stored decomposed (NFD) meets the same name
// typed composed (NFC). Only keys are folded: the paths the index holds and
// reports keep their disk spelling (the graph's placeholder node for a link
// that resolves to nothing is the one exception — spec 0069 D1), and a
// rename writes link text in NFC (D7), never folded.

use icu_normalizer::ComposingNormalizerBorrowed;
use std::borrow::Cow;
use std::path::Path;

/// `s` in Unicode Normalization Form C, borrowed back when it already is —
/// the `icu_normalizer` fast path, so text typed on a keyboard costs no copy.
pub(crate) fn nfc(s: &str) -> Cow<'_, str> {
    ComposingNormalizerBorrowed::new_nfc().normalize(s)
}

/// §390 The key a name or a link target is compared by: NFC, then
/// lowercase, then NFC again (spec 0069 D2). The last NFC composes what
/// lowercasing leaves apart: `J̌` has no precomposed capital, lowercases to
/// `j` + caron, and only then composes to the `ǰ` a name typed in lowercase
/// holds. The first NFC changed no key in the search `name-fold.json`'s
/// contract records; it is kept so that lowercase reads one form. The cases
/// are `md/fixtures/name-fold.json`, which this module's tests read and the
/// frontend's `foldName` tests are to read too (the frontend PR). Strip a
/// note extension and split a path BEFORE folding, and compare folded
/// strings of one shape only: Greek capital sigma folds by what
/// follows it (`ΑΣ` → `ας`, `ΑΣ.md` → `ασ.md`).
pub(crate) fn fold_name(s: &str) -> String {
    if s.is_ascii() {
        // NFC leaves ASCII as it is, and an ASCII letter's lowercase is its
        // ASCII lowercase: the same key without the two passes.
        return s.to_ascii_lowercase();
    }
    let lower = nfc(s).to_lowercase();
    if let Cow::Owned(composed) = nfc(&lower) {
        return composed;
    }
    lower
}

/// Normalize a wikilink target to a comparable key: trimmed, folded
/// (`fold_name`), and without one trailing note extension — `.md`, else
/// `.markdown`, never both (`x.markdown.md` → `x.markdown`).
pub(crate) fn normalize_target(target: &str) -> String {
    strip_extension_and_fold(target.trim())
}

/// `name` without one trailing `.md` or `.markdown`, folded (`fold_name`).
pub(crate) fn strip_extension_and_fold(name: &str) -> String {
    fold_name(strip_note_extension(name))
}

/// `name` without one trailing `.md` or `.markdown`, its case kept — the
/// spelling of a path link's last component (`strip_extension_and_fold`
/// without the fold), so the link reads back as the file's path key.
pub(crate) fn strip_note_extension(name: &str) -> &str {
    name.strip_suffix(".md")
        .or_else(|| name.strip_suffix(".markdown"))
        .unwrap_or(name)
}

/// The key a FILE at this path is filed under — its stem through `file_key`,
/// e.g. "/vault/notes/architecture.md" → "architecture". Read `file_key`
/// before reaching for this or for `normalize_target`: they agree on a note
/// and part ways on a file whose stem itself ends in `.md`, and picking the
/// link rule for a file is how a rename once claimed another note's links.
pub(crate) fn normalize_file_path(path: &str) -> String {
    let file_name = Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    file_key(&file_name)
}

/// The key a FILE is filed under, from its stem: folded by `fold_name`, nothing
/// stripped. For a note it is what its links normalize to (`[[Note]]`,
/// `[[note.md]]` → `note`); for a file whose stem itself ends in `.md`
/// (`diagram.md.txt` → `diagram.md`) it is not — `normalize_target` would
/// strip that `.md` and hand back the NOTE `diagram.md`'s key. A rename that
/// asks which links name a file must ask by this key, or it claims the
/// note's links.
pub(crate) fn file_key(stem: &str) -> String {
    fold_name(stem)
}

/// Resolve a wikilink target to a possible file path
pub(crate) fn resolve_target(root: &str, normalized_target: &str) -> String {
    format!("{}/{}.md", root, normalized_target)
}

/// Extract the leading timestamp-id run (12–14 digits) from a filename stem.
/// The id is the run of leading ASCII digits before the first space (or end),
/// accepted only when its length is 12–14.
pub(crate) fn extract_id_from_stem(stem: &str) -> Option<String> {
    let head = stem.split(' ').next().unwrap_or(stem);
    if head.len() >= 12 && head.len() <= 14 && head.bytes().all(|b| b.is_ascii_digit()) {
        Some(head.to_string())
    } else {
        None
    }
}

/// True iff the whole normalized target is a bare 12–14 digit id (e.g. `[[202607051530]]`).
pub(crate) fn is_id_target(target_normalized: &str) -> bool {
    target_normalized.len() >= 12
        && target_normalized.len() <= 14
        && target_normalized.bytes().all(|b| b.is_ascii_digit())
}

/// A name as typed (NFC) and as some tools store it on disk (NFD), asserted
/// to differ. Both are derived here, never taken from the literal as
/// written: an editor or a copy may compose or decompose a literal on its
/// way into a source file (spec 0069 §7).
#[cfg(test)]
pub(crate) fn both_forms(s: &str) -> (String, String) {
    let typed = nfc(s).into_owned();
    let stored = icu_normalizer::DecomposingNormalizerBorrowed::new_nfd()
        .normalize(s)
        .into_owned();
    assert_ne!(typed, stored, "{s:?} is spelled the same in both forms");
    (typed, stored)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_target() {
        assert_eq!(normalize_target("Architecture"), "architecture");
        assert_eq!(normalize_target("notes.md"), "notes");
        assert_eq!(normalize_target("  spaces  "), "spaces");
        // What fails this: dropping the `.markdown` arm of `normalize_target`.
        assert_eq!(normalize_target("Note.markdown"), "note");
        // Only one suffix comes off, `.md` tried first.
        assert_eq!(normalize_target("x.markdown.md"), "x.markdown");
        // §390 A name stored decomposed folds to the key of the one typed.
        let (typed, stored) = both_forms("회의록");
        assert_eq!(normalize_target(&format!("{stored}.md")), typed);
        assert_eq!(file_key(&stored), typed);
    }

    #[test]
    fn test_normalize_file_path() {
        assert_eq!(
            normalize_file_path("/vault/notes/architecture.md"),
            "architecture"
        );
        assert_eq!(normalize_file_path("/single.md"), "single");
        assert_eq!(normalize_file_path("relative.md"), "relative");
    }

    #[test]
    fn test_extract_id_from_stem() {
        assert_eq!(
            extract_id_from_stem("202607051530 원자적 노트"),
            Some("202607051530".to_string())
        );
        assert_eq!(
            extract_id_from_stem("202607051530"),
            Some("202607051530".to_string())
        );
        assert_eq!(
            extract_id_from_stem("20260705153012 note"),
            Some("20260705153012".to_string())
        );
        assert_eq!(extract_id_from_stem("architecture"), None);
        assert_eq!(extract_id_from_stem("2026 draft"), None); // too short
        assert_eq!(extract_id_from_stem(""), None);
    }

    #[test]
    fn test_is_id_target() {
        assert!(is_id_target("202607051530"));
        assert!(is_id_target("20260705153012"));
        assert!(!is_id_target("202607051530 원자적 노트")); // has trailing text
        assert!(!is_id_target("architecture"));
        assert!(!is_id_target("2026")); // too short
    }

    /// One case of `md/fixtures/name-fold.json` — the frontend's `foldName`
    /// test is to read the same file (the frontend PR, spec 0069 D5).
    #[derive(serde::Deserialize)]
    struct FoldCase {
        input: String,
        folded: String,
        checks: Vec<String>,
        why: String,
    }

    #[derive(serde::Deserialize)]
    struct FoldFixture {
        cases: Vec<FoldCase>,
    }

    #[test]
    fn fold_name_agrees_with_the_shared_fixture() {
        // §390 (spec 0069 D2, D5). Each case's `checks` are asserted too, so
        // the fixture cannot lose what it is there to catch, and every kind
        // of check must still be carried by some case.
        // What fails this: `fold_name` lowercasing alone — the `input-not-nfc`
        // cases keep their decomposed letters; dropping the last NFC — the
        // `final-nfc` cases stay apart (`j` + caron is not `ǰ`).
        let fixture: FoldFixture =
            serde_json::from_str(include_str!("../md/fixtures/name-fold.json")).unwrap();
        let mut kinds = std::collections::BTreeSet::new();
        for case in &fixture.cases {
            assert_eq!(fold_name(&case.input), case.folded, "{}", case.why);
            for check in &case.checks {
                kinds.insert(check.as_str());
                match check.as_str() {
                    "input-not-nfc" => assert_ne!(nfc(&case.input), case.input, "{}", case.why),
                    "final-nfc" => {
                        assert_ne!(nfc(&case.input).to_lowercase(), case.folded, "{}", case.why)
                    }
                    other => panic!("unknown check {other:?}: {}", case.why),
                }
            }
        }
        assert_eq!(
            kinds.into_iter().collect::<Vec<_>>(),
            ["final-nfc", "input-not-nfc"]
        );
    }

    #[test]
    fn the_ascii_shortcut_folds_as_the_full_fold_does() {
        // What fails this: an ASCII shortcut that is not ASCII lowercase
        // (`to_ascii_uppercase`, or none of `s` lowered) — some byte below
        // differs from NFC, lowercase, NFC.
        for byte in 0u8..=0x7f {
            let s = format!("A{}z", byte as char);
            assert_eq!(
                fold_name(&s),
                nfc(&nfc(&s).to_lowercase()).into_owned(),
                "{byte:#x}"
            );
        }
    }
}
