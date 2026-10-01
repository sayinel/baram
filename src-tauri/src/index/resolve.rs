//! The maps a `[[name]]` is resolved through and the graph built on them (§29).

use super::normalizer::{
    extract_id_from_stem, is_id_target, normalize_file_path, normalize_target, resolve_target,
    strip_extension_and_fold,
};
use super::{LinkEdge, LinkGraph, LinkIndex};

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
        // stem because companionPathFor builds one from the other).
        if let Some(paths) = self.name_map.get(target_normalized) {
            if !paths.is_empty() {
                return Some(paths[0].clone());
            }
        }

        None
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
                        .resolve_target_from_map(&target_normalized)
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

        // Stem-only: returns first registered
        let resolved = index.resolve_target_from_map("readme");
        assert!(resolved.is_some());

        // With relative path: resolves to specific one
        let resolved_a = index.resolve_target_from_map("a/readme");
        assert_eq!(resolved_a, Some("/vault/a/readme.md".to_string()));

        let resolved_b = index.resolve_target_from_map("b/readme");
        assert_eq!(resolved_b, Some("/vault/b/readme.md".to_string()));
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
