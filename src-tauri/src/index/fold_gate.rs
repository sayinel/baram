//! §390 (spec 0069 D6) The structural gate on name comparisons in the link
//! index. Names and link targets are to meet through `normalizer::fold_name`,
//! which folds Unicode normalization as well as case; the folds left outside
//! it are on `ALLOWED`, each with its reason. A comparison written with a
//! case fold of its own skips the normalization and splits a name stored
//! decomposed from the same name typed. This scans the production lines of
//! `src/index/**/*.rs` for such folds, and every one it finds must be on
//! `ALLOWED`, each entry found exactly once.
//!
//! What it reads: every `.rs` file under `src/index`, less comment lines
//! (`//`, `///`, `//!` first on the line), less the body of every inline
//! `#[cfg(test)]` module, and less every file or directory a
//! `#[cfg(test)] mod …;` declares: `service/tests/` and this file among them.
//! A test-only item that is not a module (`#[cfg(test)] fn`) is read. An
//! inline module is skipped from its `mod … {` line to the `}` alone at that
//! line's indentation. A non-blank line inside it at or left of that
//! indentation which is not that `}` (`} // mod tests`), and a module the file
//! never closes, fail the scan instead of hiding the code that follows.
//!
//! What counts as a fold, one line at a time (`folds_case`): a name in
//! `TOKENS`, or an inline regex flag group that turns `i` on (`CASE_FLAG`:
//! `(?i)`, `(?im)`, `(?xi)`, `(?i:…)`, `(?i-m)`).
//!
//! What it cannot see (spec 0069 D6): a name compared byte for byte (`==`,
//! `starts_with`, a `HashMap` lookup) with no fold at all, a fold spelled
//! with none of `TOKENS` or `CASE_FLAG`, and a widened `same_component` that
//! composes before comparing. A trailing comment on a code line is read as
//! code: a token there fails the gate, and the comment is to be reworded.

use regex::Regex;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

/// The method and builder names a case fold that bypasses `fold_name` is
/// written with. A regex's inline flag group is `CASE_FLAG`'s.
const TOKENS: &[&str] = &[
    "to_lowercase",
    "to_ascii_lowercase",
    "to_uppercase",
    "to_ascii_uppercase",
    "make_ascii_lowercase",
    "make_ascii_uppercase",
    "eq_ignore_ascii_case",
    "case_insensitive",
];

/// An inline regex flag group that turns `i` (case-insensitive) on: letters
/// holding an `i`, then optionally `-` and the letters it turns off, closed by
/// `)` or `:`. It matches `(?i)`, `(?im)`, `(?mi)`, `(?xi)`, `(?i:a)` and
/// `(?i-m)`; it does not match `(?-i)`, `(?m)` or `(?x)`.
static CASE_FLAG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\(\?[A-Za-z]*i[A-Za-z]*(?:-[A-Za-z]*)?[:)]").unwrap());

/// `(file under src/index, text the line contains, why it may)`.
const ALLOWED: &[(&str, &str, &str)] = &[
    (
        "normalizer.rs",
        "return s.to_ascii_lowercase();",
        "fold_name's ASCII shortcut: NFC leaves ASCII as it is",
    ),
    (
        "normalizer.rs",
        "let lower = nfc(s).to_lowercase();",
        "fold_name itself",
    ),
    (
        "relative_links.rs",
        "a == b || (windows && a.eq_ignore_ascii_case(b))",
        "same_component compares components byte for byte (ASCII case on \
         Windows). Its callers outside the relative-link rewrite compare disk \
         spellings (spec 0069 §3.2), `filing_key`'s relative branch aside: it \
         hands `under_root` link-text components once `..` climbs above the \
         root, and keeps today's case boundary there. The rewrite reads past \
         normalization through a comparison of its own, which has a known hole \
         for directories whose paths differ only by normalization (siblings, \
         or same-named folders under such siblings; spec 0069 §8). Widening \
         same_component would give every caller that reading, and a folder \
         rename would rewrite a link into another directory",
    ),
    (
        "service/rename/destination.rs",
        "if a.eq_ignore_ascii_case(b) {",
        "same_name: a rename that changes ASCII case only (spec 0069 D8)",
    ),
    (
        "service/rename/destination.rs",
        "(Some(a), Some(b)) => nfc(a).eq_ignore_ascii_case(&nfc(b)),",
        "same_name: a rename that changes normalization, and ASCII case at most \
         (D8); non-ASCII case stays two names",
    ),
    (
        "extractor.rs",
        r#"Regex::new(r"(?i)^tags\s*:\s*\[([^\]]*)\]")"#,
        "the front-matter key `tags`, not a name",
    ),
    (
        "extractor.rs",
        r#"Regex::new(r"(?i)^tags\s*:\s*$")"#,
        "the front-matter key `tags`, not a name",
    ),
    (
        "extractor.rs",
        r#"let pattern = format!(r"(?i)\b{}\b", escaped);"#,
        "find_unlinked_mentions: the note's name in prose in any case, as \
         typed (NFC) and as stored",
    ),
];

/// A production line: its file under `src/index`, spelled with `/`, its
/// 1-based number, and its text.
struct Line {
    file: String,
    number: usize,
    text: String,
}

/// An inline `#[cfg(test)]` module being skipped: the line that ends it, its
/// indentation (the same as the `mod` line's), and the 1-based line it opened
/// on.
struct Skipping {
    close: String,
    indent: usize,
    opened: usize,
}

/// Whether `line` holds a case fold that bypasses `fold_name`.
fn folds_case(line: &str) -> bool {
    TOKENS.iter().any(|t| line.contains(t)) || CASE_FLAG.is_match(line)
}

fn index_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src/index")
}

/// `path` under `src/index`, its components joined with `/` on any host.
fn relative(path: &Path) -> String {
    path.strip_prefix(index_dir())
        .unwrap()
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

/// Every `.rs` file under `dir`, recursively, in name order.
fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

/// The module an item line declares, trimmed: `Some((name, inline))`, inline
/// when its body opens on this line.
fn module_of(item: &str) -> Option<(&str, bool)> {
    let item = ["pub(crate) ", "pub(super) ", "pub "]
        .iter()
        .find_map(|vis| item.strip_prefix(vis))
        .unwrap_or(item);
    let rest = item.strip_prefix("mod ")?;
    if let Some(name) = rest.strip_suffix(" {") {
        return Some((name, true));
    }
    rest.strip_suffix(';').map(|name| (name, false))
}

/// The lines of `text` (the file `file` under `src/index`) outside comment
/// lines and inline `#[cfg(test)]` modules, and the names of the
/// `#[cfg(test)] mod …;` it declares. Panics when an inline module is not
/// closed by the `}` alone at its indentation (see the module doc).
fn scan_text(file: &str, text: &str) -> (Vec<Line>, Vec<String>) {
    let mut lines = Vec::new();
    let mut declared = Vec::new();
    let mut after_cfg_test = false;
    let mut closing: Option<Skipping> = None;
    for (i, line) in text.lines().enumerate() {
        if let Some(skipping) = &closing {
            if line == skipping.close {
                closing = None;
            } else if !line.trim().is_empty()
                && line.len() - line.trim_start().len() <= skipping.indent
            {
                panic!(
                    "{file}:{}: this line is at or left of the indentation of the \
                     `#[cfg(test)]` module opened at {file}:{}, and is not the `}}` \
                     that closes it. The gate skips a test module to the `}}` alone \
                     at the module's own indentation, and would hide the code that \
                     follows: close the module on a line of its own, with no \
                     trailing comment.",
                    i + 1,
                    skipping.opened
                );
            }
            continue;
        }
        let trimmed = line.trim_start();
        if trimmed.starts_with("//") {
            continue;
        }
        if trimmed == "#[cfg(test)]" {
            after_cfg_test = true;
            continue;
        }
        if after_cfg_test {
            if trimmed.starts_with("#[") {
                continue;
            }
            after_cfg_test = false;
            match module_of(trimmed.trim_end()) {
                Some((_, true)) => {
                    let indent = line.len() - trimmed.len();
                    closing = Some(Skipping {
                        close: format!("{}}}", &line[..indent]),
                        indent,
                        opened: i + 1,
                    });
                    continue;
                }
                Some((name, false)) => {
                    declared.push(name.to_string());
                    continue;
                }
                None => {}
            }
        }
        lines.push(Line {
            file: file.to_string(),
            number: i + 1,
            text: line.to_string(),
        });
    }
    if let Some(skipping) = closing {
        panic!(
            "{file}:{}: the `#[cfg(test)]` module opened here is never closed by a \
             line of {:?}: the gate would skip the rest of the file.",
            skipping.opened, skipping.close
        );
    }
    (lines, declared)
}

/// Where the module `name`, declared by `#[cfg(test)] mod name;` in
/// `declaring_file`, lives: beside a `mod.rs` it is `name.rs` or `name/` in
/// that directory, beside any other file `x.rs` it is `x/name.rs` or
/// `x/name/`.
fn declared_paths(declaring_file: &Path, name: &str) -> [PathBuf; 2] {
    let base = if declaring_file.file_name().is_some_and(|n| n == "mod.rs") {
        declaring_file.parent().unwrap().to_path_buf()
    } else {
        declaring_file.with_extension("")
    };
    [base.join(format!("{name}.rs")), base.join(name)]
}

/// Every production line under `src/index`, and the files read. A file a
/// `#[cfg(test)] mod name;` declares is skipped with everything under
/// `name/` (`declared_paths`).
fn production_lines() -> (Vec<Line>, BTreeSet<String>) {
    let mut files = Vec::new();
    rust_files(&index_dir(), &mut files);
    let mut skipped: Vec<PathBuf> = Vec::new();
    for path in &files {
        let (_, declared) = scan_text(&relative(path), &std::fs::read_to_string(path).unwrap());
        for name in declared {
            skipped.extend(declared_paths(path, &name));
        }
    }
    let mut lines = Vec::new();
    let mut read = BTreeSet::new();
    for path in &files {
        if skipped.iter().any(|s| path.starts_with(s)) {
            continue;
        }
        let file = relative(path);
        let (found, _) = scan_text(&file, &std::fs::read_to_string(path).unwrap());
        lines.extend(found);
        read.insert(file);
    }
    (lines, read)
}

#[test]
fn no_name_comparison_in_the_index_folds_case_past_fold_name() {
    // What fails this: a scan that stops at the first `#[cfg(test)]` loses
    // `resolve_link`; one that does not skip declared files reads
    // `fold_gate.rs` and `service/tests/mod.rs`; one that reads inline test
    // modules reads normalizer's `test_normalize_target`; one that does not
    // recurse loses `another_entry_at`; a new unlisted fold is `unexpected`; a
    // second copy of an allowed line is "found 2 times".
    let (lines, read) = production_lines();
    // The scan reaches the code it guards and skips the tests. `resolve_link`
    // lies below a `#[cfg(test)] fn` in its file: a scan that stopped at the
    // first `#[cfg(test)]` would miss it.
    let reads = |file: &str, text: &str| {
        lines
            .iter()
            .any(|l| l.file == file && l.text.contains(text))
    };
    assert!(reads("resolve.rs", "fn resolve_link("));
    assert!(reads(
        "service/rename/destination.rs",
        "fn another_entry_at("
    ));
    for skipped in [
        "fold_gate.rs",
        "service/tests/mod.rs",
        "service/tests/boundary.rs",
    ] {
        assert!(!read.contains(skipped), "{skipped} was read");
    }
    assert!(
        !lines
            .iter()
            .any(|l| l.text.contains("fn test_normalize_target(")),
        "normalizer.rs's test module was read"
    );

    let hits: Vec<&Line> = lines.iter().filter(|l| folds_case(&l.text)).collect();
    let allowed = |l: &Line| {
        ALLOWED
            .iter()
            .position(|(file, text, _)| l.file == *file && l.text.contains(text))
    };
    let unexpected: Vec<String> = hits
        .iter()
        .filter(|l| allowed(l).is_none())
        .map(|l| format!("{}:{}: {}", l.file, l.number, l.text.trim()))
        .collect();
    assert!(
        unexpected.is_empty(),
        "§390: a name comparison folds case on its own, past `normalizer::fold_name` — \
         {unexpected:#?}\n\nCompare names and link targets by `fold_name` (or a key \
         function built on it), which folds Unicode normalization too: a case fold \
         alone keeps a name stored decomposed (NFD) apart from the same name typed \
         (NFC). If the comparison is not of a name — a front-matter key, two disk \
         spellings — add the line to ALLOWED with the reason."
    );
    let mut uses = vec![0usize; ALLOWED.len()];
    for l in &hits {
        if let Some(i) = allowed(l) {
            uses[i] += 1;
        }
    }
    let off: Vec<String> = ALLOWED
        .iter()
        .zip(&uses)
        .filter(|(_, n)| **n != 1)
        .map(|((file, text, _), n)| format!("{file}: {text:?} found {n} times"))
        .collect();
    assert!(
        off.is_empty(),
        "each allowed line is found exactly once — {off:#?}"
    );
}

#[test]
fn the_scan_reads_past_a_test_module_and_skips_its_body() {
    // What fails this: stopping at the first `#[cfg(test)]` — `helper` and
    // `after` are lost; reading the module — `inside` is read; closing at the
    // nested module's `}` — the line after it is read.
    let text = "fn before() {}\n#[cfg(test)]\npub(crate) fn helper() {}\n#[cfg(test)]\n\
                #[allow(dead_code)]\nmod tests {\n    fn inside() {}\n    mod nested {\n    }\n    \
                fn still_inside() {}\n}\n// fn commented() {}\nfn after() {}\n#[cfg(test)]\nmod elsewhere;\n";
    let (lines, declared) = scan_text("x.rs", text);
    let read: Vec<&str> = lines.iter().map(|l| l.text.as_str()).collect();
    assert_eq!(
        read,
        [
            "fn before() {}",
            "pub(crate) fn helper() {}",
            "fn after() {}"
        ]
    );
    assert_eq!(declared, ["elsewhere"]);
}

#[test]
#[should_panic(expected = "x.rs:4:")]
fn a_test_module_closed_by_a_commented_brace_fails_the_scan() {
    // What fails this: a scan that looks for the closing line only at the end
    // of the file — it fails there, naming line 2 where the module opened,
    // not line 4 where the brace was commented; one that never looks —
    // `prod` is hidden and nothing fails.
    let text = "#[cfg(test)]\nmod tests {\n    fn t() {}\n} // mod tests\n\
                fn prod(x: &str) -> String { x.to_lowercase() }\n";
    scan_text("x.rs", text);
}

#[test]
#[should_panic(expected = "x.rs:4:")]
fn a_commented_brace_does_not_close_the_skip_at_a_later_brace() {
    // What fails this: closing the skip at the next `}` alone at the module's
    // indentation — here the last line, which ends `prod`'s body — hides
    // `prod`, and the scan neither fails there nor reaches the end of the file
    // with the skip open.
    let text = "#[cfg(test)]\nmod tests {\n    fn t() {}\n} // mod tests\n\
                fn prod(x: &str) -> String {\n    x.to_lowercase()\n}\n";
    scan_text("x.rs", text);
}

#[test]
#[should_panic(expected = "x.rs:2:")]
fn a_test_module_the_file_never_closes_fails_the_scan() {
    // What fails this: ending the scan with the skip still open — the lines
    // after the module are read as none, and nothing fails.
    scan_text("x.rs", "#[cfg(test)]\nmod tests {\n    fn t() {}\n");
}

#[test]
fn a_fold_is_a_method_name_or_a_flag_group_that_turns_case_off_or_on() {
    // What fails this: reading the flag group as the substring `(?i)` misses
    // `(?im)`, `(?mi)`, `(?xi)` and `(?i:a)`; a pattern that lets `-` come
    // before the `i` hits `(?-i)`, which turns the fold off; dropping a name
    // from `TOKENS` loses its method.
    for fold in [
        "Regex::new(r\"(?i)tags\")",
        "Regex::new(r\"(?im)^tags\")",
        "Regex::new(r\"(?mi)^tags\")",
        "Regex::new(r\"(?xi) tags\")",
        "Regex::new(r\"(?i:a)b\")",
        "Regex::new(r\"(?i-m)^a\")",
        "x.to_lowercase()",
        "x.to_ascii_lowercase()",
        "x.to_uppercase()",
        "x.to_ascii_uppercase()",
        "x.eq_ignore_ascii_case(y)",
        "RegexBuilder::case_insensitive(true)",
        "s.make_ascii_lowercase()",
        "s.make_ascii_uppercase()",
    ] {
        assert!(folds_case(fold), "{fold} is a fold");
    }
    for other in [
        "Regex::new(r\"(?-i)a\")",
        "Regex::new(r\"(?m)^a\")",
        "Regex::new(r\"(?x) a\")",
        "Regex::new(r\"(?m-i)a\")",
        "Regex::new(r\"(?:a|b)\")",
        "fold_name(s)",
        "ascii_lowercase_table",
    ] {
        assert!(!folds_case(other), "{other} is not a fold");
    }
}

#[test]
fn a_declared_module_is_beside_mod_rs_or_under_the_declaring_file() {
    // What fails this: placing every declared module beside its declaring
    // file puts `resolve`'s `x` at `index/x.rs`, where the compiler does not
    // look; placing every one under the file's stem puts `mod.rs`'s `tests` at
    // `index/mod/tests.rs`.
    let dir = Path::new("/src/index");
    assert_eq!(
        declared_paths(&dir.join("mod.rs"), "tests"),
        [dir.join("tests.rs"), dir.join("tests")]
    );
    assert_eq!(
        declared_paths(&dir.join("resolve.rs"), "x"),
        [dir.join("resolve/x.rs"), dir.join("resolve/x")]
    );
}
