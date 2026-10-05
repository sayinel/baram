// §387 The commands. Each returns the envelope its `--json` form prints and writes
// nothing itself, so the same functions can back another front end (MCP — spec 0066 D9).

use super::app_config::AppConfig;
use super::error::{CliError, ErrorCode};
use super::output::{Envelope, Row, VaultInfo};
use super::paths;
use super::vault::{RootKind, Vault};
use crate::context::manager::resolve_canonical;
use crate::fs::FsError;
use crate::search::{SearchOptions, SearchResult};
use serde::Serialize;
use std::path::{Path, PathBuf};

pub(crate) fn vault_info(vault: &Vault) -> VaultInfo {
    VaultInfo {
        name: vault.name.clone(),
        path: vault.root.to_string_lossy().into_owned(),
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct VaultRow {
    pub name: String,
    pub path: String,
    pub alias: Option<String>,
    #[serde(rename = "type")]
    pub kind: &'static str,
    /// The vault this run resolved to.
    pub current: bool,
    /// The context that was active in the app when it last wrote config.json.
    pub active: bool,
    pub exists: bool,
}

impl Row for VaultRow {
    fn fields(&self) -> Vec<String> {
        vec![
            if self.current {
                "*".to_string()
            } else {
                String::new()
            },
            self.name.clone(),
            self.kind.to_string(),
            self.path.clone(),
        ]
    }
}

/// `baram vaults` — the roots registered in the app, sorted by (name, path). `path` is
/// the registered spelling; the envelope's `vault.path` is the canonical one.
pub(crate) fn vaults(config: &AppConfig, current: Option<&Vault>) -> Envelope<VaultRow> {
    let mut items: Vec<VaultRow> = config
        .registered
        .iter()
        .map(|entry| {
            let exists = Path::new(&entry.path).is_dir();
            let canonical = if exists {
                resolve_canonical(&entry.path).ok()
            } else {
                None
            };
            VaultRow {
                name: entry.label.clone(),
                path: entry.path.clone(),
                alias: entry.alias.clone(),
                kind: match entry.kind {
                    RootKind::Vault => "vault",
                    RootKind::Folder => "folder",
                },
                current: current
                    .is_some_and(|vault| canonical.as_deref() == Some(vault.root.as_path())),
                active: config.active_id.as_deref() == Some(entry.id.as_str()),
                exists,
            }
        })
        .collect();
    items.sort_by(|a, b| {
        (a.name.as_str(), a.path.as_str()).cmp(&(b.name.as_str(), b.path.as_str()))
    });
    Envelope {
        vault: current.map(vault_info),
        truncated: false,
        items,
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct FileContent {
    pub path: String,
    pub content: String,
}

/// `baram read <path>` — one file, as it is on disk.
pub(crate) async fn read(vault: &Vault, path: &str) -> Result<Envelope<FileContent>, CliError> {
    let missing = || CliError::new(ErrorCode::FileNotFound, format!("no file at {path}"));
    // The io::Error's own text is the OS's or std's, in English, and carries no path
    // ("Permission denied (os error 13)", "stream did not contain valid UTF-8"). The
    // FsError enum's Display is not used: its wording is Korean.
    let unreadable = |source: &std::io::Error| {
        CliError::new(ErrorCode::Io, format!("cannot read {path}: {source}"))
    };
    let file = paths::file_arg(vault, path)?;
    let content = crate::fs::read_file(&file.to_string_lossy())
        .await
        .map_err(|error| match error {
            FsError::NotFound(_) => missing(),
            FsError::ReadError(source) => unreadable(&source),
            _ => CliError::new(ErrorCode::Io, format!("cannot read {path}")),
        })?;
    Ok(Envelope {
        vault: Some(vault_info(vault)),
        truncated: false,
        items: vec![FileContent {
            path: paths::relative(vault, &file),
            content,
        }],
    })
}

/// The message for a walk that failed when the failing directory cannot be named.
fn cannot_read_vault(vault: &Vault) -> CliError {
    CliError::new(
        ErrorCode::Io,
        format!("cannot read the vault at {}", vault.root.display()),
    )
}

/// The error for a command whose walk failed, naming the directory (spec 0066 §3.7).
///
/// The layers between the walk and a command flatten the error to a string, so the
/// directory is recovered by running the SAME walker again — on the failure path only.
/// Because it is the same function (`collect_md_files`: tags, tasks and `files` all walk
/// with it), its skip rules cannot disagree with the walk that failed. If the second
/// walk succeeds, the failure no longer reproduces — it was not the walk's, or the
/// directory became readable or went away in between — and the message stays general.
pub(crate) async fn walk_failure(vault: &Vault, start: &Path) -> CliError {
    let mut sink = Vec::new();
    let failed = crate::fs::collect_md_files(start, &mut sink).await.err();
    unreadable_directory(vault, failed)
}

fn unreadable_directory(vault: &Vault, failed: Option<FsError>) -> CliError {
    match failed {
        Some(FsError::ReadDir { path, source }) => CliError::new(
            ErrorCode::Io,
            format!("cannot read directory {}: {source}", path.display()),
        ),
        _ => cannot_read_vault(vault),
    }
}

/// The same for the link index, which walks TWICE: `LinkIndex::build` collects the
/// markdown files and then every file (non-markdown link targets, §278). The two
/// walkers skip the same things, and they are re-run in the order the build ran them.
pub(crate) async fn index_failure(vault: &Vault) -> CliError {
    let mut sink = Vec::new();
    let mut failed = crate::fs::collect_md_files(&vault.root, &mut sink)
        .await
        .err();
    if failed.is_none() {
        sink.clear();
        failed = crate::fs::collect_all_files(&vault.root, &mut sink)
            .await
            .err();
    }
    unreadable_directory(vault, failed)
}

/// Sorts a list the CLI prints by (path, line) (spec 0066 §3.6). The walkers hand files
/// back in `read_dir` order, which differs between filesystems; the line is compared as
/// a number, not as text.
pub(crate) fn sort_by_path_and_line<T>(
    items: &mut [T],
    key: impl for<'a> Fn(&'a T) -> (&'a str, u64),
) {
    items.sort_by(|a, b| key(a).cmp(&key(b)));
}

#[derive(Debug, Serialize)]
pub(crate) struct PathRow {
    pub path: String,
}

impl Row for PathRow {
    fn fields(&self) -> Vec<String> {
        vec![self.path.clone()]
    }
}

/// `baram files [--folder <path>]` — the markdown files the app's walk sees.
pub(crate) async fn files(
    vault: &Vault,
    folder: Option<&str>,
) -> Result<Envelope<PathRow>, CliError> {
    let start = match folder {
        Some(folder) => paths::folder_arg(vault, folder)?,
        None => vault.root.clone(),
    };
    let mut found = Vec::new();
    if crate::fs::collect_md_files(&start, &mut found)
        .await
        .is_err()
    {
        return Err(walk_failure(vault, &start).await);
    }
    Ok(Envelope {
        vault: Some(vault_info(vault)),
        truncated: false,
        items: path_rows(vault, found),
    })
}

/// The rows `files` prints: each path relative to the vault, in path order whatever order
/// the walk gave them.
fn path_rows(vault: &Vault, found: Vec<PathBuf>) -> Vec<PathRow> {
    let mut items: Vec<PathRow> = found
        .iter()
        .map(|path| PathRow {
            path: paths::relative(vault, path),
        })
        .collect();
    sort_by_path_and_line(&mut items, |row| (row.path.as_str(), 0));
    items
}

pub(crate) struct SearchQuery<'a> {
    pub query: &'a str,
    pub regex: bool,
    pub case_sensitive: bool,
    pub word: bool,
    pub folder: Option<&'a str>,
    pub limit: usize,
}

#[derive(Debug, Serialize)]
pub(crate) struct SearchRow {
    pub path: String,
    pub line: usize,
    pub snippet: String,
}

impl Row for SearchRow {
    fn fields(&self) -> Vec<String> {
        vec![
            self.path.clone(),
            self.line.to_string(),
            self.snippet.clone(),
        ]
    }
}

/// `baram search <query>` — the app's full-text search over `.md` files.
///
/// `--folder` MOVES THE SEARCH ROOT instead of passing `include_glob`. That option's
/// folder form is a string prefix (`docs` also takes `docs-old/`), and the limit is
/// applied while walking — `docs-old/` sorts first and would fill it, so filtering the
/// hits afterwards comes too late. With the root moved, neither can happen.
///
/// The match's `column` is left out: it is a byte offset, which is not a character
/// position in Korean text.
pub(crate) async fn search(
    vault: &Vault,
    query: SearchQuery<'_>,
) -> Result<Envelope<SearchRow>, CliError> {
    if query.query.is_empty() {
        return Err(CliError::new(
            ErrorCode::InvalidArgument,
            "the query is empty",
        ));
    }
    // Checked here rather than by reading `search_files`' error text: it returns a
    // String, and "bad pattern" and "bad root" could only be told apart by wording.
    // `--word` wraps the pattern in `\b…\b`, which cannot make a valid one invalid.
    if query.regex {
        if let Err(error) = regex::Regex::new(query.query) {
            return Err(CliError::new(
                ErrorCode::InvalidArgument,
                format!("invalid regular expression: {error}"),
            ));
        }
    }
    let start = match query.folder {
        Some(folder) => paths::folder_arg(vault, folder)?,
        None => vault.root.clone(),
    };
    let options = SearchOptions {
        case_sensitive: query.case_sensitive,
        whole_word: query.word,
        regex: query.regex,
        // One more than asked for: `search_files` does not say whether it stopped early.
        max_results: query.limit + 1,
        include_glob: None,
        exclude_glob: None,
    };
    let hits = crate::search::search_files(&start.to_string_lossy(), query.query, &options)
        .await
        .map_err(|_| CliError::new(ErrorCode::Io, format!("cannot search {}", start.display())))?;
    let (truncated, items) = search_rows(vault, hits, query.limit);
    Ok(Envelope {
        vault: Some(vault_info(vault)),
        truncated,
        items,
    })
}

/// The rows `search` prints, and whether `hits` held more than `limit`: the first `limit`
/// hits the search gave, each path relative to the vault, in (path, line) order.
fn search_rows(vault: &Vault, hits: Vec<SearchResult>, limit: usize) -> (bool, Vec<SearchRow>) {
    let truncated = hits.len() > limit;
    let mut items: Vec<SearchRow> = hits
        .into_iter()
        .take(limit)
        .map(|hit| SearchRow {
            path: paths::relative(vault, Path::new(&hit.file_path)),
            line: hit.line,
            snippet: hit.snippet,
        })
        .collect();
    sort_by_path_and_line(&mut items, |row| (row.path.as_str(), row.line as u64));
    (truncated, items)
}

#[cfg(test)]
mod tests {
    use super::super::vault::Registered;
    use super::*;

    fn entry(name: &str, path: &str) -> Registered {
        Registered {
            id: format!("ctx-{name}{path}"),
            label: name.to_string(),
            alias: None,
            path: path.to_string(),
            kind: RootKind::Vault,
        }
    }

    /// The input is the expected order turned around twice: `b` before `a`, and the two
    /// `a`s with their paths reversed, so the name order and the path tie-break each have
    /// something to undo.
    #[test]
    fn vaults_come_out_by_name_then_path_whatever_order_config_json_gave() {
        let config = AppConfig {
            registered: vec![entry("b", "/2"), entry("a", "/9"), entry("a", "/1")],
            ..AppConfig::default()
        };
        let order: Vec<(String, String)> = vaults(&config, None)
            .items
            .into_iter()
            .map(|row| (row.name, row.path))
            .collect();
        assert_eq!(
            order,
            [("a", "/1"), ("a", "/9"), ("b", "/2")]
                .map(|(name, path)| (name.to_string(), path.to_string()))
        );
    }

    /// The sort is tested on input turned upside down, not by creating fixture files in
    /// another order: `read_dir` order does not follow creation order, so that test
    /// would pass with the sort removed.
    #[test]
    fn lists_come_out_by_path_then_line_whatever_order_the_walk_gave() {
        let mut items: Vec<(String, u64)> = [
            ("b.md", 10),
            ("b.md", 2),
            ("a/z.md", 1),
            ("b.md", 1),
            ("a-b/x.md", 5),
        ]
        .into_iter()
        .map(|(path, line)| (path.to_string(), line))
        .collect();
        sort_by_path_and_line(&mut items, |item| (item.0.as_str(), item.1));
        assert_eq!(
            items,
            [
                ("a-b/x.md", 5), // `-` (0x2D) sorts before `/` (0x2F)
                ("a/z.md", 1),
                ("b.md", 1),
                ("b.md", 2),
                ("b.md", 10), // a number, not text: 10 comes after 2
            ]
            .into_iter()
            .map(|(path, line)| (path.to_string(), line))
            .collect::<Vec<_>>()
        );
    }

    fn vault_in(root: &str) -> Vault {
        Vault {
            name: "v".into(),
            root: PathBuf::from(root),
        }
    }

    /// Fed in an order other than the sorted one, so deleting the sort changes the result.
    /// The expected order is the byte order of the printed strings: `a/y.md` before
    /// `a0/x.md` (`/` is 0x2F, `0` is 0x30), `b.md` before the two `docs` folders (`b` is
    /// 0x62, `d` is 0x64), and `docs-old/` before `docs/` (`-` is 0x2D, `/` is 0x2F).
    #[test]
    fn files_come_out_by_path_whatever_order_the_walk_gave() {
        let vault = vault_in("/vault");
        let found: Vec<PathBuf> = ["b.md", "a0/x.md", "docs/g.md", "docs-old/a.md", "a/y.md"]
            .iter()
            .map(|rel| vault.root.join(rel))
            .collect();
        let paths: Vec<String> = path_rows(&vault, found)
            .into_iter()
            .map(|row| row.path)
            .collect();
        assert_eq!(
            paths,
            ["a/y.md", "a0/x.md", "b.md", "docs-old/a.md", "docs/g.md"]
        );
    }

    fn hit(rel: &str, line: usize) -> SearchResult {
        SearchResult {
            file_path: format!("/vault/{rel}"),
            line,
            column: 1,
            snippet: format!("{rel}:{line}"),
        }
    }

    fn pairs(rows: &[SearchRow]) -> Vec<(&str, usize)> {
        rows.iter()
            .map(|row| (row.path.as_str(), row.line))
            .collect()
    }

    /// The hits come in an order other than the sorted one (`a0/` before `a/`, line 10
    /// before line 2). The cut is made on that order and the sort comes after it, so with
    /// a limit of 2 the rows are the first two hits, sorted.
    #[test]
    fn search_hits_come_out_by_path_then_line_and_the_cut_is_reported() {
        let vault = vault_in("/vault");
        let hits = || vec![hit("a0/x.md", 1), hit("a/y.md", 10), hit("a/y.md", 2)];

        let (truncated, rows) = search_rows(&vault, hits(), 3);
        assert!(!truncated, "as many hits as the limit is not a cut");
        assert_eq!(
            pairs(&rows),
            [("a/y.md", 2), ("a/y.md", 10), ("a0/x.md", 1)]
        );
        assert_eq!(rows[0].snippet, "a/y.md:2");

        let (truncated, rows) = search_rows(&vault, hits(), 2);
        assert!(truncated);
        assert_eq!(pairs(&rows), [("a/y.md", 10), ("a0/x.md", 1)]);

        let (truncated, rows) = search_rows(&vault, hits(), 1);
        assert!(truncated);
        assert_eq!(pairs(&rows), [("a0/x.md", 1)]);
    }
}
