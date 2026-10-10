//! §393 Changes to the link index that the incremental path had no way to make (spec 0072
//! §5.4): a link target that appeared after the build, and a whole directory that went away.
//! `index::service::sync` reaches them through `Mutation::Target` and `Mutation::RemoveTree`.

use super::LinkIndex;
use std::collections::BTreeSet;
use std::path::Path;

impl LinkIndex {
    /// §278 · §393 Register `file_path` as a link target, as `build` does for every file it
    /// finds — `[[Paper.pdf]]` resolves once this ran. Does nothing for an index that was
    /// never built: without a root there is no vault-relative key to give the file.
    pub(crate) fn add_link_target(&mut self, file_path: &str) {
        if let Some(root) = self.root_path.clone() {
            self.register_link_target(file_path, &root);
        }
    }

    /// §393 Drop every note and link target at `dir` or under it, comparing path components
    /// (`/v/dir` does not take `/v/dir-old/x.md`). Returns whether anything was there.
    ///
    /// The paths are gathered from every map below and each is then removed through
    /// `remove_file`, so "remove a file" keeps one definition. The gathering is the part that
    /// can drift: a path held ONLY by a map not listed here would be missed — a new path-valued
    /// map in `LinkIndex` must be listed here as well as cleaned in `remove_file`.
    pub(crate) fn remove_tree(&mut self, dir: &str) -> bool {
        let dir = Path::new(dir);
        let under = |path: &str| Path::new(path).starts_with(dir);
        let mut doomed: BTreeSet<String> = BTreeSet::new();
        doomed.extend(self.outgoing.keys().filter(|p| under(p.as_str())).cloned());
        doomed.extend(
            self.incoming
                .values()
                .flatten()
                .map(|entry| &entry.source_path)
                .filter(|p| under(p.as_str()))
                .cloned(),
        );
        doomed.extend(
            self.file_map
                .values()
                .flatten()
                .filter(|p| under(p.as_str()))
                .cloned(),
        );
        doomed.extend(
            self.relative_map
                .values()
                .filter(|p| under(p.as_str()))
                .cloned(),
        );
        doomed.extend(self.id_map.values().filter(|p| under(p.as_str())).cloned());
        doomed.extend(
            self.name_map
                .values()
                .flatten()
                .filter(|p| under(p.as_str()))
                .cloned(),
        );
        doomed.extend(self.file_tags.keys().filter(|p| under(p.as_str())).cloned());
        let found = !doomed.is_empty();
        for path in &doomed {
            self.remove_file(path);
        }
        found
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index_at(root: &str) -> LinkIndex {
        let mut index = LinkIndex::new();
        index.root_path = Some(root.to_string());
        index
    }

    #[test]
    fn a_target_added_after_the_build_resolves_by_name_and_by_path() {
        let mut index = index_at("/vault");
        assert_eq!(index.resolve_target_from_map("paper.pdf"), None);
        index.add_link_target("/vault/papers/Paper.pdf");
        assert_eq!(
            index.resolve_target_from_map("paper.pdf").as_deref(),
            Some("/vault/papers/Paper.pdf")
        );
        assert_eq!(
            index.resolve_target_from_map("papers/paper.pdf").as_deref(),
            Some("/vault/papers/Paper.pdf")
        );
    }

    #[test]
    fn an_index_that_was_never_built_takes_no_target() {
        let mut index = LinkIndex::new();
        index.add_link_target("/vault/paper.pdf");
        assert_eq!(index.resolve_target_from_map("paper.pdf"), None);
    }

    /// What fails this: a string-prefix comparison (`dir-old` would go too), or a map
    /// `remove_tree` forgets to gather from (the PDF target would stay).
    #[test]
    fn removing_a_tree_drops_what_is_under_it_and_keeps_its_string_prefixed_sibling() {
        let mut index = index_at("/vault");
        index.update_file_from_content("/vault/dir/a.md", "see [[d]] #tag");
        index.update_file_from_content("/vault/dir/sub/b.md", "see [[d]]");
        index.add_link_target("/vault/dir/p.pdf");
        index.update_file_from_content("/vault/dir-old/c.md", "see [[d]]");
        index.update_file_from_content("/vault/d.md", "plain");
        let sources = |index: &LinkIndex| -> Vec<String> {
            let mut s: Vec<String> = index
                .get_backlinks("/vault/d.md", &[])
                .into_iter()
                .map(|b| b.source_path)
                .collect();
            s.sort();
            s
        };
        assert_eq!(
            sources(&index),
            vec![
                "/vault/dir-old/c.md",
                "/vault/dir/a.md",
                "/vault/dir/sub/b.md"
            ]
        );

        assert!(index.remove_tree("/vault/dir"));

        assert!(index.outgoing_resolved("/vault/dir/a.md").is_none());
        assert!(index.outgoing_resolved("/vault/dir/sub/b.md").is_none());
        assert_eq!(index.resolve_target_from_map("p.pdf"), None);
        assert_eq!(sources(&index), vec!["/vault/dir-old/c.md"]);
        assert!(index.outgoing_resolved("/vault/d.md").is_some());
    }

    #[test]
    fn removing_a_tree_that_holds_nothing_reports_no_change() {
        let mut index = index_at("/vault");
        index.update_file_from_content("/vault/a.md", "x");
        assert!(!index.remove_tree("/vault/elsewhere"));
        assert!(index.outgoing_resolved("/vault/a.md").is_some());
    }

    #[test]
    fn a_tree_named_by_a_file_is_that_file() {
        let mut index = index_at("/vault");
        index.update_file_from_content("/vault/a.md", "x");
        assert!(index.remove_tree("/vault/a.md"));
        assert!(index.outgoing_resolved("/vault/a.md").is_none());
    }
}
