// §61 Relative wikilink rewriting — the `[[./x]]` and `[[../x]]` targets that
// resolve into a renamed directory, respelled for the note that holds them.

use regex::Regex;
use std::sync::LazyLock;

use crate::md::literal::Literal;

// §61 Relative wikilink regex: [[./path...]] or [[../path...]]
static RELATIVE_WIKILINK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"\[\[(\.\.?/[^\]|#^\n\r]+)((?:#[^\]|^\n\r]+)?(?:\^[^\]|\n\r]+)?(?:\|[^\]\n\r]+)?)\]\]",
    )
    .unwrap()
});

/// §61 Rewrite the relative wikilinks of `content` that resolve into
/// `old_dir` so that they point into `new_dir` instead. `source_path` is the
/// note that holds `content`; a relative target resolves against its
/// directory.
pub fn rewrite_relative_wikilinks(
    content: &str,
    source_path: &str,
    old_dir: &str,
    new_dir: &str,
) -> String {
    rewrite_relative_wikilinks_with(content, source_path, old_dir, new_dir, cfg!(windows))
}

/// The rewrite proper, with the platform's separator rule as a parameter.
///
/// issue 595: `collect_md_files` spells paths with the OS separator — `\` on
/// Windows — and the webview's `old_dir` may spell either. A comparison that
/// split on `/` alone read `C:\vault\notes` as one component, so `..` popped
/// the whole path and no link ever resolved into the directory. Paths are
/// handled as components here (`/`, and `\` when `windows`), every component
/// compares without regard to ASCII case when `windows` (issue 675 — see
/// `same_component` for what that does and does not promise), and the
/// wikilink the rewrite writes is joined with `/`: it is markdown, not a
/// native path. The Rust tests run on Linux, so the Windows shape is tested
/// by passing `windows = true`, never behind `cfg(windows)`.
fn rewrite_relative_wikilinks_with(
    content: &str,
    source_path: &str,
    old_dir: &str,
    new_dir: &str,
    windows: bool,
) -> String {
    let mut source_dir = path_components(source_path, windows);
    source_dir.pop();
    let root = root_components(source_path, windows);
    let old = path_components(old_dir, windows);
    let new = path_components(new_dir, windows);

    // issue 620: a match inside a literal region is left as it is. The
    // literal set is read only once a link resolves into the old
    // directory — a namespace rename visits every note in the vault.
    let mut literal: Option<Literal> = None;
    RELATIVE_WIKILINK_RE
        .replace_all(content, |caps: &regex::Captures| {
            let whole = caps.get(0).unwrap();
            let rel_target = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let rest = caps.get(2).map(|m| m.as_str()).unwrap_or("");

            let resolved = resolve_components(&source_dir, root, rel_target, windows);
            let Some(inside) = strip_dir_prefix(&old, &resolved, windows) else {
                return caps[0].to_string();
            };
            if literal
                .get_or_insert_with(|| Literal::of(content))
                .overlaps(whole.range())
            {
                return caps[0].to_string();
            }
            let new_resolved: Vec<&str> = new.iter().chain(inside).copied().collect();
            let new_rel = relative_components(&source_dir, &new_resolved, windows);
            format!("[[{new_rel}{rest}]]")
        })
        .to_string()
}

/// The components of `path`: split on `/` — and on `\` when `windows` —
/// with empty parts and `.` dropped. A backslash in a Unix file name is a
/// character, not a separator.
fn path_components(path: &str, windows: bool) -> Vec<&str> {
    path.split(|c| c == '/' || (windows && c == '\\'))
        .filter(|part| !part.is_empty() && *part != ".")
        .collect()
}

/// How many leading components of `path` are its root and never step up: a
/// Windows drive (`C:`) is one, a UNC share (`\\server\share`) is two, a Unix
/// path has none to keep — `..` above `/` stays at `/`, which an empty
/// component list already is.
fn root_components(path: &str, windows: bool) -> usize {
    if !windows {
        return 0;
    }
    // The UNC form first: `\\C:\share` names a server called `C:`, not a
    // drive, so the share is its root.
    if path.starts_with(r"\\") || path.starts_with("//") {
        return 2;
    }
    match path_components(path, true).first() {
        Some(first) if is_drive(first) => 1,
        _ => 0,
    }
}

/// A wikilink target such as `./ai/prompt` or `../x`, resolved against the
/// directory `base`, whose first `root` components are the path's root: `..`
/// steps up, and never above the root — `C:\vault` + `../../x` is `C:\x`, as
/// it is to Windows.
fn resolve_components<'a>(
    base: &[&'a str],
    root: usize,
    relative: &'a str,
    windows: bool,
) -> Vec<&'a str> {
    let mut resolved = base.to_vec();
    for part in path_components(relative, windows) {
        if part == ".." {
            if resolved.len() > root {
                resolved.pop();
            }
        } else {
            resolved.push(part);
        }
    }
    resolved
}

/// Do two components name the same entry? Equal bytes — or, on Windows, the
/// same but for ASCII case. Only the drive letter was folded here until
/// issue 675, and Windows by default folds the rest too: a link or a note
/// path spelled `C:\VAULT\a\NS` named the same directory as `C:\vault\a\ns`
/// to the filesystem and a different one to this comparison, so a namespace
/// rename left the link pointing at a directory that no longer exists —
/// silently, because `commit_namespace_rename` reports nothing for a file
/// whose content it did not change.
///
/// ‼️ ASCII only, which is NARROWER than Windows, not equal to it: its fold
/// covers non-ASCII letters too, so `ÉCOLE` and `école` still do not match
/// here and a rename across that pair keeps the silent break this issue is
/// about. That is deliberate, because the two errors do not cost the same.
/// Folding too little leaves a link exactly as the user wrote it — the
/// behaviour of every release so far. Folding too much rewrites a link to
/// name a DIFFERENT directory, which is the failure this whole area exists
/// to prevent. `to_lowercase` folds more (measured: it equates `É` and `é`)
/// but it is Unicode's table, not the filesystem's, so adopting it would
/// widen the match on a rule nothing here can check. The frontend made the
/// same choice for the same reason (`foldAsciiCase`, `isUnderRoot`, issue
/// 631). Widening this needs a source for what Windows actually folds.
///
/// ‼️ `windows` here means "the platform folds ASCII case on every path
/// component", which is what Windows does by default and not what it can be
/// told to do: a directory carrying the per-directory case-sensitivity flag
/// (Windows 10+, for WSL) holds `ns` and `NS` at once, and this comparison
/// calls them one — a link into such a sibling was left alone before issue
/// 675 and is rewritten into the renamed directory after it. Narrowing that
/// needs an answer from the filesystem, which a pure function over two
/// strings cannot ask for.
fn same_component(a: &str, b: &str, windows: bool) -> bool {
    a == b || (windows && a.eq_ignore_ascii_case(b))
}

fn is_drive(part: &str) -> bool {
    let bytes = part.as_bytes();
    bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

/// What of `path` lies under the directory `dir`: the components after
/// `dir`'s — empty when `path` IS the directory — or None when it is not
/// under it. Component-wise, so `ns` does not claim `ns-old`.
fn strip_dir_prefix<'a>(dir: &[&str], path: &'a [&'a str], windows: bool) -> Option<&'a [&'a str]> {
    if path.len() < dir.len() {
        return None;
    }
    let under = dir
        .iter()
        .zip(path)
        .all(|(d, p)| same_component(d, p, windows));
    under.then(|| &path[dir.len()..])
}

/// The relative wikilink target that leads from the directory `source_dir`
/// to `target`: `./` when the target lies under it, else `../` per step up,
/// then the rest — joined with `/`, whatever the platform.
fn relative_components(source_dir: &[&str], target: &[&str], windows: bool) -> String {
    let common = source_dir
        .iter()
        .zip(target)
        .take_while(|(a, b)| same_component(a, b, windows))
        .count();
    let ups = source_dir.len() - common;
    let mut result = String::new();
    if ups == 0 {
        result.push_str("./");
    } else {
        for _ in 0..ups {
            result.push_str("../");
        }
    }
    result.push_str(&target[common..].join("/"));
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    // §61 rewrite_relative_wikilinks tests
    #[test]
    fn test_rewrite_relative_wikilinks() {
        // From notes/meeting.md: [[./ai/prompt]] → [[./ml/prompt]]
        let content = "See [[./ai/prompt]] for details.";
        let result = rewrite_relative_wikilinks(
            content,
            "/vault/notes/meeting.md",
            "/vault/notes/ai",
            "/vault/notes/ml",
        );
        assert_eq!(result, "See [[./ml/prompt]] for details.");

        // With heading: [[./ai/prompt#intro]] → [[./ml/prompt#intro]]
        let content = "See [[./ai/prompt#intro]] here.";
        let result = rewrite_relative_wikilinks(
            content,
            "/vault/notes/meeting.md",
            "/vault/notes/ai",
            "/vault/notes/ml",
        );
        assert_eq!(result, "See [[./ml/prompt#intro]] here.");

        // Non-matching relative link is unchanged
        let content = "See [[./other/file]] here.";
        let result = rewrite_relative_wikilinks(
            content,
            "/vault/notes/meeting.md",
            "/vault/notes/ai",
            "/vault/notes/ml",
        );
        assert_eq!(result, "See [[./other/file]] here.");

        // Global wikilinks are unchanged
        let content = "See [[prompt]] here.";
        let result = rewrite_relative_wikilinks(
            content,
            "/vault/notes/meeting.md",
            "/vault/notes/ai",
            "/vault/notes/ml",
        );
        assert_eq!(result, "See [[prompt]] here.");

        // From deeper path: [[../ai/models]] → [[../ml/models]]
        let content = "Link [[../ai/models]] from sub.";
        let result = rewrite_relative_wikilinks(
            content,
            "/vault/notes/sub/file.md",
            "/vault/notes/ai",
            "/vault/notes/ml",
        );
        assert_eq!(result, "Link [[../ml/models]] from sub.");
    }

    #[test]
    fn a_relative_wikilink_rewrite_skips_code() {
        let content = "[[../old/x]] `[[../old/x]]`\n```\n[[../old/x]]\n```\n";
        assert_eq!(
            rewrite_relative_wikilinks(content, "/v/a/note.md", "/v/old", "/v/new"),
            "[[../new/x]] `[[../old/x]]`\n```\n[[../old/x]]\n```\n"
        );
    }

    /// issue 595 — Windows spells the note's path and the directories with
    /// `\`; the rewrite compares components and writes `/` into the link.
    /// Tested with `windows = true` because the Rust tests run on Linux.
    #[test]
    fn a_relative_wikilink_rewrite_reads_windows_paths_as_components() {
        let rewrite = |content: &str, source: &str, old: &str, new: &str| {
            rewrite_relative_wikilinks_with(content, source, old, new, true)
        };
        // Into the directory, through `./` and `../`; a sibling that merely
        // shares the prefix (`ns-old`) and a global link are left alone.
        assert_eq!(
            rewrite(
                "[[./ns/c]] [[../a/ns/d#h|D]] [[./ns-old/e]] [[ns/f]]",
                r"C:\vault\a\note.md",
                r"C:\vault\a\ns",
                r"C:\vault\a\ns2",
            ),
            "[[./ns2/c]] [[./ns2/d#h|D]] [[./ns-old/e]] [[ns/f]]"
        );
        // The directory itself, and a link from a deeper note that steps up;
        // `./ns` from that note names `deep/ns`, not the directory, and stays.
        assert_eq!(
            rewrite(
                "[[../../ns]] [[../../ns/g]] [[./ns]]",
                r"C:\vault\a\sub\deep\note.md",
                r"C:\vault\a\ns",
                r"C:\vault\a\ns2",
            ),
            "[[../../ns2]] [[../../ns2/g]] [[./ns]]"
        );
        // Too many `..` stop at the drive, as they do to Windows: the link
        // still resolves into the directory and is rewritten. And on a UNC
        // share the root is the share.
        assert_eq!(
            rewrite(
                "[[../../vault/ns/x#h|X]]",
                r"C:\vault\note.md",
                r"C:\vault\ns",
                r"C:\vault\ns2",
            ),
            "[[./ns2/x#h|X]]"
        );
        assert_eq!(
            rewrite(
                "[[../../../vault/ns/x]]",
                r"\\server\share\vault\note.md",
                r"\\server\share\vault\ns",
                r"\\server\share\vault\ns2",
            ),
            "[[./ns2/x]]"
        );
        // Mixed separators and a drive letter in the other case name the
        // same directory, as they do to std::path on Windows.
        assert_eq!(
            rewrite(
                "[[./ns/c]]",
                r"c:\vault/a\note.md",
                "C:/vault/a/ns",
                r"C:\vault\a\ns2",
            ),
            "[[./ns2/c]]"
        );
        // Without the Windows rule a backslash is a character of the name:
        // `ns\c` is one component and does not lie under `ns`.
        assert_eq!(
            rewrite_relative_wikilinks_with(
                r"[[./ns\c]] [[./ns/c]]",
                "/v/a/note.md",
                "/v/a/ns",
                "/v/a/ns2",
                false,
            ),
            r"[[./ns\c]] [[./ns2/c]]"
        );
    }

    /// issue 675 — a Windows filesystem folds case on every path component.
    /// A link or a note path spelled in another case named the same directory
    /// to the filesystem, and a different one to this rewrite, so a namespace
    /// rename left the link behind. `commit_namespace_rename` treats content
    /// it did not change as nothing to report, so the break was silent.
    #[test]
    fn a_windows_rename_follows_a_link_spelled_in_another_case() {
        let rewrite = |content: &str, source: &str, old: &str, new: &str| {
            rewrite_relative_wikilinks_with(content, source, old, new, true)
        };
        // The LINK spells the directory in another case. The all-caps sibling
        // stays: folding the comparison did not make it a prefix test.
        // What fails this: restoring `first && is_drive(a) && is_drive(b)` in
        // `same_component` — the link stays `[[./NS/c]]` (measured).
        assert_eq!(
            rewrite(
                "[[./NS/c]] [[./NS-OLD/e]]",
                r"C:\vault\a\note.md",
                r"C:\vault\a\ns",
                r"C:\vault\a\ns2",
            ),
            "[[./ns2/c]] [[./NS-OLD/e]]"
        );
        // Mixed case on BOTH sides of the comparison — the shape a fold
        // restricted to uniformly cased components refuses.
        // What fails this: `windows && uniform_case && a.eq_ignore_ascii_case(b)`
        // for any `uniform_case` test — the link stays `[[./nS/c]]` (measured;
        // that mutant reddens the UNC assertion and the unit ones too).
        assert_eq!(
            rewrite(
                "[[./nS/c]]",
                r"C:\VaUlT\a\note.md",
                r"C:\vAuLt\a\Ns",
                r"C:\vault\a\ns2",
            ),
            "[[./ns2/c]]"
        );
        // The NOTE path spells a parent in another case, so BOTH comparisons
        // must fold: `strip_dir_prefix` to see the link as one that points
        // into the directory at all, and `relative_components` to count that
        // parent as shared.
        // What fails this: folding in `strip_dir_prefix` alone, which writes
        // `[[../../vault/a/ns2/c]]` — correct, and a spelling churn nobody
        // asked for (measured).
        assert_eq!(
            rewrite(
                "[[./ns/c]]",
                r"C:\VAULT\a\note.md",
                r"C:\vault\a\ns",
                r"C:\vault\a\ns2",
            ),
            "[[./ns2/c]]"
        );
    }

    /// issue 675 — the fold is the platform's to define and ours to bound:
    /// off on Unix, and ASCII-only on Windows, which is less than Windows
    /// folds (see `same_component` for why less, not more).
    #[test]
    fn the_case_fold_is_windows_only_and_ascii_only() {
        // Unix tells `NS` and `ns` apart, so the link names a directory the
        // rename did not touch.
        // What fails this: dropping the `windows &&` guard.
        assert_eq!(
            rewrite_relative_wikilinks_with(
                "[[./NS/c]]",
                "/v/a/note.md",
                "/v/a/ns",
                "/v/a/ns2",
                false,
            ),
            "[[./NS/c]]"
        );
        // A UNC server and share fold as any other component does now; the
        // drive-only comparison left this link alone (measured, both ways).
        // What fails this: restoring the `is_drive(a) && is_drive(b)` gate.
        assert_eq!(
            rewrite_relative_wikilinks_with(
                "[[./ns/c]]",
                r"\\SERVER\Share\a\note.md",
                r"\\server\share\a\ns",
                r"\\server\share\a\ns2",
                true,
            ),
            "[[./ns2/c]]"
        );
        // The ASCII bound, pinned as the limitation it is: this link is one
        // Windows would follow and we do not. Changing it is a decision
        // about what Windows folds, not a refactor.
        // What fails this: comparing `a.to_lowercase() == b.to_lowercase()`,
        // which equates `É` and `é` and rewrites the link to `[[./ns2/c]]`.
        assert_eq!(
            rewrite_relative_wikilinks_with(
                "[[./école/c]]",
                r"C:\vault\a\note.md",
                r"C:\vault\a\ÉCOLE",
                r"C:\vault\a\ns2",
                true,
            ),
            "[[./école/c]]"
        );
    }

    #[test]
    fn windows_paths_resolve_and_compare_as_components() {
        assert_eq!(
            path_components(r"C:\vault\notes/ai", true),
            ["C:", "vault", "notes", "ai"]
        );
        assert_eq!(path_components(r"/v/my\dir", false), ["v", r"my\dir"]);
        assert_eq!(
            resolve_components(&["C:", "vault", "notes"], 1, r"..\x/./y", true),
            ["C:", "vault", "x", "y"]
        );
        assert_eq!(resolve_components(&["v"], 0, "../../up", false), ["up"]);
        // `..` never steps above the root: the drive, or the UNC share.
        assert_eq!(
            resolve_components(&["C:", "vault"], 1, "../../../x", true),
            ["C:", "x"]
        );
        assert_eq!(
            resolve_components(&["server", "share", "v"], 2, "../../x", true),
            ["server", "share", "x"]
        );
        assert_eq!(root_components(r"C:\vault\note.md", true), 1);
        assert_eq!(root_components(r"\\server\share\note.md", true), 2);
        assert_eq!(root_components("//server/share/note.md", true), 2);
        // A server that happens to be spelled like a drive is still a share.
        assert_eq!(root_components(r"\\C:\share\note.md", true), 2);
        assert_eq!(root_components(r"\vault\note.md", true), 0);
        // A drive-relative path (`C:note.md`) names no absolute root here.
        assert_eq!(root_components("C:note.md", true), 0);
        assert_eq!(root_components(r"C:\", true), 1);
        assert_eq!(root_components("/v/note.md", false), 0);
        assert_eq!(root_components("//v/note.md", false), 0);
        assert_eq!(
            strip_dir_prefix(&["c:", "v", "ns"], &["C:", "v", "ns", "x"], true),
            Some(&["x"][..])
        );
        assert_eq!(
            strip_dir_prefix(&["c:", "v", "ns"], &["C:", "v", "ns", "x"], false),
            None
        );
        assert_eq!(
            strip_dir_prefix(&["v", "ns"], &["v", "ns-old", "x"], true),
            None
        );
        assert_eq!(
            relative_components(&["v", "notes"], &["v", "notes", "ml", "p"], false),
            "./ml/p"
        );
        assert_eq!(
            relative_components(&["v", "notes", "sub"], &["v", "ml"], false),
            "../../ml"
        );
        // issue 675: every component folds on Windows, not the drive alone —
        // and the fold does not turn the comparison into a prefix test.
        assert_eq!(
            strip_dir_prefix(&["c:", "v", "NS"], &["C:", "v", "ns", "x"], true),
            Some(&["x"][..])
        );
        assert_eq!(
            strip_dir_prefix(&["c:", "v", "NS"], &["C:", "v", "ns", "x"], false),
            None
        );
        assert_eq!(
            strip_dir_prefix(&["v", "NS"], &["v", "ns-old", "x"], true),
            None
        );
        // The note's own directory folds too, or the link climbs out of
        // `VAULT` and back down into `vault` instead of staying at `./`.
        assert_eq!(
            relative_components(
                &["C:", "VAULT", "a"],
                &["C:", "vault", "a", "ns2", "c"],
                true
            ),
            "./ns2/c"
        );
        // Mixed case on both sides — the shape a fold restricted to
        // uniformly cased components refuses (measured: that mutant reddens
        // this assertion, the rename test and the UNC one).
        assert!(same_component("VaUlT", "vAuLt", true));
        assert!(!same_component("VaUlT", "vAuLt", false));
        // The fold is case, not similarity: two drives stay two. And the
        // ASCII bound holds — `É`/`é` stay two, which is narrower than
        // Windows on purpose (`same_component`).
        assert!(!same_component("C:", "D:", true));
        assert!(!same_component("É", "é", true));
    }
}
