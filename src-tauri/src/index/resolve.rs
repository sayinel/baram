//! The maps a `[[name]]` is resolved through and the graph built on them (§29).

use super::normalizer::{
    extract_id_from_stem, is_id_target, normalize_file_path, normalize_target, resolve_target,
    strip_extension_and_fold,
};
use super::{LinkEdge, LinkEntry, LinkGraph, LinkIndex, LinkResolution};

impl LinkIndex {
    /// Register a file path in file_map and relative_map for target resolution
    pub(super) fn register_file_path(&mut self, file_path: &str, root_path: &str) {
        let stem = normalize_file_path(file_path);
        let paths = self.file_map.entry(stem.clone()).or_default();
        if !paths.contains(&file_path.to_string()) {
            paths.push(file_path.to_string());
        }

        // Build relative path mapping (e.g., "notes/architecture" → "/vault/notes/architecture.md")
        if let Some(rel) = file_path.strip_prefix(root_path) {
            let rel = rel
                .strip_prefix('/')
                .or_else(|| rel.strip_prefix('\\'))
                .unwrap_or(rel);
            let rel_normalized = strip_extension_and_fold(rel);
            self.relative_map
                .insert(rel_normalized, file_path.to_string());
        }

        // Register id → path for [[ID]] resolution (Zettelkasten)
        if let Some(id) = extract_id_from_stem(&stem) {
            self.id_map.insert(id, file_path.to_string());
        }
    }

    /// §278 Register a file as a wikilink TARGET only — `name_map` and nothing else.
    ///
    /// ‼️ Deliberately NOT `register_file_path`. That one also fills `file_map` (keyed by
    /// file stem) and `relative_map`, and a PDF landing in `file_map` would put
    /// `Paper.pdf` under the stem `paper` — the same key its highlight companion note
    /// uses, since `companionPathFor` derives one name from the other. Whichever
    /// registered first would then win a bare `[[Paper]]`, silently changing where an
    /// existing link points. Confining non-markdown files to `name_map` keeps the stem
    /// and relative lookups exactly as they were: this can only add resolutions.
    ///
    /// Both the bare name and the vault-relative path are registered, because
    /// `normalize_target` strips only markdown extensions — `[[Paper.pdf]]` normalises to
    /// `paper.pdf` and `[[papers/Paper.pdf]]` to `papers/paper.pdf`, and both forms have
    /// to find the file.
    pub(super) fn register_link_target(&mut self, file_path: &str, root_path: &str) {
        let mut keys: Vec<String> = Vec::new();

        if let Some(name) = std::path::Path::new(file_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
        {
            keys.push(name);
        }

        if let Some(rel) = file_path.strip_prefix(root_path) {
            let rel = rel
                .strip_prefix('/')
                .or_else(|| rel.strip_prefix('\\'))
                .unwrap_or(rel)
                .to_lowercase();
            if !keys.contains(&rel) {
                keys.push(rel);
            }
        }

        for key in keys {
            let paths = self.name_map.entry(key).or_default();
            if !paths.contains(&file_path.to_string()) {
                paths.push(file_path.to_string());
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn id_map_len(&self) -> usize {
        self.id_map.len()
    }

    /// Resolve a wikilink target to an actual file path using file maps.
    /// Falls back to None if no matching file is found.
    pub(super) fn resolve_target_from_map(&self, target_normalized: &str) -> Option<String> {
        // 0) Zettelkasten [[ID]] — bare timestamp id resolves via id_map (subfolder-agnostic)
        if is_id_target(target_normalized) {
            if let Some(path) = self.id_map.get(target_normalized) {
                return Some(path.clone());
            }
        }

        // 1) Try relative path match (for [[path/name]] style targets)
        if let Some(path) = self.relative_map.get(target_normalized) {
            return Some(path.clone());
        }

        // 2) Extract stem (last path component) for stem-only lookup
        let stem = target_normalized
            .rsplit('/')
            .next()
            .unwrap_or(target_normalized);

        // 3) Look up in file_map
        if let Some(paths) = self.file_map.get(stem) {
            if !paths.is_empty() {
                return Some(paths[0].clone());
            }
        }

        // 4) §278 Full file name, extension included — `[[Paper.pdf]]`.
        //
        // ‼️ LAST, exactly like the frontend resolver. The order is the safety property:
        // every target that resolves today is decided above, so this step can only add
        // resolutions, never change one. In particular a bare `[[Paper]]` keeps going to
        // the markdown note (which, for a PDF, is its highlight companion — they share a
        // stem because companionPathFor builds one from the other). The one exception is
        // a link that spells a note extension: `resolve_link` first looks for the note
        // of that full name (`spelled_note_name`), and only when there is none does the
        // link reach this chain.
        if let Some(paths) = self.name_map.get(target_normalized) {
            if !paths.is_empty() {
                return Some(paths[0].clone());
            }
        }

        None
    }

    /// The file a link that spells a note extension names by its full name —
    /// `[[x.markdown]]` beside `x.md` is `x.markdown`, and `[[x.md]]` is `x.md`,
    /// where the chain would answer whichever of the two its maps hold for `x`
    /// (`relative_map` keeps the last registered, `file_map` lists the first).
    /// The frontend's `resolveWikilinkTarget` (`src/utils/editor/wikilink-nav.ts`)
    /// never strips the extension: its stem pass compares the target as written
    /// and its last pass, `resolveByExactFileName`, matches the full name, so the
    /// spelled name wins there too.
    ///
    /// The candidates are the notes under the target's stem in `file_map`,
    /// matched by file name, or by root-relative path when the link spells a
    /// path — the two keys `register_link_target` gives a file, and the two
    /// `resolveByExactFileName` compares. Not `name_map` itself: a save
    /// (`update_file_from_content`) drops the note from it through
    /// `remove_file` and re-registers it with `register_file_path` alone, so a
    /// saved note would miss there while `file_map` holds it again.
    ///
    /// `None` unless `normalize_target` stripped a note extension from `full`
    /// (`full != normalized`), so a target with none — `[[Paper]]`,
    /// `[[Paper.pdf]]` — takes exactly the chain in `resolve_target_from_map`,
    /// and the §278 order stays. The guard is needed: `file_map` is not only
    /// notes, since a save registers whatever path it is given
    /// (`update_file_from_content` → `register_file_path`), and an
    /// extension-less file's name equals its key, so `[[architecture]]` would
    /// match `architecture` by name. With no candidate, `[[foo.markdown]]`
    /// beside only `foo.md` falls through to the stem `foo`: the note, not the
    /// ghost `foo.markdown.md`.
    fn spelled_note_name(&self, full: &str, normalized: &str) -> Option<String> {
        if full == normalized {
            return None;
        }
        let stem = normalized.rsplit('/').next().unwrap_or(normalized);
        let spelled_as = |path: &&String| {
            let name = std::path::Path::new(path.as_str())
                .file_name()
                .map(|n| n.to_string_lossy().to_lowercase());
            let relative = self.root_path.as_deref().and_then(|root| {
                let rel = path.strip_prefix(root)?;
                let rel = rel
                    .strip_prefix('/')
                    .or_else(|| rel.strip_prefix('\\'))
                    .unwrap_or(rel);
                Some(rel.to_lowercase())
            });
            name.as_deref() == Some(full) || relative.as_deref() == Some(full)
        };
        self.file_map.get(stem)?.iter().find(spelled_as).cloned()
    }

    /// Resolve a link's target to an indexed file, preferring its spelled
    /// note extension before the normalized map lookup. `get_link_graph`
    /// asks here for each entry when the index has a root, including entries
    /// behind a vault alias, whose edges it marks `cross_vault`.
    /// `outgoing_resolved` asks here only for entries without a vault alias.
    fn resolve_link(&self, raw_target: &str) -> Option<String> {
        let normalized = normalize_target(raw_target);
        let full = raw_target.trim().to_lowercase();
        self.spelled_note_name(&full, &normalized)
            .or_else(|| self.resolve_target_from_map(&normalized))
    }

    /// Get the full link graph
    pub fn get_link_graph(&self) -> LinkGraph {
        let mut nodes_set = std::collections::HashSet::new();
        let mut edges = Vec::new();

        for (source, entries) in &self.outgoing {
            nodes_set.insert(source.clone());
            for entry in entries {
                let target_normalized = normalize_target(&entry.target);
                if let Some(root) = &self.root_path {
                    // Use file maps for accurate resolution, fall back to simple path construction
                    let target_path = self
                        .resolve_link(&entry.target)
                        .unwrap_or_else(|| resolve_target(root, &target_normalized));
                    nodes_set.insert(target_path.clone());
                    edges.push(LinkEdge {
                        from: source.clone(),
                        to: target_path,
                        cross_vault: entry.target_vault_alias.is_some(),
                    });
                }
            }
        }

        // Add tag virtual nodes and file→tag edges
        for (file_path, tags) in &self.file_tags {
            if !nodes_set.contains(file_path) {
                continue; // skip files not in graph
            }
            for tag in tags {
                let tag_node_id = format!("tag:{}", tag);
                nodes_set.insert(tag_node_id.clone());
                edges.push(LinkEdge {
                    from: file_path.clone(),
                    to: tag_node_id,
                    cross_vault: false,
                });
            }
        }

        LinkGraph {
            nodes: nodes_set.into_iter().collect(),
            edges,
        }
    }

    /// §387 The links `file_path` holds, each with how `baram links` reports it: the file
    /// the graph's resolver (`resolve_link`) finds for the target, or, for a
    /// cross-vault link, its alias.
    ///
    /// `None` when `outgoing` holds nothing under that exact string: the file is not
    /// markdown, the walk skips it, it could not be read, it is a symlink (the walkers do
    /// not follow one), or the path is spelled under another root string than the one
    /// `build` received. A note with no links is `Some(vec![])` — `build` files every
    /// markdown file it reads under `outgoing`, linked or not.
    ///
    /// ONE method rather than three exposed pieces, because the ORDER is the contract.
    /// A cross-vault link is decided first: its `target` is the bare note name, so
    /// asking the maps would resolve `[[journal::x]]` to a local `x.md`. Then the target
    /// is passed to `resolve_link`, which checks its spelled note extension and
    /// normalized maps. So for a cross-vault link this is NOT what `get_link_graph`
    /// does: the graph asks the maps for every entry, alias or not, and only marks
    /// the edge `cross_vault`.
    ///
    /// Otherwise it is the GRAPH's resolution, not the editor's click-through: no
    /// `[[./x]]` relative to the source, no journal dates, and a path-qualified target
    /// that misses falls back to its stem.
    pub(crate) fn outgoing_resolved(
        &self,
        file_path: &str,
    ) -> Option<Vec<(LinkEntry, LinkResolution)>> {
        let entries = self.outgoing.get(file_path)?;
        Some(
            entries
                .iter()
                .map(|entry| {
                    let resolution = match &entry.target_vault_alias {
                        Some(alias) => LinkResolution::OtherVault(alias.clone()),
                        None => match self.resolve_link(&entry.target) {
                            Some(path) => LinkResolution::Resolved(path),
                            None => LinkResolution::Unresolved,
                        },
                    };
                    (entry.clone(), resolution)
                })
                .collect(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_name_lookup_runs_after_the_stem_and_relative_lookups() {
        // ‼️ This fixture is SYNTHETIC on purpose, and it has to be.
        //
        // The obvious ordering test — a PDF beside its companion note — cannot fail: the
        // PDF's name_map keys carry an extension ("attention.pdf") while a bare
        // `[[attention]]` normalises without one, so the name lookup misses no matter
        // where it sits. A mutation that hoists it above the stem lookup survived that
        // test, which is how this gap was found.
        //
        // The two orders are only distinguishable when a name_map key equals a target
        // that the earlier maps also answer. An extension-LESS file does that: it
        // registers under "notes/architecture", the exact key `relative_map` builds for
        // "notes/architecture.md" (normalize_target strips the markdown extension).
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        index.register_file_path("/vault/notes/architecture.md", "/vault");
        index.register_link_target("/vault/notes/architecture", "/vault");

        // Markdown wins — hoisting the name lookup returns the extension-less file here.
        assert_eq!(
            index.resolve_target_from_map("notes/architecture"),
            Some("/vault/notes/architecture.md".to_string())
        );
        assert_eq!(
            index.resolve_target_from_map("architecture"),
            Some("/vault/notes/architecture.md".to_string())
        );
    }

    /// An index over `/vault` whose `r.md` holds `content`, built the way
    /// `build` registers files: the markdown pass over the names ending in
    /// `.md` or `.markdown` (`collect_md_files`' filter), then every file as a
    /// target. Then each of `saved` is saved (`update_file_from_content`), as
    /// a save after the build does. The edge targets from `r.md`, in the order
    /// its links are written (`get_link_graph` walks each source's entries in
    /// order).
    fn graph_targets_of(files: &[&str], saved: &[&str], content: &str) -> Vec<String> {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        for file in files {
            if file.ends_with(".md") || file.ends_with(".markdown") {
                index.register_file_path(file, "/vault");
            }
        }
        for file in files {
            index.register_link_target(file, "/vault");
        }
        for file in saved {
            index.update_file_from_content(file, "");
        }
        index.update_file_from_content("/vault/r.md", content);
        index
            .get_link_graph()
            .edges
            .into_iter()
            .filter(|e| e.from == "/vault/r.md")
            .map(|e| e.to)
            .collect()
    }

    /// `outgoing_resolved` for `/vault/r.md` holding `content`, over an index
    /// registered as `graph_targets_of` registers one: each link's resolution,
    /// in the order written.
    fn outgoing_of(files: &[&str], content: &str) -> Vec<LinkResolution> {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        for file in files {
            if file.ends_with(".md") || file.ends_with(".markdown") {
                index.register_file_path(file, "/vault");
            }
        }
        for file in files {
            index.register_link_target(file, "/vault");
        }
        index.update_file_from_content("/vault/r.md", content);
        index
            .outgoing_resolved("/vault/r.md")
            .expect("r.md is indexed")
            .into_iter()
            .map(|(_, resolution)| resolution)
            .collect()
    }

    #[test]
    fn test_outgoing_resolved_answers_a_spelled_note_extension_by_its_full_name() {
        // The expected files are spelled out: comparing resolver answers
        // from the graph and outgoing links would exercise `resolve_link` twice.
        // What fails this: bypassing `spelled_note_name` in `resolve_link` —
        // the first order resolves both targets to `/vault/x.md`.
        let resolved = |path: &str| LinkResolution::Resolved(path.to_string());
        for files in [
            ["/vault/x.markdown", "/vault/x.md", "/vault/r.md"],
            ["/vault/x.md", "/vault/x.markdown", "/vault/r.md"],
        ] {
            assert_eq!(
                outgoing_of(&files, "[[x.md]]\n[[x.markdown]]\n"),
                vec![resolved("/vault/x.md"), resolved("/vault/x.markdown")],
                "{files:?}"
            );
        }
    }

    #[test]
    fn test_a_spelled_note_extension_resolves_by_the_full_name() {
        // `x.md` and `x.markdown` share the stem `x`. A link that spells the
        // extension names that file, as the frontend resolver reads it. A bare
        // `[[x]]` keeps the old chain: at the root `relative_map` answers
        // first, and its key `x` holds whichever of the two registered last.
        // `[[foo.markdown]]` with only `foo.md` reaches the note through its
        // stem — before the `.markdown` strip it was the ghost `foo.markdown.md`.
        // What fails this: removing the `spelled_note_name` step from
        // `resolve_link` — `[[x.markdown]]` and `[[x.md]]` both answer the
        // last registered, so one of the two orders below goes red.
        let files = [
            "/vault/x.md",
            "/vault/x.markdown",
            "/vault/foo.md",
            "/vault/r.md",
        ];
        assert_eq!(
            graph_targets_of(
                &files,
                &[],
                "[[x.markdown]]\n[[x.md]]\n[[x]]\n[[foo.markdown]]\n"
            ),
            vec![
                "/vault/x.markdown",
                "/vault/x.md",
                "/vault/x.markdown",
                "/vault/foo.md"
            ]
        );
        let files = ["/vault/x.markdown", "/vault/x.md", "/vault/r.md"];
        assert_eq!(
            graph_targets_of(&files, &[], "[[x.markdown]]\n[[x.md]]\n[[x]]\n"),
            vec!["/vault/x.markdown", "/vault/x.md", "/vault/x.md"]
        );
    }

    #[test]
    fn test_a_saved_note_is_still_found_by_its_spelled_name() {
        // A save drops the note from `name_map` (`remove_file`) and
        // re-registers it in the stem maps alone, so the spelled name is
        // looked for among the stem's notes. Under `d/`, `relative_map` does
        // not answer a bare target, and after the save `file_map` lists
        // `x.markdown` first.
        // What fails this: looking the full name up in `name_map` instead —
        // `[[x.md]]` misses there and the stem answers `/vault/d/x.markdown`.
        let files = ["/vault/d/x.md", "/vault/d/x.markdown", "/vault/r.md"];
        assert_eq!(
            graph_targets_of(&files, &["/vault/d/x.md"], "[[x.md]]\n[[d/x.md]]\n"),
            vec!["/vault/d/x.md", "/vault/d/x.md"]
        );
    }

    #[test]
    fn test_a_target_without_a_note_extension_takes_the_old_chain_in_the_graph() {
        // §278 in the graph: a save registers whatever path it is given, so
        // an extension-less `architecture` saved beside the note lands under
        // the same stem. A link spelling no note extension must not be
        // matched by full name, or `[[architecture]]` would leave the note,
        // first under the stem, for that file.
        // What fails this: dropping the `full == normalized` guard from
        // `spelled_note_name` — the edge goes to `/vault/notes/architecture`.
        let files = ["/vault/notes/architecture.md", "/vault/r.md"];
        assert_eq!(
            graph_targets_of(&files, &["/vault/notes/architecture"], "[[architecture]]\n"),
            vec!["/vault/notes/architecture.md"]
        );
    }

    #[test]
    fn test_resolve_pdf_target_by_full_name() {
        // §278 `[[Paper.pdf]]` — normalize_target strips only markdown extensions, so the
        // target stays "paper.pdf" while file_map is keyed by the stem "paper".
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        index.register_link_target("/vault/papers/attention.pdf", "/vault");

        assert_eq!(
            index.resolve_target_from_map("attention.pdf"),
            Some("/vault/papers/attention.pdf".to_string())
        );
    }

    #[test]
    fn test_resolve_pdf_target_by_relative_path() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        index.register_link_target("/vault/papers/attention.pdf", "/vault");

        assert_eq!(
            index.resolve_target_from_map("papers/attention.pdf"),
            Some("/vault/papers/attention.pdf".to_string())
        );
    }

    #[test]
    fn test_bare_target_still_resolves_to_the_markdown_note() {
        // ‼️ THE safety property. A PDF and its highlight companion note share a stem by
        // construction (companionPathFor). Registering the PDF must not steal `[[x]]`
        // from the note — non-markdown files go into name_map alone, and the name lookup
        // runs last.
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        index.register_link_target("/vault/papers/attention.pdf", "/vault");
        index.register_file_path("/vault/highlights/papers/attention.md", "/vault");

        assert_eq!(
            index.resolve_target_from_map("attention"),
            Some("/vault/highlights/papers/attention.md".to_string())
        );
        // …and the explicit form still reaches the PDF.
        assert_eq!(
            index.resolve_target_from_map("attention.pdf"),
            Some("/vault/papers/attention.pdf".to_string())
        );
    }

    #[test]
    fn test_link_target_registration_is_case_insensitive() {
        // The real file is "Survey.PDF"; a case-sensitive filesystem will not open a
        // lower-cased path, so the stored value must be the path as it is on disk.
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        index.register_link_target("/vault/papers/Survey.PDF", "/vault");

        assert_eq!(
            index.resolve_target_from_map("survey.pdf"),
            Some("/vault/papers/Survey.PDF".to_string())
        );
    }

    #[test]
    fn test_resolve_target_stem_only() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        index.register_file_path("/vault/notes/architecture.md", "/vault");

        let resolved = index.resolve_target_from_map("architecture");
        assert_eq!(resolved, Some("/vault/notes/architecture.md".to_string()));
    }

    #[test]
    fn test_resolve_target_with_relative_path() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        index.register_file_path("/vault/notes/architecture.md", "/vault");

        let resolved = index.resolve_target_from_map("notes/architecture");
        assert_eq!(resolved, Some("/vault/notes/architecture.md".to_string()));
    }

    #[test]
    fn test_resolve_target_not_found() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        index.register_file_path("/vault/notes/architecture.md", "/vault");

        let resolved = index.resolve_target_from_map("nonexistent");
        assert_eq!(resolved, None);
    }

    #[test]
    fn test_resolve_target_multiple_same_stem() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        index.register_file_path("/vault/a/readme.md", "/vault");
        index.register_file_path("/vault/b/readme.md", "/vault");
        index.register_file_path("/vault/c/readme.markdown", "/vault");

        // Stem-only: returns first registered
        let resolved = index.resolve_target_from_map("readme");
        assert!(resolved.is_some());

        // With relative path: resolves to specific one
        let resolved_a = index.resolve_target_from_map("a/readme");
        assert_eq!(resolved_a, Some("/vault/a/readme.md".to_string()));

        let resolved_b = index.resolve_target_from_map("b/readme");
        assert_eq!(resolved_b, Some("/vault/b/readme.md".to_string()));

        // A `.markdown` note is keyed by its path without the extension too.
        // What fails this, and no other test: making `register_file_path`
        // strip only `.md` from the root-relative path — `relative_map` then
        // holds `c/readme.markdown`, and the stem lookup answers
        // `a/readme.md`, registered first.
        let resolved_c = index.resolve_target_from_map("c/readme");
        assert_eq!(resolved_c, Some("/vault/c/readme.markdown".to_string()));
    }

    #[test]
    fn test_resolve_target_case_insensitive() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());
        index.register_file_path("/vault/Notes/My Note.md", "/vault");

        // normalize_target lowercases, so lookup should match
        let resolved = index.resolve_target_from_map("my note");
        assert_eq!(resolved, Some("/vault/Notes/My Note.md".to_string()));
    }

    #[test]
    fn test_link_graph_resolves_across_subdirs() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());

        // Register files in subdirectories
        index.register_file_path("/vault/notes/architecture.md", "/vault");
        index.register_file_path("/vault/daily/2024-01-15.md", "/vault");

        // Daily file links to architecture note via wikilink
        index.update_file_from_content(
            "/vault/daily/2024-01-15.md",
            "Today I worked on [[architecture]].",
        );

        let graph = index.get_link_graph();

        // The edge should point to the actual file in notes/, not ghost at /vault/architecture.md
        assert!(
            graph
                .edges
                .iter()
                .any(|e| e.from == "/vault/daily/2024-01-15.md"
                    && e.to == "/vault/notes/architecture.md"),
            "Edge should resolve to actual file path: {:?}",
            graph.edges
        );

        // No ghost node at /vault/architecture.md
        assert!(
            !graph.nodes.contains(&"/vault/architecture.md".to_string()),
            "Should not create ghost node at root level"
        );
    }

    #[test]
    fn test_link_graph_chain_daily_note_subnote() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/vault".to_string());

        // Register all files
        index.register_file_path("/vault/daily/2024-01-15.md", "/vault");
        index.register_file_path("/vault/notes/project-x.md", "/vault");
        index.register_file_path("/vault/notes/sub/design.md", "/vault");

        // daily → project-x → design chain
        index
            .update_file_from_content("/vault/daily/2024-01-15.md", "Started [[project-x]] today.");
        index.update_file_from_content("/vault/notes/project-x.md", "See [[design]] for details.");

        let graph = index.get_link_graph();

        // Both edges should resolve to actual files
        assert!(
            graph
                .edges
                .iter()
                .any(|e| e.from == "/vault/daily/2024-01-15.md"
                    && e.to == "/vault/notes/project-x.md")
        );
        assert!(
            graph
                .edges
                .iter()
                .any(|e| e.from == "/vault/notes/project-x.md"
                    && e.to == "/vault/notes/sub/design.md")
        );
    }

    #[test]
    fn test_resolve_id_target_across_subfolders() {
        let mut index = LinkIndex::new();
        index.root_path = Some("/z".to_string());
        index.register_file_path("/z/notes/202607051530 원자적 노트.md", "/z");
        // [[202607051530]] resolves to the id-prefixed file in the subfolder
        assert_eq!(
            index.resolve_target_from_map("202607051530"),
            Some("/z/notes/202607051530 원자적 노트.md".to_string())
        );
        // a non-id target is unaffected (existing stem/relative behavior)
        index.register_file_path("/z/architecture.md", "/z");
        assert_eq!(
            index.resolve_target_from_map("architecture"),
            Some("/z/architecture.md".to_string())
        );
    }
}

#[cfg(test)]
mod outgoing_tests {
    use super::*;
    use tempfile::TempDir;

    async fn index_over(files: &[(&str, &str)]) -> (TempDir, String, LinkIndex) {
        let dir = TempDir::new().unwrap();
        for (name, body) in files {
            let path = dir.path().join(name);
            tokio::fs::create_dir_all(path.parent().unwrap())
                .await
                .unwrap();
            tokio::fs::write(&path, body).await.unwrap();
        }
        let root = dir.path().to_string_lossy().to_string();
        let mut index = LinkIndex::new();
        index.build(&root).await.unwrap();
        (dir, root, index)
    }

    fn path_in(root: &str, name: &str) -> String {
        std::path::Path::new(root)
            .join(name)
            .to_string_lossy()
            .to_string()
    }

    #[tokio::test]
    async fn outgoing_links_resolve_as_the_graph_resolves_them_except_cross_vault_ones() {
        let (_dir, root, index) = index_over(&[
            (
                "notes/a.md",
                "[[b]] and [[missing]]\n((b#^x1))\n[[journal::b]]\n[[B]]\n",
            ),
            ("notes/b.md", "# B\n"),
        ])
        .await;
        let b = path_in(&root, "notes/b.md");

        let links = index
            .outgoing_resolved(&path_in(&root, "notes/a.md"))
            .expect("a.md is indexed");
        let seen: Vec<(&str, u32, &LinkResolution)> = links
            .iter()
            .map(|(entry, resolution)| (entry.target.as_str(), entry.line, resolution))
            .collect();
        assert_eq!(
            seen,
            vec![
                ("b", 1, &LinkResolution::Resolved(b.clone())),
                ("missing", 1, &LinkResolution::Unresolved),
                ("b", 2, &LinkResolution::Resolved(b.clone())),
                // The target is the bare name `b`, and a local b.md exists — it must
                // still not be resolved here: the link names another vault.
                ("b", 3, &LinkResolution::OtherVault("journal".to_string())),
                // Written with another case: the target is normalized before the maps
                // are asked.
                ("B", 4, &LinkResolution::Resolved(b)),
            ]
        );
    }

    #[tokio::test]
    async fn a_note_without_links_is_indexed_and_a_file_outside_the_index_is_not() {
        let (_dir, root, index) =
            index_over(&[("a.md", "no links\n"), ("data.txt", "[[a]]\n")]).await;
        // `LinkEntry` has no `PartialEq`, so the three answers are told apart by shape.
        assert!(index
            .outgoing_resolved(&path_in(&root, "a.md"))
            .is_some_and(|links| links.is_empty()));
        assert!(index
            .outgoing_resolved(&path_in(&root, "data.txt"))
            .is_none());
        assert!(index
            .outgoing_resolved(&path_in(&root, "nope.md"))
            .is_none());
    }

    /// One link per branch of the resolver, each on a line of its own. Two notes share
    /// the stem `b`, so a lookup by stem alone answers the same file for `[[notes/b]]` and
    /// `[[x/b]]` whichever the walk met first, and one of the two is wrong; `c` is the
    /// only note of that stem, so `[[wrong/c]]` can only get there by falling back to it.
    /// The expected path list pins the map branches. The second half pins the
    /// edge count and the graph's destinations for `OtherVault` and `Unresolved`.
    /// Its `Resolved` comparison repeats the shared `resolve_link` answer;
    /// spelled-extension resolution is pinned to explicit paths by
    /// `test_outgoing_resolved_answers_a_spelled_note_extension_by_its_full_name`.
    #[tokio::test]
    async fn every_branch_of_the_resolver_is_reached_and_agrees_with_the_graph() {
        let (_dir, root, index) = index_over(&[
            (
                "a.md",
                "[[notes/b]]\n[[x/b]]\n[[Notes/B]]\n[[wrong/c]]\n[[Paper.pdf]]\n\
                 [[papers/Paper.pdf]]\n[[202607051530]]\n[[nothing]]\n((#^self1))\n\
                 [[journal::c]]\n",
            ),
            ("notes/b.md", "# B\n"),
            ("x/b.md", "# other B\n"),
            ("deep/er/c.md", "# C\n"),
            ("papers/Paper.pdf", "not markdown\n"),
            ("z/202607051530 idea.md", "# idea\n"),
        ])
        .await;
        let at = |name: &str| path_in(&root, name);
        let a = at("a.md");

        let links = index.outgoing_resolved(&a).expect("a.md is indexed");
        let seen: Vec<(&str, u32, LinkResolution)> = links
            .iter()
            .map(|(entry, resolution)| (entry.target.as_str(), entry.line, resolution.clone()))
            .collect();
        assert_eq!(
            seen,
            vec![
                // The relative path, then the same with another case.
                ("notes/b", 1, LinkResolution::Resolved(at("notes/b.md"))),
                ("x/b", 2, LinkResolution::Resolved(at("x/b.md"))),
                ("Notes/B", 3, LinkResolution::Resolved(at("notes/b.md"))),
                // No `wrong/c.md`: the stem is tried next.
                ("wrong/c", 4, LinkResolution::Resolved(at("deep/er/c.md"))),
                // A file that is not a note: by its name, and by its relative path.
                (
                    "Paper.pdf",
                    5,
                    LinkResolution::Resolved(at("papers/Paper.pdf"))
                ),
                (
                    "papers/Paper.pdf",
                    6,
                    LinkResolution::Resolved(at("papers/Paper.pdf")),
                ),
                // A Zettel id, in a folder of its own.
                (
                    "202607051530",
                    7,
                    LinkResolution::Resolved(at("z/202607051530 idea.md")),
                ),
                ("nothing", 8, LinkResolution::Unresolved),
                // `((#^id))` names no note: the target the index files is the note's own
                // file stem.
                ("a", 9, LinkResolution::Resolved(a.clone())),
                ("c", 10, LinkResolution::OtherVault("journal".to_string())),
            ]
        );

        let graph = index.get_link_graph();
        let edges: Vec<&LinkEdge> = graph
            .edges
            .iter()
            .filter(|edge| edge.from == a && !edge.to.starts_with("tag:"))
            .collect();
        assert_eq!(edges.len(), links.len());
        for ((entry, resolution), edge) in links.iter().zip(&edges) {
            match resolution {
                LinkResolution::Resolved(path) => {
                    assert_eq!(
                        (&edge.to, edge.cross_vault),
                        (path, false),
                        "{}",
                        entry.target
                    )
                }
                // The graph asks the maps for it too, and draws it to the local note.
                LinkResolution::OtherVault(_) => {
                    assert_eq!(
                        (edge.to.as_str(), edge.cross_vault),
                        (at("deep/er/c.md").as_str(), true)
                    )
                }
                LinkResolution::Unresolved => {
                    assert_eq!(edge.to, format!("{root}/nothing.md"), "{}", entry.target)
                }
            }
        }
    }

    /// `outgoing` is keyed by the strings the walk produced: the same note under another
    /// spelling of the root is not found, and neither is a symlink to a note — the
    /// walkers do not follow one. The first assertion is the control: the note itself.
    #[cfg(unix)]
    #[tokio::test]
    async fn only_the_walked_spelling_of_a_note_is_in_the_index() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("a.md"), "[[a]]\n").unwrap();
        std::os::unix::fs::symlink(dir.path().join("a.md"), dir.path().join("link.md")).unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let mut index = LinkIndex::new();
        index.build(&root).await.unwrap();

        assert!(index.outgoing_resolved(&path_in(&root, "a.md")).is_some());
        assert!(index.outgoing_resolved(&path_in(&root, "./a.md")).is_none());
        assert!(index
            .outgoing_resolved(&path_in(&root, "link.md"))
            .is_none());
    }
}
