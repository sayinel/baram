// §29 인메모리 링크 인덱스 — Vault 내 [[wikilink]] 추출 및 백링크 조회
//
// 전략: Vault 열기 시 전체 .md 파일 스캔 → 인메모리 HashMap 저장
//       파일 저장 시 해당 파일만 증분 업데이트

mod extractor;
mod filing;
mod judgement;
mod normalizer;
mod read_back;
mod relative_links;
mod resolve;
mod rewriter;
pub mod service;
mod types;

use serde::Serialize;
use std::collections::HashMap;
use thiserror::Error;

// Re-export public API consumed by `service/` and the IPC layer
pub(crate) use extractor::file_stem_from_path;
pub use extractor::{
    collect_all_files, collect_md_files, find_unlinked_mentions, UnlinkedMentionResult,
};
pub(crate) use filing::{filing_key, keys_for, root_relative_key, FilingKey, LocalAlias};
pub(crate) use judgement::{root_places, BlockTarget, KnownPaths, RenameTarget, RootNotes};
pub(crate) use read_back::{index_reads_the_rename_back, reads_a_link_under};
pub use relative_links::rewrite_relative_wikilinks;
pub(crate) use rewriter::link_reads_back_as_the_file;
pub use rewriter::{
    block_reference_can_spell, own_block_reference_lines, replace_block_id_refs_to,
    replace_block_reference_target, replace_wikilink_target, wikilink_can_spell,
};
pub(crate) use types::LinkResolution;
pub use types::{BacklinkResult, IndexStats, LinkEdge, LinkEntry, LinkGraph};

use extractor::{extract_file_tags, extract_links};
use normalizer::normalize_file_path;

#[cfg(test)]
thread_local! {
    /// How many note paths `LinkIndex::path_keys_of` has spelled as a
    /// `Path` key on this thread — what a rename's note sets cost, counted
    /// rather than timed. Per thread, so tests running side by side do not mix.
    static PATH_KEYS_SPELLED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// `PATH_KEYS_SPELLED` so far on this thread; a test reads it before and after.
#[cfg(test)]
pub(crate) fn path_keys_spelled() -> usize {
    PATH_KEYS_SPELLED.with(std::cell::Cell::get)
}

#[derive(Error, Debug)]
pub enum IndexError {
    #[error("파일 읽기 실패: {0}")]
    IoError(#[from] std::io::Error),
}

/// The grammars a reference is read with, in ONE list, so that what the index
/// files under a stem and what a rename rewrites cannot drift apart (issue
/// 678). `LinkKind::pass` names the rewrite pass that spells each kind and has
/// no `_` arm, so a fourth grammar is a compile error until it is given one —
/// not a runtime count that a hand-written fixture cannot foresee. `ALL`
/// (tests only) is spelled from the same list as the enum, so the test that walks it
/// (`every_reference_the_index_files_under_a_stem_is_visited_by_one_rewrite_pass`)
/// holds the fourth kind without anyone remembering to add it.
///
/// On the wire the kinds are the strings the frontend has always read —
/// `ipc/types.ts` `linkType`: "wikilink" | "blockRef" | "blockEmbed".
macro_rules! link_kinds {
    ($($kind:ident),+ $(,)?) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
        #[serde(rename_all = "camelCase")]
        pub enum LinkKind { $($kind),+ }

        #[cfg(test)]
        impl LinkKind {
            /// Every kind, in the order the enum lists them — the same list,
            /// for the tests that must hold every kind.
            pub(crate) const ALL: &'static [LinkKind] = &[$(LinkKind::$kind),+];
        }
    };
}
link_kinds!(Wikilink, BlockRef, BlockEmbed);

impl LinkKind {
    /// The rewrite pass that spells this kind (issue 678). ‼️ No `_` arm, on
    /// purpose: a kind this `match` does not name does not compile. That is
    /// the half of the invariant "what the index files, one pass visits" the
    /// compiler can hold; the other half — that the pass's regex actually
    /// reads the kind — is the count test named on `LinkKind`, whose fixture
    /// `ALL` spells.
    pub fn pass(self) -> RewritePass {
        match self {
            LinkKind::Wikilink => RewritePass::Wikilinks,
            LinkKind::BlockRef | LinkKind::BlockEmbed => RewritePass::BlockReferences,
        }
    }
}

#[cfg(test)]
impl LinkKind {
    /// One reference of this kind to `target`, as prose spells it — what the
    /// count test builds its fixture from, kind by kind over `ALL`. No `_`
    /// arm: a new kind must say how it is spelled before the suite compiles.
    pub(crate) fn spelled(self, target: &str, id: &str) -> String {
        match self {
            LinkKind::Wikilink => format!("[[{target}]]"),
            LinkKind::BlockRef => format!("(({target}#^{id}))"),
            LinkKind::BlockEmbed => format!("{{{{embed (({target}#^{id}))}}}}"),
        }
    }
}

/// The two passes a file rename runs over a referrer (`rename/passes.rs`,
/// `LinkPasses`) — one per grammar a new stem may or may not be spelled in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RewritePass {
    /// `replace_wikilink_target`: `[[stem]]`, `[[alias::stem|display]]`, …
    Wikilinks,
    /// `replace_block_reference_target`: `((stem#^id))`, and the embed around one.
    BlockReferences,
}

/// The in-memory link index
#[derive(Debug, Default)]
pub struct LinkIndex {
    /// source_path → list of links found in that file
    outgoing: HashMap<String, Vec<LinkEntry>>,
    /// The key a link is filed under (`filing_key`: its stem, its path under
    /// `root_path`, or its vault alias with its target) → the links filed
    /// there. A file's backlinks are read under `backlink_keys`: `keys_for`
    /// its path, plus the zettel id in its stem when it has one, bare and
    /// behind each local alias.
    incoming: HashMap<FilingKey, Vec<LinkEntry>>,
    /// Root path of the vault
    root_path: Option<String>,
    /// Normalized file stem (lowercase, no extension) → list of absolute file paths
    /// Used to resolve [[name]] style wikilinks to actual file locations in subdirectories
    file_map: HashMap<String, Vec<String>>,
    /// Normalized relative path (lowercase, no extension) → absolute file path
    /// Used to resolve [[path/name]] style wikilinks (e.g., [[notes/architecture]])
    relative_map: HashMap<String, String>,
    /// Note id (12–14 digit filename prefix) → absolute file path (Zettelkasten `[[ID]]` links)
    id_map: HashMap<String, String>,
    /// §278 Full lowercased file NAME (extension included) → absolute file paths.
    ///
    /// `file_map` is keyed by `file_stem()`, so `Paper.pdf` lands under `paper` and a
    /// bare `[[Paper.pdf]]` (which `normalize_target` leaves as `paper.pdf`, since it
    /// only strips `.md`) never matches. Path-qualified targets already worked through
    /// `relative_map`, which strips only markdown extensions too — this closes the
    /// remaining case so a PDF link is a real edge in backlinks and the graph rather
    /// than a dangling node.
    ///
    /// A `Vec` for the same reason `file_map` uses one: two folders can hold files with
    /// the same name, and first-registered wins consistently with the stem lookup.
    name_map: HashMap<String, Vec<String>>,
    /// file_path → list of tags found in that file (for graph tag nodes)
    file_tags: HashMap<String, Vec<String>>,
}

impl LinkIndex {
    pub fn new() -> Self {
        Self::default()
    }

    /// Build the full index by scanning all .md files under root_path
    pub async fn build(&mut self, root_path: &str) -> Result<IndexStats, IndexError> {
        let start = std::time::Instant::now();
        self.root_path = Some(root_path.to_string());
        self.outgoing.clear();
        self.incoming.clear();
        self.file_map.clear();
        self.relative_map.clear();
        self.id_map.clear();
        self.name_map.clear();
        self.file_tags.clear();

        let mut files_indexed: u32 = 0;
        let mut links_found: u32 = 0;

        // Collect all .md files
        let md_files = collect_md_files(root_path).await?;

        // Build file maps for wikilink target resolution
        for file_path in &md_files {
            self.register_file_path(file_path, root_path);
        }

        // §278 Non-markdown files are link TARGETS only — registered after the markdown
        // pass so that where the two could collide, markdown is already in place.
        for file_path in collect_all_files(root_path).await? {
            self.register_link_target(&file_path, root_path);
        }

        for file_path in &md_files {
            let content = match tokio::fs::read_to_string(file_path).await {
                Ok(c) => c,
                Err(_) => continue, // skip unreadable files
            };

            let entries = extract_links(file_path, &content);
            links_found += entries.len() as u32;

            // Build incoming index
            for entry in &entries {
                self.file_incoming(entry);
            }

            self.outgoing.insert(file_path.clone(), entries);

            // Extract tags for graph tag nodes
            let tags = extract_file_tags(&content);
            if !tags.is_empty() {
                self.file_tags.insert(file_path.clone(), tags);
            }

            files_indexed += 1;
        }

        let duration = start.elapsed().as_millis() as u64;
        Ok(IndexStats {
            files_indexed,
            links_found,
            duration,
        })
    }

    /// Remove a file from the index
    pub fn remove_file(&mut self, file_path: &str) {
        self.outgoing.remove(file_path);
        // Remove from incoming: filter out entries with this source_path
        for entries in self.incoming.values_mut() {
            entries.retain(|e| e.source_path != file_path);
        }
        // Clean up empty keys
        self.incoming.retain(|_, v| !v.is_empty());

        // Remove from file maps
        let stem = normalize_file_path(file_path);
        if let Some(paths) = self.file_map.get_mut(&stem) {
            paths.retain(|p| p != file_path);
            if paths.is_empty() {
                self.file_map.remove(&stem);
            }
        }
        self.relative_map.retain(|_, v| v != file_path);
        self.id_map.retain(|_, v| v != file_path);
        // §278 same shape as the file_map cleanup above — drop the path, then the key
        // once nothing points at it.
        self.name_map.retain(|_, paths| {
            paths.retain(|p| p != file_path);
            !paths.is_empty()
        });
        self.file_tags.remove(file_path);
    }

    /// File `entry` in `incoming` under the key `filing_key` gives it.
    fn file_incoming(&mut self, entry: &LinkEntry) {
        let key = filing_key(
            &entry.source_path,
            &entry.target,
            entry.target_vault_alias.as_deref(),
            self.root_path.as_deref(),
            cfg!(windows),
        );
        self.incoming.entry(key).or_default().push(entry.clone());
    }

    /// The keys a link to `file_path` is filed under in this index
    /// (`keys_for` under `root_path`): its stem, its path under the root,
    /// and each of `local_aliases` paired with its stem and its path under
    /// that alias's own root.
    pub fn filing_keys_of(&self, file_path: &str, local_aliases: &[LocalAlias]) -> Vec<FilingKey> {
        keys_for(
            file_path,
            self.root_path.as_deref(),
            local_aliases,
            cfg!(windows),
        )
    }

    /// The `Path`-key text of every note this index holds under its root,
    /// with how many of its notes fold to it: `root_relative_key` — the
    /// function `keys_for` spells a file's path key with, so the shapes
    /// agree — of each path in `file_map`, which holds each path once. Not
    /// `relative_map`, whose keys keep the host's separators and hold one
    /// path per key. Empty with no root. The rename reads it to tell whether
    /// a path link names an existing note under a root that holds the
    /// referrer, and whether more than one note there answers to it — on a
    /// file system that keeps case, `A/note.md` and `a/note.md` both fold
    /// to `a/note` (`judgement::KnownPaths`).
    pub fn registered_path_keys(&self) -> HashMap<String, usize> {
        self.path_keys_of(self.file_map.values().flatten())
    }

    /// The `Path` keys two or more of this index's notes fold to, with how
    /// many — `registered_path_keys` without the keys one note alone has,
    /// for a rename whose only holding root this is (`judgement::RootNotes::Sole`).
    /// Two notes share a key only when they share its last component
    /// (`filing::path_key_name`), so the notes are grouped by that first and
    /// a full key is spelled only for a group of two or more — none, in a
    /// vault whose note names are all different.
    pub fn colliding_path_keys(&self) -> HashMap<String, usize> {
        let mut by_name: HashMap<String, Vec<&String>> = HashMap::new();
        for path in self.file_map.values().flatten() {
            by_name
                .entry(filing::path_key_name(path, cfg!(windows)))
                .or_default()
                .push(path);
        }
        let mut keys = self.path_keys_of(
            by_name
                .into_values()
                .filter(|group| group.len() > 1)
                .flatten(),
        );
        keys.retain(|_, notes| *notes > 1);
        keys
    }

    /// How many of this index's notes fold to the `Path` key `key` — the
    /// one entry of `registered_path_keys` a file rename needs for its new
    /// name when this is its only holding root (`judgement::RootNotes::Sole`).
    /// Spelled only for the notes whose name is the key's last component, as
    /// `colliding_path_keys` groups them.
    pub fn path_key_notes(&self, key: &str) -> usize {
        let name = key.rsplit('/').next().unwrap_or(key);
        let same_name = self
            .file_map
            .values()
            .flatten()
            .filter(|path| filing::path_key_name(path, cfg!(windows)) == name);
        self.path_keys_of(same_name).get(key).copied().unwrap_or(0)
    }

    /// The `Path` key of each of `paths` under this index's root
    /// (`root_relative_key`), with how many of them fold to it. Empty with
    /// no root.
    fn path_keys_of<'a>(&self, paths: impl Iterator<Item = &'a String>) -> HashMap<String, usize> {
        let mut keys = HashMap::new();
        let Some(root) = self.root_path.as_deref() else {
            return keys;
        };
        for path in paths {
            #[cfg(test)]
            PATH_KEYS_SPELLED.with(|n| n.set(n.get() + 1));
            if let Some(key) = filing::root_relative_key(root, path, cfg!(windows)) {
                *keys.entry(key).or_insert(0) += 1;
            }
        }
        keys
    }

    /// The keys `get_backlinks` and `block_reference_lines` read for
    /// `file_path` (`backlink_keys_for` under `root_path`): `filing_keys_of`,
    /// plus the zettel id inside its stem if it has one, under which a bare
    /// `[[202607051530]]` is filed, and that id behind each of
    /// `local_aliases` (`[[Zettel::202607051530]]`).
    pub fn backlink_keys(&self, file_path: &str, local_aliases: &[LocalAlias]) -> Vec<FilingKey> {
        filing::backlink_keys_for(
            file_path,
            self.root_path.as_deref(),
            local_aliases,
            cfg!(windows),
        )
    }

    /// The `(source_path, line)` pairs that refer to `file_path`'s block
    /// `block_id`, for the block-ID rename (issue 594), read under
    /// `backlink_keys`. Unlike `get_backlinks`, nothing is deduplicated by
    /// `(source, line)` BEFORE the block filter — a line holding
    /// `[[note]] ((note#^id))` has two entries, and the wikilink must not hide
    /// the block reference. No vault alias: the block reference and embed
    /// grammars have no alias group (`BLOCK_REF_RE`, `BLOCK_EMBED_RE` in
    /// extractor.rs).
    pub fn block_reference_lines(&self, file_path: &str, block_id: &str) -> Vec<(String, u32)> {
        let mut out = Vec::new();
        for key in self.backlink_keys(file_path, &[]) {
            if let Some(entries) = self.incoming.get(&key) {
                for e in entries {
                    if e.block_id.as_deref() == Some(block_id) {
                        out.push((e.source_path.clone(), e.line));
                    }
                }
            }
        }
        out.sort();
        out.dedup();
        out
    }

    /// §33 · issue 678: every `(file, line)` filed under the keys a link to
    /// `file_path` is filed under (`filing_keys_of`: its stem — `file_key`,
    /// not `normalize_target`, which would read a stem ending in `.md` as
    /// another note's — and its path under the root) — wikilink, block
    /// reference and embed alike. NOT the zettel-id keys that `backlink_keys`
    /// adds and `get_backlinks` also reads: a bare `[[202607051530]]` is
    /// filed under the id, and `[[Zettel::202607051530]]` under the id behind
    /// the alias, so a rename neither rewrites nor reports either. A file
    /// rename rewrites all three kinds, and counts the lines each referrer
    /// was named for to tell a same-stem note's own references apart from a
    /// stale index.
    pub fn referring_lines_to(
        &self,
        file_path: &str,
        local_aliases: &[LocalAlias],
    ) -> Vec<(String, u32)> {
        let mut out: Vec<(String, u32)> = self
            .filing_keys_of(file_path, local_aliases)
            .iter()
            .filter_map(|key| self.incoming.get(key))
            .flatten()
            .map(|e| (e.source_path.clone(), e.line))
            .collect();
        out.sort();
        out.dedup();
        out
    }

    /// Get backlinks for a given file path, read under `backlink_keys`, one
    /// per `(source, line)`. Sorted by source path, then line, so the order
    /// does not depend on which key a link was filed under.
    pub fn get_backlinks(
        &self,
        file_path: &str,
        local_aliases: &[LocalAlias],
    ) -> Vec<BacklinkResult> {
        let keys = self.backlink_keys(file_path, local_aliases);

        let mut seen = std::collections::HashSet::new();
        let mut results = Vec::new();
        for key in keys {
            if let Some(entries) = self.incoming.get(&key) {
                for e in entries {
                    if seen.insert((e.source_path.clone(), e.line)) {
                        results.push(BacklinkResult {
                            source_path: e.source_path.clone(),
                            target_path: file_path.to_string(),
                            context: e.context.clone(),
                            line: e.line,
                            link_type: e.link_type,
                            block_id: e.block_id.clone(),
                        });
                    }
                }
            }
        }
        results.sort_by(|a, b| {
            (a.source_path.as_str(), a.line).cmp(&(b.source_path.as_str(), b.line))
        });
        results
    }

    /// Update index for a single file using already-read content (sync, no I/O)
    pub fn update_file_from_content(&mut self, file_path: &str, content: &str) {
        self.remove_file(file_path);

        // Re-register in file maps for target resolution
        if let Some(root) = self.root_path.clone() {
            self.register_file_path(file_path, &root);
        }

        let entries = extract_links(file_path, content);
        for entry in &entries {
            self.file_incoming(entry);
        }
        self.outgoing.insert(file_path.to_string(), entries);

        // Extract tags for graph tag nodes
        let tags = extract_file_tags(content);
        if !tags.is_empty() {
            self.file_tags.insert(file_path.to_string(), tags);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::normalizer::{both_forms, file_key};
    use super::*;

    #[test]
    fn test_backlinks_lookup() {
        let mut index = LinkIndex::new();

        // Manually insert entries
        let entry = LinkEntry {
            source_path: "/vault/overview.md".to_string(),
            target: "architecture".to_string(),
            line: 5,
            context: "See [[architecture]] for details".to_string(),
            link_type: LinkKind::Wikilink,
            block_id: None,
            target_vault_alias: None,
            self_reference: false,
        };
        index
            .outgoing
            .entry("/vault/overview.md".to_string())
            .or_default()
            .push(entry.clone());
        index
            .incoming
            .entry(FilingKey::Stem("architecture".to_string()))
            .or_default()
            .push(entry);

        let backlinks = index.get_backlinks("/vault/architecture.md", &[]);
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].source_path, "/vault/overview.md");
    }

    #[test]
    fn a_file_rename_reads_every_line_that_refers_to_the_stem_whatever_the_link_kind() {
        // issue 678: the rename needs the referrers AND how many lines the
        // index named each for — one entry per (file, line), for every kind
        // `LinkKind::ALL` lists, each on a line of its own here (a fourth
        // kind is in this fixture the moment the enum has one). A
        // path-qualified target is filed under its path under the root
        // (issue 619): it is among the lines of `dir/target.md`, and not of
        // a `target.md` elsewhere.
        // What fails this: dropping the `Path` key from `keys_for` — the
        // `((dir/target#^b1))` line leaves the first answer.
        let mut lines: Vec<String> = LinkKind::ALL
            .iter()
            .map(|kind| format!("see {}", kind.spelled("target", "b1")))
            .collect();
        lines.push("((dir/target#^b1))".to_string());
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        index.update_file_from_content("/vault/dir/target.md", "para ^b1");
        index.update_file_from_content("/vault/r.md", &lines.join("\n"));
        index.update_file_from_content("/vault/s.md", "[[other]]");
        let one_per_kind: Vec<(String, u32)> = (1..=LinkKind::ALL.len() as u32)
            .map(|line| ("/vault/r.md".to_string(), line))
            .collect();
        let mut with_the_path = one_per_kind.clone();
        with_the_path.push(("/vault/r.md".to_string(), LinkKind::ALL.len() as u32 + 1));
        assert_eq!(
            index.referring_lines_to("/vault/dir/target.md", &[]),
            with_the_path
        );
        assert_eq!(
            index.referring_lines_to("/vault/target.md", &[]),
            one_per_kind
        );
        assert!(index
            .referring_lines_to("/vault/nothing.md", &[])
            .is_empty());
    }

    #[test]
    fn every_reference_the_index_files_under_a_stem_is_visited_by_one_rewrite_pass() {
        // issue 678: what the index counts must be what the rename rewrites.
        // The index files a link of ANY kind under its target's key, while
        // the rewrite is the union of two syntax-specific passes. A kind in
        // the bucket that no pass visits is left in every referrer and
        // reported, which reaches a maintainer as a toast, not a failing
        // test. `LinkKind::pass` makes a kind WITHOUT a pass a compile error;
        // this test holds the half the compiler cannot see — that the pass a
        // kind names actually reads that kind's syntax — so its fixture is
        // not a list of the kinds we know (an enumeration slides into
        // "therefore the rest is safe", and a fixture written by hand holds
        // only the kinds its author knew): it is spelled from `LinkKind::ALL`.
        //
        // What fails this: a kind whose `pass` names a pass whose regex does
        // not read it — `filed` grows by one, the visit count does not
        // (measured: an `@@target@@` kind given `BlockReferences`, 3 != 4. Not
        // `<<target>>` — the literal analysis reads `<target>` as an HTML tag
        // and files nothing, so that probe stays green and proves nothing).
        //
        // The fixture must hold no self-reference: `((#^id))` is filed under
        // the REFERRER's own stem, so it is not in this bucket and no pass
        // visits it. `((dir/target#^b1))` names another file's path (issue
        // 619): it is not in this bucket and no pass visits it for
        // `/vault/target.md` — the sibling test below counts the path bucket.
        let mut content = LinkKind::ALL
            .iter()
            .map(|kind| kind.spelled("target", "b1"))
            .collect::<Vec<_>>()
            .join(" and ");
        content.push_str("\n((dir/target#^b1))");
        let content = content.as_str();
        let mut index = LinkIndex::new();
        index.update_file_from_content("/vault/r.md", content);
        let filed = index
            .incoming
            .get(&FilingKey::Stem(file_key("target")))
            .map_or(0, |entries| {
                entries
                    .iter()
                    .filter(|e| e.source_path == "/vault/r.md")
                    .count()
            });
        let target = RenameTarget {
            old_path: "/vault/target.md",
            new_path: "/vault/renamed.md",
            local_aliases: &[],
            known_paths: Default::default(),
            windows: false,
        };
        let roots = ["/vault".to_string()];
        assert_eq!(
            replace_wikilink_target(content, "/vault/r.md", &roots, &target).matched
                + replace_block_reference_target(content, "/vault/r.md", &roots, &target).matched,
            filed,
            "the index files a reference under this stem that neither rewrite pass visits"
        );
    }

    #[test]
    fn the_colliding_path_keys_are_every_key_two_notes_share_and_no_other() {
        // `A/note.md` and `a/note.md` fold to `a/note`. `a/x.txt` — a rename
        // to `.txt` keeps the file in the index — and `a/x.txt.md` both
        // fold to `a/x.txt` although their stems, `x` and `x.txt`, differ:
        // the notes are grouped by the key's own last component, not by
        // stem. `b/note.md` shares a name with the first pair but not a key.
        // What fails this: grouping by `file_map`'s stem buckets instead of
        // `path_key_name` — `a/x.txt` is missed; and keeping the keys only
        // one note has — `b/note` appears.
        let mut index = LinkIndex::new();
        index.root_path = Some("/v".to_string());
        for path in [
            "/v/A/note.md",
            "/v/a/note.md",
            "/v/b/note.md",
            "/v/a/x.txt",
            "/v/a/x.txt.md",
            "/v/c/other.md",
        ] {
            index.update_file_from_content(path, "");
        }
        let expected: HashMap<String, usize> =
            [("a/note".to_string(), 2), ("a/x.txt".to_string(), 2)].into();
        assert_eq!(index.colliding_path_keys(), expected);
        let all = index.registered_path_keys();
        assert_eq!(all.len(), 4, "{all:?}");
        assert_eq!(all.get("b/note"), Some(&1));
    }

    #[test]
    fn every_reference_the_index_files_under_a_path_is_visited_by_one_rewrite_pass() {
        // issue 619: the same count for the path bucket — every kind in
        // `LinkKind::ALL`, spelled with the target's path from the root and
        // relative to the referrer's folder, is filed under `Path("dir/target")`
        // and must be visited by one pass. A link behind a vault alias is
        // filed as `Foreign`: another vault's while the alias is not this
        // vault's (visited 0 times), this file's once it is (visited once).
        // What fails this: dropping the `Path` arm from `RenameTarget::refers`
        // (the path spellings are filed and not visited), or dropping its
        // alias check (the `Foreign` line is visited with no local alias).
        let mut spellings: Vec<String> = Vec::new();
        for spelled_as in ["dir/target", "./target"] {
            spellings.extend(
                LinkKind::ALL
                    .iter()
                    .map(|kind| kind.spelled(spelled_as, "b1")),
            );
        }
        spellings.push("[[work::target]]".to_string());
        let content = spellings.join("\n");
        let mut index = LinkIndex::new();
        index.root_path = Some("/v".to_string());
        index.update_file_from_content("/v/dir/target.md", "para ^b1");
        index.update_file_from_content("/v/dir/r.md", &content);
        let filed_under = |key: &FilingKey| {
            index.incoming.get(key).map_or(0, |entries| {
                entries
                    .iter()
                    .filter(|e| e.source_path == "/v/dir/r.md")
                    .count()
            })
        };
        let filed = filed_under(&FilingKey::Path("dir/target".to_string()));
        assert_eq!(filed, 2 * LinkKind::ALL.len());
        assert_eq!(
            filed_under(&FilingKey::Foreign {
                alias: "work".to_string(),
                target: "target".to_string(),
            }),
            1
        );
        let roots = ["/v".to_string()];
        let visited = |local_aliases: &[LocalAlias]| {
            let target = RenameTarget {
                old_path: "/v/dir/target.md",
                new_path: "/v/dir/renamed.md",
                local_aliases,
                known_paths: Default::default(),
                windows: false,
            };
            replace_wikilink_target(&content, "/v/dir/r.md", &roots, &target).matched
                + replace_block_reference_target(&content, "/v/dir/r.md", &roots, &target).matched
        };
        assert_eq!(
            visited(&[]),
            filed,
            "the index files a reference under this path that neither rewrite pass visits"
        );
        let work = LocalAlias {
            alias: "work".to_string(),
            root: "/v".to_string(),
        };
        assert_eq!(visited(&[work]), filed + 1);
    }

    #[test]
    fn a_path_qualified_reference_is_a_backlink_of_the_file_it_names() {
        // issue 619: a reference spelled with the target's path under the
        // root — from the root, or relative to the referrer's folder — is
        // filed under that path and read back for that file alone, never
        // for another folder's note of the same stem.
        // What fails this: dropping the `Path` key from `keys_for`, so
        // `dir/note.md` reads its stem alone and finds nothing.
        let mut index = LinkIndex::new();
        index.root_path = Some("/v".to_string());
        index.update_file_from_content("/v/dir/note.md", "para ^b1");
        index.update_file_from_content("/v/other/note.md", "para ^b1");
        index.update_file_from_content("/v/dir/note2.markdown", "text");
        index.update_file_from_content(
            "/v/r.md",
            "[[dir/note]]\n((dir/note#^b1))\n{{embed ((dir/note#^b1))}}\n[[dir/note2.markdown]]",
        );
        index.update_file_from_content("/v/dir/s.md", "((./note#^b1))\n[[../dir/note|x]]");

        assert_eq!(index.get_backlinks("/v/dir/note.md", &[]).len(), 5);
        assert!(index.get_backlinks("/v/other/note.md", &[]).is_empty());
        assert_eq!(index.get_backlinks("/v/dir/note2.markdown", &[]).len(), 1);
        assert_eq!(
            index.block_reference_lines("/v/dir/note.md", "b1"),
            vec![
                ("/v/dir/s.md".to_string(), 1),
                ("/v/r.md".to_string(), 2),
                ("/v/r.md".to_string(), 3),
            ]
        );
        assert_eq!(index.referring_lines_to("/v/dir/note.md", &[]).len(), 5);
    }

    #[test]
    fn a_note_stored_decomposed_answers_the_links_typed_composed() {
        // §390 The folder and the note are stored decomposed (NFD), as tools
        // and imports on macOS can leave Korean names; the links are typed
        // composed (NFC). By its name, by its path from the root, from the
        // referrer's own folder, by a block reference and by its zettel id,
        // each link is a backlink of the note; the graph draws each to the
        // note and no node beside it; `links` resolves each to it.
        // What fails this: `file_key` lowercasing alone — line 1 of `r.md` is
        // lost; `strip_extension_and_fold` so — lines 2 and 3 and `s.md`'s
        // line are lost.
        let (folder, folder_on_disk) = both_forms("회의록");
        let (title, title_on_disk) = both_forms("202610061200 주간 노트");
        let note = format!("/v/{folder_on_disk}/{title_on_disk}.md");
        let sibling = format!("/v/{folder_on_disk}/s.md");
        let mut index = LinkIndex::new();
        index.root_path = Some("/v".to_string());
        index.update_file_from_content(&note, "para ^b1");
        index.update_file_from_content(
            "/v/r.md",
            &format!(
                "[[{title}]]\n[[{folder}/{title}]]\n(({folder}/{title}#^b1))\n[[202610061200]]\n"
            ),
        );
        index.update_file_from_content(&sibling, &format!("[[./{title}]]\n"));

        let lines: Vec<(String, u32)> = index
            .get_backlinks(&note, &[])
            .into_iter()
            .map(|b| (b.source_path, b.line))
            .collect();
        let r = "/v/r.md".to_string();
        assert_eq!(
            lines,
            vec![
                (r.clone(), 1),
                (r.clone(), 2),
                (r.clone(), 3),
                (r.clone(), 4),
                (sibling.clone(), 1)
            ]
        );

        let graph = index.get_link_graph();
        let ends: Vec<&str> = graph
            .edges
            .iter()
            .filter(|e| e.from != note)
            .map(|e| e.to.as_str())
            .collect();
        assert_eq!(ends, vec![note.as_str(); 5], "{graph:?}");
        let mut nodes = graph.nodes.clone();
        nodes.sort();
        let mut expected = vec![r.clone(), note.clone(), sibling.clone()];
        expected.sort();
        assert_eq!(nodes, expected);

        let resolved = index.outgoing_resolved(&r).expect("r.md is indexed");
        assert_eq!(resolved.len(), 4);
        assert!(
            resolved
                .iter()
                .all(|(_, res)| *res == LinkResolution::Resolved(note.clone())),
            "{resolved:?}"
        );
    }

    #[test]
    fn a_reference_that_escapes_the_root_is_nobodys_backlink() {
        // A relative target that climbs out of the root keeps its text as
        // its key, which no file under the root answers to.
        // What fails this: stopping `..` at the vault root instead of the
        // filesystem root in `filing_key`, so `../../x` resolves to `/v/x`
        // and `/v/x.md` claims it.
        let mut index = LinkIndex::new();
        index.root_path = Some("/v".to_string());
        index.update_file_from_content("/v/x.md", "text");
        index.update_file_from_content("/v/dir/r.md", "[[../../x]]");
        assert!(index.get_backlinks("/v/x.md", &[]).is_empty());
    }

    #[test]
    fn a_link_kind_crosses_the_wire_as_the_string_the_frontend_reads() {
        // `ipc/types.ts` documents `linkType` as "wikilink" | "blockRef" |
        // "blockEmbed"; the enum must keep spelling them, and a fourth kind
        // must be given its string here and there. What fails this: renaming
        // a variant, or dropping `rename_all = "camelCase"` (measured: the
        // latter spells "BlockRef").
        let spelled: Vec<String> = LinkKind::ALL
            .iter()
            .map(|kind| serde_json::to_string(kind).unwrap())
            .collect();
        assert_eq!(spelled, ["\"wikilink\"", "\"blockRef\"", "\"blockEmbed\""]);
    }

    // §33 the referrers of a stem, as a file rename reads them
    #[test]
    fn test_referring_lines_name_every_file_that_links_to_a_target() {
        let mut index = LinkIndex::new();

        // a.md links to "target", b.md links to "target", c.md links to "other"
        index.update_file_from_content("/vault/a.md", "See [[target]] here.");
        index.update_file_from_content("/vault/b.md", "Also [[target|alias]].");
        index.update_file_from_content("/vault/c.md", "Unrelated [[other]].");

        let files = |target: &str| -> Vec<String> {
            let mut files: Vec<String> = index
                .referring_lines_to(target, &[])
                .into_iter()
                .map(|(file, _)| file)
                .collect();
            files.dedup();
            files
        };
        assert_eq!(
            files("/vault/target.md"),
            vec!["/vault/a.md", "/vault/b.md"]
        );
        // Case-insensitive
        assert_eq!(files("/vault/Target.md").len(), 2);
        // No match
        assert!(files("/vault/nonexistent.md").is_empty());
    }

    #[test]
    fn test_remove_file() {
        let mut index = LinkIndex::new();

        let entry = LinkEntry {
            source_path: "/vault/a.md".to_string(),
            target: "b".to_string(),
            line: 1,
            context: "[[b]]".to_string(),
            link_type: LinkKind::Wikilink,
            block_id: None,
            target_vault_alias: None,
            self_reference: false,
        };
        index
            .outgoing
            .entry("/vault/a.md".to_string())
            .or_default()
            .push(entry.clone());
        index
            .incoming
            .entry(FilingKey::Stem("b".to_string()))
            .or_default()
            .push(entry);

        index.remove_file("/vault/a.md");
        assert!(!index.outgoing.contains_key("/vault/a.md"));
        assert!(index.get_backlinks("/vault/b.md", &[]).is_empty());
    }

    // --- File map target resolution tests ---

    #[tokio::test]
    async fn test_build_routes_non_markdown_through_the_target_only_path() {
        // ‼️ This one goes through `build()` ON A REAL DIRECTORY, and it has to.
        //
        // Every other test here calls the register_* functions directly, so none of them
        // can see WHICH of the two the build loop picks. Swapping `register_link_target`
        // for `register_file_path` in that loop — the mutation that puts a PDF into
        // file_map under its stem, stealing `[[attention]]` from the companion note —
        // left the whole suite green. The property lives at the call site, so the test
        // has to reach the call site.
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().to_string_lossy().to_string();

        let papers = dir.path().join("papers");
        let companions = dir.path().join("highlights").join("papers");
        tokio::fs::create_dir_all(&papers).await.expect("mkdir");
        tokio::fs::create_dir_all(&companions).await.expect("mkdir");
        tokio::fs::write(papers.join("attention.pdf"), b"%PDF-1.4\n")
            .await
            .expect("write pdf");
        tokio::fs::write(companions.join("attention.md"), "quoted line ^abc123\n")
            .await
            .expect("write md");

        let mut index = LinkIndex::new();
        index.build(&root).await.expect("build");

        // The bare target keeps going to the note — the PDF never entered file_map.
        assert_eq!(
            index.resolve_target_from_map("attention"),
            Some(
                companions
                    .join("attention.md")
                    .to_string_lossy()
                    .into_owned()
            )
        );
        // …and the explicit form reaches the PDF, which is the point of §278.
        assert_eq!(
            index.resolve_target_from_map("attention.pdf"),
            Some(papers.join("attention.pdf").to_string_lossy().into_owned())
        );
    }

    #[test]
    fn test_removing_a_file_drops_its_link_target_keys() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        index.register_link_target("/vault/papers/attention.pdf", "/vault");
        assert!(index.resolve_target_from_map("attention.pdf").is_some());

        index.remove_file("/vault/papers/attention.pdf");
        assert_eq!(index.resolve_target_from_map("attention.pdf"), None);
    }

    #[test]
    fn test_file_map_updated_on_remove() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        index.register_file_path("/vault/notes/architecture.md", "/vault");

        assert!(index.resolve_target_from_map("architecture").is_some());

        index.remove_file("/vault/notes/architecture.md");

        assert_eq!(index.resolve_target_from_map("architecture"), None);
    }

    // §87 Cross-vault alias in index
    #[test]
    fn test_cross_vault_link_indexed() {
        let mut index = LinkIndex::new();
        index.update_file_from_content("/vault/a.md", "See [[journal::2026-03-22]] here.");

        let outgoing = index.outgoing.get("/vault/a.md").unwrap();
        assert_eq!(outgoing.len(), 1);
        assert_eq!(outgoing[0].target, "2026-03-22");
        assert_eq!(outgoing[0].target_vault_alias, Some("journal".to_string()));
    }

    #[test]
    fn test_id_map_populated_and_cleared() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/z".to_string());
        index.register_file_path("/z/notes/202607051530 원자적 노트.md", "/z");
        index.register_file_path("/z/inbox/202607051531.md", "/z");
        index.register_file_path("/z/notes/architecture.md", "/z"); // no id
        assert_eq!(index.id_map_len(), 2);
        index.remove_file("/z/notes/202607051530 원자적 노트.md");
        assert_eq!(index.id_map_len(), 1);
    }

    #[test]
    fn test_backlinks_by_id() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/z".to_string());
        index.register_file_path("/z/notes/202607051530 원자적 노트.md", "/z");
        index.register_file_path("/z/notes/202607051600 다른 노트.md", "/z");
        // "다른 노트" links to the first note via [[202607051530]]
        index.update_file_from_content(
            "/z/notes/202607051600 다른 노트.md",
            "본문 [[202607051530]] 참조",
        );
        let backlinks = index.get_backlinks("/z/notes/202607051530 원자적 노트.md", &[]);
        assert_eq!(backlinks.len(), 1);
        assert_eq!(
            backlinks[0].source_path,
            "/z/notes/202607051600 다른 노트.md"
        );
    }

    #[test]
    fn test_file_map_updated_on_incremental_update() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());

        // Simulate adding a new file via incremental update
        index.update_file_from_content("/vault/notes/new-note.md", "Some content with [[other]].");

        // The new file should be in the file map
        let resolved = index.resolve_target_from_map("new-note");
        assert_eq!(resolved, Some("/vault/notes/new-note.md".to_string()));
    }

    #[test]
    fn backlinks_come_in_source_path_order_whatever_key_filed_them() {
        // Three referrers, each filed under a different key of
        // `/v/dir/note.md` — its stem, its path, and its path behind the
        // vault's own alias — registered out of alphabetical order.
        // What fails this: dropping the sort in `get_backlinks` — the keys
        // are read Stem first, so `/v/z.md` comes first.
        let mut index = LinkIndex::new();
        index.root_path = Some("/v".to_string());
        index.update_file_from_content("/v/dir/note.md", "t");
        index.update_file_from_content("/v/z.md", "x\n[[note]]");
        index.update_file_from_content("/v/m.md", "[[work::dir/note]]");
        index.update_file_from_content("/v/a.md", "x\nx\n[[dir/note]]");
        let aliases = [LocalAlias {
            alias: "work".to_string(),
            root: "/v".to_string(),
        }];
        let order: Vec<(String, u32)> = index
            .get_backlinks("/v/dir/note.md", &aliases)
            .into_iter()
            .map(|b| (b.source_path, b.line))
            .collect();
        assert_eq!(
            order,
            vec![
                ("/v/a.md".to_string(), 3),
                ("/v/m.md".to_string(), 1),
                ("/v/z.md".to_string(), 2),
            ]
        );
    }
}

/// 스펙 0066 §5 — `baram backlinks` · `baram links` 는 호출마다 인덱스를 새로 만든다.
/// 그 비용을 잰다. 평소에는 건너뛴다.
///
/// ‼️ 반드시 릴리스로 잴 것(디버그는 정규식 · 문자열 처리가 한 자릿수 배 느리다):
/// cargo test --release --manifest-path src-tauri/Cargo.toml --lib \
///   -- --ignored --nocapture build_10k_files_timing
///
/// 픽스처에 링크가 있어야 한다. `extract_links` 는 `[[` · `((` 후보가 있는 파일에서만
/// literal 분석(pulldown-cmark)을 돌리므로, 링크 없는 본문으로 재면 그 비용이 통째로 빠진다
/// — 태스크 쪽 `scan_10k_files_timing` 의 본문이 그렇다. 방금 쓴 파일을 재므로 웜 캐시다.
#[cfg(test)]
mod build_bench {
    use super::*;
    use icu_normalizer::DecomposingNormalizerBorrowed;
    use tempfile::TempDir;

    #[tokio::test]
    #[ignore]
    async fn build_10k_files_timing() {
        time_build("ascii", &|i| format!("f{i}"), &|n| format!("d{n}"), false).await;
        // §390 The same vault with Korean names, stored decomposed (NFD) on
        // disk and typed composed (NFC) in the links: every key the build
        // spells is non-ASCII, so the fold (`normalizer::fold_name`) cannot take
        // its ASCII shortcut, and the keys from files reach it decomposed.
        time_build(
            "korean-nfd",
            &|i| format!("\u{B178}\u{D2B8}{i}"),
            &|n| format!("\u{D3F4}\u{B354}{n}"),
            true,
        )
        .await;
    }

    /// The 10,000-note vault: note `i` is `name(i)` in the folder
    /// `folder(i % 100)` and links to the next note by its name and to a far
    /// one by its path, with a block reference — the names stored decomposed
    /// when `decomposed`, the links always as `name` and `folder` spell them.
    /// Built three times; each build and a backlink query on note 1 are
    /// timed and printed under `label`.
    async fn time_build(
        label: &str,
        name: &dyn Fn(usize) -> String,
        folder: &dyn Fn(usize) -> String,
        decomposed: bool,
    ) {
        const FILES: usize = 10_000;
        let stored = |s: String| {
            if !decomposed {
                return s;
            }
            let d = DecomposingNormalizerBorrowed::new_nfd()
                .normalize(&s)
                .into_owned();
            assert_ne!(d, s, "{s:?} has nothing to decompose");
            d
        };
        let path_of = |i: usize| format!("{}/{}.md", stored(folder(i % 100)), stored(name(i)));
        let d = TempDir::new().unwrap();
        for i in 0..FILES {
            let next = (i + 1) % FILES;
            let far = (i * 7 + 13) % FILES;
            let body = format!(
                "---\ntags: [t{}]\n---\n# 문서 {i}\n\n[[{}]] 과 [[{}/{}|먼 문서]] 를 본다. #tag{}\n\n(({}#^blk{next}))\n\n본문 한 줄. ^blk{i}\n\n```md\n[[코드 안의 링크 {}]]\n```\n",
                i % 50,
                name(next),
                folder(far % 100),
                name(far),
                i % 20,
                name(next),
                name(far),
            );
            let p = d.path().join(path_of(i));
            tokio::fs::create_dir_all(p.parent().unwrap())
                .await
                .unwrap();
            tokio::fs::write(&p, body).await.unwrap();
        }
        if decomposed {
            // A volume that composes names would store these notes composed
            // and this variant would time no decomposed name at all; the
            // directory has to hold the decomposed spelling.
            let folder0 = stored(folder(0));
            let names: Vec<String> = std::fs::read_dir(d.path().join(&folder0))
                .unwrap()
                .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                .collect();
            assert!(
                names.contains(&format!("{}.md", stored(name(0)))),
                "the volume did not keep the decomposed names: {names:?}"
            );
        }
        let root = d.path().to_string_lossy().to_string();

        for round in 0..3 {
            let mut index = LinkIndex::new();
            let started = std::time::Instant::now();
            let stats = index.build(&root).await.unwrap();
            println!(
                "{label} round {round}: built index over {} files, {} links, in {:?}",
                stats.files_indexed,
                stats.links_found,
                started.elapsed()
            );
            assert_eq!(stats.files_indexed as usize, FILES);
            // 파일마다 위키링크 둘과 블록 참조 하나. 코드 펜스 안의 `[[…]]` 는 세지 않는다 —
            // 이 숫자가 4만이면 literal 분석이 돌지 않은 것이다.
            assert_eq!(stats.links_found as usize, FILES * 3);

            let probe = d.path().join(path_of(1)).to_string_lossy().to_string();
            let started = std::time::Instant::now();
            let backlinks = index.get_backlinks(&probe, &[]);
            println!(
                "{label} round {round}: get_backlinks -> {} in {:?}",
                backlinks.len(),
                started.elapsed()
            );
        }

        let started = std::time::Instant::now();
        let md = collect_md_files(&root).await.unwrap();
        println!(
            "{label} collect_md_files -> {} in {:?}",
            md.len(),
            started.elapsed()
        );
        let started = std::time::Instant::now();
        let all = collect_all_files(&root).await.unwrap();
        println!(
            "{label} collect_all_files -> {} in {:?}",
            all.len(),
            started.elapsed()
        );
    }
}
