// §387 `backlinks` and `links` — what the link index says about one note, for the CLI and
// the MCP server's `backlinks` and `outgoing_links` tools. Split from `ops_notes.rs` by
// size; the contract is the same: return the envelope, write nothing.

use super::aliases;
use super::app_config::AppConfig;
use super::error::{CliError, ErrorCode};
use super::ops::{index_failure, sort_by_path_and_line, vault_info};
use super::output::{Envelope, Row};
use super::paths;
use super::vault::Vault;
use crate::index::{BacklinkResult, LinkEntry, LinkIndex, LinkResolution};
use schemars::JsonSchema;
use serde::Serialize;
use std::path::Path;

/// The link index, built for this one call. ONE spelling of the root goes in — the
/// canonical one — because `outgoing` is keyed by the paths the build walked.
async fn build_index(vault: &Vault) -> Result<LinkIndex, CliError> {
    let mut index = LinkIndex::new();
    if index.build(&vault.root.to_string_lossy()).await.is_err() {
        return Err(index_failure(vault).await);
    }
    Ok(index)
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BacklinkRow {
    /// The note that holds the link.
    pub path: String,
    pub line: u32,
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub context: String,
    pub block_id: Option<String>,
}

impl Row for BacklinkRow {
    fn fields(&self) -> Vec<String> {
        vec![
            self.path.clone(),
            self.line.to_string(),
            self.kind.to_string(),
            self.context.clone(),
        ]
    }
}

/// `baram backlinks <path>` — what the app's backlinks panel shows for the note, from the
/// one index built over this vault. The panel asks every registered directory context
/// whose root contains the file (`get_backlinks_inner` in `index/service/query.rs`) and
/// merges the answers, so with nested registered roots it can list more.
///
/// Under every key the index files a link to the note (`LinkIndex::backlink_keys`): its
/// name — `[[a]]` anywhere counts for every `a.md` — the zettel id its name starts with,
/// and its path under the vault root, as in `[[notes/a]]`, `((notes/a#^id))`, or a
/// `[[./a]]` written in `notes/`; and again behind each alias of a registered vault or
/// folder that holds the note (`aliases::of_note`, the panel's rule), its name, id, and
/// path under that context's root. A link behind any other name (`[[journal::a]]`, unless
/// `journal` names a context that holds the note) does not count. Two links on one line of
/// one note are reported once. The note need not exist — links to a note not written yet
/// are a fair question — but a directory is refused: a folder would be asked about as a
/// note named like it. So is a path the system refuses as written (a NUL inside it, a name
/// too long): INVALID_ARGUMENT, not an empty answer (`paths::refused_as_written`).
pub(crate) async fn backlinks(
    vault: &Vault,
    path: &str,
    config: &AppConfig,
) -> Result<Envelope<BacklinkRow>, CliError> {
    let target = paths::locate(vault, path)?;
    // A directory is refused, and so is a path the system refuses as written
    // (`paths::refused_as_written`). Any other metadata error passes, as a missing file
    // does: nothing here reads the file.
    match std::fs::metadata(&target) {
        Ok(meta) if meta.is_dir() => {
            return Err(CliError::new(
                ErrorCode::FileNotFound,
                format!("no file at {path}"),
            ));
        }
        Err(source) => {
            if let Some(error) = paths::refused_as_written(path, "file", &source) {
                return Err(error);
            }
        }
        Ok(_) => {}
    }
    let index = build_index(vault).await?;
    let own = aliases::of_note(config, &target);
    Ok(Envelope {
        vault: Some(vault_info(vault)),
        truncated: false,
        items: backlink_rows(vault, index.get_backlinks(&target.to_string_lossy(), &own)),
    })
}

/// The rows `backlinks` prints: each source path relative to the vault, in (path, line)
/// order whatever order the index filed them in.
fn backlink_rows(vault: &Vault, found: Vec<BacklinkResult>) -> Vec<BacklinkRow> {
    let mut items: Vec<BacklinkRow> = found
        .into_iter()
        .map(|backlink| BacklinkRow {
            path: paths::relative(vault, Path::new(&backlink.source_path)),
            line: backlink.line,
            kind: backlink.link_type.wire_name(),
            context: backlink.context,
            block_id: backlink.block_id,
        })
        .collect();
    sort_by_path_and_line(&mut items, |row| (row.path.as_str(), u64::from(row.line)));
    items
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkRow {
    pub line: u32,
    #[serde(rename = "type")]
    pub kind: &'static str,
    /// The target as the link index records it: the name inside the brackets, trimmed,
    /// without alias, heading or display text. A self-reference `((#^id))` writes none, so it
    /// holds the note's own file stem.
    pub target: String,
    pub block_id: Option<String>,
    /// `resolved` · `unresolved` · `otherVault`.
    pub resolution: &'static str,
    /// The file the link resolves to — set when `resolution` is `resolved`.
    pub path: Option<String>,
    /// The vault alias the link names — set when `resolution` is `otherVault`.
    pub vault: Option<String>,
}

impl Row for LinkRow {
    fn fields(&self) -> Vec<String> {
        vec![
            self.line.to_string(),
            self.kind.to_string(),
            self.target.clone(),
            self.resolution.to_string(),
            self.path
                .clone()
                .or_else(|| self.vault.clone())
                .unwrap_or_default(),
        ]
    }
}

/// `baram links <path>` — the links a note holds, each resolved by the graph's resolver
/// except a cross-vault link, which is reported by its alias. The graph's own edges
/// (`get_link_graph`) run a cross-vault link to the local note of that name, or to a
/// placeholder path when there is none, and an unresolved one to a placeholder path.
pub(crate) async fn links(vault: &Vault, path: &str) -> Result<Envelope<LinkRow>, CliError> {
    let file = paths::note_arg(vault, path)?;
    let index = build_index(vault).await?;
    let Some(outgoing) = index.outgoing_resolved(&file.to_string_lossy()) else {
        // `note_arg` has refused what the index never holds — a file that is no note, and
        // a note where the walk does not go — and `build` files every markdown file it
        // can read under `outgoing`. What is left is a note the build could not read.
        return Err(CliError::new(
            ErrorCode::Io,
            format!("{path} could not be read or is not UTF-8, so it is not in the link index"),
        ));
    };
    Ok(Envelope {
        vault: Some(vault_info(vault)),
        truncated: false,
        items: link_rows(vault, outgoing),
    })
}

/// The rows `links` prints: in line order, and links on one line in the order the index
/// holds them (the sort is stable). The index files a line's wikilinks first, then its
/// embeds, then its block references, so that is not always the order they are written
/// in.
fn link_rows(vault: &Vault, outgoing: Vec<(LinkEntry, LinkResolution)>) -> Vec<LinkRow> {
    let mut items: Vec<LinkRow> = outgoing
        .into_iter()
        .map(|(entry, resolution)| {
            let (resolution, resolved, other_vault) = match resolution {
                LinkResolution::Resolved(target) => (
                    "resolved",
                    Some(paths::relative(vault, Path::new(&target))),
                    None,
                ),
                LinkResolution::OtherVault(alias) => ("otherVault", None, Some(alias)),
                LinkResolution::Unresolved => ("unresolved", None, None),
            };
            LinkRow {
                line: entry.line,
                kind: entry.link_type.wire_name(),
                target: entry.target,
                block_id: entry.block_id,
                resolution,
                path: resolved,
                vault: other_vault,
            }
        })
        .collect();
    items.sort_by_key(|row| row.line);
    items
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::LinkKind;
    use std::path::PathBuf;

    fn plain_vault() -> Vault {
        Vault {
            name: "v".into(),
            root: PathBuf::from("/vault"),
            spellings: None,
        }
    }

    fn backlink(source: &str, line: u32) -> BacklinkResult {
        BacklinkResult {
            source_path: format!("/vault/{source}"),
            target_path: "/vault/target.md".to_string(),
            context: format!("{source}:{line}"),
            line,
            link_type: LinkKind::Wikilink,
            block_id: None,
        }
    }

    /// Fed in an order other than the sorted one, so deleting the sort changes the result.
    /// The expected order is the byte order of the path (`a/y.md` before `a0/x.md`: `/` is
    /// 0x2F, `0` is 0x30) and then the line as a number (the printed `10` after `2`, which
    /// text order would not give).
    #[test]
    fn backlinks_come_out_by_path_then_line_whatever_order_the_index_gave() {
        let found = vec![
            backlink("b.md", 10),
            backlink("a0/x.md", 1),
            backlink("b.md", 2),
            backlink("a/y.md", 7),
            backlink("b.md", 1),
        ];
        let rows = backlink_rows(&plain_vault(), found);
        let order: Vec<(&str, u32)> = rows
            .iter()
            .map(|row| (row.path.as_str(), row.line))
            .collect();
        assert_eq!(
            order,
            [
                ("a/y.md", 7),
                ("a0/x.md", 1),
                ("b.md", 1),
                ("b.md", 2),
                ("b.md", 10)
            ]
        );
        assert_eq!(
            rows[0].context, "a/y.md:7",
            "the row is the backlink's, moved"
        );
    }

    fn link(target: &str, line: u32) -> (LinkEntry, LinkResolution) {
        (
            LinkEntry {
                source_path: "/vault/n.md".to_string(),
                target: target.to_string(),
                line,
                context: String::new(),
                link_type: LinkKind::Wikilink,
                block_id: None,
                target_vault_alias: None,
                self_reference: false,
            },
            LinkResolution::Unresolved,
        )
    }

    /// Fed in an order other than the sorted one, with three links on line 3. The targets
    /// are not in line order (`u` is last by line and first by name), and the three on
    /// line 3 are neither in name order nor in its reverse (`w3` `w1` `w2`): a sort by
    /// anything but the line, `(line, target)` included, gives another result, and they
    /// come out in the order they went in.
    #[test]
    fn links_come_out_by_line_and_keep_the_index_order_within_a_line() {
        let outgoing = vec![
            link("w3", 3),
            link("y", 1),
            link("w1", 3),
            link("x", 2),
            link("u", 10),
            link("w2", 3),
        ];
        let order: Vec<(u32, String)> = link_rows(&plain_vault(), outgoing)
            .into_iter()
            .map(|row| (row.line, row.target))
            .collect();
        assert_eq!(
            order,
            [
                (1, "y"),
                (2, "x"),
                (3, "w3"),
                (3, "w1"),
                (3, "w2"),
                (10, "u")
            ]
            .map(|(line, target)| (line, target.to_string()))
        );
    }

    /// Forty links over five lines, in an order that mixes the lines — long enough to tell
    /// a stable sort from `sort_unstable_by_key`, which the six links above cannot (that
    /// mutation passes them). The names run against the input order (`t39` is first in),
    /// so a sort by `(line, target)` gives another result too. The expected order is the
    /// sort of `(line, position in the input)`, a key with no ties.
    #[test]
    fn links_on_one_line_keep_the_index_order_in_a_long_list() {
        let given: Vec<(u32, usize)> = (0..40).map(|i| ((i * 7 % 5 + 1) as u32, i)).collect();
        let outgoing = given
            .iter()
            .map(|(line, position)| link(&format!("t{:02}", 39 - position), *line))
            .collect();
        let got: Vec<String> = link_rows(&plain_vault(), outgoing)
            .into_iter()
            .map(|row| row.target)
            .collect();
        let mut expected = given.clone();
        expected.sort();
        let expected: Vec<String> = expected
            .iter()
            .map(|(_, position)| format!("t{:02}", 39 - position))
            .collect();
        assert_eq!(got, expected);
    }

    /// One row per way a link can resolve, in line order so the sort has nothing to do:
    /// the path is relative to the vault, the alias comes from the resolution, the block
    /// ID and the kind from the entry.
    #[test]
    fn a_link_row_says_how_the_link_resolved() {
        let outgoing = vec![
            (
                link("beta", 3).0,
                LinkResolution::Resolved("/vault/notes/beta.md".to_string()),
            ),
            (
                LinkEntry {
                    block_id: Some("blk1".to_string()),
                    link_type: LinkKind::BlockRef,
                    ..link("alpha", 4).0
                },
                LinkResolution::Resolved("/vault/alpha.md".to_string()),
            ),
            (
                LinkEntry {
                    target_vault_alias: Some("journal".to_string()),
                    ..link("remote", 5).0
                },
                LinkResolution::OtherVault("journal".to_string()),
            ),
            link("gone", 6),
        ];
        assert_eq!(
            serde_json::to_value(link_rows(&plain_vault(), outgoing)).unwrap(),
            serde_json::json!([
                { "line": 3, "type": "wikilink", "target": "beta", "blockId": null,
                  "resolution": "resolved", "path": "notes/beta.md", "vault": null },
                { "line": 4, "type": "blockRef", "target": "alpha", "blockId": "blk1",
                  "resolution": "resolved", "path": "alpha.md", "vault": null },
                { "line": 5, "type": "wikilink", "target": "remote", "blockId": null,
                  "resolution": "otherVault", "path": null, "vault": "journal" },
                { "line": 6, "type": "wikilink", "target": "gone", "blockId": null,
                  "resolution": "unresolved", "path": null, "vault": null }
            ])
        );
    }
}
