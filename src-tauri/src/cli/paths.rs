// §387 How a path argument maps into the vault a command reads, and how a path under it
// is printed (spec 0066 §3.4). Which vault that is, is `vault.rs`.

use super::error::{CliError, ErrorCode};
use super::spelling;
use super::vault::Vault;
use crate::context::manager::resolve_canonical;
use std::path::{Component, Path, PathBuf};

/// Folds `.` and `..` without touching the filesystem. `None` when `..` would climb
/// past the start of the path.
pub(crate) fn fold(path: &Path) -> Option<PathBuf> {
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
/// What this guards depends on the caller. For the CLI it is a scope rule, not a security
/// boundary: the caller's shell can already read anything this process can, and the rule
/// keeps an agent inside the vault it was pointed at. For `baram mcp` it is the tools' file
/// boundary: the caller is a model with no shell, whose arguments can come from the text of
/// a note it read (spec 0068 D6), and every note or folder path a tool takes reaches the
/// disk through this function — `backlinks` calls it directly, every other tool that takes
/// one through `folder_arg` or `note_names_first`. There an absolute input must start with
/// one of `Vault::spellings` by its letters, which asks nothing of the disk: a spelling of
/// the root that the server was not given — a link to it, another case on a volume that
/// ignores case — is outside, whether or not it would resolve into the vault (spec 0068
/// §3.2). What follows the spelling is put onto the canonical root as written, and is then
/// resolved and checked as on the command line.
pub(crate) fn locate(vault: &Vault, input: &str) -> Result<PathBuf, CliError> {
    let outside = || {
        CliError::new(
            ErrorCode::PathOutsideVault,
            format!("{input} is outside the vault at {}", vault.root.display()),
        )
    };
    let windows = cfg!(windows);
    let candidate = if Path::new(input).is_absolute() {
        match &vault.spellings {
            None => PathBuf::from(input),
            Some(spellings) => {
                let rest = below_a_spelling(input, spellings, windows).ok_or_else(outside)?;
                pushed(&vault.root, input, rest.iter().map(String::as_str), windows)?
            }
        }
    } else {
        // Pushed component by component: a verbatim Windows root (`\\?\C:\…`, what
        // canonicalize returns there) does not read `/` as a separator.
        let separators: &[char] = if windows { &['/', '\\'] } else { &['/'] };
        let parts = input.split(separators).filter(|part| !part.is_empty());
        pushed(&vault.root, input, parts, windows)?
    };
    // `..` is folded BEFORE the filesystem is asked: `resolve_canonical` climbs to an
    // existing ancestor by file name, and a path that ends in `..` has none. Only `folded`
    // reaches the disk — neither `input` nor `candidate` is handed to it — so a `..` is
    // applied to the letters even after a symbolic link (`only_the_folded_path_reaches_the_disk`).
    let folded = fold(&candidate).ok_or_else(outside)?;
    let resolved = resolve_canonical(&folded.to_string_lossy())
        .map_err(|e| CliError::new(ErrorCode::Io, format!("cannot resolve {input}: {e}")))?;
    // After canonicalization, so a symlink inside the vault that points out is caught.
    if !resolved.starts_with(&vault.root) {
        return Err(outside());
    }
    Ok(resolved)
}

/// The parts of the absolute `input` below one of `spellings`, as written, by their letters
/// (`spelling::letters`) — `None` when no spelling starts it, or `input` climbs past its
/// root.
fn below_a_spelling(input: &str, spellings: &[String], windows: bool) -> Option<Vec<String>> {
    let path = spelling::letters(input, windows)?;
    spellings.iter().find_map(|spelled| {
        let root = spelling::letters(spelled, windows)?;
        path.below(&root).map(<[String]>::to_vec)
    })
}

/// `root` with each of `parts` pushed onto it. A part that `PathBuf::push` would not append
/// as one name (`spelling::not_one_name` — on Windows, `C:x` replaces the path it is pushed
/// onto) is refused before it is pushed: INVALID_ARGUMENT, the argument being what has to
/// change, as for a path the system refuses as written (`refused_as_written`).
fn pushed<'a>(
    root: &Path,
    input: &str,
    parts: impl IntoIterator<Item = &'a str>,
    windows: bool,
) -> Result<PathBuf, CliError> {
    let mut joined = root.to_path_buf();
    for part in parts {
        if spelling::not_one_name(part, windows) {
            return Err(CliError::new(
                ErrorCode::InvalidArgument,
                format!("{input} is not a valid path: `{part}` is not a name a folder can hold"),
            ));
        }
        joined.push(part);
    }
    Ok(joined)
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
    // A failed read is split by `metadata_failure`; a file is not a folder.
    match std::fs::metadata(&folder) {
        Ok(meta) if meta.is_dir() => Ok(folder),
        Ok(_) => Err(CliError::new(
            ErrorCode::InvalidArgument,
            format!("{input} is a file, not a folder"),
        )),
        Err(source) => Err(metadata_failure(input, "folder", source)),
    }
}

/// A path argument that names a file inside the vault.
///
/// `Path::is_file` is false whenever the metadata cannot be read — std's own examples
/// are a permission error and a broken symlink — so a file behind a directory that
/// cannot be entered would be reported as absent. A failed read is split by
/// `metadata_failure`; a directory is FILE_NOT_FOUND too, as it is not a file.
pub(crate) fn file_arg(vault: &Vault, input: &str) -> Result<PathBuf, CliError> {
    existing_file(input, locate(vault, input)?)
}

/// The question `file_arg` asks of what `locate` returned: is a file there.
fn existing_file(input: &str, file: PathBuf) -> Result<PathBuf, CliError> {
    match std::fs::metadata(&file) {
        Ok(meta) if meta.is_file() => Ok(file),
        Ok(_) => Err(CliError::new(
            ErrorCode::FileNotFound,
            format!("no file at {input}"),
        )),
        Err(source) => Err(metadata_failure(input, "file", source)),
    }
}

/// INVALID_ARGUMENT for a path the system refuses as written, or `None`: a NUL inside it
/// (`InvalidInput` — std checks for it before it asks the system, and reads the system's
/// `EINVAL` the same way), or a name or a whole path longer than the system takes
/// (`InvalidFilename` — std's reading of `ENAMETOOLONG`, which macOS gives for a name past
/// its 255-byte `NAME_MAX` and for a path past its 1,024-byte `PATH_MAX`). The argument is
/// what has to change. What Windows reports for a character it does not allow has not been
/// checked.
pub(crate) fn refused_as_written(
    input: &str,
    noun: &str,
    source: &std::io::Error,
) -> Option<CliError> {
    matches!(
        source.kind(),
        std::io::ErrorKind::InvalidInput | std::io::ErrorKind::InvalidFilename
    )
    .then(|| {
        CliError::new(
            ErrorCode::InvalidArgument,
            format!("{input} is not a valid {noun} path: {source}"),
        )
    })
}

/// What a failed `metadata` on a path argument means — the one split `folder_arg` and
/// `file_arg` share: INVALID_ARGUMENT for a path the system refuses as written
/// (`refused_as_written`); FILE_NOT_FOUND `no <noun> at <input>` for what is not there —
/// nothing at the path (`NotFound`), or a file where one of its directories should be
/// (`NotADirectory`); IO `cannot read <input>: <OS error>` for any other failure — a
/// directory on the way that cannot be entered is one.
fn metadata_failure(input: &str, noun: &str, source: std::io::Error) -> CliError {
    if let Some(error) = refused_as_written(input, noun, &source) {
        return error;
    }
    match source.kind() {
        std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory => {
            CliError::new(ErrorCode::FileNotFound, format!("no {noun} at {input}"))
        }
        _ => CliError::new(ErrorCode::Io, format!("cannot read {input}: {source}")),
    }
}

/// A `--file` value for a command that reads a NOTE: a file the vault walk would list.
/// The walk lists a file by its name (`fs::is_note_name`) and never enters a hidden or
/// `SKIP_DIRS` folder (`walk_skips`), so a file outside that is refused the way
/// `folder_arg` refuses a skipped folder — an answer for it would show what the app never
/// shows (spec 0066 §3.4). Whether the file is there is asked first: on the command line a
/// missing `notes.txt` is FILE_NOT_FOUND. `baram mcp` asks in the other order
/// (`note_names_first`).
pub(crate) fn note_arg(vault: &Vault, input: &str) -> Result<PathBuf, CliError> {
    let file = file_arg(vault, input)?;
    note_rules(vault, input, &file)?;
    Ok(file)
}

/// `note_arg` for the MCP server's tools that read a note — `read_note`, `list_tasks` with
/// `file`, `outgoing_links` (spec 0068 D6): the note rules are asked after `locate` and
/// before the file is, so a path they refuse gets one answer whether a file is there or
/// not, and a tool does not tell whether a file it would never read exists. The rules are
/// asked of `locate`'s result, not of the letters given: on a volume that ignores case
/// (measured on macOS APFS), `X.MD` resolves to a note stored as `x.md` and is read, as it
/// is on the command line. Where `locate` resolves a path to other letters, the one answer
/// ends: a `link.md` that links to a file that is no note, and on such a volume
/// `NODE_MODULES/m.md`, are refused when they resolve and FILE_NOT_FOUND when nothing is
/// there.
pub(crate) fn note_names_first(vault: &Vault, input: &str) -> Result<PathBuf, CliError> {
    let file = locate(vault, input)?;
    note_rules(vault, input, &file)?;
    existing_file(input, file)
}

/// The two rules a note path meets, both asked of the path `locate` returned — neither reads
/// the disk.
fn note_rules(vault: &Vault, input: &str, file: &Path) -> Result<(), CliError> {
    let name = file
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    if !crate::fs::is_note_name(&name) {
        return Err(CliError::new(
            ErrorCode::InvalidArgument,
            format!("{input} is not a markdown note"),
        ));
    }
    if walk_skips(vault, file) {
        return Err(CliError::new(
            ErrorCode::InvalidArgument,
            format!("{input} is where the vault walk does not go"),
        ));
    }
    Ok(())
}

/// Whether the vault walk never reaches `path`: `fs::is_skipped_relative`, the walkers' own
/// rule, asked of the components BELOW the vault root. The callers pass what `locate`
/// returned, which lies under the root. `search`'s own walker skips hidden directories but
/// not hidden files; `search` reaches this only through `--folder`, and for a folder the
/// two rules agree.
pub(crate) fn walk_skips(vault: &Vault, path: &Path) -> bool {
    crate::fs::is_skipped_relative(path.strip_prefix(&vault.root).unwrap_or(path))
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
            spellings: None,
        }
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

    /// Only the folded path reaches the disk: a `..` after a link is applied to the letters,
    /// so `out/../tabs.md` is the vault's own `tabs.md` although `out` links elsewhere —
    /// following the link first, as the kernel would, gives `<elsewhere>/tabs.md`, outside.
    ///
    /// What fails this: `resolve_canonical` given the joined path instead of the folded one.
    #[cfg(unix)]
    #[test]
    fn only_the_folded_path_reaches_the_disk() {
        let (_t, base) = tree(&["vault", "elsewhere/deep"]);
        std::fs::write(base.join("vault/tabs.md"), "x").unwrap();
        std::fs::write(base.join("elsewhere/tabs.md"), "x").unwrap();
        std::os::unix::fs::symlink(base.join("elsewhere/deep"), base.join("vault/out")).unwrap();
        let vault = vault_at(&base.join("vault"));
        assert_eq!(
            locate(&vault, "out/../tabs.md").unwrap(),
            base.join("vault/tabs.md")
        );
        // The control: the link itself leads out of the vault.
        assert_eq!(
            locate(&vault, "out").unwrap_err().code,
            ErrorCode::PathOutsideVault
        );
    }

    /// For `baram mcp` (`Vault::spellings` set) an absolute path must start with one of the
    /// root's spellings by its letters (spec 0068 §3.2), and the rest is put onto the
    /// canonical root as written. A link to the vault is no spelling unless it is given as
    /// one, so it is refused as outside whatever it resolves to — while the command line,
    /// which has no spellings, resolves it on disk and accepts it. A link inside the vault
    /// that points out is still caught after the rebase.
    ///
    /// What fails this: the spellings ignored (the link is accepted); the containment check
    /// skipped after a rebase (`out/secret.md` is accepted).
    #[cfg(unix)]
    #[test]
    fn for_the_mcp_server_an_absolute_path_starts_with_a_spelling_of_the_root() {
        let (_t, base) = tree(&["vault/Notes", "other"]);
        std::fs::write(base.join("other/secret.md"), "x").unwrap();
        std::os::unix::fs::symlink(base.join("vault"), base.join("to-vault")).unwrap();
        std::os::unix::fs::symlink(base.join("other"), base.join("vault/out")).unwrap();
        let root = base.join("vault");
        let canonical = root.to_string_lossy().into_owned();
        let link = base.join("to-vault").to_string_lossy().into_owned();
        let cli = vault_at(&root);
        let given = |spellings: &[&str]| Vault {
            spellings: Some(spellings.iter().map(|s| s.to_string()).collect()),
            ..vault_at(&root)
        };
        let through_link = format!("{link}/Notes/a.md");
        assert_eq!(
            locate(&cli, &through_link).unwrap(),
            root.join("Notes/a.md")
        );
        let only_canonical = given(&[&canonical]);
        let refused = locate(&only_canonical, &through_link).unwrap_err();
        assert_eq!(refused.code, ErrorCode::PathOutsideVault);
        assert_eq!(
            refused.message,
            format!("{through_link} is outside the vault at {canonical}")
        );
        for spelled in [
            format!("{canonical}/Notes/a.md"),
            format!("{canonical}/./Notes//a.md"),
            format!("{canonical}/x/../Notes/a.md"),
        ] {
            assert_eq!(
                locate(&only_canonical, &spelled).unwrap(),
                root.join("Notes/a.md"),
                "{spelled}"
            );
        }
        let with_link = given(&[&canonical, &link]);
        assert_eq!(
            locate(&with_link, &through_link).unwrap(),
            root.join("Notes/a.md")
        );
        assert_eq!(
            locate(&with_link, &format!("{link}/out/secret.md"))
                .unwrap_err()
                .code,
            ErrorCode::PathOutsideVault
        );
    }

    /// On Windows a part of a relative path that starts with a drive (`C:x`) would replace
    /// the vault root when pushed — `C:x` names the current directory of drive `C:` — so it
    /// is refused before it is pushed. Tested with `windows = true` on every host; on Unix
    /// the same part is a name.
    ///
    /// What fails this: `pushed` without the `spelling::not_one_name` check.
    #[test]
    fn a_part_that_names_a_drive_is_refused_before_it_is_pushed() {
        let root = Path::new("/v");
        let error = pushed(root, "notes/C:x", ["notes", "C:x"], true).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArgument);
        assert_eq!(
            error.message,
            "notes/C:x is not a valid path: `C:x` is not a name a folder can hold"
        );
        // On Unix `C:x` is a name like any other. (On a Windows host `Path::join` itself
        // reads it as a drive, so this half says nothing there.)
        if cfg!(unix) {
            assert_eq!(
                pushed(root, "notes/C:x", ["notes", "C:x"], false).unwrap(),
                root.join("notes").join("C:x")
            );
        }
    }

    /// On Windows, through `locate` itself: a relative part that starts with a drive is refused
    /// before it is pushed, and for `baram mcp` an absolute path is put onto the verbatim root
    /// `canonicalize` gives, whether it is written with that `\\?\` prefix and `\`, with `/`
    /// after it — a path built from the `vault.path` a tool reports — or as the plain drive
    /// path a user types. Runs once a Windows job runs the tests.
    ///
    /// What fails this: `locate` pushing a part without `pushed`'s check (`C:x` then replaces
    /// the root and is read against drive `C:`'s current directory); the letters reading
    /// `\\?\D:` and `D:` as two places, or `/` after it as part of a name.
    #[cfg(windows)]
    #[test]
    fn on_windows_a_drive_part_is_refused_and_a_verbatim_root_takes_each_spelling_of_it() {
        let (_t, base) = tree(&["vault/notes"]);
        let root = base.join("vault");
        let error = locate(&vault_at(&root), "notes/C:x").unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArgument, "{}", error.message);
        let canonical = root.to_string_lossy().into_owned();
        let plain = canonical
            .strip_prefix(r"\\?\")
            .expect("canonicalize gives a verbatim path")
            .to_string();
        let vault = Vault {
            spellings: Some(vec![canonical.clone()]),
            ..vault_at(&root)
        };
        for input in [
            format!(r"{canonical}\notes\a.md"),
            format!("{canonical}/notes/a.md"),
            format!(r"{canonical}\notes/a.md"),
            format!(r"{plain}\notes\a.md"),
        ] {
            assert_eq!(
                locate(&vault, &input).unwrap(),
                root.join("notes").join("a.md"),
                "{input}"
            );
        }
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

    /// The message names the rule. The list is written out here, not built from
    /// `SKIP_DIRS`: built from it, the test would agree with any list.
    ///
    /// What fails this: the folder check dropped (`.obsidian` exists, so it is listed);
    /// the message's list built from anything but the walkers' `SKIP_DIRS`.
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
            assert_eq!(
                error.message,
                format!(
                    "{input} is a folder the vault walk skips \
                     (hidden, or one of: node_modules, .git, .obsidian, .baram)"
                ),
                "{input}"
            );
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

    /// A path that goes through a file names nothing, for a folder argument and a file
    /// argument alike. On macOS the read fails with `NotADirectory`, not `NotFound`.
    #[test]
    fn a_path_through_a_file_is_not_found() {
        let (_t, base) = tree(&["vault/docs"]);
        std::fs::write(base.join("vault/docs/a.md"), "x").unwrap();
        let vault = vault_at(&base.join("vault"));
        assert_eq!(
            folder_arg(&vault, "docs/a.md/x").unwrap_err().code,
            ErrorCode::FileNotFound
        );
        assert_eq!(
            file_arg(&vault, "docs/a.md/x").unwrap_err().code,
            ErrorCode::FileNotFound
        );
    }

    /// The split between what is not there and what could not be read, which both path
    /// arguments make, one error kind at a time. The kinds that are neither — a path the
    /// system refuses as written — are pinned by
    /// `a_path_the_system_cannot_take_is_an_invalid_argument`. On disk, the IO arm
    /// is pinned end to end on Unix (tests/cli.rs is `#![cfg(unix)]`) by its
    /// `…_in_a_directory_that_cannot_be_entered_…` tests — for `read`, for `files` and
    /// `search --folder`, and for `tasks --file`.
    #[test]
    fn a_failed_metadata_read_is_file_not_found_only_when_nothing_is_there() {
        use std::io::{Error, ErrorKind};
        for (kind, code) in [
            (ErrorKind::NotFound, ErrorCode::FileNotFound),
            (ErrorKind::NotADirectory, ErrorCode::FileNotFound),
            (ErrorKind::PermissionDenied, ErrorCode::Io),
        ] {
            let error = metadata_failure("a/b", "file", Error::from(kind));
            assert_eq!(error.code, code, "{kind:?}");
        }
        let missing = metadata_failure("a/b", "folder", Error::from(ErrorKind::NotFound));
        assert_eq!(missing.message, "no folder at a/b");
        let denied = metadata_failure("a/b", "file", Error::from(ErrorKind::PermissionDenied));
        assert!(
            denied.message.starts_with("cannot read a/b: "),
            "{}",
            denied.message
        );
    }

    /// A path the system refuses as written — a NUL inside it, or a name longer than the file
    /// system takes — is the caller's to fix: INVALID_ARGUMENT, not IO. A 255-byte name is
    /// one the system takes, so it is only not there. Unix only: what Windows reports for
    /// these two has not been checked.
    ///
    /// What fails this: `metadata_failure` without `refused_as_written` (both end as IO);
    /// either kind read as "not there" (FILE_NOT_FOUND).
    #[cfg(unix)]
    #[test]
    fn a_path_the_system_cannot_take_is_an_invalid_argument() {
        let dir = tempfile::TempDir::new().unwrap();
        let vault = Vault {
            name: "v".into(),
            root: dir.path().canonicalize().unwrap(),
            spellings: None,
        };
        let long = format!("{}.md", "x".repeat(300));
        for input in ["a\0b.md", long.as_str()] {
            for (what, result) in [
                ("file", file_arg(&vault, input)),
                ("folder", folder_arg(&vault, input)),
                ("note", note_arg(&vault, input)),
            ] {
                let error = result.unwrap_err();
                assert_eq!(
                    error.code,
                    ErrorCode::InvalidArgument,
                    "{what} {input:?}: {}",
                    error.message
                );
                assert!(
                    error.message.contains("is not a valid"),
                    "{what}: {}",
                    error.message
                );
            }
        }
        let longest = format!("{}.md", "x".repeat(252));
        assert_eq!(
            file_arg(&vault, &longest).unwrap_err().code,
            ErrorCode::FileNotFound
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

    /// `note_arg` and `folder_arg` answer as the walk does, over the fixture of
    /// `fs::walk_rules`' own parity test plus `c.MD`: a note is accepted exactly when
    /// `collect_md_files` lists it, and a folder exactly when the walk enters it. Links are
    /// left out — the walk does not follow them, and `locate` resolves them first.
    ///
    /// What fails this: either check reading a rule of its own that the walkers do not share
    /// — `.md` matched without regard to case (`c.MD` accepted), `.markdown` left out,
    /// hidden files let through (`sub/.h.md`), a `SKIP_DIRS` folder entered.
    #[tokio::test]
    async fn the_note_and_folder_checks_admit_what_the_vault_walk_does() {
        let (_t, base) = tree(&["vault"]);
        let root = base.join("vault");
        let files = [
            "a.md",
            "b.markdown",
            "c.pdf",
            "c.MD",
            ".DS_Store",
            ".obsidian/w.json",
            "node_modules/x.md",
            "sub/.h.md",
            "sub/d.md",
            "sub/.drafts/e.md",
        ];
        for file in files {
            let path = root.join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, "x").unwrap();
        }
        let vault = vault_at(&root);
        let mut listed = Vec::new();
        crate::fs::collect_md_files(&root, &mut listed)
            .await
            .unwrap();
        let mut accepted: Vec<&str> = files
            .iter()
            .copied()
            .filter(|file| note_arg(&vault, file).is_ok())
            .collect();
        let mut walked: Vec<String> = listed.iter().map(|path| relative(&vault, path)).collect();
        accepted.sort_unstable();
        walked.sort_unstable();
        assert_eq!(accepted, walked);
        // A positive half: the fixture puts notes on both sides of the rule.
        assert_eq!(accepted, ["a.md", "b.markdown", "sub/d.md"]);

        // The folders the walk enters: the root and each one a file it collects lies in.
        let mut every = Vec::new();
        crate::fs::collect_all_files(&root, &mut every)
            .await
            .unwrap();
        let mut entered: Vec<String> = every
            .iter()
            .filter_map(|path| path.parent())
            .map(|dir| relative(&vault, dir))
            .collect();
        entered.sort_unstable();
        entered.dedup();
        assert_eq!(entered, ["", "sub"]);
        for folder in ["", "sub", ".obsidian", "node_modules", "sub/.drafts"] {
            assert_eq!(
                folder_arg(&vault, folder).is_ok(),
                entered.iter().any(|dir| dir == folder),
                "{folder:?}"
            );
        }
    }

    /// For `baram mcp` the note rules come before the file questions (`note_names_first`):
    /// a name the rules refuse gets the same answer whether a file is there or not, so a
    /// tool does not tell whether a file it would never read exists (spec 0068 D6). What
    /// `locate` refuses still comes first, and a name the rules take is then asked about —
    /// a note is read when it is there and missing when it is not.
    ///
    /// What fails this: `note_names_first` asking for the file before the rules (each
    /// refused name is then FILE_NOT_FOUND in the empty vault); the rules asked before
    /// `locate` (`../other/x.txt` is then "not a markdown note").
    #[test]
    fn for_the_mcp_server_a_name_the_note_rules_refuse_answers_alike_whether_it_is_there() {
        let (_t, base) = tree(&[
            "full/notes",
            "full/.git",
            "full/node_modules",
            "empty",
            "other",
        ]);
        let full = base.join("full");
        for file in [
            ".env",
            ".git/config",
            "x.txt",
            "notes/.draft.md",
            "node_modules/m.md",
            "a.md",
        ] {
            std::fs::write(full.join(file), "x").unwrap();
        }
        std::fs::create_dir_all(full.join("d.md")).unwrap();
        std::fs::write(base.join("other/x.txt"), "x").unwrap();
        let (full, empty) = (vault_at(&full), vault_at(&base.join("empty")));
        for (input, code) in [
            (".env", ErrorCode::InvalidArgument),
            (".git/config", ErrorCode::InvalidArgument),
            ("x.txt", ErrorCode::InvalidArgument),
            ("notes/.draft.md", ErrorCode::InvalidArgument),
            ("node_modules/m.md", ErrorCode::InvalidArgument),
            ("d.md", ErrorCode::FileNotFound),
            ("../other/x.txt", ErrorCode::PathOutsideVault),
        ] {
            let there = note_names_first(&full, input).unwrap_err();
            let absent = note_names_first(&empty, input).unwrap_err();
            assert_eq!(there.code, code, "{input}: {}", there.message);
            assert_eq!(
                there
                    .message
                    .replace(&full.root.to_string_lossy().into_owned(), "<root>"),
                absent
                    .message
                    .replace(&empty.root.to_string_lossy().into_owned(), "<root>"),
                "{input}"
            );
            assert_eq!(there.code, absent.code, "{input}");
        }
        assert_eq!(
            note_names_first(&full, "a.md").unwrap(),
            full.root.join("a.md")
        );
        assert_eq!(
            note_names_first(&empty, "a.md").unwrap_err().code,
            ErrorCode::FileNotFound
        );
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
