// §387 Which vault a command reads, and how a path argument maps into it.

use super::error::{Candidate, CliError, ErrorCode};
use crate::context::manager::resolve_canonical;
use std::path::{Component, Path, PathBuf};

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

/// Folds `.` and `..` without touching the filesystem. `None` when `..` would climb
/// past the start of the path.
fn fold(path: &Path) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    return None;
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    Some(out)
}

/// A path argument as an absolute path inside the vault. Relative input is relative to
/// the VAULT ROOT, not the current directory — the paths a command prints can be passed
/// straight back in. An absolute input is accepted when it lies inside the vault. The
/// result may not exist; a caller that needs a file checks for one.
///
/// This is a scope rule, not a security boundary: the caller's shell can already read
/// anything this process can. It keeps an agent inside the vault it was pointed at.
pub(crate) fn locate(vault: &Vault, input: &str) -> Result<PathBuf, CliError> {
    let outside = || {
        CliError::new(
            ErrorCode::PathOutsideVault,
            format!("{input} is outside the vault at {}", vault.root.display()),
        )
    };
    let candidate = if Path::new(input).is_absolute() {
        PathBuf::from(input)
    } else {
        // Pushed component by component: a verbatim Windows root (`\\?\C:\…`, what
        // canonicalize returns there) does not read `/` as a separator.
        let separators: &[char] = if cfg!(windows) { &['/', '\\'] } else { &['/'] };
        let mut joined = vault.root.clone();
        for part in input.split(separators).filter(|part| !part.is_empty()) {
            joined.push(part);
        }
        joined
    };
    // `..` is folded BEFORE the filesystem is asked: `resolve_canonical` climbs to an
    // existing ancestor by file name, and a path that ends in `..` has none.
    let folded = fold(&candidate).ok_or_else(outside)?;
    let resolved = resolve_canonical(&folded.to_string_lossy())
        .map_err(|e| CliError::new(ErrorCode::Io, format!("cannot resolve {input}: {e}")))?;
    // After canonicalization, so a symlink inside the vault that points out is caught.
    if !resolved.starts_with(&vault.root) {
        return Err(outside());
    }
    Ok(resolved)
}

/// A `--folder` value: a directory inside the vault that a whole-vault walk would also
/// enter. The walkers apply their skip rules to the CHILDREN of the directory they are
/// given, never to that directory itself, so a skipped folder passed as the start would
/// list files the app never shows (spec 0066 §3.4).
///
/// The components checked are the ones BELOW the vault root. Checking the input as
/// typed would refuse `./docs` for its `.`, and an absolute path whenever the vault
/// itself sits under a dot folder.
pub(crate) fn folder_arg(vault: &Vault, input: &str) -> Result<PathBuf, CliError> {
    let folder = locate(vault, input)?;
    if walk_skips(vault, &folder) {
        return Err(CliError::new(
            ErrorCode::InvalidArgument,
            format!(
                "{input} is a folder the vault walk skips (hidden, or one of: {})",
                crate::fs::SKIP_DIRS.join(", ")
            ),
        ));
    }
    // `Path::exists` and `is_dir` are false whenever the metadata cannot be read, so a
    // folder behind a directory that cannot be entered would be reported as absent.
    // FILE_NOT_FOUND is for what is not there; any other failure is IO, with the OS's
    // reason (the split `ops::read` makes for a file).
    match std::fs::metadata(&folder) {
        Ok(meta) if meta.is_dir() => Ok(folder),
        Ok(_) => Err(CliError::new(
            ErrorCode::InvalidArgument,
            format!("{input} is a file, not a folder"),
        )),
        Err(source)
            if matches!(
                source.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
            ) =>
        {
            Err(CliError::new(
                ErrorCode::FileNotFound,
                format!("no folder at {input}"),
            ))
        }
        Err(source) => Err(CliError::new(
            ErrorCode::Io,
            format!("cannot read {input}: {source}"),
        )),
    }
}

/// A path argument that names a file inside the vault.
///
/// `Path::is_file` is false whenever the metadata cannot be read — std's own examples
/// are a permission error and a broken symlink — so a file behind a directory that
/// cannot be entered would be reported as absent. FILE_NOT_FOUND is for what is not
/// there: nothing at the path, a file where a directory should be, or a directory (not
/// a file). Any other failure is IO, with the OS's reason.
pub(crate) fn file_arg(vault: &Vault, input: &str) -> Result<PathBuf, CliError> {
    let file = locate(vault, input)?;
    match std::fs::metadata(&file) {
        Ok(meta) if meta.is_file() => Ok(file),
        Ok(_) => Err(CliError::new(
            ErrorCode::FileNotFound,
            format!("no file at {input}"),
        )),
        Err(source)
            if matches!(
                source.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
            ) =>
        {
            Err(CliError::new(
                ErrorCode::FileNotFound,
                format!("no file at {input}"),
            ))
        }
        Err(source) => Err(CliError::new(
            ErrorCode::Io,
            format!("cannot read {input}: {source}"),
        )),
    }
}

/// A `--file` value for a command that reads a NOTE: a file the vault walk would list.
/// The walk lists `.md` and `.markdown` files by name, case-sensitively, and never
/// enters a hidden or `SKIP_DIRS` folder, so a file outside that is refused the way
/// `folder_arg` refuses a skipped folder — an answer for it would show what the app never
/// shows (spec 0066 §3.4).
pub(crate) fn note_arg(vault: &Vault, input: &str) -> Result<PathBuf, CliError> {
    let file = file_arg(vault, input)?;
    let name = file
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    if !(name.ends_with(".md") || name.ends_with(".markdown")) {
        return Err(CliError::new(
            ErrorCode::InvalidArgument,
            format!("{input} is not a markdown note"),
        ));
    }
    if walk_skips(vault, &file) {
        return Err(CliError::new(
            ErrorCode::InvalidArgument,
            format!("{input} is where the vault walk does not go"),
        ));
    }
    Ok(file)
}

/// Whether the vault walk never reaches `path`: a component BELOW the vault root is
/// hidden, or is one of `SKIP_DIRS`. The walkers skip a hidden ENTRY of either kind and
/// test `SKIP_DIRS` on directories only; a file named exactly like one of those is never
/// a note, so for what the callers ask — a folder, or a markdown file — the answer is the
/// same.
pub(crate) fn walk_skips(vault: &Vault, path: &Path) -> bool {
    path.strip_prefix(&vault.root)
        .unwrap_or(path)
        .components()
        .any(|component| {
            let name = component.as_os_str().to_string_lossy();
            name.starts_with('.') || crate::fs::SKIP_DIRS.contains(&name.as_ref())
        })
}

/// `/` between components on every platform.
pub(crate) fn slashed(path: &Path) -> String {
    path.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// A path under the vault as the CLI prints it: relative to the root, `/`-separated.
/// A path that is not under the root is printed as it is.
pub(crate) fn relative(vault: &Vault, path: &Path) -> String {
    match path.strip_prefix(&vault.root) {
        Ok(rest) => slashed(rest),
        Err(_) => path.to_string_lossy().into_owned(),
    }
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

    fn vault_at(root: &Path) -> Vault {
        Vault {
            name: "v".into(),
            root: root.to_path_buf(),
        }
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

    // ── path arguments ────────────────────────────────────────────────────────────

    #[test]
    fn a_relative_path_is_relative_to_the_vault_root() {
        let (_t, base) = tree(&["vault/notes"]);
        let vault = vault_at(&base.join("vault"));
        assert_eq!(
            locate(&vault, "notes/a.md").unwrap(),
            base.join("vault/notes/a.md")
        );
        assert_eq!(
            locate(&vault, "./notes//a.md").unwrap(),
            base.join("vault/notes/a.md")
        );
    }

    #[test]
    fn an_absolute_path_inside_the_vault_is_accepted() {
        let (_t, base) = tree(&["vault/notes"]);
        let vault = vault_at(&base.join("vault"));
        let inside = base.join("vault/notes/a.md");
        assert_eq!(locate(&vault, &inside.to_string_lossy()).unwrap(), inside);
    }

    #[test]
    fn climbing_out_is_refused_however_it_is_spelled() {
        let (_t, base) = tree(&["vault/notes", "vault2", "other"]);
        std::fs::write(base.join("other/secret.md"), "x").unwrap();
        std::fs::write(base.join("vault2/secret.md"), "x").unwrap();
        let vault = vault_at(&base.join("vault"));
        let absolute = base.join("other/secret.md").to_string_lossy().into_owned();
        for input in [
            "../other/secret.md",
            // A sibling whose name starts with the vault's: contained by string prefix,
            // not by path component.
            "../vault2/secret.md",
            "notes/../../other/secret.md",
            "nope/../../other/secret.md",
            absolute.as_str(),
        ] {
            let error = locate(&vault, input).unwrap_err();
            assert_eq!(error.code, ErrorCode::PathOutsideVault, "{input}");
        }
        // The mechanism works at all: a `..` that stays inside is fine.
        assert_eq!(
            locate(&vault, "notes/../notes/a.md").unwrap(),
            base.join("vault/notes/a.md")
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_that_leaves_the_vault_is_refused() {
        let (_t, base) = tree(&["vault", "other"]);
        std::fs::write(base.join("other/secret.md"), "x").unwrap();
        std::os::unix::fs::symlink(base.join("other"), base.join("vault/link")).unwrap();
        let vault = vault_at(&base.join("vault"));
        let error = locate(&vault, "link/secret.md").unwrap_err();
        assert_eq!(error.code, ErrorCode::PathOutsideVault);
    }

    #[test]
    fn printed_paths_are_relative_and_slash_separated() {
        let (_t, base) = tree(&["vault/notes"]);
        let vault = vault_at(&base.join("vault"));
        assert_eq!(
            relative(&vault, &base.join("vault/notes/a.md")),
            "notes/a.md"
        );
        assert_eq!(slashed(Path::new("a").join("b").as_path()), "a/b");
    }

    // ── --folder ──────────────────────────────────────────────────────────────────

    #[test]
    fn a_folder_the_walk_skips_is_refused_even_when_it_does_not_exist() {
        let (_t, base) = tree(&["vault/docs", "vault/.obsidian", "vault/node_modules"]);
        let vault = vault_at(&base.join("vault"));
        for input in [
            ".obsidian",
            "node_modules",
            "docs/.cache",
            "docs/node_modules/x",
        ] {
            let error = folder_arg(&vault, input).unwrap_err();
            assert_eq!(error.code, ErrorCode::InvalidArgument, "{input}");
        }
    }

    #[test]
    fn only_the_components_below_the_vault_root_are_checked() {
        // The vault itself sits under a dot folder: its own path must not disqualify it.
        let (_t, base) = tree(&[".hidden/vault/docs"]);
        let vault = vault_at(&base.join(".hidden/vault"));
        let docs = base.join(".hidden/vault/docs");
        assert_eq!(folder_arg(&vault, "docs").unwrap(), docs);
        assert_eq!(folder_arg(&vault, "./docs").unwrap(), docs);
        assert_eq!(folder_arg(&vault, &docs.to_string_lossy()).unwrap(), docs);
    }

    #[test]
    fn a_missing_folder_and_a_file_are_told_apart() {
        let (_t, base) = tree(&["vault/docs"]);
        std::fs::write(base.join("vault/docs/a.md"), "x").unwrap();
        let vault = vault_at(&base.join("vault"));
        assert_eq!(
            folder_arg(&vault, "nope").unwrap_err().code,
            ErrorCode::FileNotFound
        );
        assert_eq!(
            folder_arg(&vault, "docs/a.md").unwrap_err().code,
            ErrorCode::InvalidArgument
        );
    }

    // ── --file ────────────────────────────────────────────────────────────────────

    #[test]
    fn a_note_the_walk_lists_is_accepted() {
        // The vault sits under a dot folder: only the components below its root count.
        let (_t, base) = tree(&[".hidden/vault/notes"]);
        let root = base.join(".hidden/vault");
        std::fs::write(root.join("notes/a.md"), "x").unwrap();
        std::fs::write(root.join("notes/b.markdown"), "x").unwrap();
        let vault = vault_at(&root);
        for name in ["a.md", "b.markdown"] {
            let input = format!("notes/{name}");
            assert_eq!(
                note_arg(&vault, &input).unwrap(),
                root.join("notes").join(name),
                "{input}"
            );
        }
    }

    /// Each file exists, so the refusal is the note check's and not a missing file's. The
    /// walk lists `.md` and `.markdown` by name, case-sensitively (`A.MD` is not listed),
    /// and never enters a hidden folder or one of `SKIP_DIRS`, nor lists a hidden file.
    #[test]
    fn a_file_the_walk_never_shows_is_refused_with_the_reason() {
        let (_t, base) = tree(&["vault/.hidden", "vault/node_modules", "vault/notes"]);
        let root = base.join("vault");
        for rel in [
            "notes/a.txt",
            "notes/A.MD",
            "notes/.draft.md",
            ".hidden/x.md",
            "node_modules/m.md",
        ] {
            std::fs::write(root.join(rel), "x").unwrap();
        }
        let vault = vault_at(&root);
        for (input, message) in [
            ("notes/a.txt", "notes/a.txt is not a markdown note"),
            ("notes/A.MD", "notes/A.MD is not a markdown note"),
            (
                "notes/.draft.md",
                "notes/.draft.md is where the vault walk does not go",
            ),
            (
                ".hidden/x.md",
                ".hidden/x.md is where the vault walk does not go",
            ),
            (
                "node_modules/m.md",
                "node_modules/m.md is where the vault walk does not go",
            ),
        ] {
            let error = note_arg(&vault, input).unwrap_err();
            assert_eq!(error.code, ErrorCode::InvalidArgument, "{input}");
            assert_eq!(error.message, message, "{input}");
        }
    }

    /// The file questions come first: a name that would fail the note check is still
    /// reported as missing, or outside, when it is.
    #[test]
    fn the_note_check_comes_after_the_file_questions() {
        let (_t, base) = tree(&["vault/notes", "other"]);
        std::fs::write(base.join("other/secret.txt"), "x").unwrap();
        let vault = vault_at(&base.join("vault"));
        for (input, code) in [
            ("nope.txt", ErrorCode::FileNotFound),
            ("notes", ErrorCode::FileNotFound),
            ("../other/secret.txt", ErrorCode::PathOutsideVault),
        ] {
            assert_eq!(note_arg(&vault, input).unwrap_err().code, code, "{input}");
        }
    }
}
