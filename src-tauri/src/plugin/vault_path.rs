// §260 Phase 4a/4c — pure, Tauri-independent path decisions for the sandboxed
// plugin file broker. Extracted from commands/plugin_cmd.rs (§1 split review):
// these functions take no AppHandle and touch no IPC state, so they belong beside
// plugin/mod.rs's other path-decision helpers (plugin_data_dir, resolve_key_path,
// single_segment) rather than in the command layer.
//
// commands::plugin_cmd remains the thin adapter: check_plugin_file_path and
// plugin_path_anchor wire an AppHandle to the decisions made here.

/// The app's own per-vault state directory, which brokered file ops refuse.
const VAULT_STATE_DIR: &str = ".baram";

/// §260 Phase 3c-2c — refuse the `.baram` tree even inside an open vault.
///
/// A `files` grant is described to the user as reading and writing files in the
/// vault, and `.baram/` is not user content — it is the app's own per-vault state, so
/// writing it is a strictly larger privilege than the grant describes:
///
/// - `.baram/config.json` is the vault's SETTINGS OVERRIDE layer (§86,
///   `context/vault_config.rs`), applied over the user's global settings. It carries
///   `ai.privacyMode` — a plugin that can write it can turn the privacy restriction
///   **off**, after which the app itself is permitted to send document content to a
///   cloud provider — plus `ai.model`, `extensions.enabled/disabled` (silently
///   disabling editor features), `editor.skillsFolder`, and
///   `markdown.serializationRules`, which changes how every document in the vault is
///   written back to disk.
/// - `.baram/snapshots/` holds copies of earlier file versions (§71), i.e. content
///   the user may believe they deleted.
///
/// (An earlier version of this comment claimed the AI `baseUrl` lives here. It does
/// not — 3c-2c security review, F6: `AiSection` is model/privacyMode/contextScope,
/// and `baseUrl` comes from the app-global settings store via `ollamaUrl`. The
/// carve-out stands on what is actually in the file.)
///
/// Matched on path COMPONENTS after canonicalization, so `..` tricks, a nested
/// `sub/.baram/x`, and a symlink into the tree are all covered, while a file merely
/// named `.baramish` is not.
pub(crate) fn reject_app_state_path(resolved: &std::path::Path) -> Result<(), String> {
    if resolved
        .components()
        .any(|c| c.as_os_str() == VAULT_STATE_DIR)
    {
        return Err(format!(
            "access denied: {VAULT_STATE_DIR}/ is app state, not vault content"
        ));
    }
    Ok(())
}

/// §260 Phase 4a — a sandboxed plugin's path, validated as VAULT-RELATIVE.
///
/// The sandboxed tier cannot express an absolute path: the host never tells a sandbox
/// a root (that would hand every `files`-granted plugin the user's home directory and
/// username), so a path from that realm is always relative to a context root resolved
/// here. Refusing anything but plain components is what makes the domain small enough
/// to reason about — `..`, a leading `/`, and a Windows prefix (`C:`, `\\server\share`)
/// are all rejected before any filesystem call.
///
/// This NARROWS the input; it does not replace the vault rule. `ensure_path_in_vault`
/// still runs on the resolved path, which is what catches the case this check cannot
/// see: an in-vault symlink whose target is outside.
///
/// `""` and `"."` are accepted and mean the context root, so a plugin needs no
/// bootstrap path at all — `listDir("")` enumerates the vault.
fn vault_relative(path: &str) -> Result<&std::path::Path, String> {
    use std::path::Component;
    let relative = std::path::Path::new(path);
    for component in relative.components() {
        match component {
            Component::CurDir => {}
            // §260 Phase 4a security review (LOW-4) — on Windows a colon inside a
            // component names an alternate data stream (`note.md:hidden`), which
            // `components()` hands back as one ordinary `Normal`. Such a write lands on
            // an in-vault file, so it is within what `files` grants, but it is invisible
            // to `files_list` and to the user. Precautionary: `:` is legal in a POSIX
            // filename, so the refusal is Windows-only, and the reviewer could not
            // verify the behaviour on a Windows host.
            Component::Normal(name) if cfg!(windows) && contains_colon(name) => {
                return Err(format!(
                    "path \"{path}\" must not contain \":\" (alternate data stream)"
                ))
            }
            Component::Normal(_) => {}
            // Deliberately does not echo which rule was hit: one message for every
            // rejected shape is less to keep in sync, and a plugin learns nothing
            // useful from the distinction.
            _ => {
                return Err(format!(
                    "path \"{path}\" must be relative to the context root \
                     (no absolute paths, no \"..\")"
                ))
            }
        }
    }
    Ok(relative)
}

/// Does one path component contain a colon? Compared on the raw bytes so a non-UTF-8
/// component is judged too, rather than passing by virtue of being unreadable.
fn contains_colon(name: &std::ffi::OsStr) -> bool {
    name.as_encoded_bytes().contains(&b':')
}

/// An `FsError` with any absolute path replaced by the caller's own relative one.
///
/// §260 Phase 4a — the sandboxed tier must never receive an absolute path, and two
/// `FsError` variants carry one in their `Display`. Matched EXHAUSTIVELY on purpose: a
/// wildcard arm would silently pass through the next variant that happens to embed a
/// path, which is the fail-open shape this phase's review kept finding.
pub(crate) fn redact_fs_error(error: &crate::fs::FsError, caller_path: &str) -> String {
    use crate::fs::FsError;
    match error {
        // Keep the sentinel — the frontend's `listDir` wrapper parses it (§4.3) — and
        // swap only the path after the colon.
        FsError::PermissionDenied(_) => format!("PERMISSION_DENIED:{caller_path}"),
        FsError::NotFound(_) => format!("file \"{caller_path}\" was not found"),
        // These carry an `io::Error` or a watcher message, neither of which embeds a
        // path on any platform we build for.
        FsError::ReadError(_) | FsError::TrashError(_) | FsError::WatchError(_) => {
            error.to_string()
        }
    }
}

/// Where a sandboxed plugin's relative path lands, given its anchor context.
///
/// Extracted from `check_plugin_file_path` so the whole decision is unit-testable
/// without an `AppHandle` (the 3c-2a M4 / 3c-2c `admit_op` pattern): a test that can
/// only assert on `vault_relative` in isolation would still pass if the caller stopped
/// calling it.
pub(crate) fn plugin_target_path(
    root: std::path::PathBuf,
    context_type: &crate::context::types::ContextType,
    path: &str,
) -> Result<std::path::PathBuf, String> {
    let relative = vault_relative(path)?;
    // A `File` context (§89 single-file mode) is a file, not a directory, so the only
    // path it can anchor is the file itself. Joining onto it would produce a path that
    // cannot exist, and the error would read as "not found" rather than "there is no
    // directory here".
    if *context_type == crate::context::types::ContextType::File {
        if relative.components().any(|c| c.as_os_str() != ".") {
            return Err(format!(
                "path \"{path}\": this context is a single file, so only \"\" or \".\" names it"
            ));
        }
        return Ok(root);
    }
    Ok(root.join(relative))
}

/// The canonical path as a `&str` for the `crate::fs` helpers, which take one. A
/// non-UTF-8 path is refused rather than lossily converted: a lossy string would
/// name a DIFFERENT file than the one just authorized.
pub(crate) fn authorized_path_str(path: &std::path::Path) -> Result<&str, String> {
    path.to_str()
        .ok_or_else(|| "path is not valid UTF-8".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The resolution step of `check_plugin_file_path` plus the guard. The vault check
    /// that sits between them needs an `AppHandle`, so it is exercised by the
    /// `fs_cmd` tests; what matters here is that the guard always judges a RESOLVED
    /// path, never the caller's string.
    fn resolve_then_reject(path: &std::path::Path) -> Result<std::path::PathBuf, String> {
        let resolved = crate::context::manager::resolve_canonical(path.to_str().unwrap())?;
        reject_app_state_path(&resolved)?;
        Ok(resolved)
    }

    /// §260 Phase 4a — the sandboxed tier's whole path domain, asserted through the
    /// function the op actually calls.
    ///
    /// The point of the phase is that a sandbox is never told a root, so it cannot form
    /// an absolute path; these are the shapes a plugin could still try. Every rejection
    /// here happens before any filesystem call.
    #[test]
    fn a_sandbox_path_cannot_leave_its_context_root() {
        use crate::context::types::ContextType;
        let root = std::path::PathBuf::from(if cfg!(windows) { r"C:\vault" } else { "/vault" });
        let vault = |p: &str| plugin_target_path(root.clone(), &ContextType::Vault, p);

        // Plain relative paths land under the root.
        assert_eq!(vault("note.md").unwrap(), root.join("note.md"));
        assert_eq!(
            vault("notes/deep/a.md").unwrap(),
            root.join("notes").join("deep").join("a.md")
        );
        // …and the root itself needs no path at all, which is what frees a plugin from
        // having to learn one (the smoke fixture's deleted `VAULT_DIR`).
        assert_eq!(vault("").unwrap(), root);
        assert_eq!(vault(".").unwrap(), root);
        assert_eq!(vault("./note.md").unwrap(), root.join("note.md"));

        let refused = |p: &str| {
            let e = vault(p).expect_err(&format!("must be refused: {p:?}"));
            assert!(e.contains("must be relative"), "unexpected error: {e}");
        };
        refused("/etc/passwd"); // absolute
        refused("../../etc/passwd"); // traversal
        refused("notes/../../escape.md"); // traversal after a valid component
        refused(".."); // bare traversal
        if cfg!(windows) {
            refused(r"C:\Windows\System32\x"); // a drive prefix is absolute here
            refused(r"\\server\share\x"); // and so is a UNC path
            refused(r"\Windows\x"); // rooted, no prefix
                                    // …and an alternate data stream, which `components()` reports as one
                                    // ordinary component (security review LOW-4). Message differs, so assert
                                    // separately rather than through `refused`.
            let e = vault("note.md:hidden").expect_err("an ADS must be refused");
            assert!(e.contains("alternate data stream"), "unexpected error: {e}");
        } else {
            // A colon is a legal POSIX filename character, so the refusal above must
            // NOT apply here — refusing it would break real vaults.
            assert_eq!(
                vault("note:with:colons.md").unwrap(),
                root.join("note:with:colons.md")
            );
        }

        // §89 single-file context: it anchors only itself.
        let file = |p: &str| plugin_target_path(root.clone(), &ContextType::File, p);
        assert_eq!(file("").unwrap(), root);
        let e = file("sibling.md").expect_err("a file context has no directory");
        assert!(e.contains("single file"), "unexpected error: {e}");
    }

    /// §260 Phase 4a security review (MEDIUM-2) — an error must not carry an absolute
    /// path back into the sandboxed realm. This was the only channel that did: a
    /// TCC-blocked vault answered `listDir("")` with the user's home directory.
    #[test]
    fn a_filesystem_error_never_carries_an_absolute_path_to_the_sandbox() {
        use crate::fs::FsError;
        let secret = "/Users/someone/Documents/Private Vault";

        let denied = redact_fs_error(&FsError::PermissionDenied(secret.into()), "notes");
        // The sentinel survives — the frontend's `listDir` wrapper parses it (§4.3) —
        // but the path is the caller's own.
        assert_eq!(denied, "PERMISSION_DENIED:notes");
        assert!(!denied.contains(secret));

        let missing = redact_fs_error(&FsError::NotFound(secret.into()), "notes/a.md");
        assert!(!missing.contains(secret), "leaked: {missing}");
        assert!(missing.contains("notes/a.md"), "unexpected: {missing}");

        // A variant that carries no path is passed through unchanged, so a real cause is
        // not flattened into a generic message.
        let io = redact_fs_error(
            &FsError::ReadError(std::io::Error::other("disk on fire")),
            "notes",
        );
        assert!(io.contains("disk on fire"), "unexpected: {io}");
    }

    /// §260 3c-2c — `.baram/` is the app's own per-vault state, so a plugin that could
    /// write it could flip `ai.privacyMode` off or rewrite
    /// `markdown.serializationRules` for every document. Component-matched after
    /// canonicalization, so nesting and `..` are covered and a similarly-named file
    /// is not.
    #[test]
    fn app_state_paths_are_refused_at_any_depth() {
        let base = std::env::temp_dir().join(format!("baram-state-{}", std::process::id()));
        let state = base.join(VAULT_STATE_DIR);
        let nested = base.join("notes").join(VAULT_STATE_DIR);
        std::fs::create_dir_all(state.join("snapshots").join("data")).unwrap();
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(state.join("config.json"), "{}").unwrap();
        std::fs::write(base.join("note.md").as_path(), "# hi").unwrap();
        std::fs::write(base.join(".baramish").as_path(), "not app state").unwrap();

        let denied = |p: std::path::PathBuf| {
            let e =
                resolve_then_reject(&p).expect_err(&format!("must be refused: {}", p.display()));
            assert!(e.contains("app state"), "unexpected error: {e}");
        };
        denied(state.join("config.json"));
        denied(state.join("snapshots").join("data").join("old.md"));
        denied(nested.join("anything.md")); // not just at the vault root
        denied(state.join("does-not-exist-yet.json")); // a WRITE target need not exist
                                                       // Nor can a traversal launder it.
        denied(
            base.join("notes")
                .join("..")
                .join(VAULT_STATE_DIR)
                .join("config.json"),
        );

        // Ordinary content, and a file merely NAMED like the state dir, are fine.
        assert!(resolve_then_reject(&base.join("note.md")).is_ok());
        assert!(resolve_then_reject(&base.join(".baramish")).is_ok());

        std::fs::remove_dir_all(&base).ok();
    }

    /// §260 3c-2c — the ops act on the RESOLVED path, which is what closes the
    /// symlink-swap window a `files`-granted plugin could otherwise open (it controls
    /// both the path it asks for and, inside the vault, what that path points at) —
    /// and it is also what stops a symlink from disguising an app-state target.
    #[cfg(unix)]
    #[test]
    fn resolution_defeats_a_symlink_and_the_guard_judges_the_target() {
        let base = std::env::temp_dir().join(format!("baram-link-{}", std::process::id()));
        std::fs::create_dir_all(base.join("real")).unwrap();
        std::fs::create_dir_all(base.join(VAULT_STATE_DIR)).unwrap();
        let target = base.join("real").join("note.md");
        std::fs::write(&target, "# hi").unwrap();
        std::fs::write(base.join(VAULT_STATE_DIR).join("config.json"), "{}").unwrap();

        // An innocent link resolves to its target, and THAT is what the op receives.
        let link = base.join("link.md");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert_eq!(
            resolve_then_reject(&link).unwrap(),
            std::fs::canonicalize(&target).unwrap(),
            "a symlinked path must resolve to its target before the op runs"
        );

        // A link whose name says "note" but which points into app state is refused,
        // because the guard sees the resolved path, not the innocuous one.
        let disguise = base.join("innocent.md");
        std::os::unix::fs::symlink(base.join(VAULT_STATE_DIR).join("config.json"), &disguise)
            .unwrap();
        let err = resolve_then_reject(&disguise).expect_err("a disguised link must be refused");
        assert!(err.contains("app state"), "unexpected error: {err}");

        std::fs::remove_dir_all(&base).ok();
    }
}
