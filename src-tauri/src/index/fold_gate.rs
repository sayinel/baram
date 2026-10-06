//! §390 (spec 0069 D6) The structural gate on name comparisons in the link
//! index. Names and link targets meet only through `normalizer::fold_name`,
//! which folds Unicode normalization as well as case; a comparison written
//! with a case fold of its own skips the normalization and splits a name
//! stored decomposed from the same name typed. This scans the production
//! lines of `src/index/**/*.rs` for such folds, and every one it finds must
//! be on `ALLOWED`, each entry found exactly once.
//!
//! What it reads: every `.rs` file under `src/index`, less comment lines
//! (`//`, `///`, `//!` first on the line), the body of every inline
//! `#[cfg(test)]` module (from its `mod … {` line to the `}` at that line's
//! indentation — rustfmt's layout, which `cargo fmt --check` holds), and
//! every file or directory a `#[cfg(test)] mod …;` declares: `service/tests/`
//! and this file among them. A test-only item that is not a module
//! (`#[cfg(test)] fn`) is read.
//!
//! What it cannot see (spec 0069 D6): a name compared byte for byte (`==`,
//! `starts_with`, a `HashMap` lookup) with no fold at all, a fold spelled
//! with none of `TOKENS`, and a widened `same_component` that composes
//! before comparing. A trailing comment on a code line is read as code: a
//! token there fails the gate, and the comment is to be reworded.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// What a case fold that bypasses `fold_name` is written with.
const TOKENS: &[&str] = &[
    "to_lowercase",
    "to_ascii_lowercase",
    "eq_ignore_ascii_case",
    "(?i)",
    "case_insensitive",
];

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
         Windows); every caller wants that, the relative-link rewrite's \
         old-directory comparison aside, and widening it lets a folder rename \
         rewrite a link into another directory (spec 0069 §3.2)",
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
/// `#[cfg(test)] mod …;` it declares.
fn scan_text(file: &str, text: &str) -> (Vec<Line>, Vec<String>) {
    let mut lines = Vec::new();
    let mut declared = Vec::new();
    let mut after_cfg_test = false;
    let mut closing: Option<String> = None;
    for (i, line) in text.lines().enumerate() {
        if let Some(close) = &closing {
            if line == close {
                closing = None;
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
                    let indent = &line[..line.len() - trimmed.len()];
                    closing = Some(format!("{indent}}}"));
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
    (lines, declared)
}

/// Every production line under `src/index`, and the files read. A file a
/// `#[cfg(test)] mod name;` declares is skipped with everything under
/// `name/`: beside a `mod.rs` it is `name.rs` or `name/` in that directory,
/// beside any other file `x.rs` it is under `x/`.
fn production_lines() -> (Vec<Line>, BTreeSet<String>) {
    let mut files = Vec::new();
    rust_files(&index_dir(), &mut files);
    let mut skipped: Vec<PathBuf> = Vec::new();
    for path in &files {
        let (_, declared) = scan_text(&relative(path), &std::fs::read_to_string(path).unwrap());
        let base = if path.file_name().is_some_and(|n| n == "mod.rs") {
            path.parent().unwrap().to_path_buf()
        } else {
            path.with_extension("")
        };
        for name in declared {
            skipped.push(base.join(format!("{name}.rs")));
            skipped.push(base.join(&name));
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

    let hits: Vec<&Line> = lines
        .iter()
        .filter(|l| TOKENS.iter().any(|t| l.text.contains(t)))
        .collect();
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
