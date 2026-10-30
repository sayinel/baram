//! §273 · §275 · §33 The PDF highlight files a file rename carries along with the PDF: the
//! sidecar `.baram/pdf-highlights/{rel}.json` and the companion note `highlights/{rel}.md`,
//! both named after the PDF's path under a vault root (`{rel}`, its `.pdf` replaced). The
//! frontend creates them (`sidecarPathFor`, `companionPathFor` in
//! `src/components/editor/pdf/pdf-highlight-sidecar.ts`) under the root the PDF viewer reads
//! from, the active context's (`useFileStore.rootPath`). Both sides hold the rule, so both
//! test it against one fixture, `index/fixtures/pdf-highlight-paths.json`: the frontend names
//! the files, and only the rename knows the PDF moved.

use crate::context::manager::{resolve_canonical, Registered};
use crate::context::ContextManager;
use crate::index::filing::root_relative_path;
use std::path::PathBuf;

use super::super::state::LinkIndexState;
use super::destination::another_entry_at;
use super::file::{rename_file, Origin};
use super::{confined_by, MovedFile};

/// The sidecar's and the companion note's paths under a root for the PDF at `rel` under it —
/// `rel` with its last `.pdf`, matched without regard to ASCII case, replaced by `.json` and
/// `.md` (`/\.pdf$/i` in the frontend). `None` for a name that does not end so: the PDF
/// viewer opens no other file, so no highlight file is named after one.
pub(super) fn highlight_paths(rel: &str) -> Option<(String, String)> {
    let cut = rel.len().checked_sub(".pdf".len())?;
    if !rel.get(cut..)?.eq_ignore_ascii_case(".pdf") {
        return None;
    }
    let stem = &rel[..cut];
    Some((
        format!(".baram/pdf-highlights/{stem}.json"),
        format!("highlights/{stem}.md"),
    ))
}

/// What carrying the highlight files along produced, to fold into the PDF rename's result:
/// the files the companion note's rename rewrote, the files left behind — a highlight file
/// that did not move, or moved but still names the old PDF — and the files moved, the note
/// and the sidecar (`RenameResult::moved`).
#[derive(Default)]
pub(super) struct Carried {
    pub(super) updated: Vec<String>,
    pub(super) skipped: Vec<String>,
    pub(super) moved: Vec<MovedFile>,
}

/// Carry the highlight files of the PDF renamed from `old_path` to `new_path` — moved by now —
/// under each directory context in `dirs` that has them, the root they are named under being
/// unknown to the backend (the viewer's is whichever context was active).
///
/// Per root, the companion note goes first, as a note rename carried along (`rename_file`,
/// `Origin::Carried`): its referrers — `[[highlights/papers/Paper]]`,
/// `((highlights/papers/Paper#^id))`, and `[[Paper]]` unless another note shares the stem —
/// follow it under every rule a note rename keeps. Then the sidecar is moved and its two records rewritten
/// (`rewrite_records`). Each piece is left where it is, and its old path reported in
/// `skipped`, when: the new name is no PDF's, so no highlight file is named after it; the
/// destination is another entry (`another_entry_at`); the sidecar resolves outside the
/// contexts; or the move fails. Nothing is deleted: the PDF has moved — the point of no return
/// of the whole rename — and every piece that could not follow is still on disk under its old
/// name, and named in the result. Every piece that moved is named in `Carried::moved`, so the
/// frontend moves an open tab with it.
pub(super) async fn carry_pdf_highlights(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    dirs: &[Registered],
    old_path: &str,
    new_path: &str,
    windows: bool,
) -> Carried {
    let mut carried = Carried::default();
    for d in dirs {
        let root = d.info.path.as_str();
        let Some(old_rel) = root_relative_path(root, old_path, windows) else {
            continue;
        };
        let Some((old_sidecar, old_companion)) = highlight_paths(&old_rel) else {
            continue;
        };
        let new_rel = root_relative_path(root, new_path, windows);
        let new = new_rel.as_deref().and_then(highlight_paths);
        let new_companion = new.as_ref().map(|(_, companion)| companion.as_str());

        let companion_from = under(root, &old_companion);
        let companion_now = match exists(&companion_from).await {
            false => Companion::Absent,
            true => match new_companion {
                Some(rel) => {
                    let to = under(root, rel);
                    carry_companion(state, ctx_mgr, &companion_from, &to, &mut carried).await
                }
                None => Companion::Left,
            },
        };
        if companion_now == Companion::Left {
            carried.skipped.push(companion_from);
        }

        let sidecar_from = under(root, &old_sidecar);
        if !exists(&sidecar_from).await {
            continue;
        }
        let (Some((new_sidecar, new_companion)), Some(new_rel)) = (new.as_ref(), new_rel.as_ref())
        else {
            carried.skipped.push(sidecar_from);
            continue;
        };
        let sidecar_to = under(root, new_sidecar);
        let companion = (companion_now != Companion::Left).then_some(new_companion.as_str());
        let sidecar = carry_sidecar(&sidecar_from, &sidecar_to, dirs, new_rel, companion).await;
        // A rename that changes only the case of `.pdf` names the sidecar the same: its
        // records are rewritten in place, and nothing moved.
        if sidecar.moved && sidecar_from != sidecar_to {
            carried.moved.push(MovedFile {
                from: sidecar_from,
                to: sidecar_to,
            });
        }
        carried.skipped.extend(sidecar.left);
    }
    carried
}

/// What became of a PDF's companion note.
#[derive(Debug, PartialEq, Eq)]
enum Companion {
    /// There was none.
    Absent,
    /// Under the name the PDF's new name gives it: renamed with the PDF, or already so
    /// named when only the case of `.pdf` changed.
    Moved,
    /// Still under the old name.
    Left,
}

/// Rename the companion note from `from` to `to` as any note is renamed, its result folded
/// into `carried`. Left when `to` is another entry or the rename refuses; kept, with nothing
/// renamed, when `to` is `from` — a rename that changes only the case of `.pdf`, which both
/// names are cut at.
async fn carry_companion(
    state: &LinkIndexState,
    ctx_mgr: &ContextManager,
    from: &str,
    to: &str,
    carried: &mut Carried,
) -> Companion {
    if from == to {
        return Companion::Moved;
    }
    match another_entry_at(from, to) {
        Ok(false) => {}
        Ok(true) => {
            log::warn!("rename: {to} already exists, so the highlight note {from} keeps its name");
            return Companion::Left;
        }
        Err(e) => {
            log::warn!("rename: {to} could not be checked ({e}), so {from} keeps its name");
            return Companion::Left;
        }
    }
    // Boxed: a note rename never carries highlight files (`highlight_paths` reads no `.md`),
    // but the compiler sizes the future before it knows that.
    match Box::pin(rename_file(state, ctx_mgr, from, to, Origin::Carried)).await {
        Ok(result) => {
            carried.updated.extend(result.updated_files);
            carried.skipped.extend(result.skipped_files);
            carried.moved.push(MovedFile {
                from: from.to_owned(),
                to: to.to_owned(),
            });
            carried.moved.extend(result.moved);
            Companion::Moved
        }
        Err(e) => {
            log::warn!("rename: the highlight note {from} could not be renamed: {e}");
            Companion::Left
        }
    }
}

/// What `carry_sidecar` did: whether the sidecar moved, and the path to report — the old one
/// when it stayed, the new one when it moved with its records unchanged; none when it
/// followed whole.
struct SidecarCarried {
    moved: bool,
    left: Option<String>,
}

/// Move the sidecar from `from` to `to` and rewrite its records (`rewrite_records`): the PDF
/// is now `new_rel`, and the companion `companion` when that note is (or will be) there.
async fn carry_sidecar(
    from: &str,
    to: &str,
    dirs: &[Registered],
    new_rel: &str,
    companion: Option<&str>,
) -> SidecarCarried {
    let stayed = SidecarCarried {
        moved: false,
        left: Some(from.to_owned()),
    };
    // The rename writes only inside the file's contexts: a sidecar that resolves elsewhere
    // (a `.baram` planted as a symlink) is not moved.
    let inside = resolve_canonical(from).is_ok_and(|canonical| confined_by(&canonical, dirs));
    if !inside {
        log::warn!("rename: the highlight sidecar {from} resolves outside the file's contexts");
        return stayed;
    }
    match another_entry_at(from, to) {
        Ok(false) => {}
        Ok(true) | Err(_) => {
            log::warn!("rename: {to} is taken or unreadable, so the sidecar {from} stays");
            return stayed;
        }
    }
    let text = tokio::fs::read_to_string(from).await.ok();
    // `from` is `to` when only the case of `.pdf` changed: there is nothing to move, so the
    // OS is not asked to rename a path onto itself (a no-op on a POSIX host, where no test
    // can tell the two apart).
    if from != to {
        if let Err(e) = tokio::fs::rename(from, to).await {
            log::warn!("rename: the highlight sidecar {from} could not be moved: {e}");
            return stayed;
        }
    }
    let stale = SidecarCarried {
        moved: true,
        left: Some(to.to_owned()),
    };
    let rewritten = text.and_then(|text| rewrite_records(&text, new_rel, companion));
    let Some(rewritten) = rewritten else {
        log::warn!("rename: the highlight sidecar {to} was moved but could not be read as one; it still names the old PDF");
        return stale;
    };
    match crate::fs::write_file(to, &rewritten).await {
        Ok(()) => SidecarCarried {
            moved: true,
            left: None,
        },
        Err(e) => {
            log::warn!("rename: the highlight sidecar {to} was moved but not rewritten: {e}");
            stale
        }
    }
}

/// The sidecar `text` with its records of where things are — `pdf`, and `companion` when one
/// is given — set to the new paths, every other key and value kept; written as the frontend
/// writes a sidecar (`JSON.stringify(sidecar, null, 2)` and a line break), except for key
/// order: `serde_json` is built here without its `preserve_order` feature, so every object's
/// keys, nested ones included, come out sorted (`{"b":1,"a":2}` as `{"a":2,"b":1}`). The
/// frontend reads a key by its name. The feature is left off: it is one switch for every
/// crate in the build that uses `serde_json`'s map. `None` for text that is not a JSON object
/// whose records are strings,
/// which the frontend reads as no sidecar either (`parseSidecar`). The records, not the path
/// rule, are what the frontend opens an area highlight's PDF and a text highlight's note by
/// (`resolveHighlightRef`).
fn rewrite_records(text: &str, new_rel: &str, companion: Option<&str>) -> Option<String> {
    let mut value: serde_json::Value = serde_json::from_str(text).ok()?;
    let record = value.as_object_mut()?;
    if !record.get("pdf")?.is_string() || !record.get("companion")?.is_string() {
        return None;
    }
    record.insert("pdf".to_owned(), serde_json::Value::from(new_rel));
    if let Some(companion) = companion {
        record.insert("companion".to_owned(), serde_json::Value::from(companion));
    }
    let mut out = serde_json::to_string_pretty(&value).ok()?;
    out.push('\n');
    Some(out)
}

/// `rel`, a `/`-separated path under `root`, spelled under it with this host's separator, as
/// the walk spells a file.
fn under(root: &str, rel: &str) -> String {
    let mut path = PathBuf::from(root);
    for part in rel.split('/') {
        path.push(part);
    }
    path.to_string_lossy().into_owned()
}

/// Whether there is an entry at `path`, the last component not followed.
async fn exists(path: &str) -> bool {
    tokio::fs::symlink_metadata(path).await.is_ok()
}

#[cfg(test)]
mod tests {
    use super::{highlight_paths, rewrite_records};

    #[derive(serde::Deserialize)]
    struct Case {
        pdf: String,
        sidecar: String,
        companion: String,
        why: String,
    }

    #[derive(serde::Deserialize)]
    struct Fixture {
        cases: Vec<Case>,
    }

    #[test]
    fn the_highlight_paths_agree_with_the_fixture_the_frontend_reads() {
        // What fails this: replacing `.pdf` only in lower case — the `.PDF` case keeps it;
        // replacing every `.pdf` — `a.pdf.pdf` loses its first.
        let fixture: Fixture =
            serde_json::from_str(include_str!("../../fixtures/pdf-highlight-paths.json")).unwrap();
        assert!(!fixture.cases.is_empty());
        for case in &fixture.cases {
            assert_eq!(
                highlight_paths(&case.pdf),
                Some((case.sidecar.clone(), case.companion.clone())),
                "{}",
                case.why
            );
        }
        // A name the viewer never opens has none.
        assert_eq!(highlight_paths("papers/notes.txt"), None);
        assert_eq!(highlight_paths("pdf"), None);
    }

    #[test]
    fn a_sidecars_records_follow_the_rename_and_its_other_keys_stay() {
        // What fails this: rebuilding the sidecar from the four known keys — `extra` is lost;
        // setting `companion` when the note stayed — it would name a note that is not there.
        let text = r#"{"companion":"highlights/a.md","extra":[1],"highlights":[],"pdf":"a.pdf","version":1}"#;
        let moved: serde_json::Value =
            serde_json::from_str(&rewrite_records(text, "b.pdf", Some("highlights/b.md")).unwrap())
                .unwrap();
        assert_eq!(moved["pdf"], "b.pdf");
        assert_eq!(moved["companion"], "highlights/b.md");
        assert_eq!(moved["extra"], serde_json::json!([1]));
        assert_eq!(moved["version"], 1);
        let kept: serde_json::Value =
            serde_json::from_str(&rewrite_records(text, "b.pdf", None).unwrap()).unwrap();
        assert_eq!(kept["companion"], "highlights/a.md");
        assert!(rewrite_records("[]", "b.pdf", None).is_none());
        assert!(rewrite_records(r#"{"pdf":1,"companion":"c"}"#, "b.pdf", None).is_none());
        assert!(rewrite_records("not json", "b.pdf", None).is_none());
    }
}
