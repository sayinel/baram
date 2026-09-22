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
/// handled as components here (`/`, and `\` when `windows`), a leading drive
/// letter compares without regard to case as `std::path` does, and the
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

/// Do two components name the same entry? Equal bytes — or, as the first
/// component of a Windows path, the same drive letter in either case, the
/// one exception `std::path` makes to case-sensitive comparison.
fn same_component(a: &str, b: &str, first: bool, windows: bool) -> bool {
    a == b || (first && windows && is_drive(a) && is_drive(b) && a.eq_ignore_ascii_case(b))
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
        .enumerate()
        .all(|(k, (d, p))| same_component(d, p, k == 0, windows));
    under.then(|| &path[dir.len()..])
}

/// The relative wikilink target that leads from the directory `source_dir`
/// to `target`: `./` when the target lies under it, else `../` per step up,
/// then the rest — joined with `/`, whatever the platform.
fn relative_components(source_dir: &[&str], target: &[&str], windows: bool) -> String {
    let common = source_dir
        .iter()
        .zip(target)
        .enumerate()
        .take_while(|(k, (a, b))| same_component(a, b, *k == 0, windows))
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
    }
}
