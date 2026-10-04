// §387 Which vault a command reads.

use super::error::{Candidate, CliError, ErrorCode};
use crate::context::manager::resolve_canonical;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RootKind {
    Vault,
    Folder,
}

/// A root the app has registered (a vault or a folder context), as config.json spells it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Registered {
    pub id: String,
    pub label: String,
    pub alias: Option<String>,
    pub path: String,
    pub kind: RootKind,
}

/// The vault a command reads. `root` is canonical, and it is the ONE spelling of the
/// root this run uses: the link index keys its files by the string it was built from,
/// and the task exclusion silently stops excluding when a prefix does not strip
/// (spec 0066 §3.4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Vault {
    pub name: String,
    pub root: PathBuf,
}

/// Registered roots that are directories right now, canonical, one per directory.
/// Vault contexts are taken first, so where a vault and a folder context name the same
/// directory the vault's label and kind are the ones kept.
fn live(registered: &[Registered]) -> Vec<(&Registered, PathBuf)> {
    let mut out: Vec<(&Registered, PathBuf)> = Vec::new();
    for kind in [RootKind::Vault, RootKind::Folder] {
        for entry in registered.iter().filter(|r| r.kind == kind) {
            if !Path::new(&entry.path).is_dir() {
                continue;
            }
            let Ok(root) = resolve_canonical(&entry.path) else {
                continue;
            };
            if out.iter().all(|(_, seen)| seen != &root) {
                out.push((entry, root));
            }
        }
    }
    out
}

fn candidates<'a>(entries: impl Iterator<Item = &'a Registered>) -> Vec<Candidate> {
    entries
        .map(|r| Candidate {
            name: r.label.clone(),
            path: r.path.clone(),
        })
        .collect()
}

/// Resolves the vault for one run (spec 0066 §3.3): `--vault <path>`, `--vault <name>`,
/// or — with no flag — the registered root that contains the current directory. Nothing
/// falls back to the app's active vault: called from a code repository, that would read
/// some other vault and say nothing.
///
/// `cwd` is the current directory, or the error reading it gave — a shell can sit in a
/// directory that was deleted. Only the two forms that read it fail with that error: no
/// `--vault`, and a path-form `--vault` that is still relative once `~` is expanded. A
/// name or an absolute path resolves without it.
pub(crate) fn resolve(
    arg: Option<&str>,
    cwd: Result<&Path, &CliError>,
    home: Option<&Path>,
    registered: &[Registered],
) -> Result<Vault, CliError> {
    match arg {
        Some(arg) if is_path_form(arg) => from_path(arg, cwd, home, registered),
        Some(arg) => from_name(arg, registered),
        None => from_cwd(cwd.map_err(CliError::clone)?, registered),
    }
}

/// A `--vault` value is a path when it could not be a name the app shows: it has a
/// separator, or starts with `.` or `~`. Deciding by FORM keeps a vault named `notes`
/// apart from a `notes` folder in the current directory.
fn is_path_form(arg: &str) -> bool {
    arg.contains('/')
        || arg.contains(std::path::MAIN_SEPARATOR)
        || arg.starts_with('.')
        || arg.starts_with('~')
}

fn from_path(
    arg: &str,
    cwd: Result<&Path, &CliError>,
    home: Option<&Path>,
    registered: &[Registered],
) -> Result<Vault, CliError> {
    let separators = ['/', std::path::MAIN_SEPARATOR];
    let expanded = match arg.strip_prefix('~') {
        Some(rest) if rest.is_empty() || rest.starts_with(separators) => {
            let home = home.ok_or_else(|| {
                CliError::new(
                    ErrorCode::InvalidArgument,
                    "cannot expand `~`: no home directory",
                )
            })?;
            home.join(rest.trim_start_matches(separators))
        }
        _ => PathBuf::from(arg),
    };
    let path = if expanded.is_absolute() {
        expanded
    } else {
        cwd.map_err(CliError::clone)?.join(expanded)
    };
    if !path.is_dir() {
        return Err(CliError::new(
            ErrorCode::VaultNotFound,
            format!("no directory at {}", path.display()),
        ));
    }
    let root = resolve_canonical(&path.to_string_lossy()).map_err(|e| {
        CliError::new(
            ErrorCode::Io,
            format!("cannot resolve {}: {e}", path.display()),
        )
    })?;
    let name = live(registered)
        .into_iter()
        .find(|(_, seen)| seen == &root)
        .map(|(entry, _)| entry.label.clone())
        .unwrap_or_else(|| folder_name(&root));
    Ok(Vault { name, root })
}

fn folder_name(root: &Path) -> String {
    root.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.to_string_lossy().into_owned())
}

/// Matches `label` and `alias` without regard to case and counts CONTEXTS whose
/// directory exists, one per canonical path. Counting fields instead would make a vault
/// ambiguous with itself — a vault's default alias is its default label — and counting
/// list entries would trip over the same path persisted twice.
fn from_name(name: &str, registered: &[Registered]) -> Result<Vault, CliError> {
    let wanted = name.to_lowercase();
    let matched: Vec<Registered> = registered
        .iter()
        .filter(|r| {
            r.label.to_lowercase() == wanted
                || r.alias
                    .as_deref()
                    .is_some_and(|a| a.to_lowercase() == wanted)
        })
        .cloned()
        .collect();
    let alive = live(&matched);
    match alive.as_slice() {
        [(entry, root)] => Ok(Vault {
            name: entry.label.clone(),
            root: root.clone(),
        }),
        [] if matched.is_empty() => Err(CliError::new(
            ErrorCode::VaultNotFound,
            format!("no registered vault is named `{name}`"),
        )
        .with_candidates(candidates(registered.iter()))),
        [] => Err(CliError::new(
            ErrorCode::VaultNotFound,
            format!("the vault named `{name}` is registered, but its directory is missing"),
        )
        .with_candidates(candidates(matched.iter()))),
        _ => Err(CliError::new(
            ErrorCode::VaultAmbiguous,
            format!("more than one registered vault is named `{name}`"),
        )
        .with_candidates(
            alive
                .iter()
                .map(|(entry, root)| Candidate {
                    name: entry.label.clone(),
                    path: root.to_string_lossy().into_owned(),
                })
                .collect(),
        )),
    }
}

/// The registered root that contains the current directory. Containment is by path
/// COMPONENT (`Path::starts_with`): a string prefix would let `/x/Vault` claim
/// `/x/Vault-secret`. Among several, a vault context beats a folder context and the
/// outermost wins — the app's task scan drops roots that sit under another root, and
/// its default scope reads vault contexts only (spec 0066 §3.3-2).
fn from_cwd(cwd: &Path, registered: &[Registered]) -> Result<Vault, CliError> {
    let here = resolve_canonical(&cwd.to_string_lossy()).map_err(|e| {
        CliError::new(
            ErrorCode::Io,
            format!("cannot resolve the current directory: {e}"),
        )
    })?;
    let containing: Vec<(&Registered, PathBuf)> = live(registered)
        .into_iter()
        .filter(|(_, root)| here.starts_with(root))
        .collect();
    let preferred = if containing
        .iter()
        .any(|(entry, _)| entry.kind == RootKind::Vault)
    {
        RootKind::Vault
    } else {
        RootKind::Folder
    };
    containing
        .into_iter()
        .filter(|(entry, _)| entry.kind == preferred)
        .min_by_key(|(_, root)| root.components().count())
        .map(|(entry, root)| Vault {
            name: entry.label.clone(),
            root,
        })
        .ok_or_else(|| {
            CliError::new(
                ErrorCode::VaultNotFound,
                format!(
                    "{} is not inside a registered vault; pass --vault <name|path>",
                    here.display()
                ),
            )
            .with_candidates(candidates(registered.iter()))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn registered(label: &str, alias: Option<&str>, path: &Path, kind: RootKind) -> Registered {
        Registered {
            id: format!("ctx-{label}"),
            label: label.to_string(),
            alias: alias.map(str::to_string),
            path: path.to_string_lossy().into_owned(),
            kind,
        }
    }

    /// A canonical temp dir with `dirs` created under it.
    fn tree(dirs: &[&str]) -> (TempDir, PathBuf) {
        let temp = TempDir::new().unwrap();
        let base = temp.path().canonicalize().unwrap();
        for dir in dirs {
            std::fs::create_dir_all(base.join(dir)).unwrap();
        }
        (temp, base)
    }

    // ── --vault <path> ────────────────────────────────────────────────────────────

    #[test]
    fn a_path_is_used_whether_or_not_it_is_registered() {
        let (_t, base) = tree(&["plain"]);
        let vault = resolve(Some("./plain"), Ok(&base), None, &[]).unwrap();
        assert_eq!(vault.root, base.join("plain"));
        assert_eq!(vault.name, "plain");
    }

    #[test]
    fn a_registered_path_takes_the_name_the_app_shows() {
        let (_t, base) = tree(&["plain"]);
        let list = [registered(
            "My Notes",
            None,
            &base.join("plain"),
            RootKind::Vault,
        )];
        let path = base.join("plain").to_string_lossy().into_owned();
        assert_eq!(
            resolve(Some(&path), Ok(&base), None, &list).unwrap().name,
            "My Notes"
        );
    }

    #[test]
    fn a_tilde_is_the_home_directory() {
        let (_t, base) = tree(&["home/notes"]);
        let home = base.join("home");
        assert_eq!(
            resolve(Some("~"), Ok(&base), Some(&home), &[])
                .unwrap()
                .root,
            home
        );
        assert_eq!(
            resolve(Some("~/notes"), Ok(&base), Some(&home), &[])
                .unwrap()
                .root,
            home.join("notes")
        );
        let error = resolve(Some("~/notes"), Ok(&base), None, &[]).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArgument);
    }

    #[test]
    fn a_path_that_is_not_a_directory_is_vault_not_found() {
        let (_t, base) = tree(&[]);
        std::fs::write(base.join("file.md"), "x").unwrap();
        for arg in ["./nope", "./file.md"] {
            let error = resolve(Some(arg), Ok(&base), None, &[]).unwrap_err();
            assert_eq!(error.code, ErrorCode::VaultNotFound, "{arg}");
        }
    }

    #[test]
    fn an_unreadable_current_directory_fails_only_the_forms_that_read_it() {
        let (_t, base) = tree(&["a"]);
        let list = [registered("notes", None, &base.join("a"), RootKind::Vault)];
        let unreadable = CliError::new(ErrorCode::Io, "cannot read the current directory: gone");
        let absolute = base.join("a").to_string_lossy().into_owned();
        for arg in [absolute.as_str(), "~/a", "notes"] {
            let vault = resolve(Some(arg), Err(&unreadable), Some(&base), &list).unwrap();
            assert_eq!(vault.root, base.join("a"), "{arg}");
        }
        for arg in [None, Some("./a"), Some("a/")] {
            let error = resolve(arg, Err(&unreadable), Some(&base), &list).unwrap_err();
            assert_eq!(error, unreadable, "{arg:?}");
        }
    }

    // ── --vault <name> ────────────────────────────────────────────────────────────

    #[test]
    fn a_name_matches_label_or_alias_without_regard_to_case() {
        let (_t, base) = tree(&["a", "b"]);
        let list = [
            registered("Notes", Some("nt"), &base.join("a"), RootKind::Vault),
            registered("일지", None, &base.join("b"), RootKind::Vault),
        ];
        assert_eq!(
            resolve(Some("notes"), Ok(&base), None, &list).unwrap().root,
            base.join("a")
        );
        assert_eq!(
            resolve(Some("NT"), Ok(&base), None, &list).unwrap().root,
            base.join("a")
        );
        assert_eq!(
            resolve(Some("일지"), Ok(&base), None, &list).unwrap().root,
            base.join("b")
        );
    }

    #[test]
    fn a_vault_whose_alias_equals_its_label_is_not_ambiguous_with_itself() {
        let (_t, base) = tree(&["a"]);
        let list = [registered(
            "notes",
            Some("notes"),
            &base.join("a"),
            RootKind::Vault,
        )];
        assert_eq!(
            resolve(Some("notes"), Ok(&base), None, &list).unwrap().root,
            base.join("a")
        );
    }

    #[test]
    fn the_same_directory_listed_twice_counts_once() {
        let (_t, base) = tree(&["a"]);
        let list = [
            registered("notes", None, &base.join("a"), RootKind::Vault),
            registered("notes", None, &base.join("a"), RootKind::Vault),
        ];
        assert_eq!(
            resolve(Some("notes"), Ok(&base), None, &list).unwrap().root,
            base.join("a")
        );
    }

    #[test]
    fn two_directories_under_one_name_are_ambiguous_and_both_are_listed() {
        let (_t, base) = tree(&["a", "b"]);
        let list = [
            registered("notes", None, &base.join("a"), RootKind::Vault),
            registered("Notes", None, &base.join("b"), RootKind::Folder),
        ];
        let error = resolve(Some("notes"), Ok(&base), None, &list).unwrap_err();
        assert_eq!(error.code, ErrorCode::VaultAmbiguous);
        assert_eq!(error.candidates.len(), 2);
    }

    #[test]
    fn a_missing_directory_does_not_count_and_a_live_namesake_wins() {
        let (_t, base) = tree(&["a"]);
        let gone = base.join("gone");
        let only_gone = [registered("notes", None, &gone, RootKind::Vault)];
        let error = resolve(Some("notes"), Ok(&base), None, &only_gone).unwrap_err();
        assert_eq!(error.code, ErrorCode::VaultNotFound);
        assert_eq!(error.candidates[0].path, gone.to_string_lossy());

        let with_live = [
            registered("notes", None, &gone, RootKind::Vault),
            registered("notes", None, &base.join("a"), RootKind::Vault),
        ];
        assert_eq!(
            resolve(Some("notes"), Ok(&base), None, &with_live)
                .unwrap()
                .root,
            base.join("a")
        );
    }

    #[test]
    fn an_unknown_name_lists_every_registered_vault() {
        let (_t, base) = tree(&["a"]);
        let list = [registered("notes", None, &base.join("a"), RootKind::Vault)];
        let error = resolve(Some("nope"), Ok(&base), None, &list).unwrap_err();
        assert_eq!(error.code, ErrorCode::VaultNotFound);
        assert_eq!(error.candidates.len(), 1);
    }

    // ── no --vault: the current directory ─────────────────────────────────────────

    #[test]
    fn the_current_directory_picks_the_registered_root_above_it() {
        let (_t, base) = tree(&["vault/sub/deep"]);
        let list = [registered("V", None, &base.join("vault"), RootKind::Vault)];
        let vault = resolve(None, Ok(&base.join("vault/sub/deep")), None, &list).unwrap();
        assert_eq!((vault.name.as_str(), vault.root), ("V", base.join("vault")));
    }

    #[test]
    fn of_two_nested_vaults_the_outer_one_wins() {
        let (_t, base) = tree(&["outer/inner/x"]);
        let list = [
            registered("inner", None, &base.join("outer/inner"), RootKind::Vault),
            registered("outer", None, &base.join("outer"), RootKind::Vault),
        ];
        let vault = resolve(None, Ok(&base.join("outer/inner/x")), None, &list).unwrap();
        assert_eq!(vault.name, "outer");
    }

    #[test]
    fn a_vault_inside_a_folder_context_beats_the_folder() {
        let (_t, base) = tree(&["work/notes/x", "work/code"]);
        let list = [
            registered("work", None, &base.join("work"), RootKind::Folder),
            registered("notes", None, &base.join("work/notes"), RootKind::Vault),
        ];
        assert_eq!(
            resolve(None, Ok(&base.join("work/notes/x")), None, &list)
                .unwrap()
                .name,
            "notes"
        );
        // Outside the vault but inside the folder context, the folder is all there is.
        assert_eq!(
            resolve(None, Ok(&base.join("work/code")), None, &list)
                .unwrap()
                .name,
            "work"
        );
    }

    #[test]
    fn a_sibling_whose_name_starts_the_same_is_not_inside() {
        let (_t, base) = tree(&["Vault", "Vault-secret"]);
        let list = [registered(
            "Vault",
            None,
            &base.join("Vault"),
            RootKind::Vault,
        )];
        let error = resolve(None, Ok(&base.join("Vault-secret")), None, &list).unwrap_err();
        assert_eq!(error.code, ErrorCode::VaultNotFound);
        assert_eq!(error.candidates.len(), 1);
    }
}
