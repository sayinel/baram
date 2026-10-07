// §387 How a path argument maps into the vault a command reads, and how a path under it
// is printed (spec 0066 §3.4). Which vault that is, is `vault.rs`.

use super::error::{CliError, ErrorCode};
use super::vault::Vault;
use crate::context::manager::resolve_canonical;
use std::path::{Component, Path, PathBuf};

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
    if walk_skips(vault, &folder, true)? {
        return Err(CliError::new(
            ErrorCode::InvalidArgument,
            format!(
                "{input} is a folder the vault walk skips (hidden, one of: {}, or left out by {})",
                crate::fs::DEFAULT_EXCLUDED_DIRS.join(", "),
                crate::fs::BARAMIGNORE
            ),
        ));
    }
    // `Path::exists` and `is_dir` are false whenever the metadata cannot be read, so a
    // folder behind a directory that cannot be entered would be reported as absent.
    // FILE_NOT_FOUND is for what is not there; any other failure is IO, with the OS's
    // reason (the split `file_arg` makes for a file).
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
/// enters a hidden folder or one `walk_skips` leaves out, so a file outside that is refused the way
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
    if walk_skips(vault, &file, false)? {
        return Err(CliError::new(
            ErrorCode::InvalidArgument,
            format!("{input} is where the vault walk does not go"),
        ));
    }
    Ok(file)
}

/// Whether the vault walk never reaches `path`: `VaultExclusion::walk_skips` under the
/// vault root — a component BELOW the root is hidden, or the default list or the vault's
/// `.baramignore` leaves it or a folder above it out. The two `fs` walkers,
/// `collect_md_files` and `collect_all_files`, skip a hidden ENTRY of either kind and ask
/// the same matcher of every entry, so for what the callers ask — a folder, or a markdown
/// file — the answer is the one those two walkers give. `search`'s own walker skips
/// hidden directories but not hidden files; `search` reaches this only through
/// `--folder`, and for a folder the two rules agree.
pub(crate) fn walk_skips(vault: &Vault, path: &Path, is_dir: bool) -> Result<bool, CliError> {
    Ok(exclusion(vault)?.walk_skips(path, is_dir))
}

/// The vault's `VaultExclusion`; a `.baramignore` that cannot be used is an IO error
/// naming it, as every other walk reports it.
pub(crate) fn exclusion(vault: &Vault) -> Result<crate::fs::VaultExclusion, CliError> {
    crate::fs::VaultExclusion::load(&vault.root).map_err(|e| {
        CliError::new(
            ErrorCode::Io,
            match e {
                crate::fs::FsError::BaramIgnore { path, reason } => {
                    format!("cannot use {}: {reason}", path.display())
                }
                other => other.to_string(),
            },
        )
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
    /// and never enters a hidden folder or one of `DEFAULT_EXCLUDED_DIRS`, nor lists a hidden file.
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
