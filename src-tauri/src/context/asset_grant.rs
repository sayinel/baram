// §89 / §329.2 What `asset://` serves for a registered context.
//
// Two readers share this rule: `commands/context_cmd.rs`'s `register_asset_scope` grants it, and
// `commands/thumbnail_cmd.rs` asks whether a photo lies inside it — an image's preview has to be
// allowed wherever the image itself is shown, or the editor body falls back to drawing the full
// original there (§3.3).

use std::path::{Path, PathBuf};

use super::manager::resolve_canonical;
use super::{ContextInfo, ContextManager, ContextType};

/// §backlog #3 / §89 — the `asset://` scope a context should be granted.
#[derive(Debug, PartialEq)]
pub enum AssetScopeGrant {
    /// Allow a single file (fallback when a file path has no parent directory).
    File(PathBuf),
    /// Allow a directory (recursively).
    Dir(PathBuf),
}

/// Decide the asset-protocol scope grant for a context.
///
/// §89 A standalone external `File` context grants its *parent directory*
/// (recursive) — not just the `.md` file — so images referenced relative to the
/// file (siblings and subfolders such as the Typora-style `./assets/img.png`)
/// resolve over `asset://`. `Vault`/`Folder` contexts grant their own directory.
pub fn asset_scope_grant(ctx: &ContextInfo) -> AssetScopeGrant {
    match ctx.context_type {
        ContextType::File => match Path::new(&ctx.path).parent() {
            Some(dir) => AssetScopeGrant::Dir(dir.to_path_buf()),
            None => AssetScopeGrant::File(PathBuf::from(&ctx.path)),
        },
        ContextType::Vault | ContextType::Folder => AssetScopeGrant::Dir(PathBuf::from(&ctx.path)),
    }
}

/// Whether `path` lies under the asset grant of a context registered **now**.
///
/// This answers which open context would be the reason a file is shown — not whether `asset://`
/// serves it. That second question is tauri's, and `thumbnail_cmd::authorize_source` asks it as
/// well, because the two answers differ in both directions:
/// - tauri's scope only grows (§335: revoking with `forbid_*` would kill a later re-approval), so
///   it still serves the folder of a context closed an hour ago, and `$APPDATA/**`, the thumbnail
///   cache and the plugin folders. This answers from the contexts held at the call.
/// - This resolves the context's path at the call, while tauri matches against the patterns it
///   stored when it granted, and tauri does not serve every path below a granted folder (on unix
///   `**` skips a component that starts with `.`). So this can cover a file tauri refuses.
pub async fn under_a_registered_grant(contexts: &ContextManager, path: &str) -> bool {
    let Ok(target) = resolve_canonical(path) else {
        return false;
    };
    contexts
        .list()
        .await
        .iter()
        .any(|ctx| grant_covers(&asset_scope_grant(ctx), &target))
}

/// Whether the canonical `target` lies under `grant`, the grant's path resolved at the call.
/// `Path::starts_with` compares whole components, so `/x/Vault` does not take `/x/Vault-secret`.
fn grant_covers(grant: &AssetScopeGrant, target: &Path) -> bool {
    match grant {
        AssetScopeGrant::File(file) => {
            resolve_canonical(&file.to_string_lossy()).is_ok_and(|file| file == target)
        }
        AssetScopeGrant::Dir(dir) => {
            resolve_canonical(&dir.to_string_lossy()).is_ok_and(|root| target.starts_with(root))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(context_type: ContextType, path: &str) -> ContextInfo {
        ContextInfo {
            id: "id".into(),
            context_type,
            path: path.into(),
            label: "label".into(),
            color: "#ffffff".into(),
            alias: None,
            vault_type: None,
            added_at: 0,
        }
    }

    #[test]
    fn file_context_grants_parent_directory() {
        // §89 external single file → grant its parent dir (recursive) so sibling
        // and subfolder images resolve over asset:// (they were previously
        // outside the scope because only the .md file itself was allowed).
        let grant = asset_scope_grant(&ctx(ContextType::File, "/Users/x/Desktop/note.md"));
        assert_eq!(
            grant,
            AssetScopeGrant::Dir(PathBuf::from("/Users/x/Desktop"))
        );
    }

    #[test]
    fn vault_context_grants_own_directory() {
        let grant = asset_scope_grant(&ctx(ContextType::Vault, "/Users/x/vault"));
        assert_eq!(grant, AssetScopeGrant::Dir(PathBuf::from("/Users/x/vault")));
    }

    #[test]
    fn folder_context_grants_own_directory() {
        let grant = asset_scope_grant(&ctx(ContextType::Folder, "/Users/x/folder"));
        assert_eq!(
            grant,
            AssetScopeGrant::Dir(PathBuf::from("/Users/x/folder"))
        );
    }

    /// `Path::starts_with` is per component — `/x/Vault` must not take `/x/Vault-secret`.
    /// Fails if the prefix test becomes a string prefix.
    #[test]
    fn a_directory_grant_does_not_cover_a_sibling_whose_name_extends_it() {
        let parent = tempfile::TempDir::new().unwrap();
        let root = parent.path().join("Vault");
        let secret = parent.path().join("Vault-secret");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&secret).unwrap();
        std::fs::write(root.join("in.png"), b"x").unwrap();
        std::fs::write(secret.join("out.png"), b"x").unwrap();
        let grant = AssetScopeGrant::Dir(root.clone());
        let canonical = |p: &Path| std::fs::canonicalize(p).unwrap();

        assert!(grant_covers(&grant, &canonical(&root.join("in.png"))));
        assert!(!grant_covers(&grant, &canonical(&secret.join("out.png"))));
    }

    /// The division of labour `thumbnail_cmd::authorize_source` relies on, measured against a
    /// real `register_asset_scope` grant rather than read from tauri's source: the files a File
    /// context exists to show, this covers and tauri serves; a file beside the folder, neither;
    /// a dot path below it, this covers and tauri refuses on unix — the reason the thumbnailer
    /// asks tauri too.
    #[tokio::test]
    async fn under_a_file_context_it_covers_what_tauri_serves_and_more() {
        use tauri::Manager;
        let app = tauri::test::mock_app();
        let contexts = ContextManager::new();
        let dir = tempfile::TempDir::new().unwrap();
        let outside = tempfile::TempDir::new().unwrap();
        let note = dir.path().join("note.md");
        std::fs::write(&note, "").unwrap();
        let added = contexts
            .add(ctx(ContextType::File, &note.to_string_lossy()))
            .await
            .unwrap();
        crate::commands::context_cmd::register_asset_scope(app.handle(), &added);
        let file = |path: PathBuf| {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, b"x").unwrap();
            path
        };
        let shown = [
            file(dir.path().join("photo.png")),
            file(dir.path().join("assets/photo.png")),
        ];
        let hidden = [
            file(dir.path().join(".photo.png")),
            file(dir.path().join(".private/photo.png")),
        ];
        let beside = file(outside.path().join("photo.png"));
        let scope = app.asset_protocol_scope();
        let covered = |path: &Path| {
            let path = path.to_string_lossy().to_string();
            let contexts = &contexts;
            async move { under_a_registered_grant(contexts, &path).await }
        };

        for path in &shown {
            assert!(covered(path).await, "{}", path.display());
            assert!(scope.is_allowed(path), "{}", path.display());
        }
        assert!(!covered(&beside).await);
        assert!(!scope.is_allowed(&beside));
        for path in &hidden {
            assert!(covered(path).await, "{}", path.display());
            #[cfg(unix)]
            assert!(!scope.is_allowed(path), "{}", path.display());
        }
    }
}
