//! §33 The notes a file rename reports for markdown-syntax links to the renamed file, which
//! it does not rewrite (`index::markdown_links`).

use crate::context::manager::Registered;
use crate::index::markdown_links::markdown_link_dangles;

use super::super::state::LinkIndexState;

/// Every note of the file's directory contexts (`dirs`, each index's `note_paths`) holding a
/// markdown link, image or link definition that the editor resolves to `old_path` and not to
/// `new_path` (`markdown_link_dangles`), read from disk before the move. The renamed note
/// itself, which may link to itself so, is named by its new path, as it is reported for its
/// wikilinks. A note that cannot be read now is passed over: whether it holds such a link
/// cannot be told, and the index never named it for one.
///
/// Only the notes an index holds are read: a file named `….md` or `….markdown`, in that case
/// (`crate::fs::is_note_name`), that the build walks to. A file outside that rule (`.mdx`,
/// `.MD`), a note in a folder the walk skips (a hidden one, or a `SKIP_DIRS` name), and
/// every note of a context whose index is not built (`with_index_for` hands over none) are
/// not read, so a link in one of them is not reported.
pub(super) async fn markdown_referrers(
    state: &LinkIndexState,
    dirs: &[Registered],
    old_path: &str,
    new_path: &str,
    windows: bool,
) -> Vec<String> {
    let mut notes: Vec<String> = Vec::new();
    for d in dirs {
        let found = state
            .with_index_for(&d.info.path, d.incarnation, |index| {
                index
                    .map(|index| index.note_paths().cloned().collect::<Vec<_>>())
                    .unwrap_or_default()
            })
            .await;
        for note in found {
            if !notes.contains(&note) {
                notes.push(note);
            }
        }
    }
    notes.sort();
    let mut reported = Vec::new();
    for note in notes {
        let Ok(content) = tokio::fs::read_to_string(&note).await else {
            continue;
        };
        if markdown_link_dangles(&content, &note, old_path, new_path, windows) {
            reported.push(if note == old_path {
                new_path.to_owned()
            } else {
                note
            });
        }
    }
    reported
}
