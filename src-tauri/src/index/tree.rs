//! §393 Changes to the link index that the incremental path had no way to make (spec 0072
//! §5.4): a link target that appeared after the build, a whole directory that went away, and a
//! note re-read that tells whether it changed anything. `index::service::sync` reaches them
//! through `Mutation::Target`, `Mutation::RemoveTree` and `Mutation::Update`.

use super::extractor::{extract_file_tags, extract_links};
use super::LinkIndex;
use std::collections::{BTreeSet, HashSet};
use std::path::Path;

impl LinkIndex {
    /// §393 Write `file_path` as read from `content` (`write_note`, what
    /// `update_file_from_content` does), unless it reads as what the index holds for it: the
    /// same link entries in `outgoing` (line and context included) and the same tags in
    /// `file_tags` — no entry there when there are none, as the write leaves it. Then nothing
    /// is written, the file maps included, and this returns `false`: every read of the index
    /// answers as before. The watcher's echo of a save is such a read. Tags are compared as
    /// sets: `extract_file_tags` collects through a `HashSet`, so two reads of one note list
    /// the same tags, once each, in orders that need not agree.
    pub(crate) fn update_file_unless_held(&mut self, file_path: &str, content: &str) -> bool {
        let entries = extract_links(file_path, content);
        let tags = extract_file_tags(content);
        let same_tags = match self.file_tags.get(file_path) {
            Some(held) => held.len() == tags.len() && tags.iter().all(|tag| held.contains(tag)),
            None => tags.is_empty(),
        };
        if same_tags && self.outgoing.get(file_path) == Some(&entries) {
            return false;
        }
        self.write_note(file_path, entries, tags);
        true
    }

    /// §278 · §393 Register `file_path` as a link target, as `build` does for every file it
    /// finds — `[[Paper.pdf]]` resolves once this ran. Does nothing for an index that was
    /// never built: without a root there is no vault-relative key to give the file.
    pub(crate) fn add_link_target(&mut self, file_path: &str) {
        if let Some(root) = self.root_path.clone() {
            self.register_link_target(file_path, &root);
        }
    }

    /// §393 Drop every note and link target at one of `dirs` or under it, comparing path
    /// components (`/v/dir` does not take `/v/dir-old/x.md`). Returns whether anything was there.
    ///
    /// ONE gather serves every dir: a candidate is doomed when one of its `Path::ancestors()`
    /// (the path itself included) is a dir, so a batch of N removed paths costs one scan of
    /// the maps, not N (a scan per path measured ~1.2 ms each on an 11,000-note index). Each
    /// doomed path is then removed through `remove_file`, so "remove a file" keeps one
    /// definition. The gathering is the part that can drift: a path held ONLY by a map not
    /// listed here would be missed — a new path-valued map in `LinkIndex` must be listed here
    /// as well as cleaned in `remove_file`.
    pub(crate) fn remove_trees(&mut self, dirs: &[&str]) -> bool {
        let dirs: HashSet<&Path> = dirs.iter().map(|dir| Path::new(*dir)).collect();
        let under = |path: &str| Path::new(path).ancestors().any(|a| dirs.contains(a));
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

    /// What fails this: a string-prefix comparison (`dir-old` would go too), or a gather that
    /// forgets `name_map`, the only map a non-note target sits in (the PDF would keep
    /// resolving). Forgetting any one of the other six fails no `index::` test (each was
    /// probed alone): a note sits in several maps, so another gather still finds it.
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

        assert!(index.remove_trees(&["/vault/dir"]));

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
        assert!(!index.remove_trees(&["/vault/elsewhere"]));
        assert!(index.outgoing_resolved("/vault/a.md").is_some());
    }

    /// What fails this: a gather that only honours the first dir, or one that compares a path
    /// with each dir by string prefix — `/vault/b-old` would go with `/vault/b`.
    #[test]
    fn several_trees_go_in_one_call_and_each_keeps_its_string_prefixed_sibling() {
        let mut index = index_at("/vault");
        for path in [
            "/vault/a/1.md",
            "/vault/b/sub/2.md",
            "/vault/b-old/3.md",
            "/vault/c/4.md",
        ] {
            index.update_file_from_content(path, "x");
        }

        assert!(index.remove_trees(&["/vault/a", "/vault/b", "/vault/nothing"]));

        assert!(index.outgoing_resolved("/vault/a/1.md").is_none());
        assert!(index.outgoing_resolved("/vault/b/sub/2.md").is_none());
        assert!(index.outgoing_resolved("/vault/b-old/3.md").is_some());
        assert!(index.outgoing_resolved("/vault/c/4.md").is_some());
        assert!(!index.remove_trees(&["/vault/a", "/vault/b"]));
    }

    #[test]
    fn a_tree_named_by_a_file_is_that_file() {
        let mut index = index_at("/vault");
        index.update_file_from_content("/vault/a.md", "x");
        assert!(index.remove_trees(&["/vault/a.md"]));
        assert!(index.outgoing_resolved("/vault/a.md").is_none());
    }
}
